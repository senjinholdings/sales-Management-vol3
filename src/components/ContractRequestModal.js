import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { FiFileText, FiX } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, getDocs, query, where } from 'firebase/firestore';
import ContractRequestsSection from './ContractRequestsSection.js';
import { markContractRequested, markContractSigned } from '../utils/contractRequestSync.js';

// 契約締結依頼の画面。account-sales-boardの「契約書」タブ(ContractRequestsSection)と同じ中身を
// モーダルで開く。開く場所は2か所で、どちらもこの同じ画面を使う:
//  - 第一想起の「契約締結依頼」ボタン（①②の確認が済んだ案件）… source="firstRecall"
//  - 受注情報の入力（ReceivedOrderModal）で「続けて契約締結依頼を出す」を選んだとき … source="order"
//
// 以前の③はここで課金タイプ・金額などを専用の入力欄で集め、スプレッドシート連携(GAS)に送るだけで
// 契約書チームには届いていなかった。今は雛形（マスター管理 → 契約書管理）を選び、雛形の入力項目に
// 値を入れて記入済み契約書を作り、依頼文をSlackの契約書チームに送る（account-sales-boardと同じ）。
// 第一想起のヒアリング内容は、雛形の入力項目の初期値として使う（項目名が一致するものだけ）。

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  z-index: 2000;
  padding: 2rem 1rem;
  overflow-y: auto;
`;

const Card = styled.div`
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 760px;
  padding: 1.5rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid #f8f9fa;
`;

const Title = styled.h3`
  margin: 0;
  color: #8e44ad;
  font-size: 1.15rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 1.4rem;
  color: #95a5a6;
  cursor: pointer;
  &:hover { color: #7f8c8d; }
`;

const Hint = styled.div`
  font-size: 0.8rem;
  color: #6b7280;
  background: #f9fafb;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
`;

const formatJaDate = (value) => {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : '';
};

const yen = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('ja-JP')}円` : '';
};

/**
 * 案件と第一想起のヒアリング内容から、雛形の入力項目の初期値を作る（項目名→値）。
 * 項目名は契約書管理の「よく使う項目」に合わせてある。雛形にその項目が無ければ使われないだけ。
 */
const buildPrefill = (deal, brief) => {
  const prefill = {
    契約相手: deal.companyName || '',
    会社名: deal.companyName || '',
    プロモーション対象: deal.productName || '',
    案件名: deal.productName ? `「${deal.productName}」SNSプロモーション業務` : '',
  };
  if (brief) {
    const schedule = brief.scheduleAgreed || null;
    if (schedule?.startDate) {
      prefill.実施期間 = `${formatJaDate(schedule.startDate)}〜${formatJaDate(schedule.endDate)}`;
    }
    if (brief.conditionType === '制作型') {
      const total = Number(brief.productionUnitPrice) * Number(brief.productionCount);
      prefill.料金 = yen(total);
    } else {
      prefill.料金 = yen(brief.totalBudget);
    }
    if (brief.conditionType === '予算型' && brief.targetViews) {
      prefill.保証インプレッション数 = String(brief.targetViews);
    }
  }
  return Object.fromEntries(Object.entries(prefill).filter(([, v]) => v));
};

/**
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {Function} props.onClose
 * @param {object} props.deal - 案件
 * @param {Function} [props.onSaved] - 締結依頼を送ったあとに呼ぶ
 * @param {'firstRecall'|'order'} [props.source='firstRecall'] - どこから開いたか
 */
function ContractRequestModal({ isOpen, onClose, deal, onSaved, source = 'firstRecall' }) {
  const [prefill, setPrefill] = useState(null);

  // 第一想起のヒアリング内容（firstRecallBriefs）の最新1件を初期値に使う。
  // 複合インデックスを避けてdealIdの等値検索のみ行い、クライアント側で最新に絞る（既存方針）。
  useEffect(() => {
    if (!isOpen || !deal) return undefined;
    let cancelled = false;
    setPrefill(null);
    (async () => {
      let brief = null;
      try {
        const snapshot = await getDocs(query(collection(db, 'firstRecallBriefs'), where('dealId', '==', deal.id)));
        const briefs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        briefs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        brief = briefs[0] || null;
      } catch (error) {
        console.error('契約締結依頼: ヒアリング情報の取得に失敗しました', error);
      }
      if (!cancelled) setPrefill(buildPrefill(deal, brief));
    })();
    return () => { cancelled = true; };
    // deal自体ではなくdeal?.idに依存させる: 親のリアルタイム購読(onSnapshot)によりdeal propは
    // 同じ案件でも毎回新しいオブジェクト参照で渡ってくるため、入力中に初期値が作り直されないようにする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, deal?.id]);

  if (!isOpen || !deal) return null;

  const handleRequested = async () => {
    try {
      await markContractRequested(deal, { fromFirstRecall: source === 'firstRecall' });
    } catch (error) {
      // 依頼自体はSlackに送れて記録も残っているので、案件側の追従に失敗しても止めない。
      console.error('契約締結依頼: 案件の状態の更新に失敗しました', error);
    }
    if (onSaved) onSaved();
  };

  const handleSigned = async () => {
    try {
      await markContractSigned(deal);
    } catch (error) {
      console.error('契約締結: 案件の状態の更新に失敗しました', error);
    }
  };

  return (
    <Overlay onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>
            <FiFileText />
            契約締結依頼｜{deal.companyName || deal.productName}
          </Title>
          <CloseButton onClick={onClose}><FiX /></CloseButton>
        </Header>
        {source === 'firstRecall' && (
          <Hint>
            第一想起のヒアリング内容（実施期間・料金など）は、雛形の同じ名前の入力項目に初期値として入ります。
            送ると案件はフェーズ7に進み、NA「③契約締結依頼を提出する」は完了になります。
          </Hint>
        )}
        {prefill === null ? (
          <Hint>読み込み中...</Hint>
        ) : (
          <ContractRequestsSection
            deal={deal}
            startWithForm
            prefillByLabel={prefill}
            onRequested={handleRequested}
            onSigned={handleSigned}
          />
        )}
      </Card>
    </Overlay>
  );
}

export default ContractRequestModal;
