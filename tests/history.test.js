import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory, startOfWeek } from '../src/history.js';
import { HOUR, formatHM } from '../src/time.js';

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 2, 12);

/** An 8-hour shift with no breaks starting at 8 AM on the given day. */
const day = (y, mo, d, hours = 8) => ({ id: `${y}-${mo}-${d}`, start: at(y, mo, d, 8), end: at(y, mo, d, 8) + hours * HOUR, breaks: [] });

test('startOfWeek for Monday and Sunday weeks', () => {
  // Thu Oct 1, 2026
  assert.equal(startOfWeek(at(2026, 10, 1, 15), 1), at(2026, 9, 28, 0)); // Monday Sep 28
  assert.equal(startOfWeek(at(2026, 10, 1, 15), 0), at(2026, 9, 27, 0)); // Sunday Sep 27
  // A Sunday in a Monday week belongs to the Monday before it.
  assert.equal(startOfWeek(at(2026, 10, 4, 9), 1), at(2026, 9, 28, 0));
  assert.equal(startOfWeek(at(2026, 10, 4, 9), 0), at(2026, 10, 4, 0));
});

test('groups into years, months, and weeks, newest first, with totals', () => {
  const shifts = [
    day(2025, 12, 30, 7),
    day(2026, 9, 28), day(2026, 9, 29), day(2026, 9, 30, 6),
    day(2026, 10, 1), day(2026, 10, 2, 4),
  ];
  const years = buildHistory(shifts, NOW);
  assert.deepEqual(years.map((y) => y.year), [2026, 2025]);

  const [y2026, y2025] = years;
  assert.equal(formatHM(y2026.workedMs), '34:00');
  assert.equal(y2026.daysWorked, 5);
  assert.equal(formatHM(y2025.workedMs), '7:00');

  assert.deepEqual(y2026.months.map((m) => m.key), ['2026-10', '2026-09']);
  const [oct, sep] = y2026.months;
  assert.equal(formatHM(oct.workedMs), '12:00');
  assert.equal(oct.daysWorked, 2);
  assert.equal(formatHM(oct.avgPerDayMs), '6:00');
  assert.equal(formatHM(sep.workedMs), '22:00');
  assert.equal(sep.daysWorked, 3);
});

test('a week split across two months shows the full week total in both', () => {
  const shifts = [day(2026, 9, 28), day(2026, 9, 29), day(2026, 10, 1)];
  const [{ months: [oct, sep] }] = buildHistory(shifts, NOW, { weekStartsOn: 1 });
  assert.equal(oct.weeks.length, 1);
  assert.equal(sep.weeks.length, 1);
  assert.equal(formatHM(oct.weeks[0].fullWeekMs), '24:00');
  assert.equal(formatHM(sep.weeks[0].fullWeekMs), '24:00');
  assert.equal(oct.weeks[0].start, at(2026, 9, 28, 0));
  assert.equal(oct.weeks[0].end, at(2026, 10, 4, 0));
});

test('week start setting changes where weeks split', () => {
  // Sun Sep 27 and Mon Sep 28.
  const shifts = [day(2026, 9, 27), day(2026, 9, 28)];
  const monday = buildHistory(shifts, NOW, { weekStartsOn: 1 })[0].months[0].weeks;
  const sunday = buildHistory(shifts, NOW, { weekStartsOn: 0 })[0].months[0].weeks;
  assert.equal(monday.length, 2);
  assert.equal(sunday.length, 1);
});

test('two shifts on one day count as one day worked; a not-yet-started shift counts as none', () => {
  const split = [
    { id: 'a', start: at(2026, 10, 1, 7), end: at(2026, 10, 1, 11), breaks: [] },
    { id: 'b', start: at(2026, 10, 1, 12), end: at(2026, 10, 1, 16), breaks: [] },
    { id: 'c', start: NOW + HOUR, end: null, breaks: [] },
  ];
  const [{ months: [oct] }] = buildHistory(split, NOW);
  assert.equal(oct.daysWorked, 1);
  assert.equal(formatHM(oct.avgPerDayMs), '8:00');
});

test('big totals get commas', () => {
  assert.equal(formatHM(1412 * HOUR + 5 * 60000), '1,412:05');
});
