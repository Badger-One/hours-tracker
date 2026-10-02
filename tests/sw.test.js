// The service worker must list every file the app needs to open offline.
// If one is missing (or listed but deleted), the offline copy breaks. This catches that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const listed = [...sw.match(/const APP_FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('every file in APP_FILES exists', () => {
  for (const file of listed.filter((f) => f !== './')) {
    assert.ok(existsSync(new URL(file, root)), `sw.js lists ${file}, but it does not exist`);
  }
});

test('every app script and icon is in APP_FILES', () => {
  const needed = [
    ...readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`),
    ...readdirSync(new URL('icons/', root)).filter((f) => f.endsWith('.png')).map((f) => `icons/${f}`),
  ];
  for (const file of needed) assert.ok(listed.includes(file), `${file} is missing from APP_FILES in sw.js`);
});
