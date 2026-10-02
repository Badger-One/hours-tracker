import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/store.js';
import { rateOn, hourlyShiftPay, salaryShare, groupPay, earnedToday, hasHourlyJob, formatMoney, describePay } from '../src/pay.js';

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const HOUR = 3600e3;
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.01, `${label}: ${actual} vs ${expected}`);

/** A state with one job and its pay, plus shifts given as [y, mo, d, startHour, hours]. */
function setup(pay, shifts, { job = 'Tech', weekStartsOn = 1 } = {}) {
  const s = store.emptyState();
  s.settings.weekStartsOn = weekStartsOn;
  s.jobs = [{ name: job, archived: false, pay }];
  shifts.forEach(([y, mo, d, h, hours], i) => s.shifts.push({ id: `s${i}`, job, start: at(y, mo, d, h), end: at(y, mo, d, h) + hours * HOUR, breaks: [] }));
  return s;
}
const hourly = (rates, overtime = { enabled: false }) => ({ type: 'hourly', rates, overtime });
const salary = (rates) => ({ type: 'salary', rates });
const NOW = at(2026, 10, 30, 12);

test('rateOn picks the latest rate that has started', () => {
  const pay = hourly([{ from: '2026-06-01', amount: 24 }, { from: '2026-01-01', amount: 22 }]);
  assert.equal(rateOn(pay, at(2025, 12, 31, 9)), null);
  assert.equal(rateOn(pay, at(2026, 3, 1, 9)), 22);
  assert.equal(rateOn(pay, at(2026, 6, 1, 0)), 24);
});

test('hourly pay without overtime', () => {
  const s = setup(hourly([{ from: '2026-01-01', amount: 20 }]), [[2026, 9, 28, 8, 8]]);
  near(hourlyShiftPay(s, NOW).get('s0').amount, 160, '8h at $20');
});

test('weekly overtime: hours past 40 in a week pay 1.5x', () => {
  const days = [28, 29, 30, 1, 2].map((d, i) => [2026, i < 3 ? 9 : 10, d, 8, 9]); // Mon to Fri, 9h each = 45h
  const s = setup(hourly([{ from: '2026-01-01', amount: 20 }], { enabled: true, threshold: 40, per: 'week', multiplier: 1.5 }), days);
  const pay = hourlyShiftPay(s, NOW);
  near([...pay.values()].reduce((a, p) => a + p.amount, 0), 40 * 20 + 5 * 30, 'week total');
  assert.equal(pay.get('s4').overtimeMs, 5 * HOUR);
  assert.equal(pay.get('s3').overtimeMs, 0);
});

test('overtime resets each week', () => {
  const s = setup(hourly([{ from: '2026-01-01', amount: 20 }], { enabled: true, threshold: 40, per: 'week', multiplier: 1.5 }),
    [[2026, 9, 27, 8, 41], [2026, 9, 28, 8, 8]]); // Sun (end of one week), Mon (next week)
  const pay = hourlyShiftPay(s, NOW);
  assert.equal(pay.get('s0').overtimeMs, 1 * HOUR);
  assert.equal(pay.get('s1').overtimeMs, 0);
});

test('daily overtime: hours past 8 in a day', () => {
  const s = setup(hourly([{ from: '2026-01-01', amount: 20 }], { enabled: true, threshold: 8, per: 'day', multiplier: 2 }), [[2026, 9, 28, 8, 10]]);
  near(hourlyShiftPay(s, NOW).get('s0').amount, 8 * 20 + 2 * 40, '10h with double time after 8');
});

test('a raise applies from its start date; earlier shifts keep the old rate', () => {
  const s = setup(hourly([{ from: '2026-01-01', amount: 20 }, { from: '2026-09-29', amount: 25 }]), [[2026, 9, 28, 8, 8], [2026, 9, 29, 8, 8]]);
  const pay = hourlyShiftPay(s, NOW);
  near(pay.get('s0').amount, 160, 'before raise');
  near(pay.get('s1').amount, 200, 'after raise');
});

test('shifts before the first rate earn nothing (no pay shown)', () => {
  const s = setup(hourly([{ from: '2026-10-01', amount: 20 }]), [[2026, 9, 28, 8, 8]]);
  assert.equal(hourlyShiftPay(s, NOW).has('s0'), false);
});

test('salary shares: 1/12 per month, 1/52 per week, all of it per year', () => {
  const pay = salary([{ from: '2026-01-01', amount: 80000 }]);
  near(salaryShare(pay, at(2026, 9, 1), at(2026, 10, 1), 'month'), 80000 / 12, 'September');
  near(salaryShare(pay, at(2026, 2, 1), at(2026, 3, 1), 'month'), 80000 / 12, 'February');
  near(salaryShare(pay, at(2026, 9, 28), at(2026, 10, 5), 'week'), 80000 / 52, 'a week');
  near(salaryShare(pay, at(2026, 1, 1), at(2027, 1, 1), 'year'), 80000, 'the year');
});

test('a salary raise partway through a month is split by days', () => {
  const pay = salary([{ from: '2026-01-01', amount: 60000 }, { from: '2026-09-16', amount: 90000 }]);
  near(salaryShare(pay, at(2026, 9, 1), at(2026, 10, 1), 'month'), (60000 / 12) * (15 / 30) + (90000 / 12) * (15 / 30), 'split September');
});

test('History group pay: salary share plus effective hourly rate', () => {
  const s = setup(salary([{ from: '2026-01-01', amount: 80000 }]), [[2026, 9, 1, 8, 80], [2026, 9, 15, 8, 80]]); // 160h in September
  const g = groupPay(s, s.shifts, at(2026, 9, 1), at(2026, 10, 1), 'month', hourlyShiftPay(s, NOW), NOW);
  assert.equal(g.hasPay, true);
  near(g.amount, 80000 / 12, 'September pay');
  near(g.effectiveRate, 80000 / 12 / 160, 'per hour worked');
});

test('History group pay for hourly has no effective rate line', () => {
  const s = setup(hourly([{ from: '2026-01-01', amount: 20 }]), [[2026, 9, 28, 8, 8]]);
  const g = groupPay(s, s.shifts, at(2026, 9, 1), at(2026, 10, 1), 'month', hourlyShiftPay(s, NOW), NOW);
  near(g.amount, 160, 'pay');
  assert.equal(g.effectiveRate, null);
});

test('a job with no pay set shows no pay', () => {
  const s = setup(undefined, [[2026, 9, 28, 8, 8]]);
  const g = groupPay(s, s.shifts, at(2026, 9, 1), at(2026, 10, 1), 'month', hourlyShiftPay(s, NOW), NOW);
  assert.equal(g.hasPay, false);
});

test('earned today, hourly: counts the running shift up to now', () => {
  const now = at(2026, 10, 2, 10);
  const s = setup(hourly([{ from: '2026-01-01', amount: 20 }]), []);
  s.shifts.push({ id: 'run', job: 'Tech', start: at(2026, 10, 2, 8), end: null, breaks: [] });
  const e = earnedToday(s, now, hourlyShiftPay(s, now));
  near(e.amount, 40, '2h at $20');
});

test('earned today leaves salaried jobs out', () => {
  const now = at(2026, 10, 2, 12);
  const s = setup(salary([{ from: '2026-01-01', amount: 60000 }]), []);
  s.shifts.push({ id: 'run', job: 'Tech', start: at(2026, 10, 2, 8), end: null, breaks: [] });
  assert.equal(earnedToday(s, now, hourlyShiftPay(s, now)).hasPay, false);
  assert.equal(hasHourlyJob(s), false);
  assert.equal(hasHourlyJob(setup(hourly([{ from: '2026-01-01', amount: 20 }]), [])), true);
});

test('formatting', () => {
  assert.equal(formatMoney(1234.5), '$1,234.50');
  assert.equal(formatMoney(6666.67, { cents: false }), '$6,667');
  assert.equal(describePay(hourly([{ from: '2026-01-01', amount: 24 }]), NOW), '$24.00/hr');
  assert.equal(describePay(salary([{ from: '2026-01-01', amount: 80000 }]), NOW), '$80,000/yr');
});

test('validatePay explains what to fix', async () => {
  const { validatePay } = await import('../src/pay.js');
  assert.deepEqual(validatePay(hourly([{ from: '2026-01-01', amount: 20 }])), []);
  assert.match(validatePay(hourly([]))[0], /at least one rate/);
  assert.match(validatePay(hourly([{ from: '2026-01-01', amount: 0 }]))[0], /above \$0/);
  assert.match(validatePay(hourly([{ from: '', amount: 20 }]))[0], /start date/);
  assert.match(validatePay(hourly([{ from: '2026-01-01', amount: 20 }, { from: '2026-01-01', amount: 22 }]))[0], /same day/);
  assert.match(validatePay(hourly([{ from: '2026-01-01', amount: 20 }], { enabled: true, threshold: 40, per: 'week', multiplier: 0.5 }))[0], /1 or more/);
});

test('renaming a job keeps its pay; setJobPay clears with null', async () => {
  const { renameJob, setJobPay } = await import('../src/jobs.js');
  const s = setup(hourly([{ from: '2026-01-01', amount: 20 }]), [[2026, 9, 28, 8, 8]]);
  renameJob(s, 'Tech', 'Help Desk');
  near(hourlyShiftPay(s, NOW).get('s0').amount, 160, 'still paid after rename');
  setJobPay(s, 'Help Desk', null);
  assert.equal(hourlyShiftPay(s, NOW).size, 0);
});

test('monthly salary (like military pay): each month shows exactly that amount', () => {
  const pay = { type: 'salary', per: 'month', rates: [{ from: '2026-01-01', amount: 4321.5 }] };
  near(salaryShare(pay, at(2026, 9, 1), at(2026, 10, 1), 'month'), 4321.5, 'September');
  near(salaryShare(pay, at(2026, 2, 1), at(2026, 3, 1), 'month'), 4321.5, 'February');
  near(salaryShare(pay, at(2026, 9, 28), at(2026, 10, 5), 'week'), (4321.5 * 12) / 52, 'a week');
  assert.equal(describePay(pay, NOW), '$4,321.50/mo');
});

test('no per-hour figure for a salary when under an hour was worked', () => {
  const s = setup(salary([{ from: '2026-01-01', amount: 80000 }]), [[2026, 9, 1, 8, 0.01]]);
  const g = groupPay(s, s.shifts, at(2026, 9, 1), at(2026, 10, 1), 'month', hourlyShiftPay(s, NOW), NOW);
  assert.equal(g.effectiveRate, null);
  assert.equal(g.hasPay, true);
});

test('the month in progress counts salary only through today', () => {
  const now = at(2026, 10, 2, 12); // Oct 2: 2 of 31 days
  const s = setup({ ...salary([{ from: '2026-01-01', amount: 4500 }]), per: 'month' }, [[2026, 10, 1, 8, 8], [2026, 10, 2, 8, 2]]);
  s.settings.weekStartsOn = 1;
  const g = groupPay(s, s.shifts, at(2026, 10, 1), at(2026, 11, 1), 'month', hourlyShiftPay(s, now), now);
  near(g.amount, (4500 * 12) / 12 / 31 * 2, 'two days of October');
  near(g.effectiveRate, ((4500 / 31) * 2) / 10, 'per hour over 10h');
});
