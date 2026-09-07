import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import styled from 'styled-components';
import {
  FiPlus,
  FiTrash2,
  FiPlay,
  FiSquare,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiUser,
  FiCalendar,
  FiEdit3,
  FiSave,
  FiLink,
  FiCheck,
  FiCheckCircle,
  FiLock
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
  confirmDayPlan,
  planNextDayTasks,
  completeNightReview,
  reportUrgentTaskComplete,
  updateTaskFields
} from '../services/dailyTimerService.js';
import {
  computeScheduleGaps,
  minutesToTime,
  timeToMinutes,
  PLAN_WINDOW_START
} from '../utils/dailyTimerSchedule.js';
import {
  fetchAllNextActions,
  addSalesEntry,
  updateSalesEntryStatus,
  fetchPipelineReviewSnapshot,
  fetchDealsForRep,
  fetchAllClientMeetingSettings,
  fetchMaterialSlot
} from '../services/projectService.js';
import { isStageTargetProject } from '../utils/stageProgress.js';

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

// 終了時の次NA入力モーダル（NA管理のdoneドロップ時の必須入力と同じ見た目）
const EndNaModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const EndNaModalContent = styled.div`
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  padding: 1.5rem;
  width: 420px;
  max-width: 90vw;
`;

const EndNaModalTitle = styled.h3`
  font-size: 1rem;
  margin: 0 0 0.75rem;
  color: #2c3e50;
`;

const EndNaModalHint = styled.p`
  font-size: 0.8rem;
  color: #e67e22;
  margin: 0 0 1rem;
`;

const EndNaModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
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

const DateInput = styled.input`
  width: 140px;
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
  box-shadow: ${(props) => (props.$highlighted ? '0 0 0 3px #f1c40f' : 'none')};
  transition: box-shadow 0.3s;
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

// ---- 時刻未定タスクの見出し ----

const UntimedLabel = styled.div`
  font-size: 0.75rem;
  color: #95a5a6;
  font-weight: 600;
  margin: 0.25rem 0 0.35rem;
`;

// ---- 空き時間の行 ----

const GapRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  border: 1px dashed ${(props) => (props.$alert ? '#e74c3c' : '#bdc3c7')};
  background: ${(props) => (props.$alert ? '#fdecea' : '#f8f9fa')};
  flex-wrap: wrap;
`;

const GapLabel = styled.span`
  font-size: 0.85rem;
  color: ${(props) => (props.$alert ? '#c0392b' : '#7f8c8d')};
  font-weight: 500;
`;

const GapActions = styled.div`
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
`;

const GapButton = styled.button`
  padding: 0.35rem 0.7rem;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  background: white;
  color: #2c3e50;
  font-size: 0.78rem;
  cursor: pointer;
  white-space: nowrap;
  &:hover { border-color: #3498db; color: #3498db; }
`;

// ---- 予定の確認・確定 ----

const ConfirmBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
`;

const ConfirmStatus = styled.span`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: ${(props) => (props.$confirmed ? '#27ae60' : '#e67e22')};
`;

const ConfirmButton = styled(AddButton)`
  background: #27ae60;
`;

const GapWarningList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 1rem;
`;

const GapWarningItem = styled.div`
  font-size: 0.8rem;
  color: #c0392b;
  background: #fdecea;
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
`;

const ConfirmedTag = styled.span`
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #27ae60;
  background: #eafaf1;
  border: 1px solid #27ae60;
  padding: 0.1rem 0.5rem;
  border-radius: 4px;
`;

const LockedHint = styled.span`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: #e67e22;
  font-weight: 600;
  white-space: nowrap;
`;

const AddedLaterBadge = styled.span`
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
  background: #f39c12;
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
  white-space: nowrap;
`;

// 案件のネクストアクションから追加したタスクの目印（終了時に次のNA入力が必須になる）
const NaLinkBadge = styled.span`
  font-size: 0.75rem;
  font-weight: 600;
  color: #6c5ce7;
  background: #ecebfd;
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
  white-space: nowrap;
`;

// 議事録が自動記録されるミーティング（clientMeetingSettingsにmeetUrl登録済み）の目印。
// 「ダッシュボードに登録されていない社外ミーティングがないか」を見つけやすくするための表示
const MeetingLinkBadge = styled.span`
  font-size: 0.75rem;
  font-weight: 600;
  color: #16a085;
  background: #e8f8f5;
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
  white-space: nowrap;
`;

// ---- タイムライン（左＝朝の予定 / 右＝実績） ----

const TimelineGrid = styled.div`
  display: grid;
  grid-template-columns: 42px 1fr 1fr;
  grid-template-rows: auto 1fr;
  gap: 0.5rem;
`;

const TimelineColHeader = styled.div`
  font-size: 0.85rem;
  font-weight: 600;
  color: #2c3e50;
  text-align: center;
  padding-bottom: 0.35rem;
`;

const TimelineHourGutter = styled.div`
  position: relative;
`;

const TimelineHourLabel = styled.div`
  position: absolute;
  right: 4px;
  transform: translateY(-50%);
  font-size: 0.68rem;
  color: #95a5a6;
  white-space: nowrap;
`;

const TimelineColumn = styled.div`
  position: relative;
  background: #fafbfc;
  border: 1px solid #eee;
  border-radius: 4px;
`;

const TimelineHourLine = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid #eee;
`;

const TimelineBlock = styled.div`
  position: absolute;
  left: 3px;
  right: 3px;
  border-radius: 3px;
  padding: 0.1rem 0.3rem;
  font-size: 0.68rem;
  line-height: 1.25;
  color: white;
  overflow: hidden;
  cursor: pointer;
  background: ${(props) =>
    props.$variant === 'added' ? '#f39c12'
    : props.$variant === 'urgent' ? '#e67e22'
    : props.$variant === 'running' ? '#3498db'
    : '#6b8caf'};
  outline: ${(props) => (props.$variant === 'running' ? '2px solid #2980b9' : 'none')};
`;

const TimelineGapBlock = styled.div`
  position: absolute;
  left: 3px;
  right: 3px;
  border-radius: 3px;
  background: ${(props) =>
    props.$alert
      ? 'repeating-linear-gradient(45deg, #fdecea, #fdecea 6px, #fbd4d0 6px, #fbd4d0 12px)'
      : 'repeating-linear-gradient(45deg, #f1f2f3, #f1f2f3 6px, #e6e8ea 6px, #e6e8ea 12px)'};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  color: ${(props) => (props.$alert ? '#c0392b' : '#95a5a6')};
  text-align: center;
  overflow: hidden;
`;

const TimelineNowLine = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  border-top: 2px solid #e74c3c;
  z-index: 5;
`;

const TimelinePlaceholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 0.8rem;
  color: #95a5a6;
  text-align: center;
  padding: 1rem;
`;

// ---- 振り返り ----

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

// ---- 振り返りウィザード（手順表示） ----

const WizardStepBadge = styled.span`
  font-size: 0.75rem;
  font-weight: 600;
  color: #7f8c8d;
`;

const WizardIntro = styled.p`
  font-size: 0.85rem;
  color: #5a6b7a;
  margin: 0 0 0.75rem;
`;

const WizardItemCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #fafbfc;
`;

const WizardChoiceRow = styled.label`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: #2c3e50;
  cursor: pointer;
`;

const WizardInputsRow = styled.div`
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
`;

// 手順0: 確認すべき数字を、案内文よりも目立たせて表示する
const WizardStatRow = styled.div`
  display: flex;
  gap: 2rem;
  flex-wrap: wrap;
`;

const WizardStatItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
`;

const WizardStatNumber = styled.span`
  font-size: 1.75rem;
  font-weight: 700;
  color: #2c3e50;
  line-height: 1.1;
`;

const WizardStatLabel = styled.span`
  font-size: 0.75rem;
  color: #7f8c8d;
`;

// 手順3・4: 自由記述と、横に表示するパイプラインの状況（読み取り専用）
const WizardSideBySide = styled.div`
  display: flex;
  gap: 1.25rem;
  align-items: flex-start;
  flex-wrap: wrap;
`;

const WizardMainColumn = styled.div`
  flex: 1 1 320px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`;

const WizardSideColumn = styled.div`
  flex: 1 1 280px;
  min-width: 260px;
  max-height: 420px;
  overflow-y: auto;
  background: #fafbfc;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 0.75rem;
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

// 振り返りウィザードの手順番号 → その手順が始まったら自動開始する固定タスク名
const REVIEW_TASK_NAME_BY_PHASE_START = { 0: '日報に基づく振り返り', 3: '週次パイプライン振り返り', 5: '翌日の予定の記入' };
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

/**
 * ドキュメントの表示順のタスク一覧を返す（振り返りの未完了/超過一覧など、並び順だけ欲しい箇所用）
 * 全タスクに開始時刻が入る前提のため、時刻順が唯一の正しい並びになった
 * （旧D&D手動並び替え・manualSortは廃止。予定を確定する仕組みに置き換えたため）
 * 緊急クエスト（isUrgentTask）は並び順に関わらず常に先頭に出す（最優先タスクのため）
 */
const getDisplayTasks = (dayDoc) => {
  const tasks = dayDoc?.tasks || [];
  const timed = tasks.filter((t) => t.plannedStartTime)
    .sort((a, b) => a.plannedStartTime.localeCompare(b.plannedStartTime));
  const untimed = tasks.filter((t) => !t.plannedStartTime);
  const urgent = untimed.filter((t) => t.isUrgentTask);
  const other = untimed.filter((t) => !t.isUrgentTask);
  return [...urgent, ...timed, ...other];
};

/** 時刻未定のタスク（緊急クエスト・割り込みで今すぐ開始したもの）だけを、一覧の上に出す別枠用に取り出す */
const getUntimedTasks = (tasks) => {
  const untimed = (tasks || []).filter((t) => !t.plannedStartTime);
  const urgent = untimed.filter((t) => t.isUrgentTask);
  const other = untimed.filter((t) => !t.isUrgentTask);
  return [...urgent, ...other];
};

/** 時刻がある行を時刻順に並べ、空き時間の行(type:'gap')を間に挟んだ表示用の一覧を作る */
const buildTimedRowsWithGaps = (tasks) => {
  const timed = (tasks || []).filter((t) => t.plannedStartTime)
    .sort((a, b) => a.plannedStartTime.localeCompare(b.plannedStartTime));
  const { gaps } = computeScheduleGaps(tasks || []);
  const rows = [
    ...timed.map((t) => ({ type: 'task', sortMin: timeToMinutes(t.plannedStartTime), task: t })),
    ...gaps.map((g) => ({ type: 'gap', sortMin: g.start, gap: g }))
  ];
  rows.sort((a, b) => a.sortMin - b.sortMin);
  return rows;
};

// ---- タイムライン（左＝朝の予定 / 右＝実績）用の時刻換算 ----

const TIMELINE_START_MIN = timeToMinutes(PLAN_WINDOW_START); // 6:00（表示レイアウト用の下限。空き時間の判定はcomputeScheduleGapsが動的に行う）
const TIMELINE_END_MIN = 24 * 60;
const TIMELINE_PX_PER_MIN = 0.9;
const TIMELINE_HEIGHT = (TIMELINE_END_MIN - TIMELINE_START_MIN) * TIMELINE_PX_PER_MIN;

const minutesFromMidnight = (ms) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};

const clampToTimelineRange = (min) => Math.min(TIMELINE_END_MIN, Math.max(TIMELINE_START_MIN, min));

const timelineTopPx = (min) => (clampToTimelineRange(min) - TIMELINE_START_MIN) * TIMELINE_PX_PER_MIN;

const timelineHeightPx = (startMin, endMin) =>
  Math.max(2, (clampToTimelineRange(endMin) - clampToTimelineRange(startMin)) * TIMELINE_PX_PER_MIN);

/**
 * 実績ブロック（sessions由来の区間）の一覧から、指定範囲内で何も動いていなかった時間（空白）を計算する
 * 5分未満は誤差として無視する
 */
const computeFreeRanges = (blocks, rangeStart, rangeEnd, minGap = 5) => {
  const clipped = blocks
    .map((b) => ({ start: Math.max(rangeStart, b.startMin), end: Math.min(rangeEnd, b.endMin) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  clipped.forEach((b) => {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
    } else {
      merged.push({ ...b });
    }
  });
  const free = [];
  let cursor = rangeStart;
  merged.forEach((b) => {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  });
  if (cursor < rangeEnd) free.push({ start: cursor, end: rangeEnd });
  // start/endは秒単位まで含む実績時刻由来のため小数になりうる（表示用のminutesだけ丸める。
  // ピクセル位置の計算にはstart/endの精度をそのまま使うので、ここでは丸めない）
  return free.map((f) => ({ ...f, minutes: Math.round(f.end - f.start) })).filter((f) => f.minutes >= minGap);
};

const LAST_REP_STORAGE_KEY = 'dailyTimerLastRepresentative';

// デイリータイマーの担当者は荒幡のみ（担当者マスターは他画面と共用のため画面側で絞る）
const REPRESENTATIVE_FILTER = '荒幡';

// ============================================
// 振り返りヘルパー
// ============================================

// 夜の振り返りウィザードの手順0・3・4の「確認しました」フラグ・任意の自由記述
const normalizeReview = (review = {}) => ({
  reminderAcked: !!review.reminderAcked,
  pipelineStatusChecked: !!review.pipelineStatusChecked,
  pipelineWeekChecked: !!review.pipelineWeekChecked,
  pipelineStatusNote: review.pipelineStatusNote || '',
  pipelineWeekNote: review.pipelineWeekNote || ''
});

// リマインドが飛ぶ基準と同じ「大幅な超過」判定（functions/dailyReportGuard.jsのisOverrunと同じ式）
const OVERRUN_BUFFER_MINUTES = 20;
const OVERRUN_RATIO = 1.3;
const isSignificantOverrun = (task, timing) => {
  if (timing.status !== 'done' || task.plannedMinutes == null) return false;
  const actualMinutes = Math.round(timing.actualMs / 60000);
  return actualMinutes > task.plannedMinutes + OVERRUN_BUFFER_MINUTES
    && actualMinutes > task.plannedMinutes * OVERRUN_RATIO;
};

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

  // タイムラインのブロックをクリックした時、下のタスク一覧の該当行を光らせる
  const [highlightedTaskId, setHighlightedTaskId] = useState(null);
  const taskRowRefs = useRef({});

  // 空き時間の行の「ここにタスクを追加」から、上の「タスクを追加」フォームへフォーカスを移すための参照
  const taskNameInputRef = useRef(null);

  // 振り返りウィザード（null=未開始、0〜5=手順番号）
  // 0:リマインド確認 1:時間の使い方 2:未完了タスク 3:各案件ステータス 4:今週確定予定 5:翌日の予定作り
  const [reviewStep, setReviewStep] = useState(null);
  // 手順1: 大幅超過タスクごとの入力 { [taskId]: { reflection, actions: [{id,name,minutes,dueDate}], draft: {name,minutes,dueDate} } }
  // reflectionのみ必須。actionsは任意・複数可（draftは未追加の入力欄の一時保持で、保存対象ではない）
  const [overrunInputs, setOverrunInputs] = useState({});
  // 手順2: 未完了タスクごとの選択 { [taskId]: { mode: 'reschedule'|'earlyMorning', newDate } }
  const [unfinishedInputs, setUnfinishedInputs] = useState({});

  // 手順3・4: 自由記述（任意）と、画面内に読み取り専用で表示するパイプラインの状況
  const [pipelineStatusNoteInput, setPipelineStatusNoteInput] = useState('');
  const [pipelineWeekNoteInput, setPipelineWeekNoteInput] = useState('');
  const [pipelineReviewSnapshot, setPipelineReviewSnapshot] = useState({ activeDeals: [], predictedDeals: [] });
  const [pipelineReviewLoading, setPipelineReviewLoading] = useState(false);

  // 手順5: 翌日が定例/単発ミーティングの予定にあたる案件の候補（任意・追加しなくても完了できる）
  const [meetingCandidates, setMeetingCandidates] = useState([]);

  // NA（次のアクション）タスク一覧（手順1・2の記入や案件NAの追加でここに積まれ、手順5で登録する）。
  // ローカルidは編集用の一時キー。基本は翌日だが、タスクごとに対象日を変えられる
  const [nextDayPlan, setNextDayPlan] = useState([]);
  const [nextDayTaskName, setNextDayTaskName] = useState('');
  const [nextDayPlannedMinutes, setNextDayPlannedMinutes] = useState('');
  const [nextDayPlannedStartTime, setNextDayPlannedStartTime] = useState('');
  const [nextDayTaskDate, setNextDayTaskDate] = useState('');

  // 期日が3日以内の案件ネクストアクション（ウィザード開始時に取得し、手順5でワンクリックでNAタスク一覧に追加できる）。
  // 明日が期日のもの(mandatory:true)は、翌日の予定作りを完了する前に必ず追加する必要がある
  const [upcomingDueNas, setUpcomingDueNas] = useState([]);

  // 案件のネクストアクションから来たタスクを終了する時の「次のNA」入力モーダル
  // （NA管理のdoneドロップ時の必須入力と同じ考え方。確定まで何も書き込まないので、
  // キャンセルすればタイマーは動いたままになる）
  const [endNaModal, setEndNaModal] = useState(null); // { rep, task }
  const [endNaContent, setEndNaContent] = useState('');
  const [endNaDueDate, setEndNaDueDate] = useState('');
  const [endNaSaving, setEndNaSaving] = useState(false);

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

  // 超過タスクのうち、リマインドが飛ぶ基準を満たす「大幅な超過」だけを手順1の対象にする
  const { significantOverdueTasks, minorOverdueTasks } = useMemo(() => {
    const sig = [];
    const minor = [];
    overdueTasks.forEach(({ task, timing }) => {
      (isSignificantOverrun(task, timing) ? sig : minor).push({ task, timing });
    });
    return { significantOverdueTasks: sig, minorOverdueTasks: minor };
  }, [overdueTasks]);

  // 未完了タスクのうち、手順2で新しい期日・早起きを決めてもらう対象
  // （「振り返り」枠は毎日自動で作られるため対象に含めない）
  const unfinishedForRecovery = useMemo(
    () => unfinishedTasks.filter(({ task }) => !task.isReviewTask),
    [unfinishedTasks]
  );

  // ウィザードを開始した時に、3日以内が期日の案件ネクストアクションを拾ってくる
  // （手順5でワンクリックでNAタスク一覧に追加できるように）。
  // 明日が期日のものはmandatory:trueにする（翌日の予定作り完了の必須条件になる）
  // ステージ連動の特殊なNA（完了すると自動で次のステージNAが生成される）は対象から除く
  const wizardActive = reviewStep !== null;
  useEffect(() => {
    if (!wizardActive || !loadedDate) return;
    const tomorrowDate = shiftDateKey(loadedDate, 1);
    const withinDates = new Set([tomorrowDate, shiftDateKey(loadedDate, 2), shiftDateKey(loadedDate, 3)]);
    let cancelled = false;
    (async () => {
      try {
        const all = await fetchAllNextActions();
        if (cancelled) return;
        const due = all
          .filter((na) =>
            withinDates.has(na.actionDueDate) &&
            (na.actionStatus || 'active') !== 'done' &&
            (na.actionAssignee || '').includes(REPRESENTATIVE_FILTER) &&
            !(na.stageNaStage != null && isStageTargetProject(na))
          )
          .map((na) => ({ ...na, mandatory: na.actionDueDate === tomorrowDate }));
        setUpcomingDueNas(due);
      } catch (error) {
        console.error('近日期日の案件ネクストアクション取得エラー:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [wizardActive, loadedDate]);

  // 手順3・4に入ったら、パイプラインの状況（保有中案件・今週成約予定案件）を読み取り専用で取得する
  // （パイプライン振り返りページに遷移せず、この画面内で確認できるようにするため）
  useEffect(() => {
    if (!wizardActive || (reviewStep !== 3 && reviewStep !== 4) || !representative) return;
    let cancelled = false;
    (async () => {
      setPipelineReviewLoading(true);
      try {
        const snapshot = await fetchPipelineReviewSnapshot(representative);
        if (!cancelled) setPipelineReviewSnapshot(snapshot);
      } catch (error) {
        console.error('パイプライン状況の取得エラー:', error);
      } finally {
        if (!cancelled) setPipelineReviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [wizardActive, reviewStep, representative]);

  // ウィザードを開始した時に、翌日が定例/単発ミーティングの予定にあたる案件を洗い出す
  // （議事録が自動記録される＝ダッシュボードに登録済みのミーティングのみが対象。任意の候補表示）
  useEffect(() => {
    if (!wizardActive || !loadedDate) return;
    const tomorrowDate = shiftDateKey(loadedDate, 1);
    let cancelled = false;
    (async () => {
      try {
        const [deals, clientSettings] = await Promise.all([
          fetchDealsForRep(REPRESENTATIVE_FILTER),
          fetchAllClientMeetingSettings()
        ]);
        if (cancelled) return;
        const [ty, tm, td] = tomorrowDate.split('-').map(Number);
        const tomorrowWeekday = WEEKDAYS[new Date(ty, tm - 1, td).getDay()];
        const settingsByCompany = new Map(clientSettings.map((s) => [s.companyName, s]));

        const recurringCandidates = deals
          .filter((deal) => {
            const setting = settingsByCompany.get(deal.companyName);
            return setting && setting.meetUrl && setting.recurringDayOfWeek === tomorrowWeekday;
          })
          .map((deal) => ({
            dealId: deal.id,
            companyName: deal.companyName || deal.productName || '(社名未設定)',
            meetUrl: settingsByCompany.get(deal.companyName).meetUrl,
            meetingType: '定例',
            scheduledDate: tomorrowDate,
            startTime: settingsByCompany.get(deal.companyName).recurringTime || null
          }));

        const adhocCandidates = (await Promise.all(deals.map(async (deal) => {
          const slot = await fetchMaterialSlot(deal.id, tomorrowDate);
          if (!slot || slot.meetingType !== '臨時') return null;
          const setting = settingsByCompany.get(deal.companyName);
          if (!setting?.meetUrl) return null;
          return {
            dealId: deal.id,
            companyName: deal.companyName || deal.productName || '(社名未設定)',
            meetUrl: setting.meetUrl,
            meetingType: '臨時',
            scheduledDate: tomorrowDate,
            startTime: null
          };
        }))).filter(Boolean);

        if (!cancelled) setMeetingCandidates([...recurringCandidates, ...adhocCandidates]);
      } catch (error) {
        console.error('翌日のミーティング候補取得エラー:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [wizardActive, loadedDate]);

  // 明日が期日（必須）/ 2〜3日以内が期日（任意）に分けて表示する
  const tomorrowMandatoryNas = useMemo(
    () => upcomingDueNas.filter((na) => na.mandatory),
    [upcomingDueNas]
  );
  const soonOptionalNas = useMemo(
    () => upcomingDueNas.filter((na) => !na.mandatory),
    [upcomingDueNas]
  );

  // 案件のネクストアクションをNAタスク一覧に追加する（追加後は候補一覧から消す。対象日はそのNAの期日そのもの）
  const addNaToNextDayPlan = (na) => {
    setNextDayPlan((prev) => [...prev, {
      localId: `na_${na.id}`,
      name: `${na.companyName || na.productName || '(案件)'}: ${na.actionContent}`,
      plannedMinutes: null,
      plannedStartTime: null,
      fromCarryover: false,
      date: na.actionDueDate,
      naLink: {
        projectId: na.projectId,
        recordId: na.recordId,
        subCol: na.subCol,
        entryId: na.id,
        actionAssignee: na.actionAssignee || ''
      }
    }]);
    setUpcomingDueNas((prev) => prev.filter((n) => n.id !== na.id));
  };

  // 翌日のミーティング候補をNAタスク一覧に追加する（追加後は候補一覧から消す）。
  // 定例は設定済みの時刻を予定開始時刻にそのまま使う。単発は時刻未設定のため、他の予定と同様に手動で入れてもらう
  const addMeetingToNextDayPlan = (meeting) => {
    setNextDayPlan((prev) => [...prev, {
      localId: `meeting_${meeting.dealId}_${meeting.scheduledDate}`,
      name: `${meeting.companyName}: ${meeting.meetingType}MTG`,
      plannedMinutes: null,
      plannedStartTime: meeting.startTime || null,
      fromCarryover: false,
      date: meeting.scheduledDate,
      meetingLink: {
        dealId: meeting.dealId,
        companyName: meeting.companyName,
        meetUrl: meeting.meetUrl,
        meetingType: meeting.meetingType,
        scheduledDate: meeting.scheduledDate,
        startTime: meeting.startTime || null
      }
    }]);
    setMeetingCandidates((prev) => prev.filter((m) => !(m.dealId === meeting.dealId && m.meetingType === meeting.meetingType)));
  };

  // nextDayPlanの各行の予定開始時刻をその場で編集する（早起き候補の時刻指定にも使う）
  const updateNextDayPlanStartTime = (localId, time) => {
    setNextDayPlan((prev) => prev.map((t) => (t.localId === localId ? { ...t, plannedStartTime: time || null } : t)));
  };

  // 夜の振り返りが完了したかどうかは、この記録の有無だけで判定する
  // （振り返り欄に文字が入っているかどうかでは判定しない）
  const reviewCompleted = !!dayDocs.find((d) => d.representative === representative)?.reviewCompletedAt;

  // タイマー止め忘れ・つけ忘れによる「不正確な時間」の合計とリマインド回数
  // （超過分＋タイマー未開始で空いていた時間。functions/dailyReportGuard.jsが日々積み上げて記録する）
  const timeAccuracy = dayDocs.find((d) => d.representative === representative)?.timeAccuracy;

  // ---- 予定の確認・確定（表示中の担当者について。planSnapshotの有無で確定済みかを判定する） ----

  const selectedDayDoc = useMemo(
    () => dayDocs.find((d) => d.representative === representative) || null,
    [dayDocs, representative]
  );

  // 手順が該当フェーズに入ったら、対応する振り返り固定タスク（isReviewTask）のタイマーを
  // 自動で動かす。startTaskは「同時実行は1タスクのみ、別タスクの開始で実行中のタスクを
  // 自動終了する」という不変条件を持つため、次のフェーズを開始するだけで前のフェーズの
  // タイマーは自動的に止まる（endTaskを明示的に呼ぶ必要はない）。
  // 同じ手順のままselectedDayDocが更新されるたびに再実行されないよう、
  // 「そのreviewStepで既に自動開始を試みたか」をrefで記録する（手動で早めに終了させた場合に
  // 勝手に再開してしまうのを防ぐ）
  const autoStartedReviewStepRef = useRef(null);
  useEffect(() => {
    if (!wizardActive) {
      autoStartedReviewStepRef.current = null;
      return;
    }
    const taskName = REVIEW_TASK_NAME_BY_PHASE_START[reviewStep];
    if (!taskName) return;
    if (autoStartedReviewStepRef.current === reviewStep) return;
    const task = selectedDayDoc?.tasks?.find((t) => t.isReviewTask && t.name === taskName);
    if (!task) return; // 固定タスクがまだ見つからない場合は次のデータ更新時に再試行する
    autoStartedReviewStepRef.current = reviewStep;
    if (getTaskTiming(task).status === 'running') return;
    startTask(representative, selectedDate, task.id)
      .then(() => loadDayDocs(selectedDate))
      .catch((error) => console.error('振り返りタイマー自動開始エラー:', error));
  }, [reviewStep, wizardActive, selectedDayDoc, representative, selectedDate]);

  const planConfirmed = !!selectedDayDoc?.planSnapshot;
  const scheduleCheck = useMemo(
    () => computeScheduleGaps(selectedDayDoc?.tasks || []),
    [selectedDayDoc]
  );

  // 実績（sessions）を1区間=1ブロックとして展開する（タイムライン右側用）。実行中の区間は現在時刻まで伸ばす
  const actualBlocks = useMemo(() => {
    const tasks = selectedDayDoc?.tasks || [];
    const blocks = [];
    tasks.forEach((task) => {
      getTaskSessions(task).forEach((s, i) => {
        const startMs = toMillis(s.startedAt);
        if (startMs === null) return;
        const endMsRaw = toMillis(s.endedAt);
        const running = endMsRaw === null;
        const endMs = running ? now : endMsRaw;
        blocks.push({
          key: `${task.id}_${i}`,
          taskId: task.id,
          name: task.name,
          startMin: minutesFromMidnight(startMs),
          endMin: minutesFromMidnight(endMs),
          variant: task.addedAfterConfirm ? 'added' : task.isUrgentTask ? 'urgent' : running ? 'running' : 'done'
        });
      });
    });
    return blocks;
  }, [selectedDayDoc, now]);

  // 実績側の「何も動いていなかった時間」（空白）。今日はまだ来ていない未来分を含めないよう現在時刻までに絞る
  const actualRangeEnd = isTodaySelected
    ? Math.min(TIMELINE_END_MIN, minutesFromMidnight(now))
    : TIMELINE_END_MIN;
  const freeGaps = useMemo(
    () => (selectedDayDoc ? computeFreeRanges(actualBlocks, TIMELINE_START_MIN, actualRangeEnd) : []),
    [actualBlocks, actualRangeEnd, selectedDayDoc]
  );
  const freeGapMinutesTotal = freeGaps.reduce((sum, g) => sum + g.minutes, 0);

  const handleConfirmPlan = () => {
    if (!representative) return;
    if (!window.confirm('この内容で今日の予定を確定します。確定後に開始ボタンが押せるようになります。よろしいですか？')) return;
    runMutation(() => confirmDayPlan(representative, selectedDate));
  };

  // 予定時間は必須（全タスク共通のルール）
  const nextDayPlannedMinutesNum = Number(nextDayPlannedMinutes);
  const nextDayPlannedMinutesValid = nextDayPlannedMinutes.trim() !== ''
    && Number.isInteger(nextDayPlannedMinutesNum) && nextDayPlannedMinutesNum > 0;

  const addNextDayTask = () => {
    if (!nextDayTaskName.trim() || !nextDayPlannedMinutesValid) return;
    const defaultDate = loadedDate ? shiftDateKey(loadedDate, 1) : '';
    setNextDayPlan((prev) => [...prev, {
      localId: `new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: nextDayTaskName.trim(),
      plannedMinutes: nextDayPlannedMinutesNum,
      plannedStartTime: nextDayPlannedStartTime || null,
      fromCarryover: false,
      date: nextDayTaskDate || defaultDate
    }]);
    setNextDayTaskName('');
    setNextDayPlannedMinutes('');
    setNextDayPlannedStartTime('');
    setNextDayTaskDate(defaultDate); // 対象日は次の入力のためデフォルト（翌日）に戻す
  };

  const removeNextDayTask = (localId) => {
    setNextDayPlan((prev) => prev.filter((t) => t.localId !== localId));
  };

  // ウィザードの途中（手順5の完了前）に日付を切り替えようとしたら確認する
  // （各手順の記入は都度保存済みだが、翌日の予定作りが途中で失われることを防ぐ）
  const confirmLeaveReview = () =>
    !wizardActive ||
    window.confirm('振り返りの途中です。中断して移動しますか？');

  const changeDate = (dateKey) => {
    if (!confirmLeaveReview()) return;
    setEditingTask(null);
    setLinksPopover(null);
    setSelectedDate(dateKey);
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
    setLinksPopover(null);
    setSelectedDate(dateKey);
    setCalendarOpen(false);
  };

  // ---- タスク操作 ----

  const hasPlannedInput = plannedMinutes.trim() !== '';
  const plannedNum = Number(plannedMinutes);
  // 予定時間は必須（確定後に追加するタスクも含め、全タスク共通）
  const plannedValid = hasPlannedInput && Number.isInteger(plannedNum) && plannedNum > 0;
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

  // 案件のネクストアクションから来たタスク（naLink付き）は、終了前に次のNA入力を必須にする
  // （NA管理のdoneドロップ時の必須入力と同じ考え方）。それ以外のタスクは今まで通りそのまま終了する
  const handleEndClick = (rep, task) => {
    if (task.naLink) {
      setEndNaContent('');
      setEndNaDueDate('');
      setEndNaModal({ rep, task });
      return;
    }
    handleEnd(rep, task.id);
  };

  const handleConfirmEndNa = async () => {
    if (!endNaModal || !endNaContent.trim() || !endNaDueDate) return;
    setEndNaSaving(true);
    try {
      const { rep, task } = endNaModal;
      const { projectId, recordId, subCol, entryId, actionAssignee } = task.naLink;
      await updateSalesEntryStatus(projectId, recordId, entryId, 'done', subCol);
      await addSalesEntry(projectId, recordId, {
        memoContent: '',
        actionContent: endNaContent.trim(),
        actionDueDate: endNaDueDate,
        actionAssignee: actionAssignee || rep,
        actionStatus: 'active'
      }, subCol);
      await endTask(rep, selectedDate, task.id);
      setEndNaModal(null);
      await loadDayDocs(selectedDate);
    } catch (error) {
      console.error('タイマー終了時の次NA登録エラー:', error);
      window.alert('次のネクストアクションの登録に失敗しました');
    } finally {
      setEndNaSaving(false);
    }
  };

  const handleDelete = (rep, taskId) =>
    runMutation(() => deleteTask(rep, selectedDate, taskId));

  // ---- 空き時間の埋め方 ----

  // 空き時間の開始時刻を起点に、上の「タスクを追加」フォームへ入力させる
  // （分・タスク名はそのフォームでいつも通り入力してもらう）
  const beginGapInsert = (gap) => {
    setPlannedStartTime(minutesToTime(gap.start));
    taskNameInputRef.current?.focus();
    taskNameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // タイムラインのブロックをクリックすると、下のタスク一覧の該当行までスクロールして光らせる
  const handleTimelineBlockClick = (taskId) => {
    setHighlightedTaskId(taskId);
    taskRowRefs.current[taskId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      setHighlightedTaskId((prev) => (prev === taskId ? null : prev));
    }, 2000);
  };

  const beginEditTask = (rep, task) => {
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

  // ---- 振り返りウィザード ----

  const currentReview = () => normalizeReview(dayDocs.find((d) => d.representative === representative)?.review);

  const handleStartReview = () => {
    if (!representative) {
      window.alert('担当者を選択してください');
      return;
    }
    setOverrunInputs({});
    setUnfinishedInputs({});
    setNextDayPlan([]);
    setPipelineStatusNoteInput('');
    setPipelineWeekNoteInput('');
    setMeetingCandidates([]);
    setReviewStep(0);
  };

  // 手順0: リマインド確認
  const handleAckReminders = () => {
    runMutation(async () => {
      await saveReview(representative, selectedDate, { ...currentReview(), reminderAcked: true });
      setReviewStep(1);
    });
  };

  // 手順1: 時間の使い方の振り返り（大幅超過タスクごとの記入）。
  // 振り返り本文は必須、次のアクションは任意・複数追加可（未追加の入力欄の内容は保存されない）
  const defaultOverrunInput = () => ({ reflection: '', actions: [], draft: { name: '', minutes: '', dueDate: '' } });

  const updateOverrunReflection = (taskId, value) => {
    setOverrunInputs((prev) => ({
      ...prev,
      [taskId]: { ...defaultOverrunInput(), ...prev[taskId], reflection: value }
    }));
  };

  const updateOverrunDraft = (taskId, field, value) => {
    setOverrunInputs((prev) => {
      const current = { ...defaultOverrunInput(), ...prev[taskId] };
      return { ...prev, [taskId]: { ...current, draft: { ...current.draft, [field]: value } } };
    });
  };

  const addOverrunAction = (taskId) => {
    setOverrunInputs((prev) => {
      const current = { ...defaultOverrunInput(), ...prev[taskId] };
      const minutesNum = Number(current.draft.minutes);
      if (!current.draft.name.trim() || !Number.isInteger(minutesNum) || minutesNum <= 0 || !current.draft.dueDate) {
        return prev;
      }
      const action = {
        id: `${taskId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: current.draft.name.trim(),
        minutes: minutesNum,
        dueDate: current.draft.dueDate
      };
      return {
        ...prev,
        [taskId]: { ...current, actions: [...current.actions, action], draft: { name: '', minutes: '', dueDate: '' } }
      };
    });
  };

  const removeOverrunAction = (taskId, actionId) => {
    setOverrunInputs((prev) => {
      const current = prev[taskId];
      if (!current) return prev;
      return { ...prev, [taskId]: { ...current, actions: current.actions.filter((a) => a.id !== actionId) } };
    });
  };

  const overrunStepReady = significantOverdueTasks.every(
    ({ task }) => (overrunInputs[task.id]?.reflection || '').trim() !== ''
  );

  const handleAdvanceOverrunStep = () => {
    if (!overrunStepReady) return;
    runMutation(async () => {
      await Promise.all(significantOverdueTasks.map(({ task }) =>
        updateTaskFields(representative, selectedDate, task.id, {
          overrunReflection: overrunInputs[task.id].reflection.trim()
        })
      ));
      setNextDayPlan((prev) => [
        ...prev,
        ...significantOverdueTasks.flatMap(({ task }) =>
          (overrunInputs[task.id]?.actions || []).map((action) => ({
            localId: `overrun_${task.id}_${action.id}`,
            name: action.name,
            plannedMinutes: action.minutes,
            plannedStartTime: null,
            fromCarryover: false,
            date: action.dueDate
          }))
        )
      ]);
      setReviewStep(2);
    });
  };

  // 手順2: 今日終わらなかったタスクの振り返り（新しい期日 or 早起き）
  const updateUnfinishedInput = (taskId, field, value) => {
    setUnfinishedInputs((prev) => ({ ...prev, [taskId]: { ...prev[taskId], [field]: value } }));
  };

  const unfinishedStepReady = unfinishedForRecovery.every(({ task }) => {
    const input = unfinishedInputs[task.id] || {};
    if (input.mode === 'earlyMorning') return true;
    return input.mode === 'reschedule' && !!input.newDate;
  });

  const handleAdvanceUnfinishedStep = () => {
    if (!unfinishedStepReady) return;
    const tomorrowDate = shiftDateKey(selectedDate, 1);
    runMutation(async () => {
      await Promise.all(unfinishedForRecovery.map(({ task }) =>
        updateTaskFields(representative, selectedDate, task.id, { recoveryPlanned: true })
      ));
      setNextDayPlan((prev) => [
        ...prev,
        ...unfinishedForRecovery.map(({ task }) => {
          const input = unfinishedInputs[task.id];
          const isEarly = input.mode === 'earlyMorning';
          return {
            localId: `unfinished_${task.id}`,
            name: task.name,
            plannedMinutes: task.plannedMinutes,
            plannedStartTime: null,
            fromCarryover: true,
            date: isEarly ? tomorrowDate : input.newDate,
            ...(isEarly ? { earlyMorningCandidate: true } : {})
          };
        })
      ]);
      setReviewStep(3);
    });
  };

  // 手順3・4: 週次パイプライン振り返り（リンクを開いて目視確認するだけ）
  const handleConfirmPipelineStatus = () => {
    runMutation(async () => {
      await saveReview(representative, selectedDate, {
        ...currentReview(),
        pipelineStatusChecked: true,
        pipelineStatusNote: pipelineStatusNoteInput.trim()
      });
      setReviewStep(4);
    });
  };

  const handleConfirmPipelineWeek = () => {
    runMutation(async () => {
      await saveReview(representative, selectedDate, {
        ...currentReview(),
        pipelineWeekChecked: true,
        pipelineWeekNote: pipelineWeekNoteInput.trim()
      });
      await completeNightReview(representative, selectedDate);
      setReviewStep(5);
    });
  };

  // 手順5: 翌日の予定作り
  const tomorrowDateForPlan = shiftDateKey(selectedDate, 1);
  const tomorrowPlanItems = useMemo(
    () => nextDayPlan.filter((t) => (t.date || tomorrowDateForPlan) === tomorrowDateForPlan),
    [nextDayPlan, tomorrowDateForPlan]
  );
  const tomorrowPlanGapCheck = useMemo(
    () => computeScheduleGaps(tomorrowPlanItems),
    [tomorrowPlanItems]
  );
  const hasUnsetEarlyMorning = nextDayPlan.some((t) => t.earlyMorningCandidate && !t.plannedStartTime);
  const canFinalizeTomorrowPlan = tomorrowMandatoryNas.length === 0
    && !hasUnsetEarlyMorning
    && tomorrowPlanGapCheck.isFilled;

  const handleFinalizeTomorrowPlan = () => {
    if (!canFinalizeTomorrowPlan) return;
    runMutation(async () => {
      // 振り返り完了時、動いている振り返り固定タスクがあれば終了する
      const runningReviewTask = (selectedDayDoc?.tasks || [])
        .find((t) => t.isReviewTask && getTaskTiming(t).status === 'running');
      if (runningReviewTask) {
        await endTask(representative, selectedDate, runningReviewTask.id);
      }

      // NAタスクは対象日ごとにグループ化し、日付ごとのドキュメントへ分けて登録する
      // （基本は翌日だが、タスクごとに別の日を指定できるため）
      const byDate = new Map();
      nextDayPlan.forEach((t) => {
        const date = t.date || tomorrowDateForPlan;
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push({
          name: t.name,
          plannedMinutes: t.plannedMinutes,
          plannedStartTime: t.plannedStartTime,
          ...(t.naLink ? { naLink: t.naLink } : {}),
          ...(t.meetingLink ? { meetingLink: t.meetingLink } : {})
        });
      });
      if (!byDate.has(tomorrowDateForPlan)) byDate.set(tomorrowDateForPlan, []);
      for (const [date, tasksForDate] of byDate) {
        await planNextDayTasks(representative, date, tasksForDate);
      }
      setReviewStep(null);
      setNextDayPlan([]);
      setOverrunInputs({});
      setUnfinishedInputs({});
      setSelectedDate(tomorrowDateForPlan);
    });
  };

  const handleReportUrgentComplete = (rep, taskId) => {
    if (!window.confirm('緊急クエストの完了をSlackに報告します。よろしいですか？')) return;
    runMutation(async () => {
      await reportUrgentTaskComplete(rep, selectedDate, taskId);
    });
  };

  const renderTaskRow = (dayDoc, task) => {
    const rep = dayDoc.representative;
    const timing = getTaskTiming(task);
    const hasPlanned = task.plannedMinutes != null;
    const plannedMs = hasPlanned ? task.plannedMinutes * 60000 : null;
    const hasPlannedStart = !!task.plannedStartTime;
    const isHighlighted = highlightedTaskId === task.id;
    const attachRowRef = (el) => { taskRowRefs.current[task.id] = el; };
    // 確定前は緊急クエスト以外の開始を止める（当日分のみ。過去日・翌日以降はロックしない）
    const startLocked = isTodaySelected && !dayDoc.planSnapshot && !task.isUrgentTask;

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
        <TaskRow key={task.id} ref={attachRowRef} $urgent={task.isUrgentTask} $highlighted={isHighlighted}>
          <TaskName>{task.name}</TaskName>
          {task.isUrgentTask && <UrgentBadge>🚨緊急クエスト</UrgentBadge>}
          {task.isReviewTask && <FixedBadge>固定</FixedBadge>}
          {task.addedAfterConfirm && <AddedLaterBadge>後から追加</AddedLaterBadge>}
          {task.naLink && <NaLinkBadge title="案件のネクストアクションから追加したタスク">案件NA</NaLinkBadge>}
          {task.meetingLink && <MeetingLinkBadge title="議事録が自動記録されるミーティング">🎥議事録自動記録</MeetingLinkBadge>}
          {scheduleLabel && <PlannedBadge>{scheduleLabel}</PlannedBadge>}
          <ActionButton
            onClick={() => handleStart(rep, task.id)}
            disabled={saving || startLocked}
            title={startLocked ? '予定を確定してから開始してください' : undefined}
          >
            <FiPlay size={12} /> 開始
          </ActionButton>
          {startLocked && <LockedHint><FiLock size={11} /> 未確定</LockedHint>}
          {editIcon}
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
        <TaskRow key={task.id} ref={attachRowRef} $running $overdue={overdue} $urgent={task.isUrgentTask} $highlighted={isHighlighted}>
          <TaskName>{task.name}</TaskName>
          {task.isUrgentTask && <UrgentBadge>🚨緊急クエスト</UrgentBadge>}
          {task.isReviewTask && <FixedBadge>固定</FixedBadge>}
          {task.addedAfterConfirm && <AddedLaterBadge>後から追加</AddedLaterBadge>}
          {task.naLink && <NaLinkBadge title="案件のネクストアクションから追加したタスク">案件NA</NaLinkBadge>}
          {task.meetingLink && <MeetingLinkBadge title="議事録が自動記録されるミーティング">🎥議事録自動記録</MeetingLinkBadge>}
          {startGapLabel && <PlannedBadge>{startGapLabel}</PlannedBadge>}
          {hasPlanned && <PlannedBadge>予定 {task.plannedMinutes}分</PlannedBadge>}
          <ElapsedText $overdue={overdue}>経過 {formatElapsed(elapsedMs)}</ElapsedText>
          {overdue && <OverdueBadge>超過{overdueMinutes}分</OverdueBadge>}
          <ActionButton $variant="stop" onClick={() => handleEndClick(rep, task)} disabled={saving}>
            <FiSquare size={12} /> 終了
          </ActionButton>
          {editIcon}
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
      <ActionButton
        onClick={() => handleStart(rep, task.id)}
        disabled={saving || startLocked}
        title={startLocked ? '予定を確定してから再開してください' : undefined}
      >
        <FiPlay size={12} /> 再開
      </ActionButton>
    );

    // 予定なしの行は超過判定をせず実績のみ表示（妥当性は判定不能で「−」）
    if (!hasPlanned) {
      return (
        <TaskRow key={task.id} ref={attachRowRef} $urgent={task.isUrgentTask} $highlighted={isHighlighted}>
          <TaskName>{task.name}</TaskName>
          {task.isUrgentTask && <UrgentBadge>🚨緊急クエスト</UrgentBadge>}
          {task.isReviewTask && <FixedBadge>固定</FixedBadge>}
          {task.addedAfterConfirm && <AddedLaterBadge>後から追加</AddedLaterBadge>}
          {task.naLink && <NaLinkBadge title="案件のネクストアクションから追加したタスク">案件NA</NaLinkBadge>}
          {task.meetingLink && <MeetingLinkBadge title="議事録が自動記録されるミーティング">🎥議事録自動記録</MeetingLinkBadge>}
          {startGapLabel && <PlannedBadge>{startGapLabel}</PlannedBadge>}
          <ResultText>実績{formatActual(actualMs)}</ResultText>
          {resumeButton}
          {startLocked && <LockedHint><FiLock size={11} /> 未確定</LockedHint>}
          {editIcon}
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
      <TaskRow key={task.id} ref={attachRowRef} $overdue={overdue} $highlighted={isHighlighted}>
        <TaskName>{task.name}</TaskName>
        {task.isReviewTask && <FixedBadge>固定</FixedBadge>}
        {task.addedAfterConfirm && <AddedLaterBadge>後から追加</AddedLaterBadge>}
        {task.naLink && <NaLinkBadge title="案件のネクストアクションから追加したタスク">案件NA</NaLinkBadge>}
          {task.meetingLink && <MeetingLinkBadge title="議事録が自動記録されるミーティング">🎥議事録自動記録</MeetingLinkBadge>}
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
        {startLocked && <LockedHint><FiLock size={11} /> 未確定</LockedHint>}
        {editIcon}
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
            <FormLabel>タスク名</FormLabel>
            <Input
              ref={taskNameInputRef}
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
            <FormLabel>予定時間</FormLabel>
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
              placeholder="分"
              value={plannedMinutes}
              onChange={(e) => setPlannedMinutes(e.target.value)}
            />
            <FormLabel>分</FormLabel>
            <AddButton onClick={handleAddTask} disabled={!canAdd}>
              <FiPlus size={14} /> 追加
            </AddButton>
            {isTodaySelected && (
              <StartNowButton
                onClick={handleAddAndStart}
                disabled={!canAdd || !planConfirmed}
                title={!planConfirmed ? '予定を確定してから開始してください' : undefined}
              >
                <FiPlay size={14} /> 今すぐ開始
              </StartNowButton>
            )}
          </FormRow>
        </AddForm>
      </Section>

      <Section>
        <SectionTitle><FiClock /> {formatDateDisplay(selectedDate)} のタスク</SectionTitle>
        {loading ? (
          <EmptyText>読み込み中...</EmptyText>
        ) : dayDocs.length === 0 ? (
          <EmptyText>この日のタスクはまだ登録されていません</EmptyText>
        ) : (
          dayDocs.map((dayDoc) => {
            const untimed = getUntimedTasks(dayDoc.tasks || []);
            const timedRows = buildTimedRowsWithGaps(dayDoc.tasks || []);
            return (
              <RepSection key={dayDoc.id}>
                <RepHeader>
                  <FiUser size={14} /> {dayDoc.representative}
                  {dayDoc.planSnapshot && (
                    <ConfirmedTag>
                      <FiCheckCircle size={12} /> 予定確定済み（{formatClock(toMillis(dayDoc.planSnapshot.confirmedAt))}）
                    </ConfirmedTag>
                  )}
                </RepHeader>
                {untimed.length > 0 && (
                  <>
                    <UntimedLabel>時刻未定</UntimedLabel>
                    <TaskList>
                      {untimed.map((task) => renderTaskRow(dayDoc, task))}
                    </TaskList>
                  </>
                )}
                <TaskList>
                  {timedRows.map((row) => (
                    row.type === 'task' ? (
                      renderTaskRow(dayDoc, row.task)
                    ) : (
                      <GapRow key={`gap_${dayDoc.id}_${row.gap.start}`}>
                        <GapLabel>
                          空き {row.gap.minutes}分（{minutesToTime(row.gap.start)}〜{minutesToTime(row.gap.end)}）
                        </GapLabel>
                        <GapActions>
                          <GapButton onClick={() => beginGapInsert(row.gap)}>
                            ここにタスクを追加
                          </GapButton>
                        </GapActions>
                      </GapRow>
                    )
                  ))}
                </TaskList>
              </RepSection>
            );
          })
        )}
      </Section>

      <Section>
        <SectionTitle><FiEdit3 /> 振り返り{representative ? `（${representative}）` : ''}</SectionTitle>
        {!wizardActive ? (
          <ReviewBody>
            {reviewCompleted ? (
              <>
                <ReviewSavedBadge>✅ 今日の振り返りは完了しています</ReviewSavedBadge>
                <ReviewSummaryBlock>
                  <ReviewSummaryTitle>大幅超過タスクの振り返り</ReviewSummaryTitle>
                  {(selectedDayDoc?.tasks || []).filter((t) => t.overrunReflection).length === 0 ? (
                    <ReviewSummaryEmpty>記入はありませんでした</ReviewSummaryEmpty>
                  ) : (
                    <TaskList>
                      {(selectedDayDoc?.tasks || []).filter((t) => t.overrunReflection).map((t) => (
                        <TaskRow key={t.id}>
                          <TaskName>{t.name}</TaskName>
                          <ResultText>{t.overrunReflection}</ResultText>
                        </TaskRow>
                      ))}
                    </TaskList>
                  )}
                </ReviewSummaryBlock>
                <ReviewSummaryBlock>
                  <ReviewSummaryTitle>未完了タスクのリカバリー</ReviewSummaryTitle>
                  {(selectedDayDoc?.tasks || []).filter((t) => t.recoveryPlanned).length === 0 ? (
                    <ReviewSummaryEmpty>対象はありませんでした</ReviewSummaryEmpty>
                  ) : (
                    <TaskList>
                      {(selectedDayDoc?.tasks || []).filter((t) => t.recoveryPlanned).map((t) => (
                        <TaskRow key={t.id}>
                          <TaskName>{t.name}</TaskName>
                          <PlannedBadge>対応済み</PlannedBadge>
                        </TaskRow>
                      ))}
                    </TaskList>
                  )}
                </ReviewSummaryBlock>
                {(selectedDayDoc?.review?.pipelineStatusNote || selectedDayDoc?.review?.pipelineWeekNote) && (
                  <ReviewSummaryBlock>
                    <ReviewSummaryTitle>週次パイプライン振り返りの記入</ReviewSummaryTitle>
                    <TaskList>
                      {selectedDayDoc?.review?.pipelineStatusNote && (
                        <TaskRow>
                          <TaskName>各案件のステータス確認</TaskName>
                          <ResultText>{selectedDayDoc.review.pipelineStatusNote}</ResultText>
                        </TaskRow>
                      )}
                      {selectedDayDoc?.review?.pipelineWeekNote && (
                        <TaskRow>
                          <TaskName>今週確定予定の案件確認</TaskName>
                          <ResultText>{selectedDayDoc.review.pipelineWeekNote}</ResultText>
                        </TaskRow>
                      )}
                    </TaskList>
                  </ReviewSummaryBlock>
                )}
              </>
            ) : (
              <AddButton type="button" onClick={handleStartReview} disabled={!representative}>
                <FiPlay size={14} /> 振り返りを始める
              </AddButton>
            )}
          </ReviewBody>
        ) : (
          <ReviewBody>
            <WizardStepBadge>手順 {reviewStep + 1} / 6</WizardStepBadge>

            {reviewStep === 0 && (
              <>
                <WizardIntro>日報に基づく振り返り（1/2）: リマインドされた頻度を確認してください。</WizardIntro>
                <WizardStatRow>
                  <WizardStatItem>
                    <WizardStatNumber>{timeAccuracy?.reminderCount || 0}回</WizardStatNumber>
                    <WizardStatLabel>リマインド回数（合計）</WizardStatLabel>
                  </WizardStatItem>
                  <WizardStatItem>
                    <WizardStatNumber>{freeGaps.length}回</WizardStatNumber>
                    <WizardStatLabel>タイマーが止まっていた回数</WizardStatLabel>
                  </WizardStatItem>
                  <WizardStatItem>
                    <WizardStatNumber>{freeGapMinutesTotal}分</WizardStatNumber>
                    <WizardStatLabel>止まっていた時間（合計）</WizardStatLabel>
                  </WizardStatItem>
                </WizardStatRow>
                <ReviewFooter>
                  <AddButton onClick={handleAckReminders} disabled={saving}>
                    <FiCheck size={14} /> 確認しました
                  </AddButton>
                </ReviewFooter>
              </>
            )}

            {reviewStep === 1 && (
              <>
                <WizardIntro>日報に基づく振り返り（2/2）: 時間の使い方を振り返ってください。大幅に超過したタスクは振り返りの記入が必須です（次のアクションの追加は任意・複数可）。</WizardIntro>
                {significantOverdueTasks.length === 0 ? (
                  <ReviewSummaryEmpty>大幅に超過したタスクはありません</ReviewSummaryEmpty>
                ) : (
                  <ReviewSummaryBlock>
                    {significantOverdueTasks.map(({ task, timing }) => {
                      const input = overrunInputs[task.id] || defaultOverrunInput();
                      const draftMinutesNum = Number(input.draft.minutes);
                      const draftValid = input.draft.name.trim() !== ''
                        && Number.isInteger(draftMinutesNum) && draftMinutesNum > 0
                        && !!input.draft.dueDate;
                      return (
                        <WizardItemCard key={task.id}>
                          <TaskRow $overdue>
                            <TaskName>{task.name}</TaskName>
                            <ResultText $overdue>
                              予定{task.plannedMinutes}分 / 実績{formatActual(timing.actualMs)}
                            </ResultText>
                            <OverdueBadge>超過{timing.diffMinutes}分</OverdueBadge>
                          </TaskRow>
                          <ReviewField>
                            <ReviewLabel htmlFor={`overrun-reflection-${task.id}`}>振り返り</ReviewLabel>
                            <ReviewTextarea
                              id={`overrun-reflection-${task.id}`}
                              value={input.reflection}
                              onChange={(e) => updateOverrunReflection(task.id, e.target.value)}
                            />
                          </ReviewField>
                          {input.actions.length > 0 && (
                            <TaskList>
                              {input.actions.map((action) => (
                                <TaskRow key={action.id}>
                                  <TaskName>{action.name}</TaskName>
                                  <PlannedBadge>期日 {action.dueDate}</PlannedBadge>
                                  <PlannedBadge>予定 {action.minutes}分</PlannedBadge>
                                  <DeleteButton onClick={() => removeOverrunAction(task.id, action.id)}>
                                    <FiTrash2 size={14} />
                                  </DeleteButton>
                                </TaskRow>
                              ))}
                            </TaskList>
                          )}
                          <WizardInputsRow>
                            <Input
                              placeholder="次のアクション名（任意）"
                              value={input.draft.name}
                              onChange={(e) => updateOverrunDraft(task.id, 'name', e.target.value)}
                            />
                            <MinutesInput
                              type="number"
                              min="1"
                              placeholder="予定時間（分）"
                              value={input.draft.minutes}
                              onChange={(e) => updateOverrunDraft(task.id, 'minutes', e.target.value)}
                            />
                            <DateInput
                              type="date"
                              value={input.draft.dueDate}
                              onChange={(e) => updateOverrunDraft(task.id, 'dueDate', e.target.value)}
                              title="期日"
                            />
                            <AddButton type="button" onClick={() => addOverrunAction(task.id)} disabled={!draftValid}>
                              <FiPlus size={14} /> アクションを追加
                            </AddButton>
                          </WizardInputsRow>
                        </WizardItemCard>
                      );
                    })}
                  </ReviewSummaryBlock>
                )}
                {minorOverdueTasks.length > 0 && (
                  <ReviewSummaryBlock>
                    <ReviewSummaryTitle>少し超過したタスク（記入不要）</ReviewSummaryTitle>
                    <TaskList>
                      {minorOverdueTasks.map(({ task, timing }) => (
                        <TaskRow key={task.id}>
                          <TaskName>{task.name}</TaskName>
                          <ResultText>
                            予定{task.plannedMinutes}分 / 実績{formatActual(timing.actualMs)}
                          </ResultText>
                          <OverdueBadge>超過{timing.diffMinutes}分</OverdueBadge>
                        </TaskRow>
                      ))}
                    </TaskList>
                  </ReviewSummaryBlock>
                )}
                <ReviewFooter>
                  <AddButton onClick={handleAdvanceOverrunStep} disabled={saving || !overrunStepReady}>
                    <FiCheck size={14} /> 次へ
                  </AddButton>
                </ReviewFooter>
              </>
            )}

            {reviewStep === 2 && (
              <>
                <WizardIntro>今日終わらなかったタスクについて、どうリカバリーするか決めてください（新しい期日を切るか、翌朝早起きして片付けるか）。</WizardIntro>
                {unfinishedForRecovery.length === 0 ? (
                  <ReviewSummaryEmpty>今日終わらなかったタスクはありません</ReviewSummaryEmpty>
                ) : (
                  <ReviewSummaryBlock>
                    {unfinishedForRecovery.map(({ task, timing }) => {
                      const input = unfinishedInputs[task.id] || {};
                      return (
                        <WizardItemCard key={task.id}>
                          <TaskRow>
                            <TaskName>{task.name}</TaskName>
                            {task.plannedMinutes != null && (
                              <PlannedBadge>予定 {task.plannedMinutes}分</PlannedBadge>
                            )}
                            <StateBadge $running={timing.status === 'running'}>
                              {timing.status === 'running' ? '実行中' : '未開始'}
                            </StateBadge>
                          </TaskRow>
                          <WizardChoiceRow>
                            <input
                              type="radio"
                              name={`unfinished-${task.id}`}
                              checked={input.mode === 'reschedule'}
                              onChange={() => updateUnfinishedInput(task.id, 'mode', 'reschedule')}
                            />
                            新しい期日にする
                            {input.mode === 'reschedule' && (
                              <DateInput
                                type="date"
                                value={input.newDate || ''}
                                onChange={(e) => updateUnfinishedInput(task.id, 'newDate', e.target.value)}
                              />
                            )}
                          </WizardChoiceRow>
                          <WizardChoiceRow>
                            <input
                              type="radio"
                              name={`unfinished-${task.id}`}
                              checked={input.mode === 'earlyMorning'}
                              onChange={() => updateUnfinishedInput(task.id, 'mode', 'earlyMorning')}
                            />
                            明日早起きして片付ける
                          </WizardChoiceRow>
                        </WizardItemCard>
                      );
                    })}
                  </ReviewSummaryBlock>
                )}
                <ReviewFooter>
                  <AddButton onClick={handleAdvanceUnfinishedStep} disabled={saving || !unfinishedStepReady}>
                    <FiCheck size={14} /> 次へ
                  </AddButton>
                </ReviewFooter>
              </>
            )}

            {reviewStep === 3 && (
              <>
                <WizardIntro>
                  「荒幡さんの週次パイプライン振り返り」に基づく振り返り（1/2）: 各案件のフェーズ・ネクストアクションの内容が正しいか確認してください（気になる点があれば自由記述に書けます・任意）。
                </WizardIntro>
                <WizardSideBySide>
                  <WizardMainColumn>
                    <ReviewField>
                      <ReviewLabel htmlFor="pipeline-status-note">振り返りコメント（任意）</ReviewLabel>
                      <ReviewTextarea
                        id="pipeline-status-note"
                        value={pipelineStatusNoteInput}
                        onChange={(e) => setPipelineStatusNoteInput(e.target.value)}
                      />
                    </ReviewField>
                    <ReviewFooter>
                      <AddButton onClick={handleConfirmPipelineStatus} disabled={saving}>
                        <FiCheck size={14} /> 確認しました
                      </AddButton>
                    </ReviewFooter>
                  </WizardMainColumn>
                  <WizardSideColumn>
                    <ReviewSummaryTitle>保有中の案件</ReviewSummaryTitle>
                    {pipelineReviewLoading ? (
                      <ReviewSummaryEmpty>読み込み中...</ReviewSummaryEmpty>
                    ) : pipelineReviewSnapshot.activeDeals.length === 0 ? (
                      <ReviewSummaryEmpty>保有中の案件はありません</ReviewSummaryEmpty>
                    ) : (
                      <TaskList>
                        {pipelineReviewSnapshot.activeDeals.map((deal) => (
                          <TaskRow key={deal.id}>
                            <TaskName>{deal.companyName}</TaskName>
                            <PlannedBadge>{deal.status}</PlannedBadge>
                            {deal.naContent && <ResultText>{deal.naContent}</ResultText>}
                          </TaskRow>
                        ))}
                      </TaskList>
                    )}
                  </WizardSideColumn>
                </WizardSideBySide>
              </>
            )}

            {reviewStep === 4 && (
              <>
                <WizardIntro>
                  「荒幡さんの週次パイプライン振り返り」に基づく振り返り（2/2）: 今週確定予定の案件について、ヨミの確度が変わっていないか、追加で取るべきアクションがないか確認してください（任意）。
                </WizardIntro>
                <WizardSideBySide>
                  <WizardMainColumn>
                    <ReviewField>
                      <ReviewLabel htmlFor="pipeline-week-note">振り返りコメント（任意）</ReviewLabel>
                      <ReviewTextarea
                        id="pipeline-week-note"
                        value={pipelineWeekNoteInput}
                        onChange={(e) => setPipelineWeekNoteInput(e.target.value)}
                      />
                    </ReviewField>
                    <ReviewFooter>
                      <AddButton onClick={handleConfirmPipelineWeek} disabled={saving}>
                        <FiCheck size={14} /> 確認しました（振り返りを完了する）
                      </AddButton>
                    </ReviewFooter>
                  </WizardMainColumn>
                  <WizardSideColumn>
                    <ReviewSummaryTitle>今週成約予定の案件</ReviewSummaryTitle>
                    {pipelineReviewLoading ? (
                      <ReviewSummaryEmpty>読み込み中...</ReviewSummaryEmpty>
                    ) : pipelineReviewSnapshot.predictedDeals.length === 0 ? (
                      <ReviewSummaryEmpty>今週成約予定の案件はありません</ReviewSummaryEmpty>
                    ) : (
                      <TaskList>
                        {pipelineReviewSnapshot.predictedDeals.map((deal) => (
                          <TaskRow key={deal.id}>
                            <TaskName>{deal.companyName}</TaskName>
                            <PlannedBadge>確度 {deal.probability}%</PlannedBadge>
                          </TaskRow>
                        ))}
                      </TaskList>
                    )}
                  </WizardSideColumn>
                </WizardSideBySide>
              </>
            )}

            {reviewStep === 5 && (
              <>
                <WizardIntro>翌日の予定を作りましょう。空いている時間がなくなるまで埋めると完了できます。</WizardIntro>
                <ReviewSummaryBlock>
                  <ReviewSummaryTitle>期日が明日の案件ネクストアクション（必須・すべて追加しないと完了できません）</ReviewSummaryTitle>
                  {tomorrowMandatoryNas.length === 0 ? (
                    <ReviewSummaryEmpty>期日が明日の案件ネクストアクションはありません</ReviewSummaryEmpty>
                  ) : (
                    <TaskList>
                      {tomorrowMandatoryNas.map((na) => (
                        <TaskRow key={na.id} $urgent>
                          <TaskName>
                            {na.companyName || na.productName || '(案件)'}: {na.actionContent}
                          </TaskName>
                          <AddButton type="button" onClick={() => addNaToNextDayPlan(na)}>
                            <FiPlus size={14} /> 追加
                          </AddButton>
                        </TaskRow>
                      ))}
                    </TaskList>
                  )}
                </ReviewSummaryBlock>
                <ReviewSummaryBlock>
                  <ReviewSummaryTitle>期日が2〜3日以内の案件ネクストアクション（任意・先取りして追加できます）</ReviewSummaryTitle>
                  {soonOptionalNas.length === 0 ? (
                    <ReviewSummaryEmpty>期日が2〜3日以内の案件ネクストアクションはありません</ReviewSummaryEmpty>
                  ) : (
                    <TaskList>
                      {soonOptionalNas.map((na) => (
                        <TaskRow key={na.id}>
                          <TaskName>
                            {na.companyName || na.productName || '(案件)'}: {na.actionContent}
                          </TaskName>
                          <PlannedBadge>期日 {na.actionDueDate}</PlannedBadge>
                          <AddButton type="button" onClick={() => addNaToNextDayPlan(na)}>
                            <FiPlus size={14} /> 追加
                          </AddButton>
                        </TaskRow>
                      ))}
                    </TaskList>
                  )}
                </ReviewSummaryBlock>
                {meetingCandidates.length > 0 && (
                  <ReviewSummaryBlock>
                    <ReviewSummaryTitle>翌日の定例/単発ミーティング候補（任意・議事録が自動記録されます）</ReviewSummaryTitle>
                    <TaskList>
                      {meetingCandidates.map((meeting) => (
                        <TaskRow key={`${meeting.dealId}_${meeting.meetingType}`}>
                          <TaskName>
                            {meeting.companyName}: {meeting.meetingType}MTG
                            {meeting.startTime ? `（${meeting.startTime}〜）` : ''}
                          </TaskName>
                          <AddButton type="button" onClick={() => addMeetingToNextDayPlan(meeting)}>
                            <FiPlus size={14} /> 追加
                          </AddButton>
                        </TaskRow>
                      ))}
                    </TaskList>
                  </ReviewSummaryBlock>
                )}
                {nextDayPlan.some((t) => t.earlyMorningCandidate && !t.plannedStartTime) && (
                  <ReviewSummaryBlock>
                    <ReviewSummaryTitle>早起き候補（開始時刻を指定してください）</ReviewSummaryTitle>
                    <TaskList>
                      {nextDayPlan.filter((t) => t.earlyMorningCandidate && !t.plannedStartTime).map((t) => (
                        <TaskRow key={t.localId}>
                          <TaskName>{t.name}</TaskName>
                          {t.plannedMinutes != null && <PlannedBadge>予定 {t.plannedMinutes}分</PlannedBadge>}
                          <TimeInput
                            type="time"
                            value={t.plannedStartTime || ''}
                            onChange={(e) => updateNextDayPlanStartTime(t.localId, e.target.value)}
                          />
                        </TaskRow>
                      ))}
                    </TaskList>
                  </ReviewSummaryBlock>
                )}
                <ReviewSummaryBlock>
                  <ReviewSummaryTitle>NA（次のアクション・完了時にまとめて登録されます）</ReviewSummaryTitle>
                  {nextDayPlan.length === 0 ? (
                    <ReviewSummaryEmpty>NAタスクはありません</ReviewSummaryEmpty>
                  ) : (
                    <TaskList>
                      {nextDayPlan.map((t) => (
                        <TaskRow key={t.localId}>
                          <TaskName>{t.name}{t.fromCarryover ? '（未完了の繰越）' : ''}</TaskName>
                          {t.naLink && <NaLinkBadge>案件NA</NaLinkBadge>}
                          {t.meetingLink && <MeetingLinkBadge>🎥議事録自動記録</MeetingLinkBadge>}
                          <PlannedBadge>{t.date}{t.plannedStartTime ? ` ${t.plannedStartTime}` : ''}</PlannedBadge>
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
                    <DateInput
                      type="date"
                      value={nextDayTaskDate}
                      onChange={(e) => setNextDayTaskDate(e.target.value)}
                      title="対象日（基本は翌日）"
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
                    <AddButton
                      type="button"
                      onClick={addNextDayTask}
                      disabled={!nextDayTaskName.trim() || !nextDayPlannedMinutesValid}
                    >
                      <FiPlus size={14} /> 追加
                    </AddButton>
                  </div>
                </ReviewSummaryBlock>
                {tomorrowPlanItems.length > 0 && (tomorrowPlanGapCheck.gaps.length > 0 || tomorrowPlanGapCheck.overlaps.length > 0) && (
                  <GapWarningList>
                    {tomorrowPlanGapCheck.gaps.map((g) => (
                      <GapWarningItem key={`plan_gap_${g.start}`}>
                        空いています：{minutesToTime(g.start)}〜{minutesToTime(g.end)}（{g.minutes}分）
                      </GapWarningItem>
                    ))}
                    {tomorrowPlanGapCheck.overlaps.map((o, i) => (
                      <GapWarningItem key={`plan_overlap_${i}`}>
                        時刻が重なっています：「{o.a.name}」と「{o.b.name}」
                      </GapWarningItem>
                    ))}
                  </GapWarningList>
                )}
                <ReviewFooter>
                  <AddButton
                    onClick={handleFinalizeTomorrowPlan}
                    disabled={saving || !canFinalizeTomorrowPlan}
                    title={!canFinalizeTomorrowPlan ? '必須のネクストアクションの追加・早起き候補の時刻指定・予定の空き時間の解消が必要です' : undefined}
                  >
                    <FiCheck size={14} /> 完了
                  </AddButton>
                </ReviewFooter>
              </>
            )}
          </ReviewBody>
        )}
      </Section>

      <Section>
        <SectionTitle><FiCheckCircle /> 予定の確認・確定</SectionTitle>
        {!representative ? (
          <EmptyText>担当者を選択してください</EmptyText>
        ) : (
          <>
            {isTodaySelected && (
              <ConfirmBar>
                <ConfirmStatus $confirmed={planConfirmed}>
                  {planConfirmed ? (
                    <><FiCheckCircle /> 確定済み（{formatClock(toMillis(selectedDayDoc.planSnapshot.confirmedAt))}）</>
                  ) : (
                    <><FiLock /> 未確定（最初の予定〜23:00が埋まるまで開始できません）</>
                  )}
                </ConfirmStatus>
                {!planConfirmed && (
                  <ConfirmButton onClick={handleConfirmPlan} disabled={saving || !scheduleCheck.isFilled}>
                    <FiCheck size={14} /> 予定を確定する
                  </ConfirmButton>
                )}
              </ConfirmBar>
            )}
            {isTodaySelected && !planConfirmed && (scheduleCheck.gaps.length > 0 || scheduleCheck.overlaps.length > 0) && (
              <GapWarningList>
                {scheduleCheck.gaps.map((g) => (
                  <GapWarningItem key={`gap_${g.start}`}>
                    空いています：{minutesToTime(g.start)}〜{minutesToTime(g.end)}（{g.minutes}分）
                  </GapWarningItem>
                ))}
                {scheduleCheck.overlaps.map((o, i) => (
                  <GapWarningItem key={`overlap_${i}`}>
                    時刻が重なっています：「{o.a.name}」と「{o.b.name}」
                  </GapWarningItem>
                ))}
              </GapWarningList>
            )}
            <TimelineGrid>
              <div />
              <TimelineColHeader>予定</TimelineColHeader>
              <TimelineColHeader>実績</TimelineColHeader>
              <TimelineHourGutter style={{ height: TIMELINE_HEIGHT }}>
                {Array.from({ length: 19 }, (_, i) => 6 + i).map((h) => (
                  <TimelineHourLabel key={h} style={{ top: timelineTopPx(h * 60) }}>
                    {h}:00
                  </TimelineHourLabel>
                ))}
              </TimelineHourGutter>
              <TimelineColumn style={{ height: TIMELINE_HEIGHT }}>
                {Array.from({ length: 19 }, (_, i) => 6 + i).map((h) => (
                  <TimelineHourLine key={h} style={{ top: timelineTopPx(h * 60) }} />
                ))}
                {planConfirmed ? (
                  selectedDayDoc.planSnapshot.tasks.map((t) => {
                    const start = timeToMinutes(t.plannedStartTime);
                    return (
                      <TimelineBlock
                        key={t.id}
                        style={{ top: timelineTopPx(start), height: timelineHeightPx(start, start + (t.plannedMinutes || 0)) }}
                        onClick={() => handleTimelineBlockClick(t.id)}
                        title={`${t.name}（${formatTimeHM(t.plannedStartTime)}〜）`}
                      >
                        {t.name}
                      </TimelineBlock>
                    );
                  })
                ) : isTodaySelected ? (
                  <>
                    {(selectedDayDoc?.tasks || [])
                      .filter((t) => t.plannedStartTime && t.plannedMinutes != null)
                      .map((t) => {
                        const start = timeToMinutes(t.plannedStartTime);
                        return (
                          <TimelineBlock
                            key={t.id}
                            style={{ top: timelineTopPx(start), height: timelineHeightPx(start, start + t.plannedMinutes) }}
                            onClick={() => handleTimelineBlockClick(t.id)}
                            title={t.name}
                          >
                            {t.name}
                          </TimelineBlock>
                        );
                      })}
                    {scheduleCheck.gaps.map((g) => (
                      <TimelineGapBlock
                        key={`gap_${g.start}`}
                        $alert
                        style={{ top: timelineTopPx(g.start), height: timelineHeightPx(g.start, g.end) }}
                      >
                        {g.minutes >= 20 ? `空き${g.minutes}分` : ''}
                      </TimelineGapBlock>
                    ))}
                  </>
                ) : (
                  <TimelinePlaceholder>この日は予定が確定されていません</TimelinePlaceholder>
                )}
              </TimelineColumn>
              <TimelineColumn style={{ height: TIMELINE_HEIGHT }}>
                {Array.from({ length: 19 }, (_, i) => 6 + i).map((h) => (
                  <TimelineHourLine key={h} style={{ top: timelineTopPx(h * 60) }} />
                ))}
                {actualBlocks.map((b) => (
                  <TimelineBlock
                    key={b.key}
                    $variant={b.variant}
                    style={{ top: timelineTopPx(b.startMin), height: timelineHeightPx(b.startMin, b.endMin) }}
                    onClick={() => handleTimelineBlockClick(b.taskId)}
                    title={b.name}
                  >
                    {b.name}
                  </TimelineBlock>
                ))}
                {freeGaps.map((g) => (
                  <TimelineGapBlock
                    key={`free_${g.start}`}
                    style={{ top: timelineTopPx(g.start), height: timelineHeightPx(g.start, g.end) }}
                  >
                    {g.minutes >= 20 ? `${g.minutes}分` : ''}
                  </TimelineGapBlock>
                ))}
                {isTodaySelected && (
                  <TimelineNowLine style={{ top: timelineTopPx(minutesFromMidnight(now)) }} />
                )}
              </TimelineColumn>
            </TimelineGrid>
          </>
        )}
      </Section>

      {endNaModal && (
        <EndNaModalOverlay onClick={(e) => { if (e.target === e.currentTarget) setEndNaModal(null); }}>
          <EndNaModalContent>
            <EndNaModalTitle>次のネクストアクションを入力してください</EndNaModalTitle>
            <EndNaModalHint>
              「{endNaModal.task.name}」はこの案件のネクストアクションから追加したタスクです。
              次のネクストアクションを入力するまでタイマーは終了しません。キャンセルすると終了自体が取り消されます。
            </EndNaModalHint>
            <ReviewField>
              <ReviewLabel>次のNA内容 *</ReviewLabel>
              <ReviewTextarea
                value={endNaContent}
                onChange={(e) => setEndNaContent(e.target.value)}
              />
            </ReviewField>
            <ReviewField>
              <ReviewLabel>期日 *</ReviewLabel>
              <DateInput
                type="date"
                value={endNaDueDate}
                onChange={(e) => setEndNaDueDate(e.target.value)}
              />
            </ReviewField>
            <EndNaModalActions>
              <CancelButton onClick={() => setEndNaModal(null)} disabled={endNaSaving}>
                キャンセル（終了を取り消す）
              </CancelButton>
              <AddButton
                onClick={handleConfirmEndNa}
                disabled={!endNaContent.trim() || !endNaDueDate || endNaSaving}
              >
                <FiCheck size={14} /> {endNaSaving ? '保存中...' : '終了して次のNAを登録'}
              </AddButton>
            </EndNaModalActions>
          </EndNaModalContent>
        </EndNaModalOverlay>
      )}
    </PageContainer>
  );
};

export default DailyTimerPage;
