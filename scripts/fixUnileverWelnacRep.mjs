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

// この四半期の確定売上記録(salesRep:荒幡)を持つ、名義が増田のままだった2案件を荒幡名義に統一する
// ・ユニリーバ・ジャパン株式会社/Doveスクラブ＋クリームボディウォッシュ（既存, ¥70,000確定 2026-07-17分, salesRep:荒幡）
// ・WELNAC株式会社/フェミッシュホイップ（既存, ¥1,000,000確定 2026-07-31分, salesRep:荒幡）
// 同名会社の別案件（isExistingProject:false側）は売上記録が全て増田名義で一致しているため対象外
const targets = ['OAUUXuj5OcBiOCZ0U5Kr', 'jDDAMXprD631m2WRhhii'];

for (const id of targets) {
  const ref = doc(db, 'progressDashboard', id);
  const before = (await getDoc(ref)).data();
  console.log(id, before.companyName, before.productName, 'before:', before.representative);
  await updateDoc(ref, { representative: '荒幡' });
  const after = (await getDoc(ref)).data();
  console.log(id, 'after:', after.representative);
}
process.exit(0);
