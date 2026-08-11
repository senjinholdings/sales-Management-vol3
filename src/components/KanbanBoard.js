import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { FiUser, FiCalendar, FiTag } from 'react-icons/fi';
import { useNavigate, useLocation } from 'react-router-dom';
import { mockDeals, introducers } from '../data/mockData.js';
import { STATUS_ORDER, STATUS_COLORS } from '../data/constants.js';
import { db } from '../firebase.js';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import ReceivedOrderModal from './ReceivedOrderModal.js';
import { updateDealOrderInfo } from '../services/salesService.js';

const KanbanContainer = styled.div`
  max-width: 1400px;
  margin: 0 auto;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
`;

const Title = styled.h2`
  color: #2c3e50;
  margin: 0;
`;

const BoardContainer = styled.div`
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  padding-bottom: 1rem;
`;

const Column = styled.div`
  min-width: 280px;
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1rem;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
`;

const ColumnHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid ${props => props.color};
`;

const ColumnTitle = styled.h3`
  margin: 0;
  color: #2c3e50;
  font-size: 1rem;
  font-weight: 600;
`;

const CardCount = styled.span`
  background: ${props => props.color};
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
`;

const CardContainer = styled.div`
  min-height: 200px;
  padding: 0.5rem 0;
`;

const Card = styled.div`
  background: white;
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 0.75rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  cursor: pointer;
  transition: all 0.3s ease;
  border-left: 4px solid ${props => STATUS_COLORS[props.status]};
  
  &:hover {
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    transform: translateY(-1px);
  }
`;

const CardTitle = styled.h4`
  margin: 0 0 0.75rem 0;
  color: #2c3e50;
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.3;
`;

const CardMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const MetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: #7f8c8d;
`;

const MetaIcon = styled.span`
  display: flex;
  align-items: center;
`;

const UrgentBadge = styled.span`
  background: #e74c3c;
  color: white;
  padding: 0.125rem 0.5rem;
  border-radius: 12px;
  font-size: 0.6rem;
  font-weight: 600;
  margin-top: 0.5rem;
  display: inline-block;
`;

const ProposalTag = styled.span`
  background: #ecf0f1;
  color: #2c3e50;
  padding: 0.125rem 0.5rem;
  border-radius: 12px;
  font-size: 0.6rem;
  font-weight: 500;
  margin-top: 0.5rem;
  display: inline-block;
`;

// クリック可能なカードコンポーネント
function ClickableCard({ deal }) {
  const navigate = useNavigate();


  // 期日が1週間以内かチェック
  const isUrgent = (dateString) => {
    if (!dateString) return false;
    const nextActionDate = new Date(dateString);
    const today = new Date();
    const oneWeekFromToday = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    return nextActionDate <= oneWeekFromToday;
  };

  const handleCardClick = () => {
    navigate(`/product/${deal.id}`);
  };

  return (
    <Card
      status={deal.status}
      onClick={handleCardClick}
    >
      <CardTitle>{deal.productName}</CardTitle>
      <CardMeta>
        <MetaRow>
          <MetaIcon><FiUser size={12} /></MetaIcon>
          担当: {/* Ver 2.2: 担当者の併記表示（社内／パートナー） */}
          {deal.representative && deal.partnerRepresentative ? (
            // 両方存在する場合は併記
            `${deal.representative}（社内）／${deal.partnerRepresentative}（${deal.introducer?.replace('株式会社', '') || 'パートナー'}）`
          ) : deal.representative ? (
            // 社内担当者のみ
            `${deal.representative}（社内）`
          ) : deal.partnerRepresentative ? (
            // パートナー担当者のみ
            `${deal.partnerRepresentative}（${deal.introducer?.replace('株式会社', '') || 'パートナー'}）`
          ) : (
            // どちらもない場合
            '-'
          )}
        </MetaRow>
        <MetaRow>
          <MetaIcon><FiUser size={12} /></MetaIcon>
          紹介: {deal.introducer || '-'}
        </MetaRow>
        <MetaRow>
          <MetaIcon><FiCalendar size={12} /></MetaIcon>
          最終接触: {deal.lastContactDate}
        </MetaRow>
        {deal.nextAction && (
          <MetaRow>
            <MetaIcon><FiTag size={12} /></MetaIcon>
            {deal.nextAction}
            {deal.nextActionDate && ` (${deal.nextActionDate})`}
          </MetaRow>
        )}
      </CardMeta>
      <ProposalTag>{deal.proposalMenu}</ProposalTag>
      {deal.nextActionDate && isUrgent(deal.nextActionDate) && (
        <UrgentBadge>急</UrgentBadge>
      )}
    </Card>
  );
}

// ステータス別カラムコンポーネント
function StatusColumn({ status, deals }) {
  const statusColor = STATUS_COLORS[status] || '#95a5a6';
  const statusDeals = deals.filter(deal => deal.status === status);

  return (
    <Column>
      <ColumnHeader color={statusColor}>
        <ColumnTitle>{status}</ColumnTitle>
        <CardCount color={statusColor}>{statusDeals.length}</CardCount>
      </ColumnHeader>
      <CardContainer>
        {statusDeals.map(deal => (
          <ClickableCard
            key={deal.id}
            deal={deal}
          />
        ))}
      </CardContainer>
    </Column>
  );
}

function KanbanBoard() {
  const [deals, setDeals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [receivedOrderModal, setReceivedOrderModal] = useState({ show: false, deal: null });
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const location = useLocation();
  
  // パートナー向けかどうかを判定
  const isPartnerView = window.location.pathname.startsWith('/partner') || 
                       window.location.pathname.startsWith('/partner-entry');
  
  // パートナー会社を判定
  const getPartnerCompany = () => {
    const path = window.location.pathname;
    if (path.startsWith('/partner-entry/piala')) {
      return '株式会社ピアラ';
    }
    return null;
  };
  
  const partnerCompany = getPartnerCompany();
  
  const fetchProgressData = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('📊 KanbanBoard: Firestoreから進捗データ取得開始');
      
      const progressRef = collection(db, 'progressDashboard');
      const q = query(progressRef, orderBy('updatedAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const progressItems = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        progressItems.push({
          id: docSnap.id,
          ...data,
          // 日付フィールドの統一処理
          lastContactDate: data.lastContactDate?.toDate?.()?.toLocaleDateString('ja-JP') || 
                          data.lastContactDate || null,
          nextActionDate: data.nextActionDate || null,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null
        });
      });
      
      // 既存案件側の複製レコードを除外（新規側を正とする）
      const filteredItems = progressItems.filter(d => d.isExistingProject !== true);

      console.log('✅ KanbanBoard: 進捗データ取得成功:', filteredItems.length, '件 (除外:', progressItems.length - filteredItems.length, '件)');
      setDeals(filteredItems);
    } catch (error) {
      console.error('💥 KanbanBoard: 進捗データ取得エラー:', error);
      // エラー時はモックデータを使用
      setDeals(mockDeals);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Firebaseから進捗データを取得
  useEffect(() => {
    fetchProgressData();
  }, [fetchProgressData]);
  
  // ページがフォーカスされた時に自動リロード（過度な再読み込みを防ぐため削除）
  // useEffect(() => {
  //   const handleVisibilityChange = () => {
  //     if (!document.hidden) {
  //       console.log('🔄 KanbanBoard: ページがアクティブになったため、データを再取得');
  //       fetchProgressData();
  //     }
  //   };
  //   
  //   const handleFocus = () => {
  //     console.log('🔄 KanbanBoard: ウィンドウがフォーカスされたため、データを再取得');
  //     fetchProgressData();
  //   };
  //   
  //   document.addEventListener('visibilitychange', handleVisibilityChange);
  //   window.addEventListener('focus', handleFocus);
  //   
  //   return () => {
  //     document.removeEventListener('visibilitychange', handleVisibilityChange);
  //     window.removeEventListener('focus', handleFocus);
  //   };
  // }, []);
  
  // ルート変更時にもデータを再取得（過度な再読み込みを防ぐため削除）
  // useEffect(() => {
  //   console.log('🔄 KanbanBoard: ルート変更検知、データ再取得');
  //   fetchProgressData();
  // }, [location.pathname]);

  
  // 受注情報保存処理
  const handleSaveReceivedOrder = async (orderData) => {
    try {
      setIsSavingOrder(true);
      console.log('💾 KanbanBoard受注情報保存開始:', orderData);
      
      // salesService経由で受注情報を保存
      // 実施月はモーダルの受注日（YYYY-MM-DD）から導出する（旧モーダルのreceivedOrderMonthは現行では渡されない）
      await updateDealOrderInfo(
        orderData.dealId,
        orderData.receivedOrderMonth || (orderData.receivedOrderDate || '').slice(0, 7),
        orderData.receivedOrderAmount
      );
      
      console.log('✅ KanbanBoard受注情報保存成功');
      
      // データを再取得してUI更新
      await fetchProgressData();
      
      // モーダルを閉じる
      setReceivedOrderModal({ show: false, deal: null });
      
      // 成功メッセージ
      alert('受注情報が保存されました');
      
    } catch (error) {
      console.error('💥 KanbanBoard受注情報保存エラー:', error);
      alert('受注情報の保存に失敗しました: ' + error.message);
    } finally {
      setIsSavingOrder(false);
    }
  };
  
  // 受注モーダルのキャンセル処理
  const handleCancelReceivedOrder = () => {
    setReceivedOrderModal({ show: false, deal: null });
  };

  return (
    <KanbanContainer>
      <Header>
        <Title>ステータス別看板</Title>
      </Header>
      
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#7f8c8d' }}>
          データを読み込み中...
        </div>
      ) : (
      <BoardContainer>
        {STATUS_ORDER.map(status => {
          // パートナー会社の場合のフィルタリング
          const filteredDeals = isPartnerView && partnerCompany 
            ? deals.filter(deal => {
                // 紹介者名で絞り込み
                const getIntroducerName = (introducerId) => {
                  const introducer = introducers.find(i => i.id === introducerId);
                  return introducer ? introducer.name : '';
                };
                
                return (deal.introducer === partnerCompany) || 
                       (getIntroducerName(deal.introducerId) === partnerCompany);
              })
            : deals.filter(deal => {
                // 管理者画面では「他社案件」を非表示
                return deal.proposalMenu !== '他社案件';
              });
          
          return (
            <StatusColumn
              key={status}
              status={status}
              deals={filteredDeals}
            />
          );
        })}
      </BoardContainer>
      )}
      
      {/* 受注情報入力モーダル */}
      <ReceivedOrderModal
        isOpen={receivedOrderModal.show}
        onClose={handleCancelReceivedOrder}
        onSave={handleSaveReceivedOrder}
        deal={receivedOrderModal.deal}
        isLoading={isSavingOrder}
      />
    </KanbanContainer>
  );
}

export default KanbanBoard; 