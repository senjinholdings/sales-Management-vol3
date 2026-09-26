/**
 * 一回限りの後片付け（2026年9月26日に実行済み: 案件136件・アクションログ192件を削除）。
 * 2回目以降は結果の記録を1件読むだけで何もしない。関数を消すとデプロイ（--non-interactiveで--force無し）が
 * 「関数の削除」で止まるため、消すときはFirebaseのコンソールで関数を先に削除してから、このファイルと登録を消す。
 *
 * 開発中の接続テスト（旧 src/test-firebase.js）が、開発で立ち上げるたびに本番の
 * progressDashboard と actionLogs に中身の無いテストデータを1件ずつ書いていた（案件は136件）。
 * テスト自体は削除済み。ここでは溜まった分を消す。
 *
 * 消すのは「項目が createdAt・testField・timestamp の3つだけ」かつ testField が
 * 「これはテストデータです」のものだけ。progressDashboard は配下のデータが1件でもあれば残す。
 * 結果は appConfig/cleanupTestData に残し、2回目以降は何もしない。
 */

const EXPECTED_KEYS = 'createdAt,testField,timestamp';
const isTestDoc = (data) => Object.keys(data).sort().join(',') === EXPECTED_KEYS
  && data.testField === 'これはテストデータです';

function createTestDataCleanup({ admin, db }) {
  return async function cleanupTestData() {
    const resultRef = db.collection('appConfig').doc('cleanupTestData');
    const done = await resultRef.get();
    if (done.exists && done.get('completedAt')) return;

    const result = {};
    for (const name of ['progressDashboard', 'actionLogs']) {
      const snap = await db.collection(name).get();
      const targets = [];
      let keptWithChildren = 0;
      for (const d of snap.docs) {
        if (!isTestDoc(d.data())) continue;
        if (name === 'progressDashboard' && (await d.ref.listCollections()).length > 0) {
          keptWithChildren += 1;
          continue;
        }
        targets.push(d.ref);
      }
      for (let i = 0; i < targets.length; i += 400) {
        const batch = db.batch();
        targets.slice(i, i + 400).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
      result[name] = { before: snap.size, deleted: targets.length, keptWithChildren };
      console.log(`テストデータの削除 ${name}: 全${snap.size}件中 ${targets.length}件を削除（配下ありで残した ${keptWithChildren}件）`);
    }
    await resultRef.set({ ...result, completedAt: admin.firestore.FieldValue.serverTimestamp() });
  };
}

module.exports = { createTestDataCleanup, isTestDoc };
