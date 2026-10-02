import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initLogger } from '../src/logger.js';
import { backupDue, recordBackup, dismissBackupForToday } from '../src/backup.js';
import * as store from '../src/store.js';

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const TODAY_9AM = at(2026, 10, 2, 9);

before(() => initLogger({ console: false }));

function withAShift() {
  const s = store.emptyState();
  s.shifts.push({ id: 'a', start: at(2026, 10, 1, 8), end: at(2026, 10, 1, 17), breaks: [] });
  return s;
}

test('the banner shows when there are shifts and no backup today', () => {
  assert.equal(backupDue(withAShift(), TODAY_9AM), true);
});

test('nothing to back up: no banner', () => {
  assert.equal(backupDue(store.emptyState(), TODAY_9AM), false);
  const onlyRunning = store.emptyState();
  onlyRunning.shifts.push({ id: 'r', start: TODAY_9AM - 3600e3, end: null, breaks: [] });
  assert.equal(backupDue(onlyRunning, TODAY_9AM), false);
});

test('a backup today hides the banner until tomorrow', () => {
  const s = withAShift();
  recordBackup(s, TODAY_9AM, { shifts: 1, how: 'shared', from: 'banner' });
  assert.equal(backupDue(s, at(2026, 10, 2, 23, 59)), false);
  assert.equal(backupDue(s, at(2026, 10, 3, 0, 1)), true);
});

test('hiding the banner lasts until tomorrow', () => {
  const s = withAShift();
  dismissBackupForToday(s, TODAY_9AM);
  assert.equal(backupDue(s, at(2026, 10, 2, 18)), false);
  assert.equal(backupDue(s, at(2026, 10, 3, 7)), true);
});

test('data saved before backups existed loads with empty backup info', () => {
  const data = new Map([[store.STORAGE_KEY, JSON.stringify({ schema: 1, shifts: [], settings: { job: '' }, lastImport: null })]]);
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const s = store.loadState(storage);
  assert.deepEqual(s.backup, { lastAt: null, hiddenOn: null });
  assert.equal(s.settings.weekStartsOn, 1);
});

test('a banner hidden in beta 0.6.0 (old "dismissedOn" flag) shows again', () => {
  const s = withAShift();
  s.backup.dismissedOn = '2026-10-02';
  assert.equal(backupDue(s, TODAY_9AM), true);
});
