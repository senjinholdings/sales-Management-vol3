// GPT APIサービス - 議事録分析機能
// Version: 2.0.2 - APIキー確認機能追加版
import OpenAI from 'openai';

// OpenAI APIクライアントの初期化
const API_KEY = process.env.REACT_APP_OPENAI_API_KEY;

// APIキーの存在確認
export const isGPTServiceAvailable = () => {
  return !!API_KEY;
};

// APIキーの妥当性確認（形式チェック）
export const validateAPIKey = () => {
  if (!API_KEY) return false;
  // OpenAI APIキーは "sk-" で始まる
  return API_KEY.startsWith('sk-');
};

// OpenAIクライアントの初期化（遅延実行）
let openai = null;
const getOpenAIClient = () => {
  if (!openai && API_KEY) {
    openai = new OpenAI({
      apiKey: API_KEY,
      dangerouslyAllowBrowser: true // クライアントサイドでの使用を許可
    });
  }
  return openai;
};

// ステータス定義（フェーズ1〜8 + 失注）
const STATUS_DEFINITIONS = {
  'フェーズ1': '初期段階',
  'フェーズ2': '第2段階',
  'フェーズ3': '第3段階',
  'フェーズ4': '第4段階',
  'フェーズ5': '第5段階',
  'フェーズ6': '第6段階',
  'フェーズ7': '第7段階',
  'フェーズ8': '受注完了',
  '失注': 'MTGの結果、サービスが導入されなかったステータス'
};

// プロンプトテンプレート
const createPrompt = (meetingNotes) => {
  return `下記の議事録を読み取って、以下の3つの項目を出力してください：

■ AI要約
この議事録を5行で要約してください。

■ アクションプラン  
この議事録の内容に基づいて、次に取るべき具体的なアクションを提案してください。
議事録の内容から適切な行動を推測し、実行可能で具体的なアクションを複数提案してください。
例：「提案書作成」「価格調整」「社内稟議」「デモ実施」「追加ヒアリング」「契約書準備」など

■ ステータス
以下の9つのステータスから最も適切なものを1つ選択してください：
- フェーズ1：初期段階
- フェーズ2：第2段階
- フェーズ3：第3段階
- フェーズ4：第4段階
- フェーズ5：第5段階
- フェーズ6：第6段階
- フェーズ7：第7段階
- フェーズ8：受注完了
- 失注：MTGの結果、サービスが導入されなかったステータス

議事録：
${meetingNotes}

※回答は上記の■で示した3つの項目のみを含めてください。他の情報は不要です。`;
};

/**
 * 議事録をGPTで分析してAI要約、アクションプラン、ステータスを取得
 * @param {string} meetingNotes - 議事録の内容
 * @returns {Promise<{summary: string, actionPlans: string[], status: string, error?: string}>}
 */
export const analyzeMeetingNotes = async (meetingNotes) => {
  try {
    console.log('🤖 GPT API: 議事録分析開始');
    console.log('📝 入力された議事録:', meetingNotes);
    console.log('🔑 APIキー:', API_KEY ? `${API_KEY.substring(0, 20)}...` : '未設定');
    console.log('✅ APIキー形式チェック:', validateAPIKey() ? '有効' : '無効');
    
    // APIキーの確認
    if (!API_KEY) {
      console.error('❌ OpenAI APIキーが環境変数に設定されていません');
      throw new Error('OpenAI APIキーが設定されていません。.envファイルを確認してください。');
    }

    // APIキーの形式確認
    if (!validateAPIKey()) {
      console.error('❌ OpenAI APIキーの形式が正しくありません');
      throw new Error('OpenAI APIキーの形式が正しくありません。"sk-"で始まる有効なキーを設定してください。');
    }

    // 入力検証
    if (!meetingNotes || meetingNotes.trim().length === 0) {
      throw new Error('議事録の内容が入力されていません。');
    }

    // OpenAIクライアントの取得
    const client = getOpenAIClient();
    if (!client) {
      throw new Error('OpenAI APIクライアントの初期化に失敗しました。');
    }

    // デバッグモード: モックレスポンスを返す（開発中のテスト用）
    const USE_MOCK = false; // 本番環境ではfalseに設定
    console.log('🔧 モックモード:', USE_MOCK ? '有効' : '無効（実際のAPIを使用）');
    
    if (USE_MOCK) {
      console.log('🔧 デバッグモード: モックレスポンスを使用');
      
      // 議事録の内容に基づいて動的にモックレスポンスを生成
      const mockResponse = generateMockResponse(meetingNotes);
      const parsed = parseGPTResponse(mockResponse);
      
      console.log('✅ モックレスポンス生成完了');
      return {
        summary: parsed.summary,
        actionPlans: parsed.actionPlans,
        status: parsed.status,
        rawResponse: mockResponse
      };
    }

    // プロンプトを生成
    const prompt = createPrompt(meetingNotes);
    console.log('📨 送信するプロンプト:');
    console.log(prompt);
    console.log('='.repeat(50));
    
    // GPT APIリクエスト
    console.log('🚀 OpenAI APIにリクエスト送信中...');
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini', // コスト効率的なモデルを使用
      messages: [
        {
          role: 'system',
          content: 'あなたは営業支援AIです。議事録を分析して、次のアクションプランと適切なステータスを提案してください。回答は簡潔で実行可能な内容にしてください。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.3, // 一貫性を重視
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    });

    const analysisResult = response.choices[0]?.message?.content;
    
    if (!analysisResult) {
      throw new Error('GPTからの応答が取得できませんでした。');
    }

    console.log('✅ GPT API: 分析完了');
    console.log('📝 生のGPT応答:');
    console.log(analysisResult);
    console.log('='.repeat(50));

    // レスポンスを解析
    const parsed = parseGPTResponse(analysisResult);
    
    console.log('📊 解析結果:');
    console.log('- 要約:', parsed.summary);
    console.log('- アクションプラン:', parsed.actionPlans);
    console.log('- ステータス:', parsed.status);
    console.log('='.repeat(50));
    
    return {
      summary: parsed.summary,
      actionPlans: parsed.actionPlans,
      status: parsed.status,
      rawResponse: analysisResult
    };

  } catch (error) {
    console.error('💥 GPT API エラー:', error);
    console.error('エラー詳細:', {
      message: error.message,
      code: error.code,
      type: error.type,
      status: error.status
    });
    
    // エラーの種類に応じて適切なメッセージを返す
    let errorMessage = 'AI分析中にエラーが発生しました。';
    
    if (error.message.includes('API key')) {
      errorMessage = 'OpenAI APIキーの設定に問題があります。有効なAPIキーを設定してください。';
    } else if (error.message.includes('rate limit')) {
      errorMessage = 'API利用制限に達しました。しばらく時間をおいてからお試しください。';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'API接続がタイムアウトしました。もう一度お試しください。';
    } else if (error.message.includes('401')) {
      errorMessage = 'APIキーが無効です。正しいOpenAI APIキーを設定してください。';
    } else if (error.message.includes('429')) {
      errorMessage = 'APIの利用制限に達しました。しばらく待ってから再度お試しください。';
    } else if (error.message.includes('insufficient_quota')) {
      errorMessage = 'APIの利用枠が不足しています。OpenAIアカウントの利用状況を確認してください。';
    }
    
    // 詳細なエラー情報をコンソールに出力
    console.error('🔍 エラー診断:');
    console.error('- APIキー設定:', isGPTServiceAvailable() ? '有' : '無');
    console.error('- APIキー形式:', validateAPIKey() ? '正常' : '異常');
    console.error('- エラーメッセージ:', errorMessage);
    
    return {
      summary: '',
      actionPlans: [],
      status: '',
      error: errorMessage
    };
  }
};

/**
 * 議事録の内容に基づいてモックレスポンスを生成
 * @param {string} meetingNotes - 議事録の内容
 * @returns {string} モックレスポンス
 */
const generateMockResponse = (meetingNotes) => {
  // 議事録から重要なキーワードを抽出
  const keywords = meetingNotes.toLowerCase();
  
  // ステータスを決定（フェーズ1〜8 + 失注）
  let status = 'フェーズ3';
  if (keywords.includes('受注') || keywords.includes('契約') || keywords.includes('確定')) {
    status = 'フェーズ8';
  } else if (keywords.includes('失注') || keywords.includes('見送り') || keywords.includes('不採用')) {
    status = '失注';
  } else if (keywords.includes('提案') || keywords.includes('見積') || keywords.includes('資料')) {
    status = 'フェーズ4';
  } else if (keywords.includes('検討中') || keywords.includes('比較') || keywords.includes('評価')) {
    status = 'フェーズ5';
  }
  
  // アクションプランを生成
  const actionPlans = [];
  if (keywords.includes('提案')) {
    actionPlans.push('提案書の作成と送付');
    actionPlans.push('提案内容の社内レビュー実施');
  }
  if (keywords.includes('見積')) {
    actionPlans.push('見積書の作成');
    actionPlans.push('価格調整の検討');
  }
  if (keywords.includes('デモ') || keywords.includes('デモンストレーション')) {
    actionPlans.push('デモ実施日程の調整');
    actionPlans.push('デモ環境の準備');
  }
  if (keywords.includes('追加') || keywords.includes('質問')) {
    actionPlans.push('追加ヒアリングの実施');
    actionPlans.push('質問事項への回答準備');
  }
  if (keywords.includes('契約') || keywords.includes('受注')) {
    actionPlans.push('契約書の準備');
    actionPlans.push('社内承認プロセスの開始');
  }
  
  // デフォルトのアクションプラン
  if (actionPlans.length === 0) {
    actionPlans.push('フォローアップメールの送付');
    actionPlans.push('次回打ち合わせ日程の調整');
    actionPlans.push('社内共有と戦略会議の実施');
  }
  
  // 要約を生成（議事録の最初の部分を使用）
  const lines = meetingNotes.split('\n').filter(line => line.trim());
  const summary = lines.slice(0, 5).join(' ').substring(0, 200) + '...';
  
  return `■ AI要約
${summary}

■ アクションプラン
${actionPlans.map(plan => `・${plan}`).join('\n')}

■ ステータス
${status}`;
};

/**
 * GPTレスポンスを解析して構造化データに変換
 * @param {string} response - GPTからの生のレスポンス
 * @returns {{summary: string, actionPlans: string[], status: string}}
 */
export const parseGPTResponse = (response) => {
  const lines = response.split('\n').map(line => line.trim()).filter(line => line);
  
  let summary = '';
  let actionPlans = [];
  let status = '';
  
  let currentSection = '';
  
  for (const line of lines) {
    // セクションの判定（■マーカーを探す）
    if (line.includes('■') && line.includes('AI要約')) {
      currentSection = 'summary';
      continue;
    } else if (line.includes('■') && line.includes('アクションプラン')) {
      currentSection = 'actionPlans';
      continue;
    } else if (line.includes('■') && line.includes('ステータス')) {
      currentSection = 'status';
      continue;
    }
    
    // 各セクションの内容を抽出
    if (currentSection === 'summary' && line && !line.startsWith('■')) {
      summary += (summary ? '\n' : '') + line;
    } else if (currentSection === 'actionPlans' && line && !line.startsWith('■')) {
      // 箇条書きのマーカーを除去
      const cleanedLine = line.replace(/^[\*\-・]+\s*/, '').trim();
      if (cleanedLine) {
        actionPlans.push(cleanedLine);
      }
    } else if (currentSection === 'status' && line && !line.startsWith('■')) {
      // ステータスの定義部分を除去して、ステータス名のみを抽出
      const statusMatch = line.match(/^(与件化_提案中|受注|失注|保留|検討中|稼働終了)/);
      if (statusMatch) {
        status = statusMatch[1];
      } else if (!status && Object.keys(STATUS_DEFINITIONS).includes(line.split('：')[0])) {
        status = line.split('：')[0];
      } else if (!status) {
        // 定義されたステータスのいずれかが含まれているか確認
        for (const definedStatus of Object.keys(STATUS_DEFINITIONS)) {
          if (line.includes(definedStatus)) {
            status = definedStatus;
            break;
          }
        }
      }
    }
  }
  
  // デフォルト値の設定
  if (!summary) {
    summary = '議事録の要約を生成できませんでした。';
  }
  if (actionPlans.length === 0) {
    actionPlans = ['次回アクションを検討'];
  }
  if (!status || !Object.keys(STATUS_DEFINITIONS).includes(status)) {
    status = '検討中';
  }
  
  return { summary, actionPlans, status };
};

/**
 * 着地予想と目標の差分を埋めるための追加アクションをGPTに提案させる
 * （実データの業種情報や配信実績は無いため、一般的な知見にもとづく参考意見という位置づけ）
 * @param {{dealType: string, gapAmount: number, avgDealBudget: number, dealCount: number}} params
 * @returns {Promise<{suggestion: string, error?: string}>}
 */
export const suggestGapClosingActions = async ({ dealType, gapAmount, avgDealBudget, dealCount }) => {
  try {
    if (!API_KEY) {
      return { suggestion: '', error: 'OpenAI APIキーが設定されていません。' };
    }
    const client = getOpenAIClient();
    if (!client) {
      return { suggestion: '', error: 'OpenAI APIクライアントの初期化に失敗しました。' };
    }

    const prompt = `あなたは営業支援AIです。ソリューション営業の担当者が、今期の${dealType}の売上目標に対して着地予想が不足しています。

不足額: 約${Math.round(gapAmount).toLocaleString()}円
現在保有している${dealType}案件の平均想定予算: 約${Math.round(avgDealBudget || 0).toLocaleString()}円
現在保有している${dealType}案件数: ${dealCount}件

この不足を埋めるために、新規の見込み顧客への架電・メールなどのアプローチを増やす前提で、以下を答えてください。

1. 目標達成のためにはおおよそ何件くらいの新規アプローチ（メール・架電など）が必要そうか。想定する成約率（歩留まり）の前提も明記し、あくまで目安の試算であることが分かるようにする
2. どのような業種・規模の企業層を優先して狙うとよさそうか（一般的な知見にもとづく提案でよい）

実データにもとづく精緻な計算ではなく、あくまで参考意見であることが伝わる書き方にしてください。300字程度で簡潔にまとめてください。`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'あなたは営業支援AIです。営業担当者が次に取るべき現実的なアクションを、前提を明示しながら簡潔に提案してください。' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 600,
      temperature: 0.4
    });

    const suggestion = response.choices[0]?.message?.content?.trim();
    if (!suggestion) {
      return { suggestion: '', error: 'AIから提案を取得できませんでした。' };
    }
    return { suggestion };
  } catch (error) {
    console.error('提案生成エラー:', error);
    return { suggestion: '', error: error.message || '提案の生成に失敗しました。' };
  }
};

// APIキーチェック用のヘルパー関数をエクスポート
export const checkAPIKeyStatus = async () => {
  try {
    if (!isGPTServiceAvailable()) {
      return { valid: false, error: 'APIキーが設定されていません' };
    }
    
    if (!validateAPIKey()) {
      return { valid: false, error: 'APIキーの形式が正しくありません' };
    }
    
    // 簡単なテストリクエストを送信
    const result = await analyzeMeetingNotes('テスト: 本日の会議で新サービスの提案を行いました。');
    
    if (result.error) {
      return { valid: false, error: result.error };
    }
    
    return { valid: true, message: 'APIキーは有効です' };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

// デバッグ用: API状態を確認
export const debugAPIStatus = () => {
  console.log('🔍 OpenAI API 状態確認:');
  console.log('- APIキー設定:', isGPTServiceAvailable() ? '✅' : '❌');
  console.log('- APIキー形式:', validateAPIKey() ? '✅' : '❌');
  console.log('- APIキー値:', API_KEY ? `${API_KEY.substring(0, 20)}...` : 'なし');
  console.log('- 環境変数名: REACT_APP_OPENAI_API_KEY');
  return {
    available: isGPTServiceAvailable(),
    valid: validateAPIKey(),
    keyPreview: API_KEY ? `${API_KEY.substring(0, 20)}...` : null
  };
};