// Unique IDs for shifts and import batches.
// crypto.randomUUID() only exists on https:// pages and localhost. When you open the
// dev server from your phone over Wi-Fi (plain http://), it is missing, so fall back
// to random numbers. Collisions are not a practical concern at this app's size.

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
