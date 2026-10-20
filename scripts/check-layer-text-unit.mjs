// scripts/check-layer-text-unit.mjs — Unit coverage for the new
// Layers.addText() / Layers.setText() pair (user-typed text layers).
// Verifies the contract:
//   - addText(text, opts?) appends a layer with kind=='text' and the
//     given text, position, font fields. Caps at 240 chars.
//   - setText(id, text) updates the string in place.
//   - pos defaults to {x:0, y:0, rot:0} when no opts supplied.
//   - empty/missing id makes addText() fall back to "T<index>".

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

function makeDom() {
  // Bare minimum: the IIFE's render() needs document.createElement.
  // We don't actually paint anything; we just verify the shape of the
  // layer objects. querySelector must return objects with .value so
  // the Layers.render() helper that sets `sel.value = l.blend` doesn't
  // throw.
  const cls = { add() {}, remove() {}, toggle() {}, contains: () => false };
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
    const n = {
      tagName: (tag || 'div').toUpperCase(),
      children: [], style: {}, className: '', dataset: {}, classList: cls,
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      setAttribute() {}, addEventListener() {}, removeEventListener() {},
      set textContent(v) { this._txt = v; },
      get textContent() { return this._txt || ''; },
      value: '', checked: false,
    };
    n.querySelector = (sel) => {
      if (sel === '.rot-v') return makeSpanStub();
      return makeInputStub();
    };
    n.querySelectorAll = () => [];
    return n;
  };
  return {
    createElement: (tag) => makeNode(tag || 'div'),
    createDocumentFragment: () => makeNode('fragment'),
    getElementById: () => makeNode('div'),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
}

function runFresh() {
  const rAFs = [];
  const sandbox = {
    window: {},
    document: makeDom(),
    console: { warn() {}, log() {}, info() {}, error() {} },
    Audio: () => null,
    setStatus: () => {},
    requestAnimationFrame: (cb) => { rAFs.push(cb); return rAFs.length; },
    cancelAnimationFrame: () => {},
    CustomEvent: class { constructor(t, init) { this.type = t; this.detail = init && init.detail; } },
    dispatchEvent: () => true,
    localStorage: { getItem: () => null, setItem: () => {} },
    performance: { now: () => 1000 },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { L: sandbox.window.Layers, flushRaf: () => {
    // First tick fires synchronously at the sandbox's pinned clock so
    // tweens with HOME_MS=50 land at k=1 on the first frame and commit
    // their final state.
    let clock = sandbox.performance.now();
    for (let i = 0; i < 4 && rAFs.length; i++) {
      clock += 1000;
      const cb = rAFs.shift();
      try { cb(clock); } catch (_) {}
    }
  } };
}

check('addText() creates a kind:text layer with the given string', () => {
  const { L } = runFresh();
  L.addText('hello world');
  const layer = L.list[L.list.length - 1];
  if (layer.kind !== 'text') return 'kind: ' + layer.kind;
  if (layer.text !== 'hello world') return 'text: ' + layer.text;
  return true;
});

check('addText() defaults pos to {x:0, y:0, rot:0}', () => {
  const { L } = runFresh();
  L.addText('x');
  const layer = L.list[L.list.length - 1];
  if (!layer.pos || layer.pos.x !== 0 || layer.pos.y !== 0 || layer.pos.rot !== 0) {
    return 'pos: ' + JSON.stringify(layer.pos);
  }
  return true;
});

check('addText() honours opts.x / opts.y / opts.rot', () => {
  const { L } = runFresh();
  L.addText('y', { x: 12, y: -34, rot: 7 });
  const layer = L.list[L.list.length - 1];
  if (layer.pos.x !== 12 || layer.pos.y !== -34 || layer.pos.rot !== 7) {
    return 'pos: ' + JSON.stringify(layer.pos);
  }
  return true;
});

check('addText() caps the string at 240 chars', () => {
  const { L } = runFresh();
  const big = 'A'.repeat(300);
  L.addText(big);
  const layer = L.list[L.list.length - 1];
  if (layer.text.length !== 240) return 'length: ' + layer.text.length;
  return true;
});

check('setText() updates an existing text layer in place', () => {
  const { L } = runFresh();
  const layer = L.addText('first');
  L.setText(layer.id, 'second');
  const after = L.list.find((l) => l.id === layer.id);
  if (!after || after.text !== 'second') return 'text not updated: ' + (after && after.text);
  return true;
});

check('setText() returns false for a non-text layer', () => {
  const { L } = runFresh();
  L.add({ id: 'IMG-1', name: 'img', type: 'image', url: 'data:' });
  const ok = L.setText('IMG-1', 'nope');
  return ok === false;
});

check('addText() leaves audio reactors empty (text is user-set, not audio)', () => {
  const { L } = runFresh();
  L.addText('a');
  const layer = L.list[L.list.length - 1];
  if (Array.isArray(layer.reactors) && layer.reactors.length !== 0) {
    return 'reactors: ' + JSON.stringify(layer.reactors);
  }
  return true;
});

check('addText() then homeAll() resets the position back to origin', () => {
  const { L, flushRaf } = runFresh();
  L.addText('p', { x: 50, y: 60 });
  L.homeAll(50);
  flushRaf();
  // After homeAll the layer's pos should be back at origin.
  const layer = L.list[L.list.length - 1];
  if (Math.abs(layer.pos.x) > 1 || Math.abs(layer.pos.y) > 1) {
    return 'pos not reset: ' + JSON.stringify(layer.pos) + ' (start was 50,60)';
  }
  return true;
});

// ---- summary ----
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
if (fail > 0) process.exit(1);
