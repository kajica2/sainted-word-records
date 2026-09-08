# FX postprocess: skip uniform writes when value unchanged, drop shader pass when uniforms are static

**Cycle**: 2026-09-01T15-42
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

`fx-postprocess.js` issues **20 `gl.uniform1f` calls per RAF tick** every frame
once any persona/preset uniform is non-zero — the common case. None of the
calls are gated on "did this value change since last frame?". Most persona
uniforms (posterize, vignette, chroma, grain, sepia, glow, grayscale, blur,
liquid, pearl, glitch) change rarely (only on user input or preset apply);
`temp`/`mut` change even less. This plan (a) caches last-written uniform
values and skips `gl.uniform1f` when the value is byte-identical, and (b)
skips the *entire* shader pass when none of the uniforms AND audio features
have changed since the last draw, since the output is bitwise-identical.
On a typical preset session with one persona effect on, this drops the FX
pass from ~20 uniform writes + 1 GPU upload + 1 drawArrays to ~5 writes (time
+ 4 audio) per frame — a measurable win on mobile GPUs and a battery saving
on laptops.

## Why this cycle

Scanned `fx-postprocess.js` for hot-path allocations / wasted GPU work:

- `fx-postprocess.js:510-528` — 20 `gl.uniform1f` calls, all unconditional.
  The block sits inside the per-RAF `render()` loop (`fx-postprocess.js:448`).
  None compare against a previously-written value.
- `fx-postprocess.js:489-495` — audio features (`bass`, `mid`, `treble`,
  `beat`) are read into `state.*` every frame even when
  `SWR.Audio.feat._v` hasn't ticked (the audio module bumps `_v` only when
  features actually change — see `engine-*.client.js` audio reactor code).
- `fx-postprocess.js:441-447` — `anyFxActive()` already short-circuits when
  ALL persona uniforms are 0, so the gate exists for the cold-start case.
  It does *not* help once any single effect is on (the common preset).
- `fx-postprocess.js:497-507` — `gl.texImage2D` upload happens every frame
  the shader runs, regardless of whether the stage canvas has actually
  changed. The stage canvas re-renders every frame for `engine-render` but
  the *output* is identical when nothing in the composition changed (no
  audio, no reactor). For muted sessions this is pure waste.

These are the exact files / lines a follow-up agent should touch. No new
APIs, no spec changes.

## Goal

After this lands, the FX pass issues the minimum necessary `gl.uniform1f`
calls and `gl.texImage2D` uploads per frame, while producing pixel-identical
output to today's build (verified via frame-hash regression in
`verify-css-fx.mjs`).

## Plan

### Step 1 — Cache last-written uniform values, skip identical writes

- **Files**: `fx-postprocess.js:400-421` (uniform location object) and
  `fx-postprocess.js:510-528` (the 20 uniform writes inside `render()`).
- **Action**: Extend the `u` object so each entry tracks `lastWritten`
  (a number). Wrap the writes in a small helper:

  ```js
  function setU(key, v) {
    if (u[key].lastWritten !== v) {
      gl.uniform1f(u[key], v);
      u[key].lastWritten = v;
    }
  }
  ```

  Replace each `gl.uniform1f(u.time, state.time);` etc. with
  `setU('time', state.time);`. Initialise `lastWritten = NaN` so the first
  frame always writes.

- **Verify**: `npm run check:syntax` and `npm run build` both pass.
  `npm run verify:css-fx` still passes (frame-hash matches expected persona
  output — if it doesn't, the regression caught a real bug).

### Step 2 — Skip the GPU upload + draw when nothing changed

- **Files**: `fx-postprocess.js:489-530` (inside `render()`, after the
  `anyFxActive()` gate at line 457).
- **Action**: Track `lastAudioHash` (a 1-decimal-rounded hash of
  `bass|mid|treble|beat` mirroring `engine-render.client.js:audioFingerprint`
  semantics). Track `lastTimeBucket` (Math.floor(state.time / N) for some
  small N like 4 — fbm/voronoi patterns advance visibly at ~4fps; finer than
  that is sub-perceptual). When `state.time` bucket + audio hash + all
  persona uniform values match the previous frame, skip `gl.texImage2D`,
  skip all `setU(...)` calls (none will write anyway), and skip
  `gl.drawArrays` — just `requestAnimationFrame(render)` and exit.
  On the resume-from-skip frame, force-write everything once.

  Implementation sketch (insert before the resize block):

  ```js
  const audioHash = state.bass.toFixed(1) + '|' + state.mid.toFixed(1) +
                    '|' + state.treble.toFixed(1) + '|' + state.beat.toFixed(1);
  const timeBucket = Math.floor(state.time * 4);  // ~4 fps animation step
  const personaKey = state.temp + '|' + state.mut + '|' + state.mutAlgo +
    '|' + state.posterize + '|' + state.vignette + '|' + state.chroma +
    '|' + state.grain + '|' + state.sepia + '|' + state.glow +
    '|' + state.grayscale + '|' + state.blur + '|' + state.liquid +
    '|' + state.pearl + '|' + state.glitch;
  if (audioHash === state._lastAudioHash && timeBucket === state._lastTimeBucket &&
      personaKey === state._lastPersonaKey) {
    requestAnimationFrame(render);
    return;
  }
  state._lastAudioHash = audioHash;
  state._lastTimeBucket = timeBucket;
  state._lastPersonaKey = personaKey;
  ```

  Initialise the three `_last*` to unique sentinels so the first frame
  always draws.

- **Verify**: `npm run verify:css-fx` — the existing persona-output frame
  hash should match. If it doesn't, the regression caught a real visual
  delta; investigate the personaKey bucket precision (try `toFixed(2)`).

### Step 3 — Add a perf-instrumented verifier

- **Files**: new file `verify-fx-skip.mjs` at repo root (matches the
  `verify-*.mjs` convention; see AGENTS.md "Testing instructions").
- **Action**: Puppeteer harness that:
  1. Opens `engine.html` with a known preset + persona (e.g.
     `?preset=demo&persona=film`).
  2. Loads `window.FX` and asserts the new skip path fires. Inject a
     `performance.measure` counter around the FX render — count uniform
     writes via `gl.getError()` before/after or via a counter on `setU`.
  3. Drives audio to silence for 2s, asserts uniform writes drop to ≤5/frame
     (only `time` and the 4 audio uniforms).
  4. Resumes audio, asserts writes climb back to the per-frame pattern.
  5. Snapshots a frame hash and compares to the pre-change reference.

- **Verify**: `node verify-fx-skip.mjs` exits 0 with the perf-delta logged.
  Wire it as `npm run verify:fx-skip` in `package.json` next to the other
  `verify:*` scripts.

### Step 4 — Update the FX source comment

- **Files**: `fx-postprocess.js:434-447` (the existing `anyFxActive` block
  and its explanatory comment).
- **Action**: Update the comment to describe the new layered short-circuit:
  1. `!state.enabled` → skip (already exists)
  2. `!anyFxActive()` → skip (already exists)
  3. *new* — `personaKey + audioHash + timeBucket` unchanged → skip
  4. Otherwise draw.

  Keep the `t0` reset on the inactive→active transition (already exists
  at line 476 — verify it still fires correctly when the new step 3 short-
  circuit also exits via `requestAnimationFrame(render)`).

- **Verify**: `npm run check:syntax` + manual read of the diff to confirm
  the comment accurately describes the new control flow.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run build` passes — `dist/` rebuilds cleanly with no new warnings.
- `npm run verify:css-fx` passes with frame-hash equal to the pre-change
  reference (catches accidental visual regressions from the skip).
- `node verify-fx-skip.mjs` exits 0 and reports a measurable drop in
  uniform writes per frame on idle audio (target: ≥75% reduction).
- Manual smoke: open `engine.html` in a browser, enable a single persona
  (e.g. film), pause audio — observe via DevTools Performance that the FX
  frame no longer logs `texImage2D` or `uniform1f` calls beyond the time
  tick.

## Risks / gotchas

- **PersonaKey precision**: using `+` to concatenate floats loses precision.
  If two near-equal values land on opposite sides of a bucket boundary the
  skip will fire falsely. Mitigation: `toFixed(4)` on each uniform before
  concatenation.
- **Audio feature memo TTL**: `engine-render.client.js` already throttles
  its audio hash to 32ms. The FX skip should match this — using
  `Math.floor(state.time * 4)` (250ms buckets) is far coarser and safe, but
  if you wire `audioHash` to the same 32ms TTL as `engine-render` you'd need
  a separate memo, which isn't worth it. The 250ms bucket is fine because
  beat-driven FX is already perceived at 4-8fps.
- **Recorder captureStream()**: `window.FX.outputCanvas` is captured by the
  recorder. The skip must NOT cause the canvas to "freeze" visibly — but
  since we're skipping frames that are bitwise identical to the last
  drawn frame, the canvas content is already identical. The captureStream
  pulls whatever is currently on the canvas; no change.
- **First-frame correctness**: the `_last*` sentinels must be unique so
  the first frame always draws. Use `null` (not a string) and the
  `audioHash === null` test will fire on frame 0. Same for the `u.*.lastWritten`
  initial `NaN` — the `!==` test against any number is `true` so the first
  frame writes every uniform, as desired.

## Out of scope

- Changing the shader source itself (no visual change in this plan).
- Reducing audio feature reads in `engine-render.client.js` (separate
  concern; the LFO modulators need fresh audio every frame anyway).
- Workerising the FX pass (would be a much bigger refactor; out of scope
  for a single-cycle P1).
- New presets / personas — this is a pure perf plan, no UX surface
  changes.
