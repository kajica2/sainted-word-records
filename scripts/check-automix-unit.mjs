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

// ---- Phase 1.1: computeTickInterval -------------------------------------
assert.equal(A.computeTickInterval(null), 3000, 'null features → max interval (3000ms)');
assert.equal(A.computeTickInterval({}), 3000, 'empty features → max interval (3000ms)');
assert.equal(A.computeTickInterval({ rms: 1.0, onset: 1.0 }), 500,
             'max-intensity features → min interval (500ms)');
// mid intensity (~0.5)
const mid = A.computeTickInterval({ rms: 0.33, onset: 0 });
assert.ok(mid > 1500 && mid < 2000, 'mid intensity should land in (1500, 2000), got ' + mid);
// intensity clipped to [0, 1] even with huge inputs
const clipped = A.computeTickInterval({ rms: 99, onset: 99 });
assert.equal(clipped, 500, 'clamped at min interval');
// intensity clipped to [0, 1] from negative inputs
const noNeg = A.computeTickInterval({ rms: -1, onset: -1 });
assert.equal(noNeg, 3000, 'clamped at max interval');

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

console.log('AUTOMIX UNIT: ALL GREEN (33 tests)');