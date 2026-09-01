/**
 * tl;dv連携ルーター
 * - tl;dvのネイティブWebhook（MeetingReady/TranscriptReady）を受信
 * - 議事録全文・AI要約・ネクストアクションを`meetings`コレクションに永続化
 * - 案件のMeet URL（progressDashboard.linkedMeetUrls）と照合して自動紐付け
 * - 紐付いた案件のNA（entries）を自動生成
 * - Slackに結果を通知（手動の案件選択UIは持たない）
 */

const express = require('express');
const fetch = require('node-fetch');
const OpenAI = require('openai');
const { WebClient } = require('@slack/web-api');

const TLDV_API_BASE = 'https://pasta.tldv.io/v1alpha1';
const SLACK_CHANNEL = '#営業_議事録';

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
 * 前後の空白除去＋全角英数字を半角に変換する（IME経由のコピペでの誤変換対策）。
 * 長さは一致するのに文字コードが違う、という事故を吸収する。
 */
function normalizeSecret(str) {
  return String(str)
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
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

  batch.update(dealRef, {
    lastContactDate: new Date().toISOString().split('T')[0],
    ...(aiResult.summary ? { summary: aiResult.summary } : {})
  });

  await batch.commit();
}

async function notifySlack({ linkStatus, dealIds, title }) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || linkStatus === 'internal') return; // 社内MTGは通知しない

  const slack = new WebClient(token);
  let text;
  if (linkStatus === 'auto' && dealIds?.length > 0) {
    const links = dealIds
      .map((id) => `https://sales-management-staging.web.app/product/${id}`)
      .join('\n');
    text = `📹 議事録を登録しました: ${title}\n${dealIds.length}件の案件に自動で紐付けました。\n${links}`;
  } else {
    text = `📹 議事録を登録しました: ${title}\n案件には自動で紐付きませんでした（案件詳細にMTG URLの登録が必要です）。`;
  }

  try {
    await slack.chat.postMessage({ channel: SLACK_CHANNEL, text });
  } catch (error) {
    console.error('Slack通知失敗（続行）:', error.message);
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
    const webhookSecret = process.env.TLDV_WEBHOOK_SECRET ? normalizeSecret(process.env.TLDV_WEBHOOK_SECRET) : null;
    const apiKeySecret = process.env.TLDV_API_KEY ? normalizeSecret(process.env.TLDV_API_KEY) : null;
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
      const apiKey = process.env.TLDV_API_KEY;
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

      const allEmails = [organizer.email, ...invitees.map((i) => i.email)].filter(Boolean);
      const allInternal = allEmails.length > 0 && allEmails.every((e) => e.toLowerCase().endsWith('@senjinholdings.com'));

      const meetUrl = normalizeMeetUrl(conferenceId) || existing?.meetUrl || null;

      // AI分析は本文が取れている時だけ実行（無駄なAPI呼び出しを避ける）
      const openaiKey = process.env.OPENAI_API_KEY;
      const aiResult = (openaiKey && finalTranscript.length > 10)
        ? await analyzeMeeting(openaiKey, title, finalTranscript)
        : { summary: existing?.aiSummary || '', nextActions: existing?.aiNextActions || [], meetingType: existing?.aiMeetingType || 'その他', relatedService: existing?.aiRelatedService || null };

      // 案件紐付け：社内のみのMTGは対象外。Meet URLが登録されている「全ての」案件に紐付ける
      // （1つのMTGで複数案件・複数サービスが同時に話されるケースがあるため、1件に絞らない）
      let dealIds = existing?.dealIds || [];
      let linkStatus = existing?.linkStatus || 'none';
      let matchReason = existing?.matchReason || null;

      if (allInternal) {
        linkStatus = 'internal';
      } else if (dealIds.length === 0 && meetUrl) {
        const dealsSnap = await db.collection('progressDashboard')
          .where('linkedMeetUrls', 'array-contains', meetUrl)
          .get();
        if (!dealsSnap.empty) {
          dealIds = dealsSnap.docs.map((d) => d.id);
          linkStatus = 'auto';
          matchReason = 'meetUrl';
        }
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(existingSnap.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() })
      }, { merge: true });

      // 紐付いた案件ごとに、本文の分析結果があるときだけNAを自動生成
      // （AIはMTG全体から1つの要約・アクション一覧しか抽出しないため、同じ内容を
      //   該当する全案件に適用する。関係ないNAが混じる場合は営業が手動で削除する運用）
      const isFirstTimeWithTranscript = finalTranscript && !existing?.transcript;
      if (dealIds.length > 0 && finalTranscript && (isFirstTimeWithTranscript || event === 'TranscriptReady')) {
        await Promise.all(dealIds.map((dealId) =>
          applyToDeal({ admin, db, dealId, meetingId, aiResult })
        ));
      }

      // 初回のみSlack通知（同じMTGへの再送で毎回通知しない）
      if (!existingSnap.exists || (isFirstTimeWithTranscript)) {
        await notifySlack({ linkStatus, dealIds, title });
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
