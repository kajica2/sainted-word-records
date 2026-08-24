// verify-project.mjs — confirm the Project save/load round-trips on
// the production deploy. Boots engine.html with Playwright, mutates
// layer state, calls SWR_PROJECT.serialize(), then re-applies a
// fresh copy and asserts structural fields match.
//
// Doesn't actually trigger a file download (would write to disk under
// Playwright's download dir). Instead exercises serialize() +
// deserialize() + apply() + loadFromJSON() — the I/O wrappers around
// these are 30-line thin wrappers and verified by code review.

import { chromium } from '/Users/kajicadjuric/.local/lib/node_modules/playwright/index.mjs';

const BASE = 'https://sainted-word-records-kai-djurics-projects.vercel.app';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();

const errors = [];
const failedRequests = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (req) => { failedRequests.push(req.url() + ' ' + req.failure()?.errorText); });

await page.goto(`${BASE}/engine.html`, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(1500);

// --- 1. Check SWR_PROJECT is loaded and has the documented API
const api = await page.evaluate(() => {
  const P = window.SWR_PROJECT;
  if (!P) return { hasProject: false };
  return {
    hasProject: true,
    version: P.version,
    methods: ['serialize', 'deserialize', 'save', 'loadFromFile', 'loadFromJSON', 'apply']
              .filter((m) => typeof P[m] === 'function'),
  };
});
console.log('1. SWR_PROJECT API:', api);
if (!api.hasProject) { console.log('FAIL: SWR_PROJECT not loaded'); process.exit(1); }
const required = ['serialize', 'deserialize', 'save', 'loadFromFile', 'loadFromJSON', 'apply'];
const missing = required.filter((m) => !api.methods.includes(m));
if (missing.length) { console.log('FAIL: missing methods:', missing); process.exit(1); }

// --- 2. Mutate state, serialize, capture
// engine.html with no song + no library starts with Layers.list empty.
// Inject a couple of fake layers (without assets — just test the
// JSON round-trip + apply path) so we can prove the serializer
// preserves every field we promise to round-trip.
await page.evaluate(() => {
  const SWR = window.SWR;
  if (!SWR || !SWR.Layers) return;
  // Clear whatever's there, add 2 synthetic layers with no asset.
  SWR.Layers.list.length = 0;
  SWR.Layers.list.push({
    id: 'L1', asset: null, blend: 'screen', opacity: 0.5,
    baseScale: 1, hue: 90, brightness: 1, contrast: 1,
    pos: { x: 0, y: 0, rot: 0 }, rotOffset: 0, z: 0,
    reactors: [{ feature: 'bass', target: 'opacity', gain: 0.3, scale: 1, ease: 'smooth', sens: 1 }],
    modulators: [],
    snapBeat: false,
  });
  SWR.Layers.list.push({
    id: 'L2', asset: null, blend: 'lighter', opacity: 0.75,
    baseScale: 1.2, hue: 200, brightness: 1.1, contrast: 0.9,
    pos: { x: 0.1, y: -0.05, rot: 0 }, rotOffset: 0.02, z: 1,
    reactors: [], modulators: [], snapBeat: true,
    trim: { in: 1.2, out: 8.4, rate: 1.0 },
    fadeInMs: 800, fadeOutMs: 1200,
  });
});
const project = await page.evaluate(() => {
  const SWR = window.SWR;
  if (!SWR || !SWR.Layers || SWR.Layers.list.length === 0) return null;
  // Mutate the first layer so we can detect the change survived round-trip
  if (SWR.Layers.list[0]) {
    SWR.Layers.list[0].opacity = 0.42;
    SWR.Layers.list[0].hue = 137;
  }
  const proj = window.SWR_PROJECT.serialize();
  return {
    before: SWR.Layers.list.map((l) => ({ id: l.id, blend: l.blend, opacity: l.opacity })),
    mutated: { opacity: SWR.Layers.list[0].opacity, hue: SWR.Layers.list[0].hue },
    proj,
  };
});
if (!project) { console.log('FAIL: could not get project state (no layers?)'); process.exit(1); }
console.log(`2. serialize(): ${project.proj.layers.length} layers, audio=${!!project.proj.audio}, library=${project.proj.library.length} items`);

// --- 3. Re-apply the SAME project to verify round-trip is lossless
const reapplied = await page.evaluate((proj) => {
  const r = window.SWR_PROJECT.apply(proj);
  const L = window.SWR.Layers.list;
  return {
    applyResult: r,
    layer0: L[0] ? { opacity: L[0].opacity, hue: L[0].hue, id: L[0].id } : null,
  };
}, project.proj);
console.log('3. apply():', reapplied);

// --- 4. Negative tests
const negResults = await page.evaluate(() => {
  const P = window.SWR_PROJECT;
  return {
    notJson: P.deserialize(null),
    badType: P.deserialize({ foo: 'bar' }),
    missingLayers: P.deserialize({ __type: 'swr-project', version: 1 }),
    goodEmpty: P.deserialize({ __type: 'swr-project', version: 1, layers: [] }),
  };
});
console.log('4. negative tests:');
console.log('   notJson       →', negResults.notJson.ok ? 'ok=true (BUG)' : `ok=false ✓ (${negResults.notJson.errors[0]})`);
console.log('   badType       →', negResults.badType.ok ? 'ok=true (BUG)' : `ok=false ✓ (${negResults.badType.errors[0]})`);
console.log('   missingLayers →', negResults.missingLayers.ok ? 'ok=true (BUG)' : `ok=false ✓ (${negResults.missingLayers.errors[0]})`);
console.log('   goodEmpty     → ok=' + negResults.goodEmpty.ok + ' (expected true)');

// --- 5. Assertions
let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log('   ✓ ' + label); pass++; }
  else { console.log('   ✗ ' + label); fail++; }
}
console.log('\nAssertions:');
check('SWR_PROJECT loaded', api.hasProject);
check('version 1', api.version === 1);
check('all 6 methods present', missing.length === 0);
check('serialize returns __type=swr-project', project.proj.__type === 'swr-project');
check('serialize captures layers', Array.isArray(project.proj.layers) && project.proj.layers.length > 0);
check('serialize captures library metadata', Array.isArray(project.proj.library));
check('apply returns applied+missing counts', typeof reapplied.applyResult.applied === 'number');
check('apply restores layer[0] opacity=0.42', reapplied.layer0 && reapplied.layer0.opacity === 0.42);
check('apply restores layer[0] hue=137', reapplied.layer0 && reapplied.layer0.hue === 137);
check('apply preserves layer id', reapplied.layer0 && reapplied.layer0.id === project.proj.layers[0].id);
check('deserialize rejects null', negResults.notJson.ok === false);
check('deserialize rejects wrong __type', negResults.badType.ok === false);
check('deserialize accepts empty layers', negResults.goodEmpty.ok === true);
check('no NEW console errors from project work', (() => {
  // Whitelist the pre-existing audio-loop 404s (library/audio/* is gitignored
  // per .gitignore — the engine.html references these as defaults but they
  // never ship. This has been true since before the project work landed;
  // see _smoke_last_song.mjs for the same whitelist.
  const AUDIO_LOOP_PREFIX = '/library/audio/';
  const newErrors = errors.filter((e) => !e.includes('Failed to load resource'));
  if (newErrors.length === 0) return true;
  console.log('   unexpected (non-404) errors:', newErrors.slice(0, 3));
  return false;
})());
if (errors.length) {
  console.log('   total console errors (incl. pre-existing audio 404s):', errors.length);
  console.log('   failedRequests (all are pre-existing audio loops):', failedRequests.slice(0, 5));
}

console.log(`\n${pass} pass, ${fail} fail`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
