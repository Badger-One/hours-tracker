// The app's data and the actions that change it.
//
// All data lives in one object, saved on the device as JSON:
//
//   {
//     schema: 1,
//     shifts: [ { id, job, start, end, breaks: [ { start, end } ], note, source, importBatch? } ],
//     settings: { job },
//     lastImport: { batchId, at, count } | null
//   }
//
// `start` and `end` are epoch milliseconds. A shift or break with `end: null` is
// still running. At most one shift is running at a time.

import { log } from './logger.js';
import { newId } from './ids.js';

export const STORAGE_KEY = 'hours-tracker:data:v1';
const DEFAULT_JOB = 'Work';

export function emptyState() {
  return { schema: 1, shifts: [], settings: { job: '' }, lastImport: null };
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
    const state = { ...emptyState(), ...parsed, settings: { ...emptyState().settings, ...parsed.settings } };
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

/** The shift that is running right now, or null. */
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

/** 'off', 'working', or 'break'. */
export function currentStatus(state) {
  const shift = activeShift(state);
  if (!shift) return 'off';
  return activeBreak(shift) ? 'break' : 'working';
}

/** The job name new shifts get: the one in Settings, else the most recent shift's job, else "Work". */
export function effectiveJob(state) {
  if (state.settings.job?.trim()) return state.settings.job.trim();
  return state.shifts.at(-1)?.job || DEFAULT_JOB;
}

// ---- Actions. Each one checks it makes sense right now, changes `state`, and logs. ----

export function startWork(state, now) {
  if (activeShift(state)) throw new Error('You are already clocked in.');
  const shift = { id: newId(), job: effectiveJob(state), start: now, end: null, breaks: [], note: '', source: 'app' };
  state.shifts.push(shift);
  log.info('shift.start', { id: shift.id, job: shift.job, at: new Date(now).toISOString() });
  return shift;
}

export function startBreak(state, now) {
  const shift = activeShift(state);
  if (!shift) throw new Error('Start work before starting a break.');
  if (activeBreak(shift)) throw new Error('You are already on a break.');
  shift.breaks.push({ start: now, end: null });
  log.info('break.start', { shiftId: shift.id, breakNumber: shift.breaks.length, at: new Date(now).toISOString() });
}

export function endBreak(state, now) {
  const shift = activeShift(state);
  const brk = activeBreak(shift);
  if (!brk) throw new Error('You are not on a break.');
  brk.end = now;
  log.info('break.end', { shiftId: shift.id, breakNumber: shift.breaks.length, minutes: Math.round((now - brk.start) / 60000) });
}

/** Ends the running shift. If you are on a break, the break ends at the same moment. */
export function clockOut(state, now) {
  const shift = activeShift(state);
  if (!shift) throw new Error('You are not clocked in.');
  const brk = activeBreak(shift);
  if (brk) {
    brk.end = now;
    log.info('break.end', { shiftId: shift.id, breakNumber: shift.breaks.length, reason: 'clock-out' });
  }
  shift.end = now;
  log.info('shift.end', { id: shift.id, minutes: Math.round((now - shift.start) / 60000), breaks: shift.breaks.length });
}

/** Add the shifts from a reviewed import (see importers.js) and remember the batch so it can be undone. */
export function applyImport(state, result, now) {
  state.shifts.push(...result.shifts);
  state.shifts.sort((a, b) => a.start - b.start);
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
