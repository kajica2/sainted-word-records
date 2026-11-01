#!/usr/bin/env node
// Unit coverage for client/neon-demo-panel.client.js (helpers + mount registry contract).

import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('client/neon-demo-panel.client.js', 'utf8');

function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    id: '',
    type: '',
    value: '1',
    min: '0',
    max: '1',
    step: '0.01',
    disabled: false,
    title: '',
    style: {},
    textContent: '',
    children: [],
    parentNode: null,
    classList: {
      toggle: function () {},
      add: function () {},
      remove: function () {},
    },
    setAttribute: function (k, v) { el.attrs[k] = v; },
    getAttribute: function (k) { return el.attrs[k] != null ? el.attrs[k] : null; },
    hasAttribute: function (k) { return el.attrs[k] != null; },
    appendChild: function (child) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    addEventListener: function () {},
    querySelector: function (sel) {
      return walkQuery(el, sel);
    },
    querySelectorAll: function (sel) {
      const out = [];
      walkQueryAll(el, sel, out);
      return out;
    },
    attrs: {},
  };
  return el;
}

function walkQuery(node, sel) {
  if (matchSel(node, sel)) return node;
  for (const c of node.children || []) {
    const hit = walkQuery(c, sel);
    if (hit) return hit;
  }
  return null;
}

function walkQueryAll(node, sel, out) {
  if (matchSel(node, sel)) out.push(node);
  for (const c of node.children || []) walkQueryAll(c, sel, out);
}

function matchSel(node, sel) {
  if (sel === '[data-demo-layer-fields]') return node.attrs && node.attrs['data-demo-layer-fields'] === '1';
  if (sel === '[data-demo-all]') return node.attrs && node.attrs['data-demo-all'] === '1';
  if (sel.startsWith('#')) return node.id === sel.slice(1);
  if (sel.startsWith('[data-demo-preset=')) {
    const id = sel.match(/"([^"]+)"/)[1];
    return node.getAttribute('data-demo-preset') === id;
  }
  if (sel.startsWith('[data-demo-filter=')) {
    const id = sel.match(/"([^"]+)"/)[1];
    return node.getAttribute('data-demo-filter') === id;
  }
  if (sel.startsWith('[data-demo-control]')) return node.getAttribute('data-demo-control');
  return false;
}

const body = makeEl('body');
const head = makeEl('head');

const document = {
  readyState: 'complete',
  head: head,
  body: body,
  getElementById: function (id) {
    function find(n) {
      if (n.id === id) return n;
      for (const c of n.children) {
        const r = find(c);
        if (r) return r;
      }
      return null;
    }
    return find(body) || null;
  },
  addEventListener: function () {},
  createElement: function (tag) {
    return makeEl(tag);
  },
};

['sens', 'gate', 'decay'].forEach(function (id) {
  const inp = makeEl('input');
  inp.id = id;
  inp.min = '0';
  inp.max = '3';
  inp.step = '0.05';
  inp.value = '1';
  body.appendChild(inp);
});

const window = {
  document: document,
  addEventListener: function () {},
  SWR_MOTION_KILL: {
    isRotationGloballyEnabled: function () { return false; },
    isZoomGloballyEnabled: function () { return false; },
    IMAGE_CLARITY_ENABLED: true,
  },
  VersionsPresets: {
    SHORTCUT_PRESETS: ['pulse', 'neon'],
    PRESETS: { neon: { label: 'NEON', temp: 0.1 }, pulse: { label: 'PULSE', temp: 0.5 } },
    setPresetOverride: function () { return true; },
    applyPreset: function (k) { return k === 'neon' || k === 'pulse'; },
  },
  __swrCurrentPreset: 'pulse',
  __SWR_PRESETS: { neon: { temp: 0.1 }, aurora: { temp: 0.2 } },
  SWR_PRESET_CYCLE: { next: function (p) { return p === 'pulse' ? 'neon' : 'pulse'; } },
  FX: { setPersona: function () {}, state: { temp: 0, grain: 0, glow: 0, sepia: 0, vignette: 0, grayscale: 0, blur: 0 } },
  SWR_LOOK_FILTER_CYCLER: { apply: function () { return true; }, reset: function () {}, get: function () { return { slot: 0 }; } },
  SWR_KEYS: { run: function () { return true; }, home: function () {}, isBlackoutActive: function () { return false; } },
  SWR_SCENES: { recall: function () { return true; }, startCapture: function () {}, cancelCapture: function () {} },
  SWR_AUTOMAP: {},
  Layers: {
    sel: { blend: 'screen', opacity: 1, baseScale: 1, hue: 0, contrast: 1, brightness: 1, alpha: 1, mutate: 0, reactors: [] },
    render: function () {},
  },
  SWR_RENDER: { invalidate: function () {} },
};
window.window = window;

vm.runInNewContext(source, { window: window, document: document });

const api = window.SWR_NEON_DEMO;
let tests = 0;
function assert(cond, msg) {
  tests++;
  if (!cond) throw new Error('FAIL: ' + msg);
}

assert(api && typeof api.mount === 'function', 'SWR_NEON_DEMO exports mount');
assert(api.listShortcutPresets().join(',') === 'pulse,neon', 'listShortcutPresets');
assert(api.isRotationOff() === true, 'isRotationOff');
assert(api.isZoomOff() === true, 'isZoomOff');
assert(api.applyShortcutPreset('neon') === true, 'applyShortcutPreset');
assert(api.getState().activePreset === 'neon', 'active preset tracked');
assert(api.applyLookFilter(3) === true, 'applyLookFilter');

const listed = api.listControls();
assert(listed.length >= 10, 'listControls returns mounted controls (' + listed.length + ')');
const unbound = listed.filter(function (c) {
  const r = api.invokeControl(c.id);
  return !r || r.error === 'unknown_control';
});
assert(unbound.length === 0, 'every listed control is invokable');

const domControls = document.body.querySelectorAll('[data-demo-control]');
assert(domControls.length === listed.length, 'DOM control count matches registry');

try {
  api.assertAllControlsBound();
  assert(true, 'assertAllControlsBound');
} catch (e) {
  assert(false, 'assertAllControlsBound: ' + e.message);
}

// Static guard: regControl must be the only path that sets data-demo-control.
const rogueAssign = source.match(/setAttribute\(\s*['"]data-demo-control['"]/g);
const regCalls = source.match(/regControl\(/g) || [];
assert(!rogueAssign || rogueAssign.length <= regCalls.length, 'data-demo-control only via regControl');

console.log('NEON DEMO PANEL UNIT: ALL GREEN (' + tests + ' tests, ' + listed.length + ' controls)');
