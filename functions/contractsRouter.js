const crypto = require('crypto');
const { Readable } = require('stream');
const express = require('express');
const { google } = require('googleapis');
const { WebClient } = require('@slack/web-api');
const { proposeContractEdits, checkContractConsistency } = require('./contractRevisionAi');
const {
  extractDocIdFromUrl, getTemplateText, replaceRangeWithMarker, replaceRangeWithText, getDocsClient,
  GOOGLE_DOC_MIME_TYPE, isOfficeFileError,
} = require('./googleDocsClient');
const { requireAppSecret, env } = require('./authHelpers');
const { getSecret, chatworkSecretName } = require('./secrets');
const { getOrCreateRoomInviteLink } = require('./chatworkInviteLink');

// 契約書の雛形マスタ(contracts)と、案件ごとの締結依頼・締結状況
// (progressDashboard/{id}/contractRequests)・記入済み契約書(progressDashboard/{id}/generatedContracts)を扱う。
//
// account-sales-board(functions/contractsRouter.js)の契約書締結依頼をそのまま移したもの。
// 手順・文言・データの形はあちらに揃えてあり、違うのは次の点だけ:
//  - Googleドキュメント・ドライブの操作: あちらは担当者本人のGoogle連携(OAuth)を使うが、
//    こちらはGoogleアカウントでログインしない(共通ID/PW)ため、MTG登録(calendar.js)と同じ
//    ドメイン全体の委任のサービスアカウントで、設定画面で選んだ社内アカウントになりすまして操作する。
//  - 案件は progressDashboard。Chatworkルーム・Slackチャンネルは会社単位の clientMeetingSettings にある。
//  - 案件に担当者(連絡先)の一覧が無いため、メールで共有するときは宛先をフォームで直接入力する。
//  - 依頼者は案件の営業担当(representative)として記録する(ログインユーザーを識別できないため)。
//
// 契約書マスタは実体を持たず、Googleドキュメント等へのURLを登録するだけ。更新は上書きせず
// 常に新しいバージョンを追加する(groupKeyでグループ化し、グループ内でversionが最大のものが「現在の版」)。

// 依頼の投稿先。account-sales-board(functions/slackChannelConfig.js)と同じ契約書チームの
// チャンネル・メンション先に送る。値を変えるときは両方のリポジトリを揃えること。
const CONTRACT_REQUEST_SLACK_CHANNEL_ID = 'C06FKB0BEKC';
const CONTRACT_REQUEST_MENTION_USER_ID = 'U04NDGFM887';
const CONTRACT_REQUEST_CC_USER_ID = 'U018GS87H7Y';

// テスト送信であることを本文の1行目に含めるための文言。プレビューで見せる文面と
// 実際に送信する文面を完全に一致させたい(messageOverrideは本文をまるごと差し替えるため、
// 投稿時に別途テスト表示を足すとプレビューと食い違ってしまう)ので、文面を組み立てる時点で入れる。
const TEST_NOTICE_LINE = '【テスト送信】本番の依頼先チャンネルではなくテストグループに送っています';

// テストグループが未設定なまま明示的にテスト送信を求められたときのエラー文言。
// 「テストのつもりが本番に届いた」という事故を避けるため、この場合だけは黙って
// 本番にフォールバックせず、依頼そのものを400で止める。
const TEST_CHANNEL_NOT_CONFIGURED_ERROR =
  'テストグループのチャンネルIDが未設定です（マスター管理の契約書管理で設定してください）';

// SlackのチャンネルIDはC/G/Dで始まる英数字。取り違えて「#チャンネル名」を貼られると
// 通知が飛ばないまま気づけないため、保存時に弾いて理由を返す。
const CHANNEL_ID_PATTERN = /^[CGD][A-Z0-9]{6,}$/i;

// 依頼文の手動差し替え(messageOverride)の検証。空文字・空白のみは拒否し、極端に長い入力も拒否する。
const MESSAGE_OVERRIDE_MAX_LENGTH = 4000;
function normalizeMessageOverride(messageOverride) {
  if (messageOverride === undefined || messageOverride === null) return { value: null };
  if (typeof messageOverride !== 'string' || !messageOverride.trim()) {
    return { error: '依頼文を入力してください' };
  }
  const trimmed = messageOverride.trim();
  if (trimmed.length > MESSAGE_OVERRIDE_MAX_LENGTH) {
    return { error: `依頼文は${MESSAGE_OVERRIDE_MAX_LENGTH}文字以内で入力してください` };
  }
  return { value: trimmed };
}

// sendToTestChannel(依頼フォームの「テストグループに送る」チェックボックス)の検証。
function normalizeSendToTestChannel(value) {
  if (value === undefined || value === null) return { value: undefined };
  if (typeof value !== 'boolean') {
    return { error: 'sendToTestChannelはtrue/falseで指定してください' };
  }
  return { value };
}

// Firestoreのドキュメントを画面に返す形にする(Timestampは{_seconds}の形でそのまま返り、
// 画面側のtoDateで読める)。
function serializeDoc(id, data) {
  return { id, ...data };
}

async function postToSlack(text, channelId) {
  const token = env('SLACK_BOT_TOKEN');
  if (!token || !channelId) {
    throw new Error('SLACK_BOT_TOKEN または投稿先チャンネルIDが未設定です');
  }
  const slack = new WebClient(token);
  return slack.chat.postMessage({ channel: channelId, text });
}

// Googleドキュメント・ドライブを操作する範囲。ドメイン全体の委任の設定(Workspace管理者)で、
// サービスアカウントのクライアントIDにこの2つを許可しておく必要がある。
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
];

function createContractsRouter({ admin, db }) {
  const router = express.Router();
  const Timestamp = admin.firestore.Timestamp;
  const FieldValue = admin.firestore.FieldValue;

  // ログイン済みの社内画面からだけ呼ばれる(他の自前APIと同じ x-app-secret)。
  router.use((req, res, next) => {
    if (!requireAppSecret(req, res)) return;
    next();
  });

  // mediaMaterialsRouter.js の groupKeyFor と同じ考え方: 契約書名でグループ化し、
  // 同名の契約書が更新されるたびに新しいバージョンとして積み上げる。
  const groupKeyFor = (name) => `contract:${name}`;

  // requestFields(締結依頼時に入力させる項目)のバリデーションと正規化。
  // PATCH /contracts/:idと、新バージョン登録時の引き継ぎ(下記POST /contracts)の
  // 両方から使う。idを付け忘れている項目(新規追加分)にはここでサーバー側で採番する
  // ―― フロントでの一時的なidと衝突しないよう、既にidが付いている項目はそのまま使う。
  function normalizeRequestFields(requestFields) {
    if (!Array.isArray(requestFields)) {
      return { error: 'requestFieldsは配列で指定してください' };
    }
    const normalized = [];
    for (const raw of requestFields) {
      if (!raw || typeof raw !== 'object') {
        return { error: '入力項目の形式が不正です' };
      }
      const label = raw.label != null ? String(raw.label).trim() : '';
      if (!label) {
        return { error: '入力項目名を入力してください' };
      }
      if (label.length > 60) {
        return { error: '入力項目名は60文字以内で指定してください' };
      }
      const id = raw.id ? String(raw.id) : crypto.randomUUID();
      // requiredは明示的にfalseが指定された時だけ任意項目にする(未指定・それ以外の値は必須扱い)。
      const required = raw.required !== false;
      normalized.push({ id, label, required });
    }
    return { value: normalized };
  }

  // Task 1: 契約書マスタ ------------------------------------------------

  router.get('/contracts', async (req, res) => {
    try {
      const snap = await db.collection('contracts').get();
      const contracts = snap.docs
        .map((d) => serializeDoc(d.id, d.data()))
        .sort((a, b) => b.version - a.version);
      res.json(contracts);
    } catch (error) {
      console.error('契約書一覧取得エラー:', error);
      res.status(500).json({ error: '契約書の取得に失敗しました' });
    }
  });

  // 契約書マスタに1バージョン積む。リンクでの登録(POST /contracts)と
  // ファイルのアップロードでの登録(POST /contracts/upload)で同じ手順を使う。
  // 登録の入口が増えるたびに版の積み方とメタ情報の引き継ぎを書き写すと、片方にしか
  // 直しが入らない事故が起きるため、1箇所にまとめてある。
  async function registerContractVersion({ name, url, note, extra }) {
    const groupKey = groupKeyFor(name);
    const existingSnap = await db.collection('contracts').where('groupKey', '==', groupKey).get();
    const maxVersion = existingSnap.docs.reduce((max, d) => Math.max(max, d.data().version || 0), 0);
    // 同じgroupKeyの中でversionが最大のもの(=現在の版)を探す。新バージョンはkind/requestFields
    // (種別・入力項目の設定)を引き継ぐ。引き継がないと、再アップロードするたびに入力項目の
    // 設定が消え、operatorが気付かないまま空の依頼フォームに戻ってしまう。
    const latestExisting = existingSnap.docs.reduce(
      (latest, d) => (!latest || (d.data().version || 0) > (latest.data().version || 0) ? d : latest),
      null,
    );
    const latestData = latestExisting ? latestExisting.data() : null;

    const docRef = await db.collection('contracts').add({
      name,
      groupKey,
      url,
      note: note || '',
      version: maxVersion + 1,
      // kindが無い既存契約書は個別契約書として扱う(後方互換)ので、引き継ぎ時もその既定値に揃える。
      kind: latestData && latestData.kind === 'basic' ? 'basic' : 'individual',
      requestFields: latestData && Array.isArray(latestData.requestFields) ? latestData.requestFields : [],
      // 名前を変えたことがあるグループでは、過去の名前も新しい版に引き継ぐ
      // (契約書名で引き当てている古い記録があるため。下の POST /contracts/rename 参照)。
      ...(latestData && Array.isArray(latestData.pastNames) && latestData.pastNames.length > 0
        ? { pastNames: latestData.pastNames } : {}),
      ...(extra || {}),
      createdAt: FieldValue.serverTimestamp(),
    });
    const created = await docRef.get();
    return serializeDoc(created.id, created.data());
  }

  router.post('/contracts', async (req, res) => {
    try {
      const { name, url, note } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: '契約書名を入力してください' });
      }
      if (!url || !String(url).trim()) {
        return res.status(400).json({ error: 'リンクを入力してください' });
      }
      const created = await registerContractVersion({
        name: String(name).trim(),
        url: url.trim(),
        note: note ? String(note).trim() : '',
      });
      res.status(201).json(created);
    } catch (error) {
      console.error('契約書登録エラー:', error);
      res.status(500).json({ error: '契約書の登録に失敗しました' });
    }
  });

  // 契約書名の変更。
  //
  // 契約書名はバージョン群のまとめ役(groupKey)そのものなので、1つの版だけ名前を変えると
  // バージョン群が2つに割れ、以後の再登録が第1版から始まってしまう。なのでその契約書の
  // 全バージョンをまとめて付け替える。
  router.post('/contracts/rename', async (req, res) => {
    try {
      const groupKey = String(req.body?.groupKey || '').trim();
      const name = String(req.body?.name || '').trim();
      if (!groupKey) return res.status(400).json({ error: '契約書を指定してください' });
      if (!name) return res.status(400).json({ error: '新しい契約書名を入力してください' });

      const snap = await db.collection('contracts').where('groupKey', '==', groupKey).get();
      if (snap.empty) return res.status(404).json({ error: '契約書が見つかりません' });

      const newGroupKey = groupKeyFor(name);
      if (newGroupKey === groupKey) {
        return res.status(400).json({ error: '契約書名が変わっていません' });
      }
      // 既にある契約書名に変えると、別の契約書のバージョン群と混ざって版番号が重複する。
      const clashSnap = await db.collection('contracts').where('groupKey', '==', newGroupKey).limit(1).get();
      if (!clashSnap.empty) {
        return res.status(409).json({ error: `「${name}」という契約書はすでにあります。別の名前にしてください` });
      }

      // 古い名前も残しておく。締結依頼で作った「記入済み契約書」のうちcontractIdを
      // 持たない古い記録は契約書名で引き当てているので、名前を捨てると引き当てが切れる。
      const batch = db.batch();
      snap.docs.forEach((d) => {
        const data = d.data();
        const pastNames = Array.from(new Set([...(data.pastNames || []), data.name].filter(Boolean)))
          .filter((n) => n !== name);
        batch.update(d.ref, {
          name,
          groupKey: newGroupKey,
          pastNames,
          renamedAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      res.json({ groupKey: newGroupKey, name, updated: snap.docs.length });
    } catch (error) {
      console.error('契約書名の変更エラー:', error);
      res.status(500).json({ error: '契約書名の変更に失敗しました' });
    }
  });

  // kind(基本/個別)とrequestFields(締結依頼時の入力項目)は契約書の内容そのものではなく、
  // 「どう依頼するか」というメタ情報なので、更新してもバージョンは増やさずその場で上書きする
  // (バージョン管理はurl/noteなど契約書の実体が変わった時のためのものであり、
  // メタ情報の変更のたびに新バージョンを積むのは意味がない)。
  router.patch('/contracts/:id', async (req, res) => {
    try {
      const { kind, requestFields } = req.body || {};
      const update = {};
      if (kind !== undefined) {
        if (!['basic', 'individual'].includes(kind)) {
          return res.status(400).json({ error: 'kindはbasicかindividualのいずれかを指定してください' });
        }
        update.kind = kind;
      }
      if (requestFields !== undefined) {
        const result = normalizeRequestFields(requestFields);
        if (result.error) {
          return res.status(400).json({ error: result.error });
        }
        update.requestFields = result.value;
      }
      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: '更新する項目がありません' });
      }
      const docRef = db.collection('contracts').doc(req.params.id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: '契約書が見つかりません' });
      }
      await docRef.update(update);
      const updated = await docRef.get();
      res.status(200).json(serializeDoc(updated.id, updated.data()));
    } catch (error) {
      console.error('契約書のメタ情報更新エラー:', error);
      res.status(500).json({ error: '契約書の更新に失敗しました' });
    }
  });

  // 雛形をファイルのアップロードで登録する ----------------------------------
  //
  // Googleドキュメントを先に作ってからURLを登録する、という手順を踏まなくて済むようにする。
  // Cloud Functionsでmultipartを受けるのは面倒なので、chatworkRouter.jsのファイル送信と
  // 同じくbase64の中身をJSONで受け取る。
  const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

  // Googleドキュメントに変換して置く種類。変換しておかないと{{項目名}}のマーク付けが
  // できない(Docs APIはOfficeファイルを読み書きできず、実際に「must not be an Office file」で
  // 行き止まりになった)。PDFは変換するとOCRにかかって中身が崩れるので、そのまま置く。
  const CONVERT_TO_DOC_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
    'application/vnd.oasis.opendocument.text', // .odt
    'application/rtf',
    'text/rtf',
    'text/plain',
  ];

  // 雛形の置き場所。記入済み契約書の保存先フォルダの中に「契約書雛形」フォルダを作り、
  // その中に入れる(記入済みの契約書と雛形が同じ階層に混ざらないようにするため)。
  // 設定を増やさず、既に設定してあるフォルダだけを使う。
  const TEMPLATE_FOLDER_NAME = '契約書雛形';
  // 既に締結済みの契約書（アップロードして取り込むもの）の置き場。雛形とは別にしておく
  // ―― 雛形フォルダに実際の契約書が混ざると、どれが雛形か分からなくなる。
  const SIGNED_FOLDER_NAME = '締結済み契約書';

  async function resolveSubFolderId(drive, folderName) {
    const parentId = await resolveContractOutputFolderId();
    const q = [
      `'${parentId}' in parents`,
      `name = '${folderName}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      'trashed = false',
    ].join(' and ');
    const found = await drive.files.list({
      q, fields: 'files(id)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    if (found.data.files && found.data.files.length > 0) return found.data.files[0].id;
    const created = await drive.files.create({
      supportsAllDrives: true,
      fields: 'id',
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
    });
    return created.data.id;
  }

  const resolveTemplateFolderId = (drive) => resolveSubFolderId(drive, TEMPLATE_FOLDER_NAME);
  const resolveSignedFolderId = (drive) => resolveSubFolderId(drive, SIGNED_FOLDER_NAME);

  // ファイルをDriveに上げてリンクを返す。雛形のアップロードと、締結済み契約書の
  // アップロードで同じ手順を使う（2箇所に書くと、片方だけ変換や共有の扱いが変わる）。
  async function uploadFileToDrive({ folderId, name, fileName, fileDataBase64, mimeType }) {
    const buffer = Buffer.from(String(fileDataBase64), 'base64');
    if (buffer.length === 0) return { error: 'ファイルの中身が空です' };
    if (buffer.length > UPLOAD_MAX_BYTES) return { error: 'ファイルサイズが大きすぎます（8MBまで）' };
    const { drive, actorEmail } = await getGoogleClients();
    const targetFolderId = folderId || await resolveSignedFolderId(drive);
    const convert = CONVERT_TO_DOC_MIME_TYPES.includes(mimeType);
    let createRes;
    try {
      createRes = await drive.files.create({
        supportsAllDrives: true,
        fields: 'id, webViewLink',
        requestBody: {
          // Drive上のファイル名は契約書名に揃える(後でDriveを直接見た人が探せるように)。
          name,
          parents: [targetFolderId],
          ...(convert ? { mimeType: GOOGLE_DOC_MIME_TYPE } : {}),
        },
        media: { mimeType, body: Readable.from(buffer) },
      });
    } catch (driveError) {
      console.error('契約書アップロードエラー:', driveError.message, fileName);
      return { error: googleApiErrorMessage(driveError, '契約書の保存先フォルダにアップロードできませんでした') };
    }
    const url = createRes.data.webViewLink
      || (convert
        ? `https://docs.google.com/document/d/${createRes.data.id}/edit`
        : `https://drive.google.com/file/d/${createRes.data.id}/view`);
    // 法務が開ける状態にしておく（リンクで登録する場合と同じ扱い）。
    const { sharing, sharingError } = await shareFileForLegalReview({
      drive, fileId: createRes.data.id, userEmail: actorEmail,
    });
    if (sharingError) console.error('アップロードした契約書の共有に失敗:', sharingError);
    return {
      value: {
        fileId: createRes.data.id, url, convert, sharing: sharing || null, sharingError: sharingError || null,
      },
    };
  }

  router.post('/contracts/upload', async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const fileName = String(req.body?.fileName || '').trim();
      const fileDataBase64 = req.body?.fileDataBase64;
      const note = req.body?.note ? String(req.body.note).trim() : '';
      const mimeType = String(req.body?.mimeType || '').trim() || 'application/octet-stream';
      if (!name) return res.status(400).json({ error: '契約書名を入力してください' });
      if (!fileName || !fileDataBase64) return res.status(400).json({ error: 'ファイルを選択してください' });

      const { drive } = await getGoogleClients();
      const folderId = await resolveTemplateFolderId(drive);
      const uploaded = await uploadFileToDrive({ folderId, name, fileName, fileDataBase64, mimeType });
      if (uploaded.error) return res.status(400).json({ error: uploaded.error });
      const { url, convert, sharing, sharingError } = uploaded.value;

      const created = await registerContractVersion({
        name,
        url,
        note: note || `${fileName} をアップロードして登録${convert ? '（Googleドキュメントに変換）' : ''}`,
        extra: {
          uploadedFileName: fileName,
          sharing: sharing || null,
          sharingError: sharingError || null,
        },
      });
      res.status(201).json(created);
    } catch (error) {
      console.error('雛形アップロード登録エラー:', error);
      res.status(error.status || 500).json({ error: error.message || '雛形のアップロードに失敗しました' });
    }
  });

  // Task 1.5: 雛形への{{項目名}}マーク付け --------------------------------
  //
  // 契約書の雛形(Googleドキュメント)の一部を{{項目名}}に置き換えておくと、締結依頼の
  // フォームで入力した値をそのまま差し込んだ契約書を作れるようになる。ここではその
  // 「マークを付ける」側だけを扱う。
  //
  // 元の雛形は絶対に書き換えない。マーク付けは必ず複製(項目入り版)に対して行い、
  // 複製は同じgroupKeyの新しいバージョンとして登録する(既存のバージョン管理に乗せる
  // ことで、締結依頼は今まで通り「現在の版」を使うだけでよくなる)。

  // Googleドキュメント・ドライブの操作は、設定画面で選んだ社内アカウントになりすまして行う
  // (このアプリはGoogleアカウントでログインしないため、操作している人本人のアカウントは使えない)。
  // 仕組みはMTG登録(calendar.js)と同じドメイン全体の委任のサービスアカウント。
  // 作ったファイルの持ち主はこのアカウントになる。雛形をリンクで登録する場合は、
  // このアカウントがそのGoogleドキュメントを開ける必要がある。
  async function getGoogleClients() {
    const settings = await readContractSettings();
    const actorEmail = settings.googleAccountEmail;
    if (!actorEmail) {
      const error = new Error('Googleドキュメントを操作するアカウントが未設定です（マスター管理の契約書管理で選んでください）');
      error.status = 400;
      throw error;
    }
    const keyJson = env('TLDV_CALENDAR_SA_KEY');
    if (!keyJson) {
      const error = new Error('サービスアカウントの鍵（TLDV_CALENDAR_SA_KEY）が未設定です');
      error.status = 500;
      throw error;
    }
    const credentials = JSON.parse(keyJson);
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: GOOGLE_SCOPES,
      subject: actorEmail,
    });
    return { auth, drive: google.drive({ version: 'v3', auth }), actorEmail };
  }

  // Google API が返した理由をそのまま画面にも出す。以前は理由を握りつぶして
  // 「閲覧権限があるか確認してください」の一言に置き換えていたため、実際には
  // 「Docs APIがこのプロジェクトで有効になっていない」だったケースを、権限の問題だと
  // 思って調べ続けることになった(実際にそうなった)。原因の切り分けは画面でできるようにする。
  function googleApiErrorMessage(error, what) {
    const detail = error?.response?.data?.error?.message || error?.errors?.[0]?.message || error?.message || '';
    // ドメイン全体の委任でこの範囲が許可されていないと unauthorized_client になる。
    // 原因が分からないまま調べ続けないよう、何をすればよいかを添える。
    const hint = /unauthorized_client|invalid_grant/i.test(`${detail} ${error?.response?.data?.error || ''}`)
      ? '（Google Workspaceの管理コンソールで、サービスアカウントのドメイン全体の委任にドライブとドキュメントの権限を追加してください）'
      : '';
    return `${what}。${detail || '原因が取得できませんでした'}${hint}`;
  }

  // アプリが作ったGoogleドキュメント(記入済み契約書・項目入り版)を、法務が開いて
  // 直せる状態にする。
  //
  // 複製したファイルは元の雛形の共有設定を引き継ぐため、そこに入っていない人
  // (法務)は開けない。実際に「権限がなくて法務が見られない」で止まったので、
  // 作った時点で共有まで済ませる。
  //
  // まず「リンクを知っている全員が編集可」を試す。Workspaceの設定で社外共有が
  // 禁止されていると弾かれるので、その場合は社内ドメイン全員が編集可に落とす
  // (法務は社内なので、それでも目的は果たせる)。どちらも通らなかったときは
  // 黙って見逃さず、呼び出し側に理由を返して画面に出す。
  async function shareFileForLegalReview({ drive, fileId, userEmail }) {
    try {
      await drive.permissions.create({
        fileId,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: { role: 'writer', type: 'anyone' },
      });
      return { sharing: 'anyone' };
    } catch (anyoneError) {
      const domain = String(userEmail || '').split('@')[1];
      if (!domain) {
        return { sharing: null, sharingError: googleApiErrorMessage(anyoneError, '作成したファイルを共有できませんでした') };
      }
      try {
        await drive.permissions.create({
          fileId,
          supportsAllDrives: true,
          sendNotificationEmail: false,
          requestBody: { role: 'writer', type: 'domain', domain },
        });
        return { sharing: 'domain' };
      } catch (domainError) {
        return { sharing: null, sharingError: googleApiErrorMessage(domainError, '作成したファイルを共有できませんでした') };
      }
    }
  }

  // 契約書を読み込み、GoogleドキュメントのIDまで解決する。契約書マスタにはPDFやWord等の
  // URLも登録できるため、Googleドキュメント以外は分かりやすい400にする。
  async function loadContractDoc(contractId) {
    const ref = db.collection('contracts').doc(contractId);
    const snap = await ref.get();
    if (!snap.exists) {
      const error = new Error('契約書が見つかりません');
      error.status = 404;
      throw error;
    }
    const contract = snap.data();
    const docId = extractDocIdFromUrl(contract.url);
    if (!docId) {
      const error = new Error('この契約書はGoogleドキュメントではないため、項目のマーク付けはできません');
      error.status = 400;
      throw error;
    }
    return { ref, contract, docId };
  }

  // 雛形に入っている{{項目名}}が、そのまま締結依頼時の入力項目になる。マーク付けや
  // 文章の手直しのたびにrequestFieldsを揃えておくことで「雛形には{{支払期日}}があるのに
  // 依頼フォームに欄が無く、置換されないまま送られる」という食い違いが起きないようにする。
  //
  // **既にある項目は絶対に消さない**。以前はマークだけから作り直していたため、
  // 雛形の文章を少し直しただけで、契約書詳細ページで手で登録した入力項目が
  // まるごと消えた(実際に「入力項目が空になった」という事故が起きた)。
  // 入力項目は雛形のマークと1対1ではない: 本文には出てこないが依頼文には要る項目を
  // 手で足すことがあるし、そもそもマークを1つも付けていない契約書でも入力項目は使う。
  // マークは「足りない項目を足す」ためだけに使い、要らなくなった項目は
  // 契約書詳細ページの「削除」で人が消す。
  //
  // 並びはマークの出現順が先、そのあとに本文に出てこない既存の項目。
  // 依頼文の行順がこの順になるので、雛形に沿った順で並ぶほうが読みやすい。
  function mergeRequestFieldsWithMarkers(markers, existingFields) {
    const existing = Array.isArray(existingFields) ? existingFields : [];
    const byLabel = new Map(existing.map((f) => [f.label, f]));
    const merged = [];
    const seen = new Set();
    const push = (label, source) => {
      if (!label || seen.has(label)) return;
      seen.add(label);
      merged.push({
        id: (source && source.id) || crypto.randomUUID(),
        label,
        required: !source || source.required !== false,
      });
    };
    for (const label of markers) push(label, byLabel.get(label));
    for (const field of existing) push(field.label, field);
    return merged;
  }

  // 入力項目名のマスタ。契約書ごとではなく全契約書で共有する(「実施期間」のような項目を
  // 契約書ごとに作り直す意味が無く、表記ゆれも生むため)。
  router.get('/contract-field-presets', async (req, res) => {
    try {
      const snap = await db.collection('contractFieldPresets').get();
      const presets = snap.docs
        .map((d) => ({ id: d.id, label: d.data().label || '' }))
        .filter((p) => p.label)
        .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
      res.json(presets);
    } catch (error) {
      console.error('入力項目マスタ取得エラー:', error);
      res.status(500).json({ error: '入力項目マスタの取得に失敗しました' });
    }
  });

  router.post('/contract-field-presets', async (req, res) => {
    try {
      const label = req.body && req.body.label != null ? String(req.body.label).trim() : '';
      if (!label) {
        return res.status(400).json({ error: '項目名を入力してください' });
      }
      if (label.length > 60) {
        return res.status(400).json({ error: '項目名は60文字以内で指定してください' });
      }
      // {{}}の中に入る文字なので、波括弧は受け付けない(入れると検出用の正規表現と衝突する)。
      if (/[{}]/.test(label)) {
        return res.status(400).json({ error: '項目名に { } は使えません' });
      }
      // 同じ項目名を二重に登録しない(押し間違いで選択肢が増殖するのを防ぐ)。
      const existing = await db.collection('contractFieldPresets').where('label', '==', label).limit(1).get();
      if (!existing.empty) {
        return res.status(200).json({ id: existing.docs[0].id, label });
      }
      const docRef = await db.collection('contractFieldPresets').add({
        label,
        createdAt: FieldValue.serverTimestamp(),
      });
      res.status(201).json({ id: docRef.id, label });
    } catch (error) {
      console.error('入力項目マスタ登録エラー:', error);
      res.status(500).json({ error: '入力項目マスタの登録に失敗しました' });
    }
  });

  router.delete('/contract-field-presets/:id', async (req, res) => {
    try {
      await db.collection('contractFieldPresets').doc(req.params.id).delete();
      res.status(204).send();
    } catch (error) {
      console.error('入力項目マスタ削除エラー:', error);
      res.status(500).json({ error: '入力項目マスタの削除に失敗しました' });
    }
  });

  // 元の雛形を複製して「項目入り版」を作り、同じ契約書の新しいバージョンとして登録する。
  // 複製先は元ファイルと同じフォルダにする(契約書の置き場所は運用で決まっているため、
  // 勝手にマイドライブ直下へ置くと見つけられなくなる)。
  router.post('/contracts/:id/markup-copy', async (req, res) => {
    try {
      const { contract, docId } = await loadContractDoc(req.params.id);
      const { drive, actorEmail } = await getGoogleClients();

      let parents;
      let mimeType;
      try {
        const info = await drive.files.get({ fileId: docId, fields: 'parents, mimeType', supportsAllDrives: true });
        parents = info.data.parents;
        mimeType = info.data.mimeType;
      } catch (driveError) {
        console.error('雛形ファイル情報取得エラー:', driveError.message);
        return res.status(400).json({
          error: googleApiErrorMessage(driveError, 'このGoogleドキュメントをDriveから開けませんでした'),
        });
      }

      // Drive上のWordファイル(.docx)は、Googleドキュメントの画面で開けてしまうが実体は
      // Officeファイルのままで、Docs APIでは読み書きできない。複製するときに
      // Googleドキュメントへ変換しておけば、そのままマーク付けに進める
      // (元のWordファイルは触らない。ここで作るのは複製だけ)。
      const needsConversion = !!mimeType && mimeType !== GOOGLE_DOC_MIME_TYPE;

      // すでに項目入り版なら、もう一度複製する意味は無い ―― ただしWordファイルのままの
      // 項目入り版は別。変換していない頃に作った複製はWordファイルのままで、
      // 画面には「項目入り版」と出るのにマーク付けできず、変換する手段も無くなっていた。
      // その場合だけは作り直しを許して、Googleドキュメントに変換した版を作る。
      if (contract.isMarkupCopy && !needsConversion) {
        return res.status(400).json({ error: 'この版はすでに項目入り版です。そのままマーク付けできます' });
      }

      const copyRes = await drive.files.copy({
        fileId: docId,
        supportsAllDrives: true,
        fields: 'id, webViewLink',
        requestBody: {
          name: `${contract.name}（項目入り）`,
          ...(needsConversion ? { mimeType: GOOGLE_DOC_MIME_TYPE } : {}),
          ...(parents && parents.length > 0 ? { parents } : {}),
        },
      });
      const url = copyRes.data.webViewLink || `https://docs.google.com/document/d/${copyRes.data.id}/edit`;

      // 依頼文には雛形リンクとしてこの版が載るので、こちらも法務が開ける状態にしておく。
      const { sharing, sharingError } = await shareFileForLegalReview({
        drive, fileId: copyRes.data.id, userEmail: actorEmail,
      });
      if (sharingError) console.error('項目入り版の共有に失敗:', sharingError);

      const groupKey = contract.groupKey || groupKeyFor(contract.name);
      const existingSnap = await db.collection('contracts').where('groupKey', '==', groupKey).get();
      const maxVersion = existingSnap.docs.reduce((max, d) => Math.max(max, d.data().version || 0), 0);

      const docRef = await db.collection('contracts').add({
        name: contract.name,
        groupKey,
        url,
        note: needsConversion
          ? `項目入り版（WordファイルをGoogleドキュメントに変換して${contract.isMarkupCopy ? '作り直し' : '複製'}）`
          : '項目入り版（元の雛形を複製して作成）',
        version: maxVersion + 1,
        kind: contract.kind === 'basic' ? 'basic' : 'individual',
        requestFields: Array.isArray(contract.requestFields) ? contract.requestFields : [],
        isMarkupCopy: true,
        copiedFromContractId: req.params.id,
        sharing: sharing || null,
        sharingError: sharingError || null,
        createdAt: FieldValue.serverTimestamp(),
      });
      const created = await docRef.get();
      res.status(201).json(serializeDoc(created.id, created.data()));
    } catch (error) {
      console.error('項目入り版の作成エラー:', error);
      res.status(error.status || 500).json({ error: error.message || '項目入り版の作成に失敗しました' });
    }
  });

  // 雛形の本文(プレーンテキスト)と、今入っている{{項目名}}の一覧を返す。
  // 画面側はこのテキストをそのまま表示して選択させ、選択範囲の文字位置(flatStart/flatEnd)を
  // 下のマーク付けAPIに渡す。
  router.get('/contracts/:id/template', async (req, res) => {
    try {
      const { contract, docId } = await loadContractDoc(req.params.id);
      const { auth } = await getGoogleClients();
      let template;
      try {
        template = await getTemplateText(auth, docId);
      } catch (docsError) {
        console.error('雛形ドキュメント取得エラー:', docsError.message);
        if (isOfficeFileError(docsError)) {
          return res.status(400).json({
            // codeは画面側の分岐用。文言で判定させると言い回しを直した瞬間に壊れる。
            code: 'office_file',
            error: 'この雛形はWordファイル（.docx）としてDriveに置かれているため、そのままでは中身を読めません。'
              + '下の「Googleドキュメントに変換した版を作る」を押すと、変換した複製を作ってマーク付けできます（元のファイルは変わりません）',
          });
        }
        return res.status(400).json({
          error: googleApiErrorMessage(docsError, 'このGoogleドキュメントを開けませんでした'),
        });
      }
      res.json({ ...template, isMarkupCopy: !!contract.isMarkupCopy });
    } catch (error) {
      console.error('雛形プレビュー取得エラー:', error);
      res.status(error.status || 500).json({ error: error.message || '雛形の取得に失敗しました' });
    }
  });

  // 選択範囲の文章そのものを直す(置き換え・削除・カーソル位置への追加)。
  // マーク付けで選ぶ範囲を間違えて元の文言を消してしまうことがあり、そのたびに
  // Googleドキュメントを開き直すのは手間なので、同じパネルの中で直せるようにする。
  // マーク付けと同じく、書き換えるのは項目入り版だけ(元の雛形は触らない)。
  router.post('/contracts/:id/template/text', async (req, res) => {
    try {
      const { ref, contract, docId } = await loadContractDoc(req.params.id);
      if (!contract.isMarkupCopy) {
        return res.status(400).json({
          error: '元の雛形は書き換えません。先に「項目入り版を作る」を押してから、その版を編集してください',
        });
      }
      const { flatStart, flatEnd, text, expectedOriginal } = req.body || {};
      if (!Number.isInteger(flatStart) || !Number.isInteger(flatEnd)) {
        return res.status(400).json({ error: '編集する範囲が不正です' });
      }
      const { auth } = await getGoogleClients();
      // 画面を開いたまま誰かがGoogleドキュメント側を直していると、文字位置がズレて
      // 関係ない場所を壊してしまう。書き換える前に「そこが今も同じ文字か」を確かめる。
      if (typeof expectedOriginal === 'string') {
        const before = await getTemplateText(auth, docId);
        if (before.text.slice(flatStart, flatEnd) !== expectedOriginal) {
          return res.status(409).json({ error: '雛形が更新されています。読み直してから保存し直してください' });
        }
      }
      const result = await replaceRangeWithText(auth, docId, flatStart, flatEnd, text);
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      // 文章を直した結果、{{項目名}}が増減していることがある(間違えて消した場合など)ので、
      // マーク付けと同じく入力項目を取り直して揃える。
      const template = await getTemplateText(auth, docId);
      const requestFields = mergeRequestFieldsWithMarkers(template.markers, contract.requestFields);
      await ref.update({ requestFields });
      res.json({ ...template, isMarkupCopy: true, requestFields });
    } catch (error) {
      console.error('雛形の文章編集エラー:', error);
      res.status(error.status || 500).json({ error: error.message || '雛形の編集に失敗しました' });
    }
  });

  // 選択範囲を{{項目名}}に置き換える。元の雛形は書き換えず、項目入り版に対してのみ許可する。
  router.post('/contracts/:id/template/markers', async (req, res) => {
    try {
      const { ref, contract, docId } = await loadContractDoc(req.params.id);
      if (!contract.isMarkupCopy) {
        return res.status(400).json({
          error: '元の雛形は書き換えません。先に「項目入り版を作る」を押してから、その版にマークを付けてください',
        });
      }
      const { flatStart, flatEnd, label } = req.body || {};
      const { auth } = await getGoogleClients();
      const result = await replaceRangeWithMarker(auth, docId, flatStart, flatEnd, label);
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      const template = await getTemplateText(auth, docId);
      const requestFields = mergeRequestFieldsWithMarkers(template.markers, contract.requestFields);
      await ref.update({ requestFields });
      res.json({ ...template, isMarkupCopy: true, requestFields });
    } catch (error) {
      console.error('項目マーク付けエラー:', error);
      res.status(error.status || 500).json({ error: error.message || 'マーク付けに失敗しました' });
    }
  });


  // Task 1.6: 記入済み契約書の生成 ----------------------------------------
  //
  // 締結依頼の入力フォームに書いた値を、雛形の{{項目名}}に差し込んだ契約書を作る。
  // 雛形(項目入り版)をDriveで複製し、複製の方だけを置換するので雛形は変わらない。
  //
  // 生成は依頼を送るときではなく、送る前の明示的な操作(「記入済み契約書を作成」)で行う。
  // 依頼文に生成した契約書のリンクを載せる以上、プレビューより前に実物が無いと
  // 「プレビューで見せた文面と実際に送る文面を一致させる」(CLAUDE.md)が守れないため。
  // 送る前に中身を開いて確認できる点も、法務チェックが必ず入る運用に合っている。

  // 生成した契約書の保存先Driveフォルダ。案件をまたいで1つのフォルダに集める運用。
  // 秘密情報ではない設定値なのでSecret Managerではなくappconfigに置き、設定画面から
  // 変更できるようにする(CLAUDE.mdの「秘密情報でない設定値をSecret Managerに置かない」)。
  const DEFAULT_CONTRACT_OUTPUT_FOLDER_ID = '1Dtzhe_jOIGIGuU0zlOHc8iHmFx4Qqs5k';

  // DriveのフォルダURLでもIDそのままでも受け付ける(運用側はURLをコピーしてくる方が自然なため)。
  function extractDriveFolderId(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/folders\/([-\w]+)/);
    return match ? match[1] : raw;
  }

  // 契約書まわりの設定(秘密情報ではないのでFirestoreのappConfigに置き、設定画面から変える)。
  //  folderId:           記入済み契約書の保存先Driveフォルダ(未設定なら既定のフォルダ)
  //  googleAccountEmail: Googleドキュメント・ドライブを操作する社内アカウント(なりすまし先)
  //  testChannelId:      「テストグループに送る」を選んだときの投稿先Slackチャンネル
  async function readContractSettings() {
    const snap = await db.collection('appConfig').doc('contractOutput').get();
    const data = snap.exists ? snap.data() : {};
    return {
      folderId: extractDriveFolderId(data.folderId) || DEFAULT_CONTRACT_OUTPUT_FOLDER_ID,
      googleAccountEmail: data.googleAccountEmail ? String(data.googleAccountEmail).trim() : '',
      testChannelId: data.testChannelId ? String(data.testChannelId).trim() : '',
    };
  }

  async function resolveContractOutputFolderId() {
    const { folderId } = await readContractSettings();
    return folderId;
  }

  const settingsResponse = (settings) => ({
    ...settings,
    folderUrl: `https://drive.google.com/drive/folders/${settings.folderId}`,
  });

  router.get('/contract-settings', async (req, res) => {
    try {
      res.json(settingsResponse(await readContractSettings()));
    } catch (error) {
      console.error('契約書の設定取得エラー:', error);
      res.status(500).json({ error: '契約書の設定の取得に失敗しました' });
    }
  });

  // 送られてきたキーだけを書き込む(1項目だけ保存したときに他の項目を空で上書きしないため)。
  router.put('/contract-settings', async (req, res) => {
    try {
      const { folderId, googleAccountEmail, testChannelId } = req.body || {};
      const update = {};
      if (folderId !== undefined) {
        const value = extractDriveFolderId(folderId);
        if (!value) return res.status(400).json({ error: 'フォルダのURLかIDを入力してください' });
        update.folderId = value;
      }
      if (googleAccountEmail !== undefined) {
        const value = String(googleAccountEmail || '').trim();
        if (value && !/^[^@\s]+@[^@\s]+$/.test(value)) {
          return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
        }
        update.googleAccountEmail = value;
      }
      if (testChannelId !== undefined) {
        const value = String(testChannelId || '').trim();
        if (value && !CHANNEL_ID_PATTERN.test(value)) {
          return res.status(400).json({
            error: 'チャンネルIDの形式が正しくありません（Cから始まるIDを入力してください。チャンネル名(#〜)ではありません）',
          });
        }
        update.testChannelId = value;
      }
      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: '更新する項目がありません' });
      }
      await db.collection('appConfig').doc('contractOutput').set({
        ...update,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      res.json(settingsResponse(await readContractSettings()));
    } catch (error) {
      console.error('契約書の設定保存エラー:', error);
      res.status(500).json({ error: '契約書の設定の保存に失敗しました' });
    }
  });

  // 依頼の投稿先。テスト送信を明示的に選んだのにテストグループが未設定なら、
  // 本番に流さずエラーを返す(テストのつもりが本番に届く事故を防ぐ)。
  async function resolveRequestChannel({ sendToTestChannel }) {
    if (sendToTestChannel === true) {
      let testChannelId = '';
      try {
        ({ testChannelId } = await readContractSettings());
      } catch (error) {
        console.error('テストグループの設定の取得に失敗:', error);
      }
      if (!testChannelId) {
        return { channelId: null, isTest: true, error: TEST_CHANNEL_NOT_CONFIGURED_ERROR };
      }
      return { channelId: testChannelId, isTest: true };
    }
    return { channelId: CONTRACT_REQUEST_SLACK_CHANNEL_ID, isTest: false };
  }

  // 依頼文に載せるChatworkの招待リンク。案件の営業担当のChatworkトークンで発行する
  // (このアプリはログインユーザーを識別できないため、担当者本人の連携を使う)。
  // 未連携・発行失敗なら null を返し、依頼自体は通す。
  async function inviteLinkForChatworkRequest(entity) {
    try {
      if (!entity.representative || !entity.chatworkRoomId) return null;
      const staffSnap = await db.collection('staffMembers').where('name', '==', entity.representative).limit(1).get();
      if (staffSnap.empty) return null;
      const token = await getSecret(chatworkSecretName(staffSnap.docs[0].id));
      if (!token) return null;
      const result = await getOrCreateRoomInviteLink({ token, roomId: entity.chatworkRoomId });
      return result.url || null;
    } catch (error) {
      console.error('Chatwork招待リンク発行エラー:', error);
      return null;
    }
  }

  // 案件と、その会社のChatworkルーム・Slackチャンネル(会社単位の clientMeetingSettings)を合わせて返す。
  // 共有先の選択肢(連携済みかどうか)の判定に使う。
  async function withChatSettings(deal) {
    if (!deal.companyName) return { ...deal, chatworkRoomId: null, slackChannelId: null };
    const snap = await db.collection('clientMeetingSettings')
      .where('companyName', '==', deal.companyName).limit(1).get();
    const settings = snap.empty ? {} : snap.docs[0].data();
    return {
      ...deal,
      chatworkRoomId: settings.chatworkRoomId || null,
      slackChannelId: settings.slackChannelId || null,
    };
  }

  // メールで共有するときの宛先。案件に担当者(連絡先)の一覧が無いため、フォームで直接入力してもらう。
  function normalizeEmailContact({ contactName, contactEmail }) {
    const name = String(contactName || '').trim();
    const email = String(contactEmail || '').trim();
    if (!name) return { error: '先方の担当者名を入力してください' };
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { error: '先方の担当者のメールアドレスを入力してください' };
    return { value: { name, email } };
  }

  // 1つの契約書について、雛形を複製して{{項目名}}を置換する。
  // 差し込む項目が雛形に無い(= Googleドキュメントでない、またはマークが1つも無い)場合はnullを返し、
  // 呼び出し側でスキップしてもらう(基本契約書に項目が無く個別契約書にだけある、という組み合わせがあるため)。
  async function generateOneContractDocument({ auth, drive, contract, counterpartyName, folderId, valueByLabel, userEmail }) {
    const docId = extractDocIdFromUrl(contract.url);
    if (!docId) return { value: null };
    let template;
    try {
      template = await getTemplateText(auth, docId);
    } catch (error) {
      // Wordファイルのままの雛形。原因の分からない500にせず、次の一手を出す。
      if (isOfficeFileError(error)) {
        return {
          error: `「${contract.name}」の雛形はWordファイル（.docx）のため読み取れません。`
            + 'マスター管理の契約書管理で「項目入り版を作る」を押すと、Googleドキュメントに変換した複製を作れます',
        };
      }
      throw error;
    }
    if (template.markers.length === 0) return { value: null };

    // 置換できない項目が残ったまま送ってしまわないよう、複製を作る前に確認する。
    const missing = template.markers.filter((label) => !valueByLabel.has(label));
    if (missing.length > 0) {
      return {
        error: `「${contract.name}」の雛形にある ${missing.map((m) => `{{${m}}}`).join('・')} に入れる値がありません。契約書の設定で入力項目を追加してください`,
      };
    }

    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const copyRes = await drive.files.copy({
      fileId: docId,
      supportsAllDrives: true,
      fields: 'id, name, webViewLink',
      requestBody: { name: `${contract.name}_${counterpartyName}_${today}`, parents: [folderId] },
    });
    const newDocId = copyRes.data.id;

    // 作った直後に共有まで済ませる(法務が開けないと締結依頼を出す意味が無い)。
    const { sharing, sharingError } = await shareFileForLegalReview({ drive, fileId: newDocId, userEmail });

    const docs = getDocsClient(auth);
    await docs.documents.batchUpdate({
      documentId: newDocId,
      requestBody: {
        requests: template.markers.map((label) => ({
          replaceAllText: {
            containsText: { text: `{{${label}}}`, matchCase: true },
            replaceText: valueByLabel.get(label),
          },
        })),
      },
    });

    // 置換漏れが無いか、書き換えた後の本文をもう一度読んで確かめる
    // (表の中など、プレビューに出ていない場所にマークが残っているケースを拾うため)。
    const after = await getTemplateText(auth, newDocId);
    const url = copyRes.data.webViewLink || `https://docs.google.com/document/d/${newDocId}/edit`;
    if (after.markers.length > 0) {
      return {
        error: `「${contract.name}」に ${after.markers.map((m) => `{{${m}}}`).join('・')} が残りました。作成したファイル(${url})を確認してください`,
      };
    }

    return {
      value: {
        contractId: contract.id,
        contractName: contract.name,
        contractVersion: contract.version || null,
        docId: newDocId,
        name: copyRes.data.name,
        url,
        // 生成直後の本文を控えておく。あとでAIに直してもらったときに
        // 「どこが変わったか」を全体で見比べるための基準になる。
        originalText: after.text,
        // 誰が編集できる状態にしたか。共有に失敗したときは理由を残し、画面にも出す
        // (共有できていないことに気づかずに依頼を送るのが一番まずい)。
        sharing: sharing || null,
        sharingError: sharingError || null,
      },
    };
  }

  // 依頼文の組み立てのみを担当する関数（検証は呼び出し元で先に行う）。プレビュー用
  // エンドポイントと送信用エンドポイントの両方から同じ関数を呼ぶことで、プレビューで
  // 見た文面と実際に送信される文面が食い違わないようにする。
  // 契約相手の名称は案件のデータから直接読まず、counterpartyNameOf・入力項目から決めた
  // counterpartyNameとして受け取る。
  // individualContract: 基本契約書と併せて選んだ個別契約書(無ければnull)。
  // fieldValues: 送信済みの{ label, value }の配列(順序は主契約書の項目→個別契約書の項目。
  //   resolveFieldValuesが作る)。必須項目の抜けチェックは呼び出し元(送信/プレビュー両方の
  //   ハンドラ)で先に行っているので、ここでは受け取った分をそのまま並べるだけでよい。
  function buildContractRequestMessage({ contract, individualContract, fieldValues, generatedDocuments, counterpartyName, department, shareChannel, contact, cloudSignEmail, notes, inviteLink, isTest }) {
    const lines = [];
    // テスト送信であることを本文の1行目に含めておく。プレビューで見せる文面と実際に送信する
    // 文面を完全に一致させたい(messageOverrideは本文をまるごと差し替えるため、投稿時に
    // 別途テスト表示を足すとプレビューと食い違ってしまう)ので、ここ(組み立て時点)で入れる。
    if (isTest) {
      lines.push(TEST_NOTICE_LINE);
    }
    lines.push(
      `<@${CONTRACT_REQUEST_MENTION_USER_ID}> cc <@${CONTRACT_REQUEST_CC_USER_ID}>`,
      'お疲れ様です！マーケ案件進行にあたり契約書の締結をお願いしたいです！',
      `・契約内容：${contract.name}（第${contract.version}版）`,
      `・契約相手（企業名）：${counterpartyName}`,
      `・契約書雛形：${contract.url}`,
    );
    if (individualContract) {
      lines.push(
        `・個別契約書：${individualContract.name}（第${individualContract.version}版）`,
        `・個別契約書リンク：${individualContract.url}`,
      );
    }
    // 入力項目を差し込んで作った契約書。雛形のリンクだけだと法務側が値を確認できないため、
    // 生成してあるときはそのリンクも載せる(生成はプレビューより前に済ませてあるので、
    // プレビューで見た文面と実際に送る文面は一致する)。
    (generatedDocuments || []).forEach((doc) => {
      lines.push(`・記入済み契約書（${doc.contractName}）：${doc.url}`);
    });
    (fieldValues || []).forEach(({ label, value }) => {
      lines.push(`・${label}：${value}`);
    });
    lines.push(`・所属部署：${department || DEFAULT_DEPARTMENT}`);

    if (shareChannel === 'email') {
      lines.push(`・共有先／グループ：メール（${contact.name} <${contact.email}>）`);
      if (cloudSignEmail) {
        lines.push(`・クラウドサイン送付先：${cloudSignEmail}`);
      }
    } else if (shareChannel === 'chatwork') {
      lines.push('・共有先／グループ：Chatwork');
      // 招待リンクが取得できた場合のみ1行追加する（本人が未連携、権限不足、
      // API仕様差異など理由は色々あるが、取れないだけで依頼自体は通す）。
      if (inviteLink) {
        lines.push(`・Chatwork招待リンク：${inviteLink}`);
      }
    } else {
      lines.push('・共有先／グループ：Slack');
    }
    if (notes) {
      lines.push(`・備考：${notes}`);
    }
    lines.push('ご確認お願いいたします！');
    return lines.join('\n');
  }

  // 契約相手として使う入力項目の名前(優先順)。
  //
  // 案件の企業名(＝発注元)と、契約書に書く契約相手が違うことがある
  // (発注は三菱地所、契約先は一般社団法人、など)。契約書に入力した企業名のほうが
  // 実際に締結する相手なので、そちらを優先する。入力が無ければ案件の会社名。
  const COUNTERPARTY_FIELD_LABELS = ['契約相手', '契約先', '契約先企業名', '会社名', '企業名'];

  // 依頼文に載せる「契約相手」と、そこに使った入力項目を除いた残りの項目を返す。
  // 契約相手に使った項目をそのまま下にも並べると同じ会社名が2回出るため、1つにまとめる。
  function splitCounterparty(fieldValues, fallbackName) {
    const values = Array.isArray(fieldValues) ? fieldValues : [];
    for (const label of COUNTERPARTY_FIELD_LABELS) {
      const index = values.findIndex((v) => v.label === label && String(v.value || '').trim());
      if (index === -1) continue;
      return {
        counterpartyName: String(values[index].value).trim(),
        restFieldValues: values.filter((_, i) => i !== index),
      };
    }
    return { counterpartyName: fallbackName, restFieldValues: values };
  }

  // 依頼文に書く所属部署。契約書チームが振り分けに使うので、選んだものをそのまま載せる。
  const DEPARTMENTS = ['営業', 'メディア', '広告'];
  const DEFAULT_DEPARTMENT = '営業';

  function normalizeDepartment(department) {
    if (department === undefined || department === null || department === '') {
      return { value: DEFAULT_DEPARTMENT };
    }
    if (!DEPARTMENTS.includes(department)) {
      return { error: `所属部署は${DEPARTMENTS.join('・')}のいずれかを選んでください` };
    }
    return { value: department };
  }

  // 個別契約書(基本契約書と併せて選ぶ、任意)の解決。指定が無ければnull、指定があるのに
  // 見つからなければエラーを返す。主契約書の解決(送信・プレビュー両ハンドラに元々あるロジック)
  // と同じ考え方。送信・プレビュー・記入済み契約書の作成で同じものを使う。
  async function resolveIndividualContract(individualContractId) {
    if (!individualContractId) {
      return { value: null };
    }
    const snap = await db.collection('contracts').doc(individualContractId).get();
    if (!snap.exists) {
      return { error: '指定の個別契約書が見つかりません' };
    }
    return { value: { id: snap.id, ...snap.data() } };
  }

  // 主契約書・個別契約書それぞれのrequestFieldsに対して、送られてきたfieldValues
  // ([{ contractId, fieldId, value }, ...])を突き合わせる。戻り値は{ label, value }の配列で、
  // 順序は主契約書の項目→個別契約書の項目(これがそのまま依頼文の行順・履歴の保存順になる)。
  // 値が空の任意項目は行を作らない(「入力された項目だけ1行」という仕様のため)。
  //
  // 必須チェックをするのは「記入済み契約書を作るとき」だけ(required: true)。
  // 締結依頼を送ること自体には入力項目は要らない ―― 送るのは出来上がった契約書で、
  // 項目はその契約書を作るために使うものだから。ここを必須にしていたせいで、
  // すでに作ってある契約書を送りたいだけなのに入力欄を埋めさせられていた。
  function resolveFieldValues({ contract, individualContract, fieldValues, required = true }) {
    const rawList = Array.isArray(fieldValues) ? fieldValues : [];
    const resolved = [];
    for (const c of [contract, individualContract]) {
      if (!c) continue;
      const fields = Array.isArray(c.requestFields) ? c.requestFields : [];
      for (const field of fields) {
        const entry = rawList.find((v) => v && v.contractId === c.id && v.fieldId === field.id);
        const value = entry && entry.value != null ? String(entry.value).trim() : '';
        if (required && field.required !== false && !value) {
          return { error: `${field.label}を入力してください` };
        }
        if (value) {
          resolved.push({ label: field.label, value });
        }
      }
    }
    return { value: resolved };
  }

  // Task 2: 案件ごとの締結状況と締結依頼 ----------------------------------
  //
  // account-sales-boardでは案件・パートナーの両方に同じ手順を登録しているため、差分を
  // entityConfigで吸収する形になっている。こちらは案件だけだが、あちらと見比べて直せるよう
  // 形はそのまま残してある。
  //
  // entityConfig:
  //   collectionName: 対象コレクション名('progressDashboard')
  //   pathName:       APIのパスに使う名前('deals')
  //   factsSource:    AIに渡す前提のうち、案件から取った事実に付ける出どころ
  //   notFoundError:  親ドキュメントが無かった場合のエラーメッセージ
  //   counterpartyNameOf: 親ドキュメントのデータから契約相手の名称を取り出す関数
  //   chatworkUnlinkedError / slackUnlinkedError: 未連携時のエラーメッセージ
  function registerContractRequestRoutes({ collectionName, pathName, factsSource, notFoundError, counterpartyNameOf, factsOf, chatworkUnlinkedError, slackUnlinkedError }) {
    const basePath = `/${pathName}/:id/contract-requests`;

    // 送る前に、入力した値を差し込んだ契約書を作る。作ったものは案件の配下に
    // 残し、契約書タブから開けるようにする。
    router.post(`${basePath}/documents`, async (req, res) => {
      try {
        const { contractId, individualContractId, fieldValues } = req.body || {};
        if (!contractId) {
          // 締結依頼側のエラーと同じ文言にすると、どちらで詰まっているのか分からなくなる。
          return res.status(400).json({ error: '記入済み契約書を作る雛形を選択してください' });
        }
        const contractSnap = await db.collection('contracts').doc(contractId).get();
        if (!contractSnap.exists) {
          return res.status(400).json({ error: '指定の契約書が見つかりません' });
        }
        const contract = { id: contractSnap.id, ...contractSnap.data() };

        const individualContractResult = await resolveIndividualContract(individualContractId);
        if (individualContractResult.error) {
          return res.status(400).json({ error: individualContractResult.error });
        }
        const individualContract = individualContractResult.value;

        // 必須項目の検証は送信・プレビューと同じ関数を使う(ここだけ緩いと、
        // 空欄のまま生成した契約書を送ってしまえることになるため)。
        const fieldValuesResult = resolveFieldValues({ contract, individualContract, fieldValues });
        if (fieldValuesResult.error) {
          return res.status(400).json({ error: fieldValuesResult.error });
        }
        const valueByLabel = new Map(fieldValuesResult.value.map(({ label, value }) => [label, value]));

        const entityRef = db.collection(collectionName).doc(req.params.id);
        const entitySnap = await entityRef.get();
        if (!entitySnap.exists) return res.status(404).json({ error: notFoundError });
        // ファイル名にも、契約書に入力した企業名を優先して使う（依頼文の契約相手と揃える）。
        const { counterpartyName } = splitCounterparty(
          fieldValuesResult.value, counterpartyNameOf(entitySnap.data()),
        );

        const { auth, drive, actorEmail } = await getGoogleClients();
        const folderId = await resolveContractOutputFolderId();

        const generated = [];
        for (const target of [contract, individualContract]) {
          if (!target) continue;
          const result = await generateOneContractDocument({
            auth, drive, contract: target, counterpartyName, folderId, valueByLabel,
            userEmail: actorEmail,
          });
          if (result.error) {
            return res.status(400).json({ error: result.error });
          }
          if (result.value) generated.push(result.value);
        }
        if (generated.length === 0) {
          return res.status(400).json({
            error: '差し込む項目が雛形にありません。マスター管理の契約書管理で「項目入り版を作る」から{{項目名}}をマークしてください',
          });
        }

        const saved = [];
        for (const doc of generated) {
          const ref = await entityRef.collection('generatedContracts').add({
            ...doc,
            fieldValues: fieldValuesResult.value,
            createdAt: FieldValue.serverTimestamp(),
          });
          const snap = await ref.get();
          saved.push(serializeDoc(snap.id, snap.data()));
        }
        res.status(201).json(saved);
      } catch (error) {
        console.error('記入済み契約書の作成エラー:', error);
        res.status(error.status || 500).json({ error: error.message || '記入済み契約書の作成に失敗しました' });
      }
    });

    router.get(`${basePath}/documents`, async (req, res) => {
      try {
        const snap = await db.collection(collectionName).doc(req.params.id).collection('generatedContracts')
          .orderBy('createdAt', 'desc')
          .get();
        res.json(snap.docs.map((d) => serializeDoc(d.id, d.data())));
      } catch (error) {
        console.error('記入済み契約書一覧取得エラー:', error);
        res.status(500).json({ error: '記入済み契約書の取得に失敗しました' });
      }
    });

    // Task 1.7: 記入済み契約書のAI修正 ------------------------------------
    //
    // 案件ごとの事情(「この案件は支払いを試作後にする」など)を、生成済みの契約書に
    // 反映させる。雛形そのものは触らない: 雛形は全案件で共有するものなので、
    // 案件固有の文言を入れたら次の案件に漏れる。直すのは「項目を差し込んで作った
    // その案件用の1ファイル」だけ。
    //
    // AIは提案までしかしない。反映するかどうかは必ず人が押す(契約書は法務確認が
    // 前提の書類で、気づかないうちに文言が変わっているのが一番まずいため)。
    // 差分は全体を見せる: 直した1箇所だけ見ても、その条項が他の条項と矛盾していないかは
    // 分からないので、生成直後の本文と並べて全体を確認できるようにする。

    // 生成済み契約書1件を読み、GoogleドキュメントIDまで解決する。
    async function loadGeneratedContractDoc(entityId, documentId) {
      const ref = db.collection(collectionName).doc(entityId)
        .collection('generatedContracts').doc(String(documentId));
      const snap = await ref.get();
      if (!snap.exists) {
        const error = new Error('作成済みの契約書が見つかりません');
        error.status = 404;
        throw error;
      }
      const data = snap.data();
      // docIdは生成時に保存してあるが、古いデータのためURLからの復元も残しておく。
      const docId = data.docId || extractDocIdFromUrl(data.url);
      if (!docId) {
        const error = new Error('このファイルはGoogleドキュメントではないため編集できません');
        error.status = 400;
        throw error;
      }
      return { ref, data, docId };
    }

    // AIに渡す「この契約の前提」。案件に入っている事実と、
    // 契約書を作るときに実際に差し込んだ項目の値を並べる。
    //
    // これが無いと、AIは契約書の文面と一行の指示だけで書くことになり、
    // 書かれていない前提を勝手に埋めてしまう(「9月末締め翌月末払い」という指示に対して、
    // 一括請求のパッケージなのに毎月請求の条項を書いてしまい、実施していない9月にも
    // 請求が立つ文面になりかけた)。画面にも同じものを出して、
    // 「AIが何を知った上で書いているか」が人に見えるようにする。
    async function contractFactsFor(entityId, data) {
      const snap = await db.collection(collectionName).doc(entityId).get();
      const entityFacts = snap.exists && factsOf ? factsOf(snap.data()) : [];
      const fieldValues = Array.isArray(data.fieldValues) ? data.fieldValues : [];
      return [
        ...entityFacts.map((f) => ({ ...f, source: factsSource })),
        ...fieldValues.map((f) => ({ label: f.label, value: f.value, source: '契約書に差し込んだ項目' })),
      ].filter((f) => f.label && f.value != null && String(f.value).trim());
    }

    // 画面が出すもの一式。originalTextは生成直後の本文(全体差分の左側)で、
    // この機能より前に作った契約書には入っていないためnullになりうる。
    function generatedContractPayload(data, docId, text, facts) {
      return {
        text,
        docId,
        url: data.url || `https://docs.google.com/document/d/${docId}/edit`,
        name: data.name || null,
        contractName: data.contractName || null,
        originalText: typeof data.originalText === 'string' ? data.originalText : null,
        revisions: Array.isArray(data.revisions) ? data.revisions : [],
        facts: facts || [],
      };
    }

    router.get(`${basePath}/documents/:documentId/text`, async (req, res) => {
      try {
        const { data, docId } = await loadGeneratedContractDoc(req.params.id, req.params.documentId);
        const { auth } = await getGoogleClients();
        let template;
        try {
          template = await getTemplateText(auth, docId);
        } catch (docsError) {
          console.error('記入済み契約書の取得エラー:', docsError.message);
          return res.status(400).json({
            error: googleApiErrorMessage(docsError, 'この契約書のGoogleドキュメントを開けませんでした'),
          });
        }
        const facts = await contractFactsFor(req.params.id, data);
        res.json(generatedContractPayload(data, docId, template.text, facts));
      } catch (error) {
        console.error('記入済み契約書の本文取得エラー:', error);
        res.status(error.status || 500).json({ error: error.message || '契約書の本文取得に失敗しました' });
      }
    });

    // 指示に沿った直し方を提案するだけ。ドキュメントには一切書き込まない。
    //
    // 直す単位は「選んだ範囲」ではなく契約書全体。同じ事柄(支払条件・金額・期間など)は
    // 契約書の複数の場所に書かれているのが普通で、選んだ範囲だけ直すと矛盾が残る
    // (実際に、料金の条項だけ月末払いに直って、別の場所の支払条件が前払いのまま
    //  残りかけた)。選択範囲は「気になっている箇所の手がかり」としてだけ渡す。
    //
    // 本文は画面から受け取る。画面側では本文をそのまま編集できるようにしてあり、
    // Googleドキュメントにまだ保存していない状態の文章に対しても頼めるようにするため。
    router.post(`${basePath}/documents/:documentId/ai-revision`, async (req, res) => {
      try {
        const { text, instruction, focus, answers } = req.body || {};
        const trimmedInstruction = instruction != null ? String(instruction).trim() : '';
        const body = text != null ? String(text) : '';
        if (!trimmedInstruction) {
          return res.status(400).json({ error: 'どう直したいかを入力してください' });
        }
        if (!body.trim()) {
          return res.status(400).json({ error: '契約書の本文が読み込めていません' });
        }
        const apiKey = env('OPENAI_API_KEY');
        if (!apiKey) {
          return res.status(500).json({ error: 'OPENAI_API_KEYが未設定です' });
        }
        // どの案件のどの契約書に対する依頼なのかは確かめておく(存在しないIDでも
        // 通ってしまうと、この入口がただのAI呼び出し口になってしまうため)。
        const { data } = await loadGeneratedContractDoc(req.params.id, req.params.documentId);
        const facts = await contractFactsFor(req.params.id, data);

        const result = await proposeContractEdits({
          apiKey,
          text: body,
          instruction: trimmedInstruction,
          focus: focus != null ? String(focus).trim() : '',
          facts,
          answers: answers != null ? String(answers).trim() : '',
        });
        res.json(result);
      } catch (error) {
        console.error('契約書のAI修正エラー:', error);
        res.status(error.status || 500).json({ error: error.message || 'AIによる修正案の作成に失敗しました' });
      }
    });

    // 今の本文を通しで読み、矛盾・直し忘れが残っていないかだけを報告する。
    // 直した後に押してもらう想定。AIが挙げた箇所を直すかどうかは人が決める。
    router.post(`${basePath}/documents/:documentId/ai-consistency-check`, async (req, res) => {
      try {
        const body = req.body && req.body.text != null ? String(req.body.text) : '';
        if (!body.trim()) {
          return res.status(400).json({ error: '契約書の本文が読み込めていません' });
        }
        const apiKey = env('OPENAI_API_KEY');
        if (!apiKey) {
          return res.status(500).json({ error: 'OPENAI_API_KEYが未設定です' });
        }
        const { data } = await loadGeneratedContractDoc(req.params.id, req.params.documentId);
        const facts = await contractFactsFor(req.params.id, data);
        const result = await checkContractConsistency({ apiKey, text: body, facts });
        res.json(result);
      } catch (error) {
        console.error('契約書の矛盾チェックエラー:', error);
        res.status(error.status || 500).json({ error: error.message || '矛盾チェックに失敗しました' });
      }
    });

    // 提案を反映する(AIを通さず手で直した文字でも同じ入口を使う)。
    // 書き換える前に「選択範囲が今も同じ文字か」を確かめる: 画面を開いたまま別の誰かが
    // ドキュメントを直していると、文字位置がズレて関係ない場所を壊してしまうため。
    router.post(`${basePath}/documents/:documentId/text`, async (req, res) => {
      try {
        const { flatStart, flatEnd, text, expectedOriginal, instruction } = req.body || {};
        if (!Number.isInteger(flatStart) || !Number.isInteger(flatEnd)) {
          return res.status(400).json({ error: '編集する範囲が不正です' });
        }
        const { ref, data, docId } = await loadGeneratedContractDoc(req.params.id, req.params.documentId);
        const { auth } = await getGoogleClients();

        if (typeof expectedOriginal === 'string') {
          const before = await getTemplateText(auth, docId);
          if (before.text.slice(flatStart, flatEnd) !== expectedOriginal) {
            return res.status(409).json({
              error: '本文が更新されています。読み直してから反映し直してください',
            });
          }
        }

        const result = await replaceRangeWithText(auth, docId, flatStart, flatEnd, text);
        if (result.error) {
          return res.status(400).json({ error: result.error });
        }
        const after = await getTemplateText(auth, docId);

        // 何をどう直したかの履歴。全体差分で「何が変わったか」は見えるので、ここには
        // 「どういう意図で直したか」だけを残す(本文まで持つと際限なく太るため)。
        const revisions = (Array.isArray(data.revisions) ? data.revisions : []).concat([{
          at: new Date().toISOString(),
          instruction: instruction != null ? String(instruction).slice(0, 500) : null,
        }]).slice(-50);
        await ref.update({ revisions, revisedAt: FieldValue.serverTimestamp() });

        const facts = await contractFactsFor(req.params.id, data);
        res.json(generatedContractPayload({ ...data, revisions }, docId, after.text, facts));
      } catch (error) {
        console.error('記入済み契約書の編集エラー:', error);
        res.status(error.status || 500).json({ error: error.message || '契約書の編集に失敗しました' });
      }
    });

    // プレビュー・送信で使う、生成済み契約書の解決。画面から渡ってくるのはidだけにして、
    // 本文に載せるURLは必ずサーバー側で引き直す(プレビューと送信で同じものを見るため)。
    async function resolveGeneratedDocuments(entityId, ids) {
      if (!Array.isArray(ids) || ids.length === 0) return { value: [] };
      const entityRef = db.collection(collectionName).doc(entityId);
      const docs = [];
      for (const id of ids) {
        const snap = await entityRef.collection('generatedContracts').doc(String(id)).get();
        if (!snap.exists) {
          return { error: '作成済みの契約書が見つかりません。もう一度「記入済み契約書を作成」を押してください' };
        }
        docs.push({ id: snap.id, ...snap.data() });
      }
      return { value: docs };
    }

    // 送信・プレビューが共通で使う「何を送るか」の解決。
    //
    // 送る契約書の決め方は2通りある:
    //  A. すでに作ってある記入済み契約書を選ぶ。どの雛形から作ったものかは生成時に
    //     記録してあるので、雛形を選び直してもらう必要はない(ここで引き当てる)。
    //  B. 雛形を選ぶ。項目を差し込んだ契約書をその場で作って送るか、雛形をそのまま送る。
    //
    // 入力項目は「記入済み契約書を作るため」のものなので、送るときには必須にしない。
    async function resolveRequestTargets(entityId, body) {
      const generatedResult = await resolveGeneratedDocuments(entityId, body.generatedDocumentIds);
      if (generatedResult.error) return { error: generatedResult.error };
      const generatedDocuments = generatedResult.value;

      // 記入済み契約書には、どの雛形から作ったかを生成時に記録してある。
      // 先頭のものに限らず、記録が残っているものから引き当てる
      // (記録の無い古いデータが1件混ざっただけで送れなくなるのを避ける)。
      const fromGenerated = generatedDocuments.find((d) => d.contractId);
      const contractId = body.contractId || (fromGenerated && fromGenerated.contractId) || '';
      if (!contractId) {
        return {
          error: generatedDocuments.length > 0
            ? 'この契約書がどの雛形から作られたか分からないため送れません。「雛形から作る」を選んで作り直してください'
            : '送る契約書を選んでください（雛形か、作成済みの契約書のどちらか）',
        };
      }
      const contractSnap = await db.collection('contracts').doc(contractId).get();
      if (!contractSnap.exists) {
        return { error: '指定の契約書が見つかりません（契約書管理から削除された可能性があります）' };
      }
      const contract = { id: contractSnap.id, ...contractSnap.data() };

      const individualResult = await resolveIndividualContract(body.individualContractId);
      if (individualResult.error) return { error: individualResult.error };
      const individualContract = individualResult.value;

      // 入力漏れでは止めない(送るのは出来上がった契約書なので)。値は依頼文に載せるためだけに使う。
      const fieldValuesResult = resolveFieldValues({
        contract, individualContract, fieldValues: body.fieldValues, required: false,
      });
      if (fieldValuesResult.error) return { error: fieldValuesResult.error };

      // 依頼文に載せる入力項目。フォームで入力していればそれを使い、すでに作ってある
      // 契約書を選んだだけなら、その契約書を作ったときに使った値を使う
      // (法務が「どの値で作られた契約書か」を依頼文だけで確認できるようにするため)。
      let resolvedFieldValues = fieldValuesResult.value;
      if (resolvedFieldValues.length === 0) {
        const seen = new Set();
        resolvedFieldValues = [];
        for (const doc of generatedDocuments) {
          for (const fv of doc.fieldValues || []) {
            const key = `${fv.label}\u0000${fv.value}`;
            if (!fv.label || seen.has(key)) continue;
            seen.add(key);
            resolvedFieldValues.push({ label: fv.label, value: fv.value });
          }
        }
      }

      // 契約相手は、契約書に入力した企業名を優先する（案件の企業名＝発注元とは違うことがある）。
      // 使った項目は下の一覧から外す（同じ会社名が2回並ぶため）。
      const { counterpartyName, restFieldValues } = splitCounterparty(resolvedFieldValues, body.fallbackCounterpartyName);
      return {
        value: {
          contract, individualContract, generatedDocuments,
          resolvedFieldValues: restFieldValues, counterpartyName,
        },
      };
    }

    router.get(basePath, async (req, res) => {
      try {
        const snap = await db.collection(collectionName).doc(req.params.id).collection('contractRequests')
          .orderBy('requestedAt', 'desc')
          .get();
        res.json(snap.docs.map((d) => serializeDoc(d.id, d.data())));
      } catch (error) {
        console.error('締結依頼一覧取得エラー:', error);
        res.status(500).json({ error: '締結依頼の取得に失敗しました' });
      }
    });

    // 既に締結済みの契約書を、ファイルをアップロードして登録する。
    //
    // 今後の締結はこのアプリから依頼する前提だが、それ以前の契約書が既に何通もある。
    // また、先方から修正依頼が来て直した版を受け取ることは今後も起きるので、
    // 同じ締結記録に版を足せるようにしてある（差し替えではなく、版を積む
    // ―― どの版で合意したのかが後から分からなくなるのが一番まずい）。
    router.post(`${basePath}/upload`, async (req, res) => {
      try {
        const contractName = String(req.body?.contractName || '').trim();
        const fileName = String(req.body?.fileName || '').trim();
        const fileDataBase64 = req.body?.fileDataBase64;
        const mimeType = String(req.body?.mimeType || '').trim() || 'application/octet-stream';
        const kind = req.body?.kind === 'basic' ? 'basic' : 'individual';
        const note = req.body?.note ? String(req.body.note).trim() : '';
        const signedDate = req.body?.signedDate ? String(req.body.signedDate) : null;
        const replacesRequestId = req.body?.replacesRequestId ? String(req.body.replacesRequestId) : null;
        if (!contractName) return res.status(400).json({ error: '契約書名を入力してください' });
        if (!fileName || !fileDataBase64) return res.status(400).json({ error: 'ファイルを選択してください' });
        if (signedDate && !/^\d{4}-\d{2}-\d{2}$/.test(signedDate)) {
          return res.status(400).json({ error: '締結日はYYYY-MM-DDで入力してください' });
        }

        const entityRef = db.collection(collectionName).doc(req.params.id);
        const entitySnap = await entityRef.get();
        if (!entitySnap.exists) return res.status(404).json({ error: notFoundError });

        const uploaded = await uploadFileToDrive({ name: contractName, fileName, fileDataBase64, mimeType });
        if (uploaded.error) return res.status(400).json({ error: uploaded.error });

        const nowTs = Timestamp.now();
        // ログインユーザーを識別できないため、案件の営業担当を登録者として残す。
        const uploadedBy = entitySnap.data().representative || null;
        const version = {
          fileName,
          url: uploaded.value.url,
          note,
          uploadedAt: nowTs,
          uploadedBy,
        };

        if (replacesRequestId) {
          const requestRef = entityRef.collection('contractRequests').doc(replacesRequestId);
          const requestSnap = await requestRef.get();
          if (!requestSnap.exists) return res.status(404).json({ error: '締結記録が見つかりません' });
          await requestRef.update({
            // 最新版を表に出しつつ、前の版も残す。
            contractUrl: uploaded.value.url,
            uploadedFileName: fileName,
            uploadedVersions: FieldValue.arrayUnion(version),
            status: 'signed',
            signedAt: nowTs,
            ...(signedDate ? { signedDate } : {}),
          });
          const updated = await requestRef.get();
          return res.status(200).json(serializeDoc(updated.id, updated.data()));
        }

        const requestRef = await entityRef.collection('contractRequests').add({
          // 雛形マスタを経由していないので contractId は持たない。
          // 基本/個別は雛形から引けないため、この記録自体に持たせる
          // （請求先との基本契約書があるかの判定がこれを見る）。
          contractId: null,
          contractName,
          contractUrl: uploaded.value.url,
          kind,
          uploadedFileName: fileName,
          uploadedVersions: [version],
          // アプリから依頼したものではなく、締結済みのものを取り込んだ記録。
          source: 'upload',
          fieldValues: [],
          generatedDocuments: [],
          counterpartyName: counterpartyNameOf(entitySnap.data()) || '',
          notes: note,
          status: 'signed',
          signedAt: nowTs,
          signedDate: signedDate || null,
          requestedAt: nowTs,
          requestedBy: uploadedBy,
        });
        const created = await requestRef.get();
        res.status(201).json(serializeDoc(created.id, created.data()));
      } catch (error) {
        console.error('締結済み契約書の登録エラー:', error);
        res.status(error.status || 500).json({ error: error.message || '締結済み契約書の登録に失敗しました' });
      }
    });

    router.post(basePath, async (req, res) => {
      try {
        const {
          contractId, individualContractId, fieldValues, generatedDocumentIds, shareChannel, contactName, contactEmail, cloudSignEmail, notes, department, messageOverride, sendToTestChannel,
        } = req.body || {};
        const departmentResult = normalizeDepartment(department);
        if (departmentResult.error) {
          return res.status(400).json({ error: departmentResult.error });
        }
        if (!['email', 'chatwork', 'slack'].includes(shareChannel)) {
          return res.status(400).json({ error: '共有先／グループを選択してください' });
        }
        const overrideResult = normalizeMessageOverride(messageOverride);
        if (overrideResult.error) {
          return res.status(400).json({ error: overrideResult.error });
        }
        const sendToTestChannelResult = normalizeSendToTestChannel(sendToTestChannel);
        if (sendToTestChannelResult.error) {
          return res.status(400).json({ error: sendToTestChannelResult.error });
        }
        // messageOverrideで本文が差し替えられていても、記録として残すfieldValuesと
        // individualContractは別途解決・保存する必要があるため、ここでの解決は
        // messageOverrideの有無に関わらず必ず行う。
        const entityRef = db.collection(collectionName).doc(req.params.id);
        const entitySnap = await entityRef.get();
        if (!entitySnap.exists) return res.status(404).json({ error: notFoundError });
        const entity = await withChatSettings(entitySnap.data());

        const targetsResult = await resolveRequestTargets(req.params.id, {
          contractId, individualContractId, fieldValues, generatedDocumentIds,
          fallbackCounterpartyName: counterpartyNameOf(entity),
        });
        if (targetsResult.error) {
          return res.status(400).json({ error: targetsResult.error });
        }
        const {
          contract, individualContract, generatedDocuments, resolvedFieldValues, counterpartyName,
        } = targetsResult.value;

        if (shareChannel === 'chatwork' && !entity.chatworkRoomId) {
          return res.status(400).json({ error: chatworkUnlinkedError });
        }
        if (shareChannel === 'slack' && !entity.slackChannelId) {
          return res.status(400).json({ error: slackUnlinkedError });
        }

        let contact = null;
        if (shareChannel === 'email') {
          const contactResult = normalizeEmailContact({ contactName, contactEmail });
          if (contactResult.error) return res.status(400).json({ error: contactResult.error });
          contact = contactResult.value;
        }

        // 依頼文のフォーマットは雛形確認依頼(dealsRouter.js)に揃える。契約書名の代わりに
        // 「契約書名(URL・第n版)」を入れる点だけが異なる。
        const inviteLink = shareChannel === 'chatwork' ? await inviteLinkForChatworkRequest(entity) : null;
        // 投稿先は依頼フォームで選んだテストグループ/本番のどちらか(未指定なら設定の既定値)。
        // 設定は appConfig/slackChannels で管理する(functions/README.md参照)。
        const { channelId, isTest, error: channelError } = await resolveRequestChannel({
          sendToTestChannel: sendToTestChannelResult.value,
        });
        if (channelError) {
          return res.status(400).json({ error: channelError });
        }
        const message = overrideResult.value || buildContractRequestMessage({
          contract, individualContract, fieldValues: resolvedFieldValues, generatedDocuments,
          counterpartyName, department: departmentResult.value, shareChannel, contact, cloudSignEmail, notes, inviteLink, isTest,
        });

        // 契約書は実体を持たずURLで管理しているため、雛形確認依頼と異なりファイル添付は行わない
        // (添付する元データが存在しない)。常にテキストのみ投稿する。
        await postToSlack(message, channelId);

        const nowTs = Timestamp.now();
        // ログインユーザーを識別できないため、案件の営業担当を依頼者として残す。
        const requestedBy = entity.representative || null;
        const requestRef = await entityRef.collection('contractRequests').add({
          contractId,
          contractName: contract.name,
          contractUrl: contract.url,
          contractVersion: contract.version,
          // 個別契約書はidだけでなくname/url/versionもここに複製しておく(マスタ側が
          // 後から更新されても、履歴表示がその時点の内容のまま読めるようにするため。
          // 主契約書のcontractName等を別フィールドで持っているのと同じ考え方)。
          individualContract: individualContract
            ? { id: individualContract.id, name: individualContract.name, url: individualContract.url, version: individualContract.version }
            : null,
          // 入力項目はラベルと値のペアで保存する。idだけ保存すると、マスタ側で項目名が
          // 変わったり削除された時に履歴が読めなくなるため、依頼時点のラベルをそのまま残す。
          fieldValues: resolvedFieldValues,
          // 実際に依頼文へ書いた契約相手と所属部署。履歴を読むときに本文と突き合わせられるように残す。
          counterpartyName,
          department: departmentResult.value,
          // 送った時点で紐づけた記入済み契約書。後から「何を送ったか」を辿れるように、
          // 契約書名とURLもそのまま複製して残す(生成物を後で消されても履歴は読める)。
          generatedDocuments: generatedDocuments.map((d) => ({
            id: d.id, contractId: d.contractId, contractName: d.contractName, name: d.name, url: d.url,
          })),
          shareChannel,
          // メールで共有した場合の宛先(案件に連絡先の一覧が無いため、依頼ごとに入力した値を残す)。
          emailContact: contact,
          cloudSignEmail: shareChannel === 'email' && cloudSignEmail ? String(cloudSignEmail).trim() : null,
          notes: notes ? String(notes).trim() : '',
          // 後から何を依頼したか分かるよう、実際に送信した本文をそのまま保存する
          // (messageOverrideで差し替えられていた場合はその内容)。
          message,
          // どのチャンネルに送ったか(テストグループ宛だったか)を履歴として残す。
          slackChannelId: channelId,
          sentToTestChannel: isTest,
          status: 'requested',
          requestedAt: nowTs,
          requestedBy,
        });


        const created = await requestRef.get();
        res.status(201).json(serializeDoc(created.id, created.data()));
      } catch (error) {
        console.error('契約締結依頼エラー:', error);
        res.status(500).json({ error: '契約締結の依頼に失敗しました' });
      }
    });

    // 上と同じ検証・組み立てを行い、Slackへの投稿や記録は行わずに依頼文だけを返す。
    // 送信前に文面を確認・修正したい、という運用側の要望への対応。
    router.post(`${basePath}/preview`, async (req, res) => {
      try {
        const { contractId, individualContractId, fieldValues, generatedDocumentIds, shareChannel, contactName, contactEmail, cloudSignEmail, notes, department, sendToTestChannel } = req.body || {};
        const departmentResult = normalizeDepartment(department);
        if (departmentResult.error) {
          return res.status(400).json({ error: departmentResult.error });
        }
        if (!['email', 'chatwork', 'slack'].includes(shareChannel)) {
          return res.status(400).json({ error: '共有先／グループを選択してください' });
        }
        const sendToTestChannelResult = normalizeSendToTestChannel(sendToTestChannel);
        if (sendToTestChannelResult.error) {
          return res.status(400).json({ error: sendToTestChannelResult.error });
        }
        const entitySnap = await db.collection(collectionName).doc(req.params.id).get();
        if (!entitySnap.exists) return res.status(404).json({ error: notFoundError });
        const entity = await withChatSettings(entitySnap.data());

        // 送信時とまったく同じ解決を通す(プレビューで見た文面と実際に送る文面を一致させる)。
        const targetsResult = await resolveRequestTargets(req.params.id, {
          contractId, individualContractId, fieldValues, generatedDocumentIds,
          fallbackCounterpartyName: counterpartyNameOf(entity),
        });
        if (targetsResult.error) {
          return res.status(400).json({ error: targetsResult.error });
        }
        const {
          contract, individualContract, generatedDocuments, resolvedFieldValues, counterpartyName,
        } = targetsResult.value;

        if (shareChannel === 'chatwork' && !entity.chatworkRoomId) {
          return res.status(400).json({ error: chatworkUnlinkedError });
        }
        if (shareChannel === 'slack' && !entity.slackChannelId) {
          return res.status(400).json({ error: slackUnlinkedError });
        }

        let contact = null;
        if (shareChannel === 'email') {
          const contactResult = normalizeEmailContact({ contactName, contactEmail });
          if (contactResult.error) return res.status(400).json({ error: contactResult.error });
          contact = contactResult.value;
        }

        // プレビューでも送信時と同じロジックで招待リンクを取得する
        // （プレビューに出ていないものが送信時に増えると混乱するため）。
        const inviteLink = shareChannel === 'chatwork' ? await inviteLinkForChatworkRequest(entity) : null;
        // 送信先も送信時と同じロジックで解決する。プレビュー画面でテストグループ宛だと
        // 分かるようにするため、判定結果(isTest/channelId)をレスポンスに含める。
        const { channelId, isTest, error: channelError } = await resolveRequestChannel({
          sendToTestChannel: sendToTestChannelResult.value,
        });
        if (channelError) {
          return res.status(400).json({ error: channelError });
        }
        const message = buildContractRequestMessage({
          contract, individualContract, fieldValues: resolvedFieldValues, generatedDocuments,
          counterpartyName, department: departmentResult.value, shareChannel, contact, cloudSignEmail, notes, inviteLink, isTest,
        });
        res.status(200).json({ message, testChannel: isTest ? { channelId } : null });
      } catch (error) {
        console.error('契約締結依頼プレビューエラー:', error);
        res.status(500).json({ error: '締結依頼のプレビューに失敗しました' });
      }
    });

    // 締結が完了したこと(あるいは依頼を取り消したこと)を人が記録するための操作。
    // Slackへの投稿自体はここでは行わない(締結依頼時に既に投稿済みのため)。
    router.patch(`${basePath}/:requestId`, async (req, res) => {
      try {
        const { status, note } = req.body || {};
        if (!['requested', 'signed', 'cancelled'].includes(status)) {
          return res.status(400).json({ error: 'statusはrequested/signed/cancelledのいずれかを指定してください' });
        }
        const requestRef = db.collection(collectionName).doc(req.params.id).collection('contractRequests').doc(req.params.requestId);
        const requestSnap = await requestRef.get();
        if (!requestSnap.exists) return res.status(404).json({ error: '締結依頼が見つかりません' });

        const update = { status };
        if (note !== undefined) {
          update.note = note ? String(note).trim() : '';
        }
        if (status === 'signed') {
          update.signedAt = Timestamp.now();
        }
        await requestRef.update(update);
        const updated = await requestRef.get();
        res.status(200).json(serializeDoc(updated.id, updated.data()));
      } catch (error) {
        console.error('締結状況の更新エラー:', error);
        res.status(500).json({ error: '締結状況の更新に失敗しました' });
      }
    });
  }

  registerContractRequestRoutes({
    collectionName: 'progressDashboard',
    pathName: 'deals',
    factsSource: '案件情報',
    notFoundError: '案件が見つかりません',
    counterpartyNameOf: (deal) => deal.companyName || deal.productName || '',
    // AIに渡す「この契約の前提」。案件側にある事実だけを並べる(推測は足さない)。
    factsOf: (deal) => [
      { label: '契約相手', value: deal.companyName },
      { label: '商材', value: deal.productName },
      { label: '提案メニュー', value: deal.proposalMenu },
      { label: '案件の状況', value: deal.status },
      { label: '受注金額', value: deal.receivedOrderAmount ? `${Number(deal.receivedOrderAmount).toLocaleString('ja-JP')}円` : '' },
      { label: '想定予算', value: deal.expectedBudget ? `${Number(deal.expectedBudget).toLocaleString('ja-JP')}円` : '' },
      { label: '受注日', value: deal.confirmedDate },
      { label: '紹介者（代理店）', value: deal.introducer },
    ],
    chatworkUnlinkedError: 'この会社はChatworkルームが未連携です（案件詳細のMTG設定で連携してください）',
    slackUnlinkedError: 'この会社はSlackチャンネルが未連携です（案件詳細のMTG設定で連携してください）',
  });

  return router;
}

module.exports = { createContractsRouter };
