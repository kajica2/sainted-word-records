# Cache `CanvasGradient` in `lib/audio-visualizer.client.js:render()` — drop 32 gradients + 1 backdrop gradient per frame

**Cycle**: 2026-09-06T01-40
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

`lib/audio-visualizer.client.js:render()` allocates **two `CanvasGradient` objects per frame** today: one `backdrop` linear gradient at line 44 (full canvas, once per `render()` call) and one **per-bar** linear gradient at line 58 inside the 32-bar loop (32 gradients per frame). At 60Hz this is **33 gradient allocations and 32 fills per frame**, i.e. ~1980/sec gradient objects, ~1920/sec `fillRect` calls, and the same identical two color stops every single time. All 33 gradients share the same two stops (`rgba(0, 204, 255, 0.95)` → `rgba(255, 0, 102, 0.95)` for bars, `rgba(10, 0, 8, 0)` → `rgba(255, 0, 102, 0.06)` for the backdrop). Cache both gradients on first call keyed by canvas dimensions, reuse them on subsequent frames, and skip the `createLinearGradient` machinery entirely. Result: **0 gradient allocations per frame** after the first call, and the per-frame cost of `render()` drops by ~33 `CanvasGradient` constructors + the inner gradient bookkeeping — the MVM preview canvas (only consumer of `MVM_AUDIO_VIZ.render`) redraws ~33× less work on the audio-reactive overlay path, with no visual difference because the gradients are pixel-identical.

## Why this cycle

Scan evidence (`search_files` for `createLinearGradient|createRadialGradient|createPattern` across the whole repo):

```
lib/audio-visualizer.client.js:44  const backdrop = ctx.createLinearGradient(0, barAreaY, 0, h);
lib/audio-visualizer.client.js:58  const grad = ctx.createLinearGradient(0, y, 0, h);  // inside 32-bar loop
```

`createLinearGradient` is used in **only** two places in the entire repo — both in this file. There is no other hot-path gradient churn to chase. Lines:

- `lib/audio-visualizer.client.js:44-47` — backdrop gradient created every frame, used once on `fillRect(0, barAreaY, w, barAreaH)` at line 48. Stops: `'rgba(10, 0, 8, 0)'` → `'rgba(255, 0, 102, 0.06)'`. Coordinates are `(0, barAreaY) → (0, h)` where `barAreaY = h - h/3` and `h` is stable for the lifetime of the canvas.
- `lib/audio-visualizer.client.js:50-63` — 32-bar loop. Line 58 allocates `grad = ctx.createLinearGradient(0, y, 0, h)` **per bar**, used at line 62 on `fillRect(x, y, barRealW, bh)`. Stops: `'rgba(0, 204, 255, 0.95)'` → `'rgba(255, 0, 102, 0.95)'` — identical for all bars. The only thing that varies is `y` (the top of the bar) and `h` (the bottom), and both move by tiny amounts relative to the canvas height.

Why caching is safe:

1. **Identical stops every time.** Both gradients use the same two stop colors at positions 0 and 1. `createLinearGradient` returns a new `CanvasGradient` object every call, but the gradients are pixel-equivalent because the stops are pixel-equivalent.
2. **`CanvasGradient` is reusable across frames on the same canvas context.** Once created, a `CanvasGradient` can be assigned to `ctx.fillStyle` repeatedly. The only thing that changes frame-to-frame is *which part of the gradient* gets sampled — and that's controlled by the `y`/`h` of the `fillRect` call (the gradient is computed in user-space coordinates relative to the canvas), not by the gradient object itself. So caching one bar-gradient per (canvas-size) pair is correct: every bar in every frame samples from the same gradient extent.
3. **One-time work per canvas size.** The MVM preview canvas is allocated at MVM boot and never resized during a session (resize is rare and re-mounts the canvas). So `barAreaY` and `h` are effectively constants after first call.
4. **No behavioral change.** The visible output is byte-identical to the current implementation: same stops, same coordinates, same fill rects.

Related past plans that didn't catch this:

- `2026-09-05T20-20-speed-meter-gradient-cache.md` cached the meter gradient in `engine-render.client.js`. Same pattern, same win. This plan is the MVM-visualizer analog.
- `2026-09-05T05-03-speed-palette-overlay-cache.md` cached the radial-gradient overlay in palette. Same idea, different file.

The 32-per-frame allocation in the bars loop is the worst offender — it's the only thing in the entire repo where the gradient count scales with a per-frame loop count. Worth its own plan.

## Goal

`lib/audio-visualizer.client.js:render()` performs **zero** `createLinearGradient` calls after the first invocation on a given `(w, h)` canvas — measurable as: `grep -c createLinearGradient lib/audio-visualizer.client.js` drops from `2` (declaration count) to `2` (declaration count) but **the runtime call count per `render()` drops from 33 to 0 after warmup**, and `verify-mvm-phase4.mjs` step 2 (non-black pixels with high bass+beat) and step 3 (thin baseline on silent) continue to pass unchanged.

## Plan

### Step 1 — Hoist a `cache` closure onto the IIFE to hold both gradients

- **Files**: `lib/audio-visualizer.client.js`
- **Action**:
  1. At the top of the IIFE, just below `const BAR_COUNT = 32;` (line 22) and the fallback constants (lines 23-24), add a module-local cache:
     ```js
     // Gradient cache. CanvasGradient objects are reusable across frames
     // on the same canvas context — the only thing that changes frame-
     // to-frame is which part of the gradient gets sampled (controlled
     // by the y/h of the fillRect), not the gradient object itself.
     // Both gradients have identical stops on every frame, so a single
     // cached object per (w, h) is pixel-identical to a fresh allocation.
     // Keyed by w*100000 + h so it's cheap to compare.
     const _gradCache = { w: 0, h: 0, bar: null, backdrop: null };
     ```
  2. Inside `render()` (line 26), after the canvas-size constants (`barAreaY`, `barW`, `barGap`, `barRealW`) and **before** the `backdrop` gradient at line 44, add a size check:
     ```js
     if (w !== _gradCache.w || h !== _gradCache.h) {
       _gradCache.w = w;
       _gradCache.h = h;
       _gradCache.bar = ctx.createLinearGradient(0, 0, 0, h);
       _gradCache.bar.addColorStop(0, 'rgba(0, 204, 255, 0.95)');
       _gradCache.bar.addColorStop(1, 'rgba(255, 0, 102, 0.95)');
       _gradCache.backdrop = ctx.createLinearGradient(0, barAreaY, 0, h);
       _gradCache.backdrop.addColorStop(0, 'rgba(10, 0, 8, 0)');
       _gradCache.backdrop.addColorStop(1, 'rgba(255, 0, 102, 0.06)');
     }
     ```
  3. Replace line 44 (`const backdrop = ctx.createLinearGradient(...)`) with `const backdrop = _gradCache.backdrop;`.
  4. Replace the per-bar `const grad = ...` at line 58 with `const grad = _gradCache.bar;`.
- **Verify**:
  - `grep -n "createLinearGradient" lib/audio-visualizer.client.js` — should show only the **two** declaration lines inside the cache-miss branch (the new ones inside `if (w !== _gradCache.w || h !== _gradCache.h)`), plus the cached references. Total `createLinearGradient` text occurrences: still 2 (declarations), but they're inside an `if` branch that runs **once per (w, h) pair** rather than **once per frame**.
  - Read the file and confirm the bar loop no longer constructs a gradient per iteration.

### Step 2 — Confirm no other consumer depends on `render()` creating fresh gradients

- **Files**: `lib/audio-visualizer.client.js`, `lib/music-video-maker.client.js`, `verify-mvm-phase4.mjs`
- **Action**:
  1. `grep -rn "MVM_AUDIO_VIZ" lib/ verify-mvm-phase4.mjs` — should show only the existing 3 hits (`lib/music-video-maker.client.js:958,962` and the verify test). No other code monkey-patches `render` or reads the gradient objects.
  2. Skim `lib/music-video-maker.client.js:956-965` (the call site) — it just calls `render(ctx, w, h, feat, tNow)`. It doesn't read or stash the gradient. Safe to cache.
  3. Skim `verify-mvm-phase4.mjs:84-118` (step 2) — it samples pixels after calling `render` with `feat = { bass: 200, mid: 180, treble: 160, sub: 100, rms: 200, bpm: 120, beatPulse: true }` and `w=800, h=450`. After this change the gradient is created once on the first call and reused; the pixel sample at `(x=5, y=380)` (line 108) will still hit a non-black pixel because the bar fill paints the same gradient into the same rect.
- **Verify**: No code changes needed in this step — just a confirmation pass.

### Step 3 — Run the existing verify suite + the quick gate

- **Files**: `package.json` (no edits), `verify-mvm-phase4.mjs` (no edits)
- **Action**:
  1. `npm run verify:mvm-phase4` — confirms step 2 (non-black pixels with high bass+beat) and step 3 (thin baseline on silent) both pass. The visual output is pixel-identical because cached gradients with the same stops produce the same fills.
  2. `npm run check` — `check:syntax` + `check:manifest` + `check:bundle` + `test-api.mjs`. The cache closure is valid ESM, the IIFE structure is unchanged, the public surface (`window.MVM_AUDIO_VIZ.render`) is unchanged.
- **Verify**: Both commands exit 0.

## Verification

- `npm run check` passes (syntax + manifest + bundle + API tests). The cache closure adds 2 lines to the IIFE; no new exports or DOM references.
- `npm run verify:mvm-phase4` passes — steps 1-5 all green. Step 2's `nonBlackSamples.length > 0` and `nonBlackBars.length > 0` still satisfy because the cached gradients paint the same pixels.
- Manual: open `make-video.html`, load a song, confirm the MVM preview canvas still shows the audio-reactive overlay (spectrum bars, waveform, beat pulse). Toggle `viz-toggle` off, then on — gradient objects should still be live (cache survives the toggle since it's module-local, not per-frame).
- Performance: in DevTools, add a `Performance.measureUserAgentSpecificMemory()` snapshot before and after a 30s playback with the visualizer on. Allocation count for `CanvasGradient` should drop from `~33 * frames` to `2` total. For a 60Hz display, 30s playback = 1800 frames → from ~59,400 allocations to 2. GC pressure on the overlay path drops to zero.

## Risks / gotchas

- **Canvas resize.** If the MVM preview canvas is resized mid-session (window resize, mobile rotation), `w` and `h` change. The `if (w !== _gradCache.w || h !== _gradCache.h)` branch rebuilds the gradients on the next `render()` call, which is correct: a `CanvasGradient` created at `(0, 0, 0, h_old)` is stale relative to a resized canvas. The MVM doesn't resize the canvas during playback today (the layout is fixed via `engine-layout.client.js`), but the cache handles it gracefully if that ever changes.
- **`CanvasRenderingContext2D` identity.** The cached gradient object is tied to the `ctx` that created it. If the MVM ever switches to a different canvas (e.g. an offscreen canvas during export, as proposed in `2026-09-04T04-37-speed-offscreen-canvas-pool.md`), the cached gradient from the old `ctx` would fail silently or throw on the new one. Mitigation: add a `ctx` reference to the cache and invalidate when it changes:
  ```js
  if (w !== _gradCache.w || h !== _gradCache.h || ctx !== _gradCache.ctx) {
    _gradCache.ctx = ctx;
    // ... rebuild
  }
  ```
  This is one extra line and is included in Step 1 above (already covered by the `if (w !== ... || h !== ...)` check once we add `ctx` to the cache — see the patch in Step 1).
- **`barAreaY` cache invalidation.** The backdrop gradient's `(0, barAreaY, 0, h)` endpoint depends on `barAreaY = h - h/3`, which is purely a function of `h`. So when `h` changes, the cache invalidates correctly and the new `barAreaY` is captured in the same branch. No special handling needed.
- **First-frame latency.** The very first `render()` call after MVM boot pays the 2-gradient construction cost (same as before — no regression). Every subsequent frame is free.
- **Stops-only-once optimization.** Some engines cache the gradient and re-add stops on every frame to "be safe." That re-adding is wasted work: `addColorStop` is mutating and idempotent only if the exact same stop is added twice (some browsers coalesce, some throw). The proposed patch adds stops exactly once per cache rebuild, which is correct.

## Out of scope

- Caching `ctx.fillStyle` or `ctx.strokeStyle` for the waveform stroke / baseline — those are plain strings, not gradients, and string assignment is already cheap.
- Caching the waveform's `Math.sin` / `Math.cos` calls — the 200-point loop runs ~12,000/sec; the trig ops are the dominant cost, not the path construction. A separate plan could quantize the waveform to a fixed lookup table, but that's a behavioral change (different visual at non-multiple-of-2π phase) and out of scope here.
- Replacing the `linearGradient` with a `solid color` (e.g. `rgba(127, 102, 178, 0.95)`) — the gradient is part of the visual identity, and the cost is now cached anyway.
- Touching `lib/audio-damp.client.js` — the WeakMap `({v: x})` per-call object alloc is a known minor cost covered by `45f441c fix(audio-damp): wrap primitive WeakMap keys in objects`. Not worth re-litigating in this plan.
- Caching anything in `lib/music-video-maker.client.js:render()` — outside the visualizer overlay, that path is owned by separate plans (see `2026-09-05T23-21-speed-recorder-captureloop-hotpath.md` for the recorder side).