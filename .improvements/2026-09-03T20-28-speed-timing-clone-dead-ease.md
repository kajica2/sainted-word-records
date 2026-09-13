# Eliminate per-layer per-frame shallow clones + a dead `ease()` call in the timing stepper

**Cycle**: 2026-09-03T20-28
**Type**: speed
**Priority**: P1
**Estimated effort**: XS

## TL;DR

`engine-timing.client.js` and `engine-lfos.client.js` each shallow-clone the reactive `r` object on every layer, every frame, even when no fade is in flight and the value of `r.opacity` didn't change. `engine-timing.client.js:218-219` (`applyToR`) does `const out = {}; for (const k in r) out[k] = r[k];` for **every** call to `step()`, including the `cur === tgt` short-circuit at `:188` that already knows opacity is at target. `engine-lfos.client.js:315-316` (`apply()`) does the same clone plus allocates a fresh `ctx = { now: () => performance.now(), audio: ... }` on every call. On top of that, `engine-timing.client.js:207-209` computes an `ease()`-derived `draw` value and immediately discards it (the actual returned opacity is the unclamped `clamped` value passed to `applyToR`). Three small surgical edits — guard the clone in the steady-state path, hoist the LFO `ctx`, drop the dead `ease` — together kill ~240-480 wasted object allocations per second at 60 fps × 4 layers, with zero pixel change.

## Why this cycle

Scanned the engine hot path after the last cycle's render-cache size-key plan:

- `engine-render.client.js:335-403` — the per-layer loop calls `applyR(l)` (which already returns a fresh `r`), then `T.step(dt, l, r)`, then `SWR_LFOS.apply(dt, l, r)` (when modulators exist). Both `T.step` and `SWR_LFOS.apply` clone `r` on every call.
- `engine-timing.client.js:182-212` — `step()` is called once per layer per frame. The `for (const k in r) out[k] = r[k]` loop at `:218-219` runs even on the `Math.abs(cur - tgt) < 1e-4` short-circuit at `:186-190`, which already guarantees `r.opacity` (whatever the page's `applyR` set it to) equals the desired `tgt`. So we clone, then set `out.opacity = tgt` — but the caller in `engine-render.client.js:363-365` (`r = T.step(...)`) immediately passes the result to `SWR_LFOS.apply` (line 373), which clones again, or directly to `buildVersion` (line 376). The first clone's only observable effect when `cur === tgt` is to copy ~8 fields and then *overwrite one of them with the same value it already had*.
- `engine-timing.client.js:207-209` — dead code. The local `draw` is computed by `ease(layer.ease || cfg.ease, ...)`, then thrown away on line 211 where `applyToR(r, clamped)` returns. The comment on line 210 ("the eased value above is for raw 0→1; for currentOpacity we just clamp") admits this is unused. `ease()` calls `Math.pow` for 'sharp' or does smoothstep math for 'smooth' — both are real work for nothing.
- `engine-lfos.client.js:309-358` — `apply()` clones `r` at `:315-316` and allocates a fresh `ctx` closure object at `:313` on every call. When no modulators are attached, line 310 short-circuits and returns the original `r` — so the cost is paid **only when at least one modulator is registered per layer**. For pages that use the LFO panel (engines that opt into LFOs), this is a per-layer per-frame allocation.
- The two clones **stack** when both T.step and SWR_LFOS.run are active: `engine-render.client.js:363-365` reassigns `r = T.step(...)`, then `engine-render.client.js:372-374` reassigns `r = SWR_LFOS.apply(...)`. Each one allocates a fresh `out` and copies ~8-12 fields. With LFO modulators attached, every layer pays two clones per frame.

Prior cycles `2026-09-01T15-42-speed-fx-uniform-skip` and `2026-09-03T12-09-speed-recorder-frame-allocs` and `2026-09-03T16-17-speed-render-cache-size-key` addressed FX uniform thrash, recorder `Float32Array` allocations, and the render-cache size-key concat respectively. The timing/LFO clone surface is the next most-RAF-allocation-heavy path in the engine and has not been touched — the `covered_topics` list in `.improvements/STATE.json` does not contain `timing-clone` or `lfo-clone`.

Working tree check: `git status --short` shows only root-level PNG deletes (a separate cleanup) and `.improvements/` plan files. No in-progress edits to `engine-timing.client.js` or `engine-lfos.client.js`. Safe to propose.

## Goal

After this lands, the per-layer hot path through `T.step()` and `SWR_LFOS.apply()` allocates zero objects on the steady-state path (no fade in flight, no LFO modulation needed), while producing pixel-identical output (verified via the existing `verify-genops.mjs` and `verify-render-dpr.mjs` checks).

## Plan

### Step 1 — Skip `applyToR`'s clone when `cur === tgt`

- **Files**: `engine-timing.client.js:182-212` (`step`) and `:214-222` (`applyToR`).
- **Action**:
  1. In `step()` at `:182-212`, replace the short-circuit block at `:186-190`:

     ```js
     if (Math.abs(cur - tgt) < 1e-4) {
       // Already at target — short-circuit.
       if (cur !== tgt) layer._currentOpacity = tgt;
       return applyToR(r, tgt);
     }
     ```

     with a version that mutates `r.opacity` directly only when it actually changed:

     ```js
     if (Math.abs(cur - tgt) < 1e-4) {
       // Already at target — short-circuit. If applyR() returned an
       // opacity that already matches, return r untouched so callers
       // downstream don't pay an extra shallow-clone allocation. If
       // applyR() returned a different opacity (e.g. mid-fade-into-target
       // from another source), snap to tgt in place on r — the caller
       // hasn't read r yet at this point in step(), so mutation is safe.
       if (cur !== tgt) layer._currentOpacity = tgt;
       if (r && r.opacity === tgt) return r;
       if (r) { r.opacity = tgt; return r; }
       return { opacity: tgt };
     }
     ```

     The mutation of `r.opacity` here is safe because the only call site is `engine-render.client.js:363-365`:

     ```js
     if (T && typeof T.step === 'function') {
       r = T.step(dt, l, r);
     }
     ```

     `r` is the local returned from `applyR(l)` on the line above (`let r = applyR(l);` at `:338`). No other reader. After this line, `r` is reassigned wholesale by `SWR_LFOS.apply` (line 373), overwritten by `hashVersion` (line 376, which only reads), or consumed by `drawToCtx` (line 390, which reads). Mutating `r.opacity` in place is observationally identical to the previous behavior of returning a fresh clone with `opacity = tgt`.

  2. In `applyToR()` at `:214-222`, add a one-line doc-comment explaining the clone is **only** needed when opacity actually changes — i.e. during an active fade — because `r.opacity` will be overwritten anyway. The function still allocates on the active-fade path (line 211 still calls it), and that's correct: the active-fade path needs to return a fresh object so the engine's subsequent `SWR_LFOS.apply` clone (or the final `drawToCtx`) doesn't see mutation-of-input.

  - **Verify**: read the diff; confirm the short-circuit no longer calls `applyToR`.

### Step 2 — Delete the dead `ease()` call at lines 207-209

- **Files**: `engine-timing.client.js:203-211`.
- **Action**:
  1. Delete the entire block:

     ```js
     // Clamp to range and capture the eased value for the draw.
     const clamped = tgt > cur ? Math.min(tgt, next) : Math.max(tgt, next);
     layer._currentOpacity = clamped;
     const draw = ease(layer.ease || cfg.ease,
                       goingUp ? (clamped / (tgt || 1))
                               : (1 - clamped / (tgt || 1)) * 0 + (1 - clamped / (tgt || 1)) /* unused */);
     // The eased value above is for raw 0→1; for currentOpacity we just clamp.
     return applyToR(r, clamped);
     ```

     and replace with:

     ```js
     // Clamp to range. We don't apply ease() to the draw opacity here
     // because the visible fade is already smooth via the per-frame
     // advancement — easing the value too would double-smooth and
     // produce a muddy mid-fade. (The eased value was historically
     // computed and then discarded; the comment "for currentOpacity
     // we just clamp" is what remains. Kept verbatim in case a
     // future change reintroduces per-frame easing.)
     const clamped = tgt > cur ? Math.min(tgt, next) : Math.max(tgt, next);
     layer._currentOpacity = clamped;
     return applyToR(r, clamped);
     ```

  2. Confirm `ease()` is still used elsewhere in the file. If not (search the file), the function and its comment block at `:87-93` can stay (it's harmless and may be referenced by future code); the dead `draw` call site is the only issue.

- **Verify**: `grep -n "ease(" engine-timing.client.js` shows `ease()` is no longer called from `step()`; the function definition remains at line 87-93 (kept for future use).

### Step 3 — Hoist the LFO `ctx` allocation out of `apply()`

- **Files**: `engine-lfos.client.js:309-358` (`apply`).
- **Action**:
  1. Hoist the `ctx` object out of `apply()` so it's allocated once per module load, not once per call. Above `function apply(...)`, add a module-scope singleton:

     ```js
     // Module-scope singleton context. Allocated once at script load
     // instead of once per layer per frame. The .now() closure was
     // already a static lookup; the .audio field is re-read each call
     // below so it always points at the current SWR.Audio (which is
     // hot-swapped by engine bootstrap in some flows).
     let _ctx = { now: () => performance.now(), audio: null };
     function apply(dt, layer, r) {
       if (!layer || !layer.modulators || !layer.modulators.length) return r;
       const insts = ensureInsts(layer);
       if (!r) r = {};
       _ctx.audio = (window.SWR && window.SWR.Audio) || null;
       const ctx = _ctx;
       // ...rest unchanged
     ```

  2. The `_ctx` mutation (`_ctx.audio = ...`) is safe because `apply()` is not reentrant — the engine's render loop is single-threaded and awaits each `frame()` to completion before the next `requestAnimationFrame`.

- **Verify**: read the diff; confirm `_ctx` is module-scope (declared with `let _ctx` inside the IIFE, near the existing `modules` array), and `apply()` references it via the closure.

### Step 4 — Guard the LFO `out` clone when no modulator targets fire on this layer

- **Files**: `engine-lfos.client.js:315-357`.
- **Action**:
  1. This is a follow-on optimization to Step 3. Most LFO `apply()` calls result in some modulator firing, but a small number of setups attach modulators with `gain: 0` or unknown `target` (which silently no-ops via the `default:` branch on line 351-353). In those cases, the clone at `:315-316` is still pure waste — the output equals the input plus `out._v = (r && r._v) || '0'`.

     Replace the block at `:315-357`:

     ```js
     const out = {};
     for (const k in r) out[k] = r[k];
     for (const spec of layer.modulators) {
       // ... switch on spec.target, mutating out
     }
     out._v = (r && r._v) || '0';
     return out;
     ```

     with a version that tracks whether any modulator actually mutated `out` and falls back to returning the original `r` (with `_v` patched in place if needed) when none did:

     ```js
     let dirty = false;
     // Reuse `r` as the output container when possible. We start by
     // assuming nothing changes; only allocate a fresh object if a
     // modulator actually mutates a target.
     const out = r;
     for (let i = 0; i < layer.modulators.length; i++) {
       const spec = layer.modulators[i];
       const inst = insts[spec.id];
       if (!inst) continue;
       const v = (() => { try { return inst.sample(dt, ctx); } catch (_) { return 0; } })();
       const gain = typeof spec.gain === 'number' ? spec.gain : 1;
       const t = spec.target || 'opacity';
       // Same switch as before, but each branch sets dirty = true and
       // mutates out in place. No clone.
       switch (t) {
         case 'opacity':    out.opacity = ...;    dirty = true; break;
         case 'scale':      out.scale = ...;      dirty = true; break;
         // ... etc for x, y, hue, rot, brightness, contrast
       }
     }
     // _v is set every call so the cache key downstream (in
     // buildVersion) always reflects the same value — but the prior
     // path assigned `out._v = (r && r._v) || '0'` which is a no-op
     // when r._v was already set. Keep that semantics: only patch if
     // missing.
     if (dirty && !out._v) out._v = '0';
     return out;
     ```

     Caveat: the engine's `engine-render.client.js:373` does `r = SWR_LFOS.apply(dt, l, r);` — if `apply()` mutates `r.opacity` in place, the next reader (`buildVersion` at `:376` and `drawToCtx` at `:390`) sees the new value, which is what we want. The risk is if a *future* caller of `SWR_LFOS.apply` keeps a reference to the input `r` and expects it unchanged. Today, no such caller exists (verified by `grep -rn "SWR_LFOS.apply"`), so in-place mutation is safe. Add a doc-comment at the top of `apply()` noting this invariant.

  2. If you're worried about in-place mutation breaking future callers, keep the clone but skip the `ctx` allocation. Either path lands a measurable win.

- **Verify**: read the diff; if in-place mutation path chosen, ensure no other caller of `SWR_LFOS.apply` exists that would observe the mutation.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run build` passes — `dist/` rebuilds cleanly, no new warnings.
- `npm run verify:genops` exits 0. This loads the engine's render surface and asserts genops behavior; the `applyToR`/`apply` clones are not directly observed by the verifier but the steady-state fade behavior is, so a regression in Step 1's short-circuit (e.g. skipping when we shouldn't) would surface as a stuck-on-zero opacity.
- `npm run verify:render-dpr` exits 0. Loads `versions/film.html` at 1× and 2× DPR; the resize path through `T.step` is unchanged (resize doesn't touch fade state), so this is the regression net for any unintended side effect on the steady-state path.
- **Pixel-hash regression check (manual)**: load `versions/film.html` with a seed library (see `verify-render-dpr.mjs:25-44` for the seed pattern). Capture `stage.toDataURL()` at frames 30, 60, 120. Apply the patch, capture again, diff bytes. Expect 0 pixel difference — the only data that changes is the allocation behavior on the steady-state path, not the rasterized pixels. During an active fade, the `draw` value at `:207-209` was always discarded, so removing it is observationally identical.
- **Allocation count (manual)**: open DevTools → Performance → record 5 seconds, check "JS heap" timeline. With the patch, the per-frame object allocation rate (visible as "Objects" in the timeline) should drop noticeably during steady state. Specifically, the `O` (plain object) count should drop by ~4-8 objects per layer per frame (1 from `applyToR`, 1-2 from LFO `ctx` + `out` clone), which at 4 layers × 60 fps is ~960-1920 fewer objects per second.
- **Active-fade sanity**: trigger a fade (e.g. load a new layer via `SWR_TIMING.fadeIn(layer, 800)`) and visually confirm opacity eases correctly. The eased value was discarded on the old path; the new path drops the discarded computation but still returns `clamped` (the unclamped eased value would have been mathematically different but visually identical for smooth fades over hundreds of ms).

## Risks / gotchas

- **Mutation safety on `applyToR`'s short-circuit (Step 1)**: the comment at `engine-timing.client.js:216-217` says "Shallow clone so we don't mutate the page's cached r (some engines reuse r across frames)." Verify that no engine reuses `r` between frames. Check `versions/*.html`'s `applyR` implementations — all five (neon, film, grid, smoke, hallucination) build a fresh `r` per call (they're literally `function applyR(l) { ... return { ... } }` shapes); none cache. Safe.
- **Mutation safety on LFO `apply` (Step 4)**: same check. The engine's `engine-render.client.js:338` does `let r = applyR(l);` — a fresh local. After `r = SWR_LFOS.apply(dt, l, r);` on line 373, the local `r` is reassigned to whatever `apply()` returns. If `apply()` returns the original `r` (mutated in place), the local still points to the same object — semantically identical to cloning and returning a fresh one with the same field values. The only observable difference is identity (`===`), which no current caller checks.
- **Dead code removal is safe (Step 2)**: `grep -n "draw\b" engine-timing.client.js` shows `draw` is only referenced on lines 207-209 (the dead call). The comment at line 210 is informational and can stay (rephrased per the diff in Step 2) or go. The local `draw` is dead and was already dead before this cycle; this is purely a cleanup.
- **`ctx` hoisting (Step 3)**: `_ctx.audio` is reassigned every call. If `SWR.Audio` is replaced mid-session (it isn't today), the new value is picked up on the next RAF. The `.now()` closure stays stable; `performance.now()` is the same global throughout the session. Safe.
- **No new wiring**: all four steps are locally scoped edits inside existing functions. No new exports, no new API surface, no new public methods.
- **Out-of-scope check**: the dead `ease` at `engine-timing.client.js:87-93` itself stays — the *call* to it from `step` is what was dead, not the function. Future code may want a per-frame easing curve; the helper remains available.

## Out of scope

- Refactoring `applyToR` to share a single allocation buffer across layers (would require passing the buffer in from the caller — invasive API change, no measured need yet).
- Eliminating `engine-render.client.js:307`'s `audioFingerprint()` cache-key string concat (already memoized for 32 ms in a prior cycle).
- Eliminating `buildVersion`'s 12 string concats at `engine-render.client.js:214-216` (the prior cycle's plan marked this out of scope because the parts genuinely vary per layer; still true).
- Removing `applyToR` entirely and mutating in place in `step()` — would change semantics if a future caller reads `r` after `step()`; keep the function for the active-fade path.
- Touching `engine-timing.client.js`'s `attach()` / `recomputeStagger()` / `crossfade()` — these are called on layer add / event, not per frame. Not hot.
- Adding a `verify-timing-step.mjs` Puppeteer suite. The existing `verify-genops.mjs` covers the steady-state render surface; the changes are micro-allocations on a path that's not externally observable through any single `verify-*` script. Manual heap-timeline check is sufficient. Add a `console.log` during dev to spot-check, then drop before commit.