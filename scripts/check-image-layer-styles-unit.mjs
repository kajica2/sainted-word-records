#!/usr/bin/env node
// Image layer swap styles — fade / depth / move / mask contracts.

import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const stylesSrc = fs.readFileSync('client/image-layer-styles.client.js', 'utf8');
const renderSrc = fs.readFileSync('engine-render.client.js', 'utf8');

function makeEl(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    style: {},
    children: [],
    appendChild(c) { this.children.push(c); return c; },
  };
}

function runStyles(extra) {
  const store = Object.create(null);
  const layers = {
    list: [],
    renderCalls: 0,
    render() { this.renderCalls += 1; },
  };
  const lane = {
    list: [],
    renderCalls: 0,
    render() { this.renderCalls += 1; },
  };
  const maskCalls = [];
  const crossfadeCalls = [];
  const timers = [];
  let now = 1000;
  const fxState = {
    temp: 0.1, mut: 0.2, mutAlgo: 1, posterize: 0, vignette: 0.05,
    chroma: 0, grain: 0, sepia: 0, glow: 0, grayscale: 0, blur: 0,
    liquid: 0, pearl: 0, glitch: 0, tone: 0, sharp: 0, cinematic: 0,
  };
  const personaCalls = [];
  const sandbox = {
    console,
    performance: { now: () => now },
    setTimeout(fn, ms) {
      const id = timers.length + 1;
      timers.push({ id, fn, at: now + (ms || 0) });
      return id;
    },
    clearTimeout(id) {
      for (let i = 0; i < timers.length; i++) {
        if (timers[i] && timers[i].id === id) timers[i] = null;
      }
    },
    localStorage: {
      getItem(k) { return store[k] == null ? null : store[k]; },
      setItem(k, v) { store[k] = String(v); },
    },
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    dispatchEvent() { return true; },
    Layers: layers,
    SWR_IMAGE_LANE: lane,
    MaskIllusions: {
      apply(name) { maskCalls.push(name); },
    },
    Personas: {
      PERSONAS: {
        neon: { label: 'Neon' },
        maskThreshold: { label: 'Develop' },
      },
      current() { return 'neon'; },
      apply(name) { personaCalls.push(name); },
    },
    FX: {
      state: fxState,
      setPersona(profile) {
        if (!profile) return;
        for (const k of Object.keys(profile)) fxState[k] = profile[k];
      },
    },
    SWR_TIMING: {
      attach() {},
      crossfade(layer, asset, opts) {
        crossfadeCalls.push({ layer, asset, opts });
        layer._swapPending = { newAsset: asset };
        layer._targetOpacity = 0;
        layer._flowX = 1;
        layer._flowY = 0.35;
        layer._flowAmp = 0.085;
        layer._flowUntil = now + 700;
        return true;
      },
    },
    SWR_MOTION_KILL: {
      isZoomGloballyEnabled() { return false; },
    },
    SWR: { Audio: { playing: true } },
  };
  Object.assign(sandbox, extra || {});
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(stylesSrc, sandbox);
  function flush(to) {
    now = to;
    for (let i = 0; i < timers.length; i++) {
      const t = timers[i];
      if (t && t.at <= now) {
        timers[i] = null;
        t.fn();
      }
    }
  }
  return { sandbox, layers, lane, maskCalls, crossfadeCalls, store, personaCalls, fxState, flush, setNow: (t) => { now = t; } };
}

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok  ' + name);
  } catch (err) {
    failed += 1;
    console.error('  FAIL  ' + name + ' — ' + (err && err.message));
  }
}

console.log('check:image-layer-styles-unit');

check('exposes four public styles', () => {
  const { sandbox } = runStyles();
  const S = sandbox.SWR_IMAGE_STYLES;
  assert.ok(S);
  assert.equal(S.STYLES.length, 4);
  assert.equal(S.STYLES.map((s) => s.id).join(','), 'fade,depth,move,mask');
});

check('setStyle persists and cycles', () => {
  const { sandbox, store } = runStyles();
  const S = sandbox.SWR_IMAGE_STYLES;
  S.setStyle('move');
  assert.equal(S.getStyle().id, 'move');
  assert.equal(store['swr.imageLayerStyle.v1'], 'move');
  S.cycle();
  assert.equal(S.getStyle().id, 'mask');
  S.cycle();
  assert.equal(S.getStyle().id, 'fade');
});

check('swapDepth reorders toward top', () => {
  const { sandbox, layers } = runStyles();
  const a = { id: 'L1', z: 0 };
  const b = { id: 'L2', z: 1 };
  const c = { id: 'L3', z: 2 };
  layers.list = [a, b, c];
  const S = sandbox.SWR_IMAGE_STYLES;
  assert.equal(S.swapDepth(a), true);
  assert.equal(layers.list.map((l) => l.id).join(','), 'L2,L1,L3');
  assert.equal(layers.renderCalls, 1);
});

check('swapDepth works on the image lane stack', () => {
  const { sandbox, layers, lane } = runStyles();
  const a = { id: 'I1', z: 0, _imageLane: true };
  const b = { id: 'I2', z: 1, _imageLane: true };
  lane.list = [a, b];
  layers.list = []; // video stack empty — lane owns the stills
  const S = sandbox.SWR_IMAGE_STYLES;
  assert.equal(S.swapDepth(a), true);
  assert.equal(lane.list.map((l) => l.id).join(','), 'I2,I1');
  assert.equal(lane.renderCalls, 1);
});

check('fade swap clears flow after crossfade seed', () => {
  const { sandbox, crossfadeCalls } = runStyles();
  const layer = { id: 'L1', asset: { id: 'old', type: 'image', name: 'a.png' } };
  const next = { id: 'new', type: 'image', name: 'b.png' };
  const S = sandbox.SWR_IMAGE_STYLES;
  S.setStyle('fade');
  assert.equal(S.swap(layer, next), true);
  assert.equal(crossfadeCalls.length, 1);
  assert.equal(layer._flowAmp, 0);
  assert.equal(layer._flowUntil, 0);
});

check('move swap keeps a flow window that lands at zero', () => {
  const { sandbox, setNow } = runStyles();
  const layer = { id: 'L1', asset: { id: 'old', type: 'image', name: 'a.png' }, opacity: 0.7 };
  const next = { id: 'new', type: 'image', name: 'b.png' };
  const S = sandbox.SWR_IMAGE_STYLES;
  S.setStyle('move');
  assert.equal(S.swap(layer, next), true);
  assert.ok(layer._flowAmp > 0);
  assert.ok(layer._flowUntil > 1000);
  // Mid-window offset is non-zero even when opacity settles below 1.
  layer._currentOpacity = 0.7;
  layer._targetOpacity = 0.7;
  setNow(1000 + (layer._flowUntil - layer._flowFrom) * 0.5);
  const mid = S.flowOffset(layer, 1280, 720);
  assert.ok(Math.abs(mid.x) > 1 || Math.abs(mid.y) > 1);
  // At the end of the window the offset is cleared — no snap residue.
  setNow(layer._flowUntil);
  const end = S.flowOffset(layer, 1280, 720);
  assert.equal(end.x, 0);
  assert.equal(end.y, 0);
  assert.equal(layer._flowUntil, 0);
});

check('mask swap applies then restores FX', () => {
  const { sandbox, maskCalls, personaCalls, fxState, flush } = runStyles();
  const layer = { id: 'L1', asset: { id: 'old', type: 'image', name: 'a.png' } };
  const next = { id: 'new', type: 'image', name: 'b.png' };
  const beforeMut = fxState.mut;
  const beforeAlgo = fxState.mutAlgo;
  const S = sandbox.SWR_IMAGE_STYLES;
  S.setStyle('mask');
  // Simulate MaskIllusions writing FX via Personas.apply path used in restore.
  sandbox.MaskIllusions.apply = function (name) {
    maskCalls.push(name);
    fxState.mut = 0.9;
    fxState.mutAlgo = 6;
  };
  assert.equal(S.swap(layer, next), true);
  assert.equal(maskCalls.length, 1);
  assert.ok(String(maskCalls[0]).startsWith('mask'));
  assert.equal(fxState.mutAlgo, 6);
  flush(1000 + 2000);
  // Restored either via Personas.apply('neon') or setPersona snapshot.
  assert.ok(personaCalls.indexOf('neon') >= 0 || fxState.mut === beforeMut);
  if (personaCalls.indexOf('neon') < 0) {
    assert.equal(fxState.mut, beforeMut);
    assert.equal(fxState.mutAlgo, beforeAlgo);
  }
});

check('depth swap reorders then crossfades', () => {
  const { sandbox, layers, crossfadeCalls } = runStyles();
  const a = { id: 'L1', asset: { id: 'old', type: 'image', name: 'a.png' } };
  const b = { id: 'L2', asset: { id: 'mid', type: 'image', name: 'm.png' } };
  layers.list = [a, b];
  const next = { id: 'new', type: 'image', name: 'b.png' };
  const S = sandbox.SWR_IMAGE_STYLES;
  S.setStyle('depth');
  assert.equal(S.swap(a, next), true);
  assert.equal(layers.list[layers.list.length - 1].id, 'L1');
  assert.equal(crossfadeCalls.length, 1);
});

check('locked layer refuses swap and depth', () => {
  const { sandbox, layers } = runStyles();
  const a = { id: 'L1', locked: true, asset: { id: 'old', type: 'image' } };
  layers.list = [a, { id: 'L2' }];
  const S = sandbox.SWR_IMAGE_STYLES;
  assert.equal(S.swapDepth(a), false);
  assert.equal(S.swap(a, { id: 'x', type: 'image' }), false);
});

check('imageEvolve restores Ken Burns pan with zoom gated off', () => {
  assert.ok(renderSrc.includes('Seeded Ken Burns') || renderSrc.includes('seeded Ken Burns') || renderSrc.includes('Image evolution'));
  assert.ok(renderSrc.includes('isZoomGloballyEnabled'));
  assert.ok(renderSrc.includes('a._kbT'));
  // Must not remain a stub.
  assert.ok(!/TODO: implement seeded Ken Burns/.test(renderSrc));
});

check('flowOffset returns zero when idle', () => {
  const { sandbox } = runStyles();
  const S = sandbox.SWR_IMAGE_STYLES;
  const off = S.flowOffset({ id: 'L1' }, 1280, 720);
  assert.equal(off.x, 0);
  assert.equal(off.y, 0);
});

check('pages load image-layer-styles', () => {
  const neon = fs.readFileSync('versions/neon.html', 'utf8');
  const rootNeon = fs.readFileSync('neon.html', 'utf8');
  const engine = fs.readFileSync('engine.html', 'utf8');
  const play = fs.readFileSync('versions/play.html', 'utf8');
  assert.ok(neon.includes('image-layer-styles.client.js'));
  assert.ok(rootNeon.includes('image-layer-styles.client.js'));
  assert.ok(engine.includes('image-layer-styles.client.js'));
  assert.ok(play.includes('image-layer-styles.client.js'));
  assert.ok(neon.includes('Image swap styles') || fs.readFileSync('client/neon-demo-panel.client.js', 'utf8').includes('Image swap styles'));
});

if (failed) {
  console.error(`\n${failed} failing assertion(s)`);
  process.exit(1);
}
console.log('\nall good');
