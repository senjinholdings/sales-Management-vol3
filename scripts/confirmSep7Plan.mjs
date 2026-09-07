// 一回限りの措置（2026-09-07実行）: 荒幡さんが「予定を確定する」操作をしないまま
// 9/7を実際に運用してしまっていたため、開始ボタンのロックを解除する目的で
// dailyTimers/荒幡_2026-09-07 に planSnapshot（確定済みの印）を直接書き込む。
// 今後の日にも効く「1日分埋めないと開始できない」という仕組み自体は変更しない
// （9/7だけの特別措置。ユーザーの明示的な指示による）
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

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

const DOC_ID = '荒幡_2026-09-07';

const main = async () => {
  const ref = doc(db, 'dailyTimers', DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.error('対象ドキュメントが見つかりません:', DOC_ID);
    process.exit(1);
  }
  const data = snap.data();
  const tasks = data.tasks || [];
  if (data.planSnapshot) {
    console.log('すでにplanSnapshotが存在します。何もせず終了します。');
    process.exit(0);
  }

  const snapshotTasks = tasks.map((t) => ({
    id: t.id,
    name: t.name,
    plannedMinutes: t.plannedMinutes ?? null,
    plannedStartTime: t.plannedStartTime ?? null
  }));

  await setDoc(ref, {
    planSnapshot: {
      tasks: snapshotTasks,
      confirmedAt: Timestamp.now()
    },
    updatedAt: Timestamp.now()
  }, { merge: true });

  console.log(`完了: ${DOC_ID} にplanSnapshotを書き込みました（タスク${snapshotTasks.length}件）`);
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
