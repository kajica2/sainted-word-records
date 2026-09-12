# Throttle `$('fps').textContent` + gate `$('flash').style.opacity` on every variants/* page (the engine.html follow-up that didn't ship)

**Cycle**: 2026-09-09T04-31
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

The 2026-09-08T01-36 plan (`engine-loop-dom-write-throttle.md`) shipped a 5 Hz throttle for `$('fps-v').textContent` and a Δ≥0.005 gate for `stageFlash.style.opacity` in `engine.html` — but **only in `engine.html`**. The 10 variant pages (`aurora`, `chrome`, `fractal`, `glitch`, `grid`, `music_video`, `neon`, `pulse`, `void`, `watercolor`) all run the exact same per-frame pattern in their own `loop(t)`:

```js
$('fps').textContent = Math.round(fps) + ' fps';        // line N
$('flash').style.opacity = A.feat.beat > 0.3 ? String(A.feat.beat*0.4) : '0';   // line N+1
```

Each line fires every RAF tick. At 60 fps that's **120 DOM-write churns/sec/tab** on each variant; with multiple variants open the per-tab cost is identical and the fleet-wide cost is the same × N. The fix is the proven engine.html pattern ported to each variant's closure scope (the renderer is local to each page's IIFE — no shared module to hoist into). After this lands, all 10 variants read the same 5 Hz FPS counter and the same Δ-gated flash opacity that engine.html ships today.

`smoke` is the lone variant that **does not** carry these lines — `smoke.html:923` z-sorts but does not write fps/flash. It is intentionally out of scope (the changes would be net-zero there).

## Why this cycle

**Scan evidence (this cycle)**:
```text
$ grep -nE "\\\$\\('fps'\\)\\.textContent" versions/*.html
versions/aurora.html:863:      $('fps').textContent = Math.round(fps)+' fps';
versions/chrome.html:841:      $('fps').textContent = Math.round(fps)+' fps';
versions/film.html:992:      $('fps').textContent = Math.round(fps)+' fps';
versions/fractal.html:831:      $('fps').textContent = Math.round(fps)+' fps';
versions/glitch.html:836:      $('fps').textContent = Math.round(fps)+' fps';
versions/grid.html:963:      $('fps').textContent = Math.round(fps)+' FPS';
versions/hallucination.html:1091:      $('fps').textContent = Math.round(fps)+' fps';
versions/music_video.html:1337:      $('fps').textContent = Math.round(fps)+' fps';
versions/neon.html:953:      $('fps').textContent = Math.round(fps)+' fps';
versions/pulse.html:965:      $('fps').textContent = Math.round(fps)+' fps';
versions/void.html:853:      $('fps').textContent = Math.round(fps)+' fps';
versions/watercolor.html:874:      $('fps').textContent = Math.round(fps)+' fps';

$ grep -nE "\\\$\\('flash'\\)\\.style\\.opacity" versions/*.html
versions/aurora.html:869:      $('flash').style.opacity = A.feat.beat > 0.3 ? String(A.feat.beat*0.4) : '0';
versions/chrome.html:847:      $('flash').style.opacity = A.feat.beat > 0.3 ? String(A.feat.beat*0.4) : '0';
versions/fractal.html:837:      $('flash').style.opacity = A.feat.beat > 0.3 ? String(A.feat.beat*0.4) : '0';
versions/glitch.html:842:      $('flash').style.opacity = A.feat.beat > 0.3 ? String(A.feat.beat*0.4) : '0';
versions/grid.html:932:      $('flash').style.opacity = String(flash);
versions/music_video.html:1343:      $('flash').style.opacity = A.feat.beat > 0.3 ? String(A.feat.beat*0.4) : '0';
versions/neon.html:959:      $('flash').style.opacity = A.feat.beat > 0.3 ? String(A.feat.beat*0.4) : '0';
versions/pulse.html:971:      $('flash').style.opacity = A.feat.beat > 0.3 ? String(A.feat.beat*0.4) : '0';
versions/void.html:859:      $('flash').style.opacity = A.feat.beat > 0.3 ? String(A.feat.beat*0.4) : '0';
versions/watercolor.html:880:      $('flash').style.opacity = A.feat.beat > 0.3 ? String(A.feat.beat*0.4) : '0';
```

(`hallucination.html` and `film.html` carry the FPS write but their flash line uses different element IDs — `hallucination.html` uses `$('flash')` via a different expression; see Out-of-scope.)

**Score** (1-5 per axis, total 3-15):
- Impact: **5** — 120 churns/sec/tab × 10 variants = real DOM-write churn; user-visible on long sessions (FPS counter is the visible feedback). Same shape as the engine.html plan that the team just shipped.
- Confidence: **5** — pattern is byte-for-byte identical to the shipped engine.html change (verified in `engine.html:4313` + `engine.html:4381-4384` against `.improvements/2026-09-08T01-36-engine-loop-dom-write-throttle.md` Step 2-3).
- Novelty: **5** — `covered_topics` has `engine-loop-fps-v-textContent-throttle` and `engine-loop-stageFlash-style-opacity-gate` (both from the 2026-09-08T01-36 plan, scoped to engine.html). No plan in 36 prior cycles has proposed the variant-port. Zero matches for `variant-fps-textContent-throttle` or `variant-flash-opacity-gate` in `STATE.json:18-152`.
- **Total: 15/15.**

Tie-break per skill: speed > quality > templates. This is the highest possible score with the preferred type.

**Working-tree compatibility**:
- `git status --short` shows `versions/music_video.html` dirty (226 added lines, all hook detector + panel). The hook detector changes are at lines 359-371 (panel markup), 422 (footer button), 2358-2522 (SWR_HOOK_DETECTOR module), 2764-2809 (panel wiring). The dirty touches do NOT include lines 1337 (fps write) or 1343 (flash write). Safe to patch those lines.
- The 9 in-flight proposals in `STATE.json:2026-09-09T02-29` (`variants-zsort-cache-13-pages`, `variants-zsort-codemod-template-line`, `grid-html-second-zsort-in-grid-render`, etc.) operate on the **layer iteration path** (line 1340 + 1342). They do NOT touch lines 1337 or 1343. No collision.
- No proposed plan in `.improvements/` (37 plans surveyed) targets the variant FPS/flash churn.

**Precedent**: see `engine.html:4313` (FPS counter, ship-target now throttled), `engine.html:4381-4384` (stageFlash, shipped gated), and `engine.html:4443` (`_watermarkFrame: 0, // throttle to ~30fps inside rAF`). The codebase already uses the per-frame counter + interval-check pattern; we mirror it exactly.

**Engine.html delta reference**: the engine.html version of this fix lives in the merge history (the prior plan is fully shipped — `grep -n "_lastFpsWriteAt\|_lastStageFlashOpacity\|_fpsEl" engine.html` returns 3 hits each, confirming the cache + gate fields are present). This plan is the variant mirror of the same pattern, with `fpsEl` + `flashEl` cached at `loop()`'s first invocation (no constructor scope available for the variants — they have inline `<script>` IIFEs).

## Goal

After this plan lands, **none** of the 10 affected variants write `$('fps').textContent` or `$('flash').style.opacity` unconditionally per frame. The FPS counter is throttled to 5 Hz (200 ms interval, same as engine.html). The flash opacity write is gated by a Δ≥0.005 epsilon check (same as engine.html's `stageFlash`). Both element refs are cached once on the first call to `loop()` (no closure-constructor is available for variants — they use top-of-IIFE scoping) instead of `document.getElementById` per frame. `npm run check` passes; the existing variant smoke tests pass with byte-identical rendered frames at 60 fps.

## Plan

### Step 1 — Add per-variant throttle fields + cached element refs in each `loop(t)`

- **Files**: 10 variants. Per file, the loop body sits at:
  - `versions/aurora.html:861`
  - `versions/chrome.html:839`
  - `versions/fractal.html:829`
  - `versions/glitch.html:834`
  - `versions/grid.html:961` (slight variant — see note)
  - `versions/music_video.html:1335` (dirty tree; safe to patch — see compatibility note above)
  - `versions/neon.html:951`
  - `versions/pulse.html:963`
  - `versions/void.html:851`
  - `versions/watercolor.html:872`
- **Action**: in each file's top-of-IIFE (search up from `loop(t)` for the IIFE open `(function () {` or `(async function () {`, plus the `let fps = 0, lastT = ...` declaration line at `versions/aurora.html:859` and the equivalent in every other variant — typically ~3 lines above `loop(t)`), insert the throttle state and cached element refs. Concretely, transform:

  ```js
  // before (example: aurora.html:857-860)
  let fps=0, lastT=performance.now();

  function loop(t) {
  ```

  into:

  ```js
  // after
  let fps=0, lastT=performance.now();
  let _fpsEl = null, _flashEl = null;
  let _lastFpsWriteAt = 0;
  let _lastFlashOpacity = NaN;
  // Cached on first loop() invocation. Variants use inline <script>
  // IIFEs (no constructor scope), so we lazily grab the elements once.
  // FPS throttle: 200 ms = 5 Hz, same as engine.html post-2026-09-08T01-36.
  // Flash opacity gate: Δ≥0.005, same as engine.html's stageFlash.

  function loop(t) {
  ```

  For `versions/grid.html` specifically, the fps write uses `' FPS'` (uppercase) and the flash write uses a local `flash` variable. Use the same shape; only the throttle constants need to match the surrounding style.

- **Verify**: `grep -nE "_fpsEl|_flashEl|_lastFpsWriteAt|_lastFlashOpacity" versions/aurora.html versions/chrome.html versions/fractal.html versions/glitch.html versions/grid.html versions/music_video.html versions/neon.html versions/pulse.html versions/void.html versions/watercolor.html` returns exactly the new field declarations (10 hits for each field — one per file).

### Step 2 — Replace the unconditional FPS write in each variant's `loop(t)`

- **Files**: 10 variants. The replacement is mechanical. Current:
  ```js
  $('fps').textContent = Math.round(fps)+' fps';
  ```
  Replace with:
  ```js
  if (!_fpsEl) _fpsEl = $('fps');
  const nowMs = performance.now();
  if (_fpsEl && nowMs - _lastFpsWriteAt >= 200) {
    _fpsEl.textContent = Math.round(fps) + ' fps';
    _lastFpsWriteAt = nowMs;
  }
  ```
  For `versions/grid.html:963` only, the literal is `' FPS'` (uppercase); preserve that.

- **Verify**: `grep -n "\\\$('fps').textContent" versions/*.html` returns zero matches in the 10 affected files. (Other variants — `baroque`, `kraft`, `mosaic`, `phosphor`, `tape`, `collage`, `eclipse`, `spectrum`, `typography`, `gallery`, `smoke`, `tape` — either don't use the `$('fps')` ID or use different mechanisms; see Out-of-scope.)

### Step 3 — Replace the unconditional flash-opacity write in each variant's `loop(t)`

- **Files**: 10 variants. Current (the dominant shape):
  ```js
  $('flash').style.opacity = A.feat.beat > 0.3 ? String(A.feat.beat*0.4) : '0';
  ```
  Replace with:
  ```js
  if (!_flashEl) _flashEl = $('flash');
  const _opacityNow = A.feat.beat > 0.3 ? A.feat.beat * 0.4 : 0;
  if (_flashEl && (isNaN(_lastFlashOpacity) || Math.abs(_opacityNow - _lastFlashOpacity) >= 0.005)) {
    _flashEl.style.opacity = String(_opacityNow);
    _lastFlashOpacity = _opacityNow;
  }
  ```
  For `versions/grid.html:932` the existing expression is `String(flash)` where `flash` is a local; preserve the upstream value. Specifically, change:
  ```js
  $('flash').style.opacity = String(flash);
  ```
  to:
  ```js
  if (!_flashEl) _flashEl = $('flash');
  if (_flashEl && (isNaN(_lastFlashOpacity) || Math.abs(flash - _lastFlashOpacity) >= 0.005)) {
    _flashEl.style.opacity = String(flash);
    _lastFlashOpacity = flash;
  }
  ```
  For `versions/grid.html:935` the second line (`$('grid').style.opacity = String(Math.min(1, gridOpacity));`) writes a different element (`#grid`, not `#flash`) and is **out of scope** for this plan — leave untouched.

- **Verify**: `grep -nE "\\\$\\('flash'\\)\\.style\\.opacity = A\\.feat\\.beat" versions/*.html` returns zero matches.

### Step 4 — Add a smoke verifier that asserts the throttles fire as expected

- **Files**: new `verify-variant-loop-throttle.mjs` at repo root (matches the `verify-*.mjs` Puppeteer pattern noted in AGENTS.md); wire it as `npm run verify:variant-loop-throttle` in `package.json` next to the existing `verify:*` entries (next to the engine.html throttle verifier shipped in the 2026-09-08T01-36 plan).
- **Action**: open `/versions/aurora.html` (or any of the 10) with a synthetic silent audio file (use the existing `audios/` test asset pattern from the verify scripts — `verify-autoplay.mjs` is the closest precedent). After the page boots, read `document.getElementById('fps').textContent` 30 times at 33 ms intervals (~30 samples across 1 second); assert that the value changed ≤6 times (5 Hz throttle). Read `getComputedStyle(document.getElementById('flash')).opacity` 30 times; assert that the value is constant or changes ≤3 times during silence. The test boots aurora, runs for 2 seconds, exits 0 on pass.
- **Verify**: `npm run verify:variant-loop-throttle` exits 0; the verifier writes a one-line pass/fail summary consistent with the existing `verify-*.mjs` pattern.

### Step 5 — Codemod template stays clean

- **Files**: `versions/_render-inject.js` lines 141-213 (the loop-body rewrite block).
- **Action**: **no change**. The codemod rewrites the draw-loop body (`ctx.fillStyle` + `fillRect` + layer iteration + `drawFx`/`drawMeter`) into a `SWR_RENDER.frame(...)` call. The fps + flash writes sit **outside** the replaced block (after `drawMeter()` but before `requestAnimationFrame(loop)`). Re-running `node versions/_render-inject.js` does not touch them. Confirm by reading the regex at `versions/_render-inject.js:162` — it matches only up to `drawMeter();`, leaving the fps + flash writes untouched. Re-running the codemod post-patch must not regress.
- **Verify**: `node versions/_render-inject.js` on any already-patched variant must produce zero `git diff` lines.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run build` passes (the variants are pure HTML+JS; build output is unchanged in size and content for the throttled lines).
- `npm run verify:variant-loop-throttle` passes (new verifier from Step 4).
- `npm run verify:autoplay` and `npm run verify:hallucination-story` still pass — they exercise variants but don't assert specific per-frame allocation counts, so the visual parity is sufficient.
- `grep -rn "\\\$\\('fps'\\)\\.textContent" versions/{aurora,chrome,fractal,glitch,grid,music_video,neon,pulse,void,watercolor}.html` returns zero matches.
- `grep -rn "\\\$\\('flash'\\)\\.style\\.opacity = A\\.feat\\.beat" versions/{aurora,chrome,fractal,glitch,music_video,neon,pulse,void,watercolor}.html` returns zero matches.
- Manual smoke on at least 2 variants (e.g. `/versions/neon.html` and `/versions/music_video.html`): load a song, watch the FPS readout update 5x/sec (was 60x/sec — the visible cadence change is noticeable to the user), watch the flash still pulse on the beat (the ε-gate preserves the visible beat flashes — beat-driven opacity transitions are ≫0.005 each step).
- `node versions/_render-inject.js` on each patched variant: `git diff` is empty.

## Risks / gotchas

- **`fps` / `flash` are local-scope variables** inside each variant's `loop(t)`. The throttle fields (`_fpsEl`, `_flashEl`, `_lastFpsWriteAt`, `_lastFlashOpacity`) must live at the **outer scope** of the IIFE (sibling of `let fps=0, lastT=performance.now()`), not inside `loop(t)` — otherwise the lazy cache misses the first call and the `Math.abs(_opacityNow - _lastFlashOpacity)` check starts from `NaN` every call. Step 1 places them at the IIFE top for that reason.
- **`grid.html` ships two flash-style writes** (`$('flash')` + `$('grid')`). Only the `$('flash')` one is the throttle target. `$('grid')` is out of scope (different element, different semantic).
- **`hallucination.html` and `film.html` carry the FPS write** but their flash line writes a different element or uses a different expression — they are **intentionally out of scope** for this plan. Adding them later is a separate, smaller PR. See "Out of scope" below for the exact lines.
- **`music_video.html` is on the dirty tree** (uncommitted hook detector). The hook-detector diff does not touch lines 1337 or 1343, but the agent applying this plan should verify the dirty baseline by reading `git diff versions/music_video.html | head -50` before patching. If the diff grows to cover those lines, this plan's Step 2 + Step 3 must be deferred until the hook-detector lands.
- **`_fpsEl` / `_flashEl` lazy grab** means the very first call to `loop(t)` runs an extra `document.getElementById` (one-shot cost). After that, every call is a property read. Net per-frame savings after warmup: 1 `getElementById` removed + ~5 fps writes/sec instead of 60 + ~3 flash writes/sec instead of 60.
- **`_lastFlashOpacity = NaN` initial sentinel** — needed so the very first write fires regardless of `A.feat.beat`. Using `NaN` (not `0`) means the first transition from "never written" to "A.feat.beat > 0.3" passes the gate; using `0` would silently suppress the first visible flash. Documented at engine.html:4381-4384 in the original 2026-09-08T01-36 plan.
- **Throttle constants are hard-coded** (200 ms, Δ≥0.005) — same as engine.html. If a future variant needs different values (e.g. for a 120 Hz display), it can opt-in by overriding the constants locally; the canonical pattern stays the same.

## Out of scope

- **`engine.html`** — already shipped in 2026-09-08T01-36. No work needed.
- **`versions/hallucination.html:1091` FPS write** + the equivalent flash line in that file — they use a different local `flash` derivation (computed from `A.feat.beat * 1.2` inside the engine's own draw cycle, not the simple ternary). Porting them requires reading the surrounding `drawFx` body; do as a follow-up if the user wants full coverage. `versions/film.html:992` FPS write is the same — same `loop(t)` shape, but `film.html` does not carry the `$('flash')` flash-element write at all (the flash effect is baked into the film-grain layer instead).
- **`versions/smoke.html`** — does NOT carry the `$('fps').textContent` or `$('flash').style.opacity` writes. The `z-sort cache` 2026-09-09T00-14 plan covers its layer-iteration churn but not these (because they don't exist). Net effect on smoke.html: zero.
- **`versions/baroque.html`, `kraft.html`, `mosaic.html`, `phosphor.html`, `tape.html`** — these are the 5-variant fleet that loads `fx-postprocess.js`. None of them use `$('fps')` or `$('flash')` directly (the FPS readout is in the canvas-via-canvas HUD, the flash is part of the post-process shader). The 2026-09-08T18-03 plan already covers their WebGL state churn. No work needed.
- **`versions/collage.html`, `eclipse.html`, `spectrum.html`, `typography.html`, `gallery.html`, `tape.html`, `kraft.html`, `mosaic.html`, `baroque.html`, `phosphor.html`** — different layout; their FPS counter (if present) lives inside the canvas-via-canvas HUD pattern. Not the `$('fps').textContent` pattern. Out of scope.
- **Removing the per-variant `$()` helper calls** (the `$` is `document.querySelector.bind(document)` or similar in each file's IIFE). Cheap, but unrelated to the FPS/flash writes — leave for a separate cleanup cycle.
- **Cache invalidation when the user switches variants** — not relevant. The lazy `_fpsEl`/`_flashEl` cache survives across loop iterations within a single page lifetime; the page is destroyed on navigation so no stale-ref risk.

## Follow-ups (for next cycle, NOT this one)

- Port the same pattern to `versions/hallucination.html` and `versions/film.html` if the user wants 100% fleet coverage (these two are the only other variants that carry the FPS-write line; their flash write is either element-absent or computed differently).
- Consider promoting the throttle constants to `engine-render.client.js` as a `SWR_RENDER.throttleFps(...)` / `SWR_RENDER.gateOpacity(...)` helper pair so future variants can call them by API instead of copy-pasting the 5-line block. The codemod template (`versions/_render-inject.js`) is the natural injection point once the API exists.
