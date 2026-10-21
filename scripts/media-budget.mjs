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
import path from 'node:path';

const DIST = (() => {
  const i = process.argv.indexOf('--dist');
  return i > -1 ? process.argv[i + 1] : 'dist';
})();

// dir -> byte budget. Sized from the measured 2026-10-21 build
// (173.1M total, 156.2M of it media), with the target state in
// docs/plans/2026-10-21-shipped-media-budget.md.
const BUDGETS = {
  audios: 40 * 1024 * 1024,
  packs: 40 * 1024 * 1024,
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

function dirBytes(dir) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { bytes += statSync(p).size; files++; }
    }
  };
  walk(dir);
  return { bytes, files };
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
for (const [dir, budget] of Object.entries(BUDGETS)) {
  const target = path.join(DIST, dir);
  if (!existsSync(target)) continue;
  const { bytes, files } = dirBytes(target);
  total += bytes;
  const over = bytes > budget;
  if (over) failed++;
  rows.push({ dir, mb: mb(bytes), budget: mb(budget), files, over });
}
rows.sort((a, b) => parseFloat(b.budget) - parseFloat(a.budget));
for (const r of rows) {
  console.log(`  ${r.dir.padEnd(22)} ${r.mb.padStart(7)}M  budget ${r.budget.padStart(6)}M  ${String(r.files).padStart(4)} files  ${r.over ? '✗ OVER' : '✓'}`);
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
