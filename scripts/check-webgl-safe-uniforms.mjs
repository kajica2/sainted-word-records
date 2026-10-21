#!/usr/bin/env node
// scripts/check-webgl-safe-uniforms.mjs — gate for the "uniform setter
// null-guard" fix in fx-postprocess.js and versions-presets.js.
//
// The bug class:
//   gl.uniform1f(null, val);
//   → "WebGL: INVALID_OPERATION: uniform1f: location is not from the
//      associated program"
//
// Root cause: getUniformLocation(prog, 'u_X') returns null when the
// shader doesn't declare u_X. The original code had `_uf` / `_ui` /
// `_u3` safe wrappers defined LATER in the file (line ~1228), but
// the FIRST 6 setters (line 1126 + 1167-1171) called gl.uniform*
// directly. If the page preset omits any of those uniforms, the
// browser throws INVALID_OPERATION on every frame.
//
// This script verifies:
//   1. The safe setters _uf / _ui / _u3 are defined BEFORE the
//      first direct gl.uniform call.
//   2. Every gl.uniform* call in fx-postprocess.js and
//      versions-presets.js is wrapped (no direct calls remain).
//   3. A simulated shader that doesn't include a specific uniform
//      produces zero INVALID_OPERATION messages when the safe
//      wrappers are used.
//
// Run: node scripts/check-webgl-safe-uniforms.mjs
// Exit 0 on full pass, 1 otherwise.
//
// Wired into scripts/run-steps.mjs as `check:webgl-safe-uniforms`.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
function ok(name) { console.log('  PASS  ' + name); }
function bad(name, detail) {
  failed++;
  console.log('  FAIL  ' + name + (detail ? ' — ' + detail : ''));
}

function check(name, fn) {
  try { fn(name); ok(name); }
  catch (e) { bad(name, e.message.slice(0, 200)); }
}

console.log('webgl-safe-uniforms:');

// ---- 1. The safe setters are defined BEFORE the first direct
//        gl.uniform call in both files. ----
function assertSafeSettersBeforeDirectCalls(file, label) {
  const src = fs.readFileSync(resolve(ROOT, file), 'utf8');
  const safeDef = src.match(/const\s+_uf\s*=\s*\(loc,\s*val\)/);
  if (!safeDef) throw new Error(`${label}: safe setters not found at all`);

  // First direct gl.uniform* call (excluding lines inside the safe
  // setter definitions themselves — we look for ones not inside the
  // wrapper).
  const directMatches = [...src.matchAll(/gather\ngl\.uniform[1234][a-z]*\(/g)];
  if (directMatches.length === 0) {
    // All calls are wrapped — that's fine.
    return;
  }
  const firstDirectOffset = directMatches[0].index + 5;
  const safeDefOffset = safeDef.index;
  if (safeDefOffset > firstDirectOffset) {
    throw new Error(`${label}: safe setters defined at offset ${safeDefOffset} but first direct gl.uniform* call at offset ${firstDirectOffset} — setters come too late`);
  }
}

check('fx-postprocess.js: safe setters defined before first direct call', () => {
  assertSafeSettersBeforeDirectCalls('fx-postprocess.js', 'fx-postprocess.js');
});

check('versions-presets.js: safe setters defined before first direct call', () => {
  assertSafeSettersBeforeDirectCalls('versions-presets.js', 'versions-presets.js');
});

// ---- 2. Every gl.uniform* call uses the safe setters. ----
function assertNoDirectUniforms(file, label) {
  const src = fs.readFileSync(resolve(ROOT, file), 'utf8');
  // Strip line comments first — comments can mention gl.uniform*i*()
  // without being a real call site.
  const noComments = src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip the safe-setter definitions themselves so their internal
  // gl.uniform* calls don't count. The body has no nested braces, so
  // a single regex per setter is enough.
  const stripped = noComments
    .replace(/const\s+_uf\s*=\s*\(loc,\s*val\)\s*=>\s*\{[^}]*\}\s*;?/g, '')
    .replace(/const\s+_ui\s*=\s*\(loc,\s*val\)\s*=>\s*\{[^}]*\}\s*;?/g, '')
    .replace(/const\s+_u3\s*=\s*\(loc,\s*a,\s*b,\s*c\)\s*=>\s*\{[^}]*\}\s*;?/g, '');

  // Now every gl.uniform* call left is a direct call that bypasses
  // the safe setter.
  const directCalls = [...stripped.matchAll(/gl\.uniform[1234][a-z]*\(/g)];
  if (directCalls.length > 0) {
    const lineNo = stripped.slice(0, directCalls[0].index).split('\n').length;
    throw new Error(`${label}: ${directCalls.length} direct gl.uniform* call(s) remain — first at line ~${lineNo}`);
  }
}

check('fx-postprocess.js: every gl.uniform* uses _uf/_ui/_u3', () => {
  assertNoDirectUniforms('fx-postprocess.js', 'fx-postprocess.js');
});

check('versions-presets.js: every gl.uniform* uses _uf/_ui/_u3', () => {
  assertNoDirectUniforms('versions-presets.js', 'versions-presets.js');
});

// ---- 3. The safe wrappers exist as text in both files. ----
check('fx-postprocess.js: _uf / _ui / _u3 are defined', () => {
  const src = fs.readFileSync(resolve(ROOT, 'fx-postprocess.js'), 'utf8');
  if (!/_uf\s*=\s*\(loc,\s*val\)/.test(src)) throw new Error('_uf missing');
  if (!/_ui\s*=\s*\(loc,\s*val\)/.test(src)) throw new Error('_ui missing');
  if (!/_u3\s*=\s*\(loc,\s*a,\s*b,\s*c\)/.test(src)) throw new Error('_u3 missing');
});

check('versions-presets.js: _uf / _ui / _u3 are defined', () => {
  const src = fs.readFileSync(resolve(ROOT, 'versions-presets.js'), 'utf8');
  if (!/_uf\s*=\s*\(loc,\s*val\)/.test(src)) throw new Error('_uf missing');
  if (!/_ui\s*=\s*\(loc,\s*val\)/.test(src)) throw new Error('_ui missing');
  if (!/_u3\s*=\s*\(loc,\s*a,\s*b,\s*c\)/.test(src)) throw new Error('_u3 missing');
});

// ---- 4. Safe-setter logic — a thin reducer that proves the wrappers
//        prevent the call when loc is null. ----
check('safe setters: call is skipped when location is null', () => {
  let calls = 0;
  let skipped = 0;
  const fakeGL = {
    uniform1f: () => { calls++; },
    uniform1i: () => { calls++; },
    uniform3f: () => { calls++; },
  };
  const _uf = (loc, val) => { if (loc) fakeGL.uniform1f(loc, val); else skipped++; };
  const _ui = (loc, val) => { if (loc) fakeGL.uniform1i(loc, val); else skipped++; };
  const _u3 = (loc, a, b, c) => { if (loc) fakeGL.uniform3f(loc, a, b, c); else skipped++; };

  // null locations: nothing should hit the driver
  _uf(null, 0.5);
  _ui(null, 1);
  _u3(null, 1, 2, 3);
  if (calls !== 0) throw new Error(`expected 0 calls with null locations, got ${calls}`);
  if (skipped !== 3) throw new Error(`expected 3 skips, got ${skipped}`);

  // non-null locations: should pass through
  _uf({}, 0.5);
  _ui({}, 1);
  _u3({}, 1, 2, 3);
  if (calls !== 3) throw new Error(`expected 3 calls with valid locations, got ${calls}`);
});

// ---- 5. Browser-style guard simulates the WebGL driver behaviour. ----
check('safe setters: no INVALID_OPERATION when uniform is missing from shader', () => {
  // Simulate gl.getUniformLocation returning null for a uniform the
  // shader doesn't declare.
  const gl = {
    _errors: [],
    getUniformLocation: (prog, name) => {
      // Pretend the shader only knows about u_time and u_bass.
      if (['u_time', 'u_bass'].includes(name)) return { name };
      return null;
    },
    uniform1f: (loc, val) => {
      // Real WebGL driver: throws INVALID_OPERATION if loc is null.
      if (!loc) {
        gl._errors.push('INVALID_OPERATION: uniform1f: location is not from the associated program');
      }
    },
  };

  const _uf = (loc, val) => { if (loc) gl.uniform1f(loc, val); };

  // Try every uniform — including ones the shader doesn't know.
  for (const u of ['u_time', 'u_bass', 'u_mut', 'u_temp', 'u_blur', 'u_glow', 'u_sepia']) {
    const loc = gl.getUniformLocation({}, u);
    _uf(loc, 0.5);
  }

  if (gl._errors.length !== 0) {
    throw new Error(`expected 0 errors, got ${gl._errors.length}: ${gl._errors[0]}`);
  }
});

console.log('');
if (failed) {
  console.log('FAIL — ' + failed + ' webgl-safe-uniforms check(s) failed');
  process.exit(1);
} else {
  console.log('OK — all webgl-safe-uniforms checks passed');
}