import React, { useState, useEffect, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { FiEdit3, FiPlus, FiCheck, FiX, FiRefreshCw, FiTarget } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { STATUS_COLORS, PHASE_DESCRIPTIONS } from '../data/constants.js';
import { addSalesEntry, updateSalesEntry, updateSalesEntryStatus } from '../services/projectService.js';
import { suggestGapClosingActions, isGPTServiceAvailable } from '../services/gptService.js';

// 日報（デイリータイマー）等と同様、現状は荒幡さんのみが対象の専用画面
const REP_NAME = '荒幡 輝';

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

const DealCard = styled.div`
  background: white;
  border: 1px solid #eee;
  border-radius: 10px;
  padding: 1rem 1.25rem;
  margin-bottom: 0.75rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
`;

const DealHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.6rem;
`;

const CompanyName = styled.div`
  font-weight: 700;
  color: #2c3e50;
  font-size: 1rem;
`;

const PhaseBadge = styled.span`
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
  background: ${(props) => STATUS_COLORS[props.$status] || '#95a5a6'};
  padding: 0.15rem 0.6rem;
  border-radius: 10px;
`;

const BudgetText = styled.span`
  font-size: 0.9rem;
  color: #2c3e50;
  margin-left: auto;
`;

const FieldsGrid = styled.div`
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 0.6rem 1rem;
  align-items: start;
  @media (max-width: 600px) { grid-template-columns: 1fr; }
`;

const FieldLabel = styled.div`
  font-size: 0.8rem;
  color: #7f8c8d;
  padding-top: 0.4rem;
`;

const ProbabilityInput = styled.input`
  width: 70px;
  padding: 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.9rem;
`;

const NoteTextarea = styled.textarea`
  width: 100%;
  min-height: 50px;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85rem;
  font-family: inherit;
  resize: vertical;
`;

const NaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
`;

const NaText = styled.span`
  font-size: 0.9rem;
  color: #2c3e50;
`;

const NaDue = styled.span`
  font-size: 0.75rem;
  color: #e67e22;
`;

const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid #ddd;
  background: white;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  &:hover { background: #f8f9fa; }
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
  padding: 0.45rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85rem;
`;

const EmptyText = styled.div`
  text-align: center;
  color: #999;
  padding: 2rem 0;
`;

// ============================================
// メインコンポーネント
// ============================================

function PipelineForecastPage() {
  const { options: quarterOptions, current: currentQuarterKey } = useMemo(() => generateQuarterOptions(), []);
  const [selectedQuarter, setSelectedQuarter] = useState(currentQuarterKey);
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

  const isExisting = dealType === 'existing';
  const subCol = isExisting ? 'salesRecords' : 'newCaseSalesRecords';

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
        const na = await fetchDealActiveNa(d.id, subCol).catch(() => null);
        return {
          ...d,
          landingProbability: d.landingProbability != null ? d.landingProbability : (PHASE_PROBABILITY[d.status] || 0),
          landingStatusNote: d.landingStatusNote || '',
          na
        };
      }));
      setDeals(withNa);

      const targetDocId = isExisting ? `${selectedQuarter}-existing` : selectedQuarter;
      const targetSnap = await getDoc(doc(db, 'salesTargets', targetDocId));
      setTarget(targetSnap.exists() ? (targetSnap.data().target || 0) : 0);
    } catch (error) {
      console.error('週次パイプライン取得エラー:', error);
    } finally {
      setLoading(false);
    }
  }, [isExisting, subCol, selectedQuarter]);

  useEffect(() => { loadData(); }, [loadData]);

  const forecastTotal = useMemo(() => (
    deals.reduce((sum, d) => sum + (d.expectedBudget || 0) * (d.landingProbability || 0) / 100, 0)
  ), [deals]);
  const gap = target - forecastTotal;
  const avgBudget = deals.length > 0
    ? deals.reduce((sum, d) => sum + (d.expectedBudget || 0), 0) / deals.length
    : 0;

  const handleProbabilityInput = (dealId, value) => {
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, landingProbability: value } : d)));
  };

  const handleProbabilityBlur = async (dealId, value) => {
    const num = Math.max(0, Math.min(100, Number(value) || 0));
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, landingProbability: num } : d)));
    try {
      await updateDoc(doc(db, 'progressDashboard', dealId), { landingProbability: num });
    } catch (error) {
      console.error('着地確率の保存に失敗:', error);
    }
  };

  const handleNoteChange = (dealId, value) => {
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, landingStatusNote: value } : d)));
  };

  const handleNoteBlur = async (dealId, value) => {
    try {
      await updateDoc(doc(db, 'progressDashboard', dealId), { landingStatusNote: value });
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
              <SummaryLabel>着地予想額（想定予算×着地確率の合計）</SummaryLabel>
              <SummaryValue>{formatCurrency(forecastTotal)}</SummaryValue>
            </SummaryCard>
            <SummaryCard>
              <SummaryLabel>{gap > 0 ? '不足額' : '超過見込み'}</SummaryLabel>
              <SummaryValue $negative={gap > 0}>{formatCurrency(Math.abs(gap))}</SummaryValue>
            </SummaryCard>
          </SummaryRow>

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
            deals.map((deal) => (
              <DealCard key={deal.id}>
                <DealHeader>
                  <CompanyName>{deal.companyName || deal.productName || '(社名未設定)'}</CompanyName>
                  <PhaseBadge $status={deal.status}>
                    {deal.status}（{PHASE_DESCRIPTIONS[deal.status] || ''}）
                  </PhaseBadge>
                  <BudgetText>想定予算 {formatCurrency(deal.expectedBudget)}</BudgetText>
                </DealHeader>

                <FieldsGrid>
                  <FieldLabel>今期内の着地確率</FieldLabel>
                  <div>
                    <ProbabilityInput
                      type="number"
                      min="0"
                      max="100"
                      value={deal.landingProbability}
                      onChange={(e) => handleProbabilityInput(deal.id, e.target.value)}
                      onBlur={(e) => handleProbabilityBlur(deal.id, e.target.value)}
                    /> %
                  </div>

                  <FieldLabel>状況メモ</FieldLabel>
                  <NoteTextarea
                    value={deal.landingStatusNote}
                    onChange={(e) => handleNoteChange(deal.id, e.target.value)}
                    onBlur={(e) => handleNoteBlur(deal.id, e.target.value)}
                    placeholder="今の状況、懸念点、直近の動きなどを書く"
                  />

                  <FieldLabel>ネクストアクション</FieldLabel>
                  {naEditingId === deal.id ? (
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
                  ) : deal.na ? (
                    <NaRow>
                      <NaText>{deal.na.actionContent}</NaText>
                      {deal.na.actionDueDate && <NaDue>期限 {deal.na.actionDueDate}</NaDue>}
                      <IconButton onClick={() => beginNaEdit(deal)}><FiEdit3 /> 直す</IconButton>
                      <IconButton onClick={() => completeNa(deal)}><FiCheck /> 完了にする</IconButton>
                    </NaRow>
                  ) : (
                    <NaRow>
                      <NaText style={{ color: '#999' }}>設定されていません</NaText>
                      <IconButton onClick={() => beginNaEdit(deal)}><FiPlus /> 追加</IconButton>
                    </NaRow>
                  )}
                </FieldsGrid>
              </DealCard>
            ))
          )}
        </>
      )}
    </PageContainer>
  );
}

export default PipelineForecastPage;
