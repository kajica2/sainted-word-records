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
// automix.client.js (neighbours + preset shape).
const ANCHORS = {
  neon:   { warmth: 0.5, intensity: 0.6, preset: { temp: -0.3, mut: 0.55, sepia: 0.0,  chroma: 0.85, grain: 0.40, glow: 0.4, grayscale: 0.0,  posterize: 0.10 } },
  film:   { warmth: 0.7, intensity: 0.4, preset: { temp:  0.3, mut: 0.20, sepia: 0.70, chroma: 0.0,  grain: 0.85, glow: 0.15, grayscale: 0.0,  posterize: 0.0  } },
  void:   { warmth: 0.2, intensity: 0.2, preset: { temp: -0.45,mut: 0.05, sepia: 0.0,  chroma: 0.05, grain: 0.55, glow: 0.1, grayscale: 0.4,  posterize: 0.60 } },
  glitch: { warmth: 0.4, intensity: 0.9, preset: { temp:  0.0, mut: 0.90, sepia: 0.0,  chroma: 0.7,  grain: 0.50, glow: 0.1, grayscale: 0.0,  posterize: 0.35 } },
};

const sandbox = {
  window: {},
  console,
  Math, // for drift()
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

// featuresToCoords: bass-heavy → warmth > 0.5; treb-heavy → warmth < 0.5
const warm  = A.featuresToCoords({ bass: 0.8, mid: 0.2, treb: 0.1 });
const cool  = A.featuresToCoords({ bass: 0.1, mid: 0.2, treb: 0.8 });
assert.ok(warm.warmth  > 0.5, 'bass-heavy should skew warm, got ' + warm.warmth);
assert.ok(cool.warmth  < 0.5, 'treb-heavy should skew cool, got ' + cool.warmth);
assert.ok(warm.intensity >= 0 && warm.intensity <= 1, 'intensity must be in [0,1]');
assert.ok(cool.intensity >= 0 && cool.intensity <= 1, 'intensity must be in [0,1]');

// null/undefined features → safe midpoint
const safe = A.featuresToCoords(null);
assert.equal(safe.warmth, 0.5, 'null features must default to warmth=0.5');
assert.equal(safe.intensity, 0.5, 'null features must default to intensity=0.5');

// blendAnchors: 2 anchors of equal weight + equal distance → arithmetic mean
const blend = A.blendAnchors([
  { id: 'a', dist: 0.1, anchor: ANCHORS.neon },
  { id: 'b', dist: 0.1, anchor: ANCHORS.film },
]);
const expectedTemp = (ANCHORS.neon.preset.temp + ANCHORS.film.preset.temp) / 2;
assert.ok(Math.abs(blend.temp - expectedTemp) < 1e-6, 'equal weights must give arithmetic mean');

// mix: full pipeline returns { coords, anchors, preset } with all 8 fields
const mixed = A.mix({ bass: 0.5, mid: 0.5, treb: 0.5 }, 2);
assert.ok(mixed && mixed.coords && mixed.anchors && mixed.preset, 'mix must return full envelope');
assert.equal(mixed.anchors.length, 2, 'must honour neighbours count');
assert.equal(typeof mixed.preset.temp, 'number');
assert.equal(typeof mixed.preset.glow, 'number');

// drift: clamped to [-1, 1] and within ±0.02 of input
const base = { temp: 0.5, mut: 0.5, sepia: 0.5, chroma: 0.5, grain: 0.5, glow: 0.5, grayscale: 0.5, posterize: 0.5 };
for (let i = 0; i < 50; i++) {
  const d = A.drift(base);
  for (const f of Object.keys(base)) {
    assert.ok(d[f] >= -1 && d[f] <= 1, 'drift must clamp to [-1,1]');
    assert.ok(Math.abs(d[f] - base[f]) <= 0.021, 'drift step must be ≤ 0.02');
  }
}

// mix without neighbours arg picks up HologramState.neighbours if present
sandbox.window.HologramState = { neighbours: 3 };
const m2 = A.mix({ bass: 0.5, mid: 0.5, treb: 0.5 });
assert.equal(m2.anchors.length, 3, 'HologramState.neighbours must override default n');

console.log('AUTOMIX UNIT: ALL GREEN (8 tests)');
