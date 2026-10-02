// Daily backup reminder.
//
// A web app can't save to iCloud Drive on its own, so the Clock tab shows a banner
// once a day until you back up. Tapping it opens the Share sheet with today's CSV
// (Save to Files > Save). These functions decide when the banner shows and record
// backups; the screen code lives in app.js.

import { formatDate } from './time.js';
import { log } from './logger.js';

/** True when there's something to back up and you haven't backed up (or hidden the banner) today. */
export function backupDue(state, now) {
  const today = formatDate(now);
  if (!state.shifts.some((s) => s.end != null)) return false;
  if (state.backup.lastAt != null && formatDate(state.backup.lastAt) === today) return false;
  if (state.backup.dismissedOn === today) return false;
  return true;
}

/** Remember a finished backup. `how` is 'shared' or 'downloaded' (from files.js). */
export function recordBackup(state, now, { shifts, how, from }) {
  state.backup.lastAt = now;
  log.info('backup.done', { shifts, how, from });
}

/** Hide the banner until tomorrow. */
export function dismissBackupForToday(state, now) {
  state.backup.dismissedOn = formatDate(now);
  log.info('backup.dismissed', { until: 'tomorrow' });
}
