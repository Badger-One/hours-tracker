// Turns a copy of the app into the test copy published at /beta/.
// Run by .github/workflows/pages.yml on the copy it publishes; never on your files.
//
//   node tools/mark-beta.js _site/beta
//
// It renames the app to "Hours Beta" (so the home screen icon says so) and swaps
// in the orange icons. The orange BETA strip and separate saved data are handled
// by the app itself (src/env.js), based on the /beta/ address.

import { readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function markIndexHtml(html) {
  return html
    .replace('<title>Hours Tracker</title>', '<title>Hours Beta</title>')
    .replace('<meta name="apple-mobile-web-app-title" content="Hours">', '<meta name="apple-mobile-web-app-title" content="Hours Beta">')
    .replace('<meta name="theme-color" content="#0f766e">', '<meta name="theme-color" content="#ea580c">');
}

export function markManifest(json) {
  const manifest = JSON.parse(json);
  manifest.name = 'Hours Tracker Beta';
  manifest.short_name = 'Hours Beta';
  manifest.theme_color = '#ea580c';
  return JSON.stringify(manifest, null, 2) + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node tools/mark-beta.js <folder>');
    process.exit(1);
  }
  const file = (name) => path.join(dir, name);
  writeFileSync(file('index.html'), markIndexHtml(readFileSync(file('index.html'), 'utf8')));
  writeFileSync(file('manifest.webmanifest'), markManifest(readFileSync(file('manifest.webmanifest'), 'utf8')));
  for (const icon of readdirSync(file('icons/beta'))) copyFileSync(file(`icons/beta/${icon}`), file(`icons/${icon}`));
  console.log(`Marked ${dir} as the beta copy.`);
}
