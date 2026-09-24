// scripts/check-automix-unit.mjs
// Node-only unit tests for the pure functions in client/automix.client.js.
// Loads the file as text, evals it in a sandbox with a minimal
// SWR_ANCHOR_MAP stub, then asserts on the returned values.
//
// Run command:
//   node scripts/check-automix-unit.mjs
//
// Pass criteria: every `assert(...)` succeeds, exit code 0, last
// line prints "AUTOMIX UNIT: ALL GREEN (N tests)".

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(new URL('../client/automix.client.js', import.meta.url), 'utf8');

// Minimal SWR_ANCHOR_MAP stub matching the public surface used by
// automix.client.js (neighbours + preset shape). 4 anchors spanning
// the gradient so we can test POOL_BIAS filtering across sections.
const ANCHORS = {
  neon:   { warmth: 0.5, intensity: 0.6, preset: { temp: -0.3, mut: 0.55, sepia: 0.0,  chroma: 0.85, grain: 0.40, glow: 0.4, grayscale: 0.0,  posterize: 0.10 } },
  film:   { warmth: 0.7, intensity: 0.4, preset: { temp:  0.3, mut: 0.20, sepia: 0.70, chroma: 0.0,  grain: 0.85, glow: 0.15, grayscale: 0.0,  posterize: 0.0  } },
  void_:  { warmth: 0.2, intensity: 0.2, preset: { temp: -0.45,mut: 0.05, sepia: 0.0,  chroma: 0.05, grain: 0.55, glow: 0.1, grayscale: 0.4,  posterize: 0.60 } },
  glitch: { warmth: 0.4, intensity: 0.9, preset: { temp:  0.0, mut: 0.90, sepia: 0.0,  chroma: 0.7,  grain: 0.50, glow: 0.1, grayscale: 0.0,  posterize: 0.35 } },
  // For section-pool tests we want a clearly-warm anchor (chorus high warmth)
  solar:  { warmth: 0.85, intensity: 0.85, preset: { temp: 0.7, mut: 0.5, sepia: 0.4, chroma: 0.9, grain: 0.2, glow: 0.8, grayscale: 0.0, posterize: 0.0 } },
  // And a clearly-cool dim anchor (breakdown / intro)
  mist:   { warmth: 0.15, intensity: 0.15, preset: { temp: -0.7, mut: 0.1, sepia: 0.0, chroma: 0.1, grain: 0.6, glow: 0.05, grayscale: 0.5, posterize: 0.4 } },
};

const sandbox = {
  window: {},
  console,
  Math,
  Object,
  Array,
  JSON,
};
sandbox.globalThis = sandbox.window;
sandbox.window.SWR_ANCHOR_MAP = {
  neighbours: function (coords, n) {
    n = n || 4;
    return Object.entries(ANCHORS).map(([id, a]) => ({
      id,
      dist: Math.hypot(a.warmth - coords.warmth, a.intensity - coords.intensity),
      anchor: a,
    })).sort((a, b) => a.dist - b.dist).slice(0, n);
  },
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const A = sandbox.window.SWR_AUTOMIX;
assert.ok(A, 'SWR_AUTOMIX must be defined');

// ---- featuresToCoords (v1, backward-compat) -----------------------------
const warm  = A.featuresToCoords({ bass: 0.8, mid: 0.2, treb: 0.1 });
const cool  = A.featuresToCoords({ bass: 0.1, mid: 0.2, treb: 0.8 });
assert.ok(warm.warmth  > 0.5, 'bass-heavy should skew warm, got ' + warm.warmth);
assert.ok(cool.warmth  < 0.5, 'treb-heavy should skew cool, got ' + cool.warmth);
assert.ok(warm.intensity >= 0 && warm.intensity <= 1, 'intensity must be in [0,1]');
assert.ok(cool.intensity >= 0 && cool.intensity <= 1, 'intensity must be in [0,1]');
const safe = A.featuresToCoords(null);
assert.equal(safe.warmth, 0.5, 'null features must default to warmth=0.5');
assert.equal(safe.intensity, 0.5, 'null features must default to intensity=0.5');

// ---- featuresToCoordsV2 (Phase 2.3) -------------------------------------
const v2Rich = A.featuresToCoordsV2({ bass: 0.5, mid: 0.5, treb: 0.5, centroid: 0.4, rms: 0.3 });
assert.ok(v2Rich.warmth >= 0 && v2Rich.warmth <= 1, 'v2 warmth in [0,1]');
assert.ok(v2Rich.intensity >= 0 && v2Rich.intensity <= 1, 'v2 intensity in [0,1]');
const v2Centroid = A.featuresToCoordsV2({ bass: 0.5, mid: 0.5, treb: 0.5, centroid: 0.9, rms: 0.3 });
const v2NoCent   = A.featuresToCoordsV2({ bass: 0.5, mid: 0.5, treb: 0.5 });
assert.ok(v2Centroid.warmth > v2NoCent.warmth, 'high centroid should pull warmer (centroid adds +0.2 * centroid to warmth)');
const v2Safe = A.featuresToCoordsV2(null);
assert.equal(v2Safe.warmth, 0.5, 'v2 null → (0.5, 0.5)');
assert.equal(v2Safe.intensity, 0.5, 'v2 null → (0.5, 0.5)');

// ---- blendAnchors: 2 anchors of equal weight + equal distance → mean ---
const blend = A.blendAnchors([
  { id: 'a', dist: 0.1, anchor: ANCHORS.neon },
  { id: 'b', dist: 0.1, anchor: ANCHORS.film },
]);
const expectedTemp = (ANCHORS.neon.preset.temp + ANCHORS.film.preset.temp) / 2;
assert.ok(Math.abs(blend.temp - expectedTemp) < 1e-6, 'equal weights must give arithmetic mean');

// ---- mix: full pipeline returns envelope --------------------------------
const mixed = A.mix({ bass: 0.5, mid: 0.5, treb: 0.5 }, 2);
assert.ok(mixed && mixed.coords && mixed.anchors && mixed.preset, 'mix must return full envelope');
assert.equal(mixed.anchors.length, 2, 'must honour neighbours count');
assert.equal(typeof mixed.preset.temp, 'number');
assert.equal(typeof mixed.preset.glow, 'number');

// ---- Phase 1.3: drift amplitudes (new constants) ------------------------
const base = { temp: 0.5, mut: 0.5, sepia: 0.5, chroma: 0.5, grain: 0.5, glow: 0.5, grayscale: 0.5, posterize: 0.5 };

// drift with beat undefined → amplitude = 0.01, step ≤ 0.011
for (let i = 0; i < 50; i++) {
  const d = A.drift(base);
  for (const f of Object.keys(base)) {
    assert.ok(d[f] >= -1 && d[f] <= 1, 'drift must clamp to [-1,1]');
    assert.ok(Math.abs(d[f] - base[f]) <= 0.012, 'cold drift step must be ≤ 0.012');
  }
}
// drift with beat=0 → amplitude = 0.01, step ≤ 0.011 (same as cold)
for (let i = 0; i < 100; i++) {
  const d = A.drift(base, 0);
  for (const f of Object.keys(base)) {
    assert.ok(Math.abs(d[f] - base[f]) <= 0.012,
              'beat=0 drift step ≤ 0.012 (got ' + (d[f] - base[f]) + ')');
  }
}
// drift with beat=1 → amplitude = 0.03, step ≤ 0.031
for (let i = 0; i < 200; i++) {
  const d = A.drift(base, 1);
  for (const f of Object.keys(base)) {
    assert.ok(Math.abs(d[f] - base[f]) <= 0.032, 'beat=1 drift step must be ≤ 0.032');
  }
}
// defensive: bad beat inputs → cold path
for (let i = 0; i < 50; i++) {
  const variants = [A.drift(base), A.drift(base, undefined), A.drift(base, null),
                    A.drift(base, 'not-a-number'), A.drift(base, NaN)];
  for (const v of variants) {
    for (const f of Object.keys(base)) {
      assert.ok(v[f] >= -1 && v[f] <= 1, 'defensive clamp');
      assert.ok(Math.abs(v[f] - base[f]) <= 0.012, 'defensive ≤ 0.012');
    }
  }
}
// defensive: negative / huge beat inputs clamp to [0, 1] then apply
for (let i = 0; i < 50; i++) {
  const dNeg = A.drift(base, -1);
  const dBig = A.drift(base, 99);
  for (const v of [dNeg, dBig]) {
    for (const f of Object.keys(base)) {
      assert.ok(Math.abs(v[f] - base[f]) <= 0.032, 'clamped beat stays within hot bound');
    }
  }
}
// drift(null) returns null unchanged.
assert.strictEqual(A.drift(null), null);
assert.strictEqual(A.drift(null, 1), null);

// ---- mix() threads beat through: same features + beat=0 vs beat=1 -------
let differ = false;
for (let i = 0; i < 30 && !differ; i++) {
  const a = A.mix({ bass: 0.5, mid: 0.5, treb: 0.5, beat: 0 });
  const b = A.mix({ bass: 0.5, mid: 0.5, treb: 0.5, beat: 1 });
  for (const f of Object.keys(a.preset)) {
    if (Math.abs(a.preset[f] - b.preset[f]) > 1e-6) { differ = true; break; }
  }
}
assert.ok(differ, 'mix(beat=0) vs mix(beat=1) produces different presets across runs');

// HologramState.neighbours override
sandbox.window.HologramState = { neighbours: 3 };
const m2 = A.mix({ bass: 0.5, mid: 0.5, treb: 0.5 });
assert.equal(m2.anchors.length, 3, 'HologramState.neighbours must override default n');

// ---- Phase 5: computeTickInterval (bars-based, BPM-aware) ----------------
// Default = 8 bars × [0.5×, 1.5×] intensity scaling, 120 BPM when bpm
// missing. At 120 BPM, 1 bar = 4 × 500 ms = 2000 ms.
//   intensity 0   → 1.5 × 8 × 2000 = 24000 ms
//   intensity 0.5 → 1.0 × 8 × 2000 = 16000 ms
//   intensity 1   → 0.5 × 8 × 2000 =  8000 ms
assert.equal(A.computeTickInterval(null), 24000, 'null features → 12 bars × 1.5× = 24000ms');
assert.equal(A.computeTickInterval({}), 24000, 'empty features → 12 bars × 1.5× = 24000ms');
assert.equal(A.computeTickInterval({ rms: 1.0, onset: 1.0 }), 8000,
             'max-intensity features → 4 bars × 0.5× = 8000ms');
// mid intensity (~0.495 from rms=0.33 → intensity = 0.495)
//   barsMul = 1.5 − 0.495 × 1.0 = 1.005
//   interval = 8 × 1.005 × 2000 ≈ 16080 ms
const mid = A.computeTickInterval({ rms: 0.33, onset: 0 });
assert.ok(mid > 15000 && mid < 17000, 'mid intensity should land ~16080 ms, got ' + mid);
// intensity clipped to [0, 1] even with huge inputs
const clipped = A.computeTickInterval({ rms: 99, onset: 99 });
assert.equal(clipped, 8000, 'clamped at 0.5× floor = 8000ms');
// intensity clipped to [0, 1] from negative inputs
const noNeg = A.computeTickInterval({ rms: -1, onset: -1 });
assert.equal(noNeg, 24000, 'clamped at 1.5× ceiling = 24000ms');
// BPM-aware: 12 bars at 180 BPM low intensity = 12 × 4 × (60000/180)
// = 12 × 1333.33 = 16000 ms.
const fastBpm = A.computeTickInterval({ bpm: 180, rms: 0, onset: 0 });
assert.ok(fastBpm > 15000 && fastBpm < 17000,
          '12 bars @ 180 BPM low intensity → ~16000 ms, got ' + fastBpm);
// BPM-aware: 12 bars at 90 BPM low intensity = 12 × 4 × (60000/90)
// = 12 × 2666.67 = 32000 ms.
const slowBpm = A.computeTickInterval({ bpm: 90, rms: 0, onset: 0 });
assert.ok(slowBpm > 31000 && slowBpm < 33000,
          '12 bars @ 90 BPM low intensity → ~32000 ms, got ' + slowBpm);
// fastBpm < slowBpm — faster tempo yields shorter interval at same intensity
assert.ok(fastBpm < slowBpm, 'faster BPM must produce shorter interval');
// BPM out of range → falls back to 120 BPM default
const weirdBpm = A.computeTickInterval({ bpm: 9999, rms: 0, onset: 0 });
assert.equal(weirdBpm, 24000, 'BPM out of [40, 240] → falls back to 120 BPM default');

// ---- Phase 1.2: smoothstep + lerpPreset + presetDistance ----------------
assert.equal(A.smoothstep(0), 0, 'smoothstep(0) = 0');
assert.equal(A.smoothstep(1), 1, 'smoothstep(1) = 1');
assert.equal(A.smoothstep(0.5), 0.5, 'smoothstep(0.5) = 0.5 (midpoint symmetry)');
assert.ok(A.smoothstep(0.25) < 0.25, 'smoothstep ease-in: f(0.25) < 0.25');
assert.ok(A.smoothstep(0.75) > 0.75, 'smoothstep ease-out: f(0.75) > 0.75');
assert.ok(A.smoothstep(-1) === 0 && A.smoothstep(2) === 1, 'smoothstep clamps');
const lerpTest = A.lerpPreset({ temp: 0, mut: 0 }, { temp: 1, mut: 1 }, 0.5);
assert.equal(lerpTest.temp, 0.5, 'lerp 0→1 at t=0.5 = 0.5');
assert.equal(lerpTest.mut, 0.5);
const lerpEnd = A.lerpPreset({ temp: 0.2 }, { temp: 0.8 }, 1);
assert.equal(lerpEnd.temp, 0.8, 'lerp at t=1 = target');
const lerpStart = A.lerpPreset({ temp: 0.2 }, { temp: 0.8 }, 0);
assert.equal(lerpStart.temp, 0.2, 'lerp at t=0 = source');
assert.equal(A.lerpPreset(null, { temp: 0.5 }, 0.5).temp, 0.5, 'null from → returns to');
assert.equal(A.lerpPreset({ temp: 0.5 }, null, 0.5).temp, 0.5, 'null to → returns from');
// presetDistance
assert.equal(A.presetDistance({ temp: 0 }, { temp: 0 }), 0, 'distance self = 0');
assert.ok(A.presetDistance({ temp: 1, mut: 0 }, { temp: 0, mut: 0 }) > 0.99,
          'distance ≈ 1 for 1-unit diff in 8-space');
assert.equal(A.presetDistance(null, { temp: 0 }), Infinity, 'null → Infinity');
assert.equal(A.presetDistance({ temp: 0 }, null), Infinity, 'null → Infinity');

// ---- Phase 2.1+2.5: tickSection hysteresis -------------------------------
sandbox.window.SWR_SECTION = {
  detect: function () { return { section: 'verse', confidence: 0.9 }; }
};
const state0 = A.tickSection({}, null);
assert.equal(state0.current, 'verse', 'initial = verse');
// Switch to chorus but unstable
sandbox.window.SWR_SECTION.detect = function () { return { section: 'chorus', confidence: 0.9 }; };
const s1 = A.tickSection({}, state0);
assert.equal(s1.current, 'verse', 'still verse after 1 chorus tick (hysteresis)');
const s2 = A.tickSection({}, s1);
assert.equal(s2.current, 'chorus', 'switches to chorus after 2 stable ticks');
// Low confidence → hold previous
sandbox.window.SWR_SECTION.detect = function () { return { section: 'breakdown', confidence: 0.3 }; };
const s3 = A.tickSection({}, s2);
assert.equal(s3.current, 'chorus', 'low confidence holds chorus');
// No SWR_SECTION → static fallback to 'verse'
delete sandbox.window.SWR_SECTION;
const s4 = A.tickSection({}, s3);
assert.equal(s4.current, 'verse', 'no SWR_SECTION → verse fallback');

// ---- Phase 2.2: POOL_BIAS filtering -------------------------------------
assert.ok(A.POOL_BIAS.chorus, 'POOL_BIAS must include chorus');
assert.ok(A.POOL_BIAS.intro, 'POOL_BIAS must include intro');
assert.equal(Object.keys(A.POOL_BIAS).length, 6, 'POOL_BIAS has 6 sections');
// Each entry has warmth + intensity ranges
for (const sec of Object.keys(A.POOL_BIAS)) {
  const b = A.POOL_BIAS[sec];
  assert.ok(b.warmth && b.intensity, sec + ' has both axes');
  assert.ok(b.warmth[0] < b.warmth[1], sec + ' warmth range valid');
  assert.ok(b.intensity[0] < b.intensity[1], sec + ' intensity range valid');
}
// mix() with section option includes section in result
const chorusMix = A.mix({ bass: 0.5, mid: 0.5, treb: 0.5 }, 4, { section: 'chorus' });
assert.equal(chorusMix.section, 'chorus', 'mix must echo section option');

// ---- Phase 3.2: isStuck ------------------------------------------------
assert.equal(A.isStuck(null, base, 99999), false, 'null prev → not stuck');
assert.equal(A.isStuck(base, null, 99999), false, 'null curr → not stuck');
// Identical presets → stuck after long enough
assert.equal(A.isStuck(base, base, A.STUCK_DURATION_MS), true, 'identical + long enough → stuck');
assert.equal(A.isStuck(base, base, A.STUCK_DURATION_MS - 1), false, 'identical but too soon → not stuck');
// Different presets → not stuck even after long time
const moved = { temp: 0.9, mut: 0.1, sepia: 0.2, chroma: 0.8, grain: 0.1, glow: 0.9, grayscale: 0.1, posterize: 0.9 };
assert.equal(A.isStuck(base, moved, A.STUCK_DURATION_MS * 2), false, 'different → not stuck');

// ---- Phase 3.3: isFlatAudio ---------------------------------------------
assert.equal(A.isFlatAudio(null, 99999), false, 'null features → not flat');
assert.equal(A.isFlatAudio({}, 99999), false, 'no centroidVar → not flat');
assert.equal(A.isFlatAudio({ centroidVar: 0.001 }, A.FLAT_DURATION_MS - 1), false, 'flat but too soon → not flat');
assert.equal(A.isFlatAudio({ centroidVar: 0.001 }, A.FLAT_DURATION_MS), true, 'flat + long enough → flat');
assert.equal(A.isFlatAudio({ centroidVar: 0.5 }, A.FLAT_DURATION_MS * 2), false, 'variance high → not flat');

// ---- Phase 2.3: mix() routes to v2 when centroid present ---------------
const v2Coords = A.mix({ bass: 0.5, mid: 0.5, treb: 0.5, centroid: 0.9, rms: 0.4 }, 2).coords;
const v1Coords = A.mix({ bass: 0.5, mid: 0.5, treb: 0.5 }, 2).coords;
assert.notEqual(v2Coords.warmth, v1Coords.warmth,
                'v2 vs v1 must differ when centroid is present');

// ---- Task 1 (cross-variant port): runtime config-loader -----------------
// Loads client/automix-runtime.client.js into a fresh sandbox per scenario
// and exercises the loadConfig() entry point (parse / validate / apply).
//
// Each scenario builds its own sandbox with document stubs so we can
// simulate variants that ship a #swrc-automix-config script tag vs.
// variants (music_video + 5 done) that don't.
import { createContext, runInContext } from 'node:vm';
const runtimeSrc = readFileSync(new URL('../client/automix-runtime.client.js', import.meta.url), 'utf8');

// Snapshot/restore SWR_AUTOMIX.POOL_BIAS around each scenario so tests
// stay isolated even though `A` is shared across all the unit checks.
// (POOL_BIAS is a single object — mutations in one scenario would leak.)
function snapshotPoolBias() {
  const out = {};
  for (const k of Object.keys(A.POOL_BIAS)) {
    out[k] = { warmth: A.POOL_BIAS[k].warmth.slice(), intensity: A.POOL_BIAS[k].intensity.slice() };
  }
  return out;
}
function restorePoolBias(snap) {
  for (const k of Object.keys(snap)) {
    A.POOL_BIAS[k] = { warmth: snap[k].warmth.slice(), intensity: snap[k].intensity.slice() };
  }
}
// Snapshot/restore SWR_AUTOMIX's closure-private drift amplitudes. After
// Task 1 fix round 1, the runtime config-loader mutates the amplitudes
// in place via _setDriftAmplitude() — shared state across sandboxes, so
// scenarios that apply a config (1b, 1g, 1m) must capture & restore.
// `_getDriftAmplitude()` reads the current values; the by-value
// `DRIFT_BASE` / `DRIFT_BEAT_BONUS` exports on `A` are stale after a
// setter call, so we never read those for current state.
function snapshotDrift() {
  if (typeof A._getDriftAmplitude === 'function') {
    return A._getDriftAmplitude();
  }
  return { base: A.DRIFT_BASE, beatScale: A.DRIFT_BEAT_BONUS };
}
function restoreDrift(snap) {
  if (typeof A._setDriftAmplitude === 'function') {
    A._setDriftAmplitude(snap.base, snap.beatScale);
  }
}
// Snapshot/restore the closure-private tick-interval bounds. After Task 1
// fix round 2, _setTuning() mutates them in place — shared state across
// sandboxes, so scenarios that apply a tuning config (1b, 1h, 1p) must
// capture & restore. `_getTuning()` reads the current values. The
// by-value `TICK_INTERVAL_MIN_MS` / `TICK_INTERVAL_MAX_MS` exports on
// `A` are now live getters (Important 3 fix), so they yield the same
// values as _getTuning() — but the getter is the documented public
// surface.
function snapshotTuning() {
  if (typeof A._getTuning === 'function') {
    return A._getTuning();
  }
  return { minTickMs: A.TICK_INTERVAL_MIN_MS, maxTickMs: A.TICK_INTERVAL_MAX_MS };
}
function restoreTuning(snap) {
  if (typeof A._setTuning === 'function') {
    A._setTuning(snap.minTickMs, snap.maxTickMs);
  }
}

function makeRuntimeEnv(opts) {
  opts = opts || {};
  const elements = opts.elements || {};
  // Tiny DOM stub: getElementById returns whatever was registered via opts.elements;
  // createElement/createTextNode return nodes that record their writes so we can assert.
  function makeNode(tag) {
    const n = {
      _tag: tag,
      // parentNode tracks which makeNode (or null) owns this node, so the
      // runtime's _applyToggleLabel can compare `span.parentNode === el`
      // (test 1n + 1o scenarios for toggle-label DOM mutation).
      parentNode: null,
      style: { display: '' },
      classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); }, contains(c) { return this._set.has(c); } },
      hidden: false,
      textContent: '',
      childNodes: [],
      firstChild: null,
      appendChild(c) {
        this.childNodes.push(c);
        this.firstChild = this.childNodes[0] || null;
        if (c && typeof c === 'object') c.parentNode = this;
        return c;
      },
      insertBefore(c, ref) {
        const idx = ref ? this.childNodes.indexOf(ref) : 0;
        this.childNodes.splice(idx, 0, c);
        this.firstChild = this.childNodes[0] || null;
        if (c && typeof c === 'object') c.parentNode = this;
        return c;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    return n;
  }
  const dom = {
    getElementById(id) { return Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : null; },
    addEventListener() {},
    removeEventListener() {},
    readyState: 'complete',
    createElement(tag) { return makeNode(tag); },
    createTextNode(text) { return { nodeType: 3, textContent: text }; },
  };
  const ls = { _data: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(ls._data, k) ? ls._data[k] : null; }, setItem(k, v) { ls._data[k] = String(v); } };
  const sb = {
    console: { warn() {}, log() {}, info() {}, error() {} },
    Math, Object, Array, JSON, Number, String, Boolean, Date,
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    performance: { now() { return 0; } },
    URLSearchParams: class { constructor() { this._q = {}; } get(k) { return Object.prototype.hasOwnProperty.call(this._q, k) ? this._q[k] : null; } },
    CustomEvent: class { constructor(name, init) { this.type = name; this.detail = init && init.detail; } },
    dispatchEvent() {},
    document: dom,
    localStorage: ls,
  };
  sb.window = sb;
  sb.globalThis = sb;
  sb.SWR_AUTOMIX = A;
  sb.SWR = { Audio: { feat: {} }, _fxOverride: null, Gradient: null };
  sb.HologramState = { neighbours: 4 };
  // window-level event listener stubs (used by wire() and _parseURL).
  sb.addEventListener = function () {};
  sb.removeEventListener = function () {};
  createContext(sb);
  return { sandbox: sb, dom: dom, ls: ls };
}

// ---- 1a: parse success (graceful default when no config) -----------------
{
  const env = makeRuntimeEnv();  // no #swrc-automix-config element
  runInContext(runtimeSrc, env.sandbox);
  const R = env.sandbox.SWR_AUTOMIX_RUNTIME;
  assert.ok(R, 'SWR_AUTOMIX_RUNTIME must be defined');
  assert.equal(typeof R.loadConfig, 'function', 'loadConfig must be exposed');
  assert.equal(R._config(), null, 'no #swrc-automix-config in DOM → _config stays null');
}

// ---- 1b: parse success with a valid config -------------------------------
{
  const poolSnap = snapshotPoolBias();
  const driftSnap = snapshotDrift();
  const tuningSnap = snapshotTuning();
  const cfgScript = { textContent: JSON.stringify({
    version: 1, variant: 'aurora', enabled: true, defaultState: 'off',
    poolBias: { intro: { warmth: [0.1, 0.5], intensity: [0.0, 0.2] } },
    driftAmplitude: { base: 0.02, beatScale: 0.03 },
    tuning: { minTickMs: 400, maxTickMs: 2500 },
    anchorMap: 'all',
    ui: { toggleLabel: 'Auto-Mix', toggleShortcut: 'm' },
  }) };
  const env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  const R = env.sandbox.SWR_AUTOMIX_RUNTIME;
  const cfg = R._config();
  assert.ok(cfg, 'valid config must populate _config');
  assert.equal(cfg.variant, 'aurora');
  assert.equal(cfg.enabled, true);
  // poolBias merged into SWR_AUTOMIX.POOL_BIAS.intro
  assert.ok(A.POOL_BIAS.intro, 'POOL_BIAS.intro exists');
  assert.equal(A.POOL_BIAS.intro.warmth[0], 0.1, 'poolBias.intro.warmth[0] overridden');
  assert.equal(A.POOL_BIAS.intro.warmth[1], 0.5, 'poolBias.intro.warmth[1] overridden');
  assert.equal(A.POOL_BIAS.intro.intensity[0], 0.0);
  assert.equal(A.POOL_BIAS.intro.intensity[1], 0.2);
  // unlisted sections kept their global defaults
  assert.equal(A.POOL_BIAS.chorus.warmth[0], 0.2, 'unlisted chorus keeps global default');
  assert.equal(A.POOL_BIAS.chorus.warmth[1], 0.8);
  assert.equal(A.POOL_BIAS.verse.warmth[0], 0.3, 'unlisted verse keeps global default');
  // driftAmplitude applied via SWR_AUTOMIX._setDriftAmplitude (replaces
  // closure-private DRIFT_BASE / DRIFT_BEAT_BONUS in place — no
  // per-tick compounding in the runtime). The runtime no longer
  // exposes its own _driftAmplitude accessor; the public surface is
  // SWR_AUTOMIX._getDriftAmplitude().
  const drift = A._getDriftAmplitude();
  assert.equal(drift.base, 0.02, 'driftAmplitude.base applied via _setDriftAmplitude');
  assert.equal(drift.beatScale, 0.03, 'driftAmplitude.beatScale applied via _setDriftAmplitude');
  // (Task 1 fix round 2 — tuning applied via _setTuning, replacing
  // closure-private TICK_INTERVAL_*MS in place. computeTickInterval()
  // now honours the override.)
  const tuning = A._getTuning();
  assert.equal(tuning.minTickMs, 400, 'tuning.minTickMs applied via _setTuning');
  assert.equal(tuning.maxTickMs, 2500, 'tuning.maxTickMs applied via _setTuning');
  restoreTuning(tuningSnap);
  restoreDrift(driftSnap);
  restorePoolBias(poolSnap);
}

// ---- 1c: parse failure (graceful fallback) -------------------------------
{
  const poolSnap = snapshotPoolBias();
  const warnCalls = [];
  const cfgScript = { textContent: '{invalid json,,,' };
  const env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  env.sandbox.console.warn = function () { warnCalls.push(Array.from(arguments)); };
  runInContext(runtimeSrc, env.sandbox);
  const R = env.sandbox.SWR_AUTOMIX_RUNTIME;
  assert.equal(R._config(), null, 'invalid JSON → _config stays null (graceful)');
  assert.ok(warnCalls.length > 0, 'invalid JSON → console.warn called');
  // POOL_BIAS unchanged from defaults
  assert.equal(A.POOL_BIAS.chorus.warmth[0], 0.2, 'fallback keeps global defaults');
  restorePoolBias(poolSnap);
}

// ---- 1d: parse failure when JSON is not an object ------------------------
{
  const warnCalls = [];
  const cfgScript = { textContent: '"a string"' };
  const env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  env.sandbox.console.warn = function () { warnCalls.push(Array.from(arguments)); };
  runInContext(runtimeSrc, env.sandbox);
  const R = env.sandbox.SWR_AUTOMIX_RUNTIME;
  assert.equal(R._config(), null, 'non-object JSON → _config stays null');
  assert.ok(warnCalls.length > 0, 'non-object JSON → console.warn called');
}

// ---- 1e: enabled=false hides #automix-toggle -----------------------------
{
  let toggleDisplay = '';
  const toggle = {
    _display: '',
    style: { set display(v) { toggleDisplay = v; }, get display() { return toggleDisplay; } },
    addEventListener() {},
    removeEventListener() {},
  };
  const cfgScript = { textContent: JSON.stringify({ version: 1, enabled: false }) };
  const env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript, 'automix-toggle': toggle } });
  runInContext(runtimeSrc, env.sandbox);
  const R = env.sandbox.SWR_AUTOMIX_RUNTIME;
  assert.equal(R._config().enabled, false);
  assert.equal(toggleDisplay, 'none', 'enabled=false sets #automix-toggle display:none');
}

// ---- 1f: defaultState:"on" calls automix.start() -------------------------
{
  // automix.start() requires window.SWR_AUTOMIX (set up in env) and
  // a non-null audio feat so it can call A.mix(). Our env has feat={} which
  // still works for the start path (mix() returns coords/anchors/preset).
  // We stub HologramState.neighbours + SWR_ANCHOR_MAP so mix() succeeds.
  const cfgScript = { textContent: JSON.stringify({ version: 1, defaultState: 'on' }) };
  const env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  env.sandbox.SWR_Audio = env.sandbox.SWR.Audio;
  env.sandbox.SWR_AUTOMIX = A;
  env.sandbox.SWR.Audio.feat = { bass: 0.5, mid: 0.5, treb: 0.5 };
  env.sandbox.SWR_ANCHOR_MAP = sandbox.window.SWR_ANCHOR_MAP;
  runInContext(runtimeSrc, env.sandbox);
  const R = env.sandbox.SWR_AUTOMIX_RUNTIME;
  assert.equal(R.automix.enabled, true, 'defaultState:"on" → automix.enabled after load');
  // cleanup: stop to release any timers that might leak across cases
  try { R.automix.stop(); } catch (_) {}
}

// ---- 1g: driftAmplitude validation bounds-check ---------------------------
{
  const driftSnap = snapshotDrift();
  // Public surface checks: _setDriftAmplitude / _getDriftAmplitude are
  // exposed on SWR_AUTOMIX and replace the closure-private drift
  // amplitudes in place. The runtime no longer carries its own
  // _driftAmplitude mirror — verification goes through SWR_AUTOMIX.
  assert.equal(typeof A._setDriftAmplitude, 'function', '_setDriftAmplitude exposed on SWR_AUTOMIX');
  assert.equal(typeof A._getDriftAmplitude, 'function', '_getDriftAmplitude exposed on SWR_AUTOMIX');

  // invalid: base > 1
  let cfgScript = { textContent: JSON.stringify({ version: 1, driftAmplitude: { base: 1.5, beatScale: 0.02 } }) };
  let env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  const R1 = env.sandbox.SWR_AUTOMIX_RUNTIME;
  assert.equal(R1._config().driftAmplitude.base, 1.5, 'invalid amplitude still captured on _config (validation applies at use-time)');
  // Validation rejects → SWR_AUTOMIX amplitudes unchanged from snapshot.
  const cur1 = A._getDriftAmplitude();
  assert.equal(cur1.base, driftSnap.base, 'invalid base>1 → SWR_AUTOMIX DRIFT_BASE unchanged');
  assert.equal(cur1.beatScale, driftSnap.beatScale, 'invalid base>1 → SWR_AUTOMIX DRIFT_BEAT_BONUS unchanged');

  // valid: applied via _setDriftAmplitude. Verify drift() now uses the
  // new amplitude (no per-tick compounding in the runtime — drift()
  // itself honours the override in place).
  cfgScript = { textContent: JSON.stringify({ version: 1, driftAmplitude: { base: 0.02, beatScale: 0.04 } }) };
  env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  const cur2 = A._getDriftAmplitude();
  assert.equal(cur2.base, 0.02, 'valid config → SWR_AUTOMIX DRIFT_BASE replaced');
  assert.equal(cur2.beatScale, 0.04, 'valid config → SWR_AUTOMIX DRIFT_BEAT_BONUS replaced');
  // Beat=1 → amplitude = 0.02 + 0.04 = 0.06, step ≤ 0.061.
  const baseP = { temp: 0.5, mut: 0.5, sepia: 0.5, chroma: 0.5, grain: 0.5, glow: 0.5, grayscale: 0.5, posterize: 0.5 };
  for (let i = 0; i < 100; i++) {
    const d = A.drift(baseP, 1);
    for (const f of Object.keys(baseP)) {
      assert.ok(Math.abs(d[f] - baseP[f]) <= 0.062,
                'after override, beat=1 drift step ≤ 0.062 (got ' + (d[f] - baseP[f]).toFixed(4) + ')');
    }
  }
  // Beat=0 → amplitude = 0.02, step ≤ 0.021.
  for (let i = 0; i < 100; i++) {
    const d = A.drift(baseP, 0);
    for (const f of Object.keys(baseP)) {
      assert.ok(Math.abs(d[f] - baseP[f]) <= 0.022,
                'after override, beat=0 drift step ≤ 0.022');
    }
  }

  // invalid: base < 0 → rejected (amplitudes unchanged from last valid).
  cfgScript = { textContent: JSON.stringify({ version: 1, driftAmplitude: { base: -0.01, beatScale: 0.02 } }) };
  env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  const cur3 = A._getDriftAmplitude();
  assert.equal(cur3.base, 0.02, 'invalid base<0 → SWR_AUTOMIX DRIFT_BASE unchanged');
  assert.equal(cur3.beatScale, 0.04, 'invalid base<0 → SWR_AUTOMIX DRIFT_BEAT_BONUS unchanged');

  // invalid: beatScale > 1 → rejected.
  cfgScript = { textContent: JSON.stringify({ version: 1, driftAmplitude: { base: 0.01, beatScale: 2.0 } }) };
  env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  const cur4 = A._getDriftAmplitude();
  assert.equal(cur4.base, 0.02, 'invalid beatScale>1 → SWR_AUTOMIX DRIFT_BASE unchanged');
  assert.equal(cur4.beatScale, 0.04, 'invalid beatScale>1 → SWR_AUTOMIX DRIFT_BEAT_BONUS unchanged');

  restoreDrift(driftSnap);
}

// ---- 1h: tuning validation bounds-check (Phase 4: bars-based preferred) ---
// Phase 5: the validator now accepts either barsPerTick (preferred) OR the
// legacy minTickMs/maxTickMs pair. barsPerTick sets BARS_PER_TICK directly;
// the legacy ms pair derives barsPerTick from the midpoint at 120 BPM
// (1 bar @ 120 BPM = 2000 ms). _getTuning() returns both knobs.
{
  const tuningSnap = snapshotTuning();
  // Valid: barsPerTick path (preferred going forward)
  let cfgScript = { textContent: JSON.stringify({ version: 1, tuning: { barsPerTick: 4 } }) };
  let env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  let t = A._getTuning();
  assert.equal(t.barsPerTick, 4, 'valid barsPerTick → _getTuning().barsPerTick replaced');
  // At 120 BPM, 4 bars × 1.5× ceiling = 12000 ms; × 0.5× floor = 4000 ms.
  assert.equal(A.computeTickInterval({ rms: 0, onset: 0 }), 12000,
               'barsPerTick=4, intensity=0 → 6 bars × 1.5× = 12000ms');
  assert.equal(A.computeTickInterval({ rms: 1, onset: 1 }), 4000,
               'barsPerTick=4, intensity=1 → 2 bars × 0.5× = 4000ms');

  // Valid: legacy minTickMs/maxTickMs path (back-compat).
  // midpoint = 1450 ms → round(1450 / 2000) = 1 bar. The legacy ms
  // fields are also surfaced via _getTuning() for inspection.
  cfgScript = { textContent: JSON.stringify({ version: 1, tuning: { minTickMs: 400, maxTickMs: 2500 } }) };
  env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  t = A._getTuning();
  assert.equal(t.minTickMs, 400, 'valid legacy tuning → _getTuning().minTickMs replaced');
  assert.equal(t.maxTickMs, 2500, 'valid legacy tuning → _getTuning().maxTickMs replaced');
  assert.equal(t.barsPerTick, 1, 'legacy ms midpoint at 120 BPM → barsPerTick=1');
  // 1 bar × 1.5× ceiling = 3000 ms; × 0.5× floor = 1000 ms.
  assert.equal(A.computeTickInterval({ rms: 0, onset: 0 }), 3000,
               'legacy ms derived barsPerTick=1, intensity=0 → 3000ms');
  assert.equal(A.computeTickInterval({ rms: 1, onset: 1 }), 1000,
               'legacy ms derived barsPerTick=1, intensity=1 → 1000ms');

  // Invalid: max < min → rejected, last valid state preserved.
  cfgScript = { textContent: JSON.stringify({ version: 1, tuning: { minTickMs: 2000, maxTickMs: 500 } }) };
  env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  const t2 = A._getTuning();
  assert.equal(t2.barsPerTick, 1, 'max<min → _setTuning rejected, barsPerTick unchanged');
  assert.equal(t2.minTickMs, 400, 'max<min → legacy ms preserved from last valid');
  assert.equal(t2.maxTickMs, 2500, 'max<min → legacy ms preserved from last valid');

  // Invalid: barsPerTick out of range [1, 32] → rejected.
  cfgScript = { textContent: JSON.stringify({ version: 1, tuning: { barsPerTick: 100 } }) };
  env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  const t3 = A._getTuning();
  assert.equal(t3.barsPerTick, 1, 'barsPerTick=100 → _setTuning rejected, unchanged');
  // Negative barsPerTick → rejected.
  cfgScript = { textContent: JSON.stringify({ version: 1, tuning: { barsPerTick: -1 } }) };
  env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  const t4 = A._getTuning();
  assert.equal(t4.barsPerTick, 1, 'barsPerTick=-1 → _setTuning rejected, unchanged');

  // Invalid: min out of range [1, 10000] ms → rejected.
  cfgScript = { textContent: JSON.stringify({ version: 1, tuning: { minTickMs: 0, maxTickMs: 1000 } }) };
  env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  const t5 = A._getTuning();
  assert.equal(t5.minTickMs, 400, 'min<1 → _setTuning rejected, bounds unchanged');
  assert.equal(t5.maxTickMs, 2500, 'min<1 → _setTuning rejected, bounds unchanged');
  restoreTuning(tuningSnap);
}

// ---- 1i: poolBias partial override — unlisted sections keep global ------
{
  const poolSnap = snapshotPoolBias();
  // Note: SWR_AUTOMIX.POOL_BIAS is shared across sandboxes (we reuse `A`
  // from the existing setup). Each test that mutates POOL_BIAS records
  // its own section. To verify "unlisted sections keep global" we look at
  // a section we never touch in this scenario.
  const cfgScript = { textContent: JSON.stringify({
    version: 1,
    poolBias: { chorus: { warmth: [0.0, 0.4], intensity: [0.7, 1.0] } },
  }) };
  const env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  // chorus overridden
  assert.equal(A.POOL_BIAS.chorus.warmth[0], 0.0, 'poolBias.chorus overridden');
  assert.equal(A.POOL_BIAS.chorus.warmth[1], 0.4);
  assert.equal(A.POOL_BIAS.chorus.intensity[0], 0.7);
  assert.equal(A.POOL_BIAS.chorus.intensity[1], 1.0);
  // intro, verse, prechorus, breakdown, outro: untouched (still global defaults)
  assert.equal(A.POOL_BIAS.intro.warmth[0], 0.4, 'intro untouched');
  assert.equal(A.POOL_BIAS.verse.warmth[0], 0.3, 'verse untouched');
  assert.equal(A.POOL_BIAS.prechorus.warmth[0], 0.4, 'prechorus untouched');
  assert.equal(A.POOL_BIAS.breakdown.warmth[0], 0.5, 'breakdown untouched');
  assert.equal(A.POOL_BIAS.outro.warmth[0], 0.3, 'outro untouched');
  restorePoolBias(poolSnap);
}

// ---- 1j: poolBias bounds-check — invalid range rejected -----------------
{
  const poolSnap = snapshotPoolBias();
  // We need a section that won't collide with other tests; use 'verse' but
  // first capture its current state to restore after.
  const cfgScript = { textContent: JSON.stringify({
    version: 1,
    poolBias: {
      // invalid: warmth range inverted (low > high)
      verse: { warmth: [0.9, 0.1], intensity: [0.3, 0.6] },
      // invalid: warmth[1] > 1
      chorus: { warmth: [0.0, 1.5], intensity: [0.6, 1.0] },
      // invalid: intensity[0] < 0
      intro: { warmth: [0.4, 0.6], intensity: [-0.1, 0.4] },
    },
  }) };
  const env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  // None of the bad entries should have been applied. Each section
  // should still match the snapshot taken before this scenario ran.
  assert.deepEqual(A.POOL_BIAS.verse, { warmth: poolSnap.verse.warmth.slice(), intensity: poolSnap.verse.intensity.slice() },
                   'inverted range rejected → verse untouched');
  assert.deepEqual(A.POOL_BIAS.chorus, { warmth: poolSnap.chorus.warmth.slice(), intensity: poolSnap.chorus.intensity.slice() },
                   'out-of-range warmth rejected → chorus untouched');
  assert.deepEqual(A.POOL_BIAS.intro, { warmth: poolSnap.intro.warmth.slice(), intensity: poolSnap.intro.intensity.slice() },
                   'negative intensity rejected → intro untouched');
  restorePoolBias(poolSnap);
}

// ---- 1k: ui.toggleShortcut applied (stored on runtime) ------------------
// (Task 1 fix round 2 — extended to also verify ui.toggleLabel mutates
// the DOM. The done variants all match the film.html:407 pattern:
// `<label id="automix-toggle">Automix <span id="automix-state">OFF</span></label>`
// — verify the leading text node is updated and the span child structure
// (with its state text) is preserved.)
{
  // Build the toggle element to mirror film.html:407 / grid.html:462 /
  // neon.html:404 / hallucination.html:513 / smoke.html:396 exactly.
  const toggle = makeRuntimeEnv().dom.createElement('label'); // fresh makeNode
  const span = makeRuntimeEnv().dom.createElement('span');
  span.textContent = 'OFF';
  // Append the "Automix " text node + state span as children (the order
  // matches the live DOM).
  toggle.appendChild({ nodeType: 3, textContent: 'Automix ' });
  toggle.appendChild(span);
  const cfgScript = { textContent: JSON.stringify({
    version: 1, ui: { toggleLabel: 'Auto-Mix', toggleShortcut: 'm' },
  }) };
  const env = makeRuntimeEnv({ elements: {
    'swrc-automix-config': cfgScript,
    'automix-toggle': toggle,
    'automix-state': span,
  } });
  runInContext(runtimeSrc, env.sandbox);
  const R = env.sandbox.SWR_AUTOMIX_RUNTIME;
  // toggleShortcut still stored on the runtime
  assert.equal(R._toggleShortcut(), 'm', 'ui.toggleShortcut stored (lowercased)');
  // toggleLabel: leading text node updated, span child + state preserved.
  assert.equal(toggle.childNodes.length, 2, 'toggle keeps text+span child structure');
  assert.equal(toggle.childNodes[0].nodeType, 3, 'leading child is still a text node');
  assert.equal(toggle.childNodes[0].textContent, 'Auto-Mix ',
               'leading text node reads "Auto-Mix " (label + space)');
  assert.equal(toggle.childNodes[1], span, 'span still in childNodes');
  assert.equal(toggle.childNodes[1].parentNode, toggle, 'span.parentNode still === toggle');
  assert.equal(span.textContent, 'OFF', 'span textContent (state) preserved verbatim');
}

// ---- 1n: ui.toggleLabel fallback when toggle has no #automix-state span --
// (Task 1 fix round 2 — the plain-textContent fallback path is also
// untested. Covers variants that ship a bare `<label id="automix-toggle">`
// without the inner state span — none of the current 5 done variants do,
// but the fallback should still work safely when the span is absent.)
{
  const toggle = makeRuntimeEnv().dom.createElement('label');
  // No children — fallback path: plain textContent replacement.
  const cfgScript = { textContent: JSON.stringify({
    version: 1, ui: { toggleLabel: 'Auto-Mix' },
  }) };
  const env = makeRuntimeEnv({ elements: {
    'swrc-automix-config': cfgScript,
    'automix-toggle': toggle,
    // No 'automix-state' registered → span lookup returns null → fallback.
  } });
  runInContext(runtimeSrc, env.sandbox);
  assert.equal(toggle.textContent, 'Auto-Mix',
               'toggleLabel without span → plain textContent replacement');
}

// ---- 1l: anchorMap:"all" is a no-op (reserved field) --------------------
{
  // Just verify _config has the field captured; the runtime shouldn't
  // throw or otherwise misbehave.
  const cfgScript = { textContent: JSON.stringify({ version: 1, anchorMap: 'all' }) };
  const env = makeRuntimeEnv({ elements: { 'swrc-automix-config': cfgScript } });
  runInContext(runtimeSrc, env.sandbox);
  assert.equal(env.sandbox.SWR_AUTOMIX_RUNTIME._config().anchorMap, 'all');
}

// ---- 1m: _setDriftAmplitude mutates drift() behaviour directly -----------
// (Task 1 fix round 1 — the loadConfig() path goes through this same
// setter, but this scenario proves the public surface independently.)
{
  const driftSnap = snapshotDrift();
  const baseP = { temp: 0.5, mut: 0.5, sepia: 0.5, chroma: 0.5, grain: 0.5, glow: 0.5, grayscale: 0.5, posterize: 0.5 };

  // Baseline: default amplitudes (DRIFT_BASE=0.01, DRIFT_BEAT_BONUS=0.02).
  // Beat=1 → amplitude = 0.03, step ≤ 0.031.
  for (let i = 0; i < 50; i++) {
    const d = A.drift(baseP, 1);
    for (const f of Object.keys(baseP)) {
      assert.ok(Math.abs(d[f] - baseP[f]) <= 0.032,
                'baseline beat=1 step ≤ 0.032');
    }
  }

  // Mutate via the setter to ZERO drift. Every drift() call must now be
  // a no-op (output equals input) regardless of beat — this is the
  // load-bearing proof that the closure vars were replaced, not layered.
  A._setDriftAmplitude(0.0, 0.0);
  const cur1 = A._getDriftAmplitude();
  assert.equal(cur1.base, 0.0, 'setter writes base');
  assert.equal(cur1.beatScale, 0.0, 'setter writes beatScale');
  for (let i = 0; i < 50; i++) {
    const d = A.drift(baseP, 1);
    for (const f of Object.keys(baseP)) {
      assert.ok(Math.abs(d[f] - baseP[f]) < 1e-6,
                'zero amplitude → drift is no-op (got delta ' + (d[f] - baseP[f]).toFixed(8) + ')');
    }
  }

  // Mutate to HIGH drift. Beat=1 → amplitude = 0.05 + 0.10 = 0.15.
  A._setDriftAmplitude(0.05, 0.10);
  const cur2 = A._getDriftAmplitude();
  assert.equal(cur2.base, 0.05);
  assert.equal(cur2.beatScale, 0.10);
  for (let i = 0; i < 100; i++) {
    const d = A.drift(baseP, 1);
    for (const f of Object.keys(baseP)) {
      assert.ok(Math.abs(d[f] - baseP[f]) <= 0.152,
                'high amplitude → beat=1 step ≤ 0.152');
    }
  }
  // Beat=0 → amplitude = 0.05, step ≤ 0.051.
  for (let i = 0; i < 100; i++) {
    const d = A.drift(baseP, 0);
    for (const f of Object.keys(baseP)) {
      assert.ok(Math.abs(d[f] - baseP[f]) <= 0.052,
                'high amplitude → beat=0 step ≤ 0.052');
    }
  }

  // Defensive: non-number / non-finite inputs are silently ignored
  // (amplitudes unchanged). Finite numbers in any range are clamped
  // to [0, 1] — the public setter is the load-bearing surface, so it
  // stays safe even when called from untrusted config inputs.
  A._setDriftAmplitude(NaN, 0.05);
  const cur3 = A._getDriftAmplitude();
  assert.equal(cur3.base, 0.05, 'NaN base → ignored');
  A._setDriftAmplitude('not-a-number', 0.05);
  const cur4 = A._getDriftAmplitude();
  assert.equal(cur4.base, 0.05, 'string base → ignored');
  A._setDriftAmplitude(0.05, Infinity);
  const cur5 = A._getDriftAmplitude();
  assert.equal(cur5.beatScale, 0.10, 'Infinity beatScale → ignored');

  // Finite out-of-range numbers clamp to [0, 1] (consistent with the
  // runtime's _validateDriftAmplitude contract).
  A._setDriftAmplitude(1.5, 0.02);
  const cur6 = A._getDriftAmplitude();
  assert.equal(cur6.base, 1.0, 'base>1 clamped to 1.0');
  assert.equal(cur6.beatScale, 0.02, 'beatScale applied alongside');
  A._setDriftAmplitude(0.01, -0.5);
  const cur7 = A._getDriftAmplitude();
  assert.equal(cur7.base, 0.01, 'base applied alongside');
  assert.equal(cur7.beatScale, 0.0, 'beatScale<0 clamped to 0.0');

  restoreDrift(driftSnap);
}

// ---- 1q (Task 4): validateAutomixConfig + 17-variant loop ----------------
// Schema validator for variants/<name>.automix.json. Mirrors the runtime's
// validation helpers (_validateBias, _validateDriftAmplitude,
// _validateTuning) so the unit-level shape matches what loadConfig()
// will accept at runtime. Returns { ok, errors[] } — non-fatal by design
// so a single bad field doesn't blank out the whole config.
function validateAutomixConfig(json, variantName) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, errors: ['root must be an object'] };
  }
  if (json.version !== 1) {
    errors.push('version must be 1 (got ' + JSON.stringify(json.version) + ')');
  }
  if (json.variant !== variantName) {
    errors.push('variant must match filename ("' + variantName + '", got "' + json.variant + '")');
  }
  if ('enabled' in json && typeof json.enabled !== 'boolean') {
    errors.push('enabled must be boolean when present');
  }
  if ('defaultState' in json && json.defaultState !== 'on' && json.defaultState !== 'off') {
    errors.push('defaultState must be "on" or "off" when present');
  }
  if ('poolBias' in json) {
    if (!json.poolBias || typeof json.poolBias !== 'object' || Array.isArray(json.poolBias)) {
      errors.push('poolBias must be an object');
    } else {
      const validSecs = ['intro','verse','prechorus','chorus','breakdown','outro'];
      for (const sec of Object.keys(json.poolBias)) {
        if (!validSecs.includes(sec)) {
          errors.push('poolBias section "' + sec + '" not in ' + JSON.stringify(validSecs));
          continue;
        }
        const b = json.poolBias[sec];
        if (!b || typeof b !== 'object') {
          errors.push('poolBias.' + sec + ' must be an object');
          continue;
        }
        for (const axis of ['warmth','intensity']) {
          const arr = b[axis];
          if (!Array.isArray(arr) || arr.length !== 2) {
            errors.push('poolBias.' + sec + '.' + axis + ' must be a 2-element array');
            continue;
          }
          for (let i = 0; i < 2; i++) {
            const v = arr[i];
            if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1) {
              errors.push('poolBias.' + sec + '.' + axis + '[' + i + '] must be a finite number in [0,1]');
            }
          }
          if (typeof arr[0] === 'number' && typeof arr[1] === 'number' && arr[0] > arr[1]) {
            errors.push('poolBias.' + sec + '.' + axis + ' low > high');
          }
        }
      }
    }
  }
  if ('driftAmplitude' in json) {
    if (!json.driftAmplitude || typeof json.driftAmplitude !== 'object') {
      errors.push('driftAmplitude must be an object');
    } else {
      for (const k of ['base','beatScale']) {
        const v = json.driftAmplitude[k];
        if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1) {
          errors.push('driftAmplitude.' + k + ' must be a finite number in [0,1]');
        }
      }
    }
  }
  if ('tuning' in json) {
    if (!json.tuning || typeof json.tuning !== 'object') {
      errors.push('tuning must be an object');
    } else {
      // Phase 5: accept either barsPerTick (preferred) OR the legacy
      // minTickMs/maxTickMs pair. At least one valid knob must be present
      // when `tuning` is supplied at all.
      var hasBars = typeof json.tuning.barsPerTick === 'number'
        && isFinite(json.tuning.barsPerTick)
        && json.tuning.barsPerTick >= 1 && json.tuning.barsPerTick <= 32;
      var hasMs = typeof json.tuning.minTickMs === 'number'
        && isFinite(json.tuning.minTickMs)
        && json.tuning.minTickMs >= 1 && json.tuning.minTickMs <= 10000
        && typeof json.tuning.maxTickMs === 'number'
        && isFinite(json.tuning.maxTickMs)
        && json.tuning.maxTickMs >= 1 && json.tuning.maxTickMs <= 10000
        && json.tuning.minTickMs <= json.tuning.maxTickMs;
      if (!hasBars && !hasMs) {
        if (typeof json.tuning.barsPerTick !== 'undefined') {
          errors.push('tuning.barsPerTick must be a finite integer in [1,32] when present');
        }
        if (typeof json.tuning.minTickMs !== 'undefined' || typeof json.tuning.maxTickMs !== 'undefined') {
          errors.push('tuning.minTickMs/maxTickMs must both be finite numbers in [1,10000] with min <= max when present');
        }
      }
    }
  }
  if ('anchorMap' in json && json.anchorMap !== 'all') {
    errors.push('anchorMap must be "all" when present');
  }
  if ('ui' in json) {
    if (!json.ui || typeof json.ui !== 'object') {
      errors.push('ui must be an object');
    } else {
      if ('toggleLabel' in json.ui && (typeof json.ui.toggleLabel !== 'string' || json.ui.toggleLabel.length === 0)) {
        errors.push('ui.toggleLabel must be a non-empty string when present');
      }
      if ('toggleShortcut' in json.ui && (typeof json.ui.toggleShortcut !== 'string' || json.ui.toggleShortcut.length !== 1)) {
        errors.push('ui.toggleShortcut must be a single character when present');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// 17 known variants — covers all enabled (15) + the 2 disabled
// (echo-manifold, tape). Disabled variants still must satisfy the schema
// even though the runtime hides #automix-toggle when enabled=false.
const VARIANT_NAMES = [
  'aurora', 'baroque', 'chrome', 'collage', 'echo-manifold',
  'eclipse', 'fractal', 'glitch', 'kraft', 'mosaic',
  'phosphor', 'pulse', 'spectrum', 'tape', 'typography',
  'void', 'watercolor',
];
{
  const allErrors = [];
  const variantsDir = new URL('../variants/', import.meta.url);
  for (const name of VARIANT_NAMES) {
    let json;
    try {
      const raw = readFileSync(new URL(name + '.automix.json', variantsDir), 'utf8');
      json = JSON.parse(raw);
    } catch (e) {
      allErrors.push(name + ': ' + e.message);
      continue;
    }
    const res = validateAutomixConfig(json, name);
    if (!res.ok) {
      allErrors.push(name + ': ' + res.errors.join('; '));
    }
  }
  assert.equal(allErrors.length, 0,
               'every variant config must validate cleanly (got errors: ' + JSON.stringify(allErrors) + ')');
}

// Spot-check the disabled variants are flagged with enabled=false (so
// runtime contract tests below can rely on this state). tape was enabled
// once lib/media-feat closed its audio-feature gap (see AGENTS.md) —
// echo-manifold is the sole remaining opt-out (no FX surface to drive).
{
  for (const name of ['echo-manifold']) {
    const raw = readFileSync(new URL('../variants/' + name + '.automix.json', import.meta.url), 'utf8');
    const json = JSON.parse(raw);
    assert.equal(json.enabled, false, name + ' config must have enabled:false');
  }
}

// Negative-case sanity: a deliberately broken config must produce errors.
// This guards against the validator turning into a no-op (always ok).
{
  const bad = validateAutomixConfig({
    version: 2, variant: 'mismatched',
    enabled: 'yes', defaultState: 'maybe',
    poolBias: { made_up: { warmth: [0.5, 0.1], intensity: [-0.5, 1.5] } },
    driftAmplitude: { base: 2.0, beatScale: -1.0 },
    tuning: { minTickMs: 2000, maxTickMs: 500 },
    anchorMap: 'sparse',
    ui: { toggleLabel: '', toggleShortcut: 'ab' },
  }, 'mismatched');
  assert.equal(bad.ok, false, 'broken config must fail validation');
  assert.ok(bad.errors.length >= 8, 'broken config must produce multiple errors (got ' + bad.errors.length + ')');
}

// ---- 1p: _setTuning mutates computeTickInterval behaviour directly -------
// Phase 5: setter is bars-based (preferred) with a legacy ms-pair
// fallback that derives barsPerTick from the midpoint at 120 BPM. Mirrors
// the 1m _setDriftAmplitude shape — proves the public surface independently
// of the loadConfig() path.
{
  const tuningSnap = snapshotTuning();
  // ----- barsPerTick path (canonical) -----
  A._setTuning(undefined, undefined, 4);
  const cur1 = A._getTuning();
  assert.equal(cur1.barsPerTick, 4, 'setter writes barsPerTick');
  // 4 bars at 120 BPM: ceil 1.5× = 12000ms, floor 0.5× = 4000ms.
  assert.equal(A.computeTickInterval({ rms: 0, onset: 0 }), 12000,
               'barsPerTick=4, intensity=0 → 12000ms');
  assert.equal(A.computeTickInterval({ rms: 1, onset: 1 }), 4000,
               'barsPerTick=4, intensity=1 → 4000ms');

  // ----- legacy ms path (back-compat): derives bars from midpoint -----
  // midpoint = 1000 → round(1000/2000) = 1 bar at 120 BPM.
  A._setTuning(200, 1800);
  const cur2 = A._getTuning();
  assert.equal(cur2.minTickMs, 200, 'legacy setter writes minTickMs');
  assert.equal(cur2.maxTickMs, 1800, 'legacy setter writes maxTickMs');
  assert.equal(cur2.barsPerTick, 1, 'legacy midpoint 1000 → barsPerTick=1');
  assert.equal(A.computeTickInterval({ rms: 0, onset: 0 }), 3000,
               'legacy ms → barsPerTick=1, intensity=0 → 3000ms');
  assert.equal(A.computeTickInterval({ rms: 1, onset: 1 }), 1000,
               'legacy ms → barsPerTick=1, intensity=1 → 1000ms');

  // ----- defensive: non-number / non-finite inputs are silently ignored -----
  A._setTuning(NaN, 1000);
  const cur3 = A._getTuning();
  assert.equal(cur3.minTickMs, 200, 'NaN min → ignored');
  A._setTuning(500, 'not-a-number');
  const cur4 = A._getTuning();
  assert.equal(cur4.maxTickMs, 1800, 'string max → ignored');
  A._setTuning(undefined, undefined, NaN);
  assert.equal(A._getTuning().barsPerTick, 1, 'NaN barsPerTick → ignored');

  // ----- out-of-range / inverted-range inputs are clamped or rejected -----
  A._setTuning(99999, 1000); // min>max → rejected, state unchanged
  const cur5 = A._getTuning();
  assert.equal(cur5.barsPerTick, 1, 'min>max → rejected, barsPerTick unchanged');
  // barsPerTick > 32 is clamped to 32 (forgiving for callers, mirrors the
  // _validateTuning range contract). Setter accepts the clamped value
  // rather than rejecting silently.
  A._setTuning(undefined, undefined, 100); // > 32 → clamped to 32
  assert.equal(A._getTuning().barsPerTick, 32, 'barsPerTick>32 → clamped to 32');
  A._setTuning(undefined, undefined, 0); // < 1 → clamped to 1
  assert.equal(A._getTuning().barsPerTick, 1, 'barsPerTick<1 → clamped to 1');

  // ----- valid setter call after rejections restores expected state -----
  A._setTuning(undefined, undefined, 8);
  assert.equal(A._getTuning().barsPerTick, 8, 'valid setter after rejections works');
  assert.equal(A.computeTickInterval({ rms: 0, onset: 0 }), 24000,
               'barsPerTick=8, intensity=0 → 24000ms');

  // ----- live-getter parity: by-value exports track the closure vars -----
  A._setTuning(undefined, undefined, 12);
  assert.equal(A.BARS_PER_TICK, 12, 'live getter BARS_PER_TICK tracks closure var');
  // legacy live-getter still surfaces the last ms-pair write so callers
  // that migrated from v1 (and external test suites that read it) keep
  // working. Write through the legacy path then read it back.
  A._setTuning(123, 4567);
  assert.equal(A.TICK_INTERVAL_MIN_MS, 123, 'live getter TICK_INTERVAL_MIN_MS tracks legacy ms setter');
  assert.equal(A.TICK_INTERVAL_MAX_MS, 4567, 'live getter TICK_INTERVAL_MAX_MS tracks legacy ms setter');

  restoreTuning(tuningSnap);
}

console.log('AUTOMIX UNIT: ALL GREEN (58 tests)');