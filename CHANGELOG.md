# Changelog

Every version of the app and what changed in it. Newest first.

Each pull request that changes the app adds a section at the top with a new version number (also set in `src/version.js` and `package.json`). When the pull request is merged, GitHub creates a Release with that section as its notes.

Sections use these headings: **Added** (new features), **Changed** (existing features that work differently), **Fixed** (bugs), **Removed**.

## [0.6.0] - 2026-10-02

### Added

- A **Back up to iCloud** banner on the Clock tab, under the Edit shift / Clock out at links. It shows once a day until you back up. Tap it, then **Save to Files**, then **Save**, without leaving the Clock tab. Backups are named by weekday (`hours-tracker-Mon.csv` through `hours-tracker-Sun.csv`), so the folder never holds more than 7 files and you can go back up to a week. Each one restores everything when imported.
- The banner's **×** hides it until tomorrow, with **Undo** in case you tap it by mistake.
- Settings shows when you last backed up, and **Back up now** there counts as today's backup too.

### Fixed

- Saving a backup or log to Files no longer creates a second, text-only file containing the file name.

## [0.5.0] - 2026-10-02

### Changed

- The **More** tab is now **Settings**, with a gear icon. Clock and History have icons too.
- Settings is grouped into **Jobs**, **Backup & data** (Back up now, Import), **Preferences** (Week starts on), and **Troubleshooting** (Debug log, now hidden until you tap **Show**, and Delete all data).

## [0.4.0] - 2026-10-02

### Added

- History groups shifts by year, then month, then week. Tap a year or month heading to open or close it. Closed months show only their totals, so you can compare months at a glance. Everything starts closed; what you open is remembered.
- Each year and month heading shows days worked and average hours per day worked, for example "20 days · avg 7:46".
- Open months show a total for each week. A week that crosses into the next month shows its full-week total in both months.
- **Week starts on** setting (Monday or Sunday) under More > Settings.

### Changed

- Totals over 999 hours have commas, for example "1,330:42".
- **Add shift** suggests your most recent shift's times rounded to the nearest 15 minutes (8:00 AM to 5:07 PM becomes 8:00 AM to 5:00 PM).
- The app picks up every new publish when you switch back to it, even when the version number didn't change.

### Fixed

- Pinching or double-tapping no longer zooms the app (it could get stuck zoomed in). Two quick taps on a History heading now just open and close it.

## [0.3.1] - 2026-10-02

### Added

- A test copy of the app at https://badger-one.github.io/hours-tracker/beta/ ("Hours Beta", orange icon and BETA strip) for trying changes before they reach the real app. It keeps its own data, separate from the real app's.

## [0.3.0] - 2026-10-02

### Changed

- History shows one line per shift: date, start and end time, and hours worked. Times too long for the screen end in "…". Shifts are grouped by month, with the month's total hours in the heading. Break totals no longer show in the list; open a shift to see its breaks.
- Popups have large filled buttons: a red **Cancel** and a green **Start**, **Save**, **Clock out**, and so on.
- **Clock Out** is red and **Start Break** is yellow. **Cancel** on a scheduled start is red.
- The "edited" and "added" tags moved from the History list into the shift editor, which now says when a shift was edited, added by hand, or imported.

## [0.2.1] - 2026-10-02

### Changed

- The **Start at…**, **Clock out at…**, **Break at…**, and **End break at…** popups now have separate **Date** and **Time** fields. The quick-pick buttons ("15 min ago" and so on) are gone, and the calendar no longer opens by itself when the popup appears.
- The shift editor has one **Date** with **Start** and **End** times. An end time earlier than the start (a shift past midnight) moves to the next day automatically.
- **Cancel** and **Save** moved to the top bar of both popups, away from the iPhone's date and time pickers. **Delete shift** moved to the bottom with space above it, so tapping below a picker to close it can't hit a button.

### Fixed

- A new version now loads when you switch back to the app. Before, you had to swipe the app closed and reopen it.

## [0.2.0] - 2026-10-02

### Added

- **Start at…**: clock in at an earlier time, or up to 24 hours ahead. A future start shows a countdown on the Clock tab and starts counting on its own, with **Start Now** and **Cancel** buttons.
- **Edit shift**: change the start time, end time, breaks, job, or note of the running shift (Clock tab) or any past shift (tap it in History). You can also delete a shift.
- **Add shift** button in History for a day you forgot to track.
- **Clock out at…**, **Break at…**, and **End break at…** for when you tap late.
- **Undo** bar for 8 seconds after every clock action, edit, and delete.
- A reminder on the Clock tab when you've been clocked in for more than 14 hours, with a **Clock out at…** button.
- History marks shifts you edited or added by hand.
- Checks that stop shifts from overlapping each other, breaks from falling outside their shift, and end times from being in the future. The editor shows each problem as you type.

### Changed

- **Clock Out** no longer asks "Are you sure?". Use **Undo** instead.

## [0.1.0] - 2026-10-02

### Added

- Clock tab with **Start Work**, **Start Break**, **End Break**, and **Clock Out**, showing this session, today's work, this break, and today's breaks.
- History tab with shifts grouped by day.
- CSV export that doubles as a backup.
- CSV import for Hours Tracker (Cribasoft) exports and this app's backups, with a review step and **Undo last import**.
- Debug log under More, with export.
- Works offline and installs to the iPhone home screen.
