/**
 * 「緊急クエスト」機能: 増田さんが自分のSlack投稿に🚨（rotating_light）スタンプを押すと、
 * その投稿を最優先タスクとして担当者（荒幡）の日報に自動登録する。
 *
 * Slackのreaction_addedイベント（Event Subscriptions）を使う。増田さんが管理しているグループを
 * 問わず、どのチャンネルでも拾えるようにするため、特定チャンネルには限定しない
 * （ただしBotがそのチャンネル・グループのメンバーになっている必要がある。プライベート
 * グループの場合は招待が必要）。
 *
 * 必要なBot Token Scopes: reactions:read, channels:history, groups:history
 * （im:history/mpim:history はDM・グループDMでも使う場合に追加）。
 * スコープ追加時はワークスペースへの再インストールが必要で、Bot User OAuth Tokenが
 * 再発行されるため、SLACK_BOT_TOKENも更新すること（functions/slackApproval.js冒頭コメント参照）。
 *
 * Slack App設定側で「Event Subscriptions」を有効にし、Request URLをこのルーターの
 * エンドポイント（/api/slack/events）に設定、Bot Eventsに reaction_added を追加する必要がある。
 */

const express = require('express');
const { WebClient } = require('@slack/web-api');
const { env } = require('./authHelpers');
const { resolveSlackUserId, verifySlackSignature } = require('./slackApproval');
const { toJstDateStr } = require('./dailyReportGuard');

const TRIGGER_REACTION = 'rotating_light'; // 🚨
const REP_NAME = '荒幡'; // 日報機能は今のところ荒幡さんのみが対象
const MANAGER_EMAIL = 'yoh.masuda@senjinholdings.com';

/**
 * @param {{admin: import('firebase-admin'), db: FirebaseFirestore.Firestore}} deps
 */
function createUrgentQuestRouter({ admin, db }) {
  const router = express.Router();

  router.post('/events', async (req, res) => {
    // SlackのEvent SubscriptionsはURL登録時にchallengeを送ってくる（署名検証より前に応答が必要）
    if (req.body?.type === 'url_verification') {
      return res.status(200).json({ challenge: req.body.challenge });
    }

    if (!verifySlackSignature(req)) {
      return res.status(401).send('invalid signature');
    }

    // Slackは3秒以内の応答を要求するため、先にACKしてから実処理を行う
    res.status(200).send('');

    const event = req.body?.event;
    if (!event || event.type !== 'reaction_added') return;
    if (event.reaction !== TRIGGER_REACTION) return;
    if (event.item?.type !== 'message') return;

    const token = env('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN が未設定のため緊急クエスト処理をスキップ');
      return;
    }
    const slack = new WebClient(token);

    try {
      const managerId = await resolveSlackUserId(slack, MANAGER_EMAIL);
      if (!managerId || event.user !== managerId) return; // スタンプを押したのが増田さん本人でなければ無視

      const { channel, ts } = event.item;
      const repliesRes = await slack.conversations.replies({ channel, ts, inclusive: true, limit: 1 });
      const message = repliesRes.messages?.[0];
      if (!message) return;
      if (message.user !== managerId) return; // 増田さん自身の投稿でなければ無視（オーダーではない）

      const messageText = (message.text || '').trim();
      if (!messageText) return;

      const threadTs = message.thread_ts || ts;
      const taskId = `urgent_${channel}_${ts}`;
      const dateStr = toJstDateStr(new Date());
      const docRef = db.collection('dailyTimers').doc(`${REP_NAME}_${dateStr}`);
      const snap = await docRef.get();
      const tasks = Array.isArray(snap.data()?.tasks) ? snap.data().tasks : [];
      if (tasks.some((t) => t.id === taskId)) return; // 二重投稿（Slackのイベント再送）対策

      await docRef.set({
        representative: REP_NAME,
        date: dateStr,
        tasks: [
          ...tasks,
          {
            id: taskId,
            name: messageText.slice(0, 200),
            plannedMinutes: null,
            plannedStartTime: null,
            sessions: [],
            source: 'urgent_order',
            isUrgentTask: true,
            slackChannelId: channel,
            slackThreadTs: threadTs
          }
        ],
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });

      await slack.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `🚨 緊急クエストとして記録しました（${REP_NAME}さんの日報に最優先タスクとして表示されます）`
      });
    } catch (error) {
      console.error('緊急クエスト登録エラー:', error);
    }
  });

  return router;
}

module.exports = { createUrgentQuestRouter };
