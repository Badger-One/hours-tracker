// Every $('some-id') in app.js must exist in index.html. A missing one crashes the
// app at startup, which tests that don't load a browser would otherwise miss.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const app = readFileSync(new URL('src/app.js', root), 'utf8');
const html = readFileSync(new URL('index.html', root), 'utf8');

// Created by app.js itself (import review buttons), so not in index.html.
const CREATED_IN_CODE = new Set(['btn-confirm-import', 'btn-cancel-import']);

test('every element app.js looks up exists in index.html', () => {
  const used = new Set([...app.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !CREATED_IN_CODE.has(id) && !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `index.html has no element with these ids: ${missing.join(', ')}`);
});
