import { db } from '../firebase.js';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'firebase/firestore';

/**
 * 紹介者(パートナー)向けネクストアクション。
 * 案件のNA（progressDashboard/{id}/{salesRecords|newCaseSalesRecords}/{recordId}/entries）と
 * 同じフィールド構成（actionContent/actionDueDate/actionAssignee/actionStatus/memoContent）を踏襲し、
 * NextActionManagementPage.js側での共通表示・共通ロジックの再利用を容易にする。
 */

export const addIntroducerNextAction = async (introducerId, actionData) => {
  try {
    const entriesRef = collection(db, 'introducers', introducerId, 'nextActions');
    await addDoc(entriesRef, {
      ...actionData,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to add introducer next action:', error);
    throw error;
  }
};

export const fetchIntroducerNextActions = async (introducerId) => {
  try {
    const entriesRef = collection(db, 'introducers', introducerId, 'nextActions');
    const snapshot = await getDocs(entriesRef);
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  } catch (error) {
    console.error('Failed to fetch introducer next actions:', error);
    throw error;
  }
};

export const updateIntroducerNextActionStatus = async (introducerId, naId, status) => {
  try {
    const entryRef = doc(db, 'introducers', introducerId, 'nextActions', naId);
    await updateDoc(entryRef, { actionStatus: status });
  } catch (error) {
    console.error('Failed to update introducer next action status:', error);
    throw error;
  }
};

export const updateIntroducerNextAction = async (introducerId, naId, data) => {
  try {
    const entryRef = doc(db, 'introducers', introducerId, 'nextActions', naId);
    await updateDoc(entryRef, data);
  } catch (error) {
    console.error('Failed to update introducer next action:', error);
    throw error;
  }
};

export const deleteIntroducerNextAction = async (introducerId, naId) => {
  try {
    const entryRef = doc(db, 'introducers', introducerId, 'nextActions', naId);
    await deleteDoc(entryRef);
  } catch (error) {
    console.error('Failed to delete introducer next action:', error);
    throw error;
  }
};

export const addIntroducerNaComment = async (introducerId, naId, commentData) => {
  try {
    const commentsRef = collection(db, 'introducers', introducerId, 'nextActions', naId, 'comments');
    await addDoc(commentsRef, {
      ...commentData,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to add introducer NA comment:', error);
    throw error;
  }
};

export const fetchIntroducerNaComments = async (introducerId, naId) => {
  try {
    const commentsRef = collection(db, 'introducers', introducerId, 'nextActions', naId, 'comments');
    const snapshot = await getDocs(commentsRef);
    return snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return aTime - bTime;
      });
  } catch (error) {
    console.error('Failed to fetch introducer NA comments:', error);
    throw error;
  }
};

export const updateIntroducerNaComment = async (introducerId, naId, commentId, data) => {
  try {
    const commentRef = doc(db, 'introducers', introducerId, 'nextActions', naId, 'comments', commentId);
    await updateDoc(commentRef, data);
  } catch (error) {
    console.error('Failed to update introducer NA comment:', error);
    throw error;
  }
};

export const deleteIntroducerNaComment = async (introducerId, naId, commentId) => {
  try {
    const commentRef = doc(db, 'introducers', introducerId, 'nextActions', naId, 'comments', commentId);
    await deleteDoc(commentRef);
  } catch (error) {
    console.error('Failed to delete introducer NA comment:', error);
    throw error;
  }
};

/**
 * 全紹介者のネクストアクションをフラットに取得する（NextActionManagementPage.js統合用）。
 * projectService.js の fetchAllNextActions と同じ考え方（全件取得→クライアント側で結合）。
 */
export const fetchAllIntroducerNextActions = async () => {
  try {
    const introducersRef = collection(db, 'introducers');
    const introducersSnap = await getDocs(introducersRef);

    const allNas = [];
    await Promise.all(introducersSnap.docs.map(async (introducerDoc) => {
      const introducerId = introducerDoc.id;
      const introducerData = introducerDoc.data();
      const entriesRef = collection(db, 'introducers', introducerId, 'nextActions');
      const entriesSnap = await getDocs(entriesRef);

      entriesSnap.docs.forEach((entryDoc) => {
        const entry = entryDoc.data();
        if (entry.actionContent) {
          allNas.push({
            id: entryDoc.id,
            introducerId,
            introducerName: introducerData.name || '',
            isIntroducerNa: true,
            ...entry
          });
        }
      });
    }));

    allNas.sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });

    return allNas;
  } catch (error) {
    console.error('Failed to fetch all introducer next actions:', error);
    throw error;
  }
};
