// scripts/check-automix-session-unit.mjs — unit coverage for the L4
// session-memory store (client/automix-session-store.client.js) and the
// session novelty layer wired into client/automix-runtime.client.js.
//
// node:vm trick from check-capture-unit.mjs / check-automix-arc-unit.mjs:
//   - store tests: load the store IIFE in a sandbox with a stub
//     localStorage and assert record/recent/corruption behaviour.
//   - layer tests: load store + runtime in the SAME sandbox with stubbed
//     SWR / SWR_AUTOMIX / SWR_ANCHOR_MAP / SWR_AUTOMIX_ARC and drive
//     automix.tick() — asserting reroute/passthrough through the real
//     layer chain, the tick event payload, the pill, and the song-change
//     flush hook in _ensureArc().

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storeSrc = readFileSync(path.join(__dirname, '..', 'client', 'automix-session-store.client.js'), 'utf8');
const runtimeSrc = readFileSync(path.join(__dirname, '..', 'client', 'automix-runtime.client.js'), 'utf8');

// localStorage stub backed by an in-memory map (same shape as
// check-last-mix-unit.mjs).
function makeStorage() {
  const map = new Map();
  return {
    _map: map,
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

// 4 synthetic anchors at the 2x2 corners of the map with distinct presets.
function makeMap() {
  const anchors = {
    a: { warmth: 0.2, intensity: 0.2, preset: { temp: 0.1, mut: 0.2 } },
    b: { warmth: 0.8, intensity: 0.2, preset: { temp: 0.4, mut: 0.5 } },
    c: { warmth: 0.2, intensity: 0.8, preset: { temp: -0.2, mut: 0.7 } },
    d: { warmth: 0.8, intensity: 0.8, preset: { temp: 0.0, mut: 0.9 } },
  };
  return {
    anchors,
    neighbours(coords, n) {
      n = n || 4;
      return Object.keys(anchors)
        .map((id) => {
          const a = anchors[id];
          const dx = a.warmth - coords.warmth;
          const dy = a.intensity - coords.intensity;
          return { id, dist: Math.sqrt(dx * dx + dy * dy), anchor: a };
        })
        .sort((x, y) => x.dist - y.dist)
        .slice(0, n);
    },
  };
}

function makeElement() {
  return { textContent: '', hidden: false, classList: { toggle() {}, add() {}, remove() {} } };
}

// Sandbox with store + runtime loaded, page-order (store first).
function makeSandbox({ loadStore = true, map = makeMap() } = {}) {
  const storage = makeStorage();
  const listeners = {};
  const events = [];
  const els = { 'synth-pill': makeElement() };
  const windowObj = {
    location: { search: '' },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => {
      const l = listeners[t] || [];
      const i = l.indexOf(fn);
      if (i !== -1) l.splice(i, 1);
    },
    dispatchEvent: (ev) => {
      events.push(ev);
      (listeners[ev.type] || []).forEach((fn) => fn(ev));
      return true;
    },
    SWR: {
      Audio: { feat: {}, el: { src: 'song1.mp3', currentTime: 0 } },
      _fxOverride: null,
    },
    SWR_AUTOMIX: {
      FLAT_CENTROID_VAR: 0.05,
      FLAT_DURATION_MS: 99999,
      ANTI_PATTERN_INTERVAL_MS: 99999,
      tickSection: () => ({ current: 'chorus', pending: null, pendingCount: 0 }),
      featuresToCoordsV2: () => ({ warmth: 0.5, intensity: 0.5 }),
      mix: () => ({
        coords: { warmth: 0.5, intensity: 0.5 },
        anchors: [{ id: 'a', dist: 0, anchor: map.anchors.a }],
        preset: map.anchors.a.preset,
        section: 'chorus',
      }),
      isStuck: () => false,
      presetDistance: () => 0,
      lerpPreset: (from, to, t) => {
        if (!from) return to;
        if (!to) return from;
        const out = {};
        for (const f of ['temp', 'mut']) {
          out[f] = (from[f] || 0) + ((to[f] || 0) - (from[f] || 0)) * t;
        }
        return out;
      },
      computeTickInterval: () => 1500,
    },
    SWR_ANCHOR_MAP: map,
    // Arc module present (pages always ship it) but build() → null so the
    // arc layer stays a passthrough unless a test sets automix.arc.
    SWR_AUTOMIX_ARC: {
      build: () => null,
      analyzeElement: () => Promise.resolve(null),
      sampleAt: () => null,
    },
  };
  const documentObj = {
    readyState: 'complete',
    getElementById: (id) => els[id] || null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Math, Object, Array, JSON, Date, Promise,
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    performance: { now: () => Date.now() },
    URLSearchParams,
    CustomEvent: function (type, opts) { this.type = type; this.detail = opts && opts.detail; },
    localStorage: storage,
    document: documentObj,
    window: windowObj,
  };
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  if (loadStore) vm.runInContext(storeSrc, sandbox);
  vm.runInContext(runtimeSrc, sandbox);
  return {
    storage,
    events,
    els,
    win: windowObj,
    automix: windowObj.automix,
    session: windowObj.SWR_AUTOMIX_SESSION,
  };
}

function tickEvents(sb) {
  return sb.events.filter((e) => e.type === 'swr-automix-tick').map((e) => e.detail.mixed);
}

// ---- Store-only tests ------------------------------------------------------
const storeOnly = () => {
  const storage = makeStorage();
  const sandbox = { console, Math, Object, Array, JSON, Date, setTimeout, clearTimeout, localStorage: storage, window: {} };
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(storeSrc, sandbox);
  return { m: sandbox.window.SWR_AUTOMIX_SESSION, storage };
};

const results = [];
function check(name, fn) {
  try { fn(); results.push('  \u2713 ' + name); }
  catch (err) { results.push('  \u2717 ' + name + ' \u2014 ' + err.message); process.exitCode = 1; }
}

// 1. Module surface.
check('1. store API surface (record/recent/KEY/__loaded)', () => {
  const { m, storage } = storeOnly();
  for (const k of ['record', 'recent', 'KEY', '__loaded']) assert.ok(k in m, 'missing: ' + k);
});

// 2. record + recent roundtrip.
check('2. record + recent roundtrip (newest song first)', () => {
  const { m, storage } = storeOnly();
  m.record('s1', ['a', 'b']);
  m.record('s2', ['c']);
  assert.deepStrictEqual(Array.from(m.recent()), ['c', 'a', 'b']);
});

// 3. Duplicate key replaces (no double entry).
check('3. duplicate key replaces the old entry', () => {
  const { m } = storeOnly();
  m.record('s1', ['a']);
  m.record('s1', ['b']);
  m.record('s2', ['c']);
  assert.deepStrictEqual(Array.from(m.recent()), ['c', 'b']);
});

// 4. Cap at 5 songs drops the oldest.
check('4. store caps at 5 songs, oldest dropped', () => {
  const { m, storage } = storeOnly();
  for (let i = 1; i <= 7; i++) m.record('s' + i, ['a' + i]);
  const raw = JSON.parse(storage.getItem('swr.automix.session.v1'));
  assert.strictEqual(raw.songs.length, 5);
  assert.deepStrictEqual(raw.songs.map((s) => s.key), ['s3', 's4', 's5', 's6', 's7']);
  assert.deepStrictEqual(Array.from(m.recent()), ['a7', 'a6', 'a5', 'a4', 'a3']);
});

// 5. Per-song anchorIds capped at 8.
check('5. per-song anchorIds capped at 8', () => {
  const { m, storage } = storeOnly();
  m.record('s1', ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9', 'x10']);
  const raw = JSON.parse(storage.getItem('swr.automix.session.v1'));
  assert.strictEqual(raw.songs[0].anchorIds.length, 8);
});

// 6. recent() dedupes across songs.
check('6. recent() dedupes anchors across songs', () => {
  const { m, storage } = storeOnly();
  m.record('s1', ['a', 'b']);
  m.record('s2', ['b', 'c']);
  assert.deepStrictEqual(Array.from(m.recent()), ['b', 'c', 'a']);
});

// 7. Corrupted stored JSON → empty store, no throw, recovers on record.
check('7. corrupted JSON treated as empty store, never throws', () => {
  const { m, storage } = storeOnly();
  const store = storage;
  store.setItem('swr.automix.session.v1', '{not json!!');
  assert.deepStrictEqual(Array.from(m.recent()), []);
  m.record('s1', ['a']);
  assert.deepStrictEqual(Array.from(m.recent()), ['a']);
  const raw = JSON.parse(store.getItem('swr.automix.session.v1'));
  assert.strictEqual(raw.songs.length, 1);
});

// non-string/empty anchor ids are filtered.
check('8. record filters non-string anchor ids', () => {
  const { m, storage } = storeOnly();
  m.record('s1', ['a', null, '', 42, 'b']);
  const raw = JSON.parse(storage.getItem('swr.automix.session.v1'));
  assert.deepStrictEqual(raw.songs[0].anchorIds, ['a', 'b']);
});

// record with no songKey is a no-op.
check('9. record without songKey is a no-op', () => {
  const { m, storage } = storeOnly();
  m.record('', ['a']);
  m.record(null, ['b']);
  assert.deepStrictEqual(Array.from(m.recent()), []);
});

// ---- Layer tests (through the real runtime tick) --------------------------

// 10. Reroute: picked anchor is in recent, unused neighbour exists.
check('10. session layer reroutes to an unused neighbour (preset + coords + flag)', () => {
  const sb = makeSandbox();
  sb.session.record('earlier-song', ['a']);
  sb.automix.tick();
  const mixed = tickEvents(sb)[0];
  assert.strictEqual(mixed.sessionRerouted, true, 'expected sessionRerouted flag');
  assert.strictEqual(mixed.anchors[0].id, 'b', 'expected first unused neighbour b');
  assert.deepStrictEqual(mixed.preset, sb.win.SWR_ANCHOR_MAP.anchors.b.preset);
  assert.deepStrictEqual(mixed.coords, { warmth: 0.5, intensity: 0.5 }, 'coords must be unchanged');
  assert.strictEqual(sb.win.SWR._fxOverride, sb.win.SWR_ANCHOR_MAP.anchors.b.preset,
    'ramped override must be the neighbour preset');
});

// 11. Passthrough: picked anchor not in recent.
check('11. passthrough when picked anchor is novel', () => {
  const sb = makeSandbox();
  sb.session.record('earlier-song', ['z']);
  sb.automix.tick();
  const mixed = tickEvents(sb)[0];
  assert.strictEqual(mixed.sessionRerouted, undefined);
  assert.strictEqual(mixed.anchors[0].id, 'a');
  assert.strictEqual(sb.win.SWR._fxOverride, sb.win.SWR_ANCHOR_MAP.anchors.a.preset);
});

// 12. Passthrough: ALL 4 neighbours already used.
check('12. passthrough when every neighbour is a repeat', () => {
  const sb = makeSandbox();
  sb.session.record('earlier-song', ['a', 'b', 'c', 'd']);
  sb.automix.tick();
  const mixed = tickEvents(sb)[0];
  assert.strictEqual(mixed.sessionRerouted, undefined);
  assert.strictEqual(mixed.anchors[0].id, 'a', 'keeps the current anchor');
});

// 13. Passthrough when the session store is absent (min pages).
check('13. passthrough when SWR_AUTOMIX_SESSION is absent', () => {
  const sb = makeSandbox({ loadStore: false });
  assert.strictEqual(sb.win.SWR_AUTOMIX_SESSION, undefined);
  sb.automix.tick();
  const mixed = tickEvents(sb)[0];
  assert.strictEqual(mixed.anchors[0].id, 'a');
  assert.strictEqual(mixed.sessionRerouted, undefined);
});

// 14. Passthrough when the anchor map is absent.
check('14. passthrough when SWR_ANCHOR_MAP is absent', () => {
  const sb = makeSandbox({ map: makeMap() });
  sb.win.SWR_ANCHOR_MAP = null;
  sb.session.record('earlier-song', ['a']);
  sb.automix.tick();
  const mixed = tickEvents(sb)[0];
  assert.strictEqual(mixed.sessionRerouted, undefined);
  assert.strictEqual(mixed.anchors[0].id, 'a');
});

// 15. Null mix passthrough: tick is a silent no-op.
check('15. null mix passthrough: no event, no crash', () => {
  const sb = makeSandbox();
  sb.win.SWR_AUTOMIX.mix = () => null;
  sb.automix.tick();
  assert.strictEqual(tickEvents(sb).length, 0, 'no tick event when mix is null');
  assert.strictEqual(sb.win.SWR._fxOverride, null);
});

// 16. Pill (legacy path): 'auto · <anchor>'.
check('16. pill legacy format: auto · <anchor>', () => {
  const sb = makeSandbox();
  sb.automix.tick();
  assert.strictEqual(sb.els['synth-pill'].textContent, 'auto · a');
});

// 17. Pill (arc path): 'auto · act N/M · section · anchor' — phase 3 format.
check('17. pill act context: auto · act N/M · section · anchor', () => {
  const sb = makeSandbox();
  const map = sb.win.SWR_ANCHOR_MAP;
  sb.win.SWR_AUTOMIX_ARC.sampleAt = () => ({
    actIndex: 1, actCount: 3, actName: 'surge', actProgress: 0.5,
    anchorId: 'a', coords: { warmth: 0.5, intensity: 0.5 }, preset: map.anchors.a.preset,
  });
  sb.automix.arc = { acts: [{}, {}, {}] };
  sb.automix.tick();
  assert.strictEqual(sb.els['synth-pill'].textContent, 'auto · act 2/3 · chorus · a');
});

// 18. Song-change flush: anchors accrue per tick, recorded on song change.
check('18. song-change flush records the old song and resets accumulation', () => {
  const sb = makeSandbox();
  sb.automix.tick();
  sb.automix.tick(); // duplicate anchor not re-pushed
  assert.deepStrictEqual(Array.from(sb.automix._sessionAnchors), ['a']);
  assert.deepStrictEqual(Array.from(sb.session.recent()), [], 'nothing flushed before the song changes');
  sb.win.SWR.Audio.el.src = 'song2.mp3';
  sb.automix._ensureArc();
  assert.deepStrictEqual(Array.from(sb.automix._sessionAnchors), [], 'accumulation reset after flush');
  assert.deepStrictEqual(Array.from(sb.session.recent()), ['a']);
  const raw = JSON.parse(sb.storage.getItem('swr.automix.session.v1'));
  assert.strictEqual(raw.songs[0].key, 'song1.mp3');
  assert.deepStrictEqual(Array.from(raw.songs[0].anchorIds), ['a']);
  assert.strictEqual(typeof raw.songs[0].ts, 'number');
});

// 19. Engine transport shape: window.Audio exposes the element as
//     `audioEl` (lib/audio.client.js), not `.el`/`._el` like the variant
//     stubs. The runtime must find it so the arc + flush work there.
check('19. engine-shape transport (audioEl) feeds _ensureArc and flush', () => {
  const sb = makeSandbox();
  const engineAudio = { feat: {}, audioEl: { src: 'esong1.mp3', currentTime: 0 } };
  sb.win.SWR.Audio = engineAudio;
  sb.automix.tick();
  assert.deepStrictEqual(Array.from(sb.automix._sessionAnchors), ['a']);
  engineAudio.audioEl.src = 'esong2.mp3';
  sb.automix._ensureArc();
  assert.deepStrictEqual(Array.from(sb.session.recent()), ['a'],
    'flush must fire with the audioEl-only transport');
});

// 20. Arc within-act progression: the preset glides from this act's
//     baseline toward the next act's baseline with actProgress (the
//     displacement contract's inside-act motion).
check('20. arc preset progresses within an act (actProgress lerp)', () => {
  const sb = makeSandbox();
  const acts = [
    { t0: 0, t1: 30, preset: { temp: 0.2, mut: 0.2 } },
    { t0: 30, t1: 60, preset: { temp: 0.6, mut: 0.8 } },
    { t0: 60, t1: 90, preset: { temp: 0.1, mut: 0.1 } },
  ];
  sb.win.SWR_AUTOMIX_ARC.sampleAt = (arc, t) => {
    for (let i = 0; i < acts.length; i++) {
      if (t >= acts[i].t0 && t < acts[i].t1) {
        return { actIndex: i, actCount: acts.length, actName: 'x',
                 actProgress: (t - acts[i].t0) / (acts[i].t1 - acts[i].t0),
                 anchorId: 'a', coords: { warmth: 0.5, intensity: 0.5 },
                 preset: acts[i].preset, rampMs: 1000 };
      }
    }
    return null;
  };
  sb.automix.arc = { acts: acts };
  // Mid-act: halfway between act 1 baseline and act 2 baseline.
  sb.win.SWR.Audio.el.currentTime = 15;
  sb.automix.tick();
  let mixed = tickEvents(sb)[0];
  assert.ok(Math.abs(mixed.preset.temp - 0.4) < 1e-9, 'temp mid-act ' + mixed.preset.temp);
  assert.ok(Math.abs(mixed.preset.mut - 0.5) < 1e-9, 'mut mid-act ' + mixed.preset.mut);
  // Act start: exactly the act's own baseline.
  sb.win.SWR.Audio.el.currentTime = 0;
  sb.automix.tick();
  mixed = tickEvents(sb)[1];
  assert.strictEqual(mixed.preset.temp, 0.2);
  assert.strictEqual(mixed.preset.mut, 0.2);
  // Last act: wraps to the first baseline (outro drifts back toward the
  // intro feel) — halfway there at progress 0.5.
  sb.win.SWR.Audio.el.currentTime = 75;
  sb.automix.tick();
  mixed = tickEvents(sb)[2];
  assert.ok(Math.abs(mixed.preset.temp - 0.15) < 1e-9, 'temp last-act wrap ' + mixed.preset.temp);
  assert.ok(Math.abs(mixed.preset.mut - 0.15) < 1e-9, 'mut last-act wrap ' + mixed.preset.mut);
});

console.log(results.join('\n'));
if (process.exitCode) {
  console.log('\nSESSION UNIT: FAILURES ABOVE');
} else {
  console.log('\nSESSION UNIT: ALL GREEN (' + results.length + ' tests)');
}
