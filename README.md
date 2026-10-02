# Hours Tracker

An iPhone time tracker that replaces the Hours Tracker app by Cribasoft. Tap **Start Work**, tap **Start Break**, export a CSV.

It's a web app you add to your home screen. It runs full screen with its own icon like a normal app, works with no signal, and costs nothing to install because it doesn't go through the App Store.

## What it does

- **Start Work / Clock Out.** The Clock tab shows time worked this session and today.
- **Start Break / End Break.** Shows how long this break has run and your total break time today.
- **History tab.** Every shift grouped by day, with worked time and breaks.
- **Export CSV.** Every finished shift as a spreadsheet file. The file is also a full backup: import it to restore.
- **Import CSV.** Reads Hours Tracker (Cribasoft) exports and this app's own exports. You can pick several files at once and review what's in them before anything is added.
- **Debug log.** The app records what it does (More > Debug log). Export the log when something looks wrong.

## Install it on your iPhone

1. Open **https://badger-one.github.io/hours-tracker/** in **Safari**. Other browsers can't add home screen apps that save data properly.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open **Hours** from your home screen. Use this icon from now on, not the Safari tab.

## Move your history from Hours Tracker

1. In Hours Tracker, export your data as CSV and save the files to the Files app (iCloud Drive or On My iPhone).
2. Open this app **from the home screen icon**, go to **More > Import**, and tap **Choose CSV files**.
3. Select all the files. You'll get a summary per file: how many shifts are new, how many are already in the app, and any notes about lines it had to adjust or skip.
4. Tap **Import**. If the result looks wrong, tap **Undo last import**.

Files that aren't shift lists (a summary file, for example) are listed as "Not a format this app knows" and skipped. Importing the same file twice adds nothing the second time.

## Where your data lives

Your shifts are stored **only on your phone**, inside this app. Nothing is sent anywhere. That has three consequences:

- **Deleting the home screen icon deletes your data.** Export a CSV first.
- **The Safari tab and the home screen app keep separate data.** Always use the home screen icon.
- **There is no automatic backup yet.** Export a CSV every week or so and keep it in iCloud Drive.

## Run it on your PC

You need [Node.js](https://nodejs.org) (already installed on this PC). There's nothing else to install.

1. Open a terminal in this folder.
2. Start the local server:

   ```bash
   npm start
   ```

3. Open **http://localhost:5173** in your browser. To stop the server, press **Ctrl+C** in the terminal.

The server also prints a second address for trying the app on your phone over the same Wi-Fi. Windows may ask whether to allow Node.js through the firewall; allow it on private networks. Over Wi-Fi the app works, but offline mode is off, because iPhones only allow that on https:// sites.

## Run the tests

```bash
npm test
```

The tests check the time math, CSV reading and writing, the Hours Tracker importer, and the Start/Break/Clock Out rules. They run automatically on GitHub for every push and pull request. A red X on a pull request means a test failed.

## Making a change

1. Make a branch: `git switch -c my-change`
2. Edit files. Use `npm start` to look at the result and `npm test` to check nothing broke.
3. Pick a new version number and put it in `src/version.js` and `package.json`. Raise the middle number for new features (0.2.0 to 0.3.0) and the last number for fixes (0.2.0 to 0.2.1). The number shows on the More screen, so you can tell when your phone has the new version.
4. Add a section for that version at the top of [CHANGELOG.md](CHANGELOG.md) listing what changed.
5. Commit, push, and open a pull request. The pull request form has a Changelog section; paste the same notes there.
6. Try it in the test copy first (see below).
7. Merge it. Within about a minute GitHub publishes the new version and creates a [Release](https://github.com/Badger-One/hours-tracker/releases) with the changelog notes. Your phone picks it up the next time you switch to the app with a signal.

A pull request that changes the app without steps 3 and 4 fails the **changelog** check, and `npm test` fails if the version in `src/version.js` has no changelog section.

## The test copy (beta)

A second copy of the app lives at **https://badger-one.github.io/hours-tracker/beta/**. It shows the latest change waiting for approval, so you can try it on your phone before it reaches your real app (or anyone you've shared it with).

- Add it to your home screen the same way as the real app. It's called **Hours Beta**, has an orange icon, and shows an orange **BETA** strip at the top.
- It keeps its own data. Nothing you do there touches your real hours. To try a change on your real history, export a CSV from the real app and import it into the beta.
- It's published from the `beta` branch. To put a change there: `git push --force origin my-change:beta`. When the change is merged, reset it with `git push --force origin main:beta`.
- When there's nothing waiting, the beta copy is the same as the real app.

## Project layout

| Path | What it is |
|---|---|
| `index.html` | The page: the three tabs and their buttons |
| `styles.css` | Colors, sizes, light and dark mode |
| `src/app.js` | Connects the buttons to everything else and redraws the screen |
| `src/store.js` | Your data, saving and loading it, and the Start Work / Break / Clock Out actions |
| `src/time.js` | Time math and formatting ("8:05", "7:00 AM") |
| `src/importers.js` | Reads Hours Tracker and backup CSV files |
| `src/exporter.js` | Writes the export CSV |
| `src/csv.js` | Low-level CSV reading and writing |
| `src/logger.js` | The debug log |
| `src/files.js` | Opens the iPhone Share sheet to save a file |
| `sw.js` | Lets the app open with no signal |
| `manifest.webmanifest` | App name and icon for the home screen |
| `tests/` | Automated tests (`npm test`) |
| `tools/` | The local server and the icon generator |
