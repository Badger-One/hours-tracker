// Jobs: the list of places you work, and which one a new shift goes to.
//
// Saved in the app's data as:
//   jobs: [ { name, archived } ]
//   settings.jobMode: 'default' (always use settings.defaultJob) or 'ask' (pick on Start Work)
//   settings.defaultJob: a job name
//
// Each shift stores its job by name (shift.job), which keeps CSV export and import
// simple. Renaming a job renames it on every shift too. A job that has shifts can't
// be deleted, only hidden ("archived"), so its history stays intact.

import { log } from './logger.js';

export const FALLBACK_JOB = 'Work';

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Data saved before jobs existed has no jobs list. Build one from the job names on
 * past shifts (most recently used first) and the old single "job name" setting.
 */
export function migrateJobs(state) {
  if (Array.isArray(state.jobs)) return;
  const names = [];
  const add = (name) => {
    const n = name?.trim();
    if (n && !names.some((x) => sameName(x, n))) names.push(n);
  };
  add(state.settings.job);
  for (const s of [...state.shifts].sort((a, b) => b.start - a.start)) add(s.job);
  state.jobs = names.map((name) => ({ name, archived: false }));
  state.settings.defaultJob ??= names[0] ?? null;
  state.settings.jobMode ??= 'default';
  delete state.settings.job;
  log.info('jobs.migrated', { jobs: names });
}

export function activeJobs(state) {
  return state.jobs.filter((j) => !j.archived).map((j) => j.name);
}

/** The job a new shift gets when the app doesn't ask. */
export function defaultJob(state) {
  const active = activeJobs(state);
  const chosen = state.settings.defaultJob;
  if (chosen && active.some((n) => sameName(n, chosen))) return active.find((n) => sameName(n, chosen));
  return active[0] ?? FALLBACK_JOB;
}

/** True when Start Work should show the job picker. Never with fewer than 2 jobs. */
export function needsJobPick(state) {
  return state.settings.jobMode === 'ask' && activeJobs(state).length >= 2;
}

function findJob(state, name) {
  return state.jobs.find((j) => sameName(j.name, name)) ?? null;
}

/** Add a job. Adding the name of a hidden job brings it back. */
export function addJob(state, rawName) {
  const name = rawName?.trim();
  if (!name) throw new Error('Type a name for the job.');
  const existing = findJob(state, name);
  if (existing && !existing.archived) throw new Error(`You already have a job called "${existing.name}".`);
  if (existing) {
    existing.archived = false;
    log.info('jobs.restore', { name: existing.name });
    return existing.name;
  }
  state.jobs.push({ name, archived: false });
  if (!state.settings.defaultJob) state.settings.defaultJob = name;
  log.info('jobs.add', { name });
  return name;
}

/** Rename a job everywhere: the jobs list, the default, and every shift. Returns how many shifts changed. */
export function renameJob(state, oldName, rawNewName) {
  const job = findJob(state, oldName);
  if (!job) throw new Error('That job no longer exists.');
  const name = rawNewName?.trim();
  if (!name) throw new Error('Type a name for the job.');
  const clash = findJob(state, name);
  if (clash && clash !== job) throw new Error(`You already have a job called "${clash.name}".`);
  let shifts = 0;
  for (const s of state.shifts) {
    if (sameName(s.job ?? '', job.name)) {
      s.job = name;
      shifts++;
    }
  }
  if (state.settings.defaultJob && sameName(state.settings.defaultJob, job.name)) state.settings.defaultJob = name;
  log.info('jobs.rename', { from: job.name, to: name, shifts });
  job.name = name;
  return shifts;
}

/**
 * Remove a job. With no shifts it's deleted; with shifts it's hidden from the job
 * pickers but kept in History. Returns 'deleted' or 'hidden'. You always keep at least one job.
 */
export function removeJob(state, name) {
  const job = findJob(state, name);
  if (!job) throw new Error('That job no longer exists.');
  if (activeJobs(state).length <= 1 && !job.archived) throw new Error('You need at least one job.');
  const used = state.shifts.some((s) => sameName(s.job ?? '', job.name));
  if (used) {
    job.archived = true;
  } else {
    state.jobs = state.jobs.filter((j) => j !== job);
  }
  if (state.settings.defaultJob && sameName(state.settings.defaultJob, job.name)) state.settings.defaultJob = activeJobs(state)[0] ?? null;
  const result = used ? 'hidden' : 'deleted';
  log.info('jobs.remove', { name: job.name, result });
  return result;
}

/** Make sure every job name on these shifts is in the list (used after an import and on Start Work). */
export function rememberJobs(state, shifts) {
  for (const s of shifts) {
    if (s.job && !findJob(state, s.job)) {
      state.jobs.push({ name: s.job, archived: false });
      if (!state.settings.defaultJob) state.settings.defaultJob = s.job;
      log.info('jobs.add', { name: s.job, reason: 'seen on a shift' });
    }
  }
}

/** Every job name that appears on a shift, for the History filter. */
export function jobsInShifts(shifts) {
  const names = [];
  for (const s of shifts) if (s.job && !names.some((n) => sameName(n, s.job))) names.push(s.job);
  return names;
}
