// Keeps the version number and the changelog in step.
// If this fails: add a "## [x.y.z] - YYYY-MM-DD" section to CHANGELOG.md for the
// version in src/version.js, and set the same version in package.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../src/version.js';
import { changelogSection } from '../tools/changelog-notes.js';

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package.json version matches src/version.js', () => {
  assert.equal(pkg.version, APP_VERSION);
});

test('CHANGELOG.md has a section for the current version, and it is the newest one', () => {
  const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/gm)].map((m) => m[1]);
  assert.equal(versions[0], APP_VERSION, `The top section of CHANGELOG.md should be ## [${APP_VERSION}] - YYYY-MM-DD`);
  assert.ok(changelogSection(changelog, APP_VERSION).length > 0, 'The section is empty');
  assert.equal(new Set(versions).size, versions.length, 'A version appears twice');
});

test('changelogSection pulls out just one version', () => {
  const text = '# Changelog\n\n## [0.2.0] - 2026-10-02\n\n- B\n\n## [0.1.0] - 2026-10-01\n\n- A\n';
  assert.equal(changelogSection(text, '0.2.0'), '- B');
  assert.equal(changelogSection(text, '0.1.0'), '- A');
  assert.equal(changelogSection(text, '9.9.9'), null);
});
