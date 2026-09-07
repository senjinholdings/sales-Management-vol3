import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { FiSave, FiRefreshCw, FiCalendar, FiUser, FiFileText, FiPlus, FiAlertCircle, FiX, FiZap, FiUpload, FiDownload } from 'react-icons/fi';
import { PROPOSAL_MENUS, PARTNER_PROPOSAL_MENUS, SALES_REPRESENTATIVES, STATUSES, DEPARTMENT_NAMES } from '../data/constants.js';
import { introducers } from '../data/mockData.js';
import { useNavigate, useLocation } from 'react-router-dom';
import { db } from '../firebase.js';
import { collection, addDoc, serverTimestamp, query, where, getDocs, updateDoc, doc, orderBy } from 'firebase/firestore';
import { analyzeMeetingNotes, isGPTServiceAvailable } from '../services/gptService.js';

const LogEntryContainer = styled.div`
  max-width: 800px;
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

const Form = styled.form`
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  position: relative;
`;

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  
  &.full-width {
    grid-column: 1 / -1;
  }
`;

const Label = styled.label`
  font-weight: 600;
  color: #2c3e50;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const Input = styled.input`
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  
  &:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
  }
  
  &:required {
    border-left: 3px solid #e74c3c;
  }
`;

const Select = styled.select`
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  background: white;
  
  &:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
  }
  
  &:required {
    border-left: 3px solid #e74c3c;
  }
`;

const TextArea = styled.textarea`
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  min-height: 120px;
  resize: vertical;
  font-family: inherit;
  
  &:focus {
    outline: none;
    border-color: #3498db;
    box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
  }
  
  &:required {
    border-left: 3px solid #e74c3c;
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 2rem;
`;

const Button = styled.button`
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.3s ease;
  
  &.primary {
    background: #3498db;
    color: white;
    
    &:hover {
      background: #2980b9;
    }
  }
  
  &.secondary {
    background: #95a5a6;
    color: white;
    
    &:hover {
      background: #7f8c8d;
    }
  }
  
  &.success {
    background: #27ae60;
    color: white;
    
    &:hover {
      background: #219a52;
    }
  }
  
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  &.ai-analyze {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    position: relative;
    
    &:hover {
      background: linear-gradient(135deg, #5a6fd8 0%, #6a4190 100%);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }
    
    &:disabled {
      background: #bdc3c7;
      transform: none;
      box-shadow: none;
    }
  }
`;

const SummarySection = styled.div`
  background: #f8f9fa;
  padding: 1rem;
  border-radius: 4px;
  margin-top: 1rem;
  border-left: 4px solid #3498db;
`;

const SummaryTitle = styled.h4`
  margin: 0 0 0.5rem 0;
  color: #2c3e50;
`;


const IntroducerActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const LinkButton = styled.button`
  background: none;
  border: none;
  color: #3498db;
  text-decoration: underline;
  cursor: pointer;
  font-size: 0.875rem;
  
  &:hover {
    color: #2980b9;
  }
`;

const Modal = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background: white;
  padding: 2rem;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
`;

const ModalTitle = styled.h3`
  margin: 0;
  color: #2c3e50;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #95a5a6;
  padding: 0;
  
  &:hover {
    color: #7f8c8d;
  }
`;

const ModalButtonGroup = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
`;

const ErrorMessage = styled.div`
  background: #fee;
  border: 1px solid #f5c6cb;
  color: #721c24;
  padding: 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const SuccessMessage = styled.div`
  background: #d4edda;
  border: 1px solid #c3e6cb;
  color: #155724;
  padding: 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  z-index: 10;
`;

const LoadingSpinner = styled.div`
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

// CSV一括入稿用スタイル
const CSVSection = styled.div`
  background: #f8f9fa;
  border: 2px dashed #dee2e6;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 2rem;
  text-align: center;
`;

const CSVButtons = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
`;

const CSVButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;

  &.upload {
    background: #3498db;
    color: white;

    &:hover {
      background: #2980b9;
    }
  }

  &.download {
    background: #27ae60;
    color: white;

    &:hover {
      background: #219a52;
    }
  }
`;

const HiddenInput = styled.input`
  display: none;
`;

const CSVPreviewTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
  font-size: 0.85rem;

  th, td {
    border: 1px solid #dee2e6;
    padding: 0.5rem;
    text-align: left;
  }

  th {
    background: #e9ecef;
    font-weight: 600;
  }

  tr:nth-child(even) {
    background: #f8f9fa;
  }
`;

const CSVModalContent = styled(ModalContent)`
  max-width: 900px;
  width: 95%;
`;

const CSVResultMessage = styled.div`
  padding: 1rem;
  border-radius: 4px;
  margin-top: 1rem;

  &.success {
    background: #d4edda;
    color: #155724;
  }

  &.error {
    background: #f8d7da;
    color: #721c24;
  }
`;

function LogEntryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  
  // パートナー向けかどうかを判定
  const isPartnerView = window.location.pathname.startsWith('/partner') || 
                       window.location.pathname.startsWith('/partner-entry') ||
                       window.location.search.includes('app=partner');
  
  // パートナー会社を判定
  const getPartnerCompany = () => {
    const path = window.location.pathname;
    if (path.startsWith('/partner-entry/piala')) {
      return '株式会社ピアラ';
    }
    return null;
  };
  
  const partnerCompany = getPartnerCompany();
  
  const [formData, setFormData] = useState({
    companyName: '',
    productName: '',
    proposalMenu: '',
    representative: '',
    leadSource: '',
    introducerId: '',
    actionDate: new Date().toISOString().split('T')[0],
    actionDetails: '',
    nextAction: '',
    nextActionDate: '',
    status: '',
    summary: '',
    sub_department_name: '',
    sub_department_owner: '',
    expectedBudget: ''
  });

  const [introducersList, setIntroducersList] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [submitMessage, setSubmitMessage] = useState({ type: '', text: '' });
  const [showIntroducerModal, setShowIntroducerModal] = useState(false);
  const [introducerFormData, setIntroducerFormData] = useState({
    name: '',
    contactPerson: '',
    email: '',
    memo: '',
    status: 'アクティブ'
  });
  
  // パートナー専用担当者マスター関連のstate
  const [representativesList, setRepresentativesList] = useState([]);
  const [showRepresentativeModal, setShowRepresentativeModal] = useState(false);
  const [representativeFormData, setRepresentativeFormData] = useState({
    name: ''
  });
  
  // 提案メニューマスター関連のstate
  const [proposalMenusList, setProposalMenusList] = useState([]);

  // 流入経路マスター関連のstate
  const [leadSourcesList, setLeadSourcesList] = useState([]);

  // CSV一括入稿関連のstate
  const [showCSVModal, setShowCSVModal] = useState(false);
  const [csvData, setCsvData] = useState([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState(null);

  const fetchIntroducers = useCallback(async () => {
    try {
      console.log('📋 LogEntryPage: 紹介者データをFirestoreから取得開始');
      
      const introducersRef = collection(db, 'introducers');
      const q = query(introducersRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const introducersData = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        introducersData.push({
          id: docSnap.id,
          ...data
        });
      });
      
      console.log('✅ LogEntryPage: 紹介者データ取得成功:', introducersData.length, '件');
      setIntroducersList(introducersData);
    } catch (error) {
      console.error('💥 LogEntryPage: 紹介者データ取得エラー:', error);
      // エラー時はモックデータを使用
      setIntroducersList(introducers);
    }
  }, []);

  // パートナー専用担当者データを取得
  const fetchRepresentatives = useCallback(async () => {
    try {
      console.log('👤 LogEntryPage: 担当者データをFirestoreから取得開始');
      console.log('🏢 LogEntryPage: 対象会社:', partnerCompany);
      
      const representativesRef = collection(db, 'representatives');
      
      // デバッグ用：全件取得
      console.log('📋 LogEntryPage: 全担当者データ確認中...');
      const allQuery = query(representativesRef);
      const allSnapshot = await getDocs(allQuery);
      console.log('📊 LogEntryPage: 全担当者データ:', allSnapshot.size, '件');
      
      // 会社名でフィルタリング
      const q = query(representativesRef, 
        where('companyName', '==', partnerCompany)
      );
      const querySnapshot = await getDocs(q);
      
      const representativesData = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        console.log('✅ LogEntryPage: マッチした担当者:', docSnap.id, data.name);
        representativesData.push({
          id: docSnap.id,
          ...data
        });
      });
      
      console.log('✅ LogEntryPage: 担当者データ取得成功:', representativesData.length, '件');
      setRepresentativesList(representativesData);
    } catch (error) {
      console.error('💥 LogEntryPage: 担当者データ取得エラー:', error);
      console.error('LogEntryPage: エラー詳細:', {
        code: error.code,
        message: error.message
      });
      setRepresentativesList([]);
    }
  }, [partnerCompany]);

  // 提案メニューデータを取得
  const fetchProposalMenus = useCallback(async () => {
    try {
      console.log('📋 LogEntryPage: 提案メニューデータをFirestoreから取得開始');
      
      const menusRef = collection(db, 'proposalMenus');
      // isActiveがtrueのもののみ取得
      const q = query(menusRef, where('isActive', '==', true));
      const querySnapshot = await getDocs(q);
      
      const menusData = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        menusData.push({
          id: docSnap.id,
          ...data
        });
      });
      
      // クライアントサイドでdisplayOrderでソート
      menusData.sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999));
      
      console.log('✅ LogEntryPage: 提案メニューデータ取得成功:', menusData.length, '件');
      setProposalMenusList(menusData);
    } catch (error) {
      console.error('💥 LogEntryPage: 提案メニューデータ取得エラー:', error);
      // エラー時は既存の定数を使用
      const fallbackMenus = isPartnerView ? PARTNER_PROPOSAL_MENUS : PROPOSAL_MENUS;
      setProposalMenusList(fallbackMenus.map((menu, index) => ({
        id: index.toString(),
        name: menu,
        isActive: true
      })));
    }
  }, [isPartnerView]);

  // 流入経路データを取得
  const fetchLeadSources = useCallback(async () => {
    try {
      console.log('📋 LogEntryPage: 流入経路データをFirestoreから取得開始');

      const sourcesRef = collection(db, 'leadSources');
      const q = query(sourcesRef, where('isActive', '==', true));
      const querySnapshot = await getDocs(q);

      const sourcesData = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        sourcesData.push({
          id: docSnap.id,
          ...data
        });
      });

      // クライアントサイドでdisplayOrderでソート
      sourcesData.sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999));

      console.log('✅ LogEntryPage: 流入経路データ取得成功:', sourcesData.length, '件');
      setLeadSourcesList(sourcesData);
    } catch (error) {
      console.error('💥 LogEntryPage: 流入経路データ取得エラー:', error);
      // エラー時はデフォルトの定数から生成
      const { LEAD_SOURCES } = await import('../data/constants.js');
      setLeadSourcesList(LEAD_SOURCES.map((source, index) => ({
        id: index.toString(),
        name: source,
        isActive: true
      })));
    }
  }, []);

  // Firestoreから紹介者データを取得
  useEffect(() => {
    fetchIntroducers();
    fetchProposalMenus();
    fetchLeadSources();
    if (isPartnerView && partnerCompany) {
      fetchRepresentatives();
    }
  }, [isPartnerView, partnerCompany, fetchIntroducers, fetchRepresentatives, fetchProposalMenus, fetchLeadSources]);

  // URLパラメータから事前入力データを取得（編集モード判定も含む）
  const [isEditMode, setIsEditMode] = useState(false);
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const prefillData = {};
    
    if (searchParams.get('companyName')) prefillData.companyName = searchParams.get('companyName');
    if (searchParams.get('productName')) prefillData.productName = searchParams.get('productName');
    if (searchParams.get('proposalMenu')) prefillData.proposalMenu = searchParams.get('proposalMenu');
    if (searchParams.get('representative')) prefillData.representative = searchParams.get('representative');
    if (searchParams.get('leadSource')) prefillData.leadSource = searchParams.get('leadSource');
    if (searchParams.get('introducerId')) {
      const introducerIdStr = searchParams.get('introducerId');
      prefillData.introducerId = introducerIdStr === '0' ? '' : introducerIdStr;
    }
    if (searchParams.get('introducer')) prefillData.introducer = searchParams.get('introducer');
    
    // URLパラメータが存在する場合は編集モード（既存案件への追加）とみなす
    const hasParams = Object.keys(prefillData).length > 0;
    setIsEditMode(hasParams);
    
    if (hasParams) {
      setFormData(prev => ({ ...prev, ...prefillData }));
      
      // 既存案件の部署情報を取得（パートナー画面のみ）
      if (isPartnerView && prefillData.productName && prefillData.proposalMenu) {
        const fetchDealInfo = async () => {
          try {
            const progressRef = collection(db, 'progressDashboard');
            const q = query(
              progressRef,
              where('productName', '==', prefillData.productName),
              where('proposalMenu', '==', prefillData.proposalMenu)
            );
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
              const dealData = querySnapshot.docs[0].data();
              setFormData(prev => ({
                ...prev,
                sub_department_name: dealData.sub_department_name || '',
                sub_department_owner: dealData.sub_department_owner || ''
              }));
            }
          } catch (error) {
            console.error('既存案件の部署情報取得エラー:', error);
          }
        };
        fetchDealInfo();
      }
    }
  }, [location, isPartnerView]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // エラーをクリア
    if (formErrors[name]) {
      setFormErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  // フォームバリデーション
  const validateForm = () => {
    const errors = {};

    if (!formData.companyName.trim()) {
      errors.companyName = '会社名は必須です';
    }

    if (!formData.productName.trim()) {
      errors.productName = '商材名は必須です';
    }

    if (!formData.proposalMenu) {
      errors.proposalMenu = '提案メニューを選択してください';
    }

    // 想定予算は新規登録時のみ必須（編集モードでは入力欄自体が無効化されているため対象外）
    if (!isEditMode) {
      const budgetNum = Number(formData.expectedBudget);
      if (!formData.expectedBudget || !Number.isFinite(budgetNum) || budgetNum <= 0) {
        errors.expectedBudget = '想定予算を入力してください（0円は不可）';
      }
    }

    if (!formData.representative) {
      errors.representative = '対応者を選択してください';
    }

    if (!isPartnerView && !isEditMode && !formData.leadSource) {
      errors.leadSource = '流入経路を選択してください';
    }

    // パートナー選択時のみ紹介者必須
    if (!isPartnerView && !isEditMode && formData.leadSource === 'パートナー' && !formData.introducerId) {
      errors.introducerId = '紹介者を選択してください';
    }

    if (!formData.nextAction.trim()) {
      errors.nextAction = '次回アクションは必須です';
    }

    if (!formData.status) {
      errors.status = 'ステータスを選択してください';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };



  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // バリデーション実行
    if (!validateForm()) {
      setSubmitMessage({
        type: 'error',
        text: '入力内容に不備があります。必須項目を確認してください。'
      });
      return;
    }
    
    try {
      setIsProcessing(true);
      setSubmitMessage({ type: '', text: '' });
      
      console.log('💾 Firestoreにアクションログ保存開始:', formData);
      
      // エラーの詳細を確認するためのログ
      console.log('Firebase app initialized:', db);
      
      const progressRef = collection(db, 'progressDashboard');
      const actionLogsRef = collection(db, 'actionLogs');
      
      // 会社名＋商材名＋提案メニュー＋流入経路をキーとして案件を検索
      const currentLeadSource = isPartnerView ? 'パートナー' : (formData.leadSource || '');
      const dealKey = `${formData.companyName}_${formData.productName}_${formData.proposalMenu}_${currentLeadSource}`;

      // 既存案件をチェック（流入経路も含めて一致を確認）
      const existingDealQuery = query(
        progressRef,
        where('companyName', '==', formData.companyName),
        where('productName', '==', formData.productName),
        where('proposalMenu', '==', formData.proposalMenu),
        where('leadSource', '==', currentLeadSource)
      );
      const existingDealSnapshot = await getDocs(existingDealQuery);

      let dealDocId = null;

      if (existingDealSnapshot.empty) {
        // 新規案件として進捗一覧に追加
        console.log('🆕 新規案件を作成:', dealKey);

        const newDeal = {
          companyName: formData.companyName,
          productName: formData.productName,
          proposalMenu: formData.proposalMenu,
          expectedBudget: formData.expectedBudget ? Number(formData.expectedBudget) : null,
          // パートナー案件の場合は担当者を分離
          representative: isPartnerView ? '増田 陽' : formData.representative || '',
          partnerRepresentative: isPartnerView ? formData.representative || '' : null,
          // 流入経路と紹介者
          leadSource: isPartnerView ? 'パートナー' : formData.leadSource || '',
          introducer: isPartnerView ? (partnerCompany || '') : (formData.leadSource === 'パートナー' ? getIntroducerName(formData.introducerId) : ''),
          introducerId: isPartnerView ? 0 : (formData.leadSource === 'パートナー' ? parseInt(formData.introducerId) : 0),
          status: formData.status, // 必須項目
          lastContactDate: formData.actionDate || new Date().toISOString().split('T')[0],
          nextAction: formData.nextAction || '',
          nextActionDate: formData.nextActionDate || null,
          summary: formData.summary || '', // AI要約
          sub_department_name: isPartnerView ? formData.sub_department_name || '' : '',
          sub_department_owner: isPartnerView ? formData.sub_department_owner || '' : '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        
        console.log('🆕 新規案件データ:', newDeal);
        
        const dealDocRef = await addDoc(progressRef, newDeal);
        dealDocId = dealDocRef.id;
      } else {
        // 既存案件を更新
        const existingDeal = existingDealSnapshot.docs[0];
        dealDocId = existingDeal.id;
        
        console.log('🔄 既存案件を更新:', dealDocId);
        
        // 既存案件のステータスと詳細を更新
        const updateData = {
          status: formData.status, // ステータスは必須なので常に更新
          lastContactDate: formData.actionDate || new Date().toISOString().split('T')[0],
          nextAction: formData.nextAction || existingDeal.data().nextAction,
          nextActionDate: formData.nextActionDate || existingDeal.data().nextActionDate,
          summary: formData.summary || existingDeal.data().summary || '', // AI要約
          // パートナー案件の場合は担当者を分離
          representative: isPartnerView ? '増田 陽' : formData.representative || existingDeal.data().representative,
          partnerRepresentative: isPartnerView ? formData.representative || '' : existingDeal.data().partnerRepresentative || null,
          // 流入経路と紹介者（既存の値を維持）
          leadSource: existingDeal.data().leadSource || (isPartnerView ? 'パートナー' : ''),
          introducer: existingDeal.data().introducer || '',
          introducerId: existingDeal.data().introducerId || 0,
          sub_department_name: isPartnerView ? formData.sub_department_name || '' : existingDeal.data().sub_department_name || '',
          sub_department_owner: isPartnerView ? formData.sub_department_owner || '' : existingDeal.data().sub_department_owner || '',
          // 想定予算が入力されている場合のみ更新
          ...(formData.expectedBudget ? { expectedBudget: Number(formData.expectedBudget) } : {}),
          updatedAt: serverTimestamp()
        };

        // フェーズ8（受注）の場合、想定予算を受注金額に自動設定、リードタイム計算
        if (formData.status === 'フェーズ8') {
          const expectedBudget = formData.expectedBudget ? Number(formData.expectedBudget) : (existingDeal.data().expectedBudget || 0);
          updateData.receivedOrderAmount = expectedBudget;
          updateData.confirmedDate = formData.actionDate || new Date().toISOString().split('T')[0];
          updateData.continuationStatus = '施策実施中';
          console.log('💰 フェーズ8: 受注金額を自動設定:', expectedBudget);

          // リードタイム計算（登録日から成約日までの日数）
          const createdAt = existingDeal.data().createdAt?.toDate?.();
          if (createdAt) {
            const confirmedDate = new Date(updateData.confirmedDate);
            const leadTimeDays = Math.floor((confirmedDate - createdAt) / (1000 * 60 * 60 * 24));
            updateData.leadTimeDays = leadTimeDays;
            console.log('📊 リードタイム（成約）:', leadTimeDays, '日');
          }
        }

        // 失注の場合、失注フェーズとリードタイムを記録
        if (formData.status === '失注') {
          const previousStatus = existingDeal.data().status;
          updateData.lostAtPhase = previousStatus; // 失注直前のフェーズを記録
          updateData.lostDate = formData.actionDate || new Date().toISOString().split('T')[0];
          console.log('❌ 失注: 直前フェーズ:', previousStatus);

          // リードタイム計算（登録日から失注日までの日数）
          const createdAt = existingDeal.data().createdAt?.toDate?.();
          if (createdAt) {
            const lostDate = new Date(updateData.lostDate);
            const leadTimeDays = Math.floor((lostDate - createdAt) / (1000 * 60 * 60 * 24));
            updateData.leadTimeDays = leadTimeDays;
            console.log('📊 リードタイム（失注）:', leadTimeDays, '日');
          }
        }
        
        console.log('🔄 既存案件のステータス更新:', dealDocId, '→', formData.status);
        await updateDoc(doc(progressRef, dealDocId), updateData);
        console.log('✅ 既存案件のステータス更新完了');
      }
      
      // アクションログを作成
      const newLog = {
        dealId: dealDocId,
        dealKey: dealKey,
        companyName: formData.companyName,
        productName: formData.productName,
        proposalMenu: formData.proposalMenu,
        action: `${formData.companyName} - ${formData.productName}`,
        description: formData.actionDetails,
        status: formData.status || 'アポ設定',
        nextAction: formData.nextAction || '',
        nextActionDate: formData.nextActionDate || null,
        summary: formData.summary || '', // AI要約
        // パートナー案件の場合は担当者を分離
        representative: isPartnerView ? '増田 陽' : formData.representative || '',
        partnerRepresentative: isPartnerView ? formData.representative || '' : null,
        // 流入経路と紹介者
        leadSource: isPartnerView ? 'パートナー' : formData.leadSource || '',
        introducer: isPartnerView ? (partnerCompany || '') : (formData.leadSource === 'パートナー' ? getIntroducerName(formData.introducerId) : ''),
        sub_department_name: isPartnerView ? formData.sub_department_name || '' : '',
        sub_department_owner: isPartnerView ? formData.sub_department_owner || '' : '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      const logDocRef = await addDoc(actionLogsRef, newLog);
      
      console.log('✅ アクションログ保存成功:', {
        logId: logDocRef.id,
        dealId: dealDocId
      });
      
      // IFキャスティング選択時は自動でキャスティング管理に登録
      if (formData.proposalMenu === 'IFキャスティング') {
        try {
          const castingProposalData = {
            projectName: formData.companyName,
            dealId: dealDocId,
            influencers: [], // 空の配列で初期化
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          
          const castingRef = collection(db, 'castingProposals');
          await addDoc(castingRef, castingProposalData);
          console.log('✅ キャスティング管理に自動登録完了');
        } catch (castingError) {
          console.error('キャスティング管理への登録エラー:', castingError);
          // メインの処理は成功しているので、エラーは警告に留める
        }
      }
      
      setSubmitMessage({
        type: 'success',
        text: 'アクションログが正常に保存されました！'
      });
      
      // 1秒後に画面遷移
      setTimeout(() => {
        if (isPartnerView) {
          if (partnerCompany) {
            navigate('/partner-entry/piala/dashboard');
          } else {
            navigate('/dashboard');
          }
        } else {
          navigate('/');
        }
      }, 1000);
      
    } catch (error) {
      console.error('💥 保存エラー:', error);
      console.error('エラーの詳細:', {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      
      // より詳細なエラーメッセージ
      let errorMessage = '保存に失敗しました: ';
      if (error.code === 'permission-denied') {
        errorMessage += 'Firestoreへのアクセス権限がありません。';
      } else if (error.code === 'unavailable') {
        errorMessage += 'Firestoreサービスが利用できません。';
      } else if (error.code === 'failed-precondition') {
        errorMessage += 'Firestoreのインデックスが必要です。';
      } else {
        errorMessage += error.message;
      }
      
      setSubmitMessage({
        type: 'error',
        text: errorMessage
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setFormData({
      companyName: '',
      productName: '',
      proposalMenu: '',
      representative: '',
      leadSource: '',
      introducerId: '',
      actionDate: new Date().toISOString().split('T')[0],
      actionDetails: '',
      nextAction: '',
      nextActionDate: '',
      status: '',
      summary: '',
      sub_department_name: '',
      sub_department_owner: '',
      expectedBudget: ''
    });
    setAnalysisResult(null);
    setFormErrors({});
    setSubmitMessage({ type: '', text: '' });
  };

  // CSVテンプレートのダウンロード
  const downloadCSVTemplate = () => {
    const headers = [
      '会社名',
      '商材名',
      '提案メニュー',
      '担当者',
      '流入経路',
      '紹介者',
      'アクション日',
      'アクション詳細',
      '次回アクション',
      '次回アクション日',
      'ステータス',
      '想定予算'
    ];

    const sampleData = [
      '株式会社サンプル',
      'サンプル商材A',
      '第一想起取れるくん',
      '増田 陽',
      'テレアポ',
      '',
      '2025-01-15',
      '初回商談実施。課題ヒアリング完了。',
      '提案書送付',
      '2025-01-20',
      'フェーズ2',
      '1000000'
    ];

    const csvContent = [
      headers.join(','),
      sampleData.join(',')
    ].join('\n');

    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'アクションログ_テンプレート.csv';
    link.click();
  };

  // CSVファイルの読み込み
  const handleCSVUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split('\n').filter(line => line.trim());

      if (lines.length < 2) {
        alert('CSVファイルにデータがありません');
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const data = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        if (values.length >= 6) {
          data.push({
            companyName: values[0] || '',
            productName: values[1] || '',
            proposalMenu: values[2] || '',
            representative: values[3] || '',
            leadSource: values[4] || '',
            introducer: values[5] || '',
            actionDate: values[6] || new Date().toISOString().split('T')[0],
            actionDetails: values[7] || '',
            nextAction: values[8] || '',
            nextActionDate: values[9] || '',
            status: values[10] || 'フェーズ1',
            expectedBudget: values[11] || ''
          });
        }
      }

      if (data.length === 0) {
        alert('有効なデータがありません');
        return;
      }

      setCsvData(data);
      setCsvResult(null);
      setShowCSVModal(true);
    };

    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
  };

  // CSV一括登録の実行
  const executeCSVImport = async () => {
    if (csvData.length === 0) return;

    setCsvImporting(true);
    setCsvResult(null);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const row of csvData) {
      try {
        // バリデーション
        if (!row.companyName || !row.productName || !row.proposalMenu) {
          throw new Error('会社名、商材名、提案メニューは必須です');
        }

        const progressRef = collection(db, 'progressDashboard');
        const actionLogsRef = collection(db, 'actionLogs');

        // 紹介者IDの検索
        let introducerId = 0;
        let introducerName = row.introducer || '';
        if (row.leadSource === 'パートナー' && row.introducer) {
          const foundIntroducer = introducersList.find(i =>
            i.name === row.introducer || i.name.includes(row.introducer)
          );
          if (foundIntroducer) {
            introducerId = foundIntroducer.id;
            introducerName = foundIntroducer.name;
          }
        }

        // 案件キー（流入経路も含む）
        const csvLeadSource = row.leadSource || '';
        const dealKey = `${row.companyName}_${row.productName}_${row.proposalMenu}_${csvLeadSource}`;

        // 既存案件をチェック（流入経路も含めて一致を確認）
        const existingQuery = query(
          progressRef,
          where('companyName', '==', row.companyName),
          where('productName', '==', row.productName),
          where('proposalMenu', '==', row.proposalMenu),
          where('leadSource', '==', csvLeadSource)
        );
        const existingSnapshot = await getDocs(existingQuery);

        let dealDocId;

        if (existingSnapshot.empty) {
          // 新規案件作成
          const newDeal = {
            companyName: row.companyName,
            productName: row.productName,
            proposalMenu: row.proposalMenu,
            expectedBudget: row.expectedBudget ? Number(row.expectedBudget) : null,
            representative: row.representative || '',
            leadSource: row.leadSource || '',
            introducer: introducerName,
            introducerId: introducerId,
            status: row.status || 'フェーズ1',
            lastContactDate: row.actionDate || new Date().toISOString().split('T')[0],
            nextAction: row.nextAction || '',
            nextActionDate: row.nextActionDate || null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };

          // フェーズ8（受注）の場合は受注金額と確定日を設定
          if ((row.status === 'フェーズ8' || row.status === '受注') && row.expectedBudget) {
            newDeal.receivedOrderAmount = Number(row.expectedBudget);
            newDeal.confirmedDate = row.actionDate || new Date().toISOString().split('T')[0];
            newDeal.status = 'フェーズ8';
            newDeal.continuationStatus = '施策実施中';
          }

          const dealDocRef = await addDoc(progressRef, newDeal);
          dealDocId = dealDocRef.id;
        } else {
          // 既存案件を更新
          const existingDeal = existingSnapshot.docs[0];
          dealDocId = existingDeal.id;

          const updateData = {
            status: row.status || existingDeal.data().status,
            lastContactDate: row.actionDate || existingDeal.data().lastContactDate,
            nextAction: row.nextAction || existingDeal.data().nextAction,
            nextActionDate: row.nextActionDate || existingDeal.data().nextActionDate,
            ...(row.expectedBudget ? { expectedBudget: Number(row.expectedBudget) } : {}),
            updatedAt: serverTimestamp()
          };

          // フェーズ8（受注）の場合は受注金額と確定日を設定、リードタイム計算
          if (row.status === 'フェーズ8' || row.status === '受注') {
            const budget = row.expectedBudget ? Number(row.expectedBudget) : (existingDeal.data().expectedBudget || 0);
            updateData.receivedOrderAmount = budget;
            updateData.confirmedDate = row.actionDate || new Date().toISOString().split('T')[0];
            updateData.status = 'フェーズ8';
            updateData.continuationStatus = '施策実施中';

            // リードタイム計算（登録日から成約日までの日数）
            const createdAt = existingDeal.data().createdAt?.toDate?.();
            if (createdAt) {
              const confirmedDate = new Date(updateData.confirmedDate);
              const leadTimeDays = Math.floor((confirmedDate - createdAt) / (1000 * 60 * 60 * 24));
              updateData.leadTimeDays = leadTimeDays;
            }
          }

          // 失注の場合、失注フェーズとリードタイムを記録
          if (row.status === '失注') {
            const previousStatus = existingDeal.data().status;
            updateData.lostAtPhase = previousStatus;
            updateData.lostDate = row.actionDate || new Date().toISOString().split('T')[0];

            // リードタイム計算（登録日から失注日までの日数）
            const createdAt = existingDeal.data().createdAt?.toDate?.();
            if (createdAt) {
              const lostDate = new Date(updateData.lostDate);
              const leadTimeDays = Math.floor((lostDate - createdAt) / (1000 * 60 * 60 * 24));
              updateData.leadTimeDays = leadTimeDays;
            }
          }

          await updateDoc(doc(progressRef, dealDocId), updateData);
        }

        // アクションログを作成
        const newLog = {
          dealId: dealDocId,
          dealKey: dealKey,
          companyName: row.companyName,
          productName: row.productName,
          proposalMenu: row.proposalMenu,
          action: `${row.companyName} - ${row.productName}`,
          description: row.actionDetails || '',
          status: row.status || 'フェーズ1',
          nextAction: row.nextAction || '',
          nextActionDate: row.nextActionDate || null,
          representative: row.representative || '',
          leadSource: row.leadSource || '',
          introducer: introducerName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        await addDoc(actionLogsRef, newLog);
        successCount++;
      } catch (error) {
        errorCount++;
        errors.push(`${row.companyName}: ${error.message}`);
      }
    }

    setCsvImporting(false);
    setCsvResult({
      success: successCount,
      error: errorCount,
      errors: errors
    });
  };

  // AI分析機能
  const handleAIAnalysis = async () => {
    // デバッグ用アラート
    const debugMode = false; // 本番環境ではfalseに設定
    
    if (debugMode) {
      alert(`AI分析開始\n議事録文字数: ${formData.actionDetails.length}文字\n内容: ${formData.actionDetails.substring(0, 100)}...`);
    }
    
    console.log('🔘 AI分析ボタンがクリックされました');
    console.log('📝 現在の議事録内容:', formData.actionDetails);
    console.warn('📝 議事録内容（警告レベルで表示）:', formData.actionDetails);
    
    if (!formData.actionDetails || formData.actionDetails.trim().length < 10) {
      alert('議事録（アクション詳細）を入力してください。');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisResult(null);

    try {
      console.log('🤖 AI分析開始:', formData.actionDetails);
      console.log('⏰ 実行時刻:', new Date().toISOString());
      
      const result = await analyzeMeetingNotes(formData.actionDetails);
      
      console.log('✅ AI分析完了 - 受信データ:');
      console.log('- summary:', result.summary);
      console.log('- actionPlans:', result.actionPlans);
      console.log('- status:', result.status);
      console.log('- error:', result.error);
      
      if (debugMode && result) {
        alert(`AI分析完了\n要約: ${(result.summary || '').substring(0, 50)}...\nステータス: ${result.status}`);
      }
      
      setAnalysisResult(result);
      
      // AI分析結果を自動でフォームに適用
      if (result && !result.error) {
        // アクションプランを次回アクションに適用（全項目を改行区切りで）
        if (result.actionPlans && result.actionPlans.length > 0) {
          const allActionPlans = result.actionPlans.join('\n');
          setFormData(prev => ({
            ...prev,
            nextAction: allActionPlans
          }));
        }

        // ステータスを適用
        if (result.status) {
          setFormData(prev => ({
            ...prev,
            status: result.status
          }));
        }

        // AI要約を適用
        if (result.summary) {
          setFormData(prev => ({
            ...prev,
            summary: result.summary
          }));
        }
        
        console.log('✅ AI分析結果をフォームに自動適用しました');
      }
      
      if (result.error) {
        setSubmitMessage({
          type: 'error',
          text: `AI分析エラー: ${result.error}`
        });
      }
      
    } catch (error) {
      console.error('💥 AI分析エラー:', error);
      console.error('エラー詳細:', error.stack);
      
      if (debugMode) {
        alert(`エラー発生: ${error.message}`);
      }
      
      setSubmitMessage({
        type: 'error',
        text: 'AI分析中にエラーが発生しました。しばらく時間をおいてからお試しください。'
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // AI分析結果の適用
  const handleApplyAIResult = () => {
    if (!analysisResult || analysisResult.error) {
      return;
    }

    // アクションプランを次回アクションに適用（全項目を改行区切りで）
    if (analysisResult.actionPlans && analysisResult.actionPlans.length > 0) {
      const allActionPlans = analysisResult.actionPlans.join('\n');
      setFormData(prev => ({
        ...prev,
        nextAction: allActionPlans
      }));
    }

    // ステータスを適用
    if (analysisResult.status) {
      setFormData(prev => ({
        ...prev,
        status: analysisResult.status
      }));
    }

    // 分析結果をクリア
    setAnalysisResult(null);
    
    setSubmitMessage({
      type: 'success',
      text: 'AI分析結果をフォームに適用しました！'
    });

    // 3秒後にメッセージをクリア
    setTimeout(() => {
      setSubmitMessage({ type: '', text: '' });
    }, 3000);
  };

  const handleAddIntroducer = () => {
    setShowIntroducerModal(true);
  };

  const handleIntroducerInputChange = (e) => {
    const { name, value } = e.target;
    setIntroducerFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleIntroducerSubmit = async (e) => {
    e.preventDefault();
    
    try {
      console.log('➕ 紹介者新規追加開始（モーダル）');
      const docRef = await addDoc(collection(db, 'introducers'), {
        ...introducerFormData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      console.log('✅ 紹介者新規追加成功（モーダル）:', docRef.id);
      
      // 紹介者リストを再取得
      await fetchIntroducers();
      
      // 新規追加した紹介者を自動選択
      setFormData(prev => ({
        ...prev,
        introducerId: docRef.id
      }));
      
      // モーダルを閉じてフォームをリセット
      setShowIntroducerModal(false);
      setIntroducerFormData({
        name: '',
        contactPerson: '',
        email: '',
        memo: '',
        status: 'アクティブ'
      });
      
      alert('紹介者を新規登録し、自動選択しました！');
    } catch (error) {
      console.error('💥 紹介者追加エラー（モーダル）:', error);
      alert('紹介者の追加に失敗しました: ' + error.message);
    }
  };

  const handleCloseIntroducerModal = () => {
    setShowIntroducerModal(false);
    setIntroducerFormData({
      name: '',
      contactPerson: '',
      email: '',
      memo: '',
      status: 'アクティブ'
    });
  };

  // 担当者関連の処理
  const handleAddRepresentative = () => {
    setShowRepresentativeModal(true);
  };

  const handleRepresentativeInputChange = (e) => {
    const { name, value } = e.target;
    setRepresentativeFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleRepresentativeSubmit = async (e) => {
    e.preventDefault();
    
    try {
      console.log('➕ 担当者新規追加開始（モーダル）');
      const docRef = await addDoc(collection(db, 'representatives'), {
        ...representativeFormData,
        companyName: partnerCompany,
        status: 'アクティブ',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      console.log('✅ 担当者新規追加成功（モーダル）:', docRef.id);
      
      // 担当者リストを再取得
      await fetchRepresentatives();
      
      // 新規追加した担当者を自動選択
      setFormData(prev => ({
        ...prev,
        representative: representativeFormData.name
      }));
      
      // モーダルを閉じてフォームをリセット
      setShowRepresentativeModal(false);
      setRepresentativeFormData({
        name: ''
      });
      
      alert('担当者を新規登録し、自動選択しました！');
    } catch (error) {
      console.error('💥 担当者追加エラー（モーダル）:', error);
      alert('担当者の追加に失敗しました: ' + error.message);
    }
  };

  const handleCloseRepresentativeModal = () => {
    setShowRepresentativeModal(false);
    setRepresentativeFormData({
      name: ''
    });
  };

  const getIntroducerName = (introducerId) => {
    const introducer = introducersList.find(i => i.id === introducerId);
    return introducer ? introducer.name : '';
  };

  return (
    <LogEntryContainer>
      <Header>
        <Title>アクションログ記録</Title>
      </Header>

      {/* CSV一括入稿セクション（管理者のみ） */}
      {!isPartnerView && (
        <CSVSection>
          <h3 style={{ margin: '0 0 1rem 0', color: '#2c3e50' }}>📁 CSV一括入稿</h3>
          <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.9rem' }}>
            複数の案件を一括で登録できます。テンプレートをダウンロードしてご利用ください。
          </p>
          <CSVButtons>
            <CSVButton className="download" onClick={downloadCSVTemplate}>
              <FiDownload />
              テンプレートダウンロード
            </CSVButton>
            <label>
              <CSVButton as="span" className="upload">
                <FiUpload />
                CSVアップロード
              </CSVButton>
              <HiddenInput
                type="file"
                accept=".csv"
                onChange={handleCSVUpload}
              />
            </label>
          </CSVButtons>
        </CSVSection>
      )}

      <Form onSubmit={handleSubmit}>
        {isProcessing && (
          <LoadingOverlay>
            <LoadingSpinner />
          </LoadingOverlay>
        )}
        
        {submitMessage.text && (
          submitMessage.type === 'success' ? (
            <SuccessMessage>
              <FiSave />
              {submitMessage.text}
            </SuccessMessage>
          ) : (
            <ErrorMessage>
              <FiAlertCircle />
              {submitMessage.text}
            </ErrorMessage>
          )
        )}
        
        <FormGrid>
          <FormGroup>
            <Label>
              <FiFileText />
              会社名 *
            </Label>
            <Input
              type="text"
              name="companyName"
              value={formData.companyName}
              onChange={handleInputChange}
              placeholder="例：株式会社ABC"
              required
              disabled={isEditMode}
              style={{
                ...(formErrors.companyName ? { borderColor: '#e74c3c' } : {}),
                ...(isEditMode ? { backgroundColor: '#f8f9fa', cursor: 'not-allowed' } : {})
              }}
            />
            {formErrors.companyName && (
              <div style={{ color: '#e74c3c', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                {formErrors.companyName}
              </div>
            )}
          </FormGroup>

          <FormGroup>
            <Label>
              <FiFileText />
              商材名 *
            </Label>
            <Input
              type="text"
              name="productName"
              value={formData.productName}
              onChange={handleInputChange}
              placeholder="例：新商品A、サービスB"
              required
              disabled={isEditMode}
              style={{
                ...(formErrors.productName ? { borderColor: '#e74c3c' } : {}),
                ...(isEditMode ? { backgroundColor: '#f8f9fa', cursor: 'not-allowed' } : {})
              }}
            />
            {formErrors.productName && (
              <div style={{ color: '#e74c3c', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                {formErrors.productName}
              </div>
            )}
          </FormGroup>

          <FormGroup>
            <Label>
              <FiFileText />
              提案メニュー *
            </Label>
            <Select
              name="proposalMenu"
              value={formData.proposalMenu}
              onChange={handleInputChange}
              required
              disabled={isEditMode}
              style={{
                ...(formErrors.proposalMenu ? { borderColor: '#e74c3c' } : {}),
                ...(isEditMode ? { backgroundColor: '#f8f9fa', cursor: 'not-allowed' } : {})
              }}
            >
              <option value="">選択してください</option>
              {proposalMenusList.map(menu => (
                <option key={menu.id} value={menu.name}>
                  {menu.name}
                </option>
              ))}
            </Select>
            {formErrors.proposalMenu && (
              <div style={{ color: '#e74c3c', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                {formErrors.proposalMenu}
              </div>
            )}
          </FormGroup>

          <FormGroup>
            <Label>
              <FiFileText />
              想定予算（円） {!isEditMode && '*'}
            </Label>
            <Input
              type="number"
              name="expectedBudget"
              value={formData.expectedBudget}
              onChange={handleInputChange}
              placeholder="例：1000000"
              min="1"
              style={{
                ...(formErrors.expectedBudget ? { borderColor: '#e74c3c' } : {}),
                ...(isEditMode ? { backgroundColor: '#f8f9fa', cursor: 'not-allowed' } : {})
              }}
            />
            {formErrors.expectedBudget && (
              <div style={{ color: '#e74c3c', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                {formErrors.expectedBudget}
              </div>
            )}
          </FormGroup>

          <FormGroup>
            <Label>
              <FiUser />
              対応者 *
            </Label>
            <Select
              name="representative"
              value={formData.representative}
              onChange={handleInputChange}
              required
              disabled={isEditMode}
              style={{
                ...(formErrors.representative ? { borderColor: '#e74c3c' } : {}),
                ...(isEditMode ? { backgroundColor: '#f8f9fa', cursor: 'not-allowed' } : {})
              }}
            >
              <option value="">選択してください</option>
              {isPartnerView && partnerCompany ? (
                // パートナービューの場合は担当者マスターから選択
                representativesList.filter(rep => rep.status === 'アクティブ').map(rep => (
                  <option key={rep.id} value={rep.name}>
                    {rep.name}{rep.department ? ` (${rep.department})` : ''}
                  </option>
                ))
              ) : (
                // 管理者ビューの場合は従来通り定数から選択
                SALES_REPRESENTATIVES.map(rep => (
                  <option key={rep} value={rep}>
                    {rep}
                  </option>
                ))
              )}
            </Select>
            {formErrors.representative && (
              <div style={{ color: '#e74c3c', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                {formErrors.representative}
              </div>
            )}
            {isPartnerView && partnerCompany && (
              <IntroducerActions>
                <LinkButton type="button" onClick={handleAddRepresentative}>
                  <FiPlus />
                  担当者を新規登録する
                </LinkButton>
              </IntroducerActions>
            )}
          </FormGroup>

          {!isPartnerView && (
            <FormGroup>
              <Label>
                <FiUser />
                流入経路 *
              </Label>
              <Select
                name="leadSource"
                value={formData.leadSource}
                onChange={handleInputChange}
                required
                disabled={isEditMode}
                style={{
                  ...(formErrors.leadSource ? { borderColor: '#e74c3c' } : {}),
                  ...(isEditMode ? { backgroundColor: '#f8f9fa', cursor: 'not-allowed' } : {})
                }}
              >
                <option value="">選択してください</option>
                {leadSourcesList.map(source => (
                  <option key={source.id} value={source.name}>
                    {source.name}
                  </option>
                ))}
              </Select>
              {formErrors.leadSource && (
                <div style={{ color: '#e74c3c', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                  {formErrors.leadSource}
                </div>
              )}
            </FormGroup>
          )}

          {/* パートナー選択時のみ紹介者を表示 */}
          {!isPartnerView && formData.leadSource === 'パートナー' && (
            <FormGroup>
              <Label>
                <FiUser />
                紹介者 *
              </Label>
              <Select
                name="introducerId"
                value={formData.introducerId}
                onChange={handleInputChange}
                required
                disabled={isEditMode}
                style={{
                  ...(formErrors.introducerId ? { borderColor: '#e74c3c' } : {}),
                  ...(isEditMode ? { backgroundColor: '#f8f9fa', cursor: 'not-allowed' } : {})
                }}
              >
                <option value="">選択してください</option>
                {introducersList.filter(i => i.status === 'アクティブ').map(introducer => (
                  <option key={introducer.id} value={introducer.id}>
                    {introducer.name}
                  </option>
                ))}
              </Select>
              {formErrors.introducerId && (
                <div style={{ color: '#e74c3c', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                  {formErrors.introducerId}
                </div>
              )}
              {!isEditMode && (
                <IntroducerActions>
                  <LinkButton type="button" onClick={handleAddIntroducer}>
                    <FiPlus />
                    紹介者を新規登録する
                  </LinkButton>
                </IntroducerActions>
              )}
            </FormGroup>
          )}

          {isPartnerView && isEditMode && formData.introducer && (
            <FormGroup>
              <Label>
                <FiUser />
                紹介者
              </Label>
              <Input
                type="text"
                value={formData.introducer}
                disabled
                style={{
                  backgroundColor: '#f8f9fa',
                  cursor: 'not-allowed',
                  color: '#666'
                }}
              />
            </FormGroup>
          )}

          {isPartnerView && (
            <>
              <FormGroup>
                <Label>
                  <FiFileText />
                  部署名
                </Label>
                <Select
                  name="sub_department_name"
                  value={formData.sub_department_name}
                  onChange={handleInputChange}
                >
                  <option value="">選択してください</option>
                  {DEPARTMENT_NAMES.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </Select>
              </FormGroup>

              <FormGroup>
                <Label>
                  <FiUser />
                  他部署担当者名
                </Label>
                <Input
                  type="text"
                  name="sub_department_owner"
                  value={formData.sub_department_owner}
                  onChange={handleInputChange}
                  placeholder="他部署担当者名を入力"
                />
              </FormGroup>
            </>
          )}

          <FormGroup>
            <Label>
              <FiCalendar />
              アクション日 *
            </Label>
            <Input
              type="date"
              name="actionDate"
              value={formData.actionDate}
              onChange={handleInputChange}
              required
            />
          </FormGroup>

          <FormGroup>
            <Label>
              <FiCalendar />
              次回アクション日
            </Label>
            <Input
              type="date"
              name="nextActionDate"
              value={formData.nextActionDate}
              onChange={handleInputChange}
            />
          </FormGroup>
        </FormGrid>

        <FormGroup>
          <Label>
            <FiFileText />
            議事録
          </Label>
          <TextArea
            name="actionDetails"
            value={formData.actionDetails}
            onChange={handleInputChange}
            placeholder="今回の議事録内容を詳しく記載してください"
            style={formErrors.actionDetails ? { borderColor: '#e74c3c' } : {}}
          />
          {formErrors.actionDetails && (
            <div style={{ color: '#e74c3c', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              {formErrors.actionDetails}
            </div>
          )}
          
          {/* AI分析ボタン（議事録が入力されている場合に表示） */}
          {formData.actionDetails && formData.actionDetails.length > 50 && isGPTServiceAvailable() && (
            <div style={{ marginTop: '1rem', textAlign: 'right' }}>
              <Button
                type="button"
                className="ai-analyze"
                onClick={handleAIAnalysis}
                disabled={isAnalyzing || isProcessing}
              >
                {isAnalyzing ? <FiRefreshCw /> : <FiZap />}
                {isAnalyzing ? 'AI分析中...' : 'AI要約・分析実行'}
              </Button>
            </div>
          )}
          
        </FormGroup>

        <FormGroup>
          <Label>
            <FiFileText />
            次回アクション *
          </Label>
          <TextArea
            name="nextAction"
            value={formData.nextAction}
            onChange={handleInputChange}
            placeholder="次回実施予定のアクション（複数のアクションプランが自動入力されます）"
            rows={4}
            required
            style={formErrors.nextAction ? { borderColor: '#e74c3c' } : {}}
          />
          {formErrors.nextAction && (
            <div style={{ color: '#e74c3c', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              {formErrors.nextAction}
            </div>
          )}
        </FormGroup>

        <FormGroup>
          <Label>
            <FiFileText />
            ステータス
          </Label>
          <Select
            name="status"
            value={formData.status}
            onChange={handleInputChange}
            required
          >
            <option value="">選択してください</option>
            {STATUSES.map(status => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label>
            <FiFileText />
            要約
          </Label>
          <TextArea
            name="summary"
            value={formData.summary}
            onChange={handleInputChange}
            placeholder="AI要約がここに自動入力されます。手動での編集も可能です。"
            rows={4}
          />
        </FormGroup>

        <ButtonGroup>
          <Button type="button" className="secondary" onClick={handleReset}>
            リセット
          </Button>
          <Button type="submit" className="primary">
            <FiSave />
            保存
          </Button>
        </ButtonGroup>
      </Form>

      {/* 紹介者新規登録モーダル */}
      {showIntroducerModal && (
        <Modal onClick={(e) => e.target === e.currentTarget && handleCloseIntroducerModal()}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>紹介者新規登録</ModalTitle>
              <CloseButton onClick={handleCloseIntroducerModal}>
                <FiX />
              </CloseButton>
            </ModalHeader>
            
            <form onSubmit={handleIntroducerSubmit}>
              <FormGroup>
                <Label>
                  <FiUser />
                  紹介者名 *
                </Label>
                <Input
                  type="text"
                  name="name"
                  value={introducerFormData.name}
                  onChange={handleIntroducerInputChange}
                  required
                  placeholder="紹介者名を入力"
                />
              </FormGroup>

              <FormGroup>
                <Label>
                  <FiUser />
                  担当者名
                </Label>
                <Input
                  type="text"
                  name="contactPerson"
                  value={introducerFormData.contactPerson}
                  onChange={handleIntroducerInputChange}
                  placeholder="担当者名を入力"
                />
              </FormGroup>

              <FormGroup>
                <Label>
                  <FiUser />
                  メールアドレス
                </Label>
                <Input
                  type="email"
                  name="email"
                  value={introducerFormData.email}
                  onChange={handleIntroducerInputChange}
                  placeholder="メールアドレスを入力"
                />
              </FormGroup>

              <FormGroup>
                <Label>
                  <FiFileText />
                  メモ
                </Label>
                <TextArea
                  name="memo"
                  value={introducerFormData.memo}
                  onChange={handleIntroducerInputChange}
                  placeholder="メモを入力"
                  rows={3}
                />
              </FormGroup>

              <ModalButtonGroup>
                <Button type="button" className="secondary" onClick={handleCloseIntroducerModal}>
                  キャンセル
                </Button>
                <Button type="submit" className="primary">
                  <FiSave />
                  登録
                </Button>
              </ModalButtonGroup>
            </form>
          </ModalContent>
        </Modal>
      )}

      {/* 担当者新規登録モーダル（パートナー専用） */}
      {showRepresentativeModal && (
        <Modal onClick={(e) => {
          if (e.target === e.currentTarget) {
            handleCloseRepresentativeModal();
          }
        }}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>担当者新規登録</ModalTitle>
              <CloseButton onClick={handleCloseRepresentativeModal}>
                <FiX />
              </CloseButton>
            </ModalHeader>
            
            <form onSubmit={handleRepresentativeSubmit}>
              <FormGroup>
                <Label>
                  <FiUser />
                  氏名 *
                </Label>
                <Input
                  type="text"
                  name="name"
                  value={representativeFormData.name}
                  onChange={handleRepresentativeInputChange}
                  required
                  placeholder="担当者名を入力"
                />
              </FormGroup>

              <ModalButtonGroup>
                <Button type="button" className="secondary" onClick={handleCloseRepresentativeModal}>
                  キャンセル
                </Button>
                <Button type="submit" className="primary">
                  <FiSave />
                  登録
                </Button>
              </ModalButtonGroup>
            </form>
          </ModalContent>
        </Modal>
      )}

      {/* CSVプレビューモーダル */}
      {showCSVModal && (
        <Modal onClick={() => !csvImporting && setShowCSVModal(false)}>
          <CSVModalContent onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>CSV一括入稿プレビュー</ModalTitle>
              <CloseButton onClick={() => !csvImporting && setShowCSVModal(false)}>
                <FiX />
              </CloseButton>
            </ModalHeader>

            <p style={{ color: '#666', marginBottom: '1rem' }}>
              {csvData.length}件のデータが読み込まれました。内容を確認して登録してください。
            </p>

            <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
              <CSVPreviewTable>
                <thead>
                  <tr>
                    <th>会社名</th>
                    <th>商材名</th>
                    <th>提案メニュー</th>
                    <th>担当者</th>
                    <th>流入経路</th>
                    <th>ステータス</th>
                    <th>想定予算</th>
                  </tr>
                </thead>
                <tbody>
                  {csvData.map((row, index) => (
                    <tr key={index}>
                      <td>{row.companyName}</td>
                      <td>{row.productName}</td>
                      <td>{row.proposalMenu}</td>
                      <td>{row.representative}</td>
                      <td>{row.leadSource}</td>
                      <td>{row.status}</td>
                      <td>{row.expectedBudget ? `¥${Number(row.expectedBudget).toLocaleString()}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </CSVPreviewTable>
            </div>

            {csvResult && (
              <CSVResultMessage className={csvResult.error > 0 ? 'error' : 'success'}>
                <strong>結果:</strong> {csvResult.success}件成功
                {csvResult.error > 0 && `, ${csvResult.error}件失敗`}
                {csvResult.errors.length > 0 && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                    {csvResult.errors.slice(0, 5).map((err, i) => (
                      <div key={i}>• {err}</div>
                    ))}
                    {csvResult.errors.length > 5 && <div>...他{csvResult.errors.length - 5}件</div>}
                  </div>
                )}
              </CSVResultMessage>
            )}

            <ModalButtonGroup>
              <Button
                type="button"
                className="secondary"
                onClick={() => setShowCSVModal(false)}
                disabled={csvImporting}
              >
                キャンセル
              </Button>
              {!csvResult && (
                <Button
                  type="button"
                  onClick={executeCSVImport}
                  disabled={csvImporting}
                  style={{ background: csvImporting ? '#95a5a6' : '#27ae60' }}
                >
                  {csvImporting ? '登録中...' : `${csvData.length}件を一括登録`}
                </Button>
              )}
              {csvResult && (
                <Button
                  type="button"
                  onClick={() => {
                    setShowCSVModal(false);
                    setCsvData([]);
                    setCsvResult(null);
                  }}
                >
                  閉じる
                </Button>
              )}
            </ModalButtonGroup>
          </CSVModalContent>
        </Modal>
      )}
    </LogEntryContainer>
  );
}

export default LogEntryPage; 