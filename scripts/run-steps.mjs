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
    'npm run check:engine-mobile',
    'npm run check:quota-estimate-unit',
    'npm run check:quota-eviction',
    'npm run check:pt-verify',
    'npm run check:pt-import',
    'npm run check:bundle',
    'npm run check:automix-unit',
    // The engine's section detector: self-similarity matrix + Foote novelty
    // over the live Audio.feat stream, replacing the energy-threshold
    // segmenter it used to be. Its own gate asserts both true boundaries are
    // found on a 3-section fixture with at most 1 false positive, and that
    // the old rule over-fires on the same fixture.
    'npm run check:section-detector-unit',
    'npm run check:automix-arc-unit',
    'npm run check:automix-session-unit',
    'npm run check:posterize-curve',
    'npm run check:contract',
    'npm run check:ver-picker',
    'npm run check:svg-grade-integration',
    'npm run check:api-mock',
    'npm run check:client-sdk',
    'npm run check:webgl-default-off',
    'npm run check:webgl-safe-uniforms',
    'npm run check:clip-evolution-unit',
    'npm run check:site-keys-unit',
    'npm run check:gradient-dot-unit',
    'npm run check:depth-blend-unit',
    'npm run check:last-mix-unit',
    'npm run check:get-preset-unit',
    'npm run check:preset-cycle-unit',
    'npm run check:preset-pick-unit',
    'npm run check:webgl-uniform-guard',
    'npm run check:webgl-no-invalid-op',
    // Preset spec gate: manifest.json + presets/*.json against swr-preset/v1.
    // Also its own CI step (npm run preset-pipeline:verify) after check:full.
    'npm run check:preset-smoke',
    'npm run check:layer-state-unit',
    // Layer groups: the shift+click multi-selection, the group header,
    // group visibility (hidden members), collapse, ungroup, and the
    // group name. The sibling layer-retire/layer-text/layer-lifecycle
    // suites are reachable from no gate (pre-existing, not this gate's job).
    'npm run check:layer-groups-unit',
    // The auto-post feed: the posts come from site-map.json's
    // `announcements` array, read from the inlined footer slice or from
    // /site-map.json, and painted into every [data-announcements]
    // container plus the footer's bottom bar.
    'npm run check:announcements-unit',
    // The store: the Gumroad download catalogue and the Stripe products
    // come from site-map.json's `store` block, read from the inlined
    // footer slice or from /site-map.json. A product without a link must
    // never render a dead checkout URL, and the publish script must write
    // the off-site URL back into the manifest without reformatting it.
    'npm run check:store-unit',
    'npm run check:with-dist-unit',
    // The digit-row contract (docs/PLANS/number-key-assignment.md): bare
    // 1..9 apply a look filter and never touch a layer's rotation state.
    // The rotation guard is what ENFORCES that, and the filter/keyspress
    // suites cover the mapping itself. All three were reachable from no
    // gate before this.
    'npm run check:engine-keys-digit-filter-unit',
    'npm run check:engine-keys-digit-rotation-guard-unit',
    'npm run check:engine-keys-keyspress-unit',
    // The one rule for "which media belong together" — shared by the
    // media panel's group-by-name view and the automix layer pool.
    'npm run check:media-grouping-unit',
    // A video loaded as the song becomes a layer that shares the song's own
    // <video> element, so the picture and the sound are one clock. The unit
    // pins the module's decisions (a video song adds one songBound layer
    // bound to the song's element, an audio song adds none, a new song
    // replaces the old one, the song-loaded seam chains).
    'npm run check:song-video-layer-unit',
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
    // Google sign-in: the start endpoint, the signed state, the exchange,
    // the session cookie and the redirect_uri callback. Google's two
    // endpoints are stubbed; everything else is the real handler.
    'npm run check:auth-google-signin-unit',
    'npm run check:bpm-unit',
    'npm run check:life-unit',
    'npm run check:midi-feat-unit',
    'npm run check:app-version-bust-unit',
    'npm run check:version-watcher-unit',
    'npm run check:variant-codemods',
    // The manifest half of the codemod contract (plan P0.5, "the 'I rebuilt
    // it' #1"). check:variant-codemods above asks one question per codemod:
    // "does this marker exist where the codemod says it should?". This asks
    // the other half: does versions/manifest.json still describe the tree?
    // It re-runs all 20 codemods against a throwaway copy of versions/ +
    // tools/ + auth/ and fails on drift the manifest does not record, on a
    // marker that disappeared, on a codemod whose declared marker is no
    // longer in its own source, and on recorded `pending` debt older than
    // the manifest's 30-day budget. Read-only on the working tree.
    'npm run check:codemods',
    // Doc-vs-code drift: every file path, route, glob and library name the
    // current-state docs assert is verified against the tree. Carries its
    // own self-test, because a green gate that can no longer detect anything
    // is worse than no gate.
    'npm run check:doc-truth',
    'npm run check:looks-menu-unit',
    'npm run check:invite-unlock-unit',
    'npm run check:grant-invite-batch-unit',
    'npm run check:invite-api-smoke',
    'npm run check:pt-unit',
    'npm run check:zip-reader-unit',
    'npm run check:slots-unit',
    'npm run check:slots-api-smoke',
    'npm run check:webm-clips-unit',
    'npm run check:storage-blob-unit',
    'npm run check:cross-tab-unit',
    'npm run check:dpr-ratchet-unit',
    // P2.2: set + clear session cookies both carry Secure. The plan
    // (docs/PLANS/architecture-audit-2026-10.md) called out that the
    // delete cookie was missing the flag; this is the gate that
    // catches a future regression that drops it again.
    'npm run check:session-cookie-secure',
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
    // Full 16-variant switcher coverage: every entry in
    // client/variant-switcher.client.js's VARIANTS array compiles and runs
    // against a vm sandbox, with a guarded A.feat that fails on a future
    // drawFx that reads a feature the contract mock does not provide.
    'npm run check:variants-unit',
    // Static: lib/look-variant.client.js is loaded by engine/composer/record
    // and its JS source carries no em-dashes. Reachable from NO gate until
    // it was added here.
    'npm run check:look-variant-unit',
    'npm run check:targeting-unit',
    'npm run targeting:verify',
    'npm run check:media-input-unit',
    'npm run check:directors-unit',
    'npm run check:spit-live-unit',
    'npm run check:tiktok-unit',
    'npm run check:glyphs-layers-unit',
    'npm run check:glyph-forge-unit',
    'npm run check:camera-enhance-unit',
    'npm run check:capture-unit',
    'npm run check:reel-unit',
    'npm run check:photo-slideshow',
    'npm run check:default-library',
    'npm run check:grade-smoke',
    // Static: every shipped page carries the shared header + footer, the
    // shared styles, a unique title, a description and a <main> landmark
    // (app surfaces must carry an exit link instead).
    'npm run check:site-chrome',
    // Static: the five iPhone-first surfaces declare viewport-fit=cover (without
    // it every env(safe-area-inset-*) resolves to 0px), apply the insets where
    // they collide with the notch / home indicator, and set
    // overscroll-behavior: none on html/body only where there is fixed chrome
    // to justify it; scrolling pages must keep their rubber-band.
    'npm run check:safe-area-inset',
    // The same iPhone-first pass, second half: the interactive controls must
    // meet the 44px bar on coarse pointers and narrow viewports, or the
    // engine is unusable with a thumb.
    'npm run check:touch-targets',
    // Static: every landing-personas register's inlined personas-data node
    // still carries personas.json's 8 personas (canonical fields) in order.
    'npm run check:register-data',
    // Static: sitemap.xml is the generated projection of the shipped surface
    // (no drift, no 301/archived URL, no duplicate, every shipped content page
    // exactly once). Needs a built dist/ — ensureDist() builds it on demand.
    'npm run check:sitemap',
    // The living history: rebuilds generations.json + the per-generation
    // archives from marketing/generations.json and the tree, then proves the
    // records are sound, the media really has a length and a bitrate, the
    // archives are readable zips that credit what they claim, and the route
    // is wired (site-map → vercel → sitemap).
    'npm run check:generations',
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
    // Layer groups in the engine's layer panel: shift+click multi-select,
    // the group header, hide/collapse/ungroup, and the proof that a hidden
    // member stops drawing on the stage. Needs a built dist/ (ensureDist).
    'npm run check:layer-groups-smoke',
    // A video song on the real stage: the song's own <video> element becomes
    // a layer, the stage canvas draws it, the shared element advances with
    // the sound, a seek moves the picture with it, and the renderer never
    // re-loads the element. Needs a built dist/ (ensureDist).
    'npm run check:song-video-layer-smoke',
    // The auto-post feed in a real browser: the changelog and the
    // marketplace paint the posts, and the footer's "New — …" link reaches
    // every page that mounts <swr-footer>. Needs a built dist/.
    'npm run check:announcements-smoke',
    // The store in a real browser: the marketplace paints the download
    // catalogue from site-map.json, the shop renders the shop products
    // with a disabled Buy button while the Payment Links are missing, and
    // no page ships a placeholder checkout URL. Needs a built dist/.
    'npm run check:store-smoke',
    'npm run check:media-input-smoke',
    // The Live control end to end in a real browser: a synthetic camera
    // (--use-fake-device-for-media-stream) actually playing, the stage
    // pixels moving, the mic routed into the engine's own analyser, and
    // the devices released on stop. Was reachable from NO gate.
    'npm run check:live-input',
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
    // Full 16-variant switcher coverage in the real browser: walks every
    // entry in SWR_VARIANTS.list(), activates it, loads the variant's
    // default song, samples the engine render canvas and asserts the
    // frame is not black. Catches a drawFx that compiles but produces a
    // black frame, or an activate that throws mid-frame. ensureDist()
    // builds dist/ if missing or stale. The 90s budget covers the
    // 16×~1.6s variant walk plus harness boot.
    { cmd: 'npm run check:variants-smoke', timeoutMs: 120000, retries: 1 },
    // Builds twice from a clean state and verifies the second `dist/` is
    // byte-identical to the first. Catches plugin-ordering bugs (a
    // post-processor that overwrites another post-processor's output)
    // before they ship. The only allowed drift is the build timestamp
    // in `dist/lib/app-version.js`.
    { cmd: 'npm run check:build-idempotent', timeoutMs: 240000, retries: 0 },
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
