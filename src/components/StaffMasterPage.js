import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { FiPlus, FiTrash2, FiUser, FiUsers, FiCheck, FiMessageCircle } from 'react-icons/fi';
import {
  fetchAllStaff, addStaff, updateStaffEmail, deleteStaff,
  registerChatworkToken, fetchChatworkStatus
} from '../services/staffService.js';

// ============================================
// Styled Components
// ============================================

const PageContainer = styled.div`
  max-width: 1000px;
  margin: 0 auto;
`;

const Title = styled.h1`
  font-size: 1.5rem;
  font-weight: 700;
  color: #2c3e50;
  margin: 0 0 1.5rem;
`;

const SectionGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
`;

const Section = styled.div`
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  padding: 1.5rem;
`;

const SectionTitle = styled.h2`
  font-size: 1.1rem;
  font-weight: 600;
  color: #2c3e50;
  margin: 0 0 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const AddForm = styled.div`
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
`;

const Input = styled.input`
  flex: 1;
  padding: 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  &:focus { outline: none; border-color: #3498db; }
`;

const AddButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.6rem 1rem;
  border: none;
  border-radius: 4px;
  background: #3498db;
  color: white;
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
  &:hover { opacity: 0.9; }
  &:disabled { background: #bdc3c7; cursor: not-allowed; }
`;

const StaffList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const StaffItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  background: #f8f9fa;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
`;

const StaffInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
  min-width: 0;
`;

const StaffName = styled.span`
  font-size: 0.9rem;
  color: #2c3e50;
  font-weight: 500;
`;

const EmailInput = styled.input`
  padding: 0.3rem 0.4rem;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 0.78rem;
  color: #7f8c8d;
  background: transparent;
  &:hover { border-color: #ddd; }
  &:focus { outline: none; border-color: #3498db; background: white; color: #2c3e50; }
`;

const DeleteButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  color: #7f8c8d;
  &:hover { color: #e74c3c; border-color: #e74c3c; }
`;

const EmptyText = styled.div`
  text-align: center;
  padding: 1.5rem;
  color: #95a5a6;
  font-size: 0.85rem;
`;

const ChatworkRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.2rem;
`;

const ChatworkBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.72rem;
  color: #1abc9c;
  font-weight: 600;
`;

const ChatworkLink = styled.button`
  background: none;
  border: none;
  padding: 0;
  color: #3498db;
  font-size: 0.72rem;
  cursor: pointer;
  text-decoration: underline;
  &:hover { color: #2980b9; }
`;

const ChatworkTokenInput = styled.input`
  flex: 1;
  padding: 0.25rem 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.75rem;
  &:focus { outline: none; border-color: #3498db; }
`;

const ChatworkSaveButton = styled.button`
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: 4px;
  background: #3498db;
  color: white;
  font-size: 0.72rem;
  cursor: pointer;
  white-space: nowrap;
  &:hover { opacity: 0.9; }
  &:disabled { background: #bdc3c7; cursor: not-allowed; }
`;

/**
 * 担当者ごとのChatwork連携UI。
 * トークンはCloud Functions経由でSecret Managerに保存され、Firestoreには一切置かない
 * （案件データベースは現状アクセス制限が全開放のため、生きた認証情報を置けない）。
 */
const ChatworkConnect = ({ staffId }) => {
  const [connected, setConnected] = useState(null); // null=確認中
  const [editing, setEditing] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchChatworkStatus(staffId).then((isConnected) => {
      if (!cancelled) setConnected(isConnected);
    }).catch(() => { if (!cancelled) setConnected(false); });
    return () => { cancelled = true; };
  }, [staffId]);

  const handleSave = async () => {
    if (!tokenInput.trim()) return;
    setSaving(true);
    setError('');
    try {
      await registerChatworkToken(staffId, tokenInput.trim());
      setConnected(true);
      setEditing(false);
      setTokenInput('');
    } catch (err) {
      setError(err.message || '登録に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (connected === null) return null;

  if (!editing && connected) {
    return (
      <ChatworkRow>
        <ChatworkBadge><FiCheck size={12} /> Chatwork連携済み</ChatworkBadge>
        <ChatworkLink onClick={() => setEditing(true)}>変更</ChatworkLink>
      </ChatworkRow>
    );
  }

  if (!editing) {
    return (
      <ChatworkRow>
        <ChatworkLink onClick={() => setEditing(true)}>
          <FiMessageCircle size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
          Chatworkと連携する
        </ChatworkLink>
      </ChatworkRow>
    );
  }

  return (
    <ChatworkRow>
      <ChatworkTokenInput
        type="password"
        placeholder="ChatworkのAPIトークン"
        value={tokenInput}
        onChange={(e) => setTokenInput(e.target.value)}
        disabled={saving}
      />
      <ChatworkSaveButton onClick={handleSave} disabled={saving || !tokenInput.trim()}>
        {saving ? '確認中...' : '登録'}
      </ChatworkSaveButton>
      <ChatworkLink onClick={() => { setEditing(false); setError(''); }}>取消</ChatworkLink>
      {error && <span style={{ fontSize: '0.7rem', color: '#e74c3c' }}>{error}</span>}
    </ChatworkRow>
  );
};

// ============================================
// コンポーネント
// ============================================

const StaffMasterPage = () => {
  const [staff, setStaff] = useState([]);
  const [operatorName, setOperatorName] = useState('');
  const [salesName, setSalesName] = useState('');

  const loadStaff = useCallback(async () => {
    try {
      const data = await fetchAllStaff();
      setStaff(data);
    } catch (error) {
      console.error('Failed to load staff:', error);
    }
  }, []);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const operators = staff.filter((s) => s.role === 'operator');
  const salesReps = staff.filter((s) => s.role === 'sales');

  const handleAddOperator = async () => {
    if (!operatorName.trim()) return;
    try {
      await addStaff(operatorName.trim(), 'operator');
      setOperatorName('');
      await loadStaff();
    } catch (error) {
      console.error('Failed to add operator:', error);
    }
  };

  const handleAddSales = async () => {
    if (!salesName.trim()) return;
    try {
      await addStaff(salesName.trim(), 'sales');
      setSalesName('');
      await loadStaff();
    } catch (error) {
      console.error('Failed to add sales rep:', error);
    }
  };

  const handleEmailBlur = async (staffId, email) => {
    try {
      await updateStaffEmail(staffId, email.trim());
      await loadStaff();
    } catch (error) {
      console.error('Failed to update staff email:', error);
    }
  };

  const handleDelete = async (staffId) => {
    try {
      await deleteStaff(staffId);
      await loadStaff();
    } catch (error) {
      console.error('Failed to delete staff:', error);
    }
  };

  /** Enterキーで追加 */
  const handleKeyDown = (e, addFn) => {
    if (e.key === 'Enter') addFn();
  };

  return (
    <PageContainer>
      <Title>担当者管理</Title>
      <SectionGrid>
        {/* 運用者リスト */}
        <Section>
          <SectionTitle><FiUser /> 運用者リスト</SectionTitle>
          <AddForm>
            <Input
              placeholder="氏名を入力..."
              value={operatorName}
              onChange={(e) => setOperatorName(e.target.value)}
                          />
            <AddButton onClick={handleAddOperator} disabled={!operatorName.trim()}>
              <FiPlus size={14} /> 追加
            </AddButton>
          </AddForm>
          <StaffList>
            {operators.length === 0 ? (
              <EmptyText>運用者が登録されていません</EmptyText>
            ) : (
              operators.map((s) => (
                <StaffItem key={s.id}>
                  <StaffInfo>
                    <StaffName>{s.name}</StaffName>
                    <EmailInput
                      key={`${s.id}-${s.email || ''}`}
                      type="email"
                      defaultValue={s.email || ''}
                      placeholder="メールアドレス（未設定）"
                      onBlur={(e) => handleEmailBlur(s.id, e.target.value)}
                    />
                    <ChatworkConnect staffId={s.id} />
                  </StaffInfo>
                  <DeleteButton onClick={() => handleDelete(s.id)}>
                    <FiTrash2 size={14} />
                  </DeleteButton>
                </StaffItem>
              ))
            )}
          </StaffList>
        </Section>

        {/* 営業者リスト */}
        <Section>
          <SectionTitle><FiUsers /> 営業者リスト</SectionTitle>
          <AddForm>
            <Input
              placeholder="氏名を入力..."
              value={salesName}
              onChange={(e) => setSalesName(e.target.value)}
                          />
            <AddButton onClick={handleAddSales} disabled={!salesName.trim()}>
              <FiPlus size={14} /> 追加
            </AddButton>
          </AddForm>
          <StaffList>
            {salesReps.length === 0 ? (
              <EmptyText>営業者が登録されていません</EmptyText>
            ) : (
              salesReps.map((s) => (
                <StaffItem key={s.id}>
                  <StaffInfo>
                    <StaffName>{s.name}</StaffName>
                    <EmailInput
                      key={`${s.id}-${s.email || ''}`}
                      type="email"
                      defaultValue={s.email || ''}
                      placeholder="メールアドレス（未設定）"
                      onBlur={(e) => handleEmailBlur(s.id, e.target.value)}
                    />
                    <ChatworkConnect staffId={s.id} />
                  </StaffInfo>
                  <DeleteButton onClick={() => handleDelete(s.id)}>
                    <FiTrash2 size={14} />
                  </DeleteButton>
                </StaffItem>
              ))
            )}
          </StaffList>
        </Section>
      </SectionGrid>
    </PageContainer>
  );
};

export default StaffMasterPage;
