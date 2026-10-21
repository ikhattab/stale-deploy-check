const MINUTE = 60;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** "45 s", "12 min", "5.5 hours", "3.1 days". Precise enough for a title, not for math. */
export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 90 * MINUTE) return `${Math.round(seconds / MINUTE)} min`;
  if (seconds < 36 * HOUR) return `${round1(seconds / HOUR)} hours`;
  return `${round1(seconds / DAY)} days`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
