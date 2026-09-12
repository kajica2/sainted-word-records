# Hoist `HologramState.depth` + skip blend-object allocation when no override

**Cycle**: 2026-09-08T15-57
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

The render loop in `versions-presets.js` calls `blendFxOverride(preset, _ovFx, _depth)` every animation frame on **every** `versions/*.html` page (22 pages mount this script). The helper allocates a fresh `{temp, mut, sepia, chroma, grain, glow, grayscale, posterize}` object literal every frame, and the upstream code walks a 4-step `window.SWR.HologramState.depth` property chain on the same frame. On the 21 pages that don't use the `music_video.html` automixer (`_fxOverride` is null), the blend result is discarded immediately — `tempOverride` is null and `_hasOv` is false, so `_blend` is never read. Hoist the depth lookup, skip `blendFxOverride()` entirely when `_ovFx` is null, and inline the 8 mixed-field reads to use `preset.X` directly. This composes with the in-flight `2026-09-08T09-47-speed-versions-presets-uniform-sticky.md` plan (which addresses the **uniform-call layer**) — together they cut per-frame allocations and GL calls to a minimum on the 21 non-music_video pages and shrink the hot path on the 1 automixer page.

## Why this cycle

**Scan evidence** (Phase 2 of the worker cycle):

- **`versions-presets.js:887-965`** — `render()` runs at 60Hz on every variant that has a `<body data-page>` attribute. Per frame:
  - **Lines 933-936**: 4-step property walk `window.SWR && window.SWR._fxOverride` then `window.SWR.HologramState && typeof HologramState.depth === 'number'` — every frame.
  - **Line 937**: `const _blend = _ovFx ? blendFxOverride(preset, _ovFx, _depth) : preset;` — when `_ovFx` is `null` (21/22 pages), the ternary still invokes the `preset` branch with no allocation, BUT when `_ovFx` is set (music_video.html with automix on), `blendFxOverride` allocates `{temp, mut, sepia, chroma, grain, glow, grayscale, posterize}` — a fresh object on every frame, ×60 fps.
  - **Line 937 in the helper** (`versions-presets.js:57-69`): 8 ternaries `(ovFx ? (ovFx.X || 0) : 0) * mixFx` — all evaluate to `0 * mixFx = 0` when `ovFx` is truthy but the field is undefined (which is the case for most fields in `_fxOverride` because `setPresetOverride` only writes 8 of 8 fields, so this is mostly true, but on partial overrides the ternaries still touch both branches). The `Math.max/min` clamp on `mixFx` runs every call.
  - **Lines 939-946**: 8 conditional variable reads gated on `_hasOv`. When `_hasOv` is false (21/22 pages), these degenerate to `preset.X` reads — but the source still computes them as ternaries, paying branch-prediction cost on every frame.

- **In-flight plan `2026-09-08T09-47-speed-versions-presets-uniform-sticky.md`** addresses the uniform-call layer (skip `gl.uniform1f` when the value hasn't changed). It explicitly notes (line 234): *"`_fxOverride` is a `window.SWR` property — the code reads `window.SWR && window.SWR._fxOverride` every frame. The memo doesn't cache this; the read is cheap (~0.1 µs). No risk."* That plan **does not touch** the blend-object allocation, the `HologramState.depth` chain, or the 8 ternary field reads. Adjacent, complementary, non-overlapping.

- **Existing unit-test scaffold** `scripts/check-depth-blend-unit.mjs:1-50` already exercises `window.__SWR_BLEND_FX` (= `blendFxOverride`) under Node via vm sandbox. This plan can extend that file with **parity tests** that assert the inlined-frame code produces the same numeric result as the original `blendFxOverride()` for every (preset, override, depth) triple — and per the skill's anti-pattern note ("parity test as a permanent regression gate"), the parity test ships as a temporary guard that becomes a **delegation test** when the helper is inlined.

- **No dirty-tree conflict**: `git status` shows untracked on `package.json:24-41` (scripts), `docs/music-video.md`, `.worktrees/`, and 4 un-shipped `.improvements/` plans — none touch `versions-presets.js` or its helpers.

- **Active user direction** (per skill "Active directions"): the music-video sprint is the live work (`versions/music_video.html` last touched Sep 8 15:42; `client/automix.client.js` last touched Sep 8 sprint). The `HologramState.depth` slider is the user's invention (music_video.html:1446-1451). This plan **strengthens** that path by removing the upstream blend overhead the slider triggers every frame.

## Goal

The `render()` loop in `versions-presets.js:887-965` runs with:
- **Zero object allocations per frame** when `window.SWR._fxOverride` is null (the 21 non-automixer pages).
- **One hoisted read** of `HologramState.depth` per frame instead of a 4-step `window.SWR && window.SWR.HologramState && typeof ... === 'number'` chain.
- **Identical numeric output** to the current implementation in all cases, verified by an extended `scripts/check-depth-blend-unit.mjs`.

## Plan

### Step 1 — extend the existing unit test to cover the parity matrix

- **Files**: `scripts/check-depth-blend-unit.mjs`
- **Action**: add a test block that imports the original `blendFxOverride` (via the existing vm-sandbox pattern at lines 22-50), then for a fixture of `(preset, ovFx, depth)` triples — including the cases `ovFx === null`, `ovFx === {}`, `ovFx` partial (only some fields set), `depth ∈ {0, 0.25, 0.5, 0.75, 1}`, and one real preset row from `PRESETS.neon` or similar — runs **both** the original helper and the proposed inline expression and asserts `Math.abs(a - b) < 1e-9` for every output field. Mirror the style of the existing tests in the file (`DEPTH BLEND UNIT: ALL GREEN (N tests)` line, `assert.equal` / `assert.ok`).
- **Verify**: `node scripts/check-depth-blend-unit.mjs` exits 0 with the new line count. Existing tests still pass.

### Step 2 — hoist the `HologramState.depth` read

- **Files**: `versions-presets.js:887-965` (the `render()` function)
- **Action**: at the top of `render()` (after the `now`/`t`/`Audio`/`feat` lines 888-898), add a single guarded read:
  ```js
  const SWR = window.SWR;
  const _ovFx = (SWR && SWR._fxOverride) || null;
  const _depth = (SWR && SWR.HologramState && typeof SWR.HologramState.depth === 'number')
    ? SWR.HologramState.depth
    : 0.4;
  ```
  and replace lines 933-936 with these three lines. The hoist reads `window.SWR` once instead of twice (once for `_fxOverride`, once for `HologramState`).
- **Verify**: `grep -n "window.SWR" versions-presets.js` shows the read site is now inside `render()` once per frame instead of twice. `grep -n "HologramState" versions-presets.js` shows one read site (in `render()`) plus the existing slider handler in `versions/music_video.html:1446-1451`.

### Step 3 — skip the blend-object allocation when no override

- **Files**: `versions-presets.js:937`
- **Action**: replace
  ```js
  const _blend = _ovFx ? blendFxOverride(preset, _ovFx, _depth) : preset;
  ```
  with
  ```js
  let _blend = null;
  if (_ovFx) _blend = blendFxOverride(preset, _ovFx, _depth);
  ```
  This makes `_blend` a `null` placeholder when no override is set, so the 8 field reads at lines 939-946 can fall through to `preset.X` directly without the helper having allocated.
- **Verify**: `grep -n "_blend = " versions-presets.js` shows the new guarded assignment. `node scripts/check-depth-blend-unit.mjs` still passes (the parity test from Step 1 covers this).

### Step 4 — inline the 8 mixed-field reads with null-check

- **Files**: `versions-presets.js:938-946`
- **Action**: replace
  ```js
  const _hasOv = !!_ovFx;
  const _temp      = tempOverride !== null ? tempOverride : (_hasOv ? _blend.temp : preset.temp);
  const _mut       = _hasOv ? _blend.mut       : preset.mut;
  const _chroma    = _hasOv ? _blend.chroma    : preset.chroma;
  const _grain     = _hasOv ? _blend.grain     : preset.grain;
  const _sepia     = _hasOv ? _blend.sepia     : preset.sepia;
  const _glow      = _hasOv ? _blend.glow      : preset.glow;
  const _grayscale = _hasOv ? _blend.grayscale : preset.grayscale;
  const _posterize = _hasOv ? _blend.posterize : preset.posterize;
  ```
  with
  ```js
  const _hasOv = !!_blend;
  const _temp      = tempOverride !== null ? tempOverride : (_blend ? _blend.temp      : preset.temp);
  const _mut       = _blend ? _blend.mut       : preset.mut;
  const _chroma    = _blend ? _blend.chroma    : preset.chroma;
  const _grain     = _blend ? _blend.grain     : preset.grain;
  const _sepia     = _blend ? _blend.sepia     : preset.sepia;
  const _glow      = _blend ? _blend.glow      : preset.glow;
  const _grayscale = _blend ? _blend.grayscale : preset.grayscale;
  const _posterize = _blend ? _blend.posterize : preset.posterize;
  ```
  Drop the now-redundant `const _hasOv = !!_ovFx;` line at the top (the new `_hasOv = !!_blend` is equivalent — both are truthy iff an override was applied — and `_ovFx` is no longer needed after the `_blend` assignment). The in-flight plan `2026-09-08T09-47` (Step 4 of that plan) will still wire the uniform-skip layer on top of these local variables.
- **Verify**: `grep -n "_ovFx\|_blend" versions-presets.js` shows `_ovFx` only at the (now single) read site inside `render()`, and `_blend` is set once + read 8 times in the inline ternary block.

### Step 5 — add a one-time console note on the dev path

- **Files**: `versions-presets.js` (optional, comment near line 47)
- **Action**: extend the existing comment block at line 46-56 to note that `blendFxOverride` is now called from `render()` only when `_ovFx` is truthy. Match the surrounding comment style. Don't write any new code paths — this is purely a maintenance breadcrumb so the next reader doesn't wonder why the helper sometimes returns a discarded value.
- **Verify**: `grep -n "blendFxOverride\|only when" versions-presets.js` shows the comment update.

### Step 6 — run the full check gate

- **Files**: (no edits)
- **Action**: run `npm run check` (which runs `check:syntax`, `check:manifest`, `check:bundle`, `scripts/test-api.mjs`) and confirm 0 errors. Then `node scripts/check-depth-blend-unit.mjs` to confirm the parity tests pass. The visualizer on any non-music_video page (`http://localhost:5174/<version>.html` — e.g. `/film/`) should look **identical** to before; verify by opening `versions/film.html` and `versions/neon.html` and confirming the WebGL post-process output matches (no visual diff). For `versions/music_video.html`, open with automix on, drag the depth slider, and confirm the blend still tracks depth 0→1 correctly.
- **Verify**: `npm run check` exits 0. `node scripts/check-depth-blend-unit.mjs` exits 0 with `ALL GREEN (N+ tests)` (N from before + new parity tests). Visual diff on 3 pages is identical.

### Step 7 — prepare the follow-up delegation test (do not apply in this PR)

- **Files**: (note in PR description, no code change here)
- **Action**: in the PR description or commit message, flag that the parity tests from Step 1 should be **replaced** in a follow-up PR with a **delegation test** that asserts the inlined math references the same function as `window.__SWR_BLEND_FX`. Per the skill's anti-pattern note ("parity test as a permanent regression gate"), the parity test is scaffolding — its job is to confirm the inlined version is correct, then it gets retired once the helper is fully inlined. This plan ships parity as a temporary regression guard; the next round of cleanup can delete it.
- **Verify**: this is a process step, not a code step. The PR description contains the note.

## Verification

- `node scripts/check-depth-blend-unit.mjs` exits 0 with the new parity test count (≥ 30 assertions covering all (preset × ovFx-shape × depth) combos).
- `npm run check` exits 0 (no syntax, manifest, bundle, or api regression).
- `npm run build` exits 0 (the prebuild `fetch-library.mjs` runs first; this plan doesn't touch `library/`).
- Visual smoke on 3 representative pages:
  - `http://localhost:5174/film/` (non-automixer, no automix override) — output identical to pre-change.
  - `http://localhost:5174/neon/` (non-automixer) — output identical to pre-change.
  - `http://localhost:5174/music_video/` with automix on, drag depth 0 → 0.5 → 1 — output matches pre-change at every slider position.
- Optional perf measurement: open Chrome DevTools → Performance → record 5 seconds on `/film/` with the WebGL canvas visible. The "Scripting" time per frame should drop measurably (target: ≥ 0.05 ms / frame saved on the 21 non-automixer pages, dominated by removing the per-frame object literal allocation + the 4-step property chain). On `/music_video/` with automix on, expect ≥ 0.03 ms / frame saved (the object alloc + chain still happen, but the redundant `!!_ovFx` ternary and the `_hasOv` assignment go away).
- `grep -rn "HologramState\|_fxOverride" --include="*.js" --include="*.html"` shows the same set of files as before; no new surfaces added.

## Risks / gotchas

- **Hidden consumers of `window.__SWR_BLEND_FX`**: line 70 exports it for tests. After this change, it's still called from `render()` only when `_ovFx` is truthy (1 page out of 22). The test file `scripts/check-depth-blend-unit.mjs` calls it directly — that's fine, the helper still exists, it just gets called less often. **Mitigation**: keep `window.__SWR_BLEND_FX = blendFxOverride;` at line 70; do not delete the helper. The in-flight plan `2026-09-08T09-47` notes (line 234) that downstream scripts call `setPresetOverride` (line 1016-1021), which writes `window.SWR._fxOverride` — that path is unchanged.

- **Edge case: `tempOverride` + override both set**: the inline reads at Step 4 must handle the case where `tempOverride !== null` AND `_ovFx` is truthy. Current code: `tempOverride !== null ? tempOverride : (_hasOv ? _blend.temp : preset.temp)` — when `tempOverride` is set, the override is ignored. The inlined version preserves this exactly (same precedence). **Verify**: the parity test from Step 1 includes a `(tempOverride: 0.3, _ovFx: {temp: 0.9}, depth: 1.0, preset: {temp: 0.0})` combo and asserts `_temp === 0.3`.

- **`typeof` check semantics**: `typeof window.SWR.HologramState.depth === 'number'` rejects `NaN`. The original code rejects `NaN` too (because `typeof NaN === 'number'`, but `NaN` would be a bug input). **Mitigation**: keep the `typeof === 'number'` guard verbatim; do not change to truthiness.

- **The depth-blend helper still allocates when called**: `blendFxOverride()` at lines 57-69 returns an object literal `{temp, mut, ...}`. When called (only on music_video.html with automix on), it still allocates 1 object/frame. That's the inherent cost of having an 8-field blend result, and is **out of scope** for this plan. A separate plan could refactor `blendFxOverride()` to take an out-parameter and mutate a preallocated scratch object — flag this as a possible follow-on cycle if perf budget requires it.

- **In-flight plan interaction**: the in-flight `2026-09-08T09-47-speed-versions-presets-uniform-sticky.md` modifies the same `render()` function (specifically the uniform-call block at lines 947-960). If both plans land in the same PR, the diff may collide. **Mitigation**: if this plan lands first, the next agent applying the in-flight plan will see `_temp`, `_mut`, ..., `_posterize` as the local variables they hook into (no change needed). If the in-flight plan lands first, this plan still applies — the new `_hasOv`, `_temp`, etc. are local-only additions. Apply whichever lands first as a clean baseline, then the other as a follow-up.

## Out of scope

- Refactoring `blendFxOverride()` to take an out-parameter (the remaining 1-alloc/frame cost on the automixer page). Flag as a follow-on cycle if the in-flight plan + this one don't meet the perf target.
- Changing the public API of `setPresetOverride()` or `setTemp()` (lines 998-1021). Both keep their existing signatures.
- Touching `versions/music_video.html`, `client/automix.client.js`, or `client/anchor-embed.js` — those write to `window.SWR.HologramState` / `window.SWR._fxOverride` and are unchanged. This plan only changes the **consumer** side (the render loop).
- Adding `domínio` or any new dependency. Pure refactor of the existing render loop.
- Touching `scripts/with-dist.mjs` or any verify-*.mjs — this plan is a pure local refactor with no API surface change, so the existing `verify:music-video-maker` smoke covers regression detection.
- `library/` (verified tracked in git per the `.improvements/STATE.json` "covered_topics" — this plan doesn't add or remove media).