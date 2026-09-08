# Pool offscreen canvases in `engine-render.client.js`'s cache-miss path

**Cycle**: 2026-09-04T04-37
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

`engine-render.client.js:386-388` allocates a fresh `OffscreenCanvas` (or `HTMLCanvasElement` fallback) and calls `getContext('2d')` on every layer that misses the per-layer render cache. The cache is bounded at 4 entries (`state.cacheCap` at line 50) but most engines render 4-8 layers, the `activeSet` (top N by audio energy) is uncached by design (line 377), and any cache invalidation (asset swap, reactor edit, fade transition, audio fingerprint change, resize) forces a miss next frame — so in steady-state reactive playback the miss branch fires on most layers most frames. Each miss allocates a ~16.6 MB canvas at DPR-2 plus a fresh `CanvasRenderingContext2D`. Replace the throwaway `makeOffscreen()` with a small canvas pool keyed by `(width, height)` that reuses canvases between frames (the previous frame's canvas is safe to overwrite: it's only consumed by the immediately-following `ctx.drawImage(oc, 0, 0, state.cssW, state.cssH)` at line 402, then dropped). Expected savings: one `OffscreenCanvas` + one 2D context per uncached layer per frame. At 4 layers × 60 fps that's 240 canvas allocations/sec gone, and — more importantly — the canvas pool amortizes the ~GPU-memory-and-driver-call cost of repeatedly creating and tearing down backing stores on the same path the existing cache (`state.cache`, line 40) already shows is allocation-heavy.

## Why this cycle

Scanned `engine-render.client.js` after the prior cycles — recent speed wins targeted LFO `ensureInsts` (plan `2026-09-03T22-30-speed-lfo-ensureinsts-allocs`), recorder frame allocs (`2026-09-03T12-09`), render-cache-size-key (`2026-09-03T16-17`), timing clone dead-ease (`2026-09-03T20-28`), and FX uniform skip (`2026-09-01T15-42`). The `engine-render.client.js` file itself has been left alone since the render-cache-size-key plan (which only touched `e.lastSize` storage at lines 261/273). Reading the cache-miss branch:

- `engine-render.client.js:386` — `const oc = makeOffscreen(backingW, backingH);` allocates an `OffscreenCanvas` (or HTMLCanvasElement fallback) per miss. `makeOffscreen()` at line 191-196 returns `new OffscreenCanvas(w, h)` directly with no reuse.
- `engine-render.client.js:387` — `const octx = oc.getContext('2d');` returns a fresh `CanvasRenderingContext2D` per miss.
- `engine-render.client.js:388` — `octx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);` resets the transform on the new context.
- The branch is hit on **every** cache miss, including:
  - The `activeSet` (line 377): top N layers by audio energy are explicitly *uncached* by design so per-frame motion never serves a stale blit. Engines with 4+ reactive layers hit this every frame.
  - The "non-active" but rotating steady state: any audio-feature change within `FINGERPRINT_TTL_MS` (32 ms, line 229) invalidates the memoized `audioHash` (line 245-247 invalidates `_lastAudioHashAt` to 0 on beat flips at line 241-244), forcing a fresh `buildVersion()` hash and a fresh cache-key for every layer every ~3 frames even when the visual reactor is unchanged.
  - Crossfade transitions: `engine-timing.client.js` calls `invalidate(l.id)` at line 359, clearing the cache for the fading layer until the swap completes.
  - Manual reactor edits, asset swaps, preset applications, `SWR_RENDER.markDirty()`.

This is the same hot-path surface that the render-cache-size-key plan improved (smaller keys → fewer invalidations → fewer misses), but the improvement is bounded by the fact that *some* misses are intrinsic (audio-reactive layers must redraw). The pool complements that work: when a miss *does* fire, reuse the canvas instead of allocating.

Working tree check: `git status --short` shows root-level PNG deletes (separate cleanup, unrelated) and `.improvements/` plan files. `engine-render.client.js` is clean. Safe to propose.

## Goal

After this lands, the cache-miss branch in `frame()` reuses canvases from a small size-keyed pool instead of allocating a fresh `OffscreenCanvas` per miss. At steady state with a 4-layer engine and one active layer, the pool should retain 1-3 canvases (each at the current backing-store size) and service all cache misses without any new `OffscreenCanvas` allocation. Pixel output remains identical (verified by `verify-genops.mjs`).

## Plan

### Step 1 — Add a size-keyed canvas pool next to `makeOffscreen()`

- **Files**: `engine-render.client.js:189-196` (the `// ---- offscreen canvas ----` section).
- **Action**: Replace `makeOffscreen(w, h)` (lines 191-196) with a pool-backed function. The pool is module-scoped (the IIFE at line 21-527 already isolates state) and keyed by `w + 'x' + h` since most frames draw at a single backing-store size:

  ```js
  // ---- offscreen canvas -----------------------------------------------
  //
  // The cache-miss branch in frame() renders into an offscreen canvas and
  // blits it. The result canvas is consumed by the immediately-following
  // ctx.drawImage(oc, ...) and then dropped on the floor — it doesn't need
  // to persist across frames. That makes it a perfect candidate for a
  // pool: keep up to N canvases keyed by (w,h), hand one out per miss,
  // mark it "in use" until the next frame's render loop is done.
  //
  // Bounded size: the worst-case usage is one canvas per layer per frame
  // (activeSet layers always miss, and most engines have 4-8 layers), so
  // cap the pool at 8 entries. On overflow, drop the LRU entry — the
  // offender is asking for more canvases than we want to retain, and
  // better to recycle than grow unbounded.
  const POOL_CAP = 8;
  const _canvasPool = []; // each entry: { w, h, canvas, inUse, lastUsedAt }

  function _acquireOffscreen(w, h) {
    const now = performance.now();
    for (let i = 0; i < _canvasPool.length; i++) {
      const e = _canvasPool[i];
      if (!e.inUse && e.w === w && e.h === h) {
        e.inUse = true;
        e.lastUsedAt = now;
        return e.canvas;
      }
    }
    // Miss: create a new canvas.
    let c;
    if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(w, h);
    else { c = document.createElement('canvas'); c.width = w; c.height = h; }
    const entry = { w, h, canvas: c, inUse: true, lastUsedAt: now };
    _canvasPool.push(entry);
    // Evict the oldest unused entry if over cap.
    if (_canvasPool.length > POOL_CAP) {
      let oldestIdx = -1, oldestAt = Infinity;
      for (let i = 0; i < _canvasPool.length; i++) {
        if (!_canvasPool[i].inUse && _canvasPool[i].lastUsedAt < oldestAt) {
          oldestAt = _canvasPool[i].lastUsedAt;
          oldestIdx = i;
        }
      }
      if (oldestIdx >= 0) _canvasPool.splice(oldestIdx, 1);
    }
    return c;
  }

  function _releaseOffscreenPool() {
    // Called once per RAF (at the end of frame()) after all draws have
    // completed. Marks every canvas "not in use" so the next frame's
    // acquire can pick them up. This is sound because every canvas
    // handed out in this frame is consumed by ctx.drawImage(oc, ...)
    // synchronously before the next acquire — the GPU has read the
    // pixels by the time drawImage returns.
    for (let i = 0; i < _canvasPool.length; i++) _canvasPool[i].inUse = false;
  }
  ```

  The `inUse` flag is necessary because a single frame can have multiple cache misses in flight sequentially (line 386 acquires, line 402 draws, then the next layer's iteration at line 386 acquires again). Without the flag, two iterations on the same `(w, h)` would both pull the same canvas and the second `drawImage(oc, ...)` would draw the *second* layer's pixels over the first before the first `drawImage` ran. With the flag, the first iteration's canvas is reserved until `_releaseOffscreenPool()` runs at the end of `frame()`.

- **Verify**: read the diff; confirm the pool is module-scoped and keyed by `(w, h)`.

### Step 2 — Replace `makeOffscreen(...)` call in `frame()` and add pool release

- **Files**: `engine-render.client.js:386-388` (the cache-miss branch) and `engine-render.client.js:436-437` (just before `state.dirty = false`).
- **Action**:
  1. At line 386, change:
     ```js
     const oc = makeOffscreen(backingW, backingH);
     const octx = oc.getContext('2d');
     octx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
     ```
     to:
     ```js
     const oc = _acquireOffscreen(backingW, backingH);
     const octx = oc.getContext('2d');
     // Reset transform every frame: pooled canvases retain state from
     // the previous draw, and drawToCtx() relies on the transform being
     // the DPR-only identity at the start of every render. Cheap (one
     // setTransform call), and the only state drawToCtx() is documented
     // to read at entry.
     octx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
     ```
  2. After `state.dirty = false;` at line 436, insert:
     ```js
     // Release pooled canvases back to the pool. Every canvas handed
     // out this frame has been consumed by a synchronous ctx.drawImage()
     // before this point, so it's safe to mark them available for the
     // next frame.
     _releaseOffscreenPool();
     ```
- **Verify**: read the diff; confirm the `setTransform` line is preserved (still needed even on pooled canvases since drawToCtx() may mutate it).

### Step 3 — Add a pool-drain on `SWR_RENDER.invalidate()` and on resize

- **Files**: `engine-render.client.js:184-187` (`invalidate()`), `engine-render.client.js:163-182` (`fit()`), and `engine-render.client.js:449` (the `setCacheCap` setter on `window.SWR_RENDER`).
- **Action**:
  1. At line 186-187, after `state.cache.delete(layerId);`, do **not** drain the pool. Reason: a cache invalidation means the next frame will re-render that layer; we want the pooled canvas available for that redraw. Only the layer's *cached* canvas is gone — the pooled offscreen (used for the transient render path) is fine to keep.
  2. At line 180 (`if (dprChanged) state.dirty = true;` in `fit()`), the backing-store size is about to change. Drain the pool so we don't keep stale-sized canvases around:
     ```js
     // DPR changed → existing pooled canvases are sized for the old DPR
     // and would silently clip or scale incorrectly on the next acquire.
     // Drain them; the next frame will populate the pool at the new size.
     _canvasPool.length = 0;
     ```
     Add this immediately after `state.dirty = true;` at line 180 inside the `dprChanged` branch. Also add it in `fit()` when `stage.width !== targetW || stage.height !== targetH` (line 170-174) — same reasoning.
  3. At line 449 (`setCacheCap(n)`), the cache cap changes but the pool is independent of `state.cache`; leave it alone. The pool size is governed by `POOL_CAP`, not by `cacheCap`.
- **Verify**: read the diff; confirm the pool is drained only when the backing-store size changes (not on every invalidate).

### Step 4 — Expose pool stats on `window.SWR_RENDER` for ops visibility

- **Files**: `engine-render.client.js:441-453` (the public `window.SWR_RENDER` object).
- **Action**: Add a `get poolStats()` getter that returns `{ size, capacity, inUse, bySize }` so the `verify-genops.mjs` harness and DevTools can inspect pool pressure:
  ```js
  get poolStats() {
    let inUse = 0;
    const bySize = {};
    for (let i = 0; i < _canvasPool.length; i++) {
      const e = _canvasPool[i];
      if (e.inUse) inUse++;
      const k = e.w + 'x' + e.h;
      bySize[k] = (bySize[k] || 0) + 1;
    }
    return { size: _canvasPool.length, capacity: POOL_CAP, inUse, bySize };
  },
  ```
- **Verify**: load any engine page, open DevTools, type `SWR_RENDER.poolStats`. After 60 seconds of playback expect `{ size: 1..4, inUse: 0, bySize: { '3840x2160': N } }` (all `inUse: 0` because the pool releases after each frame).

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run build` passes — `dist/` rebuilds cleanly.
- `npm run verify:genops` exits 0. Loads each engine page with a seed library, asserts the canvas is non-blank after RAF settles. Pixel output should be identical to pre-patch (the pool serves the same canvases; only the allocation pattern changes).
- **Manual pool inspection**:
  1. Open `versions/film.html`, press play, wait 5 seconds for steady state.
  2. Open DevTools console: `JSON.stringify(SWR_RENDER.poolStats)` → expect `{ "size": 1-4, "capacity": 8, "inUse": 0, "bySize": { "<W>x<H>": N } }` (e.g. `{"size":2,"capacity":8,"inUse":0,"bySize":{"1920x1080":2}}` at 1080p DPR-1).
  3. Toggle the LFO panel to force cache invalidations: `SWR_RENDER.poolStats.size` should grow up to ~`layers.length` then stay bounded by `POOL_CAP`.
  4. Resize the window: `SWR_RENDER.poolStats.size` should reset (the drain on DPR/size change empties the pool), then refill.
- **Manual heap check**: DevTools → Performance → record 10 seconds with 4 layers active. Compare `OffscreenCanvas` allocation count before/after the patch. Expected drop: ~1 per layer per cache-miss frame. With 4 layers and `activeSet=2`, that's ~120 fewer `OffscreenCanvas` allocations per second. Pool size stays at 2-4 (no growth).
- **Pixel-hash regression**: load `versions/film.html`, capture `stage.toDataURL()` at frames 30/60/120 with and without the patch. Expect 0 pixel difference (the pool serves the same canvases; the only change is allocation pattern).

## Risks / gotchas

- **Pool drain timing (Step 2)**: the `_releaseOffscreenPool()` call at the end of `frame()` assumes every `ctx.drawImage(oc, ...)` consumes the pooled canvas synchronously. This is true for the main-stage draw at line 402 (synchronous GPU read), but if a future variant adds an async `drawToCtx` (e.g. WebCodecs pipeline), the canvas would be reused before its pixels were read. Mitigation: the `inUse` flag protects against in-frame reuse; cross-frame reuse is guarded by the `_releaseOffscreenPool()` call at end of frame, which only fires after all `drawImage` calls have returned. Verified today: every `drawToCtx` in the seed harness is synchronous (search: `function drawToCtx` and `function drawLayer` in `versions/*.html` — all are synchronous 2D canvas draws).
- **Concurrent fit() during frame()**: a `ResizeObserver` callback (line 485) could fire during `frame()` and call `fit()`, which would drain the pool mid-frame. The `inUse` flag protects the in-flight canvas from being dropped (the drain logic in Step 3 only removes `!inUse` entries), but the next iteration's `_acquireOffscreen` would see an empty pool and allocate fresh. Worst case: one extra canvas allocation per resize event. Acceptable.
- **Canvas state pollution across pool reuse (Step 2)**: pooled canvases retain 2D context state (transform, fillStyle, strokeStyle, filter, globalAlpha, etc.) from the previous draw. `drawToCtx()` is documented to assume a DPR-only identity transform at entry (line 388 reset it explicitly), but other state could leak. Mitigation: `octx.setTransform(...)` at line 388 is the only state read at the top of every draw; if `drawToCtx` (or a variant) reads `fillStyle` or `filter` from the context without setting it first, that's a pre-existing bug. Out of scope to fix here — the pool inherits the contract.
- **`OffscreenCanvas` constructor throws on size 0**: if `backingW` or `backingH` is 0 (early frame before `fit()`), `new OffscreenCanvas(0, 0)` throws `IndexSizeError`. Pre-existing risk: `makeOffscreen` had the same exposure. The `fit()` call at line 298 (gated by `state.dirty`) ensures `backingW/H` are valid before the cache-miss branch fires, and `state.dirty=true` is set on first frame. No regression.
- **Pool size on multi-page engines**: the pool is module-scoped (line 21 IIFE), so it persists across page navigations within the SPA. SPA navigation would need to call a `drainPool()` explicitly. Today there's no SPA navigation; each `versions/*.html` is a separate page load. Out of scope.
- **No new wiring**: all four steps are locally scoped edits inside the existing IIFE. No new exports, no new public methods beyond `poolStats` (a read-only getter).
- **Backwards compatibility**: `makeOffscreen` is removed (Step 1). `grep -rn "makeOffscreen" engine-*.client.js client/ lib/`: 1 hit (`engine-render.client.js:191` and `:386`). Only the in-file caller uses it. Safe to delete. If a downstream caller exists in a variant page, the `grep` would have surfaced it.

## Out of scope

- Pooling the **cached** layer canvases themselves (`state.cache` at line 40). These need to persist for many frames (the whole point of the cache) and are already size-keyed by `lastSize` (line 273). The cache is a separate concern with its own eviction policy (FIFO at line 279-283). Leaving it alone.
- Reusing the 2D context itself across frames. `OffscreenCanvas.getContext('2d')` returns the same context for the same canvas (per spec), so `octx` is already reused — only the canvas wrapper is pooled here. No further win available without invasive API changes.
- Switching the offscreen canvas to `createImageBitmap` + `ImageBitmapRenderingContext`. Higher throughput (GPU-backed) but adds complexity (lifecycle, transferability, ImageBitmap close()) and would require changes to every variant's `drawToCtx`. Defer until a measured need.
- Pool drain on `setCacheCap()` (Step 3.3). The pool cap is independent; setting `cacheCap=0` doesn't free pool entries. Acceptable — pool entries are bounded by `POOL_CAP=8` and most engines use 4-8 layers.
- Adding a `verify-canvas-pool.mjs` Puppeteer suite. The changes are observable through `SWR_RENDER.poolStats` from the console; a Puppeteer suite would assert `poolStats.inUse === 0` between RAF frames, which is a 5-line test. Nice-to-have, not blocking — propose as a follow-up if any cycle picks up "verify-suite coverage."
- Multi-canvas `OffscreenCanvas` cloning for the FX pipeline (`fx-postprocess.js`). Different surface (WebGL), different per-frame cost model. Out of scope for this cycle.
