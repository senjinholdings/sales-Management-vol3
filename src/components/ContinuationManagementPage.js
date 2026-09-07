import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import styled from 'styled-components';
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import {
  CONTINUATION_STATUSES,
  CONTINUATION_STATUS_COLORS,
  FOLLOW_UP_PHASES,
  FOLLOW_UP_PHASE_DETAILS,
  FOLLOW_UP_PHASE_COLORS,
  SALES_REPRESENTATIVES
} from '../data/constants.js';
import { FiSearch, FiChevronUp, FiChevronDown, FiMinus, FiEdit2, FiX } from 'react-icons/fi';
import { fetchClientMeetingSettings } from '../services/projectService.js';
import { ensureContinuationMealNa } from '../utils/continuationMealNa.js';

// ============================================
// Styled Components
// ============================================

const PageContainer = styled.div`
  max-width: 1800px;
  margin: 0 auto;
`;

const PageHeader = styled.div`
  margin-bottom: 1.5rem;
`;

const Title = styled.h1`
  font-size: 1.5rem;
  font-weight: 700;
  color: #2c3e50;
  margin: 0;
`;

const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
`;

const SummaryCard = styled.div`
  background: white;
  border-radius: 8px;
  padding: 1.25rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  border-left: 4px solid ${props => props.color || '#3498db'};
`;

const SummaryLabel = styled.div`
  font-size: 0.8rem;
  color: #7f8c8d;
  margin-bottom: 0.5rem;
`;

const SummaryValue = styled.div`
  font-size: 1.5rem;
  font-weight: 700;
  color: #2c3e50;
`;

const SummarySubValue = styled.div`
  font-size: 0.85rem;
  color: #95a5a6;
  margin-top: 0.25rem;
`;

const FilterSection = styled.div`
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  align-items: center;
`;

const SearchInputWrapper = styled.div`
  position: relative;
  flex: 0 0 280px;
`;

const SearchIcon = styled.div`
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: #95a5a6;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 0.6rem 0.75rem 0.6rem 2.25rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.875rem;
  &:focus { outline: none; border-color: #3498db; }
`;

const FilterDropdownContainer = styled.div`
  position: relative;
`;

const FilterDropdownButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 0.875rem;
  color: #2c3e50;
  white-space: nowrap;
  &:hover { border-color: #3498db; }
`;

const FilterDropdownList = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 1000;
  background: white;
  border: 1px solid #ddd;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 200px;
  max-height: 300px;
  overflow-y: auto;
  padding: 0.5rem 0;
`;

const FilterCheckboxItem = styled.label`
  display: flex;
  align-items: center;
  padding: 0.5rem 1rem;
  cursor: pointer;
  &:hover { background-color: #f5f5f5; }
  input { margin-right: 0.5rem; }
`;

const FilterToggleAllButton = styled.button`
  width: 100%;
  padding: 0.4rem 1rem;
  border: none;
  background: none;
  color: #3498db;
  cursor: pointer;
  font-size: 0.8rem;
  text-align: left;
  &:hover { background: #f0f8ff; }
`;

const TableContainer = styled.div`
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  overflow-x: auto;
  &::-webkit-scrollbar { height: 8px; }
  &::-webkit-scrollbar-track { background: #f1f1f1; }
  &::-webkit-scrollbar-thumb { background: #bdc3c7; border-radius: 4px; }
`;

const Table = styled.table`
  width: 100%;
  min-width: 1400px;
  border-collapse: collapse;
`;

const TableHead = styled.thead`
  background: #f8f9fa;
`;

const TableHeaderCell = styled.th`
  padding: 0.75rem 1rem;
  text-align: left;
  font-size: 0.8rem;
  font-weight: 600;
  color: #7f8c8d;
  white-space: nowrap;
  border-bottom: 2px solid #e9ecef;
  cursor: ${props => props.sortable ? 'pointer' : 'default'};
  user-select: none;
  &:hover { ${props => props.sortable && 'color: #2c3e50;'} }
`;

const TableRow = styled.tr`
  border-bottom: 1px solid #eee;
  &:hover { background: #f8f9fa; }
`;

const TableCell = styled.td`
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  color: #2c3e50;
  vertical-align: middle;
`;

const ContinuationBadge = styled.span`
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 500;
  color: white;
  background-color: ${props => CONTINUATION_STATUS_COLORS[props.status] || '#95a5a6'};
`;

const FollowUpBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 500;
  color: white;
  background-color: ${props => FOLLOW_UP_PHASE_COLORS[props.phase] || '#95a5a6'};
`;

const ProbabilityText = styled.span`
  font-size: 0.7rem;
  opacity: 0.9;
`;

const ElapsedDays = styled.span`
  font-weight: 600;
  color: ${props => props.color || '#999'};
`;

const ElapsedLabel = styled.span`
  font-size: 0.75rem;
  color: #95a5a6;
  margin-left: 0.25rem;
`;

const UrgentBadge = styled.span`
  display: inline-block;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  background-color: #e74c3c;
  margin-left: 0.5rem;
`;

const OverdueBadge = styled.span`
  display: inline-block;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  background-color: #8e44ad;
  margin-left: 0.5rem;
`;

const MeetingStatusText = styled.span`
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  color: ${props => (props.$active ? '#27ae60' : '#95a5a6')};
`;

const InlineSelect = styled.select`
  padding: 0.3rem 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  background: white;
  cursor: pointer;
  &:focus { outline: none; border-color: #3498db; }
`;

const NextActionCell = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 200px;
`;

const NextActionText = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const EditButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  color: #7f8c8d;
  flex-shrink: 0;
  &:hover { background: #f8f9fa; color: #3498db; border-color: #3498db; }
`;

const Modal = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: white;
  padding: 2rem;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
`;

const ModalTitle = styled.h3`
  font-size: 1.1rem;
  margin: 0 0 1.5rem;
  color: #2c3e50;
`;

const FormGroup = styled.div`
  margin-bottom: 1rem;
`;

const Label = styled.label`
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  color: #555;
  margin-bottom: 0.25rem;
`;

const Input = styled.input`
  width: 100%;
  padding: 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  box-sizing: border-box;
  &:focus { outline: none; border-color: #3498db; }
`;

const TextArea = styled.textarea`
  width: 100%;
  padding: 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  resize: vertical;
  min-height: 80px;
  box-sizing: border-box;
  &:focus { outline: none; border-color: #3498db; }
`;

const ModalButtons = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.5rem;
`;

const ModalButton = styled.button`
  padding: 0.6rem 1.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  background: ${props => props.primary ? '#3498db' : '#e9ecef'};
  color: ${props => props.primary ? 'white' : '#495057'};
  &:hover { opacity: 0.9; }
`;

const LoadingText = styled.div`
  text-align: center;
  padding: 3rem;
  color: #95a5a6;
  font-size: 1rem;
`;

const EmptyText = styled.div`
  text-align: center;
  padding: 3rem;
  color: #95a5a6;
  font-size: 0.9rem;
`;

// ============================================
// Helper Functions
// ============================================

const getElapsedDaysColor = (days) => {
  if (typeof days !== 'number') return '#999';
  if (days <= 14) return '#27ae60';
  if (days <= 30) return '#f39c12';
  if (days <= 60) return '#e67e22';
  return '#e74c3c';
};

const calculateElapsedDays = (deal) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const status = deal.continuationStatus || '施策実施中';
  let startDateStr;

  switch (status) {
    case '施策実施中':
      startDateStr = deal.confirmedDate;
      break;
    case '継続提案中':
      startDateStr = deal.continuationStartDate || deal.confirmedDate;
      break;
    case '終了':
      startDateStr = deal.projectEndDate;
      break;
    case '継続成約':
      return null;
    default:
      return null;
  }

  if (!startDateStr) return null;
  const startDate = new Date(startDateStr.replace(/\//g, '-'));
  startDate.setHours(0, 0, 0, 0);
  if (isNaN(startDate.getTime())) return null;
  return Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
};

const getElapsedLabel = (status) => {
  switch (status || '施策実施中') {
    case '施策実施中': return '成約から';
    case '継続提案中': return '提案開始から';
    case '終了': return '終了から';
    default: return '';
  }
};

const getDateStatus = (dateStr) => {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(dateStr);
  targetDate.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((targetDate - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 2) return 'urgent';
  return null;
};

const formatAmount = (amount) => {
  if (!amount) return '-';
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount);
};

// ============================================
// Component
// ============================================

const ContinuationManagementPage = () => {
  const [deals, setDeals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [continuationStatusFilter, setContinuationStatusFilter] = useState([...CONTINUATION_STATUSES]);
  const [followUpPhaseFilter, setFollowUpPhaseFilter] = useState([]);
  const [representativeFilter, setRepresentativeFilter] = useState([...SALES_REPRESENTATIVES]);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'none' });
  const [editModal, setEditModal] = useState({ show: false, deal: null });
  const [editFormData, setEditFormData] = useState({ nextAction: '', nextActionDate: '' });

  // Dropdown open states
  const [dropdownOpen, setDropdownOpen] = useState({
    continuationStatus: false,
    followUpPhase: false,
    representative: false
  });

  const dropdownRefs = {
    continuationStatus: useRef(null),
    followUpPhase: useRef(null),
    representative: useRef(null)
  };

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      Object.keys(dropdownRefs).forEach(key => {
        if (dropdownRefs[key].current && !dropdownRefs[key].current.contains(e.target)) {
          setDropdownOpen(prev => ({ ...prev, [key]: false }));
        }
      });
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const progressRef = collection(db, 'progressDashboard');
      const q = query(progressRef, where('status', '==', 'フェーズ8'));
      const snapshot = await getDocs(q);

      const items = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        items.push({
          id: docSnap.id,
          ...data,
          confirmedDate: data.confirmedDate || '',
          lastContactDate: data.lastContactDate?.toDate?.()?.toLocaleDateString('ja-JP') || data.lastContactDate || '',
          createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt || '',
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || '',
          nextActionDate: data.nextActionDate || null
        });
      });

      setDeals(items);
      console.log('✅ 継続管理データ取得:', items.length, '件');
    } catch (error) {
      console.error('💥 継続管理データ取得エラー:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchData]);

  // 会社ごとの定例MTG設定（clientMeetingSettings）を取得し、一覧の「定例」列に使う。
  // 会社単位のデータなので、同じ会社の別商材は同じ結果を共有する
  const [meetingSettingsByCompany, setMeetingSettingsByCompany] = useState(new Map());
  useEffect(() => {
    const uniqueCompanies = [...new Set(deals.map(d => d.companyName).filter(Boolean))];
    const missing = uniqueCompanies.filter(name => !meetingSettingsByCompany.has(name));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(missing.map(async (name) => {
        try {
          return [name, await fetchClientMeetingSettings(name)];
        } catch (error) {
          console.error('定例MTG設定取得エラー:', name, error);
          return [name, null];
        }
      }));
      if (cancelled) return;
      setMeetingSettingsByCompany(prev => {
        const next = new Map(prev);
        results.forEach(([name, settings]) => next.set(name, settings));
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [deals, meetingSettingsByCompany]);

  // Summary calculation
  const summary = useMemo(() => {
    const result = { 施策実施中: 0, 継続提案中: 0, 終了: 0, 継続成約: 0, 継続成約金額: 0 };
    deals.forEach(deal => {
      const status = deal.continuationStatus || '施策実施中';
      if (result[status] !== undefined) result[status]++;
      if (status === '継続成約' && deal.receivedOrderAmount) {
        result.継続成約金額 += Number(deal.receivedOrderAmount) || 0;
      }
    });
    return result;
  }, [deals]);

  // Filtered & sorted deals
  const filteredDeals = useMemo(() => {
    let result = deals.filter(deal => {
      const status = deal.continuationStatus || '施策実施中';
      if (!continuationStatusFilter.includes(status)) return false;
      if (followUpPhaseFilter.length > 0 && deal.followUpPhase && !followUpPhaseFilter.includes(deal.followUpPhase)) return false;
      const rep = deal.representative || '';
      if (!representativeFilter.includes(rep) && rep !== '') return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const companyName = (deal.companyName || '').toLowerCase();
        const productName = (deal.productName || '').toLowerCase();
        const proposalMenu = (deal.proposalMenu || '').toLowerCase();
        if (!companyName.includes(term) && !productName.includes(term) && !proposalMenu.includes(term)) return false;
      }
      return true;
    });

    if (sortConfig.key && sortConfig.direction !== 'none') {
      result = [...result].sort((a, b) => {
        let aValue, bValue;
        switch (sortConfig.key) {
          case 'companyName':
            aValue = (a.companyName || a.productName || '').toLowerCase();
            bValue = (b.companyName || b.productName || '').toLowerCase();
            break;
          case 'receivedOrderAmount':
            aValue = Number(a.receivedOrderAmount) || 0;
            bValue = Number(b.receivedOrderAmount) || 0;
            break;
          case 'confirmedDate':
            aValue = a.confirmedDate ? new Date(a.confirmedDate) : new Date(0);
            bValue = b.confirmedDate ? new Date(b.confirmedDate) : new Date(0);
            break;
          case 'elapsedDays':
            aValue = calculateElapsedDays(a) ?? -1;
            bValue = calculateElapsedDays(b) ?? -1;
            break;
          case 'nextActionDate':
            aValue = a.nextActionDate ? new Date(a.nextActionDate) : new Date(9999, 11, 31);
            bValue = b.nextActionDate ? new Date(b.nextActionDate) : new Date(9999, 11, 31);
            break;
          default:
            return 0;
        }
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [deals, searchTerm, continuationStatusFilter, followUpPhaseFilter, representativeFilter, sortConfig]);

  // Handlers
  const handleSort = (key) => {
    setSortConfig(prev => {
      if (prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      if (prev.direction === 'desc') return { key: null, direction: 'none' };
      return { key, direction: 'asc' };
    });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <FiMinus size={12} />;
    if (sortConfig.direction === 'asc') return <FiChevronUp size={12} />;
    return <FiChevronDown size={12} />;
  };

  const handleContinuationStatusChange = async (dealId, newStatus) => {
    try {
      const dealRef = doc(db, 'progressDashboard', dealId);
      const updateData = { continuationStatus: newStatus, updatedAt: serverTimestamp() };

      if (newStatus === '継続提案中') {
        updateData.continuationStartDate = new Date().toISOString().split('T')[0];
      }
      if (newStatus === '終了') {
        updateData.projectEndDate = new Date().toISOString().split('T')[0];
      }
      if (newStatus === '継続成約') {
        updateData.followUpPhase = 'フォロー5';
      }

      await updateDoc(dealRef, updateData);
      setDeals(prev => prev.map(deal => deal.id === dealId ? { ...deal, ...updateData } : deal));

      // 継続成約になった瞬間だけ、会食/定例打診のネクストアクションを自動で立てる
      // （さかのぼり生成はしないため、この直後にだけ呼ぶ）
      if (newStatus === '継続成約') {
        const target = deals.find(deal => deal.id === dealId);
        if (target) ensureContinuationMealNa({ ...target, ...updateData });
      }
    } catch (error) {
      console.error('継続ステータス更新エラー:', error);
      alert('ステータス更新に失敗しました');
      fetchData();
    }
  };

  const handleFollowUpPhaseChange = async (dealId, newPhase) => {
    try {
      const dealRef = doc(db, 'progressDashboard', dealId);
      const updateData = { followUpPhase: newPhase, updatedAt: serverTimestamp() };

      if (newPhase === 'フォロー5') {
        updateData.continuationStatus = '継続成約';
      }

      await updateDoc(dealRef, updateData);
      setDeals(prev => prev.map(deal => deal.id === dealId ? { ...deal, ...updateData } : deal));

      if (newPhase === 'フォロー5') {
        const target = deals.find(deal => deal.id === dealId);
        if (target) ensureContinuationMealNa({ ...target, ...updateData });
      }
    } catch (error) {
      console.error('フォローフェーズ更新エラー:', error);
      fetchData();
    }
  };

  const openEditModal = (deal) => {
    setEditFormData({ nextAction: deal.nextAction || '', nextActionDate: deal.nextActionDate || '' });
    setEditModal({ show: true, deal });
  };

  const handleSaveNextAction = async () => {
    if (!editModal.deal) return;
    try {
      const dealRef = doc(db, 'progressDashboard', editModal.deal.id);
      await updateDoc(dealRef, {
        nextAction: editFormData.nextAction,
        nextActionDate: editFormData.nextActionDate || null,
        updatedAt: serverTimestamp()
      });
      setDeals(prev => prev.map(deal =>
        deal.id === editModal.deal.id
          ? { ...deal, nextAction: editFormData.nextAction, nextActionDate: editFormData.nextActionDate || null }
          : deal
      ));
      setEditModal({ show: false, deal: null });
    } catch (error) {
      console.error('ネクストアクション更新エラー:', error);
      alert('更新に失敗しました');
    }
  };

  // Filter toggle helpers
  const toggleFilterItem = (setter, current, item) => {
    setter(current.includes(item) ? current.filter(i => i !== item) : [...current, item]);
  };

  const toggleAllFilter = (setter, current, allItems) => {
    setter(current.length === allItems.length ? [] : [...allItems]);
  };

  // Render
  return (
    <PageContainer>
      <PageHeader>
        <Title>継続管理</Title>
      </PageHeader>

      {/* Summary Cards */}
      <SummaryGrid>
        <SummaryCard color={CONTINUATION_STATUS_COLORS['施策実施中']}>
          <SummaryLabel>施策実施中</SummaryLabel>
          <SummaryValue>{summary.施策実施中}件</SummaryValue>
        </SummaryCard>
        <SummaryCard color={CONTINUATION_STATUS_COLORS['継続提案中']}>
          <SummaryLabel>継続提案中</SummaryLabel>
          <SummaryValue>{summary.継続提案中}件</SummaryValue>
        </SummaryCard>
        <SummaryCard color={CONTINUATION_STATUS_COLORS['終了']}>
          <SummaryLabel>終了</SummaryLabel>
          <SummaryValue>{summary.終了}件</SummaryValue>
        </SummaryCard>
        <SummaryCard color={CONTINUATION_STATUS_COLORS['継続成約']}>
          <SummaryLabel>継続成約</SummaryLabel>
          <SummaryValue>{summary.継続成約}件</SummaryValue>
          <SummarySubValue>{formatAmount(summary.継続成約金額)}</SummarySubValue>
        </SummaryCard>
      </SummaryGrid>

      {/* Filters */}
      <FilterSection>
        <SearchInputWrapper>
          <SearchIcon><FiSearch size={16} /></SearchIcon>
          <SearchInput
            type="text"
            placeholder="会社名・商材名で検索..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </SearchInputWrapper>

        {/* Continuation Status Filter */}
        <FilterDropdownContainer ref={dropdownRefs.continuationStatus}>
          <FilterDropdownButton onClick={() => setDropdownOpen(prev => ({ ...prev, continuationStatus: !prev.continuationStatus }))}>
            継続ステータス ({continuationStatusFilter.length}/{CONTINUATION_STATUSES.length})
          </FilterDropdownButton>
          {dropdownOpen.continuationStatus && (
            <FilterDropdownList>
              <FilterToggleAllButton onClick={() => toggleAllFilter(setContinuationStatusFilter, continuationStatusFilter, CONTINUATION_STATUSES)}>
                {continuationStatusFilter.length === CONTINUATION_STATUSES.length ? '全解除' : '全選択'}
              </FilterToggleAllButton>
              {CONTINUATION_STATUSES.map(status => (
                <FilterCheckboxItem key={status}>
                  <input
                    type="checkbox"
                    checked={continuationStatusFilter.includes(status)}
                    onChange={() => toggleFilterItem(setContinuationStatusFilter, continuationStatusFilter, status)}
                  />
                  <ContinuationBadge status={status}>{status}</ContinuationBadge>
                </FilterCheckboxItem>
              ))}
            </FilterDropdownList>
          )}
        </FilterDropdownContainer>

        {/* Follow-up Phase Filter */}
        <FilterDropdownContainer ref={dropdownRefs.followUpPhase}>
          <FilterDropdownButton onClick={() => setDropdownOpen(prev => ({ ...prev, followUpPhase: !prev.followUpPhase }))}>
            フォローフェーズ ({followUpPhaseFilter.length > 0 ? followUpPhaseFilter.length : '全て'})
          </FilterDropdownButton>
          {dropdownOpen.followUpPhase && (
            <FilterDropdownList>
              <FilterToggleAllButton onClick={() => setFollowUpPhaseFilter([])}>
                フィルター解除
              </FilterToggleAllButton>
              {FOLLOW_UP_PHASES.map(phase => (
                <FilterCheckboxItem key={phase}>
                  <input
                    type="checkbox"
                    checked={followUpPhaseFilter.includes(phase)}
                    onChange={() => toggleFilterItem(setFollowUpPhaseFilter, followUpPhaseFilter, phase)}
                  />
                  <FollowUpBadge phase={phase}>
                    {phase} {FOLLOW_UP_PHASE_DETAILS[phase]?.label}
                  </FollowUpBadge>
                </FilterCheckboxItem>
              ))}
            </FilterDropdownList>
          )}
        </FilterDropdownContainer>

        {/* Representative Filter */}
        <FilterDropdownContainer ref={dropdownRefs.representative}>
          <FilterDropdownButton onClick={() => setDropdownOpen(prev => ({ ...prev, representative: !prev.representative }))}>
            担当者 ({representativeFilter.length}/{SALES_REPRESENTATIVES.length})
          </FilterDropdownButton>
          {dropdownOpen.representative && (
            <FilterDropdownList>
              <FilterToggleAllButton onClick={() => toggleAllFilter(setRepresentativeFilter, representativeFilter, SALES_REPRESENTATIVES)}>
                {representativeFilter.length === SALES_REPRESENTATIVES.length ? '全解除' : '全選択'}
              </FilterToggleAllButton>
              {SALES_REPRESENTATIVES.map(rep => (
                <FilterCheckboxItem key={rep}>
                  <input
                    type="checkbox"
                    checked={representativeFilter.includes(rep)}
                    onChange={() => toggleFilterItem(setRepresentativeFilter, representativeFilter, rep)}
                  />
                  {rep}
                </FilterCheckboxItem>
              ))}
            </FilterDropdownList>
          )}
        </FilterDropdownContainer>
      </FilterSection>

      {/* Table */}
      <TableContainer>
        {isLoading ? (
          <LoadingText>読み込み中...</LoadingText>
        ) : filteredDeals.length === 0 ? (
          <EmptyText>該当する案件がありません</EmptyText>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell sortable onClick={() => handleSort('companyName')}>
                  会社名 {getSortIcon('companyName')}
                </TableHeaderCell>
                <TableHeaderCell>商材名</TableHeaderCell>
                <TableHeaderCell>提案メニュー</TableHeaderCell>
                <TableHeaderCell sortable onClick={() => handleSort('receivedOrderAmount')}>
                  元受注金額 {getSortIcon('receivedOrderAmount')}
                </TableHeaderCell>
                <TableHeaderCell sortable onClick={() => handleSort('confirmedDate')}>
                  成約日 {getSortIcon('confirmedDate')}
                </TableHeaderCell>
                <TableHeaderCell>継続ステータス</TableHeaderCell>
                <TableHeaderCell>フォローフェーズ</TableHeaderCell>
                <TableHeaderCell sortable onClick={() => handleSort('elapsedDays')}>
                  経過日数 {getSortIcon('elapsedDays')}
                </TableHeaderCell>
                <TableHeaderCell>ネクストアクション</TableHeaderCell>
                <TableHeaderCell sortable onClick={() => handleSort('nextActionDate')}>
                  期日 {getSortIcon('nextActionDate')}
                </TableHeaderCell>
                <TableHeaderCell>定例</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {filteredDeals.map(deal => {
                const contStatus = deal.continuationStatus || '施策実施中';
                const elapsed = calculateElapsedDays(deal);
                const dateStatus = getDateStatus(deal.nextActionDate);

                return (
                  <TableRow key={deal.id}>
                    <TableCell style={{ fontWeight: 500 }}>
                      {deal.companyName || '不明'}
                    </TableCell>
                    <TableCell>{deal.productName || '-'}</TableCell>
                    <TableCell>{deal.proposalMenu || '-'}</TableCell>
                    <TableCell>{formatAmount(deal.receivedOrderAmount)}</TableCell>
                    <TableCell>{deal.confirmedDate || '-'}</TableCell>
                    <TableCell>
                      <InlineSelect
                        value={contStatus}
                        onChange={e => handleContinuationStatusChange(deal.id, e.target.value)}
                        style={{ backgroundColor: CONTINUATION_STATUS_COLORS[contStatus] + '20', borderColor: CONTINUATION_STATUS_COLORS[contStatus] }}
                      >
                        {CONTINUATION_STATUSES.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </InlineSelect>
                    </TableCell>
                    <TableCell>
                      {contStatus === '継続提案中' || contStatus === '継続成約' ? (
                        <InlineSelect
                          value={deal.followUpPhase || ''}
                          onChange={e => handleFollowUpPhaseChange(deal.id, e.target.value)}
                          style={deal.followUpPhase ? {
                            backgroundColor: FOLLOW_UP_PHASE_COLORS[deal.followUpPhase] + '20',
                            borderColor: FOLLOW_UP_PHASE_COLORS[deal.followUpPhase]
                          } : {}}
                        >
                          <option value="">選択...</option>
                          {FOLLOW_UP_PHASES.map(p => (
                            <option key={p} value={p}>
                              {p} ({FOLLOW_UP_PHASE_DETAILS[p]?.label} {FOLLOW_UP_PHASE_DETAILS[p]?.probability}%)
                            </option>
                          ))}
                        </InlineSelect>
                      ) : (
                        <span style={{ color: '#bdc3c7' }}>-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {elapsed !== null ? (
                        <>
                          <ElapsedDays color={getElapsedDaysColor(elapsed)}>{elapsed}日</ElapsedDays>
                          <ElapsedLabel>{getElapsedLabel(contStatus)}</ElapsedLabel>
                        </>
                      ) : (
                        <span style={{ color: '#bdc3c7' }}>-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <NextActionCell>
                        <NextActionText>{deal.nextAction || '-'}</NextActionText>
                        <EditButton onClick={() => openEditModal(deal)} title="編集">
                          <FiEdit2 size={14} />
                        </EditButton>
                      </NextActionCell>
                    </TableCell>
                    <TableCell style={{ whiteSpace: 'nowrap' }}>
                      {deal.nextActionDate || '-'}
                      {dateStatus === 'urgent' && <UrgentBadge>急</UrgentBadge>}
                      {dateStatus === 'overdue' && <OverdueBadge>超過</OverdueBadge>}
                    </TableCell>
                    <TableCell style={{ whiteSpace: 'nowrap' }}>
                      {(() => {
                        const meetingSettings = meetingSettingsByCompany.get(deal.companyName);
                        const hasRecurring = !!meetingSettings?.recurringDayOfWeek;
                        return (
                          <MeetingStatusText $active={hasRecurring}>
                            {hasRecurring
                              ? `定例あり（毎週${meetingSettings.recurringDayOfWeek}${meetingSettings.recurringTime ? ' ' + meetingSettings.recurringTime : ''}）`
                              : '定例なし'}
                          </MeetingStatusText>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </TableContainer>

      {/* Edit Next Action Modal */}
      {editModal.show && (
        <Modal onClick={() => setEditModal({ show: false, deal: null })}>
          <ModalContent onClick={e => e.stopPropagation()}>
            <ModalTitle>
              ネクストアクション編集
              <span style={{ fontSize: '0.85rem', color: '#95a5a6', marginLeft: '0.5rem' }}>
                {editModal.deal?.companyName || editModal.deal?.productName || ''}
              </span>
            </ModalTitle>
            <FormGroup>
              <Label>ネクストアクション</Label>
              <TextArea
                value={editFormData.nextAction}
                onChange={e => setEditFormData(prev => ({ ...prev, nextAction: e.target.value }))}
                placeholder="次に取るべきアクションを入力..."
              />
            </FormGroup>
            <FormGroup>
              <Label>期日</Label>
              <Input
                type="date"
                value={editFormData.nextActionDate}
                onChange={e => setEditFormData(prev => ({ ...prev, nextActionDate: e.target.value }))}
              />
            </FormGroup>
            <ModalButtons>
              <ModalButton onClick={() => setEditModal({ show: false, deal: null })}>キャンセル</ModalButton>
              <ModalButton primary onClick={handleSaveNextAction}>保存</ModalButton>
            </ModalButtons>
          </ModalContent>
        </Modal>
      )}
    </PageContainer>
  );
};

export default ContinuationManagementPage;
