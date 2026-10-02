// Groups shifts for the History tab: years, then months, then weeks, newest first,
// with totals at every level. No screen code here, so it can be tested in Node.
//
// A shift belongs to the day, week, month, and year it started in.

import { workedMs, startOfDay, formatDate } from './time.js';

/** Midnight at the start of the week containing `ms`. weekStartsOn: 0 = Sunday, 1 = Monday. */
export function startOfWeek(ms, weekStartsOn = 1) {
  const d = new Date(startOfDay(ms));
  const back = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - back);
  return d.getTime();
}

/** The day after the week ends (exclusive), safe across daylight saving changes. */
function addDays(ms, days) {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Totals for a group of shifts: hours worked, distinct days worked, and average per day worked. */
function summarize(shifts, now) {
  let worked = 0;
  const days = new Set();
  for (const s of shifts) {
    const w = workedMs(s, now);
    worked += w;
    if (w > 0) days.add(startOfDay(s.start));
  }
  return { workedMs: worked, daysWorked: days.size, avgPerDayMs: days.size ? worked / days.size : 0 };
}

/** Put items into a Map by key, keeping their order. */
function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

/**
 * @returns [{ year, ...totals, months: [{ key: '2026-09', start, ...totals,
 *            weeks: [{ start, end, fullWeekMs, shifts }] }] }], newest first.
 *
 * Week totals cover the whole week, including days in the next or previous month,
 * so a week split across two months shows the same total in both.
 */
export function buildHistory(shifts, now, { weekStartsOn = 1 } = {}) {
  const newestFirst = [...shifts].sort((a, b) => b.start - a.start);
  const byWeek = groupBy(newestFirst, (s) => startOfWeek(s.start, weekStartsOn));
  const fullWeekMs = new Map([...byWeek].map(([week, list]) => [week, summarize(list, now).workedMs]));

  const years = groupBy(newestFirst, (s) => new Date(s.start).getFullYear());
  return [...years].map(([year, yearShifts]) => ({
    year,
    ...summarize(yearShifts, now),
    months: [...groupBy(yearShifts, (s) => formatDate(s.start).slice(0, 7))].map(([key, monthShifts]) => ({
      key,
      start: monthShifts.at(-1).start,
      ...summarize(monthShifts, now),
      weeks: [...groupBy(monthShifts, (s) => startOfWeek(s.start, weekStartsOn))].map(([week, weekShifts]) => ({
        start: week,
        end: addDays(week, 6), // last day of the week, for labels
        fullWeekMs: fullWeekMs.get(week),
        shifts: weekShifts,
      })),
    })),
  }));
}
