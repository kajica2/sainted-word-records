#!/usr/bin/env node
// verify-rotation-asset.mjs — smoke test for the per-asset rotation detector.
//
//   node verify-rotation-asset.mjs
//
// Builds a synthetic MP4, patches its `tkhd` display matrix to a real 90° CW
// rotation, then asserts the detector functions return the right degrees.
// Pure-Node: no browser needed. Complements (not replaces) the existing
// verify-rotation-enabled.mjs, which covers the per-layer toggle.
//
// Exits 0 on green, 1 on any failure.

import fs from 'node:fs';
import path from 'node:path';
import { Blob } from 'node:buffer';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const TMP = '/tmp/rot-probe';
fs.mkdirSync(TMP, { recursive: true });

const html = fs.readFileSync(path.join(ROOT, 'engine.html'), 'utf8');
const grab = name => {
  const re = new RegExp(`(?:async )?function ${name}[\\s\\S]*?\\n    \\}`, 'm');
  const m = html.match(re);
  if (!m) throw new Error('could not extract ' + name);
  return m[0];
};

// Stub browser globals only as much as the functions need.
globalThis.FileReader = class { constructor(){} readAsArrayBuffer(){} };

fs.writeFileSync('/tmp/_rot_extracted.mjs', `
${grab('_walkMp4Boxes')}
${grab('detectMp4Rotation')}
export { detectMp4Rotation };
`);
const { detectMp4Rotation } = await import('/tmp/_rot_extracted.mjs');

let failed = 0;
async function step(name, fn) {
  try { await fn(); process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed += 1; process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`); }
}

// Build a baseline MP4 (no tkhd rotation).
const base = path.join(TMP, 'baseline.mp4');
const rotated = path.join(TMP, 'portrait-90cw.mp4');
execFileSync('ffmpeg', ['-y', '-f', 'lavfi',
  '-i', 'testsrc=size=720x1280:duration=1:rate=10',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', base], { stdio: 'pipe' });

// Patch tkhd display matrix: identity → 90° CW (CW positive in 16.16 fixed-point).
const buf = Buffer.from(fs.readFileSync(base));
const tkhd = buf.indexOf('tkhd');
if (tkhd < 0) { console.error('no tkhd in baseline'); process.exit(1); }
const mOff = tkhd + 4 + 40;          // 4-byte box header + 40-byte content prefix
const matrix90 = Buffer.alloc(36);
// row 0: a=0, b=1, c=0
matrix90.writeInt32BE(0, 0);       matrix90.writeInt32BE(0x10000, 4);  matrix90.writeInt32BE(0, 8);
// row 1: a=-1, b=0, c=0
matrix90.writeInt32BE(-0x10000, 12); matrix90.writeInt32BE(0, 16);     matrix90.writeInt32BE(0, 20);
// row 2: a=0, b=0, c=1 (0x40000000 in 16.16)
matrix90.writeInt32BE(0, 24);      matrix90.writeInt32BE(0, 28);      matrix90.writeInt32BE(0x40000000, 32);
matrix90.copy(buf, mOff);
fs.writeFileSync(rotated, buf);

await step('baseline MP4 (identity tkhd) → 0°', async () => {
  const got = await detectMp4Rotation(new Blob([fs.readFileSync(base)], { type: 'video/mp4' }));
  if (got !== 0) throw new Error(`expected 0°, got ${got}°`);
});

await step('portrait MP4 (tkhd 90° CW) → 90°', async () => {
  const got = await detectMp4Rotation(new Blob([fs.readFileSync(rotated)], { type: 'video/mp4' }));
  if (got !== 90) throw new Error(`expected 90°, got ${got}°`);
});

// Sanity check: the matrix patch actually wrote 16.16 (0x00010000) into the slot.
await step('patched matrix contains 90° CW signature', async () => {
  const after = fs.readFileSync(rotated);
  const m = after.slice(mOff, mOff + 36);
  // row 0 should be: 00 00 00 00  00 01 00 00  00 00 00 00
  if (m.readInt32BE(0) !== 0 || m.readInt32BE(4) !== 0x10000 || m.readInt32BE(8) !== 0)
    throw new Error('matrix[0] wrong: ' + m.slice(0, 12).toString('hex'));
});

if (failed) {
  process.stderr.write(`\n${failed} assertion(s) failed\n`);
  process.exit(1);
}
process.stdout.write('\nPASS — asset rotation detector correct\n');
