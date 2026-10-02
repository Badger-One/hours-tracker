// Pay: hourly rates (with overtime) and salaries, both with raises over time.
//
// Each job can have a pay setup, saved on the job:
//   pay: {
//     type: 'hourly' | 'salary',
//     rates: [ { from: '2026-01-01', amount } ],   // $/hour, or for a salary $/year or $/month (see per), each from that day on
//     per: 'year' | 'month',                                               // salary only; month suits fixed monthly pay like military pay
//     overtime: { enabled, threshold, per: 'week' | 'day', multiplier },   // hourly only
//     expectedWeeklyHours,                                                 // salary only
//   }
//
// Old shifts keep the rate that applied on the day they started, so a raise never
// changes past pay. All amounts are plain dollars (numbers); they're rounded only
// when shown.

import { HOUR, workedMs, startOfDay, startOfNextDay, formatDate } from './time.js';
import { startOfWeek } from './history.js';

export const DEFAULT_OVERTIME = { enabled: true, threshold: 40, per: 'week', multiplier: 1.5 };
export const DEFAULT_EXPECTED_WEEKLY_HOURS = 40;

const sameName = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** The pay setup for a job name, or null if it has none. */
export function payForJob(state, name) {
  const job = state.jobs.find((j) => sameName(j.name, name));
  return job?.pay?.type && job.pay.rates?.length ? job.pay : null;
}

/** The rate that applies on the day containing `ms`, or null if it's before the first rate. */
export function rateOn(pay, ms) {
  const day = formatDate(ms);
  let rate = null;
  for (const r of [...pay.rates].sort((a, b) => a.from.localeCompare(b.from))) {
    if (r.from <= day) rate = r.amount;
  }
  return rate;
}

/** A salary rate as dollars per year: a monthly amount times 12. */
export function annualAmount(pay, amount) {
  return pay.per === 'month' ? amount * 12 : amount;
}

/** The yearly salary on the day containing `ms`, or null. */
function annualOn(pay, ms) {
  const rate = rateOn(pay, ms);
  return rate == null ? null : annualAmount(pay, rate);
}

/** The hourly rate a salary works out to at the expected hours: $80,000 at 40 h/week is $38.46/h. */
export function salaryHourlyPace(annual, expectedWeeklyHours) {
  return annual / (52 * (expectedWeeklyHours || DEFAULT_EXPECTED_WEEKLY_HOURS));
}

/**
 * Pay for every hourly shift: Map of shift id -> { amount, regularMs, overtimeMs }.
 * Overtime counts hours within each week (or day) per job, in the order they were
 * worked, so it has to look at all shifts, not just the ones on screen.
 */
export function hourlyShiftPay(state, now) {
  const result = new Map();
  const weekStartsOn = state.settings.weekStartsOn ?? 1;
  for (const job of state.jobs) {
    const pay = payForJob(state, job.name);
    if (pay?.type !== 'hourly') continue;
    const ot = pay.overtime?.enabled ? pay.overtime : null;
    const shifts = state.shifts.filter((s) => sameName(s.job, job.name) && s.start <= now).sort((a, b) => a.start - b.start);
    let bucket = null;
    let used = 0;
    for (const s of shifts) {
      const worked = workedMs(s, now);
      const rate = rateOn(pay, s.start);
      if (rate == null) continue;
      let regular = worked;
      let overtime = 0;
      if (ot) {
        const key = ot.per === 'day' ? startOfDay(s.start) : startOfWeek(s.start, weekStartsOn);
        if (key !== bucket) {
          bucket = key;
          used = 0;
        }
        regular = Math.min(worked, Math.max(0, ot.threshold * HOUR - used));
        overtime = worked - regular;
        used += worked;
      }
      const amount = (regular / HOUR) * rate + (overtime / HOUR) * rate * (ot?.multiplier ?? 1);
      result.set(s.id, { amount, regularMs: regular, overtimeMs: overtime });
    }
  }
  return result;
}

/** Each calendar day in [from, to), as the ms of its midnight. */
function eachDay(from, to) {
  const days = [];
  for (let d = startOfDay(from); d < to; d = startOfNextDay(d)) days.push(d);
  return days;
}

function daysInMonth(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * A salary's share of a period. Weeks get 1/52 of the yearly salary, months 1/12,
 * years all of it; a raise partway through is split by days. Days before the first
 * rate earn nothing.
 */
export function salaryShare(pay, from, to, kind) {
  let total = 0;
  for (const day of eachDay(from, to)) {
    const annual = annualOn(pay, day);
    if (annual == null) continue;
    total += kind === 'week' ? annual / 52 / 7 : annual / 12 / daysInMonth(day);
  }
  return total;
}

/**
 * Pay for one History group (a year, month, or week).
 * @param shifts   the shifts shown in that group
 * @param from,to  the group's dates; kind is 'year' | 'month' | 'week'
 * @returns { amount, hasPay, effectiveRate } where effectiveRate (pay per hour worked)
 *          is set only when a salary is involved.
 */
export function groupPay(state, shifts, from, to, kind, hourlyPay, now) {
  let amount = 0;
  let hasPay = false;
  let paidMs = 0;
  const salaryJobs = new Set();
  for (const s of shifts) {
    const pay = payForJob(state, s.job);
    if (!pay) continue;
    if (pay.type === 'hourly') {
      const p = hourlyPay.get(s.id);
      if (!p) continue;
      amount += p.amount;
      paidMs += workedMs(s, now);
      hasPay = true;
    } else {
      salaryJobs.add(state.jobs.find((j) => sameName(j.name, s.job)).name);
      paidMs += workedMs(s, now);
    }
  }
  for (const name of salaryJobs) {
    // A period still in progress (this week, month, or year) counts salary only through today.
    const share = salaryShare(payForJob(state, name), from, Math.min(to, startOfNextDay(now)), kind);
    if (share > 0) {
      amount += share;
      hasPay = true;
    }
  }
  // Under an hour worked, "per hour" is meaningless (seconds of work would show millions), so skip it.
  const effectiveRate = salaryJobs.size && paidMs >= HOUR ? amount / (paidMs / HOUR) : null;
  return { amount, hasPay, effectiveRate };
}

/**
 * What you've earned today, for the Clock tab.
 * Hourly: each of today's shifts at its rate, with overtime.
 * Salary: earns at the salary's hourly pace until you reach your expected hours for
 * the week, then stops; \`salaryRate\` is then what the week's pay works out to per
 * hour you've actually worked, which drops the longer you work.
 */
export function earnedToday(state, now, hourlyPay) {
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now, state.settings.weekStartsOn ?? 1);
  let amount = 0;
  let hasPay = false;
  let salaryRate = null;

  for (const s of state.shifts) {
    if (s.start < dayStart || s.start > now) continue;
    const p = hourlyPay.get(s.id);
    if (p) {
      amount += p.amount;
      hasPay = true;
    }
  }

  for (const job of state.jobs) {
    const pay = payForJob(state, job.name);
    if (pay?.type !== 'salary') continue;
    const annual = annualOn(pay, now);
    if (annual == null) continue;
    const expected = (pay.expectedWeeklyHours || DEFAULT_EXPECTED_WEEKLY_HOURS) * HOUR;
    const pace = salaryHourlyPace(annual, pay.expectedWeeklyHours);
    const weekShifts = state.shifts.filter((s) => sameName(s.job, job.name));
    const workedUpTo = (t) => weekShifts.reduce((sum, s) => sum + workedMs(s, now, weekStart, t), 0);
    const weekSoFar = workedUpTo(now);
    if (weekSoFar === 0) continue;
    const beforeToday = workedUpTo(dayStart);
    amount += ((Math.min(weekSoFar, expected) - Math.min(beforeToday, expected)) / HOUR) * pace;
    hasPay = true;
    salaryRate = weekSoFar > expected ? (annual / 52) / (weekSoFar / HOUR) : pace;
  }
  return { amount, hasPay, salaryRate };
}

/** "$1,234.56", or "$1,235" with cents: false. */
export function formatMoney(amount, { cents = true } = {}) {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

/** "$24.00/hr" or "$80,000/yr" for the current rate, or "" if none yet. */
export function describePay(pay, now) {
  if (!pay) return '';
  const rate = rateOn(pay, now) ?? [...pay.rates].sort((a, b) => a.from.localeCompare(b.from))[0]?.amount;
  if (rate == null) return '';
  if (pay.type === 'hourly') return `${formatMoney(rate)}/hr`;
  return pay.per === 'month' ? `${formatMoney(rate)}/mo` : `${formatMoney(rate, { cents: false })}/yr`;
}

/** Problems with a pay setup from the editor, in plain English. Empty means it can be saved. */
export function validatePay(pay) {
  if (!pay) return [];
  const problems = [];
  if (!pay.rates.length) problems.push('Add at least one rate.');
  const days = new Set();
  pay.rates.forEach((r, i) => {
    const n = pay.rates.length > 1 ? `Rate ${i + 1}: ` : '';
    if (!(r.amount > 0)) problems.push(`${n}enter an amount above $0.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.from ?? '')) problems.push(`${n}pick a start date.`);
    else if (days.has(r.from)) problems.push(`${n}two rates start on the same day.`);
    days.add(r.from);
  });
  if (pay.type === 'hourly' && pay.overtime?.enabled) {
    if (!(pay.overtime.threshold > 0)) problems.push('Overtime: enter the hours it starts after.');
    if (!(pay.overtime.multiplier >= 1)) problems.push('Overtime: the multiplier must be 1 or more (1.5 is time and a half).');
  }
  if (pay.type === 'salary' && !(pay.expectedWeeklyHours > 0)) problems.push('Enter your expected hours per week.');
  return problems;
}
