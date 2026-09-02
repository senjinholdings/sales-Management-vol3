/**
 * お礼メッセージの承認フロー（Slack DM + ボタン）。
 * - 下書きができたら、担当者本人のSlackにBotからDMを送る（下書き全文＋ボタン2つ）
 * - 担当者ごとのOAuth連携は不要。既存の社内通知用Bot（SLACK_BOT_TOKEN）が
 *   staffMembers.emailからusers.lookupByEmailで本人を特定してDMするだけ
 * - 「送信する」→そのままChatworkへ実送信（functions/thanks.js）
 * - 「指示して再生成」→Slackモーダルで追加指示を入力してもらい、議事録全文＋指示を
 *   踏まえてOpenAIに書き直させる（デフォルトの下書きはテンプレートのみでOpenAIを
 *   呼ばないため、トークンを使うのはこの再生成を明示的に選んだ時だけ）
 * - どちらもこのエンドポイントの署名検証を経由する
 *
 * 必要なBot Token Scopes: chat:write, users:read, users:read.email, im:write
 * （Appは「tldv-record」。スコープ追加時はワークスペースへの再インストールが必要で、
 *   Bot User OAuth Tokenが再発行されるため、SLACK_BOT_TOKENも更新すること）
 */

const crypto = require('crypto');
const express = require('express');
const OpenAI = require('openai');
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

/** 下書き表示＋操作ボタン2つのBlock Kitブロックを組み立てる（初回・再生成後で共用） */
function buildDraftBlocks({ companyName, productName, draftText, actionValue }) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${companyName || ''} ${productName || ''}*\nMTGのお礼メッセージ下書きができました。このまま送っていいか確認してください。`
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
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '指示して再生成' },
          action_id: 'regenerate_thank_you',
          value: actionValue
        }
      ]
    }
  ];
}

/**
 * 下書きができたことを担当者にSlack DMで知らせ、操作ボタンを出す。
 * @param {{db, dealId: string, meetingId: string, draftText: string}} params
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
    blocks: buildDraftBlocks({ companyName: deal.companyName, productName: deal.productName, draftText, actionValue })
  });

  await db.collection('meetings').doc(meetingId).set({
    thankYouSlackChannel: channelId,
    thankYouSlackTs: result.ts
  }, { merge: true });
}

/**
 * 会社単位のメンション設定（clientMeetingSettings.chatworkMentions）から
 * Chatworkの[To:accountId]タグ部分を組み立てる。
 */
async function buildMentionPrefix(db, companyName) {
  try {
    const settingsSnap = await db.collection('clientMeetingSettings')
      .where('companyName', '==', companyName)
      .limit(1)
      .get();
    if (settingsSnap.empty) return '';
    const mentions = settingsSnap.docs[0].data().chatworkMentions;
    if (!Array.isArray(mentions) || mentions.length === 0) return '';
    return mentions.map((m) => `[To:${m.accountId}]${m.name || ''}さん`).join('\n') + '\n';
  } catch (error) {
    console.error('メンション先取得失敗（続行）:', error.message);
    return '';
  }
}

/**
 * 議事録全文と担当者の追加指示を踏まえてお礼メッセージを書き直す。
 * デフォルトの下書き（テンプレート）と違い、ここは明示的に呼ばれた時だけ実行される
 * ＝担当者がトークンを使う判断をした時だけコストが発生する。
 */
async function regenerateThankYouMessage({ apiKey, title, transcript, tldvSummary, instruction }) {
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'あなたは営業支援AIです。MTG議事録と担当者からの指示を踏まえて、先方に送るお礼メッセージを書いてください。メッセージ本文のみを出力し、宛名・署名・前置きの説明は付けないでください。'
      },
      {
        role: 'user',
        content: `MTGタイトル: ${title || '不明'}

tl;dvによる要約:
${(tldvSummary || '').substring(0, 1000)}

議事録全文:
${(transcript || '').substring(0, 6000)}

担当者からの追加の指示:
${instruction}`
      }
    ],
    max_tokens: 500,
    temperature: 0.4
  });
  return completion.choices[0]?.message?.content?.trim() || '';
}

/**
 * 「指示して再生成」の実処理。OpenAIで書き直し、meetings.thankYouDraftを更新し、
 * 元のSlackメッセージを新しい下書き＋ボタン2つの状態に戻す。
 */
async function handleRegenerate({ admin, db, meetingId, dealId, channelId, messageTs, instruction }) {
  const meetingRef = db.collection('meetings').doc(meetingId);
  const meetingSnap = await meetingRef.get();
  if (!meetingSnap.exists) throw new Error('meetingが見つかりません');
  const meeting = meetingSnap.data();

  const dealSnap = await db.collection('progressDashboard').doc(dealId).get();
  if (!dealSnap.exists) throw new Error('案件が見つかりません');
  const deal = dealSnap.data();

  const openaiKey = env('OPENAI_API_KEY');
  if (!openaiKey) throw new Error('OPENAI_API_KEY が未設定です');

  const newMessage = await regenerateThankYouMessage({
    apiKey: openaiKey,
    title: meeting.title,
    transcript: meeting.transcript,
    tldvSummary: meeting.aiSummary,
    instruction
  });

  let materialUrl = null;
  if (meeting.thankYouMaterialId) {
    const materialSnap = await db.collection('progressDashboard').doc(dealId)
      .collection('materials').doc(meeting.thankYouMaterialId).get();
    if (materialSnap.exists) materialUrl = materialSnap.data().url;
  }

  const mentionPrefix = await buildMentionPrefix(db, deal.companyName);
  const newDraft = mentionPrefix + newMessage + (materialUrl ? `\n\n資料はこちら: ${materialUrl}` : '');

  await meetingRef.update({ thankYouDraft: newDraft });

  const token = env('SLACK_BOT_TOKEN');
  const slack = new WebClient(token);
  const actionValue = JSON.stringify({ meetingId, dealId });
  await slack.chat.update({
    channel: channelId,
    ts: messageTs,
    text: `MTGのお礼メッセージ下書き（再生成）（${deal.companyName || ''}）`,
    blocks: buildDraftBlocks({ companyName: deal.companyName, productName: deal.productName, draftText: newDraft, actionValue })
  });
}

/** Slackからのインタラクション（ボタン押下・モーダル送信）の署名を検証する */
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

    const token = env('SLACK_BOT_TOKEN');

    // モーダルの「指示して再生成」提出（view_submission）。
    // OpenAI呼び出しが数秒かかりSlackの3秒ACK期限に収まらないため、
    // 空応答で即座にモーダルを閉じてから非同期で処理する
    if (payload.type === 'view_submission' && payload.view?.callback_id === 'regenerate_modal') {
      res.status(200).json({ response_action: 'clear' });

      try {
        const { meetingId, dealId, channelId, messageTs } = JSON.parse(payload.view.private_metadata);
        const instruction = payload.view.state?.values?.instruction_block?.instruction_input?.value || '';
        await handleRegenerate({ admin, db, meetingId, dealId, channelId, messageTs, instruction });
      } catch (error) {
        console.error('お礼メッセージ再生成エラー:', error);
        try {
          const { channelId, messageTs } = JSON.parse(payload.view.private_metadata);
          const slack = new WebClient(token);
          await slack.chat.postMessage({
            channel: channelId,
            thread_ts: messageTs,
            text: `再生成に失敗しました: ${error.message}`
          });
        } catch (notifyError) {
          console.error('失敗通知の送信も失敗:', notifyError.message);
        }
      }
      return;
    }

    if (payload.type !== 'block_actions') {
      return res.status(200).send('');
    }

    // Slackは3秒以内の応答を要求するため、先にACKしてから実処理を行う
    res.status(200).send('');

    const action = payload.actions?.[0];

    try {
      if (action?.action_id === 'regenerate_thank_you') {
        const { meetingId, dealId } = JSON.parse(action.value);
        const slack = new WebClient(token);
        await slack.views.open({
          trigger_id: payload.trigger_id,
          view: {
            type: 'modal',
            callback_id: 'regenerate_modal',
            private_metadata: JSON.stringify({
              meetingId,
              dealId,
              channelId: payload.channel.id,
              messageTs: payload.message.ts
            }),
            title: { type: 'plain_text', text: '文章を再作成' },
            submit: { type: 'plain_text', text: '再生成する' },
            close: { type: 'plain_text', text: 'キャンセル' },
            blocks: [
              {
                type: 'input',
                block_id: 'instruction_block',
                label: { type: 'plain_text', text: '追加の指示' },
                element: {
                  type: 'plain_text_input',
                  action_id: 'instruction_input',
                  multiline: true,
                  placeholder: { type: 'plain_text', text: '例: もう少しカジュアルなトーンにして' }
                }
              }
            ]
          }
        });
        return;
      }

      if (action?.action_id !== 'send_thank_you') return;
      const { meetingId, dealId } = JSON.parse(action.value);

      const { sendThankYou } = require('./thanks');
      const result = await sendThankYou({ admin, db, dealId, meetingId });

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
      console.error('お礼メッセージ操作処理エラー:', error);
      try {
        const slack = new WebClient(token);
        await slack.chat.postMessage({
          channel: payload.channel.id,
          thread_ts: payload.message.ts,
          text: `処理に失敗しました: ${error.message}`
        });
      } catch (notifyError) {
        console.error('失敗通知の送信も失敗:', notifyError.message);
      }
    }
  });

  return router;
}

module.exports = { sendApprovalRequest, createSlackInteractionRouter, resolveSlackUserId };
