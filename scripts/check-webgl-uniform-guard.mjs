#!/usr/bin/env node
// scripts/check-webgl-uniform-guard.mjs — gate for the "every direct
// gl.uniform* call is null-guarded" rule in fx-postprocess.js and
// versions-presets.js.
//
// The bug: page preset shaders (film, neon, smoke, hallucination, …)
// don't all declare every uniform — e.g. a minimal shader won't have
// u_blur, u_glow, u_sepia, etc. gl.getUniformLocation(prog, 'u_X')
// returns null for any missing uniform. Without the safe setters
// _uf / _ui / _u3, gl.uniform1f(null, …) throws
//
//   WebGL: INVALID_OPERATION: uniform1f: location is not from the
//          associated program
//
// every frame, and the browser eventually rate-limits with "too
// many errors, no more errors will be reported".
//
// What this gate verifies:
//   1. Both files define the safe setters _uf, _ui, _u3 (after
//      stripping comments).
//   2. ZERO direct gl.uniform* calls remain — every call site
//      uses _uf / _ui / _u3.
//
// Run: node scripts/check-webgl-uniform-guard.mjs
// Exit 0 on full pass, 1 otherwise.

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
  try { fn(); ok(name); }
  catch (e) { bad(name, e.message.slice(0, 200)); }
}

// Strip comments + safe-setter definitions; what remains must have
// zero direct gl.uniform* calls.
function guardFile(rel) {
  const src = fs.readFileSync(resolve(ROOT, rel), 'utf8');
  const cleaned = src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/const\s+_uf\s*=\s*\(loc,\s*val\)\s*=>\s*\{[^}]*\}\s*;?/g, '')
    .replace(/const\s+_ui\s*=\s*\(loc,\s*val\)\s*=>\s*\{[^}]*\}\s*;?/g, '')
    .replace(/const\s+_u3\s*=\s*\(loc,\s*a,\s*b,\s*c\)\s*=>\s*\{[^}]*\}\s*;?/g, '');
  return [...cleaned.matchAll(/gl\.uniform[1234][a-z]*\(/g)];
}

console.log('webgl-uniform-guard:');

check('fx-postprocess.js: zero direct gl.uniform* calls', () => {
  const calls = guardFile('fx-postprocess.js');
  if (calls.length !== 0) {
    throw new Error(`${calls.length} direct call(s) remain — first at offset ${calls[0].index}`);
  }
});

check('versions-presets.js: zero direct gl.uniform* calls', () => {
  const calls = guardFile('versions-presets.js');
  if (calls.length !== 0) {
    throw new Error(`${calls.length} direct call(s) remain — first at offset ${calls[0].index}`);
  }
});

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

// Behaviour: a fake WebGL driver that errors on null locations.
// The wrappers must skip the call so the driver emits zero errors.
check('safe setters: zero INVALID_OPERATION when uniforms missing', () => {
  const errors = [];
  const gl = {
    getUniformLocation: (prog, name) => {
      // Pretend the shader only knows about u_time and u_bass.
      if (['u_time', 'u_bass'].includes(name)) return { name };
      return null;
    },
    uniform1f: (loc) => { if (!loc) errors.push('uniform1f null'); },
    uniform1i: (loc) => { if (!loc) errors.push('uniform1i null'); },
    uniform3f: (loc) => { if (!loc) errors.push('uniform3f null'); },
  };
  const _uf = (loc, val) => { if (loc) gl.uniform1f(loc, val); };
  const _ui = (loc, val) => { if (loc) gl.uniform1i(loc, val); };
  const _u3 = (loc, a, b, c) => { if (loc) gl.uniform3f(loc, a, b, c); };

  for (const u of ['u_time', 'u_bass', 'u_mut', 'u_temp', 'u_blur']) {
    const loc = gl.getUniformLocation({}, u);
    _uf(loc, 0.5);
  }
  _ui(gl.getUniformLocation({}, 'u_page'), 3);
  _u3(gl.getUniformLocation({}, 'u_tint'), 1, 2, 3);

  if (errors.length !== 0) {
    throw new Error(`expected 0 errors, got ${errors.length}: ${errors.join(', ')}`);
  }
});

console.log('');
if (failed) {
  console.log('FAIL — ' + failed + ' check(s) failed');
  process.exit(1);
} else {
  console.log('OK — all webgl-uniform-guard checks passed');
}