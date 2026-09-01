import { db } from '../firebase.js';
import {
  collection,
  query,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  deleteDoc,
  getDoc,
  setDoc,
  orderBy,
  where,
  serverTimestamp
} from 'firebase/firestore';
import { PROJECT_STAGES } from '../data/constants.js';
import { addBusinessDays } from '../utils/businessDays.js';

/**
 * 案件管理のFirestore操作サービス
 */

/**
 * 案件を1件取得する
 * @param {string} projectId - 案件ID
 * @returns {Promise<object|null>} 案件データ
 */
export const fetchProjectById = async (projectId) => {
  try {
    const projectRef = doc(db, 'progressDashboard', projectId);
    const snapshot = await getDoc(projectRef);
    if (!snapshot.exists()) return null;
    return { id: snapshot.id, ...snapshot.data() };
  } catch (error) {
    console.error('Failed to fetch project by id:', error);
    throw error;
  }
};

/**
 * 案件を全件取得する（progressDashboardのフェーズ8 = 受注案件）
 * @returns {Promise<Array<{id: string, data: object}>>} 案件一覧
 */
export const fetchProjects = async () => {
  try {
    const progressRef = collection(db, 'progressDashboard');
    // 既存案件（isExistingProject === true）を全フェーズ取得
    const snapshot = await getDocs(progressRef);
    const all = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
    // アカウント営業の案件（大型自主提案）はAccountSalesDashboard.js専用で管理するため除外する
    return all.filter(doc => doc.isExistingProject === true && doc.salesTrack !== 'account');
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    throw error;
  }
};

/**
 * プロジェクトごとに営業記録+最新エントリを一括取得する
 * @param {string} projectId - 案件ID
 * @returns {Promise<{records: Array, latestEntry: object|null}>}
 */
export const fetchProjectSalesData = async (projectId) => {
  try {
    // 営業記録を全件取得
    const recordsRef = collection(db, 'progressDashboard', projectId, 'salesRecords');
    const recordsSnap = await getDocs(recordsRef);
    const records = recordsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        // 登録日(date)降順、同日ならcreatedAtでタイブレーク
        const aDate = a.date || '';
        const bDate = b.date || '';
        if (aDate !== bDate) return bDate.localeCompare(aDate);
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });

    // 全レコードからエントリを収集し、アクティブなNA全件を返す
    const activeNaEntries = [];
    if (records.length > 0) {
      await Promise.all(records.map(async (record) => {
        const entriesRef = collection(db, 'progressDashboard', projectId, 'salesRecords', record.id, 'entries');
        const entriesSnap = await getDocs(entriesRef);
        entriesSnap.docs.forEach((d) => {
          const entry = { id: d.id, ...d.data() };
          if (entry.actionContent && entry.actionStatus !== 'done') {
            activeNaEntries.push(entry);
          }
        });
      }));
      // createdAt降順でソート
      activeNaEntries.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
    }

    const latestEntry = activeNaEntries[0] || null;
    return { records, latestEntry, activeNaEntries };
  } catch (error) {
    console.error('Failed to fetch project sales data:', error);
    return { records: [], latestEntry: null };
  }
};

/**
 * 案件ドキュメントを更新する
 * @param {string} projectId - 案件ID
 * @param {object} data - 更新データ
 */
export const updateProject = async (projectId, data) => {
  try {
    const projectRef = doc(db, 'progressDashboard', projectId);
    await updateDoc(projectRef, {
      ...data,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to update project:', error);
    throw error;
  }
};

/**
 * 進行ステージを完了にする（受注後の進行ステージ管理）
 * 完了日時はserverTimestampのみで記録し、ユーザー指定の日時は受け付けない
 * @param {string} projectId - 案件ID
 * @param {number} stageNo - 完了にするステージ番号（1〜7）
 */
export const completeStage = async (projectId, stageNo) => {
  try {
    const projectRef = doc(db, 'progressDashboard', projectId);
    await updateDoc(projectRef, {
      [`stageProgress.completedAt.${stageNo}`]: serverTimestamp(),
      'stageProgress.currentStage': Math.min(stageNo + 1, 7),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to complete stage:', error);
    throw error;
  }
};

/**
 * 進行ステージの完了を取り消す（直前に完了したステージのみ呼び出し側で制御）
 * @param {string} projectId - 案件ID
 * @param {number} stageNo - 取り消すステージ番号
 */
export const undoStage = async (projectId, stageNo) => {
  try {
    const projectRef = doc(db, 'progressDashboard', projectId);
    await updateDoc(projectRef, {
      [`stageProgress.completedAt.${stageNo}`]: null,
      'stageProgress.currentStage': stageNo,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to undo stage:', error);
    throw error;
  }
};

// ============================================
// 進行ステージ連動NA（ステージNA）
// ステージNAは stageNaStage フィールド（ステージ番号）で通常NAと区別する。
// データの正は stageProgress.completedAt であり、NAの完了状態はそこから同期される従属情報
// ============================================

// エントリIDは決定的ID。同じ生成処理が二重に走っても同一ドキュメントに収束し、重複が構造的に発生しない
const stageNaEntryId = (stageNo) => `stageNa_${stageNo}`;

/** DateをactionDueDate形式（YYYY-MM-DD）の文字列にする */
const toDueDateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Firestore Timestamp/秒数オブジェクトをDateに変換（変換不能ならnull） */
const timestampToDate = (ts) => {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return null;
};

/**
 * 案件配下の全営業記録からステージNA（stageNaStage付きエントリ）を収集する
 * @param {string} projectId - 案件ID
 * @returns {Promise<Array>} エントリ一覧（recordId付き）
 */
export const fetchStageNaEntries = async (projectId) => {
  const recordsRef = collection(db, 'progressDashboard', projectId, 'salesRecords');
  const recordsSnap = await getDocs(recordsRef);
  const results = [];
  await Promise.all(recordsSnap.docs.map(async (recordDoc) => {
    const entriesRef = collection(db, 'progressDashboard', projectId, 'salesRecords', recordDoc.id, 'entries');
    const entriesSnap = await getDocs(entriesRef);
    entriesSnap.docs.forEach((d) => {
      const entry = d.data();
      if (entry.stageNaStage != null) {
        results.push({ recordId: recordDoc.id, id: d.id, ...entry });
      }
    });
  }));
  return results;
};

/**
 * 指定ステージのNAを生成する。同ステージのNAが既にあれば（完了済みでも）何もしない
 * 期日 = 基準日（前ステージ完了日時）+ 標準営業日数。標準日数のないステージ1・7は生成対象外
 * @param {string} projectId - 案件ID
 * @param {object|null} project - 案件データ（担当者参照用）
 * @param {number} stageNo - NAを生成するステージ番号
 * @param {Date} baseDate - 期日計算の基準日（前ステージの完了日時）
 * @param {Array|null} [existingStageNas] - fetchStageNaEntriesの結果（省略時は内部で取得）
 */
export const ensureStageNa = async (projectId, project, stageNo, baseDate, existingStageNas = null) => {
  const stageDef = PROJECT_STAGES.find(s => s.no === stageNo);
  if (!stageDef || stageDef.standardDays == null || !baseDate) return;

  // 重複防止: 全営業記録を走査し、同ステージのNAが（完了済み含め）1件でもあればスキップ
  const stageNas = existingStageNas || await fetchStageNaEntries(projectId);
  if (stageNas.some(e => e.stageNaStage === stageNo)) return;

  // 追加先は最新の営業記録（なければ最小限の記録を作成）
  const records = await fetchSalesRecords(projectId, 'salesRecords');
  let recordId;
  if (records.length > 0) {
    const sorted = [...records].sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || (a.createdAt?.seconds || 0) * 1000;
      const bTime = b.createdAt?.toMillis?.() || (b.createdAt?.seconds || 0) * 1000;
      return bTime - aTime;
    });
    recordId = sorted[0].id;
  } else {
    const newRecordRef = await addDoc(
      collection(db, 'progressDashboard', projectId, 'salesRecords'),
      { phase: '', date: '', createdAt: serverTimestamp() }
    );
    recordId = newRecordRef.id;
  }

  const dueDate = addBusinessDays(baseDate, stageDef.standardDays);
  const entryRef = doc(db, 'progressDashboard', projectId, 'salesRecords', recordId, 'entries', stageNaEntryId(stageNo));
  await setDoc(entryRef, {
    memoContent: '',
    actionContent: stageDef.name,
    actionDueDate: toDueDateString(dueDate),
    actionAssignee: project?.representative || '',
    actionStatus: 'active',
    stageNaStage: stageNo,
    createdAt: serverTimestamp()
  });
};

/**
 * ステージ完了 + NA連動。運用管理・NA管理のどちらからの完了操作もこれを使う
 * 1. ステージをDoneにする（データの正を先に書く）
 * 2. 同ステージのステージNAを完了にする
 * 3. 次ステージのステージNAを生成（期日 = 今回の完了日時 + 標準営業日数）
 * @param {string} projectId - 案件ID
 * @param {number} stageNo - 完了にするステージ番号
 */
export const completeStageWithSync = async (projectId, stageNo) => {
  await completeStage(projectId, stageNo);

  try {
    const [project, stageNas] = await Promise.all([
      fetchProjectById(projectId),
      fetchStageNaEntries(projectId)
    ]);

    // 同ステージのNAを完了に（手動削除済みなら対象なし）
    await Promise.all(
      stageNas
        .filter(e => e.stageNaStage === stageNo && e.actionStatus !== 'done')
        .map(e => updateSalesEntry(projectId, e.recordId, e.id, { actionStatus: 'done' }))
    );

    // 次ステージのNAを生成。期日はserverTimestampの確定値から計算
    const completedDate = timestampToDate(project?.stageProgress?.completedAt?.[String(stageNo)]) || new Date();
    await ensureStageNa(projectId, project, stageNo + 1, completedDate, stageNas);
  } catch (error) {
    // NA連動の失敗でステージ記録は巻き戻さない（stageProgressが正）
    console.error('Failed to sync stage NA on complete:', error);
  }
};

/**
 * ステージ取消 + NA連動
 * 1. ステージの完了を取り消す
 * 2. 同ステージのステージNAを未完了（todo）に戻す
 * 3. 取消で無効になった次ステージの未完了ステージNAを削除（再Done時に新しい期日で再生成される）
 * @param {string} projectId - 案件ID
 * @param {number} stageNo - 取り消すステージ番号
 */
export const undoStageWithSync = async (projectId, stageNo) => {
  await undoStage(projectId, stageNo);

  try {
    const stageNas = await fetchStageNaEntries(projectId);
    await Promise.all([
      ...stageNas
        .filter(e => e.stageNaStage === stageNo && e.actionStatus === 'done')
        .map(e => updateSalesEntry(projectId, e.recordId, e.id, { actionStatus: 'active', reviewAssignee: '' })),
      ...stageNas
        .filter(e => e.stageNaStage === stageNo + 1 && e.actionStatus !== 'done')
        .map(e => deleteSalesEntry(projectId, e.recordId, e.id))
    ]);
  } catch (error) {
    console.error('Failed to sync stage NA on undo:', error);
  }
};

/**
 * ネクストアクションを追加する
 * @param {string} projectId - 案件ID
 * @param {string} tab - タブ種別 ("operator" or "sales")
 * @param {object} actionData - アクションデータ
 */
export const addNextAction = async (projectId, tab, actionData) => {
  try {
    const actionsRef = collection(db, 'progressDashboard', projectId, 'nextActions');
    await addDoc(actionsRef, {
      ...actionData,
      tab,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to add next action:', error);
    throw error;
  }
};

/**
 * タブ別にネクストアクションを取得する（createdAt昇順）
 * @param {string} projectId - 案件ID
 * @param {string} tab - タブ種別 ("operator" or "sales")
 * @returns {Promise<Array>} アクション一覧
 */
export const fetchNextActions = async (projectId, tab) => {
  try {
    // 複合インデックス不要: 全件取得→クライアントサイドでフィルタ&ソート
    const actionsRef = collection(db, 'progressDashboard', projectId, 'nextActions');
    const snapshot = await getDocs(actionsRef);
    return snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((action) => action.tab === tab)
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return aTime - bTime;
      });
  } catch (error) {
    console.error('Failed to fetch next actions:', error);
    throw error;
  }
};

/**
 * ネクストアクションを削除する
 * @param {string} projectId - 案件ID
 * @param {string} actionId - アクションID
 */
export const deleteNextAction = async (projectId, actionId) => {
  try {
    const actionRef = doc(db, 'progressDashboard', projectId, 'nextActions', actionId);
    await deleteDoc(actionRef);
  } catch (error) {
    console.error('Failed to delete next action:', error);
    throw error;
  }
};

/**
 * 月次データを取得する（なければnull）
 * @param {string} projectId - 案件ID
 * @param {string} month - 月（YYYY-MM形式）
 * @returns {Promise<object|null>} 月次データ
 */
export const fetchMonthlyData = async (projectId, month) => {
  try {
    const monthRef = doc(db, 'progressDashboard', projectId, 'monthlyData', month);
    const snapshot = await getDoc(monthRef);
    if (!snapshot.exists()) {
      return null;
    }
    return { id: snapshot.id, ...snapshot.data() };
  } catch (error) {
    console.error('Failed to fetch monthly data:', error);
    throw error;
  }
};

/**
 * 月次データを保存する（マージモード）
 * @param {string} projectId - 案件ID
 * @param {string} month - 月（YYYY-MM形式）
 * @param {object} data - 保存データ
 */
export const saveMonthlyData = async (projectId, month, data) => {
  try {
    const monthRef = doc(db, 'progressDashboard', projectId, 'monthlyData', month);
    await setDoc(monthRef, data, { merge: true });
  } catch (error) {
    console.error('Failed to save monthly data:', error);
    throw error;
  }
};

/**
 * スタンドアロンNA用の親ドキュメントを確保する
 * fetchAllNextActionsで検出するために親ドキュメントが必要
 * @param {string} projectId - スタンドアロンNA用案件ID
 */
export const ensureStandaloneNaProject = async (projectId) => {
  try {
    const projectRef = doc(db, 'progressDashboard', projectId);
    await setDoc(projectRef, {
      companyName: '商材なし',
      productName: '',
      isStandaloneNa: true
    }, { merge: true });
  } catch (error) {
    console.error('Failed to ensure standalone NA project:', error);
    throw error;
  }
};

/**
 * 営業記録を追加する
 * @param {string} projectId - 案件ID
 * @param {object} data - 営業記録データ
 */
export const addSalesRecord = async (projectId, data, subCol = 'salesRecords') => {
  try {
    const recordsRef = collection(db, 'progressDashboard', projectId, subCol);
    await addDoc(recordsRef, data);
  } catch (error) {
    console.error('Failed to add sales record:', error);
    throw error;
  }
};

/**
 * 営業記録を全件取得する
 * @param {string} projectId - 案件ID
 * @returns {Promise<Array>} 営業記録一覧
 */
export const fetchSalesRecords = async (projectId, subCol = 'salesRecords') => {
  try {
    const recordsRef = collection(db, 'progressDashboard', projectId, subCol);
    const snapshot = await getDocs(recordsRef);
    return snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
  } catch (error) {
    console.error('Failed to fetch sales records:', error);
    throw error;
  }
};

/**
 * 受注確定を保存する（受注モーダルの保存処理の共通化）
 * - 案件ドキュメントを既存案件へin-place移行する（複製ドキュメントは作らない）
 * - 成約レコード: salesRecords内に「confirmedDateを持たないフェーズ8レコード」
 *   （営業記録タブのフェーズ8更新で生まれたレコード）があれば、最新の1件に受注情報を
 *   上書きして成約レコードへ昇格させる。これにより1回の受注で成約案件一覧に
 *   2行出る二重計上を吸収する。confirmedDate付き（確定済みの過去の成約）は
 *   保護し、新しい成約レコードを追加する
 * @param {string} dealId - 案件ID
 * @param {object} orderData - 受注モーダルの入力値
 */
export const saveReceivedOrder = async (dealId, orderData) => {
  const today = new Date().toISOString().split('T')[0];
  const confirmedDate = orderData.receivedOrderDate || today;

  const dealRef = doc(db, 'progressDashboard', dealId);
  await updateDoc(dealRef, {
    status: 'フェーズ8',
    isExistingProject: true,
    confirmedDate,
    receivedOrderDate: orderData.receivedOrderDate || '',
    receivedOrderAmount: orderData.receivedOrderAmount,
    contractRequested: true,
    updatedAt: serverTimestamp()
  });

  const orderFields = {
    phase: 'フェーズ8',
    budget: orderData.receivedOrderAmount,
    confirmedDate,
    salesRep: orderData.salesRep || '',
    operatorRep: orderData.operatorRep || '',
    startDate: orderData.startDate || '',
    endDate: orderData.endDate || ''
  };

  const records = await fetchSalesRecords(dealId, 'salesRecords');
  const absorbTargets = records
    .filter((r) => r.phase === 'フェーズ8' && !r.confirmedDate)
    .sort((a, b) => {
      const aDate = a.date || '';
      const bDate = b.date || '';
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      const aTime = a.createdAt?.toMillis?.() || (a.createdAt?.seconds ?? 0) * 1000;
      const bTime = b.createdAt?.toMillis?.() || (b.createdAt?.seconds ?? 0) * 1000;
      return bTime - aTime;
    });

  if (absorbTargets.length > 0) {
    // 上書き時はdate（商談日）とrecordTypeを元レコードのまま維持する
    const target = absorbTargets[0];
    await updateSalesRecord(dealId, target.id, {
      ...orderFields,
      recordType: target.recordType || '新規'
    }, 'salesRecords');
  } else {
    await addSalesRecord(dealId, {
      ...orderFields,
      date: today,
      recordType: '新規',
      createdAt: new Date()
    }, 'salesRecords');
  }
};

/**
 * 営業記録を更新する
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 記録ID
 * @param {object} data - 更新データ
 */
export const updateSalesRecord = async (projectId, recordId, data, subCol = 'salesRecords') => {
  try {
    const recordRef = doc(db, 'progressDashboard', projectId, subCol, recordId);
    await updateDoc(recordRef, data);
  } catch (error) {
    console.error('Failed to update sales record:', error);
    throw error;
  }
};

/**
 * 営業記録を削除する
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 記録ID
 */
export const deleteSalesRecord = async (projectId, recordId, subCol = 'salesRecords') => {
  try {
    const recordRef = doc(db, 'progressDashboard', projectId, subCol, recordId);
    await deleteDoc(recordRef);
  } catch (error) {
    console.error('Failed to delete sales record:', error);
    throw error;
  }
};

/**
 * キーパーソンを追加する
 * @param {string} projectId - 案件ID
 * @param {object} data - キーパーソンデータ
 */
export const addKeyPerson = async (projectId, data) => {
  try {
    const personsRef = collection(db, 'progressDashboard', projectId, 'keyPersons');
    await addDoc(personsRef, data);
  } catch (error) {
    console.error('Failed to add key person:', error);
    throw error;
  }
};

/**
 * キーパーソンを全件取得する
 * @param {string} projectId - 案件ID
 * @returns {Promise<Array>} キーパーソン一覧
 */
export const fetchKeyPersons = async (projectId) => {
  try {
    const personsRef = collection(db, 'progressDashboard', projectId, 'keyPersons');
    const snapshot = await getDocs(personsRef);
    return snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
  } catch (error) {
    console.error('Failed to fetch key persons:', error);
    throw error;
  }
};

/**
 * キーパーソンを更新する
 * @param {string} projectId - 案件ID
 * @param {string} personId - キーパーソンID
 * @param {object} data - 更新データ
 */
export const updateKeyPerson = async (projectId, personId, data) => {
  try {
    const personRef = doc(db, 'progressDashboard', projectId, 'keyPersons', personId);
    await updateDoc(personRef, data);
  } catch (error) {
    console.error('Failed to update key person:', error);
    throw error;
  }
};

/**
 * キーパーソンを削除する
 * @param {string} projectId - 案件ID
 * @param {string} personId - キーパーソンID
 */
export const deleteKeyPerson = async (projectId, personId) => {
  try {
    const personRef = doc(db, 'progressDashboard', projectId, 'keyPersons', personId);
    await deleteDoc(personRef);
  } catch (error) {
    console.error('Failed to delete key person:', error);
    throw error;
  }
};

// ============================================
// キーパーソン接触ログ
// ============================================

/**
 * 接触ログを追加する
 * @param {string} projectId - 案件ID
 * @param {string} personId - キーパーソンID
 * @param {object} data - { contactDate, memo }
 */
export const addContactLog = async (projectId, personId, data) => {
  try {
    const logsRef = collection(db, 'progressDashboard', projectId, 'keyPersons', personId, 'contactLogs');
    await addDoc(logsRef, { ...data, createdAt: serverTimestamp() });
  } catch (error) {
    console.error('Failed to add contact log:', error);
    throw error;
  }
};

/**
 * 接触ログを全件取得する（日付降順）
 * @param {string} projectId - 案件ID
 * @param {string} personId - キーパーソンID
 * @returns {Promise<Array>} 接触ログ一覧
 */
export const fetchContactLogs = async (projectId, personId) => {
  try {
    const logsRef = collection(db, 'progressDashboard', projectId, 'keyPersons', personId, 'contactLogs');
    const snapshot = await getDocs(logsRef);
    const logs = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
    // 接触日付の降順でソート
    logs.sort((a, b) => (b.contactDate || '').localeCompare(a.contactDate || ''));
    return logs;
  } catch (error) {
    console.error('Failed to fetch contact logs:', error);
    throw error;
  }
};

/**
 * 接触ログを更新する
 * @param {string} projectId - 案件ID
 * @param {string} personId - キーパーソンID
 * @param {string} logId - ログID
 * @param {object} data - 更新データ
 */
export const updateContactLog = async (projectId, personId, logId, data) => {
  try {
    const logRef = doc(db, 'progressDashboard', projectId, 'keyPersons', personId, 'contactLogs', logId);
    await updateDoc(logRef, { ...data, updatedAt: serverTimestamp() });
  } catch (error) {
    console.error('Failed to update contact log:', error);
    throw error;
  }
};

/**
 * 接触ログを削除する
 * @param {string} projectId - 案件ID
 * @param {string} personId - キーパーソンID
 * @param {string} logId - ログID
 */
export const deleteContactLog = async (projectId, personId, logId) => {
  try {
    const logRef = doc(db, 'progressDashboard', projectId, 'keyPersons', personId, 'contactLogs', logId);
    await deleteDoc(logRef);
  } catch (error) {
    console.error('Failed to delete contact log:', error);
    throw error;
  }
};

// ============================================
// 運用メモ（週次メモ）
// ============================================

/**
 * 運用メモを追加する
 * @param {string} projectId - 案件ID
 * @param {object} memoData - メモデータ { content: string }
 */
export const addOperationMemo = async (projectId, memoData) => {
  try {
    const memosRef = collection(db, 'progressDashboard', projectId, 'operationMemos');
    await addDoc(memosRef, {
      ...memoData,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to add operation memo:', error);
    throw error;
  }
};

/**
 * 運用メモを全件取得する（作成日時昇順）
 * @param {string} projectId - 案件ID
 * @returns {Promise<Array>} メモ一覧
 */
export const fetchOperationMemos = async (projectId) => {
  try {
    const memosRef = collection(db, 'progressDashboard', projectId, 'operationMemos');
    const snapshot = await getDocs(memosRef);
    return snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
  } catch (error) {
    console.error('Failed to fetch operation memos:', error);
    throw error;
  }
};

/**
 * 運用メモを削除する
 * @param {string} projectId - 案件ID
 * @param {string} memoId - メモID
 */
export const updateOperationMemo = async (projectId, memoId, updateData) => {
  try {
    const memoRef = doc(db, 'progressDashboard', projectId, 'operationMemos', memoId);
    await updateDoc(memoRef, updateData);
  } catch (error) {
    console.error('Failed to update operation memo:', error);
    throw error;
  }
};

export const deleteOperationMemo = async (projectId, memoId) => {
  try {
    const memoRef = doc(db, 'progressDashboard', projectId, 'operationMemos', memoId);
    await deleteDoc(memoRef);
  } catch (error) {
    console.error('Failed to delete operation memo:', error);
    throw error;
  }
};

// ============================================
// 営業記録メモ（接触履歴）
// ============================================

/**
 * 営業記録にメモを追加する
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {object} memoData - メモデータ { content: string }
 */
export const addSalesRecordMemo = async (projectId, recordId, memoData) => {
  try {
    const memosRef = collection(db, 'progressDashboard', projectId, 'salesRecords', recordId, 'memos');
    await addDoc(memosRef, {
      ...memoData,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to add sales record memo:', error);
    throw error;
  }
};

/**
 * 営業記録のメモを全件取得する（作成日時昇順）
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @returns {Promise<Array>} メモ一覧
 */
export const fetchSalesRecordMemos = async (projectId, recordId) => {
  try {
    const memosRef = collection(db, 'progressDashboard', projectId, 'salesRecords', recordId, 'memos');
    const snapshot = await getDocs(memosRef);
    return snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return aTime - bTime;
      });
  } catch (error) {
    console.error('Failed to fetch sales record memos:', error);
    throw error;
  }
};

/**
 * 営業記録のメモを削除する
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {string} memoId - メモID
 */
export const deleteSalesRecordMemo = async (projectId, recordId, memoId) => {
  try {
    const memoRef = doc(db, 'progressDashboard', projectId, 'salesRecords', recordId, 'memos', memoId);
    await deleteDoc(memoRef);
  } catch (error) {
    console.error('Failed to delete sales record memo:', error);
    throw error;
  }
};

// ============================================
// 営業記録ネクストアクション
// ============================================

/**
 * 営業記録にネクストアクションを追加する
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {object} actionData - { content, dueDate, assignee }
 */
export const addSalesRecordAction = async (projectId, recordId, actionData) => {
  try {
    const actionsRef = collection(db, 'progressDashboard', projectId, 'salesRecords', recordId, 'actions');
    await addDoc(actionsRef, {
      ...actionData,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to add sales record action:', error);
    throw error;
  }
};

/**
 * 営業記録のネクストアクションを全件取得する（作成日時昇順）
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @returns {Promise<Array>} アクション一覧
 */
export const fetchSalesRecordActions = async (projectId, recordId) => {
  try {
    const actionsRef = collection(db, 'progressDashboard', projectId, 'salesRecords', recordId, 'actions');
    const snapshot = await getDocs(actionsRef);
    return snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return aTime - bTime;
      });
  } catch (error) {
    console.error('Failed to fetch sales record actions:', error);
    throw error;
  }
};

/**
 * 営業記録のネクストアクションを削除する
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {string} actionId - アクションID
 */
export const deleteSalesRecordAction = async (projectId, recordId, actionId) => {
  try {
    const actionRef = doc(db, 'progressDashboard', projectId, 'salesRecords', recordId, 'actions', actionId);
    await deleteDoc(actionRef);
  } catch (error) {
    console.error('Failed to delete sales record action:', error);
    throw error;
  }
};

// ============================================
// 営業エントリ（接触メモ + NA統合）
// ============================================

/**
 * 営業記録配下にエントリを追加する（メモ+NA統合）
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {object} entryData - { memoContent, actionContent, actionDueDate, actionAssignee, phase }
 */
export const addSalesEntry = async (projectId, recordId, entryData, subCol = 'salesRecords') => {
  try {
    const entriesRef = collection(db, 'progressDashboard', projectId, subCol, recordId, 'entries');
    await addDoc(entriesRef, {
      ...entryData,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to add sales entry:', error);
    throw error;
  }
};

/**
 * 営業記録配下のエントリを全件取得する（作成日時降順）
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @returns {Promise<Array>} エントリ一覧
 */
export const fetchSalesEntries = async (projectId, recordId, subCol = 'salesRecords') => {
  try {
    const entriesRef = collection(db, 'progressDashboard', projectId, subCol, recordId, 'entries');
    const snapshot = await getDocs(entriesRef);
    return snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
  } catch (error) {
    console.error('Failed to fetch sales entries:', error);
    throw error;
  }
};

/**
 * 営業記録配下のエントリを削除する
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {string} entryId - エントリID
 */
export const deleteSalesEntry = async (projectId, recordId, entryId, subCol = 'salesRecords') => {
  try {
    const entryRef = doc(db, 'progressDashboard', projectId, subCol, recordId, 'entries', entryId);
    await deleteDoc(entryRef);
  } catch (error) {
    console.error('Failed to delete sales entry:', error);
    throw error;
  }
};

/**
 * 営業エントリを更新する
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {string} entryId - エントリID
 * @param {object} data - 更新データ
 */
export const updateSalesEntry = async (projectId, recordId, entryId, data, subCol = 'salesRecords') => {
  try {
    const entryRef = doc(db, 'progressDashboard', projectId, subCol, recordId, 'entries', entryId);
    await updateDoc(entryRef, data);
  } catch (error) {
    console.error('Failed to update sales entry:', error);
    throw error;
  }
};

/**
 * 営業エントリのステータスを更新する（active/done）
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {string} entryId - エントリID
 * @param {string} status - "active" or "done"
 */
export const updateSalesEntryStatus = async (projectId, recordId, entryId, status, subCol = 'salesRecords') => {
  try {
    const entryRef = doc(db, 'progressDashboard', projectId, subCol, recordId, 'entries', entryId);
    await updateDoc(entryRef, { actionStatus: status });
  } catch (error) {
    console.error('Failed to update sales entry status:', error);
    throw error;
  }
};

/**
 * 全プロジェクトのNA付きエントリを一括取得する
 * @returns {Promise<Array>} NA一覧（projectId, recordId, entryデータ, 案件情報付き）
 */
// ============================================
// NAコメント（看板ボード用）
// ============================================

/**
 * NAエントリにコメントを追加する
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {string} entryId - エントリID
 * @param {object} commentData - { content, author }
 * @param {string} subCol - サブコレクション名
 */
export const addNaComment = async (projectId, recordId, entryId, commentData, subCol = 'salesRecords') => {
  try {
    const commentsRef = collection(
      db, 'progressDashboard', projectId, subCol, recordId, 'entries', entryId, 'comments'
    );
    await addDoc(commentsRef, {
      ...commentData,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to add NA comment:', error);
    throw error;
  }
};

/**
 * NAエントリのコメントを全件取得する（作成日時昇順）
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {string} entryId - エントリID
 * @param {string} subCol - サブコレクション名
 * @returns {Promise<Array>} コメント一覧
 */
export const fetchNaComments = async (projectId, recordId, entryId, subCol = 'salesRecords') => {
  try {
    const commentsRef = collection(
      db, 'progressDashboard', projectId, subCol, recordId, 'entries', entryId, 'comments'
    );
    const snapshot = await getDocs(commentsRef);
    return snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return aTime - bTime;
      });
  } catch (error) {
    console.error('Failed to fetch NA comments:', error);
    throw error;
  }
};

/**
 * NAコメントを更新する
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {string} entryId - エントリID
 * @param {string} commentId - コメントID
 * @param {object} data - 更新データ
 * @param {string} subCol - サブコレクション名
 */
export const updateNaComment = async (projectId, recordId, entryId, commentId, data, subCol = 'salesRecords') => {
  try {
    const commentRef = doc(
      db, 'progressDashboard', projectId, subCol, recordId, 'entries', entryId, 'comments', commentId
    );
    await updateDoc(commentRef, data);
  } catch (error) {
    console.error('Failed to update NA comment:', error);
    throw error;
  }
};

/**
 * NAコメントを削除する
 * @param {string} projectId - 案件ID
 * @param {string} recordId - 営業記録ID
 * @param {string} entryId - エントリID
 * @param {string} commentId - コメントID
 * @param {string} subCol - サブコレクション名
 */
export const deleteNaComment = async (projectId, recordId, entryId, commentId, subCol = 'salesRecords') => {
  try {
    const commentRef = doc(
      db, 'progressDashboard', projectId, subCol, recordId, 'entries', entryId, 'comments', commentId
    );
    await deleteDoc(commentRef);
  } catch (error) {
    console.error('Failed to delete NA comment:', error);
    throw error;
  }
};

export const fetchAllNextActions = async () => {
  try {
    // 全案件を取得（フェーズ制限なし）
    const progressRef = collection(db, 'progressDashboard');
    const projectsSnap = await getDocs(progressRef);

    const allNas = [];

    // 指定サブコレクションからNAエントリを収集するヘルパー
    const collectFromSubCol = async (projectDoc, subColName) => {
      const projectId = projectDoc.id;
      const projectData = projectDoc.data();
      const recordsRef = collection(db, 'progressDashboard', projectId, subColName);
      const recordsSnap = await getDocs(recordsRef);

      for (const recordDoc of recordsSnap.docs) {
        const recordId = recordDoc.id;
        const entriesRef = collection(db, 'progressDashboard', projectId, subColName, recordId, 'entries');
        const entriesSnap = await getDocs(entriesRef);

        entriesSnap.docs.forEach((entryDoc) => {
          const entry = entryDoc.data();
          if (entry.actionContent) {
            allNas.push({
              id: entryDoc.id,
              projectId,
              recordId,
              subCol: subColName,
              companyName: projectData.companyName || '',
              productName: projectData.productName || '',
              confirmedDate: projectData.confirmedDate || '', // 進行ステージ対象判定用（受注日）
              ...entry
            });
          }
        });
      }
    };

    // 全案件について両方のサブコレクションを並列取得
    await Promise.all(
      projectsSnap.docs.map(async (projectDoc) => {
        await Promise.all([
          collectFromSubCol(projectDoc, 'salesRecords'),
          collectFromSubCol(projectDoc, 'newCaseSalesRecords')
        ]);
      })
    );

    // 作成日時降順
    allNas.sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });

    return allNas;
  } catch (error) {
    console.error('Failed to fetch all next actions:', error);
    throw error;
  }
};

/**
 * 案件に紐付いたtl;dv議事録を取得する（新しい順）
 * コレクション: meetings/{tldvMeetingId}（dealIds配列にprojectIdを含むもので絞り込み。
 * 1つのMTGで複数案件が話されることがあるため、案件は複数紐付きうる）
 * @param {string} projectId - 案件ID
 */
export const fetchMeetingsForDeal = async (projectId) => {
  try {
    const q = query(collection(db, 'meetings'), where('dealIds', 'array-contains', projectId));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const aTime = a.happenedAt ? new Date(a.happenedAt).getTime() : 0;
        const bTime = b.happenedAt ? new Date(b.happenedAt).getTime() : 0;
        return bTime - aTime;
      });
  } catch (error) {
    console.error('Failed to fetch meetings for deal:', error);
    throw error;
  }
};
