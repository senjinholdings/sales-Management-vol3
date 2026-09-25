import { doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import {
  updateProject, updateSalesRecord, completeContractStageIfSigned,
} from '../services/projectService.js';
import {
  resolveSalesSubCol, getLatestRecordId, advanceFirstRecallNa, FIRST_RECALL_NA_LABELS,
} from './firstRecallNextAction.js';

/**
 * 契約書の締結依頼・締結と、案件側の状態（第一想起の③・フェーズ・進行ステージ）をつなぐ。
 *
 * 契約書そのもの（依頼・締結の記録）の正は progressDashboard/{id}/contractRequests で、
 * ここで書く案件側のフィールドはそこから追従させる従属情報。
 */

/**
 * 締結依頼を送ったあとに呼ぶ。
 * - 第一想起の③がまだ「送信可能」の案件は「依頼済み」にする（①②③の進捗バッジが見る値）
 * - 第一想起の③ボタンから送った場合（fromFirstRecall）は、以前の③と同じく
 *   フェーズ7「当社の処理」に進め、NA「③契約締結依頼を提出する」を完了にする
 * @param {object} deal - 案件
 * @param {{fromFirstRecall?: boolean}} [options]
 */
export const markContractRequested = async (deal, { fromFirstRecall = false } = {}) => {
  const dashSnap = await getDoc(doc(db, 'progressDashboard', deal.id));
  const dashData = dashSnap.exists() ? dashSnap.data() : {};

  const updates = { contractRequestedAt: serverTimestamp() };
  if (fromFirstRecall || dashData.firstRecallContractStatus === 'ready') {
    updates.firstRecallContractStatus = 'requested';
  }
  const shouldAdvancePhase = fromFirstRecall
    && dashData.status !== 'フェーズ7' && dashData.status !== 'フェーズ8';
  if (shouldAdvancePhase) {
    updates.status = 'フェーズ7';
  }
  await updateProject(deal.id, updates);

  const subCol = resolveSalesSubCol({ ...deal, ...dashData });
  if (shouldAdvancePhase) {
    // salesRecords側のphaseも合わせて更新する（ProjectDetailPanelの起動時同期ロジックが
    // salesRecords.phaseを正としてprogressDashboard.statusを巻き戻してしまうのを防ぐため）
    const recordId = await getLatestRecordId(deal.id, subCol, dashData.status || '');
    await updateSalesRecord(deal.id, recordId, { phase: 'フェーズ7' }, subCol);
  }

  if (fromFirstRecall) {
    // 以前の③は依頼を送ってもこのNAを完了にしておらず、送った後も残り続けていた。
    const recordId = await getLatestRecordId(deal.id, subCol, dashData.status || '');
    await advanceFirstRecallNa({
      dealId: deal.id,
      subCol,
      recordId,
      matchKeywords: [FIRST_RECALL_NA_LABELS.contract],
      nextActionContent: null,
    });
  }
};

/**
 * 契約書が締結済みになったあとに呼ぶ（「締結済みにする」・締結済みの契約書のアップロード）。
 * - 第一想起の③を「締結済み」にする（依頼中・送信可能だった場合のみ）
 * - 進行ステージの「契約締結」をDoneにする（対象案件でステージ1のときだけ。受注前なら受注時に行う）
 * @param {object} deal - 案件
 */
export const markContractSigned = async (deal) => {
  const dashSnap = await getDoc(doc(db, 'progressDashboard', deal.id));
  const dashData = dashSnap.exists() ? dashSnap.data() : {};
  const updates = { contractSignedAt: serverTimestamp() };
  if (['ready', 'requested'].includes(dashData.firstRecallContractStatus)) {
    updates.firstRecallContractStatus = 'signed';
  }
  await updateProject(deal.id, updates);
  await completeContractStageIfSigned(deal.id);
};
