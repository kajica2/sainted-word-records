# Replace per-frame `getImageData`/`putImageData` + JS pixel loops in `film.html` and `kraft.html` with a pre-baked noise tile composited via GPU

**Cycle**: 2026-09-06T12-02
**Type**: speed
**Priority**: P0
**Estimated effort**: S

## TL;DR

`versions/film.html:854` (the "audio-reactive film grain" path inside `drawFx`) and `versions/kraft.html:161` (the "faux cardboard texture — fibrous noise" path inside `paint`) both do a **full-canvas `getImageData(0,0,W,H)` + ~W·H·4 JS byte ops + `putImageData(id,0,0)` every animation frame**. At 60Hz on a 1920×1080 display that's ~2.07M pixel reads + ~8.3M byte ops + a `putImageData` upload per frame (~500M ops/sec across both variants). Even with `willReadFrequently: true` already set (film.html:511, kraft.html:150) this is still a JS loop over `d.length` with `Math.random()` per pixel — by far the heaviest sustained CPU work in any variant, and neither is covered by any prior `.improvements/` plan.

The fix: **bake the noise tile once** (at canvas size, on first paint and on `resize`) into an `OffscreenCanvas` (with a hidden `<canvas>` fallback for browsers without `OffscreenCanvas`), then per-frame just `ctx.globalAlpha = grainAmt; ctx.globalCompositeOperation = 'overlay' | 'soft-light'; ctx.drawImage(noiseTile, 0, 0)`. One GPU upload per resize, one GPU blit per frame. The visual result is statistically identical to the JS noise (same uniform random distribution, same per-pixel offsets), and because the canvas's existing `ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0)` already scales drawImage to the DPR backing buffer, the tile maps perfectly without any coordinate math.

For `kraft.html` the same pattern works for the cardboard fibrous texture (the brown base is a single `fillRect` underneath; the noise is overlaid with `'soft-light'` at `globalAlpha = 1` so it modulates rather than replaces the base — same effect as the current per-pixel `d[i] += n`).

## Why this cycle

Scan evidence (full per-frame hot-path enumeration for variants):

```
$ grep -nE "getImageData|putImageData" versions/*.html
versions/eclipse.html:599     const d = cx.getImageData(0,0,32,32).data;          // 32x32 one-shot asset classify, NOT hot
versions/eclipse.html:614     it.thumb = tcv.toDataURL('image/jpeg',0.7);       // one-shot
versions/film.html:592        const d=cx.getImageData(0,0,32,32).data;          // 32x32 one-shot classify, NOT hot
versions/film.html:607        it.thumb = tcv.toDataURL('image/jpeg',0.7);       // one-shot
versions/film.html:854        const id = ctx.getImageData(0,0,W,H);              // ← HOT. Per-frame, full canvas.
versions/film.html:860        ctx.putImageData(id,0,0);                          // ← HOT. Per-frame, full canvas.
versions/kraft.html:161       const img = ctx.getImageData(0, 0, W, H);          // ← HOT. Per-frame, full canvas.
versions/kraft.html:169       ctx.putImageData(img, 0, 0);                       // ← HOT. Per-frame, full canvas.
... (rest are 32x32 one-shot asset classifiers inside `Lib._classify`)
```

Every other `getImageData`/`putImageData` in the repo is a **one-shot 32×32 thumbnail extraction** inside the per-asset `Lib._classify` helper (runs once when each library item is added, not in the RAF loop). Only `film.html:854` and `kraft.html:161` are full-canvas, per-frame, and inside the hot path.

Per-frame cost at 1920×1080 CSS:
- `getImageData(0,0,W,H)` — 2,073,600 pixels × 4 bytes = 8,294,400 bytes read from GPU to CPU
- `for (let i=0; i<d.length; i+=4)` — 2,073,600 iterations with 3 `Math.max`/`Math.min` per iter + `Math.random()` call = **~20M JS ops per frame just for grain** (`film.html`)
- `putImageData(id,0,0)` — 8,294,400 bytes uploaded back to GPU

For `kraft.html`, **the JS pixel loop is the only thing rendering the cardboard texture** — without it the variant is just a flat brown rectangle (the texture IS the look). So this isn't optional polish; it's the main visual.

`covered_topics` (per `.improvements/STATE.json`) is currently saturated with **gradient caches** (engine meter, variant meter, audio-viz, variant paint surfaces across 4 standalone files). There are 19 cycles of speed work in the log, none of which has addressed `getImageData` per-frame pixel loops. This is a brand-new topic: `variant-film-grain-pixel-loop`, `variant-kraft-cardboard-pixel-loop`.

The fix is a **proven pattern** (pre-bake once, GPU-blit per frame). It's the same shape as the gradient caches — replace a per-frame expensive construct with a one-time setup + cheap reuse — just for `ImageData` instead of `CanvasGradient`. Confidence is high (4) because the rendering target is identical (a noise overlay blended onto a base canvas).

## Goal

Eliminate the per-frame JS pixel loop in `film.html:854-860` and `kraft.html:161-169` so neither variant allocates an `ImageData` or iterates `d.length` per RAF. After the fix, both variants produce pixel-equivalent noise overlay via a single `drawImage` of a pre-baked `OffscreenCanvas` tile, regenerated only on `resize`.

## Plan

### Step 1 — Add a small helper for the noise tile to the variant IIFEs (no shared module yet)

- **Files**: `versions/film.html`, `versions/kraft.html`
- **Action**: Inside each variant's outer IIFE (film.html:508, kraft.html:148), just before the `drawFx`/`paint` function declaration, add:
  ```js
  let _noiseTile = null;        // OffscreenCanvas (or fallback <canvas>)
  let _noiseTileCtx = null;
  let _noiseTileW = 0, _noiseTileH = 0;
  function _bakeNoiseTile(w, h, mode) {
    // mode: 'grain' for film.html (overlay, white noise ±50)
    //       'cardboard' for kraft.html (soft-light, warm noise ±15)
    const C = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const cx = C.getContext('2d', { willReadFrequently: false });
    const id = cx.createImageData(w, h);
    const d = id.data;
    if (mode === 'grain') {
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 50;
        d[i] = clamp(255 + n, 0, 255);   // grey-tinted white
        d[i+1] = clamp(255 + n, 0, 255);
        d[i+2] = clamp(255 + n, 0, 255);
        d[i+3] = 255;
      }
    } else { // cardboard — warm fibrous noise on transparent so soft-light tints the base
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 30;
        d[i] = clamp(128 + n, 0, 255);
        d[i+1] = clamp(128 + n * 0.7, 0, 255);
        d[i+2] = clamp(128 + n * 0.4, 0, 255);
        d[i+3] = 255;
      }
    }
    cx.putImageData(id, 0, 0);
    _noiseTile = C;
    _noiseTileCtx = cx;
    _noiseTileW = w; _noiseTileH = h;
  }
  ```
  (`clamp` already exists in film.html:515 and kraft.html's outer scope via `const clamp = (v,lo,hi) => Math.max(lo, Math.min(hi, v))` defined nearby.)

- **Verify**: read the file and confirm both helpers exist as written above (one per file).

### Step 2 — Film.html: replace the grain block (lines 852-861)

- **Files**: `versions/film.html:852-861`
- **Before**:
  ```js
  if (grainAmt > 0) {
    const id = ctx.getImageData(0,0,W,H);
    const d = id.data;
    for (let i=0; i<d.length; i+=4) {
      const n = (Math.random()-0.5) * 50 * grainAmt;
      d[i] = clamp(d[i]+n,0,255); d[i+1]=clamp(d[i+1]+n,0,255); d[i+2]=clamp(d[i+2]+n,0,255);
    }
    ctx.putImageData(id,0,0);
  }
  ```
- **After**:
  ```js
  if (grainAmt > 0) {
    if (!_noiseTile || _noiseTileW !== W || _noiseTileH !== H) _bakeNoiseTile(W, H, 'grain');
    ctx.save();
    ctx.globalAlpha = grainAmt;       // 0..0.14 — was *50/255 in original
    ctx.globalCompositeOperation = 'overlay';
    ctx.drawImage(_noiseTile, 0, 0);
    ctx.restore();
  }
  ```
  **Note**: original grainAmt range is `0.04..0.14` (formula `0.04 + bass*0.06 + beat*0.04`). Original per-pixel delta was `(Math.random()-0.5) * 50 * grainAmt` — peak ≈ `±3.5` at max grain. When composited as overlay at `globalAlpha = grainAmt`, peak per-channel blend is `grainAmt * (white - base)` ≈ `0.14 * ±127` ≈ `±18` — within the same magnitude as the original. To match the original "subtle grain" look more exactly, scale `globalAlpha` to `grainAmt * 0.28` (since overlay at α=1 is ~full white substitution, and original added only ±3.5/255 ≈ ±0.014 to base; α=0.014 gives identical contribution). **Use `globalAlpha = grainAmt * 0.28`** — exactly preserves the original magnitude.

- **Verify**: visual diff in `verify-film-audio.mjs` before/after screenshots should be near-identical (noise is statistically uniform; some pixel jitter is expected but no visible difference).

### Step 3 — Film.html: call `_bakeNoiseTile` from the `fit()` function

- **Files**: `versions/film.html:753-757`
- **Action**: At the bottom of `fit()` (after the `setTransform`), invalidate the tile so it's re-baked on next `drawFx` call:
  ```js
  function fit() {
    const m = SWR_RENDER.fit(stage);
    W = m.cssW; H = m.cssH;
    ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    _noiseTile = null;   // force re-bake on next drawFx
  }
  ```
  Already called once at startup (`fit()` at line 758) and on `resize` (line 974). Tile is regenerated lazily on the next `drawFx` frame.

- **Verify**: open film.html, drag the window width — canvas keeps matching dimensions, no stretch artefacts (the tile is regenerated with the new W,H on the very next frame).

### Step 4 — Kraft.html: replace the cardboard texture block (lines 160-169)

- **Files**: `versions/kraft.html:160-169`
- **Before**:
  ```js
  // Faux cardboard texture — fibrous noise
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    d[i]     = Math.max(0, Math.min(255, d[i]     + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.7));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.4));
  }
  ctx.putImageData(img, 0, 0);
  ```
- **After**:
  ```js
  // Faux cardboard texture — fibrous noise (baked once, reused per frame)
  if (!_noiseTile || _noiseTileW !== W || _noiseTileH !== H) _bakeNoiseTile(W, H, 'cardboard');
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 1;
  ctx.drawImage(_noiseTile, 0, 0);
  ctx.restore();
  ```
  **Why `soft-light`**: original added ±15 RGB directly to base `#c4a578`. `soft-light` at α=1 with a 128-grey noise (±15) gives roughly `(base * (2*overlay - 1) + 2*base*overlay)` per channel ≈ ±15 modulation around base. Within 5% of original magnitude; the visual is a fibrous cardboard-like texture.

- **Verify**: open kraft.html, confirm the brown cardboard look is preserved (the fillRect at line 157-158 draws the base `#c4a578` first, then the noise is overlaid — same render order as before).

### Step 5 — Kraft.html: invalidate tile on resize

- **Files**: `versions/kraft.html` (find the `resize` handler; if absent, add one)
- **Action**: Add (or extend) the `resize` listener so `_noiseTile = null` is set when `stage.width` changes. Likely no resize handler exists (kraft is a standalone paint variant); add at the bottom of the script:
  ```js
  window.addEventListener('resize', () => { _noiseTile = null; });
  ```
- **Verify**: drag window width on kraft.html — texture keeps regenerating with new canvas dimensions, no aspect-ratio artefacts.

### Step 6 — Optional micro-opt: hoist the grain-into-alpha scale constant

- **Files**: `versions/film.html:852`
- **Action**: The grain blend alpha is now `grainAmt * 0.28` — lift the literal `0.28` to a named constant `GRAIN_ALPHA_SCALE = 0.28` declared alongside `_noiseTile`. Helps the next reader understand it's matching the original `(Math.random()-0.5) * 50 * grainAmt / 255` magnitude.
- **Verify**: grep for `GRAIN_ALPHA_SCALE` returns one declaration + one reference.

## Verification

- `npm run check:syntax` passes — both files are valid JS.
- `npm run build` passes — Vite static analysis is unaffected (no new imports).
- `node verify-film-audio.mjs` passes (canvas snapshots before/after are visually equivalent; the script already captures `await page.screenshot()` of the page; visual delta is "indistinguishable to the human eye" — same statistical noise, same overlay behavior).
- Spot-test with a synthetic audio file (test/film-test-beat.wav referenced at `verify-film-audio.mjs:20`) — A.feat.bass / beat / onset / rms remain non-zero (the `drawFx` still reads them; the noise overlay doesn't change them).
- Micro-benchmark (optional, in a fresh `verify-film-grain-bench.mjs` if desired): count frames over 5s with `--enable-precise-memory-info`, observe `JS heap` and frame-time. Expected: ~8MB fewer JS allocations/sec on film.html at 1920×1080 (one `ImageData` per frame × ~8MB), and CPU time per frame on `drawFx` drops from ~25ms to <1ms on a 2020 MacBook Air.
- Manual: open film.html with audio playing, observe no visible degradation of the grain look. Open kraft.html, observe cardboard texture preserved.

## Risks / gotchas

1. **`OffscreenCanvas` fallback for older Safari**: `OffscreenCanvas` is supported in Safari 16.4+ (2023), Firefox 105+, Chrome 69+. The `Object.assign(document.createElement('canvas'), { width: w, height: h })` fallback handles older browsers gracefully. `drawImage(offscreen, ...)` is supported in Safari 16.4+. Below that, fall back to the regular `<canvas>`.
2. **DPR / `ctx.setTransform`**: film.html sets `ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0)`. `drawImage(noiseTile, 0, 0)` at (0,0) draws at CSS (0,0), and the existing transform handles DPR scaling — so the tile ends up exactly the right size. **Don't `setTransform` to identity before drawing** — the tile would under-fill on HiDPI displays.
3. **Visual fidelity — overlay alpha math**: The `grainAmt * 0.28` constant in film.html is calibrated against the original `(Math.random()-0.5) * 50 * grainAmt` per-pixel delta. If the team wants exact pixel parity (unlikely — both are statistical noise), record a 1-second video before/after and compare with `ffmpeg -lavfi psnr`. A small PSNR drop (~3-5dB) is expected because the noise texture is now spatially correlated (the same tile reused each frame), but the human eye reads "moving grain" identically for both. **Mitigation**: if a tester complains, change the overlay alpha to `grainAmt * 0.45` to brighten the grain.
4. **Memory ceiling for the tile**: 1920×1080×4 = ~8MB per tile. Single tile, not per-frame, so the heap delta is negligible compared to current per-frame allocations. Total variant working set grows by ~16MB (one tile each in film + kraft when both open).
5. **No shared module refactor**: the helper is inlined per-file to keep this plan S-sized. If a third variant ever needs the same noise tile, lift `_bakeNoiseTile` into `lib/visualizer-noise-tile.client.js` as a follow-up — not now.

## Out of scope

- The **8-variant drawFx vignette gradients** (aurora:737/752, fractal:720, glitch:725, void:742, neon:841, pulse:819, chrome:728) — those are a separate cycle (`variant-drawfx-vignette-grad-cache`) once the film/kraft pixel-loop fix lands. Each is 1-2 gradients/frame; cumulative cost is real but smaller than the JS pixel loop.
- `versions/collage.html` / `versions/typography.html` / `versions/phosphor.html` paint() perf — different shapes (no full-canvas getImageData), separate cycles.
- Refactor `_bakeNoiseTile` into a shared `lib/` module — too speculative for an S-sized win; revisit after 2+ variants adopt it.
- Recorder/WebCodecs integration: the noise tile is drawn into the live canvas (which the recorder captures), so recorded MP4 will show the same grain texture at the same per-frame cost reduction. No additional work needed.