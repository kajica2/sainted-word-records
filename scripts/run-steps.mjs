#!/usr/bin/env node
// scripts/run-steps.mjs
//
// Runs a named group of gate commands in sequence and exits non-zero if ANY
// failed — instead of stopping at the first one.
//
// WHY NOT `a && b && c`
// ---------------------
// The `&&` chains these groups replace short-circuited: the first failure
// silently truncated every step after it, and because the CI step was
// `continue-on-error: true` the job still reported success. A gate you believe
// is running but isn't is worse than no gate — it is a false signal of
// coverage, and it hides the *other* regressions the skipped steps would have
// caught.
//
// That was not hypothetical:
//   - `check:full` truncated at `check:verify` (CI run 36323771785), silently
//     skipping check:automix-smoke, check:automix-arc-smoke, check:storyboard,
//     verify:automix, check:capture-smoke, check:media-input-smoke and
//     check:spit-live-smoke. Seven gates dead in CI *and* locally.
//   - `check` is a 29-step chain, worse in kind: it runs FIRST inside
//     check:full, it is the documented "quick gate", and an early failure hid
//     up to 28 suites behind a single opaque failure line.
//
// So: run them all, report each, aggregate.
//
// Usage:
//   node scripts/run-steps.mjs check        # the 29-step quick gate
//   node scripts/run-steps.mjs storyboard
//   node scripts/run-steps.mjs full         # the pre-PR gate
//   node scripts/run-steps.mjs check --list # print the steps, don't run
//   STEPS_ONLY=check:syntax,check:bpm-unit node scripts/run-steps.mjs check
//     (developer subset override; also how the aggregation itself is tested)
//
// Each step is a full command string, run through the shell, so a group can mix
// `npm run x` with a direct `node scripts/y.mjs`.

import { spawnSync } from 'node:child_process';

const GROUPS = {
  // The quick gate. Order preserved from the original `check` chain.
  check: [
    'npm run check:syntax',
    'npm run check:bundle',
    'npm run check:automix-unit',
    'npm run check:automix-arc-unit',
    'npm run check:automix-session-unit',
    'npm run check:clip-evolution-unit',
    'npm run check:site-keys-unit',
    'npm run check:gradient-dot-unit',
    'npm run check:depth-blend-unit',
    'npm run check:last-mix-unit',
    'npm run check:get-preset-unit',
    'npm run check:preset-cycle-unit',
    'npm run check:preset-pick-unit',
    'npm run check:layer-state-unit',
    'npm run check:with-dist-unit',
    // These were reachable from NO gate: six `check:*` unit suites plus
    // check:unit's four members (check:unit itself is a `&&` chain, so its
    // members are listed individually here — same short-circuit reasoning as
    // the rest of this runner). All eleven were verified passing in ~8.7s
    // combined before being added, i.e. this is coverage that already existed
    // and simply never ran.
    'npm run check:narrative-unit',
    'npm run check:score-evolution-smoke',
    'npm run check:mv-unit',
    'npm run check:mv-ta-unit',
    'npm run check:mv-render-unit',
    'npm run check:mv-keys-unit',
    'npm run test:generated-audio',
    'npm run test:mascot-states',
    'npm run test:asset-curator-unit',
    'npm run test:asset-curator',
    'npm run check:auth-unit',
    'npm run check:bpm-unit',
    'npm run check:storage-blob-unit',
    'npm run check:db-postgres',
    'npm run verify:smtp',
    // The node:test suite for api/_lib/email.js (nodemailer is stubbed via a
    // global, so it is hermetic and ~50ms). verify:smtp covers the transport
    // over a running API; this covers the message assembly, which nothing ran.
    'npm run test:smtp',
    'node scripts/test-api.mjs',
    'npm run check:dashboard',
    'npm run check:variant-switcher-unit',
    'npm run check:variant-switcher-smoke',
    'npm run check:targeting-unit',
    'npm run targeting:verify',
    'npm run check:media-input-unit',
    'npm run check:spit-live-unit',
    'npm run check:capture-unit',
    'npm run check:photo-slideshow',
    'npm run check:default-library',
  ],

  // Was its own 5-step `&&` chain with the same truncation property.
  storyboard: [
    'node scripts/check-storyboard-song.mjs',
    'node scripts/check-storyboard-structure.mjs',
    'node scripts/check-storyboard-transitions.mjs',
    'node scripts/check-storyboard-shots.mjs',
    'node scripts/check-storyboard-e2e.mjs',
  ],

  // The pre-PR gate.
  full: [
    'npm run check',
    'npm run check:verify',
    'npm run check:automix-smoke',
    'npm run check:automix-arc-smoke',
    'npm run check:storyboard',
    'npm run verify:automix',
    'npm run verify:genops',
    'npm run verify:story-graph',
    'npm run check:capture-smoke',
    'npm run check:targeting-smoke',
    'npm run check:media-input-smoke',
    'npm run check:spit-live-smoke',
    // Needs a built dist/ (ensureDist builds when stale): asserts every
    // vercel.json rewrite, every root-relative link in a shipped page, and
    // every site-map entry resolves to a file that actually made it into dist.
    'npm run check:dist-links',
  ],
};

const [group, ...flags] = process.argv.slice(2);
if (!group || !GROUPS[group]) {
  console.error(`usage: node scripts/run-steps.mjs <${Object.keys(GROUPS).join('|')}> [--list]`);
  process.exit(2);
}

let steps = GROUPS[group];
if (process.env.STEPS_ONLY) {
  const only = process.env.STEPS_ONLY.split(',').map((s) => s.trim()).filter(Boolean);
  steps = steps.filter((s) => only.some((o) => s.includes(o)));
  if (!steps.length) {
    console.error(`STEPS_ONLY matched nothing in group "${group}"`);
    process.exit(2);
  }
}

if (flags.includes('--list')) {
  console.log(`${group} (${steps.length} steps):`);
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  process.exit(0);
}

const results = [];
for (const step of steps) {
  process.stdout.write(`\n─── ${step} ───\n`);
  const t0 = Date.now();
  const r = spawnSync(step, { shell: true, stdio: 'inherit', env: process.env });
  // A null status means the child was killed by a signal; treat that as failure.
  const code = r.status === null ? 1 : r.status;
  results.push({ step, code, ms: Date.now() - t0 });
}

const failed = results.filter((r) => r.code !== 0);
console.log(`\n─── ${group} summary ───`);
for (const r of results) {
  console.log(`  ${r.code === 0 ? '✓' : '✗'} ${r.step.padEnd(34)} ${(r.ms / 1000).toFixed(1)}s`);
}

if (failed.length) {
  console.error(`\n${group}: ${failed.length}/${results.length} step(s) FAILED: ${failed.map((r) => r.step).join(', ')}`);
  process.exit(1);
}
console.log(`\n${group}: all ${results.length} steps passed`);
