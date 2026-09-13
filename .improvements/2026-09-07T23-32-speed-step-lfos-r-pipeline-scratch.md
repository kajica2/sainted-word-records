# Reuse a single scratch `r` object across `T.step` + `SWR_LFOS.apply` — drop 2 of 3 per-layer shallow clones per frame

**Cycle**: 2026-09-07T23-32
**Type**: speed
**Priority**: P1
**Estimated effort**: XS

## TL;DR

`SWR_RENDER.frame()` (engine-render.client.js:295-437) builds a fresh `r` three times per layer per frame:

1. `let r = applyR(l)` — engine.html / variant local (out of scope here; covered by 2026-09-05T08-06 engine-applyR-scratch-object).
2. `r = T.step(dt, l, r)` — engine-render.client.js:364 → calls `applyToR()` at engine-timing.client.js:214-222 which shallow-clones via `const out = {}; for (const k in r) out[k] = r[k]`.
3. `r = window.SWR_LFOS.apply(dt, l, r)` — engine-render.client.js:373 → shallow-clones again at engine-lfos.client.js:315-316 (`const out = {}; for (const k in r) out[k] = r[k]`).

Clones #2 and #3 are sequential — neither holds onto the old `r`, neither side-effects the old `r`. The output of clone #2 is the input of clone #3. Replacing both with a single scratch `r` (one `applyR` copy + two in-place mutations) eliminates **two of the three per-layer object allocations per frame** without changing any behavior. With 4-6 active layers at 60Hz this saves **480-720 object allocations/sec**, plus the corresponding `for…in` enumerations (~8 keys each = ~3,840-5,760 key reads/sec).

Same proven scratch-object pattern as cycle 2026-09-05T08-06 (`engine-applyR-scratch-object`) — that plan cached one scratch at the render-frame scope; this plan caches two more in the same scope and rewires the two callers to mutate-in-place.

## Why this cycle

- **Direct cite**: cycle 2026-09-05T08-06 (`engine-applyR-scratch-object`) carved out the third allocation: *"Scratch is allocated at the top of `frame()` and reused for every layer in the loop; engine-timing's `applyToR()` and LFOS `apply()` would need their own scratch passed in (or a per-call out param)."* This is that follow-up.
- **Direct cite**: cycle 2026-09-05T08-06 also carved out the LFOS clone specifically: *"For now, the LFO clone stays as-is (separate cycle)."* This is that separate cycle.
- **Scan evidence**:
  ```
  $ grep -nE "applyToR|out = {}" engine-timing.client.js
  189:      return applyToR(r, tgt);              // short-circuit path
  211:    return applyToR(r, clamped);            // main step path
  218:    const out = {};
  219:    for (const k in r) out[k] = r[k];
  221:    return out;
  $ grep -nE "out = {}|out\[k\] = r" engine-lfos.client.js
  315:    const out = {};
  316:    for (const k in r) out[k] = r[k];
  ```
- **Why the fix is safe**:
  1. The two `out` objects are **pure functions of their inputs** — neither holds a reference to the input `r` beyond the `for…in` clone, neither reads `r` again, neither mutates `r`. Verified by reading both bodies (`engine-timing.client.js:214-222` and `engine-lfos.client.js:309-358`).
  2. Both callers in `frame()` immediately **discard the previous `r`** — `r = T.step(dt, l, r)` then `r = window.SWR_LFOS.apply(dt, l, r)`. Nothing downstream in the same frame reads the intermediate `r`. The loop body's only further use of `r` is `buildVersion(r, …)` at engine-render.client.js:376, which reads the **final** `r` (post-LFO) — unaffected.
  3. The engine-timing short-circuit (line 186-189) returns `applyToR(r, tgt)` **even when already at target** — we still need a fresh scratch in that case so we don't poison `r` (which the caller passed in by reference). Mutation-in-place would change the caller's `r` if the timing module were called by anyone other than `frame()`. So the public `step()` / `apply()` signatures keep returning a new object; we add an internal `_mutate(out, dt, layer, r)` / `_applyMutate(out, dt, layer, r)` pair used only by `frame()`.
  4. `engine.html:4052` (and the per-variant `applyR` bodies) read `r` after `applyR` returns and pass it straight into `T.step(...)`. They don't hold the reference. Confirmed by grepping for any post-`r =` use of `r` outside the render pipeline — none.
- **Adjacent win**: This change also lets `T.step` and `SWR_LFOS.apply` keep their existing public signature (`return out`), so other call sites — if any — stay compatible. The scratch is **per-frame**, owned by `frame()`, and never leaks.
- **Working tree**: `git status --short` shows only root-level PNG deletes (unrelated cleanup), a stray `._static_server.mjs` (Mac metadata), `references/` (untracked dir), and `.improvements/` plan files. `engine-render.client.js`, `engine-timing.client.js`, `engine-lfos.client.js` are clean. No collision with any in-flight plan.

## Goal

After this change, per-frame per-layer allocation count in the engine pipeline is:

- `engine.html.applyR` → 1 (out of scope, unchanged; cycle 2026-09-05T08-06).
- `T.step()` → 0 new allocations (mutates the scratch passed in).
- `SWR_LFOS.apply()` → 0 new allocations (mutates the scratch passed in).

Verifiable as: `grep -c "out = {}" engine-timing.client.js engine-lfos.client.js` returns **1** per file (only inside `_mutate` / `_applyMutate` private helpers, not the public functions), and adding a `console.log` debug counter in `frame()` shows 1 allocation per layer per frame instead of 3.

## Plan

### Step 1 — Add a scratch pair to `engine-render.client.js`

In the `state` object (engine-render.client.js:36-44), add two fields:

```js
// Scratch r objects, owned by frame(), used to eliminate the per-frame
// per-layer shallow clones inside T.step() and SWR_LFOS.apply(). Allocated
// lazily on first use and reused forever (they're plain mutable objects).
_rScratchA: null,
_rScratchB: null,
```

In `frame()` (engine-render.client.js:295), immediately after `state._lastFrameAt = now;` (line 318), add a lazy-init block:

```js
// Hoist scratch allocation out of the per-layer loop. The scratch objects
// are mutated in place by T.step and SWR_LFOS.apply (internal variants),
// so we need TWO: T.step writes into _rScratchA, SWR_LFOS.apply reads
// from _rScratchA and writes into _rScratchB. Final r for buildVersion is
// _rScratchB.
if (!state._rScratchA) state._rScratchA = {};
if (!state._rScratchB) state._rScratchB = {};
```

In the per-layer for-loop (engine-render.client.js:335), replace the current r rebinding:

```js
let r = applyR(l);
// ... swap-pending block ...
if (T && typeof T.step === 'function') {
  r = T.step(dt, l, r);
}
if (window.SWR_LFOS && typeof window.SWR_LFOS.apply === 'function') {
  r = window.SWR_LFOS.apply(dt, l, r);
}
```

with:

```js
let r = applyR(l);
// Copy applyR's fields into the FIRST scratch (applyR's r may be a fresh
// object OR a cached one — we don't own it, so we must copy).
const _sa = state._rScratchA;
for (const k in r) _sa[k] = r[k];
// ... swap-pending block (unchanged) ...
// T.step writes its output into _sa in place. Since step()'s first action
// is to copy r into its own out, we can fold that into a direct mutate:
//   const sa = _sa;
//   if (T && T._stepMutate) T._stepMutate(sa, dt, l, r); else if (T) r = T.step(dt, l, sa);
// For now (simpler, public-API-preserving path): call the existing step()
// and let the caller pass `_sa` as both the r-arg and a hint to mutate.
// (See Step 2 for the API change.)
if (T && typeof T.step === 'function') {
  r = T.step(dt, l, _sa);
}
if (window.SWR_LFOS && typeof window.SWR_LFOS.apply === 'function') {
  // LFOS reads r (now the step result) and mutates it in place into _sb.
  r = window.SWR_LFOS.apply(dt, l, _sa, state._sb);
}
```

Wait — this still has `applyToR` allocating inside `step()` and `apply()`. The simpler, cleaner plan is the one we ship: change `step()` and `apply()` to accept an optional `out` param and mutate it in place when provided.

### Step 1 (corrected) — Add a public `out` parameter to both functions

In `engine-timing.client.js` (the `step()` / `applyToR()` pair at lines 182 / 214):

1. Change `step(dt, layer, r)` to `step(dt, layer, r, out)`.
2. If `out` is provided, copy `r`'s keys into `out` and overwrite `out.opacity` with the computed value; return `out`. Skip the `applyToR()` allocation entirely.
3. If `out` is not provided, fall back to the existing path (call `applyToR(r, …)`) — preserves public API for any external callers.

Concrete change at engine-timing.client.js:182-222:

```js
function step(dt, layer, r, out) {
  if (!layer) return r && r.opacity != null ? r.opacity : 1;
  const cur = layer._currentOpacity;
  const tgt = layer._targetOpacity;
  let clamped;
  if (Math.abs(cur - tgt) < 1e-4) {
    if (cur !== tgt) layer._currentOpacity = tgt;
    clamped = tgt;
  } else {
    // ... existing eased math ...
    const adv = rawStep >= 1 ? 1 : rawStep;
    const dir = goingUp ? +1 : -1;
    const next = cur + dir * (Math.abs(tgt - cur)) * adv;
    clamped = tgt > cur ? Math.min(tgt, next) : Math.max(tgt, next);
    layer._currentOpacity = clamped;
  }
  if (out) {
    // Mutate caller's scratch in place. Caller owns out; r is read-only input.
    for (const k in r) if (k !== 'opacity') out[k] = r[k];
    out.opacity = clamped;
    return out;
  }
  return applyToR(r, clamped);
}

function applyToR(r, opacity) {
  // Unchanged (used only by the no-`out` fallback path now).
  if (!r) return { opacity: opacity };
  const out = {};
  for (const k in r) out[k] = r[k];
  out.opacity = opacity;
  return out;
}
```

In `engine-lfos.client.js` (the `apply()` function at line 309):

1. Change `apply(dt, layer, r)` to `apply(dt, layer, r, out)`.
2. If `out` is provided, copy `r`'s keys into `out` (skipping fields that LFO will overwrite), then run the existing modulator loop writing into `out`, then return `out`.
3. If `out` is not provided, fall back to the existing path.

Concrete change at engine-lfos.client.js:309-358:

```js
function apply(dt, layer, r, out) {
  if (!layer || !layer.modulators || !layer.modulators.length) return r;
  const insts = ensureInsts(layer);
  if (!r) r = {};
  const ctx = { now: () => performance.now(), audio: window.SWR && window.SWR.Audio };
  // If caller didn't pass an out, allocate a fresh one (legacy path).
  if (!out) {
    out = {};
    for (const k in r) out[k] = r[k];
  } else {
    // Mutate caller's scratch in place. r is read-only input.
    for (const k in r) out[k] = r[k];
  }
  for (const spec of layer.modulators) {
    const inst = insts[spec.id];
    if (!inst) continue;
    const v = (() => { try { return inst.sample(dt, ctx); } catch (_) { return 0; } })();
    const gain = typeof spec.gain === 'number' ? spec.gain : 1;
    const t = spec.target || 'opacity';
    switch (t) {
      // ... existing cases, but writing to out ...
    }
  }
  out._v = (r && r._v) || '0';
  return out;
}
```

The `out._v = …` line preserves the engine's `version` computation downstream.

### Step 2 — Wire the call site in `engine-render.client.js`

At engine-render.client.js:335-374, replace the current `r = applyR(l) ... r = T.step(...) ... r = SWR_LFOS.apply(...)` chain with a scratch-reusing version:

```js
for (let i = 0; i < layers.length; i++) {
  try {
    const l = layers[i];
    let r = applyR(l);
    // ... existing swap-pending block (reads l, may invalidate cache) ...
    if (T && typeof T.step === 'function') {
      // T.step mutates _rScratchA in place; subsequent LFOS.apply reads it.
      r = T.step(dt, l, r, state._rScratchA);
    }
    if (window.SWR_LFOS && typeof window.SWR_LFOS.apply === 'function') {
      // SWR_LFOS.apply mutates _rScratchB in place; final r for buildVersion.
      r = window.SWR_LFOS.apply(dt, l, r, state._rScratchB);
    }
    const assetId = l.asset ? l.asset.id : 'none';
    const version = hashVersion(buildVersion(r, assetId, audioHash));
    // ... rest unchanged ...
  }
}
```

Lazy-init the scratches once at the top of `frame()` (after `state._lastFrameAt = now;`):

```js
if (!state._rScratchA) state._rScratchA = {};
if (!state._rScratchB) state._rScratchB = {};
```

**Indentation**: 2-space, single quotes, `const`/`let`, match the existing style in each file. The `{ for (const k in r) out[k] = r[k]; }` block lives at 6 spaces inside the function body of `step()` / `apply()`, exactly like the existing `for…in` clones.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run check:full` passes (adds verify smoke).
- **Allocation counter**: temporarily wrap `applyR` / `T.step` / `SWR_LFOS.apply` in engine.html test harness with `window.__allocR = (window.__allocR || 0) + 1` counters; before this change count 3 per layer per frame; after, count 1 (only applyR). Remove the counter before commit.
- **E2E**: `npm run verify:engine-render` (or whichever existing verify suite covers variants — `verify-film-audio-synthetic.mjs` is the closest proxy if no engine-render-specific suite exists) — visual smoke confirms fade steppers and LFO modulators still move layers correctly. Specifically: enable the LFO panel (`engine-lfo-panel.client.js`), attach an `lfo-cluster` modulator to a layer, observe it still modulates; trigger a crossfade via `engine-timing.client.js` swap, observe the layer still fades smoothly.
- **Regression hunt**: search for any external call to `T.step(...)` or `SWR_LFOS.apply(...)` with positional args — the new optional `out` param is back-compatible so none should break, but log a check: `grep -rnE "T\\.step\\(|SWR_LFOS\\.apply\\(" --include="*.js" --include="*.html"`. Expected hits: only engine-render.client.js (which we changed) and maybe a unit-test stub (none currently exists for these).

## Risks / gotchas

- **Public API back-compat**: the new `out` param is the **last** positional in both functions and is optional. Any caller passing only the original 3 args continues to work via the fallback allocation path. Verified via grep — only the one in-engine call site we changed uses these functions.
- **Iteration order of `for…in`**: in modern V8, `for…in` over a plain object literal returns keys in insertion order. Both clone paths rely on this. Our mutate-in-place versions also use `for…in` to seed `out`, so the iteration order is identical. The subsequent LFO switch-case writes to specific keys (`opacity`, `scale`, `x`, …), so any order-driven side effect would already have manifested in the clone paths.
- **Scratch ownership across layers**: the scratches are reused across all layers within a single `frame()`. That's safe because the loop is **synchronous** — each layer's pipeline completes (including `buildVersion`) before the next layer reads the scratches. `buildVersion(r, assetId, audioHash)` is called inline at engine-render.client.js:376 before the loop advances, so `r` (= `_rScratchB`) is fully consumed.
- **Scratch across frames**: scratches persist across frames. We don't reset them between frames — the `for…in` copy overwrites all keys the input `r` has, and `out.opacity = clamped` (or the LFO switch-case) explicitly sets every field the downstream pipeline reads (`r._v`, `r.opacity`, `r.scale`, `r.x`, `r.y`, `r.hue`, `r.rot`, `r.brightness`, `r.contrast`). If a future contributor adds a new field to the applyR output that's NOT subsequently overwritten by `step()` or `apply()`, it will leak from the previous frame. Mitigation: add a `delete out._unknownField` line in `step()` / `apply()` if this becomes a problem — for now, all observed applyR fields are overwritten. (See engine.html's `applyReactors` source for the full key set: `_v`, `opacity`, `scale`, `x`, `y`, `hue`, `rot`, `brightness`, `contrast` — all 9 are touched by the union of step + LFOS-apply code paths.)
- **Debug visibility**: if a future contributor adds a `console.log(r)` between `T.step` and `SWR_LFOS.apply`, they'll see the post-step state (correct, expected). Between `SWR_LFOS.apply` and `buildVersion`, they'll see the post-LFO state. The `r =` reassignment now reads as a no-op-alloc, which is the point.

## Out of scope

- **`engine.html:applyReactors` and per-variant `applyR`** — that's the first of the three clones (out of scope; covered by cycle 2026-09-05T08-06). Same scratch-reuse pattern would apply there if/when the engine.html applyR is converted, but that's a separate, larger codemod across engine.html + 19 variant files.
- **Replacing the LFOS `out = {}` allocation in the no-`out` fallback path** — kept as-is to preserve the legacy public API. If a future cycle decides to make `out` mandatory, the fallback can be removed.
- **The `applyToR` shallow clone itself** — `applyToR` is unchanged; it's only called from the fallback `step()` path now. If we later remove the fallback (once the public API is fully migrated), `applyToR` becomes dead code and can be removed in a follow-up.