import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { FiPlus, FiEdit2, FiTrash2, FiSave, FiX, FiMail, FiUser, FiActivity, FiFileText, FiCalendar, FiCheckSquare, FiCheck } from 'react-icons/fi';
import { introducers as initialIntroducers, mockDeals } from '../data/mockData.js';
import { INTRODUCER_STATUS } from '../data/constants.js';
import { db } from '../firebase.js';
import { collection, query, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import {
  fetchIntroducerNextActions,
  addIntroducerNextAction,
  updateIntroducerNextActionStatus,
  deleteIntroducerNextAction
} from '../services/introducerNaService.js';
import { fetchAllStaff } from '../services/staffService.js';

const DAYS_OF_WEEK = ['月', '火', '水', '木', '金', '土', '日'];

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
    
    &:hover {
      background: #2980b9;
    }
  }
  
  &.success {
    background: #27ae60;
    color: white;
    
    &:hover {
      background: #219a52;
    }
  }
  
  &.danger {
    background: #e74c3c;
    color: white;
    
    &:hover {
      background: #c0392b;
    }
  }
  
  &.secondary {
    background: #95a5a6;
    color: white;
    
    &:hover {
      background: #7f8c8d;
    }
  }
`;

const StatusBadge = styled.span`
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  
  &.active {
    background: #e8f5e8;
    color: #27ae60;
  }
  
  &.inactive {
    background: #f8f9fa;
    color: #6c757d;
  }
  
  &.attention {
    background: #fff3cd;
    color: #856404;
  }
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

const CardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.25rem;
`;

const Card = styled.div`
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
`;

const CardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
`;

const CardName = styled.div`
  font-size: 1.1rem;
  font-weight: 700;
  color: #2c3e50;
`;

const CardActions = styled.div`
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
`;

const CardStatsRow = styled.div`
  display: flex;
  justify-content: space-around;
  padding: 0.75rem 0;
  border-top: 1px solid #eee;
  border-bottom: 1px solid #eee;
`;

const Stat = styled.div`
  text-align: center;
`;

const StatNumber = styled.div`
  font-size: 1.6rem;
  font-weight: 700;
  color: #2c3e50;
  line-height: 1.2;
`;

const StatLabel = styled.div`
  font-size: 0.75rem;
  color: #7f8c8d;
  margin-top: 0.15rem;
`;

const MeetingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: ${props => (props.$active ? '#27ae60' : '#e67e22')};
`;

const CardMeta = styled.div`
  font-size: 0.8rem;
  color: #6c757d;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const QuarterBar = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
`;

const SummaryBar = styled.div`
  display: flex;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  padding: 1.25rem 1rem;
  margin-bottom: 1.5rem;
`;

const SummaryStat = styled.div`
  flex: 1;
  text-align: center;
  border-right: 1px solid #eee;

  &:last-child {
    border-right: none;
  }
`;

const SummaryNumber = styled.div`
  font-size: 1.8rem;
  font-weight: 700;
  color: #2c3e50;
  line-height: 1.2;
`;

const SummaryLabel = styled.div`
  font-size: 0.8rem;
  color: #7f8c8d;
  margin-top: 0.25rem;
`;

const NaButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  color: #2c3e50;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: #f8f9fa;
  }
`;

const NaCountBadge = styled.span`
  background: #e74c3c;
  color: white;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  min-width: 1.1rem;
  height: 1.1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.3rem;
`;

const NaPreview = styled.div`
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.5rem 0.6rem;
  margin-top: 0.4rem;
  background: #fff9f0;
  border: 1px solid #fde8c8;
  border-radius: 6px;
  font-size: 0.8rem;
  color: #2c3e50;
  cursor: pointer;

  &:hover { background: #fef3e0; }
`;

const NaPreviewDue = styled.span`
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 700;
  color: #e67e22;
`;

const NaList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-height: 320px;
  overflow-y: auto;
  margin-bottom: 1rem;
`;

const NaItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  border: 1px solid #eee;
  background: ${props => (props.$done ? '#f8f9fa' : 'white')};
`;

const NaCheckBtn = styled.button`
  flex-shrink: 0;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 4px;
  border: 1px solid #ccc;
  background: ${props => (props.$done ? '#27ae60' : 'white')};
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-top: 0.1rem;
`;

const NaBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const NaContent = styled.div`
  font-size: 0.875rem;
  color: #2c3e50;
  text-decoration: ${props => (props.$done ? 'line-through' : 'none')};
  opacity: ${props => (props.$done ? 0.6 : 1)};
`;

const NaMetaRow = styled.div`
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: #7f8c8d;
`;

const NaDueBadge = styled.span`
  font-weight: 600;
  &.overdue { color: #e74c3c; }
  &.urgent { color: #e67e22; }
`;

const NaDeleteBtn = styled.button`
  flex-shrink: 0;
  border: none;
  background: none;
  color: #bbb;
  cursor: pointer;
  padding: 0.2rem;

  &:hover { color: #e74c3c; }
`;

const EmptyNaMessage = styled.div`
  text-align: center;
  color: #95a5a6;
  font-size: 0.85rem;
  padding: 1.5rem 0;
`;

const QuarterSelect = styled.select`
  padding: 0.5rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.95rem;
  background: white;
`;

// HomeDashboard.js等と同じ四半期(暦年ベース)の定義を踏襲
const getQuarterRange = (quarterKey) => {
  const [y, q] = quarterKey.split('-Q').map(Number);
  const startMonth = (q - 1) * 3;
  const endMonth = startMonth + 2;
  return {
    start: new Date(y, startMonth, 1),
    end: new Date(y, endMonth + 1, 0),
    label: `${y}年${startMonth + 1}月〜${endMonth + 1}月`
  };
};

const generateQuarterOptions = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  const options = [];
  for (let y = currentYear - 2; y <= currentYear + 1; y++) {
    for (let q = 1; q <= 4; q++) {
      options.push({ value: `${y}-Q${q}`, label: `${y}年 Q${q}（${(q - 1) * 3 + 1}〜${q * 3}月）` });
    }
  }
  return { options, current: `${currentYear}-Q${currentQ}` };
};

const isDateWithinRange = (dateValue, range) => {
  if (!dateValue) return false;
  const d = dateValue.toDate ? dateValue.toDate() : new Date(dateValue);
  if (isNaN(d.getTime())) return false;
  return d >= range.start && d <= range.end;
};

// NextActionManagementPage.js等と同じ期日判定ロジック
const getDueStatus = (dueDate) => {
  if (!dueDate) return 'none';
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((due - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'overdue';
  if (diff <= 2) return 'urgent';
  return 'normal';
};

function IntroducerMasterPage() {
  const [introducers, setIntroducers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingIntroducer, setEditingIntroducer] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deals, setDeals] = useState([]);
  const quarterOptions = generateQuarterOptions();
  const [selectedQuarter, setSelectedQuarter] = useState(quarterOptions.current);
  const [formData, setFormData] = useState({
    name: '',
    contactPerson: '',
    email: '',
    memo: '',
    status: 'アクティブ',
    hasRegularMeeting: false,
    regularMeetingDay: '',
    regularMeetingTime: ''
  });

  // ネクストアクション(NA)関連
  const [naModalIntroducer, setNaModalIntroducer] = useState(null);
  const [introducerNas, setIntroducerNas] = useState([]);
  const [naCounts, setNaCounts] = useState({});
  const [staffList, setStaffList] = useState([]);
  const [newNaContent, setNewNaContent] = useState('');
  const [newNaDueDate, setNewNaDueDate] = useState('');
  const [newNaAssignee, setNewNaAssignee] = useState('');
  const [naSaving, setNaSaving] = useState(false);

  // Firestoreから紹介者データと案件データを取得
  useEffect(() => {
    fetchIntroducers();
    fetchDeals();
    fetchAllStaff().then(setStaffList).catch((error) => console.error('スタッフ取得エラー:', error));
  }, []);

  // 各紹介者の未完了NA件数と直近の内容を取得（クリックしなくてもカード上で内容が分かるようにする）
  const loadNaCounts = async (introducersList) => {
    const summaries = {};
    await Promise.all(introducersList.map(async (introducer) => {
      try {
        const nas = await fetchIntroducerNextActions(introducer.id);
        const active = nas.filter(na => na.actionStatus !== 'done');
        // 期日が近い順（期日なしは末尾）にソートし、先頭をカードのプレビューに使う
        active.sort((a, b) => {
          if (!a.actionDueDate && !b.actionDueDate) return 0;
          if (!a.actionDueDate) return 1;
          if (!b.actionDueDate) return -1;
          return a.actionDueDate.localeCompare(b.actionDueDate);
        });
        summaries[introducer.id] = { count: active.length, next: active[0] || null };
      } catch (error) {
        summaries[introducer.id] = { count: 0, next: null };
      }
    }));
    setNaCounts(summaries);
  };

  const fetchIntroducers = async () => {
    try {
      setIsLoading(true);
      console.log('📋 紹介者データをFirestoreから取得開始');

      const introducersRef = collection(db, 'introducers');
      const q = query(introducersRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);

      const introducersList = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        introducersList.push({
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null
        });
      });

      console.log('✅ 紹介者データ取得成功:', introducersList.length, '件');
      setIntroducers(introducersList);
      loadNaCounts(introducersList);
    } catch (error) {
      console.error('💥 紹介者データ取得エラー:', error);
      // エラー時はモックデータを使用
      setIntroducers(initialIntroducers);
    } finally {
      setIsLoading(false);
    }
  };

  // Firestoreから案件データを取得
  const fetchDeals = async () => {
    try {
      console.log('📋 案件データをFirestoreから取得開始');
      
      const dealsRef = collection(db, 'progressDashboard');
      const querySnapshot = await getDocs(dealsRef);
      
      const dealsList = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        dealsList.push({
          id: docSnap.id,
          ...data
        });
      });
      
      console.log('✅ 案件データ取得成功:', dealsList.length, '件');
      setDeals(dealsList);
    } catch (error) {
      console.error('💥 案件データ取得エラー:', error);
      // エラー時はモックデータを使用
      setDeals(mockDeals);
    }
  };

  // 紹介件数を計算（Firestoreの案件データから、累計）
  const getIntroductionCount = (introducerName) => {
    return deals.filter(deal => deal.introducer === introducerName).length;
  };

  // 選択中の四半期に登録された紹介数
  const getQuarterlyReferralCount = (introducerName) => {
    const range = getQuarterRange(selectedQuarter);
    return deals.filter(deal => (
      deal.introducer === introducerName && isDateWithinRange(deal.createdAt, range)
    )).length;
  };

  // 選択中の四半期に成約(フェーズ8)した数
  const getQuarterlyWonCount = (introducerName) => {
    const range = getQuarterRange(selectedQuarter);
    return deals.filter(deal => (
      deal.introducer === introducerName
      && deal.status === 'フェーズ8'
      && isDateWithinRange(deal.confirmedDate, range)
    )).length;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: checked
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      if (editingIntroducer) {
        // 編集
        console.log('✏️ 紹介者編集開始:', editingIntroducer.id);
        const introducerRef = doc(db, 'introducers', editingIntroducer.id);
        await updateDoc(introducerRef, {
          ...formData,
          updatedAt: serverTimestamp()
        });
        console.log('✅ 紹介者編集成功');
      } else {
        // 新規追加
        console.log('➕ 紹介者新規追加開始');
        await addDoc(collection(db, 'introducers'), {
          ...formData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        console.log('✅ 紹介者新規追加成功');
      }
      
      // データを再取得して画面を更新
      await fetchIntroducers();
      handleCloseModal();
    } catch (error) {
      console.error('💥 紹介者保存エラー:', error);
      alert('紹介者の保存に失敗しました: ' + error.message);
    }
  };

  const handleEdit = (introducer) => {
    setEditingIntroducer(introducer);
    setFormData({
      name: introducer.name,
      contactPerson: introducer.contactPerson,
      email: introducer.email,
      memo: introducer.memo,
      status: introducer.status,
      hasRegularMeeting: introducer.hasRegularMeeting || false,
      regularMeetingDay: introducer.regularMeetingDay || '',
      regularMeetingTime: introducer.regularMeetingTime || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (introducerId) => {
    if (window.confirm('この紹介者を削除してもよろしいですか？')) {
      try {
        console.log('🗑️ 紹介者削除開始:', introducerId);
        await deleteDoc(doc(db, 'introducers', introducerId));
        console.log('✅ 紹介者削除成功');
        
        // データを再取得して画面を更新
        await fetchIntroducers();
      } catch (error) {
        console.error('💥 紹介者削除エラー:', error);
        alert('紹介者の削除に失敗しました: ' + error.message);
      }
    }
  };

  const handleAdd = () => {
    setEditingIntroducer(null);
    setFormData({
      name: '',
      contactPerson: '',
      email: '',
      memo: '',
      status: 'アクティブ',
      hasRegularMeeting: false,
      regularMeetingDay: '',
      regularMeetingTime: ''
    });
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingIntroducer(null);
    setFormData({
      name: '',
      contactPerson: '',
      email: '',
      memo: '',
      status: 'アクティブ',
      hasRegularMeeting: false,
      regularMeetingDay: '',
      regularMeetingTime: ''
    });
  };

  // --- ネクストアクション(NA) ---

  const openNaModal = async (introducer) => {
    setNaModalIntroducer(introducer);
    setNewNaContent('');
    setNewNaDueDate('');
    setNewNaAssignee('');
    try {
      const nas = await fetchIntroducerNextActions(introducer.id);
      nas.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setIntroducerNas(nas);
    } catch (error) {
      console.error('NA取得エラー:', error);
      setIntroducerNas([]);
    }
  };

  const closeNaModal = () => {
    setNaModalIntroducer(null);
    setIntroducerNas([]);
  };

  const handleAddNa = async () => {
    if (!newNaContent.trim() || !naModalIntroducer) return;
    setNaSaving(true);
    try {
      await addIntroducerNextAction(naModalIntroducer.id, {
        actionContent: newNaContent.trim(),
        actionDueDate: newNaDueDate,
        actionAssignee: newNaAssignee,
        actionStatus: 'active',
      });
      setNewNaContent('');
      setNewNaDueDate('');
      setNewNaAssignee('');
      await openNaModal(naModalIntroducer);
      loadNaCounts(introducers);
    } catch (error) {
      console.error('NA追加エラー:', error);
      alert('ネクストアクションの追加に失敗しました');
    } finally {
      setNaSaving(false);
    }
  };

  const handleToggleNaDone = async (na) => {
    if (!naModalIntroducer) return;
    const newStatus = na.actionStatus === 'done' ? 'active' : 'done';
    try {
      await updateIntroducerNextActionStatus(naModalIntroducer.id, na.id, newStatus);
      setIntroducerNas(prev => prev.map(item => item.id === na.id ? { ...item, actionStatus: newStatus } : item));
      loadNaCounts(introducers);
    } catch (error) {
      console.error('NAステータス更新エラー:', error);
    }
  };

  const handleDeleteNa = async (na) => {
    if (!naModalIntroducer) return;
    if (!window.confirm('このネクストアクションを削除しますか？')) return;
    try {
      await deleteIntroducerNextAction(naModalIntroducer.id, na.id);
      setIntroducerNas(prev => prev.filter(item => item.id !== na.id));
      loadNaCounts(introducers);
    } catch (error) {
      console.error('NA削除エラー:', error);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'アクティブ': return 'active';
      case '非稼働': return 'inactive';
      case '要確認': return 'attention';
      default: return 'inactive';
    }
  };

  // 全体サマリー（パートナー数・定例実施中数・選択中四半期の紹介数/成約数の合計）
  const totalPartnerCount = introducers.length;
  const activeMeetingCount = introducers.filter(i => i.hasRegularMeeting).length;
  const totalQuarterlyReferralCount = introducers.reduce((sum, i) => sum + getQuarterlyReferralCount(i.name), 0);
  const totalQuarterlyWonCount = introducers.reduce((sum, i) => sum + getQuarterlyWonCount(i.name), 0);

  return (
    <Container>
      <Header>
        <Title>紹介者マスター</Title>
        <Button className="primary" onClick={handleAdd}>
          <FiPlus />
          新規登録
        </Button>
      </Header>

      <SummaryBar>
        <SummaryStat>
          <SummaryNumber>{totalPartnerCount}</SummaryNumber>
          <SummaryLabel>パートナー数</SummaryLabel>
        </SummaryStat>
        <SummaryStat>
          <SummaryNumber>{activeMeetingCount}</SummaryNumber>
          <SummaryLabel>定例実施中のパートナー数</SummaryLabel>
        </SummaryStat>
        <SummaryStat>
          <SummaryNumber>{totalQuarterlyReferralCount}件</SummaryNumber>
          <SummaryLabel>選択四半期の合計紹介数</SummaryLabel>
        </SummaryStat>
        <SummaryStat>
          <SummaryNumber>{totalQuarterlyWonCount}件</SummaryNumber>
          <SummaryLabel>選択四半期の合計成約数</SummaryLabel>
        </SummaryStat>
      </SummaryBar>

      <QuarterBar>
        <Label style={{ margin: 0 }}>集計対象四半期</Label>
        <QuarterSelect value={selectedQuarter} onChange={(e) => setSelectedQuarter(e.target.value)}>
          {quarterOptions.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </QuarterSelect>
      </QuarterBar>

      <CardGrid>
        {introducers.map(introducer => (
          <Card key={introducer.id}>
            <CardHeader>
              <div>
                <CardName>{introducer.name}</CardName>
                <StatusBadge className={getStatusBadgeClass(introducer.status)} style={{ marginTop: '0.4rem', display: 'inline-block' }}>
                  {introducer.status}
                </StatusBadge>
              </div>
              <CardActions>
                <Button
                  className="primary"
                  onClick={() => handleEdit(introducer)}
                  style={{ padding: '0.5rem', fontSize: '0.875rem' }}
                >
                  <FiEdit2 />
                </Button>
                <Button
                  className="danger"
                  onClick={() => handleDelete(introducer.id)}
                  style={{ padding: '0.5rem', fontSize: '0.875rem' }}
                >
                  <FiTrash2 />
                </Button>
              </CardActions>
            </CardHeader>

            <CardStatsRow>
              <Stat>
                <StatNumber>{getQuarterlyReferralCount(introducer.name)}件</StatNumber>
                <StatLabel>今四半期紹介</StatLabel>
              </Stat>
              <Stat>
                <StatNumber>{getQuarterlyWonCount(introducer.name)}件</StatNumber>
                <StatLabel>今四半期成約</StatLabel>
              </Stat>
            </CardStatsRow>

            <MeetingRow $active={!!introducer.hasRegularMeeting}>
              <FiCalendar />
              {introducer.hasRegularMeeting
                ? `定例実施中${introducer.regularMeetingDay ? `（毎週${introducer.regularMeetingDay}${introducer.regularMeetingTime ? ' ' + introducer.regularMeetingTime : ''}）` : ''}`
                : '定例未実施'}
            </MeetingRow>

            <CardMeta>
              <div><FiUser style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />{introducer.contactPerson || '担当者未設定'}</div>
              <div><FiMail style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />{introducer.email || '-'}</div>
              <div>累計紹介件数: {getIntroductionCount(introducer.name)}件</div>
              {introducer.memo && <div><FiFileText style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />{introducer.memo}</div>}
            </CardMeta>

            <NaButton onClick={() => openNaModal(introducer)}>
              <FiCheckSquare />
              ネクストアクション
              {naCounts[introducer.id]?.count > 0 && <NaCountBadge>{naCounts[introducer.id].count}</NaCountBadge>}
            </NaButton>
            {naCounts[introducer.id]?.next && (
              <NaPreview onClick={() => openNaModal(introducer)}>
                <span>{naCounts[introducer.id].next.actionContent}</span>
                {naCounts[introducer.id].next.actionDueDate && (
                  <NaPreviewDue>{naCounts[introducer.id].next.actionDueDate}</NaPreviewDue>
                )}
              </NaPreview>
            )}
          </Card>
        ))}
      </CardGrid>

      {showModal && (
        <Modal>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                {editingIntroducer ? '紹介者編集' : '紹介者新規登録'}
              </ModalTitle>
              <Button 
                className="secondary" 
                onClick={handleCloseModal}
                style={{ padding: '0.5rem' }}
              >
                <FiX />
              </Button>
            </ModalHeader>

            <Form onSubmit={handleSubmit}>
              <FormGroup>
                <Label>
                  <FiUser />
                  紹介者名 *
                </Label>
                <Input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                />
              </FormGroup>

              <FormGroup>
                <Label>
                  <FiUser />
                  担当者名
                </Label>
                <Input
                  type="text"
                  name="contactPerson"
                  value={formData.contactPerson}
                  onChange={handleInputChange}
                />
              </FormGroup>

              <FormGroup>
                <Label>
                  <FiMail />
                  メールアドレス
                </Label>
                <Input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                />
              </FormGroup>

              <FormGroup>
                <Label>
                  <FiActivity />
                  稼働状況
                </Label>
                <Select
                  name="status"
                  value={formData.status}
                  onChange={handleInputChange}
                >
                  {INTRODUCER_STATUS.map(status => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
              </FormGroup>

              <FormGroup>
                <Label style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    name="hasRegularMeeting"
                    checked={formData.hasRegularMeeting}
                    onChange={handleCheckboxChange}
                    style={{ width: '1.1rem', height: '1.1rem' }}
                  />
                  <FiCalendar />
                  定例MTGを実施中
                </Label>
              </FormGroup>

              {formData.hasRegularMeeting && (
                <FormGroup>
                  <Label>
                    <FiCalendar />
                    定例の曜日・時刻
                  </Label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Select
                      name="regularMeetingDay"
                      value={formData.regularMeetingDay}
                      onChange={handleInputChange}
                      style={{ flex: 1 }}
                    >
                      <option value="">曜日を選択</option>
                      {DAYS_OF_WEEK.map(day => (
                        <option key={day} value={day}>{day}曜日</option>
                      ))}
                    </Select>
                    <Input
                      type="time"
                      name="regularMeetingTime"
                      value={formData.regularMeetingTime}
                      onChange={handleInputChange}
                      style={{ flex: 1 }}
                    />
                  </div>
                </FormGroup>
              )}

              <FormGroup>
                <Label>
                  <FiFileText />
                  備考
                </Label>
                <TextArea
                  name="memo"
                  value={formData.memo}
                  onChange={handleInputChange}
                />
              </FormGroup>

              <ButtonGroup>
                <Button type="button" className="secondary" onClick={handleCloseModal}>
                  キャンセル
                </Button>
                <Button type="submit" className="success">
                  <FiSave />
                  保存
                </Button>
              </ButtonGroup>
            </Form>
          </ModalContent>
        </Modal>
      )}

      {naModalIntroducer && (
        <Modal>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{naModalIntroducer.name} のネクストアクション</ModalTitle>
              <Button className="secondary" onClick={closeNaModal} style={{ padding: '0.5rem' }}>
                <FiX />
              </Button>
            </ModalHeader>

            <NaList>
              {introducerNas.length === 0 ? (
                <EmptyNaMessage>ネクストアクションはまだありません</EmptyNaMessage>
              ) : (
                introducerNas.map(na => {
                  const done = na.actionStatus === 'done';
                  const dueStatus = done ? 'none' : getDueStatus(na.actionDueDate);
                  return (
                    <NaItem key={na.id} $done={done}>
                      <NaCheckBtn $done={done} onClick={() => handleToggleNaDone(na)} title={done ? '未完了に戻す' : '完了にする'}>
                        {done && <FiCheck size={14} />}
                      </NaCheckBtn>
                      <NaBody>
                        <NaContent $done={done}>{na.actionContent}</NaContent>
                        <NaMetaRow>
                          {na.actionDueDate && (
                            <NaDueBadge className={dueStatus}>
                              {na.actionDueDate}
                              {dueStatus === 'overdue' && ' 超過'}
                              {dueStatus === 'urgent' && ' 急'}
                            </NaDueBadge>
                          )}
                          {na.actionAssignee && <span>{na.actionAssignee}</span>}
                        </NaMetaRow>
                      </NaBody>
                      <NaDeleteBtn onClick={() => handleDeleteNa(na)} title="削除">
                        <FiTrash2 size={14} />
                      </NaDeleteBtn>
                    </NaItem>
                  );
                })
              )}
            </NaList>

            <Form onSubmit={(e) => { e.preventDefault(); handleAddNa(); }}>
              <FormGroup>
                <Label>内容 *</Label>
                <Input
                  type="text"
                  value={newNaContent}
                  onChange={(e) => setNewNaContent(e.target.value)}
                  placeholder="例: 定例MTGの日程調整を行う"
                  required
                />
              </FormGroup>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <FormGroup style={{ flex: 1 }}>
                  <Label>期日</Label>
                  <Input
                    type="date"
                    value={newNaDueDate}
                    onChange={(e) => setNewNaDueDate(e.target.value)}
                  />
                </FormGroup>
                <FormGroup style={{ flex: 1 }}>
                  <Label>担当者</Label>
                  <Select value={newNaAssignee} onChange={(e) => setNewNaAssignee(e.target.value)}>
                    <option value="">未設定</option>
                    {staffList.map(staff => (
                      <option key={staff.id} value={staff.name}>{staff.name}</option>
                    ))}
                  </Select>
                </FormGroup>
              </div>
              <ButtonGroup>
                <Button type="submit" className="success" disabled={naSaving}>
                  <FiPlus />
                  追加
                </Button>
              </ButtonGroup>
            </Form>
          </ModalContent>
        </Modal>
      )}
    </Container>
  );
}

export default IntroducerMasterPage; 