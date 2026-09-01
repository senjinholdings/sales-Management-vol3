import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { FiCalendar, FiSave, FiX, FiUser } from 'react-icons/fi';
import { fetchAllStaff } from '../services/staffService.js';

// 案件詳細「MTGを登録」モーダル。ScheduleConfirmModal.js と同じ
// ModalOverlay/ModalContent/ModalHeader/Form パターンを踏襲（色は青系#3498db）。
// サーバー側（functions/calendar.js）が担当者になりすましてGoogleカレンダーに
// 予定を作成し、Meet URLをclientMeetingSettings（会社単位）に自動登録する。

const MEETING_SCHEDULE_URL = 'https://sales-management-staging.web.app/api/meetings/schedule';
const MEETING_SCHEDULE_SECRET = process.env.REACT_APP_MEETING_SCHEDULE_SECRET || '';

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 2rem 0;
  overflow-y: auto;
`;

const ModalContent = styled.div`
  background: white;
  padding: 2rem;
  border-radius: 12px;
  max-width: 520px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 10px 25px rgba(0,0,0,0.2);
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #f8f9fa;
`;

const ModalTitle = styled.h3`
  margin: 0;
  color: #3498db;
  font-size: 1.25rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #95a5a6;
  padding: 0;
  display: flex;
  align-items: center;

  &:hover { color: #7f8c8d; }
`;

const Form = styled.form`
  display: grid;
  gap: 1.25rem;
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
  gap: 0.4rem;
  font-size: 0.9rem;
`;

const Input = styled.input`
  padding: 0.7rem;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 0.95rem;

  &:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
  }

  &.error { border-color: #e74c3c; }
`;

const Select = styled.select`
  padding: 0.7rem;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 0.95rem;
  background: white;

  &:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
  }

  &.error { border-color: #e74c3c; }
`;

const TextArea = styled.textarea`
  padding: 0.7rem;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 0.95rem;
  min-height: 60px;
  resize: vertical;
  font-family: inherit;

  &:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
  }
`;

const RadioGroup = styled.div`
  display: flex;
  gap: 1.5rem;
`;

const RadioLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  font-weight: 500;
  color: #2c3e50;
  cursor: pointer;
`;

const HintBox = styled.div`
  background: #eaf3fb;
  border-radius: 8px;
  padding: 0.7rem;
  font-size: 0.85rem;
  color: #21618c;
`;

const ErrorMessage = styled.div`
  color: #e74c3c;
  font-size: 0.85rem;
  margin-top: 0.25rem;
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 0.5rem;
`;

const Button = styled.button`
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;

  &.primary {
    background: #3498db;
    color: white;
    &:hover { background: #2980b9; }
    &:disabled { background: #95a5a6; cursor: not-allowed; }
  }

  &.secondary {
    background: #95a5a6;
    color: white;
    &:hover { background: #7f8c8d; }
  }
`;

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

/** "YYYY-MM-DDTHH:mm" から曜日・時刻の表示用文字列を作る（タイムゾーン変換を経由しない） */
const describeWeeklySchedule = (startDateTime) => {
  const match = String(startDateTime).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, hh, mm] = match;
  const dayOfWeek = DAY_NAMES[new Date(Number(y), Number(mo) - 1, Number(d)).getDay()];
  return `毎週${dayOfWeek}曜日 ${hh}:${mm}`;
};

const getInitialFormData = (project) => ({
  organizerName: project?.representative || '',
  title: project?.companyName ? `${project.companyName}様-Senjin MTG` : '',
  startDateTime: '',
  durationMinutes: '30',
  recurring: 'true',
  attendeeEmailsText: ''
});

function MeetingScheduleModal({ isOpen, onClose, project, onScheduled }) {
  const [formData, setFormData] = useState(getInitialFormData(project));
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [staffList, setStaffList] = useState([]);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setFormData(getInitialFormData(project));
    setErrors({});
    setResult(null);
    fetchAllStaff().then(setStaffList).catch((error) => {
      console.error('担当者一覧の取得に失敗しました:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, project?.id]);

  if (!isOpen || !project) return null;

  const clearError = (field) => {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: null }));
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    clearError(name);
  };

  const organizer = staffList.find((s) => s.name === formData.organizerName);

  const validateForm = () => {
    const newErrors = {};
    if (!formData.organizerName) newErrors.organizerName = '担当者を選択してください';
    else if (!organizer?.email) newErrors.organizerName = 'この担当者にはメールアドレスが未設定です（担当者管理で設定してください）';
    if (!formData.startDateTime) newErrors.startDateTime = '開始日時は必須です';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCancel = () => {
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const attendeeEmails = formData.attendeeEmailsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const response = await fetch(MEETING_SCHEDULE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(MEETING_SCHEDULE_SECRET ? { 'x-meeting-secret': MEETING_SCHEDULE_SECRET } : {})
        },
        body: JSON.stringify({
          organizerEmail: organizer.email,
          companyName: project.companyName,
          title: formData.title,
          startDateTime: formData.startDateTime,
          durationMinutes: Number(formData.durationMinutes),
          recurring: formData.recurring === 'true',
          attendeeEmails
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      setResult(data);
      if (onScheduled) onScheduled(data);
    } catch (error) {
      console.error('MTG登録エラー:', error);
      alert(`カレンダーへの登録に失敗しました: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalOverlay onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>
            <FiCalendar />
            MTGを登録
          </ModalTitle>
          <CloseButton onClick={handleCancel}><FiX /></CloseButton>
        </ModalHeader>

        {result ? (
          <>
            <HintBox>
              Googleカレンダーに登録しました。参加者にはメールで招待が届きます。
              {result.meetUrl && <><br />Meet URL: https://meet.google.com/{result.meetUrl}</>}
            </HintBox>
            <ButtonGroup>
              <Button type="button" className="primary" onClick={onClose}>閉じる</Button>
            </ButtonGroup>
          </>
        ) : (
          <Form onSubmit={handleSubmit}>
            <HintBox>{project.companyName}の全商材で共有されるMTG URLとして登録されます。</HintBox>

            <FormGroup>
              <Label><FiUser />担当者（このカレンダーに予定が作られます） *</Label>
              <Select
                name="organizerName"
                value={formData.organizerName}
                onChange={handleChange}
                className={errors.organizerName ? 'error' : ''}
                disabled={isSubmitting}
              >
                <option value="">選択してください</option>
                {staffList.filter((s) => s.role === 'sales').map((s) => (
                  <option key={s.id} value={s.name}>{s.name}{s.email ? '' : '（メール未設定）'}</option>
                ))}
              </Select>
              {errors.organizerName && <ErrorMessage>{errors.organizerName}</ErrorMessage>}
            </FormGroup>

            <FormGroup>
              <Label>タイトル</Label>
              <Input
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder={`${project.companyName}様-Senjin MTG`}
                disabled={isSubmitting}
              />
            </FormGroup>

            <FormGroup>
              <Label>開始日時 *</Label>
              <Input
                type="datetime-local"
                name="startDateTime"
                value={formData.startDateTime}
                onChange={handleChange}
                className={errors.startDateTime ? 'error' : ''}
                disabled={isSubmitting}
              />
              {errors.startDateTime && <ErrorMessage>{errors.startDateTime}</ErrorMessage>}
            </FormGroup>

            <FormGroup>
              <Label>所要時間</Label>
              <Select name="durationMinutes" value={formData.durationMinutes} onChange={handleChange} disabled={isSubmitting}>
                <option value="15">15分</option>
                <option value="30">30分</option>
                <option value="45">45分</option>
                <option value="60">60分</option>
                <option value="90">90分</option>
              </Select>
            </FormGroup>

            <FormGroup>
              <Label>種別</Label>
              <RadioGroup>
                <RadioLabel>
                  <input type="radio" name="recurring" value="true" checked={formData.recurring === 'true'} onChange={handleChange} disabled={isSubmitting} />
                  定例（毎週・繰り返し）
                </RadioLabel>
                <RadioLabel>
                  <input type="radio" name="recurring" value="false" checked={formData.recurring === 'false'} onChange={handleChange} disabled={isSubmitting} />
                  臨時（1回のみ）
                </RadioLabel>
              </RadioGroup>
              {formData.recurring === 'true' && (
                <HintBox style={{ marginTop: '0.6rem' }}>
                  {describeWeeklySchedule(formData.startDateTime)
                    ? `「開始日時」で指定した ${describeWeeklySchedule(formData.startDateTime)} で、以降ずっと繰り返されます。`
                    : '「開始日時」で指定した曜日・時刻で、以降ずっと繰り返されます。'}
                </HintBox>
              )}
            </FormGroup>

            <FormGroup>
              <Label>先方の参加者メール（任意・1行1件）</Label>
              <TextArea
                name="attendeeEmailsText"
                value={formData.attendeeEmailsText}
                onChange={handleChange}
                placeholder={'tanaka@example.com'}
                disabled={isSubmitting}
              />
            </FormGroup>

            <ButtonGroup>
              <Button type="button" className="secondary" onClick={handleCancel} disabled={isSubmitting}>
                <FiX />
                キャンセル
              </Button>
              <Button type="submit" className="primary" disabled={isSubmitting}>
                <FiSave />
                {isSubmitting ? '登録中...' : 'カレンダーに登録'}
              </Button>
            </ButtonGroup>
          </Form>
        )}
      </ModalContent>
    </ModalOverlay>
  );
}

export default MeetingScheduleModal;
