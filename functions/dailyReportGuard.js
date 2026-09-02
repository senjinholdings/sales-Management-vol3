/**
 * 日報（dailyTimers）の記入漏れ防止。2つのスケジュール実行Cloud Functionsで構成する：
 * - タイマーの止め忘れ: 予定時間を明らかに超えて動いたままのタスクを15分おきに検知し、
 *   本人にSlack DMで知らせる
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
// 同じセッションへの再アラートは60分間隔（動きっぱなしを検知するたび毎回送らない）
const OVERRUN_REALERT_MINUTES = 60;

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

async function findStaffEmail(db, representative) {
  const staffSnap = await db.collection('staffMembers').where('name', '==', representative).limit(1).get();
  if (staffSnap.empty) return null;
  return staffSnap.docs[0].data().email || null;
}

/**
 * タイマーの止め忘れチェック（15分おき）。
 * @param {{admin: import('firebase-admin'), db: FirebaseFirestore.Firestore}} deps
 */
function createOverrunChecker({ admin, db }) {
  return async () => {
    const token = env('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN が未設定のためタイマー超過チェックをスキップ');
      return;
    }
    const slack = new WebClient(token);
    const today = toJstDateStr(new Date());

    const snap = await db.collection('dailyTimers').where('date', '==', today).get();
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      let changed = false;

      for (const task of tasks) {
        if (task.plannedMinutes == null || !isRunningTask(task)) continue;

        const sessions = task.sessions;
        const last = sessions[sessions.length - 1];
        const startedAtMs = last.startedAt?.toMillis?.();
        if (!startedAtMs) continue;

        const elapsedMinutes = (Date.now() - startedAtMs) / 60000;
        const isOverrun = elapsedMinutes > task.plannedMinutes + OVERRUN_BUFFER_MINUTES &&
          elapsedMinutes > task.plannedMinutes * OVERRUN_RATIO;
        if (!isOverrun) continue;

        const lastAlertMs = last.overrunAlertedAt?.toMillis?.();
        if (lastAlertMs && (Date.now() - lastAlertMs) / 60000 < OVERRUN_REALERT_MINUTES) continue;

        try {
          const email = await findStaffEmail(db, data.representative);
          if (email) {
            await dmStaff(
              slack,
              email,
              `タスク『${task.name}』が予定時間を大幅に超過しています（予定${task.plannedMinutes}分・経過${Math.round(elapsedMinutes)}分）。タイマーを止め忘れていませんか？`
            );
          }
        } catch (error) {
          console.error('タイマー超過アラート送信失敗（続行）:', error.message);
        }

        last.overrunAlertedAt = admin.firestore.Timestamp.now();
        changed = true;
      }

      if (changed) {
        await docSnap.ref.update({ tasks });
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
        await dmStaff(slack, email, text);
      } catch (error) {
        console.error('振り返りリマインド送信失敗（続行）:', error.message);
      }
    }
  };
}

module.exports = { createOverrunChecker, createReviewReminder };
