import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { FiCalendar, FiDollarSign, FiSave, FiX, FiUser, FiSend } from 'react-icons/fi';
import { fetchAllStaff } from '../services/staffService.js';
import ContractRequestModal from './ContractRequestModal.js';

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
  max-width: 500px;
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
  
  &:hover {
    color: #7f8c8d;
  }
`;

const Form = styled.form`
  display: grid;
  gap: 1.5rem;
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
  font-size: 0.95rem;
`;

const Input = styled.input`
  padding: 0.75rem;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 1rem;
  transition: border-color 0.3s ease;
  
  &:focus {
    outline: none;
    border-color: #27ae60;
    box-shadow: 0 0 0 3px rgba(39, 174, 96, 0.1);
  }
  
  &.error {
    border-color: #e74c3c;
    box-shadow: 0 0 0 3px rgba(231, 76, 60, 0.1);
  }
`;

const Select = styled.select`
  padding: 0.75rem;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 1rem;
  transition: border-color 0.3s ease;
  background: white;

  &:focus {
    outline: none;
    border-color: #27ae60;
    box-shadow: 0 0 0 3px rgba(39, 174, 96, 0.1);
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 1rem;
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
    background: #27ae60;
    color: white;
    
    &:hover {
      background: #219a52;
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(39, 174, 96, 0.3);
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
  margin-bottom: 1rem;
  border-left: 4px solid #27ae60;
`;

const DealText = styled.p`
  margin: 0;
  color: #2c3e50;
  font-weight: 500;
  
  strong {
    color: #27ae60;
  }
`;

const ErrorMessage = styled.div`
  color: #e74c3c;
  font-size: 0.875rem;
  margin-top: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
`;

const SuccessIcon = styled.div`
  color: #27ae60;
  font-size: 2rem;
  text-align: center;
  margin-bottom: 1rem;
`;

function ReceivedOrderModal({
  isOpen,
  onClose,
  onSave,
  deal,
  isLoading = false
}) {
  // 想定予算を初期値として設定
  const getInitialAmount = () => {
    if (deal && deal.expectedBudget) {
      return deal.expectedBudget.toString();
    }
    return '';
  };

  const [formData, setFormData] = useState({
    receivedOrderDate: new Date().toISOString().split('T')[0],
    receivedOrderAmount: getInitialAmount(),
    startDate: '',
    endDate: '',
    salesRep: '',
    operatorRep: '',
  });
  // 受注を確定したあと、そのまま契約締結依頼の画面を開くか。
  // 以前はこのモーダルの中に契約書締結依頼の簡易欄（事業部・連絡グループ・契約内容）があり、
  // Slackに流すだけで記録が残らなかった。今は第一想起の③と同じ契約締結依頼の画面
  // （雛形から記入済み契約書を作ってSlackの契約書チームに送る）を受注の直後に開く。
  const [requestContractAfterSave, setRequestContractAfterSave] = useState(true);
  // 受注確定後に開く契約締結依頼の対象。受注を保存すると親がこのモーダルを閉じて
  // dealを外すことがあるので、開いた時点の案件をここに持っておく。
  const [contractRequestDeal, setContractRequestDeal] = useState(null);
  const [errors, setErrors] = useState({});
  const [staffList, setStaffList] = useState([]);

  // スタッフマスターを取得
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

  // dealが変わったら金額を更新
  useEffect(() => {
    if (deal && deal.expectedBudget) {
      setFormData(prev => ({
        ...prev,
        receivedOrderAmount: deal.expectedBudget.toString()
      }));
    }
  }, [deal]);

  const contractRequestModal = (
    <ContractRequestModal
      isOpen={!!contractRequestDeal}
      onClose={() => setContractRequestDeal(null)}
      deal={contractRequestDeal}
      source="order"
      onSaved={() => alert('契約締結依頼を送信しました。')}
    />
  );

  if (!isOpen || !deal) return contractRequestModal;

  // フォーム入力ハンドラー
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // エラーをクリア
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: null
      }));
    }
  };

  // バリデーション
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.receivedOrderDate) {
      newErrors.receivedOrderDate = '受注日は必須です';
    }
    
    if (!formData.receivedOrderAmount) {
      newErrors.receivedOrderAmount = '受注金額は必須です';
    } else if (isNaN(Number(formData.receivedOrderAmount)) || Number(formData.receivedOrderAmount) <= 0) {
      newErrors.receivedOrderAmount = '正の数値を入力してください';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 保存処理
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    try {
      await onSave({
        dealId: deal.id,
        receivedOrderDate: formData.receivedOrderDate,
        receivedOrderAmount: Number(formData.receivedOrderAmount),
        startDate: formData.startDate,
        endDate: formData.endDate,
        salesRep: formData.salesRep,
        operatorRep: formData.operatorRep
      });

      if (requestContractAfterSave) {
        setContractRequestDeal(deal);
      }
    } catch (error) {
      console.error('受注情報保存エラー:', error);
    }
  };

  // キャンセル処理
  const handleCancel = () => {
    setFormData({
      receivedOrderDate: new Date().toISOString().split('T')[0],
      receivedOrderAmount: '',
      startDate: '',
      endDate: '',
      salesRep: '',
      operatorRep: '',
    });
    setErrors({});
    onClose();
  };

  // 金額をフォーマット
  const formatAmount = (amount) => {
    if (!amount) return '';
    return new Intl.NumberFormat('ja-JP').format(amount);
  };

  return (
    <>
    {contractRequestModal}
    <ModalOverlay onClick={handleCancel}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>
            <FiDollarSign />
            受注情報の入力
          </ModalTitle>
          <CloseButton onClick={handleCancel}>
            <FiX />
          </CloseButton>
        </ModalHeader>

        <DealInfo>
          <DealText>
            <strong>{deal.productName}</strong> - {deal.proposalMenu}
          </DealText>
          <DealText style={{ fontSize: '0.9rem', marginTop: '0.25rem', color: '#666' }}>
            この案件を「受注」ステータスに変更します
          </DealText>
        </DealInfo>

        <Form onSubmit={handleSubmit}>
          <FormGroup>
            <Label>
              <FiCalendar />
              受注日 *
            </Label>
            <Input
              type="date"
              name="receivedOrderDate"
              value={formData.receivedOrderDate}
              onChange={handleInputChange}
              className={errors.receivedOrderDate ? 'error' : ''}
              disabled={isLoading}
            />
            {errors.receivedOrderDate && (
              <ErrorMessage>{errors.receivedOrderDate}</ErrorMessage>
            )}
          </FormGroup>

          <FormGroup>
            <Label>
              <FiDollarSign />
              受注金額（円）*
            </Label>
            <Input
              type="number"
              name="receivedOrderAmount"
              value={formData.receivedOrderAmount}
              onChange={handleInputChange}
              placeholder="例：1000000"
              className={errors.receivedOrderAmount ? 'error' : ''}
              disabled={isLoading}
              min="1"
            />
            {errors.receivedOrderAmount && (
              <ErrorMessage>{errors.receivedOrderAmount}</ErrorMessage>
            )}
            {formData.receivedOrderAmount && !errors.receivedOrderAmount && (
              <div style={{ 
                fontSize: '0.9rem', 
                color: '#27ae60', 
                marginTop: '0.25rem',
                fontWeight: '500'
              }}>
                金額: {formatAmount(formData.receivedOrderAmount)}円
              </div>
            )}
          </FormGroup>

          <FormGroup>
            <Label>
              <FiCalendar />
              開始日
            </Label>
            <Input
              type="date"
              name="startDate"
              value={formData.startDate}
              onChange={handleInputChange}
              disabled={isLoading}
            />
          </FormGroup>

          <FormGroup>
            <Label>
              <FiCalendar />
              終了日
            </Label>
            <Input
              type="date"
              name="endDate"
              value={formData.endDate}
              onChange={handleInputChange}
              disabled={isLoading}
            />
          </FormGroup>

          <FormGroup>
            <Label>
              <FiUser />
              営業担当
            </Label>
            <Select
              name="salesRep"
              value={formData.salesRep}
              onChange={handleInputChange}
              disabled={isLoading}
            >
              <option value="">選択してください</option>
              {staffList.filter(s => s.role === 'sales').map(staff => (
                <option key={staff.id} value={staff.name}>{staff.name}</option>
              ))}
            </Select>
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
              disabled={isLoading}
            >
              <option value="">選択してください</option>
              {staffList.filter(s => s.role === 'operator').map(staff => (
                <option key={staff.id} value={staff.name}>{staff.name}</option>
              ))}
            </Select>
          </FormGroup>

          <div style={{ borderTop: '2px solid #e9ecef', paddingTop: '1rem', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: '#3498db', fontWeight: 600 }}>
              <FiSend />
              契約書締結依頼
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={requestContractAfterSave}
                onChange={(e) => setRequestContractAfterSave(e.target.checked)}
                disabled={isLoading}
              />
              受注確定のあと、続けて契約締結依頼を出す
            </label>
            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
              契約書の雛形を選んで記入済み契約書を作り、Slackの契約書チームに依頼を送る画面が開きます。
            </div>
          </div>

          <ButtonGroup>
            <Button
              type="button"
              className="secondary"
              onClick={handleCancel}
              disabled={isLoading}
            >
              <FiX />
              キャンセル
            </Button>
            <Button
              type="submit"
              className="primary"
              disabled={isLoading}
            >
              <FiSave />
              {isLoading ? '保存中...' : '受注確定'}
            </Button>
          </ButtonGroup>
        </Form>
      </ModalContent>
    </ModalOverlay>
    </>
  );
}

export default ReceivedOrderModal;