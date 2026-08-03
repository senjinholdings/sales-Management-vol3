import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  FiSave
} from 'react-icons/fi';
import { fetchStaffByRole } from '../services/staffService.js';
import {
  fetchDailyTimersByDate,
  addTask,
  startTask,
  endTask,
  deleteTask,
  saveReview,
  fetchDatesWithData
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
  border: 1px solid ${(props) => (props.$overdue ? '#e74c3c' : props.$running ? '#3498db' : '#e0e0e0')};
  background: ${(props) => (props.$overdue ? '#fdecea' : props.$running ? '#eaf4fd' : '#f8f9fa')};
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

/** タイムスタンプ(ms)を "9:13" 形式の時刻にする */
const formatClock = (ms) => {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 予定開始時刻がある行を時刻昇順で先に、ない行はその後ろに追加順で並べる */
const sortTasksForDisplay = (tasks) => {
  const withTime = tasks.filter((t) => t.plannedStartTime);
  const withoutTime = tasks.filter((t) => !t.plannedStartTime);
  withTime.sort((a, b) => a.plannedStartTime.localeCompare(b.plannedStartTime));
  return [...withTime, ...withoutTime];
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

const normalizeReview = (review = {}) => ({
  notAchieved: review.notAchieved || '',
  timeImprovement: review.timeImprovement || '',
  reflection: review.reflection || '',
  nextAction: review.nextAction || ''
});

const hasReviewContent = (review) =>
  REVIEW_FIELDS.some((f) => (review[f.key] || '').trim() !== '');

const isSameReview = (a, b) =>
  REVIEW_FIELDS.every((f) => a[f.key] === b[f.key]);

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

  // 振り返り
  const [reviewDraft, setReviewDraft] = useState(normalizeReview());
  const [savedReview, setSavedReview] = useState(normalizeReview());
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewKeyRef = useRef(null);

  // カレンダー
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [datesWithData, setDatesWithData] = useState(() => new Set());

  const todayKey = formatDateKey(new Date());
  const tomorrowKey = shiftDateKey(todayKey, 1);

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

  const confirmLeaveReview = () =>
    !reviewDirty ||
    window.confirm('振り返りに未保存の変更があります。破棄して移動しますか？');

  const changeDate = (dateKey) => {
    if (!confirmLeaveReview()) return;
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

  const handleStart = (rep, taskId) =>
    runMutation(() => startTask(rep, selectedDate, taskId));

  const handleEnd = (rep, taskId) =>
    runMutation(() => endTask(rep, selectedDate, taskId));

  const handleDelete = (rep, taskId) =>
    runMutation(() => deleteTask(rep, selectedDate, taskId));

  const handleSaveReview = () => {
    if (!representative) {
      window.alert('担当者を選択してください');
      return;
    }
    runMutation(async () => {
      await saveReview(representative, selectedDate, reviewDraft);
      setSavedReview({ ...reviewDraft });
    });
  };

  const renderTaskRow = (rep, task) => {
    const startedMs = toMillis(task.startedAt);
    const endedMs = toMillis(task.endedAt);
    const hasPlanned = task.plannedMinutes != null;
    const plannedMs = hasPlanned ? task.plannedMinutes * 60000 : null;
    const hasPlannedStart = !!task.plannedStartTime;

    // 予定の表示ラベル: 時刻+時間なら「予定 9:00-9:30」、時刻のみ「予定 9:00」、時間のみ「予定 30分」
    const scheduleLabel = hasPlannedStart
      ? hasPlanned
        ? `予定 ${formatTimeHM(task.plannedStartTime)}-${plannedEndTime(task.plannedStartTime, task.plannedMinutes)}`
        : `予定 ${formatTimeHM(task.plannedStartTime)}`
      : hasPlanned
        ? `予定 ${task.plannedMinutes}分`
        : null;

    // 予定開始と実開始のズレ表示（開始済みの行のみ）
    const startGapLabel = hasPlannedStart && startedMs !== null
      ? `予定${formatTimeHM(task.plannedStartTime)} / 開始${formatClock(startedMs)}`
      : null;

    // 未開始
    if (startedMs === null) {
      return (
        <TaskRow key={task.id}>
          <TaskName>{task.name}</TaskName>
          {scheduleLabel && <PlannedBadge>{scheduleLabel}</PlannedBadge>}
          <ActionButton onClick={() => handleStart(rep, task.id)} disabled={saving}>
            <FiPlay size={12} /> 開始
          </ActionButton>
          {/* 開始済みの行は記録の信頼性を守るため削除ボタン自体を出さない */}
          <DeleteButton onClick={() => handleDelete(rep, task.id)} disabled={saving}>
            <FiTrash2 size={14} />
          </DeleteButton>
        </TaskRow>
      );
    }

    // 実行中: 経過時間は表示のたびに「現在時刻 - 開始時刻」で計算
    if (endedMs === null) {
      const elapsedMs = now - startedMs;
      const overdue = hasPlanned && elapsedMs > plannedMs;
      const overdueMinutes = overdue ? Math.ceil((elapsedMs - plannedMs) / 60000) : 0;
      return (
        <TaskRow key={task.id} $running $overdue={overdue}>
          <TaskName>{task.name}</TaskName>
          {startGapLabel && <PlannedBadge>{startGapLabel}</PlannedBadge>}
          {hasPlanned && <PlannedBadge>予定 {task.plannedMinutes}分</PlannedBadge>}
          <ElapsedText $overdue={overdue}>経過 {formatElapsed(elapsedMs)}</ElapsedText>
          {overdue && <OverdueBadge>超過{overdueMinutes}分</OverdueBadge>}
          <ActionButton $variant="stop" onClick={() => handleEnd(rep, task.id)} disabled={saving}>
            <FiSquare size={12} /> 終了
          </ActionButton>
        </TaskRow>
      );
    }

    // 完了: 実績 = 終了時刻 - 開始時刻
    const actualMs = endedMs - startedMs;

    // 予定なしの行は超過判定をせず実績のみ表示
    if (!hasPlanned) {
      return (
        <TaskRow key={task.id}>
          <TaskName>{task.name}</TaskName>
          {startGapLabel && <PlannedBadge>{startGapLabel}</PlannedBadge>}
          <ResultText>実績{formatActual(actualMs)}</ResultText>
        </TaskRow>
      );
    }

    const actualMinutes = Math.round(actualMs / 60000);
    const diffMinutes = actualMinutes - task.plannedMinutes;
    const overdue = actualMs > plannedMs && diffMinutes > 0;
    return (
      <TaskRow key={task.id} $overdue={overdue}>
        <TaskName>{task.name}</TaskName>
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
                {sortTasksForDisplay(dayDoc.tasks || []).map((task) =>
                  renderTaskRow(dayDoc.representative, task)
                )}
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
            {hasReviewContent(savedReview) && <ReviewSavedBadge>記入済み</ReviewSavedBadge>}
            {reviewOpen ? <FiChevronUp size={18} /> : <FiChevronDown size={18} />}
          </ReviewHeaderRight>
        </ReviewHeaderButton>
        {reviewOpen && (
          <ReviewBody>
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
            <ReviewFooter>
              {reviewDirty && <UnsavedText>未保存の変更があります</UnsavedText>}
              <AddButton
                onClick={handleSaveReview}
                disabled={saving || !representative || !reviewDirty}
              >
                <FiSave size={14} /> 保存
              </AddButton>
            </ReviewFooter>
          </ReviewBody>
        )}
      </Section>
    </PageContainer>
  );
};

export default DailyTimerPage;
