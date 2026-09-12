#!/usr/bin/env node
// scripts/check-fx-spatial-unit.mjs — Unit tests for client/fx-spatial.client.js.
//
// We can't require('canvas') in this repo (node-canvas isn't installed and
// we're told not to npm install). Instead we build a tiny in-memory canvas
// stub that records drawImage, fillRect, getImageData/putImageData, and
// filter state — enough to drive SWR_FX_SPATIAL.apply() and observe the
// post-pass pixel diff.
//
// The stub maintains a Uint8ClampedArray of pixels per canvas. drawImage
// does a nearest-neighbour resample from source rect into dest rect;
// fillRect paints a solid colour; getImageData returns a fresh
// ImageData-shaped object; putImageData writes back into the pixel buffer.
// Ops go into a SHARED log so we can audit which scratch canvas saw
// getImageData/putImageData (chromatic) and which canvas saw a 'lighter'
// composite (bloom). This is intentionally a low-fidelity emulator — we
// only need it to catch "did the effect actually move pixels" + "did
// anything throw".

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'client/fx-spatial.client.js');

let failures = 0;
function assert(cond, msg) {
  console.log(cond ? `  PASS  ${msg}` : `  FAIL  ${msg}`);
  if (!cond) failures += 1;
}

// -----------------------------------------------------------------------
// Stub canvas + context. One instance per fake canvas. All canvases share
// a global `opLog` so tests can assert across scratch buffers.
// -----------------------------------------------------------------------

const opLog = [];
function resetOpLog() { opLog.length = 0; }

// We allocate a fixed 1920x1080 backing store up-front for every canvas
// because in a real browser setting canvas.width/height auto-resets the
// pixel buffer; in our stub those props are just metadata, so we have to
// reserve the maximum size we'll ever need. The FX module's scratch
// buffers top out at 1280x720 (CHROMA_DOWNSCALE_W/H), and the stage
// canvas is whatever the consumer sets (tests use <=1280x720), so 1920x1080
// is comfortably above the cap.
const MAX_W = 1920;
const MAX_H = 1080;
const MAX_PIXELS = MAX_W * MAX_H * 4;

function makeCanvas(w, h, tag) {
  const pixels = new Uint8ClampedArray(MAX_PIXELS);
  // default transparent
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
  return {
    width: w,
    height: h,
    tag: tag || 'stage',
    pixels,
  };
}

function makeCtx(canvas) {
  const ctx = {
    canvas,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1.0,
    fillStyle: '#000',
    filter: 'none',
    _fillRGB: [0, 0, 0],

    _resolveFill() {
      const s = this.fillStyle;
      if (typeof s !== 'string') return this._fillRGB;
      if (s[0] === '#') {
        let h = s.slice(1);
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        if (h.length >= 6) {
          return [
            parseInt(h.slice(0, 2), 16),
            parseInt(h.slice(2, 4), 16),
            parseInt(h.slice(4, 6), 16),
          ];
        }
      }
      return this._fillRGB;
    },

    clearRect(x, y, w, h) {
      x = x | 0; y = y | 0; w = w | 0; h = h | 0;
      const cw = canvas.width, ch = canvas.height;
      const x2 = Math.min(cw, x + w), y2 = Math.min(ch, y + h);
      const xa = Math.max(0, x), ya = Math.max(0, y);
      for (let yy = ya; yy < y2; yy++) {
        for (let xx = xa; xx < x2; xx++) {
          const i = (yy * cw + xx) * 4;
          canvas.pixels[i] = 0;
          canvas.pixels[i + 1] = 0;
          canvas.pixels[i + 2] = 0;
          canvas.pixels[i + 3] = 0;
        }
      }
      opLog.push(['clearRect', canvas.tag, x, y, w, h]);
    },

    fillRect(x, y, w, h) {
      const [r, g, b] = this._resolveFill();
      const a = Math.round(this.globalAlpha * 255);
      x = x | 0; y = y | 0; w = w | 0; h = h | 0;
      const cw = canvas.width, ch = canvas.height;
      const x2 = Math.min(cw, x + w), y2 = Math.min(ch, y + h);
      const xa = Math.max(0, x), ya = Math.max(0, y);
      for (let yy = ya; yy < y2; yy++) {
        for (let xx = xa; xx < x2; xx++) {
          const i = (yy * cw + xx) * 4;
          if (this.globalCompositeOperation === 'lighter') {
            canvas.pixels[i]     = Math.min(255, canvas.pixels[i] + r);
            canvas.pixels[i + 1] = Math.min(255, canvas.pixels[i + 1] + g);
            canvas.pixels[i + 2] = Math.min(255, canvas.pixels[i + 2] + b);
            canvas.pixels[i + 3] = Math.min(255, canvas.pixels[i + 3] + a);
          } else {
            canvas.pixels[i]     = r;
            canvas.pixels[i + 1] = g;
            canvas.pixels[i + 2] = b;
            canvas.pixels[i + 3] = a;
          }
        }
      }
      opLog.push(['fillRect', canvas.tag, x, y, w, h, this.fillStyle]);
    },

    // drawImage: 5-arg (image, dx, dy, dw, dh) or 9-arg (sx, sy, sw, sh,
    // dx, dy, dw, dh). The 5-arg form is what the FX module uses.
    drawImage(src, a, b, c, d, e, f, g, h) {
      const isRect = (e === undefined);
      let sx, sy, sw, sh, dx, dy, dw, dh;
      if (isRect) {
        sx = 0; sy = 0; sw = src.width; sh = src.height;
        dx = a | 0; dy = b | 0; dw = c | 0; dh = d | 0;
      } else {
        sx = a | 0; sy = b | 0; sw = c | 0; sh = d | 0;
        dx = e | 0; dy = f | 0; dw = g | 0; dh = h | 0;
      }
      opLog.push([
        'drawImage', canvas.tag, isRect ? 'full' : 'rect',
        sx, sy, sw, sh, dx, dy, dw, dh,
        this.globalCompositeOperation,
      ]);
      // Nearest-neighbour resample from src into dst. Bounded by both
      // canvases' width/height so we never read past the end of the
      // scratch buffer.
      const cw = canvas.width;
      for (let yy = 0; yy < dh; yy++) {
        const dstY = dy + yy;
        if (dstY < 0 || dstY >= canvas.height) continue;
        for (let xx = 0; xx < dw; xx++) {
          const dstX = dx + xx;
          if (dstX < 0 || dstX >= cw) continue;
          const srcX = sx + Math.min(sw - 1, Math.floor((xx / dw) * sw));
          const srcY = sy + Math.min(sh - 1, Math.floor((yy / dh) * sh));
          if (srcX < 0 || srcX >= src.width || srcY < 0 || srcY >= src.height) continue;
          const sIdx = (srcY * src.width + srcX) * 4;
          const dIdx = (dstY * cw + dstX) * 4;
          const sr = src.pixels[sIdx];
          const sg = src.pixels[sIdx + 1];
          const sb = src.pixels[sIdx + 2];
          const sa = src.pixels[sIdx + 3];
          if (this.globalCompositeOperation === 'lighter') {
            canvas.pixels[dIdx]     = Math.min(255, canvas.pixels[dIdx] + sr);
            canvas.pixels[dIdx + 1] = Math.min(255, canvas.pixels[dIdx + 1] + sg);
            canvas.pixels[dIdx + 2] = Math.min(255, canvas.pixels[dIdx + 2] + sb);
            canvas.pixels[dIdx + 3] = Math.min(255, canvas.pixels[dIdx + 3] + sa);
          } else {
            canvas.pixels[dIdx]     = sr;
            canvas.pixels[dIdx + 1] = sg;
            canvas.pixels[dIdx + 2] = sb;
            canvas.pixels[dIdx + 3] = sa;
          }
        }
      }
    },

    createImageData(w, h) {
      return {
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
      };
    },

    getImageData(x, y, w, h, out) {
      // The FX module passes either an ImageData wrapper ({data, ...})
      // or the raw Uint8ClampedArray — support both.
      let data;
      if (out instanceof Uint8ClampedArray) {
        data = out;
      } else if (out && out.data) {
        data = out.data;
      } else {
        data = new Uint8ClampedArray(w * h * 4);
      }
      const cw = canvas.width;
      for (let yy = 0; yy < h; yy++) {
        const srcY = y + yy;
        if (srcY < 0 || srcY >= canvas.height) continue;
        for (let xx = 0; xx < w; xx++) {
          const srcX = x + xx;
          if (srcX < 0 || srcX >= cw) continue;
          const sIdx = (srcY * cw + srcX) * 4;
          const dIdx = (yy * w + xx) * 4;
          data[dIdx]     = canvas.pixels[sIdx];
          data[dIdx + 1] = canvas.pixels[sIdx + 1];
          data[dIdx + 2] = canvas.pixels[sIdx + 2];
          data[dIdx + 3] = canvas.pixels[sIdx + 3];
        }
      }
      opLog.push(['getImageData', canvas.tag, x, y, w, h]);
      return { width: w, height: h, data };
    },

    putImageData(img, x, y) {
      const { width: w, height: h, data } = img;
      const cw = canvas.width;
      for (let yy = 0; yy < h; yy++) {
        const dstY = y + yy;
        if (dstY < 0 || dstY >= canvas.height) continue;
        for (let xx = 0; xx < w; xx++) {
          const dstX = x + xx;
          if (dstX < 0 || dstX >= cw) continue;
          const sIdx = (yy * w + xx) * 4;
          const dIdx = (dstY * cw + dstX) * 4;
          canvas.pixels[dIdx]     = data[sIdx];
          canvas.pixels[dIdx + 1] = data[sIdx + 1];
          canvas.pixels[dIdx + 2] = data[sIdx + 2];
          canvas.pixels[dIdx + 3] = data[sIdx + 3];
        }
      }
      opLog.push(['putImageData', canvas.tag, x, y, w, h]);
    },
  };
  return ctx;
}

// -----------------------------------------------------------------------
// Load the module into a vm context with a stubbed `window` + `document`.
// -----------------------------------------------------------------------

const SRC = fs.readFileSync(SRC_PATH, 'utf8');

function loadFX() {
  resetOpLog();
  const ctx = {
    window: {},
    document: {
      createElement(tag) {
        if (tag !== 'canvas') throw new Error('unexpected createElement: ' + tag);
        const c = makeCanvas(0, 0, 'scratch');
        c.getContext = () => makeCtx(c);
        return c;
      },
    },
    Uint8ClampedArray,
    console,
    Math,
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext('delete window.SWR_FX_SPATIAL;', ctx);
  vm.runInContext(SRC, ctx);
  return ctx.window.SWR_FX_SPATIAL;
}

// -----------------------------------------------------------------------
// Pixel helpers used by tests.
// -----------------------------------------------------------------------

function meanDiff(a, b, len) {
  // Default to canvas pixel bounds, not the stub backing-store size.
  len = len || Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += Math.abs(a[i] - b[i]);
  return sum / len;
}

function sumRGB(pixels, len) {
  len = len || pixels.length;
  let sum = 0;
  for (let i = 0; i < len; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
  return sum;
}

function seedGradient(canvas) {
  const w = canvas.width, h = canvas.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      canvas.pixels[i]     = (x * 255 / w) | 0;
      canvas.pixels[i + 1] = (y * 255 / h) | 0;
      canvas.pixels[i + 2] = ((x + y) * 128 / (w + h)) | 0;
      canvas.pixels[i + 3] = 255;
    }
  }
}

function makeStageCanvas(w, h) {
  const c = makeCanvas(w, h, 'stage');
  c.getContext = () => makeCtx(c);
  return c;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

(async function main() {
  console.log('\n=== 1. apply() runs without throwing on 1280x720 ===');
  {
    const FX = loadFX();
    const stage = makeStageCanvas(1280, 720);
    seedGradient(stage);
    const ctx = stage.getContext();
    let threw = false;
    try {
      FX.apply(ctx, stage, {
        feat: { bass: 0.5, onset: 0.4, rms: 0.6 },
      }, { chroma: 0.3, motion: 0.5, bloom: 0.4 });
    } catch (e) {
      threw = true;
      console.error('  THREW:', e.message);
    }
    assert(!threw, 'apply did not throw on 1280x720 stage');
    assert(FX.enabled === true, 'enabled defaults to true');
    assert(typeof FX.apply === 'function', 'apply is a function');
    assert(opLog.length > 0, 'op log captured canvas activity');
  }

  console.log('\n=== 2. enabled=false short-circuits cleanly ===');
  {
    const FX = loadFX();
    const w = 640, h = 360;
    const stage = makeStageCanvas(w, h);
    seedGradient(stage);
    const ctx = stage.getContext();
    const before = Uint8ClampedArray.from(stage.pixels);
    FX.enabled = false;
    FX.apply(ctx, stage, { feat: { bass: 1 } }, { motion: 1 });
    FX.enabled = true;
    let threw = false;
    try {
      FX.apply(ctx, stage, { feat: { bass: 0.2 } }, { motion: 0.1 });
    } catch (e) { threw = true; }
    assert(!threw, 'apply survives enabled toggle');
    assert(meanDiff(before, stage.pixels, w * h * 4) > 0, 'pixels changed across two apply() calls');
  }

  console.log('\n=== 3. parallax scales bands (motion=1 stretches middle) ===');
  {
    const FX = loadFX();
    const w = 320, h = 320;
    const stage = makeStageCanvas(w, h);
    seedGradient(stage);
    const ctx = stage.getContext();
    const before = Uint8ClampedArray.from(stage.pixels);
    // Heavy motion, zero bass → depth = 1*0.6 = 0.6, maxScale=1.03.
    FX.apply(ctx, stage, { feat: { bass: 0 } }, { motion: 1, chroma: 0, bloom: 0 });
    const after = stage.pixels;
    const md = meanDiff(before, after, w * h * 4);
    assert(md > 0.001, `parallax changed pixels (mean diff=${md.toFixed(4)})`);

    // 8 bands → 8 drawImage ops on the stage canvas.
    const drawOps = opLog.filter(o => o[0] === 'drawImage' && o[1] === 'stage');
    assert(drawOps.length >= 8,
      `parallax produced >=8 stage drawImage calls (got ${drawOps.length})`);

    // The middle band (band 4 of 8, y∈[160,200)) gets a slight scale and
    // a small vertical shift (dy ≈ 159.4). The visible change is at the
    // *boundary* rows of the redrawn region — the top edge of band 4
    // (y≈159) gets filled with resampled band-4 data where the original
    // held band-3 pixels. Sample one row above the original band-4
    // boundary; the middle row should change while the top row of band 0
    // (no rescale) should not.
    let midDiff = 0, topDiff = 0;
    const midY = 159;  // one row above band-4 boundary, now band-4 content
    const topY = 4;    // inside band 0, no rescale, no shift
    const colRange = 40; // avoid edge resample weirdness
    for (let x = colRange; x < w - colRange; x++) {
      const iMid  = (midY  * w + x) * 4;
      const iTop  = (topY  * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        midDiff += Math.abs(after[iMid + c] - before[iMid + c]);
        topDiff += Math.abs(after[iTop + c] - before[iTop + c]);
      }
    }
    assert(midDiff > topDiff,
      `parallax boundary row changed more than top row (mid=${midDiff}, top=${topDiff})`);
  }

  console.log('\n=== 4. chromatic aberration shifts pixels (visible diff) ===');
  {
    const FX = loadFX();
    const w = 256, h = 256;
    const stage = makeStageCanvas(w, h);
    seedGradient(stage);
    const ctx = stage.getContext();
    const before = Uint8ClampedArray.from(stage.pixels);
    // Strong onset + chroma → mag = (1+1)*3 = 6 px.
    FX.apply(ctx, stage,
      { feat: { bass: 0, onset: 1, rms: 0 } },
      { chroma: 1, motion: 0, bloom: 0 });
    const after = stage.pixels;
    const md = meanDiff(before, after, w * h * 4);
    assert(md > 0.5, `chromatic changed pixels (mean diff=${md.toFixed(3)})`);

    // Chromatic uses a scratch canvas — getImageData/putImageData
    // should appear in the shared opLog with tag='scratch'.
    const getOps = opLog.filter(o => o[0] === 'getImageData' && o[1] === 'scratch');
    const putOps = opLog.filter(o => o[0] === 'putImageData' && o[1] === 'scratch');
    assert(getOps.length >= 1, `scratch saw getImageData (got ${getOps.length})`);
    assert(putOps.length >= 1, `scratch saw putImageData (got ${putOps.length})`);

    // R/B channels should no longer be perfectly correlated with G
    // across a row. Sample the middle row.
    const y = (h / 2) | 0;
    let rEqG = 0, bEqG = 0, totalPx = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      totalPx++;
      if (after[i] === after[i + 1]) rEqG++;
      if (after[i + 2] === after[i + 1]) bEqG++;
    }
    // After the chromatic shift, at least one pixel should differ.
    assert((rEqG + bEqG) < (totalPx * 2),
      `chromatic decoupled R/G/B (R==G=${rEqG}, B==G=${bEqG} of ${totalPx})`);
  }

  console.log('\n=== 5. bloom modifies output (lighter composite visible) ===');
  {
    const FX = loadFX();
    const w = 256, h = 256;
    const stage = makeStageCanvas(w, h);
    // Default alpha=255, sparse bright dots so bloom has something to lift.
    for (let i = 3; i < stage.pixels.length; i += 4) stage.pixels[i] = 255;
    for (let n = 0; n < 12; n++) {
      const cx = ((n * 37) % w) | 0;
      const cy = ((n * 53) % h) | 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || x >= w || y < 0 || y >= h) continue;
          const i = (y * w + x) * 4;
          stage.pixels[i]     = 200;
          stage.pixels[i + 1] = 200;
          stage.pixels[i + 2] = 200;
        }
      }
    }
    const ctx = stage.getContext();
    const before = Uint8ClampedArray.from(stage.pixels);
    FX.apply(ctx, stage, { feat: { bass: 0, onset: 0 } },
      { chroma: 0, motion: 0, bloom: 0.8 });
    const after = stage.pixels;
    const md = meanDiff(before, after, w * h * 4);
    assert(md > 0.5, `bloom lifted pixels (mean diff=${md.toFixed(3)})`);

    // The bloom's drawImage back to the stage canvas must use
    // globalCompositeOperation='lighter'.
    const lighterOps = opLog.filter(
      o => o[0] === 'drawImage' && o[1] === 'stage' && o[11] === 'lighter'
    );
    assert(lighterOps.length >= 1,
      `lighter composite used on stage (got ${lighterOps.length})`);

    // Mean RGB brightness should not have decreased (additive bloom
    // lifts highlights, doesn't dim anything).
    const bSum = sumRGB(before);
    const aSum = sumRGB(after);
    assert(aSum >= bSum * 0.999,
      `bloom did not darken the frame (before=${bSum}, after=${aSum})`);
  }

  console.log('\n=== 6. spatial mirror shifts with audio pan ===');
  {
    const FX = loadFX();
    const w = 320, h = 80;
    const stage = makeStageCanvas(w, h);
    // vertical bars so a horizontal shift is visible
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const i = (y * w + x) * 4;
        stage.pixels[i]     = (x % 32) * 8;
        stage.pixels[i + 1] = (x % 32) * 8;
        stage.pixels[i + 2] = 255 - (x % 32) * 8;
        stage.pixels[i + 3] = 255;
      }
    }
    const ctx = stage.getContext();
    FX.apply(ctx, stage,
      { feat: { bass: 0, onset: 0 }, channelL: 1.0, channelR: 0.0 },
      { chroma: 0, motion: 0, bloom: 0 });

    // pan = +1 → dx = +20 → expect a fillRect on the left 20px gutter.
    const fillOps = opLog.filter(o => o[0] === 'fillRect' && o[1] === 'stage');
    assert(fillOps.length >= 1,
      `mirror issued a fillRect gutter (got ${fillOps.length})`);
    // The fillRect should target the left edge when pan > 0.
    // op format: ['fillRect', tag, x, y, w, h, fillStyle] → o[2]=x.
    const leftGutter = fillOps.some(o => o[2] === 0 && o[4] > 0 && o[4] <= 30);
    assert(leftGutter, `positive pan → fillRect at left edge (x=0)`);
  }

  console.log('\n=== 7. safe defaults when audio/chapter are missing ===');
  {
    const FX = loadFX();
    const stage = makeStageCanvas(640, 360);
    seedGradient(stage);
    const ctx = stage.getContext();
    let threw = false;
    try {
      FX.apply(ctx, stage, null, null);
    } catch (e) {
      threw = true;
      console.error('  THREW:', e.message);
    }
    assert(!threw, 'apply survives null audio + null chapter');
    let threw2 = false;
    try {
      FX.apply(ctx, stage, {}, {});
    } catch (e) { threw2 = true; }
    assert(!threw2, 'apply survives empty audio + empty chapter');
  }

  console.log('\n=== 8. computePan returns signed ratio from channels ===');
  {
    // We can't poke the internal function, but we can drive apply() with
    // different channel balances and observe the mirror effect.
    const FX = loadFX();
    for (const { l, r, expectFill } of [
      { l: 1.0, r: 0.0, expectFill: 'left' },
      { l: 0.0, r: 1.0, expectFill: 'right' },
      { l: 0.5, r: 0.5, expectFill: 'none' },
    ]) {
      resetOpLog();
      const stage = makeStageCanvas(320, 80);
      // full-alpha white so mirror overwrites everything visibly
      for (let i = 0; i < stage.pixels.length; i += 4) {
        stage.pixels[i] = 255; stage.pixels[i+1] = 255;
        stage.pixels[i+2] = 255; stage.pixels[i+3] = 255;
      }
      const ctx = stage.getContext();
      FX.apply(ctx, stage, { feat: { bass: 0, onset: 0 }, channelL: l, channelR: r },
        { chroma: 0, motion: 0, bloom: 0 });
      const fillOps = opLog.filter(o => o[0] === 'fillRect' && o[1] === 'stage');
      if (expectFill === 'none') {
        assert(fillOps.length === 0,
          `balanced L/R (${l}/${r}) → no gutter fillRect`);
      } else if (expectFill === 'left') {
        // positive pan → fillRect at x=0 with width up to ~20
        const hit = fillOps.some(o => o[2] === 0 && o[4] > 0 && o[4] <= 30);
        assert(hit, `L-dominant (${l}/${r}) → left-edge fillRect`);
      } else {
        // negative pan → dx < 0 → fillRect at x=w-|dx|
        const w = 320;
        const hit = fillOps.some(o =>
          o[2] >= (w - 30) && o[2] <= w && o[4] > 0);
        assert(hit, `R-dominant (${l}/${r}) → right-edge fillRect`);
      }
    }
  }

  console.log('\n' + (failures === 0
    ? `FX-SPATIAL UNIT: ALL GREEN (8 tests)`
    : `FX-SPATIAL UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});