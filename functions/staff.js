/**
 * 担当者ごとの外部サービス連携（Chatwork）ルーター
 * - Chatwork APIトークンはFirestoreに置かず、Secret Managerにのみ保存する
 *   （Firestoreのセキュリティルールは現状ほぼ全開放のため、生きた認証情報を置けない）
 * - シークレット名は `CHATWORK_TOKEN_{staffId}` の形。staffIdはFirestoreの自動ID
 *   （英数字のみ）なのでSecret Managerの命名制約にそのまま使える
 */

const express = require('express');
const fetch = require('node-fetch');
const { getSecret, setSecret, hasSecret, chatworkSecretName } = require('./secrets');
const { requireAppSecret } = require('./authHelpers');

const CHATWORK_API_BASE = 'https://api.chatwork.com/v2';

/** ChatworkのAPIトークンをASCII化してから使う（全角混入によるヘッダーエラー事故対策） */
function sanitizeToken(token) {
  return String(token).trim().replace(/[^\x20-\x7e]/g, '');
}

function createStaffRouter({ db }) {
  const router = express.Router();

  /**
   * POST /api/staff/chatwork-token
   * body: { staffId: string, apiToken: string }
   * 担当者本人のChatwork APIトークンを登録する
   */
  router.post('/chatwork-token', async (req, res) => {
    if (!requireAppSecret(req, res)) return;
    try {
      const { staffId, apiToken } = req.body || {};
      if (!staffId || !apiToken) {
        return res.status(400).json({ error: 'staffId, apiToken は必須です' });
      }
      const staffSnap = await db.collection('staffMembers').doc(staffId).get();
      if (!staffSnap.exists) {
        return res.status(404).json({ error: '担当者が見つかりません' });
      }

      const token = sanitizeToken(apiToken);
      // トークンの有効性を先に確認してから保存する（無効なトークンを保存してしまうと
      // あとで送信が失敗する原因が分かりにくいため）
      const meRes = await fetch(`${CHATWORK_API_BASE}/me`, {
        headers: { 'X-ChatWorkToken': token }
      });
      if (!meRes.ok) {
        return res.status(400).json({ error: 'Chatworkのトークンが無効です。コピーし直して再登録してください' });
      }

      await setSecret(chatworkSecretName(staffId), token);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Chatworkトークン登録エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/staff/chatwork-status?staffId=xxx
   * トークンが登録済みかどうかだけを返す（値は返さない）
   */
  router.get('/chatwork-status', async (req, res) => {
    if (!requireAppSecret(req, res)) return;
    try {
      const { staffId } = req.query;
      if (!staffId) return res.status(400).json({ error: 'staffId は必須です' });
      const connected = await hasSecret(chatworkSecretName(staffId));
      return res.status(200).json({ connected });
    } catch (error) {
      console.error('Chatwork連携状況確認エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/staff/chatwork-rooms?staffId=xxx
   * 登録済みトークンでその担当者が参加している部屋一覧を取得する
   * （MTG URL登録欄のChatworkルーム選択をプルダウンにするために使う）
   */
  router.get('/chatwork-rooms', async (req, res) => {
    if (!requireAppSecret(req, res)) return;
    try {
      const { staffId } = req.query;
      if (!staffId) return res.status(400).json({ error: 'staffId は必須です' });
      const token = await getSecret(chatworkSecretName(staffId));
      if (!token) {
        return res.status(404).json({ error: 'この担当者はChatworkが未連携です' });
      }
      const roomsRes = await fetch(`${CHATWORK_API_BASE}/rooms`, {
        headers: { 'X-ChatWorkToken': token }
      });
      if (!roomsRes.ok) {
        return res.status(502).json({ error: 'Chatwork APIの呼び出しに失敗しました' });
      }
      const rooms = await roomsRes.json();
      return res.status(200).json({
        rooms: rooms.map((r) => ({ id: String(r.room_id), name: r.name, type: r.type }))
      });
    } catch (error) {
      console.error('Chatworkルーム一覧取得エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/staff/chatwork-room-members?staffId=xxx&roomId=yyy
   * 指定ルームのメンバー一覧を取得する（お礼メッセージでメンションする相手を選ぶため）
   */
  router.get('/chatwork-room-members', async (req, res) => {
    if (!requireAppSecret(req, res)) return;
    try {
      const { staffId, roomId } = req.query;
      if (!staffId || !roomId) return res.status(400).json({ error: 'staffId, roomId は必須です' });
      const token = await getSecret(chatworkSecretName(staffId));
      if (!token) {
        return res.status(404).json({ error: 'この担当者はChatworkが未連携です' });
      }
      const membersRes = await fetch(`${CHATWORK_API_BASE}/rooms/${roomId}/members`, {
        headers: { 'X-ChatWorkToken': token }
      });
      if (!membersRes.ok) {
        return res.status(502).json({ error: 'Chatwork APIの呼び出しに失敗しました' });
      }
      const members = await membersRes.json();
      return res.status(200).json({
        members: members.map((m) => ({ accountId: String(m.account_id), name: m.name }))
      });
    } catch (error) {
      console.error('Chatworkルームメンバー取得エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = createStaffRouter;
