// モールカレンダーの初期データ投入（一回限り・2026-09-07実行）
// Amazon/楽天/Qoo10の2026年セール予定を mallSaleEvents コレクションに登録する。
// 実施済み分は実績、未来分は去年（2025年）の実績パターンを1年ずらした見込みとして登録する
// （見込みかどうかはmemoに明記。日付は今後の公式発表でずれる可能性がある）
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, Timestamp } from 'firebase/firestore';

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

const ACTUAL = '実績（確定）';
const ESTIMATE_SUFFIX = '見込み（予想）。確定次第ずれる可能性あり';

const events = [
  // ---- Amazon ----
  { mall: 'Amazon', title: 'スマイルセール（初売り）', startDate: '2026-01-03', endDate: '2026-01-07', memo: ACTUAL },
  { mall: 'Amazon', title: 'スマイルセール', startDate: '2026-01-27', endDate: '2026-02-02', memo: ACTUAL },
  { mall: 'Amazon', title: '新生活セール', startDate: '2026-03-03', endDate: '2026-03-09', memo: ACTUAL },
  { mall: 'Amazon', title: '新生活セール FINAL', startDate: '2026-03-31', endDate: '2026-04-07', memo: ACTUAL },
  { mall: 'Amazon', title: 'スマイルセール（GW）', startDate: '2026-04-30', endDate: '2026-05-03', memo: ACTUAL },
  { mall: 'Amazon', title: 'スマイルセール', startDate: '2026-05-27', endDate: '2026-06-02', memo: ACTUAL },
  { mall: 'Amazon', title: 'プライムデー', startDate: '2026-07-10', endDate: '2026-07-13', memo: ACTUAL },
  { mall: 'Amazon', title: 'スマイルセール', startDate: '2026-08-28', endDate: '2026-09-03', memo: ACTUAL },
  { mall: 'Amazon', title: 'プライム感謝祭', startDate: '2026-10-03', endDate: '2026-10-09', memo: `${ESTIMATE_SUFFIX}（去年は10/4〜10/10開催）` },
  { mall: 'Amazon', title: 'ブラックフライデー', startDate: '2026-11-21', endDate: '2026-12-01', memo: `${ESTIMATE_SUFFIX}（去年と同時期を想定）` },
  { mall: 'Amazon', title: 'クリスマスタイムセール祭り', startDate: '2026-12-16', endDate: '2026-12-25', memo: `${ESTIMATE_SUFFIX}（去年と同時期を想定）` },

  // ---- 楽天 ----
  { mall: '楽天', title: '楽天スーパーSALE', startDate: '2026-03-03', endDate: '2026-03-10', memo: ACTUAL },
  { mall: '楽天', title: '楽天スーパーSALE', startDate: '2026-06-03', endDate: '2026-06-10', memo: ACTUAL },
  { mall: '楽天', title: '楽天スーパーSALE', startDate: '2026-09-04', endDate: '2026-09-11', memo: ACTUAL },
  { mall: '楽天', title: '楽天イーグルス感謝祭', startDate: '2026-11-13', endDate: '2026-11-15', memo: `${ESTIMATE_SUFFIX}（試合結果で変動あり）` },
  { mall: '楽天', title: '楽天ブラックフライデー', startDate: '2026-11-21', endDate: '2026-11-27', memo: ESTIMATE_SUFFIX },
  { mall: '楽天', title: '楽天スーパーSALE', startDate: '2026-12-03', endDate: '2026-12-10', memo: `${ESTIMATE_SUFFIX}（例年12月開催）` },
  { mall: '楽天', title: '楽天大感謝祭', startDate: '2026-12-18', endDate: '2026-12-25', memo: ESTIMATE_SUFFIX },

  // ---- Qoo10 ----
  // 第2回（初夏）は去年(2025年)が5/31〜6/12だった旨をユーザーから確認済み。
  // 2026年の実際の開催有無・日程は未確認のため見込み扱い
  { mall: 'Qoo10', title: 'メガ割', startDate: '2026-05-30', endDate: '2026-06-11', memo: `${ESTIMATE_SUFFIX}（未確認）。去年の第2回(5/31〜6/12)と同時期を想定` },
  { mall: 'Qoo10', title: 'メガ割', startDate: '2026-08-28', endDate: '2026-09-09', memo: ACTUAL },
  { mall: 'Qoo10', title: 'メガ割', startDate: '2026-11-20', endDate: '2026-12-04', memo: `${ESTIMATE_SUFFIX}（去年の第4回と同時期を想定）` }
];

const main = async () => {
  console.log(`${events.length}件のセール予定を登録します...`);
  for (const e of events) {
    const now = Timestamp.now();
    await addDoc(collection(db, 'mallSaleEvents'), {
      ...e,
      createdAt: now,
      updatedAt: now
    });
    console.log(`  登録: [${e.mall}] ${e.title} (${e.startDate}〜${e.endDate})`);
  }
  console.log('完了');
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
