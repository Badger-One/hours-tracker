import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MINUTE, HOUR, workedMs, breakMs, totalsForDay,
  formatClock, formatHM, formatDecimalHours, formatTimeOfDay, formatDate,
} from '../src/time.js';

// Local-time helper so tests pass in any time zone.
const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('worked time is shift length minus breaks', () => {
  const shift = { start: at(2026, 10, 1, 8), end: at(2026, 10, 1, 17), breaks: [{ start: at(2026, 10, 1, 12), end: at(2026, 10, 1, 13) }] };
  assert.equal(workedMs(shift, shift.end), 8 * HOUR);
  assert.equal(breakMs(shift, shift.end), 1 * HOUR);
});

test('a running shift and running break count up to now', () => {
  const now = at(2026, 10, 1, 12, 30);
  const shift = { start: at(2026, 10, 1, 8), end: null, breaks: [{ start: at(2026, 10, 1, 12), end: null }] };
  assert.equal(workedMs(shift, now), 4 * HOUR);
  assert.equal(breakMs(shift, now), 30 * MINUTE);
});

test('a shift past midnight is split between the two days', () => {
  const shift = { start: at(2026, 10, 1, 22), end: at(2026, 10, 2, 2), breaks: [{ start: at(2026, 10, 1, 23, 30), end: at(2026, 10, 2, 0, 30) }] };
  const day1 = totalsForDay([shift], shift.end, at(2026, 10, 1, 12));
  const day2 = totalsForDay([shift], shift.end, at(2026, 10, 2, 12));
  assert.deepEqual(day1, { workedMs: 90 * MINUTE, breakMs: 30 * MINUTE });
  assert.deepEqual(day2, { workedMs: 90 * MINUTE, breakMs: 30 * MINUTE });
});

test('today totals add up several shifts', () => {
  const now = at(2026, 10, 1, 18);
  const shifts = [
    { start: at(2026, 9, 30, 8), end: at(2026, 9, 30, 17), breaks: [] }, // yesterday, ignored
    { start: at(2026, 10, 1, 7), end: at(2026, 10, 1, 11, 50), breaks: [] },
    { start: at(2026, 10, 1, 12, 50), end: at(2026, 10, 1, 16, 1), breaks: [{ start: at(2026, 10, 1, 14), end: at(2026, 10, 1, 14, 10) }] },
  ];
  assert.deepEqual(totalsForDay(shifts, now), { workedMs: (4 * 60 + 50 + 3 * 60 + 1) * MINUTE, breakMs: 10 * MINUTE });
});

test('formatting', () => {
  assert.equal(formatClock(3725 * 1000), '1:02:05');
  assert.equal(formatClock(-5), '0:00:00');
  assert.equal(formatHM(8 * HOUR + 5 * MINUTE + 29 * 1000), '8:05');
  assert.equal(formatHM(8 * HOUR + 5 * MINUTE + 31 * 1000), '8:06');
  assert.equal(formatDecimalHours(8 * HOUR + 15 * MINUTE), '8.25');
  assert.equal(formatTimeOfDay(at(2026, 10, 1, 0, 5)), '12:05 AM');
  assert.equal(formatTimeOfDay(at(2026, 10, 1, 12, 0)), '12:00 PM');
  assert.equal(formatTimeOfDay(at(2026, 10, 1, 16, 7)), '4:07 PM');
  assert.equal(formatDate(at(2026, 1, 5, 9)), '2026-01-05');
});
