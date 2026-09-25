/**
 * Chatworkルームの招待リンクを取得（無ければ発行）する。
 * 担当者管理の「招待リンクを発行」（staff.js）と、契約書締結依頼の依頼文に
 * 招待リンクを載せる処理（contractsRouter.js）の両方で使うため、ここに1つだけ置く。
 */

const fetch = require('node-fetch');

const CHATWORK_API_BASE = 'https://api.chatwork.com/v2';

/**
 * @param {{token: string, roomId: string}} params
 * @returns {Promise<{url: string} | {error: string}>}
 */
async function getOrCreateRoomInviteLink({ token, roomId }) {
  const existingRes = await fetch(`${CHATWORK_API_BASE}/rooms/${roomId}/link`, {
    headers: { 'X-ChatWorkToken': token }
  });
  if (existingRes.ok) {
    const existing = await existingRes.json();
    if (existing.public) {
      return { url: existing.url };
    }
  }

  const createRes = await fetch(`${CHATWORK_API_BASE}/rooms/${roomId}/link`, {
    method: 'POST',
    headers: {
      'X-ChatWorkToken': token,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ need_acceptance: '1' })
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '');
    return { error: `Chatwork招待リンクの発行に失敗しました: ${text}` };
  }
  const created = await createRes.json();
  return { url: created.url };
}

module.exports = { getOrCreateRoomInviteLink };
