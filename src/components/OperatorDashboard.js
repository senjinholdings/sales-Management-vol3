import React, { useState, useEffect, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { FiUser, FiCalendar, FiCheck, FiEdit2, FiTarget, FiDownload, FiAlertTriangle } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { fetchStaffByRole } from '../services/staffService.js';
import { updateSalesRecord } from '../services/projectService.js';
import { STATUS_COLORS, CONTINUATION_STATUS_COLORS } from '../data/constants.js';
import { getStageState, getStageDef, getOverdueBusinessDays, formatStageDate, isStageTargetProject } from '../utils/stageProgress.js';
import PhaseTooltip from './PhaseTooltip.js';
import ProjectDetailPanel from './ProjectDetailPanel.js';

// 継続ステータス自動判定
const calcContinuationStatus = (records, isExistingProject) => {
  if (!records || records.length === 0) return '';
  const latest = records[0];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (latest.phase === 'Dead') return '終了';
  const endDate = latest.endDate ? new Date(latest.endDate) : null;
  const startDate = latest.startDate ? new Date(latest.startDate) : null;
  const isPhase8 = latest.phase === 'フェーズ8';
  const isPhase1to7 = latest.phase && latest.phase !== 'フェーズ8' && latest.phase !== '失注';
  if (isExistingProject) {
    if (isPhase8 && (!startDate || startDate > today)) return '継続成約';
    if (isPhase8 && endDate && endDate < today) return '終了';
    if (isPhase1to7 && records.length >= 2) return '継続提案中';
    if (isPhase1to7 && records.length === 1) return '新規提案中';
    if (startDate && (!endDate || endDate >= today)) return '施策実施中';
  } else {
    if (isPhase8 && (!startDate || startDate > today)) return '新規成約';
    if (isPhase8 && endDate && endDate < today) return '終了';
    if (isPhase1to7 && records.length >= 2) return '継続提案中';
    if (startDate && (!endDate || endDate >= today)) return '施策実施中';
  }
  return '';
};

// --- styled-components ---
const PageContainer = styled.div`
  max-width: 1600px;
  margin: 0 auto;
  padding: 1.5rem;
`;

const PageTitle = styled.h2`
  color: #2c3e50;
  margin: 0 0 1.5rem 0;
`;

const MainLayout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`;

const LeftColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`;

const Card = styled.div`
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  overflow: hidden;
`;

const CardHeader = styled.div`
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
`;

const CardTitle = styled.h3`
  margin: 0;
  color: #2c3e50;
  font-size: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const FilterRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
`;

const Select = styled.select`
  padding: 0.4rem 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85rem;
`;

const DateInput = styled.input`
  padding: 0.4rem 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85rem;
`;

const FilterLabel = styled.span`
  font-size: 0.8rem;
  color: #666;
`;

const TargetCard = styled(Card)`
  padding: 1.25rem 1.5rem;
`;

const TargetRow = styled.div`
  display: flex;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;
`;

const TargetMetric = styled.div`
  text-align: center;
`;

const TargetLabel = styled.div`
  font-size: 0.7rem;
  color: #999;
  margin-bottom: 0.15rem;
`;

const TargetValue = styled.div`
  font-size: 1.3rem;
  font-weight: bold;
  color: ${props => props.color || '#2c3e50'};
`;

const TargetInput = styled.input`
  padding: 0.35rem 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85rem;
  width: 140px;
  text-align: right;
`;

const TargetSaveBtn = styled.button`
  padding: 0.3rem 0.6rem;
  border: none;
  border-radius: 4px;
  background: #27ae60;
  color: white;
  cursor: pointer;
  font-size: 0.8rem;
  &:hover { background: #219a52; }
`;

const ProgressBar = styled.div`
  flex: 1;
  min-width: 120px;
  max-width: 200px;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const Th = styled.th`
  background: #f8f9fa;
  padding: 0.6rem 0.75rem;
  text-align: left;
  font-size: 0.8rem;
  color: #666;
  border-bottom: 2px solid #e9ecef;
  white-space: nowrap;
`;

const Td = styled.td`
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid #f0f0f0;
  font-size: 0.85rem;
  color: #2c3e50;
`;

const ClickableRow = styled.tr`
  cursor: pointer;
  &:hover { background: #f8f9fa; }
`;

const PhaseBadge = styled.span`
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  color: white;
  background: ${props => props.color || '#95a5a6'};
`;

const InlineSelect = styled.select`
  padding: 0.3rem 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  background: white;
`;

const InlineInput = styled.input`
  padding: 0.3rem 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  width: 130px;
`;

const SaveBtn = styled.button`
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: 4px;
  background: #27ae60;
  color: white;
  cursor: pointer;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  &:hover { background: #219a52; }
`;

const EditableCell = styled.span`
  cursor: pointer;
  padding: 0.15rem 0.3rem;
  border-radius: 3px;
  &:hover { background: #e8f4fd; }
`;

const EmptyMessage = styled.div`
  text-align: center;
  padding: 2rem;
  color: #999;
  font-size: 0.9rem;
`;

const CsvButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 1rem;
  border: none;
  border-radius: 6px;
  background: #27ae60;
  color: white;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: #219a52; }
`;

const LoadingMessage = styled.div`
  text-align: center;
  padding: 3rem;
  color: #999;
`;

const RightCard = styled(Card)`
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  position: sticky;
  top: 80px;
`;

// 金額フォーマット
const formatCurrency = (value) => {
  if (!value && value !== 0) return '-';
  return `¥${Number(value).toLocaleString()}`;
};

function OperatorDashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [operators, setOperators] = useState([]);
  const [selectedOperator, setSelectedOperator] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dateFrom, setDateFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dateTo, setDateTo] = useState(() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  });

  // 目標値
  const [targetValue, setTargetValue] = useState(0);
  const [editingTarget, setEditingTarget] = useState('');
  const [isEditingTarget, setIsEditingTarget] = useState(false);

  // 既存案件データ
  const [existingDeals, setExistingDeals] = useState([]);
  // CSV出力用：全案件（ステータス不問）
  const [allCsvDeals, setAllCsvDeals] = useState([]);
  // 新規案件（Phase 2-7）
  const [pipelineDeals, setPipelineDeals] = useState([]);

  // インライン編集state
  const [editingId, setEditingId] = useState(null);
  const [editField, setEditField] = useState(null); // 'operator' or 'startDate'
  const [editOperator, setEditOperator] = useState('');
  const [editStartDate, setEditStartDate] = useState('');

  // 詳細パネル
  const [selectedProject, setSelectedProject] = useState(null);

  // データ取得
  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const progressRef = collection(db, 'progressDashboard');
      const querySnapshot = await getDocs(progressRef);

      const allDeals = [];
      querySnapshot.forEach((docSnap) => {
        allDeals.push({
          id: docSnap.id,
          ...docSnap.data(),
          createdAt: docSnap.data().createdAt?.toDate?.() || new Date(docSnap.data().createdAt)
        });
      });

      // 既存案件（フェーズ8のみ）
      const existing = allDeals.filter(d => d.isExistingProject === true && d.status === 'フェーズ8');
      const enrichedDeals = [];
      await Promise.all(existing.map(async (deal) => {
        try {
          const salesSnap = await getDocs(
            collection(db, 'progressDashboard', deal.id, 'salesRecords')
          );
          const recs = [];
          salesSnap.forEach(rec => recs.push({ id: rec.id, ...rec.data() }));
          recs.sort((a, b) => {
            const aDate = a.date || '';
            const bDate = b.date || '';
            if (aDate !== bDate) return bDate.localeCompare(aDate);
            const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
          });
          const latest = recs.length > 0 ? recs[0] : null;
          enrichedDeals.push({
            ...deal,
            latestRecordId: latest?.id || null,
            operatorRep: latest?.operatorRep || '',
            startDate: latest?.startDate || '',
            endDate: latest?.endDate || '',
            budget: latest ? (typeof latest.budget === 'string' ? Number(latest.budget) || 0 : latest.budget || 0) : 0,
            latestPhase: latest?.phase || deal.status || '',
            continuationStatus: calcContinuationStatus(recs, !!deal.isExistingProject),
          });
        } catch (err) {
          enrichedDeals.push({ ...deal, operatorRep: '', startDate: '', endDate: '', budget: 0, latestPhase: deal.status || '', continuationStatus: '' });
        }
      }));
      setExistingDeals(enrichedDeals);

      // CSV用: 全既存案件の全salesRecordを施策単位で取得
      const csvAllTargets = allDeals.filter(d => d.isExistingProject === true);
      const csvRows = [];
      await Promise.all(csvAllTargets.map(async (deal) => {
        try {
          const salesSnap = await getDocs(
            collection(db, 'progressDashboard', deal.id, 'salesRecords')
          );
          salesSnap.forEach(rec => {
            const data = rec.data();
            if (data.startDate) {
              csvRows.push({
                ...deal,
                operatorRep: data.operatorRep || '',
                startDate: data.startDate || '',
                endDate: data.endDate || '',
                budget: typeof data.budget === 'string' ? Number(data.budget) || 0 : data.budget || 0,
              });
            }
          });
        } catch (err) { /* skip */ }
      }));
      setAllCsvDeals(csvRows);

      // 新規案件（Phase 2-7）
      const pipeline = allDeals.filter(d =>
        d.isExistingProject !== true &&
        ['フェーズ2', 'フェーズ3', 'フェーズ4', 'フェーズ5', 'フェーズ6', 'フェーズ7'].includes(d.status)
      );
      setPipelineDeals(pipeline);
    } catch (error) {
      console.error('データ取得エラー:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 目標値取得
  const fetchTarget = useCallback(async () => {
    if (!selectedOperator || !selectedMonth) return;
    try {
      const targetRef = doc(db, 'operatorTargets', `${selectedOperator}_${selectedMonth}`);
      const targetDoc = await getDoc(targetRef);
      if (targetDoc.exists()) {
        setTargetValue(targetDoc.data().target || 0);
      } else {
        setTargetValue(0);
      }
    } catch (error) {
      console.error('目標値取得エラー:', error);
    }
  }, [selectedOperator, selectedMonth]);

  // 目標値保存
  const saveTarget = async () => {
    if (!selectedOperator || !selectedMonth) return;
    try {
      const targetRef = doc(db, 'operatorTargets', `${selectedOperator}_${selectedMonth}`);
      const value = parseInt(editingTarget) || 0;
      await setDoc(targetRef, { target: value, updatedAt: new Date() });
      setTargetValue(value);
      setIsEditingTarget(false);
    } catch (error) {
      console.error('目標値保存エラー:', error);
      alert('保存に失敗しました');
    }
  };

  useEffect(() => {
    fetchData();
    fetchStaffByRole('operator').then(staff => {
      setOperators(staff.map(s => s.name));
    }).catch(err => console.error('運用者リスト取得エラー:', err));
  }, [fetchData]);

  useEffect(() => {
    fetchTarget();
  }, [fetchTarget]);

  // 選択月の予算実績
  const monthlyActual = useMemo(() => {
    if (!selectedOperator || !selectedMonth) return 0;
    const monthStart = `${selectedMonth}-01`;
    const [y, m] = selectedMonth.split('-').map(Number);
    const monthEnd = new Date(y, m, 0);
    const monthEndStr = `${y}-${String(m).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;

    return existingDeals
      .filter(d => d.operatorRep === selectedOperator && d.startDate && d.startDate >= monthStart && d.startDate <= monthEndStr)
      .reduce((sum, d) => sum + d.budget, 0);
  }, [existingDeals, selectedOperator, selectedMonth]);

  // パート1: 選択中の運用者の案件（月フィルタなし）
  const operatorDeals = useMemo(() => {
    if (!selectedOperator) return [];
    let deals = existingDeals.filter(d => d.operatorRep === selectedOperator);

    // 開始日フィルタ
    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
      const to = dateTo ? new Date(dateTo + 'T23:59:59') : null;
      deals = deals.filter(d => {
        if (!d.startDate) return true;
        const sd = new Date(d.startDate);
        if (from && sd < from) return false;
        if (to && sd > to) return false;
        return true;
      });
    }

    // ソート: 開始日あり→なし
    deals.sort((a, b) => {
      if (a.startDate && !b.startDate) return -1;
      if (!a.startDate && b.startDate) return 1;
      if (a.startDate && b.startDate) return b.startDate.localeCompare(a.startDate);
      return 0;
    });
    return deals;
  }, [existingDeals, selectedOperator, dateFrom, dateTo]);

  // パート2: 担当者未確定の案件
  const unassignedDeals = useMemo(() => {
    return existingDeals.filter(d => !d.operatorRep);
  }, [existingDeals]);

  // 遅延中の案件（進行ステージの期限を超過しているもの）
  const delayedDeals = useMemo(() => {
    const now = new Date();
    return existingDeals
      .map(deal => {
        // 基準日より前に受注した案件は進行ステージの対象外（遅延一覧に載せない）
        if (!isStageTargetProject(deal)) return null;
        const state = getStageState(deal.stageProgress);
        if (!state.deadline) return null;
        const overdueDays = getOverdueBusinessDays(state.deadline, now);
        if (overdueDays <= 0) return null;
        return {
          deal,
          stageName: getStageDef(state.currentStage)?.name || '',
          deadline: state.deadline,
          overdueDays,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.overdueDays - a.overdueDays);
  }, [existingDeals]);

  // インライン編集の開始
  const startEditing = (deal, field) => {
    setEditingId(deal.id);
    setEditField(field);
    setEditOperator(deal.operatorRep || '');
    setEditStartDate(deal.startDate || '');
  };

  // インライン編集の保存
  const handleSaveField = async (deal) => {
    try {
      const updates = {};
      if (editField === 'operator') updates.operatorRep = editOperator;
      if (editField === 'startDate') updates.startDate = editStartDate;
      await updateSalesRecord(deal.id, deal.latestRecordId, updates, 'salesRecords');

      setExistingDeals(prev => prev.map(d =>
        d.id === deal.id ? {
          ...d,
          ...(editField === 'operator' ? { operatorRep: editOperator } : {}),
          ...(editField === 'startDate' ? { startDate: editStartDate } : {}),
        } : d
      ));
      setEditingId(null);
      setEditField(null);
    } catch (error) {
      console.error('保存失敗:', error);
      alert('保存に失敗しました');
    }
  };

  // 詳細パネル
  const handleRowClick = (deal) => {
    if (editingId) return; // 編集中はクリック無効
    setSelectedProject(deal);
  };

  const handlePanelClose = () => {
    setSelectedProject(null);
    fetchData();
  };

  // 月別実施案件CSV出力
  const handleCsvExport = () => {
    if (!selectedMonth) return;
    const [y, m] = selectedMonth.split('-').map(Number);
    const monthStart = `${selectedMonth}-01`;
    const monthEnd = new Date(y, m, 0);
    const monthEndStr = `${y}-${String(m).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;

    const filtered = allCsvDeals.filter(d => {
      if (!d.startDate) return false;
      if (d.startDate > monthEndStr) return false;
      if (d.endDate && d.endDate < monthStart) return false;
      return true;
    });

    const header = '商材名,担当者,クライアント,案件開始日,案件終了日,予算';
    const rows = filtered.map(d => {
      const cols = [
        d.productName || '',
        d.operatorRep || '',
        d.companyName || '',
        d.startDate || '',
        d.endDate || '実施中',
        d.budget || 0,
      ];
      return cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
    });

    const bom = '\uFEFF';
    const csv = bom + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `実施案件一覧_${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // テーブル行レンダリング（パート1・2共通）
  const renderDealRow = (deal) => (
    <ClickableRow key={deal.id} onClick={() => handleRowClick(deal)}>
      <Td>{deal.companyName || ''}</Td>
      <Td>{deal.productName || ''}</Td>
      <Td style={{ textAlign: 'right' }}>{formatCurrency(deal.budget)}</Td>
      <Td>
        {editingId === deal.id && editField === 'startDate' ? (
          <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
            <InlineInput
              type="date"
              value={editStartDate}
              onChange={(e) => setEditStartDate(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            <SaveBtn onClick={(e) => { e.stopPropagation(); handleSaveField(deal); }}>
              <FiCheck size={12} />
            </SaveBtn>
          </div>
        ) : (
          <EditableCell onClick={(e) => { e.stopPropagation(); startEditing(deal, 'startDate'); }}>
            {deal.startDate || '+ 入力'}
          </EditableCell>
        )}
      </Td>
      <Td>{deal.endDate || '-'}</Td>
      <Td>
        {(() => {
          const label = deal.continuationStatus === '施策実施中' ? '施策実施中'
            : deal.continuationStatus === '継続成約' || deal.continuationStatus === '新規成約' ? '開始前'
            : deal.continuationStatus || '-';
          const color = label === '施策実施中' ? '#3498db' : label === '開始前' ? '#f39c12' : '#95a5a6';
          return <PhaseBadge color={color}>{label}</PhaseBadge>;
        })()}
      </Td>
      <Td>
        {editingId === deal.id && editField === 'operator' ? (
          <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
            <InlineSelect
              value={editOperator}
              onChange={(e) => setEditOperator(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">選択</option>
              {operators.map(op => (
                <option key={op} value={op}>{op}</option>
              ))}
            </InlineSelect>
            <SaveBtn onClick={(e) => { e.stopPropagation(); handleSaveField(deal); }}>
              <FiCheck size={12} />
            </SaveBtn>
          </div>
        ) : (
          <EditableCell onClick={(e) => { e.stopPropagation(); startEditing(deal, 'operator'); }}>
            {deal.operatorRep || '+ 割当'}
          </EditableCell>
        )}
      </Td>
    </ClickableRow>
  );

  // 月プルダウン選択肢（過去6ヶ月〜未来3ヶ月）
  const monthOptions = useMemo(() => {
    const options = [];
    const now = new Date();
    for (let i = -6; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
      options.push({ val, label });
    }
    return options;
  }, []);

  const achievementRate = targetValue > 0 ? Math.round((monthlyActual / targetValue) * 100) : 0;
  const barWidth = Math.min(achievementRate, 100);

  if (isLoading) {
    return <PageContainer><LoadingMessage>データを読み込み中...</LoadingMessage></PageContainer>;
  }

  return (
    <PageContainer>
      <PageTitle>運用管理</PageTitle>

      <MainLayout>
        <LeftColumn>
          {/* 遅延中の案件（進行ステージ期限超過。0件なら非表示） */}
          {delayedDeals.length > 0 && (
            <Card>
              <CardHeader style={{ background: '#fdf0ef' }}>
                <CardTitle style={{ color: '#e74c3c' }}>
                  <FiAlertTriangle />
                  遅延中の案件（{delayedDeals.length}件）
                </CardTitle>
              </CardHeader>
              <Table>
                <thead>
                  <tr>
                    <Th>会社名</Th>
                    <Th>商材名</Th>
                    <Th>現在のステージ</Th>
                    <Th>期限</Th>
                    <Th>超過日数</Th>
                  </tr>
                </thead>
                <tbody>
                  {delayedDeals.map(({ deal, stageName, deadline, overdueDays }) => (
                    <ClickableRow key={deal.id} onClick={() => handleRowClick(deal)}>
                      <Td>{deal.companyName || ''}</Td>
                      <Td>{deal.productName || ''}</Td>
                      <Td>{stageName}</Td>
                      <Td>{formatStageDate(deadline)}</Td>
                      <Td>
                        <PhaseBadge color="#e74c3c">{overdueDays}日超過</PhaseBadge>
                      </Td>
                    </ClickableRow>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          {/* 運用者の目標実績 */}
          <TargetCard>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <FiTarget size={18} color="#2c3e50" />
              <span style={{ fontWeight: 'bold', color: '#2c3e50' }}>運用者の目標実績</span>
            </div>
            <TargetRow>
              <Select
                value={selectedOperator}
                onChange={(e) => setSelectedOperator(e.target.value)}
              >
                <option value="">運用者を選択</option>
                {operators.map(op => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </Select>
              <Select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              >
                {monthOptions.map(opt => (
                  <option key={opt.val} value={opt.val}>{opt.label}</option>
                ))}
              </Select>
              <CsvButton onClick={handleCsvExport}>
                <FiDownload size={14} />
                月別実施案件CSV
              </CsvButton>
              {selectedOperator && (
                <>
                  <TargetMetric>
                    <TargetLabel>目標</TargetLabel>
                    {isEditingTarget ? (
                      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                        <TargetInput
                          type="number"
                          value={editingTarget}
                          onChange={(e) => setEditingTarget(e.target.value)}
                          placeholder="目標金額"
                        />
                        <TargetSaveBtn onClick={saveTarget}>保存</TargetSaveBtn>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}
                        onClick={() => { setEditingTarget(targetValue.toString()); setIsEditingTarget(true); }}>
                        <TargetValue>{formatCurrency(targetValue)}</TargetValue>
                        <FiEdit2 size={12} color="#999" />
                      </div>
                    )}
                  </TargetMetric>
                  <TargetMetric>
                    <TargetLabel>実績</TargetLabel>
                    <TargetValue color="#3498db">{formatCurrency(monthlyActual)}</TargetValue>
                  </TargetMetric>
                  <TargetMetric>
                    <TargetLabel>達成率</TargetLabel>
                    <TargetValue color={achievementRate >= 100 ? '#27ae60' : achievementRate >= 50 ? '#f39c12' : '#e74c3c'}>
                      {achievementRate}%
                    </TargetValue>
                  </TargetMetric>
                  <ProgressBar>
                    <div style={{ height: '16px', background: '#e9ecef', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${barWidth}%`,
                        height: '100%',
                        background: achievementRate >= 100 ? '#27ae60' : achievementRate >= 50 ? '#f39c12' : '#e74c3c',
                        borderRadius: '4px',
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </ProgressBar>
                </>
              )}
            </TargetRow>
          </TargetCard>

          {/* パート1 + パート2: 案件一覧（統合テーブル） */}
          <Card>
            <CardHeader>
              <CardTitle>
                <FiUser />
                運用者の案件一覧
              </CardTitle>
              <FilterRow>
                <FiCalendar size={14} color="#666" />
                <FilterLabel>開始日:</FilterLabel>
                <DateInput
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
                <FilterLabel>〜</FilterLabel>
                <DateInput
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </FilterRow>
            </CardHeader>

            <Table>
              <thead>
                <tr>
                  <Th>会社名</Th>
                  <Th>商材名</Th>
                  <Th style={{ textAlign: 'right' }}>予算</Th>
                  <Th>開始日</Th>
                  <Th>終了日</Th>
                  <Th>ステータス</Th>
                  <Th>運用者</Th>
                </tr>
              </thead>
              <tbody>
                {!selectedOperator ? (
                  <tr><Td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: '1.5rem' }}>運用者を選択してください</Td></tr>
                ) : operatorDeals.length === 0 ? (
                  <tr><Td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: '1.5rem' }}>該当する案件がありません</Td></tr>
                ) : (
                  operatorDeals.map(deal => renderDealRow(deal))
                )}

                {/* 区切り: 担当者未確定の案件 */}
                <tr><td colSpan={7} style={{ padding: '0.75rem', border: 'none' }} /></tr>
                <tr>
                  <Td colSpan={7} style={{ background: '#f8f9fa', padding: '0.6rem 0.75rem', fontWeight: 600, color: '#e74c3c', fontSize: '0.85rem', borderTop: '2px solid #e9ecef' }}>
                    担当者未確定の案件（{unassignedDeals.length}件）
                  </Td>
                </tr>
                {unassignedDeals.length === 0 ? (
                  <tr><Td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: '1.5rem' }}>未確定の案件はありません</Td></tr>
                ) : (
                  unassignedDeals.map(deal => renderDealRow(deal))
                )}
              </tbody>
            </Table>
          </Card>

          {/* パート3: 追加予定の予算 */}
          <Card>
            <CardHeader>
              <CardTitle>追加予定の予算（フェーズ2-7）</CardTitle>
              <FilterLabel>{pipelineDeals.length}件</FilterLabel>
            </CardHeader>
            {pipelineDeals.length === 0 ? (
              <EmptyMessage>フェーズ2-7の案件がありません</EmptyMessage>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>会社名</Th>
                    <Th>商材名</Th>
                    <Th>フェーズ <PhaseTooltip /></Th>
                    <Th style={{ textAlign: 'right' }}>想定予算</Th>
                  </tr>
                </thead>
                <tbody>
                  {pipelineDeals.map(deal => (
                    <ClickableRow key={deal.id} onClick={() => handleRowClick(deal)}>
                      <Td>{deal.companyName || ''}</Td>
                      <Td>{deal.productName || ''}</Td>
                      <Td>
                        <PhaseBadge color={STATUS_COLORS[deal.status]}>
                          {deal.status}
                        </PhaseBadge>
                      </Td>
                      <Td style={{ textAlign: 'right' }}>{formatCurrency(deal.expectedBudget)}</Td>
                    </ClickableRow>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </LeftColumn>
      </MainLayout>

      {/* 詳細パネル */}
      {selectedProject && (
        <ProjectDetailPanel
          project={selectedProject}
          onClose={handlePanelClose}
          onProjectUpdate={(updated) => {
            setExistingDeals(prev => prev.map(d => d.id === updated.id ? { ...d, ...updated } : d));
          }}
          mode={selectedProject.isExistingProject ? undefined : 'newCase'}
          hideSalesTab
          showStageProgress={!!selectedProject.isExistingProject}
        />
      )}
    </PageContainer>
  );
}

export default OperatorDashboard;
