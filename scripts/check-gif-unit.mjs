#!/usr/bin/env node
// scripts/check-gif-unit.mjs — Node-side unit tests for lib/gif-decoder.client.js.
//
// The decoder uses omggif (a battle-tested GIF LZW implementation) which
// we vendor at lib/omggif.js. The decoder wrapper exposes a unified
// tick(timeMs) → ImageData API. These tests verify the wrapper against
// hand-crafted GIF89a fixtures generated in-memory.
//
// Run from project root: node scripts/check-gif-unit.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const LIB_PATH = new URL('../lib/gif-decoder.client.js', import.meta.url);
const OMGGIF_PATH = new URL('../lib/omggif.js', import.meta.url);
const libSrc = readFileSync(LIB_PATH, 'utf8');
const omggifSrc = readFileSync(OMGGIF_PATH, 'utf8');

// Minimal browser-ish context
const ctx = {
  window: {},
  module: { exports: {} },
  document: { head: { appendChild: () => {} }, createElement: () => ({}) },
  performance: { now: () => Date.now() },
  ImageData: class ImageData {
    constructor(w, h) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  },
  Uint8ClampedArray,
  Uint8Array,
  console,
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id),
};
ctx.self = ctx;
vm.createContext(ctx);
// Load omggif first so the wrapper's `ensureOmggif` callback would find it.
// omggif assigns its exports via CommonJS (`exports.GifReader = ...`).
// In a vm context, we have to wire `exports` to our `module.exports`
// before running the script — by default `exports` is undefined.
const omggifWired = 'var exports = module.exports;\n' + omggifSrc;
vm.runInContext(omggifWired, ctx);
// The omggif script does `try { exports.GifReader = GifReader } catch(e) {}`
// which assigns to ctx.module.exports. Expose it on window too so the
// wrapper's primary lookup path finds it.
ctx.window.omggif = ctx.module.exports;
console.log('omggif exports GifReader?', !!ctx.module.exports.GifReader, 'window.omggif.GifReader?', !!ctx.window.omggif.GifReader);
// Now load the wrapper
vm.runInContext(libSrc, ctx);
const SWR_GIF = ctx.window.SWR_GIF || ctx.module.exports;
console.log('SWR_GIF defined?', !!SWR_GIF, 'load fn?', typeof (SWR_GIF && SWR_GIF.load));
assert.ok(SWR_GIF, 'SWR_GIF should attach to window or module.exports');

let passed = 0, failed = 0;
function test(label, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${label}\n    ${e.stack || e.message}`);
  }
}

// --- GIF89a builder (writes a complete, correct GIF via omggif) -------
// For each frame we build a single-frame GIF via omggif's GifWriter and
// concatenate the LZW image-data sub-block into a complete multi-frame
// fixture. omggif's writer is spec-correct, so the bytes match what
// the reader expects.
function buildFixture(opts) {
  const {
    width = 4,
    height = 4,
    frames = [Array(width * height).fill(0), Array(width * height).fill(1)],
    palette = [[255, 0, 0], [0, 255, 0]],
    delayCs = 20,
  } = opts || {};

  // Build header + GCT
  const out = [];
  out.push(...Buffer.from('GIF89a'));
  out.push(width & 0xff, width >> 8, height & 0xff, height >> 8);
  out.push(0x80 | 0x70 | 0);  // GCT flag = 1, color res = 7, GCT size 0 (2 entries)
  out.push(0, 0);
  for (let i = 0; i < 2; i++) {
    if (i < palette.length) {
      out.push(palette[i][0], palette[i][1], palette[i][2]);
    } else {
      out.push(0, 0, 0);
    }
  }
  // Netscape 2.0 loop extension
  out.push(0x21, 0xFF, 0x0B,
    0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00);

  for (const idxs of frames) {
    // GCE with the requested delay and transparent index 0xFF
    out.push(0x21, 0xF9, 0x04, 0x00, delayCs & 0xff, delayCs >> 8, 0xFF, 0x00);
    // Image Descriptor + LZW block — produced by omggif using the
    // SAME palette as the GCT in this fixture so the LZW pixel
    // indices map to the right RGB values.
    const numColors = Math.max(2, 1 << Math.ceil(Math.log2(palette.length)));
    const paletteTriplets = [];
    for (let i = 0; i < numColors; i++) {
      if (i < palette.length) {
        paletteTriplets.push(palette[i]);
      } else {
        paletteTriplets.push([0, 0, 0]);
      }
    }
    const singleGif = lzwCompressIndicesWith(idxs, width, height, paletteTriplets);
    // Find the first 0x2C byte (Image Descriptor marker).
    let idStart = -1;
    for (let i = 0; i < singleGif.length; i++) {
      if (singleGif[i] === 0x2C) { idStart = i; break; }
    }
    if (idStart < 0) throw new Error('omggif output had no Image Descriptor');
    // Copy from the Image Descriptor to (but not including) the trailer 0x3B.
    for (let i = idStart; i < singleGif.length - 1; i++) {
      out.push(singleGif[i]);
    }
  }
  out.push(0x3B);
  return Buffer.from(out);
}

// Spec-correct LZW encoder (LSB-first, with code-width growth).
// Uses omggif's GifWriter + addFrame path so the produced bytes match
// the decoder's expected bit-stream exactly.
function lzwCompressIndices(indices, width, height) {
  // Build a palette big enough to hold the max index in `indices`.
  const maxIdx = Math.max(...indices, 0);
  const numColors = Math.max(4, 1 << Math.ceil(Math.log2(maxIdx + 1)));
  return lzwCompressIndicesWith(indices, width, height, buildDefaultPalette(numColors));
}

function buildDefaultPalette(numColors) {
  const palette = [];
  for (let i = 0; i < numColors; i++) {
    if (i === 0) palette.push([255, 0, 0]);
    else if (i === 1) palette.push([0, 255, 0]);
    else if (i === 2) palette.push([0, 0, 255]);
    else palette.push([(i * 17) & 0xff, (i * 31) & 0xff, (i * 53) & 0xff]);
  }
  return palette;
}

function lzwCompressIndicesWith(indices, width, height, palette) {
  // Allocate a buffer big enough for the GIF header + 1 frame.
  const buf = new Uint8Array(1024 * 64);
  const GifWriter = ctx.window.omggif.GifWriter;
  const gw = new GifWriter(buf, width, height, { palette, loop: 0 });
  gw.addFrame(0, 0, width, height, indices);
  gw.end();
  return buf.slice(0, gw.getOutputBufferPosition());
}

function lzwCompress(indices, minCodeSize) {
  // Back-compat shim for older test code that only needs the LZW bytes.
  // Use omggif to produce a valid single-frame GIF, then strip the GIF
  // header/trailer and return just the LZW image-data block.
  const width = Math.sqrt(indices.length) | 0;
  const height = indices.length / width;
  const fullGif = lzwCompressIndices(indices, width, height);
  // Find the image-data LZW sub-block: 0x2C header, then LSD, then the
  // LZW min-code-size byte and its sub-blocks. The simplest way is to
  // reuse omggif's reader to round-trip.
  const GifReader = ctx.window.omggif.GifReader;
  const reader = new GifReader(fullGif);
  // We just want the raw image data — re-encode using the writer's path
  // is not what the test needs. Simpler: return the full GIF and let
  // the caller assemble a multi-frame fixture.
  return fullGif;
}

// Helper: load fixture and synchronously return result
function loadSync(buf) {
  let result, err;
  let done = false;
  // The wrapper calls back synchronously when omggif is already loaded.
  SWR_GIF.load(buf, (e, r) => { err = e; result = r; done = true; console.error('SWR_GIF.load callback fired. err=', err && err.message, 'result?', !!result); });
  if (!done) {
    console.error('SWR_GIF.load did not fire callback synchronously. err=' + err + ' result=' + result);
    throw new Error('SWR_GIF.load did not call back synchronously');
  }
  if (err) throw err;
  return result;
}

console.log('=== load: 4x4 red→green animated ===');
test('loads 2 frames with correct dimensions and loop count', () => {
  const buf = buildFixture();
  const result = loadSync(buf);
  assert.equal(result.canvasW, 4);
  assert.equal(result.canvasH, 4);
  assert.equal(result.frames.length, 2);
  assert.equal(result.loopCount, 0);
});

test('frame 0 renders all red (palette[0])', () => {
  const buf = buildFixture();
  const result = loadSync(buf);
  // Probe a range of times to find one that lands on frame 0
  for (let t = 0; t < 1000; t += 5) {
    const img = result.tick(t);
    const d = img.data;
    // Print first pixel of any non-blank frame
    const firstPx = [d[0], d[1], d[2], d[3]];
    if (d[0] || d[1] || d[2]) {
      console.log(`  t=${t} first pixel:`, firstPx);
      let redCount = 0, greenCount = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 0) redCount++;
        if (d[i + 1] === 255) greenCount++;
      }
      if (redCount > 0) {
        assert.equal(redCount, 16, `frame at t=${t} should be all red`);
        return;
      }
    }
  }
  assert.fail('No frame in 0..1000ms produced all-red pixels');
});

test('frame 1 renders all green (palette[1])', () => {
  const buf = buildFixture();
  const result = loadSync(buf);
  // tick at a time past the first frame's delay
  // Probe a range of times — find one where the result is green
  for (let t = 0; t < 5000; t += 5) {
    const img = result.tick(t);
    const d = img.data;
    let greenCount = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 0 && d[i + 1] === 255 && d[i + 2] === 0) greenCount++;
    }
    if (greenCount > 0) {
      // Found a green frame — assert it's all green
      assert.equal(greenCount, 16, `frame at t=${t} should be all green`);
      return;
    }
  }
  assert.fail('No frame in 0..5000ms produced all-green pixels');
});

test('frame delay reflects the GCE delay (cs × 10)', () => {
  const buf = buildFixture({ delayCs: 30 });
  const result = loadSync(buf);
  assert.equal(result.frames[0].delayMs, 300);
});

test('loop count from NETSCAPE is preserved', () => {
  // Hand-build a fixture with loop count 5
  const buf = Buffer.concat([
    Buffer.from('GIF89a'),
    Buffer.from([4, 0, 4, 0, 0x80 | 0x70, 0, 0]),
    Buffer.from([255, 0, 0, 0, 255, 0]),
    Buffer.from([0x21, 0xFF, 0x0B,
      0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30,
      0x03, 0x01, 5, 0, 0x00]),
    Buffer.from([0x2C, 0, 0, 0, 0, 4, 0, 4, 0, 0]),
    Buffer.from([2, 1, 0x04, 0]),
    Buffer.from([0x3B]),
  ]);
  const result = loadSync(buf);
  assert.equal(result.loopCount, 5);
});

test('throws on bad magic', () => {
  const buf = Buffer.from('PNG\x89\x00rest of png data padding here');
  assert.throws(() => loadSync(buf));
});

test('handles frames with mixed indices', () => {
  // 16 pixels alternating 0,1,0,1,... — exercises the LZW path
  const indices = Array(16).fill(0).map((_, i) => i % 2);
  const buf = buildFixture({ frames: [indices] });
  const result = loadSync(buf);
  const img = result.tick(0);
  const d = img.data;
  for (let i = 0; i < 16; i++) {
    const isRed = d[i * 4] === 255 && d[i * 4 + 1] === 0 && d[i * 4 + 2] === 0;
    const isGreen = d[i * 4] === 0 && d[i * 4 + 1] === 255 && d[i * 4 + 2] === 0;
    assert.ok(isRed || isGreen, `pixel ${i} should be red or green, got ${d[i*4]},${d[i*4+1]},${d[i*4+2]}`);
    const expectedRed = i % 2 === 0;
    assert.equal(isRed, expectedRed, `pixel ${i} should be ${expectedRed ? 'red' : 'green'}`);
  }
});

test('single-frame GIF returns the same image for any tick time', () => {
  const buf = buildFixture({ frames: [Array(16).fill(0)] });
  const result = loadSync(buf);
  const a = result.tick(0);
  const b = result.tick(99999);
  assert.equal(a.data.length, b.data.length);
  for (let i = 0; i < a.data.length; i++) {
    assert.equal(a.data[i], b.data[i]);
  }
});

console.log('\n=== save fixture to disk for browser smoke test ===');
const fixturePath = '/tmp/swr-test-4x4.gif';
writeFileSync(fixturePath, buildFixture());
console.log(`  → ${fixturePath} (${readFileSync(fixturePath).length} bytes)`);

console.log(`\nGIF UNIT: ${failed === 0 ? 'ALL GREEN' : `${failed} FAILED`} (${passed + failed} tests)`);
process.exit(failed === 0 ? 0 : 1);
