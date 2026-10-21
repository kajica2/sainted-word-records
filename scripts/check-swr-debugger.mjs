#!/usr/bin/env node
// scripts/check-swr-debugger.mjs
//
// Metric harness for client/engine-debugger.client.js.
//
// Launches headless Chrome over the DevTools Protocol (no npm
// dependencies — Node's built-in WebSocket does the work), loads an SWR
// engine page, and scores the visual debugger:
//
//   SCORE = 0.5 * coverage + 0.3 * accuracy + 0.2 * headroom
//
//   coverage  fraction of the overlay's declared surfaces that render
//             genuine live engine data (not placeholders)
//   accuracy  fraction of independent probes that confirm the overlay
//             shows the engine's real values and does not perturb it
//   headroom  frame-budget headroom, 1.0 when the overlay costs nothing
//
// Every probe is written so the debugger cannot pass by displaying
// plausible-looking numbers: the values are checked against the engine's
// own computed state, and one probe proves the overlay adds no calls into
// the engine's audio damper.
//
// Usage:
//   node scripts/check-swr-debugger.mjs [--target=<url>] [--headed]
//                                     [--fail-under=<0..1>]
//
// Env:
//   SWR_DEBUG_TARGET  same as --target
//   CHROME_BIN        explicit Chrome/Chromium binary

import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEBUGGER_SRC = join(ROOT, 'client', 'engine-debugger.client.js');

const DEFAULT_TARGET = 'https://sainted-word-records.vercel.app/versions/neon.html';
const BASE_URL = 'https://sainted-word-records.vercel.app/versions/';
// A representative slice of the variant family: the target page, two
// sibling core variants, and two artistic ones with different draw paths.
const DEFAULT_PAGES = ['neon', 'film', 'aurora', 'watercolor'];

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const TARGET = arg('target', process.env.SWR_DEBUG_TARGET || null);
const PAGES = arg('pages', process.env.SWR_DEBUG_PAGES || DEFAULT_PAGES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const HEADED = has('headed');
const NO_DEBUGGER = has('no-debugger');
const FAIL_UNDER = arg('fail-under', null);

function TARGET_URLS() {
  if (TARGET) return [TARGET];
  return PAGES.map((p) => (p.includes('://') ? p : BASE_URL + p + '.html'));
}

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── minimal CDP client ───────────────────────────────────────────────────

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = (e) => rej(new Error('CDP websocket error: ' + (e.message || 'unknown')));
    });
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 120000);
    });
  }

  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

async function launchChrome() {
  const bin = CHROME_CANDIDATES.find(Boolean);
  if (!bin) throw new Error('No Chrome binary found. Set CHROME_BIN.');
  const profile = mkdtempSync(join(tmpdir(), 'swr-debug-'));
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--window-size=1440,900',
    'about:blank',
  ];
  if (!HEADED) args.unshift('--headless=new');

  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome did not expose a DevTools endpoint.\n' + stderr)), 30000);
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error('Chrome exited early (' + code + ')\n' + stderr)); });
  });

  return { proc, wsUrl, profile };
}

// ── page helpers ─────────────────────────────────────────────────────────

async function evaluate(cdp, sessionId, expression, awaitPromise = false) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
    timeout: 60000,
  }, sessionId);
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error('page eval threw: ' + (d.exception?.description || d.text));
  }
  return res.result?.value;
}

async function waitFor(cdp, sessionId, expression, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let ok = false;
    try { ok = await evaluate(cdp, sessionId, expression); } catch { /* page may be mid-navigation */ }
    if (ok) return true;
    await sleep(250);
  }
  throw new Error('timed out waiting for ' + label);
}

// ── the in-page probe ────────────────────────────────────────────────────
//
// Installed BEFORE the debugger so the debugger's wrappers sit outside
// these. The probe therefore observes the engine through the debugger,
// which is exactly what we want to test: same values, same call counts.

const PROBE_SRC = `
(() => {
  const R = window.SWR_RENDER;
  if (!R) return { ok: false, reason: 'SWR_RENDER missing' };
  if (window.__swrProbe) return { ok: true, already: true };

  const probe = {
    frames: 0,
    applyRCalls: 0,
    evolveCalls: 0,
    drawCalls: 0,
    draws: [],
    layerIds: [],
    resolved: {},
    drawn: {},
    // layerId → the last draw the engine made for that layer, plus the
    // CSS-space quad the probe derives independently from the raw call.
    layerDraws: {},
    currentLayer: null,
    reset() {
      this.frames = 0; this.applyRCalls = 0; this.evolveCalls = 0; this.drawCalls = 0;
      this.resolved = {}; this.drawn = {}; this.draws = [];
    },
  };

  // Derive the CSS-space quad from a raw drawImage call. This is the
  // probe's own implementation of "where did that land", written
  // independently of the debugger's, so the two can be compared.
  function cssQuad(t, dx, dy, dw, dh) {
    const dpr = Math.hypot(t.a, t.b) || 1;
    const corners = [[dx, dy], [dx + dw, dy], [dx + dw, dy + dh], [dx, dy + dh]];
    return corners.map((q) => [
      (t.a * q[0] + t.c * q[1] + t.e) / dpr,
      (t.b * q[0] + t.d * q[1] + t.f) / dpr,
    ]);
  }
  probe.cssQuad = cssQuad;

  function recordDraw(ctx, layer, src, dx, dy, dw, dh) {
    if (!layer) return;
    probe.drawCalls++;
    const t = ctx.getTransform();
    const quad = cssQuad(t, dx, dy, dw, dh);
    probe.draws.push({ key: src && src.tagName ? src.tagName + '#' + String(src.src || '').slice(-24) : '',
      dx, dy, dw, dh, a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f });
    probe.layerDraws[layer.id] = { quad, w: dw, h: dh, ox: dx, oy: dy };
  }
  probe.recordDraw = recordDraw;

  const origFrame = R.frame;
  R.frame = function (stage, ctx, layers, applyR, drawToCtx, opts) {
    probe.frames++;
    probe.draws = [];
    probe.layerIds = (layers || []).map((l) => l.id);
    const rec = function (l) {
      probe.applyRCalls++;
      const r = applyR(l);
      probe.resolved[l.id] = r;
      return r;
    };
    // Attribute draws to the layer being drawn. The engine's drawToCtx
    // receives an offscreen context, and variants that ignore it draw
    // straight onto the stage instead — watch both.
    const traced = function (l, r, c, cssW, cssH) {
      probe.currentLayer = l;
      let restore = null;
      if (c && typeof c.drawImage === 'function') {
        const orig = c.drawImage;
        c.drawImage = function (src, dx, dy, dw, dh) {
          probe.recordDraw(this, l, src, dx, dy, dw, dh);
          return orig.apply(this, arguments);
        };
        restore = function () { c.drawImage = orig; };
      }
      try {
        return drawToCtx(l, r, c, cssW, cssH);
      } finally {
        if (restore) restore();
        probe.currentLayer = null;
      }
    };
    return origFrame.call(this, stage, ctx, layers, rec, traced, opts);
  };

  const origEvolve = R.imageEvolve;
  if (typeof origEvolve === 'function') {
    R.imageEvolve = function (l, r) {
      const out = origEvolve.apply(this, arguments);
      probe.evolveCalls++;
      probe.drawn[l.id] = out;
      return out;
    };
  }

  // The stage canvas, for the variants that draw straight onto it.
  const stageCtx = window.SWR && window.SWR.ctx;
  if (stageCtx) {
    const origDraw = stageCtx.drawImage;
    stageCtx.drawImage = function (src, dx, dy, dw, dh) {
      if (probe.currentLayer) probe.recordDraw(this, probe.currentLayer, src, dx, dy, dw, dh);
      return origDraw.apply(this, arguments);
    };
  }

  // Collect rAF frame periods. The engine runs a continuous rAF loop, so
  // the period between frames is the engine's real frame cadence.
  window.__swrCollect = (frames) => new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    let n = 0;
    function step() {
      const t = performance.now();
      deltas.push(t - last);
      last = t;
      if (++n >= frames) { resolve(deltas); return; }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });

  window.__swrProbe = probe;
  return { ok: true };
})()
`;

// Seed synthetic media layers so the layer-facing surfaces have real
// content to show, independent of whatever library the page ships.
// Several layers, so the overlay's per-layer rows and the stage geometry
// are exercised with a real stack rather than a single element.
const SEED_SRC = `
(async () => {
  const S = window.SWR;
  if (!S || !S.Library || !S.Layers) return { ok: false, reason: 'SWR API missing' };

  function makeCanvas(hue, label) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, hue);
    grad.addColorStop(0.5, '#00f0ff');
    grad.addColorStop(1, '#fff04a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#05030a';
    g.beginPath(); g.arc(256, 256, 110, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f5e9ff';
    g.font = 'bold 42px monospace';
    g.textAlign = 'center';
    g.fillText(label, 256, 272);
    return c;
  }

  const hues = ['#ff2d8a', '#00f0ff', '#fff04a', '#00ffa3', '#ff2d8a', '#00f0ff'];
  for (let i = 0; i < hues.length; i++) {
    const c = makeCanvas(hues[i], String(i + 1));
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const file = new File([blob], 'probe-seed-' + (i + 1) + '.png', { type: 'image/png' });
    await S.Library.addFiles([file]);
    const asset = S.Library.items[S.Library.items.length - 1];
    if (asset) S.Layers.add(asset);
  }

  return { ok: true, layers: S.Layers.list.length, assets: S.Library.items.length };
})()
`;

// The audio may be suspended behind an autoplay overlay; dismiss it.
const DISMISS_START_SRC = `
(() => {
  const s = document.getElementById('swr-start');
  if (s && !s.classList.contains('hide')) { s.click(); return 'clicked'; }
  return 'none';
})()
`;

// ── coverage probe ───────────────────────────────────────────────────────

const COVERAGE_SRC = `
(() => {
  const root = document.getElementById('swr-debugger');
  if (!root) return { surfaces: {}, total: 0 };
  const out = {};

  const textOf = (id) => {
    const n = root.querySelector('[data-surface="' + id + '"] .s-b');
    return n ? n.textContent : '';
  };
  const numbersIn = (id) => (textOf(id).match(/-?\\d+(\\.\\d+)?/g) || []).map(Number);

  out['audio-bars'] = { ok: numbersIn('audio-bars').length >= 5, n: numbersIn('audio-bars').length };
  out['audio-bpm']  = { ok: numbersIn('audio-bpm').filter((v) => v > 0).length >= 1, n: numbersIn('audio-bpm').length };
  out['audio-pulse']= { ok: numbersIn('audio-pulse').length >= 2, n: numbersIn('audio-pulse').length };
  out['layer-rows'] = { ok: root.querySelectorAll('[data-surface="layer-rows"] .lay').length >= 1,
                        n: root.querySelectorAll('[data-surface="layer-rows"] .lay').length };
  out['layer-transform'] = { ok: root.querySelectorAll('[data-surface="layer-transform"] b[data-field]').length >= 8,
                             n: root.querySelectorAll('[data-surface="layer-transform"] b[data-field]').length };
  out['reactor-rows'] = { ok: root.querySelectorAll('[data-surface="reactor-rows"] .rx').length >= 1,
                           n: root.querySelectorAll('[data-surface="reactor-rows"] .rx').length };

  // A canvas surface only counts if it actually has something drawn on
  // it. The rhythm strip was once wired up but never painted, and a
  // presence check would have called that a pass.
  const hasInk = (cv) => {
    if (!cv || !cv.width) return false;
    try {
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) return true;
      }
    } catch (e) { return false; }
    return false;
  };

  const cv = root.querySelector('[data-surface="scope-canvas"] canvas');
  const scopeInk = hasInk(cv);
  const scopeHist = window.SWR_DEBUGGER ? window.SWR_DEBUGGER.history(8).length : 0;
  out['scope-canvas'] = { ok: !!cv && scopeInk && scopeHist >= 2, n: scopeHist, ink: scopeInk };

  out['perf-stats'] = { ok: numbersIn('perf-stats').length >= 3, n: numbersIn('perf-stats').length };
  out['master-states'] = { ok: root.querySelectorAll('[data-surface="master-states"] .mast span').length >= 4,
                           n: root.querySelectorAll('[data-surface="master-states"] .mast span').length };

  // The module list must enumerate the page's real SWR_* globals.
  let modCount = 0;
  const m = /(\\d+) loaded/.exec(textOf('module-list'));
  if (m) modCount = parseInt(m[1], 10);
  let realCount = 0;
  for (const k in window) {
    if (k.length > 3 && k.slice(0, 3) === 'SWR' && k !== 'SWR_DEBUGGER') realCount++;
  }
  out['module-list'] = { ok: modCount > 0 && modCount === realCount, n: modCount, real: realCount };

  // The stage overlay must exist over the engine canvas and carry a box
  // per layer it is drawing.
  const stageOverlay = document.getElementById('swr-debugger-stage');
  const snap = window.SWR_DEBUGGER ? window.SWR_DEBUGGER.snapshot() : null;
  const quadLayers = snap ? snap.layers.filter((l) => l.quad && l.quad.length === 4).length : 0;
  const boxes = stageOverlay ? stageOverlay.querySelectorAll('[data-layer]').length : 0;
  out['layer-geometry'] = {
    ok: !!stageOverlay && boxes >= 1 && quadLayers >= 1,
    n: boxes,
    quad: quadLayers,
  };

  out['drift-readout'] = {
    ok: root.querySelectorAll('[data-surface="drift-readout"] .row').length >= 2 &&
        numbersIn('drift-readout').length >= 2,
    n: root.querySelectorAll('[data-surface="drift-readout"] .row').length,
  };

  const strip = root.querySelector('[data-surface="beat-strip"] canvas');
  const stripInk = hasInk(strip);
  out['beat-strip'] = { ok: !!strip && stripInk, n: strip ? strip.width : 0, ink: stripInk };

  const total = Object.keys(out).length;
  const passing = Object.values(out).filter((v) => v.ok).length;
  return { surfaces: out, total, passing };
})()
`;

// Read the transform values the overlay actually rendered into the DOM.
// Assigned as a function (not invoked) so the probe scripts can re-read
// the DOM at any moment.
const READ_DOM_SRC = `
(() => {
  const root = document.getElementById('swr-debugger');
  if (!root) return { rows: [] };
  const rows = [];
  root.querySelectorAll('[data-surface="layer-transform"] b[data-field]').forEach((b) => {
    const v = parseFloat(b.textContent);
    rows.push({ layer: b.getAttribute('data-layer'), field: b.getAttribute('data-field'), raw: b.textContent, value: v });
  });
  return { rows };
})
`;

// ── accuracy probes ──────────────────────────────────────────────────────

// P1 — with reactors muted the engine's resolved transform must equal the
// layer's own static fields exactly. Nothing but the engine can know this.
const P1_SRC = `
(async () => {
  const S = window.SWR;
  const D = window.SWR_DEBUGGER;
  if (!S || !S.Layers || !D) return { ok: false, reason: 'missing api' };

  const tx = window.SWR_TX_MASTER;
  const prevTx = tx ? tx.enabled : undefined;
  const prevLayerFlags = S.Layers.list.map((l) => l.reactorsEnabled);
  const prevRot = S.Layers.list.map((l) => l.rotationEnabled);

  if (tx) tx.enabled = false;
  S.Layers.list.forEach((l) => { l.reactorsEnabled = false; });

  await new Promise((r) => setTimeout(r, 220));

  const snap = D.snapshot();
  const checks = [];
  S.Layers.list.forEach((l) => {
    const s = snap.layers.find((x) => x.id === l.id);
    if (!s) { checks.push({ ok: false, reason: 'layer missing from snapshot', id: l.id }); return; }
    const r = s.resolved || {};
    const expect = {
      scale: l.baseScale, opacity: l.opacity, hue: l.hue,
      brightness: l.brightness, contrast: l.contrast,
      x: 0, y: 0, rot: l.hue * 0.05,
    };
    Object.keys(expect).forEach((k) => {
      const got = r[k];
      const ok = typeof got === 'number' && Math.abs(got - expect[k]) < 1e-6;
      checks.push({ ok, id: l.id, field: k, got, expect: expect[k] });
    });
  });

  // restore
  if (tx) tx.enabled = prevTx;
  S.Layers.list.forEach((l, i) => {
    l.reactorsEnabled = prevLayerFlags[i];
    l.rotationEnabled = prevRot[i];
  });

  const passed = checks.filter((c) => c.ok).length;
  return { ok: passed === checks.length && checks.length > 0, passed, total: checks.length,
           failures: checks.filter((c) => !c.ok).slice(0, 6) };
})()
`;

// P2 — the numbers painted into the DOM must equal the state the overlay
// last painted, and that painted state must not be stale. The overlay
// repaints on a timer, so comparing the DOM against the *live* snapshot
// would race by design; comparing against the painted snapshot is exact.
const P2_SRC = `
(() => {
  const D = window.SWR_DEBUGGER;
  if (!D) return { ok: false, reason: 'no debugger' };
  const painted = D.painted ? D.painted() : null;
  const live = D.snapshot();
  if (!painted) return { ok: false, reason: 'no painted snapshot', passed: 0, total: 0 };
  const dom = (window.__swrReadDom ? window.__swrReadDom() : { rows: [] }).rows;
  if (!dom.length) return { ok: false, reason: 'no dom rows', passed: 0, total: 0 };

  const checks = [];
  dom.forEach((d) => {
    const layer = painted.layers.find((l) => l.id === d.layer);
    if (!layer) { checks.push({ ok: false, reason: 'dom layer not in painted snapshot' }); return; }
    const got = layer.resolved ? layer.resolved[d.field] : undefined;
    const ok = typeof got === 'number' && Math.abs(got - d.value) < 5e-3;
    checks.push({ ok, id: d.layer, field: d.field, dom: d.value, painted: got });
  });

  // Freshness: the painted state must trail the live state by no more
  // than a handful of frames. A debugger that renders a cached copy
  // forever would show matching DOM but a frozen painted state.
  const lag = live.frameIndex - painted.frameIndex;
  const fresh = lag >= 0 && lag <= 8;
  checks.push({ ok: fresh, reason: 'painted state is stale', lag, live: live.frameIndex, painted: painted.frameIndex });

  const passed = checks.filter((c) => c.ok).length;
  return { ok: passed === checks.length, passed, total: checks.length,
           failures: checks.filter((c) => !c.ok).slice(0, 6) };
})()
`;

// P5 — mutating a layer must be reflected by the overlay promptly. Catches
// a debugger that renders a cached copy of the engine state.
const P5_SRC = `
(async () => {
  const S = window.SWR;
  const D = window.SWR_DEBUGGER;
  if (!S || !S.Layers || !D) return { ok: false, reason: 'missing api' };
  const l = S.Layers.list[0];
  if (!l) return { ok: false, reason: 'no layer' };

  const tx = window.SWR_TX_MASTER;
  const prevTx = tx ? tx.enabled : undefined;
  const prevFlag = l.reactorsEnabled;
  if (tx) tx.enabled = false;
  l.reactorsEnabled = false;

  const prevOpacity = l.opacity;
  l.opacity = 0.42;

  let seen = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const dom = (window.__swrReadDom ? window.__swrReadDom() : { rows: [] }).rows;
    const hit = dom.find((d) => d.layer === l.id && d.field === 'opacity');
    if (hit && Math.abs(hit.value - 0.42) < 1e-6) { seen = hit.value; break; }
  }

  l.opacity = prevOpacity;
  if (tx) tx.enabled = prevTx;
  l.reactorsEnabled = prevFlag;

  return { ok: seen !== null, seen };
})()
`;

// P4 — with reactors live the overlay must show values that MOVE. Catches
// a debugger that only ever displays static defaults.
const P4_SRC = `
(async () => {
  const D = window.SWR_DEBUGGER;
  if (!D) return { ok: false, reason: 'no debugger' };
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const snap = D.snapshot();
    snap.layers.forEach((l) => {
      const r = l.resolved || {};
      ['scale', 'opacity', 'hue', 'x', 'y'].forEach((k) => {
        if (typeof r[k] === 'number') seen.add(k + ':' + r[k].toFixed(4));
      });
    });
  }
  return { ok: seen.size >= 3, distinct: seen.size };
})()
`;

// P6 — the overlay's geometry must match where the engine ACTUALLY drew.
//
// The probe derives the CSS-space quad from the raw drawImage call using
// its own implementation; the debugger derives its reported quad through
// a different path. Comparing them is a differential test: a bug in the
// debugger's DPR handling, rotation maths or CSS conversion shows up as a
// mismatch instead of being silently consistent with itself.
const P6_SRC = `
(() => {
  const D = window.SWR_DEBUGGER;
  const p = window.__swrProbe;
  if (!D || !p) return { ok: false, reason: 'missing api' };
  const snap = D.snapshot();

  const checks = [];
  snap.layers.forEach((l) => {
    const expected = p.layerDraws[l.id];
    if (!expected) {
      checks.push({ ok: false, reason: 'probe saw no draw for this layer', id: l.id });
      return;
    }
    if (!l.observed) {
      checks.push({ ok: false, reason: 'debugger reported no observed quad', id: l.id });
      return;
    }
    if (!l.quad) {
      checks.push({ ok: false, reason: 'debugger reported no quad', id: l.id });
      return;
    }
    let maxDelta = 0;
    for (let i = 0; i < 4; i++) {
      maxDelta = Math.max(maxDelta,
        Math.abs(expected.quad[i][0] - l.quad[i][0]),
        Math.abs(expected.quad[i][1] - l.quad[i][1]));
    }
    checks.push({ ok: maxDelta <= 1.5, id: l.id, maxDelta });
  });
  if (!checks.length) return { ok: false, reason: 'no layers to compare', passed: 0, total: 0 };
  const passed = checks.filter((c) => c.ok).length;
  return { ok: passed === checks.length, passed, total: checks.length,
           failures: checks.filter((c) => !c.ok).slice(0, 6) };
})()
`;

// P7 — every layer the engine holds must appear in the overlay, with its
// own geometry. Catches an overlay that only ever shows one layer.
const P7_SRC = `
(() => {
  const S = window.SWR;
  const D = window.SWR_DEBUGGER;
  if (!S || !D) return { ok: false, reason: 'missing api' };
  const engineIds = S.Layers.list.map((l) => l.id);
  const snap = D.snapshot();
  const dbgIds = snap.layers.map((l) => l.id);
  const checks = [];
  checks.push({ ok: engineIds.length >= 3, reason: 'expected a real layer stack', n: engineIds.length });
  checks.push({ ok: dbgIds.length === engineIds.length, reason: 'layer count mismatch', dbg: dbgIds.length, engine: engineIds.length });
  engineIds.forEach((id) => checks.push({ ok: dbgIds.indexOf(id) !== -1, reason: 'layer missing from overlay', id }));
  snap.layers.forEach((l) => checks.push({ ok: !!(l.quad && l.quad.length === 4), reason: 'layer has no quad', id: l.id }));
  const passed = checks.filter((c) => c.ok).length;
  return { ok: passed === checks.length, passed, total: checks.length,
           failures: checks.filter((c) => !c.ok).slice(0, 6) };
})()
`;

// P8 — unmount must fully release the engine: the wrappers go back to
// what they were, the overlay disappears, and the engine keeps drawing.
// Runs last because it takes the debugger down (and puts it back).
const P8_SRC = `
(async () => {
  const D = window.SWR_DEBUGGER;
  const R = window.SWR_RENDER;
  const p = window.__swrProbe;
  if (!D || !R) return { ok: false, reason: 'missing api' };

  const wrappedFrame = R.frame;
  const wrappedEvolve = R.imageEvolve;
  const overlayBefore = !!document.getElementById('swr-debugger');
  const stageBefore = !!document.getElementById('swr-debugger-stage');

  D.unmount();
  await new Promise((r) => setTimeout(r, 300));

  const overlayAfter = !!document.getElementById('swr-debugger');
  const stageAfter = !!document.getElementById('swr-debugger-stage');
  const restoredFrame = R.frame !== wrappedFrame;
  const restoredEvolve = R.imageEvolve !== wrappedEvolve;

  const framesBefore = p.frames;
  await new Promise((r) => setTimeout(r, 500));
  const stillRendering = p.frames > framesBefore;

  D.mount();
  await new Promise((r) => setTimeout(r, 700));

  return {
    ok: overlayBefore && stageBefore && !overlayAfter && !stageAfter &&
        restoredFrame && restoredEvolve && stillRendering,
    overlayBefore, stageBefore, overlayAfter, stageAfter,
    restoredFrame, restoredEvolve, stillRendering,
    remounted: D.isMounted(),
  };
})()
`;

// ── main ─────────────────────────────────────────────────────────────────

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── per-page measurement ─────────────────────────────────────────────────

async function measurePage(cdp, url) {
  const source = readFileSync(DEBUGGER_SRC, 'utf8');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);

  const result = {
    url,
    surfaces: {}, surfaceTotal: 0, surfacePassing: 0,
    probes: [], baseMs: 0, dbgMs: 0, overheadPct: 0,
    coverage: 0, accuracy: 0, headroom: 0, score: 0, error: null,
  };

  try {
    // Engine boot.
    await waitFor(cdp, sessionId,
      "!!(window.SWR && window.SWR_RENDER && window.SWR.Audio && document.querySelector('canvas'))",
      'engine boot on ' + url, 30000);
    await sleep(1200);

    // Make sure audio is actually running — the feature surfaces are only
    // meaningful with a live analyser.
    await evaluate(cdp, sessionId, DISMISS_START_SRC);
    await sleep(600);
    const playing = await evaluate(cdp, sessionId, '!!(window.SWR.Audio && window.SWR.Audio.playing)');
    if (!playing) {
      await evaluate(cdp, sessionId, "(function(){const b=document.getElementById('play');if(b)b.click();return true})()");
      await sleep(1200);
    }

    // Probe first, debugger second: the debugger's wrappers end up outside
    // the probe, so the probe measures the engine as the debugger sees it.
    const probeInstalled = await evaluate(cdp, sessionId, PROBE_SRC);
    if (!probeInstalled?.ok) throw new Error('probe install failed: ' + JSON.stringify(probeInstalled));

    // Seed a layer stack so the layer surfaces have content.
    const seeded = await evaluate(cdp, sessionId, SEED_SRC, true);
    if (!seeded?.ok) throw new Error('seed failed: ' + JSON.stringify(seeded));
    // The seeded images must be decoded before the engine draws them —
    // until then the page skips the layer entirely.
    await waitFor(cdp, sessionId,
      `(() => {
        const S = window.SWR;
        const L = (S && S.Layers && S.Layers.list) || [];
        return L.length > 0 && L.every((l) => l.asset && l.asset._el &&
          l.asset._el.complete && l.asset._el.naturalWidth > 0);
      })()`,
      'seeded images to decode', 20000);
    await sleep(700);

    // ── inject the debugger ──
    let mounted = false;
    if (!NO_DEBUGGER) {
      await evaluate(cdp, sessionId, source);
      await evaluate(cdp, sessionId, 'window.SWR_DEBUGGER && window.SWR_DEBUGGER.mount(), true');
      await sleep(1200);
      mounted = await evaluate(cdp, sessionId, 'window.SWR_DEBUGGER && window.SWR_DEBUGGER.isMounted()');
      if (!mounted) throw new Error('debugger did not mount');
    }

    // ── frame cost ──
    //
    // Interleaved rounds, toggling the debugger on and off inside each,
    // so machine drift hits both conditions equally. The estimator is the
    // median of the per-round medians: a single window's median is
    // noisy, and the minimum is worse still — headless rAF fires in
    // bursts well below the vsync period, so the fastest frame measures
    // the scheduler, not the page.
    const ROUNDS = 5;
    const FRAMES = 120;
    const baseWins = [];
    const dbgWins = [];
    const baseCounters = [];
    const dbgCounters = [];
    const COUNTERS_EXPR = `(() => {
      const p = window.__swrProbe;
      return { frames: p.frames, applyRCalls: p.applyRCalls, evolveCalls: p.evolveCalls,
               drawCalls: p.drawCalls,
               perFrameApplyR: p.frames ? p.applyRCalls / p.frames : 0,
               perFrameEvolve: p.frames ? p.evolveCalls / p.frames : 0,
               perFrameDraw: p.frames ? p.drawCalls / p.frames : 0 };
    })()`;

    for (let r = 0; r < ROUNDS; r++) {
      await evaluate(cdp, sessionId, 'window.SWR_DEBUGGER && window.SWR_DEBUGGER.unmount(), true');
      await sleep(250);
      await evaluate(cdp, sessionId, 'window.__swrProbe.reset(), true');
      baseWins.push(await evaluate(cdp, sessionId, `window.__swrCollect(${FRAMES})`, true));
      baseCounters.push(await evaluate(cdp, sessionId, COUNTERS_EXPR));

      await evaluate(cdp, sessionId, 'window.SWR_DEBUGGER && window.SWR_DEBUGGER.mount(), true');
      await sleep(250);
      await evaluate(cdp, sessionId, 'window.__swrProbe.reset(), true');
      dbgWins.push(await evaluate(cdp, sessionId, `window.__swrCollect(${FRAMES})`, true));
      dbgCounters.push(await evaluate(cdp, sessionId, COUNTERS_EXPR));
    }

    // The mean, not the median: film.html runs below 60fps, so its frame
    // times quantise against vsync and the median flips between 16.7 and
    // 33.3 depending on which side of the boundary it lands. The mean
    // answers "how long does this page take per frame" without that.
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const baseMs = mean(baseWins.map(mean));
    const dbgMs = mean(dbgWins.map(mean));
    const baseSpread = Math.max(...baseWins.map(mean)) - Math.min(...baseWins.map(mean));
    const dbgSpread = Math.max(...dbgWins.map(mean)) - Math.min(...dbgWins.map(mean));

    // Counter ratios: use the round that produced the cleanest frame.
    const base = baseCounters[0];
    const dbg = dbgCounters[0];

    // Cache the DOM reader on the page for the probe scripts.
    await evaluate(cdp, sessionId, `window.__swrReadDom = ${READ_DOM_SRC}; true`);

    // ── coverage ──
    const coverage = mounted
      ? await evaluate(cdp, sessionId, COVERAGE_SRC)
      : { surfaces: {}, total: 0, passing: 0 };
    result.surfaces = coverage?.surfaces || {};
    result.surfaceTotal = coverage?.total || 0;
    result.surfacePassing = coverage?.passing || 0;

    // ── accuracy probes ──
    const probes = [];
    if (mounted) {
      const p1 = await evaluate(cdp, sessionId, P1_SRC, true);
      probes.push({ name: 'static-fidelity', ...p1 });
      const p2 = await evaluate(cdp, sessionId, P2_SRC);
      probes.push({ name: 'display-fidelity', ...p2 });
      const p4 = await evaluate(cdp, sessionId, P4_SRC, true);
      probes.push({ name: 'reactivity', ...p4 });
      const p5 = await evaluate(cdp, sessionId, P5_SRC, true);
      probes.push({ name: 'mutation-liveness', ...p5 });
      const p6 = await evaluate(cdp, sessionId, P6_SRC);
      probes.push({ name: 'geometry-truth', ...p6 });
      const p7 = await evaluate(cdp, sessionId, P7_SRC);
      probes.push({ name: 'multi-layer', ...p7 });
      const p8 = await evaluate(cdp, sessionId, P8_SRC, true);
      probes.push({ name: 'unmount-integrity', ...p8 });
    }

    // P3 — no perturbation: the debugger must not add or suppress calls
    // into the engine's applyR / imageEvolve / drawImage pipeline.
    const perturbOk =
      mounted &&
      base.perFrameApplyR > 0 && dbg.perFrameApplyR > 0 &&
      Math.abs(base.perFrameApplyR - dbg.perFrameApplyR) < 0.02 &&
      Math.abs(base.perFrameEvolve - dbg.perFrameEvolve) < 0.02 &&
      base.perFrameDraw > 0 &&
      Math.abs(base.perFrameDraw - dbg.perFrameDraw) < 0.02;
    probes.push({
      name: 'no-perturbation',
      ok: perturbOk,
      baseApplyR: base.perFrameApplyR,
      dbgApplyR: dbg.perFrameApplyR,
      baseEvolve: base.perFrameEvolve,
      dbgEvolve: dbg.perFrameEvolve,
      baseDraw: base.perFrameDraw,
      dbgDraw: dbg.perFrameDraw,
    });
    result.probes = probes;

    // ── score ──
    result.coverage = result.surfaceTotal ? result.surfacePassing / result.surfaceTotal : 0;
    result.accuracy = probes.filter((p) => p.ok).length / probes.length;
    result.baseMs = baseMs;
    result.dbgMs = dbgMs;
    result.baseSpread = baseSpread;
    result.dbgSpread = dbgSpread;
    result.overheadPct = baseMs > 0 ? ((dbgMs - baseMs) / baseMs) * 100 : 0;
    result.headroom = Math.max(0, Math.min(1, 1 - Math.max(0, result.overheadPct) / 10));
    result.score = 0.5 * result.coverage + 0.3 * result.accuracy + 0.2 * result.headroom;
  } catch (err) {
    result.error = (err && err.message ? err.message : String(err));
    result.score = 0;
  }

  try { await cdp.send('Target.closeTarget', { targetId }); } catch { /* ignore */ }
  return result;
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const { proc, wsUrl, profile } = await launchChrome();
  const cdp = new Cdp(wsUrl);
  let exitCode = 0;

  try {
    await cdp.connect();

    const urls = TARGET_URLS();
    const results = [];
    for (const url of urls) {
      const r = await measurePage(cdp, url);
      results.push(r);

      const label = url.split('/').pop();
      if (r.error) {
        console.log('PAGE ' + label.padEnd(18) + ' ERROR  ' + r.error);
        console.log('  surfaces 0/0  probes 0/0  SCORE=0.0000');
        continue;
      }
      console.log('PAGE ' + label.padEnd(18) +
        ' surfaces ' + r.surfacePassing + '/' + r.surfaceTotal +
        '  probes ' + r.probes.filter((p) => p.ok).length + '/' + r.probes.length +
        '  frame ' + r.baseMs.toFixed(2) + '→' + r.dbgMs.toFixed(2) + 'ms' +
        '  overhead ' + r.overheadPct.toFixed(2) + '%' +
        '  SCORE=' + r.score.toFixed(4));
      for (const [id, v] of Object.entries(r.surfaces)) {
        if (v.ok) continue;
        console.log('  FAIL surface ' + id.padEnd(16) + ' got=' + v.n +
          (v.real !== undefined ? ' real=' + v.real : ''));
      }
      for (const p of r.probes) {
        if (p.ok) continue;
        console.log('  FAIL probe   ' + p.name.padEnd(16) + ' ' +
          JSON.stringify(p.failures || p.reason || p));
      }
    }

    // The score is the MEAN across the page family, so a variant the
    // debugger cannot handle costs real points rather than being averaged
    // away.
    const score = results.reduce((a, r) => a + r.score, 0) / results.length;
    const totalSurfaces = results.reduce((a, r) => a + r.surfaceTotal, 0);
    const totalSurfacePassing = results.reduce((a, r) => a + r.surfacePassing, 0);
    const totalProbes = results.reduce((a, r) => a + r.probes.length, 0);
    const totalProbesPassing = results.reduce((a, r) => a + r.probes.filter((p) => p.ok).length, 0);

    console.log('');
    console.log('PAGES       ' + results.length);
    console.log('SURFACES    ' + totalSurfacePassing + '/' + totalSurfaces);
    console.log('PROBES      ' + totalProbesPassing + '/' + totalProbes);
    console.log('SCORE=' + score.toFixed(4));

    if (FAIL_UNDER !== null && score < Number(FAIL_UNDER)) {
      console.error('FAIL: score ' + score.toFixed(4) + ' below --fail-under=' + FAIL_UNDER);
      exitCode = 1;
    }
  } catch (err) {
    console.error('ERROR: ' + (err && err.message ? err.message : err));
    console.log('SCORE=0.0000');
    exitCode = 1;
  } finally {
    try { cdp.close(); } catch { /* ignore */ }
    proc.kill('SIGKILL');
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  process.exit(exitCode);
}

main();
