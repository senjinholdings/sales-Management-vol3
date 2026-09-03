/**
 * モール別売上データの更新確認とSlack督促（30分おき）。
 *
 * データは別リポジトリ・別Firebaseプロジェクト「モール一括管理くん」
 * （mall-batch-manager）で管理されているが、Firestoreルールが全コレクション
 * read: if trueのため、認証なしのREST APIで直接読みに行く（このプロジェクト側の
 * 変更・書き込みは一切行わない）。
 *
 * 鮮度の基準は「CSVをいつアップロードしたか」ではなく「アップロードされたデータの
 * 中身が実際にいつの日付まであるか」＝unified_daily_salesの`date`フィールドの最大値。
 *
 * 進行状態（確認送付済みかどうか等）はこちら側のFirestore
 * （mallUpdateChecks/{productId}_{channel}）だけで完結させる。
 *
 * 状態遷移:
 * - watching: 通常状態。7日以上データが進んでいなければ30分おきに督促し続ける
 * - confirmation_sent: 「クライアントに確認送付」ボタンを押した後。1日待っても
 *   データが追いつかなければ30分おきに再督促（「もう一度確認送付する」ボタン）。
 *   人がボタンを押すのは送付系の2つだけで、反映確認はこの関数が自動で行う
 *   （次回チェック時にstaleDays < 7になっていれば自動でwatchingに戻し、完了報告を送る）
 * - finished: 予算消化により案件が終了した場合に「案件終了済み」ボタンで入る状態。
 *   ボタンを押した日以降の日付の売上データが新たに現れるまでは一切アラートしない。
 *   再開の検知も人がボタンを押すのではなく自動判定（追加予算が付いてCSVが
 *   新しい日付まで入稿された＝配信再開、とみなしwatchingへ自動的に戻す）
 */

const fetch = require('node-fetch');
const { WebClient } = require('@slack/web-api');
const { env } = require('./authHelpers');
const { resolveSlackUserId } = require('./slackApproval');

const MALL_PROJECT_ID = 'mall-batch-manager';
const FIRESTORE_DOCS_BASE = `https://firestore.googleapis.com/v1/projects/${MALL_PROJECT_ID}/databases/(default)/documents`;

const NOTIFY_CHANNEL_ID = 'C09UJMZ7JNR'; // #営業_日報
const REP_EMAIL = 'hikaru.arahata@senjinholdings.com';
const MANAGER_EMAIL = 'yoh.masuda@senjinholdings.com';

const STALE_DAYS = 7;
const ESCALATION_THROTTLE_MS = 30 * 60 * 1000; // 30分（同じ督促を連投しない間隔）
const CONFIRMATION_ESCALATE_AFTER_MS = 24 * 60 * 60 * 1000; // 確認送付から1日

/** Firestore REST APIのfields形式から通常のJSオブジェクトへ変換する（このユースケースに必要な型のみ対応） */
function parseFirestoreFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (value.stringValue !== undefined) result[key] = value.stringValue;
    else if (value.integerValue !== undefined) result[key] = Number(value.integerValue);
    else if (value.doubleValue !== undefined) result[key] = value.doubleValue;
    else if (value.booleanValue !== undefined) result[key] = value.booleanValue;
    else if (value.arrayValue !== undefined) {
      result[key] = (value.arrayValue.values || []).map((v) => parseFirestoreFields({ v }).v);
    } else {
      result[key] = null;
    }
  }
  return result;
}

/** コレクションを全件取得する（認証なし。mall-batch-manager側のルールが全read許可のため） */
async function fetchAllDocs(collectionName) {
  const docs = [];
  let pageToken = null;
  do {
    const url = `${FIRESTORE_DOCS_BASE}/${collectionName}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mall-batch-manager ${collectionName} 取得失敗: ${res.status}`);
    const json = await res.json();
    (json.documents || []).forEach((doc) => {
      docs.push({ id: doc.name.split('/').pop(), ...parseFirestoreFields(doc.fields) });
    });
    pageToken = json.nextPageToken || null;
  } while (pageToken);
  return docs;
}

/** unified_daily_salesを指定productIdでフィルタして取得する */
async function fetchUnifiedDailySalesByProduct(productId) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'unified_daily_sales' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'productId' },
          op: 'EQUAL',
          value: { stringValue: productId }
        }
      }
    }
  };
  const res = await fetch(`${FIRESTORE_DOCS_BASE}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`unified_daily_sales取得失敗（${productId}）: ${res.status}`);
  const rows = await res.json();
  return rows.filter((r) => r.document).map((r) => parseFirestoreFields(r.document.fields));
}

/** 指定日付から現在までの経過日数（データが無ければ無限大＝即座に督促対象） */
function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  if (isNaN(d.getTime())) return Infinity;
  return (Date.now() - d.getTime()) / (24 * 60 * 60 * 1000);
}

async function buildMentions(slack) {
  const [repId, managerId] = await Promise.all([
    resolveSlackUserId(slack, REP_EMAIL),
    resolveSlackUserId(slack, MANAGER_EMAIL)
  ]);
  return [repId, managerId].filter(Boolean).map((id) => `<@${id}>`).join(' ');
}

/**
 * 同じ案件（checkId）の督促・報告は1本のスレッドにまとめる。
 * threadTsが無ければ新規投稿してそれをスレッドの起点として保存し、
 * あれば返信する。反映確認・案件終了→再開などの「一区切り」イベントは
 * 呼び出し側でスレッドを返信した後にthreadTsをクリアし、次の放置は新しいスレッドで始める
 */
async function postMallMessage(checkRef, check, slack, { text, blocks }) {
  const threadTs = check.threadTs || null;
  const result = await slack.chat.postMessage({
    channel: NOTIFY_CHANNEL_ID,
    text,
    ...(blocks ? { blocks } : {}),
    ...(threadTs ? { thread_ts: threadTs } : {})
  });
  if (!threadTs) {
    await checkRef.set({ threadTs: result.ts }, { merge: true });
  }
  return result.ts;
}

/** 督促メッセージを投稿する（mode: 'initial'=初回放置検知 / 'reminder'=確認送付後1日超過） */
async function postMallAlert(slack, checkRef, check, { product, channel, latestSalesDate, checkId, mode }) {
  const mentions = await buildMentions(slack);
  const dateLabel = latestSalesDate ? `${latestSalesDate}までしかありません` : 'データが見つかりません';
  const productLabel = `${product.productName || '(商品名不明)'}（${channel}）`;

  const text = mode === 'reminder'
    ? `${mentions} ⏰ ${productLabel}: 確認送付から1日経ってもデータが更新されていません（${dateLabel}）`
    : `${mentions} ⚠️ ${productLabel} のデータが${dateLabel}（1週間以上更新なし）`;

  const buttonText = mode === 'reminder' ? 'もう一度確認送付する' : 'クライアントに確認送付';
  const actionId = mode === 'reminder' ? 'mall_resend_confirmation' : 'mall_send_confirmation';
  const value = JSON.stringify({ checkId });

  await postMallMessage(checkRef, check, slack, {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: buttonText }, action_id: actionId, value },
          { type: 'button', text: { type: 'plain_text', text: '案件終了済み' }, action_id: 'mall_mark_finished', value }
        ]
      }
    ]
  });
}

/**
 * @param {{admin: import('firebase-admin'), db: FirebaseFirestore.Firestore}} deps
 */
function createMallUpdateChecker({ admin, db }) {
  return async () => {
    const token = env('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN が未設定のためモール更新チェックをスキップ');
      return;
    }
    const slack = new WebClient(token);

    let clientAccounts;
    let products;
    try {
      [clientAccounts, products] = await Promise.all([
        fetchAllDocs('client_accounts'),
        fetchAllDocs('registered_products')
      ]);
    } catch (error) {
      // mall-batch-manager側の不調でこちらの他の処理まで止めない
      console.error('mall-batch-manager読み取り失敗（今回はスキップ）:', error.message);
      return;
    }

    // 過去の不正CSV取込によるゴミ商品（実際にクライアントへ割り当てられていない）を除外する
    const allowedProductIds = new Set();
    clientAccounts.forEach((acc) => {
      (Array.isArray(acc.allowedProductIds) ? acc.allowedProductIds : []).forEach((id) => allowedProductIds.add(id));
    });
    const realProducts = products.filter((p) => allowedProductIds.has(p.id) && p.status !== 'archived');

    for (const product of realProducts) {
      let salesRows;
      try {
        salesRows = await fetchUnifiedDailySalesByProduct(product.id);
      } catch (error) {
        console.error(`売上データ取得失敗（続行）: ${product.id}`, error.message);
        continue;
      }

      // 監視対象のチャネルは、実際にunified_daily_salesへ売上行がある channel だけにする。
      // 商品側のamazonCode/rakutenCode/qoo10Code（API連携用）は、CSV入稿の実績とは
      // 一致しないことが実データで確認できたため判定には使わない
      // （例: amazonCodeが空でもAmazonチャネルの売上行が存在するケースがあった）
      const channelsPresent = [...new Set(salesRows.map((r) => r.channel).filter(Boolean))];

      for (const channel of channelsPresent) {
        const latestSalesDate = salesRows
          .filter((r) => r.channel === channel)
          .reduce((max, r) => (r.date && (!max || r.date > max) ? r.date : max), null);
        const staleDays = daysSince(latestSalesDate);

        const checkId = `${product.id}_${channel}`;
        const checkRef = db.collection('mallUpdateChecks').doc(checkId);
        const checkSnap = await checkRef.get();
        const check = checkSnap.exists ? checkSnap.data() : { state: 'watching' };
        const now = admin.firestore.Timestamp.now();
        const canEscalate = Date.now() - (check.lastEscalatedAt?.toMillis?.() || 0) >= ESCALATION_THROTTLE_MS;

        try {
          if (check.state === 'finished') {
            // 終了ボタンを押した日より後の日付のデータが現れたら、配信再開とみなし自動で監視に戻す
            const finishedDateStr = check.finishedAt?.toDate
              ? check.finishedAt.toDate().toISOString().slice(0, 10)
              : null;
            const resumed = latestSalesDate && finishedDateStr && latestSalesDate > finishedDateStr;
            if (resumed) {
              // このスレッドはここで一区切り。次に放置が起きたら新しいスレッドで始める
              // （直後のcheckRef.set()はthreadTsを含まないフルセットなので自動的にクリアされる）
              const mentions = await buildMentions(slack);
              await postMallMessage(checkRef, check, slack, {
                text: `${mentions} 🔄 ${product.productName || '(商品名不明)'}（${channel}）の配信が再開されたようです。監視を再開します`
              });
              await checkRef.set({
                productId: product.id,
                channel,
                productName: product.productName || '',
                latestSalesDate,
                state: 'watching',
                confirmationRequestedAt: null,
                finishedAt: null,
                lastEscalatedAt: null,
                updatedAt: now
              });
            }
            continue;
          }

          if (check.state === 'confirmation_sent') {
            if (staleDays < STALE_DAYS) {
              // データが追いついた＝反映確認。人が押すのではなくここで自動判定して完了報告する。
              // ここでスレッドは一区切り（直後のcheckRef.set()がthreadTsを自動的にクリアする）
              const mentions = await buildMentions(slack);
              await postMallMessage(checkRef, check, slack, {
                text: `${mentions} ✅ ${product.productName || '(商品名不明)'}（${channel}）の反映を確認しました`
              });
              await checkRef.set({
                productId: product.id,
                channel,
                productName: product.productName || '',
                latestSalesDate,
                state: 'watching',
                confirmationRequestedAt: null,
                lastEscalatedAt: null,
                updatedAt: now
              });
              continue;
            }

            const requestedMs = check.confirmationRequestedAt?.toMillis?.() || 0;
            if (Date.now() - requestedMs >= CONFIRMATION_ESCALATE_AFTER_MS && canEscalate) {
              await postMallAlert(slack, checkRef, check, { product, channel, latestSalesDate, checkId, mode: 'reminder' });
              await checkRef.set({ ...check, latestSalesDate, lastEscalatedAt: now, updatedAt: now }, { merge: true });
            }
            continue;
          }

          // state === 'watching'
          if (staleDays >= STALE_DAYS && canEscalate) {
            await postMallAlert(slack, checkRef, check, { product, channel, latestSalesDate, checkId, mode: 'initial' });
            await checkRef.set({
              productId: product.id,
              channel,
              productName: product.productName || '',
              latestSalesDate,
              state: 'watching',
              lastEscalatedAt: now,
              updatedAt: now
            }, { merge: true });
          }
        } catch (error) {
          console.error(`モール督促処理失敗（続行）: ${checkId}`, error.message);
        }
      }
    }
  };
}

module.exports = { createMallUpdateChecker };
