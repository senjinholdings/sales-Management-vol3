// 契約書まわりの画面（account-sales-boardから移したもの）で使う日時の変換・表示。
// APIから返るFirestoreのTimestampは {_seconds} の形、画面側のFirestoreから読んだものは {seconds} の形になる。
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n) => String(n).padStart(2, '0');

// 例: 9/25(木) 14:05（account-sales-boardの表示に揃える）
export function formatDateTime(date) {
  if (!date || Number.isNaN(date.getTime())) return '-';
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]}) ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
