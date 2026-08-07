// 契約・請求管理の請求額計算ロジック
// 請求額はDBに保存せず表示時に毎回計算する（保存するのは手動上書き額のみ）。
// 単価や予算を後から修正しても古い計算結果が残らないようにするため。

/** 空文字・null・非数はnullに揃えて数値変換する */
export const toNumberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

/**
 * 月次実績1件の請求額を計算する
 * - 手動上書き額（manualAmount）があればそれを優先
 * - 基本は 実績数量 × 単価（1円未満切り捨て）
 * - 予算の扱いが「上限厳守」の場合は月次予算額で頭打ち
 * @param {object} actual - { quantity, manualAmount }
 * @param {object} contract - { unitPrice, monthlyBudget, budgetPolicy }
 * @returns {{ amount: number|null, capped: boolean, manual: boolean }} amountは計算不能時null
 */
export const calcBillingAmount = (actual, contract) => {
  const manualAmount = toNumberOrNull(actual?.manualAmount);
  if (manualAmount !== null) {
    return { amount: manualAmount, capped: false, manual: true };
  }
  const quantity = toNumberOrNull(actual?.quantity);
  const unitPrice = toNumberOrNull(contract?.unitPrice);
  if (quantity === null || unitPrice === null) {
    return { amount: null, capped: false, manual: false };
  }
  const amount = Math.floor(quantity * unitPrice);
  const budget = toNumberOrNull(contract?.monthlyBudget);
  if (contract?.budgetPolicy === '上限厳守' && budget !== null && amount > budget) {
    return { amount: budget, capped: true, manual: false };
  }
  return { amount, capped: false, manual: false };
};

/** 契約期間の請求合計（請求額が計算できる月のみ合算） */
export const calcContractTotal = (contract) =>
  (contract?.actuals || []).reduce((sum, actual) => {
    const { amount } = calcBillingAmount(actual, contract);
    return amount !== null ? sum + amount : sum;
  }, 0);

/** 案件全体の請求合計 */
export const calcProjectTotal = (contracts) =>
  (contracts || []).reduce((sum, contract) => sum + calcContractTotal(contract), 0);

/** "YYYY-MM" の翌月を返す（不正な入力は空文字） */
export const nextYearMonth = (yearMonth) => {
  const [y, m] = String(yearMonth || '').split('-').map(Number);
  if (!y || !m) return '';
  const date = new Date(y, m, 1); // 月引数は0始まりのため m はそのまま翌月を指す
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
