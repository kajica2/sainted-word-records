#!/usr/bin/env node
// scripts/check-get-preset-unit.mjs
//
// Node-only unit tests for the __SWR_GET_PRESET helper in
// versions-presets.js. Returns a normalised fx_state object from the
// preset table by id, or null if unknown. The music_video page uses it
// via VersionsPresets.setPresetOverride(id) for clickable neighbour jumps.
//
// Strategy: load versions-presets.js in a vm sandbox with just enough
// stubs to bypass init() and expose window.__SWR_GET_PRESET. Then call
// the helper directly.
//
// Pass criteria: every assertion succeeds, exit 0, last line
// `GET PRESET UNIT: ALL GREEN (N tests)`.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(
  new URL('../versions-presets.js', import.meta.url),
  'utf8'
);

function noop() {}
const sandbox = {
  console: { ...console, warn: () => {}, error: () => {}, log: () => {} },
  Math, Object, Array, JSON, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array,
  document: {
    addEventListener: noop,
    getElementById: () => null,
    createElement: () => null,
    body: null,
    documentElement: null,
    title: '',
  },
  window: {
    addEventListener: noop,
    SWR: {},
    VersionsPresets: undefined,
  },
  requestAnimationFrame: () => 0,
  performance: { now: () => 0 },
  Date,
};
sandbox.globalThis = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const getPreset = sandbox.window.__SWR_GET_PRESET;
assert.ok(typeof getPreset === 'function', '__SWR_GET_PRESET must be a function');

// ---- Tests ----------------------------------------------------------------
const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// 1. Known preset (neon) returns the right fx_state values.
{
  const out = getPreset('neon');
  assert.ok(out, 'neon must resolve');
  assert.strictEqual(out.temp, -0.3);
  assert.strictEqual(out.mut, 0.55);
  assert.strictEqual(out.chroma, 0.85);
  assert.strictEqual(out.grain, 0.4);
  ok('neon: 4 fields match PRESETS.neon');
}

// 2. All 19 named presets resolve without throwing.
{
  const knownIds = ['film','grid','neon','smoke','hallucination','eclipse','aurora','chrome','fractal','glitch','pulse','void','watercolor','baroque','gallery','kraft','mosaic','phosphor','tape'];
  for (const id of knownIds) {
    const out = getPreset(id);
    assert.ok(out, id + ' must resolve');
    for (const k of ['temp','mut','sepia','chroma','grain','glow','grayscale','posterize']) {
      assert.strictEqual(typeof out[k], 'number', id + '.' + k + ' must be a number');
    }
  }
  ok('all 19 named presets resolve with 8 numeric fields');
}

// 3. Unknown id returns null (not undefined, not an exception).
{
  const out = getPreset('this-preset-does-not-exist');
  assert.strictEqual(out, null, 'unknown id returns null');
  ok('unknown id → null');
}

// 4. Empty string + non-string ids return null.
{
  assert.strictEqual(getPreset(''), null, 'empty string → null');
  assert.strictEqual(getPreset(null), null, 'null → null');
  assert.strictEqual(getPreset(undefined), null, 'undefined → null');
  assert.strictEqual(getPreset(42), null, 'number → null');
  ok('falsy / non-string ids → null');
}

// 5. Output is a fresh object each call (no aliasing with the PRESETS table).
{
  const a = getPreset('neon');
  const b = getPreset('neon');
  a.temp = 999;
  assert.strictEqual(b.temp, -0.3, 'mutating output must not affect future calls');
  // Also verify the in-page PRESETS table is unaffected.
  // (Reading via the public API since the table is closure-private.)
  const c = getPreset('neon');
  assert.strictEqual(c.temp, -0.3, 'underlying PRESETS.neon.temp unchanged');
  ok('output is a fresh object (no aliasing)');
}

// 6. Output schema is the documented 8 fields (no extras, no missing).
{
  const out = getPreset('neon');
  const keys = Object.keys(out).sort();
  assert.deepEqual(keys,
    ['chroma','glow','grain','grayscale','mut','posterize','sepia','temp'].sort());
  ok('output schema is exactly 8 fields');
}

console.log(results.join('\n'));
console.log('GET PRESET UNIT: ALL GREEN (' + results.length + ' tests)');