import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typedConfirmation } from '../src/confirm.js';

test('typing the word confirms, in any capitals', () => {
  for (const answer of ['undo', 'UNDO', 'Undo', 'uNdO', '  undo ']) assert.equal(typedConfirmation(answer, 'undo'), true, answer);
});

test('anything else, or cancelling, does not confirm', () => {
  for (const answer of ['', 'und', 'undo it', 'yes', null, undefined]) assert.equal(typedConfirmation(answer, 'undo'), false, String(answer));
});
