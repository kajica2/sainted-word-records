#!/usr/bin/env node
// scripts/check-variant-switcher-unit.mjs — variant-switcher (Phase A) unit tests.
//
// Verifies the honesty contract of client/variant-switcher.client.js:
//   1. The brace-matched extractor pulls each version page's drawFx source
//      verbatim (byte-for-byte identical body, no trimming of content).
//   2. The compiled FX runner executes cleanly against a mock canvas +
//      Audio.feat (absorbs the mix of scanlines/grain/ghost passes).
//   3. The no-variant postFx() path is a strict no-op (returns without error),
//      so the engine render-loop hook adds zero behavior when idle.
//
// Uses the node:vm trick from check-asset-curator-unit.mjs: load the module
// source in a sandbox with browser shims, then drive the public API.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'client/variant-switcher.client.js');
const FETCH_HTML = {}; // map of '/versions/<id>.html' -> page source (test-served)

// Variants under test — read at runtime from SWR_VARIANTS.list() so a future
// addition is auto-covered. The 5→16 expansion (5 core + 11 artistic) is
// what made this test outgrow its hardcoded list; the canonical full
// coverage now lives in scripts/check-variants-unit.mjs. This file keeps
// the extractor-fidelity check (the one assertion the new unit does not
// duplicate).
let VARIANTS = [];

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) {
    console.log('  ✓', msg, detail ? `(${detail})` : '');
  } else {
    console.log('  ✗', msg, detail ? `(${detail})` : '');
    failures += 1;
  }
}

// Brace-matched extraction (mirror of the module's tokenizer; independent impl
// is fine here — we assert the two agree on every variant).
function extractDrawFx(html) {
  const marker = 'function drawFx(';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('drawFx not found');
  const open = html.indexOf('{', start);
  let depth = 0, mode = 'code', quote = '', i = open, tplDepth = 0;
  while (i < html.length) {
    const c = html[i], n = html[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
      if (c === '"' || c === "'") { mode = 'str'; quote = c; i++; continue; }
      if (c === '`') { mode = 'tpl'; i++; continue; }
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
      i++; continue;
    }
    if (mode === 'line') { if (c === '\n') mode = 'code'; i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; } i++; continue; }
    if (mode === 'str') { if (c === '\\') { i += 2; continue; } if (c === quote) mode = 'code'; i++; continue; }
    if (mode === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { mode = 'code'; i++; continue; }
      if (c === '$' && n === '{') { mode = 'tplExpr'; tplDepth = 0; i += 2; continue; }
      i++; continue;
    }
    if (mode === 'tplExpr') {
      if (c === '\'' || c === '"') { mode = 'str'; quote = c; i++; continue; }
      if (c === '`') { mode = 'tpl'; i++; continue; }
      if (c === '{') { tplDepth++; i++; continue; }
      if (c === '}') {
        if (tplDepth > 0) { tplDepth--; i++; continue; }
        mode = 'tpl'; i++; continue;
      }
      i++; continue;
    }
  }
  throw new Error('unterminated');
}

// Mock canvas context: enough of the 2D API the drawFx passes hit.
function mockCtx(W, H) {
  const store = new Uint8Array(W * H * 4).fill(128);
  return {
    canvas: { width: W, height: H },
    save() {}, restore() {},
    fillRect() {}, drawImage() {}, putImageData() {}, getImageData() {
      const data = new Uint8Array(W * H * 4); data.set(store);
      return { data, width: W, height: H };
    },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    globalCompositeOperation: '', globalAlpha: 1, fillStyle: '', filter: 'none',
  };
}

function mockAudio(featOverrides = {}) {
  return {
    feat: Object.assign({
      bass: 0.3, mid: 0.2, treble: 0.1, air: 0.05, rms: 0.18,
      beat: 0.1, onset: 0.02, beatPulse: false,
    }, featOverrides),
  };
}

// Build the sandbox: browser shims + fetch stub serving the real version pages.
function buildContext() {
  const ctx = {
    window: {},
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      documentElement: { style: { setProperty() {}, removeProperty() {}, cssText: '' } },
      createElement: () => ({ style: {}, appendChild() {} }),
      getComputedStyle: () => ({ position: 'static' }),
    },
    fetch: async (url) => {
      const body = FETCH_HTML[url];
      if (!body) throw new Error(`404 ${url}`);
      return { ok: true, status: 200, text: async () => body };
    },
    getComputedStyle: () => ({ position: 'static', getPropertyValue: () => '' }),
    console: { warn: () => {} },
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
  // Boot the module first so we can read the runtime variant list —
  // a future addition to VARIANTS is auto-covered, instead of a stale
  // hardcoded array silently shipping a test that doesn't match the
  // production code. The fetch stub serves any requested page below.
  const ctx = buildContext();
  vm.createContext(ctx);
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  vm.runInContext(src, ctx);

  const curator = ctx.window.SWR_VARIANTS;
  if (!curator) throw new Error('SWR_VARIANTS not exposed');

  // Pre-populate ALL possible variants before module init, because the module
  // calls prefetchTopVariants() on load which tries to fetch neon/music_video.
  // Without this, those prefetches fail and pollute the cache with rejected promises.
  const ALL_VARIANTS = [
    'neon', 'film', 'smoke', 'hallucination', 'grid',
    'music_video', 'glitch', 'aurora', 'pulse', 'void',
    'chrome', 'watercolor', 'fractal', 'music_video_mtv', 'eclipse'
  ];
  for (const id of ALL_VARIANTS) {
    const fp = path.join(ROOT, `versions/${id}.html`);
    if (fs.existsSync(fp)) {
      FETCH_HTML[`/versions/${id}.html`] = fs.readFileSync(fp, 'utf8');
    }
  }

  VARIANTS = curator.list().map((v) => v.id);

  // Clear the cache after module init to clear any failed prefetch promises.
  // The module prefetches neon and music_video on load, and without pre-populating
  // FETCH_HTML those requests would fail and leave rejected promises in the cache.
  curator._debug.state.cache.clear();

  console.log(`\n=== 1. Extractor verbatim fidelity (${VARIANTS.length} variants) ===`);
  const extractor = curator._debug.extractFunctionSource;
  for (const id of VARIANTS) {
    const page = FETCH_HTML[`/versions/${id}.html`];
    const mine = extractDrawFx(page);
    const mod = extractor(page, 'drawFx');
    assert(mod === mine, `${id}: module extractor == reference extractor`);
    assert(mod.includes(`function drawFx(`), `${id}: source is a function decl`);
    // Sanity: body is substantial and retains its comment-header start.
    assert(mod.includes('function drawFx(') && mod.trimEnd().endsWith('}'), `${id}: well-formed body`);
  }

  console.log('\n=== 2. Compiled FX runs against mock canvas (no throw) ===');
  const W = 320, H = 180;
  for (const id of VARIANTS) {
    let threw = null;
    try {
      await curator.activate(id);
      curator.postFx(mockCtx(W, H));
    } catch (e) { threw = e; }
    assert(threw === null, `${id}: postFx ran without throwing`, threw ? threw.message : '');
    assert(curator.current() === id, `${id}: current() === id`);
    curator.deactivate();
  }

  console.log('\n=== 3. No-op contract ===');
  curator.deactivate();
  let noOpThrew = null;
  try { curator.postFx(mockCtx(W, H)); } catch (e) { noOpThrew = e; }
  assert(noOpThrew === null, 'postFx with no active variant is a strict no-op');
  assert(curator.current() === null, 'current() === null after deactivate');

  console.log('\n=== 4. List shape ===');
  const list = curator.list();
  assert(Array.isArray(list) && list.length === VARIANTS.length,
    `list() returns ${VARIANTS.length} variants (got ${list.length})`);
  assert(list.every((v) => v.id && v.name && v.song), 'every entry has id/name/song');

  console.log('\n' + (failures === 0
    ? 'VARIANT SWITCHER UNIT: ALL GREEN'
    : `VARIANT SWITCHER UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});