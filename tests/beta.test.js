// The test copy (/beta/) must never touch the real app's saved data,
// and must be clearly labeled as the test copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBetaPath, storageKey } from '../src/env.js';
import { markIndexHtml, markManifest } from '../tools/mark-beta.js';

const root = new URL('../', import.meta.url);

test('the /beta/ address is detected', () => {
  assert.equal(isBetaPath('/hours-tracker/beta/'), true);
  assert.equal(isBetaPath('/hours-tracker/beta/index.html'), true);
  assert.equal(isBetaPath('/hours-tracker/'), false);
  assert.equal(isBetaPath('/'), false);
  assert.equal(isBetaPath(undefined), false);
});

test('the real app keeps its existing saved-data names', () => {
  // Changing these would make the real app lose track of your data.
  assert.equal(storageKey('data:v1', false), 'hours-tracker:data:v1');
  assert.equal(storageKey('logs:v1', false), 'hours-tracker:logs:v1');
});

test('the test copy uses different saved-data names', () => {
  assert.equal(storageKey('data:v1', true), 'hours-tracker-beta:data:v1');
  assert.notEqual(storageKey('data:v1', true), storageKey('data:v1', false));
});

test('the beta copy is renamed "Hours Beta"', () => {
  const html = markIndexHtml(readFileSync(new URL('index.html', root), 'utf8'));
  assert.match(html, /<title>Hours Beta<\/title>/);
  assert.match(html, /apple-mobile-web-app-title" content="Hours Beta"/);
  const manifest = JSON.parse(markManifest(readFileSync(new URL('manifest.webmanifest', root), 'utf8')));
  assert.equal(manifest.short_name, 'Hours Beta');
});
