import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../src/csv.js';

test('parses quoted fields, commas, and doubled quotes', () => {
  assert.deepEqual(parseCsv('"a","b, c","say ""hi"""\n'), [['a', 'b, c', 'say "hi"']]);
});

test('handles Windows line endings, a byte-order mark, and blank lines', () => {
  assert.deepEqual(parseCsv('﻿x,y\r\n1,2\r\n\r\n3,4'), [['x', 'y'], ['1', '2'], ['3', '4']]);
});

test('keeps line breaks that are inside quotes', () => {
  assert.deepEqual(parseCsv('"line one\nline two",z'), [['line one\nline two', 'z']]);
});

test('keeps empty fields', () => {
  assert.deepEqual(parseCsv('a,,c,'), [['a', '', 'c', '']]);
});

test('toCsv output parses back to the same rows', () => {
  const rows = [['Job', 'Note'], ['Tech, Support', 'He said "ok"\nthen left'], ['', null]];
  assert.deepEqual(parseCsv(toCsv(rows)), [['Job', 'Note'], ['Tech, Support', 'He said "ok"\nthen left'], ['', '']]);
});
