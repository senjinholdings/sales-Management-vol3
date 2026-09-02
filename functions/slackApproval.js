/**
 * お礼メッセージの承認フロー（Slack DM + ボタン）。
 * - 下書きができたら、担当者本人のSlackにBotからDMを送る（下書き全文＋送信ボタン）
 * - 担当者ごとのOAuth連携は不要。既存の社内通知用Bot（SLACK_BOT_TOKEN）が
 *   staffMembers.emailからusers.lookupByEmailで本人を特定してDMするだけ
 * - ボタンが押されたらSlackがこのエンドポイントにPOSTしてくる。署名を検証してから
 *   実送信（functions/thanks.js）を呼び、元のDMを「送信済み」に更新する
 *
 * 必要なBot Token Scopes: chat:write, users:read, users:read.email, im:write
 * （Appは「tldv-record」。スコープ追加時はワークスペースへの再インストールが必要で、
 *   Bot User OAuth Tokenが再発行されるため、SLACK_BOT_TOKENも更新すること）
 */

const crypto = require('crypto');
const express = require('express');
const { WebClient } = require('@slack/web-api');
const { env } = require('./authHelpers');

/**
 * 担当者のメールアドレスからSlackユーザーIDを特定する。
 * Botトークンに users:read.email スコープが無いと失敗する
 * （その場合はSlack Appの設定でスコープを追加し、再インストールが必要）。
 */
async function resolveSlackUserId(slack, email) {
  if (!email) return null;
  try {
    const resp = await slack.users.lookupByEmail({ email });
    return resp.user?.id || null;
  } catch (error) {
    console.error(`Slackユーザー特定失敗 (${email}):`, error.data?.error || error.message);
    return null;
  }
}

/**
 * 下書きができたことを担当者にSlack DMで知らせ、承認ボタンを出す。
 * @param {{admin, db, dealId: string, meetingId: string, draftText: string}} params
 */
async function sendApprovalRequest({ db, dealId, meetingId, draftText }) {
  const token = env('SLACK_BOT_TOKEN');
  if (!token) {
    console.error('SLACK_BOT_TOKEN が未設定のためお礼メッセージ承認通知をスキップ');
    return;
  }

  const dealSnap = await db.collection('progressDashboard').doc(dealId).get();
  if (!dealSnap.exists) return;
  const deal = dealSnap.data();

  const staffSnap = await db.collection('staffMembers').where('name', '==', deal.representative).limit(1).get();
  if (staffSnap.empty) {
    console.error(`担当者「${deal.representative}」が担当者管理に見つからないため承認通知をスキップ`);
    return;
  }
  const staff = staffSnap.docs[0].data();
  if (!staff.email) {
    console.error(`担当者「${deal.representative}」にメールアドレス未設定のため承認通知をスキップ`);
    return;
  }

  const slack = new WebClient(token);
  const slackUserId = await resolveSlackUserId(slack, staff.email);
  if (!slackUserId) return;

  const dmChannel = await slack.conversations.open({ users: slackUserId });
  const channelId = dmChannel.channel?.id;
  if (!channelId) return;

  const actionValue = JSON.stringify({ meetingId, dealId });

  const result = await slack.chat.postMessage({
    channel: channelId,
    text: `MTGのお礼メッセージ下書きができました（${deal.companyName || ''}）`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${deal.companyName || ''} ${deal.productName || ''}*\nMTGのお礼メッセージ下書きができました。このまま送っていいか確認してください。`
        }
      },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: draftText } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '送信する' },
            style: 'primary',
            action_id: 'send_thank_you',
            value: actionValue
          }
        ]
      }
    ]
  });

  await db.collection('meetings').doc(meetingId).set({
    thankYouSlackChannel: channelId,
    thankYouSlackTs: result.ts
  }, { merge: true });
}

/** Slackからのインタラクション（ボタン押下）の署名を検証する */
function verifySlackSignature(req) {
  const signingSecret = env('SLACK_SIGNING_SECRET');
  if (!signingSecret) {
    console.error('SLACK_SIGNING_SECRET が未設定のため拒否');
    return false;
  }
  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  if (!timestamp || !signature) return false;
  // 5分以上前のリクエストはリプレイ攻撃とみなして拒否
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;

  const base = `v0:${timestamp}:${req.rawBody.toString('utf8')}`;
  const mySignature = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
  } catch (error) {
    return false;
  }
}

/**
 * @param {{admin: import('firebase-admin'), db: FirebaseFirestore.Firestore}} deps
 */
function createSlackInteractionRouter({ admin, db }) {
  const router = express.Router();

  // Slackは application/x-www-form-urlencoded で送ってくる。署名検証には生バイト列が
  // 必要だが、Firebase Cloud Functionsはリクエストボディを内部で先に読み込んでおり、
  // その生バイト列を req.rawBody として自動的に用意してくれている。
  // express.raw()等で改めてストリームを読もうとすると、Cloud Functions環境では
  // 既にストリームが消費済みのため空になってしまう（署名不一致＝毎回401になる原因だった）。
  // そのためここではExpressの追加ボディパーサーを一切使わず、Firebase提供のreq.rawBodyを使う
  router.post('/interactions', async (req, res) => {
    if (!verifySlackSignature(req)) {
      return res.status(401).send('invalid signature');
    }

    const params = new URLSearchParams(req.rawBody.toString('utf8'));
    const payloadStr = params.get('payload');
    if (!payloadStr) return res.status(400).send('missing payload');

    let payload;
    try {
      payload = JSON.parse(payloadStr);
    } catch (error) {
      return res.status(400).send('invalid payload');
    }

    // Slackは3秒以内の応答を要求するため、先にACKしてから実処理を行う
    res.status(200).send('');

    try {
      const action = payload.actions?.[0];
      if (action?.action_id !== 'send_thank_you') return;
      const { meetingId, dealId } = JSON.parse(action.value);

      const { sendThankYou } = require('./thanks');
      const result = await sendThankYou({ admin, db, dealId, meetingId });

      const token = env('SLACK_BOT_TOKEN');
      const slack = new WebClient(token);
      await slack.chat.update({
        channel: payload.channel.id,
        ts: payload.message.ts,
        text: '送信済みです',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: result.alreadySent ? 'すでに送信済みです' : `✅ 送信しました（${result.channel === 'chatwork' ? 'Chatwork' : 'Slack'}）`
            }
          }
        ]
      });
    } catch (error) {
      console.error('お礼メッセージ送信処理エラー:', error);
      try {
        const token = env('SLACK_BOT_TOKEN');
        const slack = new WebClient(token);
        await slack.chat.postMessage({
          channel: payload.channel.id,
          thread_ts: payload.message.ts,
          text: `送信に失敗しました: ${error.message}`
        });
      } catch (notifyError) {
        console.error('失敗通知の送信も失敗:', notifyError.message);
      }
    }
  });

  return router;
}

module.exports = { sendApprovalRequest, createSlackInteractionRouter };
