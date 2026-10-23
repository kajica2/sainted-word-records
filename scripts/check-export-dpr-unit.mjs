#!/usr/bin/env node
// scripts/check-export-dpr-unit.mjs  -  P2.8 unit test for the DPR=1 wrap
// in client/capture-runtime.client.js.
//
// The bug the audit flagged:
//   The 1080p / frame-export path allocated 4× the pixels it needed
//   because the engine renders onto a devicePixelRatio-sized backing
//   buffer (typical 2 on Retina). The Recorder in engine.html already
//   wraps its own start() / stop() with `Renderer.dpr = 1` and restores
//   `Renderer.dpr = prevDpr` after the recording. capture-runtime's
//   periodic toBlob() was the unfixed sibling  -  every PNG capture exported
//   at the user's dpr.
//
// What we assert:
//   1. captureNow() sets Renderer.dpr = 1 inside the synchronous prefix
//      (so the NEXT engine render, which fires before toBlob's callback,
//      paints at 1×), and the assertion is observable to a spy when the
//      toBlob callback itself observes it.
//   2. After the toBlob callback runs, Renderer.dpr is restored to the
//      original value (the test starts it at 2 and ends at 2).
//   3. The wrap is BYPASSED when window.Renderer is undefined  -  the
//      audit specifies the wrap as opt-in via the engine, so non-engine
//      pages keep their existing capture behaviour.
//   4. If canvas.toBlob throws synchronously, the wrap still restores
//      dpr (the catch branch calls restoreDpr() explicitly, the test
//      reaches that path).
//   5. The public API surface (enable / disable / setIntervalSec) is
//      unchanged  -  none of them touch Renderer.dpr. Only captureNow()
//      flips it.
//
// Uses the same node:vm sandbox pattern as check-capture-unit.mjs; the
// canvas.toBlob stub here fires the callback synchronously, so the
// observable window during the callback is precisely the wrap's interior.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'client/capture-runtime.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) {
    console.log('  ✓', msg, detail ? `(${detail})` : '');
  } else {
    console.log('  ✗', msg, detail ? `(${detail})` : '');
    failures += 1;
  }
}

// ---------------------------------------------------------------------
// Browser shims
// ---------------------------------------------------------------------

function makeCanvasMock(opts = {}) {
  return {
    width: 800,
    height: 600,
    toBlob(cb, type) {
      if (opts.throwSync) throw new Error('synthetic toBlob failure');
      if (opts.async) {
        // Capture the dpr at the moment the callback fires (after a microtask),
        // not the moment toBlob was called. The restoreDpr() in the wrap runs
        // INSIDE the callback, so dpr at callback-fire === 1.
        Promise.resolve().then(() => cb({ size: 12345, type: type || 'image/png' }));
        return;
      }
      cb({ size: 12345, type: type || 'image/png' });
    },
  };
}

function makeStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

class MockElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.style = {};
    this.classList = {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        const has = this._set.has(c);
        const next = force === undefined ? !has : !!force;
        if (next) this._set.add(c); else this._set.delete(c);
        return next;
      },
    };
    this.eventListeners = {};
    this._clicked = 0;
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.value = '';
    this.min = '';
    this.max = '';
    this.step = '';
  }
  appendChild(child) {
    if (child) {
      this.children.push(child);
      child.parentNode = this;
    }
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    if (child) child.parentNode = null;
    return child;
  }
  addEventListener() {}
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  querySelector() { return null; }
  click() { this._clicked += 1; }
}

function buildContext(opts = {}) {
  const {
    search = '',
    storage,
    canvas = null,
    body = null,
    readyState = 'complete',
    renderer = null,
  } = opts;
  const ls = storage || makeStorage();
  const dprDuringCallback = []; // observed by section 4
  const timerQueue = [];
  let timerId = 0;

  const win = {};
  const doc = {
    readyState,
    addEventListener: () => {},
    documentElement: { style: { setProperty() {}, removeProperty() {}, cssText: '' } },
    head: { appendChild() {} },
    getElementsByTagName: () => [],
  };
  doc.body = body || new MockElement('body');

  doc.createElement = (tag) => {
    if (tag === 'canvas') return makeCanvasMock();
    const el = new MockElement(tag);
    if (tag === 'input') el.type = 'number';
    return el;
  };
  doc.getElementById = (id) => {
    if (id === 'stage') return canvas;
    if (id === 'swr-capture-toolbar') {
      return doc.body.children.find((c) => c.id === 'swr-capture-toolbar') || null;
    }
    return null;
  };

  const sandbox = {
    window: win,
    document: doc,
    localStorage: ls,
    URL: {
      createObjectURL: () => 'blob:mock-export-dpr',
      revokeObjectURL: () => {},
    },
    Blob: function (parts) { return { size: parts.join('').length }; },
    console: { warn: () => {}, log: () => {}, error: () => {} },
    setTimeout: (cb, delay) => {
      const id = ++timerId;
      timerQueue.push({ id, cb, delay });
      return id;
    },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    Date,
    Math,
    JSON,
    Number,
    String,
    Object,
    Array,
    URLSearchParams,
  };

  // If the test installs a Renderer mock, attach it. The captureRuntime
  // reads window.Renderer.dpr  -  assign it here before the IIFE runs so the
  // module picks it up on first captureNow().
  if (renderer) {
    win.Renderer = renderer;
    // Spy: capture the dpr value at the moment a no-op callback inside the
    // toBlob closure runs (this is the wrap's interior). Test reads via the
    // `dprObservedBySpy` global if needed.
    win.__captureDpr = function () {
      dprDuringCallback.push(renderer.dpr);
    };
  }

  win.window = win;
  win.document = doc;
  win.localStorage = ls;
  win.URL = sandbox.URL;
  win.console = sandbox.console;
  win.location = { search };
  win.addEventListener = doc.addEventListener;
  win.setTimeout = sandbox.setTimeout;
  win.setInterval = sandbox.setInterval;

  vm.createContext(sandbox);
  return {
    sandbox, ls, win, doc, canvas, renderer,
    dprDuringCallback, timerQueue,
  };
}

function loadCaptureRuntime(ctx) {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  vm.runInContext(src, ctx.sandbox);
  return ctx.win.SWR_CAPTURE;
}

// ---------------------------------------------------------------------
// Test sections
// ---------------------------------------------------------------------

function section1() {
  console.log('\n=== 1. captureNow() sets Renderer.dpr=1 and restores it (sync toBlob) ===');
  const renderer = { dpr: 2 };
  const canvas = makeCanvasMock();
  const ctx = buildContext({ canvas, renderer });
  loadCaptureRuntime(ctx);

  assert(renderer.dpr === 2, 'Renderer starts at dpr=2', `got ${renderer.dpr}`);
  const ok = ctx.win.SWR_CAPTURE.captureNow();
  assert(ok === true, 'captureNow() returned true');

  // To observe the dpr INSIDE the wrap, we patch the toBlob to record the
  // Renderer.dpr it sees. Since our stub is the mock's toBlob, and the mock
  // already fires the callback synchronously, the wrap runs restoreDpr()
  // before toBlob's callback returns. Re-instrument: install a fresh toBlob
  // that records dpr at call-time (before the callback) and reports.
  const observedAtCallTime = [];
  const observedAfterCallback = [];
  canvas.toBlob = function (cb) {
    // Wrap's prefix already called _dprSwap (synchronously), so this is the
    // state inside the wrap at the exact call-time of toBlob.
    observedAtCallTime.push(renderer.dpr);
    // Fire callback synchronously. Inside the callback, wrap's `finally`
    // runs restoreDpr(). Capture dpr immediately, then again after restore.
    cb({ size: 99, type: 'image/png' });
    observedAfterCallback.push(renderer.dpr);
  };
  ctx.win.SWR_CAPTURE.captureNow();

  assert(
    observedAtCallTime[0] === 1,
    'Renderer.dpr === 1 inside the wrap (at toBlob call-time)',
    `got ${observedAtCallTime[0]}`
  );
  assert(
    observedAfterCallback[0] === 2,
    'Renderer.dpr restored to 2 after the toBlob callback runs',
    `got ${observedAfterCallback[0]}`
  );
  assert(renderer.dpr === 2, 'Final dpr === 2 (no leak)');
}

function section2() {
  console.log('\n=== 2. captureNow() restore works for non-default prev dpr (e.g. 3) ===');
  const renderer = { dpr: 3 };
  const canvas = makeCanvasMock();
  const ctx = buildContext({ canvas, renderer });
  loadCaptureRuntime(ctx);
  const observed = [];
  canvas.toBlob = function (cb) {
    observed.push({ phase: 'before-cb', dpr: renderer.dpr });
    cb({ size: 99, type: 'image/png' });
    observed.push({ phase: 'after-cb', dpr: renderer.dpr });
  };
  ctx.win.SWR_CAPTURE.captureNow();
  assert(observed[0].dpr === 1, 'Inside wrap: dpr === 1');
  assert(observed[1].dpr === 3, 'After restore: dpr === 3');
}

function section3() {
  console.log('\n=== 3. Window without window.Renderer: wrap is a no-op ===');
  const canvas = makeCanvasMock();
  const ctx = buildContext({ canvas, renderer: null });
  loadCaptureRuntime(ctx);
  // If Renderer is missing, captureNow() must still work.
  const ok = ctx.win.SWR_CAPTURE.captureNow();
  assert(ok === true, 'captureNow() returned true without Renderer');
  // No dpr leaks because no dpr was set.
  assert(ctx.win.Renderer === undefined, 'Renderer remains undefined');
}

function section4() {
  console.log('\n=== 4. Sync toBlob failure path still restores dpr ===');
  const renderer = { dpr: 2 };
  const canvas = makeCanvasMock({ throwSync: true });
  const ctx = buildContext({ canvas, renderer });
  loadCaptureRuntime(ctx);
  assert(renderer.dpr === 2, 'dpr starts at 2');
  const ok = ctx.win.SWR_CAPTURE.captureNow();
  assert(ok === false, 'captureNow() returns false when toBlob throws');
  assert(renderer.dpr === 2, 'dpr restored to 2 even after sync throw (catch branch)');
}

async function section5() {
  console.log('\n=== 5. Async toBlob: dpr=1 at callback-fire time, restored in finally ===');
  const renderer = { dpr: 2 };
  const canvas = makeCanvasMock({ async: true });
  const ctx = buildContext({ canvas, renderer });
  loadCaptureRuntime(ctx);
  // captureNow schedules the toBlob; the canvas stub fires the callback
  // on a microtask. We flush it before asserting.
  assert(renderer.dpr === 2, 'dpr starts at 2');
  ctx.win.SWR_CAPTURE.captureNow();
  // At this exact moment, the toBlob call has happened but the callback
  // hasn't fired yet. The wrap set Renderer.dpr = 1 synchronously. With the
  // async stub, restoreDpr runs only when the callback fires.
  assert(renderer.dpr === 1, 'dpr === 1 between toBlob call and callback fire');
  // Flush the microtask queue.
  await Promise.resolve();
  // The callback ran; finally ran; dpr is restored.
  assert(renderer.dpr === 2, 'dpr === 2 after async callback fires');
}

function section6() {
  console.log('\n=== 6. Public API does NOT touch Renderer.dpr (only captureNow does) ===');
  const renderer = { dpr: 2 };
  const ctx = buildContext({ renderer });
  loadCaptureRuntime(ctx);
  const before = renderer.dpr;
  ctx.win.SWR_CAPTURE.enable();
  assert(renderer.dpr === before, 'enable() leaves Renderer.dpr untouched');
  ctx.win.SWR_CAPTURE.disable();
  assert(renderer.dpr === before, 'disable() leaves Renderer.dpr untouched');
  ctx.win.SWR_CAPTURE.setIntervalSec(60);
  assert(renderer.dpr === before, 'setIntervalSec(60) leaves Renderer.dpr untouched');
  ctx.win.SWR_CAPTURE.reset();
  assert(renderer.dpr === before, 'reset() leaves Renderer.dpr untouched');
}

function section7() {
  console.log('\n=== 7. Multiple consecutive captures all restore cleanly ===');
  const renderer = { dpr: 2 };
  const canvas = makeCanvasMock();
  const ctx = buildContext({ canvas, renderer });
  loadCaptureRuntime(ctx);
  for (let i = 0; i < 5; i += 1) {
    const observed = [];
    canvas.toBlob = function (cb) {
      observed.push(renderer.dpr);
      cb({ size: 1, type: 'image/png' });
      observed.push(renderer.dpr);
    };
    ctx.win.SWR_CAPTURE.captureNow();
    assert(
      observed[0] === 1 && observed[1] === 2,
      `Capture #${i + 1}: dpr 2 → 1 → 2`,
      `got [${observed.join(', ')}]`
    );
  }
}

async function main() {
  section1();
  section2();
  section3();
  section4();
  await section5();
  section6();
  section7();

  console.log('\n' + (failures === 0
    ? 'EXPORT DPR: all assertions passed'
    : `EXPORT DPR: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
