/**
 * account-sales-board（別のFirebaseプロジェクト）の資源を借りて使うための入口。
 * 契約書の雛形（Firestoreの contracts）、増田さんのGoogle連携・OpenAIのAPIキー（Secret Manager）、
 * AIの利用記録（Firestoreの aiUsageLogs）を、こちらに複製せずあちらのものをそのまま使う。
 *
 * 認証はこのCloud Functions自身の実行アカウント（TEMPLATE_READER_SERVICE_ACCOUNT）で行う。
 * account-sales-boardのGoogle Cloudプロジェクトで、このアカウントに次のロールを付けてある前提:
 *  - Firestore: Cloud Datastore のオーナー（雛形の読み取りと、AIの利用記録の書き込み）
 *  - Secret Manager のシークレット アクセサー（Google連携・OpenAIのAPIキーの読み取り）
 * 秘密情報はこちらに持たない（あちらで更新すれば、こちらもそのまま新しい値を使う）。
 */

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const TEMPLATE_PROJECT_ID = 'account-sales-board';
const TEMPLATE_READER_SERVICE_ACCOUNT = 'sales-management-staging@appspot.gserviceaccount.com';
const TEMPLATE_APP_NAME = 'accountSalesBoardTemplates';

/** account-sales-boardのFirestore（admin SDKの別アプリとして初期化し、使い回す） */
function getTemplateDb(admin) {
  const existing = admin.apps.find((a) => a && a.name === TEMPLATE_APP_NAME);
  const app = existing || admin.initializeApp({ projectId: TEMPLATE_PROJECT_ID }, TEMPLATE_APP_NAME);
  return app.firestore();
}

const secretManager = new SecretManagerServiceClient();

/** account-sales-boardのSecret Managerから値を読む。無ければnull。権限が無ければ理由付きのエラー */
async function readAccountSalesBoardSecret(name) {
  try {
    const [version] = await secretManager.accessSecretVersion({
      name: `projects/${TEMPLATE_PROJECT_ID}/secrets/${name}/versions/latest`,
    });
    return version.payload.data.toString('utf8').trim();
  } catch (error) {
    if (error.code === 5) return null; // NOT_FOUND
    if (error.code === 7) { // PERMISSION_DENIED
      const wrapped = new Error('account-sales-boardの設定を読めませんでした。account-sales-boardのGoogle Cloudプロジェクトで、'
        + `${TEMPLATE_READER_SERVICE_ACCOUNT} に「Secret Manager のシークレット アクセサー」のロールを付けてください`);
      wrapped.status = 500;
      throw wrapped;
    }
    throw error;
  }
}

/**
 * OpenAIのAPIキー。vol3自身のキー（OPENAI_API_KEY）は期限切れのため、account-sales-boardのキーを使う
 * （運用で決めたこと。費用はあちらのキーにまとまり、システム費用の画面では「営業管理vol3」として分かれて出る）。
 * 読めないとき（権限が外された等）だけ、こちらのキーに戻す。
 */
async function getOpenAiApiKey() {
  try {
    const key = await readAccountSalesBoardSecret('OPENAI_API_KEY');
    if (key) return key;
  } catch (error) {
    console.error('account-sales-boardのOpenAIキーの取得に失敗（vol3のキーで続行）:', error.message);
  }
  const own = process.env.OPENAI_API_KEY;
  return own ? own.trim() : null;
}

module.exports = {
  getTemplateDb,
  readAccountSalesBoardSecret,
  getOpenAiApiKey,
  TEMPLATE_PROJECT_ID,
  TEMPLATE_READER_SERVICE_ACCOUNT,
};
