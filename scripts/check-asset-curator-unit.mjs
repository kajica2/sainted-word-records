#!/usr/bin/env node
// scripts/check-asset-curator-unit.mjs — Asset-curator (P3.8) unit tests.

import vm from 'node:vm';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'client/asset-curator.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) {
    console.log('  ✓', msg, detail ? `(${detail})` : '');
  } else {
    console.log('  ✗', msg, detail ? `(${detail})` : '');
    failures += 1;
  }
}

function crc32(buf) {
  const table = (crc32.table ||= (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })());
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function buildPNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (1 + width * 4) + 1);
  }
  const idatData = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);
}

function solidRGBA(w, h, r, g, b, a) {
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
  }
  return buf;
}

function giftBagRGBA(w, h) {
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 255; buf[i+1] = 255; buf[i+2] = 255; buf[i+3] = 255;
  }
  const cx = (w / 2) | 0, cy = (h / 2) | 0;
  for (let y = cy - 8; y < cy + 8; y++) {
    for (let x = cx - 8; x < cx + 8; x++) {
      const i = (y * w + x) * 4;
      buf[i] = 0; buf[i+1] = 0; buf[i+2] = 0; buf[i+3] = 255;
    }
  }
  return buf;
}

function gradientRGBA(w, h) {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[i] = Math.round((x / w) * 255);
      buf[i+1] = 0;
      buf[i+2] = Math.round((y / h) * 255);
      buf[i+3] = 255;
    }
  }
  return buf;
}

function runCuratorProcess(rgba, fileName, fileType = 'image/png', width = 32, height = 32) {
  const pngBytes = buildPNG(width, height, rgba);
  let currentPixels = rgba;

  // Build the vm context with shims for browser APIs the curator uses.
  const ctx = {
    window: {},
    document: {
      addEventListener: () => {},
      createElement: (tag) => {
        if (tag !== 'canvas') return {};
        const canvas = {
          width: 0, height: 0,
          toBlob(cb, mime) {
            const png = buildPNG(width, height, currentPixels);
            cb({ size: png.length, type: mime || 'image/png', _bytes: png });
          },
          getContext() {
            return {
              drawImage(bitmap) {
                if (bitmap && bitmap._pixels) currentPixels = bitmap._pixels;
              },
              getImageData(x, y, w, h) {
                return { data: currentPixels, width: w, height: h };
              },
              putImageData(imageData) { currentPixels = imageData.data; },
            };
          },
        };
        return canvas;
      },
    },
    performance: { now: () => Date.now() },
    AbortSignal: AbortSignal,
    Blob: class Blob {
      constructor(parts, opts) {
        this._parts = parts;
        this.size = (parts && parts[0] && (parts[0].length || parts[0].byteLength)) || 0;
        this.type = (opts && opts.type) || '';
      }
    },
    File: class File {
      constructor(parts, name, opts) {
        this._parts = parts; this.name = name;
        this.size = (parts && parts[0] && (parts[0].length || parts[0].byteLength)) || 0;
        this.type = (opts && opts.type) || '';
      }
    },
    fetch: () => Promise.reject(new Error('fetch not available in unit test')),
    createImageBitmap: async (file) => ({ width, height, _pixels: rgba }),
  };
  ctx.window.window = ctx.window;
  ctx.window.self = ctx.window;
  ctx.window.document = ctx.document;
  ctx.window.performance = ctx.performance;
  ctx.window.AbortSignal = ctx.AbortSignal;
  ctx.window.Blob = ctx.Blob;
  ctx.window.File = ctx.File;
  ctx.window.fetch = ctx.fetch;

  vm.createContext(ctx);
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  vm.runInContext(src, ctx);

  const curator = ctx.window.SWR_ASSET_CURATOR;
  if (!curator) throw new Error('SWR_ASSET_CURATOR not exposed');

  // Use a Blob that's an instance of the vm context's Blob class so the
  // curator's `instanceof Blob` check passes.
  const fakeBlob = new ctx.Blob([pngBytes], { type: fileType });
  fakeBlob.name = fileName;
  fakeBlob.arrayBuffer = async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength);
  const fakeFile = fakeBlob;

  return curator.process(fakeFile);
}

async function main() {
  console.log('\n=== 1. White-bg gift bag → cleaned ===');
  const r1 = await runCuratorProcess(giftBagRGBA(32, 32), 'gift_bag_01.png');
  assert(r1.file && (r1.file.size > 0 || (r1.file._bytes && r1.file._bytes.length > 0)),
    'result.file is a Blob', `size=${r1.file && r1.file.size || (r1.file && r1.file._bytes && r1.file._bytes.length)}`);
  assert(r1.status === 'cleaned', `status === 'cleaned' (got: ${r1.status})`);
  assert(r1.backgroundColor && Math.abs(r1.backgroundColor.r - 255) < 10,
    `detected background ~white (got rgb(${r1.backgroundColor && r1.backgroundColor.r}))`);
  assert(r1.folder === 'gift-bags', `folder === 'gift-bags' (got: ${r1.folder})`);
  assert(r1.tags.length > 0 && r1.tags.some(t => t.tag === 'gift bag'),
    `tags include 'gift bag' (got: ${r1.tags.map(t => t.tag).join(',')})`);

  console.log('\n=== 2. Already-transparent PNG → passthrough ===');
  const rgba2 = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < rgba2.length; i += 4) rgba2[i+3] = 0;
  rgba2[0] = 100; rgba2[1] = 50; rgba2[2] = 200;
  const r2 = await runCuratorProcess(rgba2, 'trans_icon.png', 'image/png', 16, 16);
  assert(r2.status === 'passthrough', `status === 'passthrough' (got: ${r2.status})`);

  console.log('\n=== 3. Non-uniform bg → passthrough ===');
  const r3 = await runCuratorProcess(gradientRGBA(32, 32), 'sunset.jpg', 'image/jpeg');
  assert(r3.status === 'passthrough', `status === 'passthrough' (got: ${r3.status})`);
  assert(r3.backgroundColor === null, 'backgroundColor is null (no uniform bg)');

  console.log('\n=== 4. Black-bg PNG → cleaned ===');
  const rgba4 = solidRGBA(32, 32, 0, 0, 0, 255);
  for (let y = 12; y < 20; y++) {
    for (let x = 12; x < 20; x++) {
      const i = (y * 32 + x) * 4;
      rgba4[i] = 255; rgba4[i+1] = 255; rgba4[i+2] = 255;
    }
  }
  const r4 = await runCuratorProcess(rgba4, 'logo_black.png');
  assert(r4.status === 'cleaned', `status === 'cleaned' (got: ${r4.status})`);
  assert(r4.backgroundColor && r4.backgroundColor.r < 10,
    `detected background ~black (got rgb(${r4.backgroundColor && r4.backgroundColor.r}))`);

  console.log('\n=== 5. Filename → folder routing ===');
  const rgba5 = solidRGBA(64, 64, 255, 255, 255, 255);
  rgba5[0] = 100; rgba5[1] = 100; rgba5[2] = 100;
  rgba5[60] = 100; rgba5[61] = 100; rgba5[62] = 100;
  rgba5[64*63*4+0] = 100; rgba5[64*63*4+1] = 100; rgba5[64*63*4+2] = 100;
  const r5 = await runCuratorProcess(rgba5, 'gift_bag_01.png');
  assert(r5.folder === 'gift-bags', `gift_bag filename → folder === 'gift-bags' (got: ${r5.folder})`);
  assert(r5.tags.some(t => t.tag === 'gift bag'), `tags include 'gift bag'`);

  console.log('\n' + (failures === 0
    ? 'ASSET CURATOR UNIT: ALL GREEN (5 tests)'
    : `ASSET CURATOR UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
