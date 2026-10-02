import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initLogger } from '../src/logger.js';
import * as store from '../src/store.js';
import { activeJobs, defaultJob, needsJobPick, addJob, renameJob, removeJob, jobsInShifts, FALLBACK_JOB } from '../src/jobs.js';

const at = (y, mo, d, h) => new Date(y, mo - 1, d, h).getTime();
const NOW = at(2026, 10, 2, 12);

before(() => initLogger({ console: false }));

function memoryStorage(data) {
  const map = new Map(data ? [[store.STORAGE_KEY, JSON.stringify(data)]] : []);
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
}

const shift = (job, d) => ({ id: `${job}-${d}`, job, start: at(2026, 9, d, 8), end: at(2026, 9, d, 16), breaks: [] });

test('saved data from before jobs gets a jobs list from its shifts', () => {
  const old = { schema: 1, shifts: [shift('Tech Support', 1), shift('Bartending', 3), shift('Tech Support', 2)], settings: { job: '' }, lastImport: null };
  const s = store.loadState(memoryStorage(old));
  assert.deepEqual(activeJobs(s), ['Bartending', 'Tech Support']); // most recently used first
  assert.equal(defaultJob(s), 'Bartending');
  assert.equal(s.settings.jobMode, 'default');
  assert.equal('job' in s.settings, false);
});

test('the old "job name for new shifts" setting becomes the default job', () => {
  const old = { schema: 1, shifts: [shift('Tech Support', 1)], settings: { job: 'Help Desk' }, lastImport: null };
  const s = store.loadState(memoryStorage(old));
  assert.deepEqual(activeJobs(s), ['Help Desk', 'Tech Support']);
  assert.equal(defaultJob(s), 'Help Desk');
});

test('a brand-new app uses "Work" and adds it on the first Start Work', () => {
  const s = store.emptyState();
  assert.equal(defaultJob(s), FALLBACK_JOB);
  store.startWork(s, NOW);
  assert.deepEqual(activeJobs(s), ['Work']);
});

test('Start Work uses the default job, or the one passed in', () => {
  const s = store.emptyState();
  addJob(s, 'Tech Support');
  addJob(s, 'Bartending');
  store.startWork(s, NOW);
  assert.equal(store.activeShift(s).job, 'Tech Support');
  store.clockOut(s, NOW + 3600e3 * 2, NOW + 3600e3);
  store.startWork(s, NOW + 3600e3 * 2, NOW + 3600e3 * 2, 'Bartending');
  assert.equal(store.activeShift(s).job, 'Bartending');
});

test('the picker only appears in "ask" mode with 2 or more jobs', () => {
  const s = store.emptyState();
  addJob(s, 'Tech Support');
  s.settings.jobMode = 'ask';
  assert.equal(needsJobPick(s), false);
  addJob(s, 'Bartending');
  assert.equal(needsJobPick(s), true);
  s.settings.jobMode = 'default';
  assert.equal(needsJobPick(s), false);
});

test('job names must be filled in and unique (ignoring capitals)', () => {
  const s = store.emptyState();
  addJob(s, 'Tech Support');
  assert.throws(() => addJob(s, '  '), /Type a name/);
  assert.throws(() => addJob(s, 'tech support'), /already have a job/);
});

test('renaming a job renames it on every shift and keeps it the default', () => {
  const s = store.emptyState();
  s.shifts.push(shift('Tech Support', 1), shift('Tech Support', 2), shift('Bartending', 3));
  addJob(s, 'Tech Support');
  addJob(s, 'Bartending');
  assert.equal(renameJob(s, 'Tech Support', 'Help Desk'), 2);
  assert.deepEqual(s.shifts.map((x) => x.job), ['Help Desk', 'Help Desk', 'Bartending']);
  assert.equal(defaultJob(s), 'Help Desk');
  assert.throws(() => renameJob(s, 'Help Desk', 'bartending'), /already have a job/);
});

test('removing a job with shifts hides it; without shifts deletes it; one job always stays', () => {
  const s = store.emptyState();
  s.shifts.push(shift('Tech Support', 1));
  addJob(s, 'Tech Support');
  addJob(s, 'Bartending');
  addJob(s, 'Dog Walking');
  assert.equal(removeJob(s, 'Dog Walking'), 'deleted');
  assert.equal(removeJob(s, 'Tech Support'), 'hidden');
  assert.deepEqual(activeJobs(s), ['Bartending']);
  assert.equal(defaultJob(s), 'Bartending');
  assert.equal(s.shifts[0].job, 'Tech Support', 'history keeps its job');
  assert.throws(() => removeJob(s, 'Bartending'), /at least one job/);
  // Adding a hidden job's name brings it back.
  addJob(s, 'tech support');
  assert.deepEqual(activeJobs(s), ['Tech Support', 'Bartending']);
});

test('importing shifts adds their jobs to the list', async () => {
  const { importFiles } = await import('../src/importers.js');
  const s = store.emptyState();
  const csv = '"Job","Clocked In","Clocked Out","Duration","Breaks"\n"Bartending","9/29/25 7:00 PM","9/29/25 11:00 PM","4:00",""\n';
  store.applyImport(s, importFiles([{ name: 'x.csv', text: csv }], s.shifts), NOW);
  assert.deepEqual(activeJobs(s), ['Bartending']);
});

test('jobsInShifts lists each job once', () => {
  assert.deepEqual(jobsInShifts([shift('A', 1), shift('B', 2), shift('a', 3)]), ['A', 'B']);
});

test('undoing an import also removes jobs it created that have no shifts left', async () => {
  const { importFiles } = await import('../src/importers.js');
  const { readFileSync } = await import('node:fs');
  const s = store.emptyState();
  addJob(s, 'Tech Support');
  const text = readFileSync(new URL('./fixtures/undo-test.csv', import.meta.url), 'utf8');
  store.applyImport(s, importFiles([{ name: 'undo-test.csv', text }], s.shifts), NOW);
  assert.equal(s.shifts.length, 3);
  assert.deepEqual(activeJobs(s), ['Tech Support', 'Undo Test']);
  assert.equal(store.undoLastImport(s), 3);
  assert.deepEqual(activeJobs(s), ['Tech Support']);
  assert.equal(defaultJob(s), 'Tech Support');
});

test('undo keeps a job the import created if you have since used it', async () => {
  const { importFiles } = await import('../src/importers.js');
  const csv = '"Job","Clocked In","Clocked Out","Duration","Breaks"\n"Bartending","9/29/25 7:00 PM","9/29/25 11:00 PM","4:00",""\n';
  const s = store.emptyState();
  store.applyImport(s, importFiles([{ name: 'x.csv', text: csv }], s.shifts), NOW);
  store.startWork(s, NOW, NOW, 'Bartending');
  store.undoLastImport(s);
  assert.deepEqual(activeJobs(s), ['Bartending']);
});
