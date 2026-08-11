// フェーズ4滞留NA「決済者に直接話すことを提案する」の重複調査スクリプト（読み取り専用・削除なし）
// 全progressDashboard案件のsalesRecords/newCaseSalesRecords配下のentriesを走査し、
// 対象エントリを集計してJSONに書き出す
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { writeFileSync } from 'fs';

const firebaseConfig = {
  projectId: 'sales-management-staging',
  appId: '1:691990337458:web:a7c67e5829105029b276ab',
  storageBucket: 'sales-management-staging.firebasestorage.app',
  apiKey: 'AIzaSyDcacPHbsNmktEJAvlawcTxqtI5CQzqmx8',
  authDomain: 'sales-management-staging.firebaseapp.com',
  messagingSenderId: '691990337458',
};

const TARGET_CONTENT = '決済者に直接話すことを提案する';
const SUB_COLS = ['salesRecords', 'newCaseSalesRecords'];
const OUT_PATH = process.argv[2] || 'stagnation-na-scan.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let readCount = 0;

const tsToIso = (ts) => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  if (ts.seconds != null) return new Date(ts.seconds * 1000).toISOString();
  return String(ts);
};

const main = async () => {
  const dealsSnap = await getDocs(collection(db, 'progressDashboard'));
  readCount += dealsSnap.size;
  console.log(`progressDashboard: ${dealsSnap.size}件の案件を走査します`);

  const targets = []; // 対象エントリ全件（フルデータ、バックアップ兼用）
  const deals = dealsSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

  // 同時実行を絞って順に走査
  const CONCURRENCY = 10;
  for (let i = 0; i < deals.length; i += CONCURRENCY) {
    const chunk = deals.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async ({ id: dealId, data: dealData }) => {
      for (const subCol of SUB_COLS) {
        const recordsSnap = await getDocs(collection(db, 'progressDashboard', dealId, subCol));
        readCount += recordsSnap.size;
        for (const recDoc of recordsSnap.docs) {
          const entriesSnap = await getDocs(
            collection(db, 'progressDashboard', dealId, subCol, recDoc.id, 'entries')
          );
          readCount += entriesSnap.size;
          for (const entryDoc of entriesSnap.docs) {
            const entry = entryDoc.data();
            if (entry.actionContent !== TARGET_CONTENT) continue;
            targets.push({
              path: `progressDashboard/${dealId}/${subCol}/${recDoc.id}/entries/${entryDoc.id}`,
              dealId,
              companyName: dealData.companyName || '',
              productName: dealData.productName || '',
              subCol,
              recordId: recDoc.id,
              entryId: entryDoc.id,
              createdAt: tsToIso(entry.createdAt),
              actionStatus: entry.actionStatus || '',
              actionDueDate: entry.actionDueDate || '',
              actionAssignee: entry.actionAssignee || '',
              fullData: { ...entry, createdAt: tsToIso(entry.createdAt) },
            });
          }
        }
      }
    }));
    process.stdout.write(`\r走査中... ${Math.min(i + CONCURRENCY, deals.length)}/${deals.length}案件`);
  }
  console.log('');

  // 案件ごとに最古1件（keep）とそれ以降（delete）に分類
  const byDeal = new Map();
  for (const t of targets) {
    if (!byDeal.has(t.dealId)) byDeal.set(t.dealId, []);
    byDeal.get(t.dealId).push(t);
  }
  const summary = [];
  let deleteTotal = 0;
  for (const [dealId, list] of byDeal) {
    list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    list.forEach((t, idx) => { t.action = idx === 0 ? 'keep' : 'delete'; });
    const del = list.length - 1;
    deleteTotal += del;
    summary.push({
      dealId,
      companyName: list[0].companyName,
      productName: list[0].productName,
      total: list.length,
      keep: 1,
      delete: del,
      oldestCreatedAt: list[0].createdAt,
      newestCreatedAt: list[list.length - 1].createdAt,
      statusBreakdown: list.reduce((acc, t) => {
        acc[t.actionStatus || '(none)'] = (acc[t.actionStatus || '(none)'] || 0) + 1;
        return acc;
      }, {}),
    });
  }
  summary.sort((a, b) => b.total - a.total);

  writeFileSync(OUT_PATH, JSON.stringify({
    scannedAt: new Date().toISOString(),
    targetContent: TARGET_CONTENT,
    dealCount: byDeal.size,
    totalEntries: targets.length,
    deleteTotal,
    readCount,
    summary,
    entries: targets,
  }, null, 2));

  console.log('\n===== 集計結果 =====');
  console.log(`対象エントリ総数: ${targets.length}件（${byDeal.size}案件）`);
  console.log(`削除対象: ${deleteTotal}件（各案件の最古1件を残す）`);
  console.log(`Firestore読み取り回数: 約${readCount}回`);
  console.log('\n--- 案件別 ---');
  for (const s of summary) {
    console.log(`${s.companyName} / ${s.productName} [${s.dealId}]`);
    console.log(`  計${s.total}件 → 残す1件・削除${s.delete}件 | 期間: ${s.oldestCreatedAt} 〜 ${s.newestCreatedAt} | status内訳: ${JSON.stringify(s.statusBreakdown)}`);
  }
  console.log(`\n詳細JSONを書き出しました: ${OUT_PATH}`);
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
