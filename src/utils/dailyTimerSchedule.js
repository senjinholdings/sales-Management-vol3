/**
 * 日報の「予定を確定する」機能で使う、時刻計算の純粋関数群。
 * dailyTimerService.js（確定時の再チェック）とDailyTimerPage.js（画面表示・タイムライン）の
 * 両方から使うため、他の共通ロジック（billing.js、stageProgress.js等）と同様にsrc/utils/に置く。
 */

// 埋めるべき時間帯の終了。夜の振り返り開始（23:00）に合わせている。
// 開始は固定時刻にしない（起床時刻は日によって違うため）。その日いちばん早い予定の開始時刻を起点にする
export const PLAN_WINDOW_END = '23:00';

// タイムライン表示の下限（画面レイアウト用）。8時より前に予定が入ることもあるため余裕を持たせている
export const PLAN_WINDOW_START = '06:00';

// これ未満の隙間は誤差として無視する（ここで止めると運用が現実的でないため）
const MIN_GAP_MINUTES = 5;

export const timeToMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const minutesToTime = (mins) => {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * 予定開始時刻・予定時間の両方が入っているタスクだけを対象に、
 * 「その日いちばん早い予定の開始時刻」から指定した終了時刻（既定 23:00）までの
 * 空き時間・時刻の重なりを計算する。起点を固定時刻にしないのは、起床時刻が日によって
 * 違う（8時より前のこともある）ため。予定が1件も無い日はgapsを計算しない（isFilled: false）
 * 予定開始時刻が無いタスク（緊急クエスト・割り込みで今すぐ開始したもの）は対象外
 * （時刻未定の別枠で扱うため、埋めるべき時間の計算には含めない）
 * @returns {{ gaps: Array<{start:number,end:number,minutes:number}>, overlaps: Array, isFilled: boolean }}
 *   start/endは0:00からの分数
 */
export const computeScheduleGaps = (tasks, { endTime = PLAN_WINDOW_END } = {}) => {
  const windowEnd = timeToMinutes(endTime);

  const scheduled = tasks
    .filter((t) => t.plannedStartTime && t.plannedMinutes != null)
    .map((t) => {
      const start = timeToMinutes(t.plannedStartTime);
      return { id: t.id, name: t.name, start, end: start + t.plannedMinutes };
    })
    .sort((a, b) => a.start - b.start);

  if (scheduled.length === 0) {
    return { gaps: [], overlaps: [], isFilled: false };
  }

  const windowStart = scheduled[0].start;

  const overlaps = [];
  for (let i = 1; i < scheduled.length; i++) {
    if (scheduled[i].start < scheduled[i - 1].end) {
      overlaps.push({ a: scheduled[i - 1], b: scheduled[i] });
    }
  }

  const gaps = [];
  let cursor = windowStart;
  scheduled.forEach((t) => {
    const s = Math.max(t.start, windowStart);
    if (s > cursor) gaps.push({ start: cursor, end: Math.min(s, windowEnd) });
    cursor = Math.max(cursor, t.end);
  });
  if (cursor < windowEnd) gaps.push({ start: cursor, end: windowEnd });

  const significantGaps = gaps
    .map((g) => ({ ...g, minutes: g.end - g.start }))
    .filter((g) => g.minutes >= MIN_GAP_MINUTES);

  return { gaps: significantGaps, overlaps, isFilled: significantGaps.length === 0 && overlaps.length === 0 };
};
