import { db } from '../firebase.js';
import {
  collection,
  getDocs,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';

/**
 * スタッフ管理のFirestore操作サービス
 * コレクション: staffMembers/{docId}
 * フィールド: name(string), role("operator"|"sales"), email(string, 任意), createdAt(timestamp)
 */

const COLLECTION_NAME = 'staffMembers';

/**
 * スタッフを追加する
 * @param {string} name - 氏名
 * @param {string} role - "operator" or "sales"
 */
export const addStaff = async (name, role) => {
  try {
    const ref = collection(db, COLLECTION_NAME);
    await addDoc(ref, {
      name,
      role,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to add staff:', error);
    throw error;
  }
};

/**
 * 全スタッフを取得する
 * @returns {Promise<Array<{id: string, name: string, role: string}>>}
 */
export const fetchAllStaff = async () => {
  try {
    const ref = collection(db, COLLECTION_NAME);
    const snapshot = await getDocs(ref);
    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return aTime - bTime;
      });
  } catch (error) {
    console.error('Failed to fetch staff:', error);
    throw error;
  }
};

/**
 * ロール別にスタッフを取得する
 * @param {string} role - "operator" or "sales"
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export const fetchStaffByRole = async (role) => {
  try {
    const all = await fetchAllStaff();
    return all.filter((s) => s.role === role);
  } catch (error) {
    console.error('Failed to fetch staff by role:', error);
    throw error;
  }
};

/**
 * スタッフのメールアドレスを更新する
 * @param {string} staffId - ドキュメントID
 * @param {string} email - メールアドレス
 */
export const updateStaffEmail = async (staffId, email) => {
  try {
    const ref = doc(db, COLLECTION_NAME, staffId);
    await updateDoc(ref, { email });
  } catch (error) {
    console.error('Failed to update staff email:', error);
    throw error;
  }
};

/**
 * スタッフを削除する
 * @param {string} staffId - ドキュメントID
 */
export const deleteStaff = async (staffId) => {
  try {
    const ref = doc(db, COLLECTION_NAME, staffId);
    await deleteDoc(ref);
  } catch (error) {
    console.error('Failed to delete staff:', error);
    throw error;
  }
};
