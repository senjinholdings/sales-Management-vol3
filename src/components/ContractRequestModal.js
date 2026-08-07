import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { FiFileText, FiSave, FiX } from 'react-icons/fi';
import { db } from '../firebase.js';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { updateProject, updateSalesRecord } from '../services/projectService.js';
import { resolveSalesSubCol, getLatestRecordId } from '../utils/firstRecallNextAction.js';

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
  color: #8e44ad;
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

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding-top: 1rem;
  border-top: 2px solid #e9ecef;
  color: #8e44ad;
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

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
`;

const Label = styled.label`
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
`;

const Input = styled.input`
  padding: 0.7rem;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 0.95rem;

  &:focus {
    outline: none;
    border-color: #8e44ad;
    box-shadow: 0 0 0 3px rgba(142, 68, 173, 0.1);
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
    border-color: #8e44ad;
    box-shadow: 0 0 0 3px rgba(142, 68, 173, 0.1);
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
    border-color: #8e44ad;
    box-shadow: 0 0 0 3px rgba(142, 68, 173, 0.1);
  }
`;

const CheckboxLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  font-weight: 500;
  color: #2c3e50;
  cursor: pointer;
`;

const HintBox = styled.div`
  background: #f4ecf7;
  border-radius: 8px;
  padding: 0.7rem;
  font-size: 0.85rem;
  color: #6c3483;
`;

const AutoCalcBox = styled.div`
  background: #f4ecf7;
  border-radius: 8px;
  padding: 0.7rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #8e44ad;
`;

const MediaRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.5rem;
  align-items: end;
`;

const CheckboxRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
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
    background: #8e44ad;
    color: white;
    &:hover { background: #6c3483; }
    &:disabled { background: #95a5a6; cursor: not-allowed; }
  }

  &.secondary {
    background: #95a5a6;
    color: white;
    &:hover { background: #7f8c8d; }
  }
`;

// 締結依頼の送信先（GAS Webアプリ）。未デプロイの間は空のまま運用し、Firestoreへの記録のみ行う
const CONTRACT_REQUEST_GAS_URL = process.env.REACT_APP_CONTRACT_REQUEST_GAS_URL || '';

// conditionType/prLabel から個別契約雛形を自動サジェストする（ユーザーには課金タイプ・PR表記だけ選ばせ、
// 雛形そのものはこの関数で裏側で決定する。手動で雛形を選ばせるUIは持たない）
// 成果型はPR表記の有無で分岐、予算型はimp保証、制作型は買い切り・著作権譲渡型に固定
function suggestTemplate(feeType, prLabel) {
  if (feeType === '成果型') {
    if (!prLabel) return '';
    return prLabel === '無' ? 'PR表記なしUGCパッケージ個別契約書' : 'UGCパッケージ個別契約書（PR表記あり）';
  }
  if (feeType === '予算型') {
    if (!prLabel) return '';
    return 'UGC個別契約書（imp保証）';
  }
  if (feeType === '制作型') return '動画制作・納品個別契約書（買い切り・著作権譲渡型）';
  return '';
}

// 業務委託料の対象媒体（FirstRecallBriefModal.js の MEDIA_OPTIONS と同じ選択肢）
const MEDIA_OPTIONS = ['TikTok', 'Instagram Reels', 'YouTube Shorts', 'X'];
const FEE_TYPE_OPTIONS = ['成果型', '予算型', '制作型'];
const PR_LABEL_OPTIONS = ['有', '無'];

// 業務委託料の合計金額を feeType 別に計算する
// 成果型・予算型は総予算を直接入力してもらう値そのもの（媒体別内訳は単価のみで再生数は持たないため）
function computeTotalAmount(feeType, formData) {
  if (feeType === '成果型' || feeType === '予算型') {
    return Number(formData.budgetAmount) || 0;
  }
  if (feeType === '制作型') {
    return (Number(formData.productionUnitPrice) || 0) * (Number(formData.productionCount) || 0);
  }
  return 0;
}

const formatNumber = (value) => {
  if (!value) return '';
  return new Intl.NumberFormat('ja-JP').format(value);
};

const getInitialFormData = () => ({
  feeType: '',
  prLabel: '', // 成果型・予算型で使用。②詳細確認で確定した値を自動選択する
  mediaBreakdown: [], // 成果型: [{ media, cpv }]（媒体ごとの再生単価のみ。目標再生数は持たない）
  guaranteedImp: '', // 予算型（広告モデル）
  guaranteedPosts: '', // 予算型
  adTargetMedia: [], // 予算型
  budgetAmount: '', // 成果型・予算型共通の総予算
  productionUnitPrice: '', // 制作型
  productionCount: '', // 制作型
  clientLegalName: '',
  clientAddress: '',
  clientRepresentative: '',
  projectName: '',
  periodStart: '',
  periodEnd: '',
  basicContractSigned: false,
  note: '',
});

const sendContractRequestToGas = async (payload) => {
  if (!CONTRACT_REQUEST_GAS_URL) return; // 未デプロイの間はFirestore記録のみ
  try {
    await fetch(CONTRACT_REQUEST_GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('契約締結依頼シートへの送信エラー:', error);
  }
};

function ContractRequestModal({ isOpen, onClose, deal, onSaved }) {
  const [formData, setFormData] = useState(getInitialFormData());
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hearing, setHearing] = useState(null);
  const [loadingContext, setLoadingContext] = useState(false);

  useEffect(() => {
    if (!isOpen || !deal) return;

    let cancelled = false;
    const loadContext = async () => {
      setLoadingContext(true);
      try {
        // firstRecallBriefsは案件単位で複数件ありうるため、dealIdの等値検索のみ行い
        // 複合インデックスを避けてクライアント側で最新の1件に絞る（プロジェクト既存方針に準拠）
        const q = query(collection(db, 'firstRecallBriefs'), where('dealId', '==', deal.id));
        const snapshot = await getDocs(q);
        const briefs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        briefs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        const latestHearing = briefs[0] || null;

        const companySnap = await getDoc(doc(db, 'companies', deal.companyName || ''));
        const basicContractSigned = companySnap.exists() ? !!companySnap.data().basicContractSigned : false;

        if (cancelled) return;
        setHearing(latestHearing);

        const feeType = latestHearing?.conditionType || '';
        // PR表記は②詳細確認で確定済みの値（有/無のみ）を自動選択する。未確定（未回収等）なら空のまま
        const prLabel = PR_LABEL_OPTIONS.includes(latestHearing?.prLabel) ? latestHearing.prLabel : '';

        // feeType別に、ヒアリング値から業務委託料欄の初期値をプリフィルする
        let mediaBreakdown = [];
        let guaranteedImp = '';
        let guaranteedPosts = '';
        let adTargetMedia = [];
        let budgetAmount = '';
        let productionUnitPrice = '';
        let productionCount = '';

        if (feeType === '成果型') {
          // 媒体ごとの再生単価のみ。ヒアリングは媒体別単価を持たないため単価は空欄start、営業が入力する
          const mediaList = latestHearing?.media?.length ? latestHearing.media : [];
          mediaBreakdown = mediaList.map((m) => ({ media: m, cpv: '' }));
          budgetAmount = latestHearing?.totalBudget ? String(latestHearing.totalBudget) : '';
        } else if (feeType === '予算型') {
          adTargetMedia = latestHearing?.media || [];
          budgetAmount = latestHearing?.totalBudget ? String(latestHearing.totalBudget) : '';
          guaranteedImp = latestHearing?.targetViews ? String(latestHearing.targetViews) : '';
        } else if (feeType === '制作型') {
          productionUnitPrice = latestHearing?.productionUnitPrice ? String(latestHearing.productionUnitPrice) : '';
          productionCount = latestHearing?.productionCount ? String(latestHearing.productionCount) : '';
        }

        // 実施期間は①進行スケジュール確認で確定した開始日・終了日にそのまま紐づける
        const scheduleAgreed = latestHearing?.scheduleAgreed || null;

        setFormData({
          ...getInitialFormData(),
          feeType,
          prLabel,
          mediaBreakdown,
          guaranteedImp,
          guaranteedPosts,
          adTargetMedia,
          budgetAmount,
          productionUnitPrice,
          productionCount,
          projectName: deal.productName ? `「${deal.productName}」SNSプロモーション業務` : '',
          periodStart: scheduleAgreed?.startDate || '',
          periodEnd: scheduleAgreed?.endDate || '',
          basicContractSigned,
        });
      } catch (error) {
        console.error('契約締結依頼: ヒアリング情報の取得に失敗しました', error);
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
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    clearError(name);
  };

  // 成果型: 媒体チェックボックスのON/OFFで mediaBreakdown の行を増減する
  const handleMediaBreakdownToggle = (media) => {
    setFormData((prev) => {
      const exists = prev.mediaBreakdown.some((row) => row.media === media);
      const mediaBreakdown = exists
        ? prev.mediaBreakdown.filter((row) => row.media !== media)
        : [...prev.mediaBreakdown, { media, cpv: '' }];
      return { ...prev, mediaBreakdown };
    });
    clearError('mediaBreakdown');
  };

  const handleMediaBreakdownFieldChange = (media, field, value) => {
    setFormData((prev) => ({
      ...prev,
      mediaBreakdown: prev.mediaBreakdown.map((row) => (row.media === media ? { ...row, [field]: value } : row)),
    }));
    clearError('mediaBreakdown');
  };

  // 予算型（広告モデル）: 対象媒体の複数選択
  const handleAdTargetMediaToggle = (media) => {
    setFormData((prev) => {
      const exists = prev.adTargetMedia.includes(media);
      return {
        ...prev,
        adTargetMedia: exists ? prev.adTargetMedia.filter((m) => m !== media) : [...prev.adTargetMedia, media],
      };
    });
    clearError('adTargetMedia');
  };

  const isPartner = !!(deal.introducer && deal.introducer.trim());
  const contractType = isPartner ? `パートナー経由（${deal.introducer}）` : '直';

  const totalAmount = computeTotalAmount(formData.feeType, formData);
  // 契約雛形はユーザーに選ばせず、課金タイプ・PR表記から裏側で自動決定する
  const computedTemplate = suggestTemplate(formData.feeType, formData.prLabel);
  const needsPrLabel = formData.feeType === '成果型' || formData.feeType === '予算型';

  const validateForm = () => {
    const newErrors = {};
    if (!formData.feeType) newErrors.feeType = '課金タイプを選択してください';
    if (needsPrLabel && !PR_LABEL_OPTIONS.includes(formData.prLabel)) {
      newErrors.prLabel = 'PR表記の有無を選択してください';
    }
    if (!formData.clientLegalName.trim()) newErrors.clientLegalName = '甲の正式社名は必須です';
    if (!formData.clientRepresentative.trim()) newErrors.clientRepresentative = '甲の代表者名は必須です';
    if (!formData.periodStart) newErrors.periodStart = '開始日は必須です（①進行スケジュール確認で確定してください）';

    if (formData.feeType === '成果型') {
      if (formData.mediaBreakdown.length === 0) {
        newErrors.mediaBreakdown = '対象媒体を1つ以上選択してください';
      } else if (formData.mediaBreakdown.some((row) => !row.cpv)) {
        newErrors.mediaBreakdown = '各媒体の再生単価を入力してください';
      }
      if (!formData.budgetAmount) newErrors.budgetAmount = '総予算を入力してください';
    } else if (formData.feeType === '予算型') {
      if (!formData.adTargetMedia.length) newErrors.adTargetMedia = '対象媒体を1つ以上選択してください';
      if (!formData.budgetAmount) newErrors.budgetAmount = '総予算を入力してください';
    } else if (formData.feeType === '制作型') {
      if (!formData.productionUnitPrice) newErrors.productionUnitPrice = '単価を入力してください';
      if (!formData.productionCount) newErrors.productionCount = '本数を入力してください';
    }

    if (formData.feeType && totalAmount <= 0) {
      newErrors.amount = '正しい金額になるよう各項目を入力してください';
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
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      // feeType別の内訳（該当しないパターンはnull）
      const feeBreakdown = {
        mediaBreakdown: formData.feeType === '成果型'
          ? formData.mediaBreakdown.map((row) => ({
              media: row.media,
              cpv: Number(row.cpv) || 0,
            }))
          : null,
        adModel: formData.feeType === '予算型'
          ? {
              guaranteedImp: Number(formData.guaranteedImp) || 0,
              guaranteedPosts: Number(formData.guaranteedPosts) || 0,
              targetMedia: formData.adTargetMedia,
              budgetAmount: Number(formData.budgetAmount) || 0,
            }
          : null,
        production: formData.feeType === '制作型'
          ? {
              unitPrice: Number(formData.productionUnitPrice) || 0,
              count: Number(formData.productionCount) || 0,
            }
          : null,
      };

      // スプレッドシート(GAS連携)向けに、媒体別内訳をネストなしの読みやすい文字列にもしておく
      const feeBreakdownText = formData.feeType === '成果型'
        ? formData.mediaBreakdown.map((row) => `${row.media}:${row.cpv}円/再生`).join('; ')
        : '';

      const payload = {
        dealId: deal.id,
        companyName: deal.companyName || '',
        contractType,
        basicContractNeeded: !formData.basicContractSigned,
        template: computedTemplate,
        conditionType: formData.feeType,
        projectName: formData.projectName,
        periodStart: formData.periodStart,
        periodEnd: formData.periodEnd,
        totalAmount,
        feeBreakdown,
        feeBreakdownText,
        prLabel: needsPrLabel ? formData.prLabel : '',
        media: hearing?.media || [],
        clientLegalName: formData.clientLegalName,
        clientAddress: formData.clientAddress,
        clientRepresentative: formData.clientRepresentative,
        requestedBy: deal.representative || '',
        note: formData.note,
        status: 'requested',
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'contractRequests'), payload);

      // ③契約締結依頼の送信をもって firstRecallContractStatus を 'requested' に進める。
      // このモーダル自体が①②③(第一想起)専用フローからしか開けないため、proposalMenuでの追加判定は不要
      // （proposalMenuはほとんどの既存案件で未設定のため、判定に使うと機能しない）
      const dashRef = doc(db, 'progressDashboard', deal.id);
      const dashSnap = await getDoc(dashRef);
      const dashData = dashSnap.exists() ? dashSnap.data() : {};

      const dashUpdates = {
        firstRecallContractStatus: 'requested',
        contractRequestedAt: serverTimestamp(),
      };
      const shouldAdvancePhase = dashData.status !== 'フェーズ7' && dashData.status !== 'フェーズ8';
      if (shouldAdvancePhase) {
        dashUpdates.status = 'フェーズ7';
      }
      await updateProject(deal.id, dashUpdates);

      if (shouldAdvancePhase) {
        // salesRecords側のphaseも合わせて更新する（ProjectDetailPanelの起動時同期ロジックが
        // salesRecords.phaseを正としてprogressDashboard.statusを巻き戻してしまうのを防ぐため）
        const subCol = resolveSalesSubCol(deal);
        const recordId = await getLatestRecordId(deal.id, subCol, dashData.status || '');
        await updateSalesRecord(deal.id, recordId, { phase: 'フェーズ7' }, subCol);
      }

      // 営業の自己申告で基本契約の締結有無を更新（法務確認前の暫定値）
      if (deal.companyName) {
        await setDoc(
          doc(db, 'companies', deal.companyName),
          { companyName: deal.companyName, basicContractSigned: formData.basicContractSigned },
          { merge: true }
        );
      }

      await sendContractRequestToGas(payload);

      if (onSaved) onSaved();
      setFormData(getInitialFormData());
      setErrors({});
      onClose();
    } catch (error) {
      console.error('契約締結依頼の送信エラー:', error);
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
            <FiFileText />
            契約締結依頼
          </ModalTitle>
          <CloseButton onClick={handleCancel}><FiX /></CloseButton>
        </ModalHeader>

        {loadingContext && <HintBox>ヒアリング内容を読み込み中...</HintBox>}
        {!loadingContext && !hearing && (
          <HintBox>この案件の第一想起ヒアリング内容が見つかりませんでした。雛形・金額は手動で入力してください。</HintBox>
        )}

        <Form onSubmit={handleSubmit}>
          <SectionTitle>契約形態</SectionTitle>
          <FormGroup>
            <Label>契約形態</Label>
            <Input type="text" value={contractType} disabled />
          </FormGroup>

          <FormGroup>
            <CheckboxLabel>
              <input
                type="checkbox"
                name="basicContractSigned"
                checked={formData.basicContractSigned}
                onChange={handleInputChange}
                disabled={isSubmitting}
              />
              基本契約は締結済み（未チェックの場合、基本契約も同時に締結依頼対象に含めます）
            </CheckboxLabel>
          </FormGroup>

          <SectionTitle>個別契約</SectionTitle>

          <FormGroup>
            <Label>課金タイプ *</Label>
            <Select
              name="feeType"
              value={formData.feeType}
              onChange={handleInputChange}
              className={errors.feeType ? 'error' : ''}
              disabled={isSubmitting}
            >
              <option value="">選択してください</option>
              {FEE_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </Select>
            {errors.feeType && <ErrorMessage>{errors.feeType}</ErrorMessage>}
          </FormGroup>

          {needsPrLabel && (
            <FormGroup>
              <Label>PR表記の有無 *（②詳細確認の確定値から自動選択。必要なら変更可）</Label>
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
          )}

          <HintBox>
            契約雛形（課金タイプ・PR表記から自動決定）: <strong>{computedTemplate || '（課金タイプを選択してください）'}</strong>
          </HintBox>

          <FormGroup>
            <Label>案件名</Label>
            <Input
              type="text"
              name="projectName"
              value={formData.projectName}
              onChange={handleInputChange}
              disabled={isSubmitting}
            />
          </FormGroup>

          <Row>
            <FormGroup>
              <Label>実施期間（開始日）*（①進行スケジュール確認の開始日と連動）</Label>
              <Input
                type="date"
                name="periodStart"
                value={formData.periodStart}
                disabled
                className={errors.periodStart ? 'error' : ''}
              />
              {errors.periodStart && <ErrorMessage>{errors.periodStart}</ErrorMessage>}
            </FormGroup>
            <FormGroup>
              <Label>実施期間（終了日）（①進行スケジュール確認の終了日と連動）</Label>
              <Input
                type="date"
                name="periodEnd"
                value={formData.periodEnd}
                disabled
              />
            </FormGroup>
          </Row>
          {!formData.periodStart && (
            <HintBox>①進行スケジュール確認がまだ完了していないため、開始日が反映されていません。</HintBox>
          )}

          {formData.feeType === '成果型' && (
            <FormGroup>
              <Label>業務委託料（円）* — 媒体ごとの再生単価と総予算</Label>
              <CheckboxRow>
                {MEDIA_OPTIONS.map((media) => (
                  <CheckboxLabel key={media}>
                    <input
                      type="checkbox"
                      checked={formData.mediaBreakdown.some((row) => row.media === media)}
                      onChange={() => handleMediaBreakdownToggle(media)}
                      disabled={isSubmitting}
                    />
                    {media}
                  </CheckboxLabel>
                ))}
              </CheckboxRow>

              {formData.mediaBreakdown.map((row) => (
                <MediaRow key={row.media} style={{ marginTop: '0.5rem', gridTemplateColumns: '1fr 1fr' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#2c3e50' }}>{row.media}</div>
                  <Input
                    type="number"
                    placeholder="再生単価（円）"
                    value={row.cpv}
                    onChange={(e) => handleMediaBreakdownFieldChange(row.media, 'cpv', e.target.value)}
                    disabled={isSubmitting}
                    min="0"
                    step="0.01"
                  />
                </MediaRow>
              ))}
              {errors.mediaBreakdown && <ErrorMessage>{errors.mediaBreakdown}</ErrorMessage>}

              <FormGroup style={{ marginTop: '0.5rem' }}>
                <Label>総予算（円）</Label>
                <Input
                  type="number"
                  name="budgetAmount"
                  value={formData.budgetAmount}
                  onChange={handleInputChange}
                  className={errors.budgetAmount ? 'error' : ''}
                  disabled={isSubmitting}
                  min="0"
                />
                {errors.budgetAmount && <ErrorMessage>{errors.budgetAmount}</ErrorMessage>}
              </FormGroup>

              <AutoCalcBox style={{ marginTop: '0.5rem' }}>
                総額: {totalAmount ? `${formatNumber(totalAmount)}円` : '-'}
              </AutoCalcBox>
            </FormGroup>
          )}

          {formData.feeType === '予算型' && (
            <FormGroup>
              <Label>業務委託料（円）* — 広告モデル（imp保証）</Label>
              <Row>
                <FormGroup>
                  <Label>保証投稿数（本）</Label>
                  <Input
                    type="number"
                    name="guaranteedPosts"
                    value={formData.guaranteedPosts}
                    onChange={handleInputChange}
                    disabled={isSubmitting}
                    min="0"
                  />
                </FormGroup>
                <FormGroup>
                  <Label>保証インプレッション数</Label>
                  <Input
                    type="number"
                    name="guaranteedImp"
                    value={formData.guaranteedImp}
                    onChange={handleInputChange}
                    disabled={isSubmitting}
                    min="0"
                  />
                </FormGroup>
              </Row>
              <Label style={{ marginTop: '0.5rem' }}>対象媒体</Label>
              <CheckboxRow>
                {MEDIA_OPTIONS.map((media) => (
                  <CheckboxLabel key={media}>
                    <input
                      type="checkbox"
                      checked={formData.adTargetMedia.includes(media)}
                      onChange={() => handleAdTargetMediaToggle(media)}
                      disabled={isSubmitting}
                    />
                    {media}
                  </CheckboxLabel>
                ))}
              </CheckboxRow>
              {errors.adTargetMedia && <ErrorMessage>{errors.adTargetMedia}</ErrorMessage>}

              <FormGroup style={{ marginTop: '0.5rem' }}>
                <Label>総予算（円）</Label>
                <Input
                  type="number"
                  name="budgetAmount"
                  value={formData.budgetAmount}
                  onChange={handleInputChange}
                  className={errors.budgetAmount ? 'error' : ''}
                  disabled={isSubmitting}
                  min="0"
                />
                {errors.budgetAmount && <ErrorMessage>{errors.budgetAmount}</ErrorMessage>}
              </FormGroup>
              <AutoCalcBox style={{ marginTop: '0.5rem' }}>
                総額: {totalAmount ? `${formatNumber(totalAmount)}円` : '-'}
              </AutoCalcBox>
            </FormGroup>
          )}

          {formData.feeType === '制作型' && (
            <FormGroup>
              <Label>業務委託料（円）* — 制作単価×本数</Label>
              <Row>
                <FormGroup>
                  <Label>制作単価（円）</Label>
                  <Input
                    type="number"
                    name="productionUnitPrice"
                    value={formData.productionUnitPrice}
                    onChange={handleInputChange}
                    className={errors.productionUnitPrice ? 'error' : ''}
                    disabled={isSubmitting}
                    min="0"
                  />
                  {errors.productionUnitPrice && <ErrorMessage>{errors.productionUnitPrice}</ErrorMessage>}
                </FormGroup>
                <FormGroup>
                  <Label>本数</Label>
                  <Input
                    type="number"
                    name="productionCount"
                    value={formData.productionCount}
                    onChange={handleInputChange}
                    className={errors.productionCount ? 'error' : ''}
                    disabled={isSubmitting}
                    min="0"
                  />
                  {errors.productionCount && <ErrorMessage>{errors.productionCount}</ErrorMessage>}
                </FormGroup>
              </Row>
              <AutoCalcBox style={{ marginTop: '0.5rem' }}>
                総額: {totalAmount ? `${formatNumber(totalAmount)}円` : '-'}
              </AutoCalcBox>
            </FormGroup>
          )}
          {errors.amount && <ErrorMessage>{errors.amount}</ErrorMessage>}

          <SectionTitle>甲（クライアント）情報</SectionTitle>

          <FormGroup>
            <Label>正式社名 *</Label>
            <Input
              type="text"
              name="clientLegalName"
              value={formData.clientLegalName}
              onChange={handleInputChange}
              placeholder="例：株式会社◯◯"
              className={errors.clientLegalName ? 'error' : ''}
              disabled={isSubmitting}
            />
            {errors.clientLegalName && <ErrorMessage>{errors.clientLegalName}</ErrorMessage>}
          </FormGroup>

          <FormGroup>
            <Label>住所</Label>
            <Input
              type="text"
              name="clientAddress"
              value={formData.clientAddress}
              onChange={handleInputChange}
              disabled={isSubmitting}
            />
          </FormGroup>

          <FormGroup>
            <Label>代表者名 *</Label>
            <Input
              type="text"
              name="clientRepresentative"
              value={formData.clientRepresentative}
              onChange={handleInputChange}
              className={errors.clientRepresentative ? 'error' : ''}
              disabled={isSubmitting}
            />
            {errors.clientRepresentative && <ErrorMessage>{errors.clientRepresentative}</ErrorMessage>}
          </FormGroup>

          <FormGroup>
            <Label>備考（法務への申し送り事項）</Label>
            <TextArea
              name="note"
              value={formData.note}
              onChange={handleInputChange}
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
              {isSubmitting ? '送信中...' : '締結依頼を送信'}
            </Button>
          </ButtonGroup>
        </Form>
      </ModalContent>
    </ModalOverlay>
  );
}

export default ContractRequestModal;
