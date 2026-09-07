import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { FiChevronLeft, FiChevronRight, FiPlus, FiEdit3, FiTrash2 } from 'react-icons/fi';
import { db } from '../firebase.js';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from 'firebase/firestore';
import { MALLS, MALL_COLORS } from '../data/constants.js';

/**
 * モールカレンダー: Amazon/楽天/Qoo10のセール予定を月カレンダーで管理する画面。
 * コレクション: mallSaleEvents
 *   { mall("Amazon"|"楽天"|"Qoo10"), title(string), startDate/endDate("YYYY-MM-DD"),
 *     memo(string、任意), createdAt, updatedAt }
 * データ件数が少ない想定のため複合インデックスは使わず、全件取得してクライアント側で
 * 表示中の月に絞り込む（PostingCalendarPage.jsのyearMonthクエリとは異なり、
 * 月をまたぐセール期間もそのまま扱えるようにするため）
 */

const PageContainer = styled.div`
  width: 100%;
  padding: 0 2rem;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  flex-wrap: wrap;
  gap: 1rem;
`;

const Title = styled.h2`
  color: #2c3e50;
  margin: 0;
`;

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
`;

const MonthSelector = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
`;

const MonthButton = styled.button`
  background: #3498db;
  color: white;
  border: none;
  padding: 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  &:hover { background: #2980b9; }
`;

const TodayButton = styled.button`
  background: white;
  color: #2c3e50;
  border: 1px solid #ddd;
  padding: 0.5rem 0.9rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  &:hover { border-color: #3498db; color: #3498db; }
`;

const CurrentMonth = styled.span`
  font-size: 1.2rem;
  font-weight: 600;
  color: #2c3e50;
  min-width: 120px;
  text-align: center;
`;

const AddButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.55rem 1.1rem;
  border: none;
  border-radius: 4px;
  background: #27ae60;
  color: white;
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
  &:hover { background: #219150; }
`;

const CalendarContainer = styled.div`
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  padding: 1.5rem;
  overflow-x: auto;
`;

const CalendarHeader = styled.div`
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  margin-bottom: 1rem;
  background: #e9ecef;
  border: 1px solid #e9ecef;
`;

const DayHeader = styled.div`
  background: #f8f9fa;
  padding: 0.75rem;
  text-align: center;
  font-weight: 600;
  color: #2c3e50;
  &.sunday { color: #e74c3c; }
  &.saturday { color: #3498db; }
`;

const CalendarGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  background: #e9ecef;
  border: 1px solid #e9ecef;
`;

const DayCell = styled.div`
  background: white;
  min-height: 90px;
  padding: 0.5rem;
  position: relative;
  cursor: pointer;
  &.other-month { background: #f8f9fa; color: #95a5a6; }
  &.today { background: #fff8dc; }
  &:hover { background: #f0f7fd; }
  &.other-month:hover { background: #f8f9fa; }
`;

const DayNumber = styled.div`
  font-size: 0.9rem;
  color: #7f8c8d;
  margin-bottom: 0.25rem;
`;

const EventBar = styled.div`
  position: absolute;
  height: 20px;
  background: ${(props) => props.$color};
  color: white;
  font-size: 0.72rem;
  padding: 0 0.5rem;
  display: flex;
  align-items: center;
  border-radius: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  top: ${(props) => 25 + props.$row * 24}px;
  left: ${(props) => (props.$isStart ? '0.5rem' : '0')};
  right: ${(props) => (props.$isEnd ? '0.5rem' : '0')};
  z-index: ${(props) => props.$row + 1};
  &:hover { opacity: 0.85; z-index: 10; }
`;

const Legend = styled.div`
  margin-top: 1.5rem;
  display: flex;
  gap: 1.25rem;
  flex-wrap: wrap;
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const LegendColor = styled.div`
  width: 16px;
  height: 16px;
  background: ${(props) => props.$color};
  border-radius: 3px;
`;

const LegendText = styled.span`
  font-size: 0.85rem;
  color: #2c3e50;
`;

const ListSection = styled.div`
  margin-top: 2rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  padding: 1.5rem;
`;

const ListTitle = styled.h3`
  color: #2c3e50;
  margin: 0 0 1rem 0;
`;

const EventList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const EventRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  background: #f8f9fa;
  flex-wrap: wrap;
`;

const MallPill = styled.span`
  font-size: 0.75rem;
  font-weight: 700;
  color: white;
  background: ${(props) => props.$color};
  padding: 0.15rem 0.55rem;
  border-radius: 4px;
  white-space: nowrap;
`;

const EventTitleText = styled.span`
  font-size: 0.9rem;
  color: #2c3e50;
  font-weight: 500;
  flex: 1;
  min-width: 150px;
`;

const EventDateRange = styled.span`
  font-size: 0.85rem;
  color: #7f8c8d;
  white-space: nowrap;
`;

const EventMemo = styled.span`
  font-size: 0.8rem;
  color: #95a5a6;
  flex-basis: 100%;
`;

const IconTextButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.35rem 0.6rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  color: #7f8c8d;
  font-size: 0.78rem;
  &:hover { border-color: #3498db; color: #3498db; }
`;

const DeleteIconButton = styled(IconTextButton)`
  &:hover { border-color: #e74c3c; color: #e74c3c; }
`;

const EmptyText = styled.div`
  text-align: center;
  padding: 1.5rem;
  color: #95a5a6;
  font-size: 0.85rem;
`;

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  width: 420px;
  max-width: 90vw;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
`;

const ModalTitle = styled.h3`
  margin: 0 0 1.25rem;
  color: #2c3e50;
`;

const FormGroup = styled.div`
  margin-bottom: 1rem;
`;

const FormLabel = styled.label`
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 0.3rem;
`;

const FormInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.9rem;
  &:focus { outline: none; border-color: #3498db; }
`;

const FormSelect = styled.select`
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.9rem;
  background: white;
  cursor: pointer;
  &:focus { outline: none; border-color: #3498db; }
`;

const FormTextarea = styled.textarea`
  width: 100%;
  box-sizing: border-box;
  min-height: 60px;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.9rem;
  font-family: inherit;
  resize: vertical;
  &:focus { outline: none; border-color: #3498db; }
`;

const FormRow = styled.div`
  display: flex;
  gap: 0.75rem;
  & > * { flex: 1; }
`;

const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
`;

const PrimaryButton = styled.button`
  padding: 0.5rem 1.25rem;
  border: none;
  border-radius: 4px;
  background: #3498db;
  color: white;
  cursor: pointer;
  font-size: 0.85rem;
  &:hover { background: #2980b9; }
`;

const SecondaryButton = styled.button`
  padding: 0.5rem 1.25rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  color: #7f8c8d;
  cursor: pointer;
  font-size: 0.85rem;
  &:hover { border-color: #95a5a6; color: #2c3e50; }
`;

const DangerButton = styled.button`
  margin-right: auto;
  padding: 0.5rem 1rem;
  border: 1px solid #e74c3c;
  border-radius: 4px;
  background: white;
  color: #e74c3c;
  cursor: pointer;
  font-size: 0.8rem;
  &:hover { background: #e74c3c; color: white; }
`;

/** "YYYY-MM-DD" をローカルタイムのDate（0時）にする */
const parseDateStr = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const formatDateStr = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** "YYYY-MM-DD" → "M/D"（年は表示しない） */
const formatMonthDay = (dateStr) => {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
};

const emptyForm = { mall: MALLS[0], title: '', startDate: '', endDate: '', memo: '' };

const MallCalendarPage = () => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = await getDocs(collection(db, 'mallSaleEvents'));
      const list = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      setEvents(list);
    } catch (error) {
      console.error('モールセール予定の取得エラー:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const changeMonth = (direction) => {
    setCurrentMonth((prev) => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + direction);
      return next;
    });
  };

  const generateCalendarDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    const days = [];
    const current = new Date(startDate);
    while (current <= lastDay || current.getDay() !== 0) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return days;
  };

  // 期間の行割り当て（重なるセールが同じ週にある場合、縦に積んで衝突を避ける）
  const assignRows = (periods) => {
    const sorted = [...periods].sort((a, b) => a.startMs - b.startMs);
    const rows = [];
    sorted.forEach((period) => {
      let row = 0;
      while (true) {
        const canPlace = !rows[row] || rows[row].every((p) => p.endMs < period.startMs);
        if (canPlace) {
          if (!rows[row]) rows[row] = [];
          rows[row].push(period);
          period.row = row;
          break;
        }
        row++;
      }
    });
    return sorted;
  };

  const calendarDays = generateCalendarDays();
  const monthLabel = `${currentMonth.getFullYear()}年${currentMonth.getMonth() + 1}月`;
  const today = new Date();

  const viewStartMs = calendarDays[0].getTime();
  const viewEndMs = calendarDays[calendarDays.length - 1].getTime();
  const periodsInView = events
    .map((e) => ({ ...e, startMs: parseDateStr(e.startDate).getTime(), endMs: parseDateStr(e.endDate).getTime() }))
    .filter((e) => e.endMs >= viewStartMs && e.startMs <= viewEndMs);
  const periodsWithRows = assignRows(periodsInView);

  const openAddModal = (prefillDateStr) => {
    setEditingId(null);
    setFormData({ ...emptyForm, startDate: prefillDateStr || '', endDate: prefillDateStr || '' });
    setShowModal(true);
  };

  const openEditModal = (event) => {
    setEditingId(event.id);
    setFormData({
      mall: event.mall,
      title: event.title,
      startDate: event.startDate,
      endDate: event.endDate,
      memo: event.memo || ''
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setFormData(emptyForm);
  };

  const handleFieldChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.startDate || !formData.endDate) {
      window.alert('モール・セール名・開始日・終了日は必須です');
      return;
    }
    if (formData.endDate < formData.startDate) {
      window.alert('終了日は開始日より後にしてください');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        mall: formData.mall,
        title: formData.title.trim(),
        startDate: formData.startDate,
        endDate: formData.endDate,
        memo: formData.memo.trim(),
        updatedAt: serverTimestamp()
      };
      if (editingId) {
        await updateDoc(doc(db, 'mallSaleEvents', editingId), payload);
      } else {
        await addDoc(collection(db, 'mallSaleEvents'), { ...payload, createdAt: serverTimestamp() });
      }
      closeModal();
      await fetchEvents();
    } catch (error) {
      console.error('モールセール予定の保存エラー:', error);
      window.alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('このセール予定を削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'mallSaleEvents', id));
      await fetchEvents();
    } catch (error) {
      console.error('モールセール予定の削除エラー:', error);
      window.alert('削除に失敗しました');
    }
  };

  return (
    <PageContainer>
      <Header>
        <Title>モールカレンダー（Amazon・楽天・Qoo10 セール予定）</Title>
        <Controls>
          <MonthSelector>
            <MonthButton onClick={() => changeMonth(-1)}>
              <FiChevronLeft />
            </MonthButton>
            <CurrentMonth>{monthLabel}</CurrentMonth>
            <MonthButton onClick={() => changeMonth(1)}>
              <FiChevronRight />
            </MonthButton>
          </MonthSelector>
          <TodayButton onClick={() => setCurrentMonth(new Date())}>今月</TodayButton>
          <AddButton onClick={() => openAddModal()}>
            <FiPlus size={14} /> セールを追加
          </AddButton>
        </Controls>
      </Header>

      {loading ? (
        <div>読み込み中...</div>
      ) : (
        <>
          <CalendarContainer>
            <CalendarHeader>
              <DayHeader className="sunday">日</DayHeader>
              <DayHeader>月</DayHeader>
              <DayHeader>火</DayHeader>
              <DayHeader>水</DayHeader>
              <DayHeader>木</DayHeader>
              <DayHeader>金</DayHeader>
              <DayHeader className="saturday">土</DayHeader>
            </CalendarHeader>
            <CalendarGrid>
              {calendarDays.map((day, index) => {
                const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
                const isToday = day.toDateString() === today.toDateString();
                const dayMs = day.getTime();
                const dayPeriods = periodsWithRows.filter((p) => dayMs >= p.startMs && dayMs <= p.endMs);

                return (
                  <DayCell
                    key={index}
                    className={`${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}`}
                    onClick={() => openAddModal(formatDateStr(day))}
                  >
                    <DayNumber>{day.getDate()}</DayNumber>
                    {dayPeriods.map((p) => (
                      <EventBar
                        key={p.id}
                        $color={MALL_COLORS[p.mall]}
                        $row={p.row}
                        $isStart={dayMs === p.startMs}
                        $isEnd={dayMs === p.endMs}
                        title={`${p.mall} / ${p.title}`}
                        onClick={(e) => { e.stopPropagation(); openEditModal(p); }}
                      >
                        {dayMs === p.startMs && `${p.mall} ${p.title}`}
                      </EventBar>
                    ))}
                  </DayCell>
                );
              })}
            </CalendarGrid>
            <Legend>
              {MALLS.map((mall) => (
                <LegendItem key={mall}>
                  <LegendColor $color={MALL_COLORS[mall]} />
                  <LegendText>{mall}</LegendText>
                </LegendItem>
              ))}
            </Legend>
          </CalendarContainer>

          <ListSection>
            <ListTitle>登録済みのセール予定一覧</ListTitle>
            {events.length === 0 ? (
              <EmptyText>まだセール予定が登録されていません</EmptyText>
            ) : (
              <EventList>
                {events.map((event) => (
                  <EventRow key={event.id}>
                    <MallPill $color={MALL_COLORS[event.mall]}>{event.mall}</MallPill>
                    <EventTitleText>{event.title}</EventTitleText>
                    <EventDateRange>
                      {formatMonthDay(event.startDate)}〜{formatMonthDay(event.endDate)}
                    </EventDateRange>
                    <IconTextButton onClick={() => openEditModal(event)}>
                      <FiEdit3 size={13} /> 編集
                    </IconTextButton>
                    <DeleteIconButton onClick={() => handleDelete(event.id)}>
                      <FiTrash2 size={13} /> 削除
                    </DeleteIconButton>
                    {event.memo && <EventMemo>{event.memo}</EventMemo>}
                  </EventRow>
                ))}
              </EventList>
            )}
          </ListSection>
        </>
      )}

      {showModal && (
        <ModalOverlay onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <ModalContent>
            <ModalTitle>{editingId ? 'セール予定を編集' : 'セール予定を追加'}</ModalTitle>
            <form onSubmit={handleSubmit}>
              <FormGroup>
                <FormLabel>モール</FormLabel>
                <FormSelect
                  value={formData.mall}
                  onChange={(e) => handleFieldChange('mall', e.target.value)}
                >
                  {MALLS.map((mall) => (
                    <option key={mall} value={mall}>{mall}</option>
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup>
                <FormLabel>セール名</FormLabel>
                <FormInput
                  value={formData.title}
                  onChange={(e) => handleFieldChange('title', e.target.value)}
                  placeholder="例：プライムデー"
                  autoFocus
                />
              </FormGroup>
              <FormGroup>
                <FormRow>
                  <div>
                    <FormLabel>開始日</FormLabel>
                    <FormInput
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => handleFieldChange('startDate', e.target.value)}
                    />
                  </div>
                  <div>
                    <FormLabel>終了日</FormLabel>
                    <FormInput
                      type="date"
                      value={formData.endDate}
                      onChange={(e) => handleFieldChange('endDate', e.target.value)}
                    />
                  </div>
                </FormRow>
              </FormGroup>
              <FormGroup>
                <FormLabel>メモ（任意）</FormLabel>
                <FormTextarea
                  value={formData.memo}
                  onChange={(e) => handleFieldChange('memo', e.target.value)}
                />
              </FormGroup>
              <ModalActions>
                {editingId && (
                  <DangerButton type="button" onClick={() => { handleDelete(editingId); closeModal(); }}>
                    <FiTrash2 size={13} /> 削除
                  </DangerButton>
                )}
                <SecondaryButton type="button" onClick={closeModal}>キャンセル</SecondaryButton>
                <PrimaryButton type="submit" disabled={saving}>
                  {editingId ? '保存' : '追加'}
                </PrimaryButton>
              </ModalActions>
            </form>
          </ModalContent>
        </ModalOverlay>
      )}
    </PageContainer>
  );
};

export default MallCalendarPage;
