/**
 * ダッシュボードからのSlackチャンネル作成・招待ルーター。
 *
 * 現在の共有Bot（SLACK_BOT_TOKEN、App名「tldv-record」）は完全に社内専用の
 * スコープ（chat:write, users:read, users:read.email, im:write）のみで、
 * チャンネル作成・招待に必要なスコープ（channels:manage、社外を招待する場合は
 * さらにSlack Connect用のchannels:write.invites等）を持っていない。
 * これらのスコープを追加してBotを再インストールし、社外を含めるならワークスペースの
 * Slack Connectも有効化する、という一回限りの管理作業が済むまでは、
 * このルーターの呼び出しは「missing_scope」等のSlack APIエラーをそのまま
 * 分かりやすいメッセージにして返す（社内チャンネル作成すら失敗する想定）。
 *
 * 社外（クライアント）の招待はSlack Connect（企業間連携）の仕組みを使う。
 * 相手はSlackから届く招待メールを承諾するまで参加が確定しない＝即時ではない。
 */

const express = require('express');
const { WebClient } = require('@slack/web-api');
const { env, requireAppSecret } = require('./authHelpers');
const { resolveSlackUserId } = require('./slackApproval');

/** 会社名等の自由な文字列から、Slackのチャンネル名規則（英数小文字・ハイフン・アンダースコア、
 * 最大80文字、絵文字や記号は不可）に沿った名前を作る */
function toSlackChannelName(raw) {
  const romanized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const base = romanized || 'client';
  return base.slice(0, 74); // 日付サフィックス分の余裕を残す
}

/** Slack APIの共通エラーを分かりやすいメッセージに変換する */
function describeSlackError(error) {
  const code = error?.data?.error || error?.message || '';
  if (code === 'missing_scope') {
    return 'Slack Botの権限が不足しています。Slack Connectの有効化・Botの権限追加＋ワークスペースへの再インストールが必要です（管理者に相談してください）';
  }
  if (code === 'not_allowed_token_type' || code === 'restricted_action') {
    return 'ワークスペースの設定でSlack Connectの利用が制限されています（管理者に確認してください）';
  }
  return `Slack APIエラー: ${code || 'unknown'}`;
}

function createSlackChannelsRouter({ admin, db }) {
  const router = express.Router();

  /**
   * POST /api/staff/slack-create-channel
   * body: { companyName: string, internalEmails: string[], externalEmails: string[] }
   * チャンネルを作成し、社内メンバー（メールアドレス解決）を即時招待、
   * 社外メンバー（メールアドレス）はSlack Connectで招待する
   */
  router.post('/slack-create-channel', async (req, res) => {
    if (!requireAppSecret(req, res)) return;
    try {
      const { companyName, internalEmails, externalEmails } = req.body || {};
      if (!companyName) {
        return res.status(400).json({ error: 'companyName は必須です' });
      }
      const token = env('SLACK_BOT_TOKEN');
      if (!token) {
        return res.status(500).json({ error: 'SLACK_BOT_TOKEN が未設定です' });
      }
      const slack = new WebClient(token);

      const channelName = toSlackChannelName(companyName);
      let channelId;
      try {
        const created = await slack.conversations.create({ name: channelName });
        channelId = created.channel.id;
      } catch (error) {
        return res.status(502).json({ error: describeSlackError(error) });
      }

      const internalResults = [];
      for (const email of (Array.isArray(internalEmails) ? internalEmails : [])) {
        try {
          const userId = await resolveSlackUserId(slack, email);
          if (!userId) {
            internalResults.push({ email, ok: false, error: 'Slackユーザーが見つかりません' });
            continue;
          }
          await slack.conversations.invite({ channel: channelId, users: userId });
          internalResults.push({ email, ok: true });
        } catch (error) {
          internalResults.push({ email, ok: false, error: describeSlackError(error) });
        }
      }

      const externalResults = [];
      for (const email of (Array.isArray(externalEmails) ? externalEmails : [])) {
        try {
          await slack.conversations.inviteShared({ channel: channelId, emails: [email] });
          externalResults.push({ email, ok: true });
        } catch (error) {
          externalResults.push({ email, ok: false, error: describeSlackError(error) });
        }
      }

      return res.status(200).json({ channelId, channelName, internalResults, externalResults });
    } catch (error) {
      console.error('Slackチャンネル作成エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = { createSlackChannelsRouter };
