// client/fx-spatial.client.js — post-process spatial FX chain applied to
// the engine's stage <canvas> after the underlying draw pass.
//
// Effects run in order, each writing the modified result back to the
// same canvas so the next effect can read it:
//
//   1. FAKE-3D PARALLAX — slice into 8 horizontal bands, scale each
//      vertically by 1 + depth*0.05 where
//      depth = A.feat.bass * 0.4 + chapterState.motion * 0.6. Mid
//      bands get the largest scale so the eye reads "depth" instead
//      of "vertical stretch".
//   2. SPATIAL MIRROR — translate the frame ±20px horizontally based
//      on L-R channel pan = (L-R)/(L+R). A blank gutter band keeps
//      the move from showing garbage.
//   3. CHROMATIC ABERRATION — split R/G/B via getImageData on a
//      downscaled 720p buffer; shift each channel radially. Magnitude
//      = (A.feat.onset + chapterState.chroma) * 3.
//   4. BLOOM — additive gaussian-style glow. Render a downscaled
//      blurred copy via ctx.filter='blur(Npx)' and composite with
//      globalCompositeOperation='lighter'.
//
// Performance: getImageData + canvas allocation runs on a 720p scratch
// buffer, drawImage upsamples back to the stage. The scratch buffer +
// ImageData are reused across frames; each effect short-circuits when
// its parameter is ~0 so idle frames do almost no work.
//
// Public surface (window.SWR_FX_SPATIAL):
//   .apply(ctx, canvas, audioFeat, chapterState) → void
//   .enabled — boolean kill-switch (default true)
//
// Conventions match the rest of client/*.client.js: browser global,
// IIFE, 'use strict', single quotes, 2-space, tolerant of missing
// audio/chapter state (safe defaults).
//
// Author: Kai Djuric · 2026-09-10

(function () {
  'use strict';
  if (window.SWR_FX_SPATIAL) return;

  // ---- tunables ----------------------------------------------------------

  var PARALLAX_BANDS = 8;
  var PARALLAX_DEPTH_SCALE = 0.05;       // per-unit depth
  var MIRROR_MAX_PX = 20;
  var CHROMA_RADIUS_SCALE = 3;           // pixels per unit
  var CHROMA_DOWNSCALE_W = 1280;         // scratch buffer width
  var CHROMA_DOWNSCALE_H = 720;
  var BLOOM_BLUR_PX = 24;
  var BLOOM_DOWNSCALE = 0.5;             // half-res for the blurred copy

  // ---- scratch buffers (lazy) --------------------------------------------

  var scratch = null; // {w, h, canvas, ctx, imageData}

  function getScratch(w, h) {
    if (scratch && scratch.w === w && scratch.h === h) return scratch;
    if (typeof document === 'undefined') return null;
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var cx = c.getContext('2d');
    if (!cx) return null;
    scratch = { w: w, h: h, canvas: c, ctx: cx, imageData: null };
    return scratch;
  }

  function getImageData(buf) {
    if (buf.imageData && buf.imageData.width === buf.w && buf.imageData.height === buf.h) {
      return buf.imageData;
    }
    buf.imageData = buf.ctx.createImageData(buf.w, buf.h);
    return buf.imageData;
  }

  // ---- helpers -----------------------------------------------------------

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function safeNum(v, fallback) {
    return (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;
  }

  // pan ∈ [-1, 1]. Pulls L/R channel energy from audioFeat:
  //   - prefer audioFeat.channelL / channelR (already-computed RMS)
  //   - else split audioFeat.spectrum in half (left = lower freqs)
  //   - else fall back to 0
  function computePan(audioFeat) {
    if (!audioFeat) return 0;
    var l = safeNum(audioFeat.channelL, NaN);
    var r = safeNum(audioFeat.channelR, NaN);
    if (!Number.isNaN(l) && !Number.isNaN(r)) {
      var denom = l + r;
      if (denom < 1e-6) return 0;
      return clamp((l - r) / denom, -1, 1);
    }
    var spec = audioFeat.spectrum;
    if (spec && typeof spec.length === 'number' && spec.length > 1) {
      var half = spec.length >> 1;
      var sumL = 0, sumR = 0;
      for (var i = 0; i < half; i++) sumL += spec[i];
      for (var j = half; j < spec.length; j++) sumR += spec[j];
      var d2 = sumL + sumR;
      if (d2 < 1e-6) return 0;
      return clamp((sumL - sumR) / d2, -1, 1);
    }
    return 0;
  }

  // ---- effect 1: parallax ------------------------------------------------

  function applyParallax(ctx, w, h, depth) {
    if (depth <= 1e-4) return;
    var bandH = h / PARALLAX_BANDS;
    // mid-band emphasis: gaussian-ish profile so the center bulges.
    var mid = (PARALLAX_BANDS - 1) / 2;
    var maxScale = 1 + depth * PARALLAX_DEPTH_SCALE;
    for (var i = 0; i < PARALLAX_BANDS; i++) {
      // 1.0 at edges → maxScale at center.
      var t = (i - mid) / mid;          // -1..1
      var s = 1 + (maxScale - 1) * (1 - t * t);
      var sy = bandH * s;
      var dy = i * bandH + (bandH - sy) / 2;
      // redraw the band stretched into itself
      try {
        ctx.drawImage(
          ctx.canvas,
          0, i * bandH, w, bandH,
          0, dy, w, sy
        );
      } catch (e) {
        // drawImage of a canvas into itself during a live paint is
        // well-defined in modern browsers but bail to be safe.
      }
    }
  }

  // ---- effect 2: spatial mirror -----------------------------------------

  function applyMirror(ctx, w, h, pan) {
    if (Math.abs(pan) < 1e-4) return;
    var dx = pan * MIRROR_MAX_PX;
    // fill the trailing gutter so we don't smear garbage onto the canvas
    ctx.fillStyle = '#000';
    if (dx > 0) {
      ctx.fillRect(0, 0, dx, h);
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.drawImage(ctx.canvas, -dx, 0);
    } else {
      var pad = -dx;
      ctx.fillRect(w - pad, 0, pad, h);
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.drawImage(ctx.canvas, pad, 0);
    }
  }

  // ---- effect 3: chromatic aberration -----------------------------------

  function applyChromatic(ctx, w, h, feat, chapter) {
    var onset = safeNum(feat && feat.onset, 0);
    var chroma = safeNum(chapter && chapter.chroma, 0);
    var mag = (onset + chroma) * CHROMA_RADIUS_SCALE;
    if (mag < 0.5) return;
    var sw = Math.min(CHROMA_DOWNSCALE_W, w);
    var sh = Math.min(CHROMA_DOWNSCALE_H, h);
    var buf = getScratch(sw, sh);
    if (!buf) return;
    // snapshot
    buf.ctx.clearRect(0, 0, sw, sh);
    buf.ctx.drawImage(ctx.canvas, 0, 0, sw, sh);
    var img = getImageData(buf);
    buf.ctx.getImageData(0, 0, sw, sh, img.data);
    var px = img.data;
    // precompute channel-specific horizontal offsets (radial shift ≈ uniform
    // horizontal nudge per row; we keep it constant so the read is O(n)).
    var rShift = +mag;
    var bShift = -mag;
    // shift R left, B right. Operate in-place per row on the scratch buffer.
    for (var y = 0; y < sh; y++) {
      var rowStart = y * sw * 4;
      for (var x = 0; x < sw; x++) {
        var i4 = rowStart + x * 4;
        // R: pull from x - rShift
        var rSrc = x - rShift;
        if (rSrc >= 0 && rSrc < sw) {
          px[i4] = px[rowStart + Math.floor(rSrc) * 4];
        } else {
          px[i4] = 0;
        }
        // G: leave as-is (already captured)
        // B: pull from x - bShift (bShift negative → x + mag)
        var bSrc = x - bShift;
        if (bSrc >= 0 && bSrc < sw) {
          px[i4 + 2] = px[rowStart + Math.floor(bSrc) * 4 + 2];
        } else {
          px[i4 + 2] = 0;
        }
        // alpha kept
      }
    }
    buf.ctx.putImageData(img, 0, 0);
    // draw back to full stage
    ctx.drawImage(buf.canvas, 0, 0, w, h);
  }

  // ---- effect 4: bloom ---------------------------------------------------

  function applyBloom(ctx, w, h, chapter) {
    var intensity = safeNum(chapter && chapter.bloom, 0.4);
    if (intensity <= 1e-3) return;
    var sw = Math.max(2, Math.round(w * BLOOM_DOWNSCALE));
    var sh = Math.max(2, Math.round(h * BLOOM_DOWNSCALE));
    var buf = getScratch(sw, sh);
    if (!buf) return;
    buf.ctx.clearRect(0, 0, sw, sh);
    buf.ctx.filter = 'blur(' + BLOOM_BLUR_PX + 'px)';
    buf.ctx.drawImage(ctx.canvas, 0, 0, sw, sh);
    buf.ctx.filter = 'none';
    // additive composite — the blurred copy lays on top, lighter keeps
    // highlights bright and avoids muddying midtones.
    var prevOp = ctx.globalCompositeOperation;
    var prevAlpha = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(intensity, 0, 1);
    ctx.drawImage(buf.canvas, 0, 0, w, h);
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevOp;
  }

  // ---- public apply -----------------------------------------------------

  function apply(ctx, canvas, audioFeat, chapterState) {
    if (!ctx || !canvas) return;
    var w = canvas.width | 0;
    var h = canvas.height | 0;
    if (w <= 0 || h <= 0) return;
    var feat = (audioFeat && audioFeat.feat) || audioFeat || {};
    var chapter = chapterState || {};
    var bass = safeNum(feat.bass, 0);
    var motion = safeNum(chapter.motion, 0);
    var depth = bass * 0.4 + motion * 0.6;

    // 1. parallax — reads + writes ctx.canvas
    applyParallax(ctx, w, h, depth);
    // 2. spatial mirror
    var pan = computePan(audioFeat);
    applyMirror(ctx, w, h, pan);
    // 3. chromatic aberration — uses scratch buffer
    applyChromatic(ctx, w, h, feat, chapter);
    // 4. bloom — uses scratch buffer
    applyBloom(ctx, w, h, chapter);
  }

  window.SWR_FX_SPATIAL = {
    apply: apply,
    enabled: true,
  };
})();