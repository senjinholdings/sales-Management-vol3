import React, { useState, useMemo, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { FiEye, FiPlus, FiEdit3, FiX, FiSave, FiTrash2, FiChevronUp, FiChevronDown, FiMinus } from 'react-icons/fi';
import { useNavigate, useLocation } from 'react-router-dom';
import { db } from '../firebase.js';
import { collection, query, where, orderBy, getDocs, updateDoc, doc, serverTimestamp, addDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { PROPOSAL_MENUS, PARTNER_PROPOSAL_MENUS, STATUSES, STATUS_COLORS, DEPARTMENT_NAMES } from '../data/constants.js';
import ReceivedOrderModal from './ReceivedOrderModal.js';
import { updateDealOrderInfo } from '../services/salesService.js';
import { useUndoContext } from '../contexts/UndoContext.js';

const DashboardContainer = styled.div`
  width: 100%;
  padding: 0 2rem;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
`;

const Title = styled.h2`
  color: #2c3e50;
  margin: 0;
`;

const FilterSection = styled.div`
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  margin-bottom: 2rem;
`;

const FilterGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 180px 180px;
  gap: 1rem;
  align-items: end;
`;

const SearchInput = styled.input`
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  
  &:focus {
    outline: none;
    border-color: #3498db;
  }
`;

const FilterSelect = styled.select`
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  background: white;
  
  &:focus {
    outline: none;
    border-color: #3498db;
  }
`;

const FilterDropdown = styled.div`
  position: relative;
`;

const FilterButton = styled.button`
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  background: white;
  text-align: left;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  
  &:focus {
    outline: none;
    border-color: #3498db;
  }
  
  .count {
    font-size: 0.875rem;
    color: #666;
  }
`;

const DropdownContent = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 0.25rem;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  z-index: 100;
  max-height: 300px;
  overflow-y: auto;
`;

const DropdownHeader = styled.div`
  padding: 0.75rem;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const CheckboxList = styled.div`
  padding: 0.5rem;
`;

const CheckboxItem = styled.label`
  display: flex;
  align-items: center;
  padding: 0.5rem;
  cursor: pointer;
  
  &:hover {
    background: #f8f9fa;
  }
  
  input[type="checkbox"] {
    margin-right: 0.5rem;
  }
`;

const SelectButton = styled.button`
  padding: 0.25rem 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 0.875rem;
  
  &:hover {
    background: #f8f9fa;
  }
`;

const TableContainer = styled.div`
  width: 100%;
  overflow-x: auto;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  
  /* スクロールバーのスタイリング */
  &::-webkit-scrollbar {
    height: 8px;
  }
  
  &::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 4px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 4px;
    
    &:hover {
      background: #555;
    }
  }
`;

const Table = styled.table`
  min-width: 1400px; /* 部署情報カラムを追加したため最小幅を拡大 */
  width: 100%;
  background: white;
  border-collapse: collapse;
`;

const TableHeader = styled.thead`
  background: #f8f9fa;
`;

const TableRow = styled.tr`
  border-bottom: 1px solid #eee;
  
  &:hover {
    background: #f8f9fa;
  }
`;

const TableHeaderCell = styled.th`
  padding: 1rem;
  text-align: left;
  font-weight: 600;
  color: #2c3e50;
  cursor: ${props => props.sortable ? 'pointer' : 'default'};
  user-select: none;
  position: relative;
  
  &:hover {
    background-color: ${props => props.sortable ? '#f0f0f0' : 'transparent'};
  }
  
  .sort-indicator {
    margin-left: 0.5rem;
    font-size: 0.8rem;
    color: #666;
  }
`;

const TableCell = styled.td`
  padding: 1rem;
  vertical-align: middle;
`;


const StatusBadge = styled.span`
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.875rem;
  font-weight: 500;
  color: white;
  background-color: ${props => {
    switch (props.status) {
      case 'アポ設定': return '#3498db';
      case '提案作成中': return '#f39c12';
      case '検討中': return '#9b59b6';
      case '成約': return '#27ae60';
      case '保留': return '#95a5a6';
      case '見送り': return '#e74c3c';
      case '案件満了': return '#34495e';
      default: return '#95a5a6';
    }
  }};
`;

const InlineStatusSelect = styled.select`
  padding: 0.25rem 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  background: white;
  cursor: pointer;
  
  &:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
  }
`;

const ActionButton = styled.button`
  padding: 0.5rem 0.75rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.3s ease;
  margin-right: 0.5rem;
  
  &.view {
    background: #3498db;
    color: white;
    
    &:hover {
      background: #2980b9;
    }
  }
  
  &.add {
    background: #27ae60;
    color: white;
    
    &:hover {
      background: #219a52;
    }
  }
  
  &.edit {
    background: #f39c12;
    color: white;
    
    &:hover {
      background: #e67e22;
    }
  }
  
  &.delete {
    background: #e74c3c;
    color: white;
    
    &:hover {
      background: #c0392b;
    }
  }
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
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #eee;
`;

const ModalTitle = styled.h3`
  margin: 0;
  color: #2c3e50;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #95a5a6;
  padding: 0;
  
  &:hover {
    color: #7f8c8d;
  }
`;

const FormGroup = styled.div`
  margin-bottom: 1.5rem;
`;

const Label = styled.label`
  display: block;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 0.5rem;
`;

const Input = styled.input`
  width: 100%;
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
  width: 100%;
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

const ModalButtonGroup = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 2rem;
`;

const Button = styled.button`
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  
  &.primary {
    background: #3498db;
    color: white;
    
    &:hover {
      background: #2980b9;
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

const UrgentBadge = styled.span`
  background: #e74c3c;
  color: white;
  padding: 0.125rem 0.5rem;
  border-radius: 12px;
  font-size: 0.75rem;
  margin-left: 0.5rem;
`;

const LoadingMessage = styled.div`
  text-align: center;
  padding: 2rem;
  color: #7f8c8d;
`;

const EmptyMessage = styled.div`
  text-align: center;
  padding: 2rem;
  color: #7f8c8d;
`;

const CompanyBadge = styled.div`
  background: #8e44ad;
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 1rem;
  display: inline-block;
`;

const ActionsCell = styled.div`
  display: flex;
  align-items: center;
`;

const MetricsSection = styled.div`
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
`;

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
`;

const MetricCard = styled.div`
  background: white;
  border-radius: 6px;
  padding: 1rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
`;

const MetricTitle = styled.h4`
  margin: 0 0 0.5rem 0;
  color: #2c3e50;
  font-size: 0.875rem;
  font-weight: 600;
`;

const MetricValue = styled.div`
  font-size: 0.75rem;
  color: #666;
  line-height: 1.4;
  
  .current {
    font-weight: 600;
    color: #3498db;
  }
  
  .target {
    color: #27ae60;
  }
  
  .transition {
    color: #e67e22;
  }
  
  .actual {
    color: #9b59b6;
  }
`;

function PartnerProgressDashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState([]);
  const [representativeFilter, setRepresentativeFilter] = useState([]);
  const [deals, setDeals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'none' });
  const [editModal, setEditModal] = useState({ show: false, deal: null });
  const [receivedOrderModal, setReceivedOrderModal] = useState({ show: false, deal: null });
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [representativesList, setRepresentativesList] = useState([]);
  const [targetData, setTargetData] = useState(null);
  const [statusCounts, setStatusCounts] = useState({});
  const [transitionData, setTransitionData] = useState({});
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showRepresentativeDropdown, setShowRepresentativeDropdown] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { recordAction } = useUndoContext();
  
  // パートナー会社を判定
  const getPartnerCompany = () => {
    const path = window.location.pathname;
    if (path.startsWith('/partner-entry/piala')) {
      return '株式会社ピアラ';
    }
    return null;
  };
  
  const partnerCompany = getPartnerCompany();
  
  // 担当者リストを取得
  const fetchRepresentatives = useCallback(async () => {
    try {
      console.log('👤 パートナー案件一覧: 担当者データ取得開始');
      const representativesRef = collection(db, 'representatives');
      const q = query(representativesRef, where('companyName', '==', partnerCompany));
      const querySnapshot = await getDocs(q);
      
      const repsData = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.status === 'アクティブ') {
          repsData.push({
            id: docSnap.id,
            ...data
          });
        }
      });
      
      console.log('✅ パートナー案件一覧: 担当者データ取得成功:', repsData.length, '件');
      setRepresentativesList(repsData);
    } catch (error) {
      console.error('💥 パートナー案件一覧: 担当者データ取得エラー:', error);
      setRepresentativesList([]);
    }
  }, [partnerCompany]);
  
  // Firestoreから進捗データを取得（パートナー会社の案件のみ）
  const fetchProgressData = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('📊 パートナー案件一覧: データ取得開始');
      
      const progressRef = collection(db, 'progressDashboard');
      // 全件取得してクライアントサイドでフィルタリング（introducerフィールドが統一されていないため）
      const q = query(progressRef, orderBy('updatedAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const progressItems = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        
        // 厳格にパートナー会社の案件のみを抽出（他社データ混入防止）
        // 既存案件側の複製レコードも除外（新規側を正とする）
        if (data.introducer === partnerCompany && data.isExistingProject !== true) {
          progressItems.push({
            id: docSnap.id,
            ...data,
            lastContactDate: data.lastContactDate?.toDate?.()?.toLocaleDateString('ja-JP') ||
                            data.lastContactDate || null,
            nextActionDate: data.nextActionDate || null,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null
          });
        }
      });
      
      console.log('✅ パートナー案件一覧: データ取得成功:', progressItems.length, '件');
      setDeals(progressItems);
    } catch (error) {
      console.error('💥 パートナー案件一覧: データ取得エラー:', error);
      setDeals([]);
    } finally {
      setIsLoading(false);
    }
  }, [partnerCompany]);

  // 目標データを取得
  const fetchTargetData = useCallback(async (representativeId) => {
    if (!representativeId) {
      console.log('🔍 担当者IDが指定されていません');
      setTargetData(null);
      return;
    }

    try {
      console.log('🎯 目標データ取得開始:', representativeId);
      const currentMonth = new Date().toISOString().slice(0, 7);
      console.log('📅 対象年月:', currentMonth);
      
      const targetRef = collection(db, 'representativeTargets');
      const q = query(targetRef, 
        where('representativeId', '==', representativeId),
        where('yearMonth', '==', currentMonth)
      );
      const snapshot = await getDocs(q);
      
      console.log('📊 目標データ件数:', snapshot.size);
      
      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        console.log('✅ 目標データ取得成功:', data.targets);
        setTargetData(data.targets);
      } else {
        console.log('⚠️ 目標データが存在しません');
        setTargetData(null);
      }
    } catch (error) {
      console.error('💥 目標データ取得エラー:', error);
      setTargetData(null);
    }
  }, []);

  // ステータス別件数と遷移率を計算
  const calculateStatusMetrics = useCallback((filteredDeals) => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const targetStatuses = ['フェーズ1', 'フェーズ2', 'フェーズ3', 'フェーズ4', 'フェーズ5', 'フェーズ6', 'フェーズ7', 'フェーズ8'];

    // ステータス別件数を計算
    const counts = {};
    targetStatuses.forEach(status => {
      counts[status] = filteredDeals.filter(deal => deal.status === status).length;
    });
    setStatusCounts(counts);

    // 遷移率を計算（月内データのみ）
    const transitions = {};
    const statusTransitions = [
      { from: 'フェーズ1', to: 'フェーズ2' },
      { from: 'フェーズ2', to: 'フェーズ3' },
      { from: 'フェーズ3', to: 'フェーズ4' },
      { from: 'フェーズ4', to: 'フェーズ5' },
      { from: 'フェーズ5', to: 'フェーズ6' },
      { from: 'フェーズ6', to: 'フェーズ7' },
      { from: 'フェーズ7', to: 'フェーズ8' }
    ];
    
    statusTransitions.forEach(({ from, to }) => {
      const fromDeals = filteredDeals.filter(deal => {
        const createdMonth = deal.createdAt ? new Date(deal.createdAt.toDate?.() || deal.createdAt).toISOString().slice(0, 7) : '';
        return createdMonth === currentMonth && (deal.status === from || deal.status === to);
      });
      
      const fromCount = fromDeals.filter(deal => deal.status === from).length;
      const toCount = fromDeals.filter(deal => deal.status === to).length;
      
      if (fromCount > 0) {
        transitions[`${from}_to_${to}`] = Math.round((toCount / fromCount) * 100);
      } else {
        transitions[`${from}_to_${to}`] = '-';
      }
    });
    
    setTransitionData(transitions);
  }, []);
  
  useEffect(() => {
    fetchProgressData();
    fetchRepresentatives();
  }, [fetchProgressData, fetchRepresentatives]);

  // 担当者フィルター変更時に目標データを取得
  useEffect(() => {
    console.log('👥 担当者フィルター変更:', representativeFilter);
    console.log('📜 担当者リスト:', representativesList);
    
    // 複数選択対応: 1人だけ選択されている場合のみ目標データを表示
    if (representativeFilter.length === 1) {
      const rep = representativesList.find(r => r.name === representativeFilter[0]);
      console.log('🔍 マッチした担当者:', rep);
      if (rep) {
        fetchTargetData(rep.id);
      } else {
        console.log('⚠️ 担当者がリスト内に見つかりません');
        setTargetData(null);
      }
    } else {
      setTargetData(null);
    }
  }, [representativeFilter, representativesList, fetchTargetData]);

  // 期日が1週間以内かチェック
  const isUrgent = (dateString) => {
    if (!dateString) return false;
    const nextActionDate = new Date(dateString);
    const today = new Date();
    const oneWeekFromToday = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    return nextActionDate <= oneWeekFromToday;
  };

  // ソート機能
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key) {
      if (sortConfig.direction === 'asc') {
        direction = 'desc';
      } else if (sortConfig.direction === 'desc') {
        direction = 'none';
      } else {
        direction = 'asc';
      }
    }
    setSortConfig({ key, direction });
  };

  // フィルタリング&ソートされたデータ
  const filteredDeals = useMemo(() => {
    if (!Array.isArray(deals)) return [];
    
    try {
      // フィルタリング
      let filtered = deals.filter(deal => {
        if (!deal) return false;
        
        const productName = deal.productName || '';
        const proposalMenu = deal.proposalMenu || '';
        const status = deal.status || '';
        const representative = deal.partnerRepresentative || deal.representative || '';
        
        const matchesSearch = !searchTerm || 
                             productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             proposalMenu.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter.length === 0 || statusFilter.includes(status);
        const matchesRepresentative = representativeFilter.length === 0 || representativeFilter.includes(representative);
        
        return matchesSearch && matchesStatus && matchesRepresentative;
      });

      // ソート処理
      if (sortConfig.key && sortConfig.direction !== 'none') {
        filtered.sort((a, b) => {
          let aValue, bValue;
          
          switch (sortConfig.key) {
            case 'lastContactDate':
              // 日付フィールドのソート
              aValue = a.lastContactDate ? new Date(a.lastContactDate) : new Date(0);
              bValue = b.lastContactDate ? new Date(b.lastContactDate) : new Date(0);
              break;
            case 'nextActionDate':
              // 次回アクション日付のソート（日付なしは未来の日付として扱う）
              aValue = a.nextActionDate ? new Date(a.nextActionDate) : new Date(9999, 11, 31);
              bValue = b.nextActionDate ? new Date(b.nextActionDate) : new Date(9999, 11, 31);
              break;
            case 'productName':
              aValue = (a.productName || '').toLowerCase();
              bValue = (b.productName || '').toLowerCase();
              break;
            case 'proposalMenu':
              aValue = (a.proposalMenu || '').toLowerCase();
              bValue = (b.proposalMenu || '').toLowerCase();
              break;
            default:
              return 0;
          }
          
          if (aValue < bValue) {
            return sortConfig.direction === 'asc' ? -1 : 1;
          }
          if (aValue > bValue) {
            return sortConfig.direction === 'asc' ? 1 : -1;
          }
          return 0;
        });
      }

      return filtered;
    } catch (error) {
      console.error('フィルタリング・ソートエラー:', error);
      return deals;
    }
  }, [deals, searchTerm, statusFilter, representativeFilter, sortConfig]);

  // フィルタリングされたデータで指標を計算
  useEffect(() => {
    // 複数選択対応: 1人だけ選択されている場合のみ指標を計算
    if (representativeFilter.length === 1) {
      calculateStatusMetrics(filteredDeals);
    }
  }, [filteredDeals, representativeFilter, calculateStatusMetrics]);
  
  // ドロップダウンの外側クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.filter-dropdown')) {
        setShowStatusDropdown(false);
        setShowRepresentativeDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  // ページがフォーカスされた時に自動リロード
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('🔄 パートナー案件一覧: ページがアクティブになったため、データを再取得');
        fetchProgressData();
      }
    };
    
    const handleFocus = () => {
      console.log('🔄 パートナー案件一覧: ウィンドウがフォーカスされたため、データを再取得');
      fetchProgressData();
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchProgressData]);
  
  // ルート変更時にもデータを再取得
  useEffect(() => {
    console.log('🔄 パートナー案件一覧: ルート変更検知、データ再取得');
    fetchProgressData();
  }, [location.pathname, fetchProgressData]);

  const handleViewDetail = (id) => {
    navigate(`/partner-entry/piala/product/${id}`);
  };

  const handleAddAction = (deal) => {
    console.log('Deal data:', deal);
    
    // パートナー案件の場合は紹介者情報を渡す（パートナー担当者も渡す）
    const params = new URLSearchParams({
      productName: deal.productName || '',
      proposalMenu: deal.proposalMenu || '',
      representative: deal.partnerRepresentative || deal.representative || '',
      introducerId: deal.introducerId ? deal.introducerId.toString() : '1', // ピアラの場合は1
      introducer: deal.introducer || partnerCompany
    });
    
    navigate(`/partner-entry/piala/log-entry?${params.toString()}`);
  };
  
  const handleEdit = (deal) => {
    setEditModal({ 
      show: true, 
      deal: { 
        ...deal, 
        // パートナー画面では、編集時にpartnerRepresentativeを表示
        representative: deal.partnerRepresentative || deal.representative 
      } 
    });
  };
  
  const handleEditSave = async () => {
    try {
      const editedDeal = editModal.deal;
      const originalDeal = deals.find(d => d.id === editedDeal.id);
      
      if (!editedDeal || !originalDeal) {
        alert('編集データが見つかりません');
        return;
      }
      
      console.log('📝 案件編集開始:', editedDeal.id);
      
      // 変更内容を記録
      const changes = [];
      if (originalDeal.productName !== editedDeal.productName) {
        changes.push(`商材名を変更: ${originalDeal.productName} → ${editedDeal.productName}`);
      }
      if (originalDeal.proposalMenu !== editedDeal.proposalMenu) {
        changes.push(`提案メニューを変更: ${originalDeal.proposalMenu} → ${editedDeal.proposalMenu}`);
      }
      const originalPartnerRep = originalDeal.partnerRepresentative || originalDeal.representative;
      if (originalPartnerRep !== editedDeal.representative) {
        changes.push(`担当者を変更: ${originalPartnerRep} → ${editedDeal.representative}`);
      }
      
      if (changes.length === 0) {
        alert('変更内容がありません');
        return;
      }

      // 変更前のデータをバックアップ
      const originalData = {
        productName: originalDeal.productName,
        proposalMenu: originalDeal.proposalMenu,
        representative: originalDeal.representative,
        partnerRepresentative: originalDeal.partnerRepresentative
      };
      
      // Firestoreで案件を更新
      const dealRef = doc(db, 'progressDashboard', editedDeal.id);
      await updateDoc(dealRef, {
        productName: editedDeal.productName,
        proposalMenu: editedDeal.proposalMenu,
        // パートナー案件の場合は担当者を分離
        representative: '増田 陽', // 社内担当者は固定
        partnerRepresentative: editedDeal.representative, // パートナー担当者
        sub_department_name: editedDeal.sub_department_name || '',
        sub_department_owner: editedDeal.sub_department_owner || '',
        updatedAt: serverTimestamp()
      });
      
      console.log('✅ 案件更新成功');
      
      // 編集履歴をアクションログに記録
      const logEntry = {
        dealId: editedDeal.id,
        dealKey: `${editedDeal.productName}_${editedDeal.proposalMenu}`,
        productName: editedDeal.productName,
        proposalMenu: editedDeal.proposalMenu,
        action: '案件情報を編集',
        description: changes.join('\n'),
        status: editedDeal.status || 'アポ設定',
        nextAction: editedDeal.nextAction || '',
        nextActionDate: editedDeal.nextActionDate || null,
        // パートナー案件の場合は担当者を分離
        representative: '増田 陽', // 社内担当者は固定
        partnerRepresentative: editedDeal.representative, // パートナー担当者
        introducer: partnerCompany,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      const actionLogsRef = collection(db, 'actionLogs');
      const editLogDoc = await addDoc(actionLogsRef, logEntry);
      
      console.log('✅ 編集履歴をアクションログに記録');

      // Undo操作を記録
      recordAction({
        type: 'EDIT_DEAL_PARTNER',
        description: `案件「${originalDeal.productName}」を編集`,
        undoFunction: async () => {
          // 元のデータに戻す
          await updateDoc(dealRef, {
            productName: originalData.productName,
            proposalMenu: originalData.proposalMenu,
            representative: originalData.representative,
            partnerRepresentative: originalData.partnerRepresentative,
            updatedAt: serverTimestamp()
          });
          console.log('🔄 案件編集復元完了:', originalData.productName);
          
          // 編集ログを削除
          await deleteDoc(doc(db, 'actionLogs', editLogDoc.id));
          console.log('🔄 編集ログを削除');
          
          // データを再取得
          await fetchProgressData();
        }
      });
      
      // データを再取得
      await fetchProgressData();
      
      setEditModal({ show: false, deal: null });
      // alert('案件情報を更新しました'); // 通知は不要（undo通知で代替）
    } catch (error) {
      console.error('💥 案件編集エラー:', error);
      alert('更新に失敗しました: ' + error.message);
    }
  };
  
  const handleDelete = async (deal) => {
    if (!window.confirm(`案件「${deal.productName} - ${deal.proposalMenu}」を削除しますか？\n\n削除すると以下の場所からも削除されます：\n・案件一覧\n・看板ボード\n・アクションログ一覧`)) {
      return;
    }

    try {
      console.log('🗑 案件削除開始:', deal.id);

      // 削除前に関連データをバックアップ
      const dealBackup = { ...deal };
      
      // 関連するアクションログを取得してバックアップ
      const allActionLogsRef = collection(db, 'actionLogs');
      const actionLogQuery = query(allActionLogsRef, where('dealId', '==', deal.id));
      const actionLogSnapshot = await getDocs(actionLogQuery);
      
      const relatedActionLogs = [];
      actionLogSnapshot.forEach((docSnap) => {
        if (docSnap.data().action !== 'パートナーにより案件削除') {
          relatedActionLogs.push({
            id: docSnap.id,
            data: docSnap.data()
          });
        }
      });

      // 削除履歴をアクションログに記録
      const logEntry = {
        dealId: deal.id,
        dealKey: `${deal.productName}_${deal.proposalMenu}`,
        productName: deal.productName,
        proposalMenu: deal.proposalMenu,
        action: 'パートナーにより案件削除',
        description: `案件「${deal.productName} - ${deal.proposalMenu}」がパートナーにより削除されました`,
        status: deal.status || 'アポ設定',
        nextAction: '',
        nextActionDate: null,
        representative: deal.representative,
        introducer: partnerCompany,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const actionLogsRef = collection(db, 'actionLogs');
      const deletionLogDoc = await addDoc(actionLogsRef, logEntry);
      console.log('✅ 削除履歴をアクションログに記録');

      // 案件をFirestoreから削除
      const dealRef = doc(db, 'progressDashboard', deal.id);
      await deleteDoc(dealRef);
      console.log('✅ 案件削除成功');

      // 関連するアクションログも削除
      const deletePromises = [];
      relatedActionLogs.forEach((log) => {
        deletePromises.push(deleteDoc(doc(db, 'actionLogs', log.id)));
      });
      
      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
        console.log('✅ 関連アクションログ削除成功:', deletePromises.length, '件');
      }

      // Undo操作を記録
      recordAction({
        type: 'DELETE_DEAL_PARTNER',
        description: `案件「${deal.productName}」を削除`,
        undoFunction: async () => {
          // 削除された案件を復元
          const docRef = doc(db, 'progressDashboard', dealBackup.id);
          
          const restoreData = {
            ...dealBackup,
            updatedAt: serverTimestamp()
          };
          
          // Timestampフィールドを除去
          if (restoreData.id) delete restoreData.id;
          
          await setDoc(docRef, restoreData);
          console.log('🔄 案件復元完了:', dealBackup.productName);
          
          // 関連するアクションログを復元
          const restoreLogPromises = relatedActionLogs.map(async (log) => {
            const logRef = doc(db, 'actionLogs', log.id);
            await setDoc(logRef, log.data);
          });
          
          if (restoreLogPromises.length > 0) {
            await Promise.all(restoreLogPromises);
            console.log('🔄 関連アクションログ復元完了:', restoreLogPromises.length, '件');
          }
          
          // 削除ログを削除
          await deleteDoc(doc(db, 'actionLogs', deletionLogDoc.id));
          console.log('🔄 削除ログを削除');
          
          // データを再取得
          await fetchProgressData();
        }
      });

      // データを再取得
      await fetchProgressData();

      // alert('案件を削除しました'); // 通知は不要（undo通知で代替）
    } catch (error) {
      console.error('💥 案件削除エラー:', error);
      alert('削除に失敗しました: ' + error.message);
    }
  };
  
  const handleStatusChange = async (deal, newStatus) => {
    if (deal.status === newStatus) {
      return; // 変更なしの場合は何もしない
    }

    try {
      console.log('📊 ステータス変更開始:', deal.id, deal.status, '→', newStatus);

      // 「フェーズ8」ステータスの場合は受注情報入力モーダルを表示
      if (newStatus === 'フェーズ8') {
        setReceivedOrderModal({ show: true, deal });
        return; // モーダル表示して処理を一時停止
      }

      // 変更前の状態を保存
      const previousStatus = deal.status;
      const previousConfirmedDate = deal.confirmedDate;

      // Firestoreで案件ステータスを更新
      const dealRef = doc(db, 'progressDashboard', deal.id);
      const updateData = {
        status: newStatus,
        updatedAt: serverTimestamp()
      };
      
      // 「フェーズ8」ステータスに変更された時は確定日を自動記録
      if (newStatus === 'フェーズ8') {
        updateData.confirmedDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD形式
      }
      
      await updateDoc(dealRef, updateData);

      console.log('✅ ステータス更新成功');

      // ステータス変更履歴をアクションログに記録
      const logEntry = {
        dealId: deal.id,
        dealKey: `${deal.productName}_${deal.proposalMenu}`,
        productName: deal.productName,
        proposalMenu: deal.proposalMenu,
        action: 'ステータス変更',
        description: `ステータス変更：${deal.status} → ${newStatus}`,
        status: newStatus,
        nextAction: deal.nextAction || '',
        nextActionDate: deal.nextActionDate || null,
        representative: deal.representative,
        introducer: partnerCompany,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const actionLogsRef = collection(db, 'actionLogs');
      const statusLogDoc = await addDoc(actionLogsRef, logEntry);

      console.log('✅ ステータス変更履歴をアクションログに記録');

      // Undo操作を記録
      recordAction({
        type: 'STATUS_CHANGE_PARTNER',
        description: `ステータス変更「${previousStatus}」→「${newStatus}」`,
        undoFunction: async () => {
          // ステータスを元に戻す
          const undoUpdateData = {
            status: previousStatus,
            updatedAt: serverTimestamp()
          };
          
          // 確定日も元に戻す
          if (previousConfirmedDate !== undefined) {
            undoUpdateData.confirmedDate = previousConfirmedDate;
          } else if (newStatus === 'フェーズ8') {
            // フェーズ8時に確定日が追加されていた場合は削除
            undoUpdateData.confirmedDate = null;
          }
          
          await updateDoc(dealRef, undoUpdateData);
          console.log('🔄 ステータス復元完了:', previousStatus);
          
          // ステータス変更ログを削除
          await deleteDoc(doc(db, 'actionLogs', statusLogDoc.id));
          console.log('🔄 ステータス変更ログを削除');
          
          // データを再取得
          await fetchProgressData();
        }
      });

      // データを再取得
      await fetchProgressData();

      console.log('🎉 ステータス変更完了');
    } catch (error) {
      console.error('💥 ステータス変更エラー:', error);
      alert('ステータス変更に失敗しました: ' + error.message);
    }
  };
  
  // 受注情報保存処理
  const handleSaveReceivedOrder = async (orderData) => {
    try {
      setIsSavingOrder(true);
      console.log('💾 パートナー受注情報保存開始:', orderData);
      
      // salesService経由で受注情報を保存
      // 実施月はモーダルの受注日（YYYY-MM-DD）から導出する
      // （旧モーダルのreceivedOrderMonthは現行モーダルでは渡されず、undefinedのままだと更新に失敗する）
      await updateDealOrderInfo(
        orderData.dealId,
        orderData.receivedOrderMonth || (orderData.receivedOrderDate || '').slice(0, 7),
        orderData.receivedOrderAmount
      );

      console.log('✅ パートナー受注情報保存成功');
      
      // データを再取得してUI更新
      await fetchProgressData();
      
      // モーダルを閉じる
      setReceivedOrderModal({ show: false, deal: null });
      
      // 成功メッセージ
      alert('受注情報が保存されました');
      
    } catch (error) {
      console.error('💥 パートナー受注情報保存エラー:', error);
      alert('受注情報の保存に失敗しました: ' + error.message);
    } finally {
      setIsSavingOrder(false);
    }
  };
  
  // 受注モーダルのキャンセル処理
  const handleCancelReceivedOrder = () => {
    setReceivedOrderModal({ show: false, deal: null });
  };

  // ユニークなステータス一覧を取得
  const getUniqueStatuses = () => {
    const statuses = [...new Set(deals.map(deal => deal.status).filter(Boolean))];
    return statuses.sort();
  };

  // ユニークな担当者一覧を取得
  const getUniqueRepresentatives = () => {
    const representatives = [...new Set(deals.map(deal => deal.partnerRepresentative || deal.representative).filter(Boolean))];
    return representatives.sort();
  };

  return (
    <DashboardContainer>
      <Header>
        <div>
          <CompanyBadge>{partnerCompany}</CompanyBadge>
          <Title>案件進捗一覧</Title>
        </div>
      </Header>

      <FilterSection>
        <FilterGrid>
          <div>
            <label>🔍 検索</label>
            <SearchInput
              type="text"
              placeholder="商材名・提案メニューで検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div>
            <label>📊 ステータス</label>
            <FilterDropdown className="filter-dropdown">
              <FilterButton onClick={() => setShowStatusDropdown(!showStatusDropdown)}>
                <span>
                  {statusFilter.length === 0 ? '全てのステータス' : 
                   statusFilter.length === getUniqueStatuses().length ? '全てのステータス' :
                   `${statusFilter.length}件選択中`}
                </span>
                <FiChevronDown />
              </FilterButton>
              {showStatusDropdown && (
                <DropdownContent>
                  <DropdownHeader>
                    <SelectButton onClick={() => setStatusFilter(getUniqueStatuses())}>全選択</SelectButton>
                    <SelectButton onClick={() => setStatusFilter([])}>全解除</SelectButton>
                  </DropdownHeader>
                  <CheckboxList>
                    {getUniqueStatuses().map(status => (
                      <CheckboxItem key={status}>
                        <input
                          type="checkbox"
                          checked={statusFilter.includes(status)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setStatusFilter([...statusFilter, status]);
                            } else {
                              setStatusFilter(statusFilter.filter(s => s !== status));
                            }
                          }}
                        />
                        {status}
                      </CheckboxItem>
                    ))}
                  </CheckboxList>
                </DropdownContent>
              )}
            </FilterDropdown>
          </div>
          <div>
            <label>👤 担当者</label>
            <FilterDropdown className="filter-dropdown">
              <FilterButton onClick={() => setShowRepresentativeDropdown(!showRepresentativeDropdown)}>
                <span>
                  {representativeFilter.length === 0 ? '全ての担当者' : 
                   representativeFilter.length === getUniqueRepresentatives().length ? '全ての担当者' :
                   `${representativeFilter.length}件選択中`}
                </span>
                <FiChevronDown />
              </FilterButton>
              {showRepresentativeDropdown && (
                <DropdownContent>
                  <DropdownHeader>
                    <SelectButton onClick={() => setRepresentativeFilter(getUniqueRepresentatives())}>全選択</SelectButton>
                    <SelectButton onClick={() => setRepresentativeFilter([])}>全解除</SelectButton>
                  </DropdownHeader>
                  <CheckboxList>
                    {getUniqueRepresentatives().map(rep => (
                      <CheckboxItem key={rep}>
                        <input
                          type="checkbox"
                          checked={representativeFilter.includes(rep)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setRepresentativeFilter([...representativeFilter, rep]);
                            } else {
                              setRepresentativeFilter(representativeFilter.filter(r => r !== rep));
                            }
                          }}
                        />
                        {rep}
                      </CheckboxItem>
                    ))}
                  </CheckboxList>
                </DropdownContent>
              )}
            </FilterDropdown>
          </div>
        </FilterGrid>
      </FilterSection>

      {representativeFilter.length === 1 && targetData && (
        <MetricsSection>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: '#2c3e50' }}>
            {representativeFilter[0]}さんの目標・実績（{new Date().toISOString().slice(0, 7)}）
          </h3>
          <MetricsGrid>
            <MetricCard>
              <MetricTitle>アポ打診中</MetricTitle>
              <MetricValue>
                <div>
                  <span className="current">現在 {statusCounts['アポ打診中'] || 0}件</span> / 
                  <span className="target"> 目標 {targetData['アポ打診中']?.count || '-'}件</span>
                </div>
                <div>
                  <span className="transition">想定遷移率 {targetData['アポ打診中']?.transitionRate || '-'}%</span>
                </div>
                <div>
                  <span className="actual">実際遷移率 {transitionData['アポ打診中_to_初回アポ予定'] || '-'}%</span>
                </div>
              </MetricValue>
            </MetricCard>

            <MetricCard>
              <MetricTitle>初回アポ予定</MetricTitle>
              <MetricValue>
                <div>
                  <span className="current">現在 {statusCounts['初回アポ予定'] || 0}件</span> / 
                  <span className="target"> 目標 {targetData['初回アポ予定']?.count || '-'}件</span>
                </div>
                <div>
                  <span className="transition">想定遷移率 {targetData['初回アポ予定']?.transitionRate || '-'}%</span>
                </div>
                <div>
                  <span className="actual">実際遷移率 {transitionData['初回アポ予定_to_与件化_提案中'] || '-'}%</span>
                </div>
              </MetricValue>
            </MetricCard>

            <MetricCard>
              <MetricTitle>与件化_提案中</MetricTitle>
              <MetricValue>
                <div>
                  <span className="current">現在 {statusCounts['与件化_提案中'] || 0}件</span> / 
                  <span className="target"> 目標 {targetData['与件化_提案中']?.count || '-'}件</span>
                </div>
                <div>
                  <span className="transition">想定遷移率 {targetData['与件化_提案中']?.transitionRate || '-'}%</span>
                </div>
                <div>
                  <span className="actual">実際遷移率 {transitionData['与件化_提案中_to_検討中'] || '-'}%</span>
                </div>
              </MetricValue>
            </MetricCard>

            <MetricCard>
              <MetricTitle>検討中</MetricTitle>
              <MetricValue>
                <div>
                  <span className="current">現在 {statusCounts['検討中'] || 0}件</span> / 
                  <span className="target"> 目標 {targetData['検討中']?.count || '-'}件</span>
                </div>
                <div>
                  <span className="transition">想定遷移率 {targetData['検討中']?.transitionRate || '-'}%</span>
                </div>
                <div>
                  <span className="actual">実際遷移率 {transitionData['検討中_to_受注'] || '-'}%</span>
                </div>
              </MetricValue>
            </MetricCard>
          </MetricsGrid>
        </MetricsSection>
      )}

      {isLoading ? (
        <LoadingMessage>データを読み込み中...</LoadingMessage>
      ) : (
        <TableContainer>
          <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell 
                sortable 
                onClick={() => handleSort('productName')}
                style={{ width: '120px' }}
              >
                商材名
                <span className="sort-indicator">
                  {sortConfig.key === 'productName' && sortConfig.direction === 'asc' && <FiChevronUp />}
                  {sortConfig.key === 'productName' && sortConfig.direction === 'desc' && <FiChevronDown />}
                  {sortConfig.key === 'productName' && sortConfig.direction === 'none' && <FiMinus />}
                  {sortConfig.key !== 'productName' && <FiMinus />}
                </span>
              </TableHeaderCell>
              <TableHeaderCell 
                sortable 
                onClick={() => handleSort('proposalMenu')}
                style={{ width: '120px' }}
              >
                提案メニュー
                <span className="sort-indicator">
                  {sortConfig.key === 'proposalMenu' && sortConfig.direction === 'asc' && <FiChevronUp />}
                  {sortConfig.key === 'proposalMenu' && sortConfig.direction === 'desc' && <FiChevronDown />}
                  {sortConfig.key === 'proposalMenu' && sortConfig.direction === 'none' && <FiMinus />}
                  {sortConfig.key !== 'proposalMenu' && <FiMinus />}
                </span>
              </TableHeaderCell>
              <TableHeaderCell style={{ minWidth: '90px' }}>担当者</TableHeaderCell>
              <TableHeaderCell style={{ width: '100px' }}>部署名</TableHeaderCell>
              <TableHeaderCell style={{ minWidth: '120px' }}>他部署担当者</TableHeaderCell>
              <TableHeaderCell style={{ minWidth: '80px' }}>ステータス</TableHeaderCell>
              <TableHeaderCell 
                sortable 
                onClick={() => handleSort('lastContactDate')}
                style={{ minWidth: '80px' }}
              >
                最終接触日
                <span className="sort-indicator">
                  {sortConfig.key === 'lastContactDate' && sortConfig.direction === 'asc' && <FiChevronUp />}
                  {sortConfig.key === 'lastContactDate' && sortConfig.direction === 'desc' && <FiChevronDown />}
                  {sortConfig.key === 'lastContactDate' && sortConfig.direction === 'none' && <FiMinus />}
                  {sortConfig.key !== 'lastContactDate' && <FiMinus />}
                </span>
              </TableHeaderCell>
              <TableHeaderCell 
                sortable 
                onClick={() => handleSort('nextActionDate')}
                style={{ minWidth: '150px' }}
              >
                次回アクション
                <span className="sort-indicator">
                  {sortConfig.key === 'nextActionDate' && sortConfig.direction === 'asc' && <FiChevronUp />}
                  {sortConfig.key === 'nextActionDate' && sortConfig.direction === 'desc' && <FiChevronDown />}
                  {sortConfig.key === 'nextActionDate' && sortConfig.direction === 'none' && <FiMinus />}
                  {sortConfig.key !== 'nextActionDate' && <FiMinus />}
                </span>
              </TableHeaderCell>
              <TableHeaderCell style={{ minWidth: '50px' }}>ログ</TableHeaderCell>
              <TableHeaderCell style={{ minWidth: '140px' }}>アクション</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <tbody>
            {filteredDeals.length === 0 ? (
              <TableRow>
                <TableCell colSpan="8">
                  <EmptyMessage>
                    {deals.length === 0 
                      ? '案件が登録されていません' 
                      : '検索条件に合致する案件が見つかりませんでした'
                    }
                  </EmptyMessage>
                </TableCell>
              </TableRow>
            ) : (
              filteredDeals.map(deal => (
                <TableRow key={deal.id}>
                  <TableCell style={{ minWidth: '120px' }}>
                    <strong>{deal.productName}</strong>
                  </TableCell>
                  <TableCell style={{ minWidth: '120px' }}>
                    {deal.proposalMenu}
                  </TableCell>
                  <TableCell style={{ minWidth: '90px' }}>{deal.partnerRepresentative || deal.representative || '-'}</TableCell>
                  <TableCell style={{ width: '100px' }}>{deal.sub_department_name || '-'}</TableCell>
                  <TableCell style={{ minWidth: '120px' }}>{deal.sub_department_owner || '-'}</TableCell>
                  <TableCell style={{ minWidth: '80px', padding: '0.5rem' }}>
                    <InlineStatusSelect
                      value={deal.status}
                      onChange={(e) => handleStatusChange(deal, e.target.value)}
                      style={{
                        width: '100%',
                        backgroundColor: STATUS_COLORS[deal.status] || '#f8f9fa',
                        color: ['失注', '保留'].includes(deal.status) ? '#fff' : '#000',
                        fontWeight: 'bold',
                        boxSizing: 'border-box'
                      }}
                    >
                      {STATUSES.map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </InlineStatusSelect>
                  </TableCell>
                  <TableCell style={{ minWidth: '80px' }}>{deal.lastContactDate}</TableCell>
                  <TableCell style={{ minWidth: '150px' }}>
                    {deal.nextAction}
                    {deal.nextActionDate && isUrgent(deal.nextActionDate) && (
                      <UrgentBadge>急</UrgentBadge>
                    )}
                    {deal.nextActionDate && (
                      <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.25rem' }}>
                        {deal.nextActionDate}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <ActionButton 
                      className="view"
                      onClick={() => handleViewDetail(deal.id)}
                    >
                      <FiEye />
                      詳細
                    </ActionButton>
                  </TableCell>
                  <TableCell>
                    <ActionsCell>
                      <ActionButton 
                        className="edit"
                        onClick={() => handleEdit(deal)}
                      >
                        <FiEdit3 />
                        編集
                      </ActionButton>
                      <ActionButton 
                        className="delete"
                        onClick={() => handleDelete(deal)}
                      >
                        <FiTrash2 />
                        削除
                      </ActionButton>
                      <ActionButton 
                        className="add"
                        onClick={() => handleAddAction(deal)}
                      >
                        <FiPlus />
                        追加
                      </ActionButton>
                    </ActionsCell>
                  </TableCell>
                </TableRow>
              ))
            )}
          </tbody>
        </Table>
        </TableContainer>
      )}

      {!isLoading && filteredDeals.length === 0 && deals.length === 0 && (
        <EmptyMessage>
          案件がまだ登録されていません。<br />
          アクションログを記録すると、自動的に案件が作成されます。
        </EmptyMessage>
      )}
      
      {/* 編集モーダル */}
      {editModal.show && editModal.deal && (
        <Modal onClick={() => setEditModal({ show: false, deal: null })}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>案件情報を編集</ModalTitle>
              <CloseButton onClick={() => setEditModal({ show: false, deal: null })}>
                <FiX />
              </CloseButton>
            </ModalHeader>
            
            <FormGroup>
              <Label>商材名 *</Label>
              <Input
                type="text"
                value={editModal.deal.productName}
                onChange={(e) => setEditModal(prev => ({
                  ...prev,
                  deal: { ...prev.deal, productName: e.target.value }
                }))}
                placeholder="商材名を入力"
                required
              />
            </FormGroup>
            
            <FormGroup>
              <Label>提案メニュー *</Label>
              <Select
                value={editModal.deal.proposalMenu}
                onChange={(e) => setEditModal(prev => ({
                  ...prev,
                  deal: { ...prev.deal, proposalMenu: e.target.value }
                }))}
                required
              >
                <option value="">選択してください</option>
                {PARTNER_PROPOSAL_MENUS.map(menu => (
                  <option key={menu} value={menu}>{menu}</option>
                ))}
              </Select>
            </FormGroup>
            
            <FormGroup>
              <Label>担当者 *</Label>
              <Select
                value={editModal.deal.representative}
                onChange={(e) => setEditModal(prev => ({
                  ...prev,
                  deal: { ...prev.deal, representative: e.target.value }
                }))}
                required
              >
                <option value="">選択してください</option>
                {representativesList.map(rep => (
                  <option key={rep.id} value={rep.name}>
                    {rep.name}{rep.department ? ` (${rep.department})` : ''}
                  </option>
                ))}
              </Select>
            </FormGroup>
            
            <FormGroup>
              <Label>部署名</Label>
              <Select
                value={editModal.deal.sub_department_name || ''}
                onChange={(e) => setEditModal(prev => ({
                  ...prev,
                  deal: { ...prev.deal, sub_department_name: e.target.value }
                }))}
              >
                <option value="">選択してください</option>
                {DEPARTMENT_NAMES.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </Select>
            </FormGroup>
            
            <FormGroup>
              <Label>他部署担当者名</Label>
              <Input
                type="text"
                value={editModal.deal.sub_department_owner || ''}
                onChange={(e) => setEditModal(prev => ({
                  ...prev,
                  deal: { ...prev.deal, sub_department_owner: e.target.value }
                }))}
                placeholder="他部署担当者名を入力"
              />
            </FormGroup>
            
            <ModalButtonGroup>
              <Button
                className="secondary"
                onClick={() => setEditModal({ show: false, deal: null })}
              >
                キャンセル
              </Button>
              <Button
                className="primary"
                onClick={handleEditSave}
              >
                <FiSave />
                保存
              </Button>
            </ModalButtonGroup>
          </ModalContent>
        </Modal>
      )}
      
      {/* 受注情報入力モーダル */}
      <ReceivedOrderModal
        isOpen={receivedOrderModal.show}
        onClose={handleCancelReceivedOrder}
        onSave={handleSaveReceivedOrder}
        deal={receivedOrderModal.deal}
        isLoading={isSavingOrder}
      />
    </DashboardContainer>
  );
}

export default PartnerProgressDashboard;