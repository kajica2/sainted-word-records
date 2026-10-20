// scripts/check-layer-retire-unit.mjs — unit coverage for Layers.retire
// and Layers.unretire. The new contract: a retired layer fades its
// opacity to 0 (silences audio reactivity) and shrinks baseScale to
// 0.4 over a configurable window via a tween.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../lib/layers.client.js', import.meta.url), 'utf8');

const results = [];
function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message + (e.stack ? '\n' + e.stack.split('\n').slice(1, 3).join('\n') : '');
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

// ---- DOM stub ------------------------------------------------------------
function makeDom() {
  const makeInputStub = () => ({
    value: '', checked: false, dataset: {}, style: {},
    addEventListener() {}, removeEventListener() {},
  });
  const makeSpanStub = () => ({
    value: '', checked: false, dataset: {}, style: { opacity: '1' },
    addEventListener() {}, removeEventListener() {},
    set textContent(v) { this._txt = v; },
    get textContent() { return this._txt || ''; },
  });
  const makeNode = (tag) => {
    const cls = { add() {}, remove() {}, toggle() {}, contains: () => false };
    const n = {
      tagName: (tag || 'div').toUpperCase(),
      children: [], style: {}, className: '', dataset: {}, classList: cls,
      appendChild: function (c) { this.children.push(c); return c; },
      removeChild: function (c) { this.children = this.children.filter((x) => x !== c); },
      setAttribute() {}, removeAttribute() {},
      addEventListener() {}, removeEventListener() {},
      dispatchEvent() {},
      querySelectorAll() { return []; },
      insertBefore() {},
      set textContent(v) { this._txt = v; },
      get textContent() { return this._txt || ''; },
      value: '',
      checked: false,
    };
    n.querySelector = (sel) => {
      if (sel === '.rot-v') return makeSpanStub();
      return makeInputStub();
    };
    return n;
  };
  return {
    createElement: (tag) => makeNode(tag),
    createDocumentFragment: () => makeNode('fragment'),
    getElementById: () => makeNode('div'),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
}

function makeAudio() {
  return { feat: { bass: 0.2, mid: 0.3, treble: 0.1, rms: 0.4, beat: 0, onset: false, centroid: 0.5, air: 0.1 } };
}

function runFresh() {
  let fakeNow = 1000; // pinned clock so tweens are deterministic
  const rAFs = [];
  const sandbox = {
    window: {},
    document: makeDom(),
    console: { warn() {}, log() {}, info() {}, error() {} },
    Audio: makeAudio,
    setStatus: () => {},
    // Queue rAF callbacks. Tests call sandbox.window.__flushRaf() to
    // drain the queue; each tick advances fakeNow by 1000ms so tweens
    // reach k >= 1 on the second invocation and snap to target.
    requestAnimationFrame: (cb) => { rAFs.push(cb); return rAFs.length; },
    cancelAnimationFrame: () => {},
    CustomEvent: class { constructor(t, init) { this.type = t; this.detail = init && init.detail; } },
    dispatchEvent: () => true,
    localStorage: { getItem: () => null, setItem: () => {} },
    performance: { now: () => fakeNow },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  sandbox.window.__flushRaf = (maxIter = 32) => {
    let i = 0;
    while (rAFs.length && i++ < maxIter) {
      const next = rAFs.shift();
      fakeNow += 1000;
      try { next(fakeNow); } catch (_) {}
    }
  };
  return sandbox.window;
}

// ---- checks --------------------------------------------------------------

function flushAll(windowObj) {
  windowObj.__flushRaf();
}

check('Layers.retire(id) sets opacity → 0 and baseScale → 0.4', () => {
  const w = runFresh();
  const L = w.Layers;
  L.add({ name: 'test', type: 'image', url: 'data:url' });
  const layer = L.list[0];
  layer.opacity = 1; layer.baseScale = 1.2;
  L.retire(layer.id, 100);
  flushAll(w); // drain the rAF queue so the tween completes
  if (Math.abs(layer.opacity - 0) > 1e-6) return 'opacity not zeroed: ' + layer.opacity;
  if (Math.abs(layer.baseScale - 0.4) > 1e-6) return 'baseScale not parked at 0.4: ' + layer.baseScale;
  if (!layer._retired) return '_retired flag not set';
  return true;
});

check('Layers.unretire(id) restores opacity = 1, baseScale = 1', () => {
  const w = runFresh();
  const L = w.Layers;
  L.add({ name: 'u', type: 'image', url: 'data:url' });
  const layer = L.list[0];
  L.retire(layer.id, 50);
  flushAll(w);
  L.unretire(layer.id);
  if (Math.abs(layer.opacity - 1) > 1e-6) return 'opacity not restored: ' + layer.opacity;
  if (Math.abs(layer.baseScale - 1) > 1e-6) return 'baseScale not restored: ' + layer.baseScale;
  if (layer._retired) return '_retired flag still set after unretire';
  return true;
});

check('retire(id) on missing layer returns false', () => {
  const w = runFresh();
  return w.Layers.retire('does-not-exist', 100) === false;
});

check('retire emits no false-positive for an empty layer list', () => {
  const w = runFresh();
  return w.Layers.retire('whatever') === false;
});

// ---- summary ----
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
if (fail > 0) process.exit(1);
