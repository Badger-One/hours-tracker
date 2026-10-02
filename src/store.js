// The app's data and the actions that change it.
//
// All data lives in one object, saved on the device as JSON:
//
//   {
//     schema: 1,
//     shifts: [ { id, job, start, end, breaks: [ { start, end } ], note, source, importBatch?, editedAt? } ],
//     jobs: [ { name, archived } ],      // see jobs.js
//     settings: { weekStartsOn, jobMode, defaultJob },   // weekStartsOn: 0 = Sunday, 1 = Monday; jobMode: 'default' | 'ask'
//     lastImport: { batchId, at, count } | null,
//     backup: { lastAt, hiddenOn }   // lastAt: ms of the last backup; hiddenOn: "2026-10-02" if the banner was hidden that day
//   }
//
// `start` and `end` are epoch milliseconds. A shift or break with `end: null` is
// still running. At most one shift is running at a time. A running shift whose
// start is in the future is "scheduled": it starts counting on its own at that time.
//
// Rules every shift must follow live in validateShift(). Each action checks them,
// so bad data can't be saved no matter which button changed it.

import { log } from './logger.js';
import { newId } from './ids.js';
import { storageKey } from './env.js';
import { HOUR, MINUTE, formatDayHeading, formatTimeOfDay, formatWhen } from './time.js';
import { migrateJobs, defaultJob, rememberJobs } from './jobs.js';

export const STORAGE_KEY = storageKey('data:v1');
export const MAX_SCHEDULE_AHEAD_MS = 24 * HOUR;
export const LONG_SHIFT_MS = 16 * HOUR;

export function emptyState() {
  return {
    schema: 1,
    shifts: [],
    jobs: [],
    settings: { weekStartsOn: 1, jobMode: 'default', defaultJob: null },
    lastImport: null,
    backup: { lastAt: null, hiddenOn: null },
  };
}

/** Read saved data. If it is damaged, keep a copy for recovery and start empty instead of crashing. */
export function loadState(storage) {
  const raw = storage?.getItem(STORAGE_KEY);
  if (!raw) {
    log.info('store.load.empty');
    return emptyState();
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.shifts)) throw new Error('Saved data has no shifts list');
    const defaults = emptyState();
    const state = { ...defaults, ...parsed, settings: { ...defaults.settings, ...parsed.settings }, backup: { ...defaults.backup, ...parsed.backup } };
    if (!Array.isArray(parsed.jobs)) {
      delete state.jobs;
      migrateJobs(state);
    }
    log.info('store.load.ok', { shifts: state.shifts.length, bytes: raw.length });
    return state;
  } catch (error) {
    const backupKey = `${STORAGE_KEY}:damaged:${Date.now()}`;
    try {
      storage.setItem(backupKey, raw);
    } catch {
      // Nothing more we can do; the error below still records what happened.
    }
    log.error('store.load.damaged', { error, backupKey, bytes: raw.length });
    return emptyState();
  }
}

/** Save data. Returns false (and logs why) if the device refused, so the screen can warn you. */
export function saveState(storage, state) {
  try {
    const raw = JSON.stringify(state);
    storage.setItem(STORAGE_KEY, raw);
    log.debug('store.save', { shifts: state.shifts.length, bytes: raw.length });
    return true;
  } catch (error) {
    log.error('store.save.failed', { error });
    return false;
  }
}

/** The shift that is running (or scheduled) right now, or null. */
export function activeShift(state) {
  for (let i = state.shifts.length - 1; i >= 0; i--) {
    if (state.shifts[i].end == null) return state.shifts[i];
  }
  return null;
}

/** The break that is running right now inside `shift`, or null. */
export function activeBreak(shift) {
  const last = shift?.breaks.at(-1);
  return last && last.end == null ? last : null;
}

/** 'off', 'scheduled', 'working', or 'break'. */
export function currentStatus(state, now = Date.now()) {
  const shift = activeShift(state);
  if (!shift) return 'off';
  if (shift.start > now) return 'scheduled';
  return activeBreak(shift) ? 'break' : 'working';
}

export function findShift(state, id) {
  return state.shifts.find((s) => s.id === id) ?? null;
}

// ---- Rules ----

/** An error whose message lists every rule a change broke, one per line. */
export class ValidationError extends Error {
  constructor(problems) {
    super(problems.join('\n'));
    this.name = 'ValidationError';
    this.problems = problems;
  }
}

function describeShift(s) {
  const end = s.end == null ? 'now' : formatTimeOfDay(s.end);
  return `${formatDayHeading(s.start)} (${formatTimeOfDay(s.start)} to ${end})`;
}

/**
 * Every rule a shift must follow. Returns a list of problems in plain English;
 * an empty list means the shift is fine.
 *
 * @param shift   the shift as it would be saved
 * @param others  every other shift (used to catch overlaps)
 */
export function validateShift(shift, others, now) {
  const problems = [];
  const { start, end, breaks } = shift;
  const running = end == null;

  if (!Number.isFinite(start)) return ['Set a start time.'];
  if (!running && !Number.isFinite(end)) return ['Set an end time.'];

  if (!running && end <= start) problems.push('The end time must be after the start time.');
  if (!running && end > now + MINUTE) problems.push('The end time is in the future. Use Clock Out when you finish.');
  if (running && start > now + MAX_SCHEDULE_AHEAD_MS) problems.push('You can schedule a start up to 24 hours ahead.');
  if (running && start > now && breaks.length) problems.push('A shift that hasn\'t started yet can\'t have breaks.');

  const shiftEnd = running ? Math.max(now, start) : end;
  breaks.forEach((b, i) => {
    const n = `Break ${i + 1}`;
    if (!Number.isFinite(b.start)) return problems.push(`${n}: set a start time.`);
    const isLast = i === breaks.length - 1;
    if (b.end == null) {
      if (!running || !isLast) problems.push(`${n}: set an end time.`);
    } else if (!Number.isFinite(b.end)) {
      problems.push(`${n}: set an end time.`);
    } else if (b.end <= b.start) {
      problems.push(`${n}: the end must be after the start.`);
    }
    const bEnd = b.end ?? now;
    if (b.start < start || bEnd > shiftEnd) problems.push(`${n} must be inside the shift.`);
    const next = breaks[i + 1];
    if (next && b.end != null && next.start < b.end) problems.push(`${n} overlaps break ${i + 2}.`);
  });

  for (const other of others) {
    if (other.end == null && running) {
      problems.push('Only one shift can be running at a time.');
      continue;
    }
    const otherEnd = other.end ?? Math.max(now, other.start);
    if (start < otherEnd && other.start < shiftEnd) problems.push(`Overlaps your shift on ${describeShift(other)}.`);
  }
  return problems;
}

/** Things that are allowed but probably a mistake. Shown as a heads-up, never blocks saving. */
export function shiftWarnings(shift, now) {
  const warnings = [];
  const length = (shift.end ?? now) - shift.start;
  if (length > LONG_SHIFT_MS) warnings.push(`This shift is ${Math.floor(length / HOUR)} hours long.`);
  return warnings;
}

function assertValid(shift, state, now) {
  const others = state.shifts.filter((s) => s.id !== shift.id);
  const problems = validateShift(shift, others, now);
  if (problems.length) throw new ValidationError(problems);
}

/** Readable copy of a shift for the debug log. */
function forLog(s) {
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
  return {
    id: s.id,
    job: s.job,
    start: iso(s.start),
    end: iso(s.end),
    breaks: s.breaks.map((b) => [iso(b.start), iso(b.end)]),
    note: s.note,
  };
}

function sortShifts(state) {
  state.shifts.sort((a, b) => a.start - b.start);
}

// ---- Clock actions. `at` defaults to now; pass a different time for "Start at…", "Clock out at…" and so on. ----

/** `job` defaults to the default job; the screen passes the one you picked when it asks. */
export function startWork(state, now, at = now, job = defaultJob(state)) {
  if (activeShift(state)) throw new Error('You are already clocked in.');
  const shift = { id: newId(), job, start: at, end: null, breaks: [], note: '', source: 'app' };
  assertValid(shift, state, now);
  state.shifts.push(shift);
  rememberJobs(state, [shift]);
  sortShifts(state);
  log.info(at > now ? 'shift.schedule' : 'shift.start', {
    id: shift.id,
    job: shift.job,
    at: new Date(at).toISOString(),
    offsetMinutes: Math.round((at - now) / MINUTE),
  });
  return shift;
}

/** For a scheduled shift: start counting right now instead. */
export function startScheduledNow(state, now) {
  const shift = activeShift(state);
  if (!shift || shift.start <= now) throw new Error('There is no scheduled shift.');
  log.info('shift.schedule.startNow', { id: shift.id, wasScheduledFor: new Date(shift.start).toISOString() });
  shift.start = now;
}

export function startBreak(state, now, at = now) {
  const shift = activeShift(state);
  if (!shift) throw new Error('Start work before starting a break.');
  if (shift.start > now) throw new Error('Your shift hasn\'t started yet.');
  if (activeBreak(shift)) throw new Error('You are already on a break.');
  const lastEnd = shift.breaks.at(-1)?.end ?? shift.start;
  if (at < lastEnd) throw new Error(`The break can't start before ${formatWhen(lastEnd, now)}.`);
  if (at > now) throw new Error('A break can\'t start in the future.');
  shift.breaks.push({ start: at, end: null });
  log.info('break.start', { shiftId: shift.id, breakNumber: shift.breaks.length, at: new Date(at).toISOString(), offsetMinutes: Math.round((at - now) / MINUTE) });
}

export function endBreak(state, now, at = now) {
  const shift = activeShift(state);
  const brk = activeBreak(shift);
  if (!brk) throw new Error('You are not on a break.');
  if (at <= brk.start) throw new Error(`The break started at ${formatWhen(brk.start, now)}. Pick a later time.`);
  if (at > now) throw new Error('A break can\'t end in the future.');
  brk.end = at;
  log.info('break.end', { shiftId: shift.id, breakNumber: shift.breaks.length, minutes: Math.round((at - brk.start) / MINUTE), offsetMinutes: Math.round((at - now) / MINUTE) });
}

/** Ends the running shift. If you are on a break, the break ends at the same moment. */
export function clockOut(state, now, at = now) {
  const shift = activeShift(state);
  if (!shift) throw new Error('You are not clocked in.');
  if (shift.start > now) throw new Error('Your shift hasn\'t started yet. Cancel it instead.');
  const brk = activeBreak(shift);
  const earliest = brk ? brk.start : shift.breaks.at(-1)?.end ?? shift.start;
  if (at <= earliest) throw new Error(`Pick a time after ${formatWhen(earliest, now)}.`);
  if (at > now) throw new Error('You can\'t clock out in the future.');
  if (brk) {
    brk.end = at;
    log.info('break.end', { shiftId: shift.id, breakNumber: shift.breaks.length, reason: 'clock-out' });
  }
  shift.end = at;
  log.info('shift.end', { id: shift.id, minutes: Math.round((at - shift.start) / MINUTE), breaks: shift.breaks.length, offsetMinutes: Math.round((at - now) / MINUTE) });
}

// ---- Editing ----

/**
 * Replace a shift's details with `draft` ({ job, start, end, breaks, note }).
 * Works for past shifts and the running one. Throws ValidationError if a rule is broken.
 */
export function updateShift(state, id, draft, now) {
  const shift = findShift(state, id);
  if (!shift) throw new Error('That shift no longer exists.');
  const updated = {
    ...shift,
    job: draft.job?.trim() || shift.job,
    start: draft.start,
    end: draft.end,
    breaks: [...draft.breaks].sort((a, b) => a.start - b.start),
    note: draft.note ?? '',
  };
  assertValid(updated, state, now);
  const before = forLog(shift);
  Object.assign(shift, updated, { editedAt: now });
  sortShifts(state);
  log.info('shift.edit', { id, before, after: forLog(shift) });
  return shift;
}

/** Add a finished shift you forgot to track. Throws ValidationError if a rule is broken. */
export function addShift(state, draft, now) {
  const shift = {
    id: newId(),
    job: draft.job?.trim() || defaultJob(state),
    start: draft.start,
    end: draft.end,
    breaks: [...draft.breaks].sort((a, b) => a.start - b.start),
    note: draft.note ?? '',
    source: 'manual',
  };
  if (shift.end == null) throw new ValidationError(['Set an end time.']);
  assertValid(shift, state, now);
  state.shifts.push(shift);
  sortShifts(state);
  log.info('shift.add', forLog(shift));
  return shift;
}

/** Remove a shift. The full shift goes into the debug log so it can be recovered by hand. */
export function deleteShift(state, id) {
  const shift = findShift(state, id);
  if (!shift) throw new Error('That shift no longer exists.');
  state.shifts = state.shifts.filter((s) => s.id !== id);
  log.warn('shift.delete', forLog(shift));
}

// ---- Import ----

/** Add the shifts from a reviewed import (see importers.js) and remember the batch so it can be undone. */
export function applyImport(state, result, now) {
  state.shifts.push(...result.shifts);
  sortShifts(state);
  rememberJobs(state, result.shifts);
  state.lastImport = { batchId: result.batchId, at: now, count: result.shifts.length };
  log.info('import.applied', { batchId: result.batchId, added: result.shifts.length, totalShifts: state.shifts.length });
}

/** Remove every shift added by the most recent import. Returns how many were removed. */
export function undoLastImport(state) {
  const batch = state.lastImport?.batchId;
  if (!batch) return 0;
  const before = state.shifts.length;
  state.shifts = state.shifts.filter((s) => s.importBatch !== batch);
  const removed = before - state.shifts.length;
  state.lastImport = null;
  log.info('import.undone', { batchId: batch, removed });
  return removed;
}
