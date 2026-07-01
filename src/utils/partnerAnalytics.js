/**
 * パートナー分析ユーティリティ
 * PartnersOverviewDashboard / PartnerDetailDashboard で共通使用する純粋関数
 */
import { PHASE_PROBABILITY } from '../data/constants.js';

// 進行中フェーズ（成約・失注・Dead を除く）
export const ACTIVE_PHASES = [
  'フェーズ1', 'フェーズ2', 'フェーズ3', 'フェーズ4',
  'フェーズ5', 'フェーズ6', 'フェーズ7'
];

// Firestore Timestamp / Date / 文字列 を Date に変換
const toDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val.toDate === 'function') return val.toDate(); // Firestore Timestamp
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * 指定したピリオドキーに対応する Date 範囲を返す
 * @param {'thisMonth'|'thisQuarter'|'thisYear'} period
 * @returns {{ start: Date, end: Date, label: string }}
 */
export const getPeriodRange = (period) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based

  if (period === 'thisMonth') {
    return {
      start: new Date(year, month, 1),
      end: new Date(year, month + 1, 0, 23, 59, 59),
      label: `${year}年${month + 1}月`
    };
  }

  if (period === 'thisYear') {
    return {
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31, 23, 59, 59),
      label: `${year}年`
    };
  }

  // thisQuarter (default)
  let startMonth;
  if (month < 3) startMonth = 0;
  else if (month < 6) startMonth = 3;
  else if (month < 9) startMonth = 6;
  else startMonth = 9;
  const endMonth = startMonth + 2;
  const q = Math.floor(startMonth / 3) + 1;
  return {
    start: new Date(year, startMonth, 1),
    end: new Date(year, endMonth + 1, 0, 23, 59, 59),
    label: `${year}年Q${q}（${startMonth + 1}〜${endMonth + 1}月）`
  };
};

/**
 * 全案件をパートナー（introducer）ごとにグループ化
 * - introducersMaster に登録された会社名を正とする
 * - マスター未登録の introducer は '__unregistered__' グループに集約
 * - introducer が空の案件は除外（直接営業等）
 *
 * @param {Array} deals - 新規案件（isExistingProject !== true）
 * @param {Array} introducersMaster - introducers コレクションのドキュメント配列
 * @returns {Object} { [partnerName]: deal[], __unregistered__: deal[] }
 */
export const groupDealsByPartner = (deals, introducersMaster) => {
  const masterNames = new Set(introducersMaster.map(i => i.name).filter(Boolean));
  const groups = {};

  // マスター登録済みを先に初期化（案件ゼロでもカードを表示するため）
  introducersMaster.forEach(i => {
    if (i.name) groups[i.name] = [];
  });

  deals.forEach(deal => {
    const name = deal.introducer;
    if (!name) return; // introducer なし → 除外

    if (masterNames.has(name)) {
      groups[name].push(deal);
    } else {
      if (!groups['__unregistered__']) groups['__unregistered__'] = [];
      groups['__unregistered__'].push(deal);
    }
  });

  return groups;
};

/**
 * パートナー1社のKPIを計算
 * @param {Array} deals - 対象パートナーの案件配列（新規のみ）
 * @param {{ start: Date, end: Date }} periodRange
 * @returns {Object} KPIオブジェクト
 */
export const computePartnerKpis = (deals, periodRange) => {
  const { start, end } = periodRange;

  // 期間内紹介数（createdAt が期間内 = 紹介日とみなす）
  const referredInPeriod = deals.filter(d => {
    const dt = toDate(d.createdAt);
    return dt && dt >= start && dt <= end;
  });

  // 期間内成約数（confirmedDate が期間内）
  const closedInPeriod = deals.filter(d => {
    const dt = toDate(d.confirmedDate);
    return dt && dt >= start && dt <= end;
  });

  // 進行中案件（フェーズ1〜7）
  const activeDeals = deals.filter(d => ACTIVE_PHASES.includes(d.status));

  // 成約確度 = Σ expectedBudget × PHASE_PROBABILITY[status]
  const winForecast = activeDeals.reduce((sum, d) => {
    const budget = parseFloat(d.expectedBudget) || 0;
    const prob = PHASE_PROBABILITY[d.status] || 0;
    return sum + budget * prob;
  }, 0);

  // 最終紹介日（createdAt の最大値）
  const lastReferralDate = deals.reduce((latest, d) => {
    const dt = toDate(d.createdAt);
    if (!dt) return latest;
    return !latest || dt > latest ? dt : latest;
  }, null);

  return {
    totalDeals: deals.length,
    referredInPeriod: referredInPeriod.length,
    closedInPeriod: closedInPeriod.length,
    activeDeals: activeDeals.length,
    winForecast,
    lastReferralDate,
    totalClosed: deals.filter(d => !!d.confirmedDate).length,
  };
};

/**
 * 過去N月の月次推移データ（紹介数・成約数）を返す
 * @param {Array} deals
 * @param {number} months - 遡る月数（デフォルト12）
 * @returns {Array<{ label, year, month, referred, closed }>}
 */
export const monthlyReferralTrend = (deals, months = 12) => {
  const now = new Date();
  const result = [];

  for (let i = months - 1; i >= 0; i--) {
    const base = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59);

    const referred = deals.filter(d => {
      const dt = toDate(d.createdAt);
      return dt && dt >= start && dt <= end;
    }).length;

    const closed = deals.filter(d => {
      const dt = toDate(d.confirmedDate);
      return dt && dt >= start && dt <= end;
    }).length;

    result.push({
      label: `${base.getMonth() + 1}月`,
      year: base.getFullYear(),
      month: base.getMonth() + 1,
      referred,
      closed
    });
  }

  return result;
};

/**
 * 進行中案件のフェーズ分布（ファネル表示用）
 * @param {Array} deals
 * @returns {Array<{ phase, count, budget }>} ACTIVE_PHASES 順
 */
export const phaseDistribution = (deals) => {
  const dist = {};
  ACTIVE_PHASES.forEach(ph => { dist[ph] = { count: 0, budget: 0 }; });

  deals.forEach(d => {
    if (!ACTIVE_PHASES.includes(d.status)) return;
    dist[d.status].count += 1;
    dist[d.status].budget += parseFloat(d.expectedBudget) || 0;
  });

  return ACTIVE_PHASES.map(ph => ({
    phase: ph,
    count: dist[ph].count,
    budget: dist[ph].budget,
  }));
};

/**
 * 金額を ¥XX万 / ¥XXX万 形式にフォーマット
 */
export const formatBudget = (value) => {
  if (!value || value === 0) return '¥0';
  if (value >= 100000000) return `¥${(value / 100000000).toFixed(1)}億`;
  if (value >= 10000) return `¥${Math.round(value / 10000)}万`;
  return `¥${value.toLocaleString()}`;
};

/**
 * 日付を「X日前」「本日」「X週間前」などの相対表記に変換
 */
export const formatRelativeDate = (date) => {
  if (!date) return '-';
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return '本日';
  if (days === 1) return '昨日';
  if (days < 7) return `${days}日前`;
  if (days < 30) return `${Math.floor(days / 7)}週間前`;
  if (days < 365) return `${Math.floor(days / 30)}ヶ月前`;
  return `${Math.floor(days / 365)}年以上前`;
};
