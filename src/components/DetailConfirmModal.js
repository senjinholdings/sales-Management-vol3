import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { FiCheckSquare, FiSave, FiX } from 'react-icons/fi';
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
import { updateProject } from '../services/projectService.js';
import {
  resolveSalesSubCol,
  getLatestRecordId,
  advanceFirstRecallNa,
  FIRST_RECALL_NA_LABELS,
  FIRST_RECALL_NA_CONTENT,
} from '../utils/firstRecallNextAction.js';

// 第一想起取れるくん ②詳細確認モーダル（PR表記・コメント施策の確定）
// ContractRequestModal.js と同じ ModalOverlay/ModalContent/ModalHeader/Form パターンを踏襲（色は黄色系#f39c12）

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
  color: #f39c12;
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
  font-size: 0.9rem;
`;

const Select = styled.select`
  padding: 0.7rem;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 0.95rem;
  background: white;

  &:focus {
    outline: none;
    border-color: #f39c12;
    box-shadow: 0 0 0 3px rgba(243, 156, 18, 0.15);
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
    border-color: #f39c12;
    box-shadow: 0 0 0 3px rgba(243, 156, 18, 0.15);
  }
`;

const HintBox = styled.div`
  background: #fef5e7;
  border-radius: 8px;
  padding: 0.7rem;
  font-size: 0.85rem;
  color: #b9770e;
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
    background: #f39c12;
    color: white;
    &:hover { background: #d68910; }
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
  border-left: 4px solid #f39c12;
`;

const DealText = styled.p`
  margin: 0;
  color: #2c3e50;
  font-size: 0.9rem;

  strong { color: #f39c12; }
`;

// 確定時は「未回収」を選べない（有/無、可/不可のみ）
const PR_LABEL_CONFIRM_OPTIONS = ['有', '無'];
const COMMENT_POLICY_CONFIRM_OPTIONS = ['可', '不可'];

const getInitialFormData = () => ({
  prLabel: '',
  commentPolicy: '',
  note: '',
});

function DetailConfirmModal({ isOpen, onClose, deal, onSaved }) {
  const [formData, setFormData] = useState(getInitialFormData());
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [brief, setBrief] = useState(null);
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
        // firstRecallBriefsは案件単位で複数件ありうるため、dealIdの等値検索のみ行い
        // 複合インデックスを避けてクライアント側で最新の1件に絞る（ContractRequestModal.jsと同じ方針）
        const q = query(collection(db, 'firstRecallBriefs'), where('dealId', '==', deal.id));
        const snapshot = await getDocs(q);
        const briefs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        briefs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        const latestBrief = briefs[0] || null;
        if (cancelled) return;
        setBrief(latestBrief);
        setFormData({
          prLabel: PR_LABEL_CONFIRM_OPTIONS.includes(latestBrief?.prLabel) ? latestBrief.prLabel : '',
          commentPolicy: COMMENT_POLICY_CONFIRM_OPTIONS.includes(latestBrief?.commentPolicy) ? latestBrief.commentPolicy : '',
          note: '',
        });
      } catch (error) {
        console.error('詳細確認: ヒアリング情報の取得に失敗しました', error);
      } finally {
        if (!cancelled) setLoadingContext(false);
      }
    };

    loadContext();
    return () => { cancelled = true; };
  // deal自体ではなくdeal?.idに依存させる: 親のリアルタイム購読(onSnapshot)により
  // deal propは同じ案件でも毎回新しいオブジェクト参照で渡ってくるため、
  // deal参照そのものに依存すると入力中に再フェッチが走り、選択中の値がリセットされてしまう
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
    if (!PR_LABEL_CONFIRM_OPTIONS.includes(formData.prLabel)) newErrors.prLabel = 'PR表記の有無（確定値）を選択してください';
    if (!COMMENT_POLICY_CONFIRM_OPTIONS.includes(formData.commentPolicy)) newErrors.commentPolicy = 'コメント施策の可否（確定値）を選択してください';
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
      // firstRecallBriefsのヒアリング値（未回収等）を確定値で上書き
      if (brief?.id) {
        await updateDoc(doc(db, 'firstRecallBriefs', brief.id), {
          prLabel: formData.prLabel,
          commentPolicy: formData.commentPolicy,
          detailNote: formData.note,
          detailStatus: 'done',
          detailDoneAt: serverTimestamp(),
          detailDoneBy: deal.representative || '',
        });
      }

      // progressDashboard側は一覧バッジ表示用に非正規化して保持。
      // ①②の完了順は不定なので、①が既に完了していればここでcontractStatusもreadyにする
      const dashRef = doc(db, 'progressDashboard', deal.id);
      const dashSnap = await getDoc(dashRef);
      const dashData = dashSnap.exists() ? dashSnap.data() : {};
      const scheduleAlreadyDone = dashData.firstRecallScheduleStatus === 'done';
      const updates = { firstRecallDetailStatus: 'done' };
      if (scheduleAlreadyDone) {
        updates.firstRecallContractStatus = 'ready';
      }
      await updateProject(deal.id, updates);

      // NA連鎖: ②のNAをdone化し、①②両方完了済みなら③「契約締結依頼」のNAを自動生成
      const subCol = resolveSalesSubCol(deal);
      const recordId = await getLatestRecordId(deal.id, subCol, deal.status || '');
      await advanceFirstRecallNa({
        dealId: deal.id,
        subCol,
        recordId,
        matchKeywords: [FIRST_RECALL_NA_LABELS.detail],
        nextActionContent: scheduleAlreadyDone ? FIRST_RECALL_NA_CONTENT.contract : null,
        nextActionAssignee: deal.representative || '',
        nextActionDueDate: new Date().toISOString().split('T')[0],
      });

      if (onSaved) onSaved();
      setFormData(getInitialFormData());
      setErrors({});
      onClose();
    } catch (error) {
      console.error('詳細確認の保存エラー:', error);
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
            <FiCheckSquare />
            ②詳細確認
          </ModalTitle>
          <CloseButton onClick={handleCancel}><FiX /></CloseButton>
        </ModalHeader>

        <DealInfo>
          <DealText>
            <strong>{deal.companyName || deal.productName}</strong> - {deal.productName}
          </DealText>
        </DealInfo>

        {loadingContext && <HintBox>読み込み中...</HintBox>}
        {!loadingContext && !brief && (
          <HintBox>この案件の第一想起ヒアリング内容が見つかりませんでした。確定値のみ入力してください（ヒアリングへの反映は行われません）。</HintBox>
        )}
        {!loadingContext && brief && (
          <HintBox>
            ヒアリング時点の値　PR表記: {brief.prLabel || '未回収'} ／ コメント施策: {brief.commentPolicy || '未回収'}
          </HintBox>
        )}

        <Form onSubmit={handleSubmit}>
          <FormGroup>
            <Label>PR表記の有無（確定値） *</Label>
            <Select
              name="prLabel"
              value={formData.prLabel}
              onChange={handleInputChange}
              className={errors.prLabel ? 'error' : ''}
              disabled={isSubmitting}
            >
              <option value="">選択してください</option>
              {PR_LABEL_CONFIRM_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </Select>
            {errors.prLabel && <ErrorMessage>{errors.prLabel}</ErrorMessage>}
          </FormGroup>

          <FormGroup>
            <Label>コメント施策の可否（確定値） *</Label>
            <Select
              name="commentPolicy"
              value={formData.commentPolicy}
              onChange={handleInputChange}
              className={errors.commentPolicy ? 'error' : ''}
              disabled={isSubmitting}
            >
              <option value="">選択してください</option>
              {COMMENT_POLICY_CONFIRM_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </Select>
            {errors.commentPolicy && <ErrorMessage>{errors.commentPolicy}</ErrorMessage>}
          </FormGroup>

          <FormGroup>
            <Label>備考（任意）</Label>
            <TextArea
              name="note"
              value={formData.note}
              onChange={handleInputChange}
              placeholder="確認時の補足があれば記入"
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

export default DetailConfirmModal;
