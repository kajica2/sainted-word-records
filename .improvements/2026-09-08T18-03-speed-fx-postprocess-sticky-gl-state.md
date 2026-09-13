# Hoist sticky WebGL state calls out of `fx-postprocess.js:render()`

**Cycle**: 2026-09-08T18-03
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

`fx-postprocess.js` is the WebGL post-process pipeline that runs in **5 variants** (`baroque`, `kraft`, `mosaic`, `phosphor`, `tape`) — a separate fleet from the 13 pages that load `versions-presets.js` and which the last six worker cycles have been hammering. Every frame its `render()` body issues three WebGL state calls — `gl.activeTexture(gl.TEXTURE0)` at line 499, `gl.bindTexture(gl.TEXTURE_2D, tex)` at line 500, and `gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)` at line 508 — inside the `try` block that runs on every actual draw. All three are **sticky GL state**: they remain set on the context until something else unbinds/changes them, and nothing else in the file ever does. Move them to `init()` (immediately after the existing texture creation + `gl.uniform1i(u.tex, 0)` at lines 424-430) so they fire **once per program init** instead of once per frame. Across the 5 affected variants × 60 fps × 3 calls/frame, that's **~900 wasted GL state calls/sec** removed fleet-wide, with zero behavioral change.

This complements the existing in-flight `2026-09-01T15-42-speed-fx-uniform-skip.md` (which addresses uniform writes and a whole-pass skip) and the deferred `2026-09-04T08-49-speed-versions-presets-gate.md` (the equivalent source-gate for the 13-page `versions-presets.js` path). Both of those plans operate *after* the per-frame state calls — neither hoists `pixelStorei`/`activeTexture`/`bindTexture` out of the loop. **This plan closes that gap and adds nothing the other plans would later undo.**

## Why this cycle

**Scan evidence** (Phase 2 of the worker cycle):

- **`fx-postprocess.js:499-500`** — at the top of the `try` block in `render()`, called every frame the shader runs:
  ```js
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  ```
  Both are **context-level sticky state**:
  - `gl.activeTexture(unit)` selects which texture unit the next `gl.bindTexture` call will target. It persists until the next `gl.activeTexture` call. Nothing in `fx-postprocess.js` ever changes the active unit after `init()`.
  - `gl.bindTexture(target, texture)` binds a specific texture to the current active unit. It persists until the next `gl.bindTexture` call on the same unit. Nothing in `fx-postprocess.js` rebinds a different texture after `init()`. The texture object `tex` is created at line 424 and never replaced.
  - These calls are also redundant with lines 424-425 in `init()` (`gl.bindTexture(gl.TEXTURE_2D, tex)` was already called when the texture was created — bind state was set then), and the existing `gl.uniform1i(u.tex, 0)` at line 430 already told the sampler that TEXTURE0 holds the input.
- **`fx-postprocess.js:508`** — inside the same `try` block:
  ```js
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  ```
  `pixelStorei(UNPACK_FLIP_Y_WEBGL)` is **context-level sticky state** for the texture unpack pipeline. It persists until the next `gl.pixelStorei` call. Nothing in the file ever sets it to `false`. The flip is a one-time semantic decision that should fire **once when the texture upload orientation is fixed**, not every frame.
- **5 pages load `fx-postprocess.js`** (per the loader split in the 2026-09-04 gate plan): `baroque.html`, `kraft.html`, `mosaic.html`, `phosphor.html`, `tape.html`. These pages do **not** load `versions-presets.js`, so none of the last six worker cycles' versions-presets wins reach them. This plan targets the other fleet.
- **Why now**: the in-flight `2026-09-01T15-42-speed-fx-uniform-skip.md` plan (still un-shipped) introduces a Step 2 whole-pass gate. After it lands, the upload path will fire only when inputs change — but when it *does* fire, `pixelStorei/activeTexture/bindTexture` still run inside it. Hoisting them out *before* that gate lands means the gate plan doesn't have to know about them. Order matters: ship this plan first, then the gate plan can treat the upload block as just `gl.texImage2D(...)` inside the `try`.
- **No dirty-tree conflict**: `git status` shows untracked on `package.json:24-41`, `docs/music-video.md`, `.worktrees/`, and 5 un-shipped `.improvements/` plans — none touch `fx-postprocess.js` lines 499-514. `fx-postprocess.js` last shipped at `5e135f1 fix(fx): flip Y on WebGL texture upload to align with 2D canvas` and has been untouched since. The file is clean.
- **Pre-existing regression guard**: the existing Puppeteer verifier `verify-css-fx.mjs` (and the related `verify-versions.mjs` / `verify-new-versions.mjs` that load the 5 affected variants) compare rendered canvas hashes against a known baseline. If the hoist breaks context state in any of the 5 affected pages, these verifiers will fail with a frame-hash mismatch.

## Goal

`fx-postprocess.js:render()` calls `gl.pixelStorei`, `gl.activeTexture`, and `gl.bindTexture` **exactly zero times per frame**. The three calls live in `init()` once, immediately after the texture setup at lines 424-430. Output pixels are bit-identical to the current build on all 5 affected variants (`baroque`, `kraft`, `mosaic`, `phosphor`, `tape`), verified by `npm run verify:css-fx` (and any other verifier that touches these pages).

## Plan

### Step 1 — instrument before/after counters (temporary, removed before commit)

- **Files**: `fx-postprocess.js:init()` and `fx-postprocess.js:render()`.
- **Action**: temporarily install three scalar counters on a development-only gate:
  ```js
  // dev-only — remove before commit. Wire at the top of init():
  if (typeof window !== 'undefined' && window.__SWR_FX_DEV) {
    window.__SWR_FX_DEV = window.__SWR_FX_DEV || {};
    window.__SWR_FX_DEV.activeTextureCalls = 0;
    window.__SWR_FX_DEV.bindTextureCalls = 0;
    window.__SWR_FX_DEV.pixelStoreiCalls = 0;
    window.__SWR_FX_DEV.texImage2DCalls = 0;
    window.__SWR_FX_DEV.drawArraysCalls = 0;
  }
  ```
  And increment each counter at the call site:
  ```js
  if (window.__SWR_FX_DEV) window.__SWR_FX_DEV.activeTextureCalls++;
  gl.activeTexture(gl.TEXTURE0);
  ```
- **Verify**: in Puppeteer, after `domcontentloaded` and 60 frames, assert each counter is **1** (not 60) after the hoist lands. Same for `bindTexture` and `pixelStorei`. `texImage2DCalls` and `drawArraysCalls` should still be 60 (those are NOT hoisted — they must run every frame).

### Step 2 — hoist the three sticky state calls to `init()`

- **Files**: `fx-postprocess.js:424-430` (the existing texture creation block) and `fx-postprocess.js:499-500, 508` (the per-frame state calls).
- **Action**:
  1. **Add** immediately after `gl.uniform1i(u.tex, 0);` at line 430 (still in `init()`):
     ```js
     // Hoisted from render() — all three are sticky GL state and never
     // need to be re-issued: nothing in this file unbinds, switches
     // active texture unit, or changes UNPACK_FLIP_Y_WEBGL.
     gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
     ```
     (`activeTexture` and `bindTexture` are already called at lines 425 and the texture unit is implicit-texture-unit-0 per `gl.uniform1i(u.tex, 0)` — but for safety, re-issue them explicitly here so the contract is unambiguous):
     ```js
     gl.activeTexture(gl.TEXTURE0);
     gl.bindTexture(gl.TEXTURE_2D, tex);
     ```
  2. **Remove** lines 499-500 and line 508 from `render()`. The `try` block in `render()` then contains only:
     ```js
     try {
       gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stageCanvas);
     } catch (e) {
       // Texture size mismatch (canvas not ready yet). Skip this frame.
       requestAnimationFrame(render);
       return;
     }
     ```
     Update the comment block above the upload (lines 497-507) to a one-liner pointing at `init()` for the orientation rationale, e.g.:
     ```js
     // Copy current #render pixels into the texture. Note: the upload-side
     // Y flip is set once in init() — flipping v_uv inside the shader would
     // mirror every texture sample there.
     ```
- **Verify**:
  - `grep -n "gl.pixelStorei\|gl.activeTexture\|gl.bindTexture" fx-postprocess.js` shows **1** match for each, all in `init()`. Zero matches in `render()`.
  - The dev counters from Step 1 confirm `activeTextureCalls === 1`, `bindTextureCalls === 1`, `pixelStoreiCalls === 1` after 60 frames.

### Step 3 — run all available verifiers that touch the 5 affected pages

- **Files**: `package.json` scripts + existing verifier files.
- **Action**: run each verifier that can drive one of `baroque`, `kraft`, `mosaic`, `phosphor`, `tape`. Look up exact names via:
  ```bash
  grep -l "baroque\|kraft\|mosaic\|phosphor\|tape" verify-*.mjs 2>/dev/null
  ```
  Then for each match, run `npm run verify:<name>` (the AGENTS.md convention maps `verify-foo.mjs` → `verify:foo` script in `package.json:24-41`). At minimum:
  - `npm run check` — syntax + manifest + bundle + api tests
  - `npm run verify:css-fx` — frame-hash regression guard for the FX pipeline
  - The matching Puppeteer verifier for each of the 5 pages (whatever it is — typically `verify-barque.mjs`, `verify-kraft.mjs`, etc., but grep is the source of truth)
- **Verify**: every command exits 0. Capture the per-frame canvas hash from `verify:css-fx` before and after the change — must be byte-identical (a regression here means a sticky-state assumption broke on one of the 5 pages, possibly due to a variant doing its own `bindTexture` to a different texture).

### Step 4 — remove dev-only counters

- **Files**: `fx-postprocess.js:init()` and `fx-postprocess.js:render()`.
- **Action**: delete the three `window.__SWR_FX_DEV` counter blocks from Step 1. Search for any other reference to `__SWR_FX_DEV` and remove it.
- **Verify**: `grep -n "__SWR_FX_DEV" fx-postprocess.js` returns no matches. The change is clean and ships with no dev-only hooks.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run verify:css-fx` passes with byte-identical frame-hash output.
- Each affected variant (`baroque`, `kraft`, `mosaic`, `phosphor`, `tape`) has a matching `verify-*` Puppeteer suite that passes.
- Manual spot-check: open `versions/phosphor.html` in a browser with DevTools → Performance. Record a 5-second trace before and after the change. The WebGL group should show **~300 fewer** `gl.pixelStorei/activeTexture/bindTexture` calls in the 5-second window (3 calls/frame × 60 fps × 5 sec = 900; traces report a subset, expect roughly that ratio).
- `git diff fx-postprocess.js` shows ~6 lines removed (3 calls × 2 lines incl. the `gl.` prefix) and ~3 lines added in `init()`. Net negative LoC.

## Risks / gotchas

- **Sticky-state assumption break**: if any of the 5 affected variants (`baroque`, `kraft`, `mosaic`, `phosphor`, `tape`) has its own WebGL state elsewhere that resets `UNPACK_FLIP_Y_WEBGL` to `false` between frames (e.g. its own texture upload on the same context), hoisting will break the flip. Mitigation: the existing `verify:css-fx` frame-hash regression guard catches this — the rendered output rotates 180° if the flip is dropped, which is visually obvious in the screenshot diff.
- **WebGL context loss**: if the GL context is lost and restored (mobile tab switch, GPU reset), the sticky state is wiped and must be re-issued. The current code's per-frame re-issue is a no-op in the happy path but a self-healing mechanism on context restore. Mitigation: this is rare (browsers surface a `webglcontextlost` event the page should handle anyway), but a follow-up plan could add a `webglcontextlost` listener that re-runs `init()`'s texture + state setup. Out of scope here — the current code doesn't handle context loss either.
- **Multi-context confusion**: `fx-postprocess.js` and the variant pages share the page's GL context for the `#fx-canvas` overlay. If a variant ever switches contexts (e.g. creates a separate GL context for its own `#fx-canvas2`), the sticky state from one context won't carry to the other. None of the 5 affected variants do this today; verify the grep `gl\.getContext\|new WebGL` in each variant's HTML before committing.
- **Inter-plan ordering**: this plan moves three calls that the still-un-shipped `2026-09-01T15-42-speed-fx-uniform-skip.md` Step 2 gate would otherwise run inside its `try` block. If both plans land together, the gate plan should drop its `pixelStorei/activeTexture/bindTexture` calls from its Step 2 sketch (or ship first, then this plan). The cycle worker has a 31-plan backlog so ordering is a downstream concern — this plan stands on its own.

## Out of scope

- The `gl.uniform1f` per-frame writes at lines 517-535 — covered by `2026-09-01T15-42-speed-fx-uniform-skip.md` (whole-pass gate + uniform caching). Not touching here to avoid overlap.
- The whole-pass audioHash/personaKey skip — covered by the same plan.
- `versions-presets.js` equivalent — covered by `2026-09-08T09-47-speed-versions-presets-uniform-sticky.md` for the 13 pages that load that script.
- Context-loss restoration — a separate quality follow-up if the user requests it; rare path.
- The 14-FX pipeline in the fragment shader itself — orthogonal to this fix.
