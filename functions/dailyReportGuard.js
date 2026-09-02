/**
 * 日報（dailyTimers）の記入漏れ防止。2つのスケジュール実行Cloud Functionsで構成する：
 * - タイマーの止め忘れ・つけ忘れ: 10分おきに実行し、(a) 予定時間を明らかに超えて
 *   動いたままのタスク、(b) 日中（9時〜22時未満）なのに誰も実行中のタスクがない状態、
 *   の両方を検知して本人にSlack DM。どちらもチェック間隔（10分）そのものが再送間隔になる
 *   （動きっぱなし・止まりっぱなしが続く限り毎回送る。個別の抑制フラグは持たない）
 * - 振り返り・翌日計画の未実施: 23時に1回、0時台は10分おきに本人へ催促DM。1時以降は
 *   今回のスコープでは何も送らない（上長エスカレーションは将来の拡張として見送り）
 *
 * Slack送信はfunctions/slackApproval.jsのresolveSlackUserId（staffMembers.email →
 * users.lookupByEmail → conversations.open）をそのまま再利用する。
 */

const { WebClient } = require('@slack/web-api');
const { env } = require('./authHelpers');
const { resolveSlackUserId } = require('./slackApproval');

// タスクの経過時間が「予定+20分」かつ「予定×1.3倍」の両方を超えたら明らかな超過とみなす
const OVERRUN_BUFFER_MINUTES = 20;
const OVERRUN_RATIO = 1.3;
// 「実行中のタスクなし」リマインドの対象時間帯（この時間外＝夜は送らない）
const IDLE_CHECK_START_HOUR = 9;
const IDLE_CHECK_END_HOUR = 22;

const REVIEW_FIELD_KEYS = ['notAchieved', 'timeImprovement', 'reflection', 'nextAction'];

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

function hasReviewContent(review) {
  if (!review) return false;
  return REVIEW_FIELD_KEYS.some((k) => (review[k] || '').trim() !== '');
}

/** 担当者本人にSlack DMを送る（メールからユーザーを特定できない場合は何もしない） */
async function dmStaff(slack, email, text) {
  const userId = await resolveSlackUserId(slack, email);
  if (!userId) return;
  const dm = await slack.conversations.open({ users: userId });
  const channelId = dm.channel?.id;
  if (!channelId) return;
  await slack.chat.postMessage({ channel: channelId, text });
}

// 一時的な動作確認用: 荒幡さんに実際にDMが届いているか本人だけでは確認しづらいため、
// しばらくの間、同じ内容を増田さんにも同時に送る。届いていることが確認できたら削除する
const TEMP_ALSO_NOTIFY_EMAIL = 'yoh.masuda@senjinholdings.com';

/** 本来の宛先本人 + 一時的な確認用宛先（設定されていれば）の両方にDMを送る */
async function notifyRepresentative(slack, email, text) {
  await dmStaff(slack, email, text);
  if (TEMP_ALSO_NOTIFY_EMAIL && TEMP_ALSO_NOTIFY_EMAIL !== email) {
    await dmStaff(slack, TEMP_ALSO_NOTIFY_EMAIL, `[確認用: 荒幡さん宛と同内容]\n${text}`);
  }
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
        if (task.plannedMinutes == null) continue;

        const sessions = task.sessions;
        const last = sessions[sessions.length - 1];
        const startedAtMs = last.startedAt?.toMillis?.();
        if (!startedAtMs) continue;

        const elapsedMinutes = (Date.now() - startedAtMs) / 60000;
        const isOverrun = elapsedMinutes > task.plannedMinutes + OVERRUN_BUFFER_MINUTES &&
          elapsedMinutes > task.plannedMinutes * OVERRUN_RATIO;
        if (!isOverrun) continue;

        try {
          const email = await findStaffEmail(db, data.representative);
          if (email) {
            await notifyRepresentative(
              slack,
              email,
              `タスク『${task.name}』が予定時間を大幅に超過しています（予定${task.plannedMinutes}分・経過${Math.round(elapsedMinutes)}分）。タイマーを止め忘れていませんか？`
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
 * 振り返り・翌日計画の未実施リマインド（10分おきに実行し、JST時刻で内部分岐）。
 * @param {{db: FirebaseFirestore.Firestore}} deps
 */
function createReviewReminder({ db }) {
  return async () => {
    const now = new Date();
    const { hour, minute } = jstHourMinute(now);
    const isInitialSlot = hour === 23 && minute === 0;
    const isFollowUpSlot = hour === 0; // 0:00〜0:50（10分おき）
    if (!isInitialSlot && !isFollowUpSlot) return;

    const token = env('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN が未設定のため振り返りリマインドをスキップ');
      return;
    }
    const slack = new WebClient(token);

    const todayStr = toJstDateStr(now);
    const tomorrowStr = toJstDateStr(new Date(now.getTime() + 24 * 60 * 60 * 1000));

    const todaySnap = await db.collection('dailyTimers').where('date', '==', todayStr).get();
    for (const docSnap of todaySnap.docs) {
      const data = docSnap.data();
      const reviewDone = hasReviewContent(data.review);

      const tomorrowSnap = await db.collection('dailyTimers').doc(`${data.representative}_${tomorrowStr}`).get();
      const tomorrowTasks = tomorrowSnap.exists ? (tomorrowSnap.data().tasks || []) : [];
      const planDone = tomorrowTasks.some((t) => t.source === 'planned');

      if (reviewDone && planDone) continue; // 実施済みなら何もしない

      try {
        const email = await findStaffEmail(db, data.representative);
        if (!email) continue;

        const text = isInitialSlot
          ? '23時になりました。今日の振り返りと明日の予定を24時までに入力してください。'
          : `まだ振り返り・明日の予定が入力されていません（現在24:${String(minute).padStart(2, '0')}）`;
        await notifyRepresentative(slack, email, text);
      } catch (error) {
        console.error('振り返りリマインド送信失敗（続行）:', error.message);
      }
    }
  };
}

module.exports = { createOverrunChecker, createReviewReminder };
