# Hours Tracker: notes for Claude

A home-screen web app (PWA) for iPhone that tracks work time and breaks. It replaces the Cribasoft "Hours Tracker" app. Hosted on GitHub Pages from `main`.

## About the owner

Skylar is new to programming and has intermediate Git/GitHub knowledge (branches, PRs). Explain in plain language, give exact commands, and say which file and line to look at. Keep instructions as numbered steps.

## Constraints

- No Mac, so no Xcode or native Swift. The app must run in iOS Safari as a home-screen web app.
- No build step and no npm dependencies. Plain ES modules served as static files. Tests use Node's built-in `node:test`. Ask before adding a dependency or build tool.
- All paths are relative (`src/app.js`, not `/src/app.js`) because GitHub Pages serves the app from `/hours-tracker/`.
- Data stays on the device in `localStorage` (key `hours-tracker:data:v1`). Never send user data to a server.
- Never commit real time data. `.gitignore` blocks `*.csv` except `tests/fixtures/`.

## Conventions

- Business logic goes in modules that don't touch the DOM (`store.js`, `time.js`, `importers.js`, `exporter.js`, `csv.js`) so it can be tested in Node. `app.js` is glue.
- Times are epoch milliseconds; durations are milliseconds. Format only at the edges.
- Log every user action and every failure with `log.info/warn/error('area.action', { data })`. Pass Error objects as `{ error }` so the stack is kept.
- Show problems to the user (alert or on-screen text) instead of failing silently.
- When adding a file under `src/` or `icons/`, add it to `APP_FILES` in `sw.js`. `tests/sw.test.js` enforces this.
- If the saved data shape changes, bump `schema` in `store.js` and migrate old data in `loadState`.
- Shift rules (no overlaps, breaks inside shifts, no future end times) live in `validateShift` in `store.js`. Every action that changes a shift must go through it.
- Clock actions and edits go through `perform()` in `app.js` so they get an Undo bar.
- Run `npm test` before committing.

## Releasing (every PR that changes the app)

1. Bump the version in `src/version.js` and `package.json` (minor for features, patch for fixes).
2. Add a `## [x.y.z] - YYYY-MM-DD` section at the top of `CHANGELOG.md` with Added / Changed / Fixed / Removed lists, written for Skylar (what changed on screen, not code details).
3. Fill in the PR template, pasting the changelog section under "Changelog".
4. On merge, `.github/workflows/release.yml` creates GitHub Release `vx.y.z` from that section. The PR check in `test.yml` fails if app files changed without a version and changelog bump.
