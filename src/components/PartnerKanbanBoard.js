import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { FiUser, FiCalendar, FiTag } from 'react-icons/fi';
import { useLocation, useNavigate } from 'react-router-dom';
import { STATUS_ORDER, STATUS_COLORS } from '../data/constants.js';
import { db } from '../firebase.js';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import ReceivedOrderModal from './ReceivedOrderModal.js';
import { updateDealOrderInfo } from '../services/salesService.js';

const KanbanContainer = styled.div`
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem;
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

const CompanyBadge = styled.div`
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: 600;
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
  margin: 0 0 0.5rem 0;
  color: #2c3e50;
  font-size: 0.9rem;
  font-weight: 600;
`;

const CardInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.25rem;
  color: #666;
  font-size: 0.8rem;
`;

const CardMeta = styled.div`
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid #eee;
  font-size: 0.75rem;
  color: #999;
`;

const UrgentBadge = styled.span`
  background: #e74c3c;
  color: white;
  padding: 0.125rem 0.375rem;
  border-radius: 8px;
  font-size: 0.7rem;
  margin-left: 0.5rem;
`;

function ClickableCard({ deal }) {
  const navigate = useNavigate();

  const isUrgent = (dateString) => {
    if (!dateString) return false;
    const nextActionDate = new Date(dateString);
    const today = new Date();
    const oneWeekFromToday = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    return nextActionDate <= oneWeekFromToday;
  };

  const handleCardClick = () => {
    navigate(`/partner-entry/piala/product/${deal.id}`);
  };

  return (
    <Card
      status={deal.status}
      onClick={handleCardClick}
    >
      <CardTitle>{deal.productName}</CardTitle>
      
      <CardInfo>
        <FiTag />
        {deal.proposalMenu}
      </CardInfo>
      
      <CardInfo>
        <FiUser />
        {deal.partnerRepresentative || deal.representative || '-'}
      </CardInfo>
      
      {deal.lastContactDate && (
        <CardInfo>
          <FiCalendar />
          最終接触: {deal.lastContactDate}
        </CardInfo>
      )}
      
      {deal.nextAction && (
        <CardInfo>
          次回: {deal.nextAction}
          {deal.nextActionDate && isUrgent(deal.nextActionDate) && (
            <UrgentBadge>急</UrgentBadge>
          )}
        </CardInfo>
      )}
      
      <CardMeta>
        {deal.introducer}
      </CardMeta>
    </Card>
  );
}

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
          <ClickableCard key={deal.id} deal={deal} />
        ))}
      </CardContainer>
    </Column>
  );
}

function PartnerKanbanBoard() {
  const [deals, setDeals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [receivedOrderModal, setReceivedOrderModal] = useState({ show: false, deal: null });
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const location = useLocation();
  
  // パートナー会社を判定
  const getPartnerCompany = () => {
    const path = window.location.pathname;
    if (path.startsWith('/partner-entry/piala')) {
      return '株式会社ピアラ';
    }
    return null;
  };
  
  const partnerCompany = getPartnerCompany();
  
  // Firestoreから進捗データを取得（パートナー会社の案件のみ）
  const fetchProgressData = useCallback(async () => {
    if (!partnerCompany) return;
    
    try {
      setIsLoading(true);
      console.log('📊 パートナーカンバン: データ取得開始');
      
      const progressRef = collection(db, 'progressDashboard');
      const q = query(progressRef, orderBy('updatedAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const progressItems = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        
        // 厳格にパートナー会社の案件のみを抽出（他社データ混入防止）
        if (data.introducer === partnerCompany) {
          progressItems.push({
            id: docSnap.id,
            ...data,
            lastContactDate: data.lastContactDate?.toDate?.()?.toLocaleDateString('ja-JP') || 
                            data.lastContactDate || null,
            nextActionDate: data.nextActionDate || null,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null
          });
        }
      });
      
      console.log('✅ パートナーカンバン: データ取得成功:', progressItems.length, '件');
      setDeals(progressItems);
    } catch (error) {
      console.error('💥 パートナーカンバン: データ取得エラー:', error);
      setDeals([]);
    } finally {
      setIsLoading(false);
    }
  }, [partnerCompany]);
  
  useEffect(() => {
    fetchProgressData();
  }, [fetchProgressData]);
  
  // ページがフォーカスされた時に自動リロード（過度な再読み込みを防ぐため削除）
  // useEffect(() => {
  //   const handleVisibilityChange = () => {
  //     if (!document.hidden) {
  //       console.log('🔄 パートナーカンバン: ページがアクティブになったため、データを再取得');
  //       fetchProgressData();
  //     }
  //   };
  //   
  //   const handleFocus = () => {
  //     console.log('🔄 パートナーカンバン: ウィンドウがフォーカスされたため、データを再取得');
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
  // }, [fetchProgressData]);
  
  // ルート変更時にもデータを再取得（過度な再読み込みを防ぐため削除）
  // useEffect(() => {
  //   console.log('🔄 パートナーカンバン: ルート変更検知、データ再取得');
  //   fetchProgressData();
  // }, [location.pathname, fetchProgressData]);

  
  // 受注情報保存処理
  const handleSaveReceivedOrder = async (orderData) => {
    try {
      setIsSavingOrder(true);
      console.log('💾 パートナーカンバン受注情報保存開始:', orderData);
      
      // salesService経由で受注情報を保存
      // 実施月はモーダルの受注日（YYYY-MM-DD）から導出する（旧モーダルのreceivedOrderMonthは現行では渡されない）
      await updateDealOrderInfo(
        orderData.dealId,
        orderData.receivedOrderMonth || (orderData.receivedOrderDate || '').slice(0, 7),
        orderData.receivedOrderAmount
      );
      
      console.log('✅ パートナーカンバン受注情報保存成功');
      
      // データを再取得してUI更新
      await fetchProgressData();
      
      // モーダルを閉じる
      setReceivedOrderModal({ show: false, deal: null });
      
      // 成功メッセージ
      alert('受注情報が保存されました');
      
    } catch (error) {
      console.error('💥 パートナーカンバン受注情報保存エラー:', error);
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
        <div>
          <CompanyBadge>{partnerCompany}</CompanyBadge>
          <Title>案件カンバンボード</Title>
        </div>
      </Header>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#7f8c8d' }}>
          データを読み込み中...
        </div>
      ) : (
      <BoardContainer>
        {STATUS_ORDER.map(status => {
          // パートナー画面の場合は該当するパートナー会社の案件のみフィルタリング
          const filteredDeals = partnerCompany 
            ? deals.filter(deal => deal.introducer === partnerCompany)
            : deals;
          
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

export default PartnerKanbanBoard;