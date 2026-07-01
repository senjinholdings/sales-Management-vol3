/**
 * PartnersOverviewDashboard
 * 複数の営業パートナーを横断可視化する管理者向けダッシュボード
 *
 * KGI: パートナー経由で新規成約した案件数
 * データソース: progressDashboard（新規案件）+ introducers コレクション
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import {
  FiTrendingUp, FiUsers, FiAward, FiTarget, FiBarChart2,
  FiArrowUp, FiArrowDown, FiMinus, FiEdit2, FiSave, FiX, FiAlertCircle
} from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { STATUS_COLORS, PHASE_DESCRIPTIONS } from '../data/constants.js';
import {
  groupDealsByPartner,
  computePartnerKpis,
  monthlyReferralTrend,
  getPeriodRange,
  formatBudget,
  formatRelativeDate,
  ACTIVE_PHASES
} from '../utils/partnerAnalytics.js';

// ─────────────────────────────────────────────
//  パートナー識別カラーパレット（左ボーダー用）
// ─────────────────────────────────────────────
const PARTNER_COLORS = [
  '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#EC4899', '#6366F1',
  '#84CC16', '#F97316'
];

// ─────────────────────────────────────────────
//  styled-components
// ─────────────────────────────────────────────
const Container = styled.div`
  max-width: 1400px;
  margin: 0 auto;
`;

const PageHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 0.75rem;
`;

const PageTitle = styled.h1`
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
`;

const PeriodSelect = styled.select`
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.875rem;
  cursor: pointer;
`;

const SortSelect = styled.select`
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.875rem;
  cursor: pointer;
`;

// ─── KGIサマリー ───
const KgiSection = styled.div`
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: 1.5rem 2rem;
  margin-bottom: 1.75rem;
  display: flex;
  align-items: center;
  gap: 2rem;
  flex-wrap: wrap;
`;

const KgiMain = styled.div`
  flex: 1;
  min-width: 240px;
`;

const KgiLabel = styled.div`
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  margin-bottom: 0.5rem;
`;

const KgiValue = styled.div`
  font-size: 3rem;
  font-weight: 800;
  color: var(--color-text-primary);
  line-height: 1;
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
`;

const KgiUnit = styled.span`
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-secondary);
`;

const KgiTarget = styled.div`
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin-top: 0.35rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const KgiMeterBar = styled.div`
  flex: 2;
  min-width: 200px;
`;

const KgiBarLabel = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.4rem;
`;

const KgiBarOuter = styled.div`
  height: 12px;
  background: #E2E8F0;
  border-radius: 6px;
  overflow: hidden;
`;

const KgiBarInner = styled.div`
  height: 100%;
  border-radius: 6px;
  background: ${props =>
    props.$pct >= 80 ? 'var(--color-success)' :
    props.$pct >= 50 ? '#F59E0B' :
    'var(--color-danger)'
  };
  width: ${props => Math.min(props.$pct, 100)}%;
  transition: width 0.4s ease;
`;

const KgiPct = styled.div`
  font-size: 1.5rem;
  font-weight: 700;
  margin-top: 0.35rem;
  color: ${props =>
    props.$pct >= 80 ? 'var(--color-success)' :
    props.$pct >= 50 ? '#F59E0B' :
    'var(--color-danger)'
  };
`;

const EditTargetBtn = styled.button`
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.3rem 0.6rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  &:hover { background: var(--color-surface-hover); }
`;

const TargetInput = styled.input`
  width: 80px;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
`;

const KgiSubStats = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 160px;
`;

const KgiStatRow = styled.div`
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  span { color: var(--color-text-primary); font-weight: 600; }
`;

// ─── パートナーカードグリッド ───
const SectionHeading = styled.div`
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  margin-bottom: 0.875rem;
`;

const CardsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
`;

const PartnerCard = styled(Link)`
  display: block;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border);
  border-left: 4px solid ${props => props.$color || '#3B82F6'};
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  overflow: hidden;
  &:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
    border-color: ${props => props.$color || '#3B82F6'};
  }
`;

const CardBody = styled.div`
  padding: 1rem 1.125rem;
`;

const CardHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 0.875rem;
`;

const PartnerName = styled.div`
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.3;
`;

const PartnerStatus = styled.span`
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  background: ${props => props.$active ? '#DCFCE7' : '#F1F5F9'};
  color: ${props => props.$active ? '#16A34A' : '#94A3B8'};
`;

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
  margin-bottom: 0.875rem;
`;

const Metric = styled.div`
  background: var(--color-bg);
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.4rem;
  text-align: center;
`;

const MetricLabel = styled.div`
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin-bottom: 0.25rem;
  line-height: 1.2;
`;

const MetricValue = styled.div`
  font-size: 1.4rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: ${props => props.$color || 'var(--color-text-primary)'};
`;

const CardFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
`;

const LastActivity = styled.div`
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  span { color: var(--color-text-primary); font-weight: 600; }
`;

// ─── スパークライン ───
const SparklineSvg = styled.svg`
  display: block;
`;

// ─── ローディング / 空状態 ───
const Loading = styled.div`
  text-align: center;
  padding: 3rem;
  color: var(--color-text-secondary);
  font-size: 0.95rem;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 3rem;
  color: var(--color-text-secondary);
`;

const AlertBanner = styled.div`
  background: #FEF3C7;
  border: 1px solid #FDE68A;
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  font-size: 0.85rem;
  color: #92400E;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 1rem;
`;

// ─────────────────────────────────────────────
//  Sparkline コンポーネント（SVG polyline）
// ─────────────────────────────────────────────
const Sparkline = ({ values, color = '#3B82F6', width = 80, height = 28 }) => {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 3;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return `${x},${y}`;
  });

  const lastX = pad + w;
  const lastY = pad + h - ((values[values.length - 1] - min) / range) * h;

  // グラデーション塗り（area fill）
  const areaPoints = [
    `${pad},${pad + h}`,
    ...points,
    `${lastX},${pad + h}`
  ].join(' ');

  const gradId = `sg-${color.replace('#', '')}`;

  return (
    <SparklineSvg width={width} height={height} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradId})`} />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </SparklineSvg>
  );
};

// ─────────────────────────────────────────────
//  メインコンポーネント
// ─────────────────────────────────────────────
function PartnersOverviewDashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [allDeals, setAllDeals] = useState([]);
  const [introducers, setIntroducers] = useState([]);
  const [period, setPeriod] = useState('thisQuarter');
  const [sortBy, setSortBy] = useState('closedInPeriod');
  const [kgiTarget, setKgiTarget] = useState(20);
  const [editingTarget, setEditingTarget] = useState(false);
  const [tempTarget, setTempTarget] = useState('');
  const [hasUnregistered, setHasUnregistered] = useState(false);

  // ── Firestore からデータ取得
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [dealsSnap, introducersSnap, settingsDoc] = await Promise.all([
        getDocs(collection(db, 'progressDashboard')),
        getDocs(collection(db, 'introducers')),
        getDoc(doc(db, 'settings', 'partnerDashboard'))
      ]);

      // 新規案件のみ・introducer あり
      const deals = [];
      dealsSnap.forEach(d => {
        const data = d.data();
        if (data.isExistingProject === true) return;
        deals.push({ id: d.id, ...data });
      });

      const introducersList = [];
      introducersSnap.forEach(d => {
        introducersList.push({ id: d.id, ...d.data() });
      });

      if (settingsDoc.exists()) {
        const s = settingsDoc.data();
        if (s.kgiTarget) setKgiTarget(s.kgiTarget);
      }

      setAllDeals(deals);
      setIntroducers(introducersList);
    } catch (err) {
      console.error('パートナーダッシュボード: データ取得エラー', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── KGI目標を保存
  const saveKgiTarget = async () => {
    const v = parseInt(tempTarget, 10);
    if (isNaN(v) || v <= 0) return;
    try {
      await setDoc(doc(db, 'settings', 'partnerDashboard'), { kgiTarget: v }, { merge: true });
      setKgiTarget(v);
      setEditingTarget(false);
    } catch (err) {
      console.error('目標値保存エラー', err);
    }
  };

  // ── パートナー別データ集計
  const periodRange = useMemo(() => getPeriodRange(period), [period]);

  const partnerData = useMemo(() => {
    const groups = groupDealsByPartner(allDeals, introducers);
    setHasUnregistered(!!groups['__unregistered__']);

    const entries = Object.entries(groups)
      .filter(([key]) => key !== '__unregistered__')
      .map(([name, deals], idx) => {
        const kpis = computePartnerKpis(deals, periodRange);
        const trend = monthlyReferralTrend(deals, 6);
        const introducer = introducers.find(i => i.name === name);
        return {
          name,
          color: PARTNER_COLORS[idx % PARTNER_COLORS.length],
          status: introducer?.status || 'アクティブ',
          kpis,
          sparkValues: trend.map(t => t.referred),
          deals,
        };
      });

    // 未登録グループ
    if (groups['__unregistered__']) {
      const deals = groups['__unregistered__'];
      const kpis = computePartnerKpis(deals, periodRange);
      const trend = monthlyReferralTrend(deals, 6);
      entries.push({
        name: '未登録パートナー',
        color: '#94A3B8',
        status: '-',
        kpis,
        sparkValues: trend.map(t => t.referred),
        deals,
        isUnregistered: true,
      });
    }

    // ソート
    entries.sort((a, b) => {
      if (sortBy === 'referredInPeriod') return b.kpis.referredInPeriod - a.kpis.referredInPeriod;
      if (sortBy === 'winForecast') return b.kpis.winForecast - a.kpis.winForecast;
      return b.kpis.closedInPeriod - a.kpis.closedInPeriod; // default: 成約数
    });

    return entries;
  }, [allDeals, introducers, periodRange, sortBy]);

  // ── KGIサマリー（全パートナー合算）
  const kgiTotal = useMemo(
    () => partnerData.reduce((s, p) => s + p.kpis.closedInPeriod, 0),
    [partnerData]
  );
  const totalActive = useMemo(
    () => partnerData.reduce((s, p) => s + p.kpis.activeDeals, 0),
    [partnerData]
  );
  const totalReferred = useMemo(
    () => partnerData.reduce((s, p) => s + p.kpis.referredInPeriod, 0),
    [partnerData]
  );
  const kgiPct = kgiTarget > 0 ? Math.round((kgiTotal / kgiTarget) * 100) : 0;

  // ─────────────────────
  if (isLoading) return <Container><Loading>データを読み込み中...</Loading></Container>;

  return (
    <Container>
      <PageHeader>
        <PageTitle>
          <FiUsers size={20} />
          パートナー分析
        </PageTitle>
        <Controls>
          <PeriodSelect value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="thisMonth">今月</option>
            <option value="thisQuarter">今四半期</option>
            <option value="thisYear">今年度</option>
          </PeriodSelect>
          <SortSelect value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="closedInPeriod">成約数 順</option>
            <option value="referredInPeriod">紹介数 順</option>
            <option value="winForecast">成約確度 順</option>
          </SortSelect>
        </Controls>
      </PageHeader>

      {hasUnregistered && (
        <AlertBanner>
          <FiAlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            一部の案件に「紹介者マスター」に未登録の会社名が含まれています。
            <Link to="/introducer-master" style={{ color: '#92400E', fontWeight: 600, marginLeft: 4 }}>
              紹介者マスターで確認 →
            </Link>
          </span>
        </AlertBanner>
      )}

      {/* ─── KGIサマリー ─── */}
      <KgiSection>
        <KgiMain>
          <KgiLabel>KGI — パートナー経由 新規成約数（{periodRange.label}）</KgiLabel>
          <KgiValue>
            {kgiTotal}<KgiUnit>件</KgiUnit>
          </KgiValue>
          <KgiTarget>
            目標：
            {editingTarget ? (
              <>
                <TargetInput
                  type="number"
                  value={tempTarget}
                  onChange={e => setTempTarget(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveKgiTarget(); if (e.key === 'Escape') setEditingTarget(false); }}
                  autoFocus
                />件
                <EditTargetBtn onClick={saveKgiTarget}><FiSave size={12} />保存</EditTargetBtn>
                <EditTargetBtn onClick={() => setEditingTarget(false)}><FiX size={12} /></EditTargetBtn>
              </>
            ) : (
              <>
                {kgiTarget}件
                <EditTargetBtn onClick={() => { setTempTarget(String(kgiTarget)); setEditingTarget(true); }}>
                  <FiEdit2 size={11} />目標変更
                </EditTargetBtn>
              </>
            )}
          </KgiTarget>
        </KgiMain>

        <KgiMeterBar>
          <KgiBarLabel>
            <span>進捗</span>
            <span>{kgiTotal} / {kgiTarget}件</span>
          </KgiBarLabel>
          <KgiBarOuter>
            <KgiBarInner $pct={kgiPct} />
          </KgiBarOuter>
          <KgiPct $pct={kgiPct}>{kgiPct}%</KgiPct>
        </KgiMeterBar>

        <KgiSubStats>
          <KgiStatRow>
            <FiTrendingUp size={13} />
            期間内紹介数 <span>{totalReferred}件</span>
          </KgiStatRow>
          <KgiStatRow>
            <FiBarChart2 size={13} />
            進行中案件 <span>{totalActive}件</span>
          </KgiStatRow>
          <KgiStatRow>
            <FiAward size={13} />
            パートナー数 <span>{introducers.length}社</span>
          </KgiStatRow>
        </KgiSubStats>
      </KgiSection>

      {/* ─── パートナーカード ─── */}
      <SectionHeading>
        パートナー別 実績 — クリックで詳細へ
      </SectionHeading>

      {partnerData.length === 0 ? (
        <EmptyState>
          <p>紹介者マスターにパートナーが登録されていません。</p>
          <Link to="/introducer-master">紹介者マスターへ →</Link>
        </EmptyState>
      ) : (
        <CardsGrid>
          {partnerData.map(partner => (
            <PartnerCard
              key={partner.name}
              to={`/partners-overview/${encodeURIComponent(partner.name)}`}
              $color={partner.color}
            >
              <CardBody>
                <CardHeader>
                  <PartnerName>{partner.name}</PartnerName>
                  <PartnerStatus $active={partner.status === 'アクティブ'}>
                    {partner.status}
                  </PartnerStatus>
                </CardHeader>

                <MetricsGrid>
                  <Metric>
                    <MetricLabel>期間内紹介</MetricLabel>
                    <MetricValue $color="var(--color-primary)">
                      {partner.kpis.referredInPeriod}
                    </MetricValue>
                  </Metric>
                  <Metric>
                    <MetricLabel>進行中</MetricLabel>
                    <MetricValue>
                      {partner.kpis.activeDeals}
                    </MetricValue>
                  </Metric>
                  <Metric>
                    <MetricLabel>期間内成約</MetricLabel>
                    <MetricValue $color={partner.kpis.closedInPeriod > 0 ? 'var(--color-success)' : undefined}>
                      {partner.kpis.closedInPeriod}
                    </MetricValue>
                  </Metric>
                  <Metric>
                    <MetricLabel>成約確度</MetricLabel>
                    <MetricValue style={{ fontSize: '0.95rem', marginTop: 2 }}>
                      {formatBudget(partner.kpis.winForecast)}
                    </MetricValue>
                  </Metric>
                </MetricsGrid>

                <CardFooter>
                  <LastActivity>
                    最終紹介 <span>{formatRelativeDate(partner.kpis.lastReferralDate)}</span>
                  </LastActivity>
                  <Sparkline
                    values={partner.sparkValues}
                    color={partner.color}
                    width={80}
                    height={28}
                  />
                </CardFooter>
              </CardBody>
            </PartnerCard>
          ))}
        </CardsGrid>
      )}
    </Container>
  );
}

export default PartnersOverviewDashboard;
