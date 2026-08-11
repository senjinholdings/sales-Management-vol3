import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import styled from 'styled-components';
import { FiSearch, FiChevronDown, FiChevronUp, FiPlus, FiTrash2, FiUpload, FiEdit3 } from 'react-icons/fi';
import { useSearchParams } from 'react-router-dom';
import { STATUS_COLORS, STATUSES, PHASE_DESCRIPTIONS } from '../data/constants.js';
import PhaseTooltip from './PhaseTooltip.js';
import { linkifyText } from '../utils/linkify.js';
import { fetchStaffByRole } from '../services/staffService.js';
import { db } from '../firebase.js';
import { collection, query, orderBy, getDocs, onSnapshot, deleteDoc, doc, updateDoc, serverTimestamp, addDoc, setDoc } from 'firebase/firestore';
import ReceivedOrderModal from './ReceivedOrderModal.js';

import { addSalesRecord } from '../services/projectService.js';
import { checkPhase4StagnationNa } from '../utils/phase4StagnationNa.js';
import { useUndoContext } from '../contexts/UndoContext.js';
import ProjectDetailPanel from './ProjectDetailPanel.js';

/**
 * アカウント営業（増田管轄の大型自主提案）専用の案件一覧ページ。
 * ProgressDashboard.js（新規案件一覧）と全く同じ構成・機能をベースに、
 * salesTrack==='account'の案件だけに絞って表示する。案件数が少ないため
 * AccountSalesDashboard.jsの集計と同様、新規/既存を分けず1つの一覧にまとめる。
 */

// ============================================
// 定数
// ============================================

const HOVER_COLOR = '#f0f7ff';
const NA_TRUNCATE_LENGTH = 40;
const RANKS = ['S', 'A', 'B', 'C'];
const ELAPSED_DAYS_THRESHOLD = 90;

/** 全営業レコードの全エントリからアクティブな最新NAを取得 */
const NEW_CASE_SUB_COL = 'newCaseSalesRecords';

/** 新規案件用: NA + 最新フェーズを取得。newCaseSalesRecords優先、なければsalesRecordsフォールバック */
const fetchSalesInfo = async (dealId) => {
  // 指定コレクションからレコード＋エントリを取得するヘルパー
  const collectData = async (subColName) => {
    const recordsRef = collection(db, 'progressDashboard', dealId, subColName);
    const recordsSnap = await getDocs(recordsRef);
    if (recordsSnap.empty) return { records: [], entries: [] };
    const records = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const entries = [];
    await Promise.all(
      recordsSnap.docs.map(async (recDoc) => {
        const entriesRef = collection(db, 'progressDashboard', dealId, subColName, recDoc.id, 'entries');
        const entriesSnap = await getDocs(entriesRef);
        entriesSnap.docs.forEach((entDoc) => {
          entries.push({ id: entDoc.id, ...entDoc.data() });
        });
      })
    );
    return { records, entries };
  };

  try {
    // まずnewCaseSalesRecordsを確認
    let { records, entries } = await collectData(NEW_CASE_SUB_COL);

    // なければ旧salesRecordsからもフォールバック参照
    if (records.length === 0 && entries.length === 0) {
      ({ records, entries } = await collectData('salesRecords'));
    }

    // 最新レコードのフェーズを取得
    let latestPhase = null;
    if (records.length > 0) {
      records.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return bTime - aTime;
      });
      latestPhase = records[0].phase || null;
    }

    // アクティブNA全件を収集（createdAt降順）
    const activeNaEntries = [];
    if (entries.length > 0) {
      entries.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return bTime - aTime;
      });
      entries.forEach(e => {
        if (e.actionContent && e.actionStatus !== 'done') {
          activeNaEntries.push(e);
        }
      });
    }

    // 最古レコードの「登録日」フィールド(date)を取得（経過日数計算用）
    let firstRecordDate = null;
    if (records.length > 0) {
      const oldest = records[records.length - 1];
      if (oldest.date) {
        firstRecordDate = new Date(oldest.date);
      }
    }

    const naEntry = activeNaEntries[0] || null;
    return { naEntry, latestPhase, activeNaEntries, firstRecordDate };
  } catch (error) {
    console.error('Failed to fetch sales info:', error);
    return { naEntry: null, latestPhase: null };
  }
};

// ============================================
// ユーティリティ
// ============================================

/** 経過日数を計算（createdAtから） */
const calcElapsedDays = (createdAt) => {
  if (!createdAt) return null;
  const created = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
  if (isNaN(created.getTime())) return null;
  const diff = Math.floor((new Date() - created) / (1000 * 60 * 60 * 24));
  return diff;
};

/** 期日バッジタイプを判定 */
const getDateStatus = (dateString) => {
  if (!dateString) return null;
  const nextActionDate = new Date(dateString);
  nextActionDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (nextActionDate < today) return 'overdue';
  const twoDaysFromToday = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
  if (nextActionDate <= twoDaysFromToday) return 'urgent';
  return null;
};

// ============================================
// Styled Components
// ============================================

const PageContainer = styled.div`
  max-width: 1800px;
  margin: 0 auto;
`;

const PageHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
`;

const Title = styled.h1`
  font-size: 1.5rem;
  font-weight: 700;
  color: #2c3e50;
  margin: 0;
`;

const FilterSection = styled.div`
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  margin-bottom: 1.5rem;
`;

const FilterGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 180px 180px 180px;
  gap: 1rem;
  align-items: end;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.875rem;
  &:focus { outline: none; border-color: #3498db; }
`;

const FilterDropdownContainer = styled.div`
  position: relative;
`;

const FilterDropdownButton = styled.button`
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.875rem;
  background: white;
  text-align: left;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  &:focus { outline: none; border-color: #3498db; }
  &:hover { background-color: #f5f5f5; }
`;

const FilterDropdownList = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  max-height: 300px;
  overflow-y: auto;
  z-index: 1000;
`;

const FilterCheckboxContainer = styled.div`
  padding: 0.5rem;
`;

const FilterCheckboxItem = styled.label`
  display: flex;
  align-items: center;
  padding: 0.5rem;
  cursor: pointer;
  &:hover { background-color: #f5f5f5; }
  input { margin-right: 0.5rem; }
`;

const FilterToggleAllButton = styled.button`
  width: 100%;
  padding: 0.5rem;
  border: none;
  background: #f0f0f0;
  cursor: pointer;
  font-size: 0.875rem;
  &:hover { background: #e0e0e0; }
`;

const TableContainer = styled.div`
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  overflow-x: auto;
  &::-webkit-scrollbar { height: 8px; }
  &::-webkit-scrollbar-track { background: #f1f1f1; }
  &::-webkit-scrollbar-thumb { background: #bdc3c7; border-radius: 4px; }
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const TableHead = styled.thead`
  background: #f8f9fa;
`;

const TableHeaderCell = styled.th`
  padding: 0.75rem;
  text-align: left;
  font-size: 0.8rem;
  font-weight: 600;
  color: #7f8c8d;
  white-space: nowrap;
  border-bottom: 2px solid #e9ecef;
  cursor: ${props => props.$sortable ? 'pointer' : 'default'};
  user-select: none;
  &:hover {
    ${props => props.$sortable && 'color: #2c3e50;'}
  }
`;

const SortIcon = styled.span`
  margin-left: 0.25rem;
  display: inline-flex;
  vertical-align: middle;
`;

const TableRow = styled.tr`
  border-bottom: 1px solid #eee;
  cursor: pointer;
  &:hover { background: ${HOVER_COLOR}; }
`;

const TableCell = styled.td`
  padding: 0.75rem;
  font-size: 0.85rem;
  color: #2c3e50;
  vertical-align: middle;
  white-space: nowrap;
`;

const NaText = styled.div`
  font-size: 0.8rem;
  color: #2c3e50;
  max-width: 200px;
  white-space: normal;
  word-break: break-word;
`;

const MoreLink = styled.span`
  color: #3498db;
  font-size: 0.75rem;
  cursor: pointer;
  margin-left: 0.25rem;
  &:hover { text-decoration: underline; }
`;

const DueDateBadge = styled.span`
  display: inline-block;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: white;
  margin-left: 0.25rem;
  background: ${props => props.$type === 'urgent' ? '#e74c3c' : '#9b59b6'};
`;

// 第一想起取れるくん ①進行スケジュール確認／②詳細確認／③契約締結依頼の進行バッジ
const FirstRecallBadgeRow = styled.div`
  display: flex;
  gap: 0.2rem;
`;

const FirstRecallBadge = styled.span`
  display: inline-block;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  background: ${props => (props.$done ? props.$color : '#dfe6e9')};
  opacity: ${props => (props.$done ? 1 : 0.6)};
`;

// 実施可否（Slack側botの判定結果。first-recall-brief-botからprogressDashboardへミラーされる）
const FEASIBILITY_BADGE_CONFIG = {
  feasible: { label: '可', color: '#27ae60' },
  infeasible: { label: '否', color: '#e74c3c' },
  review: { label: '検討', color: '#e67e22' },
  pending: { label: '未回答', color: '#95a5a6' },
};

const FeasibilityBadge = styled.span`
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  background: ${props => props.$color};
`;

const AddButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  background: #3498db;
  color: white;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  &:hover { opacity: 0.9; }
`;

const ModalOverlay = styled.div`
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.3);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const ModalBox = styled.div`
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  width: 480px;
  max-width: 90%;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
`;

const ModalTitle = styled.h3`
  font-size: 1rem;
  font-weight: 600;
  color: #2c3e50;
  margin: 0 0 1.25rem;
`;

const FormGroup = styled.div`
  margin-bottom: 1rem;
`;

const FormLabel = styled.label`
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: #7f8c8d;
  margin-bottom: 0.3rem;
`;

const FormSelect = styled.select`
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.85rem;
  &:focus { outline: none; border-color: #3498db; }
`;

const FormInput = styled.input`
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.85rem;
  box-sizing: border-box;
  &:focus { outline: none; border-color: #3498db; }
`;

const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
`;

const ModalBtn = styled.button`
  padding: 0.5rem 1.25rem;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  font-weight: 600;
  background: ${props => props.$primary ? '#3498db' : '#e9ecef'};
  color: ${props => props.$primary ? 'white' : '#2c3e50'};
  &:hover { opacity: 0.9; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const NaModal = styled.div`
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.3);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const NaModalContent = styled.div`
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 500px;
  width: 90%;
  max-height: 60vh;
  overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
`;

const NaModalTitle = styled.h3`
  font-size: 1rem;
  font-weight: 600;
  color: #2c3e50;
  margin: 0 0 1rem;
`;

const NaModalText = styled.div`
  font-size: 0.9rem;
  color: #2c3e50;
  white-space: pre-wrap;
  line-height: 1.6;
`;

const NaModalClose = styled.button`
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  background: #3498db;
  color: white;
  cursor: pointer;
  font-size: 0.85rem;
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
// メインコンポーネント
// ============================================

function AccountDealsListPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState(STATUSES);
  const [representativeFilter, setRepresentativeFilter] = useState([]);
  const [salesRepresentatives, setSalesRepresentatives] = useState([]);
  const [introducerFilter, setIntroducerFilter] = useState([]);
  const [deals, setDeals] = useState([]);
  const [deleteModal, setDeleteModal] = useState({ show: false, deal: null });
  const [editModal, setEditModal] = useState({ show: false, deal: null });
  const [receivedOrderModal, setReceivedOrderModal] = useState({ show: false, deal: null });
  const [introducersList, setIntroducersList] = useState([]);
  const [proposalMenusList, setProposalMenusList] = useState([]);
  const [leadSourcesList, setLeadSourcesList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [naDataMap, setNaDataMap] = useState({});
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [naModalText, setNaModalText] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddExistingModal, setShowAddExistingModal] = useState(false);
  const [showCsvGuide, setShowCsvGuide] = useState(false);
  const [addForm, setAddForm] = useState({
    companyName: '', introducer: '', productName: '',
    leadSource: '', representative: '', status: 'フェーズ1',
    expectedBudget: '', rank: ''
  });
  // 既存案件（すでに成約済みの取引）をパイプライン(フェーズ1〜)を経由せず直接登録するための
  // 簡易フォーム。既存案件一覧(ProjectManagementPage.js)の「既存案件を新規追加」と同じ考え方。
  const [addExistingForm, setAddExistingForm] = useState({
    companyName: '', introducer: '', productName: '', representative: '', expectedBudget: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState({
    status: false,
    representative: false,
    introducer: false
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const initialOpenDone = useRef(false);
  const { recordAction } = useUndoContext();

  // パートナー向けかどうかを判定
  const isPartnerView = window.location.pathname.startsWith('/partner') ||
                       window.location.pathname.startsWith('/partner-entry');

  // 営業担当者マスターを取得
  const fetchSalesReps = async () => {
    try {
      const staff = await fetchStaffByRole('sales');
      const names = staff.map(s => s.name);
      setSalesRepresentatives(names);
      setRepresentativeFilter(names);
    } catch (error) {
      console.error('Failed to fetch sales staff:', error);
    }
  };

  // マスターデータ取得（案件一覧自体はonSnapshotのリアルタイム購読で取得）
  useEffect(() => {
    fetchIntroducers();
    fetchProposalMenus();
    fetchLeadSources();
    fetchSalesReps();
  }, []);

  // 紹介者マスター取得
  const fetchIntroducers = async () => {
    try {
      const ref = collection(db, 'introducers');
      const q = query(ref, orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setIntroducersList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error('Failed to fetch introducers:', error);
    }
  };

  // 提案メニューマスター取得
  const fetchProposalMenus = async () => {
    try {
      const snap = await getDocs(collection(db, 'proposalMenus'));
      const menus = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      menus.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setProposalMenusList(menus);
    } catch (error) {
      console.error('Failed to fetch proposal menus:', error);
    }
  };

  // 流入経路マスター取得
  const fetchLeadSources = async () => {
    try {
      const snap = await getDocs(collection(db, 'leadSources'));
      const sources = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.isActive);
      sources.sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999));
      setLeadSourcesList(sources);
    } catch (error) {
      console.error('Failed to fetch lead sources:', error);
    }
  };

  // URLの?id=xxxからパネルを自動で開く
  useEffect(() => {
    if (initialOpenDone.current || deals.length === 0) return;
    const dealId = searchParams.get('id');
    if (dealId) {
      const target = deals.find(d => d.id === dealId);
      if (target) {
        setSelectedDeal(target);
        initialOpenDone.current = true;
      }
    }
  }, [deals, searchParams]);

  // NA（ネクストアクション）情報の取得。テーブル表示をブロックせず後追いで更新
  const fetchNaDataForItems = async (progressItems) => {
    if (!progressItems || progressItems.length === 0) return;
    try {
      const salesInfoEntries = await Promise.all(
        progressItems.map(async (item) => {
          const info = await fetchSalesInfo(item.id);
          return [item.id, info];
        })
      );
      setNaDataMap(Object.fromEntries(salesInfoEntries));
    } catch (error) {
      console.error('Failed to fetch NA data:', error);
    }
  };

  // 案件一覧をFirestoreのonSnapshotでリアルタイム購読
  // Slack側のbot更新／他ユーザーの①②③操作などが画面を開いたまま即時反映されるようにする
  useEffect(() => {
    setIsLoading(true);
    const progressRef = collection(db, 'progressDashboard');
    const q = query(progressRef, orderBy('updatedAt', 'desc'));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const progressItems = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        // このページはアカウント営業（大型自主提案）専用の案件一覧。それ以外の案件は除外する
        if (data.salesTrack !== 'account') return;
        progressItems.push({
          id: docSnap.id,
          ...data,
          lastContactDate: data.lastContactDate?.toDate?.()?.toLocaleDateString('ja-JP') ||
                          data.lastContactDate || null,
          nextActionDate: data.nextActionDate || null,
          // createdAtの生データを保持（経過日数計算用）
          createdAtRaw: data.createdAt,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null
        });
      });

      setDeals(progressItems);
      setIsLoading(false);
      fetchNaDataForItems(progressItems);
      progressItems.forEach(checkPhase4StagnationNa);
    }, (error) => {
      console.error('Failed to fetch progress data:', error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // ステータス変更
  const handleStatusChange = async (e, dealId, newStatus) => {
    e.stopPropagation();
    try {
      if (newStatus === 'フェーズ8') {
        const targetDeal = deals.find(deal => deal.id === dealId);
        if (targetDeal) {
          setReceivedOrderModal({ show: true, deal: targetDeal });
          return;
        }
      }

      const progressRef = doc(db, 'progressDashboard', dealId);
      // phaseEnteredAtはフェーズ4滞留チェックの基準時刻として使用する
      // phase4StagnationNaCreatedAtはリセットしない（滞留NAは案件ごとに一度きり生成の方針）
      const updateData = {
        status: newStatus,
        updatedAt: serverTimestamp(),
        phaseEnteredAt: serverTimestamp(),
      };
      if (newStatus === 'フェーズ8') {
        updateData.confirmedDate = new Date().toISOString().split('T')[0];
        updateData.continuationStatus = '施策実施中';
      }
      await updateDoc(progressRef, updateData);
      setDeals(prev => prev.map(deal =>
        deal.id === dealId ? { ...deal, status: newStatus } : deal
      ));
    } catch (error) {
      console.error('Failed to update status:', error);
      alert('ステータス更新に失敗しました');
    }
  };


  // 削除
  const handleDelete = async (deal) => {
    if (!window.confirm(`「${deal.companyName}（${deal.productName}）」を削除しますか？`)) return;
    try {
      const dealBackup = { ...deal };
      await deleteDoc(doc(db, 'progressDashboard', deal.id));

      recordAction({
        type: 'DELETE_DEAL',
        description: `案件「${deal.productName}」を削除`,
        undoFunction: async () => {
          const docRef = doc(db, 'progressDashboard', dealBackup.id);
          const restoreData = { ...dealBackup, updatedAt: serverTimestamp() };
          if (restoreData.id) delete restoreData.id;
          if (restoreData.createdAtRaw) delete restoreData.createdAtRaw;
          await setDoc(docRef, restoreData);
        }
      });
    } catch (error) {
      console.error('Failed to delete:', error);
      alert('削除に失敗しました');
    }
  };

  // ソート
  const handleSort = (key) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const renderSortIcon = (key) => {
    if (sortKey !== key) return null;
    return (
      <SortIcon>
        {sortDir === 'asc' ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />}
      </SortIcon>
    );
  };

  // フィルター
  const handleFilterChange = (filterType, value, isChecked) => {
    const setterMap = {
      status: setStatusFilter,
      representative: setRepresentativeFilter,
      introducer: setIntroducerFilter
    };
    const setter = setterMap[filterType];
    if (setter) {
      setter(prev => isChecked ? [...prev, value] : prev.filter(item => item !== value));
    }
  };

  const handleToggleAll = (filterType, items) => {
    const setterMap = {
      status: setStatusFilter,
      representative: setRepresentativeFilter,
      introducer: setIntroducerFilter
    };
    const setter = setterMap[filterType];
    if (setter) {
      setter(prev => prev.length === items.length ? [] : items);
    }
  };

  const toggleDropdown = (type) => {
    setDropdownOpen(prev => ({ ...prev, [type]: !prev[type] }));
  };

  // 外部クリックでドロップダウンを閉じる
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.filter-dropdown')) {
        setDropdownOpen({ status: false, representative: false, introducer: false });
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 紹介者名を取得
  const getIntroducerName = useCallback((deal) => {
    return deal?.introducer?.trim() || '';
  }, []);

  // フィルタリング + ソート
  const filteredDeals = useMemo(() => {
    if (!Array.isArray(deals)) return [];

    let filtered = deals.filter(deal => {
      if (!deal) return false;
      const companyName = deal.companyName || '';
      const productName = deal.productName || '';
      const status = deal.status || '';
      const representative = deal.representative || '';

      const matchesSearch = !searchTerm ||
        companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        productName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter.length === 0 || statusFilter.includes(status);
      const matchesRepresentative = representativeFilter.length === 0 || representativeFilter.includes(representative);

      let matchesIntroducer = true;
      if (introducerFilter.length > 0) {
        matchesIntroducer = introducerFilter.includes(getIntroducerName(deal));
      }

      const matchesPartnerCompany = !isPartnerView ||
        !(window.location.pathname.startsWith('/partner-entry/piala')) ||
        (deal.introducer === '株式会社ピアラ');

      const isValidProposalMenu = isPartnerView || (deal.proposalMenu !== '他社案件');

      // アカウント営業は案件数が少ないため、新規/既存を分けず1つの一覧にまとめて表示する
      // （AccountSalesDashboard.jsの集計と同じ考え方）

      return matchesSearch && matchesStatus && matchesRepresentative && matchesIntroducer && matchesPartnerCompany && isValidProposalMenu;
    });

    // ソート
    if (sortKey) {
      filtered = [...filtered].sort((a, b) => {
        let aVal, bVal;
        switch (sortKey) {
          case 'companyName':
            aVal = (a.companyName || '').toLowerCase();
            bVal = (b.companyName || '').toLowerCase();
            break;
          case 'elapsedDays': {
            const infoAe = naDataMap[a.id] || {};
            const infoBe = naDataMap[b.id] || {};
            const phaseA = infoAe.latestPhase || a.status || '';
            const phaseB = infoBe.latestPhase || b.status || '';
            // フェーズ8は末尾に配置
            aVal = phaseA === 'フェーズ8' ? -1 : (calcElapsedDays(infoAe.firstRecordDate || a.createdAtRaw) || 0);
            bVal = phaseB === 'フェーズ8' ? -1 : (calcElapsedDays(infoBe.firstRecordDate || b.createdAtRaw) || 0);
            return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
          }
          case 'nextActionDate': {
            const infoA = naDataMap[a.id] || {};
            const infoB = naDataMap[b.id] || {};
            const dateA = infoA.naEntry?.actionDueDate;
            const dateB = infoB.naEntry?.actionDueDate;
            aVal = dateA ? new Date(dateA) : new Date(9999, 11, 31);
            bVal = dateB ? new Date(dateB) : new Date(9999, 11, 31);
            return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
          }
          default:
            aVal = a[sortKey] || '';
            bVal = b[sortKey] || '';
        }
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          const cmp = aVal.localeCompare(bVal, 'ja');
          return sortDir === 'asc' ? cmp : -cmp;
        }
        return 0;
      });
    }

    return filtered;
  }, [deals, searchTerm, statusFilter, representativeFilter, introducerFilter, isPartnerView, getIntroducerName, sortKey, sortDir, naDataMap]);

  // 期日バッジ
  const renderDueDateBadge = (dueDate) => {
    const status = getDateStatus(dueDate);
    if (status === 'overdue') return <DueDateBadge $type="overdue">超過</DueDateBadge>;
    if (status === 'urgent') return <DueDateBadge $type="urgent">急</DueDateBadge>;
    return null;
  };

  // 新規追加
  const handleAddDeal = async () => {
    if (!addForm.companyName.trim() || !addForm.productName.trim()) return;
    try {
      setIsSaving(true);
      const newDeal = {
        companyName: addForm.companyName.trim(),
        introducer: addForm.introducer.trim(),
        productName: addForm.productName.trim(),
        leadSource: addForm.leadSource,
        representative: addForm.representative,
        status: addForm.status || 'フェーズ1',
        expectedBudget: addForm.expectedBudget ? Number(addForm.expectedBudget) : null,
        rank: addForm.rank || '',
        isExistingProject: false,
        salesTrack: 'account',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (addForm.leadSource === 'パートナー') {
        newDeal.introducerId = addForm.introducerId ? parseInt(addForm.introducerId) : 0;
        newDeal.partnerRepresentative = addForm.partnerRepresentative || null;
      }
      const docRef = await addDoc(collection(db, 'progressDashboard'), newDeal);

      // 営業記録を自動作成
      const today = new Date().toISOString().split('T')[0];
      await addSalesRecord(docRef.id, {
        phase: addForm.status || 'フェーズ1',
        budget: addForm.expectedBudget ? Number(addForm.expectedBudget) : '',
        salesRep: addForm.representative || '',
        operatorRep: '',
        date: today,
        startDate: '',
        endDate: '',
        recordType: '新規',
        createdAt: new Date()
      }, 'newCaseSalesRecords');

      // フェーズ8の場合は既存側にも別レコードを作成（CSV取込と同じ処理）
      if ((addForm.status || 'フェーズ1') === 'フェーズ8') {
        const existingDeal = {
          companyName: addForm.companyName.trim(),
          introducer: addForm.introducer.trim(),
          productName: addForm.productName.trim(),
          leadSource: addForm.leadSource,
          representative: addForm.representative,
          status: 'フェーズ8',
          expectedBudget: addForm.expectedBudget ? Number(addForm.expectedBudget) : null,
          rank: addForm.rank || '',
          isExistingProject: true,
          salesTrack: 'account',
          confirmedDate: today,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        if (addForm.leadSource === 'パートナー') {
          existingDeal.introducerId = addForm.introducerId ? parseInt(addForm.introducerId) : 0;
          existingDeal.partnerRepresentative = addForm.partnerRepresentative || null;
        }
        const existingRef = await addDoc(collection(db, 'progressDashboard'), existingDeal);
        await addSalesRecord(existingRef.id, {
          phase: 'フェーズ8',
          budget: addForm.expectedBudget ? Number(addForm.expectedBudget) : 0,
          date: today,
          salesRep: addForm.representative || '',
          operatorRep: '',
          recordType: '新規',
          createdAt: new Date()
        });
      }

      setShowAddModal(false);
      setAddForm({
        companyName: '', introducer: '', productName: '',
        leadSource: '', representative: '', status: 'フェーズ1',
        expectedBudget: '', rank: '', introducerId: '', partnerRepresentative: ''
      });
    } catch (error) {
      console.error('Failed to add deal:', error);
      alert('案件の追加に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // 既存案件（すでに成約済みの取引）を直接追加。フェーズ1〜7のパイプラインを経由しない。
  const handleAddExistingDeal = async () => {
    if (!addExistingForm.companyName.trim() || !addExistingForm.productName.trim()) return;
    try {
      setIsSaving(true);
      const today = new Date().toISOString().split('T')[0];
      const docRef = await addDoc(collection(db, 'progressDashboard'), {
        companyName: addExistingForm.companyName.trim(),
        introducer: addExistingForm.introducer.trim(),
        productName: addExistingForm.productName.trim(),
        representative: addExistingForm.representative,
        status: 'フェーズ8',
        expectedBudget: addExistingForm.expectedBudget ? Number(addExistingForm.expectedBudget) : null,
        isExistingProject: true,
        salesTrack: 'account',
        confirmedDate: today,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await addSalesRecord(docRef.id, {
        phase: 'フェーズ8',
        budget: addExistingForm.expectedBudget ? Number(addExistingForm.expectedBudget) : 0,
        date: today,
        salesRep: addExistingForm.representative || '',
        operatorRep: '',
        recordType: '新規',
        createdAt: new Date()
      });

      setShowAddExistingModal(false);
      setAddExistingForm({ companyName: '', introducer: '', productName: '', representative: '', expectedBudget: '' });
    } catch (error) {
      console.error('Failed to add existing deal:', error);
      alert('案件の追加に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // CSV取込
  const handleCsvImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(line => line.trim());

    // ヘッダー行をスキップ
    const startIdx = lines[0].includes('会社名') ? 1 : 0;
    // 引用符付きフィールド（"¥1,000,000"など）を考慮したCSVパース
    const parseCsvLine = (line) => {
      const cols = [];
      let current = '';
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; continue; }
        current += ch;
      }
      cols.push(current.trim());
      return cols;
    };

    // 金額文字列を数値に変換（¥1,000,000 → 1000000）
    const parseBudget = (val) => {
      if (!val) return null;
      const num = Number(val.replace(/[¥￥,]/g, ''));
      return isNaN(num) ? null : num;
    };

    const rows = lines.slice(startIdx).map(line => {
      const cols = parseCsvLine(line);
      return {
        companyName: cols[0] || '',
        introducer: cols[1] || '',
        productName: cols[2] || '',
        leadSource: cols[3] || '',
        representative: cols[4] || '',
        status: cols[5] || 'フェーズ1',
        expectedBudget: parseBudget(cols[6]),
        rank: cols[7] || ''
      };
    }).filter(r => r.companyName && r.productName);

    if (rows.length === 0) {
      alert('取り込めるデータがありません。\nCSVフォーマット: 会社名,代理店名,商材名,流入経路,担当者,ステータス,想定予算,運用ランク');
      return;
    }

    if (!window.confirm(`${rows.length}件の案件を一括追加しますか？`)) return;

    try {
      for (const row of rows) {
        const status = row.status || 'フェーズ1';
        const isPhase8 = status === 'フェーズ8';
        // マスターに存在しない担当者は空欄にする
        const rep = salesRepresentatives.includes(row.representative) ? row.representative : '';

        // 新規側のレコード（常にisExistingProject: falseで新規一覧に表示）
        const docRef = await addDoc(collection(db, 'progressDashboard'), {
          companyName: row.companyName,
          introducer: row.introducer === '-' ? '' : row.introducer,
          productName: row.productName,
          leadSource: row.leadSource,
          representative: rep,
          status,
          expectedBudget: row.expectedBudget,
          rank: row.rank,
          isExistingProject: false,
          salesTrack: 'account',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // フェーズ8の場合は既存側にも別レコードを作成
        if (isPhase8) {
          const existingRef = await addDoc(collection(db, 'progressDashboard'), {
            companyName: row.companyName,
            introducer: row.introducer === '-' ? '' : row.introducer,
            productName: row.productName,
            leadSource: row.leadSource,
            representative: rep,
            status: 'フェーズ8',
            expectedBudget: row.expectedBudget,
            rank: row.rank,
            isExistingProject: true,
            salesTrack: 'account',
            confirmedDate: new Date().toISOString().split('T')[0],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          await addSalesRecord(existingRef.id, {
            phase: 'フェーズ8',
            budget: row.expectedBudget || 0,
            date: new Date().toISOString().split('T')[0],
            recordType: '新規',
            createdAt: new Date()
          });
        }
      }
      alert(`${rows.length}件を追加しました`);
    } catch (error) {
      console.error('CSV import failed:', error);
      alert('CSV取り込みに失敗しました');
    }
  };

  // 編集保存
  const handleEditSave = async () => {
    try {
      const updatedDeal = editModal.deal;
      const dealRef = doc(db, 'progressDashboard', updatedDeal.id);
      const leadSourceInfo = { leadSource: updatedDeal.leadSource || '' };

      // パートナー選択時のみ紹介者情報を更新
      if (updatedDeal.leadSource === 'パートナー') {
        if (updatedDeal.introducerId && updatedDeal.introducerId !== '') {
          const selectedIntroducer = introducersList.find(i => i.id === updatedDeal.introducerId);
          if (selectedIntroducer) {
            leadSourceInfo.introducer = selectedIntroducer.name;
            leadSourceInfo.introducerId = parseInt(updatedDeal.introducerId);
          }
        }
        leadSourceInfo.partnerRepresentative = updatedDeal.partnerRepresentative || null;
      } else {
        leadSourceInfo.introducer = updatedDeal.introducer || '';
        leadSourceInfo.introducerId = 0;
        leadSourceInfo.partnerRepresentative = null;
      }

      await updateDoc(dealRef, {
        companyName: updatedDeal.companyName || '',
        productName: updatedDeal.productName || '',
        proposalMenu: updatedDeal.proposalMenu || '',
        representative: updatedDeal.representative || '',
        expectedBudget: updatedDeal.expectedBudget || null,
        rank: updatedDeal.rank || '',
        ...leadSourceInfo,
        updatedAt: serverTimestamp()
      });
      setEditModal({ show: false, deal: null });
    } catch (error) {
      console.error('Failed to save edit:', error);
      alert('保存に失敗しました');
    }
  };

  // フェーズ8送信時 → 既存案件移行確認モーダル表示
  // フェーズ8送信時 → 受注情報入力モーダルを表示
  const handlePhase8Submitted = () => {
    setReceivedOrderModal({ show: true, deal: selectedDeal });
  };

  // 受注情報保存 → 既存案件へ移行
  // 対象案件はモーダルに渡したdeal（orderData.dealId）を使う。
  // selectedDealはパネル未オープン時にnullで何も保存されない・別案件へ誤書き込みの恐れがあるため使わない
  const handleSaveReceivedOrder = async (orderData) => {
    const targetDeal = receivedOrderModal.deal;
    if (!targetDeal || !orderData.dealId || targetDeal.id !== orderData.dealId) return;
    try {
      setIsSavingOrder(true);

      // 新規側のレコードはフェーズ8に更新するが、isExistingProjectはfalseのまま残す
      const dealRef = doc(db, 'progressDashboard', orderData.dealId);
      await updateDoc(dealRef, {
        status: 'フェーズ8',
        confirmedDate: orderData.receivedOrderDate || new Date().toISOString().split('T')[0],
        receivedOrderDate: orderData.receivedOrderDate,
        receivedOrderAmount: orderData.receivedOrderAmount,
        contractRequested: true,
        updatedAt: serverTimestamp()
      });

      // 既存側に別レコードを作成
      const existingRef = await addDoc(collection(db, 'progressDashboard'), {
        companyName: targetDeal.companyName,
        introducer: targetDeal.introducer || '',
        productName: targetDeal.productName,
        leadSource: targetDeal.leadSource || '',
        representative: targetDeal.representative || '',
        status: 'フェーズ8',
        expectedBudget: orderData.receivedOrderAmount,
        rank: targetDeal.rank || '',
        isExistingProject: true,
        salesTrack: 'account',
        confirmedDate: orderData.receivedOrderDate || new Date().toISOString().split('T')[0],
        receivedOrderDate: orderData.receivedOrderDate,
        receivedOrderAmount: orderData.receivedOrderAmount,
        contractRequested: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // 既存側のレコードに営業記録を追加
      await addSalesRecord(existingRef.id, {
        phase: 'フェーズ8',
        budget: orderData.receivedOrderAmount,
        confirmedDate: orderData.receivedOrderDate || new Date().toISOString().split('T')[0],
        date: new Date().toISOString().split('T')[0],
        salesRep: orderData.salesRep || '',
        operatorRep: orderData.operatorRep || '',
        startDate: orderData.startDate || '',
        endDate: orderData.endDate || '',
        recordType: '新規',
        createdAt: new Date()
      });

      setReceivedOrderModal({ show: false, deal: null });
      setSelectedDeal(null);
      alert('受注情報が保存され、既存案件に移行しました');
    } catch (error) {
      console.error('Failed to save received order:', error);
      alert('保存に失敗しました: ' + error.message);
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleCancelReceivedOrder = () => {
    setReceivedOrderModal({ show: false, deal: null });
  };

  // パネルクローズ（案件一覧はonSnapshotのリアルタイム購読で常に最新化されるため再取得は不要）
  const handlePanelClose = () => {
    setSelectedDeal(null);
    setSearchParams({});
  };

  // パネル側でプロジェクト更新
  const handleProjectUpdate = useCallback((updatedProject) => {
    setDeals(prev => prev.map(d => d.id === updatedProject.id ? { ...d, ...updatedProject } : d));
    setSelectedDeal(prev => prev && prev.id === updatedProject.id ? { ...prev, ...updatedProject } : prev);
  }, []);

  // 紹介者ユニーク一覧
  const uniqueIntroducers = useMemo(() => {
    return [...new Set(deals.map(deal => getIntroducerName(deal)).filter(name => name))].sort();
  }, [deals, getIntroducerName]);

  return (
    <PageContainer>
      <PageHeader>
        <Title>アカウント営業 案件一覧</Title>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <AddButton style={{ background: '#2ecc71' }} onClick={() => setShowCsvGuide(true)}>
            <FiUpload size={14} />CSV取込
          </AddButton>
          <AddButton style={{ background: '#8e44ad' }} onClick={() => setShowAddExistingModal(true)}>
            <FiPlus size={14} />既存追加
          </AddButton>
          <AddButton onClick={() => setShowAddModal(true)}>
            <FiPlus size={14} />新規追加
          </AddButton>
        </div>
      </PageHeader>

      {/* フィルターセクション */}
      <FilterSection>
        <FilterGrid>
          <div>
            <FormLabel>検索</FormLabel>
            <SearchInput
              type="text"
              placeholder="会社名・商材名で検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div>
            <FormLabel>ステータス</FormLabel>
            <FilterDropdownContainer className="filter-dropdown">
              <FilterDropdownButton type="button" onClick={() => toggleDropdown('status')}>
                <span>
                  {statusFilter.length === 0 ? '選択してください'
                    : statusFilter.length === STATUSES.length ? '全て選択中'
                    : `${statusFilter.length}件選択中`}
                </span>
                <FiChevronDown />
              </FilterDropdownButton>
              {dropdownOpen.status && (
                <FilterDropdownList>
                  <FilterToggleAllButton type="button" onClick={() => handleToggleAll('status', STATUSES)}>
                    {statusFilter.length === STATUSES.length ? '全て解除' : '全て選択'}
                  </FilterToggleAllButton>
                  <FilterCheckboxContainer>
                    {STATUSES.map(status => (
                      <FilterCheckboxItem key={status}>
                        <input
                          type="checkbox"
                          checked={statusFilter.includes(status)}
                          onChange={(e) => handleFilterChange('status', status, e.target.checked)}
                        />
                        <span>{status}</span>
                      </FilterCheckboxItem>
                    ))}
                  </FilterCheckboxContainer>
                </FilterDropdownList>
              )}
            </FilterDropdownContainer>
          </div>
          <div>
            <FormLabel>担当者</FormLabel>
            <FilterDropdownContainer className="filter-dropdown">
              <FilterDropdownButton type="button" onClick={() => toggleDropdown('representative')}>
                <span>
                  {representativeFilter.length === 0 ? '選択してください'
                    : representativeFilter.length === salesRepresentatives.length ? '全て選択中'
                    : `${representativeFilter.length}件選択中`}
                </span>
                <FiChevronDown />
              </FilterDropdownButton>
              {dropdownOpen.representative && (
                <FilterDropdownList>
                  <FilterToggleAllButton type="button" onClick={() => handleToggleAll('representative', salesRepresentatives)}>
                    {representativeFilter.length === salesRepresentatives.length ? '全て解除' : '全て選択'}
                  </FilterToggleAllButton>
                  <FilterCheckboxContainer>
                    {salesRepresentatives.map(rep => (
                      <FilterCheckboxItem key={rep}>
                        <input
                          type="checkbox"
                          checked={representativeFilter.includes(rep)}
                          onChange={(e) => handleFilterChange('representative', rep, e.target.checked)}
                        />
                        <span>{rep}</span>
                      </FilterCheckboxItem>
                    ))}
                  </FilterCheckboxContainer>
                </FilterDropdownList>
              )}
            </FilterDropdownContainer>
          </div>
          <div>
            <FormLabel>代理店</FormLabel>
            <FilterDropdownContainer className="filter-dropdown">
              <FilterDropdownButton type="button" onClick={() => toggleDropdown('introducer')}>
                <span>
                  {introducerFilter.length === 0 ? '全て選択'
                    : `${introducerFilter.length}件選択中`}
                </span>
                <FiChevronDown />
              </FilterDropdownButton>
              {dropdownOpen.introducer && (
                <FilterDropdownList>
                  <FilterToggleAllButton type="button" onClick={() => handleToggleAll('introducer', uniqueIntroducers)}>
                    {introducerFilter.length === uniqueIntroducers.length ? '全て解除' : '全て選択'}
                  </FilterToggleAllButton>
                  <FilterCheckboxContainer>
                    {uniqueIntroducers.map(name => (
                      <FilterCheckboxItem key={name}>
                        <input
                          type="checkbox"
                          checked={introducerFilter.includes(name)}
                          onChange={(e) => handleFilterChange('introducer', name, e.target.checked)}
                        />
                        <span>{name}</span>
                      </FilterCheckboxItem>
                    ))}
                  </FilterCheckboxContainer>
                </FilterDropdownList>
              )}
            </FilterDropdownContainer>
          </div>
        </FilterGrid>
      </FilterSection>

      {/* テーブル */}
      <TableContainer>
        {isLoading ? (
          <LoadingText>読み込み中...</LoadingText>
        ) : filteredDeals.length === 0 ? (
          <EmptyText>該当する案件がありません</EmptyText>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell $sortable onClick={() => handleSort('companyName')}>
                  会社名{renderSortIcon('companyName')}
                </TableHeaderCell>
                <TableHeaderCell>代理店名</TableHeaderCell>
                <TableHeaderCell>商材名</TableHeaderCell>
                <TableHeaderCell>運用ランク</TableHeaderCell>
                <TableHeaderCell>提案予算</TableHeaderCell>
                <TableHeaderCell>流入経路</TableHeaderCell>
                <TableHeaderCell>担当者</TableHeaderCell>
                <TableHeaderCell>フェーズ<PhaseTooltip /></TableHeaderCell>
                <TableHeaderCell $sortable onClick={() => handleSort('elapsedDays')}>
                  経過日数{renderSortIcon('elapsedDays')}
                </TableHeaderCell>
                <TableHeaderCell>ネクストアクション</TableHeaderCell>
                <TableHeaderCell $sortable onClick={() => handleSort('nextActionDate')}>
                  期日{renderSortIcon('nextActionDate')}
                </TableHeaderCell>
                <TableHeaderCell>実施可否</TableHeaderCell>
                <TableHeaderCell>①②③</TableHeaderCell>
                <TableHeaderCell>締結</TableHeaderCell>
                <TableHeaderCell style={{ width: '40px' }}></TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {filteredDeals.map(deal => {
                // 営業記録からNA・フェーズを取得（フォールバック: deal直下のフィールド）
                const salesInfo = naDataMap[deal.id] || {};
                const naEntry = salesInfo.naEntry;
                const activeNaEntries = salesInfo.activeNaEntries || [];
                const displayPhase = salesInfo.latestPhase || deal.status || '';
                // 経過日数: 最初のレコード登録日から計算（フォールバック: 案件createdAt）
                const elapsedDays = displayPhase === 'フェーズ8' ? null
                  : calcElapsedDays(salesInfo.firstRecordDate || deal.createdAtRaw);
                const latestNaContent = naEntry?.actionContent || '';
                const latestNaDueDate = naEntry?.actionDueDate || '';
                return (
                  <TableRow
                    key={deal.id}
                    onClick={() => { setSelectedDeal(deal); setSearchParams({ id: deal.id }); }}
                  >
                    <TableCell style={{ fontWeight: 500 }}>{deal.companyName || '-'}</TableCell>
                    <TableCell>{deal.introducer || '-'}</TableCell>
                    <TableCell>{deal.productName || '-'}</TableCell>
                    <TableCell>{deal.rank || '-'}</TableCell>
                    <TableCell>{deal.expectedBudget ? `¥${deal.expectedBudget.toLocaleString()}` : '-'}</TableCell>
                    <TableCell>{deal.leadSource || '-'}</TableCell>
                    <TableCell>{deal.representative || '-'}</TableCell>
                    <TableCell>
                      {displayPhase ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: 'white',
                          background: STATUS_COLORS[displayPhase] || '#95a5a6'
                        }}>
                          {displayPhase}
                        </span>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {elapsedDays != null ? (
                        <span style={{ color: elapsedDays > ELAPSED_DAYS_THRESHOLD ? '#e74c3c' : '#2c3e50', fontWeight: elapsedDays > ELAPSED_DAYS_THRESHOLD ? 600 : 400 }}>
                          {elapsedDays}日
                        </span>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {displayPhase === 'フェーズ8' ? (
                        <span style={{ color: '#999' }}>-</span>
                      ) : !naEntry ? '-' : (
                        <NaText>
                          {(() => {
                            const text = naEntry.actionContent || '';
                            const truncated = text.length > NA_TRUNCATE_LENGTH
                              ? text.slice(0, NA_TRUNCATE_LENGTH) + '...'
                              : text;
                            return (
                              <div>
                                {naEntry.actionDueDate && (
                                  <span style={{ fontSize: '0.7rem', color: '#9b59b6', marginRight: '0.25rem' }}>
                                    [{naEntry.actionDueDate}]
                                  </span>
                                )}
                                {linkifyText(truncated)}
                                {text.length > NA_TRUNCATE_LENGTH && (
                                  <MoreLink onClick={(e) => { e.stopPropagation(); setNaModalText(text); }}>
                                    続きを見る
                                  </MoreLink>
                                )}
                              </div>
                            );
                          })()}
                        </NaText>
                      )}
                    </TableCell>
                    <TableCell>
                      {displayPhase === 'フェーズ8' ? '-' : (
                        <>
                          {latestNaDueDate || '-'}
                          {renderDueDateBadge(latestNaDueDate)}
                        </>
                      )}
                    </TableCell>
                    <TableCell style={{ textAlign: 'center' }}>
                      {deal.firstRecallFeasibility && (() => {
                        const cfg = FEASIBILITY_BADGE_CONFIG[deal.firstRecallFeasibility];
                        return cfg ? <FeasibilityBadge $color={cfg.color}>{cfg.label}</FeasibilityBadge> : null;
                      })()}
                    </TableCell>
                    <TableCell style={{ textAlign: 'center' }}>
                      <FirstRecallBadgeRow>
                        <FirstRecallBadge $done={deal.firstRecallScheduleStatus === 'done'} $color="#27ae60" title="①進行スケジュール確認">①</FirstRecallBadge>
                        <FirstRecallBadge $done={deal.firstRecallDetailStatus === 'done'} $color="#f39c12" title="②詳細確認">②</FirstRecallBadge>
                        <FirstRecallBadge $done={['requested', 'signed'].includes(deal.firstRecallContractStatus)} $color="#8e44ad" title="③契約締結依頼">③</FirstRecallBadge>
                      </FirstRecallBadgeRow>
                    </TableCell>
                    <TableCell style={{ textAlign: 'center' }}>
                      {deal.contractRequested ? (
                        <span style={{ color: '#27ae60', fontWeight: 'bold' }}>✓</span>
                      ) : displayPhase === 'フェーズ8' ? (
                        <span style={{ color: '#999' }}>-</span>
                      ) : ''}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <FiEdit3
                          size={14}
                          style={{ color: '#f39c12', cursor: 'pointer' }}
                          onClick={() => setEditModal({ show: true, deal: { ...deal } })}
                          title="編集"
                        />
                        <FiTrash2
                          size={14}
                          style={{ color: '#e74c3c', cursor: 'pointer' }}
                          onClick={() => handleDelete(deal)}
                          title="削除"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </TableContainer>

      {/* NAモーダル */}
      {naModalText && (
        <NaModal onClick={() => setNaModalText(null)}>
          <NaModalContent onClick={(e) => e.stopPropagation()}>
            <NaModalTitle>ネクストアクション</NaModalTitle>
            <NaModalText>{linkifyText(naModalText)}</NaModalText>
            <NaModalClose onClick={() => setNaModalText(null)}>閉じる</NaModalClose>
          </NaModalContent>
        </NaModal>
      )}

      {/* 編集モーダル */}
      {editModal.show && (
        <ModalOverlay onClick={() => setEditModal({ show: false, deal: null })}>
          <ModalBox onClick={(e) => e.stopPropagation()} style={{ maxHeight: '80vh', overflowY: 'auto' }}>
            <ModalTitle>案件情報編集</ModalTitle>
            <FormGroup>
              <FormLabel>会社名</FormLabel>
              <FormInput
                type="text"
                value={editModal.deal?.companyName || ''}
                onChange={e => setEditModal(prev => ({ ...prev, deal: { ...prev.deal, companyName: e.target.value } }))}
              />
            </FormGroup>
            <FormGroup>
              <FormLabel>商材名</FormLabel>
              <FormInput
                type="text"
                value={editModal.deal?.productName || ''}
                onChange={e => setEditModal(prev => ({ ...prev, deal: { ...prev.deal, productName: e.target.value } }))}
              />
            </FormGroup>
            <FormGroup>
              <FormLabel>提案メニュー</FormLabel>
              <FormSelect
                value={editModal.deal?.proposalMenu || ''}
                onChange={e => setEditModal(prev => ({ ...prev, deal: { ...prev.deal, proposalMenu: e.target.value } }))}
              >
                <option value="">選択してください</option>
                {proposalMenusList.map(menu => (
                  <option key={menu.id} value={menu.name}>{menu.name}</option>
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup>
              <FormLabel>社内担当者</FormLabel>
              <FormSelect
                value={editModal.deal?.representative || ''}
                onChange={e => setEditModal(prev => ({ ...prev, deal: { ...prev.deal, representative: e.target.value } }))}
              >
                <option value="">選択してください</option>
                {salesRepresentatives.map(rep => (
                  <option key={rep} value={rep}>{rep}</option>
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup>
              <FormLabel>流入経路</FormLabel>
              <FormSelect
                value={editModal.deal?.leadSource || ''}
                onChange={e => setEditModal(prev => ({ ...prev, deal: { ...prev.deal, leadSource: e.target.value } }))}
              >
                <option value="">選択してください</option>
                {leadSourcesList.map(source => (
                  <option key={source.id} value={source.name}>{source.name}</option>
                ))}
              </FormSelect>
            </FormGroup>
            {/* パートナー選択時のみ紹介者とパートナー担当者を表示 */}
            {editModal.deal?.leadSource === 'パートナー' && (
              <>
                <FormGroup>
                  <FormLabel>紹介者（パートナー企業）</FormLabel>
                  <FormSelect
                    value={editModal.deal?.introducer || ''}
                    onChange={e => {
                      const selected = introducersList.find(i => i.name === e.target.value);
                      setEditModal(prev => ({
                        ...prev,
                        deal: {
                          ...prev.deal,
                          introducer: e.target.value,
                          introducerId: selected ? selected.id : ''
                        }
                      }));
                    }}
                  >
                    <option value="">選択してください</option>
                    {introducersList.filter(i => i.status === 'アクティブ').map(i => (
                      <option key={i.id} value={i.name}>{i.name}</option>
                    ))}
                  </FormSelect>
                </FormGroup>
                <FormGroup>
                  <FormLabel>パートナー担当者</FormLabel>
                  <FormInput
                    type="text"
                    value={editModal.deal?.partnerRepresentative || ''}
                    onChange={e => setEditModal(prev => ({ ...prev, deal: { ...prev.deal, partnerRepresentative: e.target.value } }))}
                    placeholder="パートナー担当者名"
                  />
                </FormGroup>
              </>
            )}
            <FormGroup>
              <FormLabel>想定予算（円）</FormLabel>
              <FormInput
                type="number"
                value={editModal.deal?.expectedBudget || ''}
                onChange={e => setEditModal(prev => ({ ...prev, deal: { ...prev.deal, expectedBudget: e.target.value ? Number(e.target.value) : null } }))}
                placeholder="例：1000000"
                min="0"
              />
            </FormGroup>
            <FormGroup>
              <FormLabel>運用ランク</FormLabel>
              <FormSelect
                value={editModal.deal?.rank || ''}
                onChange={e => setEditModal(prev => ({ ...prev, deal: { ...prev.deal, rank: e.target.value } }))}
              >
                <option value="">選択してください</option>
                {RANKS.map(rank => (
                  <option key={rank} value={rank}>{rank}</option>
                ))}
              </FormSelect>
            </FormGroup>
            <ModalActions>
              <ModalBtn onClick={() => setEditModal({ show: false, deal: null })}>
                キャンセル
              </ModalBtn>
              <ModalBtn $primary onClick={handleEditSave}>
                保存
              </ModalBtn>
            </ModalActions>
          </ModalBox>
        </ModalOverlay>
      )}

      {/* CSVガイドモーダル */}
      {showCsvGuide && (
        <ModalOverlay onClick={() => setShowCsvGuide(false)}>
          <ModalBox onClick={(e) => e.stopPropagation()}>
            <ModalTitle>CSV一括取り込み</ModalTitle>
            <div style={{ fontSize: '0.85rem', color: '#2c3e50', lineHeight: 1.8 }}>
              <p style={{ margin: '0 0 0.75rem', fontWeight: 600 }}>CSVフォーマット</p>
              <div style={{ background: '#f8f9fa', padding: '0.5rem 0.75rem', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.8rem', marginBottom: '1rem' }}>
                会社名,代理店名,商材名,流入経路,担当者,ステータス,想定予算,運用ランク
              </div>
              <ul style={{ margin: '0 0 1rem', paddingLeft: '1.25rem' }}>
                <li>ヘッダー行あり/なし両方に対応</li>
                <li>代理店名が「-」または空欄の場合は空欄として登録</li>
                <li>取り込み前に件数確認ダイアログが表示されます</li>
              </ul>
            </div>
            <ModalActions>
              <ModalBtn onClick={() => setShowCsvGuide(false)}>キャンセル</ModalBtn>
              <ModalBtn $primary as="label" style={{ cursor: 'pointer' }}>
                ファイルを選択
                <input
                  type="file"
                  accept=".csv"
                  style={{ display: 'none' }}
                  onChange={(e) => { setShowCsvGuide(false); handleCsvImport(e); }}
                />
              </ModalBtn>
            </ModalActions>
          </ModalBox>
        </ModalOverlay>
      )}

      {/* 新規追加モーダル */}
      {showAddModal && (
        <ModalOverlay onClick={() => setShowAddModal(false)}>
          <ModalBox onClick={(e) => e.stopPropagation()}>
            <ModalTitle>新規案件を追加</ModalTitle>
            <FormGroup>
              <FormLabel>会社名 *</FormLabel>
              <FormInput
                type="text"
                placeholder="会社名を入力"
                value={addForm.companyName}
                onChange={e => setAddForm(prev => ({ ...prev, companyName: e.target.value }))}
              />
            </FormGroup>
            <FormGroup>
              <FormLabel>商材名 *</FormLabel>
              <FormInput
                type="text"
                placeholder="商材名を入力"
                value={addForm.productName}
                onChange={e => setAddForm(prev => ({ ...prev, productName: e.target.value }))}
              />
            </FormGroup>
            <FormGroup>
              <FormLabel>流入経路</FormLabel>
              <FormSelect
                value={addForm.leadSource}
                onChange={e => setAddForm(prev => ({ ...prev, leadSource: e.target.value, introducer: '', introducerId: '', partnerRepresentative: '' }))}
              >
                <option value="">選択してください</option>
                {leadSourcesList.map(source => (
                  <option key={source.id} value={source.name}>{source.name}</option>
                ))}
              </FormSelect>
            </FormGroup>
            {/* パートナー選択時のみ紹介者（代理店）セレクトを表示 */}
            {addForm.leadSource === 'パートナー' ? (
              <>
                <FormGroup>
                  <FormLabel>紹介者（パートナー企業）</FormLabel>
                  <FormSelect
                    value={addForm.introducerId || ''}
                    onChange={e => {
                      const selected = introducersList.find(i => i.id === e.target.value);
                      setAddForm(prev => ({
                        ...prev,
                        introducerId: e.target.value,
                        introducer: selected ? selected.name : ''
                      }));
                    }}
                  >
                    <option value="">選択してください</option>
                    {introducersList.filter(i => i.status === 'アクティブ').map(i => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </FormSelect>
                </FormGroup>
                <FormGroup>
                  <FormLabel>パートナー担当者</FormLabel>
                  <FormInput
                    type="text"
                    placeholder="パートナー担当者名"
                    value={addForm.partnerRepresentative || ''}
                    onChange={e => setAddForm(prev => ({ ...prev, partnerRepresentative: e.target.value }))}
                  />
                </FormGroup>
              </>
            ) : null}
            <FormGroup>
              <FormLabel>担当者</FormLabel>
              <FormSelect
                value={addForm.representative}
                onChange={e => setAddForm(prev => ({ ...prev, representative: e.target.value }))}
              >
                <option value="">選択してください</option>
                {salesRepresentatives.map(rep => (
                  <option key={rep} value={rep}>{rep}</option>
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup>
              <FormLabel>ステータス</FormLabel>
              <FormSelect
                value={addForm.status}
                onChange={e => setAddForm(prev => ({ ...prev, status: e.target.value }))}
              >
                {STATUSES.map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup>
              <FormLabel>想定予算（円）</FormLabel>
              <FormInput
                type="number"
                placeholder="例：1000000"
                value={addForm.expectedBudget}
                onChange={e => setAddForm(prev => ({ ...prev, expectedBudget: e.target.value }))}
                min="0"
              />
            </FormGroup>
            <FormGroup>
              <FormLabel>運用ランク</FormLabel>
              <FormSelect
                value={addForm.rank}
                onChange={e => setAddForm(prev => ({ ...prev, rank: e.target.value }))}
              >
                <option value="">選択してください</option>
                {RANKS.map(rank => (
                  <option key={rank} value={rank}>{rank}</option>
                ))}
              </FormSelect>
            </FormGroup>
            <ModalActions>
              <ModalBtn onClick={() => setShowAddModal(false)}>キャンセル</ModalBtn>
              <ModalBtn
                $primary
                onClick={handleAddDeal}
                disabled={!addForm.companyName.trim() || !addForm.productName.trim() || isSaving}
              >
                {isSaving ? '保存中...' : '追加'}
              </ModalBtn>
            </ModalActions>
          </ModalBox>
        </ModalOverlay>
      )}

      {/* 既存案件を追加モーダル（すでに成約済みの取引をフェーズ1〜7を経由せず直接登録） */}
      {showAddExistingModal && (
        <ModalOverlay onClick={() => setShowAddExistingModal(false)}>
          <ModalBox onClick={(e) => e.stopPropagation()}>
            <ModalTitle>既存案件を追加</ModalTitle>
            <FormGroup>
              <FormLabel>会社名 *</FormLabel>
              <FormInput
                type="text"
                placeholder="会社名を入力"
                value={addExistingForm.companyName}
                onChange={e => setAddExistingForm(prev => ({ ...prev, companyName: e.target.value }))}
              />
            </FormGroup>
            <FormGroup>
              <FormLabel>商材名 *</FormLabel>
              <FormInput
                type="text"
                placeholder="商材名を入力"
                value={addExistingForm.productName}
                onChange={e => setAddExistingForm(prev => ({ ...prev, productName: e.target.value }))}
              />
            </FormGroup>
            <FormGroup>
              <FormLabel>代理店名</FormLabel>
              <FormInput
                type="text"
                placeholder="代理店名を入力（直接取引の場合は空欄）"
                value={addExistingForm.introducer}
                onChange={e => setAddExistingForm(prev => ({ ...prev, introducer: e.target.value }))}
              />
            </FormGroup>
            <FormGroup>
              <FormLabel>担当者</FormLabel>
              <FormSelect
                value={addExistingForm.representative}
                onChange={e => setAddExistingForm(prev => ({ ...prev, representative: e.target.value }))}
              >
                <option value="">選択してください</option>
                {salesRepresentatives.map(rep => (
                  <option key={rep} value={rep}>{rep}</option>
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup>
              <FormLabel>成約予算（円）</FormLabel>
              <FormInput
                type="number"
                placeholder="例：1000000"
                value={addExistingForm.expectedBudget}
                onChange={e => setAddExistingForm(prev => ({ ...prev, expectedBudget: e.target.value }))}
                min="0"
              />
            </FormGroup>
            <ModalActions>
              <ModalBtn onClick={() => setShowAddExistingModal(false)}>キャンセル</ModalBtn>
              <ModalBtn
                $primary
                onClick={handleAddExistingDeal}
                disabled={!addExistingForm.companyName.trim() || !addExistingForm.productName.trim() || isSaving}
              >
                {isSaving ? '保存中...' : '追加'}
              </ModalBtn>
            </ModalActions>
          </ModalBox>
        </ModalOverlay>
      )}

      {/* 受注情報入力モーダル（フェーズ8時 → 既存案件へ移行） */}
      <ReceivedOrderModal
        isOpen={receivedOrderModal.show}
        onClose={handleCancelReceivedOrder}
        onSave={handleSaveReceivedOrder}
        deal={receivedOrderModal.deal}
        isLoading={isSavingOrder}
      />

      {/* 右側詳細パネル */}
      {/* この一覧は新規/既存を1つにまとめているため、営業記録の参照先サブコレクションが
          正しく切り替わるよう、案件ごとのisExistingProjectに応じてmodeを渡し分ける
          （newCase → newCaseSalesRecords、それ以外 → salesRecords）。 */}
      {selectedDeal && (
        <ProjectDetailPanel
          project={selectedDeal}
          onClose={handlePanelClose}
          onProjectUpdate={handleProjectUpdate}
          mode={selectedDeal.isExistingProject ? undefined : 'newCase'}
          onPhase8Submitted={handlePhase8Submitted}
        />
      )}
    </PageContainer>
  );
}

export default AccountDealsListPage;
