import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initLogger } from '../src/logger.js';
import { importFiles, parseHtDateTime, parseHM, detectFormat } from '../src/importers.js';
import { workedMs, breakMs, formatHM, MINUTE } from '../src/time.js';

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const sample = readFileSync(new URL('./fixtures/hourstracker-sample.csv', import.meta.url), 'utf8');

before(() => initLogger({ console: false }));

test('reads Hours Tracker dates and durations', () => {
  assert.equal(parseHtDateTime('9/29/25 7:00 AM'), at(2025, 9, 29, 7));
  assert.equal(parseHtDateTime('12/31/2025 12:15 AM'), at(2025, 12, 31, 0, 15));
  assert.equal(parseHtDateTime('10/1/26 12:46 PM'), at(2026, 10, 1, 12, 46));
  assert.equal(parseHtDateTime('garbage'), null);
  assert.equal(parseHM('8:06'), (8 * 60 + 6) * MINUTE);
  assert.equal(parseHM('-1:00'), -60 * MINUTE);
});

test('detects file formats from the header row', () => {
  assert.equal(detectFormat(['Job', 'Clocked In', 'Clocked Out', 'Duration', 'Breaks']), 'hourstracker');
  assert.equal(detectFormat(['Start (ISO)', 'End (ISO)', 'Breaks (ISO)']), 'native');
  assert.equal(detectFormat(['Date', 'Amount']), null);
});

test('imports the Hours Tracker sample', () => {
  const result = importFiles([{ name: 'sample.csv', text: sample }], []);
  const [report] = result.files;
  assert.equal(report.format, 'hourstracker');
  assert.equal(report.error, null);
  assert.equal(report.found, 7); // 8 lines, 1 has a bad date
  assert.equal(report.added, 7);
  assert.equal(result.shifts.length, 7);
  assert.ok(result.shifts.every((s) => s.importBatch === result.batchId));

  // Every imported shift's worked time matches the file's Duration column.
  const durations = ['8:06', '8:00', '4:50', '3:11', '7:43', '8:07', '3:30'];
  assert.deepEqual(result.shifts.map((s) => formatHM(workedMs(s, s.end))), durations);
});

test('handles multiple breaks, trimming, zero breaks, notes, and overnight shifts', () => {
  const { shifts, files } = importFiles([{ name: 'sample.csv', text: sample }], []);
  const [, multi, , split, overlong, zero, overnight] = shifts;

  assert.equal(multi.breaks.length, 4);
  assert.equal(breakMs(multi, multi.end), 60 * MINUTE);

  assert.equal(split.note, 'Split shift, "quoted" note');

  // "2:43 PM to 4:10 PM" runs past the 4:05 PM clock-out, so it is trimmed.
  assert.equal(overlong.breaks[0].end, at(2026, 9, 10, 16, 5));
  assert.ok(files[0].warnings.some((w) => w.includes('trimmed')));

  // The "0:00 (4:46 PM to 4:46 PM)" break is dropped.
  assert.equal(zero.breaks.length, 1);

  // The overnight break at 12:15 AM belongs to Jan 1, not Dec 31.
  assert.equal(overnight.job, 'Other Job');
  assert.equal(overnight.breaks[0].start, at(2026, 1, 1, 0, 15));

  assert.ok(files[0].warnings.some((w) => w.includes('Line 9') && w.includes('Clocked In')));
});

test('importing the same file twice adds nothing the second time', () => {
  const first = importFiles([{ name: 'a.csv', text: sample }], []);
  const second = importFiles([{ name: 'a.csv', text: sample }], first.shifts);
  assert.equal(second.files[0].added, 0);
  assert.equal(second.files[0].duplicates, 7);
});

test('the same file picked twice in one import is only counted once', () => {
  const result = importFiles([{ name: 'a.csv', text: sample }, { name: 'b.csv', text: sample }], []);
  assert.equal(result.shifts.length, 7);
  assert.equal(result.files[1].duplicates, 7);
});

test('unknown and empty files are reported, not imported', () => {
  const result = importFiles([{ name: 'bank.csv', text: 'Date,Amount\n1/1/26,5' }, { name: 'empty.csv', text: '' }], []);
  assert.match(result.files[0].error, /Not a format/);
  assert.match(result.files[1].error, /empty/);
  assert.equal(result.shifts.length, 0);
});
