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

// ============================================
// Chatwork連携（トークンはCloud Functions経由でSecret Managerに保存する。
// Firestoreは現状アクセス制限が全開放のため、生きた認証情報はここを通さない）
// ============================================

const APP_API_BASE = 'https://sales-management-staging.web.app/api';
const APP_SECRET = process.env.REACT_APP_MEETING_SCHEDULE_SECRET || '';

const appApiHeaders = () => ({
  'Content-Type': 'application/json',
  ...(APP_SECRET ? { 'x-app-secret': APP_SECRET } : {})
});

/**
 * 担当者のChatwork APIトークンを登録する
 * @param {string} staffId - ドキュメントID
 * @param {string} apiToken - Chatworkの設定画面で発行したAPIトークン
 */
export const registerChatworkToken = async (staffId, apiToken) => {
  const res = await fetch(`${APP_API_BASE}/staff/chatwork-token`, {
    method: 'POST',
    headers: appApiHeaders(),
    body: JSON.stringify({ staffId, apiToken })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

/**
 * 担当者のChatwork連携状況を取得する（トークンの値は返らない）
 * @param {string} staffId - ドキュメントID
 * @returns {Promise<boolean>}
 */
export const fetchChatworkStatus = async (staffId) => {
  const res = await fetch(`${APP_API_BASE}/staff/chatwork-status?staffId=${encodeURIComponent(staffId)}`, {
    headers: appApiHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.connected;
};

/**
 * 担当者が参加しているChatworkルーム一覧を取得する
 * @param {string} staffId - ドキュメントID
 * @returns {Promise<Array<{id: string, name: string, type: string}>>}
 */
export const fetchChatworkRooms = async (staffId) => {
  const res = await fetch(`${APP_API_BASE}/staff/chatwork-rooms?staffId=${encodeURIComponent(staffId)}`, {
    headers: appApiHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.rooms;
};

/**
 * 指定したChatworkルームのメンバー一覧を取得する
 * （お礼メッセージでメンションする相手を選ぶために使う）
 * @param {string} staffId - ドキュメントID
 * @param {string} roomId - ChatworkルームID
 * @returns {Promise<Array<{accountId: string, name: string}>>}
 */
export const fetchChatworkRoomMembers = async (staffId, roomId) => {
  const res = await fetch(`${APP_API_BASE}/staff/chatwork-room-members?staffId=${encodeURIComponent(staffId)}&roomId=${encodeURIComponent(roomId)}`, {
    headers: appApiHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.members;
};
