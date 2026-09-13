# Gate redundant WebGL uploads and draws in the variant preset pipeline

**Cycle**: 2026-09-04T08-49
**Type**: speed
**Priority**: P1
**Estimated effort**: M

## TL;DR

`versions-presets.js` runs a WebGL full-screen post-process loop for 13 variant pages. Every RAF currently calls `gl.pixelStorei`, uploads the complete `#render` backing store with `gl.texImage2D`, writes 17 uniforms, and calls `gl.drawArrays`, even when the source canvas and shader inputs have not changed. The separate `fx-postprocess.js` path already has an inactive-FX short circuit, but the variant-specific pipeline has no equivalent source/input gate. Add allocation-free invalidation state and skip the GPU pass when source, audio, preset, temperature, dimensions, and any time-dependent inputs are unchanged; preserve the existing upload-side Y flip. This should remove redundant texture uploads and full-screen draws from static/idle sessions without altering animated pages or output orientation.

## Why this cycle

The scan covered clean engine source areas after excluding unrelated user work: root-level PNG deletes, the untracked `references/` tree, and untracked `.improvements/` artifacts. The latest commit is `7594d9d feat(library): add 20 transparent PNG preset graphics (p36–p45) in Bauhaus geometric style`. Relevant recent history is `d7bbed8 fix(versions-presets): flip Y on WebGL texture upload — real fix`, `5e135f1 fix(fx): flip Y on WebGL texture upload to align with 2D canvas`, and `5feb82d feat(sprint): smoother audio + one cool flourish per visualizer`. No current untracked or staged file touches `versions-presets.js`, so this proposal does not compete with an in-progress edit in the target area.

`versions-presets.js` is 992 lines. Its WebGL loop is at `versions-presets.js:840-893`:

- `:841-843` reads `performance.now()`, derives `t`, and sets the viewport every frame.
- `:845-851` reads `bass`, `mid`, `treble`, and `beat` on every frame.
- `:853-864` activates/binds the texture, sets `gl.UNPACK_FLIP_Y_WEBGL`, and uploads `stageCanvas` with `gl.texImage2D` on every frame.
- `:870-888` unconditionally writes 17 scalar/vector uniforms: 17 `uniform1f` calls at `:870-886`, one `uniform1i` at `:887`, and one `uniform3f` at `:888`.
- `:890-891` draws the full-screen quad and schedules the next RAF.

The code has no `lastSourceFrame`, `lastAudioSignature`, or `needsDraw` state in this loop. A source upload and full-screen draw therefore happen once per RAF per affected page. At a 60 Hz RAF, one page performs about 60 full backing-store uploads and 60 full-screen draws per second before considering the 12 other pages.

The loader split matters. A scan of `versions/*.html` found 13 pages loading `versions-presets.js`: `aurora`, `chrome`, `eclipse`, `film`, `fractal`, `glitch`, `grid`, `hallucination`, `neon`, `pulse`, `smoke`, `void`, and `watercolor`. Five other pages (`baroque`, `kraft`, `mosaic`, `phosphor`, `tape`) dynamically load `fx-postprocess.js`; they are not in scope. Patching only `fx-postprocess.js` would not fix the 13-page path.

The separate `fx-postprocess.js` implementation already short-circuits completely when persona FX is inactive at `fx-postprocess.js:441-463`, but that condition cannot simply be copied: `versions-presets.js` has page-specific `effect`/`tint` values and shader branches in its own `FRAG` source. The actual variant loop must decide whether its own source and uniforms changed.

Static inputs are available near the loop: `preset` and `tempOverride` are captured at `versions-presets.js:728-732`, `pageIdx` is derived once at `:833-835`, and audio values are read at `:846-851`. The upload-side Y-flip fix at `:856-864` must remain on every actual upload. `sizeFx()` at `:743-753` changes `out.width`/`out.height`; a resize must invalidate the first post-resize pass.

Time needs explicit treatment. The shader source at `versions-presets.js:104-147` and `:160-709` contains time-dependent mutation, liquid, pearl, glitch, grain, and page-effect paths. A gate must not treat every elapsed RAF as a reason to redraw when the current configuration is static, but it must not freeze a page whose current shader branch is animated. If exact branch classification is not safe, use a conservative `timeAnimated` policy: only enable idle-frame skipping for an explicitly proven static configuration, and keep existing every-frame behavior for all other configurations.

Prior plans already cover the live FX uniform path (`2026-09-01T15-42-speed-fx-uniform-skip`), render-cache key work, timing/LFO allocations, offscreen canvases, and variant `extraDraws` arrays. None proposes a source/input gate for `versions-presets.js`; `git log -- versions-presets.js` shows the latest target-file work is the Y-flip fix and preset wiring, not this optimization.

## Goal

For every page that loads `versions-presets.js`, an unchanged source frame and unchanged shader inputs must not issue another `texImage2D` upload or `drawArrays`; any source, audio, preset, temperature, resize, or required time change must still produce the same correctly oriented output as before.

## Plan

### Step 1 — Discover or add a cheap source-frame revision

- **Files**: `versions-presets.js:840-851`, `engine-render.client.js` frame completion path around `:335-430`, and the common render paths in `versions/*.html`.
- **Action**: Search the source tree for an existing monotonic render/frame revision or dirty token before adding one. Check `SWR_RENDER`, `markDirty`, `requestAnimationFrame`, and any `stage` draw completion hook. If a suitable revision exists, consume it from `versions-presets.js`.

  If no suitable revision exists, add the smallest shared hook to the renderer that owns `#render`: increment `window.SWR_RENDER_FRAME_ID` exactly once after a completed draw into the source canvas. If some variant pages bypass `SWR_RENDER.frame()`, add the same increment to their common source-render completion path rather than copying bespoke logic into 13 files. Keep this token separate from the post-process RAF so the WebGL loop cannot advance its own token and defeat the gate.

  Initialize the consumer's previous token to a sentinel so the first render always uploads and draws. If a source revision cannot be made reliable across all variants, use a conservative fallback for those pages: retain current per-frame rendering instead of skipping frames whose source freshness cannot be proven.

- **Verify**: `grep -R -n "SWR_RENDER_FRAME_ID\|markDirty\|requestAnimationFrame" versions engine-render.client.js` identifies the chosen producer and consumer. In a running page, log the revision around two source renders and two post-process RAFs; it must advance with source draws, not with every post-process tick.

### Step 2 — Define the time-animation policy

- **Files**: `versions-presets.js:104-147`, `:160-709`, and `:840-851`.
- **Action**: Add a local `timeAnimated` decision for the initialized page. Prefer an explicit field in the preset/page configuration when the shader branch is known to be static. Otherwise classify the configuration conservatively: if the active mutation, liquid, pearl, glitch, grain, or page-effect branch uses `u_time`, set `timeAnimated = true`. Do not remove animation from a page merely because its source canvas is static.

  The gate must use the following truth table:

  | Configuration | Source unchanged | Audio unchanged | Result |
  |---|---:|---:|---|
  | Proven static | yes | yes | skip upload and draw |
  | Proven static | no | either | upload and draw |
  | Proven static | either | no | upload and draw |
  | Time-animated | either | either | draw each eligible animation tick |
  | Any configuration after resize | either | either | upload and draw once at new dimensions |
  | First initialized frame | either | either | upload and draw |

  If all shipped page presets are animated under the conservative shader analysis, still implement the input signature and a test-only static configuration. That keeps the gate correct and ready for future static presets, but do not claim production idle-frame savings where the shader policy does not permit them.

- **Verify**: Add the truth table as a code comment next to the gate. Inspect every `u_time` use in the active page-effect branch and confirm the chosen `timeAnimated` value cannot freeze a visible animation. A static test preset must render the same pixels when its RAF is allowed to run repeatedly.

### Step 3 — Gate texture upload and draw before touching WebGL upload state

- **Files**: `versions-presets.js:837-891`.
- **Action**: Refactor `render()` to compute current inputs before `gl.activeTexture`, `gl.bindTexture`, `gl.pixelStorei`, and `gl.texImage2D`. Track previous successful values in scalar locals or a fixed primitive signature; do not construct a new object or array on the skipped RAF path.

  The invalidation check must include:

  - source-frame revision from Step 1;
  - `out.width` and `out.height`;
  - `bass`, `mid`, `treble`, and `beat` (or one reliable audio revision if the audio subsystem exposes one);
  - effective temperature: `tempOverride !== null ? tempOverride : preset.temp`;
  - all preset values sent to `u.mut`, `u.mutAlgo`, `u.posterize`, `u.vignette`, `u.chroma`, `u.grain`, `u.sepia`, `u.glow`, `u.grayscale`, `u.blur`, `u.effect`, `u.page`, and `u.tint`;
  - elapsed time only when `timeAnimated` is true.

  Keep the current sequence on a real draw: set the viewport, activate/bind the texture, set `UNPACK_FLIP_Y_WEBGL` to `true`, upload `stageCanvas`, write the uniforms, call `gl.drawArrays(gl.TRIANGLES, 0, 6)`, then record the last-successful signatures. On a skip, schedule the existing RAF and return before the upload. Keep the existing upload `try/catch` at `:853-868`; if upload fails, do not record the new signature, so the next frame retries. Treat a draw failure/context loss similarly: leave the gate dirty until a successful pass completes.

  Use scalar comparisons if possible. If a string signature is used, construct it only after deciding a draw is needed or prove that the signature's cost is negligible compared with the avoided upload; never add `JSON.stringify` or a per-frame object/array signature.

- **Verify**: Add temporary development counters for `texImage2D` and `drawArrays`. On a proven-static configuration, wait for the first pass, then 120 RAFs with no source/audio/input changes: expect one successful upload/draw and no further passes. Change source revision, each audio feature group, temperature, preset, and dimensions independently; each must cause a subsequent successful pass. Remove temporary counters unless they become a narrowly scoped test hook.

### Step 4 — Preserve uniform correctness and avoid unsafe partial caching

- **Files**: `versions-presets.js:800-822` and `:870-888`.
- **Action**: Prefer Step 3's whole-pass gate over a complicated uniform-only cache. When a draw is required, keep writing every currently required uniform in the existing order; this guarantees that a source change, resize, or context restoration cannot reuse stale WebGL state. If measurement shows static uniform writes remain significant on animated pages, add allocation-free per-uniform last-value caches only after the whole-pass behavior is covered.

  If adding per-uniform caches, update cache values only after each WebGL call succeeds, invalidate every cache on initialization, resize, and context restoration, and handle `u.tint` as three scalar components. Never skip an upload/draw merely because uniform values are unchanged when the source frame changed. Keep `u.page` and `u.tint` bound to the current page's `pageIdx` and `preset.tint`.

- **Verify**: A stub WebGL harness or development counter must show that a skipped frame makes no uniform calls, while every actual draw still writes the full required uniform set. Test first draw, skipped frame, audio-only change, source-only change, preset-only change, resize, and simulated context reinitialization.

### Step 5 — Invalidate all existing mutation and resize paths

- **Files**: `versions-presets.js:743-753`, `:895-903`, and `:923-985`.
- **Action**: Ensure the gate observes or explicitly invalidates every current input mutation:

  - `sizeFx()` invalidates when `out.width` or `out.height` changes. This covers both the debounced `window.resize` listener and `ResizeObserver`.
  - `setTemp(pageKey, v)` invalidates the current page when the effective temperature changes.
  - `applyPreset(pageKey)` invalidates when any applied FX value, page effect, or tint changes.
  - Audio changes are detected through the render-loop scalar comparisons or audio revision; do not install one new event listener per page unless an existing reliable audio event is already available.
  - A source-frame revision change invalidates even if the source dimensions and uniforms are unchanged.

  Do not call `render()` synchronously from setters. Preserve the existing public `window.VersionsPresets` methods, return values, event dispatch, and `tempOverride` behavior. Do not allow an unrelated page's preset state to invalidate or draw another page's WebGL context.

- **Verify**: Exercise `setTemp()` and `applyPreset()` on a running variant and confirm the next eligible frame draws once. Resize the source canvas and confirm `out` dimensions update and one fresh upload occurs. Update the source canvas without a DOM resize and confirm the source revision, not layout observation, triggers the pass.

### Step 6 — Add a focused regression verifier

- **Files**: new `verify-versions-presets-gate.mjs`, `package.json:24-41` (scripts), and any shared source-render file changed in Step 1.
- **Action**: Follow the repository's standalone Puppeteer verifier style from `verify-new-versions.mjs` and `verify-versions.mjs`. Add a `verify:versions-presets-gate` script entry. The verifier should:

  1. Start or connect to the local Vite server using the same mechanism as the existing version verifiers.
  2. Open a representative page that definitely loads `versions-presets.js`, such as `versions/film.html` or `versions/neon.html`.
  3. Install a test-only counter or hook before initialization so it can count successful `texImage2D` uploads and `drawArrays` calls without altering production behavior.
  4. Assert that initialization produces a non-blank output and at least one upload/draw.
  5. Exercise a proven-static configuration or a fixture where time animation is disabled; wait across many RAFs with no input change and assert no additional pass.
  6. Change source revision, audio, temperature, and resize one at a time and assert each causes a pass.
  7. Assert that the upload path still sets `UNPACK_FLIP_Y_WEBGL` and use an asymmetric fixture or the existing orientation check so a vertically flipped regression cannot pass.

  If browser instrumentation cannot safely intercept WebGL calls, expose a development-only `window.__SWR_VERSIONS_PRESETS_STATS` object guarded by an unmistakable test flag. Do not ship a default console logger or a production-only test bypass.

- **Verify**: `npm run verify:versions-presets-gate` exits 0 locally and fails when the gate is intentionally disabled in a temporary test edit. The verifier must clean up its server/browser process on both pass and failure.

### Step 7 — Run repository gates and compare output

- **Files**: no additional source changes.
- **Action**: Run `npm run check`, `npm run build`, and the focused verifier. Run the existing relevant checks `npm run verify:versions` or `node verify-new-versions.mjs` (whichever is present and covers the target pages), `npm run verify:genops`, and `npm run verify:render-dpr` if available in `package.json`. Capture representative screenshots or canvas hashes for a source/input sequence before and after the change.

- **Verify**: All required commands exit 0; no affected page logs WebGL compile/link errors; output remains non-blank; and the before/after pixels match for the same source, audio, preset, dimensions, and time samples. For an animated page, compare at equivalent time/input points rather than byte-comparing frames captured at different wall-clock times.

## Verification

- `npm run check` passes: syntax, manifest, bundle, and API tests.
- `npm run build` passes and emits the updated `versions-presets.js` into `dist/`.
- `npm run verify:versions-presets-gate` passes with the expected upload/draw counters.
- Existing version/render smoke checks pass, including `verify-genops.mjs` and `verify-render-dpr.mjs` where wired.
- Proven-static case: one initial successful upload/draw, then zero additional passes over 120 RAFs with identical source/input state.
- Invalidation case: source revision, audio, temperature, preset, and resize each cause a fresh successful pass.
- Orientation case: upload keeps `gl.UNPACK_FLIP_Y_WEBGL` enabled and an asymmetric fixture is not vertically inverted.
- Animated case: any page/configuration classified as time-dependent continues to redraw and animate as before.

## Risks / gotchas

- **Freezing an animated shader**: `u_time` is used in several shader branches. Use an explicit/conservative `timeAnimated` policy; never skip an active time-dependent branch merely because `#render` is unchanged.
- **No reliable source revision**: a DOM resize or `stageCanvas` object identity is not enough to detect source redraws. Add one shared monotonic completion token or keep the affected path conservative and un-gated until freshness is provable.
- **Failed upload poisoning the cache**: record last-successful signatures only after `texImage2D` and `drawArrays` complete. A caught upload error must make the next RAF retry.
- **WebGL context restoration**: if the context/program/texture is recreated, clear all gate and uniform-cache state so the first frame repopulates the GPU.
- **Y orientation regression**: do not move or delete `gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)` without an asymmetric visual test. The fix belongs in `versions-presets.js`, which is the loader used by the 13 affected pages.
- **Audio value churn**: compare the same normalized values that are sent to uniforms. Avoid a signature based on transient object identity or a feature object that is recreated every frame.
- **Multiple RAF loops**: the source renderer and post-process renderer must not share one scheduler or cancel each other's RAF. The gate only decides whether the WebGL work is needed; it still schedules the existing render callback.
- **Test-only instrumentation leakage**: keep counters behind a test flag or remove them before landing. Do not add production console output in the hot loop.

## Out of scope

- Patching the separate `fx-postprocess.js` loop; its inactive-FX gate is a different path and is already covered by the prior FX plan.
- Rewriting the fragment shader, changing page presets, or changing visual timing/animation semantics.
- Replacing `texImage2D` with WebGL2/PBO/WebCodecs/worker architecture.
- Adding `OffscreenCanvas` or moving the variant WebGL pass to a worker.
- Changing the public shape of `window.VersionsPresets`, `window.FX`, or the recorder's `outputCanvas` contract.
- Touching the five pages that load `fx-postprocess.js` instead of `versions-presets.js`.
- Treating a test fixture's static mode as evidence that all production page presets are static.
