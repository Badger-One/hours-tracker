import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initLogger } from '../src/logger.js';
import { buildExportCsv, EXPORT_COLUMNS } from '../src/exporter.js';
import { importFiles } from '../src/importers.js';
import { parseCsv } from '../src/csv.js';

const at = (y, mo, d, h, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

before(() => initLogger({ console: false }));

const shifts = [
  {
    id: 'a', job: 'Tech Support', note: 'Has, a "comma"', source: 'app',
    start: at(2026, 10, 1, 8, 0, 12), end: at(2026, 10, 1, 17, 7, 40),
    breaks: [{ start: at(2026, 10, 1, 15, 46), end: at(2026, 10, 1, 16, 46) }],
  },
  { id: 'b', job: 'Tech Support', note: '', source: 'app', start: at(2026, 10, 2, 8), end: null, breaks: [] },
];

test('export has readable columns and skips the running shift', () => {
  const rows = parseCsv(buildExportCsv(shifts));
  assert.deepEqual(rows[0], EXPORT_COLUMNS);
  assert.equal(rows.length, 2);
  const row = Object.fromEntries(EXPORT_COLUMNS.map((c, i) => [c, rows[1][i]]));
  assert.equal(row.Date, '2026-10-01');
  assert.equal(row.Start, '8:00 AM');
  assert.equal(row.End, '5:07 PM');
  assert.equal(row['Worked (h:mm)'], '8:07');
  assert.equal(row['Worked (hours)'], '8.12');
  assert.equal(row['Breaks (h:mm)'], '1:00');
  assert.equal(row['Break Details'], '3:46 PM to 4:46 PM');
  assert.equal(row.Note, 'Has, a "comma"');
});

test('an export imports back exactly (it is a full backup)', () => {
  const result = importFiles([{ name: 'backup.csv', text: buildExportCsv(shifts) }], []);
  assert.equal(result.files[0].format, 'native');
  assert.equal(result.shifts.length, 1);
  const [s] = result.shifts;
  assert.equal(s.start, shifts[0].start);
  assert.equal(s.end, shifts[0].end);
  assert.deepEqual(s.breaks, shifts[0].breaks);
  assert.equal(s.job, 'Tech Support');
  assert.equal(s.note, 'Has, a "comma"');
});

test('restoring a backup over the same data adds nothing', () => {
  const result = importFiles([{ name: 'backup.csv', text: buildExportCsv(shifts) }], shifts);
  assert.equal(result.files[0].duplicates, 1);
  assert.equal(result.shifts.length, 0);
});
