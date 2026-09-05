#!/usr/bin/env node
// scripts/check-mesh-renderer-unit.mjs — Unit tests for client/mesh-renderer.client.js.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'client/mesh-renderer.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  console.log(cond ? `  PASS  ${msg}${detail ? ` (${detail})` : ''}` : `  FAIL  ${msg}${detail ? ` (${detail})` : ''}`);
  if (!cond) failures += 1;
}

const SRC = fs.readFileSync(SRC_PATH, 'utf8');

function loadRenderer() {
  const ctx = {
    window: {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.window.SWR_MESH_RENDER;
}

(async function main() {
  console.log('\n=== 1. Module attached to window ===');
  const R = loadRenderer();
  assert(R, 'SWR_MESH_RENDER attached to window');
  assert(typeof R._ortho === 'function', 'R._ortho is a function');
  assert(typeof R._lookAt === 'function', 'R._lookAt is a function');
  assert(typeof R._scale === 'function', 'R._scale is a function');
  assert(typeof R._mul === 'function', 'R._mul is a function');
  assert(typeof R._clamp === 'function', 'R._clamp is a function');

  console.log('\n=== 2. _scale produces uniform scale matrix ===');
  const s = new Float32Array(16);
  R._scale(s, 3);
  assert(s[0] === 3 && s[5] === 3 && s[10] === 3 && s[15] === 1,
    'scale(3) puts 3 on diagonal, 1 at [15]');

  console.log('\n=== 3. _ortho basic correctness ===');
  const o = new Float32Array(16);
  R._ortho(o, -10, 10, -5, 5, -1, 1);
  assert(Math.abs(o[0] - 0.1) < 1e-5, `ortho[0] ≈ 0.1 (got ${o[0]})`);
  assert(Math.abs(o[5] - 0.2) < 1e-5, `ortho[5] ≈ 0.2 (got ${o[5]})`);
  assert(Math.abs(o[10] - (-1)) < 1e-5, `ortho[10] ≈ -1 (got ${o[10]})`);
  assert(Math.abs(o[15] - 1) < 1e-5, `ortho[15] ≈ 1 (got ${o[15]})`);

  console.log('\n=== 4. _lookAt returns a populated matrix ===');
  const lv = new Float32Array(16);
  R._lookAt(lv, 0, 0, 5, 0, 0, 0, 0, 1, 0);
  // Allow some leniency: 4-6 nonzero entries depending on view direction.
  let nonzero = 0;
  for (let i = 0; i < 16; i++) if (Math.abs(lv[i]) > 1e-6) nonzero++;
  assert(nonzero >= 4, `lookAt has 4+ non-zero entries (got ${nonzero})`);

  console.log('\n=== 5. _mul: identity × scale = scale ===');
  const id = new Float32Array(16);
  R._scale(id, 1);
  const sc = new Float32Array(16);
  R._scale(sc, 4);
  const out = new Float32Array(16);
  R._mul(out, id, sc);
  assert(Math.abs(out[0] - 4) < 1e-5, `identity * scale(4) → 4 at [0] (got ${out[0]})`);
  assert(Math.abs(out[5] - 4) < 1e-5, `identity * scale(4) → 4 at [5] (got ${out[5]})`);
  assert(Math.abs(out[10] - 4) < 1e-5, `identity * scale(4) → 4 at [10] (got ${out[10]})`);
  assert(Math.abs(out[15] - 1) < 1e-5, `identity * scale(4) → 1 at [15] (got ${out[15]})`);

  console.log('\n=== 6. _clamp ===');
  assert(R._clamp(5, 0, 10) === 5, 'clamp(5, 0, 10) = 5');
  assert(R._clamp(-3, 0, 10) === 0, 'clamp(-3, 0, 10) = 0 (low edge)');
  assert(R._clamp(99, 0, 10) === 10, 'clamp(99, 0, 10) = 10 (high edge)');

  console.log('\n=== 7. Public API surface ===');
  const expected = [
    'createViewport', 'destroyViewport', 'uploadMesh',
    'load', 'loadMesh', 'clear', 'setAudioSource',
    'start', 'stop', 'sessions',
  ];
  for (const name of expected) {
    assert(typeof R[name] !== 'undefined', `${name} is exposed`);
  }

  console.log('\n=== 8. _sampleAudio ===');
  const sess1 = { audioSource: null };
  assert(R._sampleAudio(sess1) === 0, 'no audio → 0 envelope');

  // Mock that simply leaves the buffer alone.
  const fakeAudio = {
    an: { getByteFrequencyData: () => {} },
    fft: new Uint8Array(64),
  };
  const sess2 = { audioSource: fakeAudio };
  assert(R._sampleAudio(sess2) === 0, 'silent audio → 0 envelope');
  for (let i = 0; i < 8; i++) fakeAudio.fft[i] = 200;
  const env = R._sampleAudio(sess2);
  assert(env > 0, `loud audio → envelope > 0 (got ${env.toFixed(3)})`);
  assert(env <= 1, 'envelope stays in [0,1]');

  // Edge: maxed-out bins.
  fakeAudio.fft.fill(255);
  const envMax = R._sampleAudio(sess2);
  assert(Math.abs(envMax - 1) < 0.01, `maxed audio → envelope ≈ 1 (got ${envMax.toFixed(3)})`);

  console.log('\n' + (failures === 0
    ? `MESH RENDERER UNIT: ALL GREEN (8 tests)`
    : `MESH RENDERER UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
