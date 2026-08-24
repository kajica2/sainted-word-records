// scripts/check-syntax.mjs — fast parse check for every JS / MJS file.
//
// `node --check` on each file catches typos and broken syntax before
// the full vite build does. Cheaper than the build itself (no bundler,
// no plugins, no asset copy) so it's worth running in pre-commit and
// pre-push.
//
// Excludes: node_modules, dist, dist-dev (already excluded by find -prune),
// .vite cache, public/ (shadow copies; vite.config.js comments confirm
// they're not canonical).
//
// Exit code 0 = all parse, 1 = any file failed.

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'dist-dev', '.vite', '.git', '.hermes', 'public']);
const EXCLUDE_FILES = new Set([]); // none yet

/** @type {string[]} */
const targets = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (EXCLUDE_FILES.has(relative(ROOT, full))) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (st.isFile() && (entry.endsWith('.js') || entry.endsWith('.mjs'))) {
      targets.push(full);
    }
  }
}

walk(ROOT);

let failed = 0;
for (const f of targets) {
  try {
    execFileSync('node', ['--check', f], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    console.error(`✗ ${relative(ROOT, f)}\n    ${stderr.split('\n').slice(0, 4).join('\n    ')}`);
    failed++;
  }
}

if (failed) {
  console.error(`\n${failed}/${targets.length} files failed parse check`);
  process.exit(1);
}
console.log(`✓ ${targets.length} files parse OK`);