import { PROJECT_STAGES } from '../data/constants.js';
import { addBusinessDays, countBusinessDaysAfter } from './businessDays.js';

/**
 * 受注後の進行ステージ（stageProgress）の状態計算
 *
 * stageProgress のデータ構造（progressDashboard ドキュメント上）:
 *   stageProgress: {
 *     currentStage: number,                     // 1〜7
 *     completedAt: { [stageNo]: Timestamp | null } // Done押下時のserverTimestamp
 *   }
 * stageProgress が未定義の案件は「ステージ1・完了なし」として扱う（既存案件対応）
 */

/** FirestoreのTimestamp/秒数オブジェクトをDateに変換 */
const toDate = (ts) => {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return null;
};

/** ステージ番号から定義を取得 */
export const getStageDef = (stageNo) => PROJECT_STAGES.find(s => s.no === stageNo) || null;

/**
 * stageProgress を正規化して状態を返す
 * @param {object|undefined} stageProgress - 案件ドキュメントのstageProgressフィールド
 * @returns {{
 *   isStarted: boolean,           // stageProgressが存在するか
 *   currentStage: number,         // 現在のステージ（1〜7）
 *   completedAt: Object<number, Date|null>, // ステージ番号→完了日時
 *   allDone: boolean,             // ステージ7まで完了済みか
 *   deadline: Date|null,          // 現在のステージの期限（前ステージ完了+標準営業日数）
 *   undoableStage: number|null    // 取り消し可能なステージ番号（直前完了分のみ）
 * }}
 */
export const getStageState = (stageProgress) => {
  const completedAt = {};
  PROJECT_STAGES.forEach(s => {
    completedAt[s.no] = toDate(stageProgress?.completedAt?.[String(s.no)]);
  });

  const isStarted = !!stageProgress;
  const currentStage = Math.min(Math.max(stageProgress?.currentStage || 1, 1), 7);
  const allDone = !!completedAt[7];

  // 現在のステージの期限 = 前ステージ完了日時 + 標準営業日数
  let deadline = null;
  if (!allDone) {
    const stageDef = getStageDef(currentStage);
    const prevCompleted = completedAt[currentStage - 1];
    if (stageDef?.standardDays != null && prevCompleted) {
      deadline = addBusinessDays(prevCompleted, stageDef.standardDays);
    }
  }

  // 取り消し対象: 全完了ならステージ7、それ以外は現在の1つ前（完了記録がある場合のみ）
  let undoableStage = null;
  if (allDone) {
    undoableStage = 7;
  } else if (currentStage >= 2 && completedAt[currentStage - 1]) {
    undoableStage = currentStage - 1;
  }

  return { isStarted, currentStage, completedAt, allDone, deadline, undoableStage };
};

/**
 * 期限に対する超過営業日数を返す（超過していなければ0）
 * 期限日当日までは超過なし。土日は超過日数に数えない
 * @param {Date} deadline
 * @param {Date} [now]
 * @returns {number}
 */
export const getOverdueBusinessDays = (deadline, now = new Date()) => {
  if (!deadline) return 0;
  return countBusinessDaysAfter(deadline, now);
};

/** 期限表示用フォーマット（例: 8/5） */
export const formatStageDate = (date) => {
  if (!date) return '-';
  return `${date.getMonth() + 1}/${date.getDate()}`;
};
