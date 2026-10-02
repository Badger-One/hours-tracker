import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initLogger, log, getLogs, logsAsText, flushLogs } from '../src/logger.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
}

test('records level, event, and data, and filters by level', () => {
  initLogger({ console: false });
  log.debug('a.debug');
  log.info('a.info', { n: 1 });
  log.warn('a.warn');
  log.error('a.error');
  assert.equal(getLogs().length, 4);
  assert.deepEqual(getLogs('warn').map((e) => e.event), ['a.warn', 'a.error']);
  assert.deepEqual(getLogs('info')[0].data, { n: 1 });
});

test('Error objects keep their message and stack', () => {
  initLogger({ console: false });
  log.error('boom', { error: new Error('bad thing') });
  const { data } = getLogs('error')[0];
  assert.equal(data.error.message, 'bad thing');
  assert.match(data.error.stack, /bad thing/);
});

test('keeps only the newest 2000 entries', () => {
  initLogger({ console: false });
  for (let i = 0; i < 2100; i++) log.info('n', { i });
  const all = getLogs();
  assert.equal(all.length, 2000);
  assert.equal(all[0].data.i, 100);
});

test('survives a restart through storage', () => {
  const storage = memoryStorage();
  initLogger({ storage, console: false });
  log.info('before.restart');
  flushLogs();
  initLogger({ storage, console: false });
  assert.ok(getLogs().some((e) => e.event === 'before.restart'));
  assert.match(logsAsText(), /INFO .* before\.restart/);
});

test('a damaged saved log does not stop startup', () => {
  const storage = memoryStorage();
  storage.setItem('hours-tracker:logs:v1', '{oops');
  initLogger({ storage, console: false });
  assert.deepEqual(getLogs(), []);
});
