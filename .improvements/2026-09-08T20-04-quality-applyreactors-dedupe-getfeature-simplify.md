# Dedupe `engine.html:applyReactors` reactor dispatcher; simplify dead `getFeature` branches

**Cycle**: 2026-09-08T20-04
**Type**: quality
**Priority**: P1
**Estimated effort**: XS

## TL;DR

`engine.html:3916-3959` (`Renderer.applyReactors`) has its reactor-target dispatcher **duplicated almost verbatim** between the `!enabled` (lines 3934-3944) and `enabled` (lines 3947-3958) branches — an 11-line if/else chain that differs in exactly **one line** (`else if (r.target === 'rot') out.rot += v;` at line 3953 vs absent in the disabled branch). The two branches also share the same `getFeature(r)` and `ease(r.ease, clamp(...))` lines (3935-3936 / 3948-3949). Collapse into one reactor loop with the rot-line gated inline. While there, the adjacent `getFeature` helper at `engine.html:3903-3909` has three branches that all return the same expression as the fallback — the function reduces to a one-liner. Both sites are in the engine's per-layer per-frame hot path (`engine.html:4367` calls `drawLayer` which calls `applyReactors` at `:4052`), so the dedupe shaves work from a called-every-frame code path AND removes a near-future bug magnet (any new reactor target must be added to two places today — exactly the parity-test smell flagged in the skill spec). Existing `verify-rotation-enabled.mjs` covers both branches; passes unchanged.

## Why this cycle

**Scan evidence** (Phase 2):

- **`engine.html:3934-3944` vs `engine.html:3947-3958`** — the two `for (const r of (layer.reactors || []))` loops in `applyReactors`. Side-by-side:
  ```js
  // !enabled branch (lines 3934-3944):
  for (const r of (layer.reactors || [])) {
    let v = this.getFeature(r);
    v = this.ease(r.ease, clamp(v, 0, 1)) * r.scale;
    if (r.target === 'scale') out.scale += v;
    else if (r.target === 'x') out.x += v;
    else if (r.target === 'y') out.y += v;
    // (no rot line)
    else if (r.target === 'opacity') out.opacity = clamp(out.opacity + v, 0, 1.5);
    else if (r.target === 'hue') out.hue += v;
    else if (r.target === 'brightness') out.brightness = clamp(out.brightness + v, 0.1, 2.5);
    else if (r.target === 'contrast') out.contrast = clamp(out.contrast + v, 0.1, 2.5);
  }
  // enabled branch (lines 3947-3958): identical except adds
  //   else if (r.target === 'rot') out.rot += v;
  ```
  Eleven lines copied; one differs. The skill spec's anti-pattern table calls this out explicitly ("parity test as a permanent regression gate ... ship the dedup").
- **`engine.html:3903-3909` `getFeature`** — three branches that all do `return raw;`:
  ```js
  getFeature(react) {
    const s = this.smooth;          // ← unused after the if-chains
    const raw = Audio.feat[react.feature] ?? 0;
    if (react.feature === 'beat' || react.feature === 'onset') return raw; // already 0..1 envelope
    if (react.feature === 'centroid') return raw;
    return raw;
  }
  ```
  Three return paths that all return `raw`. The `s` local is captured but never read. Whole function is `Audio.feat[react.feature] ?? 0`. The comments are misleading: "already 0..1 envelope" and "raw" both return the same value, suggesting the original author planned to apply smoothing and never did. Either ship the smoothing or drop the dead branches. Ship the simplification here (the dirty-tree `engine-keys.client.js` master-toggle branch will need to add its own `reactorsEnabled` filter anyway, which is a separate cycle).
- **Working-tree compatibility**: `git status` shows `M engine-keys.client.js` and `M versions/music_video.html` (the dirty in-flight master-toggle + swap-asset work). Neither file touches `applyReactors` / `getFeature` — verified via `grep -n "applyReactors\|getFeature" engine-keys.client.js versions/music_video.html` returning zero hits. This plan only edits `engine.html:3903-3959`, which is clean.
- **Existing regression coverage**: `verify-rotation-enabled.mjs` (added in a prior cycle for the per-layer ROTATE toggle) already exercises both branches:
  - `verify-rotation-enabled.mjs:107-115` — rotation ON, asserts `applyReactors().rot > 0` and ≈75.
  - `verify-rotation-enabled.mjs:117-124` — rotation OFF, asserts `applyReactors().rot === 0`.
  - `verify-rotation-enabled.mjs:126-141` — rotation OFF + scale reactor, asserts scale still applies, rot stays 0.
  - `verify-rotation-enabled.mjs:143-151` — rotation ON, rot > 0 again.
  These four checks must continue to pass after the dedupe; they cover both the positive (rot accumulated) and negative (rot gated) branches.
- **Hot-path context**: `applyReactors` is called from `drawLayer` at `engine.html:4052` for every visible layer on every RAF tick (line 4367). Each call currently runs the duplicated 11-line dispatcher twice in the worst case (caching depends on rotation-enabled state — most frames take the same branch, but the duplicated code is in both paths). After dedupe, the per-frame work is unchanged in instruction count (still one loop walk) but the code surface is half the size, making future reactor targets (e.g. `z`, `blur`, `saturation`) one-line additions instead of two-line.
- **Why now**: the in-flight `2026-09-05T08-06-speed-z-sort-cache-and-apply-r-reuse.md` Step 5 plans to convert `applyReactors` to use a reusable scratch `_scratchR` field — that refactor will touch the same function and benefit from a deduplicated body. Ship the dedupe first so the scratch-object follow-up doesn't compound the diff (and doesn't risk a partial state where the loop is half-deduped half-cached).

## Goal

`engine.html:applyReactors` has **one** reactor-target dispatcher (not two near-identical copies); `engine.html:getFeature` is **one line** (`return Audio.feat[react.feature] ?? 0;`) with no unused local. All four `verify-rotation-enabled.mjs` checks still pass with bit-identical output values; `npm run check` passes.

## Plan

### Step 1 — dedupe `applyReactors` into a single reactor loop

- **Files**: `engine.html:3916-3959`.
- **Action**: replace the entire `applyReactors` function with a single-loop version where the `rot` target is gated inline. The branch difference (`out.rot = enabled ? ... : 0` and the optional `else if (r.target === 'rot') out.rot += v`) collapses cleanly. Suggested shape:
  ```js
  applyReactors(layer) {
    // Returns {scale, x, y, rot, opacity, hue, brightness, contrast}.
    // rot = audio-driven base + per-clip persistent offset when rotationEnabled
    // (defaults to true; undefined === enabled). When false, manual rotOffset
    // and any rot-target reactors are silenced; every other target still applies.
    const enabled = layer.rotationEnabled !== false;
    const out = {
      scale: layer.baseScale,
      x: layer.pos.x, y: layer.pos.y,
      rot: enabled ? (layer.pos.rot || 0) + (layer.rotOffset || 0) : 0,
      opacity: layer.opacity,
      hue: layer.hue,
      brightness: layer.brightness,
      contrast: layer.contrast,
    };
    for (const r of (layer.reactors || [])) {
      const v = this.ease(r.ease, clamp(this.getFeature(r), 0, 1)) * r.scale;
      switch (r.target) {
        case 'scale':      out.scale += v; break;
        case 'x':          out.x += v; break;
        case 'y':          out.y += v; break;
        case 'rot':        if (enabled) out.rot += v; break;
        case 'opacity':    out.opacity = clamp(out.opacity + v, 0, 1.5); break;
        case 'hue':        out.hue += v; break;
        case 'brightness': out.brightness = clamp(out.brightness + v, 0.1, 2.5); break;
        case 'contrast':   out.contrast = clamp(out.contrast + v, 0.1, 2.5); break;
      }
    }
    return out;
  }
  ```
  Notes:
  - `for...of` is preserved (matching the existing style in this file — see `engine.html:3934`, `:3947`).
  - `switch` on `r.target` is one fewer comparison than the if/else chain for the common 8-target path (V8 compiles string switches to a hash dispatch).
  - `getFeature(r)` and `ease(...)` calls moved to one place each; the original code computes `v` once per reactor per branch and then either uses it (in the matching branch) or throws it away (in the non-matching branches) — same big-O, just no dead-store hazard from refactoring.
  - The `let v = this.getFeature(r); v = this.ease(...)` chain becomes a single `const v = this.ease(...)` since `v` is no longer reassigned.
- **Verify**: `grep -n "r.target ===" engine.html` returns zero hits in `applyReactors`. `grep -n "case 'scale'\|case 'rot'" engine.html` shows the new switch in `applyReactors` only. `applyReactors` function body is <35 lines (down from 44).

### Step 2 — simplify `getFeature` to a one-liner

- **Files**: `engine.html:3903-3909`.
- **Action**: replace the function body with:
  ```js
  getFeature(react) {
    return Audio.feat[react.feature] ?? 0;
  }
  ```
  Drop the unused `s = this.smooth` local and the three identical-return branches. The comments at the original lines 3906-3907 ("already 0..1 envelope", "raw") described intent that wasn't implemented; remove the misleading dead-end comments rather than keeping them as documentation of nothing.
- **Verify**: `grep -n "this.smooth" engine.html` still returns the other call sites (search the file for `smooth` to confirm `this.smooth` is still used elsewhere — if not, leave the field intact for downstream consumers but drop the dead local). `grep -n "react.feature === 'beat'\|react.feature === 'onset'\|react.feature === 'centroid'" engine.html` returns zero hits.

### Step 3 — run the existing rotation-enabled verifier

- **Files**: no source changes.
- **Action**: run `npm run verify:rotation-enabled` (the AGENTS.md convention maps `verify-rotation-enabled.mjs` → `verify:rotation-enabled` script via `package.json:24-41`). The four `applyReactors`-shape assertions (rot ON, rot OFF, other targets when OFF, rot re-enables) must all stay green.
- **Verify**: command exits 0. Specifically:
  - Rotation ON: `applyReactors().rot > 0` and ≈75 (within 0.5°).
  - Rotation OFF: `applyReactors().rot === 0` exactly.
  - Rotation OFF + scale reactor: `scale ≈ 2.0` AND `rot === 0`.
  - Rotation back ON: `rot > 0` again.

### Step 4 — run the gate suite

- **Files**: no source changes.
- **Action**: `npm run check` — syntax + manifest + bundle + api tests. Also re-run any engine-area verifier that touches `applyReactors` indirectly (`npm run verify:e2e-media-record`, `npm run verify:genops` if available). Visual spot-check on `/engine/`: add a layer, attach a `bass → scale` reactor, drag the sensitivity slider — confirm the layer pulses with the bass. Toggle the master ROTATE checkbox (line 2861) — confirm the layer stops rotating while scale/x/y still react.
- **Verify**: all commands exit 0. Visual smoke confirms unchanged behavior.

## Verification

- `npm run check` passes.
- `npm run verify:rotation-enabled` passes; all four `applyReactors` assertions green.
- `npm run verify:e2e-media-record` passes (full engine media flow).
- `grep -n "r.target ===" engine.html` returns zero matches inside `applyReactors`.
- `grep -n "react.feature ===" engine.html` returns zero matches.
- `wc -l engine.html` decreases by at least 5 lines (current 6038; target ≤6033).
- `git diff engine.html` shows net negative LoC in `applyReactors` + `getFeature`; new code uses a `switch` statement.
- Source scan: `applyReactors` function is one continuous block; no orphaned `enabled`/`!enabled` branching.

## Risks / gotchas

- **`switch` string interning**: V8 hashes string `case` values; for the 8-target switch here the overhead is dwarfed by the rest of `applyReactors`. No risk.
- **for...of vs for-i in hot path**: `applyReactors` is called per-layer per-frame; for...of allocates an iterator object per call. Today the code already uses `for (const r of (layer.reactors || []))` (lines 3934, 3947), so the dedupe doesn't add new iterator overhead — it removes one of two iterator allocations by collapsing the two branches into one loop. If a follow-up wants to chase the iterator-allocation further, that's a separate plan (and conflicts with the in-flight `engine-loop` and `applyR-scratch` plans — keep out of scope here).
- **Future target additions**: a developer adding a new reactor target (e.g. `blur`) now has to edit exactly one place — the switch in Step 1. The old code required two edits (the `!enabled` and `enabled` branches) and frequently forgot the second, which is the exact parity-test bug smell from the skill spec. After this plan, the existing `verify-rotation-enabled.mjs` becomes a delegation-style test (it asserts behavior, not parallel-implementation equivalence), and a future expansion can rely on a single switch case.
- **Dirty-tree interleave**: the `engine-keys.client.js` master-toggle (`reactorsEnabled`) is currently being added in dirty-tree state. That feature is at a higher abstraction layer (toggles the reactor subsystem per-layer via a new field) — `applyReactors` will eventually grow a new top-level guard (`if (layer.reactorsEnabled === false) return this._scratchR;` or similar). This plan doesn't add that guard; it just dedupes the existing rot-specific branch so the future `reactorsEnabled` guard has fewer cases to reason about. If the agent integrating the master-toggle commit lands first, this plan still applies cleanly afterward; if this plan lands first, the master-toggle follow-up can `return early` from the top of `applyReactors` without worrying about which branch is active.
- **Branchless rot accumulation**: the `if (enabled) out.rot += v;` inside the switch keeps the rot-gating explicit. An alternative is `out.rot += v; if (!enabled) out.rot = 0;` post-loop, but that requires a final branch and is no clearer. The inline-`if` keeps the relationship visible at the call site.
- **Engine variants not affected**: `versions/*.html` each define their own `applyR` (or none — they consume `versions-presets.js`'s pipeline). Verified via `grep -l "target === 'rot'" versions/*.html` returning zero hits — the dispatcher duplication is `engine.html`-only. No cross-file sync needed.
- **No new test scaffold**: existing `verify-rotation-enabled.mjs` covers both rot-on and rot-off paths with 4 explicit value checks. Adding a new test would be redundant; the existing verifier's coverage IS the dedupe safety net.

## Out of scope

- Replacing `for...of` with indexed `for` to dodge iterator allocation — the original code already pays this cost in both branches; the dedupe doesn't change it. A separate `applyR-scratch-object` plan (`2026-09-05T08-06` Step 5, still in flight) is the right vehicle for that.
- Adding the `reactorsEnabled` master-toggle branch inside `applyReactors` — that ships via the dirty-tree `engine-keys.client.js` work and will need its own small follow-up commit.
- Replacing the if/else chain in `applyReactors` with a lookup table (`const TARGETS = {scale: (out, v) => out.scale += v, ...}`) — premature; the 8-case switch is already V8-hashed.
- Moving `applyReactors` out of `engine.html` into `engine-render.client.js` — engine.html and the shared render module have intentionally separate concerns (engine.html owns the `Renderer` lifecycle; the shared module is a stateless helper). Crossing that boundary is an architectural change, not a dedupe.
- Touching `versions/versions-presets.js` or any variant page — verified by `grep` that the duplication is `engine.html`-only.
