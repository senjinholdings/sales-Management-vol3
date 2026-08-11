import { db } from '../firebase.js';
import { doc, collection, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import { resolveSalesSubCol, getLatestRecordId } from './firstRecallNextAction.js';

/**
 * フェーズ4滞留NAの自動生成（案件一覧・アカウント営業一覧の共通ユーティリティ）
 *
 * フェーズ4に7日以上滞留している案件に「決済者に直接話すことを提案する」NAを1回だけ自動生成する。
 * 一度生成した案件には二度と生成しない（完了・削除されたNAも「生成済み」として扱う。
 * 判定の正は案件側フラグphase4StagnationNaCreatedAtで、NAの現存確認はしない）。
 *
 * 重複生成防止（3重ガード）:
 * ① 案件のphase4StagnationNaCreatedAtフラグ。一度立てたら二度と消さない（ステータス変更でもリセットしない）。
 *    Timestamp.now()の確定値で書く。serverTimestamp()だとサーバー確定前のローカルスナップショットで
 *    nullに読めて（遅延補償のデフォルト挙動）、onSnapshot→生成→書き込み→onSnapshot→…の
 *    無限ループで大量重複が発生した経緯があるため、serverTimestamp()に戻さないこと
 * ② NA生成とフラグ書き込みをwriteBatchで原子化（NAだけ生成されてフラグ無しの中間状態を作らない）
 * ③ セッション内Setで同一案件への並行実行を遮断（onSnapshotの連続発火・フラグ反映前の再入対策）
 */

export const PHASE4_STAGNATION_DAYS = 7;
export const PHASE4_STAGNATION_ACTION_CONTENT = '決済者に直接話すことを提案する';

// 同一セッションで処理中/処理済みの案件ID（ガード③）
const handledDealIds = new Set();

/**
 * @param {object} deal - progressDashboardの案件（id, status, phaseEnteredAt等を含む）
 */
export const checkPhase4StagnationNa = async (deal) => {
  if (deal.status !== 'フェーズ4') return;
  if (deal.phase4StagnationNaCreatedAt) return;
  if (handledDealIds.has(deal.id)) return;

  // phaseEnteredAtが無い古いデータはupdatedAtを基準時刻として代用する
  // （updatedAtが7日以上前ならその間フェーズも変わっていないことが保証されるため）
  let referenceDate = null;
  if (deal.phaseEnteredAt?.toDate) {
    referenceDate = deal.phaseEnteredAt.toDate();
  } else if (deal.updatedAt) {
    referenceDate = new Date(deal.updatedAt);
  } else if (deal.createdAt) {
    referenceDate = new Date(deal.createdAt);
  }
  if (!referenceDate || isNaN(referenceDate.getTime())) return;

  const elapsedDays = Math.floor((new Date() - referenceDate) / (1000 * 60 * 60 * 24));
  if (elapsedDays < PHASE4_STAGNATION_DAYS) return;

  handledDealIds.add(deal.id);
  try {
    const subCol = resolveSalesSubCol(deal);
    const recordId = await getLatestRecordId(deal.id, subCol, deal.status || '');
    const entryRef = doc(collection(db, 'progressDashboard', deal.id, subCol, recordId, 'entries'));
    const batch = writeBatch(db);
    batch.set(entryRef, {
      memoContent: '',
      actionContent: PHASE4_STAGNATION_ACTION_CONTENT,
      actionDueDate: new Date().toISOString().split('T')[0],
      actionAssignee: deal.representative || '',
      actionStatus: 'active',
      phase: deal.status,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'progressDashboard', deal.id), {
      phase4StagnationNaCreatedAt: Timestamp.now(),
    });
    await batch.commit();
  } catch (error) {
    // 失敗時のみセッションガードを解除し、後続スナップショットで再試行できるようにする
    handledDealIds.delete(deal.id);
    console.error('フェーズ4滞留NA自動生成に失敗:', error);
  }
};
