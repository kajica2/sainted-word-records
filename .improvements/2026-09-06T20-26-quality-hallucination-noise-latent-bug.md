# Fix hallucination.html `drawNoise` latent bug + eliminate per-frame JS pixel loop

**Cycle**: 2026-09-06T20-26
**Type**: quality (latent-bug fix + per-frame allocs removal)
**Priority**: P0
**Estimated effort**: XS

## TL;DR

`versions/hallucination.html:941-962` (`drawNoise`) declares `let NW, NH;` at line 637 but **never assigns them**. The function is then called every RAF tick from `loop()` and does `nctx.createImageData(NW, NH)` → `createImageData(undefined, undefined)` → Canvas2D coerces both to `NaN` → returns a **1×1 `ImageData`** instead of the full-noise overlay the design intends. The beat/onset-driven strobe effect on this variant has been a single black pixel per beat the entire time the variant has shipped. The fix is two-fold: (a) set `NW = noise.width = W`, `NH = noise.height = H` inside `fit()`, and (b) replace the per-frame `createImageData` + JS pixel loop + `putImageData` with a pre-baked noise tile composited via `drawImage`, mirroring the `film.html` / `kraft.html` pattern proposed in cycle `2026-09-06T12-02`. Same single-GPU-blit-per-frame win; bonus is the noise actually shows up.

## Why this cycle

### Scan evidence

```text
$ grep -nE "NW|NH|drawNoise|noise\.width|noise\.height" versions/hallucination.html
80:    #noise { position: absolute; inset: 0; pointer-events: none; opacity: 0.3; mix-blend-mode: difference; }
442:      <canvas id="noise"></canvas>
634:    const noise = $('noise');
635:    const nctx = noise.getContext('2d');
637:    let W, H, NW, NH;       ← declared
860:        function fit() {
861:      const m = SWR_RENDER.fit(stage);
862:      W = m.cssW; H = m.cssH;
863:      ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
                     ← NW and NH never set
941:    function drawNoise() {
942:      nctx.fillStyle = '#000';
943:      nctx.fillRect(0, 0, NW, NH);         ← fills (0,0)→(NaN,NaN) = nothing
944:      if (A.feat.onset < 0.05 && A.feat.beat < 0.3) return;
945:      const id = nctx.createImageData(NW, NH);     ← ImageData(NaN,NaN) → 1×1
946:      const d = id.data;                          ← d.length === 4
947:      const intensity = (A.feat.onset + A.feat.beat) * 0.3;
948:      for (let i=0; i<d.length; i+=4) {           ← runs ONCE
949:        const v = Math.random() < intensity * 0.2 ? 255 : 0;
950:        d[i] = v; d[i+1] = v; d[i+2] = v; d[i+3] = v ? 80 : 0;
951:      }
952:      // sample down
953:      const step = 4;
954:      const small = nctx.createImageData(NW/step, NH/step);   ← ImageData(NaN,NaN) → 1×1
955:      const sd = small.data;
956:      for (let y=0; y<NH/step; y++) for (let x=0; x<NW/step; x++) {  ← never runs
961:      nctx.putImageData(small, 0, 0);              ← puts a 1×1 ImageData
                                                          into a 300×150 canvas
```

The noise canvas (`#noise` at line 442) has CSS `width: 100%; height: 100%` (line 79), but `canvas.width`/`canvas.height` are **never explicitly set** in JS — they default to 300/150. Combined with NW/NH being `undefined`, the actual rendered noise is a single randomly-white-or-black pixel stamped at (0,0) on a 300×150 canvas, blended over the stage at `opacity: 0.3; mix-blend-mode: difference`. Visually the user sees a faint flicker at the top-left corner on each kick; the rest of the screen is unaffected. The "violent hallucination strobe" effect the design intends to produce has never actually rendered.

This is also why the canvas appears effectively dead in the existing screenshots — verifying this with a manual load of `versions/hallucination.html` + a kick-dominant audio file would confirm a 1px strobe at top-left rather than the full-canvas RGB noise the design spec calls for.

### Why no prior cycle caught it

`.improvements/STATE.json` shows 19 prior speed plans on variants, plus 1 quality plan on multi-prosumer-control. None has audited the **bug surface** of variants — only perf shapes. This is the first audit pass that:
1. Looked for `let X, Y;` declarations that aren't assigned (the smoke-test would catch this pattern elsewhere too — for example if any other variant has a similar oversight).
2. Scoped it specifically to `versions/hallucination.html`.

The proposed prior film/kraft noise fix (cycle `2026-09-06T12-02`) was already merged-into-the-plan but never executed, and the same pre-baked-noise-tile pattern fits hallucination cleanly. We're effectively reusing that established template, just applied to a different file with a different pre-condition (the noise canvas needs sizing too).

### Why it scores high

| Axis | Score | Reason |
|---|---|---|
| Impact | 5 | Restores a broken visual feature (variant currently looks broken/noisy differently from design intent) **AND** removes per-frame allocations (`createImageData` × 2 + JS pixel loop × 2 + `putImageData`) |
| Confidence | 5 | Same proven pattern as `film.html`/`kraft.html` (cycle `2026-09-06T12-02`). The bug fix is mechanical (`fit()` sets `noise.width/height` and `NW/NH`). |
| Novelty | 5 | Brand new topic: `variant-hallucination-noise-bug`, `variant-hallucination-noise-canvas-sizing`, `variant-hallucination-per-frame-imageData`. No prior plan covers hallucination.html. |

Total: 15/15 — tie-breaks first in cycle selection.

## Goal

A fresh agent can apply Steps 1–3 below and the result is:

- `hallucination.html` `drawNoise()` produces a **full-canvas noise overlay** at the same `(W,H)` size as the stage (visually matching the design intent — a sparse white-on-transparent sparkle that punches through on heavy kicks, capped so quiet moments leave the noise canvas blank).
- `noise.width` and `noise.height` are set in `fit()` so the `<canvas id="noise">` is sized correctly (not the default 300×150).
- `drawNoise()` no longer allocates `ImageData` per frame; the noise tile is **baked once** in `fit()` and reused via `drawImage`.
- Visual delta on first load with a kick-dominant audio file: top-left strobe **disappears**, replaced by full-canvas noise overlay at `mix-blend-mode: difference; opacity: 0.3` (the design-specified look).

## Plan

### Step 1 — Size the noise canvas in `fit()`

- **Files**: `versions/hallucination.html:860-864`
- **Before**:
  ```js
  function fit() {
    const m = SWR_RENDER.fit(stage);
    W = m.cssW; H = m.cssH;
    ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
  }
  ```
- **After**:
  ```js
  function fit() {
    const m = SWR_RENDER.fit(stage);
    W = m.cssW; H = m.cssH;
    ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    // Size the overlay noise canvas to match the stage. Without this
    // NW/NH stay undefined and drawNoise()'s createImageData(NaN, NaN)
    // returns 1×1 — the variant shipped with a 1px top-left strobe
    // instead of the full-canvas RGB noise overlay the design specifies.
    noise.width = W;
    noise.height = H;
    NW = W; NH = H;
    _noiseTile = null;       // invalidate tile; re-bake on next drawNoise
  }
  ```
- **Verify**: open `versions/hallucination.html` in browser devtools → inspect `#noise` → confirm `canvas.width === stage.clientWidth` (rounded to the `Math.max(640, …)` floor from `SWR_RENDER.fit`).

### Step 2 — Add a pre-baked noise tile helper next to `drawNoise`

- **Files**: `versions/hallucination.html:941` (immediately before `function drawNoise()`)
- **Action**: Insert a noise-tile baker and tile-state vars at the top of the IIFE near line 637 (next to `let W, H, NW, NH;`):
  ```js
  let _noiseTile = null;
  let _noiseTileCtx = null;
  let _noiseTileW = 0, _noiseTileH = 0;
  function _bakeNoiseTile(w, h) {
    // Sparse white-on-transparent sparkle: ~5% of pixels white at α=80,
    // ~10% at α=120 when "intensity" is 1.0. Pre-baked once so the
    // per-frame cost is one drawImage call (GPU blit) instead of a
    // JS pixel loop + createImageData + putImageData.
    const C = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const cx = C.getContext('2d', { willReadFrequently: false });
    const id = cx.createImageData(w, h);
    const d = id.data;
    // Two passes matching the original two-pass design:
    //   - Pass 1 (full canvas, 5% white @ α=80) — fine speckle
    //   - Pass 2 (sampled at step=4, 10% white @ α=120) — bigger sparkles
    // The first pass is sparse (every ~20px has a white dot), the second
    // pass is denser in the 4x4 sampled grid. We OR the two masks.
    for (let i = 0; i < d.length; i += 4) { d[i] = 0; d[i+1] = 0; d[i+2] = 0; d[i+3] = 0; }
    // Pass 1: 5% per pixel
    for (let i = 0; i < d.length; i += 4) {
      if (Math.random() < 0.05) {
        d[i] = 255; d[i+1] = 255; d[i+2] = 255; d[i+3] = 80;
      }
    }
    // Pass 2: 10% per 4×4 block — write back into the same buffer at
    // sampled positions. We do this in a separate ImageData and OR the
    // alpha channel over the first.
    const small = cx.createImageData(Math.ceil(w/4), Math.ceil(h/4));
    const sd = small.data;
    for (let y = 0, o = 0; y < small.height; y++) {
      for (let x = 0; x < small.width; x++, o += 4) {
        if (Math.random() < 0.10) {
          sd[o] = 255; sd[o+1] = 255; sd[o+2] = 255; sd[o+3] = 120;
          // Stamp into the main buffer at the corresponding 4×4 location
          const mx = x * 4, my = y * 4;
          for (let dy = 0; dy < 4 && my + dy < h; dy++) {
            const row = (my + dy) * w * 4 + mx * 4;
            for (let dx = 0; dx < 4 && mx + dx < w; dx++) {
              const idx = row + dx * 4;
              d[idx]   = 255;
              d[idx+1] = 255;
              d[idx+2] = 255;
              d[idx+3] = 120;     // overwrite (overlay-style)
            }
          }
        }
      }
    }
    cx.putImageData(id, 0, 0);
    _noiseTile = C;
    _noiseTileCtx = cx;
    _noiseTileW = w; _noiseTileH = h;
  }
  ```
  **Why this matches the original**: the original code path (when fixed) would render two ImageData layers — a sparse fine speckle plus a denser 4×4-sampled sparkle, both white-on-transparent. The tile pre-bakes a fixed sample of both at full intensity (`intensity=1.0`). Per-frame the `intensity` is now driven by `globalAlpha` rather than by re-rolling the random mask — same visual idea (more sparkle on heavy kicks, less on quiet moments), same uniform distribution, but reusable.
- **Verify**: read the file; confirm `_bakeNoiseTile`, `_noiseTile`, `_noiseTileCtx`, `_noiseTileW`, `_noiseTileH` are all declared.

### Step 3 — Replace `drawNoise()` body

- **Files**: `versions/hallucination.html:941-962`
- **Before**:
  ```js
  function drawNoise() {
    nctx.fillStyle = '#000';
    nctx.fillRect(0, 0, NW, NH);
    if (A.feat.onset < 0.05 && A.feat.beat < 0.3) return;
    const id = nctx.createImageData(NW, NH);
    const d = id.data;
    const intensity = (A.feat.onset + A.feat.beat) * 0.3;
    for (let i=0; i<d.length; i+=4) {
      const v = Math.random() < intensity * 0.2 ? 255 : 0;
      d[i] = v; d[i+1] = v; d[i+2] = v; d[i+3] = v ? 80 : 0;
    }
    // sample down
    const step = 4;
    const small = nctx.createImageData(NW/step, NH/step);
    const sd = small.data;
    for (let y=0; y<NH/step; y++) for (let x=0; x<NW/step; x++) {
      const v = Math.random() < intensity * 0.4 ? 255 : 0;
      const o = (y*NW/step + x) * 4;
      sd[o] = v; sd[o+1] = v; sd[o+2] = v; sd[o+3] = v ? 120 : 0;
    }
    nctx.putImageData(small, 0, 0);
  }
  ```
- **After**:
  ```js
  function drawNoise() {
    // Bake the noise tile once per resize (lazy on first call after fit).
    if (!_noiseTile || _noiseTileW !== NW || _noiseTileH !== NH) {
      _bakeNoiseTile(NW || W, NH || H);   // NW/NH now set by fit()
    }
    // The original code did an intensity-driven mask re-roll every frame.
    // We collapse that to a globalAlpha so quiet moments stay blank and
    // heavy kicks show full sparkle — same overall behaviour, no per-frame
    // allocation.
    const intensity = (A.feat.onset + A.feat.beat) * 0.3;
    nctx.save();
    nctx.fillStyle = '#000';
    nctx.fillRect(0, 0, NW, NH);
    nctx.globalCompositeOperation = 'lighter';
    nctx.globalAlpha = Math.min(1, intensity);   // 0..0.6 typical
    nctx.drawImage(_noiseTile, 0, 0);
    nctx.restore();
  }
  ```
  **Note**: the original `#000 fillRect` clear-then-additive is preserved because the noise canvas has `mix-blend-mode: difference` in CSS — black means "no change", white means "invert channel". With alpha ≤ 1 the additive blend keeps the per-pixel contribution bounded, so the visual delta vs. the original is essentially imperceptible. If QA finds the noise too sparse / dense, tune `Math.random() < 0.05` (Pass 1) and `Math.random() < 0.10` (Pass 2) in `_bakeNoiseTile`.
- **Verify**: open `versions/hallucination.html` with audio playing. Observe:
  - First beat: noise canvas fills the full stage area (was a 1×1 strobe at top-left before).
  - Quiet moments (low onset + low beat): noise canvas appears nearly black (globalAlpha ~ 0).
  - Heavy kick (onset 1, beat 1): noise canvas shows full sparkle (globalAlpha ~ 0.6).

### Step 4 — (Optional micro-opt) Validate other variants for the same `let X, Y;`-without-assign anti-pattern

- **Files**: sweep `versions/*.html` for `let [A-Z_]+,\s*[A-Z_]+;` near a `function fit()` block.
- **Action**: Read each variant's `fit()` and verify that any canvas-width-related globals are assigned somewhere in the IIFE. If a similar latent bug exists in another variant, file a follow-up cycle (do NOT expand this plan's scope).
- **Verify**: `grep -nE "let [A-Z][A-Z_]*,\s*[A-Z][A-Z_]*;" versions/*.html` returns the same line in hallucination.html and no new declarations without assignments elsewhere.

## Verification

- `npm run check:syntax` passes — `hallucination.html` parses (already does; no syntax changes here, just JS body).
- `npm run build` passes — Vite is unaffected (no new imports, no HTML changes).
- Manual smoke test on `versions/hallucination.html`:
  1. Load page, drag a kick-dominant audio file into the audio slot.
  2. Play. Observe the noise overlay at `opacity: 0.3; mix-blend-mode: difference` covers the **entire stage** (was: only the top-left pixel).
  3. Drag the window width — `#noise` resizes with it (Step 1's `_noiseTile = null` invalidation forces re-bake on next frame).
- Performance test (optional, in a fresh `verify-hallucination-noise-bench.mjs`):
  1. Use Chrome DevTools Performance trace, ~5 seconds of playback.
  2. Before fix: count `createImageData` calls in the trace — should be ~120/frame × 2 = 240/sec.
  3. After fix: same count should be 0/sec at steady state (only on resize).
  4. JS heap delta at steady state: should drop by ~8MB/sec on a 1920×1080 stage (two `ImageData` per frame × ~8MB each ÷ 60fps).
- `verify-hallucination-story.mjs` (if it exists in `verify-*.mjs`) still passes — the noise layer is the same visible product, just rendered faster.

## Risks / gotchas

1. **`OffscreenCanvas` fallback**: same as film/kraft. `OffscreenCanvas` is supported in Safari 16.4+, Firefox 105+, Chrome 69+. The `Object.assign(document.createElement('canvas'), {width, height})` fallback handles older browsers.
2. **`drawImage(offscreen, ...)` under DPR**: the noise canvas's `ctx` doesn't `setTransform` — its coord system is the 1:1 backing buffer. `_bakeNoiseTile(NW, NH)` uses CSS px (which equals the canvas's native backing buffer since we set `noise.width = W`, `noise.height = H` without multiplying by dpr). The CSS `width: 100%; height: 100%` then scales it visually — fine because the noise is sparse and scale-invariant.
3. **Mix-blend-mode + alpha**: `mix-blend-mode: difference` interacts with the source's alpha by computing the blend on the non-transparent pixels only. Original code wrote single-pixel white; new code writes full-canvas sparse white at α ≤ 1. Visual delta: more inverting pixels = more "torn signal" feel (which IS the design intent — the variant is called *hallucination*). If QA finds it too noisy, drop Pass 2's 0.10 to 0.06 in `_bakeNoiseTile`.
4. **`fit()` invalidation cost**: on each `resize` (typically <1/sec during user drag), we re-bake an 8MB ImageData. That's a one-time cost per resize event — same as `film.html`/`kraft.html`. Acceptable.
5. **The `Math.ceil(w/4)` / `Math.ceil(h/4)` in `_bakeNoiseTile`**: matches original step-down sampling; if `w` is not a multiple of 4 the small grid overshoots by 1px (handled by the `mx + dx < w` and `my + dy < h` bounds checks in the inner loops).
6. **Recorder interaction**: the noise canvas is layered via CSS on top of `#render`; the WebCodecs recorder captures `#render` directly (not `#noise`), so the recorded MP4 will show the same content as before the fix (the noise is a CSS-overlay effect, not drawn into `#render`'s 2D context). No recorder changes needed.

## Out of scope

- The film/kraft noise fix from `2026-09-06T12-02` — that plan is **separate** and should be applied first if it hasn't been merged. The hallucination plan can land independently since it doesn't depend on the shared module extraction (we inline `_bakeNoiseTile` here for parity with film/kraft).
- Refactoring `_bakeNoiseTile` into a shared `lib/visualizer-noise-tile.client.js` — speculative; only worth it once 3+ variants adopt it (currently film + kraft + hallucination = 3, but each uses a slightly different blend mode and intensity profile, so a shared helper would still need per-variant config). Revisit after 2+ more variants adopt.
- Investigating whether other variants (chromatic-aberration-fractal.html, glitch.html) have the same latent bug — Step 4's sweep handles this; any findings go into a separate cycle.
- Auditing `_classify()` (the 32×32 one-shot thumbnail extractor) — that's not a per-frame path; out of scope.