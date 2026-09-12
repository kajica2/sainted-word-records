#!/usr/bin/env node
// scripts/check-section-scheduler-unit.mjs — section scheduler unit tests.
// Uses a fake RAF + a vm context so the source is loaded verbatim and we
// can drive the tween deterministically.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');
const SRC_PATH   = path.join(ROOT, 'client/section-scheduler.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) {
    console.log('  ✓', msg, detail ? `(${detail})` : '');
  } else {
    console.log('  ✗', msg, detail ? `(${detail})` : '');
    failures += 1;
  }
}

function makeCtx() {
  // Build a fake browser context. RAF is a manual queue — tests call
  // .tick(ms) to advance virtual time and fire the next scheduled frame.
  const win = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: (ev) => {
      // Minimal dispatch so the scheduler's CustomEvent reaches a listener.
      const detail = ev && ev.detail;
      const type = ev && ev.type;
      for (const cb of win._listeners[type] || []) {
        try { cb({ detail, type }); } catch (_) {}
      }
      return true;
    },
    _listeners: {},
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
  };
  const ctx = {
    window: win,
    console,
    CustomEvent: win.CustomEvent,
    document: { addEventListener: () => {} },
    performance: { now: () => 0 },
    requestAnimationFrame: null,    // injected below
    cancelAnimationFrame: () => {},
  };
  ctx.window.window = ctx.window;
  ctx.window.self = ctx.window;
  ctx.window.document = ctx.document;
  ctx.window.performance = ctx.performance;
  ctx.window.console = console;
  // wrap addEventListener so dispatchEvent can find listeners.
  const realAdd = win.addEventListener;
  win.addEventListener = (type, cb) => {
    (win._listeners[type] ||= []).push(cb);
    return realAdd(type, cb);
  };
  return ctx;
}

function installRAF(ctx) {
  const queue = [];      // [{ cb, deadline }]
  let now = 0;
  ctx.performance.now = () => now;
  ctx.requestAnimationFrame = (cb) => {
    const id = queue.length + 1;
    queue.push({ cb, deadline: now + 16 });
    return id;
  };
  ctx.cancelAnimationFrame = (id) => {
    const i = queue.findIndex((q) => q.id === id);
    if (i !== -1) queue.splice(i, 1);
  };
  ctx.__raf = {
    tick(ms) {
      now += ms;
      // Fire every frame whose deadline is reached, in order.
      while (queue.length && queue[0].deadline <= now) {
        const next = queue.shift();
        next.cb(now);
      }
    },
    pending() { return queue.length; },
    setNow(t) { now = t; },
    now() { return now; },
  };
}

function loadScheduler() {
  const ctx = makeCtx();
  installRAF(ctx);
  vm.createContext(ctx);
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  vm.runInContext(src, ctx);
  return ctx;
}

function makeChapter(over) {
  return Object.assign({
    anchors: [], chroma: 0, grain: 0, glow: 0, motion: 0, rotation: 0, bloom: 0,
  }, over || {});
}

const TRANSITIONS = {
  intro:  makeChapter({ anchors: ['a'],     chroma: 0.1, grain: 0.1, glow: 0.1, motion: 0.1, rotation: 0,  bloom: 0.1 }),
  verse:  makeChapter({ anchors: ['a','b'], chroma: 0.4, grain: 0.3, glow: 0.4, motion: 0.3, rotation: 1,  bloom: 0.4 }),
  chorus: makeChapter({ anchors: ['b','c'], chroma: 0.9, grain: 0.7, glow: 0.9, motion: 0.8, rotation: 2,  bloom: 0.8 }),
  outro:  makeChapter({ anchors: ['a'],     chroma: 0,   grain: 0,   glow: 0,   motion: 0,   rotation: 0,  bloom: 0   }),
};

// ---- tests -------------------------------------------------------------

function test1_initDefaults() {
  console.log('\n=== 1. init() sets defaults and exposes the public surface ===');
  const ctx = loadScheduler();
  const S = ctx.window.SWR_SECTION_SCHEDULER;
  assert(typeof S === 'object' && S !== null, 'window.SWR_SECTION_SCHEDULER is exposed');
  assert(typeof S.init === 'function', '.init is a function');
  assert(typeof S.currentChapter === 'string' || S.currentChapter === null,
    '.currentChapter getter returns string|null');
  const out = S.init({
    getState: () => ({ chroma: 0.2, grain: 0.2, glow: 0.2, motion: 0.2, rotation: 0, bloom: 0.2 }),
    setState: () => {},
    transitions: TRANSITIONS,
  });
  assert(out === ctx.window.SWR_SECTION_SCHEDULER, 'init() returns the same singleton');
  assert(S.currentChapter === 'intro', `default currentChapter is 'intro' (got: ${S.currentChapter})`);
  assert(S.targetChapter === 'intro', `default targetChapter is 'intro' (got: ${S.targetChapter})`);
  assert(S.transitionProgress === 0, `default transitionProgress is 0 (got: ${S.transitionProgress})`);
  assert(S._DEFAULTS && S._DEFAULTS.beats === 4, 'default beats === 4');
}

function test2_sectionChangeStartsTransition() {
  console.log('\n=== 2. swr-section-change starts a transition ===');
  const ctx = loadScheduler();
  // 120bpm → 4 beats = 2000ms; make the test easy by overriding beats.
  ctx.window.SWR_TRANSITION_BEATS = 2;  // → 1000ms @ 120bpm
  const setCalls = [];
  const S = ctx.window.SWR_SECTION_SCHEDULER.init({
    getState: () => makeChapter({ chroma: 0.1, grain: 0.1, glow: 0.1, motion: 0.1, rotation: 0, bloom: 0.1 }),
    setState: (s) => setCalls.push(s),
    transitions: TRANSITIONS,
  });
  // RAF idle, then dispatch a section change.
  assert(ctx.__raf.pending() === 0, 'no RAF queued before the event');
  ctx.window.dispatchEvent(new ctx.window.CustomEvent('swr-section-change', {
    detail: { from: 'intro', to: 'verse', beatNumber: 4, tMs: 1000, confidence: 0.9 },
  }));
  assert(S.targetChapter === 'verse', `targetChapter is 'verse' (got: ${S.targetChapter})`);
  assert(S.transitionProgress === 0, `transitionProgress is 0 at start (got: ${S.transitionProgress})`);
  assert(ctx.__raf.pending() >= 1, `RAF loop started (pending=${ctx.__raf.pending()})`);
  assert(setCalls.length === 0, 'no setState call before first frame');
  // First tick → eased value at t≈0.016s of 1s = 0.016 → smoothstep ≈ 0.0008.
  ctx.__raf.tick(16);
  assert(setCalls.length >= 1, `setState called after first frame (calls=${setCalls.length})`);
  const first = setCalls[0];
  assert(first.chroma > 0.09 && first.chroma < 0.12, `chroma lerped slightly above 0.1 (got ${first.chroma.toFixed(4)})`);
}

function test3_progressAdvancesOverTime() {
  console.log('\n=== 3. progress advances over time (no early completion) ===');
  const ctx = loadScheduler();
  ctx.window.SWR_TRANSITION_BEATS = 4;  // → 2000ms @ 120bpm
  const samples = [];
  const S = ctx.window.SWR_SECTION_SCHEDULER.init({
    getState: () => makeChapter({ chroma: 0, grain: 0, glow: 0, motion: 0, rotation: 0, bloom: 0 }),
    setState: () => {},
    transitions: TRANSITIONS,
  });
  ctx.window.dispatchEvent(new ctx.window.CustomEvent('swr-section-change', {
    detail: { from: 'intro', to: 'chorus' },
  }));
  for (let i = 0; i < 5; i++) {
    ctx.__raf.tick(400);
    samples.push(S.transitionProgress);
  }
  // Monotonic non-decreasing, stays below 1 until last tick crosses 2s.
  let monotonic = true;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i] < samples[i - 1] - 1e-9) { monotonic = false; break; }
  }
  assert(monotonic, `progress is non-decreasing: [${samples.map((s) => s.toFixed(3)).join(', ')}]`);
  assert(samples[0] > 0 && samples[0] < 0.3, `mid-progress at 400ms: ${samples[0].toFixed(3)} in (0,0.3)`);
  assert(samples[samples.length - 1] === 1, `final sample reached 1 (got ${samples[samples.length - 1]})`);
  assert(S.currentChapter === 'chorus', `currentChapter == 'chorus' after completion (got: ${S.currentChapter})`);
  assert(S.targetChapter === 'chorus', `targetChapter == 'chorus' (got: ${S.targetChapter})`);
}

function test4_completionFiresEvent() {
  console.log('\n=== 4. completion fires swr-section-applied exactly once ===');
  const ctx = loadScheduler();
  ctx.window.SWR_TRANSITION_BEATS = 2;  // 1000ms
  let applied = [];
  ctx.window.addEventListener('swr-section-applied', (e) => applied.push(e.detail));
  const S = ctx.window.SWR_SECTION_SCHEDULER.init({
    getState: () => makeChapter(),
    setState: () => {},
    transitions: TRANSITIONS,
  });
  ctx.window.dispatchEvent(new ctx.window.CustomEvent('swr-section-change', {
    detail: { from: 'intro', to: 'verse' },
  }));
  ctx.__raf.tick(500);
  assert(applied.length === 0, `no applied event mid-transition (got ${applied.length})`);
  ctx.__raf.tick(600);
  assert(applied.length === 1, `applied fired once at completion (got ${applied.length})`);
  assert(applied[0].from === 'intro' && applied[0].to === 'verse',
    `detail {from:'intro', to:'verse'} (got ${JSON.stringify(applied[0])})`);
  // Subsequent ticks shouldn't fire again.
  ctx.__raf.tick(500);
  assert(applied.length === 1, `no further applied events (got ${applied.length})`);
  assert(S.transitionProgress === 1, 'transitionProgress pinned at 1 after completion');
}

function test5_anchorWeightsInterpolated() {
  console.log('\n=== 5. anchor weights are set via SWR_ANCHOR_MAP.setWeight ===');
  const ctx = loadScheduler();
  ctx.window.SWR_TRANSITION_BEATS = 4;
  const weights = {};
  ctx.window.SWR_ANCHOR_MAP = {
    setWeight(id, w) { weights[id] = w; },
  };
  ctx.window.SWR_SECTION_SCHEDULER.init({
    getState: () => makeChapter({ anchors: ['a'] }),
    setState: () => {},
    transitions: TRANSITIONS,
  });
  // Move intro→verse: anchors ['a','b']; both in both, so weight ramps 0→1.
  ctx.window.dispatchEvent(new ctx.window.CustomEvent('swr-section-change', {
    detail: { from: 'intro', to: 'verse' },
  }));
  ctx.__raf.tick(1000);  // 50% of 2000ms → smoothstep(0.5)=0.5
  assert(typeof weights.a === 'number', 'anchor "a" was set');
  assert(typeof weights.b === 'number', 'anchor "b" was set (new in verse)');
  assert(Math.abs(weights.a - 0.5) < 0.05, `weight a ~0.5 at midpoint (got ${weights.a.toFixed(3)})`);
  assert(Math.abs(weights.b - 0.5) < 0.05, `weight b ~0.5 at midpoint (got ${weights.b.toFixed(3)})`);
  // Now verse→chorus: 'b' is shared (should ramp 0→1), 'a' is exclusive-to-from (1→0), 'c' is exclusive-to-to (0→1).
  ctx.window.dispatchEvent(new ctx.window.CustomEvent('swr-section-change', {
    detail: { from: 'verse', to: 'chorus' },
  }));
  ctx.__raf.tick(1000);  // halfway through the new transition
  assert(weights.a < 0.55, `weight a ramping down (got ${weights.a.toFixed(3)})`);
  assert(weights.b > 0.4 && weights.b < 0.6, `weight b in transition (got ${weights.b.toFixed(3)})`);
  assert(weights.c > 0.4 && weights.c < 0.6, `weight c ramping up (got ${weights.c.toFixed(3)})`);
  // Let it complete.
  ctx.__raf.tick(1500);
  assert(Math.abs(weights.a - 0) < 1e-6, `weight a pinned at 0 after transition (got ${weights.a})`);
  assert(Math.abs(weights.b - 1) < 1e-6, `weight b pinned at 1 after transition (got ${weights.b})`);
  assert(Math.abs(weights.c - 1) < 1e-6, `weight c pinned at 1 after transition (got ${weights.c})`);
}

function test6_smoothstepEasing() {
  console.log('\n=== 6. easing is smoothstep (s-curve, not linear) ===');
  const ctx = loadScheduler();
  ctx.window.SWR_TRANSITION_BEATS = 4;
  const samples = [];
  const S = ctx.window.SWR_SECTION_SCHEDULER.init({
    getState: () => makeChapter({ chroma: 0, grain: 0, glow: 0, motion: 0, rotation: 0, bloom: 0 }),
    setState: (s) => samples.push(s.chroma),
    transitions: TRANSITIONS,
  });
  ctx.window.dispatchEvent(new ctx.window.CustomEvent('swr-section-change', {
    detail: { from: 'intro', to: 'chorus' },  // chorus chroma = 0.9
  }));
  // 25% of duration → smoothstep(0.25) ≈ 0.156 (NOT 0.225 of linear).
  ctx.__raf.tick(500);
  const at25 = samples[samples.length - 1];
  assert(at25 < 0.2 && at25 > 0.1, `at 25% time, chroma is in (0.1, 0.2) — smoothstep curve (got ${at25.toFixed(3)})`);
  // 50% → smoothstep(0.5) === 0.5 exactly.
  ctx.__raf.tick(500);
  const at50 = samples[samples.length - 1];
  assert(Math.abs(at50 - 0.45) < 0.01, `at 50% time, chroma ~0.45 (got ${at50.toFixed(3)})`);
  // 75% → smoothstep(0.75) ≈ 0.844.
  ctx.__raf.tick(500);
  const at75 = samples[samples.length - 1];
  assert(at75 > 0.7 && at75 < 0.8, `at 75% time, chroma in (0.7, 0.8) — smoothstep curve (got ${at75.toFixed(3)})`);
}

async function main() {
  test1_initDefaults();
  test2_sectionChangeStartsTransition();
  test3_progressAdvancesOverTime();
  test4_completionFiresEvent();
  test5_anchorWeightsInterpolated();
  test6_smoothstepEasing();
  console.log('\n' + (failures === 0
    ? 'SECTION SCHEDULER UNIT: ALL GREEN (6 tests)'
    : `SECTION SCHEDULER UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});