# Wire `state.activeBudget` into the frame loop (or delete it as dead code)

**Cycle**: 2026-09-08T05-40
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

`engine-render.client.js` declares `state.activeBudget` (line 42) and exposes a `setActiveBudget(n)` setter (line 452) — but the value is **never read anywhere**. The comment on line 12 documents a "top-N layers by audio energy never cached" policy, but the frame loop (line 377) only consults `state.activeSet` (a static allowlist of layerIds). Either wire `activeBudget` into the per-frame cache decision so the docstring matches reality (real perf win: ~1 offscreen render per layer per frame for the highest-energy layers on every frame where the static layer wouldn't otherwise miss), or delete the dead state. Since `setActiveBudget` is also never called from any page or inject script, the highest-confidence move is **wire it up** — turning a documented-but-dormant feature into a measurable render-path win — and have `versions/_render-inject.js` default the budget based on the engine's layer count.

## Why this cycle

The header comment at `engine-render.client.js:11-13` reads:

> The "active" set (top N layers by audio energy) is never cached, so per-frame motion never serves a stale blit.

That claim is half-implemented:

- `state.activeSet` (declared `:41`, consumed at `:377`, settable via `setActiveSet(ids)` at `:451`) is a *static allowlist* of layerIds — engines must register which layers should always redraw. A scan of all `.js` and `.html` files (`grep -rn "setActiveSet\|activeSet" --include="*.js" --include="*.html" .`) finds **zero call sites** that invoke `setActiveSet`. The field exists; nothing populates it.
- `state.activeBudget` (declared `:42`, settable via `setActiveBudget(n)` at `:452`) is meant to be the *dynamic top-N* the docstring describes. Its setter is also **never called from any source file**.

Net result: every layer goes through the `getCached()` / `setCached()` path on every frame, and the only thing that forces a miss is the cache key changing (asset swap, reactor edit, fade transition, audio fingerprint change, resize). For engines with many audio-reactive layers whose reactors *change every frame* (e.g. any reactor that uses `r.scale = 1 + f.bass * 0.3`), the cache misses every frame and we eat a `OffscreenCanvas` alloc + `drawToCtx` call for every layer every frame — exactly the cost the "active budget" was supposed to prevent.

This is a sleeping landmine from the P3.2 perf pass (`d755465 feat(perf): P3.2 render loop optimizations`). The comment described an end state that never landed; the worktrees branch `feat-auto-20260908-4ba8247d` has the same dead code, so the issue would persist across merge.

## Goal

Either remove `state.activeBudget` + `setActiveBudget` cleanly, or wire them so that on every frame, up to `state.activeBudget` layers (ranked by instantaneous audio energy from `SWR.Audio.feat`) skip the cache check and re-render unconditionally — turning the documented "top N by audio energy is never cached" guarantee into actual behavior.

Recommended: wire it up. It's a small S-effort change with a measurable win on engines that have ≥3 audio-reactive layers, and it preserves the public API the comment promised.

## Plan

### Step 1 — add the audio-energy ranking to `frame()`

- **Files**: `engine-render.client.js:295-414` (the `frame()` function body)
- **Action**: Before the per-layer loop, capture a snapshot of the audio features once per frame:
  ```js
  const _af = (window.SWR && window.SWR.Audio && window.SWR.Audio.feat) || {};
  // Cheap composite "energy" — same axes the existing audio fingerprint already reads.
  const _energy = (_af.bass || 0) * 1.2 + (_af.mid || 0) * 0.9 + (_af.treble || 0) * 0.6 + (_af.rms || 0) * 0.8;
  const _useActiveBudget = state.activeBudget > 0 && layers.length > 1;
  ```

  Inside the per-layer loop (right after `const l = layers[i];` at `:337`), compute a per-layer energy proxy. The cheapest signal that already lives on the layer after `applyR()` is the magnitude of the reactor output: `Math.abs(r.scale - 1) + Math.abs(r.x) + Math.abs(r.y) + Math.abs(r.rot) + Math.abs(r.hue) / 360`. Layers with a reactor that returns near-baseline values (no audio motion) are good cache candidates; layers whose reactors have moved meaningfully since last frame are the "active" ones.

  Concretely:
  ```js
  let activeForce = state.activeSet.has(l.id) || state.dirty;
  if (_useActiveBudget && !activeForce) {
    // Reactor "motion magnitude" — a fast proxy for "this layer is audio-reactive right now".
    const m = Math.abs((r.scale || 1) - 1) * 2
            + Math.abs(r.x || 0) + Math.abs(r.y || 0)
            + Math.abs(r.rot || 0) / 6
            + Math.abs(r.hue || 0) / 360;
    l._motion = m;
  }
  ```
  After the loop, build a sorted index of the top N motion layers and force-redraw them on subsequent frames. Simpler approach: instead of post-loop sorting, use a counter that increments per "active" decision and decays. Even simpler: **skip this and use a per-layer sticky counter** (see Step 2).

### Step 2 — sticky-decay implementation (recommended)

- **Files**: `engine-render.client.js:42`, `engine-render.client.js:377`
- **Action**: Replace the static `state.activeSet` check at `:377` with a sticky-decay policy:
  ```js
  // state.activeBudget layers are kept "warm" — they re-render every frame
  // for ~`decayFrames` after their reactor's motion magnitude crosses the
  // threshold. The top-N selection is stable across frames (no sort alloc).
  const force = state.activeSet.has(l.id) || state.dirty
              || (state.activeBudget > 0 && (l._forceFrames | 0) > 0);
  if (force && !state.activeSet.has(l.id) && !state.dirty) {
    l._forceFrames = (l._forceFrames | 0) - 1;
  }
  ```
  Then in the post-loop settle step (after the `for` ends), pick this frame's top-N motion layers and bump their `_forceFrames`:
  ```js
  if (_useActiveBudget && layers.length > 1) {
    // One pass: find the top-N motion values without allocating a sorted array.
    // Threshold = (top-N-th motion value) so only layers above the median
    // get bumped. Cheap and stable across frames.
    let n = Math.min(state.activeBudget, layers.length - 1);
    let cutoff = 0;
    for (let i = 0; i < layers.length; i++) {
      const m = layers[i]._motion || 0;
      if (m > cutoff) {
        if (n <= 0) { cutoff = m; break; }
        cutoff = m; n--;
      }
    }
    const decayFrames = 6; // ~100ms at 60fps; long enough to outlast a single beat
    for (let i = 0; i < layers.length; i++) {
      if ((layers[i]._motion || 0) >= cutoff) layers[i]._forceFrames = decayFrames;
    }
  }
  ```
  Wire it together with a tiny top-N extractor. The above is intentionally allocation-free (no `sort`, no `slice`, no temporary arrays — only scalar compares). The "top-N via repeated max" is O(N·activeBudget), which is fine since both are tiny (≤8 each).
- **Verify**: after a beat hit on a 4-layer engine with `activeBudget=2`, exactly the 2 highest-motion layers miss the cache on that frame and the next ~5 frames; the other 2 hit the cache. Open DevTools Performance, record 10 seconds with audio playing, count `OffscreenCanvas` allocations before/after.

### Step 3 — default the budget from the inject script

- **Files**: `versions/_render-inject.js:140-180` (the cache + frame rewrite block)
- **Action**: After the `SWR_RENDER.frame` rewrite, default the budget to the engine's layer count, capped at half the layer count (so at least half the layers stay cached in steady state):
  ```js
  try {
    const layers = (window.SWR && window.SWR.layers) || [];
    const budget = Math.max(0, Math.min(4, Math.ceil(layers.length / 2)));
    if (typeof SWR_RENDER.setActiveBudget === 'function') SWR_RENDER.setActiveBudget(budget);
  } catch (_) {}
  ```
  Place this after the RAF / frame rewrite so `SWR_RENDER` is guaranteed to exist. Skip the call if `layers.length < 2` (single-layer engines always cache).
- **Verify**: open `versions/neon.html` (4 layers) in DevTools, type `SWR_RENDER.cacheSize` in console — should be ~2-3 (was ~0 because every reactor moves every frame and invalidates the key). On a beat, `cacheSize` should briefly drop to 0 then refill.

### Step 4 — guard the unused `activeSet` (or delete it)

- **Files**: `engine-render.client.js:41,451`
- **Action**: `state.activeSet` and `setActiveSet()` are still useful as an explicit override (a page might want to mark specific layerIds as always-redraw regardless of audio energy). **Keep them**. No code change needed — just confirm they're not orphaned by reading the comment at `:41` and ensuring it still makes sense. The header comment at `:11-13` should be updated to mention both mechanisms:
  > The "active" set (either an explicit `setActiveSet(ids)` allowlist OR the top `activeBudget` layers by per-frame reactor motion magnitude) is never cached, so per-frame motion never serves a stale blit.

### Step 5 — alternative: delete the dead code

- **Files**: `engine-render.client.js:42,452`
- **Action**: If Step 1-3 is judged too speculative (the audio-energy heuristic might mis-rank layers for some engines and cause visual regressions), the conservative move is to delete `state.activeBudget` and `setActiveBudget()`. This is purely subtractive — `setActiveBudget` has zero callers, so the only "API break" is theoretical.
- **Verify**: `grep -rn "setActiveBudget\|activeBudget" --include="*.js" --include="*.html" .` returns zero matches after the delete.

## Verification

- `npm run check` passes (no syntax errors, no API callers broken since the public surface stays the same in Step 1-3)
- `npm run build` passes
- `npm run verify:render-dpr` passes (no regression on the existing perf-correctness E2E)
- `npm run verify:genops` passes (no regression on the mutator flows that exercise the cache key)
- Manual: open `versions/neon.html`, attach DevTools Performance, record 10 seconds with audio. Expected: `OffscreenCanvas` allocation count drops by ~50% (top 2 of 4 layers were hitting the cache path but cache-key-changing every frame forced a redraw). `SWR_RENDER.cacheSize` console read should be ~2 instead of 0 on a steady-state beat.
- `grep -rn "setActiveBudget\|state\.activeBudget" engine-*.client.js engine.html versions/ lib/ api/ auth/ client/ .` — confirm the new call site in `_render-inject.js` is the only place it changes.

## Risks / gotchas

- **Stale-motion false positives**: a layer whose reactor returns `r.scale = 1 + 0.001 * f.bass` (very low motion but nonzero) will still trip the top-N cutoff if all other layers are equally quiet. Visual regression risk: low — a layer that *barely* moves caching vs not caching is visually indistinguishable.
- **Reactor drift across frames**: if a layer's reactor returns a wildly different magnitude frame-to-frame (e.g. one frame is 0.1, next is 1.5 due to a beat), the top-N selection could flip rapidly, causing 1-frame cache thrash. Mitigation: the sticky-decay (`_forceFrames`) ensures once a layer is "active" it stays so for ~100ms — long enough to outlast a single-beat reactor spike. Audit `engine.html` reactors at `:4342` (the `Audio.feat.beat` driven rot kick) — that's exactly the kind of spike this protects against.
- **`activeBudget` public API surface**: keeping the setter even though it's now driven internally is fine — pages might still want to override (e.g. zero the budget on a static-logo engine). Don't remove `setActiveBudget()` from `window.SWR_RENDER` even if Step 4 is taken (i.e. don't delete `activeSet`).
- **Worktree divergence**: `.worktrees/feat-auto-20260908-4ba8247d/engine-render.client.js` is a separate checkout that mirrors the current main. The fix should land in both — if a follow-up agent applies this in main, the worktree will need a rebase or a parallel apply. Mention it in the commit message.
- **Audio feature timing**: `SWR.Audio.feat` is read once per frame (cheap), but `r` is computed inside the loop *after* `applyR()`. The motion magnitude uses `r` directly (not `_af`), so the ranking is per-layer-correct — no risk of cross-frame ordering issues.

## Out of scope

- Changing the cache key structure (`buildVersion`, `hashVersion`) — those are separately optimized by the prior `.improvements/2026-09-08T03-38-speed-render-version-hash-numeric.md` plan.
- Adding audio-energy ranking to engines that already use `activeSet` (none currently do, but if they did, this would be additive).
- Touching `engine-timing.client.js` or `engine-lfos.client.js` — the `activeBudget` lives entirely in `engine-render.client.js`'s frame loop and the per-layer `r` it computes.
- Adding a UI control for `activeBudget` — out of scope; the inject script picks a sensible default.
