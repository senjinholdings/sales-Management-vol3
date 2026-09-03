/**
 * 日報（dailyTimers）の記入漏れ防止。2つのスケジュール実行Cloud Functionsで構成する：
 * - タイマーの止め忘れ・つけ忘れ: 10分おきに実行し、(a) 予定時間を明らかに超えて
 *   動いたままのタスク、(b) 日中（9時〜22時未満）なのに誰も実行中のタスクがない状態、
 *   の両方を検知して本人にSlack DM。どちらもチェック間隔（10分）そのものが再送間隔になる
 *   （動きっぱなし・止まりっぱなしが続く限り毎回送る。個別の抑制フラグは持たない）
 * - 夜の振り返りフロー: 23:30に「振り返り」タスク枠（23:30〜24:00）を自動で用意し、
 *   同時にSlackスレッドを1本立てる。以後23:40〜1:00は10分おきに、そのスレッドへ
 *   催促を返信し続ける。止まるのは「完了」ボタン（functions/staff.jsの
 *   night-review-completeエンドポイント）が押された時だけで、文字が入力された
 *   かどうかでは判定しない
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
 * 夜の振り返りフロー（10分おきに実行し、JST時刻で内部分岐）。
 * - 23:30: 「振り返り」タスク枠を用意し、Slackスレッドを1本立てる
 * - 23:40〜1:00（10分おき）: reviewCompletedAtが立つまでスレッドへ督促を返信し続ける
 * @param {{admin: import('firebase-admin'), db: FirebaseFirestore.Firestore}} deps
 */
function createReviewReminder({ admin, db }) {
  return async () => {
    const now = new Date();
    const { hour, minute } = jstHourMinute(now);
    const isSetupSlot = hour === 23 && minute === 30;
    const isFollowUpSlot = (hour === 23 && minute >= 40) || hour === 0 || (hour === 1 && minute === 0);
    if (!isSetupSlot && !isFollowUpSlot) return;

    const token = env('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN が未設定のため夜の振り返りチェックをスキップ');
      return;
    }
    const slack = new WebClient(token);

    const todayStr = toJstDateStr(now);
    const docRef = db.collection('dailyTimers').doc(`${REP_NAME}_${todayStr}`);
    const snap = await docRef.get();
    const data = snap.exists ? snap.data() : null;

    if (isSetupSlot) {
      const tasks = Array.isArray(data?.tasks) ? [...data.tasks] : [];
      const hasReviewTask = tasks.some((t) => t.isReviewTask);
      if (!hasReviewTask) {
        tasks.push({
          id: `task_${Date.now()}_review`,
          name: REVIEW_TASK_NAME,
          plannedMinutes: REVIEW_TASK_MINUTES,
          plannedStartTime: REVIEW_TASK_START_TIME,
          sessions: [],
          source: 'system',
          isReviewTask: true
        });
      }

      const updates = {
        representative: REP_NAME,
        date: todayStr,
        tasks,
        updatedAt: admin.firestore.Timestamp.now()
      };

      if (!data?.nightThreadTs) {
        // その日超過したタスク・未完了予定時間の合計を添えて最初の投稿をする
        const overrunLines = tasks
          .filter((t) => !t.isReviewTask && isOverrun(t))
          .map((t) => `・${t.name}（予定${t.plannedMinutes}分 / 実績${Math.round(computeActualMinutes(t))}分）`);
        const unfinishedTotal = tasks
          .filter((t) => !t.isReviewTask && isTaskUnfinished(t))
          .reduce((sum, t) => sum + (t.plannedMinutes || 0), 0);

        let text = `📋 ${todayStr} 夜チェック\n23時30分になりました。作業をやめて夜の振り返りに移行してください。`;
        if (overrunLines.length > 0) {
          text += `\n\n本日、予定を大幅に超過したタスク:\n${overrunLines.join('\n')}`;
        }
        if (unfinishedTotal >= 120) {
          text += `\n\n⚠️ 未完了タスクの予定時間合計が${unfinishedTotal}分あります。振り返りで理由も書いてください`;
        }

        try {
          updates.nightThreadTs = await notifyRepresentative(slack, REP_EMAIL, text);
        } catch (error) {
          console.error('夜チェックスレッド作成失敗（続行）:', error.message);
        }
      }

      await docRef.set(updates, { merge: true });
      return;
    }

    // フォローアップ（23:40〜1:00、10分おき）
    if (!data || data.reviewCompletedAt) return; // セットアップ未実施 or 完了済みなら何もしない

    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const reviewTask = tasks.find((t) => t.isReviewTask);
    const text = reviewTask && isRunningTask(reviewTask)
      ? '振り返りが終わったらDBで完了ボタンを押してください'
      : '作業を中断して振り返りを開始してください';

    try {
      await notifyRepresentative(slack, REP_EMAIL, text, data.nightThreadTs || undefined);
    } catch (error) {
      console.error('夜の振り返り督促送信失敗（続行）:', error.message);
    }
  };
}

module.exports = { createOverrunChecker, createReviewReminder };
