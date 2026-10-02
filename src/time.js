// Time math.
// Every point in time is stored as epoch milliseconds (what Date.now() returns).
// Every duration is milliseconds. Formatting into "8:05" or "7:00 AM" happens
// only at the edges: the screen and CSV files.

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** Midnight (local time) at the start of the day containing `ms`. */
export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Midnight (local time) at the start of the following day. Safe across daylight saving changes. */
export function startOfNextDay(ms) {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** How many ms the ranges [aStart, aEnd) and [bStart, bEnd) share. Never negative. */
export function overlapMs(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** A shift or break with no end yet is still running, so it ends "now". */
function endOrNow(item, now) {
  return item.end ?? now;
}

/**
 * Break time inside a shift, optionally limited to the window [from, to).
 * Breaks are clamped to the shift, so a break can never count outside it.
 */
export function breakMs(shift, now, from = -Infinity, to = Infinity) {
  const lo = Math.max(from, shift.start);
  const hi = Math.min(to, endOrNow(shift, now));
  let total = 0;
  for (const b of shift.breaks) total += overlapMs(b.start, endOrNow(b, now), lo, hi);
  return total;
}

/** Time worked in a shift (shift length minus breaks), optionally limited to [from, to). */
export function workedMs(shift, now, from = -Infinity, to = Infinity) {
  const span = overlapMs(shift.start, endOrNow(shift, now), from, to);
  return Math.max(0, span - breakMs(shift, now, from, to));
}

/**
 * Totals for the calendar day containing `day` (defaults to today).
 * Only the part of each shift that falls inside that day counts, so a shift
 * that runs past midnight is split correctly between the two days.
 */
export function totalsForDay(shifts, now, day = now) {
  const from = startOfDay(day);
  const to = startOfNextDay(day);
  let worked = 0;
  let breaks = 0;
  for (const s of shifts) {
    worked += workedMs(s, now, from, to);
    breaks += breakMs(s, now, from, to);
  }
  return { workedMs: worked, breakMs: breaks };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 3725000 -> "1:02:05". Used for live timers. */
export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${pad2(m)}:${pad2(s)}`;
}

/** 29100000 -> "8:05". Rounds to the nearest minute. Used for totals and CSV. */
export function formatHM(ms) {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  return `${Math.floor(minutes / 60)}:${pad2(minutes % 60)}`;
}

/** 29100000 -> "8.08". Decimal hours, handy for timesheets and spreadsheets. */
export function formatDecimalHours(ms) {
  return (Math.max(0, ms) / HOUR).toFixed(2);
}

/** "7:00 AM". Formatted by hand so it is identical on every device and in tests. */
export function formatTimeOfDay(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${pad2(d.getMinutes())} ${suffix}`;
}

/** "2026-10-01" in local time. */
export function formatDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu, Oct 1, 2026". */
export function formatDayHeading(ms) {
  const d = new Date(ms);
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
