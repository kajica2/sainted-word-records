#!/usr/bin/env node
// scripts/check-beat-pulse-unit.mjs — Unit tests for client/beat-pulse.client.js.
//
// We sandbox the .client.js inside a vm context with a synthetic A.feat
// mutator (window.__swrBeatPulseFeat) so we can drive rising/falling
// edges deterministically without real audio. rAF is shimmed with a
// manual `flushRafs()` so we can advance one beat frame and observe the
// pulse-decay event without waiting on real time.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'client/beat-pulse.client.js');

let failures = 0;
function assert(cond, msg) {
  console.log(cond ? `  ✓  ${msg}` : `  ✗  ${msg}`);
  if (!cond) failures += 1;
}

// Build a sandbox with the minimum browser surface the module touches:
// a window, a CustomEvent constructor, setInterval/clearInterval, and a
// requestAnimationFrame shim that queues callbacks for later flush.
function buildCtx() {
  const rafQueue = [];
  const listeners = Object.create(null);
  const ctx = {
    window: {},
    console,
    Date,
    Math,
    Set,
    CustomEvent: class CustomEvent {
      constructor(name, opts) {
        this.type = name;
        this.detail = (opts && opts.detail) || null;
      }
    },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    requestAnimationFrame: (cb) => {
      const idx = rafQueue.length;
      rafQueue.push(cb);
      return idx;
    },
    cancelAnimationFrame: (idx) => {
      if (idx >= 0 && idx < rafQueue.length) rafQueue[idx] = () => {};
    },
  };
  ctx.__rafQueue = rafQueue;
  ctx.__listeners = listeners;
  ctx.window.window = ctx.window;
  // Synthetic A.feat mutator — tests write to this object directly.
  ctx.window.__swrBeatPulseFeat = { beat: 0, bass: 0, onset: 0 };
  // Single, persistent EventTarget shim. `subscribe(name, fn)` is the
  // public surface tests use; do NOT replace ctx.window.addEventListener
  // inside tests or the link between subscribe() and dispatchEvent breaks.
  ctx.window.addEventListener = (name, fn) => {
    (listeners[name] = listeners[name] || []).push(fn);
  };
  ctx.window.dispatchEvent = (ev) => {
    const ls = listeners[ev.type] || [];
    for (const fn of ls) fn(ev);
    return true;
  };
  ctx.subscribe = (name) => {
    const seen = [];
    const orig = listeners[name] || [];
    const wrapper = (ev) => seen.push(ev);
    listeners[name] = [...orig, wrapper];
    return seen;
  };
  return ctx;
}

function loadModule(ctx) {
  vm.createContext(ctx);
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  vm.runInContext(src, ctx);
  return ctx.window.SWR_BEAT_PULSE;
}

function flushRafs(ctx) {
  const pending = ctx.__rafQueue.slice();
  ctx.__rafQueue.length = 0;
  for (const fn of pending) fn(Date.now());
}

// Pump the module's setInterval watcher once. Module interval is 16ms;
// we wait 25ms so at least one tick has run.
function pumpInterval() {
  return new Promise(r => setTimeout(r, 25));
}

// ---- test 1: rising edge emits pulse ----------------------------------
async function testRisingEdge() {
  console.log('\n=== 1. Rising edge (0 → 1) emits swr-beat-pulse ===');
  const ctx = buildCtx();
  const events = ctx.subscribe('swr-beat-pulse');
  const BP = loadModule(ctx);
  BP.init();
  // Settle: first tick sees beat=0, prev=0.
  await pumpInterval();

  ctx.window.__swrBeatPulseFeat = { beat: 1, bass: 0.4, onset: 0.2 };
  await pumpInterval();

  assert(events.length >= 1, `pulse dispatched (got ${events.length})`);
  assert(BP.lastPulse && BP.lastPulse.beatNumber === 1,
    `lastPulse.beatNumber === 1 (got ${BP.lastPulse && BP.lastPulse.beatNumber})`);
}

// ---- test 2: no edge, no pulse ----------------------------------------
async function testNoEdge() {
  console.log('\n=== 2. No edge = no pulse ===');
  const ctx = buildCtx();
  const events = ctx.subscribe('swr-beat-pulse');
  const BP = loadModule(ctx);
  BP.init();
  await pumpInterval();

  // Prime prev below threshold (sub-RISE): prev=0 first tick, then sub-RISE.
  ctx.window.__swrBeatPulseFeat = { beat: 0.3, bass: 0, onset: 0 };
  await pumpInterval();   // prev=0.3, now=0.3 → no edge
  await pumpInterval();   // prev=0.3, now=0.3 → no edge
  await pumpInterval();   // prev=0.3, now=0.3 → no edge
  assert(events.length === 0, `no pulse when beat stays sub-threshold (got ${events.length})`);
  assert(BP.lastPulse === null, `lastPulse still null (got ${BP.lastPulse && JSON.stringify(BP.lastPulse)})`);

  // Crossing UP fires (sanity check that the previous stream was sub-edge).
  ctx.window.__swrBeatPulseFeat = { beat: 0.9, bass: 0.5, onset: 0.5 };
  await pumpInterval();
  assert(events.length === 1, `crossing threshold fires 1 pulse (got ${events.length})`);
}

// ---- test 3: strength = bass + onset ----------------------------------
async function testStrength() {
  console.log('\n=== 3. strength = bass + onset ===');
  const ctx = buildCtx();
  const events = ctx.subscribe('swr-beat-pulse');
  const BP = loadModule(ctx);
  BP.init();
  await pumpInterval();

  ctx.window.__swrBeatPulseFeat = { beat: 0.9, bass: 0.6, onset: 0.25 };
  await pumpInterval();

  assert(events.length >= 1, `pulse dispatched (got ${events.length})`);
  const detail = events[0].detail;
  assert(detail.strength === 0.85,
    `strength = 0.6 + 0.25 = 0.85 (got ${detail.strength})`);
  assert(BP.lastPulse && BP.lastPulse.strength === 0.85,
    `lastPulse.strength === 0.85 (got ${BP.lastPulse && BP.lastPulse.strength})`);
}

// ---- test 4: decay event fires after 1 beat frame ---------------------
async function testDecayAfterBeat() {
  console.log('\n=== 4. pulse-decay fires after 1 beat frame ===');
  const ctx = buildCtx();
  const decayEvents = ctx.subscribe('pulse-decay');
  const BP = loadModule(ctx);
  BP.init();
  await pumpInterval();

  ctx.window.__swrBeatPulseFeat = { beat: 1, bass: 0.3, onset: 0.2 };
  await pumpInterval();
  // Before flushing rAFs: no decay yet.
  assert(decayEvents.length === 0, `no decay immediately after pulse (got ${decayEvents.length})`);
  flushRafs(ctx);
  // After flushing rAFs: one decay event with matching beatNumber.
  assert(decayEvents.length === 1, `1 decay event after rAF flush (got ${decayEvents.length})`);
  const detail = decayEvents[0].detail;
  assert(detail && detail.beatNumber === 1, `decay.beatNumber === 1 (got ${detail && detail.beatNumber})`);
  BP.stop();
}

// ---- test 5: on() handler subscription ------------------------------
async function testOnHandler() {
  console.log('\n=== 5. on("pulse", fn) + on("decay", fn) ===');
  const ctx = buildCtx();
  const BP = loadModule(ctx);
  const pulses = [], decays = [];
  BP.on('pulse', d => pulses.push(d));
  BP.on('decay', d => decays.push(d));
  BP.init();
  await pumpInterval();

  ctx.window.__swrBeatPulseFeat = { beat: 1, bass: 0.5, onset: 0.1 };
  await pumpInterval();
  assert(pulses.length === 1 && pulses[0].beatNumber === 1,
    `on("pulse") got 1 event w/ beatNumber=1 (got ${pulses.length})`);

  flushRafs(ctx);
  assert(decays.length === 1 && decays[0].beatNumber === 1,
    `on("decay") got 1 event w/ beatNumber=1 (got ${decays.length})`);

  // "*" wildcard should also receive pulse events.
  const wild = [];
  BP.on('*', d => wild.push(d));
  ctx.window.__swrBeatPulseFeat = { beat: 0, bass: 0, onset: 0 };
  await pumpInterval();
  ctx.window.__swrBeatPulseFeat = { beat: 1, bass: 0.2, onset: 0.2 };
  await pumpInterval();
  assert(wild.length === 1, `"*" wildcard handler received pulse (got ${wild.length})`);
}

// ---- test 6: re-arm after high→low→high ------------------------------
async function testRearm() {
  console.log('\n=== 6. Re-arm after high → low → high (edge re-detected) ===');
  const ctx = buildCtx();
  const events = ctx.subscribe('swr-beat-pulse');
  const BP = loadModule(ctx);
  BP.init();
  await pumpInterval();

  // Beat 1: rise.
  ctx.window.__swrBeatPulseFeat = { beat: 1, bass: 0.4, onset: 0.1 };
  await pumpInterval();
  // Beat 1 frame decays — need to drop back below threshold for next rise.
  ctx.window.__swrBeatPulseFeat = { beat: 0, bass: 0, onset: 0 };
  await pumpInterval();
  // Beat 2: rise again.
  ctx.window.__swrBeatPulseFeat = { beat: 1, bass: 0.7, onset: 0.1 };
  await pumpInterval();

  assert(events.length === 2, `2 pulse events observed (got ${events.length})`);
  assert(BP.lastPulse && BP.lastPulse.beatNumber === 2,
    `lastPulse.beatNumber === 2 (got ${BP.lastPulse && BP.lastPulse.beatNumber})`);
}

(async () => {
  await testRisingEdge();
  await testNoEdge();
  await testStrength();
  await testDecayAfterBeat();
  await testOnHandler();
  await testRearm();

  console.log('\n' + (failures === 0
    ? `BEAT PULSE UNIT: ALL GREEN (6 tests)`
    : `BEAT PULSE UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
