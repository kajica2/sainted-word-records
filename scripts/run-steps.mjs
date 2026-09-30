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
// `npm run x` with a direct `node scripts/y.mjs`. A step may instead be an
// object `{ cmd, timeoutMs, retries }` when it needs a bounded wall-clock
// budget or an automatic re-run (see verify:automix below); `timeoutMs` kills
// the child when it overruns, `retries` re-runs it that many times after a
// failure — a run that fails every attempt still fails the group.

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
    'npm run check:invite-unlock-unit',
    'npm run check:grant-invite-batch-unit',
    'npm run check:pt-unit',
    'npm run check:zip-reader-unit',
    'npm run check:slots-unit',
    'npm run check:slots-api-smoke',
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
    'npm run check:directors-unit',
    'npm run check:spit-live-unit',
    'npm run check:tiktok-unit',
    'npm run check:glyphs-layers-unit',
    'npm run check:camera-enhance-unit',
    'npm run check:capture-unit',
    'npm run check:photo-slideshow',
    'npm run check:default-library',
    'npm run check:grade-smoke',
    // Static: every shipped page carries the shared header + footer, the
    // shared styles, a unique title, a description and a <main> landmark
    // (app surfaces must carry an exit link instead).
    'npm run check:site-chrome',
    // Static: every landing-personas register's inlined personas-data node
    // still carries personas.json's 8 personas (canonical fields) in order.
    'npm run check:register-data',
    // Static: sitemap.xml is the generated projection of the shipped surface
    // (no drift, no 301/archived URL, no duplicate, every shipped content page
    // exactly once). Needs a built dist/ — ensureDist() builds it on demand.
    'npm run check:sitemap',
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
    // { retries, timeoutMs }: the same treatment verify:automix got. This step
    // failed four CI runs in a row on 2026-09-29 (autoplay NotAllowedError,
    // fixed by the flag in the smoke itself); a single retry keeps a
    // navigation-timeout on a loaded runner from failing the whole gate, while
    // a deterministic failure still fails after the retry.
    { cmd: 'npm run check:automix-smoke', timeoutMs: 600000, retries: 1 },
    'npm run check:automix-arc-smoke',
    'npm run check:invite-redemption-smoke',
    'npm run check:storyboard',
    // verify:automix timed out at 173s on a loaded CI runner (and failed the
    // whole run) while passing in ~30s locally. Give it a documented 180s
    // budget plus one automatic re-run; if it fails twice the group still
    // fails, so a real regression cannot hide behind the retry.
    { cmd: 'npm run verify:automix', timeoutMs: 180_000, retries: 1 },
    'npm run verify:genops',
    'npm run verify:story-graph',
    'npm run check:capture-smoke',
    'npm run check:targeting-smoke',
    'npm run check:media-input-smoke',
    'npm run check:spit-live-smoke',
    'npm run check:tiktok-smoke',
    'npm run check:camera-enhance-smoke',
    // Needs a built dist/ (ensureDist builds when stale): asserts every
    // vercel.json rewrite, every root-relative link in a shipped page, and
    // every site-map entry resolves to a file that actually made it into dist.
    // Browser: clip posters are captured frames, which no static check can see.
    'npm run check:clip-poster-smoke',
    // verify:engine-boot was reachable from no group. It is the only gate
    // that asserts the engine's transport row stays on-screen: #transport is
    // a nowrap flex row of ~44 controls (~2900px natural width), and when it
    // overflowed its fixed 56px grid row the ● REC and 🎬 Export video
    // controls sat outside the viewport, clipped by body{overflow-x:hidden}
    // and unhittable by mouse at every width — while the page still looked
    // healthy and check:syntax passed. The budget covers its ~9s runtime.
    { cmd: 'npm run verify:engine-boot', timeoutMs: 300000, retries: 1 },
    'npm run check:dist-links',
    // Crawls every nav URL from site-map.json: shared CSS/JS load, archived
    // pages 404, landing.html raises no JS errors. Was reachable from no gate.
    'npm run verify:site-nav',
  ],
};

const [group, ...flags] = process.argv.slice(2);
if (!group || !GROUPS[group]) {
  console.error(`usage: node scripts/run-steps.mjs <${Object.keys(GROUPS).join('|')}> [--list]`);
  process.exit(2);
}

let steps = GROUPS[group];
const cmdOf = (s) => (typeof s === 'string' ? s : s.cmd);
if (process.env.STEPS_ONLY) {
  const only = process.env.STEPS_ONLY.split(',').map((s) => s.trim()).filter(Boolean);
  steps = steps.filter((s) => only.some((o) => cmdOf(s).includes(o)));
  if (!steps.length) {
    console.error(`STEPS_ONLY matched nothing in group "${group}"`);
    process.exit(2);
  }
}

if (flags.includes('--list')) {
  console.log(`${group} (${steps.length} steps):`);
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${cmdOf(s)}`));
  process.exit(0);
}

const results = [];
for (const step of steps) {
  const cmd = cmdOf(step);
  const timeoutMs = typeof step === 'string' ? undefined : step.timeoutMs;
  const retries = typeof step === 'string' ? 0 : (step.retries || 0);
  const t0 = Date.now();
  let code = 1;
  for (let attempt = 0; attempt <= retries; attempt++) {
    process.stdout.write(`\n─── ${cmd}${attempt ? ` ─── (retry ${attempt}/${retries})` : ' ───'}\n`);
    const r = spawnSync(cmd, { shell: true, stdio: 'inherit', env: process.env, timeout: timeoutMs });
    // A null status means the child was killed (by a signal, or by our
    // timeout) — treat that as failure.
    code = r.status === null ? 1 : r.status;
    if (code === 0) break;
    if (attempt < retries) process.stdout.write(`─── ${cmd} failed (attempt ${attempt + 1}) — retrying\n`);
  }
  results.push({ step: cmd, code, ms: Date.now() - t0 });
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
