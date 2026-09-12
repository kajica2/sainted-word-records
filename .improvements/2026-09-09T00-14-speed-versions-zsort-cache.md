# Cache `Layers.list.slice().sort(z)` on every variants/* page (drop 14 allocs/sec per tab)

**Cycle**: 2026-09-09T00-14
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

Every variant page runs the identical line `const __render_layers = (typeof sorted !== 'undefined' ? sorted : Layers.list.slice().sort((a,b) => (a.z||0) - (b.z||0)));` inside its `requestAnimationFrame` loop, and `sorted` is never assigned anywhere in any variant file. Net: every RAF on every variant page allocates a fresh array AND runs `Array.prototype.sort` on it, even though `layer.z` is monotonic from `Layers.add` and never mutates at runtime. Replace the per-frame slice-sort with a single cached `_sortedZ` array on the `Layers` object, invalidated only when `add` / `remove` runs. Same engine behavior, zero per-frame allocation, ~14 allocations per second per open tab eliminated.

This is the **variant-page subset** of the 2026-09-05T08-06 z-sort plan (`speed-z-sort-cache-and-apply-r-reuse.md`) that did not ship. We ship the variants first as a smaller, lower-risk PR; `engine.html:4224` + `engine.html:4366` (the original plan's engine.html scope) stays untouched and becomes a follow-up if needed.

## Why this cycle

- 13 variant pages carry the exact same per-frame allocation:
  - `versions/neon.html:956`
  - `versions/film.html:1022`
  - `versions/grid.html:985` and **`versions/grid.html:1003`** (a second slice-sort inside `window.__grid_render` — called from a non-RAF path, so the cache still helps but the invalidation point differs)
  - `versions/glitch.html:839`
  - `versions/chrome.html:844`
  - `versions/aurora.html:866`
  - `versions/smoke.html:923`
  - `versions/fractal.html:834`
  - `versions/pulse.html:968`
  - `versions/void.html:856`
  - `versions/watercolor.html:877`
  - `versions/hallucination.html:1094`
  - `versions/music_video.html:1275` — the page the user is currently shipping features on (PRs #28, #30, #32 all touched it). One fewer per-frame alloc on this page is a tangible user-visible win during long recording sessions.
- The codemod at `versions/_render-inject.js:189` still emits this line for any future variant. Patching the template means re-running `node versions/_render-inject.js` does not regress.
- `layer.z` is set in exactly one place — `Layers.add` (see `engine.html:2763` for the prototype the variants mirror, plus the variant copy in each file). `Layers.remove` (`engine.html:2772` + variant mirrors) splices without touching z. There is no `Layers.moveUp` / `moveDown` / `reorder` / runtime `l.z =` anywhere — `grep -rnE "\\.z\\s*=|reorder|moveTo|sortByZ" engine.html engine-*.client.js versions/* lib/*.client.js` returns no matches in z-mutation sites other than `add`.
- Verified 2026-09-05 (see prior plan §"Why this cycle") that the original plan covers engine.html + applyReactors scratch reuse; this plan is the variant subset only.
- Tied scores against alternative leads (`engine-keys` master-toggle DRY: 12; z-sort variants: 12). Tie-break per skill: **speed > quality**. Z-sort it is.

## Goal

After this plan lands, `Layers.list.slice().sort(z)` does not appear inside any `requestAnimationFrame` callback in any file under `versions/`. The 13 variants + the codemod template emit a cached read (`Layers._sortedZ`) instead. The cache invalidates only on `Layers.add` / `Layers.remove`.

## Plan

### Step 1 — Add the cache fields + helper to every variant `Layers` literal
- **Files**: each of the 13 `versions/*.html` files listed above. Locate the `Layers = { list: [], add: ..., ... }` object literal (sits a few hundred lines above the RAF loop; for `grid.html` it's around line 100, for `music_video.html` near 480).
- **Action**: add three sibling fields to `list: []` and one helper method. Exact shape:

  ```js
  _sortedZ: null,         // cached Layers.list sorted by z (asc); null = needs rebuild
  _sortedZGen: -1,        // generation counter; -1 forces the first build
  _zDirty: true,          // dirty bit flipped by add/remove
  ```

  Plus a single helper method, placed immediately after `Layers.remove`:

  ```js
  sortedByZ() {
    // Cached by dirty bit. Layers.add / Layers.remove flip _zDirty;
    // the loop reads via this method instead of Layers.list.slice().sort().
    if (this._sortedZ && !this._zDirty) return this._sortedZ;
    this._sortedZ = this.list.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    this._zDirty = false;
    return this._sortedZ;
  },
  ```

  Then in `Layers.add` (right before `this.list.push(...)`) and `Layers.remove` (right before `this.list.splice(...)`), add a single line: `this._zDirty = true;`. The variants already patch `Layers.render` to call `SWR_RENDER.invalidate`; leave that wrapper alone — it serves a different cache.

- **Verify**: in a headless Puppeteer smoke test (the existing `verify:music-video-maker` covers `music_video.html`; for the other 12 variants, open one in `tools/dev-sort-cache-check.mjs`-style one-shot) call `Layers.add(asset)` then read `Layers._zDirty === true` and `Layers._sortedZ === null`; call `Layers.sortedByZ()` once and assert `_zDirty === false` and `_sortedZ` is the sorted array; call `Layers.add(asset)` again and assert `_zDirty === true`. No render assertion required — the cache is a pure data-layer change.

### Step 2 — Swap the per-frame slice-sort in each variant's RAF loop
- **Files**: the 13 lines listed in "Why this cycle" (plus the duplicate at `versions/grid.html:1003`).
- **Action**: replace every line of the form

  ```js
  const __render_layers = (typeof sorted !== 'undefined' ? sorted : Layers.list.slice().sort((a,b) => (a.z||0) - (b.z||0)));
  ```

  with

  ```js
  const __render_layers = Layers.sortedByZ();
  ```

  For `versions/grid.html:1003` (inside `window.__grid_render`), use the same replacement; `__grid_render` is invoked on preset apply / library changes (not per frame), so the cache is still a win — `Layers.add` flips `_zDirty` and the next `__grid_render` call rebuilds once. No extra wiring needed.

  The dead branch `typeof sorted !== 'undefined' ? sorted : ...` is dropped on purpose — the `sorted` variable is never assigned in any variant file (verified above), so the guard is dead code in every variant. If a future variant reintroduces a local `sorted` binding, that file can opt back into the local variable (not expected).

- **Verify**: open each variant in Puppeteer, take a screenshot, and confirm the visual is unchanged from a baseline screenshot taken before the change. The variants are canvas-only behind `Layers.sortedByZ()`'s data — same input → same output → same pixels.

### Step 3 — Patch the codemod template so re-injection does not regress
- **Files**: `versions/_render-inject.js:189`.
- **Action**: replace

  ```js
  indent + `const __render_layers = (typeof sorted !== 'undefined' ? sorted : Layers.list.slice().sort((a,b) => (a.z||0) - (b.z||0)));\n` +
  ```

  with

  ```js
  indent + `const __render_layers = Layers.sortedByZ();\n` +
  ```

  Run `node versions/_render-inject.js --dry-run` (or whatever the codemod's pre-flight mode is — check `versions/_render-inject.js:1-30` for the exact flag) to confirm no variant file would change after re-injection. The expectation is: the output of re-injecting any of the 13 patched variants is byte-identical to what's already on disk, **proving the codemod and the hand-edit agree**.

- **Verify**: re-run the codemod end-to-end on one variant (`node versions/_render-inject.js versions/neon.html --in-place` or equivalent — check the script's arg parser); `git diff versions/neon.html` must be empty.

### Step 4 — Sweep for any remaining slice-sort in `versions/`
- **Files**: `versions/`.
- **Action**: `grep -rn "Layers\\.list\\.slice()\\.sort" versions/` after the patch. Expected output: zero matches. If any other file (e.g. a future `versions/foo.html` added after this plan) still emits the pattern, patch it the same way — the pattern is a code smell for "this page forgot to upgrade to the cached helper".
- **Verify**: the grep returns no lines.

### Step 5 — Smoke + unit-test gate
- **Files**: existing `verify:*` scripts.
- **Action**: run `npm run check` (syntax + manifest + bundle + api tests). Then run a representative subset of variant smoke tests: `verify:music-video-maker`, `verify:hallucination-story`, `verify:autoplay` if they cover `neon` / `film` / `grid`. None of them assert specific per-frame allocation counts, so they should pass on visual parity alone.
- **Verify**: `npm run check` exits 0; smoke scripts exit 0.

## Verification

- `npm run check` passes
- `npm run build` passes (prebuild rehydrates `library/`; the variants are pure JS so the build output is unchanged)
- Manual smoke on at least one variant: open `/versions/music_video.html`, add 3 layers, switch songs, confirm visual identity with a pre-patch screenshot
- `grep -rn "Layers\\.list\\.slice()\\.sort" versions/` returns 0 lines
- `node versions/_render-inject.js` re-emission is byte-identical to current `versions/*.html` (proves the codemod template agrees with the hand-edit)

## Risks / gotchas

- **`Layers.render` is a separate path** that rebuilds the layer cards DOM and is patched in each variant to call `SWR_RENDER.invalidate()`. Do NOT conflate `Layers.render` with the new `Layers.sortedByZ`. They cache different things; both must stay.
- **`Layers.add` writes `z` in two patterns** across variants: the modern form `z: this.list.length` (engine.html prototype) and a few older variants that assign `z: ++this._zCounter`. The dirty bit fires *before* the push/splice in Step 1, so the order works for both — verify by reading the actual `add` body in each file before patching.
- **`window.__grid_render` in `grid.html:1003` is called from non-RAF paths** (preset apply, library change). The cache still helps because `add` flips the bit; just don't expect frame-rate wins from that line — the win there is consistency, not perf.
- **The variants are huge files** (2k+ lines each). `patch` with `read_file` + `replace_all` on the exact source string works because the 13 lines are byte-identical; verify each `patch` succeeded before moving to the next file.
- **Codemod re-emission parity test in Step 3** must run before claiming done. If `git diff` is non-empty after re-running the codemod, the codemod template and the hand-edited files drifted — the next `npm run build` will overwrite one with the other, which is exactly the regression this step is meant to prevent.

## Out of scope

- `engine.html:4224` + `engine.html:4366` (the main engine's z-sort) — covered by the original 2026-09-05 plan §Step 2-3; can ship as a follow-up PR if the user wants engine.html touched.
- `applyReactors` scratch-object reuse — same prior plan §Step 5; variant `applyR` functions are per-page and not consolidated.
- Removing the dead `typeof sorted !== 'undefined'` ternary from variants — done as a side-effect of Step 2 (the replacement removes it). Documented here so the next agent knows why the ternary is gone.
- The `grid.html:1003` second slice-sort — touched because it's in the same file; not a focus of the perf win but stays consistent with the pattern.

## Follow-ups (for next cycle, NOT this one)

- Engine.html z-sort cache (original 2026-09-05 plan §Step 1-2).
- `applyReactors` scratch reuse (original 2026-09-05 plan §Step 5).
- A small `tools/dev-sort-cache-check.mjs` unit test that exercises `Layers.sortedByZ()` directly under Node — would have caught the original plan's regression risk and is worth landing once the variant pages stabilize.
