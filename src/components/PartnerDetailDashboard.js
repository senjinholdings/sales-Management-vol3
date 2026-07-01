/**
 * PartnerDetailDashboard
 * 特定パートナーのドリルダウン画面
 *
 * 表示内容:
 * - 月次推移グラフ（紹介数 + 成約数 過去12ヶ月）
 * - フェーズ分布ファネル（進行中案件が成約にどれくらい近いか）
 * - 案件一覧テーブル
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import styled from 'styled-components';
import { FiArrowLeft, FiTarget, FiBarChart2, FiList } from 'react-icons/fi';
import { db } from '../firebase.js';
import { collection, getDocs } from 'firebase/firestore';
import { STATUS_COLORS, PHASE_DESCRIPTIONS } from '../data/constants.js';
import {
  monthlyReferralTrend,
  phaseDistribution,
  computePartnerKpis,
  getPeriodRange,
  formatBudget,
  formatRelativeDate,
  ACTIVE_PHASES
} from '../utils/partnerAnalytics.js';

// ─────────────────────────────────────────────
//  styled-components
// ─────────────────────────────────────────────
const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
`;

const BackLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  text-decoration: none;
  margin-bottom: 1.25rem;
  &:hover { color: var(--color-primary); }
`;

const PageHeader = styled.div`
  margin-bottom: 1.5rem;
`;

const PageTitle = styled.h1`
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 0.25rem;
`;

const PageMeta = styled.div`
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
`;

const MetaItem = styled.span`
  display: flex;
  align-items: center;
  gap: 0.3rem;
`;

const PeriodSelect = styled.select`
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  cursor: pointer;
`;

// ─── KPIサマリーバー ───
const KpiBar = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1.5rem;
`;

const KpiCard = styled.div`
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border);
  padding: 1rem;
  text-align: center;
`;

const KpiLabel = styled.div`
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  margin-bottom: 0.4rem;
`;

const KpiValue = styled.div`
  font-size: 1.75rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: ${props => props.$color || 'var(--color-text-primary)'};
`;

const KpiSub = styled.div`
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-top: 0.2rem;
`;

// ─── 2カラムレイアウト ───
const TwoCol = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
  margin-bottom: 1.5rem;
  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.div`
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border);
  padding: 1.25rem 1.5rem;
`;

const CardTitle = styled.div`
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
`;

// ─── 月次推移バーチャート ───
const BarChart = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 140px;
  padding-bottom: 24px; /* label 用 */
  position: relative;
`;

const BarGroup = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex: 1;
`;

const BarWrapper = styled.div`
  display: flex;
  gap: 2px;
  align-items: flex-end;
  height: 116px;
  width: 100%;
  justify-content: center;
`;

const Bar = styled.div`
  flex: 1;
  border-radius: 3px 3px 0 0;
  min-height: 2px;
  transition: height 0.3s ease;
  background: ${props => props.$color};
  height: ${props => props.$height}%;
  max-width: 20px;
`;

const BarLabel = styled.div`
  font-size: 0.65rem;
  color: var(--color-text-secondary);
  text-align: center;
  white-space: nowrap;
`;

const ChartLegend = styled.div`
  display: flex;
  gap: 1rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
`;

const LegendDot = styled.div`
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: ${props => props.$color};
  flex-shrink: 0;
`;

// ─── ファネル ───
const FunnelContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const FunnelRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
`;

const FunnelBarOuter = styled.div`
  flex: 1;
  height: 28px;
  background: #F1F5F9;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
`;

const FunnelBarInner = styled.div`
  height: 100%;
  background: ${props => props.$color};
  border-radius: 4px;
  width: ${props => props.$width}%;
  display: flex;
  align-items: center;
  padding-left: 8px;
  transition: width 0.4s ease;
  min-width: ${props => props.$width > 0 ? '40px' : '0'};
`;

const FunnelBarText = styled.span`
  font-size: 0.75rem;
  font-weight: 700;
  color: white;
  white-space: nowrap;
`;

const FunnelPhaseName = styled.div`
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  width: 100px;
  flex-shrink: 0;
  text-align: right;
`;

const FunnelBudget = styled.div`
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  width: 70px;
  text-align: right;
  flex-shrink: 0;
`;

// ─── 案件テーブル ───
const TableCard = styled(Card)`
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.5rem;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const Thead = styled.thead``;

const Th = styled.th`
  text-align: left;
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
`;

const Td = styled.td`
  padding: 0.6rem 0.75rem;
  font-size: 0.875rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
`;

const Tr = styled.tr`
  &:last-child td { border-bottom: none; }
  &:hover td { background: var(--color-surface-hover); }
`;

const PhaseBadge = styled.span`
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  background: ${props => props.$color}22;
  color: ${props => props.$color};
  border: 1px solid ${props => props.$color}44;
`;

const ClosedBadge = styled.span`
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  background: #DCFCE7;
  color: #16A34A;
`;

const Loading = styled.div`
  text-align: center;
  padding: 3rem;
  color: var(--color-text-secondary);
`;

const NotFound = styled.div`
  text-align: center;
  padding: 3rem;
  color: var(--color-text-secondary);
`;

// ─────────────────────────────────────────────
//  月次推移バーチャート コンポーネント
// ─────────────────────────────────────────────
const MonthlyBarChart = ({ trendData }) => {
  if (!trendData || trendData.length === 0) {
    return <div style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: '1rem' }}>データなし</div>;
  }
  const maxVal = Math.max(...trendData.map(d => Math.max(d.referred, d.closed)), 1);

  return (
    <>
      <ChartLegend>
        <LegendItem><LegendDot $color="#3B82F6" />紹介数（案件登録）</LegendItem>
        <LegendItem><LegendDot $color="#16A34A" />成約数</LegendItem>
      </ChartLegend>
      <BarChart>
        {trendData.map((d, i) => (
          <BarGroup key={i}>
            <BarWrapper>
              <Bar $color="#3B82F6" $height={(d.referred / maxVal) * 100} />
              <Bar $color="#16A34A" $height={(d.closed / maxVal) * 100} />
            </BarWrapper>
            <BarLabel>{d.label}</BarLabel>
          </BarGroup>
        ))}
      </BarChart>
    </>
  );
};

// ─────────────────────────────────────────────
//  メインコンポーネント
// ─────────────────────────────────────────────
function PartnerDetailDashboard() {
  const { partnerName } = useParams();
  const decodedName = decodeURIComponent(partnerName);

  const [isLoading, setIsLoading] = useState(true);
  const [partnerDeals, setPartnerDeals] = useState([]);
  const [period, setPeriod] = useState('thisQuarter');
  const [sortDealBy, setSortDealBy] = useState('createdAt');

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, 'progressDashboard'));
        const deals = [];
        snap.forEach(d => {
          const data = d.data();
          if (data.isExistingProject === true) return;
          if (data.introducer === decodedName) {
            deals.push({ id: d.id, ...data });
          }
        });
        setPartnerDeals(deals);
      } catch (err) {
        console.error('パートナー詳細: データ取得エラー', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [decodedName]);

  const periodRange = useMemo(() => getPeriodRange(period), [period]);
  const kpis = useMemo(() => computePartnerKpis(partnerDeals, periodRange), [partnerDeals, periodRange]);
  const trendData = useMemo(() => monthlyReferralTrend(partnerDeals, 12), [partnerDeals]);
  const funnel = useMemo(() => phaseDistribution(partnerDeals), [partnerDeals]);

  const maxFunnelCount = useMemo(
    () => Math.max(...funnel.map(f => f.count), 1),
    [funnel]
  );

  // 案件テーブル用ソート
  const sortedDeals = useMemo(() => {
    const arr = [...partnerDeals];
    if (sortDealBy === 'status') {
      const order = [...ACTIVE_PHASES, 'フェーズ8', 'Dead', '失注'];
      return arr.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    }
    if (sortDealBy === 'expectedBudget') {
      return arr.sort((a, b) => (parseFloat(b.expectedBudget) || 0) - (parseFloat(a.expectedBudget) || 0));
    }
    // default: createdAt 降順
    return arr.sort((a, b) => {
      const da = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
      const db2 = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
      return db2 - da;
    });
  }, [partnerDeals, sortDealBy]);

  // ──────────────
  if (isLoading) return <Container><Loading>データを読み込み中...</Loading></Container>;

  return (
    <Container>
      <BackLink to="/partners-overview">
        <FiArrowLeft size={14} />
        パートナー一覧へ戻る
      </BackLink>

      <PageHeader>
        <PageTitle>{decodedName}</PageTitle>
        <PageMeta>
          <MetaItem>
            <FiTarget size={13} />
            期間：
            <PeriodSelect value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="thisMonth">今月</option>
              <option value="thisQuarter">今四半期</option>
              <option value="thisYear">今年度</option>
            </PeriodSelect>
          </MetaItem>
          <MetaItem>累計案件数 {partnerDeals.length}件</MetaItem>
          <MetaItem>最終紹介 {formatRelativeDate(kpis.lastReferralDate)}</MetaItem>
        </PageMeta>
      </PageHeader>

      {/* ─── KPIサマリー ─── */}
      <KpiBar>
        <KpiCard>
          <KpiLabel>期間内紹介数</KpiLabel>
          <KpiValue $color="var(--color-primary)">{kpis.referredInPeriod}</KpiValue>
          <KpiSub>件</KpiSub>
        </KpiCard>
        <KpiCard>
          <KpiLabel>期間内成約数</KpiLabel>
          <KpiValue $color={kpis.closedInPeriod > 0 ? 'var(--color-success)' : undefined}>
            {kpis.closedInPeriod}
          </KpiValue>
          <KpiSub>件</KpiSub>
        </KpiCard>
        <KpiCard>
          <KpiLabel>進行中案件</KpiLabel>
          <KpiValue>{kpis.activeDeals}</KpiValue>
          <KpiSub>件（フェーズ1〜7）</KpiSub>
        </KpiCard>
        <KpiCard>
          <KpiLabel>成約確度</KpiLabel>
          <KpiValue style={{ fontSize: '1.25rem' }}>{formatBudget(kpis.winForecast)}</KpiValue>
          <KpiSub>想定予算 × 受注確率</KpiSub>
        </KpiCard>
        <KpiCard>
          <KpiLabel>累計成約数</KpiLabel>
          <KpiValue>{kpis.totalClosed}</KpiValue>
          <KpiSub>件（全期間）</KpiSub>
        </KpiCard>
      </KpiBar>

      {/* ─── 月次推移 ＋ ファネル ─── */}
      <TwoCol>
        <Card>
          <CardTitle>
            <FiBarChart2 size={14} />
            月次推移（過去12ヶ月）
          </CardTitle>
          <MonthlyBarChart trendData={trendData} />
        </Card>

        <Card>
          <CardTitle>
            <FiTarget size={14} />
            フェーズ分布（進行中案件）
          </CardTitle>
          {kpis.activeDeals === 0 ? (
            <div style={{ color: 'var(--color-text-secondary)', padding: '1rem', textAlign: 'center', fontSize: '0.875rem' }}>
              進行中の案件はありません
            </div>
          ) : (
            <FunnelContainer>
              {funnel.filter(f => f.count > 0).reverse().map(f => (
                <FunnelRow key={f.phase}>
                  <FunnelPhaseName>
                    {PHASE_DESCRIPTIONS[f.phase] || f.phase}
                  </FunnelPhaseName>
                  <FunnelBarOuter>
                    <FunnelBarInner
                      $color={STATUS_COLORS[f.phase] || '#94A3B8'}
                      $width={Math.round((f.count / maxFunnelCount) * 100)}
                    >
                      <FunnelBarText>{f.count}件</FunnelBarText>
                    </FunnelBarInner>
                  </FunnelBarOuter>
                  <FunnelBudget>{formatBudget(f.budget)}</FunnelBudget>
                </FunnelRow>
              ))}
            </FunnelContainer>
          )}
        </Card>
      </TwoCol>

      {/* ─── 案件一覧テーブル ─── */}
      <TableCard>
        <CardTitle style={{ justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FiList size={14} />
            案件一覧（{partnerDeals.length}件）
          </span>
          <select
            style={{
              padding: '0.3rem 0.6rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface)',
              fontSize: '0.75rem',
              cursor: 'pointer',
              fontWeight: 400,
              letterSpacing: 0,
              textTransform: 'none',
              color: 'var(--color-text-primary)'
            }}
            value={sortDealBy}
            onChange={e => setSortDealBy(e.target.value)}
          >
            <option value="createdAt">登録日順</option>
            <option value="status">フェーズ順</option>
            <option value="expectedBudget">予算順</option>
          </select>
        </CardTitle>

        {sortedDeals.length === 0 ? (
          <div style={{ color: 'var(--color-text-secondary)', padding: '1rem', textAlign: 'center', fontSize: '0.875rem' }}>
            案件がありません
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <Thead>
                <tr>
                  <Th>会社名 / 商材</Th>
                  <Th>フェーズ</Th>
                  <Th style={{ textAlign: 'right' }}>想定予算</Th>
                  <Th>登録日</Th>
                  <Th>成約日</Th>
                </tr>
              </Thead>
              <tbody>
                {sortedDeals.map(deal => {
                  const color = STATUS_COLORS[deal.status] || '#94A3B8';
                  const createdDate = deal.createdAt?.toDate?.() || (deal.createdAt ? new Date(deal.createdAt) : null);
                  const confirmedDate = deal.confirmedDate ? new Date(deal.confirmedDate) : null;
                  const isValidDate = (d) => d && !isNaN(d.getTime());
                  const fmtDate = (d) => isValidDate(d)
                    ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
                    : '-';

                  return (
                    <Tr key={deal.id}>
                      <Td>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                          {deal.productName || '（名称未設定）'}
                        </div>
                        {deal.proposalMenu && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                            {deal.proposalMenu}
                          </div>
                        )}
                      </Td>
                      <Td>
                        {deal.confirmedDate ? (
                          <ClosedBadge>成約済</ClosedBadge>
                        ) : (
                          <PhaseBadge $color={color}>{deal.status}</PhaseBadge>
                        )}
                      </Td>
                      <Td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatBudget(parseFloat(deal.expectedBudget) || 0)}
                      </Td>
                      <Td style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>
                        {fmtDate(createdDate)}
                      </Td>
                      <Td style={{ fontSize: '0.8rem' }}>
                        {confirmedDate ? (
                          <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                            {fmtDate(confirmedDate)}
                          </span>
                        ) : '-'}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </TableCard>
    </Container>
  );
}

export default PartnerDetailDashboard;
