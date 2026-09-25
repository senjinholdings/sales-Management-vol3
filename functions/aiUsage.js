const OpenAI = require('openai');

// AI(OpenAI)の利用量と費用の記録。システム費用の画面（SystemCostsPage.js）で、
// 「どのアプリの・どの機能で・いくらかかっているか」をほぼリアルタイムに見るためのもの。
//
// OpenAIの公式の利用料金は1日単位でしか取れず、機能ごとの内訳も分からない。なので呼び出すたびに
// 返ってくる使用量（トークン数・Web検索の回数）をこちらで記録し、下の単価表で金額にしておく。
// 公式の確定値とは多少ずれる（単価表が古い・丸めの違い）ので、画面では「概算」として出す。
//
// 記録先は account-sales-board のFirestoreの aiUsageLogs（費用の画面はあちらにある）。
// このファイルは account-sales-board の functions/aiUsage.js と同じ中身で、configureAiUsage に渡す
// db（account-sales-boardのFirestore）とアプリ名だけが違う。記録の形を変えるときは両方を揃えること。
//
// 記録に失敗してもAIの呼び出し自体は止めない（費用の記録のために本来の機能が落ちるのは本末転倒）。

const COLLECTION = 'aiUsageLogs';

// モデルごとの単価（米ドル / 100万トークン）。OpenAIの料金ページの値。変わったらここだけ直す。
// 返ってくるモデル名は「gpt-4o-mini-2024-07-18」のように日付が付くので、前方一致の最長で引く。
const PRICES_USD_PER_1M_TOKENS = {
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-3.5-turbo': { input: 0.5, cachedInput: 0.5, output: 1.5 },
};
// 単価表に無いモデルは、手元で使っている中で一番高い gpt-4o の単価で見積もる（少なく見積もって
// 気づかないより、多めに出して気づけるほうがよい）。画面には「単価表に無いモデル」と出す。
const FALLBACK_PRICE = PRICES_USD_PER_1M_TOKENS['gpt-4o'];
// Web検索ツール（Responses APIの web_search）の1回あたりの料金（米ドル）。検索結果の読み込み分の
// トークンは入力トークンに含まれて返ってくるので、ここでは呼び出し回数の分だけを足す。
const WEB_SEARCH_USD_PER_CALL = 0.01;

let config = { db: null, app: null };

// 記録先とアプリ名を設定する。index.jsで一度だけ呼ぶ。
function configureAiUsage({ db, app }) {
  config = { db, app };
}

function priceForModel(model) {
  const name = String(model || '');
  const key = Object.keys(PRICES_USD_PER_1M_TOKENS)
    .filter((k) => name === k || name.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? { price: PRICES_USD_PER_1M_TOKENS[key], known: true } : { price: FALLBACK_PRICE, known: false };
}

// Chat Completions と Responses API で使用量の名前が違うので、ここで揃える。
function normalizeUsage(result) {
  const usage = (result && result.usage) || {};
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const cachedInputTokens = usage.prompt_tokens_details?.cached_tokens
    ?? usage.input_tokens_details?.cached_tokens ?? 0;
  const webSearchCalls = Array.isArray(result && result.output)
    ? result.output.filter((item) => item && item.type === 'web_search_call').length
    : 0;
  return { inputTokens, cachedInputTokens, outputTokens, webSearchCalls };
}

function estimateCostUsd(model, { inputTokens, cachedInputTokens, outputTokens, webSearchCalls }) {
  const { price, known } = priceForModel(model);
  const uncached = Math.max(0, inputTokens - cachedInputTokens);
  const tokenCost = (uncached * price.input + cachedInputTokens * price.cachedInput + outputTokens * price.output) / 1e6;
  return { costUsd: tokenCost + webSearchCalls * WEB_SEARCH_USD_PER_CALL, knownModel: known };
}

// 日付は日本時間で持つ（UTCで持つと朝9時前の分が前日に落ちる）。
function jstDateString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function recordAiUsage({ feature, model, result }) {
  if (!config.db) return;
  try {
    const usage = normalizeUsage(result);
    const usedModel = (result && result.model) || model || '';
    const { costUsd, knownModel } = estimateCostUsd(usedModel, usage);
    const now = new Date();
    const date = jstDateString(now);
    await config.db.collection(COLLECTION).add({
      app: config.app,
      feature,
      model: usedModel,
      ...usage,
      costUsd,
      knownModel,
      date,
      yearMonth: date.slice(0, 7),
      createdAt: now,
    });
  } catch (error) {
    console.error('AI利用量の記録に失敗:', error.message);
  }
}

// OpenAIクライアントの代わりに使う。chat.completions.create と responses.create だけを包み、
// 呼び出しが終わったら使用量を記録する（呼び出し方・戻り値は元のクライアントと同じ）。
// feature は画面の「機能別」に出す名前（例: '契約書のAI修正'）。
function createTrackedOpenAI({ apiKey, feature }) {
  const client = new OpenAI({ apiKey });
  const track = (fn) => async (params, ...rest) => {
    const result = await fn(params, ...rest);
    // 記録を待ってから返す。Cloud Functionsは応答を返したあとの処理が止められることがあるので、
    // 待たずに返すと記録が抜ける（書き込み1回ぶん遅くなるだけで、失敗しても例外は出さない）。
    await recordAiUsage({ feature, model: params && params.model, result });
    return result;
  };
  return {
    chat: { completions: { create: track(client.chat.completions.create.bind(client.chat.completions)) } },
    responses: { create: track(client.responses.create.bind(client.responses)) },
  };
}

module.exports = {
  configureAiUsage,
  createTrackedOpenAI,
  recordAiUsage,
  estimateCostUsd,
  normalizeUsage,
  jstDateString,
  PRICES_USD_PER_1M_TOKENS,
  WEB_SEARCH_USD_PER_CALL,
  AI_USAGE_COLLECTION: COLLECTION,
};
