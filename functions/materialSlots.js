/**
 * MTGごとの「資料枠」を先回りして用意する共通ヘルパー。
 * - 臨時MTGは登録された時点（functions/calendar.js）で、
 * - 定例MTGは前回分の処理完了時点（functions/tldv.js、次回分を先回り生成）で、
 * それぞれ呼ばれる想定。
 * 呼び出し元はcalendar.js・tldv.jsの両方にあり、同じ日付の枠が既にあれば
 * 何もしない（idempotent）。ドキュメントIDを日付から決定的に作ることで、
 * Webhookの再送などによる重複作成も防ぐ。
 */

/**
 * @param {{db: FirebaseFirestore.Firestore, admin: import('firebase-admin'), dealId: string, scheduledDate: string, meetingType: '定例'|'臨時'}} params
 */
async function ensureMaterialSlot({ db, admin, dealId, scheduledDate, meetingType }) {
  if (!dealId || !scheduledDate) return;
  try {
    const ref = db.collection('progressDashboard').doc(dealId)
      .collection('materials').doc(`slot_${scheduledDate}`);
    const snap = await ref.get();
    if (snap.exists) return; // 既に枠がある（資料登録済み含む）ので上書きしない
    await ref.set({
      title: '',
      url: '',
      scheduledDate,
      meetingType: meetingType || null,
      sentAt: null,
      sentVia: null,
      sentMeetingId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('資料枠の作成失敗（続行）:', error.message);
  }
}

module.exports = { ensureMaterialSlot };
