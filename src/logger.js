// Debug logging.
//
// Every log entry is saved on the device (newest 2000 kept) and also printed to the
// browser console. You can read, filter, and export the log from More > Debug log,
// which matters on an iPhone where there is no console to look at.
//
// Usage:
//   log.info('shift.start', { id, job });
//   log.error('import.failed', { file: name, error: err });
//
// Event names are "area.action" in lowercase so they are easy to search for.

import { storageKey } from './env.js';

const STORAGE_KEY = storageKey('logs:v1');
const MAX_ENTRIES = 2000;
const LEVELS = ['debug', 'info', 'warn', 'error'];

// A short random ID for this app launch. Every entry carries it, so when you read
// an exported log you can tell where one launch ends and the next begins.
export const SESSION_ID = Math.random().toString(36).slice(2, 8);

let storage = null;
let echoToConsole = true;
let entries = [];
let saveTimer = null;

/** Call once at startup. `storage` is window.localStorage in the app, or null in tests. */
export function initLogger({ storage: s = null, console: c = true } = {}) {
  storage = s;
  echoToConsole = c;
  entries = [];
  if (storage) {
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(saved)) entries = saved;
    } catch {
      // A damaged log should never stop the app from starting. Start a fresh one.
      entries = [];
    }
  }
}

/** Errors don't survive JSON.stringify on their own (they become {}), so convert them by hand. */
function toPlain(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
    ),
  );
}

function write(level, event, data) {
  const entry = { t: new Date().toISOString(), level, event, sid: SESSION_ID };
  if (data !== undefined) {
    try {
      entry.data = toPlain(data);
    } catch {
      entry.data = String(data);
    }
  }
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  if (echoToConsole) {
    const fn = level === 'debug' ? 'debug' : level;
    console[fn](`[${level}] ${event}`, entry.data ?? '');
  }

  // Errors are saved right away in case the app is about to crash.
  // Everything else is batched to avoid rewriting the whole log on every line.
  if (level === 'error') flushLogs();
  else scheduleSave();
}

function scheduleSave() {
  if (!storage || saveTimer) return;
  saveTimer = setTimeout(flushLogs, 500);
}

/** Write pending log entries to storage now. Called automatically; also called when the app is hidden. */
export function flushLogs() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage is full. Drop the oldest half of the log and try once more.
    entries.splice(0, Math.floor(entries.length / 2));
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Give up quietly; logging must never break the app.
    }
  }
}

export const log = {
  debug: (event, data) => write('debug', event, data),
  info: (event, data) => write('info', event, data),
  warn: (event, data) => write('warn', event, data),
  error: (event, data) => write('error', event, data),
};

/** Entries at or above `minLevel`, oldest first. */
export function getLogs(minLevel = 'debug') {
  const min = LEVELS.indexOf(minLevel);
  return entries.filter((e) => LEVELS.indexOf(e.level) >= min);
}

export function clearLogs() {
  entries = [];
  flushLogs();
}

/** One line per entry, for exporting and pasting into a bug report. */
export function formatLogEntry(e) {
  const data = e.data === undefined ? '' : ' ' + JSON.stringify(e.data);
  return `${e.t} ${e.level.toUpperCase().padEnd(5)} [${e.sid}] ${e.event}${data}`;
}

export function logsAsText(minLevel = 'debug') {
  return getLogs(minLevel).map(formatLogEntry).join('\n') + '\n';
}

/** Record crashes and failed promises that nothing else caught. */
export function installGlobalErrorHandlers(target) {
  target.addEventListener('error', (ev) => {
    log.error('window.error', {
      message: ev.message,
      source: ev.filename,
      line: ev.lineno,
      column: ev.colno,
      error: ev.error,
    });
  });
  target.addEventListener('unhandledrejection', (ev) => {
    log.error('window.unhandledrejection', { reason: ev.reason });
  });
}
