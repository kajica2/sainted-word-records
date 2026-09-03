// scripts/check-manifest.mjs — validate library/manifest.json before deploy.
//
// Run as part of CI (npm run check:manifest). A broken manifest silently
// kills the curated demo library on every deploy because vite.config.js
// closeBundle reads the file and copies the listed files into dist/.
//
// Exit code 0 = valid, 1 = invalid (with reason printed to stderr).

import fs from 'node:fs';
import path from 'node:path';

const MANIFEST = 'library/manifest.json';

if (!fs.existsSync(MANIFEST)) {
  console.error(`✗ ${MANIFEST} missing`);
  process.exit(1);
}

let m;
try {
  m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (e) {
  console.error(`✗ ${MANIFEST} is not valid JSON: ${e.message}`);
  process.exit(1);
}

const errors = [];

if (!Array.isArray(m.files)) {
  errors.push('top-level "files" must be an array');
}

if (!m.personaGroups || typeof m.personaGroups !== 'object') {
  errors.push('top-level "personaGroups" must be an object');
} else {
  for (const [group, paths] of Object.entries(m.personaGroups)) {
    if (!Array.isArray(paths)) {
      errors.push(`personaGroups.${group} must be an array (got ${typeof paths})`);
      continue;
    }
    for (const p of paths) {
      if (typeof p !== 'string') {
        errors.push(`personaGroups.${group} contains non-string entry: ${JSON.stringify(p)}`);
      }
    }
  }
}

// Cross-check: every file referenced in personaGroups must also appear in
// the top-level files[] list (otherwise the build will silently skip the
// persona preview because the source asset isn't in dist/).
if (m.personaGroups && Array.isArray(m.files)) {
  const fileSet = new Set(m.files);
  for (const [group, paths] of Object.entries(m.personaGroups)) {
    if (!Array.isArray(paths)) continue;
    for (const p of paths) {
      if (!fileSet.has(p)) {
        errors.push(`personaGroups.${group} references "${p}" but it's not in top-level files[]`);
      }
    }
  }
}

// Sanity check: every listed file must exist on disk. The curated copy
// silently skips missing files (which is why we used to warn here), but
// a missing entry also breaks the SPA Media Manager tab on every load —
// the SPA fetches /library/manifest.json, prepends each path to the base
// URL, and tries to render a thumbnail that 404s. Promote to an error.
if (Array.isArray(m.files)) {
  const missingList = [];
  for (const f of m.files) {
    if (!fs.existsSync(path.join('library', f))) missingList.push(f);
  }
  if (missingList.length) {
    errors.push(
      `${missingList.length}/${m.files.length} listed files missing from library/ (would 404 at runtime):\n` +
      missingList.slice(0, 20).map(f => `    - ${f}`).join('\n') +
      (missingList.length > 20 ? `\n    ...and ${missingList.length - 20} more` : '')
    );
  }
}

if (errors.length) {
  console.error(`✗ ${MANIFEST} is structurally invalid:`);
  for (const e of errors) console.error(`    - ${e}`);
  process.exit(1);
}

console.log(`✓ ${MANIFEST} valid (${m.files.length} files, ${Object.keys(m.personaGroups || {}).length} persona groups)`);