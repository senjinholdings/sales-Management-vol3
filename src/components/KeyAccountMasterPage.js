import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { FiPlus, FiEdit2, FiTrash2, FiSave, FiX, FiUser, FiFileText, FiTarget } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';

// アカウント営業（増田管轄の大型自主提案）の対象企業リスト。
// IntroducerMasterPage.jsのCRUDパターン（fetchIntroducers/handleSubmit/handleDelete）をそのまま踏襲する。

const KEY_ACCOUNT_STATUS = ['未接触', 'アプローチ中', '商談化', '停止'];

const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
`;

const Title = styled.h1`
  color: #2c3e50;
  margin: 0;
`;

const Button = styled.button`
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.3s ease;

  &.primary {
    background: #3498db;
    color: white;
    &:hover { background: #2980b9; }
  }

  &.success {
    background: #27ae60;
    color: white;
    &:hover { background: #219a52; }
  }

  &.danger {
    background: #e74c3c;
    color: white;
    &:hover { background: #c0392b; }
  }

  &.secondary {
    background: #95a5a6;
    color: white;
    &:hover { background: #7f8c8d; }
  }
`;

const Table = styled.table`
  width: 100%;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  border-collapse: collapse;
  overflow: hidden;
`;

const TableHeader = styled.th`
  background: #f8f9fa;
  padding: 1rem;
  text-align: left;
  font-weight: 600;
  color: #2c3e50;
  border-bottom: 1px solid #dee2e6;
`;

const TableCell = styled.td`
  padding: 1rem;
  border-bottom: 1px solid #dee2e6;
  vertical-align: top;
`;

const StatusBadge = styled.span`
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;

  &.未接触 { background: #f8f9fa; color: #6c757d; }
  &.アプローチ中 { background: #fff3cd; color: #856404; }
  &.商談化 { background: #e8f5e8; color: #27ae60; }
  &.停止 { background: #fdecea; color: #e74c3c; }
`;

const ActionButtons = styled.div`
  display: flex;
  gap: 0.5rem;
`;

const Modal = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: white;
  padding: 2rem;
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
`;

const ModalTitle = styled.h2`
  margin: 0;
  color: #2c3e50;
`;

const Form = styled.form`
  display: grid;
  gap: 1rem;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
`;

const Label = styled.label`
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const Input = styled.input`
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;

  &:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
  }
`;

const Select = styled.select`
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  background: white;

  &:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
  }
`;

const TextArea = styled.textarea`
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  min-height: 80px;
  resize: vertical;
  font-family: inherit;

  &:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 1rem;
`;

const EmptyMessage = styled.div`
  text-align: center;
  color: #95a5a6;
  padding: 3rem 0;
  background: white;
  border-radius: 8px;
`;

function KeyAccountMasterPage() {
  const [keyAccounts, setKeyAccounts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [formData, setFormData] = useState({
    companyName: '',
    proposalTheme: '',
    status: '未接触',
    assignee: '増田',
    memo: ''
  });

  useEffect(() => {
    fetchKeyAccounts();
  }, []);

  const fetchKeyAccounts = async () => {
    try {
      setIsLoading(true);
      const ref = collection(db, 'keyAccounts');
      const q = query(ref, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const list = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setKeyAccounts(list);
    } catch (error) {
      console.error('対象企業リスト取得エラー:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.companyName.trim()) return;
    try {
      if (editingAccount) {
        await updateDoc(doc(db, 'keyAccounts', editingAccount.id), {
          ...formData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'keyAccounts'), {
          ...formData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      await fetchKeyAccounts();
      handleCloseModal();
    } catch (error) {
      console.error('対象企業の保存エラー:', error);
      alert('保存に失敗しました: ' + error.message);
    }
  };

  const handleEdit = (account) => {
    setEditingAccount(account);
    setFormData({
      companyName: account.companyName || '',
      proposalTheme: account.proposalTheme || '',
      status: account.status || '未接触',
      assignee: account.assignee || '増田',
      memo: account.memo || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (accountId) => {
    if (!window.confirm('この対象企業を削除してもよろしいですか？')) return;
    try {
      await deleteDoc(doc(db, 'keyAccounts', accountId));
      await fetchKeyAccounts();
    } catch (error) {
      console.error('対象企業の削除エラー:', error);
      alert('削除に失敗しました');
    }
  };

  const handleAdd = () => {
    setEditingAccount(null);
    setFormData({ companyName: '', proposalTheme: '', status: '未接触', assignee: '増田', memo: '' });
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingAccount(null);
    setFormData({ companyName: '', proposalTheme: '', status: '未接触', assignee: '増田', memo: '' });
  };

  return (
    <Container>
      <Header>
        <Title>アカウント営業 対象企業リスト</Title>
        <Button className="primary" onClick={handleAdd}>
          <FiPlus />
          新規登録
        </Button>
      </Header>

      {!isLoading && keyAccounts.length === 0 ? (
        <EmptyMessage>対象企業が登録されていません</EmptyMessage>
      ) : (
        <Table>
          <thead>
            <tr>
              <TableHeader>会社名</TableHeader>
              <TableHeader>提案テーマ</TableHeader>
              <TableHeader>状況</TableHeader>
              <TableHeader>担当者</TableHeader>
              <TableHeader>備考</TableHeader>
              <TableHeader>操作</TableHeader>
            </tr>
          </thead>
          <tbody>
            {keyAccounts.map(account => (
              <tr key={account.id}>
                <TableCell><strong>{account.companyName}</strong></TableCell>
                <TableCell>{account.proposalTheme || '-'}</TableCell>
                <TableCell>
                  <StatusBadge className={account.status}>{account.status}</StatusBadge>
                </TableCell>
                <TableCell>{account.assignee || '-'}</TableCell>
                <TableCell>{account.memo || '-'}</TableCell>
                <TableCell>
                  <ActionButtons>
                    <Button className="primary" onClick={() => handleEdit(account)} style={{ padding: '0.5rem', fontSize: '0.875rem' }}>
                      <FiEdit2 />
                    </Button>
                    <Button className="danger" onClick={() => handleDelete(account.id)} style={{ padding: '0.5rem', fontSize: '0.875rem' }}>
                      <FiTrash2 />
                    </Button>
                  </ActionButtons>
                </TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {showModal && (
        <Modal>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{editingAccount ? '対象企業編集' : '対象企業 新規登録'}</ModalTitle>
              <Button className="secondary" onClick={handleCloseModal} style={{ padding: '0.5rem' }}>
                <FiX />
              </Button>
            </ModalHeader>

            <Form onSubmit={handleSubmit}>
              <FormGroup>
                <Label><FiUser />会社名 *</Label>
                <Input type="text" name="companyName" value={formData.companyName} onChange={handleInputChange} required />
              </FormGroup>

              <FormGroup>
                <Label><FiTarget />提案テーマ（想定する自主提案の内容）</Label>
                <Input type="text" name="proposalTheme" value={formData.proposalTheme} onChange={handleInputChange} />
              </FormGroup>

              <FormGroup>
                <Label>状況</Label>
                <Select name="status" value={formData.status} onChange={handleInputChange}>
                  {KEY_ACCOUNT_STATUS.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </Select>
              </FormGroup>

              <FormGroup>
                <Label><FiUser />担当者</Label>
                <Input type="text" name="assignee" value={formData.assignee} onChange={handleInputChange} />
              </FormGroup>

              <FormGroup>
                <Label><FiFileText />備考</Label>
                <TextArea name="memo" value={formData.memo} onChange={handleInputChange} />
              </FormGroup>

              <ButtonGroup>
                <Button type="button" className="secondary" onClick={handleCloseModal}>キャンセル</Button>
                <Button type="submit" className="success"><FiSave />保存</Button>
              </ButtonGroup>
            </Form>
          </ModalContent>
        </Modal>
      )}
    </Container>
  );
}

export default KeyAccountMasterPage;
