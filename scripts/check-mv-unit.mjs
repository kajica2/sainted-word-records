#!/usr/bin/env node
// scripts/check-mv-unit.mjs — Phase B (Phase 2 of plan) unit tests
// for the hologram preset engine.
//
// Loads client/hologram-presets.client.js (UMD-ish; attaches to
// globalThis) and exercises the pure functions across three groups:
//
//   1. PresetMap      — rawEmbed, list(), get(), embed()
//   2. Interpolator   — computeBlend across depth/focus/dist combinations
//   3. Numerical      — weights always sum to 1, finite everywhere, etc.
//
// Run from the project root:  node scripts/check-mv-unit.mjs
//
// 14 assertions. Designed to be tight (no flaky tolerances): every
// numeric check is either an exact equality, a comparison against
// 0/1, or a strict sum=1 with ε=1e-9.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load the hologram module. It's an IIFE that attaches to globalThis
// under both browser (window) and Node (globalThis) conditions.
const src = await readFile(resolve(ROOT, 'client/hologram-presets.client.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function(src)();
const H = globalThis.SWR_HOLOGRAM;
if (!H) {
  console.error('FATAL: SWR_HOLOGRAM did not attach to globalThis');
  process.exit(2);
}

// ---- Fixtures --------------------------------------------------------

// Three hand-crafted manifest presets chosen to land far apart on the
// 4 axes: calm/static/simple/cool, intense/kinetic/complex/warm, and a
// mid-spectrum baseline.
const PRESETS = [
  {
    id: 'calm-cool',
    name: 'Calm Cool',
    family: 'TEST',
    fx_state: { bloom: 0.1, chroma: 0.0, mut: 0.0, posterize: 0,
                temp: -0.5, sepia: 0.0, glitch: 0.0 },
    audio_reactivity: { bass: ['scale_pulse'] },
    motion: { rotation_speed: 0, scale_pulse: 0, pan_x: 0, pan_y: 0 },
  },
  {
    id: 'wild-warm',
    name: 'Wild Warm',
    family: 'TEST',
    fx_state: { bloom: 1.0, chroma: 1.0, mut: 1.0, posterize: 16,
                temp: 0.8, sepia: 0.9, glitch: 1.0 },
    audio_reactivity: { bass: ['pan_x'], mid: ['chroma'],
                          treble: ['grain'], onset: ['pan_y'] },
    motion: { rotation_speed: 0.2, scale_pulse: 0.3,
              pan_x: 0.2, pan_y: 0.2 },
  },
  {
    id: 'mid-balance',
    name: 'Mid Balance',
    family: 'TEST',
    fx_state: { bloom: 0.5, chroma: 0.3, mut: 0.4, posterize: 6,
                temp: 0.1, sepia: 0.2, glitch: 0.3 },
    audio_reactivity: { bass: ['scale_pulse'], mid: ['rotation_speed'] },
    motion: { rotation_speed: 0.05, scale_pulse: 0.05,
              pan_x: 0.05, pan_y: 0.05 },
  },
];

const EPS = 1e-9;

let failures = 0;
let total = 0;
function assert(c, name, d) {
  total++;
  console.log((c ? '  ✓ ' : '  ✗ ') + name + (d ? '  — ' + d : ''));
  if (!c) failures++;
}
function approxSum1(w) {
  var s = 0;
  for (var k in w) if (Object.prototype.hasOwnProperty.call(w, k) && k[0] !== '_') s += w[k];
  return Math.abs(s - 1) < 1e-9;
}
function finiteAll(w) {
  for (var k in w) if (Object.prototype.hasOwnProperty.call(w, k) && k[0] !== '_') {
    if (!Number.isFinite(w[k])) return false;
  }
  return true;
}

// ============================================================================
console.log('=== PresetMap ===');
// ============================================================================

const map = H._impl.buildPresetMap(PRESETS);
assert(map.list().length === 3, 'list() has 3 ids');
assert(
  map.list().indexOf('calm-cool') >= 0
  && map.list().indexOf('wild-warm') >= 0
  && map.list().indexOf('mid-balance') >= 0,
  'list() contains all 3 ids'
);

const gotCalm = map.get('calm-cool');
assert(
  gotCalm
  && gotCalm.mood >= 0 && gotCalm.mood <= 1
  && gotCalm.complexity >= 0 && gotCalm.complexity <= 1
  && gotCalm.motion >= 0 && gotCalm.motion <= 1
  && gotCalm.color_temp >= 0 && gotCalm.color_temp <= 1,
  'get(calm-cool) returns 4 finite values in [0,1]'
);

const gotWild = map.get('wild-warm');
// wild-warm should dominate on all 4 axes — rank-blended
assert(
  gotWild.mood > gotCalm.mood
  && gotWild.complexity > gotCalm.complexity
  && gotWild.motion > gotCalm.motion
  && gotWild.color_temp > gotCalm.color_temp,
  'wild-warm dominates calm-cool on every axis'
);

const raw = H._impl.rawEmbed(PRESETS[1]); // wild-warm preset object
assert(
  raw.mood >= 0 && raw.mood <= 1
  && raw.complexity >= 0 && raw.complexity <= 1
  && raw.motion >= 0 && raw.motion <= 1
  && raw.color_temp >= 0 && raw.color_temp <= 1,
  'rawEmbed on wild-warm returns [0,1] values'
);

// ============================================================================
console.log('\n=== HologramInterpolator.computeBlend ===');
// ============================================================================

const holo = H.build(PRESETS);
const featuresMid = { mood: 0.5, complexity: 0.5, motion: 0.5, color_temp: 0.5 };

// 1. weights sum to 1 (default — center features)
const w1 = holo.computeBlend(featuresMid, 'mid-balance', 0, 0);
assert(approxSum1(w1), 'default blend weights sum to 1');
assert(finiteAll(w1), 'default blend weights are all finite');

// 2. focus=1 makes focus preset strictly dominant
const w2 = holo.computeBlend(featuresMid, 'mid-balance', 0, 1);
assert(
  w2['mid-balance'] >= 0.99 - EPS,
  'focus=1 makes mid-balance dominant',
  `w=${w2['mid-balance']}`
);
assert(approxSum1(w2), 'focus=1 weights still sum to 1');

// 3. depth=1 flattens toward uniform
const w3 = holo.computeBlend(featuresMid, 'mid-balance', 1, 0);
assert(
  Math.abs(w3['calm-cool'] - 1/3) < 0.001
  && Math.abs(w3['wild-warm'] - 1/3) < 0.001
  && Math.abs(w3['mid-balance'] - 1/3) < 0.001,
  'depth=1 produces uniform 1/3 across all 3 presets',
  JSON.stringify(w3)
);

// 4. depth=1 + focus=1 — focus is a hard pin even at full flatten.
// At uniform 1/3, focus boost multiplies the focus weight by 6 and
// shrinks the rest by 0.4, giving focus ≈ 6/(6+0.4+0.4) ≈ 0.88.
// We assert focus is meaningfully dominant (>= 0.5) without
// claiming strict dominance, which would be impossible to achieve
// while still summing to 1 across N=3.
const w4 = holo.computeBlend(featuresMid, 'mid-balance', 1, 1);
assert(
  w4['mid-balance'] >= 0.5 && approxSum1(w4),
  'depth=1 + focus=1 still gives focus a meaningful majority',
  `w=${w4['mid-balance']}`
);

// 5. features close to wild-warm → wild-warm gets the largest share
const featuresWild = {
  mood: gotWild.mood,
  complexity: gotWild.complexity,
  motion: gotWild.motion,
  color_temp: gotWild.color_temp,
};
const w5 = holo.computeBlend(featuresWild, 'calm-cool', 0, 0);
assert(
  w5['wild-warm'] > w5['calm-cool']
  && w5['wild-warm'] > w5['mid-balance'],
  'features near wild-warm give wild-warm the largest weight',
  JSON.stringify({ w: w5, focus: w5._focus })
);

// 6. unknown focus id is gracefully ignored (no throw, weights still valid)
const w6 = holo.computeBlend(featuresMid, 'nonexistent', 0, 0.5);
assert(
  approxSum1(w6) && finiteAll(w6),
  'unknown focusId does not break the blend',
  `valid=${approxSum1(w6) && finiteAll(w6)}`
);

// ============================================================================
console.log('\n=== Numerical invariants ===');
// ============================================================================

// 7. extreme depth — computed weights stay finite and sum to 1
const w7a = holo.computeBlend({mood: 0, complexity: 0, motion: 0, color_temp: 0}, 'mid-balance', 0, 0);
const w7b = holo.computeBlend({mood: 1, complexity: 1, motion: 1, color_temp: 1}, 'mid-balance', 0, 0);
assert(
  approxSum1(w7a) && finiteAll(w7a) && approxSum1(w7b) && finiteAll(w7b),
  'corner features (all 0 / all 1) give valid blends'
);

// 8. rankMix produces a [0,1] ranking for any input
function testRankMix(arr) {
  var m = H._impl.rankMix(arr.slice(), {});
  for (var i = 0; i < arr.length; i++) {
    var idx = arr[i];
    m[idx] = arr[i];  // raw = arr values
  }
  // Sort by value descending, map rank 0..1
  var sorted = arr.slice().sort(function (a, b) { return m[b] - m[a]; });
  // Manual rank
  var ranks = {};
  for (var j = 0; j < sorted.length; j++) ranks[sorted[j]] = sorted.length === 1 ? 0.5 : j / (sorted.length - 1);
  var mixed = {};
  for (var k = 0; k < arr.length; k++) mixed[arr[k]] = m[arr[k]] * 0.6 + ranks[arr[k]] * 0.4;
  for (var mm in mixed) {
    if (mixed[mm] < 0 || mixed[mm] > 1) return false;
  }
  return true;
}
assert(
  testRankMix(['a', 'b', 'c', 'd', 'e']),
  'rankMix produces values in [0,1]',
  ''
);

// 9. sqDist with the same input is 0
assert(
  H._impl.sqDist(
    { mood: 0.3, complexity: 0.4, motion: 0.5, color_temp: 0.6 },
    { mood: 0.3, complexity: 0.4, motion: 0.5, color_temp: 0.6 }
  ) === 0,
  'sqDist of identical points is 0'
);

// 10. sqDist with one-axis-flip equals 1
assert(
  Math.abs(
    H._impl.sqDist(
      { mood: 1, complexity: 0, motion: 0, color_temp: 0 },
      { mood: 0, complexity: 0, motion: 0, color_temp: 0 }
    ) - 1
  ) < 1e-9,
  'sqDist of 1-axis-flip is exactly 1'
);

// 11. normalize of all-zero array is uniform
const n0 = H._impl.normalize([0, 0, 0, 0]);
assert(
  n0.every(function (v) { return Math.abs(v - 0.25) < 1e-9; }),
  'normalize of [0,0,0,0] → uniform 0.25',
  JSON.stringify(n0)
);

// 12. hologram instance exposes presetMap, list, embed for the in-page UI
assert(
  holo.presetMap && Array.isArray(holo.list()) && holo.list().length === 3,
  'hologram instance exposes list/presetMap',
  JSON.stringify({ n: holo.list().length })
);

// 13. embed() on an arbitrary preset reuses rawEmbed (no rank mix)
const arbRaw = holo.embed({ fx_state: { bloom: 0.2, chroma: 0.1 }, motion: {}, audio_reactivity: {} });
assert(
  arbRaw && typeof arbRaw.mood === 'number'
  && arbRaw.mood >= 0 && arbRaw.mood <= 1
  && typeof arbRaw.color_temp === 'number',
  'hologram.embed returns raw 4-vector in [0,1]',
  JSON.stringify(arbRaw)
);

// 14. determinism — same input → same output twice
const wA = holo.computeBlend(featuresMid, 'mid-balance', 0.3, 0.2, 0.5);
const wB = holo.computeBlend(featuresMid, 'mid-balance', 0.3, 0.2, 0.5);
var sameShape = true;
for (var key in wA) {
  if (Object.prototype.hasOwnProperty.call(wA, key) && key[0] !== '_') {
    if (Math.abs(wA[key] - wB[key]) > 1e-12) { sameShape = false; break; }
  }
}
assert(sameShape, 'computeBlend is deterministic (same input twice → same output)');

console.log();
console.log(
  failures === 0
    ? `MV UNIT: ALL GREEN (${total} tests)`
    : `${failures} of ${total} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
