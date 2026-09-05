/**
 * 朝のチェックの自動化。毎朝8:00 JSTに1回実行し、#営業_日報チャンネルへ
 * その日の確認事項をまとめて投稿する（読み取り専用。自動で何かを直したりはしない）。
 *
 * チェック内容:
 * - 昨日MTGがあった案件（tl;dv連携のmeetings.dealIdsで紐付け済み）に
 *   「ステータス更新は不要ですか？」とナッジする
 * - 新規/既存それぞれの案件一覧で、期限切れのネクストアクションを列挙する
 *   （entriesサブコレクションのactionDueDateを見る。画面表示の期限切れ判定と
 *   同じ基準を使う＝2日以内は急ぎ、超過は超過）
 * - 提案中（フェーズ1〜7）なのにアクティブなネクストアクションが1件も無い案件を列挙する
 * - 直近3日以内にフェーズ8になったのに成約日が未記入の案件を列挙する
 * - フェーズ8なのに既存案件フラグが立っていない案件（＝成約案件一覧から
 *   サイレントに漏れる不整合）を列挙する
 */

const { WebClient } = require('@slack/web-api');
const { env } = require('./authHelpers');

const NOTIFY_CHANNEL_ID = 'C09UJMZ7JNR'; // #営業_日報
const CLOSED_PHASE = 'フェーズ8';
const INACTIVE_STATUSES = [CLOSED_PHASE, 'Dead', '失注'];
const CONFIRMED_DATE_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000; // 直近3日

/** 日付をAsia/Tokyo（UTC+9固定・DSTなし）の "YYYY-MM-DD" に変換する */
function toJstDateStr(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" が土曜・日曜かどうか */
function isWeekendDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

/**
 * 期限バッジ判定（画面表示側のProgressDashboard.js等と同じ基準に揃えたもの）。
 * 2日以内は「急ぎ」、過ぎていれば「超過」
 */
function getDueStatus(dueDateStr) {
  if (!dueDateStr) return 'none';
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due < today) return 'overdue';
  const twoDaysFromToday = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
  if (due <= twoDaysFromToday) return 'urgent';
  return 'normal';
}

const dealLabel = (deal) => `${deal.companyName || '(社名不明)'} / ${deal.productName || '(商材不明)'}`;

/** 案件1件の両サブコレクション（salesRecords・newCaseSalesRecords）からNAエントリを集める */
async function collectActiveEntries(db, dealId) {
  const entries = [];
  await Promise.all(['salesRecords', 'newCaseSalesRecords'].map(async (subCol) => {
    const recordsSnap = await db.collection('progressDashboard').doc(dealId).collection(subCol).get();
    await Promise.all(recordsSnap.docs.map(async (recordDoc) => {
      const entriesSnap = await recordDoc.ref.collection('entries').get();
      entriesSnap.docs.forEach((entryDoc) => {
        const e = entryDoc.data();
        if (e.actionContent) entries.push(e);
      });
    }));
  }));
  entries.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  return entries;
}

/**
 * @param {{db: FirebaseFirestore.Firestore}} deps
 */
function createMorningDigest({ db }) {
  return async () => {
    const token = env('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN が未設定のため朝のチェックをスキップ');
      return;
    }
    const slack = new WebClient(token);

    const now = new Date();
    const todayStr = toJstDateStr(now);
    if (isWeekendDateStr(todayStr)) return; // 土日は投稿しない
    const yesterdayStr = toJstDateStr(new Date(now.getTime() - 24 * 60 * 60 * 1000));

    const dealsSnap = await db.collection('progressDashboard').get();
    const deals = dealsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const dealsById = new Map(deals.map((d) => [d.id, d]));

    const overdueNew = [];
    const overdueExisting = [];
    const missingNa = [];
    const missingConfirmedDate = [];
    const inconsistentDeals = [];

    await Promise.all(deals.map(async (deal) => {
      // ステータス不整合（フェーズ8なのに既存案件フラグが無い＝成約一覧からサイレントに漏れる）
      if (deal.status === CLOSED_PHASE && !deal.isExistingProject) {
        inconsistentDeals.push(deal);
      }

      // 成約日の記載漏れ（直近3日以内にフェーズ8になったレコードだけ対象）
      const closedSubCol = deal.isExistingProject ? 'salesRecords' : 'newCaseSalesRecords';
      try {
        const recSnap = await db.collection('progressDashboard').doc(deal.id).collection(closedSubCol).get();
        recSnap.docs.forEach((recDoc) => {
          const rd = recDoc.data();
          if (rd.phase !== CLOSED_PHASE || rd.confirmedDate) return;
          const ts = rd.updatedAt?.toMillis?.() || rd.createdAt?.toMillis?.() || 0;
          if (Date.now() - ts > CONFIRMED_DATE_LOOKBACK_MS) return;
          missingConfirmedDate.push(deal);
        });
      } catch (error) {
        console.error(`成約日チェック失敗（続行）: ${deal.id}`, error.message);
      }

      // フェーズ8/Dead/失注の案件は、ネクストアクション・期限切れの対象外
      if (INACTIVE_STATUSES.includes(deal.status)) return;

      let activeEntries = [];
      try {
        activeEntries = (await collectActiveEntries(db, deal.id)).filter((e) => e.actionStatus !== 'done');
      } catch (error) {
        console.error(`NA取得失敗（続行）: ${deal.id}`, error.message);
        return;
      }

      if (activeEntries.length === 0) {
        missingNa.push(deal);
        return;
      }

      const latest = activeEntries[0];
      if (getDueStatus(latest.actionDueDate) === 'overdue') {
        const target = deal.isExistingProject ? overdueExisting : overdueNew;
        target.push({ deal, dueDate: latest.actionDueDate });
      }
    }));

    // 昨日MTGがあった案件へのステータス更新ナッジ（tl;dv連携のmeetings.dealIdsを使う）
    const mtgNudgeDeals = [];
    try {
      const meetingsSnap = await db.collection('meetings').get();
      const nudgedDealIds = new Set();
      meetingsSnap.docs.forEach((m) => {
        const data = m.data();
        if (!data.happenedAt) return;
        if (toJstDateStr(new Date(data.happenedAt)) !== yesterdayStr) return;
        (Array.isArray(data.dealIds) ? data.dealIds : []).forEach((dealId) => {
          if (nudgedDealIds.has(dealId)) return;
          const deal = dealsById.get(dealId);
          if (deal) {
            nudgedDealIds.add(dealId);
            mtgNudgeDeals.push(deal);
          }
        });
      });
    } catch (error) {
      console.error('MTGナッジ取得失敗（続行）:', error.message);
    }

    // メッセージ組み立て（該当が無い項目は載せない）
    const sections = [];
    if (mtgNudgeDeals.length > 0) {
      sections.push([
        '*昨日MTGがあった案件（ステータス更新は不要ですか？）*',
        ...mtgNudgeDeals.map((d) => `・${dealLabel(d)}`)
      ].join('\n'));
    }
    if (overdueNew.length > 0) {
      sections.push([
        '*新規案件一覧: 期限切れのネクストアクション*',
        ...overdueNew.map(({ deal, dueDate }) => `・${dealLabel(deal)}（期日: ${dueDate}）`)
      ].join('\n'));
    }
    if (overdueExisting.length > 0) {
      sections.push([
        '*既存案件一覧: 期限切れのネクストアクション*',
        ...overdueExisting.map(({ deal, dueDate }) => `・${dealLabel(deal)}（期日: ${dueDate}）`)
      ].join('\n'));
    }
    if (missingNa.length > 0) {
      sections.push([
        '*ネクストアクションが未記入*',
        ...missingNa.map((d) => `・${dealLabel(d)}`)
      ].join('\n'));
    }
    if (missingConfirmedDate.length > 0) {
      sections.push([
        '*成約日が未記入（直近3日以内に成約）*',
        ...missingConfirmedDate.map((d) => `・${dealLabel(d)}`)
      ].join('\n'));
    }
    if (inconsistentDeals.length > 0) {
      sections.push([
        '*ステータス不整合（フェーズ8だが既存案件フラグが無い）*',
        ...inconsistentDeals.map((d) => `・${dealLabel(d)}`)
      ].join('\n'));
    }

    const text = sections.length > 0
      ? `📋 *朝のチェック（${todayStr}）*\n\n${sections.join('\n\n')}`
      : `📋 朝のチェック（${todayStr}）: 異常なし ✅`;

    await slack.chat.postMessage({ channel: NOTIFY_CHANNEL_ID, text });
  };
}

module.exports = { createMorningDigest };
