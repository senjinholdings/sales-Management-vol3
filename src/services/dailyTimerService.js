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
 *             sessions: [{ startedAt(Timestamp), endedAt(Timestamp|null) }] }],
 *   review: { notAchieved, timeImprovement, reflection, nextAction }（1日1件の振り返り。tasksとは独立）
 *
 * sessionsは作業区間の配列（時系列順）。終了したタスクは「再開」で区間を追加できる。
 * 開いている区間（endedAt=null）は常に最後の1つのみ。
 *
 * plannedStartTimeは「予定」であり実績とは別物。
 *
 * 実績時間はDBに保存しない（閉じた区間の合算を都度計算する）。
 * 開始・終了時刻は通常、開始/終了/再開ボタン押下時点の時刻を刻む。
 * タイマー押し忘れの事後修正としてupdateTaskSessionsで各区間の時刻のみ手動修正できる。
 *
 * 旧形式（startedAt/endedAt直持ち）のタスクはgetTaskSessionsが区間1つとして解釈し、
 * いずれかの操作時に新形式へ変換して書き戻す（一括マイグレーションはしない）。
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

/**
 * タスクの作業区間配列を返す
 * 旧形式（startedAt/endedAt直持ち）は区間1つとして解釈する（表示側もこれを経由すること）
 */
export const getTaskSessions = (task) => {
  if (Array.isArray(task.sessions)) return task.sessions;
  if (task.startedAt) return [{ startedAt: task.startedAt, endedAt: task.endedAt ?? null }];
  return [];
};

/** 旧形式タスクを新形式（sessions配列）に変換する（書き込み時の正規化用） */
const normalizeTask = (task) => {
  const { startedAt, endedAt, ...rest } = task;
  return { ...rest, sessions: getTaskSessions(task) };
};

const isRunningTask = (task) =>
  task.sessions.length > 0 && !task.sessions[task.sessions.length - 1].endedAt;

/** 開いている区間を指定時刻で閉じる */
const closeOpenSessions = (sessions, endedAt) =>
  sessions.map((s) => (s.endedAt ? s : { ...s, endedAt }));

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
    const tasks = (data?.tasks || []).map(normalizeTask);
    tasks.push({
      id: generateTaskId(),
      name,
      plannedMinutes: plannedMinutes ?? null,
      plannedStartTime: plannedStartTime ?? null,
      sessions: []
    });
    await saveTasks(ref, representative, date, tasks);
  } catch (error) {
    console.error('Failed to add task:', error);
    throw error;
  }
};

/**
 * 割り込みタスクを追加して即開始する（押下時点の時刻で最初の作業区間を開く）
 * 予定開始時刻は持たない（既存タスクの予定にも影響しない）
 * 同一担当者で実行中のタスクがあれば自動的に終了させる（二重計上の防止）
 * @param {string} representative - 担当者名
 * @param {string} date - "YYYY-MM-DD"
 * @param {string} name - タスク名
 * @param {number|null} plannedMinutes - 予定時間（分・整数）。予定なしはnull
 */
export const addTaskAndStart = async (representative, date, name, plannedMinutes) => {
  try {
    const { ref, data } = await getDayDoc(representative, date);
    const now = Timestamp.now();
    const tasks = (data?.tasks || [])
      .map(normalizeTask)
      .map((t) => (isRunningTask(t) ? { ...t, sessions: closeOpenSessions(t.sessions, now) } : t));
    tasks.push({
      id: generateTaskId(),
      name,
      plannedMinutes: plannedMinutes ?? null,
      plannedStartTime: null,
      sessions: [{ startedAt: now, endedAt: null }]
    });
    await saveTasks(ref, representative, date, tasks);
  } catch (error) {
    console.error('Failed to add and start task:', error);
    throw error;
  }
};

/**
 * タスクを開始または再開する（押下時点の時刻で新しい作業区間を開く）
 * 未開始なら初回区間、終了済みなら追加区間となり、開始と再開は同一処理
 * 同一担当者で実行中のタスクがあれば自動的に終了させる（二重計上の防止）
 */
export const startTask = async (representative, date, taskId) => {
  try {
    const { ref, data } = await getDayDoc(representative, date);
    if (!data) throw new Error('対象の日報データが見つかりません');

    const tasks = (data.tasks || []).map(normalizeTask);
    const target = tasks.find((t) => t.id === taskId);
    if (!target) throw new Error('対象のタスクが見つかりません');
    if (isRunningTask(target)) throw new Error('既に実行中のタスクです');

    const now = Timestamp.now();
    const updated = tasks.map((t) => {
      if (t.id === taskId) {
        return { ...t, sessions: [...t.sessions, { startedAt: now, endedAt: null }] };
      }
      if (isRunningTask(t)) return { ...t, sessions: closeOpenSessions(t.sessions, now) };
      return t;
    });
    await saveTasks(ref, representative, date, updated);
  } catch (error) {
    console.error('Failed to start task:', error);
    throw error;
  }
};

/**
 * タスクを終了する（開いている作業区間を押下時点の時刻で閉じる）
 */
export const endTask = async (representative, date, taskId) => {
  try {
    const { ref, data } = await getDayDoc(representative, date);
    if (!data) throw new Error('対象の日報データが見つかりません');

    const tasks = (data.tasks || []).map(normalizeTask);
    const target = tasks.find((t) => t.id === taskId);
    if (!target) throw new Error('対象のタスクが見つかりません');
    if (target.sessions.length === 0) throw new Error('未開始のタスクは終了できません');
    if (!isRunningTask(target)) throw new Error('既に終了済みのタスクです');

    const now = Timestamp.now();
    const updated = tasks.map((t) =>
      t.id === taskId ? { ...t, sessions: closeOpenSessions(t.sessions, now) } : t
    );
    await saveTasks(ref, representative, date, updated);
  } catch (error) {
    console.error('Failed to end task:', error);
    throw error;
  }
};

/** "HH:MM" をドキュメントの日付のローカル時刻Timestampに変換する（秒は00） */
const timeToTimestamp = (date, hhmm) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return Timestamp.fromDate(new Date(y, m - 1, d, h, min, 0, 0));
};

/**
 * タスクの作業区間の時刻を手動修正する（タイマー押し忘れの事後修正用）
 * @param {string} representative - 担当者名
 * @param {string} date - "YYYY-MM-DD"
 * @param {string} taskId - タスクID
 * @param {Array<{start: string, end: string|null}>} sessionTimes - 区間ごとの時刻（"HH:MM"、その日付内・時系列順）
 * 制約:
 * - 区間の追加・削除はできない（未開始タスクのみ区間1つの新規入力=完了扱いを許可）
 * - endにnullを渡せるのは元々開いていた区間のみ（手動修正で実行中状態は作らない）
 * - 各区間で終了>開始、区間同士は重複不可
 */
export const updateTaskSessions = async (representative, date, taskId, sessionTimes) => {
  try {
    const { ref, data } = await getDayDoc(representative, date);
    if (!data) throw new Error('対象の日報データが見つかりません');

    const tasks = (data.tasks || []).map(normalizeTask);
    const target = tasks.find((t) => t.id === taskId);
    if (!target) throw new Error('対象のタスクが見つかりません');

    if (target.sessions.length === 0) {
      if (sessionTimes.length !== 1) throw new Error('未開始のタスクは区間1つのみ入力できます');
    } else if (sessionTimes.length !== target.sessions.length) {
      throw new Error('区間数が変更されています。画面を再読み込みしてください');
    }

    let prevEndMs = null;
    const newSessions = sessionTimes.map((st, i) => {
      const label = sessionTimes.length > 1 ? `区間${i + 1}: ` : '';
      if (!st.start) throw new Error(`${label}開始時刻を入力してください`);
      const wasOpen = !!target.sessions[i] && !target.sessions[i].endedAt;
      if (!st.end && !wasOpen) throw new Error(`${label}終了時刻を入力してください`);

      const startedAt = timeToTimestamp(date, st.start);
      if (prevEndMs !== null && startedAt.toMillis() < prevEndMs) {
        throw new Error(`${label}前の区間と時間が重なっています`);
      }
      if (!st.end) {
        // 元々実行中だった区間は開始時刻のみ修正し、実行中を継続する
        prevEndMs = null;
        return { startedAt, endedAt: null };
      }
      const endedAt = timeToTimestamp(date, st.end);
      if (endedAt.toMillis() <= startedAt.toMillis()) {
        throw new Error(`${label}終了時刻は開始時刻より後にしてください`);
      }
      prevEndMs = endedAt.toMillis();
      return { startedAt, endedAt };
    });

    const updated = tasks.map((t) => (t.id === taskId ? { ...t, sessions: newSessions } : t));
    await saveTasks(ref, representative, date, updated);
  } catch (error) {
    console.error('Failed to update task sessions:', error);
    throw error;
  }
};

/**
 * タスク行を削除する
 * 一度でも開始した行（作業区間あり）は記録の信頼性を守るため削除不可
 */
export const deleteTask = async (representative, date, taskId) => {
  try {
    const { ref, data } = await getDayDoc(representative, date);
    if (!data) throw new Error('対象の日報データが見つかりません');

    const tasks = (data.tasks || []).map(normalizeTask);
    const target = tasks.find((t) => t.id === taskId);
    if (!target) throw new Error('対象のタスクが見つかりません');
    if (target.sessions.length > 0) throw new Error('開始済みのタスクは削除できません');

    const updated = tasks.filter((t) => t.id !== taskId);
    await saveTasks(ref, representative, date, updated);
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
