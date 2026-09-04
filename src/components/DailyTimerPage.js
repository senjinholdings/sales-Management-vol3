import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import styled from 'styled-components';
import {
  FiPlus,
  FiTrash2,
  FiPlay,
  FiSquare,
  FiChevronLeft,
  FiChevronRight,
  FiChevronDown,
  FiChevronUp,
  FiClock,
  FiUser,
  FiCalendar,
  FiEdit3,
  FiSave,
  FiLink,
  FiMenu,
  FiCheck
} from 'react-icons/fi';
import { fetchStaffByRole } from '../services/staffService.js';
import {
  fetchDailyTimersByDate,
  addTask,
  addTaskAndStart,
  startTask,
  endTask,
  deleteTask,
  saveReview,
  fetchDatesWithData,
  getTaskSessions,
  updateTaskDetails,
  reorderTasks,
  planNextDayTasks,
  completeNightReview,
  reportUrgentTaskComplete
} from '../services/dailyTimerService.js';

// ============================================
// Styled Components
// ============================================

const PageContainer = styled.div`
  max-width: 1100px;
  margin: 0 auto;
`;

const Title = styled.h1`
  font-size: 1.5rem;
  font-weight: 700;
  color: #2c3e50;
  margin: 0 0 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const Section = styled.div`
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  padding: 1.5rem;
  margin-bottom: 1.5rem;
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

const DateNav = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
`;

const DateArrowButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  color: #2c3e50;
  &:hover { background: #f8f9fa; border-color: #3498db; color: #3498db; }
`;

const DateLabel = styled.div`
  font-size: 1.1rem;
  font-weight: 600;
  color: #2c3e50;
  min-width: 200px;
  text-align: center;
`;

const DateJumpButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.5rem 1rem;
  border: 1px solid ${(props) => (props.$active ? '#3498db' : '#ddd')};
  border-radius: 4px;
  background: ${(props) => (props.$active ? '#eaf4fd' : 'white')};
  color: ${(props) => (props.$active ? '#3498db' : '#2c3e50')};
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  &:hover { border-color: #3498db; color: #3498db; }
`;

// ---- カレンダーポップオーバー ----

const CalendarAnchor = styled.div`
  position: relative;
`;

const CalendarOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 90;
`;

const CalendarPopover = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 100;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  padding: 0.75rem;
  width: 280px;
`;

const CalendarHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
`;

const CalendarMonthLabel = styled.span`
  font-size: 0.9rem;
  font-weight: 600;
  color: #2c3e50;
`;

const CalendarNavButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  color: #2c3e50;
  &:hover { border-color: #3498db; color: #3498db; }
`;

const CalendarGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
`;

const CalendarWeekday = styled.div`
  text-align: center;
  font-size: 0.7rem;
  color: #95a5a6;
  padding: 0.25rem 0;
  font-weight: 500;
`;

const CalendarDay = styled.button`
  position: relative;
  height: 34px;
  border: 1px solid ${(props) => (props.$selected ? '#3498db' : 'transparent')};
  border-radius: 4px;
  background: ${(props) => (props.$selected ? '#eaf4fd' : 'transparent')};
  color: ${(props) => (props.$today ? '#3498db' : '#2c3e50')};
  font-weight: ${(props) => (props.$today || props.$selected ? 700 : 400)};
  font-size: 0.8rem;
  cursor: pointer;
  &:hover { background: #f0f7fd; }
`;

const CalendarEmptyCell = styled.div`
  height: 34px;
`;

const DataDot = styled.span`
  position: absolute;
  bottom: 3px;
  left: 50%;
  transform: translateX(-50%);
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #3498db;
`;

// ---- 追加フォーム ----

const AddForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`;

const FormRow = styled.div`
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
`;

const FormLabel = styled.span`
  font-size: 0.8rem;
  color: #7f8c8d;
  font-weight: 500;
  min-width: 70px;
`;

const Input = styled.input`
  flex: 1;
  min-width: 200px;
  padding: 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  &:focus { outline: none; border-color: #3498db; }
`;

const Select = styled.select`
  padding: 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  background: white;
  cursor: pointer;
  &:focus { outline: none; border-color: #3498db; }
`;

const MinutesChip = styled.button`
  padding: 0.5rem 0.9rem;
  border: 1px solid ${(props) => (props.$selected ? '#3498db' : '#ddd')};
  border-radius: 4px;
  background: ${(props) => (props.$selected ? '#3498db' : 'white')};
  color: ${(props) => (props.$selected ? 'white' : '#2c3e50')};
  font-size: 0.85rem;
  cursor: pointer;
  &:hover { border-color: #3498db; }
`;

const MinutesInput = styled.input`
  width: 80px;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85rem;
  &:focus { outline: none; border-color: #3498db; }
`;

const TimeInput = styled.input`
  width: 110px;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85rem;
  &:focus { outline: none; border-color: #3498db; }
`;

const AddButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.6rem 1.25rem;
  border: none;
  border-radius: 4px;
  background: #3498db;
  color: white;
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
  align-self: flex-start;
  &:hover { opacity: 0.9; }
  &:disabled { background: #bdc3c7; cursor: not-allowed; }
`;

// 割り込みタスク用: 追加と同時にタイマーを開始する（開始ボタンと同じ緑系）
const StartNowButton = styled(AddButton)`
  background: #27ae60;
`;

// ---- タスク一覧 ----

const RepSection = styled.div`
  margin-bottom: 1.25rem;
  &:last-child { margin-bottom: 0; }
`;

const RepHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #2c3e50;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #eaf4fd;
  margin-bottom: 0.5rem;
`;

const TaskList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const TaskRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  border: 1px solid ${(props) => (props.$urgent ? '#e67e22' : props.$overdue ? '#e74c3c' : props.$running ? '#3498db' : '#e0e0e0')};
  border-width: ${(props) => (props.$urgent ? '2px' : '1px')};
  background: ${(props) => (props.$urgent ? '#fef3e6' : props.$overdue ? '#fdecea' : props.$running ? '#eaf4fd' : '#f8f9fa')};
  flex-wrap: wrap;
`;

const TaskName = styled.span`
  font-size: 0.9rem;
  color: #2c3e50;
  font-weight: 500;
  flex: 1;
  min-width: 150px;
`;

const PlannedBadge = styled.span`
  font-size: 0.8rem;
  color: #7f8c8d;
  white-space: nowrap;
`;

const FixedBadge = styled.span`
  font-size: 0.75rem;
  font-weight: 600;
  color: #6c5ce7;
  background: #ecebfd;
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
  white-space: nowrap;
`;

const UrgentBadge = styled.span`
  font-size: 0.75rem;
  font-weight: 700;
  color: white;
  background: #e67e22;
  padding: 0.1rem 0.5rem;
  border-radius: 4px;
  white-space: nowrap;
`;

const ReportedBadge = styled.span`
  font-size: 0.75rem;
  font-weight: 600;
  color: #27ae60;
  white-space: nowrap;
`;

const ElapsedText = styled.span`
  font-size: 0.9rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: ${(props) => (props.$overdue ? '#c0392b' : '#2980b9')};
  white-space: nowrap;
`;

const OverdueBadge = styled.span`
  font-size: 0.8rem;
  font-weight: 600;
  color: white;
  background: #e74c3c;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  white-space: nowrap;
`;

const ResultText = styled.span`
  font-size: 0.85rem;
  color: ${(props) => (props.$overdue ? '#c0392b' : '#27ae60')};
  font-weight: 500;
  white-space: nowrap;
`;

const ActionButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.45rem 0.9rem;
  border: none;
  border-radius: 4px;
  background: ${(props) => (props.$variant === 'stop' ? '#e74c3c' : '#27ae60')};
  color: white;
  cursor: pointer;
  font-size: 0.8rem;
  white-space: nowrap;
  &:hover { opacity: 0.9; }
  &:disabled { background: #bdc3c7; cursor: not-allowed; }
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
  &:disabled { color: #ddd; cursor: not-allowed; }
`;

const EmptyText = styled.div`
  text-align: center;
  padding: 1.5rem;
  color: #95a5a6;
  font-size: 0.85rem;
`;

// 妥当性の自動判定表示（完了タスクのみ。◯=予定以内、×=超過、−=予定なし）
const ValidityMark = styled.span`
  font-size: 0.95rem;
  font-weight: 700;
  color: ${(props) =>
    props.$type === 'ok' ? '#27ae60' : props.$type === 'ng' ? '#e74c3c' : '#95a5a6'};
  white-space: nowrap;
`;

// ---- 時刻のインライン編集 ----

const EditIconButton = styled.button`
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
  &:hover { color: #3498db; border-color: #3498db; }
  &:disabled { color: #ddd; cursor: not-allowed; }
`;

const EditSessionsBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  flex: 1;
  min-width: 260px;
`;

const EditSessionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
`;

const EditSessionLabel = styled.span`
  font-size: 0.75rem;
  color: #7f8c8d;
  min-width: 40px;
`;

const EditSep = styled.span`
  font-size: 0.8rem;
  color: #7f8c8d;
`;

const EditHint = styled.span`
  font-size: 0.75rem;
  color: #95a5a6;
`;

const EditActions = styled.div`
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
`;

const CancelButton = styled.button`
  padding: 0.45rem 0.9rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  color: #7f8c8d;
  font-size: 0.8rem;
  cursor: pointer;
  &:hover { border-color: #95a5a6; color: #2c3e50; }
  &:disabled { color: #ddd; cursor: not-allowed; }
`;

const EditFieldLabel = styled.span`
  font-size: 0.75rem;
  color: #7f8c8d;
  font-weight: 500;
`;

const LinksTextarea = styled.textarea`
  width: 100%;
  box-sizing: border-box;
  min-height: 56px;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.8rem;
  font-family: inherit;
  resize: vertical;
  &:focus { outline: none; border-color: #3498db; }
`;

// ---- アウトプットリンク表示 ----

const LinkAnchor = styled.div`
  position: relative;
  display: flex;
`;

const LinkIconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 28px;
  height: 28px;
  padding: 0 5px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  color: #2980b9;
  font-size: 0.7rem;
  font-weight: 600;
  &:hover { border-color: #3498db; background: #eaf4fd; }
`;

const LinksPopover = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 100;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  padding: 0.5rem;
  min-width: 200px;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
`;

const LinkItem = styled.a`
  display: block;
  font-size: 0.8rem;
  color: #2980b9;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  &:hover { text-decoration: underline; }
`;

// ---- ドラッグ&ドロップ並び替え ----

// 行のラッパー。ドロップ位置の挿入線をborderで表示する
const RowDragWrap = styled.div`
  display: flex;
  align-items: stretch;
  gap: 0.35rem;
  border-top: 2px solid ${(props) => (props.$dropBefore ? '#3498db' : 'transparent')};
  border-bottom: 2px solid ${(props) => (props.$dropAfter ? '#3498db' : 'transparent')};
  opacity: ${(props) => (props.$dragging ? 0.4 : 1)};
  & > *:last-child { flex: 1; min-width: 0; }
`;

const DragHandle = styled.span`
  display: flex;
  align-items: center;
  padding: 0 0.15rem;
  color: #bdc3c7;
  cursor: grab;
  &:hover { color: #7f8c8d; }
  &:active { cursor: grabbing; }
`;

// ---- 振り返り（アコーディオン） ----

const ReviewHeaderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  font-size: 1.1rem;
  font-weight: 600;
  color: #2c3e50;
`;

const ReviewHeaderLeft = styled.span`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const ReviewHeaderRight = styled.span`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #7f8c8d;
`;

const ReviewSavedBadge = styled.span`
  font-size: 0.75rem;
  font-weight: 600;
  color: #27ae60;
  background: #eafaf1;
  border: 1px solid #27ae60;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
`;

const ReviewBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1.25rem;
`;

const ReviewField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
`;

const ReviewLabel = styled.label`
  font-size: 0.85rem;
  font-weight: 600;
  color: #2c3e50;
`;

const ReviewTextarea = styled.textarea`
  width: 100%;
  box-sizing: border-box;
  min-height: 80px;
  padding: 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.875rem;
  font-family: inherit;
  resize: vertical;
  &:focus { outline: none; border-color: #3498db; }
`;

const ReviewFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
`;

const UnsavedText = styled.span`
  font-size: 0.8rem;
  color: #e67e22;
  font-weight: 500;
`;

// ---- 振り返り内のタスク一覧（未完了・超過） ----

const ReviewSummaryBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const ReviewSummaryTitle = styled.h3`
  font-size: 0.9rem;
  font-weight: 600;
  color: #2c3e50;
  margin: 0;
`;

const ReviewSummaryEmpty = styled.div`
  font-size: 0.8rem;
  color: #95a5a6;
  padding: 0.25rem 0;
`;

const StateBadge = styled.span`
  font-size: 0.75rem;
  font-weight: 600;
  color: ${(props) => (props.$running ? '#2980b9' : '#7f8c8d')};
  background: ${(props) => (props.$running ? '#eaf4fd' : '#f0f0f0')};
  border: 1px solid ${(props) => (props.$running ? '#3498db' : '#ddd')};
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  white-space: nowrap;
`;

// ============================================
// 日付・時間ヘルパー
// ============================================

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const PRESET_MINUTES = [15, 30, 60, 90];

/** ローカルタイムで "YYYY-MM-DD" を返す（toISOStringはUTCになるため使わない） */
const formatDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatDateDisplay = (dateKey) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日（${weekday}）`;
};

const shiftDateKey = (dateKey, days) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return formatDateKey(new Date(y, m - 1, d + days));
};

const toMillis = (ts) => ts?.toMillis?.() ?? null;

/** 実行中の経過表示: "M:SS" または "H:MM:SS" */
const formatElapsed = (ms) => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

/** 完了行の実績表示（1分未満は秒で表示） */
const formatActual = (ms) => {
  if (ms < 60000) return `${Math.max(1, Math.floor(ms / 1000))}秒`;
  return `${Math.round(ms / 60000)}分`;
};

/** "09:00" → "9:00"（先頭ゼロを除いた表示用） */
const formatTimeHM = (hhmm) => {
  const [h, m] = hhmm.split(':');
  return `${Number(h)}:${m}`;
};

/** 予定開始時刻 + 予定時間から終了予定（"9:30"形式）を計算 */
const plannedEndTime = (hhmm, minutes) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** 予定開始時刻 + 予定時間から終了予定を time input用の "09:30" 形式で返す */
const plannedEndTimeInput = (hhmm, minutes) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** タイムスタンプ(ms)を "9:13" 形式の時刻にする */
const formatClock = (ms) => {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** タイムスタンプ(ms)を time input用の "09:13" 形式にする */
const toInputTime = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * タスクの状態と実績を分類する（実績はDBに保存せず都度計算）
 * status: 'notStarted' | 'running' | 'done'
 * 実績は閉じた作業区間の合算（closedMs）。実行中の経過は closedMs + (現在時刻 - runningStartMs)
 * 完了かつ予定ありの場合のみ diffMinutes / overdue を持つ（超過判定は表示行と共通）
 */
const getTaskTiming = (task) => {
  const sessions = getTaskSessions(task);
  if (sessions.length === 0) {
    return {
      status: 'notStarted', firstStartMs: null, closedMs: 0,
      runningStartMs: null, actualMs: null, diffMinutes: null, overdue: false
    };
  }
  const firstStartMs = toMillis(sessions[0].startedAt);
  const closedMs = sessions.reduce((sum, s) => {
    const start = toMillis(s.startedAt);
    const end = toMillis(s.endedAt);
    return start !== null && end !== null ? sum + (end - start) : sum;
  }, 0);
  const last = sessions[sessions.length - 1];
  if (toMillis(last.endedAt) === null) {
    return {
      status: 'running', firstStartMs, closedMs,
      runningStartMs: toMillis(last.startedAt), actualMs: null, diffMinutes: null, overdue: false
    };
  }
  const actualMs = closedMs;
  if (task.plannedMinutes == null) {
    return {
      status: 'done', firstStartMs, closedMs,
      runningStartMs: null, actualMs, diffMinutes: null, overdue: false
    };
  }
  const actualMinutes = Math.round(actualMs / 60000);
  const diffMinutes = actualMinutes - task.plannedMinutes;
  const overdue = actualMs > task.plannedMinutes * 60000 && diffMinutes > 0;
  return {
    status: 'done', firstStartMs, closedMs,
    runningStartMs: null, actualMs, diffMinutes, overdue
  };
};

/** 予定開始時刻がある行を時刻昇順で先に、ない行はその後ろに追加順で並べる */
const sortTasksForDisplay = (tasks) => {
  const withTime = tasks.filter((t) => t.plannedStartTime);
  const withoutTime = tasks.filter((t) => !t.plannedStartTime);
  withTime.sort((a, b) => a.plannedStartTime.localeCompare(b.plannedStartTime));
  return [...withTime, ...withoutTime];
};

/**
 * ドキュメントの表示順のタスク一覧を返す
 * manualSort（一度でもD&Dで並び替えた）ならtasks配列の並びが正、
 * 未設定の既存ドキュメントは従来どおり予定開始時刻ソート。
 * 緊急クエスト（isUrgentTask）は並び順に関わらず常に先頭に出す（最優先タスクのため）
 */
const getDisplayTasks = (dayDoc) => {
  const base = dayDoc?.manualSort ? (dayDoc.tasks || []) : sortTasksForDisplay(dayDoc?.tasks || []);
  const urgent = base.filter((t) => t.isUrgentTask);
  if (urgent.length === 0) return base;
  return [...urgent, ...base.filter((t) => !t.isUrgentTask)];
};

const LAST_REP_STORAGE_KEY = 'dailyTimerLastRepresentative';

// デイリータイマーの担当者は荒幡のみ（担当者マスターは他画面と共用のため画面側で絞る）
const REPRESENTATIVE_FILTER = '荒幡';

// ============================================
// 振り返りヘルパー
// ============================================

const REVIEW_FIELDS = [
  { key: 'notAchieved', label: '達成できなかったことはないか？なぜか？どう組み直すか？' },
  { key: 'timeImprovement', label: '時間の使い方をもっとよくすることはできないか？' },
  { key: 'reflection', label: '振り返り' },
  { key: 'nextAction', label: 'NA（明日のネクストアクション）' }
];

// 未完了タスクの予定時間合計が2時間以上の日だけ表示する追加欄
const CONDITIONAL_REVIEW_FIELDS = [
  { key: 'scheduleGapReason', label: 'なぜこんなに予定とズレたのか' }
];

const ALL_REVIEW_FIELDS = [...REVIEW_FIELDS, ...CONDITIONAL_REVIEW_FIELDS];

const normalizeReview = (review = {}) => ({
  notAchieved: review.notAchieved || '',
  timeImprovement: review.timeImprovement || '',
  reflection: review.reflection || '',
  nextAction: review.nextAction || '',
  scheduleGapReason: review.scheduleGapReason || ''
});

const hasReviewContent = (review) =>
  ALL_REVIEW_FIELDS.some((f) => (review[f.key] || '').trim() !== '');

const isSameReview = (a, b) =>
  ALL_REVIEW_FIELDS.every((f) => a[f.key] === b[f.key]);

/** カレンダーのセル（月初までの空セルはnull） */
const buildCalendarCells = ({ year, month }) => {
  const startOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(formatDateKey(new Date(year, month, d)));
  }
  return cells;
};

// ============================================
// コンポーネント
// ============================================

const DailyTimerPage = () => {
  const [selectedDate, setSelectedDate] = useState(() => formatDateKey(new Date()));
  const [loadedDate, setLoadedDate] = useState(null);
  const [salesReps, setSalesReps] = useState([]);
  const [dayDocs, setDayDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // 追加フォーム
  const [representative, setRepresentative] = useState(
    () => localStorage.getItem(LAST_REP_STORAGE_KEY) || ''
  );
  const [taskName, setTaskName] = useState('');
  const [plannedMinutes, setPlannedMinutes] = useState('');
  const [plannedStartTime, setPlannedStartTime] = useState('');

  // 時刻のインライン編集（同時に編集できるのは1行のみ）
  // { rep, taskId, times: [{ start: "HH:MM", end: "HH:MM" | "" }], links: string }
  const [editingTask, setEditingTask] = useState(null);

  // アウトプットリンクのポップオーバー（複数リンクの行のみ使用）
  // { rep, taskId } | null
  const [linksPopover, setLinksPopover] = useState(null);

  // D&D並び替え（担当者をまたぐ移動は不可）
  const [dragItem, setDragItem] = useState(null);           // { rep, taskId }
  const [dropIndicator, setDropIndicator] = useState(null); // { rep, taskId, before }

  // 行直下のタスク差し込みフォーム（同時に開けるのは1つ、時刻編集とも排他）
  // { rep, afterTaskId, startTime: "HH:MM"|"", name, minutes: string }
  const [insertForm, setInsertForm] = useState(null);

  // 振り返り
  const [reviewDraft, setReviewDraft] = useState(normalizeReview());
  const [savedReview, setSavedReview] = useState(normalizeReview());
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewKeyRef = useRef(null);
  // 翌日の予定タスク（振り返り保存時にまとめて登録する）。ローカルidは編集用の一時キー
  const [nextDayPlan, setNextDayPlan] = useState([]);
  const [nextDayTaskName, setNextDayTaskName] = useState('');
  const [nextDayPlannedMinutes, setNextDayPlannedMinutes] = useState('');
  const [nextDayPlannedStartTime, setNextDayPlannedStartTime] = useState('');

  // カレンダー
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [datesWithData, setDatesWithData] = useState(() => new Set());

  const todayKey = formatDateKey(new Date());
  const tomorrowKey = shiftDateKey(todayKey, 1);
  const isTodaySelected = selectedDate === todayKey;

  // 経過時間は保存せず「現在時刻 - 開始時刻」で毎秒計算し直す
  useEffect(() => {
    const timerId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timerId);
  }, []);

  useEffect(() => {
    const loadStaff = async () => {
      try {
        const reps = (await fetchStaffByRole('sales'))
          .filter((r) => r.name.includes(REPRESENTATIVE_FILTER));
        setSalesReps(reps);
        // 記憶した担当者がマスターに存在しなければ先頭を初期選択
        setRepresentative((prev) =>
          reps.some((r) => r.name === prev) ? prev : (reps[0]?.name || '')
        );
      } catch (error) {
        console.error('Failed to load sales reps:', error);
      }
    };
    loadStaff();
  }, []);

  const loadDayDocs = useCallback(async (date) => {
    setLoading(true);
    try {
      const docs = await fetchDailyTimersByDate(date);
      setDayDocs(docs);
      setLoadedDate(date);
    } catch (error) {
      console.error('Failed to load daily timers:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDayDocs(selectedDate);
  }, [selectedDate, loadDayDocs]);

  // 表示中の「担当者×日付」が変わったら振り返りを読み込み直す
  // （タスク操作による再読み込みではキーが同じなので入力中の下書きを保持する）
  useEffect(() => {
    if (!loadedDate || loadedDate !== selectedDate) return;
    const key = `${representative}_${loadedDate}`;
    if (reviewKeyRef.current === key) return;
    reviewKeyRef.current = key;

    const dayDoc = dayDocs.find((d) => d.representative === representative);
    const review = normalizeReview(dayDoc?.review);
    setReviewDraft(review);
    setSavedReview(review);
    // 保存済みの振り返りがある日は初期状態で展開する
    setReviewOpen(hasReviewContent(review));
  }, [dayDocs, loadedDate, selectedDate, representative]);

  const reviewDirty = !isSameReview(reviewDraft, savedReview);

  // 振り返り用の未完了・超過タスク一覧（選択中の担当者のみ、表示専用の派生データ）
  // 実行中で予定超過中のタスクは実績未確定のため超過一覧には含めず、未完了一覧に載せる
  const { unfinishedTasks, overdueTasks } = useMemo(() => {
    const dayDoc = dayDocs.find((d) => d.representative === representative);
    const tasks = getDisplayTasks(dayDoc);
    const unfinished = [];
    const over = [];
    tasks.forEach((task) => {
      const timing = getTaskTiming(task);
      if (timing.status !== 'done') {
        unfinished.push({ task, timing });
      } else if (timing.overdue) {
        over.push({ task, timing });
      }
    });
    return { unfinishedTasks: unfinished, overdueTasks: over };
  }, [dayDocs, representative]);

  // 翌日の予定タスクの初期候補：今日の未完了タスクを自動で繰越候補にする
  // （担当者×日付が変わった時だけ再セットし、以後の追加・削除はそのまま保持する）
  const nextDayPlanKeyRef = useRef(null);
  useEffect(() => {
    const key = `${representative}_${loadedDate}`;
    if (nextDayPlanKeyRef.current === key) return;
    nextDayPlanKeyRef.current = key;
    setNextDayPlan(
      unfinishedTasks
        .filter(({ task }) => !task.isReviewTask) // 「振り返り」枠は毎日自動で作られるため繰越候補には出さない
        .map(({ task }) => ({
          localId: `carry_${task.id}`,
          name: task.name,
          plannedMinutes: task.plannedMinutes,
          plannedStartTime: null,
          fromCarryover: true
        }))
    );
  }, [unfinishedTasks, loadedDate, representative]);

  // 未完了タスク（振り返り枠を除く）の予定時間合計。2時間以上ズレていたら
  // 振り返り欄に「なぜズレたのか」の入力欄を追加で出す
  const unfinishedPlannedMinutesTotal = useMemo(() => (
    unfinishedTasks
      .filter(({ task }) => !task.isReviewTask)
      .reduce((sum, { task }) => sum + (task.plannedMinutes || 0), 0)
  ), [unfinishedTasks]);
  const showScheduleGapField = unfinishedPlannedMinutesTotal >= 120;

  // 夜の振り返りが完了したかどうかは、この記録の有無だけで判定する
  // （振り返り欄に文字が入っているかどうかでは判定しない）
  const reviewCompleted = !!dayDocs.find((d) => d.representative === representative)?.reviewCompletedAt;

  const addNextDayTask = () => {
    if (!nextDayTaskName.trim()) return;
    setNextDayPlan((prev) => [...prev, {
      localId: `new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: nextDayTaskName.trim(),
      plannedMinutes: nextDayPlannedMinutes.trim() === '' ? null : Number(nextDayPlannedMinutes),
      plannedStartTime: nextDayPlannedStartTime || null,
      fromCarryover: false
    }]);
    setNextDayTaskName('');
    setNextDayPlannedMinutes('');
    setNextDayPlannedStartTime('');
  };

  const removeNextDayTask = (localId) => {
    setNextDayPlan((prev) => prev.filter((t) => t.localId !== localId));
  };

  const confirmLeaveReview = () =>
    !reviewDirty ||
    window.confirm('振り返りに未保存の変更があります。破棄して移動しますか？');

  const changeDate = (dateKey) => {
    if (!confirmLeaveReview()) return;
    setEditingTask(null);
    setInsertForm(null);
    setLinksPopover(null);
    setSelectedDate(dateKey);
  };

  const handleRepresentativeChange = (name) => {
    if (!confirmLeaveReview()) return;
    setRepresentative(name);
    localStorage.setItem(LAST_REP_STORAGE_KEY, name);
  };

  // ---- カレンダー ----

  const openCalendar = () => {
    const [y, m] = selectedDate.split('-').map(Number);
    setCalendarMonth({ year: y, month: m - 1 });
    setCalendarOpen(true);
  };

  const shiftCalendarMonth = (delta) => {
    setCalendarMonth(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  useEffect(() => {
    if (!calendarOpen) return;
    const loadDates = async () => {
      const start = formatDateKey(new Date(calendarMonth.year, calendarMonth.month, 1));
      const end = formatDateKey(new Date(calendarMonth.year, calendarMonth.month + 1, 0));
      try {
        const dates = await fetchDatesWithData(start, end);
        setDatesWithData(new Set(dates));
      } catch (error) {
        console.error('Failed to load calendar dates:', error);
      }
    };
    loadDates();
  }, [calendarOpen, calendarMonth]);

  const handleCalendarSelect = (dateKey) => {
    if (!confirmLeaveReview()) return;
    setEditingTask(null);
    setInsertForm(null);
    setLinksPopover(null);
    setSelectedDate(dateKey);
    setCalendarOpen(false);
  };

  // ---- タスク操作 ----

  const hasPlannedInput = plannedMinutes.trim() !== '';
  const plannedNum = Number(plannedMinutes);
  const plannedValid = !hasPlannedInput || (Number.isInteger(plannedNum) && plannedNum > 0);
  const canAdd = !saving && representative && taskName.trim() && plannedValid;

  const toggleMinutesChip = (min) => {
    setPlannedMinutes((prev) => (Number(prev) === min ? '' : String(min)));
  };

  const runMutation = async (mutation) => {
    setSaving(true);
    try {
      await mutation();
      await loadDayDocs(selectedDate);
    } catch (error) {
      console.error('Daily timer operation failed:', error);
      window.alert(error.message || '操作に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleAddTask = () => {
    if (!canAdd) return;
    runMutation(async () => {
      await addTask(
        representative,
        selectedDate,
        taskName.trim(),
        hasPlannedInput ? plannedNum : null,
        plannedStartTime || null
      );
      setTaskName('');
      setPlannedStartTime('');
    });
  };

  // 割り込みタスク: 現在時刻を開始時刻として追加し、即実行中にする
  // 予定開始時刻の入力は使わない（フォームの値はそのまま残す）
  const handleAddAndStart = () => {
    if (!canAdd) return;
    runMutation(async () => {
      await addTaskAndStart(
        representative,
        selectedDate,
        taskName.trim(),
        hasPlannedInput ? plannedNum : null
      );
      setTaskName('');
    });
  };

  const handleStart = (rep, taskId) =>
    runMutation(() => startTask(rep, selectedDate, taskId));

  const handleEnd = (rep, taskId) =>
    runMutation(() => endTask(rep, selectedDate, taskId));

  const handleDelete = (rep, taskId) =>
    runMutation(() => deleteTask(rep, selectedDate, taskId));

  // ---- 時刻のインライン編集 ----

  // ---- D&D並び替え ----

  const handleDragStart = (rep, taskId) => (e) => {
    e.dataTransfer.effectAllowed = 'move';
    // FirefoxはsetDataしないとドラッグが始まらない
    e.dataTransfer.setData('text/plain', taskId);
    setEditingTask(null);
    setInsertForm(null);
    setLinksPopover(null);
    setDragItem({ rep, taskId });
  };

  const handleDragEnd = () => {
    setDragItem(null);
    setDropIndicator(null);
  };

  const handleRowDragOver = (rep, taskId) => (e) => {
    // 別担当者の行の上ではpreventDefaultしない=ドロップ不可
    if (!dragItem || dragItem.rep !== rep || dragItem.taskId === taskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    setDropIndicator((prev) =>
      prev && prev.rep === rep && prev.taskId === taskId && prev.before === before
        ? prev
        : { rep, taskId, before }
    );
  };

  const handleRowDrop = (dayDoc, targetTaskId) => (e) => {
    e.preventDefault();
    const indicator = dropIndicator;
    handleDragEnd();
    if (!dragItem || dragItem.rep !== dayDoc.representative || dragItem.taskId === targetTaskId) {
      return;
    }
    // 現在の表示順を基準に、ドラッグ行を抜いてドロップ位置に差し込む
    const original = getDisplayTasks(dayDoc).map((t) => t.id);
    const ids = original.filter((id) => id !== dragItem.taskId);
    const before = indicator && indicator.taskId === targetTaskId ? indicator.before : true;
    const insertAt = ids.indexOf(targetTaskId) + (before ? 0 : 1);
    ids.splice(insertAt, 0, dragItem.taskId);
    if (ids.every((id, i) => id === original[i])) return; // 並びが変わらなければ保存しない
    runMutation(() => reorderTasks(dayDoc.representative, selectedDate, ids));
  };

  // ---- 行直下のタスク差し込み ----

  const beginInsertAfter = (rep, task) => {
    // 予定終了時刻（予定開始+予定時間）が計算できる行はそれを自動入力、なければ空で開く
    const startTime = task.plannedStartTime && task.plannedMinutes != null
      ? plannedEndTimeInput(task.plannedStartTime, task.plannedMinutes)
      : '';
    setEditingTask(null);
    setInsertForm({ rep, afterTaskId: task.id, startTime, name: '', minutes: '' });
  };

  const updateInsertForm = (field, value) => {
    setInsertForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleInsertMinutesChip = (min) => {
    setInsertForm((prev) => ({
      ...prev,
      minutes: Number(prev.minutes) === min ? '' : String(min)
    }));
  };

  const insertMinutesNum = Number(insertForm?.minutes);
  const canInsert = !saving && !!insertForm
    && insertForm.name.trim() !== ''
    && insertForm.startTime !== ''
    && insertForm.minutes.trim() !== ''
    && Number.isInteger(insertMinutesNum) && insertMinutesNum > 0;

  const handleInsertSave = () => {
    if (!canInsert) return;
    const { rep, name, startTime, afterTaskId } = insertForm;
    runMutation(async () => {
      // afterTaskId指定で配列上も押した行の直後に挿入（手動並び順の日でも位置が保たれる）
      await addTask(rep, selectedDate, name.trim(), insertMinutesNum, startTime, afterTaskId);
      setInsertForm(null);
    });
  };

  const beginEditTask = (rep, task) => {
    setInsertForm(null);
    const sessions = getTaskSessions(task);
    // 未開始は区間1つの新規入力（両方入力で完了扱い）
    const times = sessions.length === 0
      ? [{ start: '', end: '' }]
      : sessions.map((s) => {
          const endMs = toMillis(s.endedAt);
          return {
            start: toInputTime(toMillis(s.startedAt)),
            end: endMs !== null ? toInputTime(endMs) : ''
          };
        });
    setEditingTask({ rep, taskId: task.id, times, links: (task.outputUrls || []).join('\n') });
  };

  const updateEditTime = (index, field, value) => {
    setEditingTask((prev) => ({
      ...prev,
      times: prev.times.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    }));
  };

  const handleSaveEdit = () => {
    const { rep, taskId, times, links } = editingTask;
    // 時刻欄がすべて空（未開始タスクで時刻を入れなかった）ならsessionsは変更せずリンクのみ保存
    const allTimesEmpty = times.every((t) => !t.start && !t.end);
    runMutation(async () => {
      await updateTaskDetails(rep, selectedDate, taskId, {
        sessionTimes: allTimesEmpty
          ? null
          : times.map((t) => ({ start: t.start, end: t.end || null })),
        outputUrls: links.split('\n')
      });
      setEditingTask(null);
    });
  };

  const handleSaveReview = () => {
    if (!representative) {
      window.alert('担当者を選択してください');
      return;
    }
    runMutation(async () => {
      await saveReview(representative, selectedDate, reviewDraft);
      setSavedReview({ ...reviewDraft });
      const tomorrowKey = shiftDateKey(selectedDate, 1);
      await planNextDayTasks(representative, tomorrowKey, nextDayPlan.map((t) => ({
        name: t.name,
        plannedMinutes: t.plannedMinutes,
        plannedStartTime: t.plannedStartTime
      })));
    });
  };

  const handleCompleteReview = () => {
    if (!representative) {
      window.alert('担当者を選択してください');
      return;
    }
    if (!window.confirm('夜の振り返りを完了として記録します。よろしいですか？')) return;
    runMutation(async () => {
      await completeNightReview(representative, selectedDate);
    });
  };

  const handleReportUrgentComplete = (rep, taskId) => {
    if (!window.confirm('緊急クエストの完了をSlackに報告します。よろしいですか？')) return;
    runMutation(async () => {
      await reportUrgentTaskComplete(rep, selectedDate, taskId);
    });
  };

  const renderTaskRow = (rep, task) => {
    const timing = getTaskTiming(task);
    const hasPlanned = task.plannedMinutes != null;
    const plannedMs = hasPlanned ? task.plannedMinutes * 60000 : null;
    const hasPlannedStart = !!task.plannedStartTime;

    // 時刻のインライン編集モード
    if (editingTask && editingTask.rep === rep && editingTask.taskId === task.id) {
      const editHint =
        timing.status === 'notStarted'
          ? '開始・終了の両方を入力すると完了として記録されます'
          : timing.status === 'running'
            ? '実行中の区間は終了を空のままにすると実行中を継続、入力するとその時刻で完了します'
            : null;
      return (
        <TaskRow key={task.id}>
          <TaskName>{task.name}</TaskName>
          <EditSessionsBox>
            {editingTask.times.map((t, i) => (
              <EditSessionRow key={i}>
                {editingTask.times.length > 1 && (
                  <EditSessionLabel>区間{i + 1}</EditSessionLabel>
                )}
                <TimeInput
                  type="time"
                  value={t.start}
                  onChange={(e) => updateEditTime(i, 'start', e.target.value)}
                />
                <EditSep>〜</EditSep>
                <TimeInput
                  type="time"
                  value={t.end}
                  onChange={(e) => updateEditTime(i, 'end', e.target.value)}
                />
              </EditSessionRow>
            ))}
            {editHint && <EditHint>{editHint}</EditHint>}
            <EditFieldLabel>アウトプットリンク（1行に1URL）</EditFieldLabel>
            <LinksTextarea
              placeholder={'https://...\nhttps://...'}
              value={editingTask.links}
              onChange={(e) =>
                setEditingTask((prev) => ({ ...prev, links: e.target.value }))
              }
            />
            <EditActions>
              <CancelButton onClick={() => setEditingTask(null)} disabled={saving}>
                キャンセル
              </CancelButton>
              <ActionButton onClick={handleSaveEdit} disabled={saving}>
                <FiSave size={12} /> 保存
              </ActionButton>
            </EditActions>
          </EditSessionsBox>
        </TaskRow>
      );
    }

    // タイマー押し忘れの事後修正用（全状態で表示。過去日でも修正可）
    const editIcon = (
      <EditIconButton
        onClick={() => beginEditTask(rep, task)}
        disabled={saving}
        title="時刻を修正"
      >
        <FiEdit3 size={14} />
      </EditIconButton>
    );

    // この行の直下にタスクを差し込むフォームを開く（全状態で表示）
    const insertIcon = (
      <EditIconButton
        onClick={() => beginInsertAfter(rep, task)}
        disabled={saving}
        title="この直後にタスクを追加"
      >
        <FiPlus size={14} />
      </EditIconButton>
    );

    // アウトプットリンク: 1件なら直接開く、複数ならポップオーバーで選択
    const outputUrls = task.outputUrls || [];
    const isLinksPopoverOpen =
      linksPopover && linksPopover.rep === rep && linksPopover.taskId === task.id;
    const linkIcon = outputUrls.length > 0 && (
      <LinkAnchor>
        <LinkIconButton
          onClick={() => {
            if (outputUrls.length === 1) {
              window.open(outputUrls[0], '_blank', 'noopener,noreferrer');
            } else {
              setLinksPopover(isLinksPopoverOpen ? null : { rep, taskId: task.id });
            }
          }}
          title={outputUrls.length === 1 ? outputUrls[0] : `アウトプットリンク ${outputUrls.length}件`}
        >
          <FiLink size={13} />
          {outputUrls.length > 1 && outputUrls.length}
        </LinkIconButton>
        {isLinksPopoverOpen && (
          <>
            <CalendarOverlay onClick={() => setLinksPopover(null)} />
            <LinksPopover>
              {outputUrls.map((url) => (
                <LinkItem
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={url}
                >
                  {url.replace(/^https?:\/\//, '')}
                </LinkItem>
              ))}
            </LinksPopover>
          </>
        )}
      </LinkAnchor>
    );

    // 予定の表示ラベル: 時刻+時間なら「予定 9:00-9:30」、時刻のみ「予定 9:00」、時間のみ「予定 30分」
    const scheduleLabel = hasPlannedStart
      ? hasPlanned
        ? `予定 ${formatTimeHM(task.plannedStartTime)}-${plannedEndTime(task.plannedStartTime, task.plannedMinutes)}`
        : `予定 ${formatTimeHM(task.plannedStartTime)}`
      : hasPlanned
        ? `予定 ${task.plannedMinutes}分`
        : null;

    // 予定開始と実開始（初回区間の開始）のズレ表示（開始済みの行のみ）
    const startGapLabel = hasPlannedStart && timing.firstStartMs !== null
      ? `予定${formatTimeHM(task.plannedStartTime)} / 開始${formatClock(timing.firstStartMs)}`
      : null;

    // 未開始
    if (timing.status === 'notStarted') {
      return (
        <TaskRow key={task.id} $urgent={task.isUrgentTask}>
          <TaskName>{task.name}</TaskName>
          {task.isUrgentTask && <UrgentBadge>🚨緊急クエスト</UrgentBadge>}
          {task.isReviewTask && <FixedBadge>固定</FixedBadge>}
          {scheduleLabel && <PlannedBadge>{scheduleLabel}</PlannedBadge>}
          <ActionButton onClick={() => handleStart(rep, task.id)} disabled={saving}>
            <FiPlay size={12} /> 開始
          </ActionButton>
          {editIcon}
          {insertIcon}
          {linkIcon}
          {task.isUrgentTask && (
            task.urgentReportedAt
              ? <ReportedBadge>報告済み</ReportedBadge>
              : (
                <ActionButton onClick={() => handleReportUrgentComplete(rep, task.id)} disabled={saving}>
                  <FiCheck size={12} /> 完了報告
                </ActionButton>
              )
          )}
          {/* 開始済みの行・毎日自動で用意される固定枠/緊急クエストは削除ボタン自体を出さない */}
          {!task.isReviewTask && !task.isUrgentTask && (
            <DeleteButton onClick={() => handleDelete(rep, task.id)} disabled={saving}>
              <FiTrash2 size={14} />
            </DeleteButton>
          )}
        </TaskRow>
      );
    }

    // 実行中: 経過 = 閉じた区間の合算 + (現在時刻 - 実行中区間の開始)
    if (timing.status === 'running') {
      const elapsedMs = timing.closedMs + (now - timing.runningStartMs);
      const overdue = hasPlanned && elapsedMs > plannedMs;
      const overdueMinutes = overdue ? Math.ceil((elapsedMs - plannedMs) / 60000) : 0;
      return (
        <TaskRow key={task.id} $running $overdue={overdue} $urgent={task.isUrgentTask}>
          <TaskName>{task.name}</TaskName>
          {task.isUrgentTask && <UrgentBadge>🚨緊急クエスト</UrgentBadge>}
          {task.isReviewTask && <FixedBadge>固定</FixedBadge>}
          {startGapLabel && <PlannedBadge>{startGapLabel}</PlannedBadge>}
          {hasPlanned && <PlannedBadge>予定 {task.plannedMinutes}分</PlannedBadge>}
          <ElapsedText $overdue={overdue}>経過 {formatElapsed(elapsedMs)}</ElapsedText>
          {overdue && <OverdueBadge>超過{overdueMinutes}分</OverdueBadge>}
          <ActionButton $variant="stop" onClick={() => handleEnd(rep, task.id)} disabled={saving}>
            <FiSquare size={12} /> 終了
          </ActionButton>
          {editIcon}
          {insertIcon}
          {linkIcon}
          {task.isUrgentTask && (
            <ActionButton onClick={() => handleReportUrgentComplete(rep, task.id)} disabled={saving}>
              <FiCheck size={12} /> 完了報告
            </ActionButton>
          )}
        </TaskRow>
      );
    }

    // 完了: 実績 = 閉じた区間の合算
    const { actualMs, diffMinutes, overdue } = timing;

    // 再開は「今の時刻」で区間を追加するため、今日を表示中のときのみ可能
    const resumeButton = isTodaySelected && (
      <ActionButton onClick={() => handleStart(rep, task.id)} disabled={saving}>
        <FiPlay size={12} /> 再開
      </ActionButton>
    );

    // 予定なしの行は超過判定をせず実績のみ表示（妥当性は判定不能で「−」）
    if (!hasPlanned) {
      return (
        <TaskRow key={task.id} $urgent={task.isUrgentTask}>
          <TaskName>{task.name}</TaskName>
          {task.isUrgentTask && <UrgentBadge>🚨緊急クエスト</UrgentBadge>}
          {task.isReviewTask && <FixedBadge>固定</FixedBadge>}
          {startGapLabel && <PlannedBadge>{startGapLabel}</PlannedBadge>}
          <ResultText>実績{formatActual(actualMs)}</ResultText>
          {resumeButton}
          {editIcon}
          {insertIcon}
          {linkIcon}
          {task.isUrgentTask ? (
            task.urgentReportedAt
              ? <ReportedBadge>報告済み</ReportedBadge>
              : (
                <ActionButton onClick={() => handleReportUrgentComplete(rep, task.id)} disabled={saving}>
                  <FiCheck size={12} /> 完了報告
                </ActionButton>
              )
          ) : (
            <ValidityMark $type="none" title="予定時間が未設定のため判定なし">−</ValidityMark>
          )}
        </TaskRow>
      );
    }

    return (
      <TaskRow key={task.id} $overdue={overdue}>
        <TaskName>{task.name}</TaskName>
        {task.isReviewTask && <FixedBadge>固定</FixedBadge>}
        {startGapLabel && <PlannedBadge>{startGapLabel}</PlannedBadge>}
        <ResultText $overdue={overdue}>
          予定{task.plannedMinutes}分 / 実績{formatActual(actualMs)}
          {overdue
            ? ` +${diffMinutes}分超過`
            : diffMinutes < 0
              ? ` ${diffMinutes}分`
              : ''}
        </ResultText>
        {overdue && <OverdueBadge>超過{diffMinutes}分</OverdueBadge>}
        {resumeButton}
        {editIcon}
        {insertIcon}
        {linkIcon}
        {/* 妥当性: 実績が予定以内なら◯、超過なら×（判定は超過バッジと共通） */}
        {overdue ? (
          <ValidityMark $type="ng" title="実績が予定時間を超過">×</ValidityMark>
        ) : (
          <ValidityMark $type="ok" title="実績が予定時間以内">◯</ValidityMark>
        )}
      </TaskRow>
    );
  };

  const calendarCells = buildCalendarCells(calendarMonth);

  return (
    <PageContainer>
      <Title><FiClock /> 日報</Title>

      <DateNav>
        <DateArrowButton onClick={() => changeDate(shiftDateKey(selectedDate, -1))}>
          <FiChevronLeft size={18} />
        </DateArrowButton>
        <DateLabel>{formatDateDisplay(selectedDate)}</DateLabel>
        <DateArrowButton onClick={() => changeDate(shiftDateKey(selectedDate, 1))}>
          <FiChevronRight size={18} />
        </DateArrowButton>
        <DateJumpButton $active={selectedDate === todayKey} onClick={() => changeDate(todayKey)}>
          今日
        </DateJumpButton>
        <DateJumpButton $active={selectedDate === tomorrowKey} onClick={() => changeDate(tomorrowKey)}>
          明日
        </DateJumpButton>
        <CalendarAnchor>
          <DateJumpButton
            $active={calendarOpen}
            onClick={() => (calendarOpen ? setCalendarOpen(false) : openCalendar())}
          >
            <FiCalendar size={14} /> カレンダー
          </DateJumpButton>
          {calendarOpen && (
            <>
              <CalendarOverlay onClick={() => setCalendarOpen(false)} />
              <CalendarPopover>
                <CalendarHeader>
                  <CalendarNavButton onClick={() => shiftCalendarMonth(-1)}>
                    <FiChevronLeft size={14} />
                  </CalendarNavButton>
                  <CalendarMonthLabel>
                    {calendarMonth.year}年{calendarMonth.month + 1}月
                  </CalendarMonthLabel>
                  <CalendarNavButton onClick={() => shiftCalendarMonth(1)}>
                    <FiChevronRight size={14} />
                  </CalendarNavButton>
                </CalendarHeader>
                <CalendarGrid>
                  {WEEKDAYS.map((w) => (
                    <CalendarWeekday key={w}>{w}</CalendarWeekday>
                  ))}
                  {calendarCells.map((dateKey, index) =>
                    dateKey === null ? (
                      <CalendarEmptyCell key={`empty-${index}`} />
                    ) : (
                      <CalendarDay
                        key={dateKey}
                        $selected={dateKey === selectedDate}
                        $today={dateKey === todayKey}
                        onClick={() => handleCalendarSelect(dateKey)}
                      >
                        {Number(dateKey.split('-')[2])}
                        {datesWithData.has(dateKey) && <DataDot />}
                      </CalendarDay>
                    )
                  )}
                </CalendarGrid>
              </CalendarPopover>
            </>
          )}
        </CalendarAnchor>
      </DateNav>

      <Section>
        <SectionTitle><FiPlus /> タスクを追加</SectionTitle>
        <AddForm>
          <FormRow>
            <FormLabel>担当者</FormLabel>
            <Select
              value={representative}
              onChange={(e) => handleRepresentativeChange(e.target.value)}
            >
              <option value="">選択してください</option>
              {salesReps.map((r) => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </Select>
            <FormLabel>タスク名</FormLabel>
            <Input
              placeholder="タスク名を入力..."
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddTask(); }}
            />
          </FormRow>
          <FormRow>
            <FormLabel>予定開始時刻（任意）</FormLabel>
            <TimeInput
              type="time"
              value={plannedStartTime}
              onChange={(e) => setPlannedStartTime(e.target.value)}
            />
          </FormRow>
          <FormRow>
            <FormLabel>予定時間（任意）</FormLabel>
            {PRESET_MINUTES.map((min) => (
              <MinutesChip
                key={min}
                $selected={hasPlannedInput && plannedNum === min}
                onClick={() => toggleMinutesChip(min)}
              >
                {min}分
              </MinutesChip>
            ))}
            <MinutesInput
              type="number"
              min="1"
              step="1"
              placeholder="任意"
              value={plannedMinutes}
              onChange={(e) => setPlannedMinutes(e.target.value)}
            />
            <FormLabel>分</FormLabel>
            <AddButton onClick={handleAddTask} disabled={!canAdd}>
              <FiPlus size={14} /> 追加
            </AddButton>
            {isTodaySelected && (
              <StartNowButton onClick={handleAddAndStart} disabled={!canAdd}>
                <FiPlay size={14} /> 今すぐ開始
              </StartNowButton>
            )}
          </FormRow>
        </AddForm>
      </Section>

      <Section>
        <SectionTitle><FiClock /> {formatDateDisplay(selectedDate)} のタスク（全担当者）</SectionTitle>
        {loading ? (
          <EmptyText>読み込み中...</EmptyText>
        ) : dayDocs.length === 0 ? (
          <EmptyText>この日のタスクはまだ登録されていません</EmptyText>
        ) : (
          dayDocs.map((dayDoc) => (
            <RepSection key={dayDoc.id}>
              <RepHeader><FiUser size={14} /> {dayDoc.representative}</RepHeader>
              <TaskList>
                {getDisplayTasks(dayDoc).map((task) => (
                  <React.Fragment key={task.id}>
                    <RowDragWrap
                      $dragging={
                        dragItem?.rep === dayDoc.representative && dragItem?.taskId === task.id
                      }
                      $dropBefore={
                        dropIndicator?.rep === dayDoc.representative &&
                        dropIndicator?.taskId === task.id &&
                        dropIndicator.before
                      }
                      $dropAfter={
                        dropIndicator?.rep === dayDoc.representative &&
                        dropIndicator?.taskId === task.id &&
                        !dropIndicator.before
                      }
                      onDragOver={handleRowDragOver(dayDoc.representative, task.id)}
                      onDrop={handleRowDrop(dayDoc, task.id)}
                    >
                      <DragHandle
                        draggable
                        onDragStart={handleDragStart(dayDoc.representative, task.id)}
                        onDragEnd={handleDragEnd}
                        title="ドラッグで並び替え"
                      >
                        <FiMenu size={14} />
                      </DragHandle>
                      {renderTaskRow(dayDoc.representative, task)}
                    </RowDragWrap>
                    {insertForm &&
                      insertForm.rep === dayDoc.representative &&
                      insertForm.afterTaskId === task.id && (
                        <TaskRow>
                          <FormLabel>開始</FormLabel>
                          <TimeInput
                            type="time"
                            value={insertForm.startTime}
                            onChange={(e) => updateInsertForm('startTime', e.target.value)}
                          />
                          <Input
                            placeholder="タスク名を入力..."
                            value={insertForm.name}
                            onChange={(e) => updateInsertForm('name', e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleInsertSave(); }}
                            autoFocus
                          />
                          {PRESET_MINUTES.map((min) => (
                            <MinutesChip
                              key={min}
                              $selected={insertForm.minutes !== '' && Number(insertForm.minutes) === min}
                              onClick={() => toggleInsertMinutesChip(min)}
                            >
                              {min}分
                            </MinutesChip>
                          ))}
                          <MinutesInput
                            type="number"
                            min="1"
                            step="1"
                            placeholder="分"
                            value={insertForm.minutes}
                            onChange={(e) => updateInsertForm('minutes', e.target.value)}
                          />
                          <AddButton onClick={handleInsertSave} disabled={!canInsert}>
                            <FiPlus size={14} /> 追加
                          </AddButton>
                          <CancelButton onClick={() => setInsertForm(null)} disabled={saving}>
                            キャンセル
                          </CancelButton>
                        </TaskRow>
                      )}
                  </React.Fragment>
                ))}
              </TaskList>
            </RepSection>
          ))
        )}
      </Section>

      <Section>
        <ReviewHeaderButton onClick={() => setReviewOpen((open) => !open)}>
          <ReviewHeaderLeft>
            <FiEdit3 /> 振り返り{representative ? `（${representative}）` : ''}
          </ReviewHeaderLeft>
          <ReviewHeaderRight>
            {reviewCompleted && <ReviewSavedBadge>✅ 完了済み</ReviewSavedBadge>}
            {!reviewCompleted && hasReviewContent(savedReview) && <ReviewSavedBadge>記入済み</ReviewSavedBadge>}
            {reviewOpen ? <FiChevronUp size={18} /> : <FiChevronDown size={18} />}
          </ReviewHeaderRight>
        </ReviewHeaderButton>
        {reviewOpen && (
          <ReviewBody>
            <ReviewSummaryBlock>
              <ReviewSummaryTitle>未完了タスク</ReviewSummaryTitle>
              {unfinishedTasks.length === 0 ? (
                <ReviewSummaryEmpty>未完了タスクはありません</ReviewSummaryEmpty>
              ) : (
                <TaskList>
                  {unfinishedTasks.map(({ task, timing }) => (
                    <TaskRow key={task.id}>
                      <TaskName>{task.name}</TaskName>
                      {task.plannedMinutes != null && (
                        <PlannedBadge>予定 {task.plannedMinutes}分</PlannedBadge>
                      )}
                      <StateBadge $running={timing.status === 'running'}>
                        {timing.status === 'running' ? '実行中' : '未開始'}
                      </StateBadge>
                    </TaskRow>
                  ))}
                </TaskList>
              )}
            </ReviewSummaryBlock>
            <ReviewSummaryBlock>
              <ReviewSummaryTitle>超過タスク</ReviewSummaryTitle>
              {overdueTasks.length === 0 ? (
                <ReviewSummaryEmpty>超過タスクはありません</ReviewSummaryEmpty>
              ) : (
                <TaskList>
                  {overdueTasks.map(({ task, timing }) => (
                    <TaskRow key={task.id} $overdue>
                      <TaskName>{task.name}</TaskName>
                      <ResultText $overdue>
                        予定{task.plannedMinutes}分 / 実績{formatActual(timing.actualMs)}
                      </ResultText>
                      <OverdueBadge>超過{timing.diffMinutes}分</OverdueBadge>
                    </TaskRow>
                  ))}
                </TaskList>
              )}
            </ReviewSummaryBlock>
            <ReviewSummaryBlock>
              <ReviewSummaryTitle>翌日の予定（保存時にまとめて登録されます）</ReviewSummaryTitle>
              {nextDayPlan.length === 0 ? (
                <ReviewSummaryEmpty>翌日の予定タスクはありません</ReviewSummaryEmpty>
              ) : (
                <TaskList>
                  {nextDayPlan.map((t) => (
                    <TaskRow key={t.localId}>
                      <TaskName>{t.name}{t.fromCarryover ? '（未完了の繰越）' : ''}</TaskName>
                      {t.plannedMinutes != null && (
                        <PlannedBadge>予定 {t.plannedMinutes}分</PlannedBadge>
                      )}
                      <DeleteButton onClick={() => removeNextDayTask(t.localId)}>
                        <FiTrash2 size={14} />
                      </DeleteButton>
                    </TaskRow>
                  ))}
                </TaskList>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <Input
                  placeholder="タスク名を追加"
                  value={nextDayTaskName}
                  onChange={(e) => setNextDayTaskName(e.target.value)}
                />
                <MinutesInput
                  type="number"
                  min="1"
                  placeholder="分"
                  value={nextDayPlannedMinutes}
                  onChange={(e) => setNextDayPlannedMinutes(e.target.value)}
                />
                <TimeInput
                  type="time"
                  value={nextDayPlannedStartTime}
                  onChange={(e) => setNextDayPlannedStartTime(e.target.value)}
                />
                <AddButton type="button" onClick={addNextDayTask} disabled={!nextDayTaskName.trim()}>
                  <FiPlus size={14} /> 追加
                </AddButton>
              </div>
            </ReviewSummaryBlock>
            {REVIEW_FIELDS.map((field) => (
              <ReviewField key={field.key}>
                <ReviewLabel htmlFor={`review-${field.key}`}>{field.label}</ReviewLabel>
                <ReviewTextarea
                  id={`review-${field.key}`}
                  value={reviewDraft[field.key]}
                  onChange={(e) =>
                    setReviewDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                />
              </ReviewField>
            ))}
            {showScheduleGapField && CONDITIONAL_REVIEW_FIELDS.map((field) => (
              <ReviewField key={field.key}>
                <ReviewLabel htmlFor={`review-${field.key}`}>
                  {field.label}（未完了タスクの予定時間合計が{unfinishedPlannedMinutesTotal}分あります）
                </ReviewLabel>
                <ReviewTextarea
                  id={`review-${field.key}`}
                  value={reviewDraft[field.key]}
                  onChange={(e) =>
                    setReviewDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                />
              </ReviewField>
            ))}
            <ReviewFooter>
              {reviewDirty && <UnsavedText>未保存の変更があります</UnsavedText>}
              <AddButton
                onClick={handleSaveReview}
                disabled={saving || !representative || !reviewDirty}
              >
                <FiSave size={14} /> 保存
              </AddButton>
              <AddButton
                onClick={handleCompleteReview}
                disabled={saving || !representative || reviewCompleted}
              >
                <FiCheck size={14} /> {reviewCompleted ? '完了済み' : '完了'}
              </AddButton>
            </ReviewFooter>
          </ReviewBody>
        )}
      </Section>
    </PageContainer>
  );
};

export default DailyTimerPage;
