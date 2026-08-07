import React, { useState, useEffect, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { FiStar, FiPlus, FiTrash2, FiCheck, FiTarget } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, getDocs, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

// === styled-components ===
const PageContainer = styled.div`
  max-width: 1400px;
  margin: 0 auto;
  padding: 1.5rem;
`;

const PageTitle = styled.h2`
  color: #2c3e50;
  margin: 0 0 1.5rem 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const KpiRow = styled.div`
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
`;

const KpiCard = styled.div`
  background: white;
  padding: 1rem 1.5rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  flex: 1;
  text-align: center;
`;

const KpiLabel = styled.div`
  font-size: 0.8rem;
  color: #999;
  margin-bottom: 0.25rem;
`;

const KpiValue = styled.div`
  font-size: 1.5rem;
  font-weight: bold;
  color: ${props => props.color || '#2c3e50'};
`;

const Card = styled.div`
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  overflow: hidden;
  margin-bottom: 1.5rem;
`;

const CardHeader = styled.div`
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const CardTitle = styled.h3`
  margin: 0;
  color: #2c3e50;
  font-size: 1rem;
`;

const AddButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 1rem;
  border: none;
  border-radius: 6px;
  background: #3498db;
  color: white;
  font-size: 0.85rem;
  cursor: pointer;
  &:hover { background: #2980b9; }
`;

const DeleteBtn = styled.button`
  padding: 0.2rem 0.4rem;
  border: none;
  border-radius: 4px;
  background: #e74c3c;
  color: white;
  cursor: pointer;
  font-size: 0.75rem;
  &:hover { background: #c0392b; }
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

const InlineInput = styled.input`
  padding: 0.3rem 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  width: 130px;
`;

const TextArea = styled.textarea`
  padding: 0.3rem 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  width: 100%;
  min-height: 50px;
  resize: vertical;
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

const Select = styled.select`
  padding: 0.4rem 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.9rem;
  background: white;
`;

const LoadingMessage = styled.div`
  text-align: center;
  padding: 3rem;
  color: #999;
`;

const EmptyMessage = styled.div`
  text-align: center;
  padding: 2rem;
  color: #999;
  font-size: 0.9rem;
`;

// 金額フォーマット
const formatCurrency = (value) => {
  if (!value && value !== 0) return '¥0';
  return `¥${Number(value).toLocaleString()}`;
};

// 四半期ユーティリティ
const getQuarterKey = (date) => {
  const y = date.getFullYear();
  const q = Math.ceil((date.getMonth() + 1) / 3);
  return `${y}-Q${q}`;
};

const getQuarterRange = (quarterKey) => {
  const [y, q] = quarterKey.split('-Q').map(Number);
  const startMonth = (q - 1) * 3;
  const endMonth = startMonth + 2;
  return {
    start: new Date(y, startMonth, 1),
    end: new Date(y, endMonth + 1, 0),
    label: `${y}年${startMonth + 1}月〜${endMonth + 1}月`,
    months: [startMonth, startMonth + 1, startMonth + 2],
    year: y,
  };
};

const getPrevQuarterKey = (quarterKey) => {
  const [y, q] = quarterKey.split('-Q').map(Number);
  if (q === 1) return `${y - 1}-Q4`;
  return `${y}-Q${q - 1}`;
};

const generateQuarterOptions = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  const options = [];
  for (let y = currentYear - 2; y <= currentYear + 1; y++) {
    for (let q = 1; q <= 4; q++) {
      options.push({ value: `${y}-Q${q}`, label: `${y}年 Q${q}（${(q-1)*3+1}〜${q*3}月）` });
    }
  }
  return { options, current: `${currentYear}-Q${currentQ}` };
};

function CoreCustomerPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [coreCustomers, setCoreCustomers] = useState([]);
  const [allSalesRecords, setAllSalesRecords] = useState([]);
  const [allDeals, setAllDeals] = useState([]);
  const { options: quarterOptions, current: currentQuarterKey } = useMemo(() => generateQuarterOptions(), []);
  const [selectedQuarter, setSelectedQuarter] = useState(currentQuarterKey);

  // 編集state
  const [editingId, setEditingId] = useState(null);
  const [editField, setEditField] = useState(null);
  const [editValue, setEditValue] = useState('');

  // 新規追加
  const [showAddInput, setShowAddInput] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');

  // 既存クライアント名リスト（追加用候補）
  const [companyList, setCompanyList] = useState([]);

  // データ取得
  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);

      // 1. コア顧客リスト取得
      const coreSnap = await getDocs(collection(db, 'coreCustomers'));
      const cores = [];
      coreSnap.forEach(d => cores.push({ id: d.id, ...d.data() }));
      setCoreCustomers(cores);

      // 2. 全案件 + salesRecords取得
      const progressSnap = await getDocs(collection(db, 'progressDashboard'));
      const deals = [];
      const companies = new Set();
      progressSnap.forEach(d => {
        const data = { id: d.id, ...d.data() };
        deals.push(data);
        if (data.companyName) companies.add(data.companyName);
      });
      setAllDeals(deals);
      setCompanyList([...companies].sort());

      // 既存案件のsalesRecords取得
      const existingDeals = deals.filter(d => d.isExistingProject === true);
      const records = [];
      await Promise.all(existingDeals.map(async (deal) => {
        try {
          const salesSnap = await getDocs(
            collection(db, 'progressDashboard', deal.id, 'salesRecords')
          );
          salesSnap.forEach(rec => {
            const rd = rec.data();
            if (rd.phase !== 'フェーズ8') return;
            records.push({
              companyName: deal.companyName || '',
              budget: typeof rd.budget === 'string' ? Number(rd.budget) || 0 : rd.budget || 0,
              confirmedDate: rd.confirmedDate || rd.date || '',
              recordType: rd.recordType || '',
            });
          });
        } catch (err) { /* skip */ }
      }));
      setAllSalesRecords(records);
    } catch (error) {
      console.error('データ取得エラー:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 四半期データ
  const quarterData = useMemo(() => {
    const currentQ = getQuarterRange(selectedQuarter);
    const prevQKey = getPrevQuarterKey(selectedQuarter);
    const prevQ = getQuarterRange(prevQKey);

    return coreCustomers.map(customer => {
      const name = customer.companyName;

      // 売上集計
      const calcRevenue = (range) => {
        return allSalesRecords
          .filter(r => {
            if (r.companyName !== name) return false;
            if (!r.confirmedDate) return false;
            const d = new Date(r.confirmedDate);
            return d >= range.start && d <= range.end;
          })
          .reduce((sum, r) => sum + r.budget, 0);
      };

      const currentRevenue = calcRevenue(currentQ);
      const prevRevenue = calcRevenue(prevQ);

      // コア顧客データ（四半期別）
      const qData = customer.quarters?.[selectedQuarter] || {};

      // 月別アクション
      const monthActions = {};
      currentQ.months.forEach(m => {
        const key = `${currentQ.year}-${String(m + 1).padStart(2, '0')}`;
        monthActions[key] = customer.actions?.[key] || '';
      });

      // 提案数（フェーズ1-7の案件数）
      const proposalCount = allDeals.filter(d =>
        d.companyName === name &&
        d.status &&
        !['フェーズ8', 'Dead', '失注'].includes(d.status)
      ).length;

      const isCore = currentRevenue >= 5000000;

      return {
        ...customer,
        currentRevenue,
        prevRevenue,
        isCore,
        plannedContactDate: qData.plannedContactDate || '',
        actualContactDate: qData.actualContactDate || '',
        monthActions,
        proposalCount,
      };
    });
  }, [coreCustomers, allSalesRecords, allDeals, selectedQuarter]);

  // KPI計算（コア顧客 = 今四半期500万円以上）
  const kpis = useMemo(() => {
    const totalCandidates = quarterData.length;
    const coreCustomersList = quarterData.filter(c => c.isCore);
    const totalCore = coreCustomersList.length;
    const totalProposals = quarterData.reduce((sum, c) => sum + c.proposalCount, 0);
    const contacted = quarterData.filter(c => c.actualContactDate).length;
    const contactRate = totalCandidates > 0 ? Math.round((contacted / totalCandidates) * 100) : 0;
    return { totalCandidates, totalCore, totalProposals, contacted, contactRate };
  }, [quarterData]);

  // コア顧客追加
  const handleAddCustomer = async () => {
    if (!newCompanyName.trim()) return;
    const name = newCompanyName.trim();
    try {
      const docRef = doc(collection(db, 'coreCustomers'));
      await setDoc(docRef, { companyName: name, quarters: {}, actions: {} });
      setCoreCustomers(prev => [...prev, { id: docRef.id, companyName: name, quarters: {}, actions: {} }]);
      setNewCompanyName('');
      setShowAddInput(false);
    } catch (error) {
      console.error('追加エラー:', error);
      alert('追加に失敗しました');
    }
  };

  // コア顧客削除
  const handleDelete = async (customer) => {
    if (!window.confirm(`${customer.companyName} をコア顧客候補から外しますか？`)) return;
    try {
      await deleteDoc(doc(db, 'coreCustomers', customer.id));
      setCoreCustomers(prev => prev.filter(c => c.id !== customer.id));
    } catch (error) {
      console.error('削除エラー:', error);
    }
  };

  // フィールド保存
  const handleSave = async (customer) => {
    try {
      const updates = {};
      if (editField === 'plannedContactDate' || editField === 'actualContactDate') {
        updates[`quarters.${selectedQuarter}.${editField}`] = editValue;
      } else if (editField?.startsWith('action_')) {
        const monthKey = editField.replace('action_', '');
        updates[`actions.${monthKey}`] = editValue;
      }
      await updateDoc(doc(db, 'coreCustomers', customer.id), updates);

      // ローカル更新
      setCoreCustomers(prev => prev.map(c => {
        if (c.id !== customer.id) return c;
        const updated = { ...c };
        if (editField === 'plannedContactDate' || editField === 'actualContactDate') {
          if (!updated.quarters) updated.quarters = {};
          if (!updated.quarters[selectedQuarter]) updated.quarters[selectedQuarter] = {};
          updated.quarters[selectedQuarter][editField] = editValue;
        } else if (editField?.startsWith('action_')) {
          const monthKey = editField.replace('action_', '');
          if (!updated.actions) updated.actions = {};
          updated.actions[monthKey] = editValue;
        }
        return updated;
      }));
      setEditingId(null);
      setEditField(null);
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました');
    }
  };

  const startEditing = (customerId, field, value) => {
    setEditingId(customerId);
    setEditField(field);
    setEditValue(value);
  };

  const currentQ = getQuarterRange(selectedQuarter);
  const prevQKey = getPrevQuarterKey(selectedQuarter);
  const prevQ = getQuarterRange(prevQKey);

  if (isLoading) {
    return <PageContainer><LoadingMessage>データを読み込み中...</LoadingMessage></PageContainer>;
  }

  return (
    <PageContainer>
      <PageTitle>
        <FiStar color="#f39c12" />
        コア顧客管理
        <Select
          value={selectedQuarter}
          onChange={(e) => setSelectedQuarter(e.target.value)}
          style={{ marginLeft: 'auto', fontSize: '0.9rem' }}
        >
          {quarterOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </Select>
      </PageTitle>

      {/* KPI */}
      <KpiRow>
        <KpiCard>
          <KpiLabel>コア顧客数（500万以上）</KpiLabel>
          <KpiValue>{kpis.totalCore}社</KpiValue>
          <div style={{ fontSize: '0.75rem', color: '#999' }}>候補: {kpis.totalCandidates}社</div>
        </KpiCard>
        <KpiCard>
          <KpiLabel>コア顧客候補への提案数</KpiLabel>
          <KpiValue color="#3498db">{kpis.totalProposals}件</KpiValue>
        </KpiCard>
        <KpiCard>
          <KpiLabel>コア顧客候補 四半期対面接触率</KpiLabel>
          <KpiValue color={kpis.contactRate >= 80 ? '#27ae60' : kpis.contactRate >= 50 ? '#f39c12' : '#e74c3c'}>
            {kpis.contactRate}%
          </KpiValue>
          <div style={{ fontSize: '0.75rem', color: '#999' }}>{kpis.contacted}/{kpis.totalCandidates}社</div>
        </KpiCard>
        <KpiCard>
          <KpiLabel>候補 四半期売上合計</KpiLabel>
          <KpiValue color="#27ae60">
            {formatCurrency(quarterData.reduce((sum, c) => sum + c.currentRevenue, 0))}
          </KpiValue>
        </KpiCard>
      </KpiRow>

      {/* コア顧客一覧 */}
      <Card>
        <CardHeader>
          <CardTitle>コア顧客候補一覧</CardTitle>
          {showAddInput ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <select
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                style={{ padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.85rem', minWidth: '200px' }}
              >
                <option value="">会社名を選択...</option>
                {companyList
                  .filter(name => !coreCustomers.some(c => c.companyName === name))
                  .map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))
                }
              </select>
              <SaveBtn onClick={handleAddCustomer}><FiCheck size={14} /> 追加</SaveBtn>
              <button onClick={() => setShowAddInput(false)} style={{ padding: '0.3rem 0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: '#f8f9fa', cursor: 'pointer', fontSize: '0.8rem' }}>キャンセル</button>
            </div>
          ) : (
            <AddButton onClick={() => setShowAddInput(true)}>
              <FiPlus size={14} />
              候補を追加
            </AddButton>
          )}
        </CardHeader>

        {quarterData.length === 0 ? (
          <EmptyMessage>コア顧客候補が登録されていません</EmptyMessage>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>会社名</Th>
                  <Th style={{ textAlign: 'right' }}>前四半期売上<br/><span style={{ fontSize: '0.7rem', color: '#999' }}>({prevQ.label})</span></Th>
                  <Th style={{ textAlign: 'right' }}>今四半期売上<br/><span style={{ fontSize: '0.7rem', color: '#999' }}>({currentQ.label})</span></Th>
                  <Th>接触予定日</Th>
                  <Th>対面接触日</Th>
                  {currentQ.months.map(m => (
                    <Th key={m}>{m + 1}月アクション</Th>
                  ))}
                  <Th style={{ textAlign: 'right' }}>提案数</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {quarterData.map(customer => (
                  <tr key={customer.id}>
                    <Td style={{ fontWeight: 'bold' }}>
                      <FiStar size={14} color={customer.isCore ? '#f39c12' : '#ddd'} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
                      {customer.companyName}
                      {customer.isCore && (
                        <span style={{ marginLeft: '0.5rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: '#f39c12', color: 'white', fontSize: '0.7rem', fontWeight: 'bold' }}>コア</span>
                      )}
                    </Td>
                    <Td style={{ textAlign: 'right' }}>{formatCurrency(customer.prevRevenue)}</Td>
                    <Td style={{ textAlign: 'right', fontWeight: 'bold', color: '#27ae60' }}>{formatCurrency(customer.currentRevenue)}</Td>

                    {/* 接触予定日 */}
                    <Td>
                      {editingId === customer.id && editField === 'plannedContactDate' ? (
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <InlineInput type="date" value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                          <SaveBtn onClick={() => handleSave(customer)}><FiCheck size={12} /></SaveBtn>
                        </div>
                      ) : (
                        <EditableCell onClick={() => startEditing(customer.id, 'plannedContactDate', customer.plannedContactDate)}>
                          {customer.plannedContactDate || '+ 入力'}
                        </EditableCell>
                      )}
                    </Td>

                    {/* 対面接触日 */}
                    <Td>
                      {editingId === customer.id && editField === 'actualContactDate' ? (
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <InlineInput type="date" value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                          <SaveBtn onClick={() => handleSave(customer)}><FiCheck size={12} /></SaveBtn>
                        </div>
                      ) : (
                        <EditableCell onClick={() => startEditing(customer.id, 'actualContactDate', customer.actualContactDate)}>
                          {customer.actualContactDate || '+ 入力'}
                        </EditableCell>
                      )}
                    </Td>

                    {/* 月別アクション */}
                    {currentQ.months.map(m => {
                      const monthKey = `${currentQ.year}-${String(m + 1).padStart(2, '0')}`;
                      const actionField = `action_${monthKey}`;
                      return (
                        <Td key={m} style={{ minWidth: '150px' }}>
                          {editingId === customer.id && editField === actionField ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <TextArea value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                              <SaveBtn onClick={() => handleSave(customer)}><FiCheck size={12} /> 保存</SaveBtn>
                            </div>
                          ) : (
                            <EditableCell onClick={() => startEditing(customer.id, actionField, customer.monthActions[monthKey])}>
                              {customer.monthActions[monthKey] || '+ 入力'}
                            </EditableCell>
                          )}
                        </Td>
                      );
                    })}

                    <Td style={{ textAlign: 'right' }}>{customer.proposalCount}件</Td>
                    <Td>
                      <DeleteBtn onClick={() => handleDelete(customer)}>
                        <FiTrash2 size={12} />
                      </DeleteBtn>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </PageContainer>
  );
}

export default CoreCustomerPage;
