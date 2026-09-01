/**
 * Googleカレンダー連携ルーター
 * - 案件詳細の「MTGを登録」ボタンから、営業担当者のカレンダーに代理で予定を作成する
 * - ドメイン全体の委任（Domain-Wide Delegation）で専用サービスアカウント（tldv-calendar）が
 *   担当者本人になりすまして予定を作成する。ブラウザにGoogleの認証情報は一切渡さない
 * - 委任設定（Workspace管理者によるクライアントID許可）が未完了の間は
 *   invalid_grant等のエラーになるが、コード自体はその前提で動く
 */

const express = require('express');
const { google } = require('googleapis');

function env(name) {
  const v = process.env[name];
  return v ? v.trim() : v;
}

/** 前後の空白除去＋全角英数字を半角に変換＋小文字化（tldv.jsのnormalizeSecretと同じ規則） */
function normalizeSecret(str) {
  return String(str)
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

/** Google MeetのURLから会議コードを抽出して正規化する（tldv.jsの照合ロジックと同じ規則） */
function normalizeMeetUrl(url) {
  if (!url) return null;
  const m = String(url).match(/meet\.google\.com\/([a-z0-9-]+)/i);
  if (m) return m[1].toLowerCase();
  return String(url).trim().toLowerCase() || null;
}

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_TO_RRULE = { '日': 'SU', '月': 'MO', '火': 'TU', '水': 'WE', '木': 'TH', '金': 'FR', '土': 'SA' };

/** 指定した担当者になりすましたCalendar APIクライアントを作る */
function getCalendarClientForUser(userEmail) {
  const keyJson = env('TLDV_CALENDAR_SA_KEY');
  if (!keyJson) throw new Error('TLDV_CALENDAR_SA_KEY not configured');
  const credentials = JSON.parse(keyJson);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: CALENDAR_SCOPES,
    subject: userEmail
  });
  return google.calendar({ version: 'v3', auth });
}

/**
 * @param {{admin: import('firebase-admin'), db: FirebaseFirestore.Firestore}} deps
 */
function createCalendarRouter({ admin, db }) {
  const router = express.Router();

  /**
   * POST /api/meetings/schedule
   * body: {
   *   organizerEmail: string,     // 予定を代理作成する担当者（staffMembers.email）
   *   companyName: string,        // クライアント名（clientMeetingSettingsのキー）
   *   title: string,
   *   startDateTime: string,      // "YYYY-MM-DDTHH:mm"（Asia/Tokyoのローカル時刻として解釈）
   *   durationMinutes: number,
   *   recurring: boolean,         // true=定例（毎週）, false=臨時（1回のみ）
   *   attendeeEmails: string[]    // 任意（先方の参加者メール）
   * }
   */
  router.post('/schedule', async (req, res) => {
    const secret = env('MEETING_SCHEDULE_SECRET');
    if (!secret) {
      console.error('MEETING_SCHEDULE_SECRET が未設定のため拒否');
      return res.status(500).json({ error: 'secret not configured' });
    }
    const provided = req.headers['x-meeting-secret'];
    if (!provided || normalizeSecret(provided) !== normalizeSecret(secret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const { organizerEmail, companyName, title, startDateTime, durationMinutes, recurring, attendeeEmails } = req.body || {};
      if (!organizerEmail || !companyName || !startDateTime) {
        return res.status(400).json({ error: 'organizerEmail, companyName, startDateTime は必須です' });
      }

      // "YYYY-MM-DDTHH:mm" をAsia/Tokyo（UTC+9固定）のローカル時刻として解釈する
      const start = new Date(`${startDateTime}:00+09:00`);
      if (isNaN(start.getTime())) {
        return res.status(400).json({ error: 'startDateTimeの形式が不正です' });
      }
      const durMin = Number(durationMinutes) > 0 ? Number(durationMinutes) : 30;
      const end = new Date(start.getTime() + durMin * 60000);
      const dayOfWeek = DAY_NAMES[start.getDay()];

      const calendar = getCalendarClientForUser(organizerEmail);
      const requestId = `mtg-${start.getTime()}-${Math.random().toString(36).slice(2, 8)}`;

      const eventBody = {
        summary: title || `${companyName} MTG`,
        start: { dateTime: start.toISOString(), timeZone: 'Asia/Tokyo' },
        end: { dateTime: end.toISOString(), timeZone: 'Asia/Tokyo' },
        attendees: (attendeeEmails || []).filter(Boolean).map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        },
        ...(recurring ? { recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${DAY_TO_RRULE[dayOfWeek]}`] } : {})
      };

      const { data } = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: eventBody,
        conferenceDataVersion: 1,
        sendUpdates: 'all'
      });

      const meetUrl = normalizeMeetUrl(data.hangoutLink);

      // 会社単位のMTG設定（clientMeetingSettings）に反映。手動登録（MeetUrlsSection）と同じ保存先
      const settingsSnap = await db.collection('clientMeetingSettings')
        .where('companyName', '==', companyName)
        .limit(1)
        .get();

      const settingsData = {
        companyName,
        meetUrl,
        recurringDayOfWeek: recurring ? dayOfWeek : null,
        recurringTime: recurring
          ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
          : null,
        calendarEventId: data.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (settingsSnap.empty) {
        await db.collection('clientMeetingSettings').add(settingsData);
      } else {
        await settingsSnap.docs[0].ref.update(settingsData);
      }

      return res.status(200).json({ success: true, meetUrl, eventId: data.id, htmlLink: data.htmlLink });
    } catch (error) {
      console.error('カレンダー予定作成エラー:', error.message);
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = createCalendarRouter;
