#!/usr/bin/env node
// scripts/check-capture-unit.mjs — pure-logic unit tests for
// client/capture-runtime.client.js. Covers:
//   1. loadConfig() URL opt-in: happy path + invalid forms + edge boundaries
//   2. loadConfig() localStorage fallback
//   3. localStorage round-trip (enable/disable/setIntervalSec)
//   4. _clampInterval() boundaries via setIntervalSec()
//   5. State machine (enable/disable/setIntervalSec/reset)
//   6. captureNow() trigger (canvas.toBlob → <a download> click → revoke)
//
// Uses the node:vm trick from check-variant-switcher-unit.mjs: load the
// module source in a sandbox with browser shims, then drive the public
// API. Captures setTimeout invocations so we can manually flush the
// 1000ms revoke delay without sleeping.

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

// ---------------------------------------------------------------------------
// Browser shims
// ---------------------------------------------------------------------------

// Tiny DOM-ish element. Tracks parentNode via appendChild/removeChild so
// the runtime's revoke cleanup (a.parentNode.removeChild(a)) works.
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
    this._disabled = false;
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
  addEventListener(evt, cb) {
    (this.eventListeners[evt] = this.eventListeners[evt] || []).push(cb);
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  querySelector(sel) {
    if (sel === 'button') {
      return this.children.find((c) => c.tagName === 'BUTTON') || null;
    }
    if (sel === 'input[type="number"]') {
      return this.children.find(
        (c) => c.tagName === 'INPUT' && c.type === 'number'
      ) || null;
    }
    if (sel === '.swr-capture-status') {
      return this.children.find((c) => c.className === 'swr-capture-status') || null;
    }
    return null;
  }
  click() { this._clicked += 1; }
}

// Mock canvas with a synchronous toBlob.
function makeCanvasMock() {
  return {
    width: 800,
    height: 600,
    toBlob(cb, type) {
      cb({ size: 12345, type: type || 'image/png' });
    },
  };
}

// In-memory localStorage.
function makeStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
    _dump() { return Object.fromEntries(m); },
  };
}

// Builds a fresh sandbox wired up with browser shims. Returns handles the
// tests use to drive the runtime (storage, captured URLs, scheduled timers).
function buildContext(opts = {}) {
  const {
    search = '',
    storage,
    canvas = null,
    body = null,
    readyState = 'complete',
  } = opts;
  const ls = storage || makeStorage();
  const createdUrls = [];
  const revokedUrls = [];
  const setTimeoutCalls = [];
  let timerId = 0;
  let intervalId = 0;

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
      createObjectURL: (blob) => {
        const u = 'blob:mock-' + blob.size + '-' + createdUrls.length;
        createdUrls.push({ url: u, blob });
        return u;
      },
      revokeObjectURL: (u) => { revokedUrls.push(u); },
    },
    Blob: function (parts, init) {
      return { size: parts.join('').length, type: (init && init.type) || '' };
    },
    HTMLCanvasElement: function () {},
    console: { warn: () => {}, log: () => {}, error: () => {} },
    setTimeout: (cb, delay) => {
      const id = ++timerId;
      setTimeoutCalls.push({ id, cb, delay });
      return id;
    },
    clearTimeout: () => {},
    setInterval: (cb, delay) => {
      // We don't actually fire timers in unit tests — just record the call
      // so callers can inspect them. The state-machine tests assert
      // indirectly (isEnabled stays true after setIntervalSec restarts).
      intervalId += 1;
      return intervalId;
    },
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
    sandbox, ls, win, doc, canvas,
    createdUrls, revokedUrls, setTimeoutCalls,
  };
}

function loadCaptureRuntime(ctx) {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  vm.runInContext(src, ctx.sandbox);
  return ctx.win.SWR_CAPTURE;
}

// Flush the most recent setTimeout(cb, 1000) scheduled by captureNow so we
// can verify URL.revokeObjectURL() was called with the right URL.
function flushRevoke(ctx) {
  const entry = ctx.setTimeoutCalls.find((c) => c.delay === 1000);
  if (!entry) throw new Error('no setTimeout(1000) recorded');
  entry.cb();
}

// ---------------------------------------------------------------------------
// Test sections
// ---------------------------------------------------------------------------

function section1() {
  console.log('\n=== 1. loadConfig() URL opt-in happy path (?capture=15) ===');
  const ctx = buildContext({ search: '?capture=15' });
  loadCaptureRuntime(ctx);
  ctx.win.SWR_CAPTURE.loadConfig();
  assert(ctx.win.SWR_CAPTURE.isEnabled() === true, 'isEnabled() === true after URL opt-in');
  assert(ctx.win.SWR_CAPTURE.getIntervalSec() === 15, 'getIntervalSec() === 15');
  assert(
    ctx.ls.getItem('swr.capture.enabled') === '1',
    "localStorage 'swr.capture.enabled' === '1'"
  );
  assert(
    ctx.ls.getItem('swr.capture.intervalSec') === '15',
    "localStorage 'swr.capture.intervalSec' === '15'"
  );
}

function section2() {
  console.log('\n=== 2. loadConfig() URL opt-in invalid forms (must NOT auto-enable) ===');
  const invalid = [
    { search: '?capture=abc', label: 'non-numeric' },
    { search: '?capture=0',   label: 'zero (below MIN)' },
    { search: '?capture=500', label: 'above MAX' },
    { search: '?capture=-5',  label: 'negative' },
    { search: '?capture=1.5', label: 'non-integer decimal' },
    { search: '?capture=',    label: 'empty value' },
  ];
  for (const { search, label } of invalid) {
    const ctx = buildContext({ search });
    loadCaptureRuntime(ctx);
    ctx.win.SWR_CAPTURE.loadConfig();
    assert(
      ctx.win.SWR_CAPTURE.isEnabled() === false,
      `?capture=<${label}>: isEnabled() === false`
    );
    assert(
      ctx.win.SWR_CAPTURE.getIntervalSec() === 5,
      `?capture=<${label}>: interval stays at default (5)`,
      `got ${ctx.win.SWR_CAPTURE.getIntervalSec()}`
    );
    assert(
      ctx.ls.getItem('swr.capture.enabled') === null,
      `?capture=<${label}>: localStorage enabled not written`,
      ctx.ls.getItem('swr.capture.enabled')
    );
  }
}

function section3() {
  console.log('\n=== 3. loadConfig() URL opt-in edge boundaries (must auto-enable) ===');
  const edges = [
    { search: '?capture=1',   expected: 1 },
    { search: '?capture=300', expected: 300 },
  ];
  for (const { search, expected } of edges) {
    const ctx = buildContext({ search });
    loadCaptureRuntime(ctx);
    ctx.win.SWR_CAPTURE.loadConfig();
    assert(
      ctx.win.SWR_CAPTURE.isEnabled() === true,
      `${search}: isEnabled() === true`
    );
    assert(
      ctx.win.SWR_CAPTURE.getIntervalSec() === expected,
      `${search}: getIntervalSec() === ${expected}`,
      `got ${ctx.win.SWR_CAPTURE.getIntervalSec()}`
    );
  }
}

function section4() {
  console.log('\n=== 4. loadConfig() localStorage fallback when no URL param ===');
  const ls = makeStorage();
  ls.setItem('swr.capture.enabled', '1');
  ls.setItem('swr.capture.intervalSec', '42');
  const ctx = buildContext({ search: '', storage: ls });
  loadCaptureRuntime(ctx);
  ctx.win.SWR_CAPTURE.loadConfig();
  assert(ctx.win.SWR_CAPTURE.isEnabled() === true, 'isEnabled() === true (restored from localStorage)');
  assert(ctx.win.SWR_CAPTURE.getIntervalSec() === 42, 'getIntervalSec() === 42 (restored)');
}

function section5() {
  console.log('\n=== 5. localStorage round-trip ===');
  const ctx = buildContext({ search: '' });
  loadCaptureRuntime(ctx);
  ctx.win.SWR_CAPTURE.enable();
  assert(
    ctx.ls.getItem('swr.capture.enabled') === '1',
    "enable() → localStorage 'swr.capture.enabled' === '1'"
  );
  ctx.win.SWR_CAPTURE.disable();
  assert(
    ctx.ls.getItem('swr.capture.enabled') === '0',
    "disable() → localStorage 'swr.capture.enabled' === '0'"
  );
  ctx.win.SWR_CAPTURE.setIntervalSec(60);
  assert(
    ctx.ls.getItem('swr.capture.intervalSec') === '60',
    "setIntervalSec(60) → localStorage 'swr.capture.intervalSec' === '60'"
  );
}

function section6() {
  console.log('\n=== 6. _clampInterval() boundaries via setIntervalSec() ===');
  const ctx = buildContext({ search: '' });
  loadCaptureRuntime(ctx);
  const cases = [
    { input: 0,       expected: 1,   label: '0 → 1' },
    { input: -5,      expected: 1,   label: '-5 → 1' },
    { input: 500,     expected: 300, label: '500 → 300' },
    { input: 150,     expected: 150, label: '150 → 150' },
    { input: 1.7,     expected: 1,   label: '1.7 → 1 (floored)' },
    { input: 300.999, expected: 300, label: '300.999 → 300' },
  ];
  for (const { input, expected, label } of cases) {
    ctx.win.SWR_CAPTURE.setIntervalSec(input);
    const got = ctx.win.SWR_CAPTURE.getIntervalSec();
    assert(got === expected, `setIntervalSec(${label})`, `got ${got}`);
  }
  // Non-finite inputs: _clampInterval returns DEFAULT_INTERVAL (5). The
  // task spec described "current value (no change)" — see deviations note.
  for (const input of [NaN, 'abc', undefined]) {
    const before = ctx.win.SWR_CAPTURE.getIntervalSec();
    ctx.win.SWR_CAPTURE.setIntervalSec(input);
    const got = ctx.win.SWR_CAPTURE.getIntervalSec();
    assert(
      got === 5,
      `setIntervalSec(${String(input)}) → 5 (DEFAULT fallback for non-finite)`,
      `got ${got}, before was ${before}`
    );
  }
}

function section7() {
  console.log('\n=== 7. State machine ===');
  // 7a. Default state (no URL, no lStorage) → isEnabled false.
  const ctx = buildContext({ search: '' });
  loadCaptureRuntime(ctx);
  assert(ctx.win.SWR_CAPTURE.isEnabled() === false, 'isEnabled() === false by default after init');

  // 7b. enable / disable flip.
  ctx.win.SWR_CAPTURE.enable();
  assert(ctx.win.SWR_CAPTURE.isEnabled() === true, 'enable() → isEnabled() === true');
  ctx.win.SWR_CAPTURE.disable();
  assert(ctx.win.SWR_CAPTURE.isEnabled() === false, 'disable() → isEnabled() === false');

  // 7c. setIntervalSec while enabled: state stays enabled, interval updates.
  ctx.win.SWR_CAPTURE.enable();
  ctx.win.SWR_CAPTURE.setIntervalSec(10);
  assert(ctx.win.SWR_CAPTURE.isEnabled() === true, 'setIntervalSec(10) while enabled → still enabled');
  assert(ctx.win.SWR_CAPTURE.getIntervalSec() === 10, 'setIntervalSec(10) → interval === 10');

  // 7d. reset() clears state and both localStorage keys.
  ctx.win.SWR_CAPTURE.reset();
  assert(ctx.win.SWR_CAPTURE.isEnabled() === false, 'reset() → isEnabled() === false');
  assert(
    ctx.ls.getItem('swr.capture.enabled') === null,
    "reset() → localStorage 'swr.capture.enabled' === null"
  );
  assert(
    ctx.ls.getItem('swr.capture.intervalSec') === null,
    "reset() → localStorage 'swr.capture.intervalSec' === null"
  );
}

function section8() {
  console.log('\n=== 8. captureNow() trigger (canvas → blob → <a download> → revoke) ===');
  const canvas = makeCanvasMock();
  const ctx = buildContext({ search: '', canvas });
  loadCaptureRuntime(ctx);

  // Spy on click: capture the last-created <a> via createElement.
  let lastAnchor = null;
  const origCreate = ctx.doc.createElement;
  ctx.doc.createElement = (tag) => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === 'a') lastAnchor = el;
    return el;
  };
  // Re-bind document.createElement on the window too (runtime calls
  // document.createElement through window.document).
  ctx.win.document.createElement = ctx.doc.createElement;

  const ok = ctx.win.SWR_CAPTURE.captureNow();
  assert(ok === true, 'captureNow() returns true when canvas is found');

  assert(lastAnchor !== null, 'document.createElement("a") was called');
  assert(lastAnchor && lastAnchor._clicked === 1, '<a>.click() invoked exactly once', `got ${lastAnchor && lastAnchor._clicked}`);
  assert(
    lastAnchor && /^blob:mock-12345-0$/.test(lastAnchor.href),
    '<a>.href set to URL.createObjectURL result',
    lastAnchor && lastAnchor.href
  );
  assert(
    lastAnchor && /^swr-frame-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.png$/.test(lastAnchor.download),
    '<a>.download matches swr-frame-YYYY-MM-DD-HH-mm-ss.png',
    lastAnchor && lastAnchor.download
  );
  assert(
    ctx.createdUrls.length === 1 && ctx.createdUrls[0].blob && ctx.createdUrls[0].blob.size === 12345,
    'URL.createObjectURL called with the toBlob blob',
    JSON.stringify(ctx.createdUrls[0])
  );
  assert(ctx.revokedUrls.length === 0, 'URL.revokeObjectURL NOT called before 1000ms', String(ctx.revokedUrls.length));

  // Flush the 1000ms revoke timer (recorded by spy setTimeout).
  flushRevoke(ctx);
  assert(
    ctx.revokedUrls.length === 1 && ctx.revokedUrls[0] === ctx.createdUrls[0].url,
    'URL.revokeObjectURL called with the same URL 1000ms later',
    JSON.stringify(ctx.revokedUrls)
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  section1();
  section2();
  section3();
  section4();
  section5();
  section6();
  section7();
  section8();

  console.log('\n' + (failures === 0
    ? 'CAPTURE UNIT: all assertions passed'
    : `CAPTURE UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
