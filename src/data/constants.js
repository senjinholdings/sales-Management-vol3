// 提案メニュー（5種）
export const PROPOSAL_MENUS = [
  '第一想起取れるくん',
  '獲得取れるくん',
  'インハウスキャンプ',
  'IFキャスティング',
  '運用コックピット'
];

// パートナー向け提案メニュー（6種：他社案件を含む）
export const PARTNER_PROPOSAL_MENUS = [
  '第一想起取れるくん',
  '獲得取れるくん',
  'インハウスキャンプ',
  'IFキャスティング',
  '運用コックピット',
  '他社案件'
];

// 営業対応者（2名）
export const SALES_REPRESENTATIVES = [
  '増田 陽',
  '荒幡 輝'
];

// ステータス（10種）フェーズ1〜8 + Dead + 失注
export const STATUSES = [
  'フェーズ1',
  'フェーズ2',
  'フェーズ3',
  'フェーズ4',
  'フェーズ5',
  'フェーズ6',
  'フェーズ7',
  'フェーズ8',
  'Dead',
  '失注'
];

// 紹介者の稼働状況
export const INTRODUCER_STATUS = [
  'アクティブ',
  '非稼働',
  '要確認'
];

// フェーズごとの説明
export const PHASE_DESCRIPTIONS = {
  'フェーズ1': '商談見極め',
  'フェーズ2': '課題の特定',
  'フェーズ3': '価値の訴求',
  'フェーズ4': '決裁者への訴求',
  'フェーズ5': '契約内容の調整',
  'フェーズ6': '契約の手続き',
  'フェーズ7': '当社の処理',
  'フェーズ8': '受注',
  'Dead': '失注',
};

// ステータスごとの色（フェーズ1〜8 + Dead + 失注）
export const STATUS_COLORS = {
  'フェーズ1': '#e74c3c',
  'フェーズ2': '#f39c12',
  'フェーズ3': '#f1c40f',
  'フェーズ4': '#3498db',
  'フェーズ5': '#2980b9',
  'フェーズ6': '#9b59b6',
  'フェーズ7': '#1abc9c',
  'フェーズ8': '#27ae60',
  'Dead': '#2c3e50',
  '失注': '#95a5a6'
};

// ステータスの順序（カンバンボード用）フェーズ1〜8 + Dead + 失注
export const STATUS_ORDER = [
  'フェーズ1',
  'フェーズ2',
  'フェーズ3',
  'フェーズ4',
  'フェーズ5',
  'フェーズ6',
  'フェーズ7',
  'フェーズ8',
  'Dead',
  '失注'
];

// 部署名（Ver 2.13追加）
export const DEPARTMENT_NAMES = [
  'Buzz',
  'コンサル',
  'デジコン',
  'マーケD'
];

// 流入経路
export const LEAD_SOURCES = [
  'テレアポ',
  'リファラル',
  'パートナー',
  'ソーシャル',
  '問い合わせフォーム',
  'アップセル',
  'クロスセル'
];

// 継続管理ステータス
export const CONTINUATION_STATUSES = [
  '施策実施中',
  '継続提案中',
  '新規提案中',
  '終了',
  '継続成約'
];

// 継続管理ステータスごとの色
export const CONTINUATION_STATUS_COLORS = {
  '施策実施中': '#3498db',
  '継続提案中': '#f39c12',
  '新規提案中': '#5dade2',
  '終了': '#95a5a6',
  '継続成約': '#27ae60',
  '新規成約': '#2ecc71'
};

// フォローアップフェーズ（継続案件の成約確度）
export const FOLLOW_UP_PHASES = [
  'フォロー1',
  'フォロー2',
  'フォロー3',
  'フォロー4',
  'フォロー5'
];

// フォローアップフェーズの詳細
export const FOLLOW_UP_PHASE_DETAILS = {
  'フォロー1': { label: '初回接触', probability: 20 },
  'フォロー2': { label: 'ニーズ確認', probability: 40 },
  'フォロー3': { label: '提案中', probability: 60 },
  'フォロー4': { label: '予算調整中', probability: 80 },
  'フォロー5': { label: '継続成約', probability: 100 }
};

// フォローアップフェーズの色
export const FOLLOW_UP_PHASE_COLORS = {
  'フォロー1': '#e74c3c',
  'フォロー2': '#f39c12',
  'フォロー3': '#f1c40f',
  'フォロー4': '#3498db',
  'フォロー5': '#27ae60'
};

// 案件管理ランク
export const PROJECT_RANKS = ['S', 'A', 'B', 'C'];

// フェーズごとの受注確率（HomeDashboard / NewDealsDashboard / ExistingDealsDashboard と共通）
export const PHASE_PROBABILITY = {
  'フェーズ1': 0.05,
  'フェーズ2': 0.15,
  'フェーズ3': 0.25,
  'フェーズ4': 0.50,
  'フェーズ5': 0.70,
  'フェーズ6': 0.90,
  'フェーズ7': 0.95,
  'フェーズ8': 1.00,
  '失注': 0
};