// CSV import.
//
// Understands two kinds of file:
//   1. "hourstracker": exports from the Hours Tracker iPhone app by Cribasoft.
//      Columns: Job, Clocked In, Clocked Out, Duration, Comment, Breaks, Adjustments, ...
//   2. "native": this app's own export (see exporter.js), so an export doubles as a backup
//      you can restore.
//
// Import happens in two steps so nothing changes until you've reviewed it:
//   importFiles() reads the files and reports what it found (nothing is saved).
//   store.applyImport() adds the shifts once you tap Import.
//
// Shifts already in the app (same start and end minute) are skipped, so importing
// the same file twice is harmless.

import { parseCsv } from './csv.js';
import { MINUTE, formatHM, formatDate, startOfDay, workedMs } from './time.js';
import { log } from './logger.js';
import { newId } from './ids.js';

export const FORMATS = {
  hourstracker: { label: 'Hours Tracker (Cribasoft)', required: ['Job', 'Clocked In', 'Clocked Out', 'Breaks'] },
  native: { label: 'This app', required: ['Start (ISO)', 'End (ISO)', 'Breaks (ISO)'] },
};

/** Which format a header row belongs to, or null if it isn't one we know. */
export function detectFormat(header) {
  const cols = header.map((h) => h.trim());
  for (const [id, f] of Object.entries(FORMATS)) {
    if (f.required.every((name) => cols.includes(name))) return id;
  }
  return null;
}

/** Two shifts are "the same" if they start and end in the same minute. */
export function shiftKey(shift) {
  const end = shift.end == null ? 'open' : Math.round(shift.end / MINUTE);
  return `${Math.round(shift.start / MINUTE)}|${end}`;
}

// ---- Hours Tracker format ----

const DATE_TIME_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/;
const TIME_RE = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/;
// One break inside the Breaks column: "1:00 (11:36 AM to 12:36 PM)". Several are joined with ";".
const BREAK_RE = /(-?\d+):(\d{2})\s*\(\s*([^)]*?)\s+to\s+([^)]*?)\s*\)/g;

function to24Hour(hour, ampm) {
  const h = Number(hour) % 12;
  return ampm.toUpperCase() === 'PM' ? h + 12 : h;
}

/** "9/29/25 7:00 AM" -> epoch ms in the phone's local time zone, or null if unreadable. */
export function parseHtDateTime(text) {
  const m = DATE_TIME_RE.exec(text.trim());
  if (!m) return null;
  const [, month, day, yearText, hour, minute, ampm] = m;
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  const d = new Date(year, Number(month) - 1, Number(day), to24Hour(hour, ampm), Number(minute));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** "8:06" or "-1:00" -> ms, or null. */
export function parseHM(text) {
  const m = /^(-?)(\d+):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const ms = (Number(m[2]) * 60 + Number(m[3])) * MINUTE;
  return m[1] ? -ms : ms;
}

/** Put a time of day like "11:36 AM" on the same calendar day as `dayMs`. */
function atTimeOfDay(dayMs, timeText) {
  const m = TIME_RE.exec(timeText.trim());
  if (!m) return null;
  const d = new Date(dayMs);
  d.setHours(to24Hour(m[1], m[3]), Number(m[2]), 0, 0);
  return d.getTime();
}

function addOneDay(ms) {
  const d = new Date(ms);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Sort breaks and merge any that overlap, so no break time is counted twice. */
function mergeBreaks(breaks) {
  const sorted = [...breaks].sort((a, b) => a.start - b.start);
  const out = [];
  for (const b of sorted) {
    const last = out.at(-1);
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else out.push({ ...b });
  }
  return out;
}

/**
 * Read the Breaks column. The file only gives times of day, so each break is placed on
 * the shift's date (or the next day for a shift that runs past midnight), then trimmed
 * to fit inside the shift.
 */
export function parseHtBreaks(text, shiftStart, shiftEnd) {
  const breaks = [];
  const notes = [];
  const crossesMidnight = startOfDay(shiftEnd) > startOfDay(shiftStart);
  if (!text.trim()) return { breaks, notes };

  let matched = 0;
  for (const m of text.matchAll(BREAK_RE)) {
    matched++;
    const original = m[0];
    let start = atTimeOfDay(shiftStart, m[3]);
    let end = atTimeOfDay(shiftStart, m[4]);
    if (start == null || end == null) {
      notes.push(`Could not read break "${original}", skipped it.`);
      continue;
    }
    if (start < shiftStart && crossesMidnight) start = addOneDay(start);
    if (end < start) end = addOneDay(end);

    if (end === start) continue; // A 0:00 break adds nothing.

    const clampedStart = Math.max(start, shiftStart);
    const clampedEnd = Math.min(end, shiftEnd);
    if (clampedEnd <= clampedStart) {
      notes.push(`Break "${original}" is outside the shift, skipped it.`);
      continue;
    }
    if (clampedStart !== start || clampedEnd !== end) {
      notes.push(`Break "${original}" goes past the shift, trimmed it to fit.`);
    }
    breaks.push({ start: clampedStart, end: clampedEnd });
  }
  if (matched === 0) notes.push(`Could not read the Breaks column "${text}", imported the shift without breaks.`);
  return { breaks: mergeBreaks(breaks), notes };
}

function parseHoursTrackerRows(rows) {
  const header = rows[0].map((h) => h.trim());
  const shifts = [];
  const warnings = [];

  for (let i = 1; i < rows.length; i++) {
    const line = i + 1; // Line number as a spreadsheet would show it (header is line 1).
    const rec = Object.fromEntries(header.map((h, col) => [h, (rows[i][col] ?? '').trim()]));
    const where = `Line ${line} (${rec['Clocked In'] || 'no date'})`;

    const start = parseHtDateTime(rec['Clocked In']);
    const end = parseHtDateTime(rec['Clocked Out']);
    if (start == null) {
      warnings.push(`${where}: could not read Clocked In "${rec['Clocked In']}". Skipped this line.`);
      continue;
    }
    if (end == null) {
      warnings.push(`${where}: could not read Clocked Out "${rec['Clocked Out']}". Skipped this line.`);
      continue;
    }
    if (end < start) {
      warnings.push(`${where}: Clocked Out is before Clocked In. Skipped this line.`);
      continue;
    }

    const { breaks, notes } = parseHtBreaks(rec.Breaks ?? '', start, end);
    for (const n of notes) warnings.push(`${where}: ${n}`);

    const shift = { id: newId(), job: rec.Job || 'Work', start, end, breaks, note: rec.Comment ?? '', source: 'import' };

    // Cross-check against the Duration column Hours Tracker calculated.
    // A 1-minute difference is normal (it rounds seconds we don't have).
    const expected = parseHM(rec.Duration ?? '');
    const worked = workedMs(shift, end);
    if (expected != null && Math.abs(worked - expected) > MINUTE) {
      warnings.push(`${where}: worked time comes to ${formatHM(worked)} here but the file says ${rec.Duration}. Imported anyway.`);
    }

    // Fields this app doesn't track yet. Mention them so nothing disappears silently.
    if (rec.Adjustments) warnings.push(`${where}: Adjustments "${rec.Adjustments}" were not imported.`);
    for (const col of ['TotalEarningsAdjustment', 'TotalMileage']) {
      if (rec[col] && Number(rec[col]) !== 0) warnings.push(`${where}: ${col} "${rec[col]}" was not imported.`);
    }

    shifts.push(shift);
  }
  return { shifts, warnings };
}

// ---- This app's own format ----

function parseNativeRows(rows) {
  const header = rows[0].map((h) => h.trim());
  const shifts = [];
  const warnings = [];

  for (let i = 1; i < rows.length; i++) {
    const line = i + 1;
    const rec = Object.fromEntries(header.map((h, col) => [h, (rows[i][col] ?? '').trim()]));
    const start = Date.parse(rec['Start (ISO)']);
    const end = Date.parse(rec['End (ISO)']);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
      warnings.push(`Line ${line}: could not read the start and end times. Skipped this line.`);
      continue;
    }
    const breaks = [];
    for (const part of (rec['Breaks (ISO)'] ?? '').split(';').filter(Boolean)) {
      const [bs, be] = part.split('/').map((s) => Date.parse(s));
      if (Number.isNaN(bs) || Number.isNaN(be)) warnings.push(`Line ${line}: could not read break "${part}", skipped it.`);
      else breaks.push({ start: Math.max(bs, start), end: Math.min(be, end) });
    }
    shifts.push({
      id: newId(),
      job: rec.Job || 'Work',
      start,
      end,
      breaks: mergeBreaks(breaks.filter((b) => b.end > b.start)),
      note: rec.Note ?? '',
      source: 'import',
    });
  }
  return { shifts, warnings };
}

const PARSERS = { hourstracker: parseHoursTrackerRows, native: parseNativeRows };

/**
 * Read one or more CSV files and report what importing them would do. Changes nothing.
 *
 * @param files          [{ name, text }]
 * @param existingShifts shifts already in the app, used to skip duplicates
 * @returns { batchId, shifts, files: [{ name, format, formatLabel, found, added, duplicates, warnings, error }] }
 */
export function importFiles(files, existingShifts) {
  const batchId = newId();
  const seen = new Set(existingShifts.map(shiftKey));
  const result = { batchId, shifts: [], files: [] };

  for (const { name, text } of files) {
    const report = { name, format: null, formatLabel: null, found: 0, added: 0, duplicates: 0, warnings: [], error: null };
    result.files.push(report);

    try {
      const rows = parseCsv(text);
      if (rows.length === 0) {
        report.error = 'The file is empty.';
        log.warn('import.file.empty', { name });
        continue;
      }
      report.format = detectFormat(rows[0]);
      if (!report.format) {
        report.error = `Not a format this app knows. Its columns are: ${rows[0].join(', ')}`;
        log.warn('import.file.unknownFormat', { name, header: rows[0] });
        continue;
      }
      report.formatLabel = FORMATS[report.format].label;

      const { shifts, warnings } = PARSERS[report.format](rows);
      report.found = shifts.length;
      report.warnings = warnings;
      for (const shift of shifts) {
        const key = shiftKey(shift);
        if (seen.has(key)) {
          report.duplicates++;
          continue;
        }
        seen.add(key);
        shift.importBatch = batchId;
        result.shifts.push(shift);
        report.added++;
      }

      const dates = shifts.map((s) => s.start);
      log.info('import.file.parsed', {
        name,
        format: report.format,
        rows: rows.length - 1,
        found: report.found,
        added: report.added,
        duplicates: report.duplicates,
        warnings: warnings.length,
        firstDate: dates.length ? formatDate(Math.min(...dates)) : null,
        lastDate: dates.length ? formatDate(Math.max(...dates)) : null,
      });
      for (const w of warnings) log.warn('import.row', { name, message: w });
    } catch (error) {
      report.error = `Could not read the file: ${error.message}`;
      log.error('import.file.failed', { name, error });
    }
  }
  return result;
}
