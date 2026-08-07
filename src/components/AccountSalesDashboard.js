import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { FiTarget, FiTrendingUp, FiBarChart, FiUsers, FiAlertTriangle, FiEdit2, FiDollarSign, FiUser, FiPlus, FiList } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, getDocs, doc, getDoc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { STATUS_COLORS } from '../data/constants.js';
import { fetchStaffByRole } from '../services/staffService.js';
import { addSalesRecord } from '../services/projectService.js';

/**
 * アカウント営業（増田管轄の大型自主提案）専用ダッシュボード。
 * NewDealsDashboard.jsと同じセクション構成を、salesTrack==='account'の案件だけに絞って表示する。
 * 案件数が少なく大型な提案が中心のため、フェーズ別の受注確率(PHASE_PROBABILITY)はソリューション営業の
 * 値を暫定流用している。実態と乖離する場合はここの値だけを調整すればよい。
 */
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
`;

const Title = styled.h2`
  color: var(--color-text-primary);
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
`;

const LinkButton = styled(Link)`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  color: #2c3e50;
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;

  &:hover { background: #f8f9fa; }
`;

const PrimaryButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  background: #3498db;
  color: white;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;

  &:hover { background: #2980b9; }
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

const EditButton = styled.button`
  background: none;
  border: none;
  color: #3498db;
  cursor: pointer;
  padding: 0.25rem;
  margin-left: 0.5rem;
  display: inline-flex;
  align-items: center;

  &:hover { color: #2980b9; }
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
  width: 420px;
  max-width: 90%;
  max-height: 85vh;
  overflow-y: auto;
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
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: #3498db;
  }
`;

const ModalSelect = styled.select`
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  margin-bottom: 1rem;
  background: white;
  box-sizing: border-box;
`;

const ModalLabel = styled.div`
  font-size: 0.85rem;
  font-weight: 600;
  color: #495057;
  margin-bottom: 0.35rem;
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

  &.cancel { background: #95a5a6; color: white; }
  &.save { background: #27ae60; color: white; }
  &:hover { opacity: 0.9; }
`;

// ユーティリティ
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
    const endMonth = (q - 1) * 3 + 2;
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
      options.push({ value: `${y}-Q${q}`, label: `${y}年 Q${q}（${(q - 1) * 3 + 1}〜${q * 3}月）` });
    }
  }
  return { options, current: `${currentYear}-Q${currentQ}` };
};

const MeterGauge = ({ value, target, label }) => {
  const displayPercentage = target > 0 ? Math.round((value / target) * 100) : 0;
  const clampedPercent = Math.min(Math.max(displayPercentage, 0), 100);
  const radius = 80;
  const centerX = 100;
  const centerY = 100;
  const arcPath = `M ${centerX - radius} ${centerY} A ${radius} ${radius} 0 1 1 ${centerX + radius} ${centerY}`;
  const totalLength = Math.PI * radius;
  const filledLength = (clampedPercent / 100) * totalLength;

  let color = '#27ae60';
  if (displayPercentage < 50) color = '#e74c3c';
  else if (displayPercentage < 80) color = '#f39c12';

  return (
    <MeterContainer>
      <MeterSvg viewBox="0 0 200 120">
        <path d={arcPath} fill="none" stroke="#e0e0e0" strokeWidth="16" strokeLinecap="round" />
        {clampedPercent > 0 && (
          <path d={arcPath} fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${filledLength} ${totalLength}`} />
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

const PieChart = ({ data }) => {
  const filteredData = data.filter(item => item.value > 0);
  const total = filteredData.reduce((sum, item) => sum + item.value, 0);

  if (total === 0 || filteredData.length === 0) {
    return (
      <PieChartContainer>
        <div style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>データなし</div>
      </PieChartContainer>
    );
  }

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

  let currentAngle = -Math.PI / 2;
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

    if (percentage >= 0.999) {
      return <circle key={index} cx="90" cy="90" r="70" fill={item.color} />;
    }

    return (
      <path key={index} d={`M 90 90 L ${x1} ${y1} A 70 70 0 ${largeArcFlag} 1 ${x2} ${y2} Z`} fill={item.color} />
    );
  });

  return (
    <PieChartContainer>
      <PieSvg viewBox="0 0 180 180">{paths}</PieSvg>
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

function AccountSalesDashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [deals, setDeals] = useState([]);
  const [rawSalesRecords, setRawSalesRecords] = useState([]);
  const [quarterTarget, setQuarterTarget] = useState(10000000);
  const [selectedRepresentative, setSelectedRepresentative] = useState('');
  const { options: quarterOptions, current: currentQuarterKey } = useMemo(() => generateQuarterOptions(), []);
  const [selectedQuarter, setSelectedQuarter] = useState(currentQuarterKey);
  const [salesRepList, setSalesRepList] = useState([]);

  const [quarterActual, setQuarterActual] = useState(0);
  const [quarterForecast, setQuarterForecast] = useState([]);
  const [quarterlyPersonalSales, setQuarterlyPersonalSales] = useState([]);
  const [quarterMonthlyActual, setQuarterMonthlyActual] = useState([]);
  const [monthlyPersonalSales, setMonthlyPersonalSales] = useState([]);
  const [monthForecast, setMonthForecast] = useState([]);
  const [stagnantDeals, setStagnantDeals] = useState([]);

  const [showTargetModal, setShowTargetModal] = useState(false);
  const [editingTarget, setEditingTarget] = useState('');

  // 新規登録モーダル
  const [showAddModal, setShowAddModal] = useState(false);
  const [keyAccounts, setKeyAccounts] = useState([]);
  const [addForm, setAddForm] = useState({
    companyName: '', productName: '', representative: '増田', expectedBudget: ''
  });
  const [isSaving, setIsSaving] = useState(false);

  const getQuarterKey = () => `${selectedQuarter}-account`;

  const fetchTarget = useCallback(async () => {
    try {
      const targetRef = doc(db, 'salesTargets', getQuarterKey());
      const targetDoc = await getDoc(targetRef);
      if (targetDoc.exists()) {
        setQuarterTarget(targetDoc.data().target || 10000000);
      }
    } catch (error) {
      console.error('目標値取得エラー:', error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuarter]);

  const saveTarget = async () => {
    try {
      const targetValue = parseInt(editingTarget) || 0;
      await setDoc(doc(db, 'salesTargets', getQuarterKey()), {
        target: targetValue,
        updatedAt: new Date()
      });
      setQuarterTarget(targetValue);
      setShowTargetModal(false);
    } catch (error) {
      console.error('目標値保存エラー:', error);
      alert('保存に失敗しました');
    }
  };

  const openTargetModal = () => {
    setEditingTarget(quarterTarget.toString());
    setShowTargetModal(true);
  };

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const progressRef = collection(db, 'progressDashboard');
      const querySnapshot = await getDocs(progressRef);

      const dealsList = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.salesTrack !== 'account') return;
        dealsList.push({
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt)
        });
      });

      // 案件登録モーダルからの新規作成はisExistingProject:falseだが、既存案件を後からアカウント営業に
      // 分類し直すケースもあるため、他のダッシュボードと同じくisExistingProjectで読み分ける
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
              companyName: deal.companyName || '',
              productName: deal.productName || '',
              confirmedDate: rd.confirmedDate || rd.date || '',
              representative: latestRep,
              recordType: rd.recordType,
              budget: typeof rd.budget === 'string' ? Number(rd.budget) || 0 : rd.budget || 0,
              date: rd.date,
              phase: rd.phase,
            });
          });
        } catch (err) {
          // サブコレクション取得失敗時はスキップ
        }
      }));

      setDeals(dealsList);
      setRawSalesRecords(allSalesRecords);
    } catch (error) {
      console.error('データ取得エラー:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const calculateStats = useCallback((dealsList, salesRecords, quarterKey) => {
    const quarter = getQuarterRange(quarterKey);
    const currentMonth = getCurrentMonthRange(quarterKey);
    const now = new Date();

    const getRecordsInRange = (start, end) => {
      return salesRecords.filter(rec => {
        if (rec.phase !== 'フェーズ8') return false;
        const d = rec.confirmedDate || rec.date;
        if (!d) return false;
        const recDate = new Date(d);
        return recDate >= start && recDate <= end;
      });
    };

    const quarterRecords = getRecordsInRange(quarter.start, quarter.end);
    const quarterTotal = quarterRecords.reduce((sum, rec) => sum + rec.budget, 0);
    setQuarterActual(quarterTotal);

    const colors = ['#3498db', '#e74c3c', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c'];

    const repForecast = {};
    dealsList.forEach(deal => {
      if (deal.status === '失注' || deal.status === 'Dead' || deal.status === 'フェーズ8') return;
      const rep = deal.representative || '未設定';
      const budget = deal.expectedBudget || 0;
      const probability = PHASE_PROBABILITY[deal.status] || 0;
      if (!repForecast[rep]) repForecast[rep] = 0;
      repForecast[rep] += budget * probability;
    });
    quarterRecords.forEach(rec => {
      const rep = rec.representative;
      if (!repForecast[rep]) repForecast[rep] = 0;
      repForecast[rep] += rec.budget;
    });
    setQuarterForecast(Object.entries(repForecast).map(([name, value], index) => ({
      label: name, value: Math.round(value), color: colors[index % colors.length]
    })).sort((a, b) => b.value - a.value));

    const monthRecords = getRecordsInRange(currentMonth.start, currentMonth.end);
    const repMonthlySales = {};
    monthRecords.forEach(rec => {
      const rep = rec.representative;
      if (!repMonthlySales[rep]) repMonthlySales[rep] = 0;
      repMonthlySales[rep] += rec.budget;
    });
    setMonthlyPersonalSales(Object.entries(repMonthlySales).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount));

    const quarterMonths = [];
    const currentMonthIndex = now.getMonth();
    for (let i = 0; i < 3; i++) {
      const monthStart = new Date(quarter.start.getFullYear(), quarter.start.getMonth() + i, 1);
      const monthEnd = new Date(quarter.start.getFullYear(), quarter.start.getMonth() + i + 1, 0, 23, 59, 59);
      const monthIndex = monthStart.getMonth();
      const monthRecs = getRecordsInRange(monthStart, monthEnd);
      quarterMonths.push({
        label: `${monthIndex + 1}月`,
        value: monthRecs.reduce((sum, rec) => sum + rec.budget, 0),
        isCurrentMonth: monthIndex === currentMonthIndex
      });
    }
    setQuarterMonthlyActual(quarterMonths);

    const repQuarterlySales = {};
    quarterRecords.forEach(rec => {
      const rep = rec.representative;
      if (!repQuarterlySales[rep]) repQuarterlySales[rep] = 0;
      repQuarterlySales[rep] += rec.budget;
    });
    setQuarterlyPersonalSales(Object.entries(repQuarterlySales).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount));

    const repMonthForecast = {};
    dealsList.forEach(deal => {
      if (deal.status === '失注' || deal.status === 'Dead' || deal.status === 'フェーズ8') return;
      const rep = deal.representative || '未設定';
      const budget = deal.expectedBudget || 0;
      const probability = PHASE_PROBABILITY[deal.status] || 0;
      if (!repMonthForecast[rep]) repMonthForecast[rep] = 0;
      repMonthForecast[rep] += budget * probability;
    });
    monthRecords.forEach(rec => {
      const rep = rec.representative;
      if (!repMonthForecast[rep]) repMonthForecast[rep] = 0;
      repMonthForecast[rep] += rec.budget;
    });
    setMonthForecast(Object.entries(repMonthForecast).map(([name, value], index) => ({
      label: name, value: Math.round(value), color: colors[index % colors.length]
    })).sort((a, b) => b.value - a.value));

    const stagnant = salesRecords
      .filter(rec => {
        if (rec.phase === 'フェーズ8' || rec.phase === '失注' || rec.phase === 'Dead') return false;
        if (!rec.date) return false;
        const recDate = new Date(rec.date);
        const daysDiff = Math.floor((now - recDate) / (1000 * 60 * 60 * 24));
        return daysDiff >= 90;
      })
      .map(rec => {
        const recDate = new Date(rec.date);
        return {
          id: rec.dealId,
          companyName: rec.companyName,
          productName: rec.productName,
          daysElapsed: Math.floor((now - recDate) / (1000 * 60 * 60 * 24)),
          expectedBudget: rec.budget
        };
      })
      .sort((a, b) => b.daysElapsed - a.daysElapsed);
    setStagnantDeals(stagnant);
  }, []);

  const fetchKeyAccounts = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'keyAccounts'));
      const list = [];
      snapshot.forEach(docSnap => list.push({ id: docSnap.id, ...docSnap.data() }));
      setKeyAccounts(list);
    } catch (error) {
      console.error('対象企業リスト取得エラー:', error);
    }
  };

  useEffect(() => {
    fetchData();
    fetchKeyAccounts();
    fetchStaffByRole('sales').then(staff => {
      setSalesRepList(staff.map(s => s.name));
    }).catch(err => console.error('営業者リスト取得エラー:', err));
  }, [fetchData]);

  useEffect(() => {
    calculateStats(deals, rawSalesRecords, selectedQuarter);
    fetchTarget();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuarter, deals, rawSalesRecords]);

  const representativeList = useMemo(() => {
    const repsInData = new Set();
    deals.forEach(deal => { if (deal.representative) repsInData.add(deal.representative); });
    const allReps = salesRepList.length > 0 ? [...salesRepList] : [];
    repsInData.forEach(rep => { if (!allReps.includes(rep)) allReps.push(rep); });
    if (allReps.length === 0) allReps.push('増田');
    return allReps;
  }, [deals, salesRepList]);

  const representativeSummary = useMemo(() => {
    if (!selectedRepresentative) return { totalCount: 0, phaseCounts: {}, phaseBudgets: {}, dealsList: [] };
    const targetPhases = ['フェーズ7', 'フェーズ6', 'フェーズ5', 'フェーズ4', 'フェーズ3', 'フェーズ2'];
    const filteredDeals = deals.filter(deal => deal.representative === selectedRepresentative && targetPhases.includes(deal.status));
    const phaseCounts = {};
    const phaseBudgets = {};
    targetPhases.forEach(phase => { phaseCounts[phase] = 0; phaseBudgets[phase] = 0; });
    filteredDeals.forEach(deal => {
      phaseCounts[deal.status] = (phaseCounts[deal.status] || 0) + 1;
      phaseBudgets[deal.status] += deal.expectedBudget || 0;
    });
    const dealsList = filteredDeals.map(deal => ({
      id: deal.id, companyName: deal.companyName || '', productName: deal.productName || '',
      status: deal.status, expectedBudget: deal.expectedBudget || 0
    })).sort((a, b) => {
      const phaseOrder = { 'フェーズ7': 1, 'フェーズ6': 2, 'フェーズ5': 3, 'フェーズ4': 4, 'フェーズ3': 5, 'フェーズ2': 6 };
      return (phaseOrder[a.status] || 99) - (phaseOrder[b.status] || 99);
    });
    return { totalCount: filteredDeals.length, phaseCounts, phaseBudgets, dealsList };
  }, [deals, selectedRepresentative]);

  const handleAddDeal = async () => {
    if (!addForm.companyName || !addForm.productName.trim()) return;
    setIsSaving(true);
    try {
      const newDeal = {
        companyName: addForm.companyName,
        productName: addForm.productName.trim(),
        representative: addForm.representative || '増田',
        status: 'フェーズ1',
        expectedBudget: addForm.expectedBudget ? Number(addForm.expectedBudget) : null,
        isExistingProject: false,
        salesTrack: 'account',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      const docRef = await addDoc(collection(db, 'progressDashboard'), newDeal);

      const today = new Date().toISOString().split('T')[0];
      await addSalesRecord(docRef.id, {
        phase: 'フェーズ1',
        budget: addForm.expectedBudget ? Number(addForm.expectedBudget) : '',
        salesRep: addForm.representative || '増田',
        operatorRep: '',
        date: today,
        startDate: '',
        endDate: '',
        recordType: '新規',
        createdAt: new Date()
      }, 'newCaseSalesRecords');

      setShowAddModal(false);
      setAddForm({ companyName: '', productName: '', representative: '増田', expectedBudget: '' });
      await fetchData();
    } catch (error) {
      console.error('案件の追加に失敗しました:', error);
      alert('案件の追加に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectKeyAccount = (companyName) => {
    const account = keyAccounts.find(a => a.companyName === companyName);
    setAddForm(prev => ({
      ...prev,
      companyName,
      productName: account?.proposalTheme || prev.productName
    }));
  };

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
        <Title>アカウント営業ダッシュボード</Title>
        <HeaderActions>
          <select
            value={selectedQuarter}
            onChange={(e) => setSelectedQuarter(e.target.value)}
            style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #ddd', fontSize: '0.9rem', background: 'white' }}
          >
            {quarterOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <LinkButton to="/key-accounts">
            <FiList />
            対象企業リストを管理
          </LinkButton>
          <PrimaryButton onClick={() => setShowAddModal(true)}>
            <FiPlus />
            案件を登録
          </PrimaryButton>
        </HeaderActions>
      </Header>

      <GridContainer>
        <Card>
          <CardTitle>
            <FiTarget />
            四半期売上実績（{quarter.label}）
            <EditButton onClick={openTargetModal} title="目標値を編集">
              <FiEdit2 size={16} />
            </EditButton>
          </CardTitle>
          <MeterGauge value={quarterActual} target={quarterTarget} label="目標達成率" />
        </Card>

        <Card>
          <CardTitle>
            <FiBarChart />
            四半期内月別売上実績（{quarter.label}）
          </CardTitle>
          <div style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '1rem' }}>
              {quarterMonthlyActual.map((month, index) => {
                const maxValue = Math.max(...quarterMonthlyActual.map(m => m.value), 1);
                const heightPercent = (month.value / maxValue) * 100;
                const barHeight = Math.max(heightPercent * 1.5, 15);
                return (
                  <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, maxWidth: '120px' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: month.isCurrentMonth ? '#27ae60' : '#666', marginBottom: '0.5rem' }}>
                      {formatCurrency(month.value)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', height: '150px' }}>
                      <div style={{
                        width: '60px',
                        height: `${barHeight}px`,
                        minHeight: '30px',
                        background: month.isCurrentMonth ? 'linear-gradient(180deg, #27ae60 0%, #219a52 100%)' : 'linear-gradient(180deg, #bdc3c7 0%, #95a5a6 100%)',
                        borderRadius: '4px 4px 0 0'
                      }} />
                    </div>
                    <div style={{ marginTop: '0.5rem', fontWeight: month.isCurrentMonth ? 'bold' : 'normal', color: month.isCurrentMonth ? '#27ae60' : '#666' }}>
                      {month.label}{month.isCurrentMonth && <span style={{ fontSize: '0.75rem', marginLeft: '2px' }}>★</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <TotalRow>
              <span>四半期合計</span>
              <span>{formatCurrency(quarterMonthlyActual.reduce((sum, m) => sum + m.value, 0))}</span>
            </TotalRow>
          </div>
        </Card>
      </GridContainer>

      <GridContainer>
        <Card>
          <CardTitle>
            <FiTrendingUp />
            四半期売上見込み（担当者別）
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
            月間売上見込み（{currentMonth.label}）
          </CardTitle>
          <PieChart data={monthForecast} />
          <TotalRow>
            <span>合計見込み</span>
            <span>{formatCurrency(monthForecast.reduce((sum, item) => sum + item.value, 0))}</span>
          </TotalRow>
        </Card>
      </GridContainer>

      <GridContainer>
        <Card>
          <CardTitle>
            <FiDollarSign />
            個人四半期売上（{quarter.label}）
          </CardTitle>
          <Table>
            <thead><tr><Th>担当者</Th><Th style={{ textAlign: 'right' }}>売上額</Th></tr></thead>
            <tbody>
              {quarterlyPersonalSales.length > 0 ? quarterlyPersonalSales.map((person, index) => (
                <tr key={index}><Td>{person.name}</Td><Td style={{ textAlign: 'right' }}>{formatCurrency(person.amount)}</Td></tr>
              )) : (
                <tr><Td colSpan={2} style={{ textAlign: 'center', color: '#999' }}>この四半期の確定売上はありません</Td></tr>
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
            <thead><tr><Th>担当者</Th><Th style={{ textAlign: 'right' }}>確定金額</Th></tr></thead>
            <tbody>
              {monthlyPersonalSales.length > 0 ? monthlyPersonalSales.map((person, index) => (
                <tr key={index}><Td>{person.name}</Td><Td style={{ textAlign: 'right' }}>{formatCurrency(person.amount)}</Td></tr>
              )) : (
                <tr><Td colSpan={2} style={{ textAlign: 'center', color: '#999' }}>今月の確定売上はありません</Td></tr>
              )}
            </tbody>
          </Table>
          <TotalRow>
            <span>合計</span>
            <span>{formatCurrency(monthlyPersonalSales.reduce((sum, p) => sum + p.amount, 0))}</span>
          </TotalRow>
        </Card>
      </GridContainer>

      <FullWidthContainer>
        <Card>
          <CardTitle>
            <FiUser />
            担当者別案件サマリー（フェーズ2〜7）
          </CardTitle>
          <SelectWrapper>
            <SelectLabel>担当者を選択:</SelectLabel>
            <Select value={selectedRepresentative} onChange={(e) => setSelectedRepresentative(e.target.value)}>
              <option value="">-- 選択してください --</option>
              {representativeList.map(rep => (<option key={rep} value={rep}>{rep}</option>))}
            </Select>
          </SelectWrapper>

          {selectedRepresentative ? (
            <PersonSummaryContainer>
              <SummaryBox>
                <SummaryTitle>フェーズ別 案件数</SummaryTitle>
                <FunnelContainer>
                  {['フェーズ2', 'フェーズ3', 'フェーズ4', 'フェーズ5', 'フェーズ6', 'フェーズ7'].map((phase, index, arr) => {
                    const count = representativeSummary.phaseCounts[phase] || 0;
                    const widthPercent = 100 - (index * 6);
                    const nextWidthPercent = index < arr.length - 1 ? 100 - ((index + 1) * 6) : widthPercent - 6;
                    const topIndent = (100 - widthPercent) / 2;
                    const bottomIndent = (100 - nextWidthPercent) / 2;
                    return (
                      <FunnelRow key={phase}>
                        <FunnelBar color={STATUS_COLORS[phase]} topLeft={topIndent} bottomLeft={bottomIndent} style={{ width: '100%' }}>
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

              <SummaryBox>
                <SummaryTitle>フェーズ別 想定予算合計</SummaryTitle>
                <FunnelContainer>
                  {['フェーズ2', 'フェーズ3', 'フェーズ4', 'フェーズ5', 'フェーズ6', 'フェーズ7'].map((phase, index, arr) => {
                    const budget = representativeSummary.phaseBudgets[phase] || 0;
                    const widthPercent = 100 - (index * 6);
                    const nextWidthPercent = index < arr.length - 1 ? 100 - ((index + 1) * 6) : widthPercent - 6;
                    const topIndent = (100 - widthPercent) / 2;
                    const bottomIndent = (100 - nextWidthPercent) / 2;
                    return (
                      <FunnelRow key={phase}>
                        <FunnelBar color={STATUS_COLORS[phase]} topLeft={topIndent} bottomLeft={bottomIndent} style={{ width: '100%' }}>
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

              <SummaryBox>
                <SummaryTitle>案件一覧</SummaryTitle>
                {representativeSummary.dealsList.length > 0 ? (
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    <DealListTable>
                      <thead>
                        <tr>
                          <DealListTh>会社名</DealListTh>
                          <DealListTh>提案内容</DealListTh>
                          <DealListTh>フェーズ</DealListTh>
                          <DealListTh style={{ textAlign: 'right' }}>想定予算</DealListTh>
                        </tr>
                      </thead>
                      <tbody>
                        {representativeSummary.dealsList.map(deal => (
                          <tr key={deal.id}>
                            <DealListTd>{deal.companyName}</DealListTd>
                            <DealListTd style={{ fontSize: '0.8rem', color: '#666' }}>{deal.productName}</DealListTd>
                            <DealListTd><PhaseBadge color={STATUS_COLORS[deal.status]}>{deal.status}</PhaseBadge></DealListTd>
                            <DealListTd style={{ textAlign: 'right' }}>{formatCurrency(deal.expectedBudget)}</DealListTd>
                          </tr>
                        ))}
                      </tbody>
                    </DealListTable>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', color: '#999', padding: '1rem' }}>該当する案件がありません</div>
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

      <FullWidthContainer>
        <Card>
          <CardTitle>
            <FiAlertTriangle style={{ color: '#e74c3c' }} />
            滞留商談リスト（登録から90日以上経過）
          </CardTitle>
          {stagnantDeals.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <Th>会社名</Th>
                  <Th>提案内容</Th>
                  <Th style={{ textAlign: 'center' }}>経過日数</Th>
                  <Th style={{ textAlign: 'right' }}>想定予算</Th>
                </tr>
              </thead>
              <tbody>
                {stagnantDeals.map((deal) => (
                  <tr key={deal.id}>
                    <Td>{deal.companyName}</Td>
                    <Td>{deal.productName}</Td>
                    <Td style={{ textAlign: 'center' }}><AlertBadge>{deal.daysElapsed}日</AlertBadge></Td>
                    <Td style={{ textAlign: 'right' }}>{formatCurrency(deal.expectedBudget)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#27ae60' }}>
              ✅ 90日以上滞留している商談はありません
            </div>
          )}
        </Card>
      </FullWidthContainer>

      {showTargetModal && (
        <Modal onClick={() => setShowTargetModal(false)}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <ModalTitle>四半期目標を編集</ModalTitle>
            <div style={{ marginBottom: '0.5rem', color: '#666' }}>{quarter.label}の目標売上金額</div>
            <ModalInput
              type="number"
              value={editingTarget}
              onChange={(e) => setEditingTarget(e.target.value)}
              placeholder="目標金額を入力（例: 10000000）"
              min="0"
            />
            <ModalButtons>
              <ModalButton className="cancel" onClick={() => setShowTargetModal(false)}>キャンセル</ModalButton>
              <ModalButton className="save" onClick={saveTarget}>保存</ModalButton>
            </ModalButtons>
          </ModalContent>
        </Modal>
      )}

      {showAddModal && (
        <Modal onClick={() => setShowAddModal(false)}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <ModalTitle>アカウント営業案件を登録</ModalTitle>

            <ModalLabel>対象企業 *</ModalLabel>
            <ModalSelect
              value={addForm.companyName}
              onChange={(e) => handleSelectKeyAccount(e.target.value)}
            >
              <option value="">-- 対象企業リストから選択 --</option>
              {keyAccounts.map(account => (
                <option key={account.id} value={account.companyName}>{account.companyName}</option>
              ))}
            </ModalSelect>
            {keyAccounts.length === 0 && (
              <div style={{ fontSize: '0.8rem', color: '#e67e22', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                対象企業が未登録です。先に「対象企業リストを管理」から登録してください。
              </div>
            )}

            <ModalLabel>提案内容 *</ModalLabel>
            <ModalInput
              type="text"
              value={addForm.productName}
              onChange={(e) => setAddForm(prev => ({ ...prev, productName: e.target.value }))}
              placeholder="例: ○○事業の年間包括提案"
            />

            <ModalLabel>担当者</ModalLabel>
            <ModalInput
              type="text"
              value={addForm.representative}
              onChange={(e) => setAddForm(prev => ({ ...prev, representative: e.target.value }))}
            />

            <ModalLabel>想定予算（円）</ModalLabel>
            <ModalInput
              type="number"
              value={addForm.expectedBudget}
              onChange={(e) => setAddForm(prev => ({ ...prev, expectedBudget: e.target.value }))}
              placeholder="例: 5000000"
              min="0"
            />

            <ModalButtons>
              <ModalButton className="cancel" onClick={() => setShowAddModal(false)}>キャンセル</ModalButton>
              <ModalButton className="save" onClick={handleAddDeal} disabled={isSaving}>登録</ModalButton>
            </ModalButtons>
          </ModalContent>
        </Modal>
      )}
    </DashboardContainer>
  );
}

export default AccountSalesDashboard;
