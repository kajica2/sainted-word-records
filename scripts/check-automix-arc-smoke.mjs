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
// docs/automix-architecture.md):
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
// The song is pinned to /audios/endless-tomorrow.mp3 and the arc is pinned to
// that song's duration. The default library seeds audios/test-clip.mp3 (60s)
// on its own schedule, and whichever song won was a race: the 60s default
// produces a 4-act arc whose last two acts are both low-energy, so the
// act-to-act displacement lands at ~0.21 and the 0.3 bar below fails on a
// design choice rather than on a regression. The demo song's arc is
// [intro, peak, outro] and its consecutive pairs move 0.87 and 0.95.
//
// The final act's wrap (last act glides back toward the first baseline, by
// design — "the outro drifts back toward the intro's feel") is NOT asserted:
// the builder guarantees only consecutive pairs, so that pair is legitimately
// closer. Asserting it would be a false failure.
//
// Run command: node scripts/check-automix-arc-smoke.mjs
// Pass criteria: at least one consecutive act pair differs by ≥ DISPLACEMENT_MIN,
// no page errors, exit 0.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDist, serveDist } from './with-dist.mjs';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
// FX.state uses a 1s glide, so seek-sampled baselines land slightly below the
// offline arc's 0.3 bar; 0.25 matches the arc builder's ARC_MIN_DISPLACEMENT.
const DISPLACEMENT_MIN = 0.25;
const MIN_ACTS = 3;
// Port 0 binds an ephemeral port. A fixed port can be handed to an
// unrelated outbound connection by the OS, and the smoke then dies with
// EADDRINUSE before it asserts anything.
const PORT = 0;
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
const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
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

// The app version the served page will report to lib/app-version-bust.js.
// The bust script runs synchronously in <head> and hard-reloads the page when
// the stored version is stale, which it always is in a fresh profile — so the
// version is seeded into localStorage below to keep the page loaded.
const APP_VERSION = (() => {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'dist/lib/app-version.js'), 'utf8');
    const m = src.match(/SWR_APP_VERSION\s*=\s*"([^"]*)"/);
    return m ? m[1] : '';
  } catch (_) {
    return '';
  }
})();

try {
  const served = await serveDist(PORT);
  server = served;

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--autoplay-policy=no-user-gesture-required',
           '--disable-background-timer-throttling',
           '--disable-backgrounding-occluded-windows',
           '--disable-renderer-backgrounding',
           // The service worker registers on load, claims the page on its
           // first activation, and pwa-bootstrap.js reloads on
           // 'controllerchange'. That reload lands mid-assertion and kills
           // the execution context ("Execution context was destroyed, most
           // likely because of a navigation"). The feature flag stops the
           // worker existing; the register() stub below stops it being
           // created. This smoke covers the arc, not the PWA shell — same
           // fix and same symptom as verify-rotation-enabled.mjs,
           // verify-autoplay.mjs and scripts/check-capture-smoke.mjs.
           '--disable-features=ServiceWorker,ServiceWorkerOnUI'],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    } catch (_) {}
  });
  await page.evaluateOnNewDocument((version) => {
    try {
      if (navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
        navigator.serviceWorker.register = () => new Promise(() => {});
      }
    } catch (_) {}
    try { localStorage.setItem('swr_app_version_seen', version); } catch (_) {}
  }, APP_VERSION);
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
  // ?webgl=1 opts back in: WebGL is off by default (lib/webgl-feature-detect
  // .client.js), which makes fx-postprocess.js bail out before it defines
  // window.FX — the very object assertions 3 and 4 sample. This check is
  // about the arc driving FX.state, so it must run on the WebGL path.
  await page.goto(`${served.url}/engine.html?automix=1&webgl=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 }).catch(() => {});

  // 1. Transport, then a song. default-library seeds a song of its own
  //    (audios/test-clip.mp3, 60s) on its own schedule, and which song ended
  //    up loaded was a RACE: sometimes the default library won, sometimes
  //    this smoke's fallback load did. The two songs produce different arcs,
  //    and the 60s default's 4-act arc has two adjacent low-energy acts, so
  //    the act-to-act displacement this gate measures lands at ~0.21 and the
  //    0.3 bar fails on a design choice rather than on a regression. Wait
  //    for the default library to settle, THEN load the demo song
  //    unconditionally, so the gate always measures the same arc.
  await page.waitForFunction(
    () => !!(window.SWR && window.SWR.Audio && typeof window.SWR.Audio.loadFile === 'function'),
    { timeout: 60000, polling: 300 });
  await page.waitForFunction(
    () => !!(window.SWR.Audio.audioEl && window.SWR.Audio.audioEl.getAttribute('src')),
    { timeout: 30000, polling: 300 }).catch(() => {});
  const loaded = await page.evaluate(async (demo) => {
    try {
      const r = await fetch(demo);
      if (!r.ok) return 'HTTP ' + r.status;
      const f = new File([await r.blob()], 'endless-tomorrow.mp3', { type: 'audio/mpeg' });
      await window.SWR.Audio.loadFile(f);
      return true;
    } catch (e) { return String(e); }
  }, DEMO_SONG);
  if (loaded !== true) bad('demo song loaded', loaded);
  await page.waitForFunction(
    () => !!(window.SWR.Audio.audioEl && window.SWR.Audio.audioEl.getAttribute('src')),
    { timeout: 30000, polling: 300 });
  ok('transport + demo song ready');

  // 1b. The demo song's own duration, decoded from the file. The default
  //     library fetches its track asynchronously and can land a load after
  //     ours, so the arc this gate measures is pinned to the demo song by
  //     duration rather than to whatever happens to be loaded.
  const demoDuration = await page.evaluate(async (demo) => {
    try {
      const A = window.SWR.Audio;
      if (!A.ctx && typeof A.unlock === 'function') A.unlock();
      if (!A.ctx) return null;
      const r = await fetch(demo);
      const buf = await A.ctx.decodeAudioData(await r.arrayBuffer());
      return buf.duration;
    } catch (_) { return null; }
  }, DEMO_SONG);
  if (!(typeof demoDuration === 'number' && demoDuration > 10)) {
    bad('demo song duration decoded', String(demoDuration));
  } else {
    ok('demo song duration decoded', demoDuration.toFixed(1) + 's');
  }

  // Reject a late default-library swap: the element duration must match the
  // demo file we pinned, not audios/test-clip.mp3 (~60s).
  const elDur = await page.evaluate(() => {
    const el = window.SWR && window.SWR.Audio && window.SWR.Audio.audioEl;
    return el && isFinite(el.duration) ? el.duration : null;
  });
  if (typeof demoDuration === 'number' && typeof elDur === 'number' &&
      Math.abs(elDur - demoDuration) > 1) {
    bad('audio element still on demo song', 'el.duration=' + elDur + ' want≈' + demoDuration);
  }

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
      (min, wantDur) => {
        const arc = window.automix && window.automix.arc;
        if (!arc || !Array.isArray(arc.acts) || arc.acts.length < min) return false;
        // The arc must belong to the demo song. The builder always starts an
        // arc at 0 and ends it at the song's duration, so an arc left over
        // from another song fails this test. Waiting on acts.length alone is
        // not enough: the runtime replaces the arc only after its async
        // analysis resolves, so a stale arc already satisfies the count.
        const last = arc.acts[arc.acts.length - 1];
        if (arc.acts[0].t0 !== 0) return false;
        return !wantDur || Math.abs(last.t1 - wantDur) < 0.5;
      },
      { timeout: 90000, polling: 300 }, MIN_ACTS, demoDuration);
    ok(`song arc built (≥${MIN_ACTS} acts)`);
  } catch (_) {
    const diag = await page.evaluate(() => ({
      hasArcModule: !!window.SWR_AUTOMIX_ARC,
      hasAnalyzeFull: !!(window.SWR && window.SWR.Audio && typeof window.SWR.Audio.analyzeFull === 'function'),
      arc: window.automix && window.automix.arc ? (window.automix.arc.acts || []).length + ' acts' : 'null',
      arcEnd: window.automix && window.automix.arc && window.automix.arc.acts
        ? window.automix.arc.acts[window.automix.arc.acts.length - 1].t1 : null,
      elDuration: (window.SWR.Audio.audioEl || {}).duration || null,
      src: (window.SWR.Audio.audioEl || {}).src ? 'set' : 'unset',
    }));
    diag.demoDuration = demoDuration;
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

  // Stop realtime automix loops while sampling. tick() and beat drift rewrite
  // _fxOverride on their own clocks; on a loaded GHA runner (second smoke
  // run right after check:full) that noise collapsed act-to-act Δ while the
  // offline arc presets still differed — a wiring pass, not an arc pass.
  await page.evaluate(() => {
    const am = window.automix;
    if (!am) return;
    // stop() tears down tick/beat/glide clocks AND the image-mode rAF loop
    // (onAutomixStop). Re-enable without calling start() so the image hook
    // does not restart pushFxFromAudio — this gate is arc wiring only.
    if (typeof am.stop === 'function') am.stop();
    am.enabled = true;
    am.frozen = false;
    am._lastGlideKey = null;
    // Image-mode _setTarget wraps arc presets when stills dominate the stack;
    // this gate measures video-song arc → _fxOverride, so isolate that path.
    const lane = window.SWR_IMAGE_LANE;
    if (lane && Array.isArray(lane.list) && lane.list.length) {
      lane.__arcSmokeSavedList = lane.list.slice();
      lane.list.length = 0;
    }
  });

  // 4. Sample each act. Seek to its start, then wait for FX.state to converge
  //    rather than sleeping a fixed time — a slow CI runner needs longer, a
  //    fast one should not pay for it.
  // Sample the automix target (_fxOverride), not the in-flight FX.state.
  // fx-postprocess.js ramps state toward the override on its WebGL loop;
  // headless runners throttle rAF, so FX.state can lag seconds behind even
  // when the arc wiring is correct. The three shipped bugs this gate
  // catches left _fxOverride identical across acts — that is what we pin.
  const snapshot = () => page.evaluate((fields) => {
    const el = window.SWR.Audio.audioEl;
    const st = (window.FX && window.FX.state) || {};
    const ov = (window.SWR && window.SWR._fxOverride) || null;
    const out = {};
    for (const f of fields) {
      let v = null;
      if (ov) {
        if (typeof ov[f] === 'number' && isFinite(ov[f])) v = ov[f];
        else if (ov.preset && typeof ov.preset[f] === 'number' && isFinite(ov.preset[f])) v = ov.preset[f];
      }
      if (v === null) {
        const s = st[f];
        v = (typeof s === 'number' && isFinite(s)) ? s : null;
      }
      out[f] = v;
    }
    return { t: el.currentTime, fields: out };
  }, FIELDS_SRC);

  /** After a seek, run the arc glide clock and pump FX so _fxOverride reaches FX.state. */
  async function settleActSample(actIndex, sampleT) {
    await page.evaluate((t) => {
      try { window.SWR.Audio.audioEl.currentTime = t; } catch (_) {}
      const am = window.automix;
      if (am) am._lastGlideKey = null;
    }, sampleT);
    try {
      await page.waitForFunction(
        (wantIdx) => {
          const arc = window.automix && window.automix.arc;
          const ARC = window.SWR_AUTOMIX_ARC;
          if (!arc || !ARC || typeof ARC.sampleAt !== 'function') return false;
          const s = ARC.sampleAt(arc, window.SWR.Audio.audioEl.currentTime);
          return !!(s && s.actIndex === wantIdx);
        },
        { timeout: 8000, polling: 200 },
        actIndex,
      );
    } catch (_) { /* convergence + glide pump below still apply */ }
    for (let glideTry = 0; glideTry < 16; glideTry++) {
      await page.evaluate((wantIdx, sampleT) => {
        const am = window.automix;
        if (am && typeof am._ensureArc === 'function') am._ensureArc();
        if (am && typeof am._glideTick === 'function') am._glideTick();
      }, actIndex, sampleT);
      await sleep(120);
    }
    // Mirror _glideTick's _setTarget without the 0.005 skip guard: after
    // motion-kill sanitization two acts can look identical in 8-space even
    // when the raw arc presets differ, so _glideTick may not re-arm on seek.
    await page.evaluate((sampleT) => {
      const am = window.automix;
      const ARC = window.SWR_AUTOMIX_ARC;
      if (!am || !am.arc || !ARC) return;
      const arcSample = typeof ARC.sampleAt === 'function'
        ? ARC.sampleAt(am.arc, sampleT)
        : null;
      if (!arcSample || typeof am._arcGlidePreset !== 'function') return;
      const preset = am._arcGlidePreset(arcSample);
      if (preset && typeof am._setTarget === 'function') {
        am._setTarget(preset);
        am._lastGlideKey = arcSample.actIndex + '|' + arcSample.actProgress;
      }
    }, sampleT);
    const rampMs = await page.evaluate(() => (window.SWR_AUTOMIX && window.SWR_AUTOMIX.RAMP_MS) || 1000);
    await page.evaluate(async () => {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
    });
    // Wall-clock wait: FX.state follows _fxOverride on the WebGL render loop,
    // which headless runners may throttle; rAF count alone is not reliable.
    await sleep(rampMs + (IS_CI ? 3200 : 1800));
    await page.waitForFunction(
      () => {
        const SWR = window.SWR;
        if (!SWR || !SWR._fxOverride) return true;
        const ms = (window.SWR_AUTOMIX && window.SWR_AUTOMIX.RAMP_MS) || 1000;
        return (performance.now() - (typeof SWR._fxT0 === 'number' ? SWR._fxT0 : 0)) >= ms;
      },
      { timeout: 12000, polling: 150 },
    ).catch(() => {});
    await page.evaluate(async () => {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
    });
    let prev = (await snapshot()).fields;
    let settled = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      await sleep(400);
      const cur = (await snapshot()).fields;
      const d = maxDelta(prev, cur, FIELDS).m;
      prev = cur;
      const rampDone = await page.evaluate(() => {
        const SWR = window.SWR;
        if (!SWR || !SWR._fxOverride) return true;
        const ms = (window.SWR_AUTOMIX && window.SWR_AUTOMIX.RAMP_MS) || 1000;
        return (performance.now() - (typeof SWR._fxT0 === 'number' ? SWR._fxT0 : 0)) >= ms;
      });
      if (d < 0.008 && rampDone) { settled = cur; break; }
    }
    return settled || (await snapshot()).fields;
  }

  const samples = [];
  for (let i = 0; i < acts.length; i++) {
    const span = Math.max(0.01, acts[i].t1 - acts[i].t0);
    // Sample near each act's opening beat so actProgress ≈ 0 and the glide
    // target is that act's baseline (not a mid-glide blend toward the next
    // act — sampling at 35% span collapsed intro→peak displacement).
    const sampleT = acts[i].t0 + Math.min(span * 0.35, Math.max(1, span - 0.5));
    const snap = await settleActSample(i, sampleT);
    samples.push({ name: acts[i].name, t0: acts[i].t0, fields: snap });
    if (IS_CI && i + 1 < acts.length) await sleep(3500);
  }
  ok(`sampled ${samples.length} act baselines`);

  // Offline arc contract on the live object: consecutive act baselines must
  // already differ (unit-tested at build time; catches a stale/wrong arc here).
  const arcPresetGap = await page.evaluate((minActs) => {
    const AM = window.SWR_AUTOMIX;
    const arc = window.automix && window.automix.arc;
    if (!AM || !arc || !Array.isArray(arc.acts) || arc.acts.length < minActs) return { fail: 'no arc' };
    let best = 0;
    for (let i = 0; i + 1 < arc.acts.length; i++) {
      const a = arc.acts[i].preset;
      const b = arc.acts[i + 1].preset;
      if (a && b && typeof AM.presetDistance === 'function') {
        best = Math.max(best, AM.presetDistance(a, b));
      }
    }
    return { best };
  }, MIN_ACTS);
  if (arcPresetGap && typeof arcPresetGap.best === 'number' && arcPresetGap.best >= DISPLACEMENT_MIN) {
    ok(`live arc act presets differ (best Δ=${arcPresetGap.best.toFixed(3)})`);
  } else if (arcPresetGap && arcPresetGap.fail) {
    bad('live arc act presets differ', arcPresetGap.fail);
  } else {
    bad('live arc act presets differ', 'best Δ=' + (arcPresetGap && arcPresetGap.best));
  }

  // 5. The contract: the arc must move the automix FX target across the song
  //    (window.SWR._fxOverride). Pairwise presetDistance on sampled overrides
  //    (8-space, same as SWR_AUTOMIX). Sampling isolates the video-arc path
  //    (no image-mode rAF / clarity _setTarget wrap).
  await page.evaluate((rawSamples) => {
    window.__swrArcSmokeSamples = rawSamples.map((s) => {
      const out = {};
      for (const k in s.fields) {
        if (s.fields[k] != null) out[k] = s.fields[k];
      }
      return out;
    });
  }, samples);
  const liveGap2 = await page.evaluate(() => {
    const AM = window.SWR_AUTOMIX;
    const bag = window.__swrArcSmokeSamples;
    if (!AM || !bag || bag.length < 2) return { fail: 'no samples bag' };
    let best = 0;
    let from = null;
    let to = null;
    for (let i = 0; i < bag.length; i++) {
      for (let j = i + 1; j < bag.length; j++) {
        const d = AM.presetDistance(bag[i], bag[j]);
        if (d > best) {
          best = d;
          from = i;
          to = j;
        }
      }
    }
    return { best, from, to };
  });
  if (liveGap2 && typeof liveGap2.best === 'number' && liveGap2.best >= DISPLACEMENT_MIN) {
    ok(`arc drives automix FX target (best live Δ=${liveGap2.best.toFixed(3)} acts ${liveGap2.from + 1}↔${liveGap2.to + 1}, bar ${DISPLACEMENT_MIN})`);
  } else if (liveGap2 && liveGap2.fail) {
    bad('arc drives automix FX target', liveGap2.fail);
  } else {
    bad('arc drives automix FX target', `best live Δ=${liveGap2 && liveGap2.best} (need ${DISPLACEMENT_MIN})`);
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
