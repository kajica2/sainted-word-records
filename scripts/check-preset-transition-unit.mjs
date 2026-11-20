#!/usr/bin/env node
// scripts/check-preset-transition-unit.mjs — unit coverage for
//
//   client/fx-preset-transition.client.js  — the grade glide
//   engine-render.client.js                — motion off while a still swaps
//
// Run: node scripts/check-preset-transition-unit.mjs

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRANSITION = path.join(ROOT, 'client/fx-preset-transition.client.js');
const RENDER = path.join(ROOT, 'engine-render.client.js');

let failures = 0;
function check(cond, msg, detail) {
  if (cond) console.log('  PASS', msg, detail ? '(' + detail + ')' : '');
  else { console.log('  FAIL', msg, detail ? '(' + detail + ')' : ''); failures++; }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

// ---- a clock we control -------------------------------------------------

function makeClock(sandbox) {
  let clock = 0;
  let seq = 0;
  const pending = new Map();
  sandbox.requestAnimationFrame = (fn) => { const id = ++seq; pending.set(id, fn); return id; };
  sandbox.cancelAnimationFrame = (id) => { pending.delete(id); };
  sandbox.performance = { now: () => clock };
  return {
    advance(ms) {
      clock += ms;
      const fns = Array.from(pending.values());
      pending.clear();
      fns.forEach((fn) => fn());
    },
    get now() { return clock; },
    get pending() { return pending.size; },
  };
}

// ---- the transition module ----------------------------------------------

function loadTransition(state) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN, Date,
    JSON,
    performance: { now: () => 0 },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.FX = {
    state,
    setPersona(profile) {
      for (const k of Object.keys(profile)) {
        if (k === 'mutAlgo') state.mutAlgo = profile[k];
        else state[k] = profile[k];
      }
    },
  };
  const clock = makeClock(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(TRANSITION, 'utf8'), sandbox, { filename: TRANSITION });
  return { sandbox, clock, T: sandbox.SWR_PRESET_TRANSITION };
}

console.log('\nfx-preset-transition — the grade glide');

// 1. A preset morph must not snap.
{
  const state = { temp: 0, grain: 0.4, mutAlgo: 0 };
  const { sandbox, clock, T } = loadTransition(state);
  T.morph(() => sandbox.FX.setPersona({ temp: 1, grain: 0.4 }), { ms: 400 });
  check(near(state.temp, 0), 'the grade did not snap to the target', 'temp=' + state.temp);
  check(T.isMorphing(), 'a glide is in flight');
  clock.advance(200);
  check(state.temp > 0 && state.temp < 1, 'half way through, the grade is between the two', 'temp=' + state.temp);
  clock.advance(200);
  check(near(state.temp, 1, 1e-9), 'the glide lands on the applied value', 'temp=' + state.temp);
  check(!T.isMorphing(), 'the glide ends');
}

// 2. The glide must be smooth, not linear.
{
  const state = { temp: 0 };
  const { sandbox, clock, T } = loadTransition(state);
  T.morph(() => sandbox.FX.setPersona({ temp: 1 }), { ms: 400 });
  clock.advance(200);
  const mid = state.temp;
  check(mid > 0.45 && mid < 0.55, 'the curve is eased through the middle', 'temp=' + mid);
}

// 3. A second morph mid-flight must start from where the picture is.
{
  const state = { temp: 0 };
  const { sandbox, clock, T } = loadTransition(state);
  T.morph(() => sandbox.FX.setPersona({ temp: 1 }), { ms: 400 });
  clock.advance(200);
  const mid = state.temp;
  T.morph(() => sandbox.FX.setPersona({ temp: 0 }), { ms: 400 });
  check(near(state.temp, mid, 1e-6), 'the second morph starts from the current grade', 'temp=' + state.temp);
  clock.advance(400);
  check(near(state.temp, 0, 1e-9), 'the second morph lands on its own target', 'temp=' + state.temp);
}

// 4. A key someone else writes mid-flight must not be fought.
{
  const state = { temp: 0, grain: 0.1 };
  const { sandbox, clock, T } = loadTransition(state);
  T.morph(() => sandbox.FX.setPersona({ temp: 1, grain: 0.9 }), { ms: 400 });
  clock.advance(100);
  state.grain = 0.42;              // a slider the user is dragging
  clock.advance(300);
  check(near(state.grain, 0.42, 1e-9), 'an externally written key is left alone', 'grain=' + state.grain);
  check(near(state.temp, 1, 1e-9), 'the rest of the glide still lands', 'temp=' + state.temp);
}

// 5. mutAlgo is an enum, not a dial: it must not be interpolated.
{
  const state = { temp: 0, mutAlgo: 0 };
  const { sandbox, clock, T } = loadTransition(state);
  T.morph(() => sandbox.FX.setPersona({ mutAlgo: 5 }), { ms: 400 });
  check(state.mutAlgo === 5, 'mutAlgo snaps instead of sweeping the illusions', 'mutAlgo=' + state.mutAlgo);
}

// 6. A morph that changes nothing must not start a glide.
{
  const state = { temp: 0.5 };
  const { sandbox, clock, T } = loadTransition(state);
  T.morph(() => sandbox.FX.setPersona({ temp: 0.5 }), { ms: 400 });
  check(!T.isMorphing(), 'an unchanged preset does not glide');
  check(near(state.temp, 0.5), 'the state is untouched');
}

// 7. A zero-length morph is a snap.
{
  const state = { temp: 0 };
  const { sandbox, clock, T } = loadTransition(state);
  T.morph(() => sandbox.FX.setPersona({ temp: 1 }), { ms: 0 });
  check(near(state.temp, 1), 'a zero-length morph applies the preset at once', 'temp=' + state.temp);
  check(!T.isMorphing(), 'a zero-length morph does not glide');
}

// 8. Without an FX state the module must not throw.
{
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN, Date, JSON,
    performance: { now: () => 0 },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  makeClock(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(TRANSITION, 'utf8'), sandbox, { filename: TRANSITION });
  let threw = false;
  try { sandbox.SWR_PRESET_TRANSITION.morph(() => { throw new Error('boom'); }); }
  catch (e) { threw = e.message === 'boom'; }
  check(threw, 'a failing apply propagates instead of being swallowed');
}

// ---- the render path: motion off while a still swaps --------------------

console.log('\nengine-render — motion off while a still swaps');

function loadRender() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN, Date, JSON,
    performance: { now: () => 0 },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 1; },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    devicePixelRatio: 1,
    localStorage: {
      _v: {},
      getItem(k) { return this._v[k] == null ? null : this._v[k]; },
      setItem(k, v) { this._v[k] = String(v); },
      removeItem(k) { delete this._v[k]; },
    },
    document: {
      readyState: 'complete',
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
      removeEventListener() {},
      createElement() { return { style: {}, getContext() { return null; } }; },
      documentElement: { style: {} },
      body: { style: {} },
    },
    Event: function Event(type) { this.type = type; },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(RENDER, 'utf8'), sandbox, { filename: RENDER });
  return sandbox;
}

const R = loadRender();
const SWR_RENDER = R.SWR_RENDER;

function imageLayer(extra) {
  return Object.assign({
    asset: { type: 'image', name: 'still.jpg', _kbSeed: 1, _kbT: 0 },
    _currentOpacity: 1,
    _targetOpacity: 1,
  }, extra || {});
}

// A resting layer drifts.
{
  const l = imageLayer();
  const out = SWR_RENDER.imageEvolve(l, { scale: 1, x: 0, y: 0 });
  check(out.scale > 1.0001, 'a resting still drifts (Ken Burns zoom)', 'scale=' + out.scale);
  check(Math.abs(out.x) > 1 && Math.abs(out.y) > 0.1, 'a resting still pans', 'x=' + out.x + ' y=' + out.y);
}

// A layer with a pending swap holds still.
{
  const l = imageLayer({ _swapPending: { newAsset: { id: 'b' } } });
  const out = SWR_RENDER.imageEvolve(l, { scale: 1, x: 0, y: 0 });
  check(near(out.scale, 1), 'a swapping still does not zoom', 'scale=' + out.scale);
  check(near(out.x, 0) && near(out.y, 0), 'a swapping still does not pan', 'x=' + out.x + ' y=' + out.y);
}

// A layer whose opacity is travelling holds still.
{
  const l = imageLayer({ _currentOpacity: 0.4, _targetOpacity: 1 });
  const out = SWR_RENDER.imageEvolve(l, { scale: 1, x: 0, y: 0 });
  check(near(out.scale, 1) && near(out.x, 0) && near(out.y, 0), 'a fading still holds still');
  check(SWR_RENDER.isSwapping(l), 'the layer reads as swapping');
}

// The swap's own slide survives: the Move style's flow is the transition.
{
  const l = imageLayer({
    _swapPending: { newAsset: { id: 'b' } },
    _flowUntil: 10_000_000,
    _flowOffX: -40,
    _flowOffY: 12,
  });
  const out = SWR_RENDER.imageEvolve(l, { scale: 1, x: 0, y: 0 });
  check(near(out.x, -40, 1e-6) && near(out.y, 12, 1e-6), 'the swap slide survives', 'x=' + out.x + ' y=' + out.y);
}

// Once the swap is over the drift comes back.
{
  const l = imageLayer();
  check(!SWR_RENDER.isSwapping(l), 'a settled layer is not swapping');
  const out = SWR_RENDER.imageEvolve(l, { scale: 1, x: 0, y: 0 });
  check(out.scale > 1.0001, 'a settled still drifts again', 'scale=' + out.scale);
}

// A video layer is untouched by all of this.
{
  const l = { asset: { type: 'video' }, _currentOpacity: 1, _targetOpacity: 1 };
  const r = { scale: 1, x: 0, y: 0 };
  const out = SWR_RENDER.imageEvolve(l, r);
  check(out === r, 'a video layer is passed through untouched');
}

console.log(failures ? `\nPRESET TRANSITION UNIT: ${failures} failure(s)` : '\nPRESET TRANSITION UNIT: ALL GREEN');
process.exit(failures ? 1 : 0);
