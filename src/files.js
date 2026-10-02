// Getting a file out of the app.
// On the iPhone this opens the Share sheet (Save to Files, Mail, AirDrop...).
// On a computer it downloads the file.

import { log } from './logger.js';

/** Returns 'shared', 'downloaded', or 'cancelled'. */
export async function saveFile(name, text, type = 'text/csv') {
  const file = new File([text], name, { type });
  const isTouchDevice = navigator.maxTouchPoints > 0;

  if (isTouchDevice && navigator.canShare?.({ files: [file] })) {
    try {
      // Share only the file. Adding a title makes Save to Files save a second, text-only file.
      await navigator.share({ files: [file] });
      log.info('file.shared', { name, bytes: text.length });
      return 'shared';
    } catch (error) {
      if (error.name === 'AbortError') {
        log.info('file.share.cancelled', { name });
        return 'cancelled';
      }
      log.warn('file.share.failed', { name, error });
      // Fall through to a plain download.
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  log.info('file.downloaded', { name, bytes: text.length });
  return 'downloaded';
}
