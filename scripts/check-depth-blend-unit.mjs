#!/usr/bin/env node
// scripts/check-depth-blend-unit.mjs
//
// Node-only unit tests for the HologramState.depth → _fxOverride blend
// math extracted from versions-presets.js into window.__SWR_BLEND_FX
// (the blendFxOverride function).
//
// Strategy: load versions-presets.js in a vm sandbox with just enough
// stubs to bypass init() and expose window.__SWR_BLEND_FX. Then call
// the helper directly with preset + override + depth combos.
//
// Pass criteria: every assertion succeeds, exit 0, last line
// `DEPTH BLEND UNIT: ALL GREEN (N tests)`.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(
  new URL('../versions-presets.js', import.meta.url),
  'utf8'
);

// We need to run versions-presets.js far enough to expose
// window.__SWR_BLEND_FX. The function is declared at module scope (right
// before PRESETS), so it runs on script execution. We then need to
// prevent init() from crashing — wrap it so it no-ops.
const srcForTest = src.replace(
  'window.VersionsPresets = {',
  'if (typeof window.__SWR_BLEND_FX !== "undefined") {} // marker\n  // Suppress init() so we only need to expose __SWR_BLEND_FX\n  function _noInit() { /* bypass */ }\n  document.addEventListener("DOMContentLoaded", _noInit, { once: true });\n  window.VersionsPresets = {'
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
vm.runInContext(srcForTest, sandbox);

const blendFxOverride = sandbox.window.__SWR_BLEND_FX;
assert.ok(typeof blendFxOverride === 'function', 'blendFxOverride must be exposed');

// Neon preset values from versions-presets.js (the page preset)
const NEON = {
  temp: -0.3, mut: 0.55, sepia: 0.0, chroma: 0.85, grain: 0.40,
  glow: 0.4, grayscale: 0.0, posterize: 0.10,
};

// ---- Tests ----------------------------------------------------------------
const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// 1. No override → returns the static preset unchanged (no-op).
{
  const out = blendFxOverride(NEON, null, 0.5);
  for (const k of Object.keys(NEON)) {
    assert.ok(out[k] === NEON[k], 'no-override: ' + k + ' unchanged');
  }
  ok('null override: returns static preset unchanged');
}

// 2. depth=0 → override entirely ignored.
{
  const ov = { temp: 0.99, mut: 0.99, sepia: 0.99, chroma: 0.99, grain: 0.99, glow: 0.99, grayscale: 0.99, posterize: 0.99 };
  const out = blendFxOverride(NEON, ov, 0);
  for (const k of Object.keys(NEON)) {
    assert.ok(out[k] === NEON[k], 'depth=0: ' + k + ' = preset.' + k + ' (got ' + out[k] + ')');
  }
  ok('depth=0: override ignored, fields equal preset');
}

// 3. depth=1 → override fully dominates.
{
  const ov = { temp: 0.99, mut: 0.99, sepia: 0.99, chroma: 0.99, grain: 0.99, glow: 0.99, grayscale: 0.99, posterize: 0.99 };
  const out = blendFxOverride(NEON, ov, 1);
  for (const k of Object.keys(NEON)) {
    assert.ok(Math.abs(out[k] - 0.99) < 1e-9, 'depth=1: ' + k + ' = 0.99 (got ' + out[k] + ')');
  }
  ok('depth=1: override fully dominates');
}

// 4. depth=0.5 → 50/50 blend per field.
// neon.temp = -0.3, ov.temp = 0.5 → expected -0.3*0.5 + 0.5*0.5 = 0.1
{
  const ov = { temp: 0.5, mut: 0.5, sepia: 0.5, chroma: 0.5, grain: 0.5, glow: 0.5, grayscale: 0.5, posterize: 0.5 };
  const out = blendFxOverride(NEON, ov, 0.5);
  for (const k of Object.keys(NEON)) {
    const expected = (NEON[k] + ov[k]) / 2;
    assert.ok(Math.abs(out[k] - expected) < 1e-9,
              'depth=0.5: ' + k + ' = mean (got ' + out[k] + ', expected ' + expected + ')');
  }
  ok('depth=0.5: arithmetic mean per field');
}

// 5. depth=0.4 → original PR #9 default blend (4 lines below reproduce it).
{
  const ov = { temp: 0.5, mut: 0.5, sepia: 0.5, chroma: 0.5, grain: 0.5, glow: 0.5, grayscale: 0.5, posterize: 0.5 };
  const out = blendFxOverride(NEON, ov, 0.4);
  for (const k of Object.keys(NEON)) {
    const expected = NEON[k] * 0.6 + ov[k] * 0.4;
    assert.ok(Math.abs(out[k] - expected) < 1e-9,
              'depth=0.4: ' + k + ' = 60/40 (got ' + out[k] + ', expected ' + expected + ')');
  }
  ok('depth=0.4: 60/40 blend (PR #9 default preserved)');
}

// 6. Depth > 1 → clamped to 1 (override fully dominates).
{
  const ov = { temp: 1.0, mut: 1.0, sepia: 1.0, chroma: 1.0, grain: 1.0, glow: 1.0, grayscale: 1.0, posterize: 1.0 };
  const out = blendFxOverride(NEON, ov, 5.0);
  for (const k of Object.keys(NEON)) {
    assert.ok(Math.abs(out[k] - 1.0) < 1e-9, 'depth=5: ' + k + ' clamped to 1 (got ' + out[k] + ')');
  }
  ok('depth=5: clamped to 1');
}

// 7. Depth < 0 → clamped to 0 (override ignored).
{
  const ov = { temp: 1.0, mut: 1.0, sepia: 1.0, chroma: 1.0, grain: 1.0, glow: 1.0, grayscale: 1.0, posterize: 1.0 };
  const out = blendFxOverride(NEON, ov, -2.0);
  for (const k of Object.keys(NEON)) {
    assert.ok(out[k] === NEON[k], 'depth=-2: ' + k + ' = preset (got ' + out[k] + ')');
  }
  ok('depth=-2: clamped to 0');
}

// 8. Output is a fresh object (caller can mutate freely).
{
  const out = blendFxOverride(NEON, { temp: 0.5 }, 0.5);
  out.temp = 999;
  assert.ok(NEON.temp === -0.3, 'mutating output must not affect input preset');
  ok('output is a fresh object (no aliasing)');
}

console.log(results.join('\n'));
console.log('DEPTH BLEND UNIT: ALL GREEN (' + results.length + ' tests)');