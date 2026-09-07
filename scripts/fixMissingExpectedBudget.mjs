// 一回限りの措置（2026-09-08実行）: 保有中の案件一覧で想定予算が0円表示になっていた
// 2案件について、expectedBudgetが未設定（undefined）のままだったのが原因と判明。
// それぞれ現在のフェーズと一致する直近の営業記録の金額を想定予算として設定する
// （ユーザーの確認・承認済み）
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';

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

const FIXES = [
  { id: 'cijfBJENNnlUvx3CuvKh', companyName: '株式会社magicnumber', productName: 'hiritu', expectedBudget: 6000000 },
  { id: 'TQkgnAIS6psvtJqnzNRm', companyName: '株式会社ソーシャルテック', productName: 'FUWAHIME', expectedBudget: 2000000 }
];

const main = async () => {
  for (const fix of FIXES) {
    const ref = doc(db, 'progressDashboard', fix.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      console.error(`対象ドキュメントが見つかりません: ${fix.id}`);
      continue;
    }
    const data = snap.data();
    if (data.companyName !== fix.companyName || data.productName !== fix.productName) {
      console.error(`会社名/商材名が想定と異なるため中止: ${fix.id}`, data.companyName, data.productName);
      continue;
    }
    if (data.expectedBudget) {
      console.log(`既にexpectedBudgetが設定済みのためスキップ: ${fix.companyName}/${fix.productName} = ${data.expectedBudget}`);
      continue;
    }
    await updateDoc(ref, { expectedBudget: fix.expectedBudget });
    console.log(`完了: ${fix.companyName}/${fix.productName} の想定予算を¥${fix.expectedBudget.toLocaleString()}に設定しました`);
  }
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
