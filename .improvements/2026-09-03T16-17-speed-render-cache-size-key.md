# Render cache: hoist `cssW+'x'+cssH` size key out of the per-layer hot path

**Cycle**: 2026-09-03T16-17
**Type**: speed
**Priority**: P1
**Estimated effort**: XS

## TL;DR

`engine-render.client.js:getCached()` is called once per layer per RAF frame (the engine's main hot path) and runs `state.cssW + 'x' + state.cssH` — two string concatenations and a fresh allocation — on every call just to compare against a stored `lastSize`. With the engine's default `cacheCap: 4` cached layers plus several uncached ones, that's ~6-8 short-lived strings per frame, 360-480/sec at 60 fps, all garbage. Worse, `setCached()` does the same allocation on the *uncommon* path (cache miss). Hoist the size key: store `state._sizeKey` (a single immutable string), recompute it only inside `fit()` when the CSS size actually changes (resize / DPR step), and compare via primitive `===`. Zero behavior change, fewer per-frame allocations, no new API surface.

## Why this cycle

Scanned `engine-render.client.js` for per-RAF allocations in the layer loop:

- `engine-render.client.js:261` — `getCached()` builds `state.cssW + 'x' + state.cssH` on **every call**. The call site at `:379` (`const cached = !force && getCached(l.id, version);`) runs inside the `for (let i = 0; i < layers.length; i++)` loop at `:335`, once per layer per frame. At 4 layers × 60 fps that's 240 string allocations/sec just for the size compare. The two operand string concats also defeat V8's string-intern optimization (the resulting string is unique every time `cssW` or `cssH` is a float-coerced-to-string of a number that never changed).
- `engine-render.client.js:273` — `setCached()` does the same allocation on the cache-miss path. This one only fires when a layer is *first* rendered at a new version/size, but it's still a string the GC has to clean up.
- `engine-render.client.js:307` — `const audioHash = audioFingerprint();` is already memoized for 32 ms (`:229-254`) — that path was already optimized in a prior cycle (see `engine-render.client.js:222-228` doc-comment). The size key never got the same treatment.
- `engine-render.client.js:210-217` — `buildVersion(r, assetId, audioHash)` is also a string concatenation, but it varies per layer (the `_v` differs) so we can't safely hoist it. Out of scope for this plan.

The fix is mechanical: the only legitimate times `cssW` or `cssH` change are inside `fit()` (`:163-182`) — a window resize or an auto-DPR adjustment. The string is invariant for the entire session between those events.

Existing prior cycles (`2026-09-01T15-42-speed-fx-uniform-skip` and `2026-09-03T12-09-speed-recorder-frame-allocs`) addressed the FX-pass uniform thrash and the recorder's per-frame `Float32Array` allocation respectively. The render cache layer is the next-most-RAF-allocation-heavy surface in the engine and hasn't been touched.

Working tree check: `git status --short` shows only root-level PNG deletes (likely a cleanup the user is staging) and the `.improvements/` plan files — no in-progress edits to `engine-render.client.js`. Safe to propose.

## Goal

After this lands, the per-layer render loop allocates zero strings on the `getCached`/`setCached` path between fits, while producing pixel-identical output (verified via the existing `verify-render-dpr.mjs` and `verify-genops.mjs` checks at the repo root).

## Plan

### Step 1 — Add a hoisted size-key to state, set it inside `fit()`

- **Files**: `engine-render.client.js:36-65` (state object) and `:163-182` (`fit()`).
- **Action**:
  1. Add `_sizeKey: '0x0'` to the `state` object next to `dpr`, `cssW`, `cssH`. Default value matches the initial `cssW=0, cssH=0` so the first-frame `===` compares equal without a recompute. Comment it as "invariant between fit() calls; compared by reference in getCached()".
  2. In `fit()` at `:163-182`, after the existing `state.cssW = targetCssW; state.cssH = targetCssH;` lines (`:178-179`), add a single recompute guarded by the same change detection:

     ```js
     const newKey = targetCssW + 'x' + targetCssH;
     if (newKey !== state._sizeKey) {
       state._sizeKey = newKey;
       // All cached entries are wrong size — clear so getCached misses
       // and setCached repopulates with the new key. Cheaper than
       // comparing against each entry's lastSize, and the cache will
       // fill naturally on the next few frames anyway.
       state.cache.clear();
     }
     ```

     Place this *before* the existing `if (dprChanged) state.dirty = true;` line at `:180` so dirty is set if either dpr or size changed (the existing `state.dirty = true;` at `:174` covers the backing-store change; the new branch covers the css size path which only invalidates the cache key, not the backing store).

- **Verify**: `npm run check:syntax` passes; `npm run build` rebuilds `dist/` cleanly. The change is locally scoped — no new wiring.

### Step 2 — Replace the per-call string concat with `===` against `state._sizeKey`

- **Files**: `engine-render.client.js:261` (`getCached`) and `:273` (`setCached`).
- **Action**:
  1. In `getCached()` at `:261`, replace:
     ```js
     if (e.lastSize !== state.cssW + 'x' + state.cssH) return null;
     ```
     with:
     ```js
     if (e.lastSize !== state._sizeKey) return null;
     ```
  2. In `setCached()` at `:273`, replace:
     ```js
     lastDpr: state.dpr, lastSize: state.cssW + 'x' + state.cssH,
     ```
     with:
     ```js
     lastDpr: state.dpr, lastSize: state._sizeKey,
     ```

  Both rely on the invariant from Step 1: `state._sizeKey` is updated only inside `fit()`, and `getCached`/`setCached` are only called from `frame()` which runs after `fit()` has been called at least once on a dirty frame (`:298`). The first call after a fresh load will compare `e.lastSize === '0x0'` against `state._sizeKey === '<actual>'` and miss correctly.

- **Verify**: `npm run check:syntax`; read the diff to confirm both call sites use `state._sizeKey` and no other site still does `cssW + 'x' + cssH`.

### Step 3 — Clear `_sizeKey` invalidation is correct (audit the existing cache eviction path)

- **Files**: `engine-render.client.js:265-284` (`setCached` and the cache eviction loop).
- **Action**:
  1. Confirm the existing eviction loop at `:279-283` already handles the "over-cap" case (FIFO). After Step 1, `state.cache.clear()` only fires when the key changes — no need to also touch the existing eviction loop. **No code change here**; this step is just a confirmation that the existing eviction behavior is preserved.
  2. Add a one-line doc-comment above the new branch in Step 1 explaining *why* the cache is cleared instead of just bumping `_sizeKey`:

     ```js
     // Cache entries baked at the previous CSS size are still valid
     // bitmaps — they just need their lastSize stamp refreshed. But
     // since the size key is also implicitly used by the existing FIFO
     // eviction (oldest-first), and since fresh entries are cheap to
     // re-render, a clear is simpler than a mass stamp-update and the
     // visible cost (a few uncached frames after every resize) is
     // imperceptible. Resize events are user-driven and rare.
     ```

- **Verify**: read the final diff; the comment is in place and matches the actual behavior.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run build` passes — `dist/` rebuilds cleanly, no new warnings.
- `npm run verify:genops` exits 0. The check at `verify-genops.mjs:194-201` reads `R.cssW`, `R.cssH`, `R.dpr` and asserts the backing-store math — all still pass because the public API is unchanged.
- `npm run verify:render-dpr` exits 0. This loads `versions/film.html` at 1× and 2× DPR and asserts the backing store scales; the resize path through `fit()` is the one path that mutates `_sizeKey`, so it's the right regression net.
- **Pixel-hash regression check (manual)**: load `versions/film.html` in Puppeteer with a seed library (see `verify-render-dpr.mjs:25-44` for the seed pattern), capture `stage.toDataURL()` at frame 60, apply the patch, capture again, diff bytes. Expect 0 pixel difference (the only data that changes is the cache key's lifetime, not the rasterized pixels).
- **Allocation count (manual)**: open DevTools → Performance → record 5 seconds, check "JS heap" timeline. With the patch, the `String` count tick should be flat over the recording window; before, it'll show 200-400 short-lived string entries per second during steady-state render.

## Risks / gotchas

- **First-frame invariant**: `state._sizeKey` defaults to `'0x0'` and the initial `state.cssW=0, cssH=0`. `fit()` at `:163-182` runs from `frame()` at `:298` (gated by `state.dirty`, which is `true` initially at `:38`), so by the time `getCached` first runs, `state._sizeKey` has been recomputed to the actual size. The `clear()` on first run is harmless (the cache is empty anyway).
- **Resizing during playback**: every CSS resize now triggers `state.cache.clear()` instead of just bumping the key. Cost: 4 layers × 1 frame = 4 offscreen redraws. Acceptable — resize is user-driven and rare (the auto-DPR step is the other trigger; that fires once per ~2 s at most).
- **`setCached` write path**: now uses `state._sizeKey` directly. If a future refactor adds another call site to `setCached` that bypasses `fit()`, the cache entry would be stamped with the *previous* size key. Mitigation: add an inline comment at `:273` (already there in Step 2) noting the invariant, and consider also asserting in the function that `state._sizeKey !== '0x0'`. The plan doesn't add the assert (overkill for now), but the next code reviewer touching this file should know the invariant.
- **Audio features path is unchanged**: `audioFingerprint()` is already memoized at `:229-254`; the plan does not touch it.
- **`buildVersion` is unchanged**: that string concat is per-layer, per-frame, and the parts genuinely vary (each layer has its own `_v`). Out of scope.

## Out of scope

- Changing the cache eviction policy from FIFO to LRU. The doc-comment at `:276-278` already explains why FIFO is correct here.
- Hoisting `buildVersion` (per-layer, per-frame string concat at `:214-216`). The parts genuinely vary per layer; cannot be hoisted without changing the cache-key semantics.
- Refactoring `audioFingerprint()` for further memoization. Already done.
- Touching `versions-presets.js` / `fx-postprocess.js`. The render-cache path is `engine-render.client.js` only; the FX postprocess path was addressed in a prior cycle.
- Adding a `verify-render-cache-key.mjs` script. The existing `verify-genops.mjs` and `verify-render-dpr.mjs` cover the public API surface (`R.cssW`, `R.cssH`, `R.dpr`, `R.cacheSize`); the new internal field `_sizeKey` is private and not worth a public verifier entry. Add a `console.log` during Step 1 dev to spot-check, then drop before commit.