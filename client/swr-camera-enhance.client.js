/* client/swr-camera-enhance.client.js — Camera Enhance runtime (PR 4 of 4).
 *
 * Clean processing for camera-shot footage. One renderer, two outputs: the
 * preview composites into a <canvas>, and the export composites the same
 * frame with the same ops at output resolution (see
 * client/swr-camera-enhance-export.client.js). That is the whole point —
 * what you see is what you export.
 *
 * Grade mapping (documented, deterministic — unit-tested in
 * scripts/check-camera-enhance-unit.mjs):
 *   brightness = exposure + 0.4*shadows + 0.2*highlights
 *   contrast   = contrast + 0.3*highlights - 0.3*shadows
 *   saturation = saturation                    (mono preset: -100 → grayscale)
 *   temperature > 0 → sepia + warm hue-rotate
 *   temperature < 0 → the cool trick (rotate 180, sepia, rotate back)
 *   tint       → small hue-rotate + saturate nudge
 *   grain / vignette are painted layers, not filters
 *
 * Fixes are real passes, not switches:
 *   auto exposure  frames sampled on a coarse grid → bounded grade bias
 *   stabilize      coarse-grid translation estimate → smoothed counter-move
 *   denoise        edge-preserving soften (two blur radii mixed)
 *   smooth motion  temporal blend of the previous frame
 *
 * Public API:
 *   window.SWR_CAMERA_ENHANCE.create(options) -> instance
 *   pure helpers exported alongside for tests: LOOKS, buildFilter,
 *   autoExposureBias, formatRect, estimateShift, smoothPath, overlayAlpha.
 */
(function () {
  'use strict';
  if (window.SWR_CAMERA_ENHANCE) return;

  // ---------------------------------------------------------------- presets
  // §5 of docs/prds/camera-enhance.md, verbatim.
  const LOOKS = {
    clean:   { brightness: 0,   contrast: 0,   saturation: 0,    highlights: 0,   shadows: 0,   temperature: 0,   tint: 0,   grain: 0,  vignette: 0,  description: 'Neutral, faithful to source' },
    film:    { brightness: -5,  contrast: 15,  saturation: -10,  highlights: -20, shadows: 15,  temperature: 5,   tint: 0,   grain: 25, vignette: 30, description: 'Kodak Portra-inspired warmth' },
    warm:    { brightness: 5,   contrast: 5,   saturation: 10,   highlights: 10,  shadows: 10,  temperature: 25,  tint: 5,   grain: 0,  vignette: 15, description: 'Golden hour, inviting' },
    cool:    { brightness: 0,   contrast: 10,  saturation: -5,   highlights: 15,  shadows: -10, temperature: -20, tint: -5,  grain: 0,  vignette: 10, description: 'Crisp, modern, editorial' },
    mono:    { brightness: 0,   contrast: 20,  saturation: -100, highlights: 10,  shadows: 20,  temperature: 0,   tint: 0,   grain: 35, vignette: 40, description: 'High contrast black & white' },
    vintage: { brightness: -10, contrast: -5,  saturation: -20,  highlights: -15, shadows: 20,  temperature: 30,  tint: 10,  grain: 45, vignette: 50, description: 'Faded, nostalgic, lo-fi' },
    neon:    { brightness: -5,  contrast: 25,  saturation: 20,   highlights: -10, shadows: 25,  temperature: -10, tint: -15, grain: 15, vignette: 35, description: 'Cyberpunk, night city' },
    custom:  { brightness: 0,   contrast: 0,   saturation: 0,    highlights: 0,   shadows: 0,   temperature: 0,   tint: 0,   grain: 0,  vignette: 0,  description: 'Your own look' },
  };

  const PARAM_KEYS = ['exposure', 'contrast', 'saturation', 'highlights', 'shadows', 'temperature', 'tint', 'grain', 'vignette'];

  // §4.4 export shapes.
  const FORMAT_ASPECT = { '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9, '2.39:1': 2.39 };
  const QUALITY_LONG_EDGE = { '1080': 1920, '4K': 3840 };
  const FIX_NAMES = ['stabilize', 'denoise', 'smooth', 'expose'];
  const OVERLAY_MODES = ['subtle', 'mood', 'energy', 'off'];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clamp01 = (v) => clamp(v, 0, 1);

  // ------------------------------------------------------------ grade math
  function effectiveParams(lookId, customParams, autoBias) {
    const base = LOOKS[lookId] || LOOKS.clean;
    const custom = lookId === 'custom' ? (customParams || {}) : {};
    const p = {};
    for (const k of PARAM_KEYS) {
      // §5 names the preset key `brightness`; §4.3 names the slider `exposure`.
      // Map between them here so a preset's brightness is never dropped.
      const baseVal = k === 'exposure' ? base.brightness : base[k];
      const v = custom[k] !== undefined ? Number(custom[k]) : Number(baseVal || 0);
      p[k] = Number.isFinite(v) ? v : 0;
    }
    if (autoBias) p.exposure = clamp(p.exposure + autoBias, -60, 60);
    return p;
  }

  function buildFilter(params) {
    const p = params || {};
    const n = (k) => Number(p[k] || 0);
    const brightness = clamp(1 + (n('exposure') + 0.4 * n('shadows') + 0.2 * n('highlights')) / 100, 0.2, 3);
    const contrast = clamp(1 + (n('contrast') + 0.3 * n('highlights') - 0.3 * n('shadows')) / 100, 0.2, 3);
    const saturation = clamp(1 + n('saturation') / 100, 0, 3);
    const parts = [`brightness(${brightness.toFixed(3)})`, `contrast(${contrast.toFixed(3)})`, `saturate(${saturation.toFixed(3)})`];

    const temp = n('temperature');
    if (temp > 0) {
      const s = clamp01((temp / 100) * 0.35);
      parts.push(`sepia(${s.toFixed(3)})`, `hue-rotate(${(-12 * (temp / 100)).toFixed(2)}deg)`);
    } else if (temp < 0) {
      const s = clamp01((-temp / 100) * 0.35);
      parts.push('hue-rotate(180deg)', `sepia(${s.toFixed(3)})`, 'hue-rotate(-180deg)');
    }

    const tint = n('tint');
    if (tint !== 0) {
      parts.push(`hue-rotate(${(tint * 0.12).toFixed(2)}deg)`, `saturate(${clamp(1 + Math.abs(tint) / 400, 0, 2).toFixed(3)})`);
    }
    return parts.join(' ');
  }

  // Painted layers scale 0..1 from the preset's 0..100.
  const grainAlpha = (params) => clamp01(Number((params || {}).grain || 0) / 100) * 0.5;
  const vignetteAlpha = (params) => clamp01(Number((params || {}).vignette || 0) / 100) * 0.8;

  // --------------------------------------------------------- auto exposure
  // mean/low/high are 0..1 luma statistics of the sampled frame. Returns a
  // bounded exposure bias (percentage points) that pulls the mean toward the
  // target band and reacts to clipping.
  function autoExposureBias(stats) {
    const s = stats || {};
    const mean = clamp01(Number(s.mean) || 0);
    const high = clamp01(Number(s.high) || 0);
    const low = clamp01(Number(s.low) || 0);
    const target = 0.5;
    let bias = (target - mean) * 100 * 0.6;
    if (high > 0.02) bias -= (high - 0.02) * 100 * 2.0;   // protect highlights
    if (low > 0.05) bias += (low - 0.05) * 100 * 1.2;     // lift crushed shadows
    return clamp(bias, -25, 25);
  }

  // ------------------------------------------------------------- stabiliser
  // Estimate the translation between two coarse luma grids by exhaustive
  // search over a small window. Returns {dx, dy} in grid cells.
  function estimateShift(prev, cur, w, h, range) {
    if (!prev || !cur || !w || !h) return { dx: 0, dy: 0 };
    const r = range === undefined ? 3 : range;
    let best = Infinity;
    let bx = 0;
    let by = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        let sum = 0;
        let count = 0;
        for (let y = r; y < h - r; y += 2) {
          for (let x = r; x < w - r; x += 2) {
            const a = cur[y * w + x];
            const b = prev[(y + dy) * w + (x + dx)];
            sum += a > b ? a - b : b - a;
            count++;
          }
        }
        const score = count ? sum / count : 0;
        if (score < best) { best = score; bx = dx; by = dy; }
      }
    }
    return { dx: bx, dy: by };
  }

  // Smooth a cumulative motion path with an exponential moving average so the
  // counter-move is gradual (no fighting the footage). Positions in, positions
  // out — the input is already the cumulative path, so it is NOT re-summed.
  function smoothPath(series, alpha) {
    const a = alpha === undefined ? 0.12 : alpha;
    const out = [];
    let prev = 0;
    (series || []).forEach((v, i) => {
      const x = Number(v) || 0;
      prev = i === 0 ? x : prev + (x - prev) * a;
      out.push(prev);
    });
    return out;
  }

  // ------------------------------------------------------------- geometry
  // Cover-crop the source into the target aspect and scale to the output box.
  function formatRect(format, srcW, srcH, outLongEdge) {
    const aspect = FORMAT_ASPECT[format] || FORMAT_ASPECT['16:9'];
    const srcAspect = srcW / srcH;
    let sw = srcW;
    let sh = srcH;
    if (srcAspect > aspect) sw = Math.round(srcH * aspect);      // crop sides
    else if (srcAspect < aspect) sh = Math.round(srcW / aspect); // crop top/bottom
    const sx = Math.round((srcW - sw) / 2);
    const sy = Math.round((srcH - sh) / 2);
    let outW = aspect >= 1 ? outLongEdge : Math.round(outLongEdge * aspect);
    let outH = aspect >= 1 ? Math.round(outLongEdge / aspect) : outLongEdge;
    outW = Math.max(2, outW - (outW % 2));
    outH = Math.max(2, outH - (outH % 2));
    return { sx, sy, sw, sh, outW, outH };
  }

  function outputLongEdge(quality, srcW, srcH) {
    const cap = QUALITY_LONG_EDGE[quality] || QUALITY_LONG_EDGE['1080'];
    const sourceLong = Math.max(srcW, srcH) || cap;
    return Math.min(cap, sourceLong);
  }

  // --------------------------------------------------------------- overlay
  // §4.5: overlays stay subtle. Alpha is capped so even intensity 100 keeps
  // the footage dominant (the PRD's "30% opacity max by default").
  function overlayAlpha(mode, intensity) {
    const i = clamp01((Number(intensity) || 0) / 100);
    if (mode === 'off') return 0;
    const peak = { subtle: 0.18, mood: 0.26, energy: 0.3 }[mode];
    return peak === undefined ? 0 : peak * i;
  }

  function drawOverlay(ctx, mode, intensity, w, h, audio, timeMs) {
    const alpha = overlayAlpha(mode, intensity);
    if (!alpha) return;
    const t = (timeMs || 0) / 1000;
    const energy = audio ? audio.energy : 0.3;
    ctx.save();
    if (mode === 'subtle') {
      const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.8);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${(alpha * (0.4 + energy * 0.6)).toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const size = w * (0.12 + (audio ? audio.bass * 0.06 : 0));
      const accent = ctx.createLinearGradient(w - size, 0, w, size);
      accent.addColorStop(0, 'rgba(0,0,0,0)');
      accent.addColorStop(1, `rgba(245,158,11,${(alpha * 0.8).toFixed(3)})`);
      ctx.beginPath();
      ctx.moveTo(w - size, 0); ctx.lineTo(w, 0); ctx.lineTo(w, size); ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
    } else if (mode === 'mood') {
      const ox = w * (0.3 + Math.sin(t * 0.2) * 0.2);
      const oy = h * (0.4 + Math.cos(t * 0.15) * 0.2);
      const radius = h * 0.35 * (0.7 + energy * 0.6);
      const orb = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
      const hue = 30 + energy * 30;
      orb.addColorStop(0, `hsla(${hue.toFixed(0)},70%,60%,${(alpha * 0.55).toFixed(3)})`);
      orb.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = orb;
      ctx.fillRect(0, 0, w, h);
      const bottom = ctx.createLinearGradient(0, h * 0.7, 0, h);
      bottom.addColorStop(0, 'hsla(0,0%,0%,0)');
      bottom.addColorStop(1, `hsla(${hue.toFixed(0)},50%,40%,${(alpha * 0.7).toFixed(3)})`);
      ctx.fillStyle = bottom;
      ctx.fillRect(0, h * 0.7, w, h * 0.3);
    } else if (mode === 'energy') {
      const bars = 4;
      const bandW = w / bars;
      const maxH = h * 0.15;
      const levels = audio ? [audio.bass, audio.mid, audio.high, audio.energy] : [0.3, 0.3, 0.3, 0.3];
      for (let i = 0; i < bars; i++) {
        const bh = clamp01(levels[i]) * maxH * (alpha / 0.3);
        const grad = ctx.createLinearGradient(0, h, 0, h - bh);
        grad.addColorStop(0, `rgba(245,158,11,${(alpha).toFixed(3)})`);
        grad.addColorStop(1, `rgba(239,68,68,${(alpha * 0.35).toFixed(3)})`);
        ctx.fillStyle = grad;
        ctx.fillRect(i * bandW + bandW * 0.2, h - bh, bandW * 0.6, bh);
      }
      if (audio) {
        const cross = 20 + audio.bass * 30 * (alpha / 0.3);
        ctx.strokeStyle = `rgba(255,255,255,${(alpha * 0.4).toFixed(3)})`;
        ctx.lineWidth = Math.max(1, w / 1080);
        ctx.beginPath();
        ctx.moveTo(w / 2 - cross, h / 2); ctx.lineTo(w / 2 + cross, h / 2);
        ctx.moveTo(w / 2, h / 2 - cross); ctx.lineTo(w / 2, h / 2 + cross);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // -------------------------------------------------------------- burn-ins
  // Painted into the composite (not DOM), so the export records exactly what
  // the preview showed.
  function drawBurnIns(ctx, w, h, state) {
    const b = (state && state.burnIns) || {};
    const txt = (state && state.burnText) || {};
    const pad = Math.round(w * 0.035);
    const sans = "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif";
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    if (b.logo) {
      const fs = Math.round(w * 0.026);
      ctx.font = `700 ${fs}px ${sans}`;
      ctx.fillStyle = 'rgba(245,241,235,0.85)';
      ctx.fillText('SWR', pad, pad + fs);
      ctx.fillRect(pad, pad + fs + Math.round(fs * 0.28), Math.round(fs * 1.6), Math.max(1, Math.round(fs * 0.1)));
    }
    // The forced SWR mark owns the bottom-right corner (drawMark paints it after
    // this), so the burn-in stacks sit ABOVE its band — never under it.
    const small = Math.round(w * 0.024);
    const markH = Math.round(w * 0.026 * 1.7);
    const bottomPad = pad + markH + Math.round(w * 0.014);
    const dateStr = txt.date || '';
    const locStr = txt.location || '';
    const rightStack = [];
    if (b.date && dateStr) rightStack.push(dateStr);
    if (b.location && locStr) rightStack.push(locStr);
    if (rightStack.length) {
      ctx.font = `500 ${small}px ${sans}`;
      ctx.fillStyle = 'rgba(245,241,235,0.72)';
      ctx.textAlign = 'right';
      rightStack.forEach((line, i) => {
        ctx.fillText(line, w - pad, h - bottomPad - (rightStack.length - 1 - i) * Math.round(small * 1.4));
      });
      ctx.textAlign = 'left';
    }
    const sub = txt.subtitle || '';
    const title = txt.title || '';
    let baseY = h - bottomPad;
    if (b.subtitle && sub) {
      const fs = Math.round(w * 0.028);
      ctx.font = `500 ${fs}px ${sans}`;
      ctx.fillStyle = 'rgba(245,241,235,0.78)';
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = Math.round(w * 0.012);
      ctx.fillText(sub, pad, baseY);
      baseY -= Math.round(fs * 1.45);
    }
    if (b.title && title) {
      const fs = Math.round(w * 0.045);
      ctx.font = `700 ${fs}px ${sans}`;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = Math.round(w * 0.014);
      ctx.fillText(title, pad, baseY);
    }
    ctx.restore();
  }

  // The repo's mark rule: every export carries the SWR mark (forced for the
  // free tier — same as /tiktok). Painted into the same composite.
  function drawMark(ctx, w, h) {
    const pad = Math.round(w * 0.03);
    const fs = Math.max(10, Math.round(w * 0.026));
    const sans = "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif";
    const label = 'SWR';
    const suffix = '\u00b7 enhance';
    ctx.save();
    ctx.font = `700 ${fs}px ${sans}`;
    const labelW = ctx.measureText(label).width;
    const suffixFs = Math.round(fs * 0.82);
    ctx.font = `500 ${suffixFs}px ${sans}`;
    const suffixW = ctx.measureText(suffix).width;
    const bh = Math.round(fs * 1.7);
    const bw = labelW + suffixW + bh * 0.9;
    const x = w - pad - bw;
    const y = h - pad - bh;
    const r = bh / 2;
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = 'rgba(10,13,18,0.55)';
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + bw, y, x + bw, y + bh, r);
    ctx.arcTo(x + bw, y + bh, x, y + bh, r);
    ctx.arcTo(x, y + bh, x, y, r);
    ctx.arcTo(x, y, x + bw, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(245,241,235,0.92)';
    ctx.font = `700 ${fs}px ${sans}`;
    ctx.fillText(label, x + bh * 0.42, y + bh / 2 + 1);
    ctx.fillStyle = 'rgba(245,241,235,0.62)';
    ctx.font = `500 ${suffixFs}px ${sans}`;
    ctx.fillText(suffix, x + bh * 0.42 + labelW + Math.round(fs * 0.18), y + bh / 2 + 1);
    ctx.restore();
  }

  // ----------------------------------------------------------------- noise
  // One 128x128 grain tile, reused as a pattern (cheap + deterministic-ish per
  // page load). Built lazily so unit tests never touch a canvas.
  let grainTile = null;
  function getGrainTile() {
    if (grainTile) return grainTile;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(128, 128);
    let seed = 1337;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = 40 + ((seed >> 16) & 0x7f);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    grainTile = c;
    return c;
  }

  // ---------------------------------------------------------------- instance
  function create(options) {
    const opts = options || {};
    const video = opts.video;
    const state = {
      ready: false,
      lookId: opts.lookId || 'clean',
      custom: {},
      params: {},
      fixes: { stabilize: true, denoise: false, smooth: false, expose: true },
      overlayMode: opts.overlayMode || 'subtle',
      overlayIntensity: opts.overlayIntensity === undefined ? 30 : opts.overlayIntensity,
      format: opts.format || '16:9',
      quality: opts.quality || '4K',
      burnIns: { logo: false, title: false, subtitle: false, date: false, location: false },
      burnText: { title: opts.title || '', subtitle: opts.subtitle || '', location: opts.location || '', date: opts.date || '' },
      meta: null,
      autoBias: 0,
      lastStats: null,
      playing: false,
    };

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 96;
    sampleCanvas.height = 54;
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    let gridPrev = null;
    let pathRawX = [];
    let pathRawY = [];
    let pathX = 0;
    let pathY = 0;
    let smoothPrev = null;
    let smoothPrevCtx = null;

    function sampleFrame() {
      if (!video || !video.videoWidth) return null;
      try {
        sampleCtx.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);
        const data = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
        let sum = 0;
        let low = 0;
        let high = 0;
        const n = sampleCanvas.width * sampleCanvas.height;
        const grid = new Float32Array(n);
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const luma = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
          grid[p] = luma;
          sum += luma;
          if (luma < 0.05) low++;
          if (luma > 0.95) high++;
        }
        return { mean: sum / n, low: low / n, high: high / n, grid, w: sampleCanvas.width, h: sampleCanvas.height };
      } catch (e) {
        return null;
      }
    }

    function refreshAutoExposure() {
      if (!state.fixes.expose) { state.autoBias = 0; return; }
      const stats = sampleFrame();
      if (!stats) return;
      state.lastStats = { mean: stats.mean, low: stats.low, high: stats.high };
      state.autoBias = autoExposureBias(stats);
    }

    // Cumulative camera path (raw) vs the smoothed virtual path. The
    // counter-move is (smoothed - raw): a steady pan passes through untouched,
    // jitter gets pulled back toward the virtual trajectory.
    function refreshStabilizer() {
      if (!state.fixes.stabilize) {
        gridPrev = null;
        pathRawX = [];
        pathRawY = [];
        pathX = 0;
        pathY = 0;
        return;
      }
      const stats = sampleFrame();
      if (!stats) return;
      if (gridPrev) {
        const d = estimateShift(gridPrev, stats.grid, stats.w, stats.h, 3);
        pathRawX.push(pathRawX.length ? pathRawX[pathRawX.length - 1] + d.dx : d.dx);
        pathRawY.push(pathRawY.length ? pathRawY[pathRawY.length - 1] + d.dy : d.dy);
        if (pathRawX.length > 90) { pathRawX.shift(); pathRawY.shift(); }
        const sx = smoothPath(pathRawX, 0.12);
        const sy = smoothPath(pathRawY, 0.12);
        pathX = sx.length ? sx[sx.length - 1] - pathRawX[pathRawX.length - 1] : 0;
        pathY = sy.length ? sy[sy.length - 1] - pathRawY[pathRawY.length - 1] : 0;
      }
      gridPrev = stats.grid;
    }

    function currentFilter() {
      state.params = effectiveParams(state.lookId, state.custom, state.fixes.expose ? state.autoBias : 0);
      let filter = buildFilter(state.params);
      if (state.fixes.denoise) filter += ' blur(0.4px)';
      return filter;
    }

    // The one per-frame renderer. Preview and export both call this.
    function renderFrame(ctx, frameOpts) {
      const o = frameOpts || {};
      if (!ctx || !video || !video.videoWidth) return null;
      const srcW = video.videoWidth;
      const srcH = video.videoHeight;
      const long = o.longEdge || outputLongEdge(state.quality, srcW, srcH);
      const rect = formatRect(state.format, srcW, srcH, long);
      const outW = o.width || rect.outW;
      const outH = o.height || rect.outH;
      const t = (o.timeMs === undefined ? performance.now() : o.timeMs);

      ctx.save();
      ctx.clearRect(0, 0, outW, outH);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, outW, outH);

      // stabiliser: counter-move inside a small crop
      let tx = 0;
      let ty = 0;
      let zoom = 1;
      if (state.fixes.stabilize && (pathX || pathY)) {
        // grid cells → output pixels; clamped so the 1.08 crop always covers
        const scaleX = (srcW / 96) * (outW / srcW) * 0.6;
        const scaleY = (srcH / 54) * (outH / srcH) * 0.6;
        tx = clamp(pathX * scaleX, -outW * 0.04, outW * 0.04);
        ty = clamp(pathY * scaleY, -outH * 0.04, outH * 0.04);
        zoom = 1.08;
      }
      const drawW = outW * zoom;
      const drawH = outH * zoom;
      const dx = (outW - drawW) / 2 + tx;
      const dy = (outH - drawH) / 2 + ty;

      ctx.imageSmoothingQuality = 'high';
      // smooth motion: the previous graded frame underneath, current at 55% over
      const blending = state.fixes.smooth && smoothPrev && smoothPrev.width === outW && smoothPrev.height === outH;
      if (blending) ctx.drawImage(smoothPrev, 0, 0);
      ctx.filter = currentFilter();
      if (blending) ctx.globalAlpha = 0.55;
      ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, dx, dy, drawW, drawH);
      ctx.globalAlpha = 1;
      ctx.filter = 'none';

      // grain + vignette (painted layers)
      const gA = grainAlpha(state.params);
      if (gA > 0) {
        const tile = getGrainTile();
        const pattern = ctx.createPattern(tile, 'repeat');
        ctx.globalAlpha = gA;
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, outW, outH);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      const vA = vignetteAlpha(state.params);
      if (vA > 0) {
        const grad = ctx.createRadialGradient(outW / 2, outH / 2, Math.min(outW, outH) * 0.35, outW / 2, outH / 2, Math.max(outW, outH) * 0.75);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, `rgba(0,0,0,${vA.toFixed(3)})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, outW, outH);
      }

      // reactive overlay (§4.5), composited like the PRD's mix-blend-mode: screen
      if (state.overlayMode !== 'off') {
        ctx.globalCompositeOperation = 'screen';
        drawOverlay(ctx, state.overlayMode, state.overlayIntensity, outW, outH, state.audio, t);
        ctx.globalCompositeOperation = 'source-over';
      }

      // burn-ins + the forced mark, painted into the same composite
      drawBurnIns(ctx, outW, outH, state);
      drawMark(ctx, outW, outH);

      ctx.restore();

      // cache this graded frame for the next blend (best-effort)
      if (state.fixes.smooth) {
        try {
          if (!smoothPrev) smoothPrev = document.createElement('canvas');
          if (smoothPrev.width !== outW || smoothPrev.height !== outH) {
            smoothPrev.width = outW;
            smoothPrev.height = outH;
            smoothPrevCtx = null;
          }
          if (!smoothPrevCtx) smoothPrevCtx = smoothPrev.getContext('2d');
          smoothPrevCtx.filter = currentFilter();
          smoothPrevCtx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outW, outH);
          smoothPrevCtx.filter = 'none';
        } catch (e) { /* frame cache is best-effort */ }
      } else if (smoothPrev) {
        smoothPrev = null;
        smoothPrevCtx = null;
      }

      return { rect, outW, outH, filter: currentFilter(), zoom, tx, ty, autoBias: state.autoBias };
    }

    // ------------------------------------------------------------- controls
    function setLook(id) { if (LOOKS[id]) state.lookId = id; return state.lookId; }
    function setParam(k, v) {
      if (!PARAM_KEYS.includes(k)) return null;
      state.custom[k] = clamp(Number(v) || 0, -100, 100);
      return state.custom[k];
    }
    function setFix(name, on) {
      if (!FIX_NAMES.includes(name)) return null;
      state.fixes[name] = !!on;
      if (name === 'expose' && !on) state.autoBias = 0;
      return state.fixes[name];
    }
    function setOverlayMode(m) { if (OVERLAY_MODES.includes(m)) state.overlayMode = m; return state.overlayMode; }
    function setOverlayIntensity(v) { state.overlayIntensity = clamp(Number(v) || 0, 0, 100); return state.overlayIntensity; }
    function setFormat(f) { if (FORMAT_ASPECT[f]) state.format = f; return state.format; }
    function setQuality(q) { if (QUALITY_LONG_EDGE[q]) state.quality = q; return state.quality; }
    function setBurnIn(name, on) { if (name in state.burnIns) state.burnIns[name] = !!on; return state.burnIns[name]; }
    function setBurnText(name, text) { if (name in state.burnText) state.burnText[name] = String(text || ''); return state.burnText[name]; }
    function setAudio(analyser) { state.audio = analyser || null; }

    async function loadFile(file) {
      if (!file || !video) return { ok: false, error: 'no_file' };
      const url = URL.createObjectURL(file);
      video.src = url;
      try {
        await new Promise((resolve, reject) => {
          const done = () => resolve();
          video.addEventListener('loadedmetadata', done, { once: true });
          video.addEventListener('error', () => reject(new Error('decode_failed')), { once: true });
        });
      } catch (e) {
        state.ready = false;
        return { ok: false, error: 'decode_failed' };
      }
      state.meta = {
        name: file.name,
        size: file.size,
        type: file.type || '',
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      };
      state.ready = true;
      refreshAutoExposure();
      try { video.currentTime = 0; } catch (e) { /* fine */ }
      try { await video.play(); state.playing = true; } catch (e) { state.playing = false; }
      return { ok: true, meta: state.meta };
    }

    function tick() {
      if (!state.ready || !video) return;
      if (video.paused) state.playing = false;
      refreshStabilizer();
      if (state.fixes.expose && Math.random() < 0.06) refreshAutoExposure();
      state.lastRender = renderFrame(state.previewCtx, { longEdge: 720 });
    }

    function attachPreview(ctx) { state.previewCtx = ctx; return true; }
    function play() { if (video) { video.play().then(() => { state.playing = true; }).catch(() => {}); } }
    function pause() { if (video) { video.pause(); state.playing = false; } }
    function toggle() { if (video) { if (video.paused) play(); else pause(); } }
    function seekTo(sec) { if (video) video.currentTime = clamp(Number(sec) || 0, 0, video.duration || 0); }
    function seekBy(delta) { if (video) seekTo((video.currentTime || 0) + Number(delta || 0)); }

    function getState() {
      return {
        ready: state.ready,
        lookId: state.lookId,
        params: state.params,
        fixList: state.fixes,
        overlayMode: state.overlayMode,
        overlayIntensity: state.overlayIntensity,
        format: state.format,
        quality: state.quality,
        burnIns: state.burnIns,
        burnText: state.burnText,
        meta: state.meta,
        autoBias: state.autoBias,
        lastStats: state.lastStats,
        stabilizer: { x: pathX, y: pathY },
        playing: state.playing,
      };
    }

    function destroy() {
      state.ready = false;
      if (video) {
        try { video.pause(); } catch (e) { /* fine */ }
        video.removeAttribute('src');
      }
      gridPrev = null;
      denoisePrev = null;
    }

    return {
      loadFile, tick, attachPreview, renderFrame,
      setLook, setParam, setFix, setOverlayMode, setOverlayIntensity,
      setFormat, setQuality, setBurnIn, setBurnText, setAudio,
      play, pause, toggle, seekTo, seekBy, getState, destroy,
      getVideo: () => video,
      getPreviewCtx: () => state.previewCtx,
    };
  }

  window.SWR_CAMERA_ENHANCE = {
    create,
    LOOKS,
    PARAM_KEYS,
    FORMAT_ASPECT,
    QUALITY_LONG_EDGE,
    FIX_NAMES,
    OVERLAY_MODES,
    buildFilter,
    effectiveParams,
    autoExposureBias,
    grainAlpha,
    vignetteAlpha,
    estimateShift,
    smoothPath,
    formatRect,
    outputLongEdge,
    overlayAlpha,
    drawOverlay,
    drawBurnIns,
    drawMark,
    clamp01,
  };
})();
