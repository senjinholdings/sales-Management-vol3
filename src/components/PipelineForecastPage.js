import React, { useState, useEffect, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { FiEdit3, FiPlus, FiCheck, FiX, FiRefreshCw, FiTarget, FiFileText, FiArchive, FiRotateCcw, FiChevronDown, FiChevronUp, FiCalendar } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { STATUS_COLORS, PHASE_DESCRIPTIONS } from '../data/constants.js';
import { addSalesEntry, updateSalesEntry, updateSalesEntryStatus } from '../services/projectService.js';
import { suggestGapClosingActions, isGPTServiceAvailable } from '../services/gptService.js';

// 日報（デイリータイマー）等と同様、現状は荒幡さんのみが対象の専用画面
// progressDashboardのrepresentativeは実データ上「荒幡」（姓のみ）で保存されている
// （SALES_REPRESENTATIVES定数の「荒幡 輝」とは表記が異なるので注意）
const REP_NAME = '荒幡';

// 受注済み(フェーズ8)・Dead・失注は対象外。それ以外の進行中フェーズだけを一覧に出す
const OPEN_PHASES = ['フェーズ1', 'フェーズ2', 'フェーズ3', 'フェーズ4', 'フェーズ5', 'フェーズ6', 'フェーズ7'];

// 荒幡さん個人の四半期合計目標（新規＋既存の合算）。salesTargetsコレクションは
// チーム全体（ソリューション営業の新規・既存、アカウント営業）の目標であり、担当者個人の
// 目標という概念が無いため別に定数として持つ。四半期が変わったら手動で更新する
const REP_QUARTERLY_TARGET = 100_000_000;

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

// 週の区切りは「月曜始まり・日曜終わり」。実際の振り返りは金曜16時に行われる運用に合わせる
const getWeekRange = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7; // 月=0を基準にする
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
};

const formatMonthDay = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

/** "YYYY-MM-DD" を年無し・区切り記号無しの "M/D" にする（NA期限などの表示用） */
const formatDueDateShort = (dateStr) => {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
};

/** 週の一意なID（週の始まり=月曜日の日付） */
const getWeekId = (date) => {
  const { start } = getWeekRange(date);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
};

/** 直近12週＋今週＋来週の選択肢を作る（来週のページは常に用意しておき、事前に見られるようにする） */
const generateWeekOptions = () => {
  const options = [];
  const today = new Date();
  for (let i = -1; i < 13; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i * 7);
    const { start } = getWeekRange(d);
    options.push({
      id: getWeekId(d),
      label: `${formatMonthDay(start)}週${i === 0 ? '（今週）' : i === -1 ? '（来週）' : ''}`
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
 * 荒幡さんの確定済み売上（フェーズ8）を全案件から集める。
 * 案件ごとに今のisExistingProjectに対応する片方のサブコレクションだけを見る
 * （ClosedDealsList.js・HomeDashboard.jsと同じ判定基準）。
 * 新規→既存への切り替え時、切り替え前のnewCaseSalesRecords側にフェーズ8レコードが
 * 残ったまま新しくsalesRecords側にも作られるケースがあり、両方を見ると二重計上になるため
 */
const fetchRealizedRecords = async (repName) => {
  const dealsSnap = await getDocs(collection(db, 'progressDashboard'));
  const deals = dealsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.representative === repName);

  const records = [];
  await Promise.all(deals.map(async (deal) => {
    const subCol = deal.isExistingProject === true ? 'salesRecords' : 'newCaseSalesRecords';
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
  grid-template-columns: 1.3fr 90px 100px 64px 1.2fr 28px 28px 28px;
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
  width: 40px;
  padding: 0.25rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
`;

const ProbabilityCell = styled.div`
  display: flex;
  align-items: center;
  gap: 0.15rem;
  white-space: nowrap;
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
  cursor: pointer;
  border-radius: 4px;
  padding: 0.15rem 0.3rem;
  margin: -0.15rem -0.3rem;

  &:hover {
    background: #f5f6f7;
  }
`;

const BarLabel = styled.div`
  font-size: 0.85rem;
  color: ${(props) => (props.$current ? '#2980b9' : '#2c3e50')};
  font-weight: ${(props) => (props.$current ? '700' : '400')};
  display: flex;
  align-items: center;
  gap: 0.3rem;
`;

const BarChevron = styled.span`
  font-size: 0.7rem;
  color: #95a5a6;
  display: inline-block;
`;

const BarBreakdown = styled.div`
  margin: 0.3rem 0 0.4rem;
  padding-left: 0.3rem;
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

// ---- 四半期合計進捗（新規＋既存の合算）----
const ForecastBlock = styled.div`
  & + & { margin-top: 0.9rem; }
`;

const ForecastRow = styled.div`
  display: grid;
  grid-template-columns: 100px 1fr 180px;
  align-items: center;
  gap: 0.75rem;
`;

const ForecastBreakdown = styled.div`
  margin: 0.3rem 0 0 100px;
  font-size: 0.8rem;
  color: #7f8c8d;
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

const NewBadge = styled.span`
  font-size: 0.65rem;
  font-weight: 700;
  color: white;
  background: #e74c3c;
  padding: 0.05rem 0.35rem;
  border-radius: 3px;
  margin-left: 0.4rem;
  vertical-align: middle;
`;

const DealNameWrap = styled.div`
  min-width: 0;
`;

const DealNamePrimary = styled.div`
  font-weight: 600;
  color: #2c3e50;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DealNameSecondary = styled.div`
  font-size: 0.7rem;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PredictedSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const PredictedRow = styled.div`
  display: grid;
  grid-template-columns: 1.5fr 90px 1fr 90px;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.6rem;
  background: #f8f9fa;
  border-radius: 6px;
  font-size: 0.85rem;
`;

const WonBadge = styled.span`
  font-size: 0.75rem;
  font-weight: 700;
  color: white;
  background: #27ae60;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  white-space: nowrap;
`;

const MissedInput = styled.input`
  width: 100%;
  padding: 0.35rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
`;

const ExcludedToggleHeader = styled.button`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  background: #f8f9fa;
  border: 1px solid #eee;
  border-radius: 8px;
  color: #7f8c8d;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  margin-top: 0.5rem;
  &:hover { background: #f0f0f0; }
`;

const ExcludedRow = styled.div`
  display: grid;
  grid-template-columns: 1.3fr 90px 100px 1fr 28px;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid #f0f0f0;
  font-size: 0.82rem;
  color: #999;
`;

/** 商品名をメインに、会社名はその下に小さく「」つきで表示する（会社名の方が主役ではない） */
function DealNameCell({ companyName, productName, isNew }) {
  return (
    <DealNameWrap>
      <DealNamePrimary title={productName || companyName || ''}>
        {productName || companyName || '(商品未設定)'}
        {isNew && <NewBadge>NEW</NewBadge>}
      </DealNamePrimary>
      {companyName && productName && (
        <DealNameSecondary title={companyName}>「{companyName}」</DealNameSecondary>
      )}
    </DealNameWrap>
  );
}

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
  const [excludedOpen, setExcludedOpen] = useState(false); // 「今期対象外」は普段畳んでおく
  const [predictedDeals, setPredictedDeals] = useState([]); // 表示中の週に「成約予定」とマークされていた案件
  const [expandedMonths, setExpandedMonths] = useState(() => new Set());
  const [expandedWeeks, setExpandedWeeks] = useState(() => new Set());

  const toggleExpandedMonth = (label) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  const toggleExpandedWeek = (label) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  const toggleNote = (dealId) => {
    setOpenNoteId((prev) => (prev === dealId ? null : dealId));
  };

  const isExisting = dealType === 'existing';
  const subCol = isExisting ? 'salesRecords' : 'newCaseSalesRecords';
  const recordType = RECORD_TYPE_BY_DEAL_TYPE[dealType];
  const isCurrentQuarter = selectedQuarter === currentQuarterKey;

  // 「今期対象外」にした案件は下の畳んだ一覧にまとめ、着地予想からも除く（あとで対象に戻せる）
  // 保有中の案件はフェーズが大きい方（成約に近い方）から並べる
  const activeDeals = useMemo(() => (
    deals
      .filter((d) => !d.excludedFromForecast)
      .sort((a, b) => OPEN_PHASES.indexOf(b.status) - OPEN_PHASES.indexOf(a.status))
  ), [deals]);
  const excludedDeals = useMemo(() => deals.filter((d) => d.excludedFromForecast), [deals]);

  const toggleExcluded = async (dealId, excluded) => {
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, excludedFromForecast: excluded } : d)));
    try {
      await updateDoc(doc(db, 'progressDashboard', dealId), { excludedFromForecast: excluded });
    } catch (error) {
      console.error('今期対象外フラグの保存に失敗:', error);
    }
  };

  // 選択中の週に新規登録された案件は「NEW」表示にする
  const selectedWeekRange = useMemo(() => {
    const [y, m, d] = selectedWeekId.split('-').map(Number);
    return getWeekRange(new Date(y, m - 1, d));
  }, [selectedWeekId]);

  const isNewDeal = (deal) => {
    const ms = deal.createdAt?.toMillis?.();
    if (!ms) return false;
    return ms >= selectedWeekRange.start.getTime() && ms <= selectedWeekRange.end.getTime();
  };

  // 「来週の成約予定にする」は常に、表示中の週の次の週に対して立てる
  const nextWeekId = useMemo(() => (
    getWeekId(new Date(selectedWeekRange.start.getTime() + 7 * 24 * 60 * 60 * 1000))
  ), [selectedWeekRange]);

  const togglePredicted = async (dealId, predicted) => {
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, predictedNextWeek: predicted } : d)));
    try {
      await setDoc(doc(db, 'progressDashboard', dealId, 'weeklyForecasts', nextWeekId), {
        predictedToClose: predicted
      }, { merge: true });
    } catch (error) {
      console.error('来週の成約予定フラグの保存に失敗:', error);
    }
  };

  const handleMissedReasonBlur = async (dealId, value) => {
    setPredictedDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, missedReason: value } : d)));
    try {
      await setDoc(doc(db, 'progressDashboard', dealId, 'weeklyForecasts', selectedWeekId), {
        missedReason: value
      }, { merge: true });
    } catch (error) {
      console.error('成約しなかった理由の保存に失敗:', error);
    }
  };

  // 表示中の週（selectedWeekId）に立っている「成約予定」フラグ自体を外す
  // （togglePredictedは常に「次の週」に対して立てる用途なので、これとは別にする）
  const handleRemovePrediction = async (dealId) => {
    setPredictedDeals((prev) => prev.filter((d) => d.id !== dealId));
    try {
      await setDoc(doc(db, 'progressDashboard', dealId, 'weeklyForecasts', selectedWeekId), {
        predictedToClose: false
      }, { merge: true });
    } catch (error) {
      console.error('成約予定フラグの解除に失敗:', error);
    }
  };

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
        const [na, weeklySnap, nextWeeklySnap] = await Promise.all([
          fetchDealActiveNa(d.id, subCol).catch(() => null),
          getDoc(doc(db, 'progressDashboard', d.id, 'weeklyForecasts', selectedWeekId)).catch(() => null),
          getDoc(doc(db, 'progressDashboard', d.id, 'weeklyForecasts', nextWeekId)).catch(() => null)
        ]);
        const weekly = weeklySnap?.exists() ? weeklySnap.data() : null;
        return {
          ...d,
          landingProbability: weekly?.probability != null ? weekly.probability : (PHASE_PROBABILITY[d.status] || 0),
          landingStatusNote: weekly?.statusNote || '',
          predictedNextWeek: !!nextWeeklySnap?.data()?.predictedToClose,
          na
        };
      }));
      setDeals(withNa);

      const targetDocId = isExisting ? `${selectedQuarter}-existing` : selectedQuarter;
      const targetSnap = await getDoc(doc(db, 'salesTargets', targetDocId));
      setTarget(targetSnap.exists() ? (targetSnap.data().target || 0) : 0);

      const records = await fetchRealizedRecords(REP_NAME);
      setRealizedRecords(records);

      // 表示中の週に「成約予定」とマークされていた案件（フェーズを問わず全案件から探す）
      const allRepDeals = all.filter((d) => d.representative === REP_NAME);
      const predicted = await Promise.all(allRepDeals.map(async (d) => {
        const weeklySnap = await getDoc(doc(db, 'progressDashboard', d.id, 'weeklyForecasts', selectedWeekId)).catch(() => null);
        const weekly = weeklySnap?.exists() ? weeklySnap.data() : null;
        if (!weekly?.predictedToClose) return null;
        return { ...d, missedReason: weekly.missedReason || '' };
      }));
      setPredictedDeals(predicted.filter(Boolean));
    } catch (error) {
      console.error('週次パイプライン取得エラー:', error);
    } finally {
      setLoading(false);
    }
  }, [isExisting, subCol, selectedQuarter, selectedWeekId, nextWeekId]);

  useEffect(() => { loadData(); }, [loadData]);

  // 新規/既存タブの選択に関係なく、荒幡さんの保有中案件（両方の区分）の見込みを合算するための
  // 独立したフェッチ。loadData（794〜850行目付近）の「案件ごとにweeklyForecastsから着地確率を
  // 取得し、無ければフェーズ既定値を使う」というロジックと同じ考え方で、新規・既存の両方を対象にする
  const [combinedForecasts, setCombinedForecasts] = useState([]); // [{isExistingProject, value}]
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'progressDashboard'));
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const repOpenDeals = all.filter((d) =>
          d.representative === REP_NAME && OPEN_PHASES.includes(d.status) && !d.excludedFromForecast
        );
        const forecasts = await Promise.all(repOpenDeals.map(async (d) => {
          const weeklySnap = await getDoc(doc(db, 'progressDashboard', d.id, 'weeklyForecasts', selectedWeekId)).catch(() => null);
          const weekly = weeklySnap?.exists() ? weeklySnap.data() : null;
          const probability = weekly?.probability != null ? weekly.probability : (PHASE_PROBABILITY[d.status] || 0);
          return { isExistingProject: !!d.isExistingProject, value: (d.expectedBudget || 0) * probability / 100 };
        }));
        if (!cancelled) setCombinedForecasts(forecasts);
      } catch (error) {
        console.error('四半期合計進捗の見込み取得エラー:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedWeekId]);

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

  // 保有中の案件（想定予算×着地確率）の見込み。「今期対象外」にした案件は含めない
  const pipelineForecast = useMemo(() => (
    activeDeals.reduce((sum, d) => sum + (d.expectedBudget || 0) * (d.landingProbability || 0) / 100, 0)
  ), [activeDeals]);

  // 着地予想額 = 今期すでに確定した実績 ＋ 保有中案件の見込み
  const landingForecastTotal = quarterActualTotal + pipelineForecast;
  const gap = target - landingForecastTotal;
  const avgBudget = activeDeals.length > 0
    ? activeDeals.reduce((sum, d) => sum + (d.expectedBudget || 0), 0) / activeDeals.length
    : 0;

  // ---- 四半期合計進捗（新規＋既存の合算、荒幡さん個人の目標に対して）----
  // 確定実績は新規/既存タブに関係なく全件（realizedRecords）を今期の範囲で合算する
  const combinedQuarterActualTotal = useMemo(() => (
    realizedRecords
      .filter((r) => r.date >= quarterRangeForSelected.start && r.date <= quarterRangeForSelected.end)
      .reduce((sum, r) => sum + r.budget, 0)
  ), [realizedRecords, quarterRangeForSelected]);
  const combinedQuarterActualNew = useMemo(() => (
    realizedRecords
      .filter((r) => r.recordType === '新規' && r.date >= quarterRangeForSelected.start && r.date <= quarterRangeForSelected.end)
      .reduce((sum, r) => sum + r.budget, 0)
  ), [realizedRecords, quarterRangeForSelected]);
  const combinedQuarterActualExisting = combinedQuarterActualTotal - combinedQuarterActualNew;

  const combinedPipelineForecastTotal = useMemo(() => (
    combinedForecasts.reduce((sum, f) => sum + f.value, 0)
  ), [combinedForecasts]);
  const combinedPipelineForecastNew = useMemo(() => (
    combinedForecasts.filter((f) => !f.isExistingProject).reduce((sum, f) => sum + f.value, 0)
  ), [combinedForecasts]);
  const combinedPipelineForecastExisting = combinedPipelineForecastTotal - combinedPipelineForecastNew;

  const combinedLandingTotal = combinedQuarterActualTotal + combinedPipelineForecastTotal;
  const combinedActualPercent = REP_QUARTERLY_TARGET > 0 ? (combinedQuarterActualTotal / REP_QUARTERLY_TARGET) * 100 : 0;
  const combinedLandingPercent = REP_QUARTERLY_TARGET > 0 ? (combinedLandingTotal / REP_QUARTERLY_TARGET) * 100 : 0;

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
      dealCount: activeDeals.length
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

      <SectionCard>
        <SectionTitle>荒幡さんの四半期合計進捗（新規＋既存、目標 {formatCurrency(REP_QUARTERLY_TARGET)}）</SectionTitle>
        <ForecastBlock>
          <ForecastRow>
            <BarLabel>確定実績</BarLabel>
            <BarTrack>
              <BarFill $current $percent={combinedActualPercent} />
            </BarTrack>
            <BarValue>{formatCurrency(combinedQuarterActualTotal)}（{Math.round(combinedActualPercent)}%）</BarValue>
          </ForecastRow>
          <ForecastBreakdown>
            新規 {formatCurrency(combinedQuarterActualNew)} / 既存 {formatCurrency(combinedQuarterActualExisting)}
          </ForecastBreakdown>
        </ForecastBlock>
        {isCurrentQuarter && (
          <ForecastBlock>
            <ForecastRow>
              <BarLabel>見込み込み</BarLabel>
              <BarTrack>
                <BarFill $percent={combinedLandingPercent} />
              </BarTrack>
              <BarValue>{formatCurrency(combinedLandingTotal)}（{Math.round(combinedLandingPercent)}%）</BarValue>
            </ForecastRow>
            <ForecastBreakdown>
              新規 {formatCurrency(combinedQuarterActualNew + combinedPipelineForecastNew)} /
              既存 {formatCurrency(combinedQuarterActualExisting + combinedPipelineForecastExisting)}
            </ForecastBreakdown>
          </ForecastBlock>
        )}
      </SectionCard>

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
                  const isOpen = expandedMonths.has(m.label);
                  const records = recordsForType
                    .filter((r) => r.date >= m.start && r.date <= m.end)
                    .sort((a, b) => b.date - a.date);
                  return (
                    <React.Fragment key={m.label}>
                      <BarRow onClick={() => toggleExpandedMonth(m.label)}>
                        <BarLabel $current={isCurrent}>
                          <BarChevron>{isOpen ? '▼' : '▶'}</BarChevron>
                          {m.label}{isCurrent ? '（今月）' : ''}
                        </BarLabel>
                        <BarTrack><BarFill $current={isCurrent} $percent={percent} /></BarTrack>
                        <BarValue>{formatCurrency(m.total)}</BarValue>
                      </BarRow>
                      {isOpen && (
                        <BarBreakdown>
                          {records.length === 0 ? (
                            <EmptyText>この期間に成約した案件はありません</EmptyText>
                          ) : (
                            <RecordTable>
                              {records.map((r, i) => (
                                <RecordRow key={`${r.dealId}_${i}`}>
                                  <RecordCompany>
                                    <DealNameCell companyName={r.companyName} productName={r.productName} />
                                  </RecordCompany>
                                  <RecordDate>{formatMonthDay(r.date)}</RecordDate>
                                  <RecordBudget>{formatCurrency(r.budget)}</RecordBudget>
                                </RecordRow>
                              ))}
                            </RecordTable>
                          )}
                        </BarBreakdown>
                      )}
                    </React.Fragment>
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
                  const isOpen = expandedWeeks.has(w.label);
                  const records = recordsForType
                    .filter((r) => r.date >= w.start && r.date <= w.end)
                    .sort((a, b) => b.date - a.date);
                  return (
                    <React.Fragment key={w.label}>
                      <BarRow onClick={() => toggleExpandedWeek(w.label)}>
                        <BarLabel $current={w.isCurrent}>
                          <BarChevron>{isOpen ? '▼' : '▶'}</BarChevron>
                          {w.label}{w.isCurrent ? '（今週）' : ''}
                        </BarLabel>
                        <BarTrack><BarFill $current={w.isCurrent} $percent={(w.total / maxVal) * 100} /></BarTrack>
                        <BarValue>{formatCurrency(w.total)}</BarValue>
                      </BarRow>
                      {isOpen && (
                        <BarBreakdown>
                          {records.length === 0 ? (
                            <EmptyText>この期間に成約した案件はありません</EmptyText>
                          ) : (
                            <RecordTable>
                              {records.map((r, i) => (
                                <RecordRow key={`${r.dealId}_${i}`}>
                                  <RecordCompany>
                                    <DealNameCell companyName={r.companyName} productName={r.productName} />
                                  </RecordCompany>
                                  <RecordDate>{formatMonthDay(r.date)}</RecordDate>
                                  <RecordBudget>{formatCurrency(r.budget)}</RecordBudget>
                                </RecordRow>
                              ))}
                            </RecordTable>
                          )}
                        </BarBreakdown>
                      )}
                    </React.Fragment>
                  );
                })}
              </BarList>
            </SectionCard>
          )}

          {predictedDeals.length > 0 && (
            <SectionCard>
              <SectionTitle>
                {weekOptions.find((w) => w.id === selectedWeekId)?.label}中に成約予定としていた案件（{predictedDeals.length}件）
              </SectionTitle>
              <PredictedSection>
                {predictedDeals.map((deal) => {
                  const won = recordsForType.some((r) =>
                    r.dealId === deal.id && r.date >= selectedWeekRange.start && r.date <= selectedWeekRange.end
                  );
                  return (
                    <PredictedRow key={deal.id}>
                      <DealNameCell companyName={deal.companyName} productName={deal.productName} />
                      <BudgetText>{formatCurrency(deal.expectedBudget)}</BudgetText>
                      {won ? (
                        <WonBadge>✅ 成約しました</WonBadge>
                      ) : (
                        <MissedInput
                          placeholder="成約しなかった理由"
                          defaultValue={deal.missedReason}
                          onBlur={(e) => handleMissedReasonBlur(deal.id, e.target.value)}
                        />
                      )}
                      {!won && (
                        <IconButton onClick={() => handleRemovePrediction(deal.id)} title="予定から外す">
                          <FiX /> 外す
                        </IconButton>
                      )}
                    </PredictedRow>
                  );
                })}
              </PredictedSection>
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
                      <RecordCompany>
                        <DealNameCell companyName={r.companyName} productName={r.productName} />
                      </RecordCompany>
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

          {activeDeals.length === 0 ? (
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
                  <div></div>
                  <div></div>
                </DealRowHeader>
                {activeDeals.map((deal) => (
                  <React.Fragment key={deal.id}>
                    <DealRow>
                      <DealNameCell
                        companyName={deal.companyName}
                        productName={deal.productName}
                        isNew={isNewDeal(deal)}
                      />
                      <PhaseBadge $status={deal.status} title={PHASE_DESCRIPTIONS[deal.status] || ''}>
                        {deal.status}
                      </PhaseBadge>
                      <BudgetText>{formatCurrency(deal.expectedBudget)}</BudgetText>
                      <ProbabilityCell>
                        <ProbabilityInput
                          type="number"
                          min="0"
                          max="100"
                          value={deal.landingProbability}
                          onChange={(e) => handleProbabilityInput(deal.id, e.target.value)}
                          onBlur={(e) => handleProbabilityBlur(deal.id, e.target.value)}
                        />%
                      </ProbabilityCell>
                      <NaCell>
                        {deal.na ? (
                          <>
                            <NaText title={deal.na.actionContent}>{deal.na.actionContent}</NaText>
                            {deal.na.actionDueDate && <NaDue>{formatDueDateShort(deal.na.actionDueDate)}</NaDue>}
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
                      <NoteToggleButton
                        onClick={() => toggleExcluded(deal.id, true)}
                        title="今期対象外にする"
                      >
                        <FiArchive size={14} />
                      </NoteToggleButton>
                      <NoteToggleButton
                        $hasNote={!!deal.predictedNextWeek}
                        onClick={() => togglePredicted(deal.id, !deal.predictedNextWeek)}
                        title={deal.predictedNextWeek ? '来週の成約予定（解除する）' : '来週の成約予定にする'}
                      >
                        <FiCalendar size={14} />
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

          {excludedDeals.length > 0 && (
            <SectionCard>
              <ExcludedToggleHeader onClick={() => setExcludedOpen((prev) => !prev)}>
                {excludedOpen ? <FiChevronUp /> : <FiChevronDown />}
                今期対象外にした案件（{excludedDeals.length}件）
              </ExcludedToggleHeader>
              {excludedOpen && (
                <DealTableWrap style={{ marginTop: '0.5rem' }}>
                  {excludedDeals.map((deal) => (
                    <ExcludedRow key={deal.id}>
                      <DealNameCell companyName={deal.companyName} productName={deal.productName} />
                      <PhaseBadge $status={deal.status} title={PHASE_DESCRIPTIONS[deal.status] || ''}>
                        {deal.status}
                      </PhaseBadge>
                      <BudgetText>{formatCurrency(deal.expectedBudget)}</BudgetText>
                      <div />
                      <IconButton onClick={() => toggleExcluded(deal.id, false)} title="対象に戻す">
                        <FiRotateCcw />
                      </IconButton>
                    </ExcludedRow>
                  ))}
                </DealTableWrap>
              )}
            </SectionCard>
          )}
        </>
      )}
    </PageContainer>
  );
}

export default PipelineForecastPage;
