// ローカルのFileをbase64化する。Slack・Chatwork・メールの添付と契約書雛形の
// アップロードはいずれも「JSONでbase64を送る」方式に統一してあるので共通で使う
// (Cloud Functions側でmultipartを受けるのを避けるため)。
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}
