/**
 * vol3の案件を、account-sales-boardで「見るだけ」表示するための写しを作る。
 *
 * 統合の第一段階（2026年9月）。案件そのものはvol3に置いたまま、account-sales-boardの
 * Firestoreの vol3Deals に1案件1ドキュメントの写しを置く。account-sales-board側はこれを読んで
 * 「荒幡さんの案件」の一覧と、PLの「vol3の受注」の列に出す（編集はvol3で行う）。
 *
 * - vol3のデータは読むだけ。こちらからvol3の案件・営業記録を書き換えることはない
 * - 写しの書き込み先はaccount-sales-boardのFirestore（getTemplateDbと同じ接続。
 *   sales-management-staging@appspot.gserviceaccount.com に Datastore のオーナーを付けてある前提）
 * - 中身が変わった案件だけ書く（hashで比較）。vol3で消えた案件は写しも消す
 * - アカウント営業（salesTrack === 'account'）はaccount-sales-boardで管理しているので写さない
 *
 * ステータスの対応は、運用側で決めた表をそのまま使う（account-sales-boardのステータスは
 * 「次にやること」を表す）。本当に移す段階（第二段階）でも同じ表を使う。
 */

const { getTemplateDb } = require('./accountSalesBoard');

const MIRROR_COLLECTION = 'vol3Deals';
const META_DOC = ['appConfig', 'vol3Mirror'];
const VOL3_APP_URL = 'https://sales-management-staging.web.app';

const ASB_PHASES = ['ヒアリング', '提案書の提示', '担当者の実施判断', '社内の最終決済', '契約手続き', '契約完了', '運用中', '案件終了'];
const VOL3_TO_ASB = {
  'フェーズ1': 'ヒアリング',
  'フェーズ2': 'ヒアリング',
  'フェーズ3': '提案書の提示',
  'フェーズ4': '担当者の実施判断',
  'フェーズ5': '社内の最終決済',
  'フェーズ6': '契約手続き',
  'フェーズ7': '契約完了',
};
// ステータスが空欄の案件（リストをまとめて取り込んだだけで、まだ営業が始まっていないもの）
const NOT_STARTED = '未案件化';

const asbIndex = (status) => ASB_PHASES.indexOf(status) + 1; // 見つからなければ0
const phase8Status = (deal) => (deal.continuationStatus === '終了' ? '案件終了' : '運用中');

function mapStatus(deal) {
  const s = deal.status || '';
  if (s === 'フェーズ8') return phase8Status(deal);
  if (s === 'Dead' || s === '失注') return s;
  return VOL3_TO_ASB[s] || NOT_STARTED;
}

function phaseIndexOfVol3(phase, deal) {
  if (phase === 'フェーズ8') return asbIndex(phase8Status(deal));
  return asbIndex(VOL3_TO_ASB[phase] || '');
}

function toMillis(v) {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}
const toIso = (v) => { const t = toMillis(v); return t ? new Date(t).toISOString() : null; };
// "YYYY-MM-DD"（JST）。vol3の日付は文字列とTimestampが混在している
const toDate10 = (v) => {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const t = toMillis(v);
  return t ? new Date(t + 9 * 3600000).toISOString().slice(0, 10) : null;
};
const toNumber = (v) => { const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v); return Number.isFinite(n) ? n : 0; };

// progressDashboard/{dealId}/{sub}/{recordId}[/entries/{entryId}] のパスから案件IDなどを取り出す
function recordPath(ref) {
  const parts = ref.path.split('/');
  if (parts[0] !== 'progressDashboard') return null;
  return { dealId: parts[1], subCol: parts[2], recordId: parts[3] };
}

function buildMirror(dealId, deal, { records, entries, meetings }) {
  const status = mapStatus(deal);
  // 一度でも到達した一番先のフェーズ。今のステータス・失注の直前・営業記録のフェーズ・
  // 「フェーズ2→フェーズ3」のような変更の記録から、いちばん先のものを取る
  let maxIdx = asbIndex(status);
  if (deal.lostAtPhase) maxIdx = Math.max(maxIdx, phaseIndexOfVol3(deal.lostAtPhase, deal));
  records.forEach((r) => { if (r.data.phase) maxIdx = Math.max(maxIdx, phaseIndexOfVol3(r.data.phase, deal)); });
  entries.forEach((e) => {
    const m = /→\s*(フェーズ\d)/.exec(e.data.phaseChange || '');
    if (m) maxIdx = Math.max(maxIdx, phaseIndexOfVol3(m[1], deal));
  });

  // 受注の記録は、成約案件一覧と同じく「案件の区分に対応する側の営業記録」だけを見る
  // （両方を読むと、過去の二重登録の残骸で同じ受注が2回数えられる）
  const orderSub = deal.isExistingProject ? 'salesRecords' : 'newCaseSalesRecords';
  const ownRecords = records.filter((r) => r.subCol === orderSub);
  const orders = ownRecords
    .filter((r) => r.data.phase === 'フェーズ8' && r.data.confirmedDate)
    .map((r) => ({
      id: r.recordId,
      confirmedDate: toDate10(r.data.confirmedDate),
      amount: toNumber(r.data.budget),
      recordType: r.data.recordType || '',
      startDate: toDate10(r.data.startDate),
      endDate: toDate10(r.data.endDate),
    }))
    .sort((a, b) => String(a.confirmedDate).localeCompare(String(b.confirmedDate)));

  // 想定予算: パイプライン振り返りと同じく、日付が一番新しく1円以上の営業記録の予算を優先する
  const latestBudgetRecord = ownRecords
    .filter((r) => toNumber(r.data.budget) > 0)
    .sort((a, b) => String(toDate10(b.data.date) || '').localeCompare(String(toDate10(a.data.date) || '')))[0];
  const budget = latestBudgetRecord ? toNumber(latestBudgetRecord.data.budget) : toNumber(deal.expectedBudget);

  const nas = entries.filter((e) => e.data.actionContent);
  const openNas = nas
    .filter((e) => e.data.actionStatus !== 'done')
    .map((e) => ({
      text: String(e.data.actionContent || ''),
      dueDate: toDate10(e.data.actionDueDate),
      assignee: e.data.actionAssignee || '',
      status: e.data.actionStatus || 'active',
    }))
    .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
  const activityTimes = entries.map((e) => toMillis(e.data.createdAt)).filter(Boolean);
  const meetingTimes = meetings.map((m) => toMillis(m.happenedAt)).filter(Boolean);

  const displayName = deal.companyName || deal.productName || '（名前なし）';
  return {
    companyName: displayName,
    hasCompanyName: !!deal.companyName,
    productName: deal.productName || '',
    proposalMenu: deal.proposalMenu || '',
    leadSource: deal.leadSource || '',
    introducer: deal.introducer || '',
    vol3Status: deal.status || '',
    status,
    maxPhaseReached: maxIdx,
    kind: deal.isExistingProject ? '既存' : '新規',
    // 案件担当は、vol3から来たものはすべて荒幡さん（運用側で決めたこと）。元の担当欄も残しておく
    representative: 'arahata',
    originalRepresentative: deal.representative || '',
    budget,
    createdAt: toIso(deal.createdAt),
    confirmedDate: toDate10(deal.confirmedDate),
    lostDate: toDate10(deal.lostDate),
    continuationStatus: deal.continuationStatus || '',
    nextActions: openNas.slice(0, 5),
    openNaCount: openNas.length,
    doneNaCount: nas.length - openNas.length,
    memoCount: entries.filter((e) => e.data.memoContent).length,
    lastActivityAt: activityTimes.length ? new Date(Math.max(...activityTimes)).toISOString() : null,
    meetingCount: meetings.length,
    lastMeetingAt: meetingTimes.length ? new Date(Math.max(...meetingTimes)).toISOString() : null,
    orders,
    vol3Url: `${VOL3_APP_URL}/${deal.isExistingProject ? 'project-management' : 'progress-dashboard'}?id=${dealId}`,
  };
}

function createVol3MirrorSync({ admin, db }) {
  return async function syncVol3Mirror() {
    const startedAt = Date.now();
    const asb = getTemplateDb(admin);
    const metaRef = asb.collection(META_DOC[0]).doc(META_DOC[1]);
    try {
      const [dealsSnap, salesSnap, newCaseSnap, entriesSnap, meetingsSnap, mirrorSnap] = await Promise.all([
        db.collection('progressDashboard').get(),
        db.collectionGroup('salesRecords').get(),
        db.collectionGroup('newCaseSalesRecords').get(),
        db.collectionGroup('entries').get(),
        db.collection('meetings').get(),
        asb.collection(MIRROR_COLLECTION).select('hash').get(),
      ]);

      const recordsByDeal = new Map();
      [...salesSnap.docs, ...newCaseSnap.docs].forEach((d) => {
        const p = recordPath(d.ref);
        if (!p) return;
        if (!recordsByDeal.has(p.dealId)) recordsByDeal.set(p.dealId, []);
        recordsByDeal.get(p.dealId).push({ ...p, data: d.data() });
      });
      const entriesByDeal = new Map();
      entriesSnap.docs.forEach((d) => {
        const p = recordPath(d.ref);
        if (!p || (p.subCol !== 'salesRecords' && p.subCol !== 'newCaseSalesRecords')) return;
        if (!entriesByDeal.has(p.dealId)) entriesByDeal.set(p.dealId, []);
        entriesByDeal.get(p.dealId).push({ ...p, data: d.data() });
      });
      const meetingsByDeal = new Map();
      meetingsSnap.docs.forEach((d) => {
        const m = d.data();
        (m.dealIds || []).forEach((id) => {
          if (!meetingsByDeal.has(id)) meetingsByDeal.set(id, []);
          meetingsByDeal.get(id).push(m);
        });
      });
      const existingHash = new Map(mirrorSnap.docs.map((d) => [d.id, d.get('hash')]));

      const keep = new Set();
      let batch = asb.batch();
      let ops = 0;
      let changed = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = asb.batch(); ops = 0; } };

      for (const d of dealsSnap.docs) {
        const deal = d.data();
        if (deal.salesTrack === 'account' || deal.isStandaloneNa) continue;
        keep.add(d.id);
        const mirror = buildMirror(d.id, deal, {
          records: recordsByDeal.get(d.id) || [],
          entries: entriesByDeal.get(d.id) || [],
          meetings: meetingsByDeal.get(d.id) || [],
        });
        const hash = JSON.stringify(mirror);
        if (existingHash.get(d.id) === hash) continue;
        batch.set(asb.collection(MIRROR_COLLECTION).doc(d.id), {
          ...mirror,
          hash,
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        ops += 1;
        changed += 1;
        if (ops >= 400) await flush();
      }
      let removed = 0;
      for (const id of existingHash.keys()) {
        if (keep.has(id)) continue;
        batch.delete(asb.collection(MIRROR_COLLECTION).doc(id));
        ops += 1;
        removed += 1;
        if (ops >= 400) await flush();
      }
      await flush();

      await metaRef.set({
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        dealCount: keep.size,
        changed,
        removed,
        durationMs: Date.now() - startedAt,
        error: null,
      }, { merge: true });
      console.log(`vol3の写しを更新: ${keep.size}件（変更${changed}・削除${removed}）`);
    } catch (error) {
      console.error('vol3の写しの更新に失敗:', error);
      await metaRef.set({
        lastFailedAt: admin.firestore.FieldValue.serverTimestamp(),
        error: String(error.message || error),
      }, { merge: true }).catch(() => {});
      throw error;
    }
  };
}

module.exports = { createVol3MirrorSync, buildMirror, mapStatus, MIRROR_COLLECTION };
