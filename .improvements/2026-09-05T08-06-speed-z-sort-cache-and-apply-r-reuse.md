# Cache `Layers.list.slice().sort(z)` and reuse a single `applyR` result object

**Cycle**: 2026-09-05T08-06
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

Two sibling allocations on the main `/engine/` render hot path run every frame even though their inputs are essentially static for the lifetime of a session:

1. `engine.html:4366` (inside `loop(t)`) — `const sorted = Layers.list.slice().sort((a, b) => a.z - b.z)` builds a fresh array and runs `Array.prototype.sort` every RAF tick, once per frame, *for every layer count from 1 to N*. `engine.html:4224` (inside `pickLayer`) does the same `Layers.list.slice().sort(...)` on every pointer event. The variant codemod at `versions/_render-inject.js:189` plants the identical `Layers.list.slice().sort(...)` line into ~19 variant pages.
2. `engine.html:3916-3959` (`applyReactors(layer)`) — called once per layer per RAF from `drawLayer` (engine.html:4052) and again from `pickLayer`/`drawSelection` on pointer events. Each call builds a fresh 8-field object literal `{scale, x, y, rot, opacity, hue, brightness, contrast}`. For a 6-layer scene that's 6 fresh objects per frame on the main engine, plus more on every variant frame.

Layer `z` is only written inside `Layers.add` (engine.html:2750 → 2763) and is monotonically assigned `this.list.length` at add time. There is no `Layers.moveUp`, `Layers.moveDown`, `Layers.reorder`, or runtime `l.z = ` anywhere in the repo (verified via `grep -rnE "\.z\s*=|reorder|moveTo|sortByZ|layers\.sort" engine.html engine-*.client.js versions/* lib/*.client.js`). Layers never mutate z after they're added. So the per-frame sort is pure waste — its result is identical to the result it produced last frame for as long as the same set of layers is on stage.

The fix: (a) maintain a `_sortedZ` cache on the `Layers` object, rebuild only when `Layers.add` / `Layers.remove` flips a dirty bit; (b) have `applyReactors` reuse a single reused scratch object (and have `drawLayer` consume the existing `r` reference, not a fresh allocation path). Same z order, same reactor output, identical paint — zero `slice()` allocations per RAF, zero per-call object-literal allocations from `applyReactors`.

## Why this cycle

- The main `/engine/` render loop is `engine.html:4308-4386`. After audio sampling + smoothing + auto-drift, the loop hits the z-sort at `engine.html:4366` and walks layers in order (`for (const l of sorted) this.drawLayer(l, cx, cx.canvas.width, cx.canvas.height)`). `drawLayer` immediately calls `applyReactors(l)` at `engine.html:4052`. Both allocations fire on the same frame.
- The variant codemod injects the same slice-sort into each variant page via `versions/_render-inject.js:189`. The generated line is `const __render_layers = (typeof sorted !== 'undefined' ? sorted : Layers.list.slice().sort((a,b) => (a.z||0) - (b.z||0)));`. That's 19 variant HTML files (`ls versions/*.html | wc -l` confirmed — see Variant inventory below) plus `engine.html` itself, all running the same per-frame allocation. One cache invalidation rule covers all of them once `Layers.add`/`Layers.remove` is consistent.
- `applyReactors` is one method but it's hit twice per layer per RAF (once from `drawLayer`, once from `drawLayer`'s internal direct calls — see `engine.html:4242 drawSelection` and `engine.html:4227 pickLayer` for the pointer-event path). The variant pages have their own `applyR` functions; those are out of scope for this plan (see Out of scope) — but the pattern (caller-allocated scratch) is documented here so a future cycle can apply it on the variant side too.
- Recent `covered_topics` (per `.improvements/STATE.json`) cover recorder buffers, audio-history, render-cache, LFO/timing allocations, fx postprocess, variants, and the audio sampler. The two topics here — `engine-loop-z-sort-cache` and `applyR-scratch-object-reuse` — are not in the list. Brand new ground.
- The fix is mechanical and tightly scoped to:
  - `engine.html:3916-3959` (applyReactors) — change a `{…}` literal into a `this._scratchR` reused object, mutated in place and returned.
  - `engine.html:2745-2780` (Layers) — add a `_sortedZ` cache field plus a `_zDirty` flag; have `add` and `remove` flip it; have `loop` consume the cache.
  - `engine.html:4224` (pickLayer) — switch to the same cached array (in reverse iteration order, computed lazily).
  - For variants: the codemod at `versions/_render-inject.js:189` would need to switch from `Layers.list.slice().sort(...)` to `Layers._sortedZ || (Layers._sortedZ = Layers.list.slice().sort(...))`. Two lines instead of one, but the allocation drops to zero on the cache hit. A touch-up of `_render-inject.js` re-running the build will refresh the 19 variant HTMLs automatically — but only if the codemod regex matches the *new* template. See Step 4 for the precise template change.

## Goal

`engine.html:loop()` issues zero `Layer.sort` allocations per RAF in steady state; `applyReactors` returns a reference to a single reused scratch object on every call instead of a fresh object literal; the variant frames (via the codemod) consume the same cached sorted array. Net: `2N` allocations per RAF drop to `0` per RAF (for N layers, 2 paths — `loop` z-sort + `applyReactors`), with the same engine behavior.

## Plan

### Step 1 — Cache the sorted-z array on `Layers`

- **Files**: `engine.html` inside the `Layers` object literal at `engine.html:2745`. Specifically the `list` field at `engine.html:2746` and the `add`/`remove` methods at `:2749` and `:2772`.
- **Action**: add three fields to the `Layers` literal at engine.html:2745-2746:

  ```js
  list: [],
  _sortedZ: null,                // cached Layers.list sorted by z (asc); null = needs rebuild
  _sortedZRev: null,             // same, but descending — used by pickLayer (topmost first)
  _zGeneration: -1,              // monotonically incremented by add/remove; -1 forces first build
  ```

  Then in `Layers.add` (engine.html:2749), increment the generation right before `this.list.push(layer)`. In `Layers.remove` (engine.html:2772), increment the generation right before `this.list.splice(i, 1)`. The increments must happen *before* the mutation so the next read sees the new generation.

  Add a small helper to the `Layers` object, right below `remove`:

  ```js
  sortedByZ() {
    // Cached by list generation. Building the array is O(N log N) but
    // N is typically 1-12 layers. We rebuild only when add/remove has
    // flipped _zGeneration since the last call. Both asc and desc are
    // memoised so pickLayer doesn't re-reverse every pointer event.
    const gen = this._zGeneration;
    if (this._sortedZ && this._sortedZGen === gen) {
      return this._sortedZ;
    }
    const asc = this.list.slice().sort((a, b) => a.z - b.z);
    const desc = asc.slice().reverse();
    this._sortedZ = asc;
    this._sortedZRev = desc;
    this._sortedZGen = gen;
    return asc;
  },
  ```

  Do NOT touch `Layers.render()` — that's the DOM-card rebuild and stays as-is.

- **Verify**: launch the engine in Puppeteer (`verify:engine` or its closest relative; if none exists, write a one-off `tools/dev-sort-cache-check.mjs` that imports `Layers` from a headless `engine.html` boot and asserts `_sortedZ !== null` after the first frame, and that adding/removing a layer flips `_sortedZ` invalidation on the next read).

### Step 2 — Switch the RAF loop to consume the cached array

- **Files**: `engine.html:4365-4367`. The block is:

  ```js
  // Draw layers in z order
  const sorted = Layers.list.slice().sort((a, b) => a.z - b.z);
  for (const l of sorted) this.drawLayer(l, cx, cx.canvas.width, cx.canvas.height);
  ```

- **Action**: replace the line at `engine.html:4366` with:

  ```js
  const sorted = Layers.sortedByZ();  // cached by list generation; zero-alloc on the hot path
  for (const l of sorted) this.drawLayer(l, cx, cx.canvas.width, cx.canvas.height);
  ```

  Drop the now-redundant comment or merge it onto the `for (...)` line. Do not touch anything else inside `loop()`.

- **Verify**: `grep -n "Layers.list.slice()" engine.html` must return zero matches inside the main engine file (it will still match the `sortedByZ()` helper itself, which is fine). Run `npm run check:syntax` — the file must remain valid JS.

### Step 3 — Make `pickLayer` consume the descending cache

- **Files**: `engine.html:4223-4239` (`pickLayer`). Current code at `engine.html:4224`:

  ```js
  const sorted = Layers.list.slice().sort((a, b) => b.z - a.z);
  for (const l of sorted) {
  ```

- **Action**: replace that line with:

  ```js
  const sorted = Layers._sortedZRev && Layers._sortedZGen === Layers._zGeneration
    ? Layers._sortedZRev
    : (Layers.sortedByZ(), Layers._sortedZRev);
  for (const l of sorted) {
  ```

  Yes — that one-liner is intentional: it's the same fast-path shape used in `_render-inject.js` style caches (early-return when cache is fresh). An alternative is to add a second helper `Layers.sortedByZDesc()` that mirrors Step 1's `sortedByZ()`; that would be cleaner but requires a 6-line addition. Either is acceptable. Prefer the one-liner if you want to keep the diff small.

- **Verify**: visual smoke: switch the engine to manual-drag mode, drag a layer, confirm `pickLayer` still picks the topmost layer as expected. (`verify:e2e-media-record` exercises drag interactions and would surface any regression in this path; or `tools/dev-picklayer-check.mjs` as a one-off.)

### Step 4 — Update the variant codemod so the rebuild keeps the cache

- **Files**: `versions/_render-inject.js:189` (the line that produces `const __render_layers = ...Layers.list.slice().sort(...)` on each variant).
- **Action**: change the generated line to consume the cache the same way Step 2 does:

  ```js
  const __render_layers = (typeof sorted !== 'undefined' ? sorted : (Layers._sortedZ && Layers._sortedZGen === Layers._zGeneration ? Layers._sortedZ : Layers.sortedByZ()));
  ```

  The `typeof sorted !== 'undefined'` early-out stays — variant scripts sometimes pre-declare their own `sorted` symbol. After the change, re-run the codemod across all variant files. The simplest invocation: `npm run build` (the codemod is wired into the build pipeline per AGENTS.md / vite.config.js) — but the inject passes aren't run by `npm run build` directly; check `engine-genops.client.js` and `versions-presets.js` for the actual codemod dispatcher. Most likely path: `npm run genops` or `node tools/inject-versions.mjs`. If you can't find the dispatcher, edit each variant directly via the same Step-2-style search-and-replace (`grep -n "Layers.list.slice().sort" versions/*.html` returns 19 matches; each is one line).

- **Verify**: after regeneration, `grep -n "Layers.list.slice().sort" versions/*.html` returns zero matches. `grep -n "sortedByZ\|\\._sortedZ" versions/*.html` shows the new pattern. `npm run check:bundle` passes (the bundle script re-parses all the variant HTMLs).

### Step 5 — Refactor `applyReactors` to use a reusable scratch object

- **Files**: `engine.html:3916-3959` (`applyReactors`). The literal at `engine.html:3922` is the only allocation per call.
- **Action**: declare a scratch field on the renderer object (search for `applyReactors` definition at engine.html:3916 and locate the renderer object header — see `engine-render.client.js` for the established pattern, or add the field right above `applyReactors`):

  ```js
  _scratchR: { scale: 0, x: 0, y: 0, rot: 0, opacity: 0, hue: 0, brightness: 0, contrast: 0 },
  ```

  Then rewrite `applyReactors` so that:

  ```js
  applyReactors(layer) {
    const out = this._scratchR;
    const enabled = layer.rotationEnabled !== false;
    out.scale = layer.baseScale;
    out.x = layer.pos.x;
    out.y = layer.pos.y;
    out.rot = enabled ? (layer.pos.rot || 0) + (layer.rotOffset || 0) : 0;
    out.opacity = layer.opacity;
    out.hue = layer.hue;
    out.brightness = layer.brightness;
    out.contrast = layer.contrast;
    if (!enabled) {
      for (const r of (layer.reactors || [])) {
        // …same reactor math as today, writing into out.* instead of out.*…
      }
      return out;
    }
    for (const r of (layer.reactors || [])) {
      // …same reactor math, writing into out.*…
    }
    return out;
  }
  ```

  Critical: callers must consume `out` synchronously. Since `drawLayer` saves `r = this.applyReactors(layer)` then uses `r.opacity`, `r.scale`, `r.hue`, `r.brightness`, `r.contrast` directly inside the same function call, that's already the case. `pickLayer` (engine.html:4227) and `drawSelection` (engine.html:4242) also use `r.x`, `r.y`, `r.scale` synchronously. So a single scratch object is safe — *as long as nothing stores the reference across renders*. Today nothing does. Verify by `grep -nE "applyReactors\(|applyR\(" engine.html versions/*.html` and inspect every call site — each is a local-`const` then a sync use.

  Important: do NOT mutate the return value from `applyReactors` anywhere — `out.hue += ` inside the reactor loop is fine (writes back into the same scratch), but external callers should treat it as read-only. Add a comment at the top of `applyReactors` saying so.

- **Verify**: `grep -nE "applyReactors\(" engine.html` shows 3 call sites (drawLayer, pickLayer, drawSelection). Each reads `r.x` / `r.y` / `r.scale` / etc. synchronously. No mutation across function boundaries. Run `npm run check:syntax`.

### Step 6 — Same scratch pattern for the variant `applyR`s (deferred documentation only)

- **Files**: this is *out of scope* for code changes — see Risks / gotchas. But this cycle should document the pattern so a future cycle (or the user, manually) can apply it to variants.

## Verification

- `npm run check` → syntax + manifest + bundle + api tests pass.
- `npm run check:full` → adds `check:verify` smoke; pass.
- `npm run build` → codemod regenerates the 19 variant HTMLs (Step 4); bundle is byte-identical except in `__render_layers` lines.
- Manual smoke: launch dev server, add 4–6 layers from the library, hit Play, drag a layer, watch console.log-free render with `Layers._sortedZ === Layers.sortedByZ()` (the same reference) on every RAF.
- Puppeteer check via `verify:e2e-media-record` (or its closest relative — see `npm run verify --list` or `ls verify-*.mjs` to pick one that drives the engine through layer add + RAF). Inspect the bundle's `_sortedZGen` field at the last frame to confirm the cache was reused on ≥ 90% of frames (i.e. count RAF frames where `_sortedZ` reference identity matches the previous frame's reference). With steady-state playback and no add/remove during the test, expect 100%.
- For `applyReactors`: log `_scratchR` reference identity at every call from `drawLayer`; expect the same reference across N×frames calls during steady-state playback with no reactor rebuild.

## Risks / gotchas

- **Variant `applyR` functions are NOT touched.** Each variant (`versions/neon.html`, `versions/film.html`, `versions/grid.html`, `versions/smoke.html`, `versions/hallucination.html`, plus the 14 secondary variants listed by `ls versions/*.html`) has its own `applyR(...)` that mirrors the engine's logic but with a different field set (e.g. add `chrome`, `blur`, `glitch`, etc.). Each builds its own `{...}` object literal per call. Fixing them is mechanical but large (each variant is a separate file). Deferred to a follow-up cycle called "scratch-object pool per variant applyR" — Step 6 here only documents the pattern.
- **Variant codemod regex match:** `versions/_render-inject.js:189` produces the generated line. The precise escape sequences in the template matter; a `\.` in the inline-template was a real bug source in prior cycles (see `2026-09-04T08-49-speed-versions-presets-gate.md` in `.improvements/`). When editing the template string, copy the exact escape pattern from the surrounding lines — do not rewrite the entire block.
- **The `_sortedZ` cache assumes `add` and `remove` are the only mutations.** If a future cycle introduces `Layers.moveUp`/`moveDown`/`Layers.reorder`/`Layers.shuffle` (see `_shuffle-inject.js`, `_blend-shuffle.js`), they must increment `Layers._zGeneration`. None of those exist today (verified) but the helper's name communicates the invariant; a brief doc comment is worth it.
- **`pickLayer`'s one-liner in Step 3 reads `_sortedZRev` directly** instead of going through a helper. That's intentional for diff-size reasons, but if a future cycle wraps a helper around it, both consumers (`loop` + `pickLayer`) should route through the helper.
- **Effects of cache thrashing:** if a power-user spams Add+Remove (e.g. `verify:e2e-media-record`'s stress mode), the cache rebuilds every frame. That's still O(N log N) with N ≤ 12 layers — fine. The win is steady-state, where the cache hits are free.

## Out of scope

- Variant `applyR()` refactor (Step 6 is documentation only).
- `Layers.moveUp`/`Layers.moveDown`/explicit reorder UI — not requested, not in scope.
- The `loop()` body's `Layers.list.slice()` at engine.html:4366 (the variant codemod regenerates that line — once `_render-inject.js:189` is patched, the main engine file can be reverted to the cache-consuming line in Step 2).
- `drawPaletteOverlay` cache from `2026-09-05T05-03-speed-palette-overlay-cache.md` (in_flight, not yet integrated) — orthogonal work, ship separately.
- All FX pipeline work (`fx-postprocess.js`, `engine-render.client.js` itself) — recent cycles covered those (`2026-09-04T04-37`, `:06-41`, `:08-49`).
