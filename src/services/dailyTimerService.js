import { db } from '../firebase.js';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  Timestamp
} from 'firebase/firestore';

/**
 * デイリータイマーのFirestore操作サービス
 * コレクション: dailyTimers/{担当者名}_{YYYY-MM-DD}（担当者×日付で1ドキュメント）
 * フィールド:
 *   representative(string), date("YYYY-MM-DD"),
 *   tasks: [{ id, name, plannedMinutes(number|null), plannedStartTime("HH:MM"|null),
 *             startedAt(Timestamp|null), endedAt(Timestamp|null) }],
 *   review: { notAchieved, timeImprovement, reflection, nextAction }（1日1件の振り返り。tasksとは独立）
 *
 * plannedStartTimeは「予定」であり実績のstartedAtとは別物。予定は編集可、実績は編集不可。
 *
 * 実績時間はDBに保存しない（終了時刻 - 開始時刻で都度計算する）。
 * 開始・終了時刻は本サービスが押下時点の時刻を刻む。外部から時刻を渡すAPIは提供しない。
 */

const COLLECTION_NAME = 'dailyTimers';

const buildDocId = (representative, date) => `${representative}_${date}`;

const generateTaskId = () =>
  `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getDayDoc = async (representative, date) => {
  const ref = doc(db, COLLECTION_NAME, buildDocId(representative, date));
  const snapshot = await getDoc(ref);
  return { ref, data: snapshot.exists() ? snapshot.data() : null };
};

// merge:true でtasks以外のフィールド（review等）を保全する
const saveTasks = async (ref, representative, date, tasks) => {
  await setDoc(ref, {
    representative,
    date,
    tasks,
    updatedAt: Timestamp.now()
  }, { merge: true });
};

/**
 * 指定日の全担当者分のタイマーを取得する
 * @param {string} date - "YYYY-MM-DD"
 * @returns {Promise<Array<{id: string, representative: string, date: string, tasks: Array}>>}
 */
export const fetchDailyTimersByDate = async (date) => {
  try {
    const ref = collection(db, COLLECTION_NAME);
    const q = query(ref, where('date', '==', date));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.representative || '').localeCompare(b.representative || '', 'ja'));
  } catch (error) {
    console.error('Failed to fetch daily timers:', error);
    throw error;
  }
};

/**
 * タスク行を追加する
 * @param {string} representative - 担当者名
 * @param {string} date - "YYYY-MM-DD"
 * @param {string} name - タスク名
 * @param {number|null} plannedMinutes - 予定時間（分・整数）。予定なしはnull
 * @param {string|null} plannedStartTime - 予定開始時刻（"HH:MM"）。未設定はnull
 */
export const addTask = async (representative, date, name, plannedMinutes, plannedStartTime) => {
  try {
    const { ref, data } = await getDayDoc(representative, date);
    const tasks = data?.tasks || [];
    tasks.push({
      id: generateTaskId(),
      name,
      plannedMinutes: plannedMinutes ?? null,
      plannedStartTime: plannedStartTime ?? null,
      startedAt: null,
      endedAt: null
    });
    await saveTasks(ref, representative, date, tasks);
  } catch (error) {
    console.error('Failed to add task:', error);
    throw error;
  }
};

/**
 * タスクを開始する（押下時点の時刻を記録）
 * 同一担当者で実行中のタスクがあれば自動的に終了させる（二重計上の防止）
 */
export const startTask = async (representative, date, taskId) => {
  try {
    const { ref, data } = await getDayDoc(representative, date);
    if (!data) throw new Error('対象の日報データが見つかりません');

    const target = (data.tasks || []).find((t) => t.id === taskId);
    if (!target) throw new Error('対象のタスクが見つかりません');
    if (target.startedAt) throw new Error('一度開始したタスクは再開できません');

    const now = Timestamp.now();
    const tasks = data.tasks.map((t) => {
      if (t.id === taskId) return { ...t, startedAt: now };
      if (t.startedAt && !t.endedAt) return { ...t, endedAt: now };
      return t;
    });
    await saveTasks(ref, representative, date, tasks);
  } catch (error) {
    console.error('Failed to start task:', error);
    throw error;
  }
};

/**
 * タスクを終了する（押下時点の時刻を記録）
 */
export const endTask = async (representative, date, taskId) => {
  try {
    const { ref, data } = await getDayDoc(representative, date);
    if (!data) throw new Error('対象の日報データが見つかりません');

    const target = (data.tasks || []).find((t) => t.id === taskId);
    if (!target) throw new Error('対象のタスクが見つかりません');
    if (!target.startedAt) throw new Error('未開始のタスクは終了できません');
    if (target.endedAt) throw new Error('既に終了済みのタスクです');

    const now = Timestamp.now();
    const tasks = data.tasks.map((t) =>
      t.id === taskId ? { ...t, endedAt: now } : t
    );
    await saveTasks(ref, representative, date, tasks);
  } catch (error) {
    console.error('Failed to end task:', error);
    throw error;
  }
};

/**
 * タスク行を削除する
 * 一度でも開始した行（startedAtあり）は記録の信頼性を守るため削除不可
 */
export const deleteTask = async (representative, date, taskId) => {
  try {
    const { ref, data } = await getDayDoc(representative, date);
    if (!data) throw new Error('対象の日報データが見つかりません');

    const target = (data.tasks || []).find((t) => t.id === taskId);
    if (!target) throw new Error('対象のタスクが見つかりません');
    if (target.startedAt) throw new Error('開始済みのタスクは削除できません');

    const tasks = data.tasks.filter((t) => t.id !== taskId);
    await saveTasks(ref, representative, date, tasks);
  } catch (error) {
    console.error('Failed to delete task:', error);
    throw error;
  }
};

/**
 * 1日1件の振り返りを保存する（tasksには一切触れない）
 * @param {string} representative - 担当者名
 * @param {string} date - "YYYY-MM-DD"
 * @param {{notAchieved: string, timeImprovement: string, reflection: string, nextAction: string}} review
 */
export const saveReview = async (representative, date, review) => {
  try {
    const ref = doc(db, COLLECTION_NAME, buildDocId(representative, date));
    await setDoc(ref, {
      representative,
      date,
      review: {
        notAchieved: review.notAchieved || '',
        timeImprovement: review.timeImprovement || '',
        reflection: review.reflection || '',
        nextAction: review.nextAction || ''
      },
      updatedAt: Timestamp.now()
    }, { merge: true });
  } catch (error) {
    console.error('Failed to save review:', error);
    throw error;
  }
};

/**
 * 期間内にデータが存在する日付の一覧を取得する（カレンダーのドット表示用）
 * 単一フィールドの範囲クエリのため複合インデックスは不要
 * @param {string} startDate - "YYYY-MM-DD"
 * @param {string} endDate - "YYYY-MM-DD"
 * @returns {Promise<Array<string>>} データがある日付（"YYYY-MM-DD"）の配列
 */
export const fetchDatesWithData = async (startDate, endDate) => {
  try {
    const ref = collection(db, COLLECTION_NAME);
    const q = query(ref, where('date', '>=', startDate), where('date', '<=', endDate));
    const snapshot = await getDocs(q);
    return [...new Set(snapshot.docs.map((d) => d.data().date))];
  } catch (error) {
    console.error('Failed to fetch dates with data:', error);
    throw error;
  }
};
