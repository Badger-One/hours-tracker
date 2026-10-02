// The screen. Connects buttons to the actions in store.js and redraws.
// Business logic (time math, CSV, data changes) lives in the other modules so it
// can be tested without a browser; this file should stay mostly "glue".

import { APP_VERSION } from './version.js';
import { IS_BETA, storageKey } from './env.js';
import { initLogger, log, installGlobalErrorHandlers, getLogs, clearLogs, logsAsText, formatLogEntry, flushLogs } from './logger.js';
import * as store from './store.js';
import {
  MINUTE, HOUR, totalsForDay, workedMs, breakMs, startOfDay, startOfNextDay, startOfMinute,
  formatClock, formatHM, formatTimeOfDay, formatDate, formatDayHeading, formatWhen, formatShortDay, formatMonthHeading, formatMonthDay,
  toTimeInput, fromDateAndTime, timeOnOrAfter, roundToQuarterHour,
} from './time.js';
import { importFiles } from './importers.js';
import { buildHistory } from './history.js';
import { backupDue, recordBackup, dismissBackupForToday } from './backup.js';
import * as jobs from './jobs.js';
import { typedConfirmation } from './confirm.js';
import {
  payForJob, hourlyShiftPay, groupPay, earnedToday, formatMoney, describePay, validatePay,
  DEFAULT_OVERTIME, hasHourlyJob,
} from './pay.js';
import { buildExportCsv, backupFileName } from './exporter.js';
import { saveFile } from './files.js';

// ---- Startup ----

const storage = getStorage();
initLogger({ storage });
installGlobalErrorHandlers(window);
log.info('app.start', {
  version: APP_VERSION,
  beta: IS_BETA,
  standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  userAgent: navigator.userAgent,
  url: location.href,
});

let state = store.loadState(storage);
let pendingImport = null; // An import that has been read but not confirmed yet.
let currentView = 'clock';
let renderedStatus = null; // Which buttons are on screen, so they're only rebuilt on change.

const LONG_RUNNING_MS = 14 * HOUR; // Show "Forgot to clock out?" after this long.
const UNDO_SECONDS = 8;

const $ = (id) => document.getElementById(id);

function getStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    // Some private-browsing modes block storage entirely.
    console.error('localStorage unavailable', error);
    alert('This browser is blocking storage, so nothing you record can be saved.');
    return null;
  }
}

function persist() {
  if (!store.saveState(storage, state)) {
    alert('Could not save your data on this phone. Export a CSV now so nothing is lost, then check Settings > Debug log.');
  }
}

// ---- Running actions, with Undo ----

let undoSnapshot = null;
let toastTimer = null;

/**
 * Run an action from store.js, save, redraw, and offer Undo.
 * `message` is the Undo bar text; it can be a function so it can describe the result.
 * Throws if the action is refused, so popups can show the reason in place.
 */
function perform(name, fn, message) {
  const snapshot = JSON.stringify(state);
  const now = Date.now();
  fn(state, now);
  persist();
  render();
  showUndo(typeof message === 'function' ? message(now) : message, snapshot, name);
}

/** Same as perform(), but shows a refusal in an alert. For buttons outside popups. */
function act(name, fn, message) {
  try {
    perform(name, fn, message);
  } catch (error) {
    log.warn('action.rejected', { action: name, message: error.message });
    alert(error.message);
  }
}

function showUndo(message, snapshot, action) {
  undoSnapshot = { json: snapshot, action };
  $('toast-text').textContent = message;
  $('toast-undo').hidden = false;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideUndo, UNDO_SECONDS * 1000);
}

/** Same bar as Undo, without the Undo button. For "Backed up 225 shifts." and similar. */
function showNotice(message) {
  undoSnapshot = null;
  $('toast-text').textContent = message;
  $('toast-undo').hidden = true;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideUndo, UNDO_SECONDS * 1000);
}

function hideUndo() {
  $('toast').hidden = true;
  undoSnapshot = null;
}

function undo() {
  if (!undoSnapshot) return;
  log.info('undo', { action: undoSnapshot.action });
  state = JSON.parse(undoSnapshot.json);
  hideUndo();
  persist();
  render();
}

// ---- Time picker popup (Start at…, Clock out at…, Break at…) ----

let timePickerConfirm = null;

/** `onConfirm(ms)` runs the action. If it throws, the reason shows in the popup and it stays open. */
function openTimePicker({ title, help = '', okLabel, initial = Date.now(), onConfirm }) {
  $('dlg-time-title').textContent = title;
  $('dlg-time-help').textContent = help;
  $('dlg-time-help').hidden = !help;
  $('dlg-time-ok').textContent = okLabel;
  $('dlg-time-date').value = formatDate(initial);
  $('dlg-time-time').value = toTimeInput(initial);
  $('dlg-time-error').textContent = '';
  timePickerConfirm = onConfirm;
  log.debug('dialog.time.open', { title });
  $('dlg-time').showModal();
}

function onTimePickerSubmit(event) {
  event.preventDefault(); // Keep the popup open until the action succeeds.
  const at = fromDateAndTime($('dlg-time-date').value, $('dlg-time-time').value);
  if (at == null) {
    $('dlg-time-error').textContent = 'Pick a date and time.';
    return;
  }
  try {
    timePickerConfirm(at);
    $('dlg-time').close();
  } catch (error) {
    log.warn('action.rejected', { dialog: $('dlg-time-title').textContent, message: error.message });
    $('dlg-time-error').textContent = error.message;
  }
}

/** Same minute as the action time, but with "now" seconds kept when you picked the current minute. */
function exactIfNow(at) {
  const now = Date.now();
  return at === startOfMinute(now) ? now : at;
}

// ---- Which job? ----

/**
 * A popup of big buttons. `options` is [{ label, note?, value, selected? }];
 * tapping one closes the popup and calls onPick(value).
 */
function pickFromList({ title, options, onPick }) {
  $('dlg-job-title').textContent = title;
  // When one option is the current choice (History filter), others look plain so it stands out.
  $('dlg-job-list').classList.toggle('with-current', options.some((o) => o.selected));
  $('dlg-job-list').replaceChildren(
    ...options.map((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = o.selected ? 'button selected' : 'button';
      b.textContent = o.label;
      if (o.note) b.insertAdjacentHTML('beforeend', `<small>${escapeHtml(o.note)}</small>`);
      b.addEventListener('click', () => {
        $('dlg-job').close();
        onPick(o.value);
      });
      return b;
    }),
  );
  $('dlg-job').showModal();
}

/**
 * Calls `then(job)` with the job for a new shift. When Settings says "Ask which job
 * every time" (or `always` is set, for "Other job…") and you have 2+ jobs, it shows
 * the job buttons first; otherwise it uses the default job right away.
 */
function chooseJob(then, { always = false } = {}) {
  const ask = always ? jobs.activeJobs(state).length >= 2 : jobs.needsJobPick(state);
  if (!ask) return then(jobs.defaultJob(state));
  const fallback = jobs.defaultJob(state);
  pickFromList({
    title: 'Which job?',
    options: jobs.activeJobs(state).map((name) => ({ label: name, value: name, note: name === fallback ? 'Default job' : '' })),
    onPick: (job) => {
      log.info('jobs.picked', { job });
      then(job);
    },
  });
}

/** "Clocked in at 8:00 AM" plus the job name when you have more than one job. */
function clockedInMessage(at, now, job) {
  const base = at > now ? `Starting at ${formatWhen(at, now)}` : `Clocked in at ${formatWhen(at, now)}`;
  return jobs.activeJobs(state).length > 1 ? `${base} · ${job}` : base;
}

/** "Other job…": clock in to a job other than the default without changing Settings. */
function startWorkOtherJob() {
  chooseJob((job) => act('startWork', (s, now) => store.startWork(s, now, now, job), (now) => clockedInMessage(now, now, job)), { always: true });
}

function startWorkNow() {
  chooseJob((job) => act('startWork', (s, now) => store.startWork(s, now, now, job), (now) => clockedInMessage(now, now, job)));
}

function pickStartTime() {
  chooseJob((job) =>
    openTimePicker({
      title: 'Start at',
      help: 'Pick when your shift started, or a later time to clock in ahead.',
      okLabel: 'Start',
      onConfirm: (at) =>
        perform('startWork', (s, now) => store.startWork(s, now, exactIfNow(at), job), (now) => clockedInMessage(at, now, job)),
    }),
  );
}

function pickScheduledStart() {
  const shift = store.activeShift(state);
  openTimePicker({
    title: 'Change start time',
    okLabel: 'Save',
    initial: shift.start,
    onConfirm: (at) =>
      perform('editScheduledStart', (s, now) => store.updateShift(s, shift.id, { ...shift, start: exactIfNow(at) }, now),
        (now) => `Starting at ${formatWhen(at, now)}`),
  });
}

function pickClockOut() {
  openTimePicker({
    title: 'Clock out at',
    help: 'Forgot to clock out? Pick when you actually finished.',
    okLabel: 'Clock out',
    onConfirm: (at) => perform('clockOut', (s, now) => store.clockOut(s, now, exactIfNow(at)), clockedOutMessage),
  });
}

function pickBreakStart() {
  openTimePicker({
    title: 'Break started at',
    okLabel: 'Start break',
    onConfirm: (at) =>
      perform('startBreak', (s, now) => store.startBreak(s, now, exactIfNow(at)), (now) => `Break started at ${formatWhen(at, now)}`),
  });
}

function pickBreakEnd() {
  openTimePicker({
    title: 'Break ended at',
    okLabel: 'End break',
    onConfirm: (at) =>
      perform('endBreak', (s, now) => store.endBreak(s, now, exactIfNow(at)), (now) => `Back to work at ${formatWhen(at, now)}`),
  });
}

function clockedOutMessage() {
  const last = state.shifts.filter((s) => s.end != null).sort((a, b) => a.end - b.end).at(-1);
  return last ? `Clocked out at ${formatTimeOfDay(last.end)}. Worked ${formatHM(workedMs(last, last.end))}.` : 'Clocked out.';
}

// ---- Shift editor popup ----

// What the editor is working on. Original values are kept so an untouched field
// keeps its exact seconds instead of being rounded to the minute.
let editing = null; // { id, isNew, running, start, end, rows: [{ start, end, running }] }

function openShiftEditor(shift) {
  const now = Date.now();
  if (shift) {
    editing = {
      id: shift.id,
      isNew: false,
      running: shift.end == null,
      start: shift.start,
      end: shift.end,
      rows: shift.breaks.map((b) => ({ start: b.start, end: b.end, running: b.end == null })),
    };
    fillJobSelect(shift.job);
    $('shift-note').value = shift.note ?? '';
  } else {
    // Start with yesterday, at the same times as your most recent shift rounded to the
    // nearest 15 minutes (8:00 AM to 5:07 PM becomes 8:00 AM to 5:00 PM), or 9 to 5.
    const last = state.shifts.filter((s) => s.end != null).at(-1);
    const sameTimeYesterday = (ms) => {
      const d = new Date(ms);
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      y.setHours(d.getHours(), d.getMinutes(), 0, 0);
      return y.getTime();
    };
    const start = last ? roundToQuarterHour(sameTimeYesterday(last.start)) : startOfDay(now) - 15 * HOUR;
    let end = last ? roundToQuarterHour(sameTimeYesterday(last.end)) : startOfDay(now) - 7 * HOUR;
    if (end <= start) end = start + 8 * HOUR; // The last shift crossed midnight.
    editing = { id: null, isNew: true, running: false, start, end, rows: [] };
    fillJobSelect(jobs.defaultJob(state));
    $('shift-note').value = '';
  }

  $('dlg-shift-title').textContent = editing.isNew ? 'Add shift' : editing.running ? 'Edit current shift' : 'Edit shift';
  $('shift-date').value = formatDate(editing.start);
  $('shift-start').value = toTimeInput(editing.start);
  $('shift-end').value = editing.running ? '' : toTimeInput(editing.end);
  $('shift-end-field').hidden = editing.running;
  $('shift-end-field').parentElement.classList.toggle('running', editing.running);
  $('shift-running-note').hidden = !editing.running;
  const origin = shift?.editedAt
    ? `Edited ${formatWhen(shift.editedAt, now)}.`
    : shift?.source === 'manual' ? 'Added by hand.'
    : shift?.source === 'import' ? 'Imported from a CSV file.'
    : '';
  $('shift-origin').textContent = origin;
  $('shift-origin').hidden = !origin;
  $('btn-shift-delete').hidden = editing.isNew;
  $('btn-shift-delete').textContent = editing.running ? 'Delete this shift (cancel clock-in)' : 'Delete shift';

  renderBreakRows();
  updateShiftPreview();
  log.debug('dialog.shift.open', { id: editing.id, isNew: editing.isNew, running: editing.running });
  $('dlg-shift').showModal();
}

/** The editor's Job dropdown: your jobs, plus this shift's job if it's hidden or not in the list. */
function fillJobSelect(selected) {
  const names = jobs.activeJobs(state);
  if (selected && !names.includes(selected)) names.push(selected);
  $('shift-job').replaceChildren(...names.map((n) => new Option(n, n, false, n === selected)));
}

function renderBreakRows() {
  const box = $('shift-breaks');
  if (editing.rows.length === 0) {
    box.innerHTML = '<p class="hint">No breaks.</p>';
    return;
  }
  box.replaceChildren(
    ...editing.rows.map((row, i) => {
      const el = document.createElement('div');
      el.className = 'break-row';
      el.innerHTML = `
        <input type="time" class="b-start" aria-label="Break ${i + 1} start" value="${Number.isFinite(row.start) ? toTimeInput(row.start) : ''}">
        <span class="to">to</span>
        ${row.running
          ? '<span class="running">now</span>'
          : `<input type="time" class="b-end" aria-label="Break ${i + 1} end" value="${Number.isFinite(row.end) ? toTimeInput(row.end) : ''}">`}
        <button type="button" class="remove" aria-label="Remove break ${i + 1}">×</button>`;
      el.querySelector('.remove').addEventListener('click', () => {
        saveRowInputs();
        editing.rows.splice(i, 1);
        renderBreakRows();
        updateShiftPreview();
      });
      return el;
    }),
  );
}

/** Copy what's typed in the break inputs back into editing.rows (so re-rendering doesn't lose it). */
function saveRowInputs() {
  const draft = readShiftDraft();
  editing.rows = editing.rows.map((row, i) => ({ ...row, start: draft.breaks[i].start, end: draft.breaks[i].end }));
}

function addBreakRow() {
  saveRowInputs();
  const draft = readShiftDraft();
  const shiftEnd = editing.running ? Date.now() : draft.end;
  let start;
  if (Number.isFinite(draft.start) && Number.isFinite(shiftEnd)) {
    start = editing.running ? startOfMinute(shiftEnd) - 30 * MINUTE : startOfMinute(draft.start + (shiftEnd - draft.start) / 2);
  } else {
    start = startOfMinute(Date.now());
  }
  editing.rows.push({ start, end: start + 30 * MINUTE, running: false });
  // A running break must stay last, so a new finished break goes before it.
  editing.rows.sort((a, b) => (a.running ? 1 : 0) - (b.running ? 1 : 0) || a.start - b.start);
  renderBreakRows();
  updateShiftPreview();
}

/**
 * Read the editor's inputs into a shift draft. Unreadable times become NaN so the rules report them.
 *
 * You pick one date and plain times. Each time after the start lands on the first
 * matching moment after the one before it, so a shift that ends at 2 AM ends the
 * next morning without a second date field.
 */
function readShiftDraft() {
  const dateText = $('shift-date').value;
  const startText = $('shift-start').value;
  // An untouched field keeps its exact original value (including seconds).
  const startUntouched = Number.isFinite(editing.start) && dateText === formatDate(editing.start) && startText === toTimeInput(editing.start);
  const start = startUntouched ? editing.start : fromDateAndTime(dateText, startText) ?? NaN;

  const timeAfter = (original, text, base) => {
    if (startUntouched && Number.isFinite(original) && text === toTimeInput(original)) return original;
    return Number.isFinite(base) ? timeOnOrAfter(base, text) ?? NaN : NaN;
  };

  const end = editing.running ? null : timeAfter(editing.end, $('shift-end').value, start);

  const rowEls = [...$('shift-breaks').querySelectorAll('.break-row')];
  const breaks = editing.rows.map((row, i) => {
    const el = rowEls[i];
    const bStart = timeAfter(row.start, el.querySelector('.b-start').value, start);
    if (row.running) return { start: bStart, end: null };
    return { start: bStart, end: timeAfter(row.end, el.querySelector('.b-end').value, bStart) };
  });

  return { job: $('shift-job').value, start, end, breaks, note: $('shift-note').value };
}

function updateShiftPreview() {
  const now = Date.now();
  const draft = readShiftDraft();
  const candidate = { ...draft, id: editing.id, breaks: [...draft.breaks].sort((a, b) => a.start - b.start) };
  const others = state.shifts.filter((s) => s.id !== editing.id);
  const problems = store.validateShift(candidate, others, now);

  if (problems.length === 0) {
    const worked = workedMs(candidate, now);
    const br = breakMs(candidate, now);
    const warnings = store.shiftWarnings(candidate, now);
    $('shift-summary').textContent = `Worked ${formatHM(worked)} · Breaks ${formatHM(br)}${warnings.length ? ` · ${warnings.join(' ')}` : ''}`;
  } else {
    $('shift-summary').textContent = '';
  }
  $('shift-errors').replaceChildren(
    ...problems.map((p) => {
      const li = document.createElement('li');
      li.textContent = p;
      return li;
    }),
  );
  $('btn-shift-save').disabled = problems.length > 0;
}

function onShiftEditorSubmit(event) {
  event.preventDefault();
  const draft = readShiftDraft();
  try {
    if (editing.isNew) {
      perform('addShift', (s, now) => store.addShift(s, draft, now), `Added a shift on ${formatDayHeading(draft.start)}.`);
    } else {
      perform('editShift', (s, now) => store.updateShift(s, editing.id, draft, now), 'Shift saved.');
    }
    $('dlg-shift').close();
  } catch (error) {
    log.warn('action.rejected', { action: editing.isNew ? 'addShift' : 'editShift', message: error.message });
    $('shift-errors').replaceChildren(
      ...(error.problems ?? [error.message]).map((p) => Object.assign(document.createElement('li'), { textContent: p })),
    );
  }
}

function deleteEditingShift() {
  const question = editing.running ? 'Delete this shift? Use this if you clocked in by mistake.' : 'Delete this shift?';
  if (!confirm(question)) return;
  const id = editing.id;
  perform('deleteShift', (s) => store.deleteShift(s, id), 'Shift deleted.');
  $('dlg-shift').close();
}

// ---- Clock screen ----

const BUTTONS = {
  off: [{ label: 'Start Work', cls: '', run: startWorkNow }],
  scheduled: [
    { label: 'Start Now', cls: '', run: () => act('startScheduledNow', store.startScheduledNow, (now) => `Clocked in at ${formatTimeOfDay(now)}`) },
    { label: 'Cancel', cls: 'stop', run: cancelScheduled },
  ],
  working: [
    { label: 'Start Break', cls: 'break', run: () => act('startBreak', store.startBreak, (now) => `Break started at ${formatTimeOfDay(now)}`) },
    { label: 'Clock Out', cls: 'stop', run: () => act('clockOut', store.clockOut, clockedOutMessage) },
  ],
  break: [
    { label: 'End Break', cls: '', run: () => act('endBreak', store.endBreak, (now) => `Back to work at ${formatTimeOfDay(now)}`) },
    { label: 'Clock Out', cls: 'stop', run: () => act('clockOut', store.clockOut, clockedOutMessage) },
  ],
};

const editCurrent = () => openShiftEditor(store.activeShift(state));

/** The small links under the big buttons. "Other job…" appears with 2+ jobs when Start Work doesn't ask. */
function linksFor(status) {
  if (status === 'off' && state.settings.jobMode !== 'ask' && jobs.activeJobs(state).length >= 2) {
    return [...LINKS.off, { label: 'Other job…', run: startWorkOtherJob }];
  }
  return LINKS[status];
}

const LINKS = {
  off: [{ label: 'Start at…', run: pickStartTime }],
  scheduled: [{ label: 'Change start time', run: pickScheduledStart }],
  working: [
    { label: 'Edit shift', run: editCurrent },
    { label: 'Break at…', run: pickBreakStart },
    { label: 'Clock out at…', run: pickClockOut },
  ],
  break: [
    { label: 'Edit shift', run: editCurrent },
    { label: 'End break at…', run: pickBreakEnd },
    { label: 'Clock out at…', run: pickClockOut },
  ],
};

function cancelScheduled() {
  const shift = store.activeShift(state);
  act('cancelScheduled', (s) => store.deleteShift(s, shift.id), 'Scheduled start cancelled.');
}

function makeButtons(list, className) {
  return list.map((b) => {
    const el = document.createElement('button');
    el.className = className(b);
    el.textContent = b.label;
    el.addEventListener('click', b.run);
    return el;
  });
}

function renderClock() {
  const now = Date.now();
  const shift = store.activeShift(state);
  const brk = store.activeBreak(shift);
  const status = store.currentStatus(state, now);
  const today = totalsForDay(state.shifts, now);

  const sessionWorked = shift ? workedMs(shift, now) : 0;
  const thisBreak = brk ? now - brk.start : 0;

  const showJob = shift && jobs.activeJobs(state).length > 1;
  $('current-job').hidden = !showJob;
  if (showJob) $('current-job').textContent = shift.job;

  document.body.dataset.status = status;
  $('status').textContent = { off: 'Off the clock', scheduled: 'Scheduled', working: 'Working', break: 'On break' }[status];

  if (status === 'scheduled') {
    $('hero-label').textContent = 'Starts in';
    $('hero-time').textContent = formatClock(shift.start - now);
    $('since').textContent = `Clocking in at ${formatWhen(shift.start, now)}`;
  } else if (status === 'working') {
    $('hero-label').textContent = 'Working this session';
    $('hero-time').textContent = formatClock(sessionWorked);
    $('since').textContent = `Clocked in at ${formatWhen(shift.start, now)}`;
  } else if (status === 'break') {
    $('hero-label').textContent = 'On break';
    $('hero-time').textContent = formatClock(thisBreak);
    $('since').textContent = `Break started at ${formatWhen(brk.start, now)}`;
  } else {
    $('hero-label').textContent = 'Worked today';
    $('hero-time').textContent = formatClock(today.workedMs);
    $('since').textContent = '';
  }

  $('stat-session').textContent = formatClock(sessionWorked);
  $('stat-today').textContent = formatClock(today.workedMs);
  $('stat-break').textContent = formatClock(thisBreak);
  $('stat-break-today').textContent = formatClock(today.breakMs);

  // Earned today counts hourly jobs only; a salary pays the same however long you work.
  const showEarned = hasHourlyJob(state);
  $('earned-card').hidden = !showEarned;
  if (showEarned) $('stat-earned').textContent = formatMoney(earnedToday(state, now, hourlyShiftPay(state, now)).amount);

  const showBackup = backupDue(state, now);
  $('backup-banner').hidden = !showBackup;
  if (showBackup) $('backup-sub').textContent = lastBackupText(now);

  const longRunning = (status === 'working' || status === 'break') && now - shift.start > LONG_RUNNING_MS;
  $('long-shift-banner').hidden = !longRunning;
  if (longRunning) $('long-shift-text').textContent = `You've been clocked in since ${formatWhen(shift.start, now)}. Forgot to clock out?`;

  // Rebuilding buttons every second would swallow taps, so only do it when the status changes.
  const links = linksFor(status);
  const buttonsKey = `${status}|${links.map((l) => l.label).join()}`;
  if (buttonsKey !== renderedStatus) {
    if (renderedStatus?.startsWith('scheduled|') && status === 'working') log.info('shift.schedule.began', { id: shift.id });
    $('actions').replaceChildren(...makeButtons(BUTTONS[status], (b) => `button ${b.cls}`.trim()));
    $('more-actions').replaceChildren(...makeButtons(links, () => 'link-button'));
    renderedStatus = buttonsKey;
  }
}

// ---- History screen ----

/*
 * Years, then months, then weeks, newest first. Each year and month heading is a
 * button that opens or closes it. Closed months show only their totals, so you can
 * compare months at a glance:
 *
 *   2026                                  1,412:05
 *   180 days · avg 7:51
 *   ▾ October 2026                            8:07
 *     1 day · avg 8:07
 *       Sep 28 to Oct 4                      40:12
 *       Thu, Oct 1   8:00 AM to 5:07 PM       8:07
 *   ▸ September 2026                        152:40
 *     19 days · avg 8:02
 *
 * The current month and every year start open. What you open or close is
 * remembered on this phone.
 */

const UI_KEY = storageKey('ui:v1');
let ui = loadUi();

function loadUi() {
  try {
    const saved = JSON.parse(storage?.getItem(UI_KEY) ?? '{}');
    return { open: saved.open ?? {}, jobFilter: saved.jobFilter ?? null };
  } catch {
    return { open: {}, jobFilter: null };
  }
}

function saveUi() {
  try {
    storage?.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    // Only display preferences; fine to lose.
  }
}

function isOpen(key, openByDefault) {
  return ui.open[key] ?? openByDefault;
}

function toggleGroup(key, openByDefault) {
  ui.open[key] = !isOpen(key, openByDefault);
  saveUi();
  log.debug('history.toggle', { key, open: ui.open[key] });
  renderHistory();
}

function daysSummary(t) {
  if (t.daysWorked === 0) return 'No time worked yet';
  return `${t.daysWorked} day${t.daysWorked === 1 ? '' : 's'} · avg ${formatHM(t.avgPerDayMs)}`;
}

function groupHeading({ key, openByDefault, cls, label, totals, money = '' }) {
  const open = isOpen(key, openByDefault);
  return `<button type="button" class="${cls}" data-toggle="${key}" data-default-open="${openByDefault}" aria-expanded="${open}">
    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
    <span class="label">${label}</span>
    <span class="total">${formatHM(totals.workedMs)}</span>
    <span class="sub">${daysSummary(totals)}${money ? ` · ${money}` : ''}</span>
  </button>`;
}

function shiftRow(s, showDate, now) {
  const end = s.end == null ? (s.start > now ? 'scheduled' : 'now') : formatTimeOfDay(s.end);
  return `<button type="button" class="shift-row" data-id="${s.id}">
    <span class="day-name">${showDate ? formatShortDay(s.start) : ''}</span>
    <span class="times">${formatTimeOfDay(s.start)} to ${end}</span>
    <span class="worked">${formatHM(workedMs(s, now))}</span>
  </button>`;
}

function monthBody(month, now, moneyFor) {
  return month.weeks
    .map((week) => {
      const money = moneyFor(week.start, startOfNextDay(week.end), 'week');
      const rows = week.shifts
        .map((s, i) => shiftRow(s, i === 0 || startOfDay(week.shifts[i - 1].start) !== startOfDay(s.start), now))
        .join('');
      return `<div class="week-head"><span>${formatMonthDay(week.start)} to ${formatMonthDay(week.end)}</span><span>${formatHM(week.fullWeekMs)}${money ? ` · ${money}` : ''}</span></div>${rows}`;
    })
    .join('');
}

/**
 * With shifts from 2+ jobs, History shows two buttons: "All jobs" and "Filter jobs".
 * Filter jobs opens a popup of your jobs; picking one shows only its shifts, so every
 * total becomes that job's total, and the button shows the job's name. All jobs clears it.
 * Returns the shifts to show. The choice is remembered on this phone.
 */
function renderJobFilter() {
  const names = jobs.jobsInShifts(state.shifts);
  const box = $('job-filter');
  if (names.length < 2) {
    box.hidden = true;
    return state.shifts;
  }
  const current = names.includes(ui.jobFilter) ? ui.jobFilter : null;
  const setFilter = (job) => {
    ui.jobFilter = job;
    saveUi();
    log.debug('history.jobFilter', { job });
    renderHistory();
  };
  const all = document.createElement('button');
  all.type = 'button';
  all.textContent = 'All jobs';
  all.setAttribute('aria-pressed', String(current == null));
  all.addEventListener('click', () => setFilter(null));

  const filter = document.createElement('button');
  filter.type = 'button';
  filter.className = 'filter-button';
  filter.textContent = current ?? 'Filter jobs';
  filter.setAttribute('aria-pressed', String(current != null));
  filter.addEventListener('click', () =>
    pickFromList({
      title: 'Filter jobs',
      options: [
        { label: 'All jobs', value: null, selected: current == null },
        ...names.map((n) => ({ label: n, value: n, selected: n === current })),
      ],
      onPick: setFilter,
    }),
  );

  box.hidden = false;
  box.replaceChildren(filter, all); // Filter jobs on the left (smaller), All jobs on the right (bigger).
  return current ? state.shifts.filter((s) => s.job === current) : state.shifts;
}

function renderHistory() {
  const now = Date.now();
  const box = $('history');
  if (state.shifts.length === 0) {
    box.innerHTML = '<p class="empty">No shifts yet. Tap Start Work on the Clock tab, or import a CSV in Settings.</p>';
    return;
  }
  const shown = renderJobFilter();
  const years = buildHistory(shown, now, { weekStartsOn: state.settings.weekStartsOn ?? 1 });

  // Pay for a period, from the shifts on screen: "$3,420", or "$6,667 · $41.67/hr" with a salary.
  const hourly = hourlyShiftPay(state, now);
  const moneyFor = (from, to, kind) => {
    const g = groupPay(state, shown.filter((s) => s.start >= from && s.start < to), from, to, kind, hourly, now);
    if (!g.hasPay) return '';
    return formatMoney(g.amount, { cents: false }) + (g.effectiveRate != null ? ` · ${formatMoney(g.effectiveRate)}/hr` : '');
  };
  const monthRange = (key) => {
    const [y, m] = key.split('-').map(Number);
    return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
  };

  box.innerHTML = years
    .map((y) => {
      const yearKey = `year-${y.year}`;
      const months = isOpen(yearKey, false)
        ? y.months
            .map((m) => {
              const openByDefault = false;
              return `<div class="month">
                ${groupHeading({ key: m.key, openByDefault, cls: 'month-head', label: formatMonthHeading(m.start), totals: m, money: moneyFor(...monthRange(m.key), 'month') })}
                ${isOpen(m.key, openByDefault) ? monthBody(m, now, moneyFor) : ''}
              </div>`;
            })
            .join('')
        : '';
      return `<section class="year">${groupHeading({ key: yearKey, openByDefault: false, cls: 'year-head', label: y.year, totals: y, money: moneyFor(new Date(y.year, 0, 1).getTime(), new Date(y.year + 1, 0, 1).getTime(), 'year') })}${months}</section>`;
    })
    .join('');
}

// ---- Settings screen ----

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function onImportFilesChosen(event) {
  const chosen = [...event.target.files];
  event.target.value = ''; // Lets you pick the same file again later.
  if (chosen.length === 0) return;
  log.info('import.selected', { files: chosen.map((f) => ({ name: f.name, bytes: f.size, type: f.type })) });
  try {
    const files = await Promise.all(chosen.map(async (f) => ({ name: f.name, text: await f.text() })));
    pendingImport = importFiles(files, state.shifts);
  } catch (error) {
    log.error('import.read.failed', { error });
    alert(`Could not read the file: ${error.message}`);
    pendingImport = null;
  }
  renderImportPreview();
}

function renderImportPreview() {
  const box = $('import-preview');
  if (!pendingImport) {
    box.replaceChildren();
    return;
  }
  const total = pendingImport.shifts.length;
  const files = pendingImport.files
    .map((f) => {
      if (f.error) return `<div class="file"><strong>${escapeHtml(f.name)}</strong><div class="error">${escapeHtml(f.error)}</div></div>`;
      const warnings = f.warnings.length
        ? `<details><summary>${f.warnings.length} note${f.warnings.length === 1 ? '' : 's'}</summary><ul>${f.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></details>`
        : '';
      return `<div class="file"><strong>${escapeHtml(f.name)}</strong>
        <div>${escapeHtml(f.formatLabel)} file · ${f.added} new shift${f.added === 1 ? '' : 's'}${f.duplicates ? ` · ${f.duplicates} already in the app` : ''}</div>
        ${warnings}</div>`;
    })
    .join('');
  box.innerHTML = `<div class="import-report">${files}
    ${total ? `<button id="btn-confirm-import" class="button">Import ${total} shift${total === 1 ? '' : 's'}</button>` : '<p>Nothing new to import.</p>'}
    <button id="btn-cancel-import" class="button secondary">Cancel</button></div>`;
  $('btn-confirm-import')?.addEventListener('click', confirmImport);
  $('btn-cancel-import').addEventListener('click', () => {
    log.info('import.cancelled', { batchId: pendingImport.batchId });
    pendingImport = null;
    renderImportPreview();
  });
}

function confirmImport() {
  const count = pendingImport.shifts.length;
  store.applyImport(state, pendingImport, Date.now());
  pendingImport = null;
  persist();
  render();
  alert(`Imported ${count} shift${count === 1 ? '' : 's'}.`);
}

function renderSettings() {
  $('app-version').textContent = APP_VERSION;
  $('last-backup').textContent = lastBackupText(Date.now());
  renderJobsSettings();
  $('setting-week-start').value = String(state.settings.weekStartsOn ?? 1);

  const undoImport = $('btn-undo-import');
  undoImport.hidden = !state.lastImport;
  if (state.lastImport) undoImport.textContent = `Undo last import (${state.lastImport.count} shifts)`;

  renderLogView();
}

function renderJobsSettings() {
  const active = jobs.activeJobs(state);
  const fallback = jobs.defaultJob(state);
  $('jobs-list').innerHTML = state.jobs.length
    ? state.jobs
        .map((j) => {
          const name = escapeHtml(j.name);
          const notes = [];
          if (j.archived) notes.push('Hidden. Past shifts stay in History.');
          else if (j.name === fallback && active.length > 1) notes.push('Default job');
          const payText = describePay(payForJob(state, j.name), Date.now());
          if (payText) notes.push(payText);
          const note = notes.join(' · ');
          const buttons = j.archived
            ? `<button type="button" data-action="restore" data-name="${name}">Show</button>`
            : `<button type="button" data-action="pay" data-name="${name}">Pay</button>
               <button type="button" data-action="rename" data-name="${name}">Rename</button>
               <button type="button" class="remove-job" data-action="remove" data-name="${name}">Remove</button>`;
          return `<li class="${j.archived ? 'hidden-job' : ''}"><span class="job-name">${name}${note ? `<small>${note}</small>` : ''}</span>${buttons}</li>`;
        })
        .join('')
    : `<li><span class="job-name">${escapeHtml(fallback)}<small>Used until you add a job.</small></span></li>`;

  $('setting-job-mode').value = state.settings.jobMode ?? 'default';
  $('setting-default-job').replaceChildren(...active.map((n) => new Option(n, n, false, n === fallback)));
  $('default-job-field').hidden = state.settings.jobMode === 'ask' || active.length < 2;
  $('job-mode-hint').textContent =
    active.length < 2
      ? 'With one job, Start Work never asks.'
      : state.settings.jobMode === 'ask'
        ? 'Start Work shows your jobs as buttons. Tap one to clock in.'
        : `Start Work clocks you into ${fallback}.`;
}

function onJobAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const name = button.dataset.name;
  const action = button.dataset.action;
  try {
    if (action === 'pay') {
      openPayEditor(name);
    } else if (action === 'rename') {
      const newName = prompt('New name for this job:', name);
      if (newName == null || newName.trim() === name) return;
      let changed = 0;
      perform('renameJob', (s) => (changed = jobs.renameJob(s, name, newName)), () =>
        `Renamed to ${newName.trim()}${changed ? `. Updated ${changed} shift${changed === 1 ? '' : 's'}` : ''}.`);
    } else if (action === 'remove') {
      if (!confirm(`Remove "${name}"? If it has past shifts, it is hidden instead and they stay in History.`)) return;
      let result = '';
      perform('removeJob', (s) => (result = jobs.removeJob(s, name)), () => (result === 'hidden' ? `"${name}" hidden.` : `"${name}" removed.`));
    } else if (action === 'restore') {
      perform('restoreJob', (s) => jobs.addJob(s, name), `"${name}" is back.`);
    }
  } catch (error) {
    log.warn('action.rejected', { action: `job.${action}`, message: error.message });
    alert(error.message);
  }
}

// ---- Pay editor ----

let payEditing = null; // { job, defaultFrom, rows: [{ amount, from }] }

function openPayEditor(jobName) {
  const pay = payForJob(state, jobName);
  const firstShift = Math.min(...state.shifts.filter((s) => s.job === jobName).map((s) => s.start));
  const defaultFrom = formatDate(Number.isFinite(firstShift) ? firstShift : Date.now());
  const ot = pay?.overtime ?? DEFAULT_OVERTIME;
  payEditing = {
    job: jobName,
    defaultFrom,
    rows: pay ? [...pay.rates].sort((a, b) => a.from.localeCompare(b.from)) : [{ amount: '', from: defaultFrom }],
  };
  $('dlg-pay-title').textContent = jobName;
  $('pay-type').value = pay?.type ?? '';
  $('pay-per').value = pay?.per ?? 'year';
  // Overtime starts on for a job that isn't hourly yet; an hourly job keeps its own choice.
  $('pay-ot-enabled').checked = pay?.type === 'hourly' ? !!pay.overtime?.enabled : true;
  $('pay-ot-threshold').value = ot.threshold;
  $('pay-ot-per').value = ot.per;
  $('pay-ot-multiplier').value = ot.multiplier;
  renderRateRows();
  updatePayForm();
  log.debug('dialog.pay.open', { job: jobName });
  $('dlg-pay').showModal();
}

function renderRateRows() {
  $('pay-rates').replaceChildren(
    ...payEditing.rows.map((row, i) => {
      const el = document.createElement('div');
      el.className = 'rate-row';
      el.innerHTML = `
        <span class="money-input"><input type="number" class="r-amount" inputmode="decimal" min="0" step="0.01" aria-label="Rate ${i + 1} amount" value="${row.amount ?? ''}"></span>
        <input type="date" class="r-from" aria-label="Rate ${i + 1} start date" value="${row.from ?? ''}">
        <button type="button" class="remove" aria-label="Remove rate ${i + 1}">×</button>`;
      el.querySelector('.remove').hidden = payEditing.rows.length === 1;
      el.querySelector('.remove').addEventListener('click', () => {
        payEditing.rows = readRateRows();
        payEditing.rows.splice(i, 1);
        renderRateRows();
        updatePayForm();
      });
      return el;
    }),
  );
}

function readRateRows() {
  return [...$('pay-rates').querySelectorAll('.rate-row')].map((el) => ({
    amount: el.querySelector('.r-amount').value === '' ? '' : Number(el.querySelector('.r-amount').value),
    from: el.querySelector('.r-from').value,
  }));
}

/** The pay setup as typed, or null for "No pay set". */
function readPayDraft() {
  const type = $('pay-type').value;
  if (!type) return null;
  const rates = readRateRows().map((r) => ({ from: r.from, amount: r.amount === '' ? NaN : r.amount }));
  if (type === 'hourly') {
    return {
      type,
      rates,
      overtime: {
        enabled: $('pay-ot-enabled').checked,
        threshold: Number($('pay-ot-threshold').value),
        per: $('pay-ot-per').value,
        multiplier: Number($('pay-ot-multiplier').value),
      },
    };
  }
  return { type, per: $('pay-per').value, rates };
}

function updatePayForm() {
  const type = $('pay-type').value;
  $('pay-details').hidden = !type;
  $('pay-per-field').hidden = type !== 'salary';
  $('pay-hourly-options').hidden = type !== 'hourly';
  $('pay-ot-fields').hidden = !$('pay-ot-enabled').checked;
  $('pay-rates-label').textContent =
    type === 'hourly' ? 'Dollars per hour' : $('pay-per').value === 'month' ? 'Dollars per month' : 'Dollars per year';
  const problems = validatePay(readPayDraft());
  $('pay-errors').replaceChildren(...problems.map((p) => Object.assign(document.createElement('li'), { textContent: p })));
  $('dlg-pay-save').disabled = problems.length > 0;
}

function addRateRow() {
  payEditing.rows = readRateRows();
  const last = payEditing.rows.at(-1);
  payEditing.rows.push({ amount: last?.amount ?? '', from: formatDate(Date.now()) });
  renderRateRows();
  updatePayForm();
}

function onPaySubmit(event) {
  event.preventDefault();
  const draft = readPayDraft();
  if (draft) draft.rates.sort((a, b) => a.from.localeCompare(b.from));
  const problems = validatePay(draft);
  if (problems.length) return updatePayForm();
  const name = payEditing.job;
  perform('setPay', (s) => jobs.setJobPay(s, name, draft), draft ? `Pay saved for ${name}.` : `Pay removed for ${name}.`);
  $('dlg-pay').close();
}

function addJobFromPrompt() {
  const name = prompt('Name of the job:');
  if (name == null) return;
  act('addJob', (s) => jobs.addJob(s, name), `Added "${name.trim()}".`);
}

function renderLogView() {
  const level = $('log-level').value;
  const entries = getLogs(level).slice(-300).reverse();
  $('log-view').textContent = entries.length ? entries.map(formatLogEntry).join('\n') : 'Nothing logged at this level.';
}

/**
 * Back up every finished shift: opens the Share sheet (Save to Files > Save) on the
 * iPhone, or downloads the file on a computer. `from` is 'banner' or 'settings', for the log.
 * Nothing may be awaited before saveFile(): iOS only opens the Share sheet straight from a tap.
 */
async function backUp(from) {
  const shifts = state.shifts.filter((s) => s.end != null).length;
  const how = await saveFile(backupFileName(Date.now()), buildExportCsv(state.shifts));
  if (how === 'cancelled') return;
  recordBackup(state, Date.now(), { shifts, how, from });
  persist();
  render();
  showNotice(`Backed up ${shifts} shift${shifts === 1 ? '' : 's'}.`);
}

function lastBackupText(now) {
  return state.backup.lastAt ? `Last backup: ${formatWhen(state.backup.lastAt, now)}` : 'Not backed up yet';
}

async function exportLogs() {
  flushLogs();
  await saveFile(`hours-tracker-log-${formatDate(Date.now())}.txt`, logsAsText('debug'), 'text/plain');
}

function wipeAllData() {
  const answer = prompt('This deletes every shift on this phone. Type DELETE to confirm.');
  if (answer !== 'DELETE') {
    log.info('data.wipe.cancelled');
    return;
  }
  log.warn('data.wipe', { shifts: state.shifts.length });
  state = store.emptyState();
  persist();
  render();
}

async function checkStoragePersistence() {
  const el = $('storage-status');
  if (!navigator.storage?.persist) {
    el.textContent = 'standard';
    return;
  }
  try {
    let persisted = await navigator.storage.persisted();
    if (!persisted) persisted = await navigator.storage.persist();
    el.textContent = persisted ? 'protected' : 'standard';
    log.info('storage.persist', { persisted });
  } catch (error) {
    el.textContent = 'unknown';
    log.warn('storage.persist.failed', { error });
  }
}

// ---- Tabs and redraw ----

function showView(name) {
  currentView = name;
  for (const v of ['clock', 'history', 'settings']) $(`view-${v}`).hidden = v !== name;
  for (const b of document.querySelectorAll('.tabbar button')) {
    if (b.dataset.view === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  log.debug('view.show', { view: name });
  render();
}

function render() {
  renderClock();
  if (currentView === 'history') renderHistory();
  if (currentView === 'settings') renderSettings();
}

function wireUp() {
  // Block pinch zoom. iOS ignores user-scalable=no, but these gesture events let us stop it.
  for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault());

  for (const b of document.querySelectorAll('.tabbar button')) {
    b.addEventListener('click', () => showView(b.dataset.view));
  }

  // Popups
  $('form-time').addEventListener('submit', onTimePickerSubmit);
  $('dlg-time-cancel').addEventListener('click', () => $('dlg-time').close());
  $('form-time').addEventListener('input', () => ($('dlg-time-error').textContent = ''));
  $('form-shift').addEventListener('submit', onShiftEditorSubmit);
  $('form-shift').addEventListener('input', updateShiftPreview);
  $('btn-shift-cancel').addEventListener('click', () => $('dlg-shift').close());
  $('btn-shift-delete').addEventListener('click', deleteEditingShift);
  $('btn-add-break').addEventListener('click', addBreakRow);
  $('toast-undo').addEventListener('click', undo);
  $('btn-banner-clockout').addEventListener('click', pickClockOut);

  // History
  $('btn-add-shift').addEventListener('click', () => openShiftEditor(null));
  $('history').addEventListener('click', (e) => {
    const heading = e.target.closest('[data-toggle]');
    if (heading) return toggleGroup(heading.dataset.toggle, heading.dataset.defaultOpen === 'true');
    const line = e.target.closest('[data-id]');
    if (line) openShiftEditor(store.findShift(state, line.dataset.id));
  });

  // Settings
  $('btn-export').addEventListener('click', () => backUp('settings'));
  $('btn-backup').addEventListener('click', () => backUp('banner'));
  // Goes through perform() so the bar offers Undo if you tap × by mistake.
  $('btn-backup-dismiss').addEventListener('click', () =>
    perform('hideBackupReminder', dismissBackupForToday, 'Backup reminder hidden until tomorrow.'));
  $('import-input').addEventListener('change', onImportFilesChosen);
  $('btn-undo-import').addEventListener('click', () => {
    const count = state.lastImport?.count ?? 0;
    if (!confirm(`Undo the last import? This removes the ${count} shift${count === 1 ? '' : 's'} it added.`)) return;
    const answer = prompt('To confirm, type the word undo.');
    if (!typedConfirmation(answer, 'undo')) {
      log.info('import.undo.cancelled', { typed: answer == null ? null : answer.length ? 'other text' : 'blank' });
      if (answer != null) alert('Nothing was removed. Type undo to confirm.');
      return;
    }
    const removed = store.undoLastImport(state);
    persist();
    render();
    alert(`Removed ${removed} shift${removed === 1 ? '' : 's'}.`);
  });
  $('setting-week-start').addEventListener('change', (e) => {
    state.settings.weekStartsOn = Number(e.target.value);
    log.info('settings.weekStartsOn', { weekStartsOn: state.settings.weekStartsOn });
    persist();
  });
  $('jobs-list').addEventListener('click', onJobAction);
  $('btn-add-job').addEventListener('click', addJobFromPrompt);
  $('setting-job-mode').addEventListener('change', (e) => {
    state.settings.jobMode = e.target.value;
    log.info('settings.jobMode', { jobMode: state.settings.jobMode });
    persist();
    renderSettings();
  });
  $('setting-default-job').addEventListener('change', (e) => {
    state.settings.defaultJob = e.target.value;
    log.info('settings.defaultJob', { defaultJob: state.settings.defaultJob });
    persist();
    renderSettings();
  });
  $('dlg-job-cancel').addEventListener('click', () => $('dlg-job').close());
  $('form-pay').addEventListener('submit', onPaySubmit);
  $('form-pay').addEventListener('input', updatePayForm);
  $('form-pay').addEventListener('change', updatePayForm);
  $('dlg-pay-cancel').addEventListener('click', () => $('dlg-pay').close());
  $('btn-add-rate').addEventListener('click', addRateRow);
  $('log-level').addEventListener('change', renderLogView);
  $('btn-export-logs').addEventListener('click', exportLogs);
  $('btn-clear-logs').addEventListener('click', () => {
    if (!confirm('Clear the debug log?')) return;
    clearLogs();
    log.info('logs.cleared');
    renderLogView();
  });
  $('btn-wipe').addEventListener('click', wipeAllData);

  // Timers are computed from saved timestamps, so redrawing once a second is only cosmetic.
  setInterval(renderClock, 1000);

  // When you come back to the app, redraw right away, reload data in case another tab
  // changed it, and pick up a new version if one was published.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushLogs();
    } else {
      state = store.loadState(storage);
      render();
      checkForUpdate();
    }
  });
  window.addEventListener('pagehide', flushLogs);
}

/**
 * iPhone keeps a home-screen app frozen in the background instead of reopening it,
 * so a new version wouldn't show up until you swiped the app closed. Instead, each
 * time you come back, the app asks which build is published (build.txt, written by
 * the publish workflow) and reloads if it's a different one from when it started.
 * Comparing builds instead of version numbers means fixes to Hours Beta show up even
 * when the version number stays the same. Your data is saved on the phone, so
 * reloading loses nothing. It waits if a popup or an import review is open.
 */
let startedOnBuild = null;

async function publishedBuild() {
  try {
    const res = await fetch('build.txt', { cache: 'no-store' });
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null; // No signal.
  }
}

async function checkForUpdate() {
  const latest = await publishedBuild();
  if (!latest) return;
  if (!startedOnBuild) {
    startedOnBuild = latest;
    return;
  }
  if (latest === startedOnBuild) return;
  if (document.querySelector('dialog[open]') || pendingImport) {
    log.info('app.update.waiting', { from: startedOnBuild, to: latest, reason: 'popup or import open' });
    return;
  }
  log.info('app.update', { version: APP_VERSION, from: startedOnBuild, to: latest });
  flushLogs();
  location.reload();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    log.info('sw.unsupported', { secureContext: window.isSecureContext });
    return;
  }
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => log.info('sw.registered', { scope: reg.scope }))
    .catch((error) => log.warn('sw.register.failed', { error }));
}

$('beta-strip').hidden = !IS_BETA;
wireUp();
checkForUpdate(); // Records which build this launch started on.
render();
checkStoragePersistence();
registerServiceWorker();
