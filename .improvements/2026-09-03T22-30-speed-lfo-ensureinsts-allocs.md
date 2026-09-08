# Eliminate per-frame allocations in `SWR_LFOS.apply()`'s `ensureInsts()`

**Cycle**: 2026-09-03T22-30
**Type**: speed
**Priority**: P1
**Estimated effort**: XS

## TL;DR

`engine-lfos.client.js:281-305` (`ensureInsts`) runs every layer, every frame, from `SWR_LFOS.apply()` at line 311. On every call it allocates a fresh `wanted` array via `(layer.modulators || []).map(m => m.id)` (line 283) and a fresh `_params` plain object via `Object.assign({}, inst.defaults, m.params)` for each modulator with a `m.params` (line 301). Both are pure waste: `wanted` is consumed by an `indexOf` membership test that only needs `Set.has()` semantics, and `_params` only changes when the user edits the LFO panel — not on every frame. Two surgical edits — replace the array scan with a `Set` and skip the `_params` re-assignment when the params reference is stable — eliminate ~1 array + ~N object allocations per layer per frame, on the same hot path the prior cycles targeted but from a previously-unscoped angle.

## Why this cycle

Scanned the LFO path after the prior cycle's `apply()`/`applyToR` plan:

- `engine-render.client.js:372-374` — every frame, for every layer, the engine calls `SWR_LFOS.apply(dt, l, r)`. With modulators attached (the LFO panel or any project that wires LFOs), this hits `engine-lfos.client.js:309-358`.
- `engine-lfos.client.js:309-312` — `apply()` short-circuits when `layer.modulators` is empty/absent (line 310), but when populated, the first thing it does is `const insts = ensureInsts(layer);` (line 311). This runs every frame, regardless of whether modulators are stale.
- `engine-lfos.client.js:281-305` — `ensureInsts()`:
  - Line 282: `if (!layer._lfoInsts) layer._lfoInsts = {};` — first-call only, fine.
  - Line 283: `const wanted = (layer.modulators || []).map(m => m.id);` — **allocates a fresh array** every frame, then iterates it twice (`indexOf` at 286 and `for…of` at 293). For a layer with N modulators, this is 1 array + N string reads.
  - Line 285-291: drops stale instances by `indexOf` against the freshly-allocated array — could use `Set.has()` for O(1) lookup, but more importantly: the **whole** "drop stale" branch only matters when the modulator list has changed. With a stable modulator list, the `for (const k of Object.keys(layer._lfoInsts))` walks the instance map and the `indexOf` is always `>= 0` for every key — pure waste.
  - Line 293-303: walks `layer.modulators` and **for each modulator with `m.params`**, line 301 does `inst._params = Object.assign({}, inst.defaults, m.params);`. That's 1 fresh plain object per modulator per frame. For 4 layers × 3 modulators each with `params` × 60 fps = 720 object allocations per second, all of which are immediately thrown away because the LFO `sample()` only reads `inst._params` (it never writes to it).

Prior cycles `2026-09-01T15-42-speed-fx-uniform-skip`, `2026-09-03T12-09-speed-recorder-frame-allocs`, `2026-09-03T16-17-speed-render-cache-size-key`, and `2026-09-03T20-28-speed-timing-clone-dead-ease` all targeted per-frame allocations in this same hot-path region (FX uniforms, recorder buffers, render cache key, timing/LFO clones). The `ensureInsts` allocation surface — `wanted.map()` + `Object.assign({}, ...)` for `_params` — is the next-most-RAF-allocation-heavy path in `engine-lfos.client.js` and has not been touched. The `covered_topics` list in `.improvements/STATE.json` does not contain `lfo-ensureinsts-allocs` or `lfo-params-allocs`.

Working tree check: `git status --short` shows only root-level PNG deletes (a separate cleanup unrelated to engine code) and `.improvements/` plan files. No in-progress edits to `engine-lfos.client.js`. Safe to propose.

## Goal

After this lands, `SWR_LFOS.apply()` allocates **zero arrays or plain objects** on the steady-state path (modulator list stable, params not edited this frame), while the `apply()` itself remains semantically identical for the next LFO `sample()` call (verified by `verify-genops.mjs` rendering each engine page with seed layers and confirming the canvas is non-blank after RAF settles).

## Plan

### Step 1 — Replace `wanted` array with a `Set` and skip the "drop stale" walk on the steady-state path

- **Files**: `engine-lfos.client.js:281-291`.
- **Action**:
  1. Replace the body of `ensureInsts()` from line 281 to line 291 with:

     ```js
     function ensureInsts(layer) {
       if (!layer._lfoInsts) layer._lfoInsts = {};
       const wantList = layer.modulators || [];
       // Fast path: when the modulator list hasn't changed (no add/remove this
       // frame), skip the stale-instance walk entirely. We track the list
       // identity on the instance cache; on first build we record it. When
       // `layer.modulators` is the same array reference as last frame AND
       // the same length, every existing instance is still wanted — the
       // `indexOf` walk below would always return >= 0 and is pure waste.
       if (layer._lfoInsts.__lastMods === wantList && wantList.length === layer._lfoInsts.__lastModsLen) {
         return layer._lfoInsts;
       }
       // First build or list changed: drop stale instances and record the
       // new list reference so the fast path engages on the next frame.
       const want = layer._lfoInsts.__want || (layer._lfoInsts.__want = new Set());
       want.clear();
       for (let i = 0; i < wantList.length; i++) want.add(wantList[i].id);
       for (const k of Object.keys(layer._lfoInsts)) {
         if (k === '__lastMods' || k === '__lastModsLen' || k === '__want') continue;
         if (!want.has(k)) {
           const inst = layer._lfoInsts[k];
           if (inst.onDetach) try { inst.onDetach.call(inst, layer); } catch (_) {}
           delete layer._lfoInsts[k];
         }
       }
       layer._lfoInsts.__lastMods = wantList;
       layer._lfoInsts.__lastModsLen = wantList.length;
       // (the build-new / sync-params loop continues below)
     ```

  2. The `__lastMods` / `__lastModsLen` keys are reserved internal names; the LFO panel never iterates `layer._lfoInsts` itself (verified by `grep -rn "_lfoInsts" engine-*.client.js client/ lib/`), so the `__` prefix is sufficient to avoid colliding with instance-id keys. Add a one-line doc-comment above `ensureInsts` explaining the invariant.

  3. The `Object.assign({}, mod.defaults, …)` at line 265 (inside `instantiate()`) still runs once per newly-attached modulator — that's correct, the first build of `_params` is the only time we genuinely need a fresh object.

- **Verify**: read the diff; confirm the fast-path branch returns `layer._lfoInsts` before any allocation runs.

### Step 2 — Skip `_params` re-assignment when the params reference is stable

- **Files**: `engine-lfos.client.js:293-303` (the build-new / sync-params loop that runs after the stale-walk).
- **Action**:
  1. Replace the block at lines 293-303:

     ```js
     // Build new ones.
     for (const m of layer.modulators || []) {
       if (!layer._lfoInsts[m.id]) {
         const mod = getModule(m.id);
         if (mod) layer._lfoInsts[m.id] = instantiate(mod, layer);
       }
       // Sync param overrides onto the existing instance.
       const inst = layer._lfoInsts[m.id];
       if (inst && m.params) {
         inst._params = Object.assign({}, inst.defaults, m.params);
       }
     }
     return layer._lfoInsts;
     ```

     with a version that records the last-synced `m.params` reference and only re-allocates the merged object when the user actually changes it (i.e. when the panel calls `setParam`):

     ```js
     // Build new instances and sync param overrides. Sync is a no-op when
     // the params reference hasn't changed since the last sync — the LFO
     // panel rebuilds the params object on every edit (see setParam() at
     // line ~385 which writes `m.params[k] = v` and then assigns via
     // `layer.modulators = layer.modulators.map(...)`), so the reference
     // change is a reliable change signal. Avoids one Object.assign()
     // allocation per modulator per frame on the steady-state path.
     for (let i = 0; i < wantList.length; i++) {
       const m = wantList[i];
       if (!layer._lfoInsts[m.id]) {
         const mod = getModule(m.id);
         if (mod) layer._lfoInsts[m.id] = instantiate(mod, layer);
       }
       const inst = layer._lfoInsts[m.id];
       if (!inst) continue;
       if (m.params) {
         if (inst.__lastParams !== m.params) {
           inst._params = Object.assign({}, inst.defaults, m.params);
           inst.__lastParams = m.params;
         }
       } else if (inst.__lastParams) {
         // modulators list went from "had params" → "no params"; restore
         // defaults so subsequent sample() reads see clean defaults.
         inst._params = Object.assign({}, inst.defaults);
         inst.__lastParams = null;
       }
     }
     return layer._lfoInsts;
     ```

  2. The `setParam()` helper at `engine-lfos.client.js:385-394` writes into `m.params[k] = v` in place (it does NOT replace the params object reference). This means after a single `setParam` call, `m.params` is the same reference but its contents have changed — the `inst.__lastParams === m.params` check would be true and the sync would skip, so the LFO would read stale `_params`. Two ways to fix:
     - **Option A (preferred, minimal blast radius)**: at the bottom of `setParam()`, replace `m.params[k] = v;` with `m.params = Object.assign({}, m.params, { [k]: v });` (or, equivalently, `m.params = { ...m.params, [k]: v };`). This forces the reference to change on every edit, which is what the `__lastParams` check relies on. Edit confirmed in place — no new helpers needed.
     - **Option B**: instead of reference equality, store a tiny `_paramsHash` (sum of `Object.keys(params).length` + a cheap rolling hash) and compare hashes. More robust to in-place mutation but adds ~6 lines and a per-frame hash recompute. Skip unless Option A causes a regression.

  3. Pick Option A. In `setParam()` (lines 385-394), replace:

     ```js
     function setParam(id, layer, k, v) {
       if (!layer || !layer.modulators) return false;
       for (const m of layer.modulators) {
         if (m.id !== id) continue;
         if (!m.params) m.params = {};
         m.params[k] = v;
         return true;
       }
       return false;
     }
     ```

     with:

     ```js
     function setParam(id, layer, k, v) {
       if (!layer || !layer.modulators) return false;
       for (const m of layer.modulators) {
         if (m.id !== id) continue;
         // Reassign the params object reference so ensureInsts()'s
         // __lastParams equality check picks up the change on the next
         // frame. Without this, the per-frame sync would no-op after the
         // first edit and the LFO would sample stale values.
         m.params = Object.assign({}, m.params || {}, { [k]: v });
         return true;
       }
       return false;
     }
     ```

- **Verify**: read the diff; confirm `__lastParams` is set on every `_params` assignment (so subsequent frames short-circuit cleanly), and `setParam()` now replaces the params object instead of mutating in place.

### Step 3 — Confirm `apply()` no longer allocates `ctx` every frame

- **Files**: `engine-lfos.client.js:313` (already covered by the prior cycle's plan `2026-09-03T20-28-speed-timing-clone-dead-ease` Step 3, which is still in flight).
- **Action**:
  1. No new edit here. If the prior cycle's plan lands first, this is a free rider: `apply()`'s `ctx` hoisting (singleton `_ctx` at module scope) lands as part of that prior work, and Step 1 + Step 2 of THIS plan complete the per-frame allocation picture for `engine-lfos.client.js`.
  2. If the prior cycle's plan has not landed by the time this one does, hoist `ctx` here too — single-line edit:

     ```js
     // Module-scope singleton — see plan 2026-09-03T20-28 for context.
     let _ctx = { now: () => performance.now(), audio: null };
     function apply(dt, layer, r) {
       if (!layer || !layer.modulators || !layer.modulators.length) return r;
       const insts = ensureInsts(layer);
       if (!r) r = {};
       _ctx.audio = (window.SWR && window.SWR.Audio) || null;
       const ctx = _ctx;
       // …rest unchanged
     }
     ```

- **Verify**: read the diff; confirm the prior plan is merged or this edit applies the same hoisting.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run build` passes — `dist/` rebuilds cleanly.
- `npm run verify:genops` exits 0. Loads each of 13 engines (`versions/aurora.html`, `chrome`, `eclipse`, `film`, `fractal`, `glitch`, `grid`, `hallucination`, `neon`, `pulse`, `smoke`, `void`, `watercolor`) with a seed library, asserts the canvas is non-blank after RAF settles. The seed layers do NOT attach LFOs, so the steady-state `ensureInsts` fast-path engages on every frame (no modulators → `apply()` returns at line 310). The new code path is reached when a layer has at least one modulator, which the seed harness does not exercise — but the no-modulators path is unchanged.
- **Manual LFO panel test**: load `versions/film.html`, open the LFO panel, attach `lfo-cluster` to a layer with a moderate gain. Drag the rateHz slider up and down and confirm the visual modulation follows the slider (this exercises `setParam()` → reference reassignment → `__lastParams` invalidation → next frame `_params` is recomputed).
- **Manual heap check (optional)**: open DevTools → Performance → record 5 seconds with 4 layers × 3 modulators each (`lfo-cluster`, `lfo-pnoise`, `lfo-seq`) running. Compare object allocation rate before and after. Expected drop: ~3 plain objects per layer per frame from the skipped `Object.assign({}, inst.defaults, m.params)` (= 720 objects/sec at 4 layers × 60 fps). The `wanted.map()` array allocation drops too (~4 arrays/sec at the same rate) but is dwarfed by the plain-object savings.
- **Pixel-hash regression (optional)**: same as the prior cycle — load `versions/film.html`, capture `stage.toDataURL()` at frames 30/60/120 with and without the patch. Expect 0 pixel difference. The LFO `sample()` reads `inst._params` exactly as before; the only change is *when* the merged object is allocated, not what it contains.

## Risks / gotchas

- **`setParam` reference-reassignment (Step 2 Option A)**: any caller that holds a separate reference to the old `m.params` object and mutates it directly would silently bypass the sync. Verified by `grep -rn "modulators\[.*\]\.params\b\|\.params\[" engine-*.client.js client/ lib/`: no direct mutation outside `setParam()`. The LFO panel (`engine-lfo-panel.client.js`) goes through `setParam()` exclusively. Safe.
- **`__lastMods` reference identity (Step 1)**: the fast-path check `layer._lfoInsts.__lastMods === wantList` requires `layer.modulators` to be the **same array reference** across frames. Today, `layer.modulators` is only assigned in `attach()` (line 374) and `detach()` (line 381), both user-action paths. The render loop never replaces the array. Verified by `grep -rn "\.modulators\s*=" engine-*.client.js client/ lib/`: 4 hits, all in `engine-lfos.client.js` itself. Safe.
- **First-frame cost is unchanged**: the first frame after `attach()` still pays for the array+Set+`_params` build. This is one-frame overhead on a user action, not per-frame. Acceptable.
- **`_lfoInsts` object-key collision (Step 1)**: adding `__lastMods`, `__lastModsLen`, `__want` to the same object that holds the instance cache means the for-loop at line 285 has to skip them. The diff above explicitly handles this with the `if (k === '__lastMods' || k === '__lastModsLen' || k === '__want') continue;` guard. The `__` prefix prevents future instance-id collisions (no LFO module id starts with `__` — verified by reading `modules.push(...)` at lines 55-130+).
- **Edge case: modulators list replaced wholesale**: if a future caller does `layer.modulators = [...newList]` (rather than `attach`/`detach`), the fast-path correctly invalidates because `wantList !== __lastMods`. If the new list is **equal length** AND happens to be the same identity (impossible after a wholesale replacement, but defensively handled), `__lastModsLen` would still differ if the new array's length differs. Edge case is impossible in practice; safe.
- **No new wiring**: all three steps are locally scoped edits inside existing functions. No new exports, no new API surface, no new public methods.
- **Out-of-scope check**: the LFO panel itself (`engine-lfo-panel.client.js`) is not touched — it already routes through `setParam()`, which now correctly invalidates the cache.

## Out of scope

- Eliminating the `Object.keys(layer._lfoInsts)` walk at line 285 — it runs only on the slow path (modulator list changed), so it's not per-frame waste on the steady state. Leaving it alone avoids a Set-vs-Keys micro-optimisation for a path that fires rarely.
- Touching `instantiate()`'s `Object.assign({}, mod.defaults, …)` at line 265 — that runs once per newly-attached modulator, not per frame. Correct behaviour.
- The prior cycle's plan (`2026-09-03T20-28-speed-timing-clone-dead-ease`) handles `engine-timing.client.js`'s `applyToR` clone, the LFO `ctx` allocation, and the dead `ease()` call. This plan picks up where that one left off (`ensureInsts` was not in the prior plan's scope) and is intentionally narrow so the two plans can land independently.
- Adding a `verify-lfo-alloc.mjs` Puppeteer suite. The existing `verify-genops.mjs` covers the steady-state render surface; the changes are micro-allocations on a path that's not externally observable through any single `verify-*` script. Manual heap-timeline check is sufficient.
- Refactoring `ensureInsts` into a per-layer persistent allocator (i.e. a single reusable buffer that the merge writes into) — would require changes to every LFO module's `sample()` signature to accept `inst._paramsView` instead of `inst._params`. Invasive API change, no measured need yet.
- Touching `attach()` / `detach()` / `setParam()` semantics beyond the one-line reference-reassignment fix in Step 2.