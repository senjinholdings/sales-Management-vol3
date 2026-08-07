import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { FiTarget, FiTrendingUp, FiBarChart, FiUsers, FiEdit2, FiDollarSign, FiUser } from 'react-icons/fi';
import PhaseTooltip from './PhaseTooltip.js';
import { db } from '../firebase.js';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { STATUSES, STATUS_COLORS, PROPOSAL_MENUS } from '../data/constants.js';
import { fetchStaffByRole } from '../services/staffService.js';

// フェーズごとの受注確率
const PHASE_PROBABILITY = {
  'フェーズ1': 0.05,
  'フェーズ2': 0.15,
  'フェーズ3': 0.25,
  'フェーズ4': 0.50,
  'フェーズ5': 0.70,
  'フェーズ6': 0.90,
  'フェーズ7': 0.95,
  'フェーズ8': 1.00,
  '失注': 0
};

const DashboardContainer = styled.div`
  max-width: 1400px;
  margin: 0 auto;
  padding: 0;
`;

const Header = styled.div`
  margin-bottom: 24px;
`;

const Title = styled.h2`
  color: var(--color-text-primary);
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
`;

const GridContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;

  @media (max-width: 1024px) {
    grid-template-columns: 1fr;
  }
`;

const FullWidthContainer = styled.div`
  margin-bottom: 20px;
`;

const Card = styled.div`
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--color-border);
  transition: box-shadow 0.2s ease;
`;

const CardTitle = styled.h3`
  color: var(--color-text-primary);
  margin: 0 0 16px 0;
  font-size: 0.95rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
`;

// メーターグラフ用スタイル
const MeterContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem;
  position: relative;
`;

const MeterSvg = styled.svg`
  width: 200px;
  height: 120px;
`;

const MeterValue = styled.div`
  font-size: 2rem;
  font-weight: bold;
  color: ${props => props.color || '#2c3e50'};
  margin-top: -2rem;
`;

const MeterLabel = styled.div`
  font-size: 0.9rem;
  color: #666;
  margin-top: 0.25rem;
`;

// 円グラフ用スタイル
const PieChartContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;
  justify-content: center;
`;

const PieSvg = styled.svg`
  width: 180px;
  height: 180px;
`;

const PieLegend = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
`;

const LegendColor = styled.div`
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: ${props => props.color};
`;

// テーブル用スタイル
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
`;

const Th = styled.th`
  background: #f8f9fa;
  padding: 0.75rem;
  text-align: left;
  border-bottom: 2px solid #dee2e6;
  font-weight: 600;
  color: #495057;
`;

const Td = styled.td`
  padding: 0.75rem;
  border-bottom: 1px solid #dee2e6;
  color: #212529;
`;

const AlertBadge = styled.span`
  background: #dc3545;
  color: white;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
`;

const TotalRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
  margin-top: 1rem;
  font-weight: 600;
`;

const LoadingMessage = styled.div`
  text-align: center;
  padding: 2rem;
  color: #666;
`;

// プルダウン用スタイル
const SelectWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
`;

const SelectLabel = styled.label`
  font-weight: 600;
  color: #495057;
`;

const Select = styled.select`
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  background: white;
  cursor: pointer;
  min-width: 200px;

  &:focus {
    outline: none;
    border-color: #3498db;
  }
`;

// 担当者サマリー用スタイル
const PersonSummaryContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  gap: 1.5rem;

  @media (max-width: 1200px) {
    grid-template-columns: 1fr;
  }
`;

const SummaryBox = styled.div`
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1rem;
  border: 1px solid #e9ecef;
`;

const SummaryTitle = styled.div`
  font-weight: 600;
  color: #495057;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
`;

const SummaryValue = styled.div`
  font-size: 2rem;
  font-weight: bold;
  color: #2c3e50;
`;

const PhaseRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid #e9ecef;

  &:last-child {
    border-bottom: none;
  }
`;

const PhaseName = styled.span`
  color: #495057;
`;

const PhaseValue = styled.span`
  font-weight: 600;
  color: #2c3e50;
`;

const DealListTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
`;

const DealListTh = styled.th`
  background: #e9ecef;
  padding: 0.5rem;
  text-align: left;
  font-weight: 600;
  color: #495057;
`;

const DealListTd = styled.td`
  padding: 0.5rem;
  border-bottom: 1px solid #e9ecef;
  color: #212529;
`;

const PhaseBadge = styled.span`
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background: ${props => props.color || '#95a5a6'};
  color: white;
`;

// 目標編集用スタイル
const EditButton = styled.button`
  background: none;
  border: none;
  color: #3498db;
  cursor: pointer;
  padding: 0.25rem;
  margin-left: 0.5rem;
  display: inline-flex;
  align-items: center;

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
  border-radius: 12px;
  padding: 2rem;
  width: 400px;
  max-width: 90%;
`;

const ModalTitle = styled.h3`
  margin: 0 0 1.5rem 0;
  color: #2c3e50;
`;

const ModalInput = styled.input`
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  margin-bottom: 1rem;

  &:focus {
    outline: none;
    border-color: #3498db;
  }
`;

const ModalButtons = styled.div`
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
`;

const ModalButton = styled.button`
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;

  &.cancel {
    background: #95a5a6;
    color: white;
  }

  &.save {
    background: #27ae60;
    color: white;
  }

  &:hover {
    opacity: 0.9;
  }
`;

// ユーティリティ関数
const formatCurrency = (value) => {
  if (!value) return '¥0';
  return '¥' + value.toLocaleString();
};

const getQuarterRange = (quarterKey) => {
  if (quarterKey) {
    const [y, q] = quarterKey.split('-Q').map(Number);
    const startMonth = (q - 1) * 3;
    const endMonth = startMonth + 2;
    return {
      start: new Date(y, startMonth, 1),
      end: new Date(y, endMonth + 1, 0),
      label: `${y}年${startMonth + 1}月〜${endMonth + 1}月`
    };
  }
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  let startMonth, endMonth;
  if (month < 3) { startMonth = 0; endMonth = 2; }
  else if (month < 6) { startMonth = 3; endMonth = 5; }
  else if (month < 9) { startMonth = 6; endMonth = 8; }
  else { startMonth = 9; endMonth = 11; }
  return {
    start: new Date(year, startMonth, 1),
    end: new Date(year, endMonth + 1, 0),
    label: `${year}年${startMonth + 1}月〜${endMonth + 1}月`
  };
};

const getCurrentMonthRange = (quarterKey) => {
  if (quarterKey) {
    const [y, q] = quarterKey.split('-Q').map(Number);
    const endMonth = (q - 1) * 3 + 2; // 四半期の最終月
    return {
      start: new Date(y, endMonth, 1),
      end: new Date(y, endMonth + 1, 0),
      label: `${y}年${endMonth + 1}月`
    };
  }
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    label: `${now.getFullYear()}年${now.getMonth() + 1}月`
  };
};

const generateQuarterOptions = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  const options = [];
  for (let y = currentYear - 2; y <= currentYear + 1; y++) {
    for (let q = 1; q <= 4; q++) {
      options.push({ value: `${y}-Q${q}`, label: `${y}年 Q${q}（${(q-1)*3+1}〜${q*3}月）` });
    }
  }
  return { options, current: `${currentYear}-Q${currentQ}` };
};

// メーターグラフコンポーネント
const MeterGauge = ({ value, target, label }) => {
  const displayPercentage = target > 0 ? Math.round((value / target) * 100) : 0;
  const clampedPercent = Math.min(Math.max(displayPercentage, 0), 100);

  // 半円のパス（背景・実績共通）
  const radius = 80;
  const centerX = 100;
  const centerY = 100;
  const arcPath = `M ${centerX - radius} ${centerY} A ${radius} ${radius} 0 1 1 ${centerX + radius} ${centerY}`;

  // 半円の全長 = π × radius
  const totalLength = Math.PI * radius;
  // 進捗分の長さ
  const filledLength = (clampedPercent / 100) * totalLength;

  let color = '#27ae60';
  if (displayPercentage < 50) color = '#e74c3c';
  else if (displayPercentage < 80) color = '#f39c12';

  return (
    <MeterContainer>
      <MeterSvg viewBox="0 0 200 120">
        <path
          d={arcPath}
          fill="none"
          stroke="#e0e0e0"
          strokeWidth="16"
          strokeLinecap="round"
        />
        {clampedPercent > 0 && (
          <path
            d={arcPath}
            fill="none"
            stroke={color}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={`${filledLength} ${totalLength}`}
          />
        )}
      </MeterSvg>
      <MeterValue color={color}>{displayPercentage}%</MeterValue>
      <MeterLabel>{label}</MeterLabel>
      <MeterLabel style={{ fontSize: '0.8rem', color: '#999' }}>
        {formatCurrency(value)} / {formatCurrency(target)}
      </MeterLabel>
    </MeterContainer>
  );
};

// 円グラフコンポーネント
const PieChart = ({ data, title }) => {
  // データがない場合またはすべて0の場合
  const filteredData = data.filter(item => item.value > 0);
  const total = filteredData.reduce((sum, item) => sum + item.value, 0);

  if (total === 0 || filteredData.length === 0) {
    return (
      <PieChartContainer>
        <div style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>データなし</div>
      </PieChartContainer>
    );
  }

  // 1つしかセグメントがない場合は完全な円を描画
  if (filteredData.length === 1) {
    return (
      <PieChartContainer>
        <PieSvg viewBox="0 0 180 180">
          <circle cx="90" cy="90" r="70" fill={filteredData[0].color} />
        </PieSvg>
        <PieLegend>
          <LegendItem>
            <LegendColor color={filteredData[0].color} />
            <span>{filteredData[0].label}: {formatCurrency(filteredData[0].value)} (100%)</span>
          </LegendItem>
        </PieLegend>
      </PieChartContainer>
    );
  }

  let currentAngle = -Math.PI / 2; // 12時の位置から開始
  const paths = filteredData.map((item, index) => {
    const percentage = item.value / total;
    const startAngle = currentAngle;
    const sweepAngle = percentage * 2 * Math.PI;
    const endAngle = startAngle + sweepAngle;
    currentAngle = endAngle;

    const x1 = 90 + 70 * Math.cos(startAngle);
    const y1 = 90 + 70 * Math.sin(startAngle);
    const x2 = 90 + 70 * Math.cos(endAngle);
    const y2 = 90 + 70 * Math.sin(endAngle);

    const largeArcFlag = percentage > 0.5 ? 1 : 0;

    // ほぼ100%の場合の特別処理（99.9%以上）
    if (percentage >= 0.999) {
      return (
        <circle key={index} cx="90" cy="90" r="70" fill={item.color} />
      );
    }

    return (
      <path
        key={index}
        d={`M 90 90 L ${x1} ${y1} A 70 70 0 ${largeArcFlag} 1 ${x2} ${y2} Z`}
        fill={item.color}
      />
    );
  });

  return (
    <PieChartContainer>
      <PieSvg viewBox="0 0 180 180">
        {paths}
      </PieSvg>
      <PieLegend>
        {filteredData.map((item, index) => (
          <LegendItem key={index}>
            <LegendColor color={item.color} />
            <span>{item.label}: {formatCurrency(item.value)} ({Math.round(item.value / total * 100)}%)</span>
          </LegendItem>
        ))}
      </PieLegend>
    </PieChartContainer>
  );
};

// 逆ピラミッド型ファネルチャート用スタイル
const FunnelContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0.5rem;
`;

const FunnelRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
`;

const FunnelBar = styled.div`
  height: 36px;
  background: ${props => props.color};
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  font-size: 0.8rem;
  transition: all 0.3s ease;
  clip-path: polygon(
    ${props => props.topLeft}% 0,
    ${props => 100 - props.topLeft}% 0,
    ${props => 100 - props.bottomLeft}% 100%,
    ${props => props.bottomLeft}% 100%
  );
`;

const FunnelLabel = styled.div`
  position: absolute;
  left: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: #495057;
`;

const FunnelValue = styled.div`
  width: 50px;
  font-size: 0.9rem;
  font-weight: bold;
  color: #2c3e50;
  text-align: left;
`;

function HomeDashboard() {
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(true);
  const [deals, setDeals] = useState([]); // 新規+既存の全案件
  const [newQuarterTarget, setNewQuarterTarget] = useState(10000000); // 新規目標値
  const [existingQuarterTarget, setExistingQuarterTarget] = useState(5000000); // 既存目標値
  const [selectedRepresentative, setSelectedRepresentative] = useState(''); // 担当者サマリー用
  const [salesRepList, setSalesRepList] = useState([]); // スタッフマスターからの営業者リスト
  const { options: quarterOptions, current: currentQuarterKey } = useMemo(() => generateQuarterOptions(), []);
  const [selectedQuarter, setSelectedQuarter] = useState(currentQuarterKey);

  // 再計算用の生データ保持
  const [rawNewDeals, setRawNewDeals] = useState([]);
  const [rawSalesRecords, setRawSalesRecords] = useState([]);

  // 計算結果のstate
  const [quarterActualNew, setQuarterActualNew] = useState(0); // 新規四半期実績
  const [quarterActualExisting, setQuarterActualExisting] = useState(0); // 既存四半期実績
  const [quarterForecast, setQuarterForecast] = useState([]);
  const [quarterlyPersonalSales, setQuarterlyPersonalSales] = useState([]); // 個人四半期売上
  const [quarterMonthlyActual, setQuarterMonthlyActual] = useState([]); // 四半期内の月別売上（新規+既存）
  const [monthlyPersonalSales, setMonthlyPersonalSales] = useState([]);
  const [monthForecast, setMonthForecast] = useState([]);
  const [clientBudgetSummary, setClientBudgetSummary] = useState([]);

  // 目標編集モーダル用state
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [editingNewTarget, setEditingNewTarget] = useState('');
  const [editingExistingTarget, setEditingExistingTarget] = useState('');

  // 四半期のキーを取得（目標値保存用）
  const getQuarterKey = () => selectedQuarter;

  // 新規・既存の目標値をFirestoreから取得
  const fetchTarget = useCallback(async () => {
    try {
      const quarterKey = getQuarterKey();
      // 新規目標
      const newTargetRef = doc(db, 'salesTargets', quarterKey);
      const newTargetDoc = await getDoc(newTargetRef);
      if (newTargetDoc.exists()) {
        setNewQuarterTarget(newTargetDoc.data().target || 10000000);
      }
      // 既存目標
      const existingTargetRef = doc(db, 'salesTargets', `${quarterKey}-existing`);
      const existingTargetDoc = await getDoc(existingTargetRef);
      if (existingTargetDoc.exists()) {
        setExistingQuarterTarget(existingTargetDoc.data().target || 5000000);
      }
    } catch (error) {
      console.error('目標値取得エラー:', error);
    }
  }, [selectedQuarter]);

  // 目標値をFirestoreに保存
  const saveTarget = async () => {
    try {
      const quarterKey = getQuarterKey();
      const newTargetValue = parseInt(editingNewTarget) || 0;
      const existingTargetValue = parseInt(editingExistingTarget) || 0;

      await setDoc(doc(db, 'salesTargets', quarterKey), {
        target: newTargetValue,
        updatedAt: new Date()
      });
      await setDoc(doc(db, 'salesTargets', `${quarterKey}-existing`), {
        target: existingTargetValue,
        updatedAt: new Date()
      });

      setNewQuarterTarget(newTargetValue);
      setExistingQuarterTarget(existingTargetValue);
      setShowTargetModal(false);
      alert('目標値を保存しました');
    } catch (error) {
      console.error('目標値保存エラー:', error);
      alert('保存に失敗しました');
    }
  };

  // 目標編集モーダルを開く
  const openTargetModal = () => {
    setEditingNewTarget(newQuarterTarget.toString());
    setEditingExistingTarget(existingQuarterTarget.toString());
    setShowTargetModal(true);
  };

  // データ取得
  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const progressRef = collection(db, 'progressDashboard');
      const querySnapshot = await getDocs(progressRef);

      const dealsList = [];
      querySnapshot.forEach((docSnap) => {
        dealsList.push({
          id: docSnap.id,
          ...docSnap.data(),
          createdAt: docSnap.data().createdAt?.toDate?.() || new Date(docSnap.data().createdAt)
        });
      });

      // 新規案件（パイプライン表示用）
      const newDeals = dealsList.filter(d => d.isExistingProject !== true);

      // 既存案件のsalesRecords + 新規案件のnewCaseSalesRecordsから全レコードを取得
      // （新規案件が成約(フェーズ8)した際の実績も売上集計に含めるため、両方とも対象にする）
      const allSalesRecords = [];
      await Promise.all(dealsList.map(async (deal) => {
        const subCol = deal.isExistingProject === true ? 'salesRecords' : 'newCaseSalesRecords';
        try {
          const salesRecordsSnap = await getDocs(
            collection(db, 'progressDashboard', deal.id, subCol)
          );
          const recs = [];
          salesRecordsSnap.forEach(rec => recs.push({ id: rec.id, ...rec.data() }));
          recs.sort((a, b) => {
            const aDate = a.date || '';
            const bDate = b.date || '';
            if (aDate !== bDate) return bDate.localeCompare(aDate);
            const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
          });
          const latestRep = (recs.length > 0 && recs[0].salesRep) ? recs[0].salesRep : (deal.representative || '未設定');

          recs.forEach(rd => {
            allSalesRecords.push({
              dealId: deal.id,
              companyName: deal.companyName || deal.productName || '',
              confirmedDate: rd.confirmedDate || rd.date || '',
              representative: latestRep,
              recordType: rd.recordType,
              budget: typeof rd.budget === 'string' ? Number(rd.budget) || 0 : rd.budget || 0,
              date: rd.date,
              phase: rd.phase,
            });
          });
        } catch (err) {
          // スキップ
        }
      }));

      setDeals(dealsList);
      setRawNewDeals(newDeals);
      setRawSalesRecords(allSalesRecords);
    } catch (error) {
      console.error('データ取得エラー:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 統計計算（新規案件リスト + 既存案件のsalesRecordsを合算）
  const calculateStats = useCallback((newDealsList, salesRecords, quarterKey) => {
    const quarter = getQuarterRange(quarterKey);
    const currentMonth = getCurrentMonthRange(quarterKey);
    const now = new Date();

    // ヘルパー: salesRecordsからrecordTypeと成約日で期間内レコードを抽出（confirmedDate優先、なければdate）
    const getRecordsInRange = (type, start, end) => {
      return salesRecords.filter(rec => {
        if (rec.recordType !== type) return false;
        if (rec.phase !== 'フェーズ8') return false;
        const d = rec.confirmedDate || rec.date;
        if (!d) return false;
        const recDate = new Date(d);
        return recDate >= start && recDate <= end;
      });
    };

    // デバッグ
    console.log('=== ダッシュボードデバッグ ===');
    console.log('四半期範囲:', quarter.start, '〜', quarter.end);
    console.log('salesRecords総数:', salesRecords.length);
    const phaseMap = {};
    salesRecords.forEach(r => { phaseMap[r.phase || '(空)'] = (phaseMap[r.phase || '(空)'] || 0) + 1; });
    console.log('phase別件数:', JSON.stringify(phaseMap));
    const phase8recs = salesRecords.filter(r => r.phase === 'フェーズ8');
    console.log('Phase8件数:', phase8recs.length);
    if (phase8recs.length > 0) {
      console.log('Phase8サンプル:', JSON.stringify(phase8recs[0]));
    }
    if (salesRecords.length > 0) {
      console.log('全レコードサンプル:', JSON.stringify(salesRecords[0]));
    }

    // 1. 四半期実績（新規・既存を分けて集計 — salesRecordsのbudgetベース）
    const quarterNewRecords = getRecordsInRange('新規', quarter.start, quarter.end);
    const quarterExistingRecords = getRecordsInRange('継続', quarter.start, quarter.end);
    const quarterTotalNew = quarterNewRecords.reduce((sum, rec) => sum + rec.budget, 0);
    const quarterTotalExisting = quarterExistingRecords.reduce((sum, rec) => sum + rec.budget, 0);
    setQuarterActualNew(quarterTotalNew);
    setQuarterActualExisting(quarterTotalExisting);

    // 2. 四半期売上見込み（担当者別）
    // = 新規案件フェーズ1-7 × 受注確率 ＋ salesRecords四半期実績（新規+継続）
    const repForecast = {};
    // パートA: 新規案件一覧のフェーズ1-7
    newDealsList.forEach(deal => {
      if (deal.status === '失注' || deal.status === 'Dead' || deal.status === 'フェーズ8') return;
      const rep = deal.representative || '未設定';
      const budget = deal.expectedBudget || 0;
      const probability = PHASE_PROBABILITY[deal.status] || 0;
      if (!repForecast[rep]) repForecast[rep] = 0;
      repForecast[rep] += budget * probability;
    });
    // パートB: salesRecordsの四半期実績（新規+継続）を加算
    [...quarterNewRecords, ...quarterExistingRecords].forEach(rec => {
      const rep = rec.representative;
      if (!repForecast[rep]) repForecast[rep] = 0;
      repForecast[rep] += rec.budget;
    });

    const colors = ['#3498db', '#e74c3c', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c'];
    const forecastData = Object.entries(repForecast).map(([name, value], index) => ({
      label: name,
      value: Math.round(value),
      color: colors[index % colors.length]
    })).sort((a, b) => b.value - a.value);
    setQuarterForecast(forecastData);

    // 3. 個人月間売上（salesRecords 新規+継続）
    const monthNewRecords = getRecordsInRange('新規', currentMonth.start, currentMonth.end);
    const monthExistingRecords = getRecordsInRange('継続', currentMonth.start, currentMonth.end);
    const repMonthlySales = {};
    [...monthNewRecords, ...monthExistingRecords].forEach(rec => {
      const rep = rec.representative;
      if (!repMonthlySales[rep]) repMonthlySales[rep] = 0;
      repMonthlySales[rep] += rec.budget;
    });

    const monthlySalesData = Object.entries(repMonthlySales).map(([name, amount]) => ({
      name,
      amount
    })).sort((a, b) => b.amount - a.amount);
    setMonthlyPersonalSales(monthlySalesData);

    // 3.26. 四半期内の月別売上（積み上げ棒グラフ用：新規+既存）
    const quarterMonths = [];
    const currentMonthIndex = now.getMonth();
    for (let i = 0; i < 3; i++) {
      const monthStart = new Date(quarter.start.getFullYear(), quarter.start.getMonth() + i, 1);
      const monthEnd = new Date(quarter.start.getFullYear(), quarter.start.getMonth() + i + 1, 0, 23, 59, 59);
      const monthIndex = monthStart.getMonth();
      const monthLabel = `${monthIndex + 1}月`;
      const isCurrentMonth = monthIndex === currentMonthIndex;

      const mNewRecs = getRecordsInRange('新規', monthStart, monthEnd);
      const mExistRecs = getRecordsInRange('継続', monthStart, monthEnd);
      const newSales = mNewRecs.reduce((sum, rec) => sum + rec.budget, 0);
      const existingSales = mExistRecs.reduce((sum, rec) => sum + rec.budget, 0);

      quarterMonths.push({
        label: monthLabel,
        newValue: newSales,
        existingValue: existingSales,
        value: newSales + existingSales,
        isCurrentMonth
      });
    }
    setQuarterMonthlyActual(quarterMonths);

    // 3.5. 個人四半期売上（担当者別）
    const repQuarterlySales = {};
    [...quarterNewRecords, ...quarterExistingRecords].forEach(rec => {
      const rep = rec.representative;
      if (!repQuarterlySales[rep]) repQuarterlySales[rep] = 0;
      repQuarterlySales[rep] += rec.budget;
    });

    const quarterlySalesData = Object.entries(repQuarterlySales).map(([name, amount]) => ({
      name,
      amount
    })).sort((a, b) => b.amount - a.amount);
    setQuarterlyPersonalSales(quarterlySalesData);

    // 4. 月内売上見込み（担当者別）
    // = 新規案件フェーズ1-7 × 受注確率 ＋ salesRecords月間実績（新規+継続）
    const repMonthForecast = {};
    newDealsList.forEach(deal => {
      if (deal.status === '失注' || deal.status === 'Dead' || deal.status === 'フェーズ8') return;
      const rep = deal.representative || '未設定';
      const budget = deal.expectedBudget || 0;
      const probability = PHASE_PROBABILITY[deal.status] || 0;
      if (!repMonthForecast[rep]) repMonthForecast[rep] = 0;
      repMonthForecast[rep] += budget * probability;
    });
    [...monthNewRecords, ...monthExistingRecords].forEach(rec => {
      const rep = rec.representative;
      if (!repMonthForecast[rep]) repMonthForecast[rep] = 0;
      repMonthForecast[rep] += rec.budget;
    });

    const monthForecastData = Object.entries(repMonthForecast).map(([name, value], index) => ({
      label: name,
      value: Math.round(value),
      color: colors[index % colors.length]
    })).sort((a, b) => b.value - a.value);
    setMonthForecast(monthForecastData);

    // 6. クライアント別獲得予算（四半期実績と同じロジック: confirmedDateベース）
    const allQuarterRecords = [...quarterNewRecords, ...quarterExistingRecords];
    const clientMap = {};
    allQuarterRecords.forEach(rec => {
      const name = rec.companyName || '不明';
      if (!clientMap[name]) clientMap[name] = { budget: 0, count: 0 };
      clientMap[name].budget += rec.budget;
      clientMap[name].count += 1;
    });
    const clientData = Object.entries(clientMap)
      .map(([name, data]) => ({ name, budget: data.budget, count: data.count }))
      .sort((a, b) => b.budget - a.budget);
    setClientBudgetSummary(clientData);

  }, []);

  useEffect(() => {
    fetchData();
    fetchStaffByRole('sales').then(staff => {
      setSalesRepList(staff.map(s => s.name));
    }).catch(err => console.error('営業者リスト取得エラー:', err));
  }, [fetchData, location.key]);

  // データ取得後 or 四半期変更時に再計算 + 目標再取得
  useEffect(() => {
    if (rawNewDeals.length > 0 || rawSalesRecords.length > 0) {
      calculateStats(rawNewDeals, rawSalesRecords, selectedQuarter);
    }
    fetchTarget();
  }, [selectedQuarter, rawNewDeals, rawSalesRecords]);

  // 担当者リストを取得（スタッフマスターから）
  const representativeList = useMemo(() => {
    const repsInData = new Set();
    deals.forEach(deal => {
      if (deal.representative) {
        repsInData.add(deal.representative);
      }
    });
    const allReps = salesRepList.length > 0 ? [...salesRepList] : [];
    repsInData.forEach(rep => {
      if (!allReps.includes(rep)) {
        allReps.push(rep);
      }
    });
    return allReps;
  }, [deals, salesRepList]);

  // 選択された担当者のサマリーデータを計算
  const representativeSummary = useMemo(() => {
    if (!selectedRepresentative) {
      return { totalCount: 0, phaseCounts: {}, phaseBudgets: {}, dealsList: [] };
    }

    // フェーズ2-7の案件をフィルタリング（7→2の順で定義）
    const targetPhases = ['フェーズ7', 'フェーズ6', 'フェーズ5', 'フェーズ4', 'フェーズ3', 'フェーズ2'];
    const filteredDeals = deals.filter(deal =>
      deal.representative === selectedRepresentative &&
      targetPhases.includes(deal.status)
    );

    // 件数
    const totalCount = filteredDeals.length;

    // フェーズごとの件数
    const phaseCounts = {};
    targetPhases.forEach(phase => {
      phaseCounts[phase] = 0;
    });
    filteredDeals.forEach(deal => {
      phaseCounts[deal.status] = (phaseCounts[deal.status] || 0) + 1;
    });

    // フェーズごとの予算合計
    const phaseBudgets = {};
    targetPhases.forEach(phase => {
      phaseBudgets[phase] = 0;
    });
    filteredDeals.forEach(deal => {
      phaseBudgets[deal.status] += deal.expectedBudget || 0;
    });

    // 案件一覧（7→2の順でソート）
    const dealsList = filteredDeals.map(deal => ({
      id: deal.id,
      companyName: deal.companyName || deal.productName,
      status: deal.status,
      expectedBudget: deal.expectedBudget || 0
    })).sort((a, b) => {
      // フェーズ順にソート（7→2）
      const phaseOrder = { 'フェーズ7': 1, 'フェーズ6': 2, 'フェーズ5': 3, 'フェーズ4': 4, 'フェーズ3': 5, 'フェーズ2': 6 };
      return (phaseOrder[a.status] || 99) - (phaseOrder[b.status] || 99);
    });

    return { totalCount, phaseCounts, phaseBudgets, dealsList };
  }, [deals, selectedRepresentative]);

  if (isLoading) {
    return (
      <DashboardContainer>
        <LoadingMessage>データを読み込み中...</LoadingMessage>
      </DashboardContainer>
    );
  }

  const quarter = getQuarterRange(selectedQuarter);
  const currentMonth = getCurrentMonthRange(selectedQuarter);

  return (
    <DashboardContainer>
      <Header>
        <Title>営業ダッシュボード（新規+既存）</Title>
        <select
          value={selectedQuarter}
          onChange={(e) => setSelectedQuarter(e.target.value)}
          style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.9rem', background: 'white' }}
        >
          {quarterOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </Header>

      {/* 1行目: 四半期実績 & 月間実績 */}
      <GridContainer>
        <Card>
          <CardTitle>
            <FiTarget />
            チーム全体四半期売上実績（{quarter.label}）
            <EditButton onClick={openTargetModal} title="目標値を編集">
              <FiEdit2 size={16} />
            </EditButton>
          </CardTitle>
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {[
              { label: '合計', actual: quarterActualNew + quarterActualExisting, target: newQuarterTarget + existingQuarterTarget, color: '#2c3e50' },
              { label: '新規', actual: quarterActualNew, target: newQuarterTarget, color: '#3498db' },
              { label: '既存', actual: quarterActualExisting, target: existingQuarterTarget, color: '#27ae60' },
            ].map(({ label, actual, target, color }) => {
              const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
              const barWidth = Math.min(pct, 100);
              return (
                <div key={label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '0.9rem', color }}>{label}</span>
                    <span style={{ fontSize: '0.8rem', color: '#666' }}>
                      <span style={{ fontWeight: 'bold', color }}>{pct}%</span>
                      {' '}{formatCurrency(actual)} / {formatCurrency(target)}
                    </span>
                  </div>
                  <div style={{ height: '20px', background: '#e9ecef', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${barWidth}%`,
                      height: '100%',
                      background: color,
                      borderRadius: '4px',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardTitle>
            <FiBarChart />
            四半期内月別売上実績（{quarter.label}）
          </CardTitle>
          <div style={{ padding: '1rem' }}>
            {/* 積み上げ棒グラフ（新規=青、既存=緑） */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '1rem' }}>
              {quarterMonthlyActual.map((month, index) => {
                const maxValue = Math.max(...quarterMonthlyActual.map(m => m.value), 1);
                const totalHeight = Math.max((month.value / maxValue) * 150, 15);
                const newHeight = month.value > 0 ? (month.newValue / month.value) * totalHeight : 0;
                const existingHeight = month.value > 0 ? (month.existingValue / month.value) * totalHeight : 0;
                return (
                  <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, maxWidth: '120px' }}>
                    <div style={{
                      fontSize: '0.85rem',
                      fontWeight: 'bold',
                      color: month.isCurrentMonth ? '#2c3e50' : '#666',
                      marginBottom: '0.5rem'
                    }}>
                      {formatCurrency(month.value)}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '150px' }}>
                      {/* 既存（上段・緑） */}
                      {existingHeight > 0 && (
                        <div style={{
                          width: '60px',
                          height: `${existingHeight}px`,
                          background: '#2ecc71',
                          borderRadius: newHeight > 0 ? '4px 4px 0 0' : '4px 4px 0 0',
                          transition: 'all 0.3s ease'
                        }} />
                      )}
                      {/* 新規（下段・青） */}
                      {newHeight > 0 && (
                        <div style={{
                          width: '60px',
                          height: `${newHeight}px`,
                          background: '#3498db',
                          borderRadius: existingHeight > 0 ? '0' : '4px 4px 0 0',
                          transition: 'all 0.3s ease'
                        }} />
                      )}
                      {month.value === 0 && (
                        <div style={{ width: '60px', height: '15px', background: '#e0e0e0', borderRadius: '4px 4px 0 0' }} />
                      )}
                    </div>
                    <div style={{
                      marginTop: '0.5rem',
                      fontWeight: month.isCurrentMonth ? 'bold' : 'normal',
                      color: month.isCurrentMonth ? '#2c3e50' : '#666',
                      fontSize: month.isCurrentMonth ? '1rem' : '0.9rem'
                    }}>
                      {month.label}
                      {month.isCurrentMonth && <span style={{ fontSize: '0.75rem', marginLeft: '2px' }}>★</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* 凡例 */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
              <span><span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#3498db', borderRadius: '2px', marginRight: '4px', verticalAlign: 'middle' }}></span>新規</span>
              <span><span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#2ecc71', borderRadius: '2px', marginRight: '4px', verticalAlign: 'middle' }}></span>既存</span>
            </div>
            <TotalRow>
              <span>四半期合計</span>
              <span>{formatCurrency(quarterMonthlyActual.reduce((sum, m) => sum + m.value, 0))}</span>
            </TotalRow>
          </div>
        </Card>
      </GridContainer>

      {/* 2行目: 四半期見込み & 月間見込み */}
      <GridContainer>
        <Card>
          <CardTitle>
            <FiTrendingUp />
            チーム全体四半期売上見込み（担当者別）
          </CardTitle>
          <PieChart data={quarterForecast} />
          <TotalRow>
            <span>合計見込み</span>
            <span>{formatCurrency(quarterForecast.reduce((sum, item) => sum + item.value, 0))}</span>
          </TotalRow>
        </Card>

        <Card>
          <CardTitle>
            <FiBarChart />
            チーム全体月間売上見込み（{currentMonth.label}）
          </CardTitle>
          <PieChart data={monthForecast} />
          <TotalRow>
            <span>合計見込み</span>
            <span>{formatCurrency(monthForecast.reduce((sum, item) => sum + item.value, 0))}</span>
          </TotalRow>
        </Card>
      </GridContainer>

      {/* 3行目: 個人四半期売上 & 個人月間売上 */}
      <GridContainer>
        <Card>
          <CardTitle>
            <FiDollarSign />
            個人四半期売上（{quarter.label}）
          </CardTitle>
          <Table>
            <thead>
              <tr>
                <Th>担当者</Th>
                <Th style={{ textAlign: 'right' }}>売上額</Th>
              </tr>
            </thead>
            <tbody>
              {quarterlyPersonalSales.length > 0 ? (
                quarterlyPersonalSales.map((person, index) => (
                  <tr key={index}>
                    <Td>{person.name}</Td>
                    <Td style={{ textAlign: 'right' }}>{formatCurrency(person.amount)}</Td>
                  </tr>
                ))
              ) : (
                <tr>
                  <Td colSpan={2} style={{ textAlign: 'center', color: '#999' }}>
                    この四半期の確定売上はありません
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
          <TotalRow>
            <span>合計</span>
            <span>{formatCurrency(quarterlyPersonalSales.reduce((sum, p) => sum + p.amount, 0))}</span>
          </TotalRow>
        </Card>

        <Card>
          <CardTitle>
            <FiUsers />
            個人月間売上（{currentMonth.label}）
          </CardTitle>
          <Table>
            <thead>
              <tr>
                <Th>担当者</Th>
                <Th style={{ textAlign: 'right' }}>確定金額</Th>
              </tr>
            </thead>
            <tbody>
              {monthlyPersonalSales.length > 0 ? (
                monthlyPersonalSales.map((person, index) => (
                  <tr key={index}>
                    <Td>{person.name}</Td>
                    <Td style={{ textAlign: 'right' }}>{formatCurrency(person.amount)}</Td>
                  </tr>
                ))
              ) : (
                <tr>
                  <Td colSpan={2} style={{ textAlign: 'center', color: '#999' }}>
                    今月の確定売上はありません
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
          <TotalRow>
            <span>合計</span>
            <span>{formatCurrency(monthlyPersonalSales.reduce((sum, p) => sum + p.amount, 0))}</span>
          </TotalRow>
        </Card>
      </GridContainer>

      {/* クライアント別獲得予算 */}
      <FullWidthContainer>
        <Card>
          <CardTitle>
            <FiDollarSign />
            クライアント別獲得予算（{quarter.label}）
          </CardTitle>
          {clientBudgetSummary.length > 0 ? (
            <div style={{ padding: '0 1rem 1rem' }}>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                <DealListTable>
                  <thead>
                    <tr>
                      <DealListTh>クライアント</DealListTh>
                      <DealListTh style={{ textAlign: 'right' }}>獲得予算</DealListTh>
                      <DealListTh style={{ textAlign: 'right' }}>件数</DealListTh>
                    </tr>
                  </thead>
                  <tbody>
                    {clientBudgetSummary.map(client => (
                      <tr key={client.name}>
                        <DealListTd>{client.name}</DealListTd>
                        <DealListTd style={{ textAlign: 'right', fontWeight: 'bold', color: '#27ae60' }}>{formatCurrency(client.budget)}</DealListTd>
                        <DealListTd style={{ textAlign: 'right' }}>{client.count}件</DealListTd>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #e9ecef', fontWeight: 'bold' }}>
                      <DealListTd>合計</DealListTd>
                      <DealListTd style={{ textAlign: 'right', color: '#2c3e50' }}>{formatCurrency(clientBudgetSummary.reduce((sum, c) => sum + c.budget, 0))}</DealListTd>
                      <DealListTd style={{ textAlign: 'right' }}>{clientBudgetSummary.reduce((sum, c) => sum + c.count, 0)}件</DealListTd>
                    </tr>
                  </tfoot>
                </DealListTable>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>
              該当期間の成約案件がありません
            </div>
          )}
        </Card>
      </FullWidthContainer>

      {/* 担当者別案件サマリー */}
      <FullWidthContainer>
        <Card>
          <CardTitle>
            <FiUser />
            担当者別案件サマリー（フェーズ2〜7）
          </CardTitle>
          <SelectWrapper>
            <SelectLabel>担当者を選択:</SelectLabel>
            <Select
              value={selectedRepresentative}
              onChange={(e) => setSelectedRepresentative(e.target.value)}
            >
              <option value="">-- 選択してください --</option>
              {representativeList.map(rep => (
                <option key={rep} value={rep}>{rep}</option>
              ))}
            </Select>
          </SelectWrapper>

          {selectedRepresentative ? (
            <PersonSummaryContainer>
              {/* 左: フェーズ別案件数（逆ピラミッド型ファネル） */}
              <SummaryBox>
                <SummaryTitle>フェーズ別 案件数</SummaryTitle>
                <FunnelContainer>
                  {['フェーズ2', 'フェーズ3', 'フェーズ4', 'フェーズ5', 'フェーズ6', 'フェーズ7'].map((phase, index, arr) => {
                    const count = representativeSummary.phaseCounts[phase] || 0;
                    // 逆ピラミッド: フェーズ2が上（広い）、フェーズ7が下（狭い）、傾斜を緩やかに
                    const widthPercent = 100 - (index * 6);
                    const nextWidthPercent = index < arr.length - 1 ? 100 - ((index + 1) * 6) : widthPercent - 6;
                    const topIndent = (100 - widthPercent) / 2;
                    const bottomIndent = (100 - nextWidthPercent) / 2;
                    return (
                      <FunnelRow key={phase}>
                        <FunnelBar
                          color={STATUS_COLORS[phase]}
                          topLeft={topIndent}
                          bottomLeft={bottomIndent}
                          style={{ width: '100%' }}
                        >
                          {phase}: {count}件
                        </FunnelBar>
                      </FunnelRow>
                    );
                  })}
                </FunnelContainer>
                <div style={{ textAlign: 'center', marginTop: '0.5rem', fontWeight: 'bold', color: '#2c3e50' }}>
                  合計: {representativeSummary.totalCount}件
                </div>
              </SummaryBox>

              {/* 中央: フェーズ別予算合計（逆ピラミッド型ファネル） */}
              <SummaryBox>
                <SummaryTitle>フェーズ別 想定予算合計</SummaryTitle>
                <FunnelContainer>
                  {['フェーズ2', 'フェーズ3', 'フェーズ4', 'フェーズ5', 'フェーズ6', 'フェーズ7'].map((phase, index, arr) => {
                    const budget = representativeSummary.phaseBudgets[phase] || 0;
                    // 逆ピラミッド: フェーズ2が上（広い）、フェーズ7が下（狭い）、傾斜を緩やかに
                    const widthPercent = 100 - (index * 6);
                    const nextWidthPercent = index < arr.length - 1 ? 100 - ((index + 1) * 6) : widthPercent - 6;
                    const topIndent = (100 - widthPercent) / 2;
                    const bottomIndent = (100 - nextWidthPercent) / 2;
                    return (
                      <FunnelRow key={phase}>
                        <FunnelBar
                          color={STATUS_COLORS[phase]}
                          topLeft={topIndent}
                          bottomLeft={bottomIndent}
                          style={{ width: '100%' }}
                        >
                          {phase}: {formatCurrency(budget)}
                        </FunnelBar>
                      </FunnelRow>
                    );
                  })}
                </FunnelContainer>
                <div style={{ textAlign: 'center', marginTop: '0.5rem', fontWeight: 'bold', color: '#27ae60' }}>
                  合計: {formatCurrency(Object.values(representativeSummary.phaseBudgets).reduce((sum, v) => sum + v, 0))}
                </div>
              </SummaryBox>

              {/* 右: 案件一覧 */}
              <SummaryBox>
                <SummaryTitle>案件一覧</SummaryTitle>
                {representativeSummary.dealsList.length > 0 ? (
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    <DealListTable>
                      <thead>
                        <tr>
                          <DealListTh>会社名</DealListTh>
                          <DealListTh>フェーズ <PhaseTooltip /></DealListTh>
                          <DealListTh style={{ textAlign: 'right' }}>想定予算</DealListTh>
                        </tr>
                      </thead>
                      <tbody>
                        {representativeSummary.dealsList.map(deal => (
                          <tr key={deal.id}>
                            <DealListTd>{deal.companyName}</DealListTd>
                            <DealListTd>
                              <PhaseBadge color={STATUS_COLORS[deal.status]}>{deal.status}</PhaseBadge>
                            </DealListTd>
                            <DealListTd style={{ textAlign: 'right' }}>{formatCurrency(deal.expectedBudget)}</DealListTd>
                          </tr>
                        ))}
                      </tbody>
                    </DealListTable>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', color: '#999', padding: '1rem' }}>
                    該当する案件がありません
                  </div>
                )}
              </SummaryBox>
            </PersonSummaryContainer>
          ) : (
            <div style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>
              担当者を選択すると、フェーズ2〜7の案件サマリーが表示されます
            </div>
          )}
        </Card>
      </FullWidthContainer>

      {/* 目標編集モーダル */}
      {showTargetModal && (
        <Modal onClick={() => setShowTargetModal(false)}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <ModalTitle>四半期目標を編集（{quarter.label}）</ModalTitle>
            <div style={{ marginBottom: '0.5rem', color: '#3498db', fontWeight: 'bold' }}>
              新規案件の目標
            </div>
            <ModalInput
              type="number"
              value={editingNewTarget}
              onChange={(e) => setEditingNewTarget(e.target.value)}
              placeholder="新規目標金額（例: 10000000）"
              min="0"
            />
            <div style={{ marginBottom: '0.5rem', color: '#2ecc71', fontWeight: 'bold' }}>
              既存案件の目標
            </div>
            <ModalInput
              type="number"
              value={editingExistingTarget}
              onChange={(e) => setEditingExistingTarget(e.target.value)}
              placeholder="既存目標金額（例: 5000000）"
              min="0"
            />
            <div style={{ fontSize: '0.85rem', color: '#999', marginBottom: '1rem' }}>
              合計目標: {formatCurrency((parseInt(editingNewTarget) || 0) + (parseInt(editingExistingTarget) || 0))}
            </div>
            <ModalButtons>
              <ModalButton className="cancel" onClick={() => setShowTargetModal(false)}>
                キャンセル
              </ModalButton>
              <ModalButton className="save" onClick={saveTarget}>
                保存
              </ModalButton>
            </ModalButtons>
          </ModalContent>
        </Modal>
      )}
    </DashboardContainer>
  );
}

export default HomeDashboard;
