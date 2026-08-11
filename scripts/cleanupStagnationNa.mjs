// フェーズ4滞留NA「決済者に直接話すことを提案する」の重複クリーンアップ（一回限り・2026-08-11実行）
// backup-stagnation-na-2026-08-11.json の action==='delete' のエントリのみを削除する。
// 削除直前にレコード単位で現存エントリを再取得し、actionContentの完全一致を再検証してから消す
// （スキャン後に内容が変わった/消えたエントリはスキップして報告）。
// 併せて対象案件のphase4StagnationNaCreatedAtフラグ未設定なら付与する。
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, getDoc, doc, writeBatch, Timestamp
} from 'firebase/firestore';
import { readFileSync } from 'fs';

const firebaseConfig = {
  projectId: 'sales-management-staging',
  appId: '1:691990337458:web:a7c67e5829105029b276ab',
  storageBucket: 'sales-management-staging.firebasestorage.app',
  apiKey: 'AIzaSyDcacPHbsNmktEJAvlawcTxqtI5CQzqmx8',
  authDomain: 'sales-management-staging.firebaseapp.com',
  messagingSenderId: '691990337458',
};

const TARGET_CONTENT = '決済者に直接話すことを提案する';
const BATCH_SIZE = 500;
const backupPath = process.argv[2];
if (!backupPath) {
  console.error('使い方: node cleanupStagnationNa.mjs <バックアップJSONのパス>');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const main = async () => {
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  const deletions = backup.entries.filter((e) => e.action === 'delete');
  const keeps = backup.entries.filter((e) => e.action === 'keep');
  console.log(`バックアップ読み込み: 削除対象${deletions.length}件 / 残す${keeps.length}件`);

  // レコード単位でグルーピングして現存エントリを再取得・検証
  const byRecord = new Map(); // "dealId/subCol/recordId" -> deletions[]
  for (const d of deletions) {
    const key = `${d.dealId}/${d.subCol}/${d.recordId}`;
    if (!byRecord.has(key)) byRecord.set(key, []);
    byRecord.get(key).push(d);
  }
  console.log(`対象レコード数: ${byRecord.size}`);

  const verifiedRefs = [];
  let skippedMissing = 0;
  let skippedChanged = 0;
  for (const [key, list] of byRecord) {
    const [dealId, subCol, recordId] = key.split('/');
    const entriesSnap = await getDocs(
      collection(db, 'progressDashboard', dealId, subCol, recordId, 'entries')
    );
    const current = new Map(entriesSnap.docs.map((d) => [d.id, d.data()]));
    for (const del of list) {
      const cur = current.get(del.entryId);
      if (!cur) { skippedMissing++; continue; }
      if (cur.actionContent !== TARGET_CONTENT) {
        skippedChanged++;
        console.log(`スキップ(内容変更): ${del.path}`);
        continue;
      }
      verifiedRefs.push(doc(db, 'progressDashboard', dealId, subCol, recordId, 'entries', del.entryId));
    }
  }
  console.log(`検証済み削除対象: ${verifiedRefs.length}件（消失スキップ${skippedMissing} / 内容変更スキップ${skippedChanged}）`);

  // writeBatch 500件ずつで削除
  let deleted = 0;
  for (let i = 0; i < verifiedRefs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = verifiedRefs.slice(i, i + BATCH_SIZE);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
    deleted += chunk.length;
    console.log(`削除進捗: ${deleted}/${verifiedRefs.length}`);
  }

  // 対象案件のフラグ確認・付与
  const dealIds = [...new Set(backup.entries.map((e) => e.dealId))];
  for (const dealId of dealIds) {
    const snap = await getDoc(doc(db, 'progressDashboard', dealId));
    if (!snap.exists()) { console.log(`フラグ確認: 案件${dealId}は存在しません`); continue; }
    const flag = snap.data().phase4StagnationNaCreatedAt;
    if (flag) {
      console.log(`フラグ確認: ${dealId} → 設定済み`);
    } else {
      const batch = writeBatch(db);
      batch.update(doc(db, 'progressDashboard', dealId), {
        phase4StagnationNaCreatedAt: Timestamp.now(),
      });
      await batch.commit();
      console.log(`フラグ確認: ${dealId} → 未設定だったため付与しました`);
    }
  }

  // 検証: 対象案件の残存対象エントリを数える（各案件1件のみが期待値）
  console.log('\n===== 検証（残存件数） =====');
  for (const dealId of dealIds) {
    let remain = 0;
    for (const subCol of ['salesRecords', 'newCaseSalesRecords']) {
      const recordsSnap = await getDocs(collection(db, 'progressDashboard', dealId, subCol));
      for (const recDoc of recordsSnap.docs) {
        const entriesSnap = await getDocs(
          collection(db, 'progressDashboard', dealId, subCol, recDoc.id, 'entries')
        );
        remain += entriesSnap.docs.filter((d) => d.data().actionContent === TARGET_CONTENT).length;
      }
    }
    const ok = remain === 1 ? 'OK' : '要確認!';
    console.log(`${dealId}: 残存${remain}件 [${ok}]`);
  }

  console.log(`\n完了: ${deleted}件を削除しました`);
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
