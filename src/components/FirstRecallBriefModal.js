import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { FiTarget, FiSave, FiX, FiSend } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { PHASE_DESCRIPTIONS } from '../data/constants.js';

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

const SubFormGroup = styled(FormGroup)`
  margin-left: 1rem;
  padding-left: 0.75rem;
  border-left: 3px solid #eaf2f8;
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

const RadioRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
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

const AutoCalcBox = styled.div`
  background: #eaf2f8;
  border-radius: 8px;
  padding: 0.7rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #2980b9;
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

// C09URG0R430チャンネル宛のIncoming Webhook URL（未設定時は既存Webhookにフォールバック）
const SLACK_INTAKE_WEBHOOK_URL =
  process.env.REACT_APP_SLACK_INTAKE_WEBHOOK_URL ||
  process.env.REACT_APP_SLACK_WEBHOOK_URL ||
  '';

const PURPOSE_OPTIONS = ['売上UP', '指名検索増加', 'IMP'];
const MALL_OPTIONS = ['Amazon', '楽天', 'Qoo10', '自社EC', '店頭', 'その他'];
const MALLS_REQUIRING_NOTE = ['店頭', 'その他'];
const MEDIA_OPTIONS = ['TikTok', 'Instagram Reels', 'YouTube Shorts', 'X'];
const CONDITION_TYPE_OPTIONS = ['成果型', '予算型', '制作型'];
const PR_LABEL_OPTIONS = ['有', '無', '未回収'];
const COMMENT_POLICY_OPTIONS = ['可', '不可', '未回収'];

const getInitialFormData = () => ({
  purpose: '',
  targetMalls: [],
  mallNote: '',
  targetKeyword: '',
  background: '',
  keyDates: '',
  productUrl: '',
  appealPoints: '',
  ngExpressions: '',
  conditionType: '',
  targetViews: '',
  cpv: '',
  productionUnitPrice: '',
  productionCount: '',
  conditionNote: '',
  media: [],
  prLabel: '',
  commentPolicy: '',
  startTiming: '',
  reportTo: '',
});

const formatNumber = (value) => {
  if (!value) return '';
  return new Intl.NumberFormat('ja-JP').format(value);
};

const buildPurposeSummary = (form) => {
  if (form.purpose === '売上UP') {
    const mallText = form.targetMalls.length > 0 ? form.targetMalls.join(' / ') : '未選択';
    const noteText = form.mallNote ? `（備考: ${form.mallNote}）` : '';
    return `・対象モール: ${mallText}${noteText}`;
  }
  if (form.purpose === '指名検索増加') {
    return `・対象KW: ${form.targetKeyword || '未記入'}`;
  }
  if (form.purpose === 'IMP') {
    return `・背景: ${form.background || '未記入'}`;
  }
  return '';
};

const buildConditionSummary = (form) => {
  if (form.conditionType === '成果型' || form.conditionType === '予算型') {
    const totalBudget = Number(form.targetViews || 0) * Number(form.cpv || 0);
    return `・目標再生数: ${formatNumber(form.targetViews) || '未記入'} / 単価: ${form.cpv ? `${formatNumber(form.cpv)}円` : '未記入'} / 総予算: ${totalBudget ? `${formatNumber(totalBudget)}円（自動計算）` : '未計算'}`;
  }
  if (form.conditionType === '制作型') {
    return `・制作単価: ${form.productionUnitPrice ? `${formatNumber(form.productionUnitPrice)}円` : '未記入'} / 本数: ${form.productionCount || '未記入'}本`;
  }
  return '';
};

const buildSlackMessage = (deal, form) => {
  const mediaText = form.media.length > 0 ? form.media.join(' / ') : '未選択';
  const isPartner = !!(deal.introducer && deal.introducer.trim());
  const contractType = isPartner ? `パートナー経由（${deal.introducer}）` : '直';
  const phaseDescription = deal.status ? PHASE_DESCRIPTIONS[deal.status] : null;
  const phaseLabel = deal.status ? `${deal.status}${phaseDescription ? `（${phaseDescription}）` : ''}` : '-';

  return (
    `🎯 *第一想起 実施可否すり合わせ*\n\n` +
    `*商材名:* ${deal.productName || '-'}\n` +
    `*商品URL:* ${form.productUrl || '未記入'}\n` +
    `*会社名:* ${deal.companyName || '-'}\n` +
    `*契約形態:* ${contractType}\n` +
    `*営業担当:* ${deal.representative || '-'}　*現ステータス:* ${phaseLabel}\n\n` +
    `── 目的・背景 ──\n` +
    `・目的: ${form.purpose || '未選択'}\n` +
    `${buildPurposeSummary(form)}\n` +
    `・重要日程: ${form.keyDates || 'なし'}\n\n` +
    `── 対象商品 ──\n` +
    `・訴求ポイント: ${form.appealPoints || 'なし'}\n` +
    `・NG表現: ${form.ngExpressions || 'なし'}\n\n` +
    `── 実施条件 ──\n` +
    `・実施タイプ: ${form.conditionType || '未選択'}\n` +
    `${buildConditionSummary(form)}\n` +
    `・備考: ${form.conditionNote || 'なし'}\n` +
    `・対象媒体: ${mediaText}\n` +
    `・PR表記: ${form.prLabel || '未選択'}　/ コメント施策: ${form.commentPolicy || '未選択'}\n` +
    `・開始希望: ${form.startTiming || '未記入'}\n\n` +
    `＠運用チーム 上記で実施可否のご確認お願いします🙏`
  );
};

const sendBriefToSlack = async (deal, form) => {
  if (!SLACK_INTAKE_WEBHOOK_URL) {
    throw new Error('Slack Webhook URLが未設定です');
  }
  await fetch(SLACK_INTAKE_WEBHOOK_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify({
      text: buildSlackMessage(deal, form),
      link_names: 1,
    }),
  });
};

function FirstRecallBriefModal({ isOpen, onClose, deal, onSaved }) {
  const [formData, setFormData] = useState(getInitialFormData());
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // isOpenのみに依存: dealは親の再レンダーごとに新しいオブジェクト参照になるため、
  // depsに含めると背景の再レンダー（フェーズ同期等）で入力中のフォームが消えてしまう
  useEffect(() => {
    if (isOpen) {
      setFormData(getInitialFormData());
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen || !deal) return null;

  const clearError = (field) => {
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    clearError(name);
  };

  const handlePurposeChange = (purpose) => {
    setFormData((prev) => ({
      ...prev,
      purpose,
      targetMalls: [],
      mallNote: '',
      targetKeyword: '',
      background: '',
    }));
    clearError('purpose');
    clearError('targetMalls');
    clearError('targetKeyword');
    clearError('background');
  };

  const handleConditionTypeChange = (conditionType) => {
    setFormData((prev) => ({
      ...prev,
      conditionType,
      targetViews: '',
      cpv: '',
      productionUnitPrice: '',
      productionCount: '',
    }));
    clearError('conditionType');
    clearError('targetViews');
    clearError('cpv');
    clearError('productionUnitPrice');
    clearError('productionCount');
  };

  const handleMallToggle = (mall) => {
    setFormData((prev) => {
      const exists = prev.targetMalls.includes(mall);
      const nextMalls = exists
        ? prev.targetMalls.filter((m) => m !== mall)
        : [...prev.targetMalls, mall];
      const stillNeedsNote = nextMalls.some((m) => MALLS_REQUIRING_NOTE.includes(m));
      return {
        ...prev,
        targetMalls: nextMalls,
        mallNote: stillNeedsNote ? prev.mallNote : '',
      };
    });
    clearError('targetMalls');
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
    clearError('media');
  };

  const showMallNote = formData.targetMalls.some((m) => MALLS_REQUIRING_NOTE.includes(m));
  const computedTotalBudget = Number(formData.targetViews || 0) * Number(formData.cpv || 0);

  const validateForm = () => {
    const newErrors = {};

    if (!formData.purpose) {
      newErrors.purpose = '施策の目的を選択してください';
    } else if (formData.purpose === '売上UP' && formData.targetMalls.length === 0) {
      newErrors.targetMalls = '対象モールを1つ以上選択してください';
    } else if (formData.purpose === '指名検索増加' && !formData.targetKeyword.trim()) {
      newErrors.targetKeyword = '対象KWは必須です';
    } else if (formData.purpose === 'IMP' && !formData.background.trim()) {
      newErrors.background = '背景は必須です';
    }

    if (!formData.conditionType) {
      newErrors.conditionType = '実施タイプを選択してください';
    } else if (formData.conditionType === '成果型' || formData.conditionType === '予算型') {
      if (!formData.targetViews) {
        newErrors.targetViews = '目標再生数は必須です';
      } else if (isNaN(Number(formData.targetViews)) || Number(formData.targetViews) <= 0) {
        newErrors.targetViews = '正の数値を入力してください';
      }
      if (!formData.cpv) {
        newErrors.cpv = '単価は必須です';
      } else if (isNaN(Number(formData.cpv)) || Number(formData.cpv) <= 0) {
        newErrors.cpv = '正の数値を入力してください';
      }
    } else if (formData.conditionType === '制作型') {
      if (!formData.productionUnitPrice) {
        newErrors.productionUnitPrice = '制作単価は必須です';
      } else if (isNaN(Number(formData.productionUnitPrice)) || Number(formData.productionUnitPrice) <= 0) {
        newErrors.productionUnitPrice = '正の数値を入力してください';
      }
      if (!formData.productionCount) {
        newErrors.productionCount = '本数は必須です';
      } else if (isNaN(Number(formData.productionCount)) || Number(formData.productionCount) <= 0) {
        newErrors.productionCount = '正の数値を入力してください';
      }
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
        targetMalls: formData.purpose === '売上UP' ? formData.targetMalls : [],
        mallNote: formData.purpose === '売上UP' ? formData.mallNote : '',
        targetKeyword: formData.purpose === '指名検索増加' ? formData.targetKeyword : '',
        background: formData.purpose === 'IMP' ? formData.background : '',
        keyDates: formData.keyDates,
        productUrl: formData.productUrl,
        appealPoints: formData.appealPoints,
        ngExpressions: formData.ngExpressions,
        conditionType: formData.conditionType,
        targetViews: formData.conditionType !== '制作型' && formData.targetViews ? Number(formData.targetViews) : null,
        cpv: formData.conditionType !== '制作型' && formData.cpv ? Number(formData.cpv) : null,
        totalBudget: formData.conditionType !== '制作型' ? computedTotalBudget : null,
        productionUnitPrice: formData.conditionType === '制作型' && formData.productionUnitPrice ? Number(formData.productionUnitPrice) : null,
        productionCount: formData.conditionType === '制作型' && formData.productionCount ? Number(formData.productionCount) : null,
        conditionNote: formData.conditionNote,
        media: formData.media,
        prLabel: formData.prLabel,
        commentPolicy: formData.commentPolicy,
        startTiming: formData.startTiming,
        reportTo: formData.reportTo,
        status: 'submitted',
        createdAt: serverTimestamp(),
      });

      // Slackへ実施可否すり合わせ内容を送信
      try {
        await sendBriefToSlack(deal, formData);
      } catch (slackError) {
        console.error('Slack送信エラー:', slackError);
        alert('内容はFirestoreに保存されましたが、Slackへの送信に失敗しました。');
        return;
      }

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
    <ModalOverlay onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}>
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
            <Label>施策の目的 *</Label>
            <RadioRow>
              {PURPOSE_OPTIONS.map((purpose) => (
                <RadioLabel key={purpose}>
                  <input
                    type="radio"
                    name="purpose"
                    checked={formData.purpose === purpose}
                    onChange={() => handlePurposeChange(purpose)}
                    disabled={isSubmitting}
                  />
                  {purpose}
                </RadioLabel>
              ))}
            </RadioRow>
            {errors.purpose && <ErrorMessage>{errors.purpose}</ErrorMessage>}
          </FormGroup>

          {formData.purpose === '売上UP' && (
            <SubFormGroup>
              <Label>対象モール *</Label>
              <CheckboxRow>
                {MALL_OPTIONS.map((mall) => (
                  <CheckboxLabel key={mall}>
                    <input
                      type="checkbox"
                      checked={formData.targetMalls.includes(mall)}
                      onChange={() => handleMallToggle(mall)}
                      disabled={isSubmitting}
                    />
                    {mall}
                  </CheckboxLabel>
                ))}
              </CheckboxRow>
              {errors.targetMalls && <ErrorMessage>{errors.targetMalls}</ErrorMessage>}

              {showMallNote && (
                <FormGroup style={{ marginTop: '0.75rem' }}>
                  <Label>備考（店頭・その他の詳細）</Label>
                  <Input
                    type="text"
                    name="mallNote"
                    value={formData.mallNote}
                    onChange={handleInputChange}
                    placeholder="例：店舗名、詳細な販路など"
                    disabled={isSubmitting}
                  />
                </FormGroup>
              )}
            </SubFormGroup>
          )}

          {formData.purpose === '指名検索増加' && (
            <SubFormGroup>
              <Label>対象KW *</Label>
              <Input
                type="text"
                name="targetKeyword"
                value={formData.targetKeyword}
                onChange={handleInputChange}
                placeholder="例：ブランド名、商品名"
                className={errors.targetKeyword ? 'error' : ''}
                disabled={isSubmitting}
              />
              {errors.targetKeyword && <ErrorMessage>{errors.targetKeyword}</ErrorMessage>}
            </SubFormGroup>
          )}

          {formData.purpose === 'IMP' && (
            <SubFormGroup>
              <Label>背景 *</Label>
              <TextArea
                name="background"
                value={formData.background}
                onChange={handleInputChange}
                placeholder="IMP獲得を目的とする背景を記入"
                className={errors.background ? 'error' : ''}
                disabled={isSubmitting}
              />
              {errors.background && <ErrorMessage>{errors.background}</ErrorMessage>}
            </SubFormGroup>
          )}

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

          <SectionTitle>実施条件（必須）</SectionTitle>

          <FormGroup>
            <Label>実施タイプ *</Label>
            <RadioRow>
              {CONDITION_TYPE_OPTIONS.map((type) => (
                <RadioLabel key={type}>
                  <input
                    type="radio"
                    name="conditionType"
                    checked={formData.conditionType === type}
                    onChange={() => handleConditionTypeChange(type)}
                    disabled={isSubmitting}
                  />
                  {type}
                </RadioLabel>
              ))}
            </RadioRow>
            {errors.conditionType && <ErrorMessage>{errors.conditionType}</ErrorMessage>}
          </FormGroup>

          {(formData.conditionType === '成果型' || formData.conditionType === '予算型') && (
            <SubFormGroup>
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

              <FormGroup style={{ marginTop: '0.75rem' }}>
                <Label>単価（円）*</Label>
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

              <FormGroup style={{ marginTop: '0.75rem' }}>
                <Label>総予算（自動計算）</Label>
                <AutoCalcBox>
                  {computedTotalBudget ? `${formatNumber(computedTotalBudget)}円` : '-'}
                </AutoCalcBox>
              </FormGroup>
            </SubFormGroup>
          )}

          {formData.conditionType === '制作型' && (
            <SubFormGroup>
              <FormGroup>
                <Label>制作単価（円）*</Label>
                <Input
                  type="number"
                  name="productionUnitPrice"
                  value={formData.productionUnitPrice}
                  onChange={handleInputChange}
                  placeholder="例：50000"
                  className={errors.productionUnitPrice ? 'error' : ''}
                  disabled={isSubmitting}
                  min="1"
                />
                {errors.productionUnitPrice && <ErrorMessage>{errors.productionUnitPrice}</ErrorMessage>}
              </FormGroup>

              <FormGroup style={{ marginTop: '0.75rem' }}>
                <Label>本数 *</Label>
                <Input
                  type="number"
                  name="productionCount"
                  value={formData.productionCount}
                  onChange={handleInputChange}
                  placeholder="例：5"
                  className={errors.productionCount ? 'error' : ''}
                  disabled={isSubmitting}
                  min="1"
                />
                {errors.productionCount && <ErrorMessage>{errors.productionCount}</ErrorMessage>}
              </FormGroup>
            </SubFormGroup>
          )}

          <FormGroup>
            <Label>備考</Label>
            <TextArea
              name="conditionNote"
              value={formData.conditionNote}
              onChange={handleInputChange}
              placeholder="実施条件に関する補足があれば記入"
              disabled={isSubmitting}
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
              {PR_LABEL_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
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
              {COMMENT_POLICY_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
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
