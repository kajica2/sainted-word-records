#!/usr/bin/env node
// scripts/check-waveform-scrub-unit.mjs — pure-logic unit tests for
// lib/waveform-scrub.client.js (window.SWR_WAVEFORM), the scrolling
// waveform strip. Covers:
//
//   1.  peaksFromBuffer — the min/max reduction
//   2.  peaksFromBuffer — the buckets are EQUAL LENGTH IN TIME
//   3.  peaksFromBuffer — the channels are mixed to mono
//   4.  peaksFromBuffer — degenerate input (no buffer, empty buffer)
//   5.  timeToX / xToTime — the playhead is pinned at the centre
//   6.  timeToX / xToTime — fit mode puts the whole song on the strip
//   7.  xToTime — the round trip, and the clamp at both ends
//   8.  the component degrades gracefully (no media, no canvas ctx)
//
// Uses the node:vm trick from check-reel-unit.mjs: load the module
// source in a sandbox with browser shims, then drive the public API.
//
// The drawing itself is NOT tested here — a canvas needs a browser. The
// Puppeteer smoke (verify-waveform-scrub.mjs) covers the pixels.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'lib/waveform-scrub.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) {
    console.log('  ✓', msg, detail ? `(${detail})` : '');
  } else {
    console.log('  ✗', msg, detail ? `(${detail})` : '');
    failures += 1;
  }
}
function eq(got, expected, msg) {
  assert(got === expected, msg, `got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}
function near(got, expected, tol, msg) {
  assert(Math.abs(got - expected) <= tol, msg, `got ${got}, expected ${expected} ±${tol}`);
}

// ---------------------------------------------------------------------------
// Browser shims — just enough for the module to load and define itself.
// ---------------------------------------------------------------------------

class FakeHTMLElement {
  constructor() {
    this.style = { cssText: '' };
    this.children = [];
    this.attrs = {};
  }
  getAttribute(k) { return this.attrs[k] != null ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 56 }; }
  get clientWidth() { return 600; }
  get clientHeight() { return 56; }
}
FakeHTMLElement.prototype.setPointerCapture = function () {};

function makeCtx() {
  return {
    canvas: null,
    calls: 0,
    clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    closePath() {}, fill() {}, setTransform() {},
    set fillStyle(v) {}, get fillStyle() { return '#000'; },
    set globalAlpha(v) {}, get globalAlpha() { return 1; },
  };
}

function makeCanvas() {
  return {
    width: 0, height: 0, style: { cssText: '' },
    className: '',
    _ctx: makeCtx(),
    getContext() { return this._ctx; },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 56 }; },
    setPointerCapture() {},
  };
}

// A custom-element registry the module can define into.
const definedTags = new Set();
const customElements = {
  define(name, ctor) { definedTags.add(name); customElements._ctor = ctor; },
  get(name) { return definedTags.has(name) ? customElements._ctor : undefined; },
};

const sandbox = {
  window: null,
  HTMLElement: FakeHTMLElement,
  customElements,
  document: {
    createElement(tag) {
      if (tag === 'canvas') return makeCanvas();
      return new FakeHTMLElement();
    },
    getElementById() { return null; },
    querySelector() { return null; },
  },
  getComputedStyle() { return { getPropertyValue() { return ''; } }; },
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame() { return 1; },
  cancelAnimationFrame() {},
  ResizeObserver: null,
  devicePixelRatio: 2,
  Float32Array,
  Math,
  Infinity,
  isFinite,
  console,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const src = fs.readFileSync(SRC_PATH, 'utf8');
vm.runInContext(src, sandbox, { filename: SRC_PATH });

const SWR = sandbox.window.SWR_WAVEFORM;
assert(!!SWR, 'the module attaches window.SWR_WAVEFORM');
assert(definedTags.has('swr-waveform'), 'the module defines <swr-waveform>');
assert(SWR && typeof SWR.peaksFromBuffer === 'function', 'peaksFromBuffer is public');
assert(SWR && typeof SWR.timeToX === 'function', 'timeToX is public');
assert(SWR && typeof SWR.xToTime === 'function', 'xToTime is public');

// ---------------------------------------------------------------------------
// A fake decoded buffer: `channels` arrays of samples.
// ---------------------------------------------------------------------------
function fakeBuffer(channels, sampleRate) {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: sampleRate || 44100,
    duration: channels[0].length / (sampleRate || 44100),
    getChannelData(i) { return channels[i]; },
  };
}

console.log('\n1. peaksFromBuffer — the min/max reduction');
{
  const buf = fakeBuffer([new Float32Array([0.5, -0.5, 0.25, -0.25])]);
  const p = SWR.peaksFromBuffer(buf, 2);
  eq(p.min[0], -0.5, 'bucket 0 keeps its minimum');
  eq(p.max[0], 0.5, 'bucket 0 keeps its maximum');
  eq(p.min[1], -0.25, 'bucket 1 keeps its minimum');
  eq(p.max[1], 0.25, 'bucket 1 keeps its maximum');
  eq(p.buckets, 2, 'the bucket count is what was asked for');
  near(p.duration, 4 / 44100, 1e-9, 'the duration comes from the buffer');
}

console.log('\n2. the buckets are equal length in TIME');
{
  // 1000 samples in 10 buckets → 100 samples each.
  const ch = new Float32Array(1000);
  for (let i = 0; i < 1000; i++) ch[i] = i / 1000;
  const p = SWR.peaksFromBuffer(fakeBuffer([ch]), 10);
  eq(p.min.length, 10, 'ten buckets');
  // Bucket 0 covers samples 0..99 → min 0.000, max 0.099.
  near(p.max[0], 99 / 1000, 1e-6, 'bucket 0 ends at sample 99');
  // Bucket 1 covers samples 100..199 → min 0.1, max 0.199.
  near(p.min[1], 100 / 1000, 1e-6, 'bucket 1 starts at sample 100');
  near(p.max[9], 999 / 1000, 1e-6, 'the last bucket reaches the last sample');
}

console.log('\n3. the channels are mixed to mono');
{
  // Left says +1, right says -1 → the mix is 0, so the bucket is flat.
  const buf = fakeBuffer([
    new Float32Array([1, 1, 1, 1]),
    new Float32Array([-1, -1, -1, -1]),
  ]);
  const p = SWR.peaksFromBuffer(buf, 1);
  near(p.max[0], 0, 1e-6, 'the mixed bucket is flat');
  near(p.min[0], 0, 1e-6, 'the mixed bucket has no depth');

  // Only the left channel is loud → the mix is half.
  const buf2 = fakeBuffer([
    new Float32Array([1, 1, 1, 1]),
    new Float32Array([0, 0, 0, 0]),
  ]);
  const p2 = SWR.peaksFromBuffer(buf2, 1);
  near(p2.max[0], 0.5, 1e-6, 'the quiet channel pulls the mix down');
}

console.log('\n4. degenerate input');
{
  const p = SWR.peaksFromBuffer(null, 8);
  eq(p.buckets, 0, 'no buffer → no buckets');
  const empty = SWR.peaksFromBuffer(fakeBuffer([new Float32Array(0)]), 4);
  eq(empty.min.length, 4, 'an empty buffer still returns the requested buckets');
  eq(empty.max[0], 0, 'an empty bucket is zero');
  const p3 = SWR.peaksFromBuffer(fakeBuffer([new Float32Array([0.5])]), 0);
  eq(p3.buckets, 1, 'zero buckets is clamped to one');
}

console.log('\n5. scroll mode — the playhead is pinned at the centre');
{
  const W = 600;
  const vis = 20;              // 20 seconds on the strip
  // The clock is at 30 s. A moment 5 s later is a quarter of the
  // window right of the centre.
  const x = SWR.timeToX(35, 30, W, vis, 'scroll');
  near(x, W / 2 + (5 * (W / vis)), 0.001, 'five seconds ahead is 150px right of centre');
  // A moment behind is left of it.
  const x2 = SWR.timeToX(25, 30, W, vis, 'scroll');
  near(x2, W / 2 - (5 * (W / vis)), 0.001, 'five seconds behind is 150px left of centre');
  // The clock itself is the centre.
  near(SWR.timeToX(30, 30, W, vis, 'scroll'), W / 2, 0.001, 'the clock is the centre');
}

console.log('\n6. fit mode — the whole song on the strip');
{
  const W = 600;
  const dur = 120;
  near(SWR.timeToX(0, 30, W, dur, 'fit'), 0, 0.001, 'the start is at the left edge');
  near(SWR.timeToX(60, 30, W, dur, 'fit'), 300, 0.001, 'the midpoint is in the middle');
  near(SWR.timeToX(120, 30, W, dur, 'fit'), 600, 0.001, 'the end is at the right edge');
}

console.log('\n7. xToTime — the round trip and the clamps');
{
  const W = 600;
  const vis = 20;
  // Click on the centre → the clock.
  near(SWR.xToTime(W / 2, 30, W, vis, 'scroll', 200), 30, 0.001, 'the centre is the clock');
  // Round trip through both directions.
  for (const t of [12.5, 30, 44.75]) {
    const x = SWR.timeToX(t, 30, W, vis, 'scroll');
    near(SWR.xToTime(x, 30, W, vis, 'scroll', 200), t, 0.001, `round trip at ${t}s`);
  }
  // Clamped at both ends. In scroll mode the strip is a WINDOW on the
  // song, so a click off the left is an EARLY time (3.3 s), not a
  // negative one — the clamp only bites when the time really is out of
  // range.
  near(SWR.xToTime(-500, 30, W, vis, 'scroll', 200), 3.333333, 0.01, 'a click off the left is an early time');
  near(SWR.xToTime(-9000, 30, W, vis, 'scroll', 200), 0, 0.001, 'a click far before the start clamps to zero');
  near(SWR.xToTime(9000, 30, W, vis, 'scroll', 200), 200, 0.001, 'a click far past the end clamps to the duration');
  // And in fit mode.
  near(SWR.xToTime(300, 30, W, 120, 'fit', 120), 60, 0.001, 'fit mode: the middle is the halfway point');
}

console.log('\n8. the component degrades gracefully');
{
  const inst = new SWR.Waveform();
  inst.connectedCallback();
  assert(typeof inst.render === 'function', 'the instance renders');
  assert(typeof inst.now === 'function', 'the instance has a clock');
  eq(inst.now(), 0, 'with no media and no engine the clock is zero, not NaN');
  // Rendering with no peaks must not throw.
  let threw = false;
  try { inst.render(); } catch (e) { threw = true; }
  assert(!threw, 'rendering with no peaks does not throw');
  // A clock source wins over the media element.
  inst.setClockSource(() => 12.5);
  near(inst.now(), 12.5, 0.001, 'the clock source is used when set');
  // The visible window.
  inst.setWindow(30);
  near(inst.visibleSeconds(), 30, 0.001, 'the window is what was set');
  inst.setMode('fit');
  // Fit mode with no duration falls back to the window rather than
  // zero — zero would divide by zero in the drawing maths.
  near(inst.visibleSeconds(), 30, 0.001, 'fit mode with no duration falls back to the window');
  inst.setPeaks(SWR.peaksFromBuffer(fakeBuffer([new Float32Array(44100)]), 8), 1);
  near(inst.visibleSeconds(), 1, 0.001, 'fit mode shows the whole song');
}

console.log(failures === 0 ? '\nwaveform-scrub unit: PASS' : `\nwaveform-scrub unit: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
