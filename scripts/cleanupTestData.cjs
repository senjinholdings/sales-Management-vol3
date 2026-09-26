// 一回限り: 開発中の接続テスト（旧 src/test-firebase.js）が本番に書き込んでいたテストデータを消す。
// 消すのは「項目が createdAt・testField・timestamp の3つだけ」かつ testField が「これはテストデータです」のものだけ。
// progressDashboard は配下のデータが1件でもあれば消さない。
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.SA_JSON)) });
const db = admin.firestore();
const EXPECTED = 'createdAt,testField,timestamp';
const isTestDoc = (data) => Object.keys(data).sort().join(',') === EXPECTED && data.testField === 'これはテストデータです';
(async () => {
  for (const name of ['progressDashboard', 'actionLogs']) {
    const snap = await db.collection(name).get();
    const targets = [];
    let skippedWithChildren = 0;
    for (const d of snap.docs) {
      if (!isTestDoc(d.data())) continue;
      if (name === 'progressDashboard' && (await d.ref.listCollections()).length > 0) { skippedWithChildren += 1; continue; }
      targets.push(d.ref);
    }
    console.log(`${name}: 全${snap.size}件 / テストデータ${targets.length}件を削除${skippedWithChildren ? `（配下のデータがあるため残した: ${skippedWithChildren}件）` : ''}`);
    for (let i = 0; i < targets.length; i += 400) {
      const batch = db.batch();
      targets.slice(i, i + 400).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
    const after = await db.collection(name).get();
    console.log(`${name}: 削除後 ${after.size}件（残ったテストデータ ${after.docs.filter((d) => isTestDoc(d.data())).length}件）`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
