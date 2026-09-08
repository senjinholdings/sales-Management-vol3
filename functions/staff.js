/**
 * 担当者ごとの外部サービス連携（Chatwork）ルーター
 * - Chatwork APIトークンはFirestoreに置かず、Secret Managerにのみ保存する
 *   （Firestoreのセキュリティルールは現状ほぼ全開放のため、生きた認証情報を置けない）
 * - シークレット名は `CHATWORK_TOKEN_{staffId}` の形。staffIdはFirestoreの自動ID
 *   （英数字のみ）なのでSecret Managerの命名制約にそのまま使える
 */

const express = require('express');
const fetch = require('node-fetch');
const { WebClient } = require('@slack/web-api');
const { getSecret, setSecret, hasSecret, chatworkSecretName } = require('./secrets');
const { requireAppSecret, env } = require('./authHelpers');
const { computeActualMinutes, isRunningTask } = require('./dailyReportGuard');

const CHATWORK_API_BASE = 'https://api.chatwork.com/v2';
const NIGHT_REVIEW_NOTIFY_CHANNEL_ID = 'C09UJMZ7JNR'; // #営業_日報

/** ChatworkのAPIトークンをASCII化してから使う（全角混入によるヘッダーエラー事故対策） */
function sanitizeToken(token) {
  return String(token).trim().replace(/[^\x20-\x7e]/g, '');
}

function createStaffRouter({ admin, db }) {
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
      // あとで送信が失敗する原因が分かりにくいため）。同時に自分のaccount_idを取得し、
      // 社内メンバー判定（部屋メンバー一覧で「（社内）」表示する）に使う
      const meRes = await fetch(`${CHATWORK_API_BASE}/me`, {
        headers: { 'X-ChatWorkToken': token }
      });
      if (!meRes.ok) {
        return res.status(400).json({ error: 'Chatworkのトークンが無効です。コピーし直して再登録してください' });
      }
      const me = await meRes.json();

      await setSecret(chatworkSecretName(staffId), token);
      await db.collection('staffMembers').doc(staffId).update({
        chatworkAccountId: String(me.account_id)
      });
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

      // Chatworkの部屋メンバー情報には社内/社外の区別が無いため、
      // 担当者管理に登録済みの自社メンバーのaccount_idと突き合わせて判定する
      const staffSnap = await db.collection('staffMembers').get();
      const internalAccountIds = new Set(
        staffSnap.docs.map((d) => d.data().chatworkAccountId).filter(Boolean)
      );

      const result = members
        .map((m) => ({
          accountId: String(m.account_id),
          name: m.name,
          isInternal: internalAccountIds.has(String(m.account_id))
        }))
        // 社外を先、社内を後ろに（クライアント宛のメンションを選ぶ画面なので社外を優先表示）
        .sort((a, b) => (a.isInternal === b.isInternal ? 0 : a.isInternal ? 1 : -1));

      return res.status(200).json({ members: result });
    } catch (error) {
      console.error('Chatworkルームメンバー取得エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/staff/chatwork-contacts?staffId=xxx
   * 担当者の既存Chatworkコンタクト一覧を取得する
   * （ルーム作成時に社外メンバーを検索・選択するため。ChatworkのAPIはメールアドレスだけでの
   *   新規招待に対応しておらず、既にコンタクトの相手からしか選べない）
   */
  router.get('/chatwork-contacts', async (req, res) => {
    if (!requireAppSecret(req, res)) return;
    try {
      const { staffId } = req.query;
      if (!staffId) return res.status(400).json({ error: 'staffId は必須です' });
      const token = await getSecret(chatworkSecretName(staffId));
      if (!token) {
        return res.status(404).json({ error: 'この担当者はChatworkが未連携です' });
      }
      const contactsRes = await fetch(`${CHATWORK_API_BASE}/contacts`, {
        headers: { 'X-ChatWorkToken': token }
      });
      if (!contactsRes.ok) {
        return res.status(502).json({ error: 'Chatwork APIの呼び出しに失敗しました' });
      }
      const contacts = await contactsRes.json();
      return res.status(200).json({
        contacts: contacts.map((c) => ({
          accountId: String(c.account_id),
          name: c.name,
          organizationName: c.organization_name || ''
        }))
      });
    } catch (error) {
      console.error('Chatworkコンタクト一覧取得エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/staff/chatwork-create-room
   * body: { staffId: string, name: string, memberAccountIds: string[] }
   * 担当者のトークンで新しいChatworkルームを作成する。担当者本人は自動的に管理者として含める。
   * 選択されたメンバー（社内・社外どちらもコンタクト経由）はメンバーとして追加する
   */
  router.post('/chatwork-create-room', async (req, res) => {
    if (!requireAppSecret(req, res)) return;
    try {
      const { staffId, name, memberAccountIds } = req.body || {};
      if (!staffId || !name) {
        return res.status(400).json({ error: 'staffId, name は必須です' });
      }
      const token = await getSecret(chatworkSecretName(staffId));
      if (!token) {
        return res.status(404).json({ error: 'この担当者はChatworkが未連携です' });
      }
      const meRes = await fetch(`${CHATWORK_API_BASE}/me`, {
        headers: { 'X-ChatWorkToken': token }
      });
      if (!meRes.ok) {
        return res.status(400).json({ error: 'Chatworkのトークンが無効です' });
      }
      const me = await meRes.json();
      const selfId = String(me.account_id);
      const memberIds = (Array.isArray(memberAccountIds) ? memberAccountIds : [])
        .map(String)
        .filter((id) => id !== selfId);

      const body = new URLSearchParams({
        name,
        members_admin_ids: selfId
      });
      if (memberIds.length > 0) body.set('members_member_ids', memberIds.join(','));

      const createRes = await fetch(`${CHATWORK_API_BASE}/rooms`, {
        method: 'POST',
        headers: {
          'X-ChatWorkToken': token,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
      });
      if (!createRes.ok) {
        const text = await createRes.text().catch(() => '');
        return res.status(502).json({ error: `Chatworkルーム作成に失敗しました: ${text}` });
      }
      const created = await createRes.json();
      return res.status(200).json({ roomId: String(created.room_id) });
    } catch (error) {
      console.error('Chatworkルーム作成エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/staff/chatwork-invite-link
   * body: { staffId: string, roomId: string }
   * まだコンタクトでない相手を招待するためのルーム招待リンクを発行する（無ければ作成、
   * 既にあれば既存のものを返す）。発行したURLはダッシュボード上に表示し、担当者が
   * コピーしてメール等で相手に送る運用にする（Chatwork APIにメールアドレスだけでの
   * 新規招待は無いため）
   */
  router.post('/chatwork-invite-link', async (req, res) => {
    if (!requireAppSecret(req, res)) return;
    try {
      const { staffId, roomId } = req.body || {};
      if (!staffId || !roomId) {
        return res.status(400).json({ error: 'staffId, roomId は必須です' });
      }
      const token = await getSecret(chatworkSecretName(staffId));
      if (!token) {
        return res.status(404).json({ error: 'この担当者はChatworkが未連携です' });
      }

      const existingRes = await fetch(`${CHATWORK_API_BASE}/rooms/${roomId}/link`, {
        headers: { 'X-ChatWorkToken': token }
      });
      if (existingRes.ok) {
        const existing = await existingRes.json();
        if (existing.public) {
          return res.status(200).json({ url: existing.url });
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
        return res.status(502).json({ error: `Chatwork招待リンクの発行に失敗しました: ${text}` });
      }
      const created = await createRes.json();
      return res.status(200).json({ url: created.url });
    } catch (error) {
      console.error('Chatwork招待リンク発行エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/staff/night-review-complete
   * body: { representative: string, date: string ("YYYY-MM-DD") }
   * 日報画面の「完了」ボタンから呼ばれる。夜の振り返りが終わったことを記録し、
   * その日の夜チェックスレッド（無ければ通常投稿）に完了報告を送る（メンションなし。
   * 以前は増田さん宛にメンションしていたが、営業日報の通知からは外すことになった）。
   * 「終わったかどうか」の唯一の判定基準はこのreviewCompletedAtで、
   * 振り返り欄に文字が入っているかどうかでは判定しない（functions/dailyReportGuard.js参照）
   */
  router.post('/night-review-complete', async (req, res) => {
    if (!requireAppSecret(req, res)) return;
    try {
      const { representative, date } = req.body || {};
      if (!representative || !date) {
        return res.status(400).json({ error: 'representative, date は必須です' });
      }

      const docRef = db.collection('dailyTimers').doc(`${representative}_${date}`);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: '対象の日報データが見つかりません' });
      }
      const data = snap.data();

      await docRef.update({
        reviewCompletedAt: admin.firestore.Timestamp.now()
      });

      const token = env('SLACK_BOT_TOKEN');
      if (token) {
        try {
          const slack = new WebClient(token);
          await slack.chat.postMessage({
            channel: NIGHT_REVIEW_NOTIFY_CHANNEL_ID,
            text: `✅ ${representative}さんが夜の振り返りを完了しました`,
            ...(data.nightThreadTs ? { thread_ts: data.nightThreadTs } : {})
          });
        } catch (slackError) {
          console.error('完了通知のSlack送信失敗（続行）:', slackError.message);
        }
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('夜の振り返り完了記録エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/staff/urgent-task-complete
   * body: { representative: string, date: string ("YYYY-MM-DD"), taskId: string }
   * 日報画面の緊急クエストの「完了報告」ボタンから呼ばれる。実行中なら区間を閉じたうえで、
   * その緊急クエストの元になったSlackスレッド（functions/urgentQuest.js参照）へ
   * 経過時間つきで完了報告を返信する。
   */
  router.post('/urgent-task-complete', async (req, res) => {
    if (!requireAppSecret(req, res)) return;
    try {
      const { representative, date, taskId } = req.body || {};
      if (!representative || !date || !taskId) {
        return res.status(400).json({ error: 'representative, date, taskId は必須です' });
      }

      const docRef = db.collection('dailyTimers').doc(`${representative}_${date}`);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: '対象の日報データが見つかりません' });
      }
      const data = snap.data();
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      const target = tasks.find((t) => t.id === taskId);
      if (!target || !target.isUrgentTask) {
        return res.status(404).json({ error: '対象の緊急クエストが見つかりません' });
      }

      const now = admin.firestore.Timestamp.now();
      const updatedTasks = tasks.map((t) => {
        if (t.id !== taskId) return t;
        const sessions = Array.isArray(t.sessions) ? t.sessions : [];
        const closedSessions = isRunningTask(t)
          ? sessions.map((s, i) => (i === sessions.length - 1 ? { ...s, endedAt: now } : s))
          : sessions;
        return { ...t, sessions: closedSessions, urgentReportedAt: now };
      });
      await docRef.update({ tasks: updatedTasks });

      const reportedTask = updatedTasks.find((t) => t.id === taskId);
      const elapsedMinutes = Math.round(computeActualMinutes(reportedTask));

      const token = env('SLACK_BOT_TOKEN');
      if (token && target.slackChannelId) {
        try {
          const slack = new WebClient(token);
          await slack.chat.postMessage({
            channel: target.slackChannelId,
            thread_ts: target.slackThreadTs || undefined,
            text: `✅ 対応完了しました（経過${elapsedMinutes}分）`
          });
        } catch (slackError) {
          console.error('緊急クエスト完了報告のSlack送信失敗（続行）:', slackError.message);
        }
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('緊急クエスト完了報告エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = createStaffRouter;
