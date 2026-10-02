import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initLogger, getLogs } from '../src/logger.js';
import * as store from '../src/store.js';
import { importFiles } from '../src/importers.js';

before(() => initLogger({ console: false }));

/** A stand-in for the phone's localStorage. */
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    keys: () => [...data.keys()],
  };
}

test('a full day: start, break, end break, clock out', () => {
  const s = store.emptyState();
  assert.equal(store.currentStatus(s), 'off');

  store.startWork(s, 1000);
  assert.equal(store.currentStatus(s), 'working');

  store.startBreak(s, 2000);
  assert.equal(store.currentStatus(s), 'break');

  store.endBreak(s, 3000);
  assert.equal(store.currentStatus(s), 'working');

  store.clockOut(s, 4000);
  assert.equal(store.currentStatus(s), 'off');
  assert.deepEqual(s.shifts[0].breaks, [{ start: 2000, end: 3000 }]);
  assert.equal(s.shifts[0].end, 4000);
});

test('clocking out during a break ends the break too', () => {
  const s = store.emptyState();
  store.startWork(s, 1000);
  store.startBreak(s, 2000);
  store.clockOut(s, 5000);
  assert.deepEqual(s.shifts[0].breaks, [{ start: 2000, end: 5000 }]);
});

test('actions that make no sense right now are refused with a clear message', () => {
  const s = store.emptyState();
  assert.throws(() => store.startBreak(s, 1), /Start work/);
  assert.throws(() => store.clockOut(s, 1), /not clocked in/);
  store.startWork(s, 1);
  assert.throws(() => store.startWork(s, 2), /already clocked in/);
  assert.throws(() => store.endBreak(s, 2), /not on a break/);
  store.startBreak(s, 3);
  assert.throws(() => store.startBreak(s, 4), /already on a break/);
});

test('save and load round trip', () => {
  const storage = memoryStorage();
  const s = store.emptyState();
  store.startWork(s, 1000);
  assert.equal(store.saveState(storage, s), true);
  assert.deepEqual(store.loadState(storage), s);
});

test('damaged saved data is kept aside and the app starts empty', () => {
  const storage = memoryStorage();
  storage.setItem(store.STORAGE_KEY, '{not json');
  const s = store.loadState(storage);
  assert.deepEqual(s, store.emptyState());
  assert.ok(storage.keys().some((k) => k.includes(':damaged:')));
  assert.ok(getLogs('error').some((e) => e.event === 'store.load.damaged'));
});

test('a failed save returns false instead of crashing', () => {
  const full = { setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(store.saveState(full, store.emptyState()), false);
});

test('undo last import removes only that import', () => {
  const s = store.emptyState();
  store.startWork(s, Date.UTC(2026, 9, 2, 12));
  const csv = '"Job","Clocked In","Clocked Out","Duration","Breaks"\n"J","9/29/25 7:00 AM","9/29/25 4:00 PM","9:00",""\n';
  const result = importFiles([{ name: 'x.csv', text: csv }], s.shifts);
  store.applyImport(s, result, 0);
  assert.equal(s.shifts.length, 2);
  assert.equal(store.undoLastImport(s), 1);
  assert.equal(s.shifts.length, 1);
  assert.equal(s.shifts[0].source, 'app');
  assert.equal(s.lastImport, null);
});
