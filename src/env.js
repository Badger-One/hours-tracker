// Which copy of the app is running.
//
// The real app lives at /hours-tracker/ and the test copy at /hours-tracker/beta/.
// Both are on the same website, so they would share the phone's saved data. Every
// saved item's name goes through storageKey(), which gives the test copy its own
// names. That keeps the test copy from reading or changing your real hours.

export function isBetaPath(pathname) {
  return /\/beta\//.test(pathname ?? '');
}

export const IS_BETA = isBetaPath(globalThis.location?.pathname);

/** "data:v1" -> "hours-tracker:data:v1" in the real app, "hours-tracker-beta:data:v1" in the test copy. */
export function storageKey(name, beta = IS_BETA) {
  return `${beta ? 'hours-tracker-beta' : 'hours-tracker'}:${name}`;
}
