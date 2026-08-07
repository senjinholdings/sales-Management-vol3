import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { FiCalendar, FiSave, FiX, FiUser } from 'react-icons/fi';
import { db } from '../firebase.js';
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { fetchAllStaff } from '../services/staffService.js';
import { updateProject } from '../services/projectService.js';
import {
  resolveSalesSubCol,
  getLatestRecordId,
  advanceFirstRecallNa,
  FIRST_RECALL_NA_LABELS,
  FIRST_RECALL_NA_CONTENT,
} from '../utils/firstRecallNextAction.js';

// 第一想起取れるくん ①進行スケジュール確認モーダル
// Slackボタンでの実施予定だったフローをvol3ダッシュボード上に移設したもの。
// ContractRequestModal.js と同じ ModalOverlay/ModalContent/ModalHeader/Form パターンを踏襲（色は緑系#27ae60）

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
  color: #27ae60;
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
    border-color: #27ae60;
    box-shadow: 0 0 0 3px rgba(39, 174, 96, 0.1);
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
    border-color: #27ae60;
    box-shadow: 0 0 0 3px rgba(39, 174, 96, 0.1);
  }

  &.error { border-color: #e74c3c; }
`;

const TextArea = styled.textarea`
  padding: 0.7rem;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 0.95rem;
  min-height: 80px;
  resize: vertical;
  font-family: inherit;

  &:focus {
    outline: none;
    border-color: #27ae60;
    box-shadow: 0 0 0 3px rgba(39, 174, 96, 0.1);
  }
`;

const HintBox = styled.div`
  background: #eafaf1;
  border-radius: 8px;
  padding: 0.7rem;
  font-size: 0.85rem;
  color: #1e8449;
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
    background: #27ae60;
    color: white;
    &:hover { background: #219a52; }
    &:disabled { background: #95a5a6; cursor: not-allowed; }
  }

  &.secondary {
    background: #95a5a6;
    color: white;
    &:hover { background: #7f8c8d; }
  }
`;

const DealInfo = styled.div`
  background: #f8f9fa;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 0.5rem;
  border-left: 4px solid #27ae60;
`;

const DealText = styled.p`
  margin: 0;
  color: #2c3e50;
  font-size: 0.9rem;

  strong { color: #27ae60; }
`;

const getInitialFormData = () => ({
  operator: '',
  startDate: '',
  note: '',
});

// 終了日は営業には入力させず、開始日から3ヶ月後を自動的に算出する
function addThreeMonths(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString + 'T00:00:00');
  date.setMonth(date.getMonth() + 3);
  return date.toISOString().split('T')[0];
}

function ScheduleConfirmModal({ isOpen, onClose, deal, onSaved }) {
  const [formData, setFormData] = useState(getInitialFormData());
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [staffList, setStaffList] = useState([]);
  const [briefId, setBriefId] = useState(null);
  const [loadingContext, setLoadingContext] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFormData(getInitialFormData());
    setErrors({});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !deal) return;

    let cancelled = false;
    const loadContext = async () => {
      setLoadingContext(true);
      try {
        const staff = await fetchAllStaff();
        if (!cancelled) setStaffList(staff);

        // firstRecallBriefsは案件単位で複数件ありうるため、dealIdの等値検索のみ行い
        // 複合インデックスを避けてクライアント側で最新の1件に絞る（ContractRequestModal.jsと同じ方針）
        const q = query(collection(db, 'firstRecallBriefs'), where('dealId', '==', deal.id));
        const snapshot = await getDocs(q);
        const briefs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        briefs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        if (!cancelled) setBriefId(briefs[0]?.id || null);
      } catch (error) {
        console.error('進行スケジュール確認: 初期情報の取得に失敗しました', error);
      } finally {
        if (!cancelled) setLoadingContext(false);
      }
    };

    loadContext();
    return () => { cancelled = true; };
    // deal自体ではなくdeal?.idに依存させる: 親のリアルタイム購読(onSnapshot)によりdeal propは
    // 同じ案件でも毎回新しいオブジェクト参照で渡ってくるため、deal参照に依存すると入力中に
    // 再フェッチが走り選択中の値がリセットされてしまう
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, deal?.id]);

  if (!isOpen || !deal) return null;

  const clearError = (field) => {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: null }));
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    clearError(name);
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.operator) newErrors.operator = '運用担当者を選択してください';
    if (!formData.startDate) newErrors.startDate = '開始日は必須です';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCancel = () => {
    setFormData(getInitialFormData());
    setErrors({});
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      // firstRecallBriefsに合意済みスケジュールを記録（見つからない場合はスキップし、progressDashboard側の更新は継続する）
      if (briefId) {
        await updateDoc(doc(db, 'firstRecallBriefs', briefId), {
          scheduleOperator: formData.operator,
          scheduleAgreed: {
            startDate: formData.startDate,
            endDate: addThreeMonths(formData.startDate),
            note: formData.note,
          },
          scheduleStatus: 'done',
          scheduleDoneAt: serverTimestamp(),
          scheduleDoneBy: formData.operator,
        });
      }

      // progressDashboard側は一覧バッジ表示用に非正規化して保持。
      // ①②の完了順は不定なので、②が既に完了していればここでcontractStatusもreadyにする
      const dashRef = doc(db, 'progressDashboard', deal.id);
      const dashSnap = await getDoc(dashRef);
      const dashData = dashSnap.exists() ? dashSnap.data() : {};
      const updates = {
        firstRecallScheduleStatus: 'done',
        firstRecallScheduleOperator: formData.operator,
      };
      if (dashData.firstRecallDetailStatus === 'done') {
        updates.firstRecallContractStatus = 'ready';
      }
      await updateProject(deal.id, updates);

      // NA連鎖: ①のNAをdone化し、②「詳細確認」のNAを自動生成
      const subCol = resolveSalesSubCol(deal);
      const recordId = await getLatestRecordId(deal.id, subCol, deal.status || '');
      await advanceFirstRecallNa({
        dealId: deal.id,
        subCol,
        recordId,
        matchKeywords: [FIRST_RECALL_NA_LABELS.schedule],
        nextActionContent: FIRST_RECALL_NA_CONTENT.detail,
        nextActionAssignee: deal.representative || '',
        nextActionDueDate: new Date().toISOString().split('T')[0],
      });

      if (onSaved) onSaved();
      setFormData(getInitialFormData());
      setErrors({});
      onClose();
    } catch (error) {
      console.error('進行スケジュール確認の保存エラー:', error);
      alert('保存に失敗しました。もう一度お試しください。');
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
            ①進行スケジュール確認
          </ModalTitle>
          <CloseButton onClick={handleCancel}><FiX /></CloseButton>
        </ModalHeader>

        <DealInfo>
          <DealText>
            <strong>{deal.companyName || deal.productName}</strong> - {deal.productName}
          </DealText>
        </DealInfo>

        {loadingContext && <HintBox>読み込み中...</HintBox>}
        {!loadingContext && !briefId && (
          <HintBox>この案件の第一想起ヒアリング内容が見つかりませんでした。進行スケジュールのみ案件情報として保存します。</HintBox>
        )}

        <Form onSubmit={handleSubmit}>
          <FormGroup>
            <Label>
              <FiUser />
              運用担当者を選択 *
            </Label>
            <Select
              name="operator"
              value={formData.operator}
              onChange={handleInputChange}
              className={errors.operator ? 'error' : ''}
              disabled={isSubmitting}
            >
              <option value="">選択してください</option>
              {staffList.filter((s) => s.role === 'operator').map((staff) => (
                <option key={staff.id} value={staff.name}>{staff.name}</option>
              ))}
            </Select>
            {errors.operator && <ErrorMessage>{errors.operator}</ErrorMessage>}
          </FormGroup>

          <FormGroup>
            <Label>開始日 *</Label>
            <Input
              type="date"
              name="startDate"
              value={formData.startDate}
              onChange={handleInputChange}
              className={errors.startDate ? 'error' : ''}
              disabled={isSubmitting}
            />
            {errors.startDate && <ErrorMessage>{errors.startDate}</ErrorMessage>}
          </FormGroup>
          <HintBox>終了日は開始日から3ヶ月後として自動設定されます（契約締結依頼・スプレッドシートに反映）。</HintBox>

          <FormGroup>
            <Label>すり合わせ内容メモ</Label>
            <TextArea
              name="note"
              value={formData.note}
              onChange={handleInputChange}
              placeholder="先方と合意した進行内容の詳細を記入"
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
              {isSubmitting ? '保存中...' : '確認完了として保存'}
            </Button>
          </ButtonGroup>
        </Form>
      </ModalContent>
    </ModalOverlay>
  );
}

export default ScheduleConfirmModal;
