import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { FiTarget, FiSave, FiX, FiUser, FiSend } from 'react-icons/fi';
import { fetchAllStaff } from '../services/staffService.js';
import { db } from '../firebase.js';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

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
  max-width: 560px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 10px 25px rgba(0,0,0,0.2);
  animation: modalSlideIn 0.3s ease-out;

  @keyframes modalSlideIn {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
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
  color: #2980b9;
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

  &:hover {
    color: #7f8c8d;
  }
`;

const Form = styled.form`
  display: grid;
  gap: 1.25rem;
`;

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding-top: 1rem;
  border-top: 2px solid #e9ecef;
  color: #2980b9;
  font-weight: 600;
  font-size: 0.95rem;

  &:first-of-type {
    border-top: none;
    padding-top: 0;
    margin-top: 0;
  }
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
  gap: 0.5rem;
  font-size: 0.9rem;
`;

const Input = styled.input`
  padding: 0.7rem;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 0.95rem;
  transition: border-color 0.3s ease;

  &:focus {
    outline: none;
    border-color: #2980b9;
    box-shadow: 0 0 0 3px rgba(41, 128, 185, 0.1);
  }

  &.error {
    border-color: #e74c3c;
    box-shadow: 0 0 0 3px rgba(231, 76, 60, 0.1);
  }
`;

const Select = styled.select`
  padding: 0.7rem;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 0.95rem;
  background: white;
  transition: border-color 0.3s ease;

  &:focus {
    outline: none;
    border-color: #2980b9;
    box-shadow: 0 0 0 3px rgba(41, 128, 185, 0.1);
  }

  &.error {
    border-color: #e74c3c;
  }
`;

const TextArea = styled.textarea`
  padding: 0.7rem;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 0.95rem;
  min-height: 70px;
  resize: vertical;
  font-family: inherit;

  &:focus {
    outline: none;
    border-color: #2980b9;
    box-shadow: 0 0 0 3px rgba(41, 128, 185, 0.1);
  }
`;

const CheckboxRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
`;

const CheckboxLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  font-weight: 500;
  color: #2c3e50;
  cursor: pointer;
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
  transition: all 0.3s ease;

  &.primary {
    background: #2980b9;
    color: white;

    &:hover {
      background: #21618c;
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(41, 128, 185, 0.3);
    }

    &:disabled {
      background: #95a5a6;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
  }

  &.secondary {
    background: #95a5a6;
    color: white;

    &:hover {
      background: #7f8c8d;
    }
  }
`;

const DealInfo = styled.div`
  background: #f8f9fa;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 0.5rem;
  border-left: 4px solid #2980b9;
  display: grid;
  gap: 0.35rem;
`;

const DealText = styled.p`
  margin: 0;
  color: #2c3e50;
  font-size: 0.9rem;

  strong {
    color: #2980b9;
  }
`;

const ErrorMessage = styled.div`
  color: #e74c3c;
  font-size: 0.85rem;
  margin-top: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
`;

const HelperNote = styled.div`
  font-size: 0.8rem;
  color: #7f8c8d;
  margin-top: 0.25rem;
`;

// 専用チャンネル用Webhookが未設定の間は既存Webhookにフォールバック
const SLACK_INTAKE_WEBHOOK_URL =
  process.env.REACT_APP_SLACK_INTAKE_WEBHOOK_URL ||
  process.env.REACT_APP_SLACK_WEBHOOK_URL ||
  '';

const MEDIA_OPTIONS = ['TikTok', 'Instagram Reels', 'YouTube Shorts'];

const REPORT_FREQUENCY_OPTIONS = [
  '中間1回＋最終1回',
  '週次＋最終',
  '最終のみ',
];

const getInitialFormData = () => ({
  purpose: '',
  channel: '',
  keyDates: '',
  productUrl: '',
  appealPoints: '',
  ngExpressions: '',
  sampleProvided: '未定',
  targetViews: '',
  cpv: '',
  totalBudget: '',
  media: [],
  prLabel: '',
  commentPolicy: '',
  startTiming: '',
  reportTo: '',
  operatorRep: '',
  reportFrequency: REPORT_FREQUENCY_OPTIONS[0],
});

const formatNumber = (value) => {
  if (!value) return '';
  return new Intl.NumberFormat('ja-JP').format(value);
};

const buildSlackMessage = (deal, form) => {
  const mediaText = form.media.length > 0 ? form.media.join(' / ') : '未選択';
  return (
    `🎯 *第一想起 実施可否すり合わせ*　＜${deal.companyName || deal.productName}／${deal.productName}＞\n\n` +
    `*営業担当:* ${deal.representative || '-'}　*現ステータス:* ${deal.status || '-'}\n\n` +
    `── 目的・背景 ──\n` +
    `・目的: ${form.purpose || '未記入'}\n` +
    `・対象モール/チャネル: ${form.channel || '未記入'}\n` +
    `・重要日程: ${form.keyDates || 'なし'}\n\n` +
    `── 実施条件 ──\n` +
    `・目標再生数: ${formatNumber(form.targetViews) || '未記入'} / 再生単価: ${form.cpv ? `${formatNumber(form.cpv)}円` : '未記入'} / 総予算: ${form.totalBudget ? `${formatNumber(form.totalBudget)}円` : '未記入'}\n` +
    `・対象媒体: ${mediaText}\n` +
    `・PR表記: ${form.prLabel || '未選択'}　/ コメント施策: ${form.commentPolicy || '未選択'}\n` +
    `・開始希望: ${form.startTiming || '未記入'}\n\n` +
    `── 体制 ──\n` +
    `・報告先: ${form.reportTo || '未記入'} / 運用担当: ${form.operatorRep || '未選択'} / レポート頻度: ${form.reportFrequency}\n\n` +
    `＠運用チーム 上記で実施可否のご確認お願いします🙏`
  );
};

const sendBriefToSlack = async (deal, form) => {
  if (!SLACK_INTAKE_WEBHOOK_URL) {
    console.warn('Slack Webhook URLが未設定のため送信をスキップしました');
    return false;
  }
  try {
    await fetch(SLACK_INTAKE_WEBHOOK_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({
        text: buildSlackMessage(deal, form),
        link_names: 1,
      }),
    });
    return true;
  } catch (error) {
    console.error('Slack送信エラー:', error);
    return false;
  }
};

function FirstRecallBriefModal({ isOpen, onClose, deal, onSaved }) {
  const [formData, setFormData] = useState(getInitialFormData());
  const [errors, setErrors] = useState({});
  const [staffList, setStaffList] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadStaff = async () => {
      try {
        const staff = await fetchAllStaff();
        setStaffList(staff);
      } catch (error) {
        console.error('Failed to fetch staff:', error);
      }
    };
    loadStaff();
  }, []);

  useEffect(() => {
    if (isOpen) {
      setFormData(getInitialFormData());
      setErrors({});
    }
  }, [isOpen, deal]);

  if (!isOpen || !deal) return null;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  const handleMediaToggle = (media) => {
    setFormData((prev) => {
      const exists = prev.media.includes(media);
      return {
        ...prev,
        media: exists
          ? prev.media.filter((m) => m !== media)
          : [...prev.media, media],
      };
    });
    if (errors.media) {
      setErrors((prev) => ({ ...prev, media: null }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.targetViews) {
      newErrors.targetViews = '目標再生数は必須です';
    } else if (isNaN(Number(formData.targetViews)) || Number(formData.targetViews) <= 0) {
      newErrors.targetViews = '正の数値を入力してください';
    }

    if (!formData.cpv) {
      newErrors.cpv = '再生単価は必須です';
    } else if (isNaN(Number(formData.cpv)) || Number(formData.cpv) <= 0) {
      newErrors.cpv = '正の数値を入力してください';
    }

    if (formData.media.length === 0) {
      newErrors.media = '対象媒体を1つ以上選択してください';
    }

    if (!formData.prLabel) {
      newErrors.prLabel = 'PR表記の有無を選択してください';
    }

    if (!formData.commentPolicy) {
      newErrors.commentPolicy = 'コメント施策の可否を選択してください';
    }

    if (!formData.startTiming) {
      newErrors.startTiming = '開始希望時期は必須です';
    }

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

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      // Firestoreに保存（案件と紐づけ）
      await addDoc(collection(db, 'firstRecallBriefs'), {
        dealId: deal.id,
        companyName: deal.companyName || '',
        productName: deal.productName || '',
        representative: deal.representative || '',
        dealStatus: deal.status || '',
        purpose: formData.purpose,
        channel: formData.channel,
        keyDates: formData.keyDates,
        productUrl: formData.productUrl,
        appealPoints: formData.appealPoints,
        ngExpressions: formData.ngExpressions,
        sampleProvided: formData.sampleProvided,
        targetViews: Number(formData.targetViews),
        cpv: Number(formData.cpv),
        totalBudget: formData.totalBudget ? Number(formData.totalBudget) : null,
        media: formData.media,
        prLabel: formData.prLabel,
        commentPolicy: formData.commentPolicy,
        startTiming: formData.startTiming,
        reportTo: formData.reportTo,
        operatorRep: formData.operatorRep,
        reportFrequency: formData.reportFrequency,
        status: 'submitted',
        createdAt: serverTimestamp(),
      });

      // Slackへ実施可否すり合わせ内容を送信
      await sendBriefToSlack(deal, formData);

      if (onSaved) {
        onSaved();
      }

      setFormData(getInitialFormData());
      setErrors({});
      onClose();
    } catch (error) {
      console.error('実施可否すり合わせ送信エラー:', error);
      alert('送信に失敗しました。もう一度お試しください。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalOverlay onClick={handleCancel}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>
            <FiTarget />
            第一想起 実施可否すり合わせ
          </ModalTitle>
          <CloseButton onClick={handleCancel}>
            <FiX />
          </CloseButton>
        </ModalHeader>

        <DealInfo>
          <DealText>
            <strong>{deal.companyName || deal.productName}</strong> - {deal.productName}
          </DealText>
          <DealText>
            営業担当: {deal.representative || '-'}　現ステータス: {deal.status || '-'}
          </DealText>
        </DealInfo>

        <Form onSubmit={handleSubmit}>
          <SectionTitle>目的・背景</SectionTitle>

          <FormGroup>
            <Label>施策の目的</Label>
            <Input
              type="text"
              name="purpose"
              value={formData.purpose}
              onChange={handleInputChange}
              placeholder="例：楽天の売上UP／Amazonセール連動／指名検索増／新商品認知"
              disabled={isSubmitting}
            />
          </FormGroup>

          <FormGroup>
            <Label>対象モール・チャネル</Label>
            <Input
              type="text"
              name="channel"
              value={formData.channel}
              onChange={handleInputChange}
              placeholder="例：楽天、Amazon、自社EC"
              disabled={isSubmitting}
            />
          </FormGroup>

          <FormGroup>
            <Label>動かせない重要日程</Label>
            <Input
              type="text"
              name="keyDates"
              value={formData.keyDates}
              onChange={handleInputChange}
              placeholder="例：8月のセール開始日に合わせたい"
              disabled={isSubmitting}
            />
          </FormGroup>

          <SectionTitle>対象商品</SectionTitle>

          <FormGroup>
            <Label>商品URL</Label>
            <Input
              type="text"
              name="productUrl"
              value={formData.productUrl}
              onChange={handleInputChange}
              placeholder="モール上の商品ページURL"
              disabled={isSubmitting}
            />
          </FormGroup>

          <FormGroup>
            <Label>訴求ポイント</Label>
            <TextArea
              name="appealPoints"
              value={formData.appealPoints}
              onChange={handleInputChange}
              placeholder="訴求したいポイントを記入"
              disabled={isSubmitting}
            />
          </FormGroup>

          <FormGroup>
            <Label>NG表現・言えないこと</Label>
            <TextArea
              name="ngExpressions"
              value={formData.ngExpressions}
              onChange={handleInputChange}
              placeholder="薬機法・景表法上のNGなど"
              disabled={isSubmitting}
            />
          </FormGroup>

          <FormGroup>
            <Label>サンプル提供の有無</Label>
            <Select
              name="sampleProvided"
              value={formData.sampleProvided}
              onChange={handleInputChange}
              disabled={isSubmitting}
            >
              <option value="未定">未定</option>
              <option value="有">有</option>
              <option value="無">無</option>
            </Select>
          </FormGroup>

          <SectionTitle>実施条件（必須）</SectionTitle>

          <FormGroup>
            <Label>目標再生数 *</Label>
            <Input
              type="number"
              name="targetViews"
              value={formData.targetViews}
              onChange={handleInputChange}
              placeholder="例：1000000"
              className={errors.targetViews ? 'error' : ''}
              disabled={isSubmitting}
              min="1"
            />
            {errors.targetViews && <ErrorMessage>{errors.targetViews}</ErrorMessage>}
          </FormGroup>

          <FormGroup>
            <Label>再生単価（円）*</Label>
            <Input
              type="number"
              name="cpv"
              value={formData.cpv}
              onChange={handleInputChange}
              placeholder="例：3"
              className={errors.cpv ? 'error' : ''}
              disabled={isSubmitting}
              min="0.01"
              step="0.01"
            />
            {errors.cpv && <ErrorMessage>{errors.cpv}</ErrorMessage>}
          </FormGroup>

          <FormGroup>
            <Label>総予算（円）</Label>
            <Input
              type="number"
              name="totalBudget"
              value={formData.totalBudget}
              onChange={handleInputChange}
              placeholder="例：3000000"
              disabled={isSubmitting}
              min="0"
            />
          </FormGroup>

          <FormGroup>
            <Label>対象媒体 *</Label>
            <CheckboxRow>
              {MEDIA_OPTIONS.map((media) => (
                <CheckboxLabel key={media}>
                  <input
                    type="checkbox"
                    checked={formData.media.includes(media)}
                    onChange={() => handleMediaToggle(media)}
                    disabled={isSubmitting}
                  />
                  {media}
                </CheckboxLabel>
              ))}
            </CheckboxRow>
            {errors.media && <ErrorMessage>{errors.media}</ErrorMessage>}
          </FormGroup>

          <FormGroup>
            <Label>PR表記の有無 *</Label>
            <Select
              name="prLabel"
              value={formData.prLabel}
              onChange={handleInputChange}
              className={errors.prLabel ? 'error' : ''}
              disabled={isSubmitting}
            >
              <option value="">選択してください</option>
              <option value="有">有</option>
              <option value="無">無</option>
            </Select>
            {errors.prLabel && <ErrorMessage>{errors.prLabel}</ErrorMessage>}
          </FormGroup>

          <FormGroup>
            <Label>コメント施策の可否 *</Label>
            <Select
              name="commentPolicy"
              value={formData.commentPolicy}
              onChange={handleInputChange}
              className={errors.commentPolicy ? 'error' : ''}
              disabled={isSubmitting}
            >
              <option value="">選択してください</option>
              <option value="可">可</option>
              <option value="不可">不可</option>
            </Select>
            {errors.commentPolicy && <ErrorMessage>{errors.commentPolicy}</ErrorMessage>}
          </FormGroup>

          <FormGroup>
            <Label>開始希望時期 *</Label>
            <Input
              type="text"
              name="startTiming"
              value={formData.startTiming}
              onChange={handleInputChange}
              placeholder="例：2026年8月上旬"
              className={errors.startTiming ? 'error' : ''}
              disabled={isSubmitting}
            />
            {errors.startTiming && <ErrorMessage>{errors.startTiming}</ErrorMessage>}
          </FormGroup>

          <SectionTitle>
            <FiSend />
            報告・体制
          </SectionTitle>

          <FormGroup>
            <Label>主報告先</Label>
            <Input
              type="text"
              name="reportTo"
              value={formData.reportTo}
              onChange={handleInputChange}
              placeholder="例：先方ご担当者名・役職"
              disabled={isSubmitting}
            />
          </FormGroup>

          <FormGroup>
            <Label>
              <FiUser />
              運用担当
            </Label>
            <Select
              name="operatorRep"
              value={formData.operatorRep}
              onChange={handleInputChange}
              disabled={isSubmitting}
            >
              <option value="">選択してください</option>
              {staffList.filter((s) => s.role === 'operator').map((staff) => (
                <option key={staff.id} value={staff.name}>{staff.name}</option>
              ))}
            </Select>
          </FormGroup>

          <FormGroup>
            <Label>レポート頻度</Label>
            <Select
              name="reportFrequency"
              value={formData.reportFrequency}
              onChange={handleInputChange}
              disabled={isSubmitting}
            >
              {REPORT_FREQUENCY_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </Select>
            <HelperNote>作成者は運用が一次作成→営業が確認して提出（デフォルト運用ルール）</HelperNote>
          </FormGroup>

          <ButtonGroup>
            <Button type="button" className="secondary" onClick={handleCancel} disabled={isSubmitting}>
              <FiX />
              キャンセル
            </Button>
            <Button type="submit" className="primary" disabled={isSubmitting}>
              <FiSave />
              {isSubmitting ? '送信中...' : 'Slackへ送信'}
            </Button>
          </ButtonGroup>
        </Form>
      </ModalContent>
    </ModalOverlay>
  );
}

export default FirstRecallBriefModal;
