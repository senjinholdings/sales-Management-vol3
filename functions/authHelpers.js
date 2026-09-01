/**
 * 社内フロントエンド→自前Cloud Functions間の簡易認証ヘルパー。
 * MEETING_SCHEDULE_SECRETは元々MTGカレンダー登録専用に作った名前だが、
 * 「ログイン済みの社内ユーザーからのみ呼ばれる自前API」という性質は
 * このあと追加する担当者管理・お礼メッセージ系エンドポイントも同じなので、
 * 新しいシークレットを増やさずこの1つを使い回す。
 */

function env(name) {
  const v = process.env[name];
  return v ? v.trim() : v;
}

/** 前後の空白除去＋全角英数字を半角に変換＋小文字化（tl;dv webhookの認証と同じ規則） */
function normalizeSecret(str) {
  return String(str)
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

/**
 * x-app-secretヘッダーを検証する。設定漏れ・不一致ならレスポンスを送って
 * falseを返す（呼び出し側はfalseならreturnする）。
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {boolean} 認証OKならtrue
 */
function requireAppSecret(req, res) {
  const secret = env('MEETING_SCHEDULE_SECRET');
  if (!secret) {
    console.error('MEETING_SCHEDULE_SECRET が未設定のため拒否');
    res.status(500).json({ error: 'secret not configured' });
    return false;
  }
  const provided = req.headers['x-app-secret'] || req.headers['x-meeting-secret'];
  if (!provided || normalizeSecret(provided) !== normalizeSecret(secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

module.exports = { env, normalizeSecret, requireAppSecret };
