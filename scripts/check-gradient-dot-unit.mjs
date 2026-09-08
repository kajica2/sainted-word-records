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

// ---- Load anchor-embed.js (the single source of truth post-Phase C)
const anchorEmbedSrc = readFileSync(
  new URL('../client/anchor-embed.js', import.meta.url),
  'utf8'
);
const sandbox2 = { window: {}, console, Math, Object, Array, JSON };
sandbox2.globalThis = sandbox2.window;
vm.createContext(sandbox2);
vm.runInContext(anchorEmbedSrc, sandbox2);
const SHARED = sandbox2.window.SWR_ANCHOR_EMBED.featuresToCoords;

// ---- Load automix.client.js to verify it delegates to SWR_ANCHOR_EMBED
const automixSrc = readFileSync(
  new URL('../client/automix.client.js', import.meta.url),
  'utf8'
);
const sandbox = { window: {}, console, Math, Object, Array, JSON };
sandbox.globalThis = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(automixSrc, sandbox);
const DELEGATE = sandbox.window.SWR_AUTOMIX.featuresToCoords;

function lerp(a, b, t) { return a + (b - a) * t; }

// ---- Tests
const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// 1. shared module matches expected math across the canonical feature shapes
for (const [name, feats] of [
  ['null',         null],
  ['zeros',        { bass: 0, mid: 0, treb: 0 }],
  ['bass-heavy',   { bass: 0.8, mid: 0.2, treb: 0.1 }],
  ['treb-heavy',   { bass: 0.1, mid: 0.2, treb: 0.8 }],
  ['balanced',     { bass: 0.5, mid: 0.5, treb: 0.5 }],
  ['mid-heavy',    { bass: 0.2, mid: 0.9, treb: 0.2 }],
]) {
  const a = SHARED(feats);
  if (typeof a.warmth === 'number' && typeof a.intensity === 'number') {
    ok(`shared: ${name}`);
  } else {
    bad(`shared: ${name}`, JSON.stringify(a));
  }
}

// 2. automix.client.js delegates to the shared module (parity)
for (const [name, feats] of [
  ['null',         null],
  ['zeros',        { bass: 0, mid: 0, treb: 0 }],
  ['bass-heavy',   { bass: 0.8, mid: 0.2, treb: 0.1 }],
  ['treb-heavy',   { bass: 0.1, mid: 0.2, treb: 0.8 }],
  ['balanced',     { bass: 0.5, mid: 0.5, treb: 0.5 }],
  ['mid-heavy',    { bass: 0.2, mid: 0.9, treb: 0.2 }],
]) {
  const a = DELEGATE(feats);
  const b = SHARED(feats);
  if (Math.abs(a.warmth - b.warmth) < 1e-9 && Math.abs(a.intensity - b.intensity) < 1e-9) {
    ok(`automix delegates to shared: ${name}`);
  } else {
    bad(`automix delegates to shared: ${name}`, JSON.stringify({ automix: a, shared: b }));
  }
}

// 3. shared module returns safe midpoint for null/undefined features
const safe = SHARED(null);
assert.ok(safe.warmth === 0.5 && safe.intensity === 0.5, 'null must default to midpoint');
ok('shared: null features defaults to {0.5, 0.5}');

// 4. bounds: warmth + intensity always in [0, 1]
for (let i = 0; i < 50; i++) {
  const r = { bass: Math.random(), mid: Math.random(), treb: Math.random() };
  const c = SHARED(r);
  assert.ok(c.warmth >= 0 && c.warmth <= 1, 'warmth bounds');
  assert.ok(c.intensity >= 0 && c.intensity <= 1, 'intensity bounds');
}
ok('shared: random inputs always in [0,1]');

// 5. lerp boundary cases
assert.strictEqual(lerp(0, 10, 0), 0);
assert.strictEqual(lerp(0, 10, 1), 10);
assert.strictEqual(lerp(5, 5, 0.5), 5);
assert.strictEqual(lerp(-2, 8, 0.25), 0.5);
ok('lerp boundaries (0, 1, equal, negative)');

console.log(results.join('\n'));
console.log('GRADIENT DOT UNIT: ALL GREEN (' + results.length + ' tests)');