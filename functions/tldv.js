/**
 * tl;dv連携ルーター
 * - tl;dvのネイティブWebhook（MeetingReady/TranscriptReady）を受信
 * - 議事録全文・AI要約・ネクストアクションを`meetings`コレクションに永続化
 * - 案件のMeet URL（progressDashboard.linkedMeetUrls）と照合して自動紐付け
 * - 紐付いた案件のNA（entries）を自動生成
 * - お礼メッセージの下書きを作り、担当者のSlackに承認依頼DMを送る
 *   （社内向けの紐付け結果通知は、tl;dv公式のSlack連携と重複するため廃止した）
 */

const express = require('express');
const fetch = require('node-fetch');
const OpenAI = require('openai');
const { sendApprovalRequest } = require('./slackApproval');

const TLDV_API_BASE = 'https://pasta.tldv.io/v1alpha1';

/**
 * Secret Managerの値を前後の空白/改行を除いて取得する。
 * `jq -r`等で値を流し込む際に混入した末尾改行がHTTPヘッダーで弾かれる
 * 事故があったため、読み出し側でも必ずtrimする。
 */
function env(name) {
  const v = process.env[name];
  return v ? v.trim() : v;
}

/**
 * Google MeetのURLから会議コードを抽出して正規化する。
 * 抽出できない場合は元の値を小文字化・trimして返す（フォールバック）。
 */
function normalizeMeetUrl(url) {
  if (!url) return null;
  const m = String(url).match(/meet\.google\.com\/([a-z0-9-]+)/i);
  if (m) return m[1].toLowerCase();
  return String(url).trim().toLowerCase();
}

async function tldvFetch(path, apiKey) {
  const res = await fetch(`${TLDV_API_BASE}${path}`, {
    headers: { 'x-api-key': apiKey }
  });
  if (!res.ok) {
    throw new Error(`tl;dv API ${path} failed: ${res.status}`);
  }
  return res.json();
}

/**
 * 会議のメタデータ（主催者・参加者・タイトル等）をREST APIから取得する。
 * TranscriptReadyのWebhook本文にはこれらが含まれないため、常にAPIで補う。
 * conferenceId等はドキュメント上の型に含まれておらず、取得できないことがある。
 */
async function fetchMeetingInfo(meetingId, apiKey) {
  try {
    const resp = await tldvFetch(`/meetings/${meetingId}`, apiKey);
    return resp.data || resp;
  } catch (error) {
    console.error('tl;dv meeting情報取得失敗（続行）:', error.message);
    return {};
  }
}

/**
 * Webhookのヘッダーから認証値を取り出す。
 * tl;dv側の認証方式（Header Config／APIキー方式）がどちらでも通るよう、
 * 複数のヘッダー名を許容する。
 */
function extractProvidedSecret(req) {
  const authHeader = req.headers['authorization'] || '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '');
  const raw = req.headers['x-webhook-secret'] || req.headers['x-api-key'] || bearer || null;
  return raw ? normalizeSecret(raw) : null;
}

/**
 * 前後の空白除去＋全角英数字を半角に変換＋小文字化する
 * （IME経由のコピペでの誤変換・大文字化対策）。
 * どちらの秘密値もランダムな16進数/UUID文字列なので大文字小文字を
 * 区別しても強度は変わらない。長さは一致するのに文字コードが違う、
 * という事故を吸収する。
 */
function normalizeSecret(str) {
  return String(str)
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

/**
 * tl;dvの文字起こしを取得し、話者付きの1本のテキストに整形する。
 * まだ生成されていない場合（MeetingReady直後など）は空文字を返す。
 */
async function fetchTranscriptText(meetingId, apiKey) {
  try {
    const resp = await tldvFetch(`/meetings/${meetingId}/transcript`, apiKey);
    const segments = Array.isArray(resp.data) ? resp.data : [];
    return segments
      .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
      .join('\n');
  } catch (error) {
    console.error('tl;dv transcript取得失敗（続行）:', error.message);
    return '';
  }
}

/**
 * tl;dv自身のAI要約（トピックごとの要約）を取得する。
 * OpenAIとは独立した機能のため、OpenAI側の課金状態に関係なく要約を出せる。
 * こちらを要約の第一ソースとし、OpenAIはネクストアクション抽出専用に使う。
 */
async function fetchMeetingNotesSummary(meetingId, apiKey) {
  try {
    const resp = await tldvFetch(`/meetings/${meetingId}/notes`, apiKey);
    const topics = Array.isArray(resp.topics) ? resp.topics : [];
    const fromTopics = topics
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((t) => (t.summary ? `【${t.title || 'トピック'}】${t.summary}` : null))
      .filter(Boolean)
      .join('\n');
    return fromTopics || resp.markdownContent || '';
  } catch (error) {
    console.error('tl;dv notes取得失敗（続行）:', error.message);
    return '';
  }
}

/**
 * OpenAIでMTG議事録を分析し、要約・ネクストアクション等を抽出する。
 * 既存のfunctions/index.js（旧receiveTldv）と同じプロンプト形式を踏襲。
 */
async function analyzeMeeting(apiKey, title, transcriptText) {
  const fallback = { summary: '', nextActions: [], meetingType: 'その他', relatedService: null };
  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'あなたは営業支援AIです。MTG議事録を分析して、ネクストアクションを抽出してください。回答はJSON形式のみで出力してください。'
        },
        {
          role: 'user',
          content: `以下のMTG議事録を分析して、JSON形式で出力してください。JSONのみを出力し、他のテキストは含めないでください：
{
  "summary": "3行以内の要約",
  "nextActions": [
    { "content": "具体的なアクション", "owner": "自分 or 先方", "deadline": "YYYY-MM-DD or null" }
  ],
  "meetingType": "サービス提案 or ヒアリング or 定例 or その他",
  "relatedService": "第一想起取れるくん or 獲得とれるくん or インハウスクラウド or null"
}

MTGタイトル: ${title || '不明'}
議事録:
${transcriptText.substring(0, 6000)}`
        }
      ],
      max_tokens: 1000,
      temperature: 0.3
    });
    const content = completion.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return { ...fallback, ...JSON.parse(jsonMatch[0]) };
  } catch (error) {
    console.error('AI分析エラー（続行）:', error.message);
  }
  return fallback;
}

/**
 * 紐付いた案件にネクストアクション（NA）を自動生成する。
 * 既存のステージ連動NA（stageNa_{n}）と同じ「決定的ID + setDoc」パターンで
 * Webhook再送時の重複を物理的に防ぐ。
 */
async function applyToDeal({ admin, db, dealId, meetingId, aiResult }) {
  const dealRef = db.collection('progressDashboard').doc(dealId);
  const dealSnap = await dealRef.get();
  if (!dealSnap.exists) return;
  const deal = dealSnap.data();

  const subCol = deal.isExistingProject ? 'salesRecords' : 'newCaseSalesRecords';
  const recordsSnap = await dealRef.collection(subCol).orderBy('createdAt', 'desc').limit(1).get();

  let recordId;
  if (!recordsSnap.empty) {
    recordId = recordsSnap.docs[0].id;
  } else {
    const newRecordRef = await dealRef.collection(subCol).add({
      phase: deal.status || '',
      date: '',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    recordId = newRecordRef.id;
  }

  const actions = (aiResult.nextActions || []).filter((a) => (a.owner || '自分') !== '先方');
  const batch = db.batch();

  if (actions.length === 0) {
    // ネクストアクションが無くても、議事録タブと同様に営業記録へ接触メモだけは残す
    // （手動入力の「NAなしメモのみ保存」と同じ形。ここが無いと紐付いても営業記録に何も出ない）
    const entryId = `tldvMemo_${meetingId}`;
    const entryRef = dealRef.collection(subCol).doc(recordId).collection('entries').doc(entryId);
    batch.set(entryRef, {
      memoContent: aiResult.summary || '',
      actionContent: '',
      actionDueDate: null,
      actionAssignee: '',
      actionStatus: 'active',
      aiGenerated: true,
      sourceMeetingId: meetingId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } else {
    actions.forEach((action, index) => {
      const entryId = `tldvNa_${meetingId}_${index}`;
      const entryRef = dealRef.collection(subCol).doc(recordId).collection('entries').doc(entryId);
      batch.set(entryRef, {
        memoContent: aiResult.summary || '',
        actionContent: action.content || '',
        actionDueDate: action.deadline || null,
        actionAssignee: deal.representative || '',
        actionStatus: 'active',
        aiGenerated: true,
        sourceMeetingId: meetingId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }

  batch.update(dealRef, {
    lastContactDate: new Date().toISOString().split('T')[0],
    ...(aiResult.summary ? { summary: aiResult.summary } : {})
  });

  await batch.commit();
}

/**
 * まだ送っていない資料のうち一番新しいものを1件だけ取得する。
 * お礼メッセージの下書きに自動で添付するために使う
 * （どの資料をどのMTGで使ったか、という細かい紐付けまではせず、
 *   単純に「まだ送っていない最新の1件」を拾う簡易な仕様）。
 */
async function pickUnsentMaterial(db, dealId) {
  try {
    const snap = await db.collection('progressDashboard').doc(dealId)
      .collection('materials')
      .where('sentAt', '==', null)
      .get();
    if (snap.empty) return null;
    const materials = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    materials.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    return materials[0];
  } catch (error) {
    console.error('未送付資料の取得失敗（続行）:', error.message);
    return null;
  }
}

/**
 * @param {{admin: import('firebase-admin'), db: FirebaseFirestore.Firestore}} deps
 */
function createTldvRouter({ admin, db }) {
  const router = express.Router();

  router.post('/webhook', async (req, res) => {
    // Webhook認証（secret未設定時はfail-closed=拒否）
    // tl;dv側の認証UIが「Header Config」か「APIキー」かで実際に送られてくる
    // ヘッダー名・値が変わりうるため、TLDV_WEBHOOK_SECRET/TLDV_API_KEYの
    // どちらか、x-webhook-secret/x-api-key/Authorizationのどれかに一致すれば許可する
    const webhookSecret = env('TLDV_WEBHOOK_SECRET') ? normalizeSecret(env('TLDV_WEBHOOK_SECRET')) : null;
    const apiKeySecret = env('TLDV_API_KEY') ? normalizeSecret(env('TLDV_API_KEY')) : null;
    if (!webhookSecret && !apiKeySecret) {
      console.error('TLDV_WEBHOOK_SECRET / TLDV_API_KEY が未設定のため拒否');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }
    const provided = extractProvidedSecret(req);
    if (!provided || (provided !== webhookSecret && provided !== apiKeySecret)) {
      // 値は出さずヘッダー名のみ記録（原因切り分け用の一時ログ）
      console.error('tl;dv Webhook認証失敗. 受信ヘッダー一覧:', Object.keys(req.headers));
      console.error('extractProvidedSecretの取得結果の有無:', provided ? `値あり(長さ${provided.length})` : 'なし');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const { event, data } = req.body || {};
      if (!data || !(data.id || data.meetingId)) {
        return res.status(400).json({ error: 'invalid payload' });
      }
      if (event !== 'MeetingReady' && event !== 'TranscriptReady') {
        return res.status(200).json({ ignored: true });
      }

      const meetingId = data.meetingId || data.id;
      const apiKey = env('TLDV_API_KEY');
      if (!apiKey) {
        console.error('TLDV_API_KEY が未設定');
        return res.status(500).json({ error: 'tl;dv API key not configured' });
      }

      // 決定的ドキュメントID（meetingId）を使い、Webhook再送時に重複作成しない
      const meetingRef = db.collection('meetings').doc(meetingId);
      const existingSnap = await meetingRef.get();
      const existing = existingSnap.exists ? existingSnap.data() : null;

      // 議事録本文（MeetingReady直後はまだ無いことがある。都度REST APIから最新を取得）
      const transcriptText = await fetchTranscriptText(meetingId, apiKey);
      const finalTranscript = transcriptText || existing?.transcript || '';

      // メタデータ：TranscriptReadyのWebhook本文には主催者・参加者・タイトル等が
      // 含まれないため、REST APIの結果を主として使い、Webhook本文で補完する
      // （conferenceId等ドキュメント外のフィールドが返る可能性に賭けて両方見る）
      const restInfo = await fetchMeetingInfo(meetingId, apiKey);
      const organizer = restInfo.organizer || data.organizer || {};
      const invitees = Array.isArray(restInfo.invitees) ? restInfo.invitees : (Array.isArray(data.invitees) ? data.invitees : []);
      const title = restInfo.name || data.name || existing?.title || '';
      const happenedAt = restInfo.happenedAt || data.happenedAt || existing?.happenedAt || null;
      const recordingUrl = restInfo.url || data.url || existing?.recordingUrl || null;
      const conferenceId = restInfo.extraProperties?.conferenceId || data.extraProperties?.conferenceId || null;

      const meetUrl = normalizeMeetUrl(conferenceId) || existing?.meetUrl || null;

      // 要約はtl;dv自身のAI機能（notes）を第一ソースにする（OpenAIの課金状態に依存しない）。
      // OpenAIはネクストアクションの構造化抽出（担当・期日付き）専用に使う。
      const tldvNotesSummary = await fetchMeetingNotesSummary(meetingId, apiKey);

      const openaiKey = env('OPENAI_API_KEY');
      const aiResult = (openaiKey && finalTranscript.length > 10)
        ? await analyzeMeeting(openaiKey, title, finalTranscript)
        : { summary: '', nextActions: existing?.aiNextActions || [], meetingType: existing?.aiMeetingType || 'その他', relatedService: existing?.aiRelatedService || null };

      // tl;dv notes > OpenAI要約 > 既存値 の優先順で採用
      aiResult.summary = tldvNotesSummary || aiResult.summary || existing?.aiSummary || '';

      // 案件紐付け：Meet URLは案件（商材）単位ではなく会社（クライアント）単位で登録される
      // （clientMeetingSettings.companyName）。一致した会社の「全ての」案件（商材）に紐付ける
      // （1つのMTGで複数商材が同時に話されるケースがあるため、1件に絞らない）。
      // 参加者の所属ドメインは見ない。URLが一致する＝その会社のMTGとして明示登録済み
      // ということなので、それだけで判断する。一致しなければ記録するだけで何もしない
      // （紐付かなかったことを通知したり特別扱いしたりしない）
      let dealIds = existing?.dealIds || [];
      let linkStatus = existing?.linkStatus || 'none';
      let matchReason = existing?.matchReason || null;

      if (dealIds.length === 0 && meetUrl) {
        const clientSnap = await db.collection('clientMeetingSettings')
          .where('meetUrl', '==', meetUrl)
          .limit(1)
          .get();
        if (!clientSnap.empty) {
          const companyName = clientSnap.docs[0].data().companyName;
          const dealsSnap = await db.collection('progressDashboard')
            .where('companyName', '==', companyName)
            .get();
          if (!dealsSnap.empty) {
            dealIds = dealsSnap.docs.map((d) => d.id);
            linkStatus = 'auto';
            matchReason = 'meetUrl';
          }
        }
      }

      const isFirstTimeWithTranscript = finalTranscript && !existing?.transcript;

      // お礼メッセージの下書き：紐付いた・社内のみの参加者でない・まだ下書きしていない、
      // の全てを満たす時だけ生成する。社内判定はこの機能専用のロジックで、
      // 案件紐付け自体の判定（URL一致のみ）には使わない
      const allEmails = [organizer.email, ...invitees.map((i) => i.email)].filter(Boolean);
      const allInternal = allEmails.length > 0 && allEmails.every((e) => e.toLowerCase().endsWith('@senjinholdings.com'));

      let thankYouDraft = existing?.thankYouDraft || null;
      let thankYouStatus = existing?.thankYouStatus || null;
      let thankYouMaterialId = existing?.thankYouMaterialId || null;

      // お礼メッセージのデフォルトは固定テンプレート（OpenAIは呼ばない＝コスト0）。
      // 担当者がSlackの「指示して再生成」からトークンを使う判断をした時だけ、
      // 議事録全文＋指示を踏まえてAIに書き直させる（functions/slackApproval.js側で実施）
      const shouldDraftThankYou = dealIds.length > 0 && !allInternal && finalTranscript &&
        (isFirstTimeWithTranscript || event === 'TranscriptReady') &&
        !thankYouStatus;

      if (shouldDraftThankYou) {
        // 資料は複数案件に紐付いていても代表して1件目の案件のものを使う
        // （1つのMTGで複数商材が話される場合でも、送るお礼メッセージは1通のため）
        const material = await pickUnsentMaterial(db, dealIds[0]);
        thankYouMaterialId = material ? material.id : null;

        // 相手の担当者へのメンション（Chatworkの[To:accountId]タグ）。複数人選べるため
        // 選んだ順に並べる。承認DMの時点で最終形の文面を見せたいので、送信直前ではなく
        // ここで組み立てる
        let mentionPrefix = '';
        try {
          const settingsSnap = await db.collection('clientMeetingSettings')
            .where('meetUrl', '==', meetUrl)
            .limit(1)
            .get();
          if (!settingsSnap.empty) {
            const settings = settingsSnap.docs[0].data();
            const mentions = Array.isArray(settings.chatworkMentions) ? settings.chatworkMentions : [];
            mentionPrefix = mentions
              .map((m) => `[To:${m.accountId}]${m.name || ''}さん`)
              .join('\n');
            if (mentionPrefix) mentionPrefix += '\n';
          }
        } catch (error) {
          console.error('メンション先取得失敗（続行）:', error.message);
        }

        const bodyTemplate = material
          ? `本日はお時間をいただきありがとうございました。\n以下の資料をお送りいたしますのでご確認ください。\n${material.url}`
          : '本日はお時間をいただきありがとうございました。今後ともよろしくお願いいたします。';

        thankYouDraft = mentionPrefix + bodyTemplate;
        thankYouStatus = 'draft';
      }

      await meetingRef.set({
        tldvMeetingId: meetingId,
        title,
        happenedAt,
        durationSec: restInfo.duration || data.duration || existing?.durationSec || null,
        recordingUrl,
        organizerEmail: organizer.email || null,
        organizerName: organizer.name || null,
        invitees: invitees.map((i) => ({ name: i.name || null, email: i.email || null })),
        meetUrl,
        dealIds,
        linkStatus,
        matchReason,
        transcript: finalTranscript,
        aiSummary: aiResult.summary || '',
        aiNextActions: aiResult.nextActions || [],
        aiMeetingType: aiResult.meetingType || 'その他',
        aiRelatedService: aiResult.relatedService || null,
        thankYouDraft,
        thankYouStatus,
        thankYouMaterialId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(existingSnap.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() })
      }, { merge: true });

      // 紐付いた案件ごとに、本文の分析結果があるときだけNAを自動生成
      // （AIはMTG全体から1つの要約・アクション一覧しか抽出しないため、同じ内容を
      //   該当する全案件に適用する。関係ないNAが混じる場合は営業が手動で削除する運用）
      if (dealIds.length > 0 && finalTranscript && (isFirstTimeWithTranscript || event === 'TranscriptReady')) {
        await Promise.all(dealIds.map((dealId) =>
          applyToDeal({ admin, db, dealId, meetingId, aiResult })
        ));
      }

      // お礼メッセージの下書きができたら、担当者のSlackに承認依頼DMを送る
      if (shouldDraftThankYou) {
        await sendApprovalRequest({ db, dealId: dealIds[0], meetingId, draftText: thankYouDraft }).catch((error) => {
          console.error('お礼メッセージ承認通知エラー（続行）:', error.message);
        });
      }

      return res.status(200).json({ success: true, dealIds, linkStatus });
    } catch (error) {
      console.error('tl;dv webhook処理エラー:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = createTldvRouter;
