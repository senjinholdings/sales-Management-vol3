// フェーズ8レコードの実態調査（読み取り専用・書き込みなし）
// 全案件のsalesRecords/newCaseSalesRecordsのレコード（entriesは読まない）を走査し、
// phase==='フェーズ8'のレコードを分類する
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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

const main = async () => {
  const dealsSnap = await getDocs(collection(db, 'progressDashboard'));
  console.log(`案件数: ${dealsSnap.size}`);
  const deals = dealsSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

  const rows = [];
  const CONCURRENCY = 10;
  for (let i = 0; i < deals.length; i += CONCURRENCY) {
    await Promise.all(deals.slice(i, i + CONCURRENCY).map(async ({ id, data }) => {
      for (const subCol of ['salesRecords', 'newCaseSalesRecords']) {
        const snap = await getDocs(collection(db, 'progressDashboard', id, subCol));
        snap.forEach((rec) => {
          const rd = rec.data();
          if (rd.phase !== 'フェーズ8') return;
          rows.push({
            dealId: id,
            companyName: data.companyName || '',
            productName: data.productName || '',
            isExistingProject: !!data.isExistingProject,
            subCol,
            recordId: rec.id,
            hasBudget: rd.budget != null && rd.budget !== '' && rd.budget !== 0,
            hasConfirmedDate: !!rd.confirmedDate,
            hasRecordType: !!rd.recordType,
            recordType: rd.recordType || null,
            date: rd.date || '',
            visibleInClosedList: (data.isExistingProject ? 'salesRecords' : 'newCaseSalesRecords') === subCol,
          });
        });
      }
    }));
  }

  console.log(`フェーズ8レコード総数: ${rows.length}`);
  const visible = rows.filter((r) => r.visibleInClosedList);
  console.log(`成約案件一覧に表示される行数: ${visible.length}`);
  const withInfo = visible.filter((r) => r.hasBudget || r.hasConfirmedDate);
  const withoutInfo = visible.filter((r) => !r.hasBudget && !r.hasConfirmedDate);
  console.log(`  受注情報あり(budget/confirmedDateどちらか): ${withInfo.length}`);
  console.log(`  受注情報なし(営業記録のphase更新由来とみられる): ${withoutInfo.length}`);

  // 案件ごとの表示行数（2行以上=重複疑い）
  const byDeal = new Map();
  visible.forEach((r) => {
    if (!byDeal.has(r.dealId)) byDeal.set(r.dealId, []);
    byDeal.get(r.dealId).push(r);
  });
  const dup = [...byDeal.entries()].filter(([, list]) => list.length > 1);
  console.log(`\n表示2行以上の案件: ${dup.length}件`);
  dup.sort((a, b) => b[1].length - a[1].length);
  for (const [dealId, list] of dup) {
    const r0 = list[0];
    console.log(`- ${r0.companyName} / ${r0.productName} [${dealId}] ${list.length}行`);
    list.forEach((r) => console.log(`    ${r.subCol}/${r.recordId} date=${r.date} budget=${r.hasBudget} confirmed=${r.hasConfirmedDate} type=${r.recordType}`));
  }
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
