/**
 * 日報の「予定を確定する」機能で使う、時刻計算の純粋関数群。
 * dailyTimerService.js（確定時の再チェック）とDailyTimerPage.js（画面表示・タイムライン）の
 * 両方から使うため、他の共通ロジック（billing.js、stageProgress.js等）と同様にsrc/utils/に置く。
 */

// 埋めるべき時間帯。開始は始業時刻、終了は夜の振り返り開始（23:20）に合わせている
export const PLAN_WINDOW_START = '09:00';
export const PLAN_WINDOW_END = '23:20';

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
 * 指定した時間帯（既定 9:00〜23:20）の空き時間・時刻の重なりを計算する。
 * 予定開始時刻が無いタスク（緊急クエスト・割り込みで今すぐ開始したもの）は対象外
 * （時刻未定の別枠で扱うため、埋めるべき時間の計算には含めない）
 * @returns {{ gaps: Array<{start:number,end:number,minutes:number}>, overlaps: Array, isFilled: boolean }}
 *   start/endは0:00からの分数
 */
export const computeScheduleGaps = (tasks, { startTime = PLAN_WINDOW_START, endTime = PLAN_WINDOW_END } = {}) => {
  const windowStart = timeToMinutes(startTime);
  const windowEnd = timeToMinutes(endTime);

  const scheduled = tasks
    .filter((t) => t.plannedStartTime && t.plannedMinutes != null)
    .map((t) => {
      const start = timeToMinutes(t.plannedStartTime);
      return { id: t.id, name: t.name, start, end: start + t.plannedMinutes };
    })
    .sort((a, b) => a.start - b.start);

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
