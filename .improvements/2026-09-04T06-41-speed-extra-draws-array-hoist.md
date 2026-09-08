# Hoist `extraDraws` array literal out of the per-frame RAF loop in 11 engine variants

**Cycle**: 2026-09-04T06-41
**Type**: speed
**Priority**: P2
**Estimated effort**: XS

## TL;DR

Every variant page's RAF loop calls `SWR_RENDER.frame(..., { extraDraws: [drawFx, drawMeter] })` with a freshly-allocated 2-element array wrapped in a freshly-allocated options object — 11 variants × 2 allocations × 60 fps = ~1320 wasted allocs/sec across the codebase. Both `drawFx` and `drawMeter` are stable function references defined once at module scope inside the variant's IIFE (e.g. `versions/film.html:841` and `:894`); the array contents never change between frames. Hoist the array to module scope (or just above the RAF loop) so the same `[drawFx, drawMeter]` is reused every frame. Drop the enclosing `{ extraDraws: [...] }` object literal by exposing `extraDraws` as a positional argument to `SWR_RENDER.frame()`, then deprecate the `opts` form. Pixel output is identical; `verify-genops.mjs` confirms.

## Why this cycle

Scanned the variant render paths after the last 7 cycles focused on `engine-render.client.js`, `engine-lfos.client.js`, `engine-timing.client.js`, and `lib/recorder.client.js`. The variant pages themselves (`versions/*.html`) haven't been targeted for hot-path allocations since the codemod work that surfaced them in commit `bc1a89c` (`feat(recording): upgrade Recorder across all 19 variants`). Reading the RAF loop tail across the 11 variants that route through `SWR_RENDER.frame()`:

- `versions/film.html:943` — `SWR_RENDER.frame(stage, ctx, __render_layers, applyR, __render_drawLayer, { extraDraws: [drawFx, drawMeter] });`
- `versions/neon.html:877` — identical pattern
- `versions/aurora.html:787`, `versions/chrome.html:765`, `versions/fractal.html:755`, `versions/glitch.html:760`, `versions/hallucination.html:1014`, `versions/pulse.html:889`, `versions/smoke.html:857`, `versions/void.html:777`, `versions/watercolor.html:798` — all identical pattern

Total: 11 sites (verified via `grep -n "extraDraws: \[" versions/*.html`). All 11 pass a literal `[drawFx, drawMeter]` array, and all 11 wrap it in a fresh `{ extraDraws: [...] }` options object. Inside the IIFE, `drawFx` is defined once (e.g. film.html:841) and `drawMeter` is defined once (film.html:894). The array contents are stable for the page lifetime — they only point to function references defined earlier in the same IIFE. Nobody mutates the array between frames.

`SWR_RENDER.frame()` consumes the array read-only at `engine-render.client.js:418-419`:

```js
if (opts.extraDraws) {
  for (let i = 0; i < opts.extraDraws.length; i++) {
    try { opts.extraDraws[i](); } catch (err) { ... }
  }
}
```

So the only consumers are the caller (the variant) and `frame()` itself; no other reader mutates the array between frames. Safe to share.

Also relevant: the surrounding RAF loop already hoists two other locals to "every frame" scope (`__render_layers` at `versions/film.html:941`, `__render_drawLayer` at `:942`) because they reference closure-captured values that change between frames (layer order, transform state). The `extraDraws` array is the same shape but its contents are *static* across the session — it should hoist to module scope (or before the RAF loop), not just out of the loop body.

Prior cycles `2026-09-01T15-42-speed-fx-uniform-skip`, `2026-09-03T12-09-speed-recorder-frame-allocs`, `2026-09-03T16-17-speed-render-cache-size-key`, `2026-09-03T20-28-speed-timing-clone-dead-ease`, `2026-09-03T22-30-speed-lfo-ensureinsts-allocs`, `2026-09-04T04-37-speed-offscreen-canvas-pool` all targeted per-frame allocations in `engine-render.client.js`, `engine-lfos.client.js`, `engine-timing.client.js`, and `lib/recorder.client.js`. None touched the variant HTML pages themselves. `grep -rn "extraDraws" .improvements/` returns 0 — no prior plan proposed this.

Working tree check: `git status --short` shows only root-level PNG deletes (a separate cleanup unrelated to engine code) and `.improvements/` plan files. The 11 variant HTML files are clean. Safe to propose.

## Goal

After this lands, none of the 11 variant RAF loops allocate a fresh array literal or a fresh options object literal on the per-frame `SWR_RENDER.frame(...)` call. The shared `extraDraws` array is allocated once per page load. The `SWR_RENDER.frame()` API accepts `extraDraws` as a positional argument (replacing the `opts.extraDraws` shape) so the options-object allocation goes away too. Pixel output is identical (verified by `verify-genops.mjs` rendering each engine page with seed layers and confirming the canvas is non-blank after RAF settles).

## Plan

### Step 1 — Make `extraDraws` a positional arg on `SWR_RENDER.frame()`

- **Files**: `engine-render.client.js:288-298` (the `frame()` JSDoc + signature) and `:418-428` (the `extraDraws` consumer).
- **Action**: Change the public signature from

  ```js
  function frame(stage, ctx, layers, applyR, drawToCtx, opts) {
    opts = opts || {};
    ...
    if (opts.extraDraws) { for (let i = 0; i < opts.extraDraws.length; i++) ... }
  ```

  to

  ```js
  function frame(stage, ctx, layers, applyR, drawToCtx, extraDraws) {
    ...
    if (extraDraws) { for (let i = 0; i < extraDraws.length; i++) ... }
  ```

  Update the JSDoc comment at `:288-295` to read:
  ```
  //   extraDraws   — optional array of () => {} called after layers but before meter
  //                   (one allocation per page load, reused across frames)
  ```
  The `bgColor` option (which no current caller uses) is removed from the signature; if a future caller needs per-frame bg overrides they can re-introduce it. Verified: `grep -rn "bgColor" engine-*.client.js versions/*.html` returns no callers passing `bgColor` to `frame()` (the only `bgColor` references are `SWR_RENDER.setBackground(...)` setters, which are unrelated).

- **Verify**: read the diff; confirm the only change inside the function body is renaming `opts.extraDraws` to `extraDraws` and dropping the `opts = opts || {}` line. No other field of `opts` is read (search confirms: only `opts.bgColor` and `opts.extraDraws` were ever referenced, and `bgColor` has no callers).

### Step 2 — Update the public type on `window.SWR_RENDER`

- **Files**: `engine-render.client.js:441-453` (the public object).
- **Action**: No change needed — `frame` is referenced by identity, not by signature, and the public surface still exposes `frame` as a function. The signature change is transparent to callers via the new positional argument.
- **Verify**: `SWR_RENDER.frame` still references the same function (verify by reading the diff).

### Step 3 — Hoist the `extraDraws` array in each of 11 variants

For each of `versions/film.html`, `versions/neon.html`, `versions/aurora.html`, `versions/chrome.html`, `versions/fractal.html`, `versions/glitch.html`, `versions/hallucination.html`, `versions/pulse.html`, `versions/smoke.html`, `versions/void.html`, `versions/watercolor.html`:

- **Files**: each variant's RAF loop, line N where `SWR_RENDER.frame(..., { extraDraws: [drawFx, drawMeter] });` is called.
- **Action**: Two sub-edits per variant.

  **3a — Add the hoisted array** immediately before the `requestAnimationFrame(loop)` line that schedules the first tick (e.g. film.html:952 `requestAnimationFrame(loop);`). For film.html the insert point is just before line 952. For each variant the exact line differs; locate it via `grep -n "requestAnimationFrame(loop);" versions/<variant>.html | head -2` (the second match is the kickoff, the first is the tail-of-loop). Insert:
  ```js
  // Hoisted once per page load — array contents (drawFx, drawMeter) are
  // stable function references for the lifetime of this IIFE. Reusing
  // avoids a per-frame array + options-object allocation.
  const __render_extras = [drawFx, drawMeter];
  ```

  **3b — Replace the per-frame call site.** Change:
  ```js
  SWR_RENDER.frame(stage, ctx, __render_layers, applyR, __render_drawLayer, { extraDraws: [drawFx, drawMeter] });
  ```
  to:
  ```js
  SWR_RENDER.frame(stage, ctx, __render_layers, applyR, __render_drawLayer, __render_extras);
  ```

  Both edits are mechanical codemods — a line-based pattern with a 3-line stable context window works. The marker comment `// Hoisted once per page load` makes the change idempotent if re-applied (the second application finds no `[drawFx, drawMeter]` literal at the call site and bails).

- **Verify**: After all 11 edits:
  - `grep -n "extraDraws:" versions/*.html` → 0 hits (the literal is gone).
  - `grep -n "extraDraws\b" versions/*.html engine-render.client.js` → 11 hits, all `__render_extras` declarations + usages + 1 hit in the new `frame()` signature.
  - `grep -n "__render_extras" versions/*.html` → 22 hits (1 declaration + 1 usage per variant).

### Step 4 — Run `npm run check` and the smoke verify

- **Files**: (no file changes).
- **Action**:
  1. `npm run check` — must pass (syntax + manifest + bundle + api tests). The only files touched are 11 HTMLs + 1 .js; the .js change is a pure rename.
  2. `npm run verify:genops` — must pass. Loads each engine page, asserts canvas is non-blank after RAF settles. Pixel output should be identical because `frame()` calls `extraDraws[i]()` in the same order with the same arguments.

- **Verify**: Both exit 0.

### Step 5 — Optional: pool-stats-style read for the new array

- **Files**: `engine-render.client.js:441-453` (the public object).
- **Action**: Add a read-only getter `frameExtraDraws` that returns the last `extraDraws` array passed to `frame()`, so DevTools can confirm the array reference is stable across frames:
  ```js
  get frameExtraDraws() { return state._lastExtraDraws; },
  ```
  Where `state._lastExtraDraws` is set inside `frame()` after the parameter is bound:
  ```js
  function frame(stage, ctx, layers, applyR, drawToCtx, extraDraws) {
    ...
    state._lastExtraDraws = extraDraws || null;
    ...
  ```
  This is observability, not a perf win. Skip it if Step 1-4 is already approved — it can land as a follow-up cycle.
- **Verify**: in DevTools, `SWR_RENDER.frameExtraDraws` returns the array after a few frames; subsequent reads return the same reference (`===` check).

## Verification

- `npm run check` passes — syntax + manifest + bundle + api tests.
- `npm run build` passes — `dist/` rebuilds cleanly. (Optional: skip on local; CI runs it.)
- `npm run verify:genops` passes — canvas non-blank after RAF settles on every engine page. The 11 affected variants all hit this path (verified: every `SWR_RENDER.frame` call in the 11 variants has a `__render_extras` arg after the codemod).
- **Manual identity check** (optional):
  1. Open `versions/film.html`, press play, wait 5 seconds.
  2. Open DevTools console: in the RAF loop, `console.log(__render_extras)` — confirm it's the same array reference across consecutive ticks. Insert a temporary `console.assert(__render_extras === __render_extras_lastFrame)` if useful, then remove.
- **Allocation delta**: each variant saves 1 array + 1 options object per RAF. At 60 fps × 11 variants running concurrently (the verify-genops harness does this) that's 660 array allocs/sec + 660 options object allocs/sec gone — about 1320 GC-eligible objects/sec avoided.
- **Pixel-hash regression**: load `versions/film.html`, capture `stage.toDataURL()` at frames 30/60/120 with and without the codemod. Expect 0 pixel difference (the array reference is the same, so `frame()` calls the same `drawFx` and `drawMeter` in the same order).

## Risks / gotchas

- **API breakage (Step 1)**: changing `frame(stage, ctx, layers, applyR, drawToCtx, opts)` to `frame(stage, ctx, layers, applyR, drawToCtx, extraDraws)` is a public-API rename. Today the only known callers are the 11 variant pages (Steps 3a-3b cover them) and the grid variant (which has its own manual render path — confirmed `grep -n "SWR_RENDER.frame" versions/grid.html` returns no hits, so grid is unaffected). If any external script (PWA bootstrap, test harness, third-party embed) passes a positional `opts` arg, that arg will now be treated as `extraDraws` and (because it lacks a `.length` or `.length === 0`) will silently no-op the loop. Mitigations: (a) add a guard `if (extraDraws && extraDraws.length)` so a truthy non-array value still no-ops safely; (b) in `frame()` add a debug-mode `console.warn` when `extraDraws` is truthy and not array-like. Both are 2-line additions.
- **Eclipse variant's signature (Step 3)**: `versions/eclipse.html:821` calls `SWR_RENDER.frame(stage, ctx, Layers.list, applyR, (l, r, c) => drawLayer(l, r, c, W, H));` — no `extraDraws` at all. After Step 1's signature change, this call site is unchanged in behavior (it just passes 5 args instead of 6, and `extraDraws` is undefined, which the `if (extraDraws)` guard handles). No codemod needed for eclipse.
- **Grid variant (no-op)**: `versions/grid.html` uses a manual render loop (`window.__grid_render` at line 913) and never calls `SWR_RENDER.frame`. No codemod needed.
- **Variant IIFE scope (Step 3a insertion point)**: the hoisted `__render_extras` must be inside the IIFE (so `drawFx`/`drawMeter` are in scope) but before the RAF `loop()` function. Each variant's IIFE structure is the same — IIFE opens at the top of the inline `<script>`, helpers (`drawFx`, `drawMeter`, `applyR`, `Layers`) are defined inside, then `function loop(t) {...}` is defined, then `requestAnimationFrame(loop)` kicks it off. Inserting `const __render_extras = ...` between the `requestAnimationFrame(loop)` kickoff and the next top-level statement (the Recorder block at film.html:1001) puts it in the right scope: outside `loop()` so it's allocated once, but inside the IIFE so it closes over `drawFx`/`drawMeter`. Verified by reading film.html:943-952.
- **Idempotence**: the marker comment `// Hoisted once per page load` makes the codemod re-runnable. A second application that finds the comment but no `[drawFx, drawMeter]` literal at the call site bails. (The `[drawFx, drawMeter]` literal was the trigger; once removed, re-running the codemod is a no-op.)
- **No new wiring**: all 5 steps are localized edits inside `engine-render.client.js` (1 file) and 11 variant HTML files (mechanical codemod). No new exports, no new public methods beyond the optional `frameExtraDraws` getter in Step 5.
- **Backwards compatibility**: `SWR_RENDER.setBackground(...)` is unchanged. `SWR_RENDER.invalidate(...)` is unchanged. `SWR_RENDER.cacheSize` / `cacheCap` getters unchanged. Only the `frame()` signature changes, and only for callers passing a 6th argument — every current caller is in the codemod scope.

## Out of scope

- **Hoisting `__render_layers` and `__render_drawLayer`**: those are recomputed each frame because their contents change (`Layers.list.slice().sort(...)` reflects current layer order; the arrow `(l, r, c) => drawLayer(l, r, c, W, H)` closes over the current `W`/`H` which can change on resize). Leaving alone.
- **Hoisting the `frame()` call's enclosing options object for future fields**: with the new positional `extraDraws` arg, there's no options object at all. If a future caller needs `bgColor` or other per-frame options, they can pass an object — `frame(stage, ctx, layers, applyR, drawToCtx, extraDraws, { bgColor: '#000' })`. Add the support when a real need surfaces.
- **Pooling the per-variant `__render_extras` array**: it's already allocated once per page load (after this lands). Pooling would only matter if a page reload happened frequently, which isn't a real concern. Leaving alone.
- **Codemod for the 5 variants that don't use `SWR_RENDER.frame`** (kraft, mosaic, baroque, phosphor, tape — they have inline `window.SWR.Audio.feat = {...}` test stubs and don't render through the engine). No codemod needed.
- **Codemod for `engine.html`** (the main page): confirmed it also doesn't call `SWR_RENDER.frame` — it has its own render loop. No codemod needed.
- **A verify-extras-array.mjs Puppeteer suite**: would assert `__render_extras === prevFrameExtras` across two RAF ticks. Cheap 5-line test; defer until someone proposes a verify-suite-coverage cycle.
- **The `SWR_RENDER.frameExtraDraws` getter (Step 5)**: skipped by default — Step 5 is marked optional. Defer until ops asks for it.
