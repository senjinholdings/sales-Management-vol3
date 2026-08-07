import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { FiSearch, FiChevronDown, FiChevronUp, FiPlus, FiTrash2, FiUpload, FiEdit3 } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { fetchProjects, fetchProjectSalesData, updateProject, fetchKeyPersons } from '../services/projectService.js';
import { CONTINUATION_STATUS_COLORS } from '../data/constants.js';
import ProjectDetailPanel from './ProjectDetailPanel.js';

// ============================================
// 定数
// ============================================

const HOVER_COLOR = '#f0f7ff';
const NA_TRUNCATE_LENGTH = 40;

// ============================================
// ユーティリティ
// ============================================

/** 金額を日本円フォーマットに変換 */
const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return '-';
  return new Intl.NumberFormat('ja-JP').format(amount) + '円';
};

/** 継続ステータスを自動計算する */
const calcContinuationStatus = (records, isExistingProject) => {
  if (!records || records.length === 0) return '';
  const latest = records[0];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 最新レコードがDeadなら問答無用で終了
  if (latest.phase === 'Dead') return '終了';

  const endDate = latest.endDate ? new Date(latest.endDate) : null;
  const startDate = latest.startDate ? new Date(latest.startDate) : null;
  const isPhase8 = latest.phase === 'フェーズ8';
  const isPhase1to7 = latest.phase && latest.phase !== 'フェーズ8' && latest.phase !== '失注';

  if (isExistingProject) {
    // 既存案件ボタンから追加された案件
    // 継続成約: フェーズ8 & (startDateが未来 or 空)
    if (isPhase8 && (!startDate || startDate > today)) {
      return '継続成約';
    }
    // 終了: フェーズ8 & endDateが過去
    if (isPhase8 && endDate && endDate < today) {
      return '終了';
    }
    // 継続提案中: フェーズ1-7 & レコード2件以上（リピート案件）
    if (isPhase1to7 && records.length >= 2) {
      return '継続提案中';
    }
    // 新規提案中: フェーズ1-7 & レコード1件（初回提案）
    if (isPhase1to7 && records.length === 1) {
      return '新規提案中';
    }
    // 施策実施中: startDateあり & (endDateが未来 or 空)
    if (startDate && (!endDate || endDate >= today)) {
      return '施策実施中';
    }
  } else {
    // 新規側から追加された案件
    // 新規成約: フェーズ8 & (startDateが未来 or 空)
    if (isPhase8 && (!startDate || startDate > today)) {
      return '新規成約';
    }
    // 終了: フェーズ8 & endDateが過去
    if (isPhase8 && endDate && endDate < today) {
      return '終了';
    }
    // 継続提案中: フェーズ1-7 & レコード2件以上
    if (isPhase1to7 && records.length >= 2) {
      return '継続提案中';
    }
    // 施策実施中: startDateあり & (endDateが未来 or 空)
    if (startDate && (!endDate || endDate >= today)) {
      return '施策実施中';
    }
  }

  return '';
};

/** 経過日数を計算（最新行のendDateから） */
const calcElapsedDays = (records) => {
  if (!records || records.length === 0) return null;
  const latest = records[0];
  if (!latest.endDate) return null;
  const endDate = new Date(latest.endDate);
  const today = new Date();
  const diff = Math.floor((today - endDate) / (1000 * 60 * 60 * 24));
  return diff;
};

/** 累計予算（フェーズ8の営業記録のbudget合計） */
const calcTotalSales = (records) => {
  if (!records || records.length === 0) return 0;
  return records
    .filter(r => r.phase === 'フェーズ8')
    .reduce((sum, r) => sum + (Number(r.budget) || 0), 0);
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

const SearchInputWrapper = styled.div`
  position: relative;
  flex: 0 0 280px;
  margin-bottom: 1rem;
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
  &:focus {
    outline: none;
    border-color: #3498db;
  }
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
  padding: 0.75rem 0.75rem;
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
  padding: 0.75rem 0.75rem;
  font-size: 0.85rem;
  color: #2c3e50;
  vertical-align: middle;
  white-space: nowrap;
`;


const StatusBadge = styled.span`
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
  background: ${props => props.$color || '#95a5a6'};
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
  width: 420px;
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

// ============================================
// コンポーネント
// ============================================

const ProjectManagementPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [salesDataMap, setSalesDataMap] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [naModalText, setNaModalText] = useState(null);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editModal, setEditModal] = useState({ show: false, project: null });
  const [showCsvGuide, setShowCsvGuide] = useState(false);
  const [addForm, setAddForm] = useState({ companyName: '', introducer: '', productName: '' });
  const [isSaving, setIsSaving] = useState(false);
  const initialOpenDone = useRef(false);

  // プロジェクト取得
  const loadProjects = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await fetchProjects();
      setProjects(data);

      // 各プロジェクトの営業データを並列取得
      const dataEntries = await Promise.all(
        data.map(async (p) => {
          const [salesData, keyPersons] = await Promise.all([
            fetchProjectSalesData(p.id),
            fetchKeyPersons(p.id),
          ]);
          return [p.id, { ...salesData, keyPersonCount: keyPersons.length }];
        })
      );
      const map = Object.fromEntries(dataEntries);
      setSalesDataMap(map);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // URLの?id=xxxからパネルを自動で開く
  useEffect(() => {
    if (initialOpenDone.current || projects.length === 0) return;
    const projectId = searchParams.get('id');
    if (projectId) {
      const target = projects.find(p => p.id === projectId);
      if (target) {
        setSelectedProject(target);
        initialOpenDone.current = true;
      }
    }
  }, [projects, searchParams]);

  // ソートハンドラー
  const handleSort = (key) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // ソートアイコン
  const renderSortIcon = (key) => {
    if (sortKey !== key) return null;
    return (
      <SortIcon>
        {sortDir === 'asc' ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />}
      </SortIcon>
    );
  };

  // 拡張データを持つプロジェクト一覧
  const enrichedProjects = useMemo(() => {
    return projects.map((p) => {
      const salesData = salesDataMap[p.id] || { records: [], latestEntry: null, activeNaEntries: [] };
      const { records, latestEntry, activeNaEntries = [] } = salesData;
      const latestRecord = records.length > 0 ? records[0] : null;

      // 最新NAの期日を取得
      const closestDueDate = activeNaEntries.length > 0
        ? activeNaEntries[0].actionDueDate || ''
        : '';

      return {
        ...p,
        introducer: p.introducer || '',
        proposalMenu: p.proposalMenu || '',
        totalSales: calcTotalSales(records),
        continuationStatus: calcContinuationStatus(records, !!p.isExistingProject),
        elapsedDays: calcElapsedDays(records),
        latestNaContent: latestEntry?.actionContent || '',
        latestNaDueDate: closestDueDate || latestEntry?.actionDueDate || '',
        activeNaEntries,
        recordCount: records.length,
        latestRecord,
        hasKeyPerson: (salesData.keyPersonCount || 0) > 0,
      };
    });
  }, [projects, salesDataMap]);

  // フィルタ + ソート
  const filteredProjects = useMemo(() => {
    let result = enrichedProjects;

    // 検索
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((p) => {
        return (
          (p.companyName || '').toLowerCase().includes(term) ||
          (p.introducer || '').toLowerCase().includes(term) ||
          (p.productName || '').toLowerCase().includes(term) ||
          (p.proposalMenu || '').toLowerCase().includes(term)
        );
      });
    }

    // デフォルトは作成日の降順
    result = [...result].sort((a, b) => {
      const getTime = (p) => p.createdAt?.toMillis?.() || p.createdAt?.seconds * 1000 || 0;
      return getTime(b) - getTime(a);
    });

    // ソート
    if (sortKey) {
      result = [...result].sort((a, b) => {
        let aVal = a[sortKey];
        let bVal = b[sortKey];
        if (typeof aVal === 'string') aVal = aVal || '';
        if (typeof bVal === 'string') bVal = bVal || '';
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const cmp = String(aVal).localeCompare(String(bVal), 'ja');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [enrichedProjects, searchTerm, sortKey, sortDir]);

  // 期日バッジ
  const renderDueDateBadge = (dueDate) => {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.floor((due - today) / (1000 * 60 * 60 * 24));
    if (diff < 0) return <DueDateBadge $type="overdue">超過</DueDateBadge>;
    if (diff <= 2) return <DueDateBadge $type="urgent">急</DueDateBadge>;
    return null;
  };

  // 会社名の一覧（重複排除、空や「-」を除外）
  const companyList = useMemo(() => {
    const names = [...new Set(projects.map(p => p.companyName).filter(v => v && v !== '-'))];
    return names.sort();
  }, [projects]);

  // 選択された会社に紐づく代理店一覧
  const agencyListForCompany = useMemo(() => {
    if (!addForm.companyName) return { agencies: [], hasEmpty: false };
    const raw = projects
      .filter(p => p.companyName === addForm.companyName)
      .map(p => p.introducer || p.agencyName || '');
    const hasEmpty = raw.some(v => !v || v === '-');
    const agencies = [...new Set(raw.filter(v => v && v !== '-'))].sort();
    return { agencies, hasEmpty };
  }, [projects, addForm.companyName]);

  // 新規案件追加
  const handleAddProject = async () => {
    if (!addForm.companyName || !addForm.productName.trim()) return;
    try {
      setIsSaving(true);
      await addDoc(collection(db, 'progressDashboard'), {
        companyName: addForm.companyName,
        introducer: addForm.introducer === '__none__' ? '' : addForm.introducer,
        productName: addForm.productName.trim(),
        status: 'フェーズ8',
        isExistingProject: true,
        createdAt: serverTimestamp()
      });
      setShowAddModal(false);
      setAddForm({ companyName: '', introducer: '', productName: '' });
      await loadProjects();
    } catch (error) {
      console.error('Failed to add project:', error);
      alert('案件の追加に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // 案件削除（既存案件ボタンから追加したもののみ）
  const handleDeleteProject = async (e, projectId) => {
    e.stopPropagation();
    if (!window.confirm('この案件を削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'progressDashboard', projectId));
      await loadProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
      alert('削除に失敗しました');
    }
  };

  // CSV一括取り込み
  const handleCsvImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(line => line.trim());

    // ヘッダー行をスキップ（会社名,代理店名,商材名 のような行）
    const startIdx = lines[0].includes('会社名') ? 1 : 0;
    const rows = lines.slice(startIdx).map(line => {
      const cols = line.split(',').map(c => c.trim());
      return { companyName: cols[0] || '', introducer: cols[1] || '', productName: cols[2] || '' };
    }).filter(r => r.companyName && r.productName);

    if (rows.length === 0) {
      alert('取り込めるデータがありません。\nCSVフォーマット: 会社名,代理店名,商材名');
      return;
    }

    if (!window.confirm(`${rows.length}件の案件を一括追加しますか？`)) return;

    try {
      for (const row of rows) {
        await addDoc(collection(db, 'progressDashboard'), {
          companyName: row.companyName,
          introducer: row.introducer === '-' ? '' : row.introducer,
          productName: row.productName,
          status: 'フェーズ8',
          isExistingProject: true,
          createdAt: serverTimestamp()
        });
      }
      alert(`${rows.length}件を追加しました`);
      await loadProjects();
    } catch (error) {
      console.error('CSV import failed:', error);
      alert('CSV取り込みに失敗しました');
    }
  };

  // 編集モーダル保存
  const handleEditSave = async () => {
    const p = editModal.project;
    if (!p) return;
    try {
      await updateProject(p.id, {
        companyName: p.companyName,
        introducer: p.introducer,
        productName: p.productName
      });
      setProjects(prev => prev.map(proj =>
        proj.id === p.id ? { ...proj, companyName: p.companyName, introducer: p.introducer, productName: p.productName } : proj
      ));
      setEditModal({ show: false, project: null });
    } catch (error) {
      console.error('Failed to update project:', error);
      alert('更新に失敗しました');
    }
  };

  // プロジェクト更新
  const handleProjectUpdate = useCallback((updatedProject) => {
    setProjects((prev) =>
      prev.map((p) => p.id === updatedProject.id ? updatedProject : p)
    );
    setSelectedProject((prev) =>
      prev && prev.id === updatedProject.id ? updatedProject : prev
    );
  }, []);

  return (
    <PageContainer>
      <PageHeader>
        <Title>既存案件</Title>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <AddButton style={{ background: '#2ecc71' }} onClick={() => setShowCsvGuide(true)}>
            <FiUpload size={14} />CSV取込
          </AddButton>
          <AddButton onClick={() => setShowAddModal(true)}>
            <FiPlus size={14} />新規追加
          </AddButton>
        </div>
      </PageHeader>

      <SearchInputWrapper>
        <SearchIcon><FiSearch size={16} /></SearchIcon>
        <SearchInput
          type="text"
          placeholder="会社名・紹介者・商材名・提案メニューで検索..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </SearchInputWrapper>

      <TableContainer>
        {isLoading ? (
          <LoadingText>読み込み中...</LoadingText>
        ) : filteredProjects.length === 0 ? (
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
                <TableHeaderCell $sortable onClick={() => handleSort('totalSales')}>
                  累計予算{renderSortIcon('totalSales')}
                </TableHeaderCell>
                <TableHeaderCell>継続ステータス</TableHeaderCell>
                <TableHeaderCell $sortable onClick={() => handleSort('elapsedDays')}>
                  経過日数{renderSortIcon('elapsedDays')}
                </TableHeaderCell>
                <TableHeaderCell>ネクストアクション</TableHeaderCell>
                <TableHeaderCell $sortable onClick={() => handleSort('latestNaDueDate')}>
                  期日{renderSortIcon('latestNaDueDate')}
                </TableHeaderCell>
                <TableHeaderCell>決裁者</TableHeaderCell>
                <TableHeaderCell>継続提案</TableHeaderCell>
                <TableHeaderCell>締結</TableHeaderCell>
                <TableHeaderCell style={{ width: '40px' }}></TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              {filteredProjects.map((p) => (
                <TableRow
                  key={p.id}
                  onClick={() => { setSelectedProject(p); setSearchParams({ id: p.id }); }}
                >
                  <TableCell style={{ fontWeight: 500 }}>{p.companyName || '-'}</TableCell>
                  <TableCell>{p.introducer || '-'}</TableCell>
                  <TableCell>{p.productName || '-'}</TableCell>
                  <TableCell>{p.rank || '-'}</TableCell>
                  <TableCell>{p.totalSales ? formatCurrency(p.totalSales) : '-'}</TableCell>
                  <TableCell>
                    {p.continuationStatus ? (
                      <StatusBadge $color={CONTINUATION_STATUS_COLORS[p.continuationStatus]}>
                        {p.continuationStatus}
                      </StatusBadge>
                    ) : '-'}
                  </TableCell>
                  <TableCell>
                    {p.elapsedDays != null ? (
                      <span style={{ color: p.elapsedDays > 90 ? '#e74c3c' : '#2c3e50' }}>
                        {p.elapsedDays}日
                      </span>
                    ) : '-'}
                  </TableCell>
                  <TableCell>
                    {!(p.activeNaEntries || []).length ? '-' : (() => {
                      const na = p.activeNaEntries[0];
                      const text = na.actionContent || '';
                      const truncated = text.length > NA_TRUNCATE_LENGTH
                        ? text.slice(0, NA_TRUNCATE_LENGTH) + '...'
                        : text;
                      return (
                        <NaText>
                          <div>
                            {na.actionDueDate && (
                              <span style={{ fontSize: '0.7rem', color: '#9b59b6', marginRight: '0.25rem' }}>
                                [{na.actionDueDate}]
                              </span>
                            )}
                            {truncated}
                            {text.length > NA_TRUNCATE_LENGTH && (
                              <MoreLink onClick={(e) => { e.stopPropagation(); setNaModalText(text); }}>
                                続きを見る
                              </MoreLink>
                            )}
                          </div>
                        </NaText>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {p.latestNaDueDate || '-'}
                    {renderDueDateBadge(p.latestNaDueDate)}
                  </TableCell>
                  <TableCell style={{ textAlign: 'center' }}>
                    {p.hasKeyPerson ? (
                      <span style={{ color: '#27ae60', fontWeight: 'bold' }}>✓</span>
                    ) : '-'}
                  </TableCell>
                  <TableCell style={{ textAlign: 'center' }}>
                    {p.continuationStatus === '新規提案中' ? (
                      <span style={{ color: '#27ae60', fontWeight: 'bold' }}>✓</span>
                    ) : '-'}
                  </TableCell>
                  <TableCell style={{ textAlign: 'center' }}>
                    {p.contractRequested ? (
                      <span style={{ color: '#27ae60', fontWeight: 'bold' }}>✓</span>
                    ) : '-'}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <FiEdit3
                        size={14}
                        style={{ color: '#f39c12', cursor: 'pointer' }}
                        onClick={() => setEditModal({ show: true, project: { ...p } })}
                        title="編集"
                      />
                      <FiTrash2
                        size={14}
                        style={{ color: '#e74c3c', cursor: 'pointer' }}
                        onClick={(e) => handleDeleteProject(e, p.id)}
                        title="削除"
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </TableContainer>

      {/* NAモーダル */}
      {naModalText && (
        <NaModal onClick={() => setNaModalText(null)}>
          <NaModalContent onClick={(e) => e.stopPropagation()}>
            <NaModalTitle>ネクストアクション</NaModalTitle>
            <NaModalText>{naModalText}</NaModalText>
            <NaModalClose onClick={() => setNaModalText(null)}>閉じる</NaModalClose>
          </NaModalContent>
        </NaModal>
      )}

      {/* CSVガイドモーダル */}
      {showCsvGuide && (
        <ModalOverlay onClick={() => setShowCsvGuide(false)}>
          <ModalBox onClick={(e) => e.stopPropagation()}>
            <ModalTitle>CSV一括取り込み</ModalTitle>
            <div style={{ fontSize: '0.85rem', color: '#2c3e50', lineHeight: 1.8 }}>
              <p style={{ margin: '0 0 0.75rem', fontWeight: 600 }}>CSVフォーマット</p>
              <div style={{ background: '#f8f9fa', padding: '0.5rem 0.75rem', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.8rem', marginBottom: '1rem' }}>
                会社名,代理店名,商材名
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
            <ModalTitle>既存案件を新規追加</ModalTitle>
            <FormGroup>
              <FormLabel>会社名</FormLabel>
              <FormSelect
                value={addForm.companyName}
                onChange={e => setAddForm(prev => ({ ...prev, companyName: e.target.value, introducer: '' }))}
              >
                <option value="">選択してください</option>
                {companyList.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup>
              <FormLabel>代理店名</FormLabel>
              <FormSelect
                value={addForm.introducer}
                onChange={e => setAddForm(prev => ({ ...prev, introducer: e.target.value }))}
                disabled={!addForm.companyName}
              >
                <option value="">選択してください</option>
                {agencyListForCompany.hasEmpty && (
                  <option value="__none__">直接取引（代理店なし）</option>
                )}
                {agencyListForCompany.agencies.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup>
              <FormLabel>商材名</FormLabel>
              <FormInput
                type="text"
                placeholder="商材名を入力"
                value={addForm.productName}
                onChange={e => setAddForm(prev => ({ ...prev, productName: e.target.value }))}
              />
            </FormGroup>
            <ModalActions>
              <ModalBtn onClick={() => setShowAddModal(false)}>キャンセル</ModalBtn>
              <ModalBtn
                $primary
                onClick={handleAddProject}
                disabled={!addForm.companyName || !addForm.productName.trim() || isSaving}
              >
                {isSaving ? '保存中...' : '追加'}
              </ModalBtn>
            </ModalActions>
          </ModalBox>
        </ModalOverlay>
      )}

      {/* 編集モーダル */}
      {editModal.show && (
        <ModalOverlay onClick={() => setEditModal({ show: false, project: null })}>
          <ModalBox onClick={e => e.stopPropagation()}>
            <ModalTitle>案件編集</ModalTitle>
            <FormGroup>
              <FormLabel>会社名</FormLabel>
              <FormInput
                type="text"
                value={editModal.project?.companyName || ''}
                onChange={e => setEditModal(prev => ({ ...prev, project: { ...prev.project, companyName: e.target.value } }))}
              />
            </FormGroup>
            <FormGroup>
              <FormLabel>代理店名</FormLabel>
              <FormInput
                type="text"
                value={editModal.project?.introducer || ''}
                onChange={e => setEditModal(prev => ({ ...prev, project: { ...prev.project, introducer: e.target.value } }))}
              />
            </FormGroup>
            <FormGroup>
              <FormLabel>商材名</FormLabel>
              <FormInput
                type="text"
                value={editModal.project?.productName || ''}
                onChange={e => setEditModal(prev => ({ ...prev, project: { ...prev.project, productName: e.target.value } }))}
              />
            </FormGroup>
            <ModalActions>
              <ModalBtn onClick={() => setEditModal({ show: false, project: null })}>キャンセル</ModalBtn>
              <ModalBtn $primary onClick={handleEditSave}>保存</ModalBtn>
            </ModalActions>
          </ModalBox>
        </ModalOverlay>
      )}

      {/* サイドパネル */}
      {selectedProject && (
        <ProjectDetailPanel
          project={selectedProject}
          onClose={() => { setSelectedProject(null); setSearchParams({}); loadProjects(); }}
          onProjectUpdate={handleProjectUpdate}
        />
      )}
    </PageContainer>
  );
};

export default ProjectManagementPage;
