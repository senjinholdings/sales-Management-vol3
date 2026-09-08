// 一回限りの措置（2026-09-08実行）: 画面確認のため9/8の振り返りウィザードを
// 実際に最後まで操作してしまい、reviewCompletedAt・review・振り返り固定タスクの
// タイマー実績・「就寝」タスクのrecoveryPlannedが、テスト操作のまま実データとして
// 残ってしまっていたため、これらだけを元に戻す（planSnapshot・その他のタスクは
// 実際の記入なので触らない）
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';

const firebaseConfig = {
  projectId: 'sales-management-staging',
  appId: '1:691990337458:web:a7c67e5829105029b276ab',
  storageBucket: 'sales-management-staging.firebasestorage.app',
  apiKey: 'AIzaSyDcacPHbsNmktEJAvlawcTxqtI5CQzqmx8',
  authDomain: 'sales-management-staging.firebaseapp.com',
  messagingSenderId: '691990337458',
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const DOC_ID = '荒幡_2026-09-08';

const main = async () => {
  const ref = doc(db, 'dailyTimers', DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.error('対象ドキュメントが見つかりません:', DOC_ID);
    process.exit(1);
  }
  const data = snap.data();
  const tasks = data.tasks || [];

  const updatedTasks = tasks.map((t) => {
    if (t.isReviewTask) {
      return { ...t, sessions: [] };
    }
    if (t.recoveryPlanned) {
      const { recoveryPlanned, ...rest } = t;
      return rest;
    }
    return t;
  });

  await updateDoc(ref, {
    reviewCompletedAt: deleteField(),
    review: {
      reminderAcked: false,
      pipelineStatusChecked: false,
      pipelineWeekChecked: false,
      pipelineStatusNote: '',
      pipelineWeekNote: ''
    },
    tasks: updatedTasks
  });

  console.log(`完了: ${DOC_ID} のreviewCompletedAt・review・振り返り固定タスクのsessions・recoveryPlannedを元に戻しました`);
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
