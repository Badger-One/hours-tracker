// Prints one version's section from CHANGELOG.md.
// Used by the Release workflow to write the GitHub Release notes.
//
//   node tools/changelog-notes.js 0.2.0

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The body of the "## [version]" section, without its heading. Null if there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## ['));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const notes = changelogSection(changelog, version);
  if (!notes) {
    console.error(`CHANGELOG.md has no section for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
