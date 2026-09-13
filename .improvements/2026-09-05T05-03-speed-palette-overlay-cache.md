# Cache `drawPaletteOverlay` so the RAF loop stops rebuilding two radial gradients per frame

**Cycle**: 2026-09-05T05-03
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

`engine.html:4108-4133` (`drawPaletteOverlay(cx)`) runs once per RAF tick from the engine's main loop at `engine.html:4373`. Every frame it:

- reads the DOM value `$('palette').value` (one DOM read per frame, in a hot path),
- builds a fresh `cx.createRadialGradient(...)` even though the canvas dimensions and palette key change only on resize and palette change,
- builds a second fresh `cx.createRadialGradient(...)` for the vignette (only the inner/outer radii depend on `Math.max(w, h)` which is constant between resizes),
- reads `Audio.feat.centroid` (line 4110, `const c = Audio.feat.centroid`), assigns it to a local, and then never uses it — pure dead read every frame.

Two gradient objects + two `fillRect` calls over a fullscreen quad are real per-frame work; on the main `/engine/` page that's 60 of each per second the engine is playing. The fix is to memoise the gradients on the render object, rebuild them only when `(w, h, palette)` actually changes, and drop the dead `centroid` read. Same paint output (the gradients are deterministic from those inputs), zero behavior change, real per-frame allocation and CPU savings on the engine's primary render hot path.

## Why this cycle

- The main render hot path is `engine.html:4308-4386` (`loop(t)`). The draw order is `clear → drawLayer → drawSelection → drawPaletteOverlay → drawFlash → drawMeter → drawRecordingOverlay → requestAnimationFrame`. `drawPaletteOverlay` is the only one that unconditionally does DOM reads + gradient allocations + two fullscreen fills regardless of state. `drawFlash` early-returns when `beat < 0.05` (engine.html:4137). `drawMeter` is bounded to a small canvas (engine.html:4144-4174).
- Recursive `cx.fillRect(0, 0, w, h)` over a fullscreen stage canvas with `globalCompositeOperation = 'screen'` and `'multiply'` is comparable in cost to one extra layer blit per pass, every frame, even though the gradients only depend on canvas dimensions + palette key.
- The `Audio.feat.centroid` local at `engine.html:4110` is read but never used. `5feb82d feat(sprint): smoother audio + one cool flourish` and earlier commits added features to drawPaletteOverlay that left this dead read in place; recent perf cycles did not touch the function.
- Recent `covered_topics` (per `.improvements/STATE.json`) cover recorder buffers, render-cache, LFO/timing allocations, fx postprocess, variants, and the audio sampler. None covers the per-RAF gradient rebuild on the main engine. New topic: `palette-overlay-grad-cache`.
- The fix is mechanical and tightly scoped to `engine.html:4108-4133` plus a tiny cache invalidator on window resize. Versions don't call `drawPaletteOverlay` (confirmed: `grep -rn "drawPaletteOverlay" versions/` returns zero matches, only `versions/_render-inject.js` references the symbol during codegen). One file, one method, no shared modules touched.

## Goal

`drawPaletteOverlay(cx)` builds each radial gradient at most once per `(canvasW, canvasH, paletteKey)` triple instead of every RAF tick, does no DOM reads in the steady state, and produces visually identical output for the same input state.

## Plan

### Step 1 — Add a cache key + memoised gradients to the renderer object

- **Files**: `engine.html` inside the renderer object that owns `drawPaletteOverlay`. The object literal is at `engine.html:4158` (search for `drawPaletteOverlay(cx)` at `engine.html:4108` and look up to the enclosing brace; the renderer object starts ~`engine.html:3840` next to the `proc` / `procCtx` setup). Place a new block of fields where sibling one-shot resources live (e.g. just above `drawLayer` at `engine.html:3961` is fine; it stays in the same closure).
- **Action**: declare the following fields on the renderer object initialiser:
  ```js
  // palette overlay memo cache — invalidated on resize or palette change
  this._paletteCache = null;     // { w, h, palette, grad, vignette }
  ```
  No `new` per frame; reset to `null` on resize (Step 2).
- **Verify**: confirm the field exists and is `null` at startup, and that nothing else reads/writes `_paletteCache`.

### Step 2 — Invalidate the cache on canvas resize and palette change

- **Files**: `engine.html` — wherever stage canvas dimensions are assigned during resize (search for `stageCanvas.width =` / `this.proc.width = stageCanvas.width` near `engine.html:3849-3872`) and the palette `<select>` control with `id="palette"`.
- **Action**:
  1. At the existing assignment that writes `stageCanvas.width`, also assign `this._paletteCache = null`. There are multiple resize sites: `engine.html:3849-3851`, `:3871-3872`, and the offscreen proc canvas resizes at `:3888-3889`. Add a single `this._paletteCache = null` next to each `this.proc.width = …` so the cache drops when the canvas backs the palette overlay change. (The palette overlay reads `cx.canvas.width`, which is `stageCanvas.width`.)
  2. Wire the existing palette `<select>` (referenced as `$('palette').value`) with an `input`/`change` listener — find the existing palette dropdown binding in the same render bootstrap section (search `getElementById('palette')` or `$('palette')` outside the per-frame loop). If a listener already exists, add `this._paletteCache = null` to its handler; if not, add a one-line `addEventListener('change', …)`. Don't open the full event-binding section — only add this single handler and don't refactor adjacent code.
- **Verify**: `grep -n "_paletteCache = null" engine.html` shows ≥ 3 invalidation sites (the 3 proc-canvas resize lines) plus the palette listener. No new persistent timers or RAF hooks.

### Step 3 — Memoise the gradient construction inside `drawPaletteOverlay`

- **Files**: `engine.html:4108-4133`.
- **Action**: rewrite the body so that:

  ```js
  drawPaletteOverlay(cx) {
    const w = cx.canvas.width, h = cx.canvas.height;
    const palette = $('palette').value;
    const cache = this._paletteCache;
    let grad, vg;
    if (cache && cache.w === w && cache.h === h && cache.palette === palette) {
      grad = cache.grad;
      vg   = cache.vignette;
    } else {
      const maxWH = Math.max(w, h);
      grad = cx.createRadialGradient(w/2, h/2, 0, w/2, h/2, maxWH * 0.7);
      const colors = {
        neon:  ['rgba(255, 61, 146, 0.18)', 'rgba(0, 229, 255, 0.10)'],
        solar: ['rgba(255, 210, 74, 0.18)', 'rgba(255, 122, 61, 0.10)'],
        ocean: ['rgba(0, 229, 255, 0.16)', 'rgba(80, 0, 255, 0.10)'],
        mono:  ['rgba(255, 255, 255, 0.10)', 'rgba(0, 0, 0, 0.20)'],
      }[palette];
      grad.addColorStop(0, colors[0]);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      vg = cx.createRadialGradient(w/2, h/2, maxWH * 0.3, w/2, h/2, maxWH * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      this._paletteCache = { w, h, palette, grad, vignette: vg };
    }
    // The previous frame read Audio.feat.centroid into `c` and never used it.
    // Drop the read; centroids no longer influence the palette overlay.
    cx.save();
    cx.globalCompositeOperation = 'screen';
    cx.fillStyle = grad;
    cx.fillRect(0, 0, w, h);
    cx.globalCompositeOperation = 'multiply';
    cx.fillStyle = vg;
    cx.fillRect(0, 0, w, h);
    cx.restore();
  },
  ```

  Preserve the surrounding 2-space indent, single quotes, and trailing comma style. Do not introduce template literals; do not move the two `fillRect` calls into a helper. Keep `cx.save()`/`cx.restore()` so the composites remain self-contained. Do not commit a version that keeps `const c = Audio.feat.centroid;` even as a comment that still reads it.
- **Verify**: `grep -n "createRadialGradient" engine.html` still returns 2 occurrences (`grad` and `vg` in `drawPaletteOverlay`, both behind the cache miss branch). `grep -n "Audio.feat.centroid" engine.html` no longer returns matches inside `drawPaletteOverlay` (the original on `engine.html:4110` was unused; the only remaining centroid references should be the read in `Audio.sample()` at `engine.html:1961` and the draw-call sites that already use it elsewhere — none of those are inside `drawPaletteOverlay`). The existing call site `this.drawPaletteOverlay(cx)` at `engine.html:4373` is unchanged.

### Step 4 — Add a focused verifier

- **Files**: new `verify-palette-overlay-cache.mjs` at repo root; new `verify:palette-overlay-cache` entry in `package.json` scripts (the user has untracked edits at `package.json:24-41`; merge carefully without touching unrelated lines — append the new entry alphabetically or alongside the existing `verify-*` scripts).
- **Action**: follow the standalone Puppeteer verifier style documented in `AGENTS.md` (each `verify-*.mjs` is independent). The verifier should:
  1. Connect to a running Vite dev server (`npm run dev` on port 5174) using the same connection pattern as recent recorder/audio-history buffer verifiers (e.g. `verify-audio-history-buffer.mjs`, `verify-recorder-mono-buffer-hoist.mjs`). Open `/engine/`.
  2. Read the engine page source and assert:
     - `engine.html:4108`-area `drawPaletteOverlay` does not contain `Audio.feat.centroid`.
     - `engine.html` contains a `_paletteCache` field, at least 3 `_paletteCache = null` invalidation sites, and the new gradient branch is present.
  3. Drive the renderer in-page: get a handle to the renderer's `drawPaletteOverlay` (e.g. by attaching it to `window` in a debug build, or by stubbing `cx.createRadialGradient` with a counter via `Object.defineProperty`). Load a known short audio file or a synthetic feature update, run two RAF frames, and assert the second frame produces zero `createRadialGradient` calls.
  4. Switch the palette `<select>` to a different value and assert that the next frame rebuilds exactly 2 gradients. Resize the stage canvas and assert the next frame also rebuilds exactly 2 gradients.
  5. Mark the audio-data-driven portion as a `(env skip: no local audio source)` if headless test cannot produce deterministic feature changes — preserving the literal `env skip` marker convention used elsewhere in the repo.
- **Verify**: `npm run verify:palette-overlay-cache` passes locally. No console errors. The verifier's two gradient counts are exactly 0 in the steady state and exactly 2 after each invalidation event.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run build` passes; the prebuild `fetch-library.mjs` either populates `library/` or logs the existing "skipping" message (no regression).
- Browser smoke: open `/engine/`, load any song, confirm the palette tint and vignette still look identical to before the patch (a side-by-side before/after screenshot is acceptable evidence).
- New `npm run verify:palette-overlay-cache` passes.
- No new console warnings; the existing `state._warnedLayer` / `state._warnedExtras` paths still fire only on actual errors.

## Risks / gotchas

- **Cache key correctness**: if `cx.canvas.width` ever changes inside `drawPaletteOverlay` without going through the resize paths we invalidated, the gradients will be stale and visuals will skew. Mitigate by using `(w, h, palette)` as the full key (no derived booleans, no memoised previous values). If a future refactor adds dynamic sizing outside the proc canvas resize path, the next frame will still produce a valid overlay because the cache key includes `w`/`h`.
- **Palette string changes**: if someone adds a new palette key to the literal `colors` map but forgets to invalidate the cache, a previously-cached gradient for the new palette key won't exist. Add an explicit invalidator in the palette `<select>`'s `change` listener (Step 2). The `colors[palette]` access also has an implicit edge case: if `palette` is read as an unknown key, `colors` is `undefined` and `grad.addColorStop(0, colors[0])` would throw. Match the existing behavior: preserve the original `colors[palette]` semantics including any undefined-key throw. Do not introduce a fallback color set as part of this change.
- **`(global)` state**: `cx.createRadialGradient` returns a `CanvasGradient` owned by the source canvas's context. If the stage canvas is resized (replacing the backing buffer) the gradient still references the old context. Mitigate by keying the cache on `w`/`h` so a resize forces a rebuild — this is precisely why Step 2 invalidates the cache on every `proc.width =` assignment.
- **`Audio.feat.centroid` removal**: this local was unused, but a future engine experiment might rely on it being sampled here. The audit grep in Step 3 should also check for any other reader of `centroid` from inside `drawPaletteOverlay`'s closure; if found, surface that as a blocker rather than deleting. If the only reference is the dead read at line 4110, deletion is safe.
- **Color stop ordering**: rebuilding the gradient is structurally identical (same center, same radii, same stop colors, same stop offsets). Pixel output for a stationary canvas must match exactly; the only thing that differs is *when* the gradient object is created.

## Out of scope

- Caching `drawMeter` gradients (`createLinearGradient` on `engine.html:4161` runs once per frame; it depends on `(bh, h)` which vary per-frame, so a memo would be incorrect).
- Caching `drawFlash` — early-returns when `beat < 0.05`, single `fillRect`, no gradients.
- Refactoring `loop()` itself or the broader RAF structure in `engine.html`.
- Touching `fx-postprocess.js`, `versions/*.html`, or `versions-presets.js` (none call `drawPaletteOverlay`).
- Any UX change to the palette dropdown.
- Caching other per-frame DOM reads in unrelated code paths (`$('beat-gate')`, `$('decay')`, `$('sensitivity')`); separate audit, separate plan.

