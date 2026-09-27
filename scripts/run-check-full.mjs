#!/usr/bin/env node
// scripts/run-check-full.mjs
//
// Runs every gate in check:full, then exits non-zero if ANY of them failed.
//
// Why this exists (and why check:full is not an `&&` chain)
// --------------------------------------------------------
// check:full used to be `npm run check && npm run check:verify && …`, so the
// FIRST failure silently truncated every gate after it. Combined with CI's
// `continue-on-error: true` on that step, the result was invisible:
//
//   - CI run 36323771785: check:verify failed (verify-rotation-enabled), the
//     step ended with "Process completed with exit code 1" immediately after
//     check:verify's summary, and check:automix-smoke, check:automix-arc-smoke,
//     check:storyboard, verify:automix, check:capture-smoke,
//     check:media-input-smoke and check:spit-live-smoke never ran at all.
//   - The job still reported success, so nothing surfaced it. Those gates were
//     dead in CI *and* for local `npm run check:full`.
//
// A gate you believe is running but isn't is worse than no gate: it is a false
// signal of coverage. So: run them all, report each, aggregate.
//
// Note this only fixes the top level. Some individual scripts are themselves
// `a && b && c` chains (check:storyboard), which have the same property one
// level down.
//
// Usage:
//   node scripts/run-check-full.mjs
//   CHECK_FULL_STEPS=check:syntax,check:bpm-unit node scripts/run-check-full.mjs
//     (run a subset — the override is also how the aggregation is tested)

import { spawnSync } from 'node:child_process';

const DEFAULT_STEPS = [
  'check',
  'check:verify',
  'check:automix-smoke',
  'check:automix-arc-smoke',
  'check:storyboard',
  'verify:automix',
  'check:capture-smoke',
  'check:media-input-smoke',
  'check:spit-live-smoke',
];

const STEPS = process.env.CHECK_FULL_STEPS
  ? process.env.CHECK_FULL_STEPS.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_STEPS;

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const results = [];

for (const step of STEPS) {
  process.stdout.write(`\n─── ${step} ───\n`);
  const t0 = Date.now();
  const r = spawnSync(npm, ['run', step], { stdio: 'inherit', env: process.env });
  // A null status means the child was killed by a signal; treat that as failure.
  const code = r.status === null ? 1 : r.status;
  results.push({ step, code, ms: Date.now() - t0 });
}

const failed = results.filter((r) => r.code !== 0);
console.log('\n─── check:full summary ───');
for (const r of results) {
  console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.step.padEnd(26)} ${(r.ms / 1000).toFixed(1)}s`);
}

if (failed.length) {
  console.error(`\ncheck:full: ${failed.length}/${results.length} gate(s) FAILED: ${failed.map((r) => r.step).join(', ')}`);
  process.exit(1);
}
console.log(`\ncheck:full: all ${results.length} gates passed`);
