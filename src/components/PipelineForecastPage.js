import React, { useState, useEffect, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { FiEdit3, FiPlus, FiCheck, FiX, FiRefreshCw, FiTarget, FiFileText } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { STATUS_COLORS, PHASE_DESCRIPTIONS } from '../data/constants.js';
import { addSalesEntry, updateSalesEntry, updateSalesEntryStatus } from '../services/projectService.js';
import { suggestGapClosingActions, isGPTServiceAvailable } from '../services/gptService.js';

// 日報（デイリータイマー）等と同様、現状は荒幡さんのみが対象の専用画面
// progressDashboardのrepresentativeは実データ上「荒幡」（姓のみ）で保存されている
// （SALES_REPRESENTATIVES定数の「荒幡 輝」とは表記が異なるので注意）
const REP_NAME = '荒幡';

// 受注済み(フェーズ8)・Dead・失注は対象外。それ以外の進行中フェーズだけを一覧に出す
const OPEN_PHASES = ['フェーズ1', 'フェーズ2', 'フェーズ3', 'フェーズ4', 'フェーズ5', 'フェーズ6', 'フェーズ7'];

// フェーズに応じた着地確率の目安（%）。案件ごとに手で上書きできる初期値として使う
const PHASE_PROBABILITY = {
  'フェーズ1': 5,
  'フェーズ2': 15,
  'フェーズ3': 25,
  'フェーズ4': 50,
  'フェーズ5': 70,
  'フェーズ6': 90,
  'フェーズ7': 95
};

const formatCurrency = (value) => `¥${Math.round(value || 0).toLocaleString()}`;

/** HomeDashboard.jsのgenerateQuarterOptions/getQuarterRangeと同じ考え方（四半期キー "YYYY-QN"） */
const generateQuarterOptions = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  const options = [];
  for (let y = currentYear - 1; y <= currentYear + 1; y++) {
    for (let q = 1; q <= 4; q++) {
      options.push({ value: `${y}-Q${q}`, label: `${y}年 Q${q}（${(q - 1) * 3 + 1}〜${q * 3}月）` });
    }
  }
  return { options, current: `${currentYear}-Q${currentQ}` };
};

// 実績（確定済み売上）はsalesRecords/newCaseSalesRecordsのrecordTypeで新規/継続を区別する
// （案件側のisExistingProjectとは別の集計軸。HomeDashboard.jsの実績集計と同じ考え方）
const RECORD_TYPE_BY_DEAL_TYPE = { new: '新規', existing: '継続' };

/** 四半期キーから、その四半期に含まれる3つの月の範囲を返す */
const getQuarterMonths = (quarterKey) => {
  const [y, q] = quarterKey.split('-Q').map(Number);
  const startMonth = (q - 1) * 3;
  const months = [];
  for (let i = 0; i < 3; i++) {
    const monthIndex = startMonth + i;
    months.push({
      start: new Date(y, monthIndex, 1),
      end: new Date(y, monthIndex + 1, 0, 23, 59, 59),
      label: `${monthIndex + 1}月`
    });
  }
  return months;
};

// 週の区切りはWeeklyReportPage.jsと同じ「火曜始まり・月曜終わり」に揃える
const getWeekRange = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 5) % 7; // 火=0を基準にする
  const tuesday = new Date(d);
  tuesday.setDate(d.getDate() - diff);
  tuesday.setHours(0, 0, 0, 0);
  const monday = new Date(tuesday);
  monday.setDate(tuesday.getDate() + 6);
  monday.setHours(23, 59, 59, 999);
  return { start: tuesday, end: monday };
};

const formatMonthDay = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

/** 週の一意なID（週の始まり=火曜日の日付）。WeeklyReportPage.jsのgetWeekIdと同じ形式 */
const getWeekId = (date) => {
  const { start } = getWeekRange(date);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
};

/** 直近12週＋今週の選択肢を作る（WeeklyReportPage.jsと同じ考え方） */
const generateWeekOptions = () => {
  const options = [];
  const today = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i * 7);
    const { start, end } = getWeekRange(d);
    options.push({
      id: getWeekId(d),
      label: `${formatMonthDay(start)}〜${formatMonthDay(end)}${i === 0 ? '（今週）' : ''}`
    });
  }
  return options;
};

/** 指定した月の範囲を、月をまたがない形で火〜月の週に分割する */
const splitMonthIntoWeeks = (monthStart, monthEnd) => {
  const weeks = [];
  let cursor = new Date(monthStart);
  while (cursor <= monthEnd) {
    const { start: weekStart } = getWeekRange(cursor);
    const rangeStart = weekStart < monthStart ? monthStart : weekStart;
    const weekEndRaw = new Date(weekStart);
    weekEndRaw.setDate(weekStart.getDate() + 6);
    weekEndRaw.setHours(23, 59, 59, 999);
    const rangeEnd = weekEndRaw > monthEnd ? monthEnd : weekEndRaw;
    weeks.push({ start: rangeStart, end: rangeEnd, label: `${formatMonthDay(rangeStart)}〜${formatMonthDay(rangeEnd)}` });
    cursor = new Date(weekEndRaw);
    cursor.setDate(cursor.getDate() + 1);
  }
  return weeks;
};

/**
 * 荒幡さんの確定済み売上（フェーズ8）を全案件のsalesRecords/newCaseSalesRecordsから集める。
 * HomeDashboard.jsのfetchData/calculateStatsと同じデータ源・同じ判定基準（phase==='フェーズ8'）を使う
 */
const fetchRealizedRecords = async (repName) => {
  const dealsSnap = await getDocs(collection(db, 'progressDashboard'));
  const deals = dealsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.representative === repName);

  const records = [];
  await Promise.all(deals.map(async (deal) => {
    await Promise.all(['salesRecords', 'newCaseSalesRecords'].map(async (subCol) => {
      try {
        const recSnap = await getDocs(collection(db, 'progressDashboard', deal.id, subCol));
        recSnap.forEach((r) => {
          const rd = r.data();
          if (rd.phase !== 'フェーズ8') return;
          const dateStr = rd.confirmedDate || rd.date;
          if (!dateStr) return;
          records.push({
            dealId: deal.id,
            companyName: deal.companyName || deal.productName || '(社名未設定)',
            productName: deal.productName || '',
            recordType: rd.recordType,
            budget: typeof rd.budget === 'string' ? Number(rd.budget) || 0 : rd.budget || 0,
            date: new Date(dateStr)
          });
        });
      } catch (error) {
        // 権限やデータ不整合でこの案件だけ読めない場合はスキップ
      }
    }));
  }));
  return records;
};

/**
 * 案件配下のアクティブなネクストアクションのうち最新の1件を取得する。
 * 編集・完了操作に必要なrecordId/subColも一緒に返す（無ければnull）
 * ProgressDashboard.jsのfetchSalesInfoと同じデータ源を、この画面用に軽量化して再実装
 */
const fetchDealActiveNa = async (dealId, subCol) => {
  const recordsSnap = await getDocs(collection(db, 'progressDashboard', dealId, subCol));
  if (recordsSnap.empty) return null;

  let best = null;
  await Promise.all(recordsSnap.docs.map(async (recDoc) => {
    const entriesSnap = await getDocs(
      collection(db, 'progressDashboard', dealId, subCol, recDoc.id, 'entries')
    );
    entriesSnap.docs.forEach((entDoc) => {
      const data = entDoc.data();
      if (!data.actionContent || data.actionStatus === 'done') return;
      const createdMs = data.createdAt?.toMillis?.() || 0;
      if (!best || createdMs > best.createdMs) {
        best = { id: entDoc.id, recordId: recDoc.id, createdMs, ...data };
      }
    });
  }));
  return best;
};

// ============================================
// Styled Components
// ============================================

const PageContainer = styled.div`
  max-width: 1200px;
  margin: 0 auto;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.5rem;
`;

const Title = styled.h1`
  font-size: 1.4rem;
  color: #2c3e50;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const Controls = styled.div`
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
`;

const Select = styled.select`
  padding: 0.5rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.9rem;
`;

const TabButton = styled.button`
  padding: 0.5rem 1rem;
  border: 1px solid ${(props) => (props.$active ? '#3498db' : '#ddd')};
  background: ${(props) => (props.$active ? '#3498db' : 'white')};
  color: ${(props) => (props.$active ? 'white' : '#2c3e50')};
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
`;

const SummaryRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
  @media (max-width: 700px) { grid-template-columns: 1fr; }
`;

const SummaryCard = styled.div`
  background: white;
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 1rem 1.25rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
`;

const SummaryLabel = styled.div`
  font-size: 0.8rem;
  color: #7f8c8d;
  margin-bottom: 0.35rem;
`;

const SummaryValue = styled.div`
  font-size: 1.4rem;
  font-weight: 700;
  color: ${(props) => (props.$negative ? '#e74c3c' : '#2c3e50')};
`;

const SuggestBox = styled.div`
  background: #fff9e6;
  border: 1px solid #f1c40f;
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 1.5rem;
`;

const SuggestButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  background: #f39c12;
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  &:disabled { opacity: 0.6; cursor: default; }
`;

const SuggestText = styled.div`
  margin-top: 0.75rem;
  white-space: pre-wrap;
  font-size: 0.9rem;
  color: #2c3e50;
  line-height: 1.6;
`;

// 案件一覧はあくまで全体振り返りの補足という位置づけのため、1件1件を大きなカードに
// せず、1行にぎゅっとまとめたテーブル形式にする（状況メモは書かない案件があってもよい
// 前提で、普段は畳んでおき必要な時だけ開く）
const DealTableWrap = styled.div`
  display: flex;
  flex-direction: column;
`;

const DealRow = styled.div`
  display: grid;
  grid-template-columns: 1.3fr 90px 100px 56px 1.6fr 28px;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid #f0f0f0;
  font-size: 0.82rem;
  &:hover { background: #fafbfc; }
  @media (max-width: 860px) { grid-template-columns: 1fr; row-gap: 0.3rem; }
`;

const DealRowHeader = styled(DealRow)`
  font-weight: 600;
  color: #95a5a6;
  font-size: 0.72rem;
  border-bottom: 2px solid #eee;
  &:hover { background: none; }
  @media (max-width: 860px) { display: none; }
`;

const CompanyName = styled.div`
  font-weight: 600;
  color: #2c3e50;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PhaseBadge = styled.span`
  font-size: 0.68rem;
  font-weight: 600;
  color: white;
  background: ${(props) => STATUS_COLORS[props.$status] || '#95a5a6'};
  padding: 0.1rem 0.5rem;
  border-radius: 10px;
  white-space: nowrap;
  justify-self: start;
`;

const BudgetText = styled.div`
  color: #2c3e50;
  white-space: nowrap;
`;

const ProbabilityInput = styled.input`
  width: 44px;
  padding: 0.25rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
`;

const NaCell = styled.div`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
`;

const NaText = styled.span`
  color: #2c3e50;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
`;

const NaDue = styled.span`
  font-size: 0.72rem;
  color: #e67e22;
  white-space: nowrap;
`;

const NaPlaceholder = styled.span`
  color: #bbb;
`;

const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.2rem 0.4rem;
  border: 1px solid #ddd;
  background: white;
  border-radius: 4px;
  font-size: 0.72rem;
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: #f8f9fa; }
`;

const NoteToggleButton = styled.button`
  border: none;
  background: none;
  cursor: pointer;
  color: ${(props) => (props.$hasNote ? '#e67e22' : '#ccc')};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
`;

const ExpandedPanel = styled.div`
  grid-column: 1 / -1;
  padding: 0.5rem 0.5rem 0.7rem;
  background: #fafbfc;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const NaEditRow = styled.div`
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
`;

const NaInput = styled.input`
  flex: 1;
  min-width: 200px;
  padding: 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.82rem;
`;

const NoteTextarea = styled.textarea`
  width: 100%;
  min-height: 40px;
  padding: 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  font-family: inherit;
  resize: vertical;
`;

const EmptyText = styled.div`
  text-align: center;
  color: #999;
  padding: 2rem 0;
`;

const SectionCard = styled.div`
  background: white;
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
`;

const SectionTitle = styled.h2`
  font-size: 1rem;
  color: #2c3e50;
  margin: 0 0 0.9rem 0;
`;

const BarList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
`;

const BarRow = styled.div`
  display: grid;
  grid-template-columns: 90px 1fr 110px;
  align-items: center;
  gap: 0.75rem;
`;

const BarLabel = styled.div`
  font-size: 0.85rem;
  color: ${(props) => (props.$current ? '#2980b9' : '#2c3e50')};
  font-weight: ${(props) => (props.$current ? '700' : '400')};
`;

const BarTrack = styled.div`
  background: #f0f0f0;
  border-radius: 4px;
  height: 14px;
  overflow: hidden;
`;

const BarFill = styled.div`
  background: ${(props) => (props.$current ? '#2980b9' : '#95a5a6')};
  height: 100%;
  width: ${(props) => Math.min(100, props.$percent)}%;
`;

const BarValue = styled.div`
  font-size: 0.85rem;
  color: #2c3e50;
  text-align: right;
`;

const RecordTable = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
`;

const RecordRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.6rem;
  background: #f8f9fa;
  border-radius: 6px;
  font-size: 0.85rem;
`;

const RecordCompany = styled.div`
  flex: 1;
  color: #2c3e50;
  font-weight: 600;
`;

const RecordDate = styled.div`
  color: #7f8c8d;
  width: 70px;
`;

const RecordBudget = styled.div`
  color: #27ae60;
  font-weight: 700;
  width: 110px;
  text-align: right;
`;

// ============================================
// メインコンポーネント
// ============================================

function PipelineForecastPage() {
  const { options: quarterOptions, current: currentQuarterKey } = useMemo(() => generateQuarterOptions(), []);
  const weekOptions = useMemo(() => generateWeekOptions(), []);
  const [selectedQuarter, setSelectedQuarter] = useState(currentQuarterKey);
  const [selectedWeekId, setSelectedWeekId] = useState(() => getWeekId(new Date()));
  const [dealType, setDealType] = useState('new'); // 'new' | 'existing'
  const [deals, setDeals] = useState([]);
  const [target, setTarget] = useState(0);
  const [loading, setLoading] = useState(true);
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [naEditingId, setNaEditingId] = useState(null);
  const [naDraft, setNaDraft] = useState({ content: '', dueDate: '' });
  const [savingNa, setSavingNa] = useState(false);
  const [realizedRecords, setRealizedRecords] = useState([]);
  const [openNoteId, setOpenNoteId] = useState(null); // 状況メモは普段畳んでおき、開いた案件だけ編集欄を出す

  const toggleNote = (dealId) => {
    setOpenNoteId((prev) => (prev === dealId ? null : dealId));
  };

  const isExisting = dealType === 'existing';
  const subCol = isExisting ? 'salesRecords' : 'newCaseSalesRecords';
  const recordType = RECORD_TYPE_BY_DEAL_TYPE[dealType];
  const isCurrentQuarter = selectedQuarter === currentQuarterKey;

  const loadData = useCallback(async () => {
    setLoading(true);
    setAiSuggestion('');
    setAiError('');
    try {
      const snap = await getDocs(collection(db, 'progressDashboard'));
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const filtered = all.filter((d) =>
        d.representative === REP_NAME &&
        OPEN_PHASES.includes(d.status) &&
        Boolean(d.isExistingProject) === isExisting
      );

      const withNa = await Promise.all(filtered.map(async (d) => {
        const [na, weeklySnap] = await Promise.all([
          fetchDealActiveNa(d.id, subCol).catch(() => null),
          getDoc(doc(db, 'progressDashboard', d.id, 'weeklyForecasts', selectedWeekId)).catch(() => null)
        ]);
        const weekly = weeklySnap?.exists() ? weeklySnap.data() : null;
        return {
          ...d,
          landingProbability: weekly?.probability != null ? weekly.probability : (PHASE_PROBABILITY[d.status] || 0),
          landingStatusNote: weekly?.statusNote || '',
          na
        };
      }));
      setDeals(withNa);

      const targetDocId = isExisting ? `${selectedQuarter}-existing` : selectedQuarter;
      const targetSnap = await getDoc(doc(db, 'salesTargets', targetDocId));
      setTarget(targetSnap.exists() ? (targetSnap.data().target || 0) : 0);

      const records = await fetchRealizedRecords(REP_NAME);
      setRealizedRecords(records);
    } catch (error) {
      console.error('週次パイプライン取得エラー:', error);
    } finally {
      setLoading(false);
    }
  }, [isExisting, subCol, selectedQuarter, selectedWeekId]);

  useEffect(() => { loadData(); }, [loadData]);

  // 選択中の新規/既存に対応する実績レコードだけに絞る
  const recordsForType = useMemo(() => (
    realizedRecords.filter((r) => r.recordType === recordType)
  ), [realizedRecords, recordType]);

  const quarterRangeForSelected = useMemo(() => {
    const [y, q] = selectedQuarter.split('-Q').map(Number);
    const startMonth = (q - 1) * 3;
    return { start: new Date(y, startMonth, 1), end: new Date(y, startMonth + 3, 0, 23, 59, 59) };
  }, [selectedQuarter]);

  const quarterActualTotal = useMemo(() => (
    recordsForType
      .filter((r) => r.date >= quarterRangeForSelected.start && r.date <= quarterRangeForSelected.end)
      .reduce((sum, r) => sum + r.budget, 0)
  ), [recordsForType, quarterRangeForSelected]);

  // 保有中の案件（想定予算×着地確率）の見込み。まだ確定していない分の予想
  const pipelineForecast = useMemo(() => (
    deals.reduce((sum, d) => sum + (d.expectedBudget || 0) * (d.landingProbability || 0) / 100, 0)
  ), [deals]);

  // 着地予想額 = 今期すでに確定した実績 ＋ 保有中案件の見込み
  const landingForecastTotal = quarterActualTotal + pipelineForecast;
  const gap = target - landingForecastTotal;
  const avgBudget = deals.length > 0
    ? deals.reduce((sum, d) => sum + (d.expectedBudget || 0), 0) / deals.length
    : 0;

  // 今の四半期を見ている時だけ、月別・週別の内訳と「今週の実績」を表示する
  const monthlyBreakdown = useMemo(() => {
    if (!isCurrentQuarter) return [];
    return getQuarterMonths(selectedQuarter).map((m) => ({
      ...m,
      total: recordsForType
        .filter((r) => r.date >= m.start && r.date <= m.end)
        .reduce((sum, r) => sum + r.budget, 0)
    }));
  }, [isCurrentQuarter, selectedQuarter, recordsForType]);

  const currentMonthInfo = useMemo(() => {
    const now = new Date();
    return monthlyBreakdown.find((m) => now >= m.start && now <= m.end) || null;
  }, [monthlyBreakdown]);

  const weeklyBreakdown = useMemo(() => {
    if (!currentMonthInfo) return [];
    const weeks = splitMonthIntoWeeks(currentMonthInfo.start, currentMonthInfo.end);
    const now = new Date();
    return weeks.map((w) => ({
      ...w,
      isCurrent: now >= w.start && now <= w.end,
      total: recordsForType
        .filter((r) => r.date >= w.start && r.date <= w.end)
        .reduce((sum, r) => sum + r.budget, 0)
    }));
  }, [currentMonthInfo, recordsForType]);

  const thisWeekRecords = useMemo(() => {
    if (!isCurrentQuarter) return [];
    const { start, end } = getWeekRange(new Date());
    return recordsForType
      .filter((r) => r.date >= start && r.date <= end)
      .sort((a, b) => b.date - a.date);
  }, [isCurrentQuarter, recordsForType]);

  const handleProbabilityInput = (dealId, value) => {
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, landingProbability: value } : d)));
  };

  const handleProbabilityBlur = async (dealId, value) => {
    const num = Math.max(0, Math.min(100, Number(value) || 0));
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, landingProbability: num } : d)));
    try {
      await setDoc(doc(db, 'progressDashboard', dealId, 'weeklyForecasts', selectedWeekId), {
        probability: num
      }, { merge: true });
    } catch (error) {
      console.error('着地確率の保存に失敗:', error);
    }
  };

  const handleNoteChange = (dealId, value) => {
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, landingStatusNote: value } : d)));
  };

  const handleNoteBlur = async (dealId, value) => {
    try {
      await setDoc(doc(db, 'progressDashboard', dealId, 'weeklyForecasts', selectedWeekId), {
        statusNote: value
      }, { merge: true });
    } catch (error) {
      console.error('状況メモの保存に失敗:', error);
    }
  };

  const beginNaEdit = (deal) => {
    setNaEditingId(deal.id);
    setNaDraft({
      content: deal.na?.actionContent || '',
      dueDate: deal.na?.actionDueDate || ''
    });
  };

  const cancelNaEdit = () => setNaEditingId(null);

  const saveNa = async (deal) => {
    if (!naDraft.content.trim()) return;
    setSavingNa(true);
    try {
      if (deal.na) {
        await updateSalesEntry(deal.id, deal.na.recordId, deal.na.id, {
          actionContent: naDraft.content.trim(),
          actionDueDate: naDraft.dueDate || null
        }, subCol);
      } else {
        const recordsSnap = await getDocs(collection(db, 'progressDashboard', deal.id, subCol));
        if (recordsSnap.empty) {
          window.alert('この案件には営業記録がまだ無いため、案件詳細画面から先に記録を作成してください');
          setSavingNa(false);
          return;
        }
        const records = recordsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        records.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        await addSalesEntry(deal.id, records[0].id, {
          actionContent: naDraft.content.trim(),
          actionDueDate: naDraft.dueDate || null,
          actionAssignee: REP_NAME,
          actionStatus: 'active'
        }, subCol);
      }
      setNaEditingId(null);
      await loadData();
    } catch (error) {
      console.error('ネクストアクションの保存に失敗:', error);
      window.alert('保存に失敗しました');
    } finally {
      setSavingNa(false);
    }
  };

  const completeNa = async (deal) => {
    if (!deal.na) return;
    if (!window.confirm('このネクストアクションを完了にしますか？')) return;
    try {
      await updateSalesEntryStatus(deal.id, deal.na.recordId, deal.na.id, 'done', subCol);
      await loadData();
    } catch (error) {
      console.error('ネクストアクションの完了処理に失敗:', error);
      window.alert('処理に失敗しました');
    }
  };

  const handleSuggest = async () => {
    setAiLoading(true);
    setAiSuggestion('');
    setAiError('');
    const result = await suggestGapClosingActions({
      dealType: isExisting ? '既存' : '新規',
      gapAmount: gap,
      avgDealBudget: avgBudget,
      dealCount: deals.length
    });
    setAiLoading(false);
    if (result.error) {
      setAiError(result.error);
    } else {
      setAiSuggestion(result.suggestion);
    }
  };

  return (
    <PageContainer>
      <Header>
        <Title><FiTarget /> 荒幡さんの週次パイプライン振り返り</Title>
        <Controls>
          <Select value={selectedQuarter} onChange={(e) => setSelectedQuarter(e.target.value)}>
            {quarterOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
          <Select value={selectedWeekId} onChange={(e) => setSelectedWeekId(e.target.value)}>
            {weekOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </Select>
          <TabButton $active={dealType === 'new'} onClick={() => setDealType('new')}>新規</TabButton>
          <TabButton $active={dealType === 'existing'} onClick={() => setDealType('existing')}>既存</TabButton>
        </Controls>
      </Header>

      {loading ? (
        <EmptyText>読み込み中...</EmptyText>
      ) : (
        <>
          <SummaryRow>
            <SummaryCard>
              <SummaryLabel>目標額（{isExisting ? '既存' : '新規'}）</SummaryLabel>
              <SummaryValue>{formatCurrency(target)}</SummaryValue>
            </SummaryCard>
            <SummaryCard>
              <SummaryLabel>今期の確定済み実績</SummaryLabel>
              <SummaryValue>{formatCurrency(quarterActualTotal)}</SummaryValue>
            </SummaryCard>
            <SummaryCard>
              <SummaryLabel>着地予想額（確定済み実績＋保有案件の見込み）</SummaryLabel>
              <SummaryValue>{formatCurrency(landingForecastTotal)}</SummaryValue>
            </SummaryCard>
          </SummaryRow>
          <SummaryRow style={{ gridTemplateColumns: '1fr' }}>
            <SummaryCard>
              <SummaryLabel>{gap > 0 ? '不足額' : '超過見込み'}</SummaryLabel>
              <SummaryValue $negative={gap > 0}>{formatCurrency(Math.abs(gap))}</SummaryValue>
            </SummaryCard>
          </SummaryRow>

          {isCurrentQuarter && (
            <SectionCard>
              <SectionTitle>月別の実績（{selectedQuarter.split('-Q')[0]}年 Q{selectedQuarter.split('-Q')[1]}）</SectionTitle>
              <BarList>
                {monthlyBreakdown.map((m) => {
                  const percent = monthlyBreakdown.length > 0
                    ? (m.total / Math.max(1, Math.max(...monthlyBreakdown.map((x) => x.total)))) * 100
                    : 0;
                  const isCurrent = currentMonthInfo && m.label === currentMonthInfo.label;
                  return (
                    <BarRow key={m.label}>
                      <BarLabel $current={isCurrent}>{m.label}{isCurrent ? '（今月）' : ''}</BarLabel>
                      <BarTrack><BarFill $current={isCurrent} $percent={percent} /></BarTrack>
                      <BarValue>{formatCurrency(m.total)}</BarValue>
                    </BarRow>
                  );
                })}
              </BarList>
            </SectionCard>
          )}

          {isCurrentQuarter && weeklyBreakdown.length > 0 && (
            <SectionCard>
              <SectionTitle>{currentMonthInfo?.label}の週別実績</SectionTitle>
              <BarList>
                {weeklyBreakdown.map((w) => {
                  const maxVal = Math.max(1, ...weeklyBreakdown.map((x) => x.total));
                  return (
                    <BarRow key={w.label}>
                      <BarLabel $current={w.isCurrent}>{w.label}{w.isCurrent ? '（今週）' : ''}</BarLabel>
                      <BarTrack><BarFill $current={w.isCurrent} $percent={(w.total / maxVal) * 100} /></BarTrack>
                      <BarValue>{formatCurrency(w.total)}</BarValue>
                    </BarRow>
                  );
                })}
              </BarList>
            </SectionCard>
          )}

          {isCurrentQuarter && (
            <SectionCard>
              <SectionTitle>今週確定した案件</SectionTitle>
              {thisWeekRecords.length === 0 ? (
                <EmptyText>今週はまだ確定した案件がありません</EmptyText>
              ) : (
                <RecordTable>
                  {thisWeekRecords.map((r, i) => (
                    <RecordRow key={`${r.dealId}_${i}`}>
                      <RecordCompany>{r.companyName}{r.productName ? `（${r.productName}）` : ''}</RecordCompany>
                      <RecordDate>{formatMonthDay(r.date)}</RecordDate>
                      <RecordBudget>{formatCurrency(r.budget)}</RecordBudget>
                    </RecordRow>
                  ))}
                </RecordTable>
              )}
            </SectionCard>
          )}

          {gap > 0 && (
            <SuggestBox>
              <SuggestButton onClick={handleSuggest} disabled={aiLoading || !isGPTServiceAvailable()}>
                <FiRefreshCw /> {aiLoading ? '考え中...' : '不足を埋める提案をAIに考えさせる'}
              </SuggestButton>
              {!isGPTServiceAvailable() && (
                <SuggestText>OpenAIのAPIキーが未設定のため、この機能は使えません。</SuggestText>
              )}
              {aiError && <SuggestText>提案の取得に失敗しました: {aiError}</SuggestText>}
              {aiSuggestion && <SuggestText>{aiSuggestion}</SuggestText>}
            </SuggestBox>
          )}

          {deals.length === 0 ? (
            <EmptyText>対象の案件はありません</EmptyText>
          ) : (
            <SectionCard>
              <SectionTitle>
                保有中の案件（全体振り返りの補足。メモは書かなくてもよい）
                　{weekOptions.find((w) => w.id === selectedWeekId)?.label}の記入内容
              </SectionTitle>
              <DealTableWrap>
                <DealRowHeader>
                  <div>会社名</div>
                  <div>フェーズ</div>
                  <div>想定予算</div>
                  <div>確率</div>
                  <div>ネクストアクション</div>
                  <div>メモ</div>
                </DealRowHeader>
                {deals.map((deal) => (
                  <React.Fragment key={deal.id}>
                    <DealRow>
                      <CompanyName title={deal.companyName || deal.productName || ''}>
                        {deal.companyName || deal.productName || '(社名未設定)'}
                      </CompanyName>
                      <PhaseBadge $status={deal.status} title={PHASE_DESCRIPTIONS[deal.status] || ''}>
                        {deal.status}
                      </PhaseBadge>
                      <BudgetText>{formatCurrency(deal.expectedBudget)}</BudgetText>
                      <div>
                        <ProbabilityInput
                          type="number"
                          min="0"
                          max="100"
                          value={deal.landingProbability}
                          onChange={(e) => handleProbabilityInput(deal.id, e.target.value)}
                          onBlur={(e) => handleProbabilityBlur(deal.id, e.target.value)}
                        />%
                      </div>
                      <NaCell>
                        {deal.na ? (
                          <>
                            <NaText title={deal.na.actionContent}>{deal.na.actionContent}</NaText>
                            {deal.na.actionDueDate && <NaDue>〜{deal.na.actionDueDate}</NaDue>}
                            <IconButton onClick={() => beginNaEdit(deal)}><FiEdit3 /></IconButton>
                            <IconButton onClick={() => completeNa(deal)}><FiCheck /></IconButton>
                          </>
                        ) : (
                          <>
                            <NaPlaceholder>未設定</NaPlaceholder>
                            <IconButton onClick={() => beginNaEdit(deal)}><FiPlus /></IconButton>
                          </>
                        )}
                      </NaCell>
                      <NoteToggleButton
                        $hasNote={!!deal.landingStatusNote}
                        onClick={() => toggleNote(deal.id)}
                        title={deal.landingStatusNote || 'メモを書く（任意）'}
                      >
                        <FiFileText size={14} />
                      </NoteToggleButton>
                    </DealRow>

                    {naEditingId === deal.id && (
                      <ExpandedPanel>
                        <NaEditRow>
                          <NaInput
                            placeholder="ネクストアクションの内容"
                            value={naDraft.content}
                            onChange={(e) => setNaDraft((prev) => ({ ...prev, content: e.target.value }))}
                            autoFocus
                          />
                          <NaInput
                            type="date"
                            style={{ flex: 'none', minWidth: '140px' }}
                            value={naDraft.dueDate}
                            onChange={(e) => setNaDraft((prev) => ({ ...prev, dueDate: e.target.value }))}
                          />
                          <IconButton onClick={() => saveNa(deal)} disabled={savingNa || !naDraft.content.trim()}>
                            <FiCheck /> 保存
                          </IconButton>
                          <IconButton onClick={cancelNaEdit} disabled={savingNa}>
                            <FiX /> キャンセル
                          </IconButton>
                        </NaEditRow>
                      </ExpandedPanel>
                    )}

                    {openNoteId === deal.id && (
                      <ExpandedPanel>
                        <NoteTextarea
                          value={deal.landingStatusNote}
                          onChange={(e) => handleNoteChange(deal.id, e.target.value)}
                          onBlur={(e) => handleNoteBlur(deal.id, e.target.value)}
                          placeholder="今の状況、懸念点、直近の動きなど（任意。書かなくてもよい）"
                          autoFocus
                        />
                      </ExpandedPanel>
                    )}
                  </React.Fragment>
                ))}
              </DealTableWrap>
            </SectionCard>
          )}
        </>
      )}
    </PageContainer>
  );
}

export default PipelineForecastPage;
