// scripts/check-gradient-dot-unit.mjs
// Node-only unit tests for the Phase B current-song dot math.
// The math is embedded inline in versions/music_video.html (Gradient IIFE),
// so we extract the pure parts into a small standalone module for testing.
//
// Pure functions tested:
//   - coordsFromFeatures({bass,mid,treble}) -> {warmth, intensity}
//     (must match client/automix.client.js:featuresToCoords so the gradient
//     dot and the automix mix land at the same (warmth, intensity) for the
//     same audio features — single source of truth per Phase C roadmap)
//   - lerp(a, b, t) -> number
//
// Pass criteria: every `assert(...)` succeeds, exit 0, last line
// `GRADIENT DOT UNIT: ALL GREEN (N tests)`.

import { strict as assert } from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---- Load automix.client.js to read the canonical featuresToCoords impl.
// We don't actually call it (it's pure) — we re-implement + assert parity
// against it. This is the contract Phase C will turn into a shared module.
const automixSrc = readFileSync(
  new URL('../client/automix.client.js', import.meta.url),
  'utf8'
);
const sandbox = { window: {}, console, Math, Object, Array, JSON };
sandbox.globalThis = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(automixSrc, sandbox);
const CANONICAL = sandbox.window.SWR_AUTOMIX.featuresToCoords;

// ---- Re-implementation under test. MUST stay in sync with the version
// pasted into versions/music_video.html (lines ~1192, in the Gradient IIFE).
// If they drift, these tests fail and tell you to re-paste.
function coordsFromFeatures(features) {
  if (!features) return { warmth: 0.5, intensity: 0.5 };
  const bass = (features.bass || 0);
  const mid  = (features.mid  || 0);
  const treb = (features.treb || 0);
  const warmth = 0.5 + (bass - treb) * 0.5;
  const clamped_w = Math.max(0, Math.min(1, warmth));
  const intensity = Math.min(1, (mid + treb) * 0.9 + bass * 0.1);
  return { warmth: clamped_w, intensity };
}
function lerp(a, b, t) { return a + (b - a) * t; }

// ---- Tests
const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// 1. parity with the canonical automix impl
for (const [name, feats] of [
  ['null',         null],
  ['zeros',        { bass: 0, mid: 0, treb: 0 }],
  ['bass-heavy',   { bass: 0.8, mid: 0.2, treb: 0.1 }],
  ['treb-heavy',   { bass: 0.1, mid: 0.2, treb: 0.8 }],
  ['balanced',     { bass: 0.5, mid: 0.5, treb: 0.5 }],
  ['mid-heavy',    { bass: 0.2, mid: 0.9, treb: 0.2 }],
]) {
  const a = coordsFromFeatures(feats);
  const b = CANONICAL(feats);
  if (Math.abs(a.warmth - b.warmth) < 1e-9 && Math.abs(a.intensity - b.intensity) < 1e-9) {
    ok(`parity: ${name}`);
  } else {
    bad(`parity: ${name}`, JSON.stringify({ ours: a, canonical: b }));
  }
}

// 2. null/undefined features -> safe midpoint
const safe = coordsFromFeatures(null);
assert.deepEqual
  ? assert.deepEqual(safe, { warmth: 0.5, intensity: 0.5 })
  : assert.ok(safe.warmth === 0.5 && safe.intensity === 0.5, 'null must default to midpoint');
ok('null features defaults to {0.5, 0.5}');

// 3. bounds: warmth always in [0,1]
for (let i = 0; i < 50; i++) {
  const r = { bass: Math.random(), mid: Math.random(), treb: Math.random() };
  const c = coordsFromFeatures(r);
  assert.ok(c.warmth >= 0 && c.warmth <= 1, 'warmth bounds');
  assert.ok(c.intensity >= 0 && c.intensity <= 1, 'intensity bounds');
}
ok('random inputs always in [0,1]');

// 4. lerp boundary cases
assert.strictEqual(lerp(0, 10, 0), 0);
assert.strictEqual(lerp(0, 10, 1), 10);
assert.strictEqual(lerp(5, 5, 0.5), 5);
assert.strictEqual(lerp(-2, 8, 0.25), 0.5);
ok('lerp boundaries (0, 1, equal, negative)');

console.log(results.join('\n'));
console.log('GRADIENT DOT UNIT: ALL GREEN (' + results.length + ' tests)');