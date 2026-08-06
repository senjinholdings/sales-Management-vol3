import React, { useState } from 'react';
import styled from 'styled-components';
import { FiPlus, FiTrash2, FiRotateCcw } from 'react-icons/fi';
import { BUDGET_POLICIES } from '../data/constants.js';
import { calcBillingAmount, calcContractTotal, calcProjectTotal, toNumberOrNull, nextYearMonth } from '../utils/billing.js';
import { updateProject } from '../services/projectService.js';

// ============================================
// Styled Components
// ============================================

const SectionTitle = styled.h3`
  font-size: 1rem;
  font-weight: 600;
  color: #2c3e50;
  margin: 1.5rem 0 0.75rem;
`;

const TermsRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
`;

const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const FieldLabel = styled.label`
  font-size: 0.75rem;
  font-weight: 600;
  color: #7f8c8d;
`;

const TextInput = styled.input`
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  box-sizing: border-box;
  width: 100%;
  &:focus { outline: none; border-color: #3498db; }
`;

const SelectInput = styled.select`
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  background: white;
  box-sizing: border-box;
  width: 100%;
  &:focus { outline: none; border-color: #3498db; }
`;

const ContractCard = styled.div`
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fafbfc;
`;

const CardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
`;

const CardTitle = styled.div`
  font-size: 0.875rem;
  font-weight: 600;
  color: #2c3e50;
`;

const ContractGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-bottom: 0.75rem;
`;

const ActualTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  background: white;
  border: 1px solid #eee;
  border-radius: 4px;
`;

const Th = styled.th`
  padding: 0.5rem 0.6rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 600;
  color: #7f8c8d;
  background: #f8f9fa;
  border-bottom: 2px solid #e9ecef;
`;

const Td = styled.td`
  padding: 0.5rem 0.6rem;
  font-size: 0.85rem;
  color: #2c3e50;
  border-bottom: 1px solid #eee;
  vertical-align: middle;
`;

const CellInput = styled.input`
  width: 100%;
  padding: 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  box-sizing: border-box;
  &:focus { outline: none; border-color: #3498db; }
`;

const AmountCell = styled.div`
  display: flex;
  align-items: center;
  gap: 0.4rem;
`;

const ManualBadge = styled.span`
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: #f39c12;
  color: white;
  font-size: 0.65rem;
  font-weight: 600;
  white-space: nowrap;
`;

const CappedBadge = styled.span`
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: #95a5a6;
  color: white;
  font-size: 0.65rem;
  font-weight: 600;
  white-space: nowrap;
`;

const ResetButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.15rem 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  color: #999;
  cursor: pointer;
  font-size: 0.65rem;
  white-space: nowrap;
  &:hover { color: #3498db; border-color: #3498db; }
`;

const DeleteButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: #e74c3c;
  opacity: 0.6;
  display: flex;
  align-items: center;
  padding: 0.2rem;
  &:hover { opacity: 1; }
`;

const AddButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.75rem;
  border: 1px dashed #3498db;
  border-radius: 4px;
  background: white;
  color: #3498db;
  cursor: pointer;
  font-size: 0.8rem;
  &:hover { background: #f0f8ff; }
`;

const TableFooter = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.6rem;
`;

const TotalText = styled.div`
  font-size: 0.85rem;
  font-weight: 600;
  color: #2c3e50;
`;

const GrandTotalRow = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 0.75rem;
  background: #eaf4fd;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 700;
  color: #2c3e50;
`;

const EmptyText = styled.p`
  color: #95a5a6;
  font-size: 0.875rem;
  margin: 0.5rem 0 0.75rem;
`;

// ============================================
// ユーティリティ
// ============================================

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const formatYen = (amount) => {
  if (amount === null || amount === undefined) return '-';
  return `¥${new Intl.NumberFormat('ja-JP').format(amount)}`;
};

/** 表示用: 開始日昇順（未入力は末尾） */
const sortContracts = (contracts) =>
  [...contracts].sort((a, b) => {
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return a.startDate.localeCompare(b.startDate);
  });

/** 表示用: 年月昇順（未入力は末尾） */
const sortActuals = (actuals) =>
  [...actuals].sort((a, b) => {
    if (!a.yearMonth) return 1;
    if (!b.yearMonth) return -1;
    return a.yearMonth.localeCompare(b.yearMonth);
  });

// ============================================
// 契約・請求管理セクション（運用管理から開いた案件パネルのみ）
// 自社がクライアントに請求する金額の管理。月次売上管理（クライアント商品売上）とは別概念
// ============================================

const ContractBillingSection = ({ project, onProjectUpdate }) => {
  const [paymentTerms, setPaymentTerms] = useState({
    closingDay: project.billing?.paymentTerms?.closingDay || '',
    paymentSite: project.billing?.paymentTerms?.paymentSite || ''
  });
  // actualsの各行には編集・削除の対象特定用にローカルキー（_key）を付与（DBには保存しない）
  const [contracts, setContracts] = useState(() =>
    (project.billing?.contracts || []).map(contract => ({
      ...contract,
      id: contract.id || genId(),
      actuals: (contract.actuals || []).map(actual => ({ ...actual, _key: genId() }))
    }))
  );

  /** billingフィールド全体をFirestoreに保存（数値フィールドを正規化、_keyは除去） */
  const persist = async (nextContracts = contracts, nextTerms = paymentTerms) => {
    try {
      const billing = {
        paymentTerms: {
          closingDay: nextTerms.closingDay || '',
          paymentSite: nextTerms.paymentSite || ''
        },
        contracts: nextContracts.map(contract => ({
          id: contract.id,
          startDate: contract.startDate || '',
          endDate: contract.endDate || '',
          unitPrice: toNumberOrNull(contract.unitPrice),
          unitTarget: contract.unitTarget || '',
          monthlyBudget: toNumberOrNull(contract.monthlyBudget),
          budgetPolicy: contract.budgetPolicy || BUDGET_POLICIES[0],
          actuals: (contract.actuals || []).map(actual => ({
            yearMonth: actual.yearMonth || '',
            quantity: toNumberOrNull(actual.quantity),
            manualAmount: toNumberOrNull(actual.manualAmount)
          }))
        }))
      };
      await updateProject(project.id, { billing });
      if (onProjectUpdate) {
        onProjectUpdate({ ...project, billing });
      }
    } catch (error) {
      console.error('Failed to save billing:', error);
      alert('契約・請求情報の保存に失敗しました');
    }
  };

  // ---- 支払条件 ----
  const handleTermChange = (field, value) => {
    setPaymentTerms(prev => ({ ...prev, [field]: value }));
  };

  // ---- 契約期間 ----
  const updateContractField = (contractId, field, value) => {
    setContracts(prev => prev.map(c => (c.id === contractId ? { ...c, [field]: value } : c)));
  };

  const handleContractSelectChange = (contractId, field, value) => {
    const next = contracts.map(c => (c.id === contractId ? { ...c, [field]: value } : c));
    setContracts(next);
    persist(next);
  };

  const handleAddContract = () => {
    const sorted = sortContracts(contracts);
    const last = sorted[sorted.length - 1];
    // 前期間の終了日の翌日を開始日の初期値にする
    let startDate = '';
    if (last?.endDate) {
      const d = new Date(last.endDate);
      if (!Number.isNaN(d.getTime())) {
        d.setDate(d.getDate() + 1);
        startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    }
    const next = [...contracts, {
      id: genId(),
      startDate,
      endDate: '',
      unitPrice: '',
      unitTarget: last?.unitTarget || '',
      monthlyBudget: '',
      budgetPolicy: BUDGET_POLICIES[0],
      actuals: []
    }];
    setContracts(next);
    persist(next);
  };

  const handleDeleteContract = (contractId) => {
    if (!window.confirm('この契約期間を削除しますか？（月次実績も一緒に削除されます）')) return;
    const next = contracts.filter(c => c.id !== contractId);
    setContracts(next);
    persist(next);
  };

  // ---- 月次実績 ----
  const updateActualField = (contractId, actualKey, field, value) => {
    setContracts(prev => prev.map(c => {
      if (c.id !== contractId) return c;
      return {
        ...c,
        actuals: c.actuals.map(a => (a._key === actualKey ? { ...a, [field]: value } : a))
      };
    }));
  };

  const handleAddActual = (contractId) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return;
    // 最終月の翌月 → なければ契約開始月 → なければ今月
    const sorted = sortActuals(contract.actuals).filter(a => a.yearMonth);
    const last = sorted[sorted.length - 1];
    const now = new Date();
    const yearMonth = last
      ? nextYearMonth(last.yearMonth)
      : (contract.startDate ? contract.startDate.slice(0, 7) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    const next = contracts.map(c => (
      c.id === contractId
        ? { ...c, actuals: [...c.actuals, { _key: genId(), yearMonth, quantity: '', manualAmount: null }] }
        : c
    ));
    setContracts(next);
    persist(next);
  };

  const handleDeleteActual = (contractId, actual) => {
    const label = actual.yearMonth || 'この月';
    if (!window.confirm(`${label} の実績を削除しますか？`)) return;
    const next = contracts.map(c => (
      c.id === contractId ? { ...c, actuals: c.actuals.filter(a => a._key !== actual._key) } : c
    ));
    setContracts(next);
    persist(next);
  };

  /** 請求額欄の手動編集（空にすると自動計算に戻る） */
  const handleAmountChange = (contractId, actualKey, value) => {
    updateActualField(contractId, actualKey, 'manualAmount', value === '' ? null : value);
  };

  const handleResetAmount = (contractId, actualKey) => {
    const next = contracts.map(c => {
      if (c.id !== contractId) return c;
      return { ...c, actuals: c.actuals.map(a => (a._key === actualKey ? { ...a, manualAmount: null } : a)) };
    });
    setContracts(next);
    persist(next);
  };

  const sortedContracts = sortContracts(contracts);
  const projectTotal = calcProjectTotal(contracts);

  return (
    <div>
      <SectionTitle>契約・請求管理</SectionTitle>

      {/* 支払条件 */}
      <TermsRow>
        <FieldGroup>
          <FieldLabel>締め日</FieldLabel>
          <TextInput
            type="text"
            value={paymentTerms.closingDay}
            onChange={e => handleTermChange('closingDay', e.target.value)}
            onBlur={() => persist()}
            placeholder="未登録（例: 月末、15日）"
          />
        </FieldGroup>
        <FieldGroup>
          <FieldLabel>支払サイト</FieldLabel>
          <TextInput
            type="text"
            value={paymentTerms.paymentSite}
            onChange={e => handleTermChange('paymentSite', e.target.value)}
            onBlur={() => persist()}
            placeholder="未登録（例: 翌月末、当月末）"
          />
        </FieldGroup>
      </TermsRow>

      {/* 契約期間 */}
      {sortedContracts.length === 0 && (
        <EmptyText>契約期間は未登録です</EmptyText>
      )}
      {sortedContracts.map((contract, index) => {
        const contractTotal = calcContractTotal(contract);
        return (
          <ContractCard key={contract.id}>
            <CardHeader>
              <CardTitle>
                契約期間{index + 1}
                {contract.startDate && `　${contract.startDate} 〜 ${contract.endDate || '未定'}`}
              </CardTitle>
              <DeleteButton onClick={() => handleDeleteContract(contract.id)} title="期間を削除">
                <FiTrash2 size={15} />
              </DeleteButton>
            </CardHeader>

            <ContractGrid>
              <FieldGroup>
                <FieldLabel>開始日</FieldLabel>
                <TextInput
                  type="date"
                  value={contract.startDate || ''}
                  onChange={e => updateContractField(contract.id, 'startDate', e.target.value)}
                  onBlur={() => persist()}
                />
              </FieldGroup>
              <FieldGroup>
                <FieldLabel>終了日（未定は空欄）</FieldLabel>
                <TextInput
                  type="date"
                  value={contract.endDate || ''}
                  onChange={e => updateContractField(contract.id, 'endDate', e.target.value)}
                  onBlur={() => persist()}
                />
              </FieldGroup>
              <FieldGroup>
                <FieldLabel>単価（円・小数可）</FieldLabel>
                <TextInput
                  type="number"
                  step="any"
                  min="0"
                  value={contract.unitPrice ?? ''}
                  onChange={e => updateContractField(contract.id, 'unitPrice', e.target.value)}
                  onBlur={() => persist()}
                  placeholder="例: 2 / 1.5"
                />
              </FieldGroup>
              <FieldGroup>
                <FieldLabel>単価の対象</FieldLabel>
                <TextInput
                  type="text"
                  value={contract.unitTarget || ''}
                  onChange={e => updateContractField(contract.id, 'unitTarget', e.target.value)}
                  onBlur={() => persist()}
                  placeholder="例: 再生数"
                />
              </FieldGroup>
              <FieldGroup>
                <FieldLabel>月次予算額（円）</FieldLabel>
                <TextInput
                  type="number"
                  min="0"
                  value={contract.monthlyBudget ?? ''}
                  onChange={e => updateContractField(contract.id, 'monthlyBudget', e.target.value)}
                  onBlur={() => persist()}
                  placeholder="例: 1000000"
                />
              </FieldGroup>
              <FieldGroup>
                <FieldLabel>予算の扱い</FieldLabel>
                <SelectInput
                  value={contract.budgetPolicy || BUDGET_POLICIES[0]}
                  onChange={e => handleContractSelectChange(contract.id, 'budgetPolicy', e.target.value)}
                >
                  {BUDGET_POLICIES.map(policy => (
                    <option key={policy} value={policy}>{policy}</option>
                  ))}
                </SelectInput>
              </FieldGroup>
            </ContractGrid>

            {/* 月次実績 */}
            {contract.actuals.length > 0 && (
              <ActualTable>
                <thead>
                  <tr>
                    <Th style={{ width: '25%' }}>年月</Th>
                    <Th style={{ width: '25%' }}>実績数量</Th>
                    <Th>請求額</Th>
                    <Th style={{ width: '36px' }}></Th>
                  </tr>
                </thead>
                <tbody>
                  {sortActuals(contract.actuals).map(actual => {
                    const { amount, capped, manual } = calcBillingAmount(actual, contract);
                    return (
                      <tr key={actual._key}>
                        <Td>
                          <CellInput
                            type="month"
                            value={actual.yearMonth || ''}
                            onChange={e => updateActualField(contract.id, actual._key, 'yearMonth', e.target.value)}
                            onBlur={() => persist()}
                          />
                        </Td>
                        <Td>
                          <CellInput
                            type="number"
                            min="0"
                            value={actual.quantity ?? ''}
                            onChange={e => updateActualField(contract.id, actual._key, 'quantity', e.target.value)}
                            onBlur={() => persist()}
                            placeholder="例: 450000"
                          />
                        </Td>
                        <Td>
                          <AmountCell>
                            <CellInput
                              type="number"
                              min="0"
                              value={manual ? (actual.manualAmount ?? '') : (amount ?? '')}
                              onChange={e => handleAmountChange(contract.id, actual._key, e.target.value)}
                              onBlur={() => persist()}
                              placeholder="自動計算"
                              title={manual ? '手動調整中（空にすると自動計算に戻ります）' : '自動計算（編集すると手動調整になります）'}
                            />
                            {manual && (
                              <>
                                <ManualBadge>手動調整</ManualBadge>
                                <ResetButton onClick={() => handleResetAmount(contract.id, actual._key)}>
                                  <FiRotateCcw size={10} />
                                  自動に戻す
                                </ResetButton>
                              </>
                            )}
                            {capped && <CappedBadge>上限適用</CappedBadge>}
                          </AmountCell>
                        </Td>
                        <Td>
                          <DeleteButton onClick={() => handleDeleteActual(contract.id, actual)} title="月を削除">
                            <FiTrash2 size={14} />
                          </DeleteButton>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </ActualTable>
            )}

            <TableFooter>
              <AddButton onClick={() => handleAddActual(contract.id)}>
                <FiPlus size={13} />
                月を追加
              </AddButton>
              <TotalText>期間合計 {formatYen(contractTotal)}</TotalText>
            </TableFooter>
          </ContractCard>
        );
      })}

      <div style={{ marginBottom: '0.75rem' }}>
        <AddButton onClick={handleAddContract}>
          <FiPlus size={13} />
          期間を追加
        </AddButton>
      </div>

      {sortedContracts.length > 0 && (
        <GrandTotalRow>案件全体 請求合計 {formatYen(projectTotal)}</GrandTotalRow>
      )}
    </div>
  );
};

export default ContractBillingSection;
