# Cache sticky WebGL uniforms in `versions-presets.js` render() — drop ~10 GL calls/frame × 13 engines × 60 fps

**Cycle**: 2026-09-08T09-47
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

`versions-presets.js:render()` (the 60 fps RAF loop for all 13 engine variants) currently issues **20 `gl.uniformXxx()` calls every frame** — including 8-11 that **never change** after the first frame (constants from `preset.mutAlgo`, `preset.vignette`, `preset.blur`, `preset.effect`, `u_page`, `u_tint`) and another 8 that are constant per-preset whenever the automix override is off (the common case: `_temp`, `_mut`, `_chroma`, `_grain`, `_sepia`, `_glow`, `_grayscale`, `_posterize`). WebGL uniforms are **sticky in program state** — once set on a bound program, they remain until the program is switched or the GL context is lost. `gl.useProgram(prog)` is only called once at `:788`, so every one of these re-sends is pure waste.

The fix: split the 20 uniform calls into **3 buckets** and only re-send the ones whose source value actually changed:
1. **Constant uniforms** (mutAlgo, vignette, blur, effect, page, tint) → set once after init.
2. **Preset-static uniforms** (the 8 automix-merged fields when `tempOverride === null && !_fxOverride`) → set once after init, reset on `applyPreset()`.
3. **Per-frame uniforms** (time, bass, mid, treble, beat) → still set every frame (these genuinely change).

Across 13 engines × 60 fps, this drops ~10 GL calls/frame × 780 frames/sec = **~7,800 wasted uniform calls/sec fleet-wide** in steady state. Each `gl.uniform1f` is ~1-3 µs on the JS→GL boundary on lower-end mobile, so the per-session CPU win is on the order of **8-25 ms/sec saved**, and the per-frame latency variance shrinks (no more uniform-thrash bursts).

## Why this cycle

### Scan evidence

`versions-presets.js:840-908` — the `render()` body:
```
840:    function render() {
841:      const now = performance.now();
842:      const t = (now - t0) / 1000;
843:      gl.viewport(0, 0, out.width, out.height);
...
847:      const feat = Audio.feat || {};
848:      const bass = feat.bass || 0;
849:      const mid = feat.mid || 0;
850:      const treble = feat.treble || 0;
851:      const beat = feat.beat || 0;
...
864:        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stageCanvas);
...
870-874:   gl.uniform1f(u.time, t); gl.uniform1f(u.bass, bass); gl.uniform1f(u.mid, mid);
          gl.uniform1f(u.treble, treble); gl.uniform1f(u.beat, beat);
881-890:   _ovFx + 8 ternary expressions to compute _temp, _mut, _chroma, _grain, _sepia,
          _glow, _grayscale, _posterize
891-904:   gl.uniform1f(...) × 14 (uniforms for the 8 mixed fields + 6 statics:
          u.mutAlgo, u.vignette, u.blur, u.effect, u.page (uniform1i), u.tint (uniform3f))
```

Total per-frame GL uniform work: **5 (audio) + 8 (mixed) + 6 (static) = 19 `uniform1f` + 1 `uniform1i` + 1 `uniform3f` = 21 calls**.

### Which uniforms genuinely change every frame?

- **5 audio uniforms**: `u.time`, `u.bass`, `u.mid`, `u.treble`, `u.beat` — always change (time monotonically increases; audio features are float32).
- **8 mixed-field uniforms**: `_temp`, `_mut`, `_chroma`, `_grain`, `_sepia`, `_glow`, `_grayscale`, `_posterize` — change when `tempOverride !== null` OR `window.SWR._fxOverride` is set (the music_video.html self-evolving automixer). When neither is active, these equal `preset.X` which is a constant.
- **6 static uniforms**: `u.mutAlgo`, `u.vignette`, `u.blur`, `u.effect`, `u.page`, `u.tint` — never change after init. `u.page` is `pageIdx = pageKeys.indexOf(pageKey)` which is a fixed constant for the page lifetime. `u.tint = [preset.tint[0], preset.tint[1], preset.tint[2]]` is constant. The other 4 are direct `preset.X` reads with no override path.

### Why uniform calls are expensive

WebGL drivers do not just write a register. For `gl.uniform1f` on a `uniform float`, the driver:
1. Hashes the location (already cached, so cheap).
2. Crosses the JS→native boundary (~1-3 µs each on Android).
3. Validates the location against the active program.
4. Stores the float in the program's uniform-table entry.

The JS side also has overhead: each `gl.uniform1f(u.time, t)` call has 2 function-call frames + 1 type-coercion. Modern V8 inlines `gl.uniform1f` aggressively, but the boundary-crossing is what dominates.

When a uniform is set on a bound program, **its value persists until that program is unbound** (`gl.useProgram(other)`). The driver does NOT re-read it from JS. So sending it again is pure CPU burn.

### Verify the bound-program invariant

`versions-presets.js:788` — `gl.useProgram(prog);` is called **once at init**. No other `gl.useProgram` calls exist in the file:
```
$ grep -nE "useProgram" versions-presets.js
788:    gl.useProgram(prog);
```
That's the only one. After init, the program is permanently bound until the GL context is lost (page reload / tab close). **The cache is safe.**

Also verified that nothing else in the engine hot path calls `gl.useProgram`:
- `fx-postprocess.js:386` — its own `useProgram`, but that's a separate GL context (separate canvas).
- Other engine subsystems (engine-render.client.js etc.) operate on a 2D canvas, not WebGL.

### Why now (freshness)

`covered_topics` audit (per `.improvements/STATE.json`):
- The plan `2026-09-04T08-49-speed-versions-presets-gate.md` covers the early-return when `u_effect < 0.01`, `u_blur < 0.001`, etc. — but that's about **skipping GPU work**, not CPU/JS-bound GL calls.
- `2026-09-04T08-49-speed-versions-presets-uniform-churn` exists per STATE.json — but on inspection that plan covered `u_effect` and `u_tint` only, not the full static-uniform set.
- Zero prior plan touches the **ternary-compute-then-uniform1f** pattern at `:881-890`, which is 8 wasted ternaries/frame.
- Zero prior plan sets up a `_lastSentX` memo for the audio-reactive uniforms (we don't need this for `time/bass/mid/treble/beat` — they always change — but we do need it for the automix path).

### Working tree check

`git status` shows untracked files `._static_server.mjs`, `.worktrees/`, `docs/music-video.md`, `package.json:24-41` — none of these touch `versions-presets.js` or any path this plan edits. Clean area.

## Goal

After this change, the `render()` function in `versions-presets.js` issues:
- **5 uniform calls per frame** (audio-reactive: time, bass, mid, treble, beat) — unchanged.
- **0-8 uniform calls per frame** for the automix-merged fields — only when `tempOverride` or `_fxOverride` actually changes the underlying value.
- **0 uniform calls per frame** for the 6 static fields — set once at init, reset on `applyPreset()`.

Behavior is bit-identical: every uniform ends up at the same value the user sees today. Performance: ~10 fewer GL calls per frame, ~6 fewer redundant JS ternaries, ~6 fewer JS object property reads (the `preset.X` access for the static fields).

## Plan

### Step 1 — set the 6 static uniforms once at init

- **Files**: `versions-presets.js:728-905` (the `init()` function)
- **Action**: Immediately after `sizeFx()` is called at `:837` and BEFORE the first `requestAnimationFrame(render)`, set the 6 static uniforms once. They never change:
  ```js
  // Static uniforms — set once, never re-sent. WebGL uniforms are
  // sticky in program state; useProgram(prog) is only called once at :788
  // so these values persist for the entire page lifetime.
  gl.useProgram(prog);
  gl.uniform1f(u.mutAlgo,  preset.mutAlgo);
  gl.uniform1f(u.vignette, preset.vignette);
  gl.uniform1f(u.blur,     preset.blur);
  gl.uniform1f(u.effect,   preset.effect);
  gl.uniform1i(u.page,     pageIdx);
  gl.uniform3f(u.tint,     preset.tint[0], preset.tint[1], preset.tint[2]);
  ```
  Then **delete** the 6 corresponding lines from `render()` (lines `893, 895, 901, 902, 903, 904`).
- **Verify**: load `versions/neon.html`, check `gl.getUniform(prog, u.mutAlgo)` returns the same value as before the change. Visual check: the page renders identically.

### Step 2 — memoize the 8 preset-static uniforms behind an override cache

- **Files**: `versions-presets.js:732, 840-908`
- **Action**: The 8 automix-merged uniforms (`_temp`, `_mut`, `_chroma`, `_grain`, `_sepia`, `_glow`, `_grayscale`, `_posterize`) need to be re-sent only when the underlying value changed. Add a small memo:
  ```js
  // Memo for the 8 mixed-preset uniforms. Keyed on the active source
  // (override / preset.temp / preset.X). When tempOverride is null AND
  // _fxOverride is null, these match preset.* which never changes — so
  // the 8 uniform1f calls per frame become zero.
  let _lastSent = {
    temp: null, mut: null, chroma: null, grain: null, sepia: null,
    glow: null, grayscale: null, posterize: null,
  };
  function sendIfChanged(name, value) {
    if (_lastSent[name] === value) return;
    _lastSent[name] = value;
    gl.uniform1f(u[name], value);
  }
  ```
  In `render()`, replace the ternary + `gl.uniform1f` blocks (`:883-890, :891, :892, :894, :896-900`) with:
  ```js
  let _ovFx = (window.SWR && window.SWR._fxOverride) || null;
  const _mixFx = _ovFx ? 0.4 : 0;
  sendIfChanged('temp',      tempOverride !== null ? tempOverride : (_mixFx ? preset.temp      * (1 - _mixFx) + (_ovFx.temp      || 0) * _mixFx : preset.temp));
  sendIfChanged('mut',       _mixFx ? preset.mut       * (1 - _mixFx) + (_ovFx.mut       || 0) * _mixFx : preset.mut);
  sendIfChanged('chroma',    _mixFx ? preset.chroma    * (1 - _mixFx) + (_ovFx.chroma    || 0) * _mixFx : preset.chroma);
  sendIfChanged('grain',     _mixFx ? preset.grain     * (1 - _mixFx) + (_ovFx.grain     || 0) * _mixFx : preset.grain);
  sendIfChanged('sepia',     _mixFx ? preset.sepia     * (1 - _mixFx) + (_ovFx.sepia     || 0) * _mixFx : preset.sepia);
  sendIfChanged('glow',      _mixFx ? preset.glow      * (1 - _mixFx) + (_ovFx.glow      || 0) * _mixFx : preset.glow);
  sendIfChanged('grayscale', _mixFx ? preset.grayscale * (1 - _mixFx) + (_ovFx.grayscale || 0) * _mixFx : preset.grayscale);
  sendIfChanged('posterize', _mixFx ? preset.posterize * (1 - _mixFx) + (_ovFx.posterize || 0) * _mixFx : preset.posterize);
  ```
- **Important**: when `tempOverride` is null AND `_ovFx` is null (the common case for non-music_video pages), all 8 `sendIfChanged` calls return after one `===` comparison → **zero GL calls, zero ternary evaluation** (the `_mixFx ? ...` short-circuits because `_mixFx === 0`). Wait — actually with `_mixFx === 0`, the JS engine evaluates `_mixFx ? ... : preset.X` as the `preset.X` branch. So we still do 8 ternary evaluations per frame. To skip those too, add a guard:
  ```js
  const _staticsChanged = _mixFx > 0 || tempOverride !== null;
  if (!_staticsChanged) {
    // All 8 mixed fields equal their cached preset.* value; nothing to send.
    // The render path skips 8 ternaries + 8 GL calls.
  } else {
    sendIfChanged('temp', ...);
    // ... etc
  }
  ```
  The `_staticsChanged` branch flips to `true` only when automix is enabled OR the temp slider has been moved. In the common case it's `false` forever.
- **Verify**: with the change, when no override is set, the 8 mixed-uniform calls produce zero GL traffic after the first frame. Manual: open `versions/neon.html`, in DevTools hook `gl.uniform1f` and confirm only 5 calls per frame (`u.time`, `u.bass`, `u.mid`, `u.treble`, `u.beat`).

### Step 3 — invalidate the memo when `applyPreset()` swaps the preset

- **Files**: `versions-presets.js:969-1002` (`applyPreset`)
- **Action**: When `applyPreset(pageKey)` runs and the pageKey matches the current page (which it always does in this file — the IIFE is per-page), reset `_lastSent` and re-send the 8 mixed uniforms. Otherwise an `applyPreset('film')` call would leave the screen looking like the previous preset.
  ```js
  applyPreset(pageKey) {
    var preset = PRESETS[pageKey];
    if (!preset) return false;
    // ... existing FX.setPersona call ...
    _state[pageKey] = _state[pageKey] || {};
    _state[pageKey].tempOverride = preset.temp || 0;
    // The render loop is per-page; this is the current page's preset.
    // Re-send the 8 mixed fields so the swap is immediately visible.
    _lastSent.temp = null; _lastSent.mut = null; _lastSent.chroma = null;
    _lastSent.grain = null; _lastSent.sepia = null; _lastSent.glow = null;
    _lastSent.grayscale = null; _lastSent.posterize = null;
    // ... existing dispatchEvent ...
    return true;
  }
  ```
- **Verify**: open `versions/neon.html`, in console: `VersionsPresets.applyPreset('film')` — the screen should immediately switch to film look. Before this step, the static uniforms stay stale on the old preset; the change is invisible.

### Step 4 — also re-send on `setTemp()` override change

- **Files**: `versions-presets.js:942-948` (`setTemp`)
- **Action**: When `setTemp(pageKey, v)` runs and `pageKey === currentPageKey`, set `_lastSent.temp = null` so the next render frame picks up the new temp value.
  ```js
  setTemp(pageKey, v) {
    v = Math.max(-1, Math.min(1, +v || 0));
    if (!PRESETS[pageKey]) return false;
    _state[pageKey] = _state[pageKey] || {};
    _state[pageKey].tempOverride = v;
    if (pageKey === pageKey) {  // trivially true; this IIFE is per-page
      _lastSent.temp = null;
    }
    return true;
  },
  ```
- **Verify**: drag the temp slider on `versions/neon.html` (versions/_temp-slider.js wires it to `VersionsPresets.setTemp`). Color temperature should change on the very next frame. Before this step, the first `setTemp` call doesn't re-send (cache holds the old preset.temp), and the visual update is delayed until a resize or override event.

### Step 5 — verify no caller relies on uniform re-send semantics

- **Files**: every `versions/*.html`, `versions/_temp-slider.js`, `versions/music_video.html`, `client/automix.client.js`
- **Action**: Audit which entry points touch the uniforms:
  - `versions/_temp-slider.js` — calls `VersionsPresets.setTemp(currentKey, v)` on slider input. Step 4 covers this.
  - `versions/music_video.html` (via `client/automix.client.js`?) — sets `window.SWR._fxOverride`. The override is read every frame, so when it changes the next frame's `_mixFx > 0` short-circuit trips and the 8 mixed fields are recomputed and sent. Already correct.
  - `applyPreset()` callers — keyboard map in `engine-keys.client.js`, marketplace card clicks, etc. Step 3 covers this.
  - Initial load: `init()` reads `PRESETS[pageKey]` and binds uniforms. Step 1 covers the static set; the per-frame block at Step 2 picks up the 8 mixed fields on the first frame.
- **Verify**: `grep -rn "_fxOverride\|setTemp\|applyPreset" --include="*.js" --include="*.html" versions/ client/ lib/` and confirm the audit result is "all paths covered".

## Verification

- `npm run check` passes — `versions-presets.js` is global-script (no syntax issues expected).
- `npm run build` passes — Vite bundles `versions-presets.js` as-is.
- `npm run verify:render-dpr` (or any variant verify) passes — exercises the render loop on a real engine page.
- Manual perf check: open `versions/neon.html` in Chromium with DevTools Performance trace, record 10 seconds, count `gl.uniform1f` calls:
  - **Before**: ~780 calls (13 per frame × 60fps × 10s).
  - **After**: ~3000 calls total = 5 per frame × 60fps × 10s = ~3000 calls. Wait, that's wrong. Before = 13/frame × 600 frames = 7800. After = 5/frame × 600 = 3000. Net: ~4800 fewer calls. The 6 static uniforms sent once at init = 6 calls; the 8 mixed sent on frame 1 then 0 thereafter (since no override) = 8 calls. First frame total = 19. Subsequent frames = 5. Across 600 frames = 6 + 8 + 5×599 = ~3009.
  - Actually that's 19 → 5 per frame after the first → 4800 saved per 10s trace. On a 1-minute trace: ~28,800 fewer `uniform1f` calls.
- Visual check: load each of `versions/neon.html`, `versions/film.html`, `versions/grid.html`, `versions/eclipse.html`, `versions/aurora.html`. Confirm the visual matches the prior behavior bit-for-bit. (No perceptual difference — same values, fewer calls.)
- Smoke the temp slider on `versions/neon.html` (if the slider is exposed) or use the keyboard shortcut to swap presets (`SWR_ENGINE_KEYS` shortcut map). Confirm the change is immediate.
- Confirm `versions/music_video.html` self-evolving automix still updates (the override path is explicitly covered in Step 2's `_staticsChanged` branch).

## Risks / gotchas

- **Worktree divergence**: `.worktrees/feat-auto-20260908-4ba8247d/versions-presets.js` should be byte-identical or near-identical to main (verified `git status` shows the worktree dir, not file modifications). The fix lands in both on the next sync. No extra risk.
- **`tempOverride` initial value**: `let tempOverride = null;` at `:732` is module-scope to `init()`. After init, only `setTemp()` mutates it. Step 4's invalidation handles that. If a third path mutates `tempOverride` outside `setTemp`, audit Step 5 catches it.
- **`_fxOverride` is a `window.SWR` property** — the code reads `window.SWR && window.SWR._fxOverride` every frame. The memo doesn't cache this; the read is cheap (~0.1 µs). No risk.
- **`u.tint` change after init**: the only path that mutates `preset.tint` would be `applyPreset()` from another page's preset, which can't happen because the IIFE is per-page. Step 3 invalidates `_lastSent` (which doesn't currently include tint — tint is set once at init per Step 1). If `applyPreset()` from another pageKey ever did need to change `u.tint`, we'd add it to the memo; for now it's set once at init only.
- **`gl.uniform1i` for `u.page`**: GL ES requires `uniform1i` for int uniforms and `uniform1f` for floats — the existing code is correct. The cache key for int uniforms uses `===` which works the same way. No risk.
- **`sendIfChanged` name resolution**: `u[name]` is a property lookup on a precomputed `u` object — V8 caches the hidden class so this is ~30 ns per access. Fine for the 8×60×13 = ~6,240 accesses/sec.
- **`applyPreset()` race with render()**: if `applyPreset()` runs in the middle of a frame (between `sendIfChanged` for `temp` and `sendIfChanged` for `mut`), some fields get the new preset and some get the old. This is a 1-frame visual blip at worst and matches the existing behavior (the ternary path has the same race). No regression.
- **Multi-page scenarios**: the `applyPreset()` step is per-page — the current page is the one that loaded this `versions-presets.js` IIFE. Calling `applyPreset('film')` from `versions/neon.html` does swap the preset correctly because `_lastSent` is reset and the render loop picks up the new preset object on the next frame.

## Out of scope

- Removing the `_ovFx` ternary pattern entirely and routing the automix through a different channel (e.g. directly mutating `preset` with a deep-merge) — that's a refactor, not a perf win, and would change the override semantics. Out of scope.
- Caching the audio uniform updates (`u.bass`, `u.mid`, etc.) — these genuinely change every frame and re-sending is correct.
- Sharing the static-uniform-send logic with `fx-postprocess.js` — that file has its own program/uniform lifecycle and a different set of 14 FX. Out of scope; could be a future `quality` plan.
- Removing the now-dead `_temp` ternary in the no-override path — Step 2's `_staticsChanged` guard already short-circuits before the ternary is evaluated, so removing the ternary wouldn't save anything measurable. Leave it for code clarity (the ternary documents the override path).
- Touching the GLSL shader source to expose uniform blocks / UBO. Modern WebGL1 doesn't reliably support UBOs; this is a WebGL2 refactor with its own can of worms. Out of scope.
