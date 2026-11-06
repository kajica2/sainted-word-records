#!/usr/bin/env node
// scripts/media-budget.mjs — a per-directory budget for the media the build ships.
//
// Why this exists: the CI build-size gate is one number for the whole
// dist/. It went over (155M → 173.1M) because the shipped media grew,
// and nobody noticed for two days — a single global budget tells you
// *that* the build is too big, not *which* directory did it. This gate
// names the offender and fails before the total does.
//
// Budgets are per directory, in bytes, measured the way CI measures the
// build (byte sum of the files the build copies). Raise a budget with
// the same care as the global one: the point is that growth needs
// justification, not that the number is free to move.
//
// Usage:
//   node scripts/media-budget.mjs            # check the current dist/
//   node scripts/media-budget.mjs --dist X   # check another build dir
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const DIST = (() => {
  const i = process.argv.indexOf('--dist');
  return i > -1 ? process.argv[i + 1] : 'dist';
})();

// dir -> byte budget. Sized from the measured 2026-10-21 build
// (173.1M total, 156.2M of it media), with the target state in
// docs/plans/2026-10-21-shipped-media-budget.md.
//
// These are TODAY's sizes plus a few percent of headroom, so the next
// growth trips the gate instead of passing unnoticed. They are not the
// target: slice 2 of the plan (re-encode the shipped video and audio,
// `npm run media:optimize -- --apply`) is expected to bring `audios`
// from 41M to ~28M and `videos`+`portfolio` from 45M to ~21M. When it
// does, tighten these numbers to the new sizes — a budget that is only
// ever raised is a budget that measures nothing.
const PACKS_FULL_BUDGET = 40 * 1024 * 1024;
// When PACKS_BASE is set at build time, copy-static ships only
// packs/manifest.json (~tens of KB). See scripts/lib/packs-offsite.mjs.
const PACKS_MANIFEST_ONLY_BUDGET = 512 * 1024;

const BUDGETS = {
  audios: 43 * 1024 * 1024,
  packs: PACKS_FULL_BUDGET,
  videos: 31 * 1024 * 1024,
  portfolio: 15 * 1024 * 1024,
  keyart: 10 * 1024 * 1024,
  'gallery-vintage': 9 * 1024 * 1024,
  'docs/atlas-assets': 6 * 1024 * 1024,
  'verify-screenshots': 5 * 1024 * 1024,
  'shop-designs': 3 * 1024 * 1024,
  'default-library': 2 * 1024 * 1024,
  press: 1 * 1024 * 1024,
  icons: 1 * 1024 * 1024,
};

// The deploy surface is the GIT TREE: the build runs from a checkout, so a
// file that is not tracked does not ship, however big it is on the
// developer's disk.
//
// keyart/ is the case in point. 58 files there are force-tracked and ship
// (~9.4M); 20 ignored .png originals also sit in the tree (~35M) and never
// ship. Counting them made this gate red on the developer's own machine for
// a payload the deploy never received — the same shape as a gate that asks
// a slow host for what it cannot deliver.
//
// So a dist file is SKIPPED when its source exists in the tree but is not
// tracked. A dist file with no source at all is a build artefact, and it
// still counts. In CI nothing is skipped, so the measurement there is
// byte-for-byte what it has always been.
//
// Every skip is printed. A gate that silently drops files is how a budget
// stops measuring anything.
function untrackedSources(dir) {
  let out = '';
  for (const args of [
    ['ls-files', '--others', '--exclude-standard', '--', dir],
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--', dir],
  ]) {
    try {
      out += execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return new Set(); // no git, or the dir is outside a repo: count everything
    }
  }
  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
}

function dirBytes(dir, sourcePrefix, skipSources) {
  let bytes = 0;
  let files = 0;
  let skipped = 0;
  let skippedBytes = 0;
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else {
        const size = statSync(p).size;
        // The source is the file the build copied this from, at the repo
        // root. If it exists on disk but git does not track it, the deploy
        // never receives it. `git ls-files` prints repo-root paths, so the
        // source prefix has to be put back on.
        if (skipSources && skipSources.has(`${sourcePrefix}/${r}`)) {
          skipped++;
          skippedBytes += size;
          continue;
        }
        bytes += size;
        files++;
      }
    }
  };
  walk(dir, '');
  return { bytes, files, skipped, skippedBytes };
}

const mb = (b) => (b / 1048576).toFixed(1);

console.log('media-budget: per-directory budgets for the shipped media');
console.log('=======================================================');
console.log('');

if (!existsSync(DIST)) {
  console.error(`✗ ${DIST}/ does not exist — run npm run build first`);
  process.exit(1);
}

let failed = 0;
let total = 0;
const rows = [];
function packsBudget(distRoot, measuredFiles) {
  const manifest = path.join(distRoot, 'packs', 'manifest.json');
  if (measuredFiles === 1 && existsSync(manifest)) {
    return { budget: PACKS_MANIFEST_ONLY_BUDGET, mode: 'manifest-only' };
  }
  return { budget: PACKS_FULL_BUDGET, mode: 'full' };
}

for (const [dir, defaultBudget] of Object.entries(BUDGETS)) {
  const target = path.join(DIST, dir);
  if (!existsSync(target)) continue;
  // The source of a dist file is the same path at the repo root. Files
  // that exist there but are not tracked never ship.
  const skipSources = untrackedSources(dir);
  const { bytes, files, skipped, skippedBytes } = dirBytes(target, dir, skipSources);
  let budget = defaultBudget;
  let mode = '';
  if (dir === 'packs') {
    const resolved = packsBudget(DIST, files);
    budget = resolved.budget;
    mode = resolved.mode;
  }
  total += bytes;
  const over = bytes > budget;
  if (over) failed++;
  rows.push({ dir, mb: mb(bytes), budget: mb(budget), files, over, mode, skipped, skippedBytes });
}
rows.sort((a, b) => parseFloat(b.budget) - parseFloat(a.budget));
for (const r of rows) {
  const tag = r.mode ? ` (${r.mode})` : '';
  console.log(`  ${r.dir.padEnd(22)} ${r.mb.padStart(7)}M  budget ${r.budget.padStart(6)}M  ${String(r.files).padStart(4)} files  ${r.over ? '✗ OVER' : '✓'}${tag}`);
}
const skippedRows = rows.filter((r) => r.skipped > 0);
if (skippedRows.length) {
  console.log('');
  console.log('  not shipped (present in the tree, not tracked by git — the deploy never receives these):');
  for (const r of skippedRows) {
    console.log(`    ${r.dir.padEnd(22)} ${mb(r.skippedBytes).padStart(7)}M  ${String(r.skipped).padStart(4)} files skipped`);
  }
}
console.log('');
console.log(`  total budgeted media: ${mb(total)}M`);

if (failed) {
  console.error('');
  console.error(`✗ ${failed} media director${failed === 1 ? 'y is' : 'ies are'} over budget.`);
  console.error('  The shipped media grew — see docs/plans/2026-10-21-shipped-media-budget.md.');
  console.error('  Either trim the media (scripts/media-optimize.mjs) or justify the budget here.');
  process.exit(1);
}
console.log('✓ every budgeted media directory is within its budget');
