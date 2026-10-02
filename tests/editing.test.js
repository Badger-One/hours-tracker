import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initLogger, getLogs } from '../src/logger.js';
import * as store from '../src/store.js';
import { MINUTE, HOUR, fromDateAndTime, toTimeInput, timeOnOrAfter, formatWhen } from '../src/time.js';

const at = (y, mo, d, h, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const NOW = at(2026, 10, 2, 12, 0);

before(() => initLogger({ console: false }));

/** A state with one finished shift on Oct 1, 8 AM to 5 PM with a 12 to 1 break. */
function withYesterday() {
  const s = store.emptyState();
  s.shifts.push({
    id: 'oct1', job: 'Tech', note: '', source: 'app',
    start: at(2026, 10, 1, 8), end: at(2026, 10, 1, 17),
    breaks: [{ start: at(2026, 10, 1, 12), end: at(2026, 10, 1, 13) }],
  });
  return s;
}

// ---- Form input helpers ----

test('date and time input conversions', () => {
  assert.equal(fromDateAndTime('2026-01-05', '07:03'), at(2026, 1, 5, 7, 3));
  assert.equal(fromDateAndTime('2026-01-05', ''), null);
  assert.equal(fromDateAndTime('', '07:03'), null);
  assert.equal(toTimeInput(at(2026, 1, 5, 19, 45)), '19:45');
});

test('an end time earlier in the day than the start lands on the next day', () => {
  // How the shift editor reads Start 10:00 PM, End 02:00 with one date.
  const start = fromDateAndTime('2026-10-01', '22:00');
  assert.equal(timeOnOrAfter(start, '02:00'), at(2026, 10, 2, 2));
  // The same time as the start means a zero-length shift, which the rules then refuse.
  assert.equal(timeOnOrAfter(start, '22:00'), start);
});

test('break times land on the right day, including after midnight', () => {
  assert.equal(timeOnOrAfter(at(2026, 10, 1, 8), '12:30'), at(2026, 10, 1, 12, 30));
  assert.equal(timeOnOrAfter(at(2026, 10, 1, 22), '00:15'), at(2026, 10, 2, 0, 15));
  // A shift that started at 7:00:40 still accepts a 7:00 time on the same day.
  assert.equal(timeOnOrAfter(at(2026, 10, 1, 7, 0, 40), '07:00'), at(2026, 10, 1, 7, 0));
});

test('formatWhen names the day only when it is not today', () => {
  assert.equal(formatWhen(at(2026, 10, 2, 7), NOW), '7:00 AM');
  assert.equal(formatWhen(at(2026, 10, 3, 7), NOW), 'tomorrow 7:00 AM');
  assert.equal(formatWhen(at(2026, 9, 28, 7), NOW), 'Mon Sep 28, 7:00 AM');
});

// ---- Start at ----

test('start at an earlier time', () => {
  const s = store.emptyState();
  store.startWork(s, NOW, NOW - 2 * HOUR);
  assert.equal(store.currentStatus(s, NOW), 'working');
  assert.equal(store.activeShift(s).start, NOW - 2 * HOUR);
});

test('start ahead of time: scheduled until the time arrives', () => {
  const s = store.emptyState();
  store.startWork(s, NOW, NOW + 15 * MINUTE);
  assert.equal(store.currentStatus(s, NOW), 'scheduled');
  assert.equal(store.currentStatus(s, NOW + 16 * MINUTE), 'working');
  assert.throws(() => store.startBreak(s, NOW), /hasn't started/);
  assert.throws(() => store.clockOut(s, NOW), /hasn't started/);
  assert.ok(getLogs().some((e) => e.event === 'shift.schedule'));
});

test('start now on a scheduled shift', () => {
  const s = store.emptyState();
  store.startWork(s, NOW, NOW + HOUR);
  store.startScheduledNow(s, NOW);
  assert.equal(store.activeShift(s).start, NOW);
});

test('cannot schedule more than 24 hours ahead or start inside an earlier shift', () => {
  assert.throws(() => store.startWork(store.emptyState(), NOW, NOW + 25 * HOUR), /24 hours/);
  const s = withYesterday();
  assert.throws(() => store.startWork(s, NOW, at(2026, 10, 1, 16)), /Overlaps your shift on Thu, Oct 1, 2026/);
});

// ---- Clock out at / break at ----

test('clock out at an earlier time, ending the break too', () => {
  const s = store.emptyState();
  store.startWork(s, NOW - 4 * HOUR);
  store.startBreak(s, NOW - HOUR);
  store.clockOut(s, NOW, NOW - 30 * MINUTE);
  const [shift] = s.shifts;
  assert.equal(shift.end, NOW - 30 * MINUTE);
  assert.equal(shift.breaks[0].end, NOW - 30 * MINUTE);
});

test('clock out at, break at, and end break at refuse impossible times', () => {
  const s = store.emptyState();
  store.startWork(s, NOW, NOW - 2 * HOUR);
  assert.throws(() => store.clockOut(s, NOW, NOW - 3 * HOUR), /Pick a time after/);
  assert.throws(() => store.clockOut(s, NOW, NOW + MINUTE), /future/);
  assert.throws(() => store.startBreak(s, NOW, NOW - 3 * HOUR), /can't start before/);
  store.startBreak(s, NOW, NOW - HOUR);
  assert.throws(() => store.endBreak(s, NOW, NOW - 2 * HOUR), /Pick a later time/);
  assert.throws(() => store.clockOut(s, NOW, NOW - 90 * MINUTE), /Pick a time after/);
  store.endBreak(s, NOW, NOW - 45 * MINUTE);
  assert.deepEqual(s.shifts[0].breaks, [{ start: NOW - HOUR, end: NOW - 45 * MINUTE }]);
});

// ---- Editing ----

test('edit a past shift: times, breaks, job, note', () => {
  const s = withYesterday();
  store.updateShift(s, 'oct1', {
    job: 'Help Desk',
    start: at(2026, 10, 1, 7, 30),
    end: at(2026, 10, 1, 16),
    breaks: [{ start: at(2026, 10, 1, 11), end: at(2026, 10, 1, 11, 30) }],
    note: 'Left early',
  }, NOW);
  const [shift] = s.shifts;
  assert.equal(shift.job, 'Help Desk');
  assert.equal(shift.start, at(2026, 10, 1, 7, 30));
  assert.equal(shift.note, 'Left early');
  assert.equal(shift.editedAt, NOW);
  const entry = getLogs().findLast((e) => e.event === 'shift.edit');
  assert.ok(entry.data.before.start && entry.data.after.start, 'log keeps before and after');
});

test('edit the running shift start time', () => {
  const s = store.emptyState();
  store.startWork(s, NOW);
  const shift = store.activeShift(s);
  store.updateShift(s, shift.id, { ...shift, start: NOW - 20 * MINUTE }, NOW);
  assert.equal(store.activeShift(s).start, NOW - 20 * MINUTE);
  assert.equal(store.currentStatus(s, NOW), 'working');
});

test('edits that break the rules are refused with every reason', () => {
  const s = withYesterday();
  const shift = s.shifts[0];
  const err = (() => {
    try {
      store.updateShift(s, 'oct1', {
        ...shift,
        start: at(2026, 10, 1, 17),
        end: at(2026, 10, 1, 9),
        breaks: [{ start: at(2026, 10, 1, 18), end: at(2026, 10, 1, 17, 30) }],
      }, NOW);
    } catch (e) {
      return e;
    }
  })();
  assert.ok(err instanceof store.ValidationError);
  assert.ok(err.problems.some((p) => /end time must be after/.test(p)));
  assert.ok(err.problems.some((p) => /Break 1: the end must be after/.test(p)));
  // Nothing changed.
  assert.equal(s.shifts[0].start, at(2026, 10, 1, 8));
});

test('rules: breaks inside the shift, no overlapping breaks, no end in the future', () => {
  const base = { id: 'x', start: at(2026, 10, 1, 8), end: at(2026, 10, 1, 17), breaks: [] };
  const v = (changes) => store.validateShift({ ...base, ...changes }, [], NOW);
  assert.deepEqual(v({}), []);
  assert.match(v({ breaks: [{ start: at(2026, 10, 1, 7), end: at(2026, 10, 1, 9) }] })[0], /inside the shift/);
  assert.match(
    v({ breaks: [{ start: at(2026, 10, 1, 12), end: at(2026, 10, 1, 13) }, { start: at(2026, 10, 1, 12, 30), end: at(2026, 10, 1, 14) }] })[0],
    /overlaps break 2/,
  );
  assert.match(v({ end: NOW + HOUR })[0], /future/);
  assert.match(v({ start: NaN })[0], /start time/);
});

test('shifts that touch end-to-start are fine; overlapping ones are not', () => {
  const s = withYesterday();
  const touching = { id: 'y', start: at(2026, 10, 1, 17), end: at(2026, 10, 1, 18), breaks: [] };
  assert.deepEqual(store.validateShift(touching, s.shifts, NOW), []);
  const overlapping = { ...touching, start: at(2026, 10, 1, 16, 59) };
  assert.equal(store.validateShift(overlapping, s.shifts, NOW).length, 1);
});

test('very long shifts get a warning, not an error', () => {
  const shift = { start: at(2026, 10, 1, 6), end: at(2026, 10, 1, 23), breaks: [] };
  assert.deepEqual(store.validateShift(shift, [], NOW), []);
  assert.match(store.shiftWarnings(shift, NOW)[0], /17 hours/);
});

// ---- Add and delete ----

test('add a missed shift', () => {
  const s = withYesterday();
  s.jobs = [{ name: 'Tech', archived: false }];
  store.addShift(s, { job: '', start: at(2026, 9, 30, 8), end: at(2026, 9, 30, 16), breaks: [], note: '' }, NOW);
  assert.equal(s.shifts.length, 2);
  assert.equal(s.shifts[0].source, 'manual');
  assert.equal(s.shifts[0].job, 'Tech', 'blank job uses the default job');
  assert.throws(() => store.addShift(s, { start: at(2026, 9, 30, 9), end: at(2026, 9, 30, 10), breaks: [] }, NOW), /Overlaps/);
});

test('delete a shift and keep a copy in the log', () => {
  const s = withYesterday();
  store.deleteShift(s, 'oct1');
  assert.equal(s.shifts.length, 0);
  const entry = getLogs('warn').findLast((e) => e.event === 'shift.delete');
  assert.equal(entry.data.id, 'oct1');
  assert.equal(entry.data.breaks.length, 1);
});
