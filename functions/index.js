/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const functions = require('firebase-functions/v1');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { WebClient } = require('@slack/web-api');
const OpenAI = require('openai');
const fetch = require('node-fetch');
const crypto = require('crypto');

// Firebase Admin SDK初期化
admin.initializeApp();
const db = admin.firestore();

// Express アプリケーションを作成
const app = express();

// CORS を設定
app.use(cors({
  origin: true, // すべてのオリジンを許可（本番では制限すべき）
  credentials: true
}));

// JSONパースを有効化
app.use(express.json());

// Firestoreコレクション参照
const actionLogsRef = db.collection('actionLogs');
const dealsRef = db.collection('deals');

// ヘルスチェックエンドポイント
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    message: 'Firebase Functions API with Firestore is running'
  });
});

// アクションログ一覧取得
app.get('/api/action-logs', async (req, res) => {
  try {
    const { dealId, productName, page = 1, limit = 50 } = req.query;
    
    console.log('🔍 アクションログ取得リクエスト:', { dealId, productName, page, limit });
    
    let query = actionLogsRef.orderBy('createdAt', 'desc');
    let totalQuery = actionLogsRef;
    
    // 案件IDまたは商材名でフィルタリング
    if (dealId) {
      console.log('📋 dealIdでフィルタリング:', dealId);
      query = query.where('dealId', '==', dealId);
      totalQuery = totalQuery.where('dealId', '==', dealId);
    } else if (productName) {
      console.log('📝 productNameでフィルタリング:', productName);
      query = query.where('productName', '==', productName);
      totalQuery = totalQuery.where('productName', '==', productName);
    }
    
    // ページネーション
    const offset = (parseInt(page) - 1) * parseInt(limit);
    if (offset > 0) {
      query = query.offset(offset);
    }
    query = query.limit(parseInt(limit));
    
    const snapshot = await query.get();
    const actionLogs = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      actionLogs.push({
        id: doc.id,
        ...data,
        // Timestamp型をISO文字列に変換
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
        nextActionDate: data.nextActionDate || null
      });
    });
    
    // 総件数取得
    const totalSnapshot = await totalQuery.get();
    
    console.log('✅ アクションログ取得成功:', {
      取得件数: actionLogs.length,
      総件数: totalSnapshot.size,
      フィルター条件: { dealId, productName }
    });
    
    res.json({
      actionLogs,
      total: totalSnapshot.size,
      page: parseInt(page),
      limit: parseInt(limit),
      filters: { dealId, productName }
    });
  } catch (error) {
    console.error('💥 アクションログ取得エラー:', error);
    res.status(500).json({ 
      error: 'アクションログの取得に失敗しました',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// アクションログ新規作成
app.post('/api/action-logs', async (req, res) => {
  try {
    const {
      dealId,
      action,
      description,
      status,
      nextAction,
      nextActionDate,
      productName,
      proposalMenu,
      representative,
      introducer
    } = req.body;
    
    // バリデーション
    if (!dealId || !action || !description) {
      return res.status(400).json({ 
        error: '必須フィールドが不足しています (dealId, action, description)' 
      });
    }
    
    // LogEntryPageから送信されたデータの処理
    const processedProductName = productName || dealId;
    const processedProposalMenu = proposalMenu || '';
    
    // 商材名＋提案メニューをキーとして案件を検索
    const dealKey = `${processedProductName}_${processedProposalMenu}`;
    
    // 案件コレクション参照
    const progressRef = db.collection('progressDashboard');
    
    // 既存案件をチェック
    const existingDealQuery = await progressRef
      .where('productName', '==', processedProductName)
      .where('proposalMenu', '==', processedProposalMenu)
      .limit(1)
      .get();
    
    let dealDocId = null;
    
    if (existingDealQuery.empty) {
      // 新規案件として進捗一覧に追加
      console.log('新規案件を作成:', dealKey);
      
      const newDeal = {
        productName: processedProductName,
        proposalMenu: processedProposalMenu,
        representative: representative || '',
        introducer: introducer || '',
        status: status || 'アポ設定',
        lastContactDate: admin.firestore.FieldValue.serverTimestamp(),
        nextAction: nextAction || '',
        nextActionDate: nextActionDate || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      const dealDocRef = await progressRef.add(newDeal);
      dealDocId = dealDocRef.id;
    } else {
      // 既存案件を更新
      const existingDeal = existingDealQuery.docs[0];
      dealDocId = existingDeal.id;
      
      await progressRef.doc(dealDocId).update({
        status: status || existingDeal.data().status,
        lastContactDate: admin.firestore.FieldValue.serverTimestamp(),
        nextAction: nextAction || existingDeal.data().nextAction,
        nextActionDate: nextActionDate || existingDeal.data().nextActionDate,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    // アクションログを作成
    const newLog = {
      dealId: dealDocId,
      dealKey: dealKey,
      productName: processedProductName,
      proposalMenu: processedProposalMenu,
      action,
      description,
      status: status || 'progress',
      nextAction: nextAction || '',
      nextActionDate: nextActionDate || null,
      representative: representative || '',
      introducer: introducer || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const docRef = await actionLogsRef.add(newLog);
    
    // 作成されたドキュメントを取得
    const createdDoc = await docRef.get();
    const responseData = {
      id: docRef.id,
      ...createdDoc.data(),
      createdAt: createdDoc.data().createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      updatedAt: createdDoc.data().updatedAt?.toDate?.()?.toISOString() || new Date().toISOString()
    };
    
    res.status(201).json({
      message: 'アクションログが作成されました',
      actionLog: responseData,
      dealId: dealDocId
    });
  } catch (error) {
    console.error('アクションログ作成エラー:', error);
    res.status(500).json({ error: 'アクションログの作成に失敗しました' });
  }
});

// アクションログ更新
app.put('/api/action-logs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {
      ...req.body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await actionLogsRef.doc(id).update(updateData);
    
    const updatedDoc = await actionLogsRef.doc(id).get();
    const responseData = {
      id: updatedDoc.id,
      ...updatedDoc.data(),
      createdAt: updatedDoc.data().createdAt?.toDate?.()?.toISOString(),
      updatedAt: updatedDoc.data().updatedAt?.toDate?.()?.toISOString()
    };
    
    res.json({
      message: 'アクションログが更新されました',
      actionLog: responseData
    });
  } catch (error) {
    console.error('アクションログ更新エラー:', error);
    res.status(500).json({ error: 'アクションログの更新に失敗しました' });
  }
});

// アクションログ削除
app.delete('/api/action-logs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await actionLogsRef.doc(id).delete();
    
    res.json({
      message: 'アクションログが削除されました',
      id
    });
  } catch (error) {
    console.error('アクションログ削除エラー:', error);
    res.status(500).json({ error: 'アクションログの削除に失敗しました' });
  }
});

// 案件一覧取得
app.get('/api/deals', async (req, res) => {
  try {
    const snapshot = await dealsRef.get();
    const deals = [];
    
    snapshot.forEach(doc => {
      deals.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({ deals });
  } catch (error) {
    console.error('案件取得エラー:', error);
    res.status(500).json({ error: '案件の取得に失敗しました' });
  }
});

// 進捗一覧取得
app.get('/api/progress-dashboard', async (req, res) => {
  try {
    console.log('📊 進捗一覧取得リクエスト');
    
    const progressRef = db.collection('progressDashboard');
    const snapshot = await progressRef.orderBy('updatedAt', 'desc').get();
    
    const progressItems = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      progressItems.push({
        id: doc.id,
        ...data,
        // 日付フィールドの統一処理
        lastContactDate: data.lastContactDate?.toDate?.()?.toLocaleDateString('ja-JP') || 
                        data.lastContactDate || null,
        nextActionDate: data.nextActionDate || null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null
      });
    });
    
    console.log('✅ 進捗一覧取得成功:', {
      取得件数: progressItems.length,
      最初の案件ID: progressItems[0]?.id || 'なし'
    });
    
    res.json({ 
      progressItems,
      total: progressItems.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('💥 進捗一覧取得エラー:', error);
    res.status(500).json({ 
      error: '進捗一覧の取得に失敗しました',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 案件削除（進捗一覧から）
app.delete('/api/progress-dashboard/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 削除対象の案件情報を取得
    const progressRef = db.collection('progressDashboard');
    const docSnapshot = await progressRef.doc(id).get();
    
    if (!docSnapshot.exists) {
      return res.status(404).json({ error: '案件が見つかりません' });
    }
    
    const dealData = docSnapshot.data();
    const { productName, proposalMenu } = dealData;
    
    // 案件を削除
    await progressRef.doc(id).delete();
    
    // 削除ログを作成
    const deleteLog = {
      dealId: id,
      dealKey: `${productName}_${proposalMenu}`,
      productName,
      proposalMenu,
      action: '案件削除',
      description: `${productName}（${proposalMenu}）を${new Date().toLocaleDateString('ja-JP')}に削除しました`,
      status: 'deleted',
      isDeleted: true,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await actionLogsRef.add(deleteLog);
    
    res.json({
      message: '案件が削除されました',
      id,
      deletedDeal: {
        productName,
        proposalMenu
      }
    });
  } catch (error) {
    console.error('案件削除エラー:', error);
    res.status(500).json({ error: '案件の削除に失敗しました' });
  }
});

// ============================================
// tl;dv MTG → ネクストアクション自動連携
// ============================================

// URLデコード（Slack interactionはx-www-form-urlencodedで来る）
app.use('/api/slack-interaction', express.urlencoded({ extended: true }));

/**
 * receiveTldv: Zapierからtl;dvのノートデータを受信し、AI分析してSlack通知
 */
app.post('/api/receive-tldv', async (req, res) => {
  // Webhook認証（secret未設定時はfail-closed=拒否。設定漏れで無認証のまま公開されるのを防ぐ）
  const webhookSecret = process.env.TLDV_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('TLDV_WEBHOOK_SECRET が未設定のため拒否');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }
  if (req.headers['x-webhook-secret'] !== webhookSecret) {
    console.error('Webhook認証失敗');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { noteText, meetingTitle, meetingLink, meetingDate, participants } = req.body;

    if (!noteText && !meetingTitle) {
      return res.status(400).json({ error: 'noteText or meetingTitle is required' });
    }

    const textToAnalyze = noteText || meetingTitle || '';
    console.log('📝 tl;dvデータ受信:', { meetingTitle, textLength: textToAnalyze.length });

    // 1. AI分析（ネクストアクション抽出）
    let aiResult = {
      summary: meetingTitle || 'MTG内容',
      nextActions: [],
      meetingType: 'その他',
      relatedService: null
    };

    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey && textToAnalyze.length > 10) {
      try {
        const openai = new OpenAI({ apiKey: openaiKey });
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

MTGタイトル: ${meetingTitle || '不明'}
参加者: ${participants || '不明'}
議事録:
${textToAnalyze}`
            }
          ],
          max_tokens: 1000,
          temperature: 0.3
        });

        const content = completion.choices[0]?.message?.content || '';
        // JSON部分を抽出（```json ... ``` 形式にも対応）
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiResult = JSON.parse(jsonMatch[0]);
        }
        console.log('🤖 AI分析完了:', aiResult);
      } catch (aiError) {
        console.error('AI分析エラー（続行）:', aiError.message);
      }
    }

    // 2. Firestoreから既存案件を取得し、マッチングスコアで並び替え
    const progressRef = db.collection('progressDashboard');
    const dealsSnapshot = await progressRef.get();

    const allDeals = [];
    const titleLower = (meetingTitle || '').toLowerCase();
    const noteTextLower = (textToAnalyze || '').toLowerCase();
    const aiService = (aiResult.relatedService || '').toLowerCase();

    dealsSnapshot.forEach(doc => {
      const deal = { id: doc.id, ...doc.data() };
      // 失注案件は除外
      if (deal.status === '失注') return;

      const companyName = (deal.companyName || '').toLowerCase();
      const productName = (deal.productName || '').toLowerCase();
      const proposalMenu = (deal.proposalMenu || '').toLowerCase();

      // マッチングスコア計算
      let score = 0;
      // 会社名がMTGタイトルに含まれる（最も強い一致）
      if (companyName && companyName.length > 1 && titleLower.includes(companyName)) score += 10;
      // 商材名がMTGタイトルに含まれる
      if (productName && productName.length > 1 && titleLower.includes(productName)) score += 8;
      // 会社名・商材名が議事録本文に含まれる
      if (companyName && companyName.length > 1 && noteTextLower.includes(companyName)) score += 5;
      if (productName && productName.length > 1 && noteTextLower.includes(productName)) score += 3;
      // サービス名（提案メニュー）がAI推定と一致
      if (aiService && proposalMenu && proposalMenu.includes(aiService)) score += 6;
      // サービス名がMTGタイトルに含まれる
      if (proposalMenu && proposalMenu.length > 1 && titleLower.includes(proposalMenu)) score += 4;

      deal._score = score;
      allDeals.push(deal);
    });

    // スコア降順 → 更新日降順でソート
    allDeals.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      const aDate = a.updatedAt?.toDate?.() || new Date(0);
      const bDate = b.updatedAt?.toDate?.() || new Date(0);
      return bDate - aDate;
    });

    const bestMatch = allDeals.length > 0 && allDeals[0]._score > 0 ? allDeals[0] : null;
    console.log('🔍 案件数:', allDeals.length, '件, ベストマッチ:', bestMatch?.companyName || bestMatch?.productName || 'なし', '(スコア:', bestMatch?._score || 0, ')');

    // 3. Slack通知送信
    const slackToken = process.env.SLACK_BOT_TOKEN;
    const slackChannel = process.env.SLACK_CHANNEL || '#mtg-actions';

    if (!slackToken) {
      console.error('Slack Bot Token未設定');
      return res.status(500).json({ error: 'Slack Bot Token not configured' });
    }

    const slack = new WebClient(slackToken);

    // ミーティングデータをJSON化してボタンのvalueに含める
    const meetingData = {
      title: meetingTitle || '不明なMTG',
      date: meetingDate || new Date().toISOString().split('T')[0],
      link: meetingLink || '',
      noteText: textToAnalyze.substring(0, 2000), // Slack制限考慮
      summary: aiResult.summary || '',
      nextActions: aiResult.nextActions || [],
      relatedService: aiResult.relatedService || null,
      meetingType: aiResult.meetingType || 'その他'
    };

    // meetingDataをFirestoreに一時保存（Slackボタンのvalue上限対策）
    const tempRef = db.collection('tempMeetingData');
    const tempDoc = await tempRef.add({
      ...meetingData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24時間後に期限切れ
    });
    const meetingDataId = tempDoc.id;

    // Block Kit メッセージ構築
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📹 MTG記録: ${meetingData.title}`
        }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*日時:* ${meetingData.date}` },
          { type: 'mrkdwn', text: `*種類:* ${aiResult.meetingType}` }
        ]
      }
    ];

    // AI要約
    if (aiResult.summary) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*AI要約:*\n${aiResult.summary}` }
      });
    }

    // ネクストアクション一覧
    if (aiResult.nextActions && aiResult.nextActions.length > 0) {
      const actionsText = aiResult.nextActions
        .map((a, i) => `${i + 1}. ${a.content}（${a.owner || '未定'}${a.deadline ? ' / ' + a.deadline : ''}）`)
        .join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*ネクストアクション:*\n${actionsText}` }
      });
    }

    // 録画リンク
    if (meetingLink) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `<${meetingLink}|🎥 録画を見る>` }
      });
    }

    blocks.push({ type: 'divider' });

    // 既存案件プルダウン（スコア順、ベストマッチを自動選択）
    if (allDeals.length > 0) {
      // Slack static_selectは最大100件
      const dealOptions = allDeals.slice(0, 100).map(deal => {
        const label = `${deal.companyName || deal.productName || '不明'}｜${deal.proposalMenu || '未設定'}｜${deal.status || ''}`;
        return {
          text: {
            type: 'plain_text',
            text: label.substring(0, 75) // Slack制限75文字
          },
          value: JSON.stringify({ action: 'existing_deal', dealId: deal.id, meetingDataId })
        };
      });

      const selectElement = {
        type: 'static_select',
        placeholder: { type: 'plain_text', text: '既存案件を選択...' },
        options: dealOptions,
        action_id: 'select_deal'
      };

      // ベストマッチがあれば自動選択
      if (bestMatch) {
        selectElement.initial_option = dealOptions[0]; // スコア最高の案件
      }

      blocks.push({
        type: 'section',
        block_id: 'deal_select_block',
        text: { type: 'mrkdwn', text: bestMatch ? `*🔍 既存案件に登録:* （自動マッチ: スコア${bestMatch._score}）` : '*🔍 既存案件に登録:*' },
        accessory: selectElement
      });

      // 選択確定ボタン
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '選択した案件に登録' },
            style: 'primary',
            value: JSON.stringify({ action: 'confirm_deal', meetingDataId }),
            action_id: 'confirm_deal'
          }
        ]
      });

      blocks.push({ type: 'divider' });
    }

    // 新規案件として登録（サービス選択）
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*新規案件として登録:*' }
    });

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '第一想起取れるくん' },
          value: JSON.stringify({ action: 'new_service', service: '第一想起取れるくん', meetingDataId }),
          action_id: 'service_daiichi'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '獲得とれるくん' },
          value: JSON.stringify({ action: 'new_service', service: '獲得とれるくん', meetingDataId }),
          action_id: 'service_kakutoku'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'インハウスクラウド' },
          value: JSON.stringify({ action: 'new_service', service: 'インハウスクラウド', meetingDataId }),
          action_id: 'service_inhouse'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '対象外（スキップ）' },
          value: JSON.stringify({ action: 'skip', meetingDataId }),
          action_id: 'skip'
        }
      ]
    });

    await slack.chat.postMessage({
      channel: slackChannel,
      text: `📹 MTG記録: ${meetingData.title}`,
      blocks
    });

    console.log('✅ Slack通知送信完了');
    return res.status(200).json({ success: true, meetingDataId });

  } catch (error) {
    console.error('💥 receiveTldvエラー:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * slackEvents: Slack Events API（tl;dvのSlack投稿を検知）
 */
app.post('/api/slack-events', async (req, res) => {
  // URL verification（初回設定時）
  if (req.body.type === 'url_verification') {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // 即座に200を返す（3秒ルール）→ 処理はその後
  res.status(200).send('');

  try {
    const event = req.body.event;
    if (!event || event.type !== 'message') return;

    // ボットのメッセージ or Zapier構造化メッセージのみ処理
    const msgText = event.text || '';
    const isZapierFormat = msgText.includes('【tl;dv MTG記録】') || msgText.includes('【tl;dv');
    if (!event.bot_id && !event.bot_profile && !isZapierFormat) return;

    // 自分自身のボットのメッセージは無視（名前やテキストで判定）
    const botName = event.bot_profile?.name || '';
    if (botName === 'tldv議事録' || (event.text || '').includes('既存案件に登録') || (event.text || '').includes('新規案件として登録')) {
      console.log('⏭️ 自ボット投稿スキップ:', botName);
      return;
    }

    // 重複処理防止（event_idで確認）
    const eventId = req.body.event_id;
    if (eventId) {
      const dedupRef = db.collection('processedEvents');
      const existing = await dedupRef.doc(eventId).get();
      if (existing.exists) {
        console.log('⏭️ 重複イベントスキップ:', eventId);
        return;
      }
      await dedupRef.doc(eventId).set({
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
    }

    // メッセージからtl;dvの投稿を判定
    const text = event.text || '';
    const attachments = event.attachments || [];
    const blocks = event.blocks || [];

    // tl;dvのメッセージかどうかを判定（bot名、テキスト内容、リンクで判定）
    const isTldv = (event.bot_profile?.name || '').toLowerCase().includes('tl;dv') ||
                   (event.bot_profile?.name || '').toLowerCase().includes('tldv') ||
                   text.includes('tldv.io') ||
                   text.includes('tl;dv') ||
                   attachments.some(a => (a.text || '').includes('tldv.io') || (a.title || '').includes('tldv'));

    if (!isTldv) {
      console.log('⏭️ tl;dv以外のbot投稿をスキップ:', event.bot_profile?.name || 'unknown');
      return;
    }

    console.log('📹 tl;dv投稿を検知:', { bot: event.bot_profile?.name, textLength: text.length });

    // tl;dvのメッセージからデータ抽出
    let meetingTitle = '';
    let noteText = '';
    let meetingLink = '';
    let participants = '';

    // Zapier経由の構造化メッセージを検出（【tl;dv MTG記録】ヘッダー）
    const plainText = text.replace(/<([^|>]+)\|[^>]*>/g, '$1').replace(/<([^>]+)>/g, '$1');
    if (plainText.includes('【tl;dv MTG記録】') || plainText.includes('【tl;dv')) {
      // 構造化フォーマットをパース
      const lines = plainText.split('\n');
      let contentStarted = false;
      const contentLines = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('タイトル:') || trimmed.startsWith('タイトル：')) {
          meetingTitle = trimmed.replace(/^タイトル[:：]\s*/, '').trim();
        } else if (trimmed.startsWith('URL:') || trimmed.startsWith('URL：')) {
          meetingLink = trimmed.replace(/^URL[:：]\s*/, '').trim();
        } else if (trimmed.startsWith('参加者:') || trimmed.startsWith('参加者：')) {
          participants = trimmed.replace(/^参加者[:：]\s*/, '').trim();
        } else if (trimmed.startsWith('内容:') || trimmed.startsWith('内容：')) {
          contentStarted = true;
          const afterLabel = trimmed.replace(/^内容[:：]\s*/, '').trim();
          if (afterLabel) contentLines.push(afterLabel);
        } else if (contentStarted && trimmed) {
          contentLines.push(trimmed);
        }
      }

      if (contentLines.length > 0) noteText = contentLines.join('\n');
      console.log('📋 Zapier構造化メッセージを検出:', { meetingTitle, participants, noteTextLength: noteText.length });
    }

    // 構造化パースで取れなかった場合、従来のattachments/blocks抽出にフォールバック
    if (!meetingTitle || !noteText) {
      // attachmentsからデータ抽出
      for (const att of attachments) {
        if (att.title && !meetingTitle) meetingTitle = att.title;
        if (att.text && !noteText) noteText = att.text;
        if (att.title_link && att.title_link.includes('tldv.io') && !meetingLink) meetingLink = att.title_link;
      }

      // blocksからテキスト抽出
      for (const block of blocks) {
        if (block.type === 'rich_text') {
          for (const element of (block.elements || [])) {
            for (const item of (element.elements || [])) {
              if (item.type === 'text' && item.text) {
                if (!meetingTitle && item.style?.bold) meetingTitle = item.text;
                noteText += (noteText ? '\n' : '') + item.text;
              }
              if (item.type === 'link' && item.url?.includes('tldv.io')) {
                meetingLink = meetingLink || item.url;
              }
            }
          }
        }
        if (block.type === 'section' && block.text?.text) {
          noteText += (noteText ? '\n' : '') + block.text.text;
        }
      }
    }

    // テキスト本文からリンク抽出（フォールバック）
    if (!meetingLink) {
      const linkMatch = text.match(/<(https?:\/\/[^|>]*tldv\.io[^|>]*)(?:\|[^>]*)?>/) ||
                        text.match(/(https?:\/\/[^\s]*tldv\.io[^\s]*)/);
      if (linkMatch) meetingLink = linkMatch[1];
    }

    // 最終フォールバック
    if (!noteText) noteText = text;
    if (!meetingTitle) {
      meetingTitle = text.split('\n')[0].replace(/<[^>]+>/g, '').replace(/【.*?】/g, '').trim().substring(0, 100) || 'tl;dv MTG';
    }

    console.log('📝 抽出データ:', { meetingTitle, participants, noteTextLength: noteText.length, meetingLink });

    // 既存のreceiveTldvと同じ処理を呼び出す（内部HTTPリクエスト）
    // → 直接同じロジックを実行
    const textToAnalyze = noteText;

    // AI分析
    let aiResult = {
      summary: meetingTitle,
      nextActions: [],
      meetingType: 'その他',
      relatedService: null
    };

    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey && textToAnalyze.length > 10) {
      try {
        const openai = new OpenAI({ apiKey: openaiKey });
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

MTGタイトル: ${meetingTitle}
参加者: ${participants || '不明'}
議事録:
${textToAnalyze.substring(0, 3000)}`
            }
          ],
          max_tokens: 1000,
          temperature: 0.3
        });
        const content = completion.choices[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) aiResult = JSON.parse(jsonMatch[0]);
        console.log('🤖 AI分析完了');
      } catch (aiError) {
        console.error('AI分析エラー（続行）:', aiError.message);
      }
    }

    // 既存案件マッチング
    const progressRef = db.collection('progressDashboard');
    const dealsSnapshot = await progressRef.get();
    const allDeals = [];
    const titleLower = meetingTitle.toLowerCase();
    const noteTextLower = textToAnalyze.toLowerCase();
    const aiService = (aiResult.relatedService || '').toLowerCase();

    dealsSnapshot.forEach(doc => {
      const deal = { id: doc.id, ...doc.data() };
      if (deal.status === '失注') return;
      const companyName = (deal.companyName || '').toLowerCase();
      const productName = (deal.productName || '').toLowerCase();
      const proposalMenu = (deal.proposalMenu || '').toLowerCase();
      let score = 0;
      if (companyName && companyName.length > 1 && titleLower.includes(companyName)) score += 10;
      if (productName && productName.length > 1 && titleLower.includes(productName)) score += 8;
      if (companyName && companyName.length > 1 && noteTextLower.includes(companyName)) score += 5;
      if (productName && productName.length > 1 && noteTextLower.includes(productName)) score += 3;
      if (aiService && proposalMenu && proposalMenu.includes(aiService)) score += 6;
      if (proposalMenu && proposalMenu.length > 1 && titleLower.includes(proposalMenu)) score += 4;
      deal._score = score;
      allDeals.push(deal);
    });

    allDeals.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      const aDate = a.updatedAt?.toDate?.() || new Date(0);
      const bDate = b.updatedAt?.toDate?.() || new Date(0);
      return bDate - aDate;
    });

    const bestMatch = allDeals.length > 0 && allDeals[0]._score > 0 ? allDeals[0] : null;

    // Slack通知送信
    const slackToken = process.env.SLACK_BOT_TOKEN;
    const slackChannel = process.env.SLACK_CHANNEL_TLDV || '#営業_議事録';
    const slack = new WebClient(slackToken);

    const meetingData = {
      title: meetingTitle,
      date: new Date().toISOString().split('T')[0],
      link: meetingLink,
      noteText: textToAnalyze.substring(0, 2000),
      summary: aiResult.summary || '',
      nextActions: aiResult.nextActions || [],
      relatedService: aiResult.relatedService || null,
      meetingType: aiResult.meetingType || 'その他'
    };

    const tempRef = db.collection('tempMeetingData');
    const tempDoc = await tempRef.add({
      ...meetingData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
    const meetingDataId = tempDoc.id;

    // Block Kit メッセージ（receiveTldvと同じ構造）
    const msgBlocks = [
      { type: 'header', text: { type: 'plain_text', text: `📹 MTG記録: ${meetingData.title}` } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*日時:* ${meetingData.date}` },
        { type: 'mrkdwn', text: `*種類:* ${aiResult.meetingType}` }
      ]}
    ];

    if (aiResult.summary) {
      msgBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*AI要約:*\n${aiResult.summary}` } });
    }
    if (aiResult.nextActions?.length > 0) {
      const actionsText = aiResult.nextActions
        .map((a, i) => `${i + 1}. ${a.content}（${a.owner || '未定'}${a.deadline ? ' / ' + a.deadline : ''}）`)
        .join('\n');
      msgBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*ネクストアクション:*\n${actionsText}` } });
    }
    if (meetingLink) {
      msgBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `<${meetingLink}|🎥 録画を見る>` } });
    }

    msgBlocks.push({ type: 'divider' });

    if (allDeals.length > 0) {
      const dealOptions = allDeals.slice(0, 100).map(deal => {
        const label = `${deal.companyName || deal.productName || '不明'}｜${deal.proposalMenu || '未設定'}｜${deal.status || ''}`;
        return {
          text: { type: 'plain_text', text: label.substring(0, 75) },
          value: JSON.stringify({ action: 'existing_deal', dealId: deal.id, meetingDataId })
        };
      });
      const selectElement = {
        type: 'static_select',
        placeholder: { type: 'plain_text', text: '既存案件を選択...' },
        options: dealOptions,
        action_id: 'select_deal'
      };
      if (bestMatch) selectElement.initial_option = dealOptions[0];

      msgBlocks.push({
        type: 'section', block_id: 'deal_select_block',
        text: { type: 'mrkdwn', text: bestMatch ? `*🔍 既存案件に登録:* （自動マッチ: スコア${bestMatch._score}）` : '*🔍 既存案件に登録:*' },
        accessory: selectElement
      });
      msgBlocks.push({ type: 'actions', elements: [{
        type: 'button', text: { type: 'plain_text', text: '選択した案件に登録' },
        style: 'primary',
        value: JSON.stringify({ action: 'confirm_deal', meetingDataId }),
        action_id: 'confirm_deal'
      }]});
      msgBlocks.push({ type: 'divider' });
    }

    msgBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*新規案件として登録:*' } });
    msgBlocks.push({ type: 'actions', elements: [
      { type: 'button', text: { type: 'plain_text', text: '第一想起取れるくん' },
        value: JSON.stringify({ action: 'new_service', service: '第一想起取れるくん', meetingDataId }), action_id: 'service_daiichi' },
      { type: 'button', text: { type: 'plain_text', text: '獲得とれるくん' },
        value: JSON.stringify({ action: 'new_service', service: '獲得とれるくん', meetingDataId }), action_id: 'service_kakutoku' },
      { type: 'button', text: { type: 'plain_text', text: 'インハウスクラウド' },
        value: JSON.stringify({ action: 'new_service', service: 'インハウスクラウド', meetingDataId }), action_id: 'service_inhouse' },
      { type: 'button', text: { type: 'plain_text', text: '対象外（スキップ）' },
        value: JSON.stringify({ action: 'skip', meetingDataId }), action_id: 'skip' }
    ]});

    await slack.chat.postMessage({ channel: slackChannel, text: `📹 MTG記録: ${meetingData.title}`, blocks: msgBlocks });
    console.log('✅ tl;dv検知 → Slack通知送信完了');

  } catch (error) {
    console.error('💥 slackEventsエラー:', error);
  }
});

/**
 * slackInteraction: Slackボタンクリック処理 → Firestore書き込み
 */
app.post('/api/slack-interaction', async (req, res) => {
  // Slack署名検証（secret未設定時はfail-closed=拒否。設定漏れで無認証のまま公開されるのを防ぐ）
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error('SLACK_SIGNING_SECRET が未設定のため拒否');
    return res.status(500).send('Slack signing secret not configured');
  }
  {
    const timestamp = req.headers['x-slack-request-timestamp'];
    const slackSignature = req.headers['x-slack-signature'];
    const body = req.rawBody?.toString() || '';
    const baseString = `v0:${timestamp}:${body}`;
    const mySignature = 'v0=' + crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
    if (mySignature !== slackSignature) {
      console.error('Slack署名検証失敗');
      return res.status(401).send('Unauthorized');
    }
  }

  try {
    const payload = JSON.parse(req.body.payload);
    const slackToken = process.env.SLACK_BOT_TOKEN;
    const slack = new WebClient(slackToken);

    // === モーダル送信（view_submission）の処理 ===
    if (payload.type === 'view_submission') {
      const metadata = JSON.parse(payload.view.private_metadata || '{}');
      const values = payload.view.state.values;

      const companyName = values.company_name?.company_name_input?.value || '不明';
      const productName = values.product_name?.product_name_input?.value || companyName;
      const nextAction = values.next_action?.next_action_input?.value || '';
      const nextActionDate = values.next_action_date?.next_action_date_input?.selected_date || null;
      const today = new Date().toISOString().split('T')[0];

      const tempRef = db.collection('tempMeetingData');
      const tempDoc = await tempRef.doc(metadata.meetingDataId).get();
      if (!tempDoc.exists) {
        res.status(200).json({ response_action: 'clear' });
        return;
      }
      const meetingData = tempDoc.data();
      const progressRef = db.collection('progressDashboard');

      let dealLabel = '';

      if (metadata.action === 'existing_deal') {
        const dealDoc = await progressRef.doc(metadata.dealId).get();
        if (!dealDoc.exists) {
          res.status(200).json({ response_action: 'clear' });
          return;
        }
        const deal = dealDoc.data();
        const dealCompanyName = deal.companyName || deal.productName || '';
        const dealProductName = deal.productName || '';
        const dealProposalMenu = deal.proposalMenu || '';
        const dealLeadSource = deal.leadSource || '';
        dealLabel = `既存案件「${dealCompanyName}（${dealProposalMenu}）」に`;

        await actionLogsRef.add({
          dealId: metadata.dealId,
          dealKey: `${dealCompanyName}_${dealProductName}_${dealProposalMenu}_${dealLeadSource}`,
          companyName: dealCompanyName,
          productName: dealProductName,
          proposalMenu: dealProposalMenu,
          action: `${dealCompanyName} - ${dealProductName}`,
          description: meetingData.noteText || '',
          summary: meetingData.summary || '',
          status: deal.status || 'フェーズ2',
          nextAction, nextActionDate,
          actionDate: today,
          representative: deal.representative || '増田 陽',
          partnerRepresentative: deal.partnerRepresentative || '',
          leadSource: dealLeadSource,
          introducer: deal.introducer || '',
          sub_department_name: deal.sub_department_name || '',
          sub_department_owner: deal.sub_department_owner || '',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const updateFields = {
          lastContactDate: today,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        if (nextAction) updateFields.nextAction = nextAction;
        if (nextActionDate) updateFields.nextActionDate = nextActionDate;
        if (meetingData.summary) updateFields.summary = meetingData.summary;
        await progressRef.doc(metadata.dealId).update(updateFields);

      } else {
        // new_service / new_deal
        const proposalMenu = metadata.service || '';
        const serviceLabel = proposalMenu ? `（${proposalMenu}）` : '';
        dealLabel = `新規案件${serviceLabel}として`;
        const dealKey = `${companyName}_${productName}_${proposalMenu}_tl;dv`;

        const newDeal = {
          companyName, productName, proposalMenu,
          representative: '増田 陽', partnerRepresentative: '',
          leadSource: 'tl;dv', introducer: '',
          status: 'フェーズ2', expectedBudget: '',
          lastContactDate: today,
          nextAction, nextActionDate,
          summary: meetingData.summary || '',
          sub_department_name: '', sub_department_owner: '',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const dealRef = await progressRef.add(newDeal);

        await actionLogsRef.add({
          dealId: dealRef.id, dealKey,
          companyName, productName, proposalMenu,
          action: `${companyName} - ${productName}`,
          description: meetingData.noteText || '',
          summary: meetingData.summary || '',
          status: 'フェーズ2', nextAction, nextActionDate,
          actionDate: today,
          representative: '増田 陽', partnerRepresentative: '',
          leadSource: 'tl;dv', introducer: '',
          sub_department_name: '', sub_department_owner: '',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // 元メッセージ更新 & 一時データ削除
      if (metadata.responseUrl) {
        await updateSlackMessage(metadata.responseUrl,
          `✅ 「${meetingData.title}」を${dealLabel}登録しました。\n*会社名:* ${companyName}\n*商材名:* ${productName}\n*ネクストアクション:* ${nextAction || 'なし'}\n*期日:* ${nextActionDate || '未定'}`
        );
      }
      await tempRef.doc(metadata.meetingDataId).delete();
      console.log('✅ モーダル経由Firestore書き込み完了');

      // 登録完了画面をモーダルに表示
      res.status(200).json({
        response_action: 'update',
        view: {
          type: 'modal',
          callback_id: 'mtg_register_done',
          title: { type: 'plain_text', text: '登録完了' },
          close: { type: 'plain_text', text: '閉じる' },
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `✅ *登録が完了しました！*` }
            },
            { type: 'divider' },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*会社名:*\n${companyName}` },
                { type: 'mrkdwn', text: `*商材名:*\n${productName}` }
              ]
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*登録先:*\n${dealLabel.replace(/に$/, '').replace(/として$/, '')}` },
                { type: 'mrkdwn', text: `*期日:*\n${nextActionDate || '未定'}` }
              ]
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*ネクストアクション:*\n${nextAction || 'なし'}` }
            }
          ]
        }
      });
      return;
    }

    // === ボタン/プルダウン操作（block_actions）の処理 ===
    const action = payload.actions[0];
    const responseUrl = payload.response_url;
    const triggerId = payload.trigger_id;

    // プルダウン選択変更 → 何もしない
    if (action.action_id === 'select_deal') {
      res.status(200).send('');
      return;
    }

    // 確定ボタン → プルダウンの選択値を取得
    let actionData;
    if (action.action_id === 'confirm_deal') {
      const selectedDealValue = payload.state?.values?.deal_select_block?.select_deal?.selected_option?.value;
      if (!selectedDealValue) {
        res.status(200).send('');
        await updateSlackMessage(responseUrl, '⚠️ 案件が選択されていません。プルダウンから案件を選択してください。');
        return;
      }
      actionData = JSON.parse(selectedDealValue);
    } else {
      actionData = JSON.parse(action.value);
    }

    // 対象外 → 即スキップ（モーダル不要）
    if (actionData.action === 'skip') {
      res.status(200).send('');
      const tempRef = db.collection('tempMeetingData');
      const tempDoc = await tempRef.doc(actionData.meetingDataId).get();
      const title = tempDoc.exists ? tempDoc.data().title : 'MTG';
      await updateSlackMessage(responseUrl, `✅ 「${title}」を対象外としました。`);
      if (tempDoc.exists) await tempRef.doc(actionData.meetingDataId).delete();
      return;
    }

    // --- モーダルを開く → データ取得 → 更新 (レスポンスは最後に返す) ---
    const loadingView = await slack.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'mtg_register_modal',
        title: { type: 'plain_text', text: 'MTG記録を登録' },
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: '📝 *データを読み込み中...*' } }
        ]
      }
    });
    const viewId = loadingView.view.id;

    // Firestoreからデータ取得
    const tempRef = db.collection('tempMeetingData');
    const tempDoc = await tempRef.doc(actionData.meetingDataId).get();
    if (!tempDoc.exists) {
      await slack.views.update({
        view_id: viewId,
        view: {
          type: 'modal', callback_id: 'mtg_register_modal',
          title: { type: 'plain_text', text: 'エラー' },
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '⚠️ データの有効期限が切れています。' } }]
        }
      });
      res.status(200).send('');
      return;
    }
    const meetingData = tempDoc.data();

    // AI抽出データのデフォルト値
    const nextActionsText = (meetingData.nextActions || [])
      .map(a => a.content).join('\n') || '';
    const nextDeadline = (meetingData.nextActions || [])
      .map(a => a.deadline).filter(d => d).sort()[0] || null;

    // 会社名・商材名のデフォルト値
    let companyDefault = extractCompanyName(meetingData.title);
    let productNameDefault = companyDefault; // デフォルトは会社名と同じ
    const isExistingDeal = actionData.action === 'existing_deal';

    if (isExistingDeal) {
      const progressRef = db.collection('progressDashboard');
      const dealDoc = await progressRef.doc(actionData.dealId).get();
      if (dealDoc.exists) {
        companyDefault = dealDoc.data().companyName || dealDoc.data().productName || companyDefault;
        productNameDefault = dealDoc.data().productName || companyDefault;
      }
    }

    const metadata = {
      action: actionData.action,
      dealId: actionData.dealId || null,
      service: actionData.service || null,
      meetingDataId: actionData.meetingDataId,
      responseUrl: responseUrl
    };

    const actionLabel = isExistingDeal ? '既存案件に登録'
      : actionData.service ? `新規（${actionData.service}）` : '新規案件に登録';

    // モーダルのブロック構築
    const modalBlocks = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*MTG:* ${meetingData.title}\n*AI要約:* ${meetingData.summary || 'なし'}` }
      },
      { type: 'divider' },
      {
        type: 'input', block_id: 'company_name',
        label: { type: 'plain_text', text: '会社名' },
        element: {
          type: 'plain_text_input', action_id: 'company_name_input',
          initial_value: companyDefault
        }
      }
    ];

    // 新規案件の場合は商材名の入力欄を追加
    if (!isExistingDeal) {
      modalBlocks.push({
        type: 'input', block_id: 'product_name',
        label: { type: 'plain_text', text: '商材名' },
        element: {
          type: 'plain_text_input', action_id: 'product_name_input',
          initial_value: companyDefault,
          placeholder: { type: 'plain_text', text: '例: 株式会社ABC' }
        }
      });
    }

    modalBlocks.push(
      {
        type: 'input', block_id: 'next_action',
        label: { type: 'plain_text', text: 'ネクストアクション' },
        element: {
          type: 'plain_text_input', action_id: 'next_action_input',
          multiline: true, initial_value: nextActionsText
        },
        optional: true
      },
      {
        type: 'input', block_id: 'next_action_date',
        label: { type: 'plain_text', text: '期日' },
        element: {
          type: 'datepicker', action_id: 'next_action_date_input',
          ...(nextDeadline && /^\d{4}-\d{2}-\d{2}$/.test(nextDeadline) ? { initial_date: nextDeadline } : {})
        },
        optional: true
      }
    );

    // モーダルを実データで更新
    await slack.views.update({
      view_id: viewId,
      view: {
        type: 'modal',
        callback_id: 'mtg_register_modal',
        title: { type: 'plain_text', text: 'MTG記録を登録' },
        submit: { type: 'plain_text', text: actionLabel },
        close: { type: 'plain_text', text: 'キャンセル' },
        private_metadata: JSON.stringify(metadata),
        blocks: modalBlocks
      }
    });

    // 全ての処理が完了してからレスポンスを返す（Cloud Functions生存保証）
    res.status(200).send('');

  } catch (error) {
    console.error('💥 slackInteractionエラー:', error);
    if (!res.headersSent) res.status(200).send('');
    try {
      const payload = JSON.parse(req.body.payload);
      if (payload.response_url) {
        await updateSlackMessage(payload.response_url, `⚠️ エラーが発生しました: ${error.message}`);
      }
    } catch (e) {
      console.error('エラー通知も失敗:', e.message);
    }
  }
});

/**
 * Slackメッセージをresponse_urlで更新（ボタンを消して結果表示）
 */
async function updateSlackMessage(responseUrl, text) {
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      replace_original: true,
      text: text,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: text }
        }
      ]
    })
  });
}

/**
 * MTGタイトルから会社名を抽出するヘルパー
 * 例: "株式会社ABC様 サービス提案MTG" → "株式会社ABC"
 */
function extractCompanyName(title) {
  if (!title) return '不明';

  // 「様」「さん」の前の部分を会社名として抽出
  const honorificMatch = title.match(/^(.+?)(様|さん|さま)/);
  if (honorificMatch) return honorificMatch[1].trim();

  // 「×」「x」「/」で区切られた最初の部分
  const separatorMatch = title.match(/^(.+?)\s*[×xX\/|]\s*/);
  if (separatorMatch) return separatorMatch[1].trim();

  // 「MTG」「ミーティング」「打ち合わせ」の前の部分
  const meetingMatch = title.match(/^(.+?)\s*(MTG|mtg|ミーティング|打ち合わせ|打合せ|会議|定例)/);
  if (meetingMatch) return meetingMatch[1].trim();

  // フォールバック: タイトルの最初の20文字
  return title.substring(0, 20).trim();
}

// エラーハンドリング
app.use((error, req, res, next) => {
  console.error('API Error:', error);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 404ハンドリング
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Firebase Functions でエクスポート
// 機密情報はSecret Manager経由（functions.config()は2025年末にRuntime Config APIが
// 廃止されたため使用不可。値は `firebase functions:secrets:set <NAME>` で設定する）
exports.api = functions.runWith({
  secrets: [
    'TLDV_WEBHOOK_SECRET',
    'OPENAI_API_KEY',
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET'
  ]
}).https.onRequest(app);