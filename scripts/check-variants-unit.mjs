#!/usr/bin/env node
// scripts/check-variants-unit.mjs — full 14-variant switcher unit test.
//
// The variant switcher grew from 5 (neon/film/smoke/hallucination) to 16
// across this session, then was reduced to 14 when grid and baroque were
// removed (d8f6390 and the gate's initial commit). Each wired entry
// required a `function drawFx(` body in its versions/<id>.html page;
// eclipse and baroque got author passes before their eventual removal,
// and grid's drawFx was always a no-op (`function drawFx()` in
// versions/grid.html:1079).
//
// Two latent bugs were caught and fixed during the work:
//   - `proc` / `pcx` were unbound in compileFx (aurora/glitch/chrome/
//     watercolor reference them and silently self-disabled via postFx's
//     try/catch).
//   - targeting-pipeline/build-rules.mjs's variant-id regex dropped the
//     new `music_video*` ids (underscore not in [a-z0-9-]+).
//
// Today the only verification of "every variant actually paints" was a
// one-off browser probe. This test is the contract enforcer that catches a
// future regression the day it lands:
//   1. variant id list comes from window.SWR_VARIANTS.list() at runtime —
//      a future entry that is added to the VARIANTS array is auto-covered.
//   2. For every id, loadVariant() resolves, _debug.state.fx is non-null,
//      and fx.run() does not throw against a mock canvas + Audio.feat.
//   3. The mock A.feat is the contract surface for the audio features every
//      drawFx body reads. Adding a new drawFx that reads a new feature
//      fails this test with a ReferenceError until the mock is extended —
//      which is the failure mode we want.
//
// Uses the node:vm trick from check-capture-unit.mjs: load the module
// source in a sandbox with browser shims, then drive the public API.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'client/variant-switcher.client.js');
const LOOKS_SRC_PATH = path.join(ROOT, 'client/looks-menu.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) {
    console.log('  ✓', msg, detail ? `(${detail})` : '');
  } else {
    console.log('  ✗', msg, detail ? `(${detail})` : '');
    failures += 1;
  }
}

// Mock canvas 2D context. A Proxy is not enough on its own: the drawFx
// bodies call ctx.createLinearGradient(...).addColorStop(...), and the
// gradient object's `addColorStop` must chain. Real grad objects are
// hand-rolled with a single chained method; the rest of the API is the
// Proxy and self-returns so ctx.save()/restore()/fillRect() chain cleanly.
function makeMockCtx(W, H) {
  const grad = { addColorStop() { return this; } };
  // Real ImageData buffer so ctx.getImageData(0,0,W,H) returns a typed
  // array drawFx bodies can read/write (film's grain pass iterates d[]).
  const imageData = {
    data: new Uint8ClampedArray(W * H * 4),
    width: W,
    height: H,
  };
  const handler = {
    get(target, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => Object.create(grad);
      }
      if (prop === 'canvas') return { width: W, height: H };
      if (prop === 'measureText') return () => ({ width: 12 });
      if (prop === 'getImageData') return () => imageData;
      if (prop === 'createImageData') return (w = W, h = H) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      });
      // Anything else (save/restore/fillRect/drawImage/putImageData/
      // translate/rotate/scale/transform/beginPath/closePath/moveTo/lineTo/...):
      // return a callable that ignores args and returns the proxy, so chains
      // like `ctx.save()` or `ctx.fillStyle = '...'; ctx.fillRect(...)` work.
      const v = target[prop];
      if (typeof v === 'function') return v;
      return (..._args) => target;
    },
    set(target, prop, value) { target[prop] = value; return true; },
  };
  return new Proxy({ width: W, height: H }, handler);
}

// Contract surface for the audio features every wired drawFx body reads.
// When a future drawFx reads a feature not in this mock, the test fails
// with a ReferenceError — the implementer should add the new feature here
// AND to the plan's Assumptions section so the contract stays visible.
//
// Union of `A.feat.<x>` reads across all 14 wired drawFx bodies:
//   bass, beat, beatPulse, centroid, mid, onset, rms, treble
// (`air` is read inside drawMeter, NOT drawFx — Meter is a separate
//  optional surface and is not invoked by the engine render loop the
//  variant switcher participates in.)
const MOCK_AUDIO = () => ({
  playing: false,
  feat: {
    bass: 0.4,
    mid: 0.3,
    treble: 0.2,
    beat: 0.1,
    onset: 0.0,
    beatPulse: false,
    rms: 0.3,
    centroid: 0.5,
  },
});

// Mock stage canvas — what compileFx() draws onto and what postFx() reads
// W/H from. A real <canvas> is not constructable under node:vm; the bare
// object is enough because activate() never calls getContext on it and
// postFx only reads width/height.
function makeMockStage(W, H) { return { width: W, height: H, clientWidth: W, clientHeight: H }; }

// Build the sandbox: browser shims + fetch stub serving the real version
// pages from the repo root. fetch is load-bearing: loadVariant() does
// `fetch('/versions/<id>.html')` and the variant page's drawFx source
// comes byte-for-byte from the file the test serves.
function buildContext() {
  const ctx = {
    window: {},
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      documentElement: { style: { setProperty() {}, removeProperty() {}, cssText: '' } },
      createElement: () => {
        // The real compileFx() allocates a scratch canvas via
        // `document.createElement('canvas')` and asks for its 2D context.
        // Return a canvas-shaped object with a no-op getContext so the
        // `scratchCtx` binding in compileFx lands without throwing.
        const c = { width: 0, height: 0 };
        c.getContext = () => makeMockCtx(0, 0);
        return c;
      },
      getComputedStyle: () => ({ position: 'static' }),
    },
    fetch: async (url) => {
      // strip leading '/' and resolve from repo root
      const rel = url.replace(/^\//, '');
      const p = path.join(ROOT, rel);
      if (!p.startsWith(ROOT) || !fs.existsSync(p)) {
        throw new Error(`404 ${url}`);
      }
      return { ok: true, status: 200, text: async () => fs.readFileSync(p, 'utf8') };
    },
    getComputedStyle: () => ({ position: 'static', getPropertyValue: () => '' }),
    console: { warn: () => {}, log: () => {}, error: () => {} },
    performance: { now: () => Date.now() },
    AbortSignal,
  };
  ctx.window.window = ctx.window;
  ctx.window.document = ctx.document;
  ctx.window.performance = ctx.performance;
  ctx.window.console = ctx.console;
  ctx.window.getComputedStyle = ctx.getComputedStyle;
  ctx.window.fetch = ctx.fetch;
  return ctx;
}

async function main() {
  const ctx = buildContext();
  vm.createContext(ctx);

  const src = fs.readFileSync(SRC_PATH, 'utf8');
  vm.runInContext(src, ctx);

  // Also load looks-menu so window.SWR_LOOKS is populated in the sandbox.
  // The unit test does not assert on it directly, but the public contract
  // is that both globals exist after the engine boot order runs.
  const looksSrc = fs.readFileSync(LOOKS_SRC_PATH, 'utf8');
  vm.runInContext(looksSrc, ctx);

  const variants = ctx.window.SWR_VARIANTS;
  if (!variants) throw new Error('SWR_VARIANTS not exposed');

  // Read the variant list at runtime — a future change to the VARIANTS
  // array is auto-covered. Pinning the count to 14 here would make the
  // test silently out-of-date the next time someone adds a 15th.
  const list = variants.list();
  const ids = list.map((v) => v.id);
  console.log(`\n=== 1. Variant list shape (${ids.length} entries) ===`);
  assert(Array.isArray(list), 'list() returns an array');
  assert(ids.length > 0, `list() has at least one entry (got ${ids.length})`);
  assert(list.every((v) => v.id && v.name && v.song), 'every entry has id/name/song');
  assert(new Set(ids).size === ids.length, 'all ids are unique');
  assert(ctx.window.SWR_LOOKS, 'window.SWR_LOOKS installed after switcher + looks-menu load');

  console.log(`\n=== 2. Per-variant compile + run (no throw) ===`);
  const W = 1280, H = 720;
  const stageCanvas = makeMockStage(W, H);
  const mockCtx = makeMockCtx(W, H);
  const mockA = MOCK_AUDIO();
  // The bound-name surface for compileFx: $, clamp, lerp, the stage canvas,
  // the audio object, and the A/V bound names. Mirror what postFx() passes.
  const $stub = (id) => null;          // getElementById for missing ids
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  let ok = 0;
  for (const id of ids) {
    // Reset state per id so a bad frame from a previous variant cannot
    // leak into the next one. deactivate() also nulls state.fx.
    variants.deactivate();

    // 2a. activate resolves and produces a non-null state.fx.
    let activateErr = null;
    try { await variants.activate(id); }
    catch (e) { activateErr = e; }
    const fx = variants._debug.state.fx;
    if (activateErr) {
      assert(false, `${id}: activate()`, `threw: ${activateErr.message}`);
    } else if (!fx) {
      assert(false, `${id}: activate()`, 'state.fx is null (compile or postFx self-disabled)');
    } else {
      // 2b. fx.run() executes the drawFx body with the bound names populated.
      // Any unbound name → ReferenceError surfaces here. This is the line
      // that would have caught the proc/pcx bug at the time it landed.
      let runErr = null;
      try { fx.run(mockCtx, W, H, mockA, stageCanvas, $stub, clamp, lerp); }
      catch (e) { runErr = e; }
      if (runErr) {
        assert(false, `${id}: fx.run()`, `threw: ${runErr.message}`);
      } else {
        assert(true, `${id}: fx=non-null, run()=ok`);
        ok += 1;
      }
    }
  }
  console.log(`  pass: ${ok}/${ids.length} variants compiled and ran without throwing`);

  console.log(`\n=== 3. Mock A.feat contract (no feature reads beyond the contract set) ===`);
  // Instrument a fresh mock so an unknown feature access throws, then
  // run every variant's fx against it. A future drawFx that reads a
  // feature the contract mock does not provide fails here with a clear
  // "missing feature" error and points at this test as the surface to
  // extend.
  const contractKeys = Object.keys(MOCK_AUDIO().feat);
  const guardedFeat = new Proxy(MOCK_AUDIO().feat, {
    get(target, prop) {
      if (!(prop in target)) {
        throw new Error(`mock A.feat.${String(prop)} is not in the contract (known: ${contractKeys.join(', ')})`);
      }
      return target[prop];
    },
  });
  const guardedA = Object.create(MOCK_AUDIO());
  guardedA.feat = guardedFeat;
  let contractOk = 0;
  for (const id of ids) {
    variants.deactivate();
    try {
      await variants.activate(id);
      const fx = variants._debug.state.fx;
      if (!fx) throw new Error('state.fx is null');
      fx.run(mockCtx, W, H, guardedA, stageCanvas, $stub, clamp, lerp);
      contractOk += 1;
    } catch (e) {
      assert(false, `${id}: A.feat contract`, e.message);
    }
  }
  assert(
    contractOk === ids.length,
    `every drawFx only reads contract features: ${contractOk}/${ids.length}`,
    contractOk === ids.length ? '' : 'see failures above'
  );

  console.log('\n=== 4. No-op contract (deactivate, then postFx is a no-op) ===');
  variants.deactivate();
  let noOpErr = null;
  try { variants.postFx(mockCtx); }
  catch (e) { noOpErr = e; }
  assert(noOpErr === null, 'postFx with no active variant is a strict no-op');
  assert(variants.current() === null, 'current() === null after deactivate');

  console.log('\n' + (failures === 0
    ? `VARIANTS UNIT: all ${ids.length} variants green`
    : `VARIANTS UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
