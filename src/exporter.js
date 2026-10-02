// CSV export.
//
// The first columns are for people and spreadsheets (Date, Start, Worked...).
// The last three "(ISO)" columns hold exact timestamps so importers.js can read
// the file back in. That makes every export a full backup.

import { toCsv } from './csv.js';
import { workedMs, breakMs, formatHM, formatDecimalHours, formatTimeOfDay, formatDate } from './time.js';
import { log } from './logger.js';

export const EXPORT_COLUMNS = [
  'Job',
  'Date',
  'Start',
  'End',
  'Worked (h:mm)',
  'Worked (hours)',
  'Breaks (h:mm)',
  'Break Details',
  'Note',
  'Start (ISO)',
  'End (ISO)',
  'Breaks (ISO)',
];

/** CSV text for every finished shift, oldest first. A shift still running is left out. */
export function buildExportCsv(shifts) {
  const done = shifts.filter((s) => s.end != null).sort((a, b) => a.start - b.start);
  const rows = [EXPORT_COLUMNS];
  for (const s of done) {
    rows.push([
      s.job,
      formatDate(s.start),
      formatTimeOfDay(s.start),
      formatTimeOfDay(s.end),
      formatHM(workedMs(s, s.end)),
      formatDecimalHours(workedMs(s, s.end)),
      formatHM(breakMs(s, s.end)),
      s.breaks.map((b) => `${formatTimeOfDay(b.start)} to ${formatTimeOfDay(b.end)}`).join('; '),
      s.note ?? '',
      new Date(s.start).toISOString(),
      new Date(s.end).toISOString(),
      s.breaks.map((b) => `${new Date(b.start).toISOString()}/${new Date(b.end).toISOString()}`).join(';'),
    ]);
  }
  log.info('export.built', { shifts: done.length, skippedRunning: shifts.length - done.length });
  return toCsv(rows);
}

/** "hours-tracker-2026-10-02.csv" */
export function exportFileName(now) {
  return `hours-tracker-${formatDate(now)}.csv`;
}
