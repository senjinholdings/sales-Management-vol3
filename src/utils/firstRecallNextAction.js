import { serverTimestamp } from 'firebase/firestore';
import {
  fetchSalesRecords,
  addSalesRecord,
  fetchSalesEntries,
  updateSalesEntryStatus,
  addSalesEntry,
} from '../services/projectService.js';

/**
 * 第一想起取れるくん ①②③ワークフロー共通ユーティリティ
 *
 * ①進行スケジュール確認 → ②詳細確認(PR表記など) → ③契約締結依頼 のネクストアクション(NA)連鎖を
 * NextActionManagementPage.js の handleSelectReviewer→handleSaveNextNa と同じ考え方でテンプレート化したもの。
 * 各モーダルの保存処理から呼び出し、①②の完了操作の後に次のNAを自動生成する。
 */

// dealのisExistingProjectフラグからNA/営業記録の保存先サブコレクションを判定する
// （ProjectDetailPanel.js の salesSubCol = mode === 'newCase' ? 'newCaseSalesRecords' : 'salesRecords' と同じ考え方）
export const resolveSalesSubCol = (deal) => (
  deal && deal.isExistingProject ? 'salesRecords' : 'newCaseSalesRecords'
);

// 登録日(date)降順、同日ならcreatedAtでタイブレーク（ProjectDetailPanel.js の同期処理と同じソート）
const sortRecordsDesc = (records) => (
  [...records].sort((a, b) => {
    const aDate = a.date || '';
    const bDate = b.date || '';
    if (aDate !== bDate) return bDate.localeCompare(aDate);
    const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
    const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
    return bTime - aTime;
  })
);

/**
 * 対象dealの最新営業記録IDを取得する。1件も存在しない場合はNAの入れ物として1件作成する。
 * @param {string} dealId
 * @param {string} subCol - 'salesRecords' | 'newCaseSalesRecords'
 * @param {string} fallbackPhase - レコードを新規作成する場合のphase初期値
 * @returns {Promise<string>} recordId
 */
export const getLatestRecordId = async (dealId, subCol, fallbackPhase = '') => {
  const records = await fetchSalesRecords(dealId, subCol);
  if (records.length > 0) {
    return sortRecordsDesc(records)[0].id;
  }
  // レコードがまだ無い場合（NA1生成前に①モーダルを開いた場合等）は空レコードを1件用意する
  await addSalesRecord(dealId, { phase: fallbackPhase, date: '', createdAt: serverTimestamp() }, subCol);
  const created = await fetchSalesRecords(dealId, subCol);
  return sortRecordsDesc(created)[0].id;
};

/**
 * ①②③のNA連鎖を1ステップ進める。
 * - matchKeywordsに一致する未完了NAが見つかればdoneにする（見つからなくてもエラーにしない）
 * - nextActionContentが指定されていれば新規NAを作成する
 * @param {object} params
 * @param {string} params.dealId
 * @param {string} params.subCol
 * @param {string} params.recordId
 * @param {string[]} params.matchKeywords - 対応する既存NAを判定するキーワード（いずれかを含めばマッチ）
 * @param {string|null} params.nextActionContent - 次に作成するNAの内容（nullなら作成しない）
 * @param {string} params.nextActionAssignee
 * @param {string} params.nextActionDueDate
 */
export const advanceFirstRecallNa = async ({
  dealId,
  subCol,
  recordId,
  matchKeywords,
  nextActionContent,
  nextActionAssignee = '',
  nextActionDueDate = '',
}) => {
  try {
    const entries = await fetchSalesEntries(dealId, recordId, subCol);
    const target = entries.find((entry) => (
      entry.actionContent
      && entry.actionStatus !== 'done'
      && matchKeywords.some((keyword) => entry.actionContent.includes(keyword))
    ));
    if (target) {
      await updateSalesEntryStatus(dealId, recordId, target.id, 'done', subCol);
    }
  } catch (error) {
    // 対応するNAが見つからない/更新に失敗しても後続の新規NA作成は継続する
    console.error('第一想起NA連鎖: 対応するNAの完了処理に失敗しました', error);
  }

  if (!nextActionContent) return;

  try {
    await addSalesEntry(dealId, recordId, {
      memoContent: '',
      actionContent: nextActionContent,
      actionDueDate: nextActionDueDate || '',
      actionAssignee: nextActionAssignee || '',
      actionStatus: 'active',
    }, subCol);
  } catch (error) {
    console.error('第一想起NA連鎖: 次のNA作成に失敗しました', error);
  }
};

// NA本文のテンプレート（NextActionManagementPage.js側のクリック判定でも同じキーワードを使用する）
export const FIRST_RECALL_NA_LABELS = {
  schedule: '①進行スケジュール確認',
  detail: '②詳細確認',
  contract: '③契約締結依頼',
};

export const FIRST_RECALL_NA_CONTENT = {
  detail: '②詳細確認(PR表記など)を行う',
  contract: '③契約締結依頼を提出する',
};
