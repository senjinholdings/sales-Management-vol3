// 契約書まわり（雛形管理・記入済み契約書・AI修正・締結依頼）のAPI呼び出し。
// account-sales-board(src/services/apiClient.js)の契約書部分と同じ名前・同じ引数にしてあり、
// 画面のコンポーネントはあちらからほぼそのまま移してある。
// 認証は他の自前APIと同じ x-app-secret（staffService.js と同じ）。

const API_BASE = 'https://sales-management-staging.web.app/api/contract';
const APP_SECRET = process.env.REACT_APP_MEETING_SCHEDULE_SECRET || '';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(APP_SECRET ? { 'x-app-secret': APP_SECRET } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    let message = `リクエストに失敗しました (${res.status})`;
    let errorCode = '';
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      // 画面側で分岐したいエラーだけ、文言とは別に機械可読な印を返している。
      if (body?.code) errorCode = body.code;
    } catch (_) {
      // ignore body parse failure
    }
    const error = new Error(message);
    error.status = res.status;
    error.code = errorCode;
    throw error;
  }

  if (res.status === 204) return null;
  return res.json();
}

const post = (path, data) => request(path, { method: 'POST', body: JSON.stringify(data || {}) });

export const api = {
  // 契約書の雛形マスタ
  listContracts: () => request('/contracts'),
  createContract: (data) => post('/contracts', data),
  uploadContract: (data) => post('/contracts/upload', data),
  renameContract: (groupKey, name) => post('/contracts/rename', { groupKey, name }),
  // kind(基本/個別)・requestFields(入力項目)だけを更新する。バージョンは増えない。
  updateContract: (id, data) => request(`/contracts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  // 契約書雛形(Googleドキュメント)への{{項目名}}マーク付け。
  listContractFieldPresets: () => request('/contract-field-presets'),
  createContractFieldPreset: (label) => post('/contract-field-presets', { label }),
  deleteContractFieldPreset: (id) => request(`/contract-field-presets/${id}`, { method: 'DELETE' }),
  createContractMarkupCopy: (id) => post(`/contracts/${id}/markup-copy`),
  getContractTemplate: (id) => request(`/contracts/${id}/template`),
  addContractTemplateMarker: (id, data) => post(`/contracts/${id}/template/markers`, data),
  editContractTemplateText: (id, data) => post(`/contracts/${id}/template/text`, data),
  // 共通設定（Googleドキュメントを操作するアカウント・保存先フォルダ・テストグループ）
  getContractSettings: () => request('/contract-settings'),
  saveContractSettings: (data) => request('/contract-settings', { method: 'PUT', body: JSON.stringify(data) }),

  // 案件ごとの締結依頼・締結状況
  listDealContractRequests: (dealId) => request(`/deals/${dealId}/contract-requests`),
  createDealContractRequest: (dealId, data) => post(`/deals/${dealId}/contract-requests`, data),
  previewDealContractRequest: (dealId, data) => post(`/deals/${dealId}/contract-requests/preview`, data),
  updateDealContractRequest: (dealId, requestId, data) => request(
    `/deals/${dealId}/contract-requests/${requestId}`,
    { method: 'PATCH', body: JSON.stringify(data) },
  ),
  // 締結済みの契約書をファイルで登録する。
  uploadSignedContract: (dealId, data) => post(`/deals/${dealId}/contract-requests/upload`, data),

  // 記入済み契約書（雛形に項目を差し込んで作った案件ごとの1ファイル）
  generateDealContractDocuments: (dealId, data) => post(`/deals/${dealId}/contract-requests/documents`, data),
  listDealContractDocuments: (dealId) => request(`/deals/${dealId}/contract-requests/documents`),
  getDealContractDocumentText: (dealId, documentId) => request(`/deals/${dealId}/contract-requests/documents/${documentId}/text`),
  editDealContractDocumentText: (dealId, documentId, data) => post(`/deals/${dealId}/contract-requests/documents/${documentId}/text`, data),
  reviseDealContractDocumentWithAi: (dealId, documentId, data) => post(`/deals/${dealId}/contract-requests/documents/${documentId}/ai-revision`, data),
  checkDealContractDocumentConsistency: (dealId, documentId, data) => post(`/deals/${dealId}/contract-requests/documents/${documentId}/ai-consistency-check`, data),
};
