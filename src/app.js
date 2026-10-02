// The screen. Connects buttons to the actions in store.js and redraws.
// Business logic (time math, CSV, data changes) lives in the other modules so it
// can be tested without a browser; this file should stay mostly "glue".

import { APP_VERSION } from './version.js';
import { initLogger, log, installGlobalErrorHandlers, getLogs, clearLogs, logsAsText, formatLogEntry, flushLogs } from './logger.js';
import * as store from './store.js';
import {
  totalsForDay, workedMs, breakMs, startOfDay,
  formatClock, formatHM, formatTimeOfDay, formatDate, formatDayHeading,
} from './time.js';
import { importFiles } from './importers.js';
import { buildExportCsv, exportFileName } from './exporter.js';
import { saveFile } from './files.js';

// ---- Startup ----

const storage = getStorage();
initLogger({ storage });
installGlobalErrorHandlers(window);
log.info('app.start', {
  version: APP_VERSION,
  standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  userAgent: navigator.userAgent,
  url: location.href,
});

let state = store.loadState(storage);
let pendingImport = null; // An import that has been read but not confirmed yet.
let currentView = 'clock';
let renderedStatus = null; // Which buttons are on screen, so they're only rebuilt on change.

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
    alert('Could not save your data on this phone. Export a CSV now so nothing is lost, then check More > Debug log.');
  }
}

/** Run an action from store.js, save, and redraw. Shows the problem instead of failing silently. */
function act(name, fn) {
  try {
    fn(state, Date.now());
    persist();
    render();
  } catch (error) {
    log.warn('action.rejected', { action: name, message: error.message });
    alert(error.message);
  }
}

// ---- Clock screen ----

const BUTTONS = {
  off: [{ label: 'Start Work', cls: '', run: () => act('startWork', store.startWork) }],
  working: [
    { label: 'Start Break', cls: 'break', run: () => act('startBreak', store.startBreak) },
    { label: 'Clock Out', cls: 'secondary', run: confirmClockOut },
  ],
  break: [
    { label: 'End Break', cls: '', run: () => act('endBreak', store.endBreak) },
    { label: 'Clock Out', cls: 'secondary', run: confirmClockOut },
  ],
};

function confirmClockOut() {
  if (confirm('Clock out and end this shift?')) act('clockOut', store.clockOut);
}

function renderClock() {
  const now = Date.now();
  const shift = store.activeShift(state);
  const brk = store.activeBreak(shift);
  const status = store.currentStatus(state);
  const today = totalsForDay(state.shifts, now);

  const sessionWorked = shift ? workedMs(shift, now) : 0;
  const thisBreak = brk ? now - brk.start : 0;

  document.body.dataset.status = status;
  $('status').textContent = { off: 'Off the clock', working: 'Working', break: 'On break' }[status];

  if (status === 'working') {
    $('hero-label').textContent = 'Working this session';
    $('hero-time').textContent = formatClock(sessionWorked);
    $('since').textContent = `Clocked in at ${formatTimeOfDay(shift.start)}`;
  } else if (status === 'break') {
    $('hero-label').textContent = 'On break';
    $('hero-time').textContent = formatClock(thisBreak);
    $('since').textContent = `Break started at ${formatTimeOfDay(brk.start)}`;
  } else {
    $('hero-label').textContent = 'Worked today';
    $('hero-time').textContent = formatClock(today.workedMs);
    $('since').textContent = '';
  }

  $('stat-session').textContent = formatClock(sessionWorked);
  $('stat-today').textContent = formatClock(today.workedMs);
  $('stat-break').textContent = formatClock(thisBreak);
  $('stat-break-today').textContent = formatClock(today.breakMs);

  // Rebuilding buttons every second would swallow taps, so only do it when the status changes.
  if (status !== renderedStatus) {
    const box = $('actions');
    box.replaceChildren(
      ...BUTTONS[status].map((b) => {
        const el = document.createElement('button');
        el.className = `button ${b.cls}`.trim();
        el.textContent = b.label;
        el.addEventListener('click', b.run);
        return el;
      }),
    );
    renderedStatus = status;
  }
}

// ---- History screen ----

function renderHistory() {
  const now = Date.now();
  const byDay = new Map();
  for (const s of state.shifts) {
    const day = startOfDay(s.start);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(s);
  }
  const days = [...byDay.keys()].sort((a, b) => b - a);
  const box = $('history');
  if (days.length === 0) {
    box.innerHTML = '<p class="empty">No shifts yet. Tap Start Work on the Clock tab, or import a CSV from More.</p>';
    return;
  }

  box.replaceChildren(
    ...days.map((day) => {
      const shifts = byDay.get(day).sort((a, b) => a.start - b.start);
      const worked = shifts.reduce((sum, s) => sum + workedMs(s, now), 0);
      const el = document.createElement('div');
      el.className = 'day';
      el.innerHTML = `
        <div class="day-head"><span>${formatDayHeading(day)}</span><span class="total">${formatHM(worked)}</span></div>
        ${shifts
          .map((s) => {
            const end = s.end == null ? 'now' : formatTimeOfDay(s.end);
            const br = breakMs(s, now);
            return `<div class="shift-line"><span>${formatTimeOfDay(s.start)} to ${end}</span><span>${formatHM(br) !== '0:00' ? `break ${formatHM(br)} · ` : ''}${formatHM(workedMs(s, now))}</span></div>`;
          })
          .join('')}`;
      return el;
    }),
  );
}

// ---- More screen ----

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

function renderMore() {
  $('app-version').textContent = APP_VERSION;
  const jobInput = $('setting-job');
  if (document.activeElement !== jobInput) jobInput.value = state.settings.job;
  jobInput.placeholder = store.effectiveJob(state);

  const undo = $('btn-undo-import');
  undo.hidden = !state.lastImport;
  if (state.lastImport) undo.textContent = `Undo last import (${state.lastImport.count} shifts)`;

  renderLogView();
}

function renderLogView() {
  const level = $('log-level').value;
  const entries = getLogs(level).slice(-300).reverse();
  $('log-view').textContent = entries.length ? entries.map(formatLogEntry).join('\n') : 'Nothing logged at this level.';
}

async function exportCsv() {
  const now = Date.now();
  await saveFile(exportFileName(now), buildExportCsv(state.shifts));
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
  for (const v of ['clock', 'history', 'more']) $(`view-${v}`).hidden = v !== name;
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
  if (currentView === 'more') renderMore();
}

function wireUp() {
  for (const b of document.querySelectorAll('.tabbar button')) {
    b.addEventListener('click', () => showView(b.dataset.view));
  }
  $('btn-export').addEventListener('click', exportCsv);
  $('import-input').addEventListener('change', onImportFilesChosen);
  $('btn-undo-import').addEventListener('click', () => {
    if (!confirm('Remove every shift added by the last import?')) return;
    const removed = store.undoLastImport(state);
    persist();
    render();
    alert(`Removed ${removed} shift${removed === 1 ? '' : 's'}.`);
  });
  $('setting-job').addEventListener('change', (e) => {
    state.settings.job = e.target.value.trim();
    log.info('settings.job', { job: state.settings.job });
    persist();
    renderMore();
  });
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

  // When you come back to the app, redraw right away and reload data in case another tab changed it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushLogs();
    } else {
      state = store.loadState(storage);
      render();
    }
  });
  window.addEventListener('pagehide', flushLogs);
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

wireUp();
render();
checkStoragePersistence();
registerServiceWorker();
