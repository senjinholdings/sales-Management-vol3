/**
 * Secret Managerへの動的な読み書きヘルパー。
 * 担当者ごとのChatwork/Slackトークンなど、デプロイ時に名前が確定していない
 * シークレットを実行時に作成・更新・取得するために使う
 * （tl;dv/OpenAI等の固定シークレットは従来どおりfunctions.runWith({secrets:[...]})で扱う）。
 * 生きた認証情報をFirestoreに置かない、という方針の実現手段
 * （Firestoreのセキュリティルールは現状ほぼ全開放のため）。
 */

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const client = new SecretManagerServiceClient();
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'sales-management-staging';

function secretPath(name) {
  return `projects/${PROJECT_ID}/secrets/${name}`;
}

/**
 * シークレットの最新バージョンの値を取得する。存在しなければnull。
 * @param {string} name - シークレット名（英数字とハイフン・アンダースコアのみ）
 * @returns {Promise<string|null>}
 */
async function getSecret(name) {
  try {
    const [version] = await client.accessSecretVersion({
      name: `${secretPath(name)}/versions/latest`
    });
    return version.payload.data.toString('utf8').trim();
  } catch (error) {
    if (error.code === 5) return null; // NOT_FOUND
    throw error;
  }
}

/**
 * シークレットを作成（無ければ）してから新しいバージョンを追加する。
 * @param {string} name - シークレット名
 * @param {string} value - 保存する値
 */
async function setSecret(name, value) {
  try {
    await client.createSecret({
      parent: `projects/${PROJECT_ID}`,
      secretId: name,
      secret: { replication: { automatic: {} } }
    });
  } catch (error) {
    if (error.code !== 6) throw error; // 6 = ALREADY_EXISTS はOK
  }
  await client.addSecretVersion({
    parent: secretPath(name),
    payload: { data: Buffer.from(value, 'utf8') }
  });
}

/**
 * シークレットが存在するかどうかだけを確認する（値は取得しない）。
 * @param {string} name - シークレット名
 * @returns {Promise<boolean>}
 */
async function hasSecret(name) {
  try {
    await client.getSecret({ name: secretPath(name) });
    return true;
  } catch (error) {
    if (error.code === 5) return false;
    throw error;
  }
}

/** 担当者のChatwork APIトークンのシークレット名（staffIdはFirestore自動IDなのでそのまま使える） */
function chatworkSecretName(staffId) {
  return `CHATWORK_TOKEN_${staffId}`;
}

/** 担当者のSlackユーザートークンのシークレット名（段階B用） */
function slackTokenSecretName(staffId) {
  return `SLACK_TOKEN_${staffId}`;
}

module.exports = { getSecret, setSecret, hasSecret, chatworkSecretName, slackTokenSecretName };
