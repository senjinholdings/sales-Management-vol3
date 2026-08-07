import React, { useState, useEffect, useCallback, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { FiX, FiPlus, FiTrash2, FiEdit2, FiSend, FiChevronDown, FiChevronRight, FiExternalLink, FiCheck, FiTarget, FiFileText, FiCalendar, FiCheckSquare, FiShare2 } from 'react-icons/fi';
import FirstRecallBriefModal from './FirstRecallBriefModal.js';
import ContractRequestModal from './ContractRequestModal.js';
import ScheduleConfirmModal from './ScheduleConfirmModal.js';
import DetailConfirmModal from './DetailConfirmModal.js';
import StageProgressBar from './StageProgressBar.js';
import ContractBillingSection from './ContractBillingSection.js';
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PROJECT_RANKS, STATUSES, STATUS_COLORS, CONTINUATION_STATUS_COLORS, PHASE_DESCRIPTIONS } from '../data/constants.js';
import PhaseTooltip from './PhaseTooltip.js';
import { linkifyText } from '../utils/linkify.js';
import { db } from '../firebase.js';
import { collection, getDocs, Timestamp, serverTimestamp } from 'firebase/firestore';
import { fetchAllStaff } from '../services/staffService.js';
import {
  updateProject,
  fetchMonthlyData, saveMonthlyData,
  addSalesRecord, fetchSalesRecords, updateSalesRecord, deleteSalesRecord,
  addKeyPerson, fetchKeyPersons, updateKeyPerson, deleteKeyPerson,
  addContactLog, fetchContactLogs, updateContactLog, deleteContactLog,
  addOperationMemo, fetchOperationMemos, updateOperationMemo, deleteOperationMemo,
  addSalesEntry, fetchSalesEntries, deleteSalesEntry, updateSalesEntry, updateSalesEntryStatus,
  addNaComment, fetchNaComments, updateNaComment, deleteNaComment,
  fetchProjectById, completeStageWithSync, undoStageWithSync
} from '../services/projectService.js';
import { getStageState, isStageTargetProject } from '../utils/stageProgress.js';

// ============================================
// 定数
// ============================================

const WEEKS = ['W1', 'W2', 'W3', 'W4'];
// 営業フェーズ（1〜8）
const SALES_PHASES = STATUSES.filter(s => s !== '失注');

// ============================================
// ユーティリティ関数
// ============================================

/** 金額を日本円フォーマットに変換 */
const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return '';
  return new Intl.NumberFormat('ja-JP').format(amount);
};

/** Firestoreタイムスタンプを文字列に変換 */
const formatTimestamp = (timestamp) => {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
};

/** 現在月を中心に前後12ヶ月の選択肢を生成 */
const generateMonthOptions = () => {
  const options = [];
  const now = new Date();
  for (let i = -12; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    options.push({ value, label });
  }
  return options;
};

// ============================================
// アニメーション
// ============================================

const slideIn = keyframes`
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
`;

// ============================================
// Styled Components - レイアウト
// ============================================

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1000;
`;

const Panel = styled.div`
  position: fixed;
  top: 0;
  right: 0;
  width: 50%;
  height: 100vh;
  background: #ffffff;
  box-shadow: -4px 0 12px rgba(0, 0, 0, 0.15);
  animation: ${slideIn} 0.3s ease;
  overflow-y: auto;
  z-index: 1001;
  display: flex;
  flex-direction: column;
`;

const CloseButton = styled.button`
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: none;
  border: none;
  cursor: pointer;
  color: #7f8c8d;
  font-size: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  &:hover { color: #2c3e50; }
`;

// ============================================
// Styled Components - ヘッダー
// ============================================

const PanelHeader = styled.div`
  background: #f8f9fa;
  padding: 1.5rem;
  padding-right: 3rem;
`;

const HeaderGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
`;

const HeaderItem = styled.div``;

const HeaderLabel = styled.div`
  font-size: 0.75rem;
  font-weight: 500;
  color: #95a5a6;
  margin-bottom: 0.15rem;
`;

const HeaderValue = styled.div`
  font-size: 0.9rem;
  font-weight: 600;
  color: #2c3e50;
`;

const HeaderSelect = styled.select`
  font-size: 0.85rem;
  font-weight: 600;
  color: #2c3e50;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 0.3rem 0.5rem;
  background: white;
  cursor: pointer;
  &:focus { outline: none; border-color: #3498db; }
`;

const HeaderActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
`;

const BriefButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.9rem;
  border: none;
  border-radius: 6px;
  background: #2980b9;
  color: white;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
  &:hover { background: #21618c; }
`;

const ContractButton = styled(BriefButton)`
  background: #8e44ad;
  &:hover { background: #6c3483; }
  &:disabled {
    background: #bdc3c7;
    cursor: not-allowed;
  }
  &:disabled:hover { background: #bdc3c7; }
`;

const ScheduleButton = styled(BriefButton)`
  background: #27ae60;
  &:hover { background: #219a52; }
`;

const AccountTrackButton = styled(BriefButton)`
  background: #7f8c8d;
  &:hover { background: #626e6f; }
`;

const DetailButton = styled(BriefButton)`
  background: #f39c12;
  &:hover { background: #d68910; }
`;

// ============================================
// Styled Components - タブ
// ============================================

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid #e0e0e0;
`;

const Tab = styled.button`
  padding: 0.75rem 1.5rem;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  color: ${props => props.$active ? '#3498db' : '#95a5a6'};
  border-bottom: 2px solid ${props => props.$active ? '#3498db' : 'transparent'};
  transition: all 0.2s;
  &:hover { color: #3498db; }
`;

const TabContent = styled.div`
  flex: 1;
  padding: 1.5rem;
  overflow-y: auto;
`;

// ============================================
// Styled Components - フォーム
// ============================================

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
`;

const FormGroup = styled.div`
  margin-bottom: ${props => props.$noMargin ? '0' : '1rem'};
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

const Select = styled.select`
  width: 100%;
  padding: 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  box-sizing: border-box;
  background: white;
  cursor: pointer;
  &:focus { outline: none; border-color: #3498db; }
`;

// ============================================
// Styled Components - セクション共通
// ============================================

const SectionTitle = styled.h3`
  font-size: 1rem;
  font-weight: 600;
  color: #2c3e50;
  margin: 1.5rem 0 0.75rem;
`;

const ActionForm = styled.div`
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  align-items: center;
`;

const DateInput = styled.input`
  padding: 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  &:focus { outline: none; border-color: #3498db; }
`;

const ActionInput = styled.textarea`
  width: 100%;
  padding: 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  resize: none;
  overflow-y: auto;
  min-height: 60px;
  max-height: 200px;
  font-family: inherit;
  box-sizing: border-box;
  &:focus { outline: none; border-color: #3498db; }
`;

/** テキストエリアの自動リサイズハンドラー */
const autoResize = (e) => {
  const el = e.target;
  el.style.height = 'auto';
  const maxHeight = parseInt(window.getComputedStyle(el).maxHeight) || Infinity;
  el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
};

const SendButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 4px;
  background: #3498db;
  color: white;
  cursor: pointer;
  flex-shrink: 0;
  &:hover { opacity: 0.9; }
  &:disabled { background: #bdc3c7; cursor: not-allowed; }
`;

const ActionCard = styled.div`
  background: #f8f9fa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 0.75rem;
  position: relative;
`;

const ActionContent = styled.div`
  font-size: 0.9rem;
  color: #2c3e50;
  margin-bottom: 0.25rem;
  white-space: pre-wrap;
`;

const ActionMeta = styled.div`
  font-size: 0.75rem;
  color: #7f8c8d;
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

const EditButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: #f39c12;
  opacity: 0.6;
  display: flex;
  align-items: center;
  padding: 0.2rem;
  &:hover { opacity: 1; }
`;

const EntryEditTextareaBase = styled.textarea`
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85rem;
  box-sizing: border-box;
  resize: none;
  overflow-y: auto;
  max-height: 200px;
  &:focus { outline: none; border-color: #3498db; }
`;

/** 内容に応じて自動リサイズするテキストエリア */
const EntryEditTextarea = React.forwardRef((props, ref) => (
  <EntryEditTextareaBase
    {...props}
    rows={1}
    ref={el => {
      if (el) {
        el.style.height = 'auto';
        const maxHeight = parseInt(window.getComputedStyle(el).maxHeight) || Infinity;
        el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
      }
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    }}
    onInput={e => {
      autoResize(e);
      if (props.onInput) props.onInput(e);
    }}
  />
));

const EntryEditInput = styled.input`
  padding: 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85rem;
  flex: 1;
  &:focus { outline: none; border-color: #3498db; }
`;

// ============================================
// Styled Components - テーブル系
// ============================================

const RecordTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1rem;
`;

const RecordThead = styled.thead`
  background: #f8f9fa;
`;

const RecordTh = styled.th`
  padding: 0.6rem 0.75rem;
  text-align: left;
  font-size: 0.8rem;
  font-weight: 600;
  color: #7f8c8d;
  border-bottom: 2px solid #e9ecef;
`;

const RecordTr = styled.tr`
  border-bottom: 1px solid #eee;
  &:hover { background: #f8f9fa; }
`;

const RecordTd = styled.td`
  padding: 0.6rem 0.75rem;
  font-size: 0.875rem;
  color: #2c3e50;
  vertical-align: middle;
`;

const RecordInput = styled.input`
  width: 100%;
  padding: 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  box-sizing: border-box;
  &:focus { outline: none; border-color: #3498db; }
`;

const IconButton = styled.button`
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
  margin-right: 0.25rem;
  &:hover { background: #f8f9fa; color: ${props => props.$danger ? '#e74c3c' : '#3498db'}; border-color: ${props => props.$danger ? '#e74c3c' : '#3498db'}; }
`;

const AddButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  border: 1px dashed #3498db;
  border-radius: 4px;
  background: white;
  color: #3498db;
  cursor: pointer;
  font-size: 0.85rem;
  &:hover { background: #f0f8ff; }
`;

const SaveCancelButtons = styled.div`
  display: flex;
  gap: 0.25rem;
`;

const SmallButton = styled.button`
  padding: 0.3rem 0.6rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 500;
  background: ${props => props.$primary ? '#3498db' : '#e9ecef'};
  color: ${props => props.$primary ? 'white' : '#495057'};
  &:hover { opacity: 0.9; }
`;

// ============================================
// Styled Components - キーパーソン
// ============================================

const PersonCard = styled.div`
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  position: relative;
`;

const PersonName = styled.div`
  font-size: 1rem;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 0.25rem;
`;

const PersonTitle = styled.div`
  font-size: 0.85rem;
  color: #7f8c8d;
  margin-bottom: 0.15rem;
`;

const PersonContact = styled.div`
  font-size: 0.85rem;
  color: #3498db;
  margin-bottom: 0.15rem;
`;

const PersonNote = styled.div`
  font-size: 0.85rem;
  color: #555;
  margin-top: 0.5rem;
`;

const CardActions = styled.div`
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  gap: 0.25rem;
`;

const PersonFormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  margin-bottom: 0.75rem;
`;

const EmptyText = styled.div`
  text-align: center;
  padding: 2rem;
  color: #95a5a6;
  font-size: 0.9rem;
`;

// ============================================
// Styled Components - 接触ログ
// ============================================

const ContactLogPanel = styled.div`
  border-top: 1px solid #e0e0e0;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
`;

const ContactLogCard = styled.div`
  background: #f8f9fa;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  position: relative;
`;

const ContactLogDate = styled.div`
  font-size: 0.8rem;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 0.25rem;
`;

const ContactLogMemo = styled.div`
  font-size: 0.85rem;
  color: #555;
  white-space: pre-wrap;
  word-break: break-word;
`;

const ContactLogActions = styled.div`
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  gap: 0.25rem;
`;

// ============================================
// Styled Components - 営業記録展開行
// ============================================

const ExpandableRow = styled.tr`
  cursor: pointer;
  border-bottom: 1px solid #eee;
  &:hover { background: #f8f9fa; }
`;

const ExpandedSection = styled.tr`
  background: #fafbfc;
`;

const ExpandedContent = styled.td`
  padding: 1rem;
  border-bottom: 2px solid #e0e0e0;
`;

const SubSection = styled.div`
  margin-bottom: 1rem;
`;

const SubSectionTitle = styled.h4`
  font-size: 0.85rem;
  font-weight: 600;
  color: #555;
  margin: 0 0 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const PhaseBadge = styled.span`
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
  background: ${props => props.$color || '#95a5a6'};
`;

const InlineInput = styled.input`
  padding: 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  background: white;
  width: 100%;
  box-sizing: border-box;
  &:focus { outline: none; border-color: #3498db; }
`;

const AssigneeSelect = styled.select`
  padding: 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  background: white;
  cursor: pointer;
  &:focus { outline: none; border-color: #3498db; }
`;

const PhaseSelectInline = styled.select`
  padding: 0.4rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  background: white;
  cursor: pointer;
  margin-left: 0.5rem;
  &:focus { outline: none; border-color: #3498db; }
`;

const ActionAssignee = styled.span`
  font-size: 0.75rem;
  color: #9b59b6;
  font-weight: 500;
`;

// ============================================
// Styled Components - 週次グラフ
// ============================================

const ChartContainer = styled.div`
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
`;

const WeeklyInputGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
  margin-bottom: 1rem;
`;

const WeekLabel = styled.div`
  font-size: 0.75rem;
  font-weight: 600;
  color: #7f8c8d;
  margin-bottom: 0.25rem;
  text-align: center;
`;

const WeekInput = styled.input`
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  text-align: center;
  box-sizing: border-box;
  &:focus { outline: none; border-color: #3498db; }
`;

// ============================================
// 運用メモセクション
// ============================================

const OperationMemoSection = ({ projectId }) => {
  const [memos, setMemos] = useState([]);
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [editingMemo, setEditingMemo] = useState(null);

  const loadMemos = useCallback(async () => {
    if (!projectId) return;
    try {
      setIsLoading(true);
      const data = await fetchOperationMemos(projectId);
      setMemos(data);
    } catch (error) {
      console.error('Failed to load operation memos:', error);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadMemos();
  }, [loadMemos]);

  const handleAddMemo = async () => {
    if (!content.trim()) return;
    try {
      await addOperationMemo(projectId, { content: content.trim() });
      setContent('');
      await loadMemos();
    } catch (error) {
      console.error('Failed to add operation memo:', error);
    }
  };

  const handleEditSave = async () => {
    if (!editingMemo || !editingMemo.content.trim()) return;
    try {
      await updateOperationMemo(projectId, editingMemo.id, { content: editingMemo.content.trim() });
      setEditingMemo(null);
      await loadMemos();
    } catch (error) {
      console.error('Failed to update operation memo:', error);
    }
  };

  const handleDeleteMemo = async (memoId) => {
    try {
      await deleteOperationMemo(projectId, memoId);
      await loadMemos();
    } catch (error) {
      console.error('Failed to delete operation memo:', error);
    }
  };

  return (
    <div>
      <SectionTitle>運用メモ</SectionTitle>
      <ActionForm>
        <ActionInput
          placeholder="運用メモを入力..."
          value={content}
          onChange={e => setContent(e.target.value)}
          onInput={autoResize}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && content.trim()) { e.preventDefault(); handleAddMemo(); } }}
          rows={1}
        />
        <SendButton onClick={handleAddMemo} disabled={!content.trim()}>
          <FiSend />
        </SendButton>
      </ActionForm>
      {isLoading ? (
        <EmptyText>読み込み中...</EmptyText>
      ) : memos.length === 0 ? (
        <EmptyText>運用メモはまだありません</EmptyText>
      ) : (
        memos.map(memo => (
          <ActionCard key={memo.id}>
            {editingMemo && editingMemo.id === memo.id ? (
              <>
                <EntryEditTextarea
                  value={editingMemo.content}
                  onChange={e => setEditingMemo(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="運用メモを入力..."
                />
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <SmallButton onClick={() => setEditingMemo(null)}>取消</SmallButton>
                  <SmallButton $primary onClick={handleEditSave}>保存</SmallButton>
                </div>
              </>
            ) : (
              <>
                <ActionContent>{linkifyText(memo.content)}</ActionContent>
                <ActionMeta>{formatTimestamp(memo.createdAt)}</ActionMeta>
                <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                  <EditButton onClick={() => setEditingMemo({ id: memo.id, content: memo.content })}>
                    <FiEdit2 size={14} />
                  </EditButton>
                  <DeleteButton onClick={() => handleDeleteMemo(memo.id)}>
                    <FiTrash2 size={14} />
                  </DeleteButton>
                </div>
              </>
            )}
          </ActionCard>
        ))
      )}
    </div>
  );
};

// ============================================
// タブ1: 運用者向け
// ============================================

const OperatorTab = ({ project, onProjectUpdate, showBilling = false }) => {
  const [formData, setFormData] = useState({
    rank: project.rank || '',
    clientGoal: project.clientGoal || ''
  });
  const [selectedMonth, setSelectedMonth] = useState('');
  const [monthlyTarget, setMonthlyTarget] = useState('');
  const [weeklySales, setWeeklySales] = useState({ w1: '', w2: '', w3: '', w4: '' });

  const monthOptions = generateMonthOptions();

  // 初期表示時に現在月を選択
  useEffect(() => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setSelectedMonth(currentMonth);
  }, []);

  // 月選択変更時にデータを取得
  useEffect(() => {
    if (!selectedMonth || !project.id) return;
    const loadMonthly = async () => {
      try {
        const data = await fetchMonthlyData(project.id, selectedMonth);
        if (data) {
          setMonthlyTarget(data.target || '');
          setWeeklySales({
            w1: data.w1 || '',
            w2: data.w2 || '',
            w3: data.w3 || '',
            w4: data.w4 || ''
          });
        } else {
          setMonthlyTarget('');
          setWeeklySales({ w1: '', w2: '', w3: '', w4: '' });
        }
      } catch (error) {
        console.error('Failed to load monthly data:', error);
      }
    };
    loadMonthly();
  }, [selectedMonth, project.id]);

  /** 案件情報フィールド変更時 */
  const handleFieldChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  /** onBlurで案件情報を保存 */
  const handleFieldBlur = async (field) => {
    try {
      await updateProject(project.id, { [field]: formData[field] });
      if (onProjectUpdate) {
        onProjectUpdate({ ...project, [field]: formData[field] });
      }
    } catch (error) {
      console.error('Failed to update project field:', error);
    }
  };

  /** セレクトボックス変更時（即座に保存） */
  const handleSelectChange = async (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    try {
      await updateProject(project.id, { [field]: value });
      if (onProjectUpdate) {
        onProjectUpdate({ ...project, [field]: value });
      }
    } catch (error) {
      console.error('Failed to update project field:', error);
    }
  };

  /** 月次データ保存（目標） */
  const handleTargetSave = async () => {
    if (!selectedMonth) return;
    try {
      await saveMonthlyData(project.id, selectedMonth, { target: monthlyTarget });
    } catch (error) {
      console.error('Failed to save monthly target:', error);
    }
  };

  /** 週次売上保存 */
  const handleWeeklySave = async (week) => {
    if (!selectedMonth) return;
    try {
      await saveMonthlyData(project.id, selectedMonth, { [week]: weeklySales[week] });
    } catch (error) {
      console.error('Failed to save weekly sales:', error);
    }
  };

  // グラフ用データ生成（累積 + 推測値）
  const targetValue = Number(monthlyTarget) || 0;

  // 入力済みの最後の週を特定
  let lastFilledIndex = -1;
  let lastFilledValue = 0;
  WEEKS.forEach((_, i) => {
    const val = Number(weeklySales[`w${i + 1}`]);
    if (val > 0) {
      lastFilledIndex = i;
      lastFilledValue = val;
    }
  });

  // 週あたりの平均増加ペース（推測用）
  const avgPacePerWeek = lastFilledIndex >= 0
    ? lastFilledValue / (lastFilledIndex + 1)
    : 0;

  const chartData = WEEKS.map((week, i) => {
    const weekKey = `w${i + 1}`;
    const inputValue = Number(weeklySales[weekKey]) || 0;
    const hasValue = inputValue > 0;

    // 実績値: 入力済みの週のみ
    const actual = hasValue ? inputValue : null;

    // 推測値: 入力済み最終週以降に点線で延長（小数点なし）
    let forecast = null;
    if (lastFilledIndex >= 0 && i > lastFilledIndex) {
      forecast = Math.round(lastFilledValue + avgPacePerWeek * (i - lastFilledIndex));
    }
    // 実績と推測の接続点（最後の入力週にも推測値を置く）
    if (i === lastFilledIndex && lastFilledIndex < WEEKS.length - 1) {
      forecast = lastFilledValue;
    }

    return {
      name: week,
      累積売上: actual,
      推測ペース: forecast,
      売上目標: targetValue || null,
    };
  });

  return (
    <div>
      <SectionTitle>案件情報</SectionTitle>
      <FormGrid>
        <FormGroup $noMargin>
          <Label>ランク</Label>
          <Select
            value={formData.rank}
            onChange={e => handleSelectChange('rank', e.target.value)}
          >
            <option value="">選択してください</option>
            {PROJECT_RANKS.map(rank => (
              <option key={rank} value={rank}>{rank}</option>
            ))}
          </Select>
        </FormGroup>
        <FormGroup $noMargin>
          <Label>クライアント目標</Label>
          <Input
            type="text"
            value={formData.clientGoal}
            onChange={e => handleFieldChange('clientGoal', e.target.value)}
            onBlur={() => handleFieldBlur('clientGoal')}
            placeholder="自由記述"
          />
        </FormGroup>
      </FormGrid>

      {/* 月次売上管理 */}
      <SectionTitle>月次売上管理</SectionTitle>
      <FormGrid>
        <FormGroup $noMargin>
          <Label>月</Label>
          <Select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          >
            {monthOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </FormGroup>
        <FormGroup $noMargin>
          <Label>売上目標</Label>
          <Input
            type="number"
            value={monthlyTarget}
            onChange={e => setMonthlyTarget(e.target.value)}
            onBlur={handleTargetSave}
            placeholder="円"
          />
        </FormGroup>
      </FormGrid>

      {/* 週次売上入力 */}
      <WeeklyInputGrid style={{ marginTop: '1rem' }}>
        {WEEKS.map((week, i) => {
          const weekKey = `w${i + 1}`;
          return (
            <div key={week}>
              <WeekLabel>{week}</WeekLabel>
              <WeekInput
                type="number"
                value={weeklySales[weekKey]}
                onChange={e => setWeeklySales(prev => ({ ...prev, [weekKey]: e.target.value }))}
                onBlur={() => handleWeeklySave(weekKey)}
                placeholder="円"
              />
            </div>
          );
        })}
      </WeeklyInputGrid>

      {/* グラフ */}
      <ChartContainer>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3498db" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3498db" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={v => formatCurrency(v)} />
            <Tooltip formatter={(v, name) => v != null ? [formatCurrency(v) + '円', name] : ['-', name]} />
            <Legend />
            {targetValue > 0 && (
              <Line type="monotone" dataKey="売上目標" stroke="#e74c3c" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
            )}
            <Area type="monotone" dataKey="累積売上" stroke="#3498db" strokeWidth={2} fill="url(#salesFill)" dot={{ r: 4 }} connectNulls />
            <Line type="monotone" dataKey="推測ペース" stroke="#3498db" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3, strokeDasharray: '0' }} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>

      {/* 契約・請求管理（運用管理から開いた場合のみ。月次売上管理=クライアント商品売上とは別概念） */}
      {showBilling && (
        <ContractBillingSection project={project} onProjectUpdate={onProjectUpdate} />
      )}

      {/* 運用メモ */}
      <OperationMemoSection projectId={project.id} />
    </div>
  );
};

// ============================================
// 営業記録展開コンテンツ（メモ + NA統合入力）
// ============================================

const SalesRecordEntries = ({ projectId, record, onPhaseUpdate, onRecordFieldChange, operators, salesReps, subCol = 'salesRecords', onPhase8Submitted }) => {
  const [entries, setEntries] = useState([]);
  // NA詳細パネル（2層目スライドイン）
  const [naDetailEntry, setNaDetailEntry] = useState(null);
  const [naComments, setNaComments] = useState([]);
  const [naCommentText, setNaCommentText] = useState('');
  const [naEditingCommentId, setNaEditingCommentId] = useState(null);
  const [naEditCommentText, setNaEditCommentText] = useState('');
  const CURRENT_USER = 'system';
  const [memoContent, setMemoContent] = useState('');
  // NA複数対応: 配列で管理
  const EMPTY_NA = { actionContent: '', actionDueDate: '', actionAssignee: '' };
  const [naItems, setNaItems] = useState([{ ...EMPTY_NA }]);
  const [currentPhase, setCurrentPhase] = useState(record.phase || 'フェーズ1');
  const [isLoading, setIsLoading] = useState(false);
  const [proposalMenuList, setProposalMenuList] = useState([]);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  // Dead時のNA自動セット制御
  const autoDeadNaSetRef = useRef(false);

  /** 提案メニューマスターを取得 */
  useEffect(() => {
    const fetchMenus = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'proposalMenus'));
        const menus = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(m => m.isActive !== false)
          .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
          .map(m => m.name);
        setProposalMenuList(menus);
      } catch (error) {
        console.error('Failed to fetch proposal menus:', error);
      }
    };
    fetchMenus();
  }, []);

  /** エントリを取得（降順） */
  const loadEntries = useCallback(async () => {
    if (!projectId || !record.id) return;
    try {
      setIsLoading(true);
      const data = await fetchSalesEntries(projectId, record.id, subCol);
      setEntries(data);
      setEntriesLoaded(true);
    } catch (error) {
      console.error('Failed to load sales entries:', error);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, record.id, subCol]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // 最新エントリのフェーズを初期値にする
  useEffect(() => {
    if (entries.length > 0 && entries[0].phase) {
      setCurrentPhase(entries[0].phase);
    }
  }, [entries]);

  // フェーズ3滞留時の決裁者NA自動セットは廃止（増田版ProgressDashboardのフェーズ4滞留チェックに一本化）

  // フェーズがDeadの場合、3ヶ月後再アプローチのNAを自動登録
  useEffect(() => {
    if (autoDeadNaSetRef.current || !entriesLoaded) return;
    const AUTO_DEAD_NA_CONTENT = '3ヶ月後に再アプローチの連絡を入れる';

    const persistedPhase = entries[0]?.phase || record.phase;
    if (persistedPhase !== 'Dead') return;

    // 同内容の未完了NAが既に登録済みならスキップ（二重登録防止）
    if (entries.some(e => e.actionContent === AUTO_DEAD_NA_CONTENT && e.actionStatus !== 'done')) return;

    // Deadになった日: 最新の「→Dead」変更エントリ → 記録の登録日 → 記録の作成日時
    const deadEntry = entries.find(e => e.phaseChange && e.phaseChange.endsWith('→Dead'));
    let deadStart = null;
    if (deadEntry?.createdAt) {
      deadStart = deadEntry.createdAt.toDate ? deadEntry.createdAt.toDate() : new Date(deadEntry.createdAt);
    } else if (record.date) {
      deadStart = new Date(record.date);
    } else if (record.createdAt) {
      deadStart = record.createdAt.toDate ? record.createdAt.toDate() : new Date(record.createdAt);
    }
    if (!deadStart || isNaN(deadStart.getTime())) return;

    // 期日: Deadになった日から3ヶ月後（ローカル日付で整形）
    const due = new Date(deadStart);
    due.setMonth(due.getMonth() + 3);
    const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;

    // 担当者: マスターのフルネーム表記（例: 荒幡 輝）に合わせる
    const allReps = [...new Set([...(salesReps || []), ...(operators || [])])];
    const assignee = allReps.find(name => name.includes('荒幡')) || '荒幡';

    // 同一マウント内での再実行防止（await前に立てる）
    autoDeadNaSetRef.current = true;

    (async () => {
      try {
        await addSalesEntry(projectId, record.id, {
          memoContent: '',
          actionContent: AUTO_DEAD_NA_CONTENT,
          actionDueDate: dueDate,
          actionAssignee: assignee,
          phase: persistedPhase,
          phaseChange: ''
        }, subCol);
        await loadEntries();
      } catch (error) {
        console.error('Failed to auto-register dead re-approach NA:', error);
        // 失敗時は次回レンダリングで再試行できるようにフラグを戻す
        autoDeadNaSetRef.current = false;
      }
    })();
  }, [entriesLoaded, entries, record, salesReps, operators, projectId, subCol, loadEntries]);

  /** NA行の値を更新するヘルパー */
  const updateNaItem = (index, field, value) => {
    setNaItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  /** NA行を追加 */
  const addNaRow = () => {
    setNaItems(prev => [...prev, { ...EMPTY_NA }]);
  };

  /** NA行を削除 */
  const removeNaRow = (index) => {
    setNaItems(prev => prev.length <= 1 ? [{ ...EMPTY_NA }] : prev.filter((_, i) => i !== index));
  };

  /** まとめて送信（NA複数対応） */
  const handleSubmit = async () => {
    const hasMemo = memoContent.trim();
    // 入力済みNAを抽出
    const filledNas = naItems.filter(na => na.actionContent.trim());
    if (!hasMemo && filledNas.length === 0) return;
    try {
      const phaseChanged = currentPhase !== record.phase;
      const phaseChange = phaseChanged ? `${record.phase}→${currentPhase}` : '';

      if (filledNas.length <= 1) {
        // NA 0〜1件: 従来通り1エントリ（groupIdなし）
        const na = filledNas[0] || EMPTY_NA;
        await addSalesEntry(projectId, record.id, {
          memoContent: memoContent.trim() || '',
          actionContent: na.actionContent.trim() || '',
          actionDueDate: na.actionDueDate || '',
          actionAssignee: na.actionAssignee || '',
          phase: currentPhase,
          phaseChange
        }, subCol);
      } else {
        // NA 2件以上: groupIdで紐付けて1カード表示
        const groupId = crypto.randomUUID();
        for (let i = 0; i < filledNas.length; i++) {
          const na = filledNas[i];
          await addSalesEntry(projectId, record.id, {
            memoContent: i === 0 ? (memoContent.trim() || '') : '',
            actionContent: na.actionContent.trim(),
            actionDueDate: na.actionDueDate || '',
            actionAssignee: na.actionAssignee || '',
            phase: currentPhase,
            phaseChange: i === 0 ? phaseChange : '',
            groupId
          }, subCol);
        }
      }

      // フェーズが変更されていたら営業記録も更新
      if (phaseChanged) {
        await updateSalesRecord(projectId, record.id, { phase: currentPhase }, subCol);
        onPhaseUpdate(record.id, currentPhase);
      }
      setMemoContent('');
      setNaItems([{ ...EMPTY_NA }]);
      await loadEntries();

      // フェーズ8に変更された場合、既存案件への移行を提案
      if (phaseChanged && currentPhase === 'フェーズ8' && onPhase8Submitted) {
        onPhase8Submitted();
      }
    } catch (error) {
      console.error('Failed to add sales entry:', error);
      alert('メモの保存に失敗しました');
    }
  };

  /** NAステータスの色とラベルを返す */
  const getNaStatusStyle = (status) => {
    switch (status) {
      case 'done':      return { bg: '#95a5a6', label: 'Done' };
      case 'mustToday': return { bg: '#e74c3c', label: '本日必達' };
      case 'reviewing': return { bg: '#f39c12', label: 'レビュー待ち' };
      default:          return { bg: '#8b0000', label: 'todo' };
    }
  };

  /** NAステータス切替（active⇔done、他ステータスからはdoneへ） */
  const handleToggleNaStatus = async (entryId, currentStatus) => {
    const newStatus = currentStatus === 'done' ? 'active' : 'done';

    // ステージ連動NA: 完了/取消はステージ操作として同期する（データの正はstageProgress）
    // 進行ステージの対象外案件（基準日より前の受注など）のステージNAは通常NAとして扱う
    const entry = entries.find(e => e.id === entryId);
    if (entry?.stageNaStage != null) {
      try {
        const project = await fetchProjectById(projectId);
        if (isStageTargetProject(project)) {
          const state = getStageState(project?.stageProgress);
          if (newStatus === 'done') {
            if (!state.allDone && entry.stageNaStage > state.currentStage) {
              alert('先のステージのNAは完了にできません。先に前のステージを完了してください');
              return;
            }
            if (!state.allDone && state.currentStage === entry.stageNaStage) {
              // 現在ステージのNA完了 → ステージを進める（次ステージNAの生成も同期される）
              await completeStageWithSync(projectId, entry.stageNaStage);
              await loadEntries();
              return;
            }
            // ステージ側は完了済みでNAだけ残っているズレは通常更新で追従させる
          } else {
            if (state.undoableStage !== entry.stageNaStage) {
              alert('このNAはステージ連動のため、ここでは完了を取り消せません（取り消せるのは直前に完了したステージのみです）');
              return;
            }
            if (!window.confirm(`「${entry.actionContent}」のステージ完了を取り消しますか？`)) return;
            await undoStageWithSync(projectId, entry.stageNaStage);
            await loadEntries();
            return;
          }
        }
        // 対象外案件のステージNAはそのまま通常のトグル処理へ
      } catch (error) {
        console.error('Failed to sync stage from NA status:', error);
        alert('ステージ連動の更新に失敗しました');
        return;
      }
    }

    try {
      await updateSalesEntryStatus(projectId, record.id, entryId, newStatus, subCol);
      setEntries(prev => prev.map(e =>
        e.id === entryId ? { ...e, actionStatus: newStatus } : e
      ));
    } catch (error) {
      console.error('Failed to toggle NA status:', error);
    }
  };

  // 編集中のエントリ（単一 or グループ）
  const [editingEntry, setEditingEntry] = useState(null);
  // グループ編集中のエントリ群
  const [editingGroup, setEditingGroup] = useState(null);

  const handleEditSave = async () => {
    if (!editingEntry) return;
    try {
      // 既存エントリの更新
      const updateData = {
        memoContent: editingEntry.memoContent || '',
        actionContent: editingEntry.actionContent || '',
        actionDueDate: editingEntry.actionDueDate || '',
        actionAssignee: editingEntry.actionAssignee || ''
      };
      // createdAtが編集されている場合、Firestore Timestampに変換して含める
      if (editingEntry.createdAtEdited) {
        updateData.createdAt = Timestamp.fromDate(new Date(editingEntry.createdAtEdited));
      }
      await updateSalesEntry(projectId, record.id, editingEntry.id, updateData, subCol);

      // 追加NAを新規エントリとして保存（groupIdで紐付け）
      const extraFilled = (editingEntry.extraNaItems || []).filter(na => na.actionContent.trim());
      if (extraFilled.length > 0) {
        // 既存エントリにgroupIdがなければ生成して付与
        const groupId = editingEntry.groupId || crypto.randomUUID();
        if (!editingEntry.groupId) {
          await updateSalesEntry(projectId, record.id, editingEntry.id, { groupId }, subCol);
        }
        for (const na of extraFilled) {
          await addSalesEntry(projectId, record.id, {
            memoContent: '',
            actionContent: na.actionContent.trim(),
            actionDueDate: na.actionDueDate || '',
            actionAssignee: na.actionAssignee || '',
            phase: editingEntry.phase || '',
            phaseChange: '',
            groupId
          }, subCol);
        }
      }

      setEditingEntry(null);
      await loadEntries();
    } catch (error) {
      console.error('Failed to update sales entry:', error);
    }
  };

  /** グループ編集保存 */
  const handleGroupEditSave = async () => {
    if (!editingGroup) return;
    try {
      const groupId = editingGroup.groupId;
      // 既存エントリの更新
      for (const entry of editingGroup.entries) {
        const updateData = {
          memoContent: entry.memoContent || '',
          actionContent: entry.actionContent || '',
          actionDueDate: entry.actionDueDate || '',
          actionAssignee: entry.actionAssignee || ''
        };
        if (entry.createdAtEdited) {
          updateData.createdAt = Timestamp.fromDate(new Date(entry.createdAtEdited));
        }
        await updateSalesEntry(projectId, record.id, entry.id, updateData, subCol);
      }
      // 追加NAエントリの保存
      const extraFilled = (editingGroup.extraNaItems || []).filter(na => na.actionContent.trim());
      for (const na of extraFilled) {
        await addSalesEntry(projectId, record.id, {
          memoContent: '',
          actionContent: na.actionContent.trim(),
          actionDueDate: na.actionDueDate || '',
          actionAssignee: na.actionAssignee || '',
          phase: editingGroup.entries[0]?.phase || '',
          phaseChange: '',
          groupId
        }, subCol);
      }
      setEditingGroup(null);
      await loadEntries();
    } catch (error) {
      console.error('Failed to update group entries:', error);
      alert('メモの保存に失敗しました');
    }
  };

  /** グループ内エントリ削除 */
  const handleGroupEntryDelete = async (entryId, groupId, groupEntries) => {
    try {
      // グループ内の最後の1件 → groupIdを削除対象から外す必要はない
      if (groupEntries.length <= 2) {
        // 残り1件になる場合、残るエントリからgroupIdを除去
        const remaining = groupEntries.find(e => e.id !== entryId);
        if (remaining) {
          await updateSalesEntry(projectId, record.id, remaining.id, { groupId: '' }, subCol);
        }
      }
      await deleteSalesEntry(projectId, record.id, entryId, subCol);
      await loadEntries();
    } catch (error) {
      console.error('Failed to delete group entry:', error);
    }
  };

  /** エントリ削除 */
  const handleDelete = async (entryId) => {
    try {
      await deleteSalesEntry(projectId, record.id, entryId, subCol);
      await loadEntries();
    } catch (error) {
      console.error('Failed to delete sales entry:', error);
    }
  };

  // NA入力がある場合は日付・担当者も必須（全行チェック）
  const filledNas = naItems.filter(na => na.actionContent.trim());
  const naAllValid = filledNas.every(na => na.actionDueDate && na.actionAssignee);
  const hasAnyNa = filledNas.length > 0;
  const hasInput = (memoContent.trim() || hasAnyNa) && (hasAnyNa ? naAllValid : true);

  /** エントリをgroupIdでグルーピングする */
  const groupEntries = (entries) => {
    const result = [];
    const groupMap = new Map();
    for (const entry of entries) {
      if (entry.groupId) {
        if (!groupMap.has(entry.groupId)) {
          const group = { type: 'group', groupId: entry.groupId, entries: [] };
          groupMap.set(entry.groupId, group);
          result.push(group);
        }
        groupMap.get(entry.groupId).entries.push(entry);
      } else {
        result.push({ type: 'single', entry });
      }
    }
    return result;
  };

  const groupedEntries = groupEntries(entries);

  // --- NA詳細パネル関連 ---

  const openNaDetail = async (entry) => {
    setNaDetailEntry(entry);
    setNaCommentText('');
    setNaEditingCommentId(null);
    try {
      const data = await fetchNaComments(projectId, record.id, entry.id, subCol);
      setNaComments(data);
    } catch (error) {
      console.error('Failed to load NA comments:', error);
      setNaComments([]);
    }
  };

  const closeNaDetail = () => {
    setNaDetailEntry(null);
    setNaComments([]);
    setNaCommentText('');
    setNaEditingCommentId(null);
  };

  const handleNaAddComment = async () => {
    if (!naCommentText.trim() || !naDetailEntry) return;
    try {
      await addNaComment(projectId, record.id, naDetailEntry.id, {
        content: naCommentText.trim(), author: CURRENT_USER
      }, subCol);
      setNaCommentText('');
      const data = await fetchNaComments(projectId, record.id, naDetailEntry.id, subCol);
      setNaComments(data);
    } catch (error) {
      console.error('Failed to add NA comment:', error);
    }
  };

  const handleNaUpdateComment = async (commentId) => {
    if (!naEditCommentText.trim() || !naDetailEntry) return;
    try {
      await updateNaComment(projectId, record.id, naDetailEntry.id, commentId, {
        content: naEditCommentText.trim()
      }, subCol);
      setNaEditingCommentId(null);
      const data = await fetchNaComments(projectId, record.id, naDetailEntry.id, subCol);
      setNaComments(data);
    } catch (error) {
      console.error('Failed to update NA comment:', error);
    }
  };

  const handleNaDeleteComment = async (commentId) => {
    if (!naDetailEntry) return;
    try {
      await deleteNaComment(projectId, record.id, naDetailEntry.id, commentId, subCol);
      const data = await fetchNaComments(projectId, record.id, naDetailEntry.id, subCol);
      setNaComments(data);
    } catch (error) {
      console.error('Failed to delete NA comment:', error);
    }
  };

  /** NA詳細パネルのタイムスタンプフォーマット */
  const fmtNaTs = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <ExpandedContent colSpan={7}>
      {/* 開始日・終了日 */}
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', padding: '0.5rem 0', borderBottom: '1px solid #eee' }}>
        <FormGroup $noMargin>
          <Label>開始日</Label>
          <DateInput
            type="date"
            value={record.startDate || ''}
            onChange={e => onRecordFieldChange(record.id, 'startDate', e.target.value)}
          />
        </FormGroup>
        <FormGroup $noMargin>
          <Label>終了日</Label>
          <DateInput
            type="date"
            value={record.endDate || ''}
            onChange={e => onRecordFieldChange(record.id, 'endDate', e.target.value)}
          />
        </FormGroup>
        <FormGroup $noMargin style={{ flex: 1 }}>
          <Label>メニュー</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
            {proposalMenuList.map(menu => {
              const selected = (record.proposalMenus || []).includes(menu);
              return (
                <span
                  key={menu}
                  onClick={() => {
                    const current = record.proposalMenus || [];
                    const next = selected
                      ? current.filter(m => m !== menu)
                      : [...current, menu];
                    onRecordFieldChange(record.id, 'proposalMenus', next);
                  }}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: selected ? '#3498db' : '#ddd',
                    background: selected ? '#3498db' : 'white',
                    color: selected ? 'white' : '#7f8c8d',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {menu}
                </span>
              );
            })}
          </div>
        </FormGroup>
      </div>

      {/* フェーズ選択 */}
      <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Label style={{ margin: 0, fontWeight: 600 }}>フェーズ:</Label>
        <PhaseSelectInline
          value={currentPhase}
          onChange={e => setCurrentPhase(e.target.value)}
          style={{ marginLeft: 0 }}
        >
          {SALES_PHASES.map(phase => (
            <option key={phase} value={phase}>{phase}</option>
          ))}
        </PhaseSelectInline>
        {currentPhase !== record.phase && (
          <span style={{ fontSize: '0.75rem', color: '#e67e22' }}>※送信時に更新</span>
        )}
      </div>

      {/* 接触メモ入力 */}
      <FormGroup style={{ marginBottom: '0.5rem' }}>
        <Label>接触メモ</Label>
        <ActionInput
          placeholder="接触メモを入力..."
          value={memoContent}
          onChange={e => setMemoContent(e.target.value)}
          onInput={autoResize}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
          rows={2}
        />
      </FormGroup>

      {/* NA入力（複数対応） */}
      <FormGroup style={{ marginBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <Label style={{ margin: 0 }}>ネクストアクション</Label>
          <button
            type="button"
            onClick={addNaRow}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', border: '1px solid #3498db', borderRadius: '4px',
              background: 'white', color: '#3498db', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
              padding: 0
            }}
            title="NAを追加"
          >
            <FiPlus size={12} />
          </button>
        </div>
        {naItems.map((na, idx) => (
          <div key={idx} style={{ marginBottom: idx < naItems.length - 1 ? '0.5rem' : 0, padding: naItems.length > 1 ? '0.5rem' : 0, border: naItems.length > 1 ? '1px solid #e0e0e0' : 'none', borderRadius: '6px', background: naItems.length > 1 ? '#fafbfc' : 'transparent' }}>
            {naItems.length > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#7f8c8d', fontWeight: 600 }}>NA {idx + 1}</span>
                <DeleteButton onClick={() => removeNaRow(idx)} style={{ padding: '0.1rem' }}>
                  <FiTrash2 size={12} />
                </DeleteButton>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <DateInput
                type="date"
                value={na.actionDueDate}
                onChange={e => updateNaItem(idx, 'actionDueDate', e.target.value)}
              />
              <AssigneeSelect
                value={na.actionAssignee}
                onChange={e => updateNaItem(idx, 'actionAssignee', e.target.value)}
              >
                <option value="">担当者</option>
                {[...new Set([...(salesReps || []), ...(operators || [])])].map(rep => (
                  <option key={rep} value={rep}>{rep}</option>
                ))}
              </AssigneeSelect>
            </div>
            <ActionInput
              placeholder="ネクストアクションを入力..."
              value={na.actionContent}
              onChange={e => updateNaItem(idx, 'actionContent', e.target.value)}
              onInput={autoResize}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
              rows={2}
            />
          </div>
        ))}
      </FormGroup>

      {/* バリデーションメッセージ */}
      {hasAnyNa && !naAllValid && (
        <div style={{ fontSize: '0.8rem', color: '#e74c3c', marginBottom: '0.5rem' }}>
          ※ ネクストアクション入力時は日付と担当者が必須です
        </div>
      )}

      {/* 送信ボタン */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}>
        <SendButton
          onClick={handleSubmit}
          disabled={!hasInput}
          style={{ width: 'auto', padding: '0.5rem 1.25rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <FiSend size={14} /> 送信
        </SendButton>
      </div>

      {/* 履歴タイムライン（降順） */}
      {isLoading ? (
        <EmptyText style={{ padding: '0.5rem' }}>読み込み中...</EmptyText>
      ) : entries.length === 0 ? (
        <EmptyText style={{ padding: '0.5rem' }}>記録はまだありません</EmptyText>
      ) : (
        groupedEntries.map((item, index) => {
          if (item.type === 'group') {
            // グループカード: 複数NAを1カードにまとめて表示
            const groupEntries = item.entries;
            const firstEntry = groupEntries[0];
            const isEditingThisGroup = editingGroup && editingGroup.groupId === item.groupId;

            return (
              <ActionCard key={item.groupId}>
                {isEditingThisGroup ? (
                  // グループ編集モード
                  <>
                    <SubSection style={{ marginBottom: '0.75rem' }}>
                      <SubSectionTitle style={{ margin: '0 0 0.25rem' }}>接触メモ</SubSectionTitle>
                      <EntryEditTextarea
                        value={editingGroup.entries[0]?.memoContent || ''}
                        onChange={e => setEditingGroup(prev => ({
                          ...prev,
                          entries: prev.entries.map((en, i) => i === 0 ? { ...en, memoContent: e.target.value } : en)
                        }))}
                        placeholder="接触メモを入力..."
                      />
                    </SubSection>
                    {editingGroup.entries.map((en, idx) => (
                      <SubSection key={en.id} style={{ marginBottom: '0.75rem', padding: '0.5rem', border: '1px solid #e0e0e0', borderRadius: '6px', background: '#fafbfc' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                          <SubSectionTitle style={{ margin: 0 }}>NA {idx + 1}</SubSectionTitle>
                          {editingGroup.entries.length > 1 && (
                            <DeleteButton onClick={() => setEditingGroup(prev => ({
                              ...prev,
                              entries: prev.entries.filter((_, i) => i !== idx)
                            }))} style={{ padding: '0.1rem' }}>
                              <FiTrash2 size={12} />
                            </DeleteButton>
                          )}
                        </div>
                        <EntryEditTextarea
                          value={en.actionContent || ''}
                          onChange={e => setEditingGroup(prev => ({
                            ...prev,
                            entries: prev.entries.map((item, i) => i === idx ? { ...item, actionContent: e.target.value } : item)
                          }))}
                          placeholder="ネクストアクションを入力..."
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                          <EntryEditInput
                            type="date"
                            value={en.actionDueDate || ''}
                            onChange={e => setEditingGroup(prev => ({
                              ...prev,
                              entries: prev.entries.map((item, i) => i === idx ? { ...item, actionDueDate: e.target.value } : item)
                            }))}
                          />
                          <AssigneeSelect
                            value={en.actionAssignee || ''}
                            onChange={e => setEditingGroup(prev => ({
                              ...prev,
                              entries: prev.entries.map((item, i) => i === idx ? { ...item, actionAssignee: e.target.value } : item)
                            }))}
                          >
                            <option value="">担当者</option>
                            {[...new Set([...(salesReps || []), ...(operators || [])])].map(rep => (
                              <option key={rep} value={rep}>{rep}</option>
                            ))}
                          </AssigneeSelect>
                        </div>
                      </SubSection>
                    ))}
                    {/* 追加NA行 */}
                    {(editingGroup.extraNaItems || []).map((na, idx) => (
                      <SubSection key={`extra-${idx}`} style={{ marginBottom: '0.75rem', padding: '0.5rem', border: '1px dashed #3498db', borderRadius: '6px', background: '#f0f7ff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                          <SubSectionTitle style={{ margin: 0 }}>追加NA {idx + 1}</SubSectionTitle>
                          <DeleteButton onClick={() => setEditingGroup(prev => ({
                            ...prev,
                            extraNaItems: prev.extraNaItems.filter((_, i) => i !== idx)
                          }))} style={{ padding: '0.1rem' }}>
                            <FiTrash2 size={12} />
                          </DeleteButton>
                        </div>
                        <EntryEditTextarea
                          value={na.actionContent}
                          onChange={e => setEditingGroup(prev => ({
                            ...prev,
                            extraNaItems: prev.extraNaItems.map((item, i) => i === idx ? { ...item, actionContent: e.target.value } : item)
                          }))}
                          placeholder="ネクストアクションを入力..."
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                          <EntryEditInput
                            type="date"
                            value={na.actionDueDate}
                            onChange={e => setEditingGroup(prev => ({
                              ...prev,
                              extraNaItems: prev.extraNaItems.map((item, i) => i === idx ? { ...item, actionDueDate: e.target.value } : item)
                            }))}
                          />
                          <AssigneeSelect
                            value={na.actionAssignee}
                            onChange={e => setEditingGroup(prev => ({
                              ...prev,
                              extraNaItems: prev.extraNaItems.map((item, i) => i === idx ? { ...item, actionAssignee: e.target.value } : item)
                            }))}
                          >
                            <option value="">担当者</option>
                            {[...new Set([...(salesReps || []), ...(operators || [])])].map(rep => (
                              <option key={rep} value={rep}>{rep}</option>
                            ))}
                          </AssigneeSelect>
                        </div>
                      </SubSection>
                    ))}
                    {/* NA追加ボタン */}
                    <div style={{ marginBottom: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => setEditingGroup(prev => ({
                          ...prev,
                          extraNaItems: [...(prev.extraNaItems || []), { actionContent: '', actionDueDate: '', actionAssignee: '' }]
                        }))}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                          padding: '0.25rem 0.6rem', border: '1px solid #3498db', borderRadius: '4px',
                          background: 'white', color: '#3498db', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600
                        }}
                        title="NAを追加"
                      >
                        <FiPlus size={12} /> NA追加
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                      <SmallButton onClick={() => setEditingGroup(null)}>取消</SmallButton>
                      <SmallButton $primary onClick={handleGroupEditSave}>保存</SmallButton>
                    </div>
                  </>
                ) : (
                  // グループ表示モード
                  <>
                    {/* フェーズ変更（1件目のみ） */}
                    {firstEntry.phaseChange && (
                      <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#e67e22' }}>
                          フェーズ変更: {firstEntry.phaseChange}
                        </span>
                        <PhaseBadge $color={STATUS_COLORS[firstEntry.phase]}>
                          {firstEntry.phase}
                        </PhaseBadge>
                      </div>
                    )}

                    {/* 接触メモ（1件目のみ） */}
                    {firstEntry.memoContent && (
                      <SubSection style={{ marginBottom: '0.75rem' }}>
                        <SubSectionTitle style={{ margin: '0 0 0.25rem' }}>接触メモ</SubSectionTitle>
                        <ActionContent>{linkifyText(firstEntry.memoContent)}</ActionContent>
                      </SubSection>
                    )}

                    {/* 各NAを個別に表示（独立したtodo/done） */}
                    {groupEntries.map((entry, naIdx) => entry.actionContent && (
                      <SubSection key={entry.id} style={{ marginBottom: naIdx < groupEntries.length - 1 ? '0.5rem' : 0, padding: '0.5rem', border: '1px solid #e8e8e8', borderRadius: '6px', background: '#fafbfc' }}>
                        <SubSectionTitle style={{ margin: '0 0 0.25rem' }}>
                          NA {naIdx + 1}
                          {entry.actionDueDate && (
                            <span style={{ color: '#3498db', fontWeight: 500 }}>{entry.actionDueDate}</span>
                          )}
                          {entry.actionAssignee && (
                            <ActionAssignee>{entry.actionAssignee}</ActionAssignee>
                          )}
                          <span
                            onClick={() => handleToggleNaStatus(entry.id, entry.actionStatus || 'active')}
                            style={{
                              cursor: 'pointer',
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              color: 'white',
                              background: getNaStatusStyle(entry.actionStatus || 'active').bg,
                              marginLeft: 'auto'
                            }}
                          >
                            {getNaStatusStyle(entry.actionStatus || 'active').label}
                          </span>
                          <span
                            onClick={(e) => { e.stopPropagation(); openNaDetail(entry); }}
                            style={{
                              cursor: 'pointer',
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: 500,
                              color: '#3498db',
                              border: '1px solid #3498db',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.2rem'
                            }}
                            title="NA管理ボードを開く"
                          >
                            <FiExternalLink size={10} /> NA管理
                          </span>
                        </SubSectionTitle>
                        <ActionContent style={{
                          textDecoration: entry.actionStatus === 'done' ? 'line-through' : 'none',
                          opacity: entry.actionStatus === 'done' ? 0.6 : 1
                        }}>
                          {linkifyText(entry.actionContent)}
                        </ActionContent>
                      </SubSection>
                    ))}

                    <ActionMeta style={{ marginTop: '0.5rem' }}>{formatTimestamp(firstEntry.createdAt)}</ActionMeta>
                    <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                      <EditButton onClick={() => {
                        setEditingGroup({
                          groupId: item.groupId,
                          entries: groupEntries.map(e => ({ ...e })),
                          extraNaItems: []
                        });
                      }}>
                        <FiEdit2 size={14} />
                      </EditButton>
                      <DeleteButton onClick={async () => {
                        // グループ内の全エントリを削除
                        for (const e of groupEntries) {
                          await deleteSalesEntry(projectId, record.id, e.id, subCol);
                        }
                        await loadEntries();
                      }}>
                        <FiTrash2 size={14} />
                      </DeleteButton>
                    </div>
                  </>
                )}
              </ActionCard>
            );
          }

          // 単一エントリカード（従来通り）
          const entry = item.entry;
          return (
            <ActionCard key={entry.id}>
              {editingEntry && editingEntry.id === entry.id ? (
                // 編集モード
                <>
                  <SubSection style={{ marginBottom: '0.75rem' }}>
                    <SubSectionTitle style={{ margin: '0 0 0.25rem' }}>接触メモ</SubSectionTitle>
                    <EntryEditTextarea
                      value={editingEntry.memoContent || ''}
                      onChange={e => setEditingEntry(prev => ({ ...prev, memoContent: e.target.value }))}
                      placeholder="接触メモを入力..."
                    />
                  </SubSection>
                  <SubSection style={{ marginBottom: '0.75rem' }}>
                    <SubSectionTitle style={{ margin: '0 0 0.25rem' }}>ネクストアクション</SubSectionTitle>
                    <EntryEditTextarea
                      value={editingEntry.actionContent || ''}
                      onChange={e => setEditingEntry(prev => ({ ...prev, actionContent: e.target.value }))}
                      placeholder="ネクストアクションを入力..."
                    />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <EntryEditInput
                        type="date"
                        value={editingEntry.actionDueDate || ''}
                        onChange={e => setEditingEntry(prev => ({ ...prev, actionDueDate: e.target.value }))}
                      />
                      <AssigneeSelect
                        value={editingEntry.actionAssignee || ''}
                        onChange={e => setEditingEntry(prev => ({ ...prev, actionAssignee: e.target.value }))}
                      >
                        <option value="">担当者</option>
                        {[...new Set([...(salesReps || []), ...(operators || [])])].map(rep => (
                          <option key={rep} value={rep}>{rep}</option>
                        ))}
                      </AssigneeSelect>
                    </div>
                  </SubSection>
                  {/* 追加NA行 */}
                  {(editingEntry.extraNaItems || []).map((na, idx) => (
                    <SubSection key={idx} style={{ marginBottom: '0.75rem', padding: '0.5rem', border: '1px solid #e0e0e0', borderRadius: '6px', background: '#fafbfc' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <SubSectionTitle style={{ margin: 0 }}>追加NA {idx + 1}</SubSectionTitle>
                        <DeleteButton onClick={() => setEditingEntry(prev => ({
                          ...prev,
                          extraNaItems: prev.extraNaItems.filter((_, i) => i !== idx)
                        }))} style={{ padding: '0.1rem' }}>
                          <FiTrash2 size={12} />
                        </DeleteButton>
                      </div>
                      <EntryEditTextarea
                        value={na.actionContent}
                        onChange={e => setEditingEntry(prev => ({
                          ...prev,
                          extraNaItems: prev.extraNaItems.map((item, i) => i === idx ? { ...item, actionContent: e.target.value } : item)
                        }))}
                        placeholder="ネクストアクションを入力..."
                      />
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <EntryEditInput
                          type="date"
                          value={na.actionDueDate}
                          onChange={e => setEditingEntry(prev => ({
                            ...prev,
                            extraNaItems: prev.extraNaItems.map((item, i) => i === idx ? { ...item, actionDueDate: e.target.value } : item)
                          }))}
                        />
                        <AssigneeSelect
                          value={na.actionAssignee}
                          onChange={e => setEditingEntry(prev => ({
                            ...prev,
                            extraNaItems: prev.extraNaItems.map((item, i) => i === idx ? { ...item, actionAssignee: e.target.value } : item)
                          }))}
                        >
                          <option value="">担当者</option>
                          {[...new Set([...(salesReps || []), ...(operators || [])])].map(rep => (
                            <option key={rep} value={rep}>{rep}</option>
                          ))}
                        </AssigneeSelect>
                      </div>
                    </SubSection>
                  ))}
                  {/* NA追加ボタン */}
                  <div style={{ marginBottom: '0.75rem' }}>
                    <button
                      type="button"
                      onClick={() => setEditingEntry(prev => ({
                        ...prev,
                        extraNaItems: [...(prev.extraNaItems || []), { actionContent: '', actionDueDate: '', actionAssignee: '' }]
                      }))}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                        padding: '0.25rem 0.6rem', border: '1px solid #3498db', borderRadius: '4px',
                        background: 'white', color: '#3498db', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600
                      }}
                      title="NAを追加"
                    >
                      <FiPlus size={12} /> NA追加
                    </button>
                  </div>
                  <SubSection style={{ marginBottom: '0.75rem' }}>
                    <SubSectionTitle style={{ margin: '0 0 0.25rem' }}>送信日時</SubSectionTitle>
                    <EntryEditInput
                      type="datetime-local"
                      value={editingEntry.createdAtEdited || ''}
                      onChange={e => setEditingEntry(prev => ({ ...prev, createdAtEdited: e.target.value }))}
                      style={{ flex: 'none', width: 'auto' }}
                    />
                  </SubSection>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <SmallButton onClick={() => setEditingEntry(null)}>取消</SmallButton>
                    <SmallButton $primary onClick={handleEditSave}>保存</SmallButton>
                  </div>
                </>
              ) : (
                // 表示モード
                <>
                  {/* フェーズ変更（変化時のみ表示） */}
                  {entry.phaseChange && (
                    <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#e67e22' }}>
                        フェーズ変更: {entry.phaseChange}
                      </span>
                      <PhaseBadge $color={STATUS_COLORS[entry.phase]}>
                        {entry.phase}
                      </PhaseBadge>
                    </div>
                  )}

                  {/* 接触メモ */}
                  {entry.memoContent && (
                    <SubSection style={{ marginBottom: entry.actionContent ? '0.75rem' : '0' }}>
                      <SubSectionTitle style={{ margin: '0 0 0.25rem' }}>接触メモ</SubSectionTitle>
                      <ActionContent>{linkifyText(entry.memoContent)}</ActionContent>
                    </SubSection>
                  )}

                  {/* NA */}
                  {entry.actionContent && (
                    <SubSection style={{ marginBottom: 0 }}>
                      <SubSectionTitle style={{ margin: '0 0 0.25rem' }}>
                        ネクストアクション
                        {entry.actionDueDate && (
                          <span style={{ color: '#3498db', fontWeight: 500 }}>{entry.actionDueDate}</span>
                        )}
                        {entry.actionAssignee && (
                          <ActionAssignee>{entry.actionAssignee}</ActionAssignee>
                        )}
                        <span
                          onClick={() => handleToggleNaStatus(entry.id, entry.actionStatus || 'active')}
                          style={{
                            cursor: 'pointer',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            color: 'white',
                            background: getNaStatusStyle(entry.actionStatus || 'active').bg,
                            marginLeft: 'auto'
                          }}
                        >
                          {getNaStatusStyle(entry.actionStatus || 'active').label}
                        </span>
                        <span
                          onClick={(e) => { e.stopPropagation(); openNaDetail(entry); }}
                          style={{
                            cursor: 'pointer',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 500,
                            color: '#3498db',
                            border: '1px solid #3498db',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.2rem'
                          }}
                          title="NA管理ボードを開く"
                        >
                          <FiExternalLink size={10} /> NA管理
                        </span>
                      </SubSectionTitle>
                      <ActionContent style={{
                        textDecoration: entry.actionStatus === 'done' ? 'line-through' : 'none',
                        opacity: entry.actionStatus === 'done' ? 0.6 : 1
                      }}>
                        {linkifyText(entry.actionContent)}
                      </ActionContent>
                    </SubSection>
                  )}

                  <ActionMeta style={{ marginTop: '0.5rem' }}>{formatTimestamp(entry.createdAt)}</ActionMeta>
                  <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                    <EditButton onClick={() => {
                      const date = entry.createdAt?.toDate ? entry.createdAt.toDate() : (entry.createdAt ? new Date(entry.createdAt) : new Date());
                      const isoLocal = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                      setEditingEntry({ ...entry, createdAtEdited: isoLocal, extraNaItems: [] });
                    }}>
                      <FiEdit2 size={14} />
                    </EditButton>
                    <DeleteButton onClick={() => handleDelete(entry.id)}>
                      <FiTrash2 size={14} />
                    </DeleteButton>
                  </div>
                </>
              )}
            </ActionCard>
          );
        })
      )}
      {/* NA詳細パネル（2層目：営業メモパネルの上に重ねる） */}
      {naDetailEntry && (
        <>
          <div
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.15)', zIndex: 2000
            }}
            onClick={closeNaDetail}
          />
          <div style={{
            position: 'fixed', top: 0, right: '3rem',
            width: '38%', minWidth: '360px', height: '100vh',
            background: '#fff',
            boxShadow: '-4px 0 12px rgba(0,0,0,0.15)',
            zIndex: 2001,
            display: 'flex', flexDirection: 'column',
            animation: 'naSlideIn 0.3s ease'
          }} onClick={e => e.stopPropagation()}>
            <style>{`@keyframes naSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
            {/* ヘッダー */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid #eee' }}>
              <span style={{ fontSize: '1rem', fontWeight: 600, color: '#2c3e50' }}>NA詳細</span>
              <button onClick={closeNaDetail} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#7f8c8d', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FiX size={18} />
              </button>
            </div>
            {/* ボディ */}
            <div style={{ flex: 1, padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* NA内容 */}
              <div>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#95a5a6', textTransform: 'uppercase' }}>NA内容</span>
                <div style={{ fontSize: '0.9rem', color: '#2c3e50', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '0.2rem' }}>
                  {linkifyText(naDetailEntry.actionContent)}
                </div>
              </div>
              {/* 期日 */}
              <div>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#95a5a6', textTransform: 'uppercase' }}>期日</span>
                <div style={{ fontSize: '0.9rem', color: '#2c3e50', marginTop: '0.2rem' }}>
                  {naDetailEntry.actionDueDate || '未設定'}
                </div>
              </div>
              {/* 担当者 */}
              {naDetailEntry.actionAssignee && (
                <div>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#95a5a6', textTransform: 'uppercase' }}>担当者</span>
                  <div style={{ fontSize: '0.9rem', color: '#2c3e50', marginTop: '0.2rem' }}>{naDetailEntry.actionAssignee}</div>
                </div>
              )}
              {/* ステータス */}
              <div>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#95a5a6', textTransform: 'uppercase' }}>ステータス</span>
                <div style={{ marginTop: '0.2rem' }}>
                  <span style={{
                    display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '12px',
                    fontSize: '0.75rem', fontWeight: 600, color: 'white',
                    background: naDetailEntry.actionStatus === 'done' ? '#95a5a6' : '#3498db'
                  }}>
                    {naDetailEntry.actionStatus === 'done' ? 'done' : naDetailEntry.actionStatus === 'mustToday' ? '本日必達' : naDetailEntry.actionStatus === 'reviewing' ? 'レビュー待ち' : 'todo'}
                  </span>
                </div>
              </div>

              {/* コメント欄 */}
              <div style={{ borderTop: '1px solid #eee', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#95a5a6', textTransform: 'uppercase' }}>メモ / コメント</span>

                {naComments.map(c => (
                  <div key={c.id} style={{ padding: '0.5rem 0.6rem', background: '#f9f9f9', borderRadius: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem', color: '#95a5a6' }}>
                      <span>{c.author || 'system'} — {fmtNaTs(c.createdAt)}</span>
                      {c.author === CURRENT_USER && (
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <button onClick={() => { setNaEditingCommentId(c.id); setNaEditCommentText(c.content); }} style={{ border: 'none', background: 'transparent', color: '#bdc3c7', cursor: 'pointer', padding: '0.1rem' }}><FiEdit2 size={11} /></button>
                          <button onClick={() => handleNaDeleteComment(c.id)} style={{ border: 'none', background: 'transparent', color: '#bdc3c7', cursor: 'pointer', padding: '0.1rem' }}><FiTrash2 size={11} /></button>
                        </div>
                      )}
                    </div>
                    {naEditingCommentId === c.id ? (
                      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', marginTop: '0.25rem' }}>
                        <textarea
                          value={naEditCommentText}
                          onChange={e => setNaEditCommentText(e.target.value)}
                          onInput={autoResize}
                          style={{ flex: 1, padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.85rem', resize: 'none', overflow: 'hidden', minHeight: '36px', fontFamily: 'inherit' }}
                          rows={2}
                        />
                        <button onClick={() => handleNaUpdateComment(c.id)} style={{ border: 'none', background: 'transparent', color: '#bdc3c7', cursor: 'pointer' }}><FiCheck size={14} /></button>
                        <button onClick={() => setNaEditingCommentId(null)} style={{ border: 'none', background: 'transparent', color: '#bdc3c7', cursor: 'pointer' }}><FiX size={14} /></button>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.85rem', color: '#2c3e50', whiteSpace: 'pre-wrap', marginTop: '0.15rem' }}>{linkifyText(c.content)}</div>
                    )}
                  </div>
                ))}

                {naComments.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '1rem', color: '#bdc3c7', fontSize: '0.85rem' }}>コメントはまだありません</div>
                )}

                {/* コメント入力 */}
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end' }}>
                  <textarea
                    value={naCommentText}
                    onChange={e => setNaCommentText(e.target.value)}
                    onInput={autoResize}
                    onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && naCommentText.trim()) { e.preventDefault(); handleNaAddComment(); } }}
                    placeholder="コメントを入力..."
                    rows={2}
                    style={{ flex: 1, padding: '0.6rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.85rem', resize: 'none', overflow: 'hidden', minHeight: '40px', fontFamily: 'inherit', outline: 'none' }}
                  />
                  <button
                    onClick={handleNaAddComment}
                    disabled={!naCommentText.trim()}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 36, height: 36, border: 'none', borderRadius: '50%',
                      background: naCommentText.trim() ? '#3498db' : '#bdc3c7',
                      color: 'white', cursor: naCommentText.trim() ? 'pointer' : 'not-allowed', flexShrink: 0
                    }}
                  >
                    <FiSend size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </ExpandedContent>
  );
};

// ============================================
// タブ2: 営業向け
// ============================================

const SalesTab = ({ project, operators, salesReps, subCol = 'salesRecords', onPhaseChange, onPhase8Submitted, mode }) => {
  const [records, setRecords] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editForm, setEditForm] = useState({
    phase: 'フェーズ1', budget: '', date: '', salesRep: '', operatorRep: '', startDate: '', endDate: ''
  });

  /** 営業記録を取得 */
  const loadRecords = useCallback(async () => {
    if (!project.id) return;
    try {
      const data = await fetchSalesRecords(project.id, subCol);
      data.sort((a, b) => {
        const aDate = a.createdAt?.toMillis?.() || 0;
        const bDate = b.createdAt?.toMillis?.() || 0;
        return bDate - aDate;
      });
      setRecords(data);
    } catch (error) {
      console.error('Failed to load sales records:', error);
    }
  }, [project.id, subCol]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const handleStartAdd = () => {
    setIsAdding(true);
    const today = new Date().toISOString().split('T')[0];
    setEditForm({ phase: 'フェーズ1', budget: '', date: today, salesRep: '', operatorRep: '', startDate: '', endDate: '' });
  };

  const handleSaveNew = async () => {
    try {
      await addSalesRecord(project.id, {
        phase: editForm.phase,
        budget: editForm.budget,
        date: editForm.date,
        salesRep: editForm.salesRep,
        operatorRep: editForm.operatorRep,
        startDate: editForm.startDate,
        endDate: editForm.endDate,
        recordType: mode === 'newCase' ? '新規' : '継続',
        createdAt: new Date()
      }, subCol);
      setIsAdding(false);
      await loadRecords();
    } catch (error) {
      console.error('Failed to add sales record:', error);
    }
  };

  const handleDelete = async (e, recordId) => {
    e.stopPropagation();
    try {
      await deleteSalesRecord(project.id, recordId, subCol);
      if (expandedId === recordId) setExpandedId(null);
      await loadRecords();
    } catch (error) {
      console.error('Failed to delete sales record:', error);
    }
  };

  const handlePhaseUpdate = (recordId, newPhase) => {
    setRecords(prev => prev.map(r =>
      r.id === recordId ? { ...r, phase: newPhase } : r
    ));
    // ヘッダーのフェーズも即座に更新
    if (onPhaseChange) onPhaseChange(newPhase);
  };

  /** 営業記録のフィールドをインラインで変更・保存（イベント経由） */
  const handleRecordSelectChange = async (e, recordId, field) => {
    e.stopPropagation();
    const value = e.target.value;
    await saveRecordField(recordId, field, value);
  };

  /** 営業記録のフィールドを変更・保存（値指定） */
  const saveRecordField = async (recordId, field, value) => {
    try {
      await updateSalesRecord(project.id, recordId, { [field]: value }, subCol);
      setRecords(prev => prev.map(r =>
        r.id === recordId ? { ...r, [field]: value } : r
      ));
    } catch (error) {
      console.error('Failed to update sales record field:', error);
    }
  };

  const handleCancel = () => {
    setIsAdding(false);
  };

  const toggleExpand = (recordId) => {
    setExpandedId(prev => prev === recordId ? null : recordId);
  };

  return (
    <div>
      <SectionTitle>営業記録</SectionTitle>
      <RecordTable>
        <RecordThead>
          <tr>
            <RecordTh style={{ width: '30px' }}></RecordTh>
            <RecordTh>区分</RecordTh>
            <RecordTh>フェーズ<PhaseTooltip /></RecordTh>
            <RecordTh>予算</RecordTh>
            <RecordTh>登録日</RecordTh>
            <RecordTh>営業担当</RecordTh>
            <RecordTh>運用担当</RecordTh>
            <RecordTh>操作</RecordTh>
          </tr>
        </RecordThead>
        <tbody>
          {records.map(record => (
            <React.Fragment key={record.id}>
              <ExpandableRow onClick={() => toggleExpand(record.id)}>
                <RecordTd>
                  {expandedId === record.id
                    ? <FiChevronDown size={14} />
                    : <FiChevronRight size={14} />
                  }
                </RecordTd>
                <RecordTd>
                  <AssigneeSelect
                    value={record.recordType || (mode === 'newCase' ? '新規' : '継続')}
                    onChange={e => handleRecordSelectChange(e, record.id, 'recordType')}
                    onClick={e => e.stopPropagation()}
                  >
                    <option value="新規">新規</option>
                    <option value="継続">継続</option>
                  </AssigneeSelect>
                </RecordTd>
                <RecordTd>
                  <PhaseBadge $color={STATUS_COLORS[record.phase]}>
                    {record.phase || '-'}
                  </PhaseBadge>
                </RecordTd>
                <RecordTd>
                  <InlineInput
                    type="number"
                    value={record.budget || ''}
                    onClick={e => e.stopPropagation()}
                    onChange={e => {
                      const val = e.target.value;
                      setRecords(prev => prev.map(r => r.id === record.id ? { ...r, budget: val } : r));
                    }}
                    onBlur={e => saveRecordField(record.id, 'budget', e.target.value ? Number(e.target.value) : '')}
                    placeholder="予算"
                  />
                </RecordTd>
                <RecordTd>
                  <InlineInput
                    type="date"
                    value={record.date || ''}
                    onClick={e => e.stopPropagation()}
                    onChange={e => {
                      const val = e.target.value;
                      setRecords(prev => prev.map(r => r.id === record.id ? { ...r, date: val } : r));
                    }}
                    onBlur={e => saveRecordField(record.id, 'date', e.target.value)}
                  />
                </RecordTd>
                <RecordTd>
                  <AssigneeSelect
                    value={record.salesRep || ''}
                    onChange={e => handleRecordSelectChange(e, record.id, 'salesRep')}
                    onClick={e => e.stopPropagation()}
                  >
                    <option value="">-</option>
                    {(salesReps || []).map(rep => (
                      <option key={rep} value={rep}>{rep}</option>
                    ))}
                  </AssigneeSelect>
                </RecordTd>
                <RecordTd>
                  <AssigneeSelect
                    value={record.operatorRep || ''}
                    onChange={e => handleRecordSelectChange(e, record.id, 'operatorRep')}
                    onClick={e => e.stopPropagation()}
                  >
                    <option value="">-</option>
                    {(operators || []).map(rep => (
                      <option key={rep} value={rep}>{rep}</option>
                    ))}
                  </AssigneeSelect>
                </RecordTd>
                <RecordTd>
                  <IconButton $danger onClick={(e) => handleDelete(e, record.id)}>
                    <FiTrash2 size={14} />
                  </IconButton>
                </RecordTd>
              </ExpandableRow>
              {expandedId === record.id && (
                <ExpandedSection>
                  <SalesRecordEntries
                    projectId={project.id}
                    record={record}
                    onPhaseUpdate={handlePhaseUpdate}
                    onRecordFieldChange={saveRecordField}
                    operators={operators}
                    salesReps={salesReps}
                    subCol={subCol}
                    onPhase8Submitted={onPhase8Submitted}
                  />
                </ExpandedSection>
              )}
            </React.Fragment>
          ))}
          {isAdding && (
            <RecordTr>
              <RecordTd></RecordTd>
              <RecordTd>{mode === 'newCase' ? '新規' : '継続'}</RecordTd>
              <RecordTd>
                <select
                  value={editForm.phase}
                  onChange={e => setEditForm(prev => ({ ...prev, phase: e.target.value }))}
                  style={{ padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem' }}
                >
                  {SALES_PHASES.map(phase => (
                    <option key={phase} value={phase}>{phase}</option>
                  ))}
                </select>
              </RecordTd>
              <RecordTd>
                <RecordInput
                  type="number"
                  value={editForm.budget}
                  onChange={e => setEditForm(prev => ({ ...prev, budget: e.target.value }))}
                  placeholder="予算"
                />
              </RecordTd>
              <RecordTd>
                <RecordInput
                  type="date"
                  value={editForm.date}
                  onChange={e => setEditForm(prev => ({ ...prev, date: e.target.value }))}
                />
              </RecordTd>
              <RecordTd>
                <AssigneeSelect
                  value={editForm.salesRep}
                  onChange={e => setEditForm(prev => ({ ...prev, salesRep: e.target.value }))}
                >
                  <option value="">-</option>
                  {(salesReps || []).map(rep => (
                    <option key={rep} value={rep}>{rep}</option>
                  ))}
                </AssigneeSelect>
              </RecordTd>
              <RecordTd>
                <AssigneeSelect
                  value={editForm.operatorRep}
                  onChange={e => setEditForm(prev => ({ ...prev, operatorRep: e.target.value }))}
                >
                  <option value="">-</option>
                  {(operators || []).map(rep => (
                    <option key={rep} value={rep}>{rep}</option>
                  ))}
                </AssigneeSelect>
              </RecordTd>
              <RecordTd>
                <SaveCancelButtons>
                  <SmallButton $primary onClick={handleSaveNew}>保存</SmallButton>
                  <SmallButton onClick={handleCancel}>取消</SmallButton>
                </SaveCancelButtons>
              </RecordTd>
            </RecordTr>
          )}
        </tbody>
      </RecordTable>
      {!isAdding && (
        <AddButton onClick={handleStartAdd}>
          <FiPlus size={14} />
          営業記録を追加
        </AddButton>
      )}
    </div>
  );
};

// ============================================
// タブ3: キーパーソン
// ============================================

const KeyPersonTab = ({ project }) => {
  const [persons, setPersons] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '', title: '', contact: '', note: ''
  });
  // 接触ログ用state
  const [expandedPersonId, setExpandedPersonId] = useState(null);
  const [contactLogs, setContactLogs] = useState([]);
  const [contactForm, setContactForm] = useState({
    contactDate: new Date().toISOString().split('T')[0], memo: ''
  });
  const [editingLogId, setEditingLogId] = useState(null);
  const [editingLog, setEditingLog] = useState({ contactDate: '', memo: '' });

  /** キーパーソン一覧を取得 */
  const loadPersons = useCallback(async () => {
    if (!project.id) return;
    try {
      const data = await fetchKeyPersons(project.id);
      setPersons(data);
    } catch (error) {
      console.error('Failed to load key persons:', error);
    }
  }, [project.id]);

  useEffect(() => {
    loadPersons();
  }, [loadPersons]);

  /** 接触ログを取得 */
  const loadContactLogs = useCallback(async (personId) => {
    if (!project.id || !personId) return;
    try {
      const data = await fetchContactLogs(project.id, personId);
      setContactLogs(data);
    } catch (error) {
      console.error('Failed to load contact logs:', error);
    }
  }, [project.id]);

  /** カード展開トグル */
  const handleToggleExpand = (personId) => {
    if (expandedPersonId === personId) {
      setExpandedPersonId(null);
      setContactLogs([]);
    } else {
      setExpandedPersonId(personId);
      setEditingLogId(null);
      setContactForm({ contactDate: new Date().toISOString().split('T')[0], memo: '' });
      loadContactLogs(personId);
    }
  };

  /** 接触ログを追加 */
  const handleAddLog = async () => {
    if (!contactForm.contactDate) return;
    try {
      await addContactLog(project.id, expandedPersonId, { ...contactForm });
      setContactForm({ contactDate: new Date().toISOString().split('T')[0], memo: '' });
      await loadContactLogs(expandedPersonId);
    } catch (error) {
      console.error('Failed to add contact log:', error);
    }
  };

  /** ログ編集開始 */
  const handleStartEditLog = (log) => {
    setEditingLogId(log.id);
    setEditingLog({ contactDate: log.contactDate || '', memo: log.memo || '' });
  };

  /** ログ編集保存 */
  const handleSaveEditLog = async () => {
    try {
      await updateContactLog(project.id, expandedPersonId, editingLogId, { ...editingLog });
      setEditingLogId(null);
      await loadContactLogs(expandedPersonId);
    } catch (error) {
      console.error('Failed to update contact log:', error);
    }
  };

  /** ログ削除 */
  const handleDeleteLog = async (logId) => {
    try {
      await deleteContactLog(project.id, expandedPersonId, logId);
      await loadContactLogs(expandedPersonId);
    } catch (error) {
      console.error('Failed to delete contact log:', error);
    }
  };

  /** 追加フォームを表示 */
  const handleStartAdd = () => {
    setIsAdding(true);
    setEditForm({ name: '', title: '', contact: '', note: '' });
  };

  /** 新規キーパーソンを保存 */
  const handleSaveNew = async () => {
    if (!editForm.name.trim()) return;
    try {
      await addKeyPerson(project.id, { ...editForm });
      setIsAdding(false);
      setEditForm({ name: '', title: '', contact: '', note: '' });
      await loadPersons();
    } catch (error) {
      console.error('Failed to add key person:', error);
    }
  };

  /** 編集モードに切り替え */
  const handleStartEdit = (person) => {
    setEditingId(person.id);
    setExpandedPersonId(null);
    setEditForm({
      name: person.name || '',
      title: person.title || '',
      contact: person.contact || '',
      note: person.note || ''
    });
  };

  /** 編集を保存 */
  const handleSaveEdit = async () => {
    try {
      await updateKeyPerson(project.id, editingId, { ...editForm });
      setEditingId(null);
      await loadPersons();
    } catch (error) {
      console.error('Failed to update key person:', error);
    }
  };

  /** 削除 */
  const handleDelete = async (personId) => {
    try {
      await deleteKeyPerson(project.id, personId);
      if (expandedPersonId === personId) setExpandedPersonId(null);
      await loadPersons();
    } catch (error) {
      console.error('Failed to delete key person:', error);
    }
  };

  /** キャンセル */
  const handleCancel = () => {
    setEditingId(null);
    setIsAdding(false);
  };

  /** 編集/追加フォーム共通 */
  const renderForm = (onSave) => (
    <PersonCard>
      <PersonFormGrid>
        <FormGroup $noMargin>
          <Label>氏名</Label>
          <Input
            value={editForm.name}
            onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="氏名"
          />
        </FormGroup>
        <FormGroup $noMargin>
          <Label>役職</Label>
          <Input
            value={editForm.title}
            onChange={e => setEditForm(prev => ({ ...prev, title: e.target.value }))}
            placeholder="役職"
          />
        </FormGroup>
        <FormGroup $noMargin>
          <Label>連絡先</Label>
          <Input
            value={editForm.contact}
            onChange={e => setEditForm(prev => ({ ...prev, contact: e.target.value }))}
            placeholder="メール / 電話番号"
          />
        </FormGroup>
        <FormGroup $noMargin>
          <Label>備考</Label>
          <Input
            value={editForm.note}
            onChange={e => setEditForm(prev => ({ ...prev, note: e.target.value }))}
            placeholder="備考"
          />
        </FormGroup>
      </PersonFormGrid>
      <SaveCancelButtons>
        <SmallButton $primary onClick={onSave}>保存</SmallButton>
        <SmallButton onClick={handleCancel}>取消</SmallButton>
      </SaveCancelButtons>
    </PersonCard>
  );

  /** 接触ログパネル描画 */
  const renderContactLogs = (personId) => (
    <ContactLogPanel onClick={e => e.stopPropagation()}>
      {/* 新規追加フォーム */}
      <ActionForm>
        <DateInput
          type="date"
          value={contactForm.contactDate}
          onChange={e => setContactForm(prev => ({ ...prev, contactDate: e.target.value }))}
        />
        <ActionInput
          value={contactForm.memo}
          onChange={e => {
            setContactForm(prev => ({ ...prev, memo: e.target.value }));
            autoResize(e);
          }}
          placeholder="接触メモ..."
          rows={1}
          style={{ minHeight: '36px' }}
        />
        <SendButton onClick={handleAddLog} disabled={!contactForm.contactDate}>
          <FiSend size={14} />
        </SendButton>
      </ActionForm>
      {/* ログ一覧 */}
      {contactLogs.length === 0 ? (
        <EmptyText style={{ padding: '1rem' }}>接触ログはまだありません</EmptyText>
      ) : (
        contactLogs.map(log => (
          editingLogId === log.id ? (
            <ContactLogCard key={log.id}>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                <DateInput
                  type="date"
                  value={editingLog.contactDate}
                  onChange={e => setEditingLog(prev => ({ ...prev, contactDate: e.target.value }))}
                />
              </div>
              <ActionInput
                value={editingLog.memo}
                onChange={e => {
                  setEditingLog(prev => ({ ...prev, memo: e.target.value }));
                  autoResize(e);
                }}
                rows={2}
              />
              <SaveCancelButtons style={{ marginTop: '0.5rem' }}>
                <SmallButton $primary onClick={handleSaveEditLog}>保存</SmallButton>
                <SmallButton onClick={() => setEditingLogId(null)}>取消</SmallButton>
              </SaveCancelButtons>
            </ContactLogCard>
          ) : (
            <ContactLogCard key={log.id}>
              <ContactLogDate>{log.contactDate}</ContactLogDate>
              <ContactLogMemo>{log.memo}</ContactLogMemo>
              <ContactLogActions>
                <IconButton onClick={() => handleStartEditLog(log)}>
                  <FiEdit2 size={12} />
                </IconButton>
                <IconButton $danger onClick={() => handleDeleteLog(log.id)}>
                  <FiTrash2 size={12} />
                </IconButton>
              </ContactLogActions>
            </ContactLogCard>
          )
        ))
      )}
    </ContactLogPanel>
  );

  return (
    <div>
      <SectionTitle>キーパーソン</SectionTitle>
      {/* 追加ボタン */}
      {!isAdding && (
        <AddButton onClick={handleStartAdd} style={{ marginBottom: '1rem' }}>
          <FiPlus size={14} />
          追加
        </AddButton>
      )}
      {/* 追加フォーム */}
      {isAdding && renderForm(handleSaveNew)}
      {/* 一覧 */}
      {persons.length === 0 && !isAdding ? (
        <EmptyText>キーパーソンはまだ登録されていません</EmptyText>
      ) : (
        persons.map(person => (
          editingId === person.id ? (
            <React.Fragment key={person.id}>
              {renderForm(handleSaveEdit)}
            </React.Fragment>
          ) : (
            <PersonCard
              key={person.id}
              onClick={() => handleToggleExpand(person.id)}
              style={{ cursor: 'pointer' }}
            >
              <PersonName>
                {expandedPersonId === person.id ? <FiChevronDown size={14} style={{ marginRight: '0.25rem' }} /> : <FiChevronRight size={14} style={{ marginRight: '0.25rem' }} />}
                {person.name}
              </PersonName>
              {person.title && <PersonTitle>{person.title}</PersonTitle>}
              {person.contact && <PersonContact>{person.contact}</PersonContact>}
              {person.note && <PersonNote>{person.note}</PersonNote>}
              <CardActions onClick={e => e.stopPropagation()}>
                <IconButton onClick={() => handleStartEdit(person)}>
                  <FiEdit2 size={14} />
                </IconButton>
                <IconButton $danger onClick={() => handleDelete(person.id)}>
                  <FiTrash2 size={14} />
                </IconButton>
              </CardActions>
              {expandedPersonId === person.id && renderContactLogs(person.id)}
            </PersonCard>
          )
        ))
      )}
    </div>
  );
};

// ============================================
// メインコンポーネント
// ============================================

const ProjectDetailPanel = ({ project, onClose, onProjectUpdate, mode, onPhase8Submitted, hideSalesTab, showStageProgress = false }) => {
  const [activeTab, setActiveTab] = useState(mode === 'newCase' ? 'sales' : 'operator');
  const [operators, setOperators] = useState([]);
  const [salesReps, setSalesReps] = useState([]);
  const [latestPhase, setLatestPhase] = useState(project.status || '');
  const [showBriefModal, setShowBriefModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // モードに応じたサブコレクション名
  const salesSubCol = mode === 'newCase' ? 'newCaseSalesRecords' : 'salesRecords';

  // salesRecordsの最新レコードからフェーズ・担当者をドキュメントに同期
  useEffect(() => {
    if (!project.id) return;
    const syncLatestRecord = async () => {
      try {
        const records = await fetchSalesRecords(project.id, salesSubCol);
        if (records.length > 0) {
          records.sort((a, b) => {
            const aDate = a.date || '';
            const bDate = b.date || '';
            if (aDate !== bDate) return bDate.localeCompare(aDate);
            const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
          });
          const latest = records[0];
          const updates = {};
          // フェーズの同期
          if (latest.phase && latest.phase !== project.status) {
            updates.status = latest.phase;
            setLatestPhase(latest.phase);
          } else if (latest.phase) {
            setLatestPhase(latest.phase);
          }
          // 営業担当の同期
          if (latest.salesRep && latest.salesRep !== project.representative) {
            updates.representative = latest.salesRep;
          }
          // 不一致があれば一括更新
          if (Object.keys(updates).length > 0) {
            await updateProject(project.id, updates);
          }
        }
      } catch (error) {
        console.error('Failed to sync latest record:', error);
      }
    };
    syncLatestRecord();
  }, [project.id, salesSubCol]);

  // SalesTabからフェーズ更新を受け取るコールバック
  const handlePhaseChange = useCallback(async (newPhase) => {
    setLatestPhase(newPhase);
    // ドキュメント本体のstatusも更新（ダッシュボード集計に反映するため）
    // phaseEnteredAtはフェーズ4滞留チェック（案件一覧側）の基準時刻として使用する
    try {
      await updateProject(project.id, {
        status: newPhase,
        phaseEnteredAt: serverTimestamp(),
        phase4StagnationNaCreatedAt: null,
      });
    } catch (error) {
      console.error('Failed to update document status:', error);
    }
  }, [project.id]);

  // Firestoreからスタッフ一覧を取得
  useEffect(() => {
    const loadStaff = async () => {
      try {
        const all = await fetchAllStaff();
        setOperators(all.filter(s => s.role === 'operator').map(s => s.name));
        setSalesReps(all.filter(s => s.role === 'sales').map(s => s.name));
      } catch (error) {
        console.error('Failed to load staff:', error);
      }
    };
    loadStaff();
  }, []);

  // 第一想起①②モーダル保存後、progressDashboardの最新状態を再取得してヘッダー表示に反映
  const refreshProjectFromServer = async () => {
    try {
      const fresh = await fetchProjectById(project.id);
      if (fresh && onProjectUpdate) onProjectUpdate(fresh);
    } catch (error) {
      console.error('Failed to refresh project:', error);
    }
  };

  // ヘッダーの担当者変更
  const handleHeaderSelectChange = async (field, value) => {
    try {
      await updateProject(project.id, { [field]: value });
      if (onProjectUpdate) {
        onProjectUpdate({ ...project, [field]: value });
      }
    } catch (error) {
      console.error('Failed to update project field:', error);
    }
  };

  // ESCキーでパネルを閉じる
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!project) return null;

  // ③契約締結依頼は①②(進行スケジュール確認・詳細確認)の両方が完了してから送信可能にする
  const firstRecallContractStatus = project.firstRecallContractStatus || 'waiting';
  const isContractReady = ['ready', 'requested', 'signed'].includes(firstRecallContractStatus);

  // アカウント営業（増田管轄の大型自主提案）への分類変更。
  // 以降はAccountSalesDashboard.jsで管理され、新規/既存案件ダッシュボード・案件一覧からは除外される
  const handleMoveToAccountTrack = async () => {
    if (!window.confirm(`「${project.companyName || project.productName}」をアカウント営業に移動しますか？\n以降、新規/既存案件ダッシュボードには表示されず、アカウント営業ダッシュボードで管理されます。`)) return;
    try {
      await updateProject(project.id, { salesTrack: 'account' });
      alert('アカウント営業に移動しました。');
      if (onProjectUpdate) onProjectUpdate({ ...project, salesTrack: 'account' });
    } catch (error) {
      console.error('Failed to move to account track:', error);
      alert('移動に失敗しました');
    }
  };

  const briefButton = (
    <BriefButton onClick={() => setShowBriefModal(true)}>
      <FiTarget />
      第一想起 実施可否すり合わせ
    </BriefButton>
  );

  return (
    <>
    <Overlay onClick={onClose}>
      <Panel onClick={e => e.stopPropagation()}>
        <CloseButton onClick={onClose}><FiX /></CloseButton>

        {/* ヘッダー: 案件基本情報 + 担当者 */}
        <PanelHeader>
          {mode === 'newCase' && (
            <HeaderActions>
              {briefButton}
              <ScheduleButton onClick={() => setShowScheduleModal(true)}>
                <FiCalendar />
                ①進行スケジュール確認
              </ScheduleButton>
              <DetailButton onClick={() => setShowDetailModal(true)}>
                <FiCheckSquare />
                ②詳細確認
              </DetailButton>
              <ContractButton
                onClick={() => { if (isContractReady) setShowContractModal(true); }}
                disabled={!isContractReady}
                title={isContractReady ? undefined : '①②の確認が完了すると契約締結依頼を送信できます'}
              >
                <FiFileText />
                契約締結依頼
              </ContractButton>
            </HeaderActions>
          )}
          {project.salesTrack !== 'account' && (
            <HeaderActions>
              <AccountTrackButton onClick={handleMoveToAccountTrack}>
                <FiShare2 />
                アカウント営業に移動
              </AccountTrackButton>
            </HeaderActions>
          )}
          <HeaderGrid>
            <HeaderItem>
              <HeaderLabel>社名</HeaderLabel>
              <HeaderValue>{project.companyName || '-'}</HeaderValue>
            </HeaderItem>
            <HeaderItem>
              <HeaderLabel>代理店名</HeaderLabel>
              <HeaderValue>{project.introducer || '-'}</HeaderValue>
            </HeaderItem>
            <HeaderItem>
              <HeaderLabel>商材名</HeaderLabel>
              <HeaderValue>{project.productName || '-'}</HeaderValue>
            </HeaderItem>
            {mode === 'newCase' && latestPhase ? (
              <HeaderItem>
                <HeaderLabel>フェーズ</HeaderLabel>
                <HeaderValue>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'white',
                    background: STATUS_COLORS[latestPhase] || '#95a5a6'
                  }}>
                    {latestPhase}
                  </span>
                </HeaderValue>
              </HeaderItem>
            ) : project.continuationStatus ? (
              <HeaderItem>
                <HeaderLabel>継続ステータス</HeaderLabel>
                <HeaderValue>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: 'white',
                    background: CONTINUATION_STATUS_COLORS[project.continuationStatus] || '#95a5a6'
                  }}>
                    {project.continuationStatus}
                  </span>
                </HeaderValue>
              </HeaderItem>
            ) : null}
          </HeaderGrid>
          {mode !== 'newCase' && (
            <HeaderActions style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              {briefButton}
            </HeaderActions>
          )}
        </PanelHeader>

        {/* 受注後の進行ステージ（運用管理から開いた場合のみ。基準日以降に受注した対象案件に限る） */}
        {showStageProgress && mode !== 'newCase' && isStageTargetProject(project) && (
          <StageProgressBar project={project} onProjectUpdate={onProjectUpdate} />
        )}

        {/* タブバー（newCaseモードでは非表示） */}
        {mode !== 'newCase' && (
          <TabBar>
            <Tab
              $active={activeTab === 'operator'}
              onClick={() => setActiveTab('operator')}
            >
              運用者向け
            </Tab>
            {!hideSalesTab && (
              <Tab
                $active={activeTab === 'sales'}
                onClick={() => setActiveTab('sales')}
              >
                営業向け
              </Tab>
            )}
            <Tab
              $active={activeTab === 'keyPerson'}
              onClick={() => setActiveTab('keyPerson')}
            >
              キーパーソン
            </Tab>
          </TabBar>
        )}

        {/* タブコンテンツ */}
        <TabContent>
          {activeTab === 'operator' && mode !== 'newCase' && (
            <OperatorTab
              project={project}
              onProjectUpdate={onProjectUpdate}
              showBilling={showStageProgress}
            />
          )}
          {activeTab === 'sales' && !(hideSalesTab && mode !== 'newCase') && (
            <SalesTab project={project} operators={operators} salesReps={salesReps} subCol={salesSubCol} onPhaseChange={handlePhaseChange} onPhase8Submitted={onPhase8Submitted} mode={mode} />
          )}
          {activeTab === 'keyPerson' && mode !== 'newCase' && (
            <KeyPersonTab project={project} />
          )}
        </TabContent>
      </Panel>
    </Overlay>

    <FirstRecallBriefModal
      isOpen={showBriefModal}
      onClose={() => setShowBriefModal(false)}
      deal={{ ...project, status: latestPhase || project.status }}
      onSaved={() => alert('Slackに実施可否すり合わせ内容を送信しました。')}
    />

    <ContractRequestModal
      isOpen={showContractModal}
      onClose={() => setShowContractModal(false)}
      deal={{ ...project, status: latestPhase || project.status }}
      onSaved={() => alert('契約締結依頼を送信しました。')}
    />

    <ScheduleConfirmModal
      isOpen={showScheduleModal}
      onClose={() => setShowScheduleModal(false)}
      deal={{ ...project, status: latestPhase || project.status }}
      onSaved={async () => {
        await refreshProjectFromServer();
        alert('①進行スケジュール確認を保存しました。');
      }}
    />

    <DetailConfirmModal
      isOpen={showDetailModal}
      onClose={() => setShowDetailModal(false)}
      deal={{ ...project, status: latestPhase || project.status }}
      onSaved={async () => {
        await refreshProjectFromServer();
        alert('②詳細確認を保存しました。');
      }}
    />
    </>
  );
};

export default ProjectDetailPanel;
