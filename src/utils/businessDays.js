/**
 * 営業日計算ユーティリティ（土日を除外、祝日対応なし）
 */

/**
 * 基準日から指定営業日数を加算（負数なら減算）した日付を返す
 * @param {Date|string} date - 基準日
 * @param {number} days - 営業日数
 * @returns {Date}
 */
export const addBusinessDays = (date, days) => {
  const result = new Date(date);
  let count = 0;

  while (count < Math.abs(days)) {
    result.setDate(result.getDate() + (days > 0 ? 1 : -1));
    const dayOfWeek = result.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
  }

  return result;
};

/**
 * fromの翌日からtoまでの営業日数を数える（日付単位、時刻は無視）
 * to がfrom以前の場合は0を返す
 * @param {Date} from
 * @param {Date} to
 * @returns {number}
 */
export const countBusinessDaysAfter = (from, to) => {
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  let count = 0;
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const dayOfWeek = cursor.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
  }
  return count;
};
