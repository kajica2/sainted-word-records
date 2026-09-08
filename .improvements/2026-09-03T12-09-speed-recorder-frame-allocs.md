# Recorder: hoist per-RAF Float32Array + throttle captureLoop to encoder fps

**Cycle**: 2026-09-03T12-09
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

`lib/recorder.client.js` runs `captureLoop()` on every RAF (~60Hz) while
recording. Per tick it allocates a fresh `Float32Array(frames)` for the
mono audio pull (`lib/recorder.client.js:99`) — directly contradicting the
doc-comment at `:51-52` that promises "a Float32Array reused across frames
to avoid GC pressure". On top of that, the loop ignores `state.fps`: even
when the caller passes `fps: 24`, the encoder is fed ~60 frames/second and
silently drops the surplus. Fix both: hoist `mono` to a single
reusable buffer allocated once at `start()`, and skip the capture tick
when `performance.now() - state._lastCaptureAt < 1000 / state.fps`. The
recording pipeline keeps the same wire format and the same MP4 output,
just with fewer allocations and fewer encoder-side drops.

## Why this cycle

Scanned the recorder hot path:

- `lib/recorder.client.js:75-128` — `captureLoop()` runs at RAF cadence
  while a recording is active. Two per-frame costs jumped at the scan:
  - **Allocation** — line 99 `var mono = new Float32Array(frames);`
    inside the loop. The class doc-comment on `:51-52` explicitly says
    `timeBuffer` "is a Float32Array reused across frames to avoid GC
    pressure." The promise holds for `state.audioChunkBuffer` (allocated
    once in `start()` at `:156`), but the `mono` scratch is leaked on
    every frame. At 60Hz for a 30s recording that's 1800 allocations of
    ~8820 bytes each (24 kHz × 0.1 s × 4 bytes; actual size depends on
    audioSampleRate). The buffer survives no longer than one tick.
  - **Encoder overfeed** — line 75-127 never gates on `state.fps`. The
    worker is initialized with `fps: state.fps` (`:212`) and the encoder
    configures itself accordingly, but the main thread still posts a
    `VideoFrame` every RAF. At `fps: 24` and RAF 60Hz that's ~36 extra
    encodes per second that get dropped internally. The encoder
    quantizer-side duplicate-drop work is real CPU on the worker.
- The `786c5c2 perf(recorder): cap capture at 24fps` commit on the
  `fix/v3-overlay-all-pages` branch lowered the *default* fps from 30 to
  24 but did NOT add a RAF-side throttle. So on `main`, requesting
  `fps: 24` is a no-op.
- Recent main-branch recorder work — `ad6bf96 feat(recording): record in
  MP4 (H.264/AAC) via WebCodecs when supported` and `f914b56
  perf(recorder): default SWR_RECORDER_WORKER on for capable browsers` —
  has focused on the worker/format side. The RAF-side allocations and
  overfeed are not addressed and have grown more visible now that the
  WebCodecs path is the default for capable browsers.

Existing verifier `verify-recording.mjs` at the repo root exercises the
full start → record → stop → MP4-blob pipeline. The new plan is a strict
subset of "what the existing test expects," so the verifier stays green.

## Goal

After this lands, `captureLoop()` allocates zero per-frame typed arrays
and only posts a `VideoFrame` to the worker at the encoder's requested
fps, with the resulting MP4 byte-identical to the current build on the
default 24fps preset (verified via MP4-frame-count + byte-length diff
in `verify-recording.mjs`).

## Plan

### Step 1 — Hoist `mono` to a reusable scratch buffer

- **Files**: `lib/recorder.client.js:41-60` (state) and `:75-128`
  (captureLoop).
- **Action**:
  1. Add `monoBuffer: null` to the `state` object at `:41-60`.
  2. In `start()` (`:131-145`) at the same place where
     `audioChunkBuffer` is allocated (`:156`), allocate
     `state.monoBuffer = new Float32Array(state.audioChunkFrames);`
     sized for the same window. The capture loop only needs one mono
     buffer per tick — never grows.
  3. In `cleanup()` (`:236-251`) reset `state.monoBuffer = null` next
     to the existing `audioChunkBuffer = null`.
  4. In `captureLoop()` (`:75-128`), replace `:99` `var mono = new
     Float32Array(frames);` with `var mono = state.monoBuffer;` and the
     following `analyser.getFloatTimeDomainData(mono);` stays
     unchanged. The buffer is guaranteed non-null only when
     `state.audioAnalyser` is non-null (same lifecycle), so wrap the
     audio block in a guard that returns early if either is missing
     (the existing `if (state.audioAnalyser)` at `:88` already gates
     this — leave it).

- **Verify**: `npm run check:syntax` passes; `npm run build` rebuilds
  `dist/` cleanly; `node verify-recording.mjs` still passes and the
  downloaded MP4 file size is within ±2% of the pre-change baseline
  (the audio payload byte count must match exactly).

### Step 2 — Throttle captureLoop to encoder fps

- **Files**: `lib/recorder.client.js:41-60` (state) and `:75-128`
  (captureLoop).
- **Action**:
  1. Add `_lastCaptureAt: 0` and `_captureIntervalMs: 0` to `state`
     at `:41-60`.
  2. In `start()` at `:142`, after `state.fps = opts.fps || FPS_DEFAULT;`
     add `state._captureIntervalMs = 1000 / Math.max(1, state.fps);`
     and `state._lastCaptureAt = 0;`. The `Math.max(1, ...)` guard
     prevents divide-by-zero if a caller passes `fps: 0`.
  3. In `cleanup()` (`:236-251`), reset both new fields to 0 alongside
     the existing resets.
  4. At the top of `captureLoop()` (`:75-76`), after the early-return
     for missing worker/canvas, add:

     ```js
     var nowMs = performance.now();
     if (state._lastCaptureAt && (nowMs - state._lastCaptureAt) < state._captureIntervalMs) {
       state.rafId = requestAnimationFrame(captureLoop);
       return;
     }
     state._lastCaptureAt = nowMs;
     ```

     The `if (state._lastCaptureAt && ...)` guard ensures the first
     tick after `start()` always captures (no initial zero-spike).

  5. Use the same `nowMs` for the `VideoFrame` timestamp on `:77` so
     the worker's `ts` reflects the actual capture time, not the
     time we decided to skip. (Currently `ts` uses `performance.now()
     - state.t0` — keep that, but recompute from the *post-throttle*
     `nowMs` for consistency: `var ts = (nowMs - state.t0) * 1000;`.)

- **Verify**: `node verify-recording.mjs` exits 0. Add an assertion:
  count `window.SWR_RECORDER._stats.captured` (or a counter exposed by
  the throttle, see Step 3) and assert it's ≈ `state.fps *
  recording_duration_seconds` (within ±1 due to RAF jitter). Pre-fix
  the same assertion fails — captured frames ≈ 2.5× the fps target on
  a 60Hz RAF.

### Step 3 — Add a counter so the test (and the user) can see the win

- **Files**: `lib/recorder.client.js:41-60` (state) and `:75-128`
  (captureLoop); new file `verify-recorder-fps-cap.mjs` at repo root.
- **Action**:
  1. Add `_capturedCount: 0` and `_skippedCount: 0` to `state` at
     `:41-60`. Bump them at the matching points in `captureLoop()`
     (capture branch and skip branch).
  2. Expose them on `window.SWR_RECORDER.stats` via a getter that
     returns `{ captured: state._capturedCount, skipped:
     state._skippedCount, fps: state.fps, target:
     state._captureIntervalMs }`. Reset to zero at `start()`.
  3. Add a new `verify-recorder-fps-cap.mjs` (matches the `verify-*.mjs`
     convention; wire as `npm run verify:recorder-fps-cap` in
     `package.json`). Puppeteer harness:
     - opens `engine.html`, auto-logs-in via stored cookies
     - starts a recording with `SWR_RECORDER.start({ canvas:
       document.querySelector('canvas'), fps: 24 })`
     - waits 5 seconds
     - reads `window.SWR_RECORDER.stats` and asserts
       `stats.captured` is between 110 and 130 (≈24 * 5 ±10% for
       jitter); `stats.skipped` is ≥ 150 (≈36 * 5 — the previously
       wasted ticks)
     - stops, downloads the MP4, asserts `videoFrames` matches
       `stats.captured` (worker-side count should equal main-thread
       capture count post-throttle)
     - exit 0 on all asserts
- **Verify**: `node verify-recorder-fps-cap.mjs` exits 0 and the
  reported `captured/skipped` split matches the throttle math.

### Step 4 — Update the source comment to reflect both fixes

- **Files**: `lib/recorder.client.js:51-52` (the existing
  `timeBuffer` doc-comment) and `:88-100` (the audio block).
- **Action**:
  1. Reword `:51-52` so it accurately covers BOTH reusable buffers —
     `audioChunkBuffer` (interleaved output) and `monoBuffer`
     (analyser scratch). Something like:

     ```js
     // Audio capture — analyser-driven sample-pull at AUDIO_CHUNK_MS cadence.
     // Two Float32Arrays are reused across frames to avoid GC pressure:
     //   audioChunkBuffer — interleaved output buffer (frames × channels),
     //                      sized once in start() and shipped to the worker
     //                      when full.
     //   monoBuffer       — scratch buffer for the analyser's mono time-domain
     //                      pull, also allocated once in start().
     ```

  2. Add a one-line note above the throttle at `:75-76`:

     ```js
     // Throttle to encoder fps — captureLoop is RAF-driven but the
     // encoder only needs state.fps frames/second. Without this, the
     // worker over-encode/drops at >state.fps Hz.
     ```

- **Verify**: read the diff; comments accurately describe the new
  control flow and the buffer-reuse invariant holds across frames.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run build` passes — `dist/` rebuilds cleanly with no new
  warnings.
- `node verify-recording.mjs` exits 0 and the downloaded MP4 byte
  length is within ±2% of the pre-change baseline at the default 24fps
  preset (catches accidental wire-format regressions).
- `node verify-recorder-fps-cap.mjs` exits 0 with `captured` ≈
  `fps * duration` and `skipped` > 0. This is the regression net for
  the throttle.
- `node verify-recording.mjs` against `fps: 60` (override via
  `localStorage.swr.recorder.fps=60` or harness param) exits 0 and
  produces a 60fps-equivalent MP4 (more frames, same wire format).
- Pre-fix A/B: run `verify-recorder-fps-cap.mjs` against the current
  build on `main` (before applying this plan) and confirm
  `stats.captured ≈ 60 * duration` and `stats.skipped = 0` — that's
  the *current bad behavior* that the plan fixes.

## Risks / gotchas

- **Timestamp drift**: the VideoFrame timestamp on `:77` is now
  computed from the post-throttle `nowMs` instead of the RAF time.
  The worker's encoder stamps each frame with this timestamp; if it
  drifts too far from the audio timestamp, the resulting MP4 may have
  A/V drift. Mitigation: the throttle interval is `1000/fps` ms and
  RAF jitter is bounded by the browser (~5-16ms). At 24fps that's
  <1% drift over a 30s recording — well below audible. The current
  pre-fix behavior of "post 60 frames per second and let the encoder
  drop" likely already has worse drift characteristics.
- **First-tick correctness**: the `_lastCaptureAt && ...` guard at
  Step 2 ensures frame 0 captures immediately. Without that guard
  the first frame would be skipped (`_lastCaptureAt` starts at 0, so
  `nowMs - 0 > intervalMs` is always true — but with `&&` the guard
  short-circuits to *capture*, which is what we want).
- **`monoBuffer` lifecycle**: allocated in `start()` alongside
  `audioChunkBuffer` (which is also null when no `audioSource` is
  passed). When `state.audioAnalyser` is null (no audio wired) the
  audio block at `:88` early-returns and `monoBuffer` is never
  touched. Safe — no null deref.
- **Worker close-on-stop**: `stop()` at `:222-230` cancels the RAF
  and posts `{type:'stop'}` to the worker. The new throttle doesn't
  change that path. Verified by reading `:222-230`.
- **Pre-existing `786c5c2` commit on `fix/v3-overlay-all-pages`**: if
  that branch is merged first, Step 2's *intent* is already half-done
  (default-fps lowered to 24), but the RAF throttle and the
  Float32Array hoist are still needed and independent. After merge,
  re-check `:75-76` for existing throttle code; if present, the plan
  still applies but skips the redundant throttle. Either way the
  Float32Array hoist is fresh work.

## Out of scope

- Changing the encoder config (`avc1.42E01E`, bitrate, etc.) — out of
  scope for a perf plan; would change wire format.
- Replacing the WebCodecs path with `MediaRecorder` for the default —
  the WebCodecs path is the existing direction; the throttle makes it
  faster, not different.
- Audio resampling / channel balancing — the mono→stereo duplication
  at `:103-108` is fine for music-visualizer playback and explicitly
  documented as such.
- Worker-side batching or zero-copy frame passing — separate concern;
  the per-frame work on the worker is bounded by the throttle now.
- `verify-recorder-fps-cap.mjs` cross-browser matrix (Firefox, Safari).
  The throttle is browser-agnostic; the new verifier only needs to
  run on the Chrome headless the other `verify-*.mjs` use.