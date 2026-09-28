// scripts/check-automix-arc-smoke.mjs
//
// The CI gate for "the song arc actually drives the picture".
//
//   node scripts/check-automix-arc-smoke.mjs
//
// Why this exists
// ---------------
// verify-automix-arc-displacement.mjs is the full regression contract, but it
// samples in realtime for 80-180s and is therefore deliberately excluded from
// check:full. The consequence was that automix had NO automated gate in CI, and
// three runtime-wiring bugs shipped silently (all recorded in
// docs/AUTOMIX-ARCHITECTURE.md):
//
//   1. engine.html never loaded automix-arc.client.js — the L3 layer was a
//      permanent passthrough on the *primary* surface.
//   2. fx-postprocess's zero-FX fast-path skipped the SWR._fxOverride
//      consumption block, which on zero-persona pages is the ONLY way FX.state
//      can become non-zero — a self-lockout.
//   3. the arc's act baselines were static, so displacement measured Δ=0.000
//      across a whole act.
//
// Every one of those leaves FX.state identical across acts. That is the thing
// worth gating, and it can be checked in seconds rather than minutes.
//
// What this asserts (and what it deliberately does not)
// ----------------------------------------------------
// The arc builder's own invariant — consecutive acts differ by
// ≥ ARC_MIN_DISPLACEMENT (0.25 Euclidean on the anchor map) — is already unit
// tested by check-automix-arc-unit.mjs. This gate covers the half that unit
// tests cannot reach: that the arc's act baselines actually reach FX.state on a
// real page, by sampling the pipeline state at each act and requiring
// consecutive acts to differ.
//
// Acts are sampled by SEEKING to each act's start rather than waiting in
// realtime. That is faithful because the runtime derives the act from
// el.currentTime on its 1s glide clock (automix-runtime._glideTick →
// SWR_AUTOMIX_ARC.sampleAt), so seeking selects the same act the song would
// have reached — and it covers every act deterministically instead of
// whichever ones happened to elapse. Measured cost: ~15s vs 85-180s.
//
// The final act's wrap (last act glides back toward the first baseline, by
// design — "the outro drifts back toward the intro's feel") is NOT asserted:
// the builder guarantees only consecutive pairs, so that pair is legitimately
// closer. Asserting it would be a false failure.
//
// Run command: node scripts/check-automix-arc-smoke.mjs
// Pass criteria: every consecutive act pair differs, no page errors, exit 0.

import { ensureDist, serveDist } from './with-dist.mjs';
import puppeteer from 'puppeteer';

ensureDist();

// The scaled pipeline fields that actually exist in fx-postprocess.js FX.state.
// NOTE: the realtime contract (verify-automix-arc-displacement.mjs) also lists
// an 'effect' entry, but no such field has ever existed in FX.state — grep
// fx-postprocess.js for "effect" and you get nothing. It contributes 0 there
// forever and can never win, so it is omitted here; the drift guard below would
// otherwise (correctly) fail on it.
const FIELDS = [
  'temp', 'mut', 'posterize', 'vignette', 'chroma', 'grain', 'sepia',
  'glow', 'grayscale', 'blur', 'liquid', 'pearl', 'glitch',
];
const DISPLACEMENT_MIN = 0.3;   // same bar as the realtime contract
const MIN_ACTS = 3;
const PORT = 5185;
const DEMO_SONG = '/audios/endless-tomorrow.mp3';
// A dev-only manifest probe: library-packs.client.js tries /packs/manifest.json
// then /library/manifest.json, and the latter is not copied into dist/. Benign,
// but attributed by URL below rather than swallowed with generic console noise.
const KNOWN_404 = /\/library\/manifest\.json(\?|$)/;
// This smoke serves dist/ statically, so the serverless API has no backend:
// engine.html loads lib/auth.client.js, whose session probe 404s by
// construction here (it resolves in production on Vercel). Scoped to /api/ so
// any other failing request still fails the gate.
const STATIC_SERVE_404 = /\/api\//;
// A dev/static-serve artifact: an element (or probe) resolves a null/empty URL
// to `/null` under the plain static server, intermittently (observed 0–4 times
// per run). Benign — but matched by URL so any other failing request still
// fails the gate.
const NULL_URL_404 = /\/null(\?|$)/;

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + (got !== undefined ? ' (got: ' + got + ')' : '')); process.exitCode = 1; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const maxDelta = (a, b, fields) => {
  let m = 0, key = null;
  for (const f of fields) {
    const x = a[f], y = b[f];
    if (typeof x === 'number' && typeof y === 'number') {
      const d = Math.abs(y - x);
      if (d > m) { m = d; key = f; }
    }
  }
  return { m, key };
};

const FIELDS_SRC = FIELDS;
let server;

try {
  const served = await serveDist(PORT);
  server = served;

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Generic "Failed to load resource" console lines carry no URL, so they are
    // judged from `failedRequests` below instead (which does).
    if (/Failed to load resource/.test(m.text())) return;
    pageErrors.push('console: ' + m.text());
  });
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(r.status() + ' ' + r.url()); });

  // CI runners never settle on networkidle — navigate on domcontentloaded and
  // give the page a bounded chance to reach `complete` (same pattern as the
  // other check:* smokes).
  await page.goto(`${served.url}/engine.html?automix=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 }).catch(() => {});

  // 1. Transport, then a song. default-library seeds the demo MP3, but its
  //    poll windows can miss on a cold runner, so drive loadFile ourselves if
  //    src has not landed.
  await page.waitForFunction(
    () => !!(window.SWR && window.SWR.Audio && typeof window.SWR.Audio.loadFile === 'function'),
    { timeout: 60000, polling: 300 });
  const hasSrc = async () => page.evaluate(
    () => !!(window.SWR.Audio.audioEl && window.SWR.Audio.audioEl.getAttribute('src')));
  if (!(await hasSrc())) {
    const loaded = await page.evaluate(async (demo) => {
      try {
        const r = await fetch(demo);
        if (!r.ok) return 'HTTP ' + r.status;
        const f = new File([await r.blob()], 'endless-tomorrow.mp3', { type: 'audio/mpeg' });
        window.SWR.Audio.loadFile(f);
        return true;
      } catch (e) { return String(e); }
    }, DEMO_SONG);
    if (loaded !== true) bad('demo song loaded', loaded);
  }
  await page.waitForFunction(
    () => !!(window.SWR.Audio.audioEl && window.SWR.Audio.audioEl.getAttribute('src')),
    { timeout: 30000, polling: 300 });
  ok('transport + demo song ready');

  // 2. Start automix and wait for the arc. No arc → the L3 layer is inert and
  //    every downstream assertion is meaningless, so this is the first gate.
  await page.waitForFunction(() => window.automix && typeof window.automix.start === 'function',
    { timeout: 30000, polling: 300 });
  await page.evaluate(() => { try { window.automix.start(); } catch (_) {} });
  try {
    // NOTE: MIN_ACTS must be passed as an argument — the predicate runs in the
    // page, where Node-side constants do not exist (referencing it there throws
    // a ReferenceError every poll and the wait can never satisfy).
    await page.waitForFunction(
      (min) => window.automix.arc && Array.isArray(window.automix.arc.acts) && window.automix.arc.acts.length >= min,
      { timeout: 90000, polling: 300 }, MIN_ACTS);
    ok(`song arc built (≥${MIN_ACTS} acts)`);
  } catch (_) {
    const diag = await page.evaluate(() => ({
      hasArcModule: !!window.SWR_AUTOMIX_ARC,
      hasAnalyzeFull: !!(window.SWR && window.SWR.Audio && typeof window.SWR.Audio.analyzeFull === 'function'),
      arc: window.automix && window.automix.arc ? (window.automix.arc.acts || []).length + ' acts' : 'null',
      src: (window.SWR.Audio.audioEl || {}).src ? 'set' : 'unset',
    }));
    bad('song arc built', JSON.stringify(diag));
    throw new Error('no arc');
  }

  await page.evaluate(async () => { try { await window.SWR.Audio.play(); } catch (_) {} });

  // 3. The FX.state field list must still be the documented one — if
  //    fx-postprocess renames a field, this gate would otherwise quietly stop
  //    measuring it.
  const missing = await page.evaluate((fields) => {
    const st = (window.FX && window.FX.state) || {};
    return fields.filter((f) => !(f in st));
  }, FIELDS_SRC);
  if (missing.length === 0) ok(`FX.state exposes all ${FIELDS_SRC.length} pipeline fields`);
  else bad('FX.state field list', 'missing: ' + missing.join(', '));

  const acts = await page.evaluate(() => window.automix.arc.acts.map((a) => ({ t0: a.t0, t1: a.t1, anchorId: a.anchorId, name: a.name })));

  // 4. Sample each act. Seek to its start, then wait for FX.state to converge
  //    rather than sleeping a fixed time — a slow CI runner needs longer, a
  //    fast one should not pay for it.
  const snapshot = () => page.evaluate((fields) => {
    const el = window.SWR.Audio.audioEl;
    const st = (window.FX && window.FX.state) || {};
    const out = {};
    for (const f of fields) { const v = st[f]; out[f] = (typeof v === 'number' && isFinite(v)) ? v : null; }
    return { t: el.currentTime, fields: out };
  }, FIELDS_SRC);

  const samples = [];
  for (let i = 0; i < acts.length; i++) {
    await page.evaluate((t) => { try { window.SWR.Audio.audioEl.currentTime = t; } catch (_) {} }, acts[i].t0 + 1);
    // The act is only re-read on the 1s glide clock, so give it at least one
    // full tick before trusting stability — otherwise the state is already
    // "converged" from the PREVIOUS act and the convergence loop returns stale
    // values (this made act 3 sample identical to act 2).
    await sleep(1500);
    let prev = (await snapshot()).fields;
    let settled = null;
    for (let attempt = 0; attempt < 18; attempt++) {   // ≤ 7.2s more
      await sleep(400);
      const cur = (await snapshot()).fields;
      const d = maxDelta(prev, cur, FIELDS).m;
      prev = cur;
      if (d < 0.01) { settled = cur; break; }
    }
    const snap = settled || (await snapshot()).fields;
    samples.push({ name: acts[i].name, t0: acts[i].t0, fields: snap });
    // Keep the element rolling so the next seek lands on a live transport.
    await page.evaluate(() => { const A = window.SWR.Audio; if (A.audioEl.paused) { try { A.play(); } catch (_) {} } });
  }
  ok(`sampled ${samples.length} act baselines`);

  // 5. The contract: consecutive acts must differ. This is the assertion each
  //    of the three shipped bugs would have failed.
  let worst = { m: Infinity, key: null };
  for (let i = 0; i + 1 < samples.length; i++) {
    const d = maxDelta(samples[i].fields, samples[i + 1].fields, FIELDS_SRC);
    const held = d.m >= DISPLACEMENT_MIN;
    if (d.m < worst.m) worst = { m: d.m, key: d.key };
    if (held) ok(`act ${i + 1} "${samples[i].name}" → act ${i + 2} "${samples[i + 1].name}": ${d.key} Δ=${d.m.toFixed(3)}`);
    else {
      const all = FIELDS_SRC.map((f) => `${f}=${(samples[i].fields[f] ?? 0).toFixed(3)}→${(samples[i + 1].fields[f] ?? 0).toFixed(3)}`).join(' ');
      bad(`act ${i + 1} → act ${i + 2} displacement`, `${d.key} Δ=${d.m.toFixed(3)} < ${DISPLACEMENT_MIN} — ${all}`);
    }
  }
  if (samples.length >= 2 && worst.m >= DISPLACEMENT_MIN) {
    ok(`arc drives FX.state (worst consecutive Δ=${worst.m.toFixed(3)}, bar ${DISPLACEMENT_MIN})`);
  }

  // 6. Page errors are failures (dev-control WS noise excluded, as in the
  //    sibling smokes).
  const fatal = pageErrors.filter((e) => !/ws:\/\/localhost:8787/.test(e));
  if (fatal.length === 0) ok('no page errors');
  else bad('page errors', JSON.stringify(fatal.slice(0, 4)));

  // 7. Unexpected HTTP failures. The dev-only /library/manifest.json probe is
  //    tolerated (attributed by URL); anything else 4xx/5xx is a real failure.
  const unexpected = failedRequests.filter((u) => !KNOWN_404.test(u) && !STATIC_SERVE_404.test(u) && !NULL_URL_404.test(u));
  if (unexpected.length === 0) {
    ok(`no unexpected HTTP failures${failedRequests.length ? ' (' + failedRequests.length + ' known dev/static-serve 404 ignored)' : ''}`);
  } else {
    bad('unexpected HTTP failures', JSON.stringify(unexpected.slice(0, 4)));
  }

  await browser.close();
} catch (err) {
  bad('automix arc smoke', String(err && err.message || err));
} finally {
  if (server && server.close) await server.close();
}

console.log(results.join('\n'));
if (process.exitCode) {
  console.log('\nAUTOMIX ARC SMOKE: FAILURES ABOVE');
} else {
  console.log('\nAUTOMIX ARC SMOKE: all assertions passed');
}
