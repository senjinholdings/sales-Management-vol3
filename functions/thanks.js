/**
 * お礼メッセージの実送信ロジック。
 * Slackの承認ボタン（functions/slackApproval.js）から呼ばれる想定で、
 * ここが呼ばれた時点で「担当者が下書き内容を確認してボタンを押した」ことが
 * 確定しているため、この関数自体には承認判断は含まない（純粋な送信処理）。
 */

const fetch = require('node-fetch');
const { getSecret, chatworkSecretName } = require('./secrets');

/** ChatworkのAPIトークンをASCII化してから使う（staff.jsと同じ規則） */
function sanitizeToken(token) {
  return String(token).trim().replace(/[^\x20-\x7e]/g, '');
}

async function sendViaChatwork({ roomId, token, body }) {
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
    method: 'POST',
    headers: {
      'X-ChatWorkToken': sanitizeToken(token),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ body })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Chatwork送信失敗: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * 承認された下書きを実際に送信し、meetings/materialsの記録を更新する。
 * 既にsent済みなら何もせず結果だけ返す（Slackボタンの二重押下対策）。
 * @param {{admin, db, dealId: string, meetingId: string}} params
 */
async function sendThankYou({ admin, db, dealId, meetingId }) {
  const meetingRef = db.collection('meetings').doc(meetingId);
  const meetingSnap = await meetingRef.get();
  if (!meetingSnap.exists) throw new Error('meetingが見つかりません');
  const meeting = meetingSnap.data();

  if (meeting.thankYouStatus === 'sent') {
    return { alreadySent: true, channel: meeting.thankYouChannel };
  }
  if (!meeting.thankYouDraft) throw new Error('下書きがありません');

  const dealSnap = await db.collection('progressDashboard').doc(dealId).get();
  if (!dealSnap.exists) throw new Error('案件が見つかりません');
  const deal = dealSnap.data();

  const staffSnap = await db.collection('staffMembers').where('name', '==', deal.representative).limit(1).get();
  if (staffSnap.empty) throw new Error(`担当者「${deal.representative}」が担当者管理に見つかりません`);
  const staffId = staffSnap.docs[0].id;

  const settingsSnap = await db.collection('clientMeetingSettings')
    .where('companyName', '==', deal.companyName)
    .limit(1)
    .get();
  if (settingsSnap.empty) throw new Error('この会社のMTG設定が見つかりません');
  const settings = settingsSnap.docs[0].data();

  if (!settings.chatworkRoomId) throw new Error('Chatworkルームが未設定です');
  const token = await getSecret(chatworkSecretName(staffId));
  if (!token) throw new Error(`${deal.representative}のChatworkが未連携です`);

  await sendViaChatwork({ roomId: settings.chatworkRoomId, token, body: meeting.thankYouDraft });

  const batch = db.batch();
  batch.update(meetingRef, {
    thankYouStatus: 'sent',
    thankYouChannel: 'chatwork',
    thankYouSentAt: admin.firestore.FieldValue.serverTimestamp()
  });
  if (meeting.thankYouMaterialId) {
    const materialRef = db.collection('progressDashboard').doc(dealId)
      .collection('materials').doc(meeting.thankYouMaterialId);
    batch.update(materialRef, {
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      sentVia: 'chatwork',
      sentMeetingId: meetingId
    });
  }
  await batch.commit();

  return { channel: 'chatwork' };
}

module.exports = { sendThankYou };
