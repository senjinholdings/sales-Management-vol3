/**
 * 日報（dailyTimers）の記入漏れ防止。2つのスケジュール実行Cloud Functionsで構成する：
 * - タイマーの止め忘れ・つけ忘れ: 10分おきに実行し、(a) 予定時間を明らかに超えて
 *   動いたままのタスク、(b) 日中（9時〜22時未満）なのに誰も実行中のタスクがない状態、
 *   の両方を検知して本人にSlack DM。どちらもチェック間隔（10分）そのものが再送間隔になる
 *   （動きっぱなし・止まりっぱなしが続く限り毎回送る。個別の抑制フラグは持たない）
 * - 夜の振り返りフロー: 平日分は今日から先2週間ぶん「振り返り」タスク枠（23:30〜24:00）を
 *   前もって自動で用意しておく（固定枠。カレンダーで先の日付を開いても既に入っている）。
 *   23:30になったらSlackスレッドを
 *   1本立てて開始連絡をし、以後23:40〜1:00は10分おきに、そのスレッドへ催促を返信し続ける。
 *   止まるのは「完了」ボタン（functions/staff.jsのnight-review-completeエンドポイント）が
 *   押された時だけで、文字が入力されたかどうかでは判定しない。土日は枠の用意・催促とも行わない
 *
 * Slackへの送信は個人DMではなく、#営業_日報チャンネル（担当者・増田さんの両方が
 * 参加済み）への投稿＋両者へのメンションで行う。ユーザー本人だけでは「自分に届いて
 * いるか」の確認が取りづらいため、常に両方をメンションする形に決めた。
 * ユーザーIDの特定はfunctions/slackApproval.jsのresolveSlackUserId
 * （staffMembers.email → users.lookupByEmail）をそのまま再利用する。
 */

const { WebClient } = require('@slack/web-api');
const { env } = require('./authHelpers');
const { resolveSlackUserId } = require('./slackApproval');

// タスクの合計実働時間（休止を挟んだ場合も含む）が「予定+20分」かつ「予定×1.3倍」の
// 両方を超えたら明らかな超過とみなす
const OVERRUN_BUFFER_MINUTES = 20;
const OVERRUN_RATIO = 1.3;
// 「実行中のタスクなし」リマインドの対象時間帯（この時間外＝夜は送らない）
const IDLE_CHECK_START_HOUR = 9;
const IDLE_CHECK_END_HOUR = 22;

// 日報機能は今のところ荒幡さんのみが対象（DailyTimerPage.jsのREPRESENTATIVE_FILTERと同じ）
const REP_NAME = '荒幡';
const REP_EMAIL = 'hikaru.arahata@senjinholdings.com';

const REVIEW_TASK_NAME = '振り返り';
const REVIEW_TASK_START_TIME = '23:30';
const REVIEW_TASK_MINUTES = 30;
// 「振り返り」枠を先々の日付までどれだけ前もって用意しておくか（今日を含め何日分か）
const REVIEW_TASK_PREP_DAYS_AHEAD = 14;

// 通知先は個人DMではなく#営業_日報チャンネル。担当者本人＋増田さんの両方をメンションする
const NOTIFY_CHANNEL_ID = 'C09UJMZ7JNR';
const MANAGER_EMAIL = 'yoh.masuda@senjinholdings.com';

/** 日付をAsia/Tokyo（UTC+9固定・DSTなし）の "YYYY-MM-DD" に変換する */
function toJstDateStr(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 現在時刻のJST時・分を返す */
function jstHourMinute(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return { hour: jst.getUTCHours(), minute: jst.getUTCMinutes() };
}

/** "YYYY-MM-DD" が土曜・日曜かどうか（カレンダー日付そのものの曜日なので実行環境のタイムゾーンに依存しない） */
function isWeekendDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

/**
 * 23:40〜1:00の督促が何回目かを、時刻から機械的に算出する（カウンタをDBに持たず、
 * 時刻さえ分かれば一意に決まるようにするため。23:40が1回目、1:00が9回目）
 */
function followUpReminderCount(hour, minute) {
  const minutesSince2330 = hour === 23 ? minute - 30 : hour === 0 ? 30 + minute : 90 + minute;
  return minutesSince2330 / 10;
}

/** 督促回数に応じて語調を強める前置き文（回数が伸びるほど強くする） */
function escalationTone(count) {
  if (count <= 2) return '';
  if (count <= 4) return 'まだ完了していません。';
  if (count <= 6) return 'かなり時間が経っています。';
  if (count <= 8) return '何度も催促していますが、まだ完了していません。今すぐお願いします。';
  return '本日最後の連絡です。今すぐ対応してください。';
}

function isRunningTask(task) {
  const sessions = Array.isArray(task.sessions) ? task.sessions : [];
  return sessions.length > 0 && !sessions[sessions.length - 1].endedAt;
}

/** 未着手 or 実行中（＝まだ完了していない）かどうか */
function isTaskUnfinished(task) {
  const sessions = Array.isArray(task.sessions) ? task.sessions : [];
  if (sessions.length === 0) return true;
  return !sessions[sessions.length - 1].endedAt;
}

/**
 * タスクの合計実働時間（分）。休止を挟んで複数回に分けて作業した場合も、
 * 閉じたセッションの合計＋（実行中なら）現在のセッションの経過時間、を合算する
 * （画面側DailyTimerPage.jsのgetTaskTimingと同じ考え方）
 */
function computeActualMinutes(task) {
  const sessions = Array.isArray(task.sessions) ? task.sessions : [];
  let totalMs = 0;
  sessions.forEach((s) => {
    const startMs = s.startedAt?.toMillis?.();
    if (!startMs) return;
    const endMs = s.endedAt?.toMillis?.() ?? Date.now();
    totalMs += Math.max(0, endMs - startMs);
  });
  return totalMs / 60000;
}

function isOverrun(task) {
  if (task.plannedMinutes == null) return false;
  const actual = computeActualMinutes(task);
  return actual > task.plannedMinutes + OVERRUN_BUFFER_MINUTES && actual > task.plannedMinutes * OVERRUN_RATIO;
}

/** 担当者本人と増田さんをメンションしてメッセージを投稿する（threadTs指定時はスレッド返信） */
async function notifyRepresentative(slack, repEmail, text, threadTs) {
  const [repUserId, managerUserId] = await Promise.all([
    repEmail ? resolveSlackUserId(slack, repEmail) : null,
    resolveSlackUserId(slack, MANAGER_EMAIL)
  ]);
  const mentions = [repUserId, managerUserId].filter(Boolean).map((id) => `<@${id}>`).join(' ');
  const result = await slack.chat.postMessage({
    channel: NOTIFY_CHANNEL_ID,
    text: mentions ? `${mentions} ${text}` : text,
    ...(threadTs ? { thread_ts: threadTs } : {})
  });
  return result.ts;
}

async function findStaffEmail(db, representative) {
  const staffSnap = await db.collection('staffMembers').where('name', '==', representative).limit(1).get();
  if (staffSnap.empty) return null;
  return staffSnap.docs[0].data().email || null;
}

/**
 * タイマーの止め忘れ・つけ忘れチェック（10分おき）。
 * @param {{db: FirebaseFirestore.Firestore}} deps
 */
function createOverrunChecker({ db }) {
  return async () => {
    const token = env('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN が未設定のためタイマーチェックをスキップ');
      return;
    }
    const slack = new WebClient(token);
    const now = new Date();
    const today = toJstDateStr(now);
    const { hour } = jstHourMinute(now);
    const isDaytime = hour >= IDLE_CHECK_START_HOUR && hour < IDLE_CHECK_END_HOUR;

    const snap = await db.collection('dailyTimers').where('date', '==', today).get();
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];

      let anyRunning = false;
      for (const task of tasks) {
        if (!isRunningTask(task)) continue;
        anyRunning = true;
        if (!isOverrun(task)) continue;

        try {
          const email = await findStaffEmail(db, data.representative);
          if (email) {
            await notifyRepresentative(
              slack,
              email,
              `タスク『${task.name}』が予定時間を大幅に超過しています（予定${task.plannedMinutes}分・実績${Math.round(computeActualMinutes(task))}分）。タイマーを止め忘れていませんか？`
            );
          }
        } catch (error) {
          console.error('タイマー超過アラート送信失敗（続行）:', error.message);
        }
      }

      // 日中（9時〜22時未満）なのに実行中のタスクが1つもない＝タイマーの開始忘れの可能性
      if (!anyRunning && isDaytime) {
        try {
          const email = await findStaffEmail(db, data.representative);
          if (email) {
            await notifyRepresentative(slack, email, '現在実行中のタスクがありません。タイマーを開始し忘れていませんか？');
          }
        } catch (error) {
          console.error('未実行リマインド送信失敗（続行）:', error.message);
        }
      }
    }
  };
}

/**
 * 夜の振り返りフロー（10分おきに実行し、JST時刻で内部分岐）。土日は完全にスキップする。
 * - 常時: 「振り返り」タスク枠（23:30〜24:00）を平日分は前もって用意しておく
 *   （23:30を待たず、日付が変わり次第すぐ日報に見える固定枠にする）
 * - 23:30: Slackスレッドを1本立てて開始連絡をする
 * - 23:40〜1:00（10分おき）: reviewCompletedAtが立つまでスレッドへ督促を返信し続ける
 * @param {{admin: import('firebase-admin'), db: FirebaseFirestore.Firestore}} deps
 */
function createReviewReminder({ admin, db }) {
  return async () => {
    const now = new Date();
    const { hour, minute } = jstHourMinute(now);
    const todayStr = toJstDateStr(now);

    // 「振り返り」枠は今日から先の数日分（土日を除く）を毎回（時刻を問わず）前もって用意しておく。
    // 未来日の分もあらかじめ入っているので、カレンダーで先の日付を開いても既に見える
    for (let offset = 0; offset < REVIEW_TASK_PREP_DAYS_AHEAD; offset++) {
      const dateStr = toJstDateStr(new Date(now.getTime() + offset * 24 * 60 * 60 * 1000));
      if (isWeekendDateStr(dateStr)) continue;

      const docRef = db.collection('dailyTimers').doc(`${REP_NAME}_${dateStr}`);
      const snap = await docRef.get();
      const tasks = Array.isArray(snap.data()?.tasks) ? snap.data().tasks : [];
      if (tasks.some((t) => t.isReviewTask)) continue;

      await docRef.set({
        representative: REP_NAME,
        date: dateStr,
        tasks: [
          ...tasks,
          {
            id: `task_${Date.now()}_review_${offset}`,
            name: REVIEW_TASK_NAME,
            plannedMinutes: REVIEW_TASK_MINUTES,
            plannedStartTime: REVIEW_TASK_START_TIME,
            sessions: [],
            source: 'system',
            isReviewTask: true
          }
        ],
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });
    }

    const isSetupSlot = hour === 23 && minute === 30;
    const isFollowUpSlot = (hour === 23 && minute >= 40) || hour === 0 || (hour === 1 && minute === 0);
    if (!isSetupSlot && !isFollowUpSlot) return;

    // 0時・1時台は日付が変わっているため、督促対象は前日（23:30に始まった振り返り）を指す
    const reviewDateStr = hour === 23 ? todayStr : toJstDateStr(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    if (isWeekendDateStr(reviewDateStr)) return; // 土日は振り返りなし＝催促もなし

    const token = env('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN が未設定のため夜の振り返りチェックをスキップ');
      return;
    }
    const slack = new WebClient(token);

    const docRef = db.collection('dailyTimers').doc(`${REP_NAME}_${reviewDateStr}`);
    const snap = await docRef.get();
    const data = snap.exists ? snap.data() : null;
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];

    if (isSetupSlot) {
      if (data?.nightThreadTs) return; // 既に開始連絡済み

      // その日超過したタスク・未完了予定時間の合計を添えて最初の投稿をする
      const overrunLines = tasks
        .filter((t) => !t.isReviewTask && isOverrun(t))
        .map((t) => `・${t.name}（予定${t.plannedMinutes}分 / 実績${Math.round(computeActualMinutes(t))}分）`);
      const unfinishedTotal = tasks
        .filter((t) => !t.isReviewTask && isTaskUnfinished(t))
        .reduce((sum, t) => sum + (t.plannedMinutes || 0), 0);

      let text = `📋 ${reviewDateStr} 夜チェック\n23時30分になりました。作業をやめて夜の振り返りに移行してください。`;
      if (overrunLines.length > 0) {
        text += `\n\n本日、予定を大幅に超過したタスク:\n${overrunLines.join('\n')}`;
      }
      if (unfinishedTotal >= 120) {
        text += `\n\n⚠️ 未完了タスクの予定時間合計が${unfinishedTotal}分あります。振り返りで理由も書いてください`;
      }

      try {
        const threadTs = await notifyRepresentative(slack, REP_EMAIL, text);
        await docRef.set({
          representative: REP_NAME,
          date: reviewDateStr,
          nightThreadTs: threadTs,
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });
      } catch (error) {
        console.error('夜チェックスレッド作成失敗（続行）:', error.message);
      }
      return;
    }

    // フォローアップ（23:40〜1:00、10分おき）
    if (!data || data.reviewCompletedAt) return; // セットアップ未実施 or 完了済みなら何もしない

    const reviewTask = tasks.find((t) => t.isReviewTask);
    const actionText = reviewTask && isRunningTask(reviewTask)
      ? '振り返りが終わったらDBで完了ボタンを押してください'
      : '作業を中断して振り返りを開始してください';
    const count = followUpReminderCount(hour, minute);
    const tone = escalationTone(count);
    const text = `【${count}回目の督促】${tone}${tone ? ' ' : ''}${actionText}`;

    try {
      await notifyRepresentative(slack, REP_EMAIL, text, data.nightThreadTs || undefined);
    } catch (error) {
      console.error('夜の振り返り督促送信失敗（続行）:', error.message);
    }
  };
}

module.exports = { createOverrunChecker, createReviewReminder };
