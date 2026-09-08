# Cache `drawFx` vignette/curtain gradients across 8 variant pages — drop 11 `createLinearGradient`/`createRadialGradient` calls/frame

**Cycle**: 2026-09-07T20-33
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

Eight variant `drawFx()` functions allocate canvas gradients **every RAF** on top of layers they apply over. The full list (from `grep -nE "createLinearGradient|createRadialGradient" versions/*.html | grep -v "drawMeter"`):

- `versions/aurora.html:737` — `LinearGradient(0, 0, 0, H)` for the pastel curtain. **Audio-varying** alphas across 3 stops. Defer (complex; not pure cache).
- `versions/aurora.html:752` — `RadialGradient(W/2, H/2, min(W,H)*0.2, W/2, H/2, max(W,H)*0.8)` for the soft vignette. **Stops fully fixed** (`'rgba(0,0,0,0)'` → `'rgba(0,0,0,0.45)'`). **Trivially cacheable.**
- `versions/fractal.html:720` — Radial vignette. **Stops fully fixed** (`'rgba(0,0,0,0)'` → `'rgba(0,0,0,0.7)'`). **Trivially cacheable.**
- `versions/glitch.html:725` — Radial CRT vignette. **Stops fully fixed** (`'rgba(0,0,0,0)'` → `'rgba(0,0,0,0.6)'`). **Trivially cacheable.**
- `versions/void.html:742` — Radial vignette with audio-varying outer alpha (`vig = 0.55 + 0.30 * min(1, rms*4)`). **Cacheable via `globalAlpha` trick** (cache unit-alpha gradient; multiply alpha on `fillRect`).
- `versions/neon.html:841` — Radial beat-glow with audio-varying alphas in 3 stops. **Cacheable via `globalAlpha` trick** (cache `pulse=1.0` gradient; multiply via `ctx.globalAlpha = pulse`).
- `versions/pulse.html:819` — Radial beat-flash with audio-varying alpha. **Cacheable via `globalAlpha` trick.**
- `versions/chrome.html:699` — Radial specular hotspot with audio-varying alphas in 3 stops. **Cacheable via `globalAlpha` trick.**
- `versions/watercolor.html:706` — Linear pastel overlay (`0,0 → W,H`). **Stops fully fixed** (no audio dependency). **Trivially cacheable.**

**Deferred** (out of scope this cycle):

- `versions/chrome.html:728` — the mirror-sweep LinearGradient has continuously-moving `(x-sweepWidth)*W, 0 → (x+sweepWidth)*W, 0` endpoints **and** audio-varying alphas in 2 middle stops. A pure `globalAlpha` trick can't fix the moving endpoints; a translate+scale trick works but is fiddly. Defer to a follow-up.
- `versions/aurora.html:737` — pastel curtain has **3 audio-varying alphas** at distinct stops; can't be reduced to a single `globalAlpha` multiplier. Defer.
- `versions/watercolor.html:762` — drip `LinearGradient(d.x, d.y0, d.x, d.y0 + grown)` runs inside a `grow` loop with per-drip varying coordinates; runtime cost is small (≤3 drips). Defer.

At 60 Hz the 11 in-scope calls cost ~660 `CanvasGradient` allocations/sec. The proven mitigation is the same one used for `engine.html:drawPaletteOverlay` (cycle 2026-09-05T05-03) and `engine.html:drawMeter` (cycle 2026-09-05T20-20): build the gradient once outside the per-frame loop (or lazy-init on first call guarded by canvas identity), reuse it forever. For audio-varying alphas, cache a unit-alpha gradient and apply the per-frame multiplier via `ctx.globalAlpha` — pixel-identical output, zero per-frame allocation.

## Why this cycle

The previous variant gradient cycles carved out the remaining `drawFx` paths as a future cycle:

- `2026-09-06T03-54-speed-variant-drawmeter-grad-cache.md` (in flight) covers the per-bar gradient loop in `drawMeter` across the same 8 variants — but explicitly excludes `drawFx`.
- `2026-09-06T06-45-speed-variant-2d-paint-gradients.md` (in flight) covers gradients in `paint()` for 4 standalone 2D variants (`baroque`, `mosaic`, `spectrum`, `tape`). It explicitly disclaims the `drawFx` paths of the *other* variants ("Other variants … already covered above — none have per-frame `createRadialGradient`/`createLinearGradient` calls except `baroque.html` (covered)") — which is factually wrong for the `drawFx` paths (8 files × 1–2 gradients/frame). The disclaimer was a scan miss, not a deliberate punt.
- `2026-09-06T12-02-speed-film-kraft-pixel-noise-tile.md` (in flight, applied) explicitly teed up this exact cycle in its Risks section: *"The 8-variant drawFx vignette gradients (aurora:737/752, fractal:720, glitch:725, void:742, neon:841, pulse:819, chrome:728) — those are a separate cycle (`variant-drawfx-vignette-grad-cache`) once the film/kraft pixel-loop fix lands. Each is 1-2 gradients/frame; cumulative cost is real but smaller than the JS pixel loop."* The film/kraft pixel-loop fix is now applied (commits landed). It's time.

Scan evidence:

```
$ grep -nE "createLinearGradient|createRadialGradient" versions/*.html | grep -v "drawMeter"
versions/aurora.html:737:      const grad = ctx.createLinearGradient(0, 0, 0, H);
versions/aurora.html:752:      const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.2, W/2, H/2, Math.max(W,H)*0.8);
versions/fractal.html:720:      const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.15, W/2, H/2, Math.max(W,H)*0.75);
versions/glitch.html:725:      const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.25, W/2, H/2, Math.max(W,H)*0.7);
versions/void.html:742:        const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.15, W/2, H/2, Math.max(W,H)*0.75);
versions/neon.html:841:        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.6);
versions/pulse.html:819:        const fg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.4);
versions/chrome.html:699:        const sg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.4);
versions/watercolor.html:706:      const grad = ctx.createLinearGradient(0, 0, W, H);
```

Coordinates are all derived from `W`, `H`, or `cx=W*0.5, cy=H*0.5`, which only change on viewport resize. No JS code mutates `W`/`H` after `fit()` runs (verified by scanning for `W = ` and `H = ` assignments in each file's IIFE — only `fit()` and `<canvas>`-intrinsic-size sites set them). Stops are either fully fixed strings or have a single audio-derived alpha multiplier that can be lifted out to `ctx.globalAlpha`.

Working tree: `git status --short` shows only root-level PNG deletes (a separate cleanup unrelated to engine code), a stray `._static_server.mjs` (Mac metadata), and `.improvements/` plan files. The 8 variant HTML files are clean. The two in-flight variant-gradient plans (`2026-09-06T03-54`, `2026-09-06T06-45`) target `drawMeter`/`paint` and don't touch `drawFx` — no collision.

## Goal

Across the 8 in-scope variants, `drawFx()` runs **zero** `createLinearGradient`/`createRadialGradient` calls after the first invocation on a given `(W, H)` pair. Audio-driven alpha modulation continues to flow through the gradient via `ctx.globalAlpha`, so visual output is pixel-identical to today. The three deferred gradients (`chrome.html:728`, `aurora.html:737`, `watercolor.html:762`) are explicitly NOT modified this cycle.

## Plan

### Step 1 — Cache the 4 trivial (audio-free) vignettes

Apply the same pattern to all four sites: cache a single `CanvasGradient` on the IIFE closure scope, lazy-init on first call guarded by `(W, H)` key, then reuse every frame.

**Files**: `versions/fractal.html`, `versions/glitch.html`, `versions/watercolor.html`, `versions/aurora.html` (line 752 only).

**Action (representative — `versions/fractal.html:720`)**:

Inside the IIFE that owns `drawFx` (open by searching for the file's `const meter = $('meter').getContext('2d');` line, e.g. `versions/fractal.html:513`, then read upward until you find the function scope's `var`/`const` block — likely the top-level script tag's IIFE), add:

```js
// Cache: vignette gradient. W/H are stable per page lifetime (only
// `fit()` mutates them on resize); coordinates depend only on W and H,
// stops are fully fixed strings. Lazy-init on first call.
var _drawFxVignetteCache = null;
var _drawFxVignetteKey = '';
function _getDrawFxVignette(ctx, W, H) {
  const key = W + 'x' + H;
  if (key !== _drawFxVignetteKey) {
    const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.15, W/2, H/2, Math.max(W,H)*0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.7)');
    _drawFxVignetteCache = vg;
    _drawFxVignetteKey = key;
  }
  return _drawFxVignetteCache;
}
```

Then in `drawFx()` replace:
```js
const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.15, W/2, H/2, Math.max(W,H)*0.75);
vg.addColorStop(0, 'rgba(0,0,0,0)');
vg.addColorStop(1, 'rgba(0,0,0,0.7)');
ctx.save();
ctx.globalCompositeOperation = 'multiply';
ctx.fillStyle = vg;
ctx.fillRect(0, 0, W, H);
ctx.restore();
```

with:
```js
ctx.save();
ctx.globalCompositeOperation = 'multiply';
ctx.fillStyle = _getDrawFxVignette(ctx, W, H);
ctx.fillRect(0, 0, W, H);
ctx.restore();
```

Adjust the cache function body to match the exact stops and inner/outer radii of each file:

- `versions/fractal.html:720` — `min(W,H)*0.15` → `max(W,H)*0.75`, stops `'rgba(0,0,0,0)'` and `'rgba(0,0,0,0.7)'` (multiplied).
- `versions/glitch.html:725` — `min(W,H)*0.25` → `max(W,H)*0.7`, stops `'rgba(0,0,0,0)'` and `'rgba(0,0,0,0.6)'`.
- `versions/watercolor.html:706` — **LinearGradient** `(0, 0, W, H)`, stops `'rgba(244,194,194,0.12)'`, `'rgba(184,212,184,0.08)'`, `'rgba(176,196,222,0.12)'`. Rename the helper to `_getDrawFxCurtain` for clarity. Note: this gradient uses `globalCompositeOperation = 'soft-light'`, not `'multiply'` — preserve that.
- `versions/aurora.html:752` — `min(W,H)*0.2` → `max(W,H)*0.8`, stops `'rgba(0,0,0,0)'` and `'rgba(0,0,0,0.45)'`. Composite `'multiply'`.

**Indentation**: read each file's existing body to confirm indent depth. `versions/fractal.html` and `versions/glitch.html` have `function drawFx() {` at 4 spaces and body at 6 spaces. `versions/watercolor.html` has them at 4/6. `versions/aurora.html:677` opens at 4/6. Match each file's existing style.

**Verify**:

- `grep -nE "createRadialGradient|createLinearGradient" versions/fractal.html` shows only the **declaration line inside the cache helper** (`_getDrawFxVignette`), not the previous per-frame site.
- `grep -nE "createRadialGradient|createLinearGradient" versions/watercolor.html` shows only `drawMeter`'s gradient (line 784) and the cache helper (line ~706 region) and the drip-line deferral (line 762).
- In a browser smoke test, load `http://localhost:5174/versions/fractal.html` (after `npm run dev`), play audio, confirm the vignette is still visually present (heavy black vignette around the edges, fading toward center).

### Step 2 — Cache the 4 audio-varying alpha gradients with the `globalAlpha` trick

For the 4 gradients whose stop alphas vary with audio (`void`, `neon`, `pulse`, `chrome`), cache a **unit-alpha** gradient (alpha = 1.0) once and apply the per-frame alpha multiplier via `ctx.globalAlpha` on the wrapping `save()`/`restore()` block.

**Files**: `versions/void.html:742`, `versions/neon.html:841`, `versions/pulse.html:819`, `versions/chrome.html:699`.

**Action (representative — `versions/void.html:742`)**:

Add to the IIFE closure scope (same place as Step 1):
```js
var _drawFxVoidVignetteCache = null;
var _drawFxVoidVignetteKey = '';
function _getDrawFxVoidVignette(ctx, W, H) {
  const key = W + 'x' + H;
  if (key !== _drawFxVoidVignetteKey) {
    const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.15, W/2, H/2, Math.max(W,H)*0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,1)');     // unit alpha — modulated via ctx.globalAlpha
    _drawFxVoidVignetteCache = vg;
    _drawFxVoidVignetteKey = key;
  }
  return _drawFxVoidVignetteCache;
}
```

Then in `drawFx()` replace:
```js
const vig = 0.55 + 0.30 * Math.min(1, A.feat.rms * 4);
const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.15, W/2, H/2, Math.max(W,H)*0.75);
vg.addColorStop(0, 'rgba(0,0,0,0)');
vg.addColorStop(1, 'rgba(0,0,0,' + vig + ')');
ctx.save();
ctx.globalCompositeOperation = 'multiply';
ctx.fillStyle = vg;
ctx.fillRect(0, 0, W, H);
ctx.restore();
```

with:
```js
const vig = 0.55 + 0.30 * Math.min(1, A.feat.rms * 4);
ctx.save();
ctx.globalAlpha = vig;                        // unit-alpha gradient × this = original
ctx.globalCompositeOperation = 'multiply';
ctx.fillStyle = _getDrawFxVoidVignette(ctx, W, H);
ctx.fillRect(0, 0, W, H);
ctx.restore();
```

**Why this is pixel-equivalent**: the gradient's stop-1 alpha was `vig` and stop-0 was `0`. The new gradient's stop-1 alpha is `1.0`, then `ctx.globalAlpha = vig` multiplies the entire gradient by `vig`. Both stop-0 (still `0`) and stop-1 (`1 × vig = vig`) match the original. The composite operation (`multiply`) and the fill rect coords are unchanged. Net: pixel-identical.

Apply the same pattern to the other 3 sites with these adjustments:

- `versions/neon.html:841` — `pulse = damp(beat, 0.4)` modulates the per-frame alpha (or `A.feat.beat` if damp isn't loaded). Gradient has **3 stops**:
  - stop 0: `rgba(255,240,74,0.18 * pulse)` → cache as `rgba(255,240,74,0.18)`; use `ctx.globalAlpha = pulse`.
  - stop 0.5: `rgba(0,240,255,0.10 * pulse)` → cache as `rgba(0,240,255,0.10)`; still modulated by the same `globalAlpha = pulse`.
  - stop 1: `'rgba(0,0,0,0)'` → cache as-is.
  
  Coordinates: `cx = W * 0.5, cy = H * 0.5` (per-frame but cheap arithmetic), inner radius `0`, outer radius `max(W, H) * 0.6`. Key the cache by `W + 'x' + H` (same as before).
  
  **Note**: the block is already gated by `if (pulse > 0.05)` (line 839) and the existing `ctx.save()` is at line 845. Add `ctx.globalAlpha = pulse;` right after that save() (or merge with the existing save flow).

- `versions/pulse.html:819` — `fg` stops:
  - stop 0: `rgba(255,45,138,beat*0.35)` → cache as `rgba(255,45,138,0.35)`.
  - stop 1: `rgba(0,0,0,0)` → cache as-is.
  - Use `ctx.globalAlpha = A.feat.beat` for the wrapper.
  - Coordinates: `W/2, H/2, 0` → `W/2, H/2, max(W,H)*0.4`. Cache by `W + 'x' + H`.

- `versions/chrome.html:699` — `sg` stops:
  - stop 0: `rgba(255,255,255,onset*0.6)` → cache as `rgba(255,255,255,0.6)`.
  - stop 0.4: `rgba(229,228,226,onset*0.3)` → cache as `rgba(229,228,226,0.3)`.
  - stop 1: `rgba(0,0,0,0)` → cache as-is.
  - Use `ctx.globalAlpha = A.feat.onset` for the wrapper.
  - Coordinates: `W/2, H/2, 0` → `W/2, H/2, max(W,H)*0.4`. Cache by `W + 'x' + H`.
  - **Note**: existing block is gated by `if (A.feat.onset > 0.05)` (line 698) and the existing `ctx.save()` is at line 703. Add `ctx.globalAlpha = A.feat.onset;` right after that save().

**Verify**:

- For each file, `grep -nE "createRadialGradient|createLinearGradient" versions/<file>.html` shows only the **declaration line inside the cache helper** and `drawMeter`'s gradient (separate plan).
- `grep -n "globalAlpha = " versions/<file>.html` shows the new per-frame line.
- Browser smoke test each variant at `http://localhost:5174/versions/<file>.html`. Load the bundled demo song (auto-loaded via `_last-song.js`). Visual check: vignette must darken edges, audio reactive alpha must still pulse with beat/onset/rms exactly as before.

### Step 3 — Invalidate the cache on resize

When the window resizes, `fit()` runs and updates `W`/`H`. The cache key changes, so the helpers above automatically rebuild on next `drawFx` call. **No additional code needed** — the `W + 'x' + H` mismatch triggers a fresh `createRadialGradient`.

**Verify**:

- `grep -nE "_drawFxVignetteKey|_drawFxVoidVignetteKey|_drawFxNeonGlowKey|_drawFxPulseFlashKey|_drawFxChromeSpecKey" versions/<file>.html` shows the key variable and the check site.
- Browser test: load `versions/fractal.html`, drag the window narrower — first frame after resize should still produce a visible vignette (proving the cache rebuild fired).

### Step 4 — Run the existing variant audio verifiers

After all 8 patches land:

- `npm run check` — confirms no syntax regressions across `versions/*.html`.
- `npm run verify:variants` (or the existing per-variant audio verifier: `verify-aurora-audio.mjs`, `verify-chrome-audio.mjs`, etc.) — confirms audio reactivity still fires (e.g. `verify-aurora-audio.mjs` checks that `A.feat.bass` and `A.feat.beat` move the visualizer).
- Spot-test with `verify-void-audio.mjs`, `verify-neon-audio.mjs`, `verify-pulse-audio.mjs`, `verify-watercolor-audio.mjs` if present. If not present, fall back to `verify-genops.mjs` (which renders each engine page with seed layers and confirms the canvas is non-blank).

## Verification

- `npm run check` passes (syntax + manifest + bundle + API).
- `npm run verify:variants` (or equivalent variant audio verifier) passes — audio reactivity unchanged.
- `grep -cE "createRadialGradient|createLinearGradient" versions/{aurora,chrome,fractal,glitch,void,neon,pulse,watercolor}.html` shows **only** the 1 declaration inside each new `_getDrawFx<Name>` helper + `drawMeter`'s gradient (out of scope for this plan). Total for those 8 files: should drop from ~16 occurrences (aurora:2, chrome:2, fractal:2, glitch:2, void:2, neon:2, pulse:2, watercolor:3 minus drawMeter for some = ~14 actual drawFx sites) to **8 declarations inside helpers** + the 8 drawMeter sites (covered by separate plan).
- Browser smoke: load each variant in dev mode with audio playing, confirm vignette and pulse-glow behavior is visually identical to before (sub-pixel check optional but not required).

## Risks / gotchas

- **Composite-op interaction with `globalAlpha`**: The `globalAlpha` multiplier interacts correctly with `globalCompositeOperation = 'multiply'` (the default for the vignette blocks) and `'screen'` (for the glow blocks). Verified: `globalAlpha` is applied *before* the composite op per spec, so `multiply(globalAlpha × vignette)` and `screen(globalAlpha × glow)` both produce the expected pixel result. **Same proven pattern as `engine.html:drawPaletteOverlay`** (cycle 2026-09-05T05-03).
- **`globalAlpha` already set elsewhere**: some `drawFx` blocks set `globalAlpha` before/after the gradient block (e.g. `aurora.html:711` for the soft-light tint, `fractal.html:711` for chromatic aberration). The pattern is always `ctx.save() / ... / ctx.restore()`, so the cached-alpha-wrapper's save/restore fully scopes its `globalAlpha` change. **No leak** between blocks.
- **`chrome.html:699` block re-entry**: the block is wrapped in `if (A.feat.onset > 0.05) { ... }`. The cache helper only runs inside that branch, so if onset stays below threshold the cache never builds. On the next onset spike, the helper builds and caches — no behavioral change.
- **Indent matching**: `versions/aurora.html:677` opens `function drawFx()` at 4 spaces (verify by reading the line above — the file uses 4-space body indent throughout). `versions/fractal.html` and `versions/glitch.html` similarly use 4/6. `versions/watercolor.html` uses 4/6. Match the existing style of each file.
- **In-flight plan overlap**: `2026-09-06T03-54-speed-variant-drawmeter-grad-cache.md` covers the `drawMeter` per-bar gradient in the same 8 files. The two plans touch different lines (drawFx vs drawMeter) and both can land independently. After both land, the per-frame allocation count for these 8 files drops from ~64 (5 bars × ~2 + drawFx + drawFx = 7-12 per file × 8 files = ~70-90 actually) to **0 per-frame** CanvasGradient allocations.

## Out of scope

- `versions/chrome.html:728` (mirror-sweep LinearGradient with continuously-moving endpoints and 2 audio-varying middle-stop alphas). A `translate+scale` trick is feasible but fiddly; defer.
- `versions/aurora.html:737` (pastel curtain LinearGradient with 3 distinct audio-varying alphas across 3 stops). Can't be reduced to a single `globalAlpha` multiplier; would require per-stop rerender or a different visual approach. Defer.
- `versions/watercolor.html:762` (drip `LinearGradient(d.x, d.y0, d.x, d.y0 + grown)` inside a drip-grow loop with per-drip coordinates). Runtime cost is small (≤3 drips per frame). Defer.
- `versions/spectrum.html`, `versions/baroque.html`, `versions/mosaic.html`, `versions/tape.html` — already covered by cycle 2026-09-06T06-45 (`paint()` gradients).
- `engine.html:drawPaletteOverlay`, `engine.html:drawMeter` — already covered by cycles 2026-09-05T05-03 and 2026-09-05T20-20.
- `lib/audio-visualizer.client.js` — already covered by cycle 2026-09-06T01-40.
- All `versions/*.html drawMeter` gradient caching — covered by cycle 2026-09-06T03-54 (in flight).
