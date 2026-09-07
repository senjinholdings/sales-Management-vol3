import { db } from '../firebase.js';
import { doc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import { resolveSalesSubCol, getLatestRecordId } from './firstRecallNextAction.js';

/**
 * 継続案件が「継続成約」になった瞬間に、担当者へ「会食を設定し、定例MTGを打診する」
 * ネクストアクションを1回だけ自動生成する（ContinuationManagementPage.jsの
 * handleContinuationStatusChange / handleFollowUpPhaseChange から呼び出す）。
 *
 * 対象はこれから新しく継続成約になる案件のみ。既存の継続成約案件へのさかのぼり生成はしない
 * （呼び出し元がステータス変更の直後にだけ呼ぶことで担保する。phase4StagnationNaのような
 * onSnapshotループでの全件チェックはしない）。
 *
 * 重複生成防止（フェーズ4滞留NA・ステージ連動NAと同じ考え方）:
 * ① エントリIDを決定的ID(CONTINUATION_MEAL_NA_ENTRY_ID)+setDocにし、物理的に2件目を作れない
 * ② 案件のcontinuationMealNaCreatedAtフラグ。一度立てたら二度と消さない・チェックしない
 *    （Timestamp.now()の確定値で書く。serverTimestamp()は遅延補償でnullに読める瞬間があり、
 *    連続実行で重複を招くため使わない）
 * ③ NA生成とフラグ書き込みをwriteBatchで原子化
 * ④ セッション内Setで同一案件への並行実行を遮断
 */

export const CONTINUATION_MEAL_NA_ENTRY_ID = 'continuationMealNa';
export const CONTINUATION_MEAL_NA_CONTENT = '会食を設定し、定例MTGを打診する';
export const CONTINUATION_MEAL_NA_DUE_DAYS = 7;

// 同一セッションで処理中の案件ID（ガード④）
const handledDealIds = new Set();

const toDueDateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * @param {object} deal - progressDashboardの案件（id, continuationStatus, representative,
 *   isExistingProject, continuationMealNaCreatedAt等を含む。ステータス変更を反映済みのものを渡すこと）
 */
export const ensureContinuationMealNa = async (deal) => {
  if (!deal?.id) return;
  if (deal.continuationStatus !== '継続成約') return;
  if (deal.continuationMealNaCreatedAt) return;
  if (handledDealIds.has(deal.id)) return;

  handledDealIds.add(deal.id);
  try {
    const subCol = resolveSalesSubCol(deal);
    const recordId = await getLatestRecordId(deal.id, subCol, deal.status || '');
    const entryRef = doc(db, 'progressDashboard', deal.id, subCol, recordId, 'entries', CONTINUATION_MEAL_NA_ENTRY_ID);

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + CONTINUATION_MEAL_NA_DUE_DAYS);

    const batch = writeBatch(db);
    batch.set(entryRef, {
      memoContent: '',
      actionContent: CONTINUATION_MEAL_NA_CONTENT,
      actionDueDate: toDueDateString(dueDate),
      actionAssignee: deal.representative || '',
      actionStatus: 'active',
      continuationNaType: 'meal',
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'progressDashboard', deal.id), {
      continuationMealNaCreatedAt: Timestamp.now(),
    });
    await batch.commit();
  } catch (error) {
    // 失敗時のみセッションガードを解除し、再度ステータスを変更操作すれば再試行できるようにする
    handledDealIds.delete(deal.id);
    console.error('継続成約: 会食/定例打診NAの自動生成に失敗:', error);
  }
};
