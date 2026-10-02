# Changelog

Every version of the app and what changed in it. Newest first.

Each pull request that changes the app adds a section at the top with a new version number (also set in `src/version.js` and `package.json`). When the pull request is merged, GitHub creates a Release with that section as its notes.

Sections use these headings: **Added** (new features), **Changed** (existing features that work differently), **Fixed** (bugs), **Removed**.

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
