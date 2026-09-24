// scripts/check-clip-evolution-unit.mjs — unit coverage for the natural
// clip-evolution package:
//   - layer-scheduler.worker.js: the glide-progress swap window (must
//     NEVER reschedule the pending timer — 1s updates would starve 10-20s
//     waits), swapNow (act-boundary cut), repeat avoidance, 8-bar cap.
//   - client/automix-composition.client.js: act boundaries cut on the 1s
//     glide clock, within-act profile interpolation (intro→peak midpoint),
//     no-arc fallback via tick events.
//
// node:vm pattern from check-automix-arc-unit.mjs / check-last-mix-unit.mjs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerSrc = readFileSync(path.join(__dirname, '..', 'layer-scheduler.worker.js'), 'utf8');
const compSrc = readFileSync(path.join(__dirname, '..', 'client', 'automix-composition.client.js'), 'utf8');
const natSrc = readFileSync(path.join(__dirname, '..', 'lib', 'swr-natural.client.js'), 'utf8');

// Natural-look module harness: controllable clock, inert DOM + rAF.
function makeNat() {
  let T = 1000;
  const sb = {
    console: { log: () => {}, warn: () => {} },
    Math, Object, Array, JSON, Date, Number, String, Promise, Proxy, Reflect,
    requestAnimationFrame: () => 0,
    performance: { now: () => T },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}) },
    window: {},
  };
  sb.globalThis = sb.window;
  vm.createContext(sb);
  vm.runInContext(natSrc, sb);
  return { NAT: sb.window.SWR_NATURAL, advance: (ms) => { T += ms; } };
}

// Attack τ=80ms → 16ms step ≈ 0.18; release τ=420ms → 16ms step ≈ 0.037.
function followerAudio(initial) { return { feat: Object.assign({}, initial) }; }

const results = [];
function check(name, fn) {
  try { fn(); results.push('  \u2713 ' + name); }
  catch (err) { results.push('  \u2717 ' + name + ' \u2014 ' + err.message); process.exitCode = 1; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ---- Worker harness: manual timer clock, synchronous asserts -------------
function makeWorker() {
  const posted = [];
  let pending = null; // { fn, ms }
  const sb = {
    console: { log: () => {}, warn: () => {} },
    Math, Object, Array, JSON, Date, Number, Set,
    setTimeout: (fn, ms) => { pending = { fn, ms }; return 1; },
    clearTimeout: () => { pending = null; },
    postMessage: (m) => posted.push(m),
  };
  sb.self = sb; // worker code lives on bare `self`
  vm.createContext(sb);
  vm.runInContext(workerSrc, sb);
  return {
    posted,
    get pending() { return pending; },
    fire() { const p = pending; pending = null; if (p) p.fn(); return p; },
    message(m) { sb.self.onmessage({ data: m }); },
  };
}

// ---- Composition harness: event shim + scheduler stub --------------------
function makeComposition() {
  const listeners = {};
  const sched = {
    configs: [], progress: [], swapNows: 0,
    setConfig(cfg) { this.configs.push(cfg); },
    setProgress(minS, maxS) { this.progress.push([minS, maxS]); },
    swapNow() { this.swapNows++; },
  };
  const sb = {
    console: { log: () => {}, warn: () => {} },
    Math, Object, Array, JSON, Date, Number, Set, Promise,
    setInterval: () => 0, clearInterval: () => {},
    setTimeout: () => 0, clearTimeout: () => {},
    CustomEvent: function (type, opts) { this.type = type; this.detail = opts && opts.detail; },
    window: {
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      SWR: { Layers: { list: [] } }, // auto-populate is a no-op with an empty pool
      automix: {
        enabled: true,
        arc: { acts: [{ name: 'intro' }, { name: 'peak' }, { name: 'breakdown' }] },
      },
      SWR_LAYER_SCHEDULER: sched,
    },
    document: { dispatchEvent: () => {} },
  };
  sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(compSrc, sb);
  return {
    sched,
    dispatch(type, detail) {
      (listeners[type] || []).forEach((fn) => fn({ detail }));
    },
  };
}

// ---- Worker tests ---------------------------------------------------------

check('1. worker: enable + pool arms a timer inside the config window', () => {
  const w = makeWorker();
  w.message({ type: 'config', cfg: { enabled: true, minMs: 5000, maxMs: 10000, beatSync: false, bpm: 0 } });
  w.message({ type: 'setPool', ids: ['a', 'b', 'c'] });
  assert(w.pending, 'no timer armed');
  assert(w.pending.ms >= 5000 && w.pending.ms <= 10000,
    'delay ' + w.pending.ms + ' outside [5000,10000]');
});

check('2. worker: progress hint does NOT reschedule the pending timer', () => {
  const w = makeWorker();
  w.message({ type: 'config', cfg: { enabled: true, minMs: 5000, maxMs: 10000, beatSync: false, bpm: 0 } });
  w.message({ type: 'setPool', ids: ['a', 'b', 'c'] });
  const before = w.pending;
  w.message({ type: 'progress', minMs: 2000, maxMs: 3000 });
  assert(w.pending === before, 'progress rescheduled the pending timer (starvation bug)');
});

check('3. worker: progress window is consumed at re-arm', () => {
  const w = makeWorker();
  w.message({ type: 'config', cfg: { enabled: true, minMs: 5000, maxMs: 10000, beatSync: false, bpm: 0 } });
  w.message({ type: 'setPool', ids: ['a', 'b', 'c'] });
  w.message({ type: 'progress', minMs: 2000, maxMs: 3000 });
  w.fire(); // fires a swap + re-arms
  assert(w.pending.ms >= 2000 && w.pending.ms <= 3000,
    're-arm delay ' + w.pending.ms + ' outside the progress window [2000,3000]');
});

check('4. worker: config post clears the progress window (act re-baseline)', () => {
  const w = makeWorker();
  w.message({ type: 'config', cfg: { enabled: true, minMs: 5000, maxMs: 10000, beatSync: false, bpm: 0 } });
  w.message({ type: 'setPool', ids: ['a', 'b', 'c'] });
  w.message({ type: 'progress', minMs: 2000, maxMs: 3000 });
  w.message({ type: 'config', cfg: { enabled: true, minMs: 5000, maxMs: 10000, beatSync: false, bpm: 0 } });
  w.fire();
  assert(w.pending.ms >= 5000 && w.pending.ms <= 10000,
    'post-config delay ' + w.pending.ms + ' still using the progress window');
});

check('5. worker: swapNow fires immediately and re-anchors', () => {
  const w = makeWorker();
  w.message({ type: 'config', cfg: { enabled: true, minMs: 5000, maxMs: 10000, beatSync: false, bpm: 0 } });
  w.message({ type: 'setPool', ids: ['a', 'b', 'c'] });
  const before = w.pending.ms;
  w.message({ type: 'swapNow' });
  assert(w.posted.some((m) => m.type === 'swap'), 'swapNow did not fire a swap');
  assert(w.pending, 'swapNow did not re-arm');
  assert(w.pending.ms >= 5000 && w.pending.ms <= 10000, 're-anchor outside the window');
  void before;
});

check('6. worker: no immediate clip repeats (recency filter)', () => {
  const w = makeWorker();
  w.message({ type: 'config', cfg: { enabled: true, minMs: 20, maxMs: 20, beatSync: false, bpm: 0 } });
  w.message({ type: 'setPool', ids: ['a', 'b', 'c', 'd'] });
  let prev = null;
  for (let i = 0; i < 5; i++) {
    w.fire();
    const swap = w.posted.filter((m) => m.type === 'swap').pop();
    assert(swap, 'no swap on tick ' + i);
    assert(swap.assetId !== prev, 'repeat pick: ' + prev + ' again');
    prev = swap.assetId;
  }
});

check('7. worker: 8-bar cap holds regardless of config', () => {
  const w = makeWorker();
  w.message({ type: 'config', cfg: { enabled: true, minMs: 30000, maxMs: 60000, beatSync: false, bpm: 120 } });
  w.message({ type: 'setPool', ids: ['a', 'b'] });
  assert(w.pending.ms <= 16000, 'delay ' + w.pending.ms + ' exceeds 8 bars (16s @120bpm)');
});

check('8. worker: beatSync snaps delays onto the beat grid', () => {
  const w = makeWorker();
  w.message({ type: 'config', cfg: { enabled: true, minMs: 5000, maxMs: 9000, beatSync: true, bpm: 120 } });
  w.message({ type: 'setPool', ids: ['a', 'b'] });
  const beatMs = 500;
  assert(w.pending.ms % beatMs === 0, 'delay ' + w.pending.ms + ' off the 500ms beat grid');
});

// ---- Composition tests ----------------------------------------------------

check('9. composition: act change on the glide clock reconfigures + cuts', () => {
  const c = makeComposition();
  c.dispatch('swr-automix-glide', { actIndex: 0, actName: 'intro', actProgress: 0 });
  assert(c.sched.configs.length === 1, 'act change did not apply the profile');
  assert(c.sched.configs[0].minSeconds === 9 && c.sched.configs[0].maxSeconds === 14,
    'intro profile wrong: ' + JSON.stringify(c.sched.configs[0]));
  assert(c.sched.swapNows === 1, 'act boundary did not cut');
});

check('10. composition: within-act glide interpolates toward the next profile', () => {
  const c = makeComposition();
  c.dispatch('swr-automix-glide', { actIndex: 0, actName: 'intro', actProgress: 0 }); // establish
  c.dispatch('swr-automix-glide', { actIndex: 0, actName: 'intro', actProgress: 0.5, nextActName: 'peak' });
  assert(c.sched.progress.length === 1, 'no progress hint on same-act glide');
  const [minS, maxS] = c.sched.progress[0];
  // intro (9-14) → peak (2.5-5) at p=0.5 → (5.75, 9.5)
  assert(Math.abs(minS - 5.75) < 1e-9, 'interpolated min ' + minS);
  assert(Math.abs(maxS - 9.5) < 1e-9, 'interpolated max ' + maxS);
  assert(c.sched.swapNows === 1, 'same-act glide must not cut');
});

check('11. composition: glide progress clamps to [0,1]', () => {
  const c = makeComposition();
  c.dispatch('swr-automix-glide', { actIndex: 0, actName: 'intro', actProgress: 0 });
  c.dispatch('swr-automix-glide', { actIndex: 0, actName: 'intro', actProgress: 7, nextActName: 'peak' });
  const [minS, maxS] = c.sched.progress[0];
  assert(minS === 2.5 && maxS === 5, 'out-of-range progress not clamped: ' + minS + ',' + maxS);
});

check('12. composition: tick without arc falls back to the lift profile', () => {
  const c = makeComposition();
  c.dispatch('swr-automix-tick', { mixed: {} });
  assert(c.sched.configs.length === 1, 'no-arc fallback did not apply');
  assert(c.sched.configs[0].minSeconds === 6 && c.sched.configs[0].maxSeconds === 10,
    'fallback profile wrong: ' + JSON.stringify(c.sched.configs[0]));
  assert(c.sched.swapNows === 0, 'fallback must not force a cut');
});

check('13. composition: arc rebuild resets tracking (new song)', () => {
  const c = makeComposition();
  c.dispatch('swr-automix-tick', { mixed: {} }); // no-arc state
  c.dispatch('swr-automix-arc', { acts: 3 });    // arc rebuilt
  c.dispatch('swr-automix-glide', { actIndex: 0, actName: 'intro', actProgress: 0 });
  assert(c.sched.configs.length === 2, 'arc reset did not re-arm act tracking');
});

check('14. composition: missing scheduler degrades to no-op', () => {
  const sb = {
    console: { log: () => {}, warn: () => {} },
    Math, Object, Array, JSON, Date, Number, Set, Promise,
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    window: { addEventListener: () => {}, SWR: { Layers: { list: [] } } },
    document: { dispatchEvent: () => {} },
  };
  sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(compSrc, sb); // must not throw without SWR_LAYER_SCHEDULER
});

// ---- Envelope follower (lib/swr-natural.client.js) -----------------------

check('15. follower attack rises fast (~80ms τ), release slower (~420ms τ)', () => {
  const { NAT, advance } = makeNat();
  const A = followerAudio({ bass: 0 });
  NAT.__wrap(A);
  assert(Math.abs(A.feat.bass) < 1e-9, 'initial capture');
  A.feat.bass = 1;                       // raw write (analyser side)
  advance(16);
  const up = A.feat.bass;                // one frame of attack
  assert(up > 0.08 && up < 0.35, 'attack step should be ~0.18, got ' + up);
  advance(250); A.feat.bass;             // step 1 (250ms clamp — tab-switch guard)
  advance(250);                          // step 2
  assert(A.feat.bass > 0.99, 'attack settles within 500ms, got ' + A.feat.bass);
  A.feat.bass = 0;                       // raw release
  advance(16);
  const down = A.feat.bass;
  assert(down < 0.99 && down > 0.85, 'release must be gradual, got ' + down);
});

check('16. bpm and out-of-window magnitudes pass through unsmoothed', () => {
  const { NAT, advance } = makeNat();
  const A = followerAudio({ bpm: 0, centroidVar: 0 });
  NAT.__wrap(A);
  A.feat.bpm = 136;
  advance(16);
  assert(A.feat.bpm === 136, 'bpm must not lag: ' + A.feat.bpm);
  A.feat.centroidVar = 4;
  advance(16);
  assert(A.feat.centroidVar === 4, '>1.6 magnitude must pass raw: ' + A.feat.centroidVar);
});

check('17. setEnabled(false) bypasses the follower and clears the grade', () => {
  const { NAT, advance } = makeNat();
  const A = followerAudio({ beat: 0 });
  NAT.__wrap(A);
  assert(A.feat.beat === 0, 'priming read establishes follower state');
  A.feat.beat = 1;
  advance(16);
  const smoothed = A.feat.beat;
  assert(smoothed < 1, 'expected smoothing while enabled, got ' + smoothed);
  NAT.setEnabled(false);
  A.feat.beat = 0;
  advance(16);
  assert(A.feat.beat === 0, 'disabled: reads must pass raw through');
});

check('18. module is idempotent (second load returns same surface)', () => {
  const { NAT } = makeNat();
  const sb = {
    console: { log: () => {}, warn: () => {} },
    Math, Object, Array, JSON, Date, Number, String, Promise, Proxy, Reflect,
    requestAnimationFrame: () => 0, performance: { now: () => 1 },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}) },
    window: { SWR_NATURAL: NAT },
  };
  sb.globalThis = sb.window;
  vm.createContext(sb);
  vm.runInContext(natSrc, sb);
  assert(sb.window.SWR_NATURAL === NAT, 're-execution must not rebuild the singleton');
});

console.log(results.join('\n'));
if (process.exitCode) {
  console.log('\nCLIP EVOLUTION UNIT: FAILURES ABOVE');
} else {
  console.log('\nCLIP EVOLUTION UNIT: ALL GREEN (' + results.length + ' tests)');
}
