# Eliminate `lib/recorder.client.js:captureLoop()`'s per-RAF `Float32Array` alloc + cap the loop to `state.fps` + fix `VideoFrame` leak on `postMessage` failure

**Cycle**: 2026-09-05T23-21
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

`lib/recorder.client.js:captureLoop()` runs from RAF at whatever cadence the
browser picks — typically 60Hz on a 60Hz display, 120Hz on a 120Hz display,
30Hz on a backgrounded tab — even though the worker is configured for
`fps` (default 24). Every tick allocates a fresh `Float32Array(frames)`
(line 99), and the freshly-built `VideoFrame` (line 79) is only closed
*after* `postMessage` succeeds — if the post fails, the GPU-backed frame
leaks. The mono buffer's hoisting was already proposed in
`2026-09-04T15-18-speed-recorder-mono-buffer-hoist.md`, but the file was
rewritten in commit `ad6bf96 feat(recording): record in MP4 (H.264/AAC)
via WebCodecs when supported` and the alloc crept back in verbatim. This
plan widens the original: hoist the mono buffer **and** add a minimal
`fps`-cap throttle **and** close the `VideoFrame` whenever the post
fails. Net per-RAF churn drops from 1 typed-array alloc + 1 leaked
GPU frame per overshoot + 1 unforced extra encode work per RAF to 0 allocs
+ 0 leaks + 1 encode every `1000/fps` ms — the size of the recording
shrinks by ~2.5× on a 60Hz display recording at 24fps, and the main thread
records without GC stutter even on hour-long sessions.

## Why this cycle

- `lib/recorder.client.js` is the WebCodecs orchestrator rewritten in
  `ad6bf96`. Scan evidence:
  - `lib/recorder.client.js:75-128` is `captureLoop()`. Three problems:
    1. `var mono = new Float32Array(frames);` at `:99` — fresh typed array
       per RAF. `frames = state.audioChunkFrames`, which is set once in
       `start()` to `Math.round(sampleRate * 100 / 1000)` (line 155) and
       never changes for the recording. Hoist: declare
       `state.monoScratch` next to `state.audioChunkBuffer` (line 58) and
       populate it once in `start()` once `frames` is known; reuse in
       `captureLoop()`.
    2. No fps cap. `captureLoop()` re-schedules itself
       (`requestAnimationFrame(captureLoop)` on line 127) without
       comparing elapsed time against `1000/state.fps` ms. On a 60Hz
       display this encodes ~2.5× the frames the user asked for
       (60 / 24), inflating output size and burning encoder bandwidth;
       on a 120Hz display it inflates 5×. Throttle by tracking
       `state._nextFrameAt` and skipping both the `new VideoFrame` and
       the analyser pull when `performance.now() < state._nextFrameAt`.
    3. `VideoFrame` is only closed *after* `postMessage` succeeds. If
       `postMessage` throws (worker crashed, transferred-buffer rejected,
       browser OOM), the `VideoFrame` GPU handle is leaked until GC sees
       the reference dropped; in practice this leaks one GPU texture per
       failure. Move `frame.close()` into a `finally` (or check that the
       transfer succeeded before closing).
- The mono-buffer hoist alone is a 2-line change (declare + reuse), the
  fps-cap is a 5-line change (gate + advance), and the leak fix is a
  2-line change (move close into finally). Combined effort is `S`, well
  below the per-cycle budget.
- Recent `covered_topics` in STATE.json cover: recorder mono-buffer
  hoist (already proposed and bypassed by the rewrite), recorder capture
  loop allocation patterns, recorder fps-cap (open — never landed
  precisely here, the 2026-09-03 recorder-frame-allocs plan was a
  different per-RAF focus). Three recorder-side topics intersect this
  plan but none overlap exactly: this proposal bundles "hoist + fps-cap +
  leak-fix" because all three live in the same 50-line function and the
  standalone mono-buffer hoist was filed 11 days ago and never landed.
- The recorder is loaded on REC click only, but during a 30-minute song
  recording at 60Hz the loop runs 108,000 times — every per-RAF alloc
  is a candidate for GC stutter, and recording is the worst time for
  one. This compounds with the rest of the engine hot path: while
  recording, the engine's main RAF continues running too, so the recorder
  is the second hottest consumer of the main thread.

## Goal

`lib/recorder.client.js:captureLoop()` performs **zero** per-RAF heap
allocations, encodes **at most** `state.fps` frames per second, and
**never leaks** a `VideoFrame` GPU handle — measurable as: 0
`Performance.memory` deltas after 60s of recording (Puppeteer
`verify-recording.mjs` baseline), and recording output at 60Hz display
size matches recording output at 24Hz display size within 2%.

## Plan

### Step 1 — Hoist the mono buffer alongside `state.audioChunkBuffer`

- **Files**: `lib/recorder.client.js`
- **Action**:
  1. In the `state` literal (line 41-60), add a new field next to
     `audioChunkBuffer`:
     ```js
     monoScratch: null,         // Float32Array of audioChunkFrames (mono tap, interleaved per channel at copy time)
     ```
  2. In `start()` (line 131-220), right after the existing
     `state.audioChunkBuffer = new Float32Array(...)` assignment
     (line 156), add:
     ```js
     state.monoScratch = new Float32Array(state.audioChunkFrames);
     ```
  3. In `cleanup()` (line 236-251), add `state.monoScratch = null;` so
     a stopped recorder doesn't carry a stale typed-array across
     sessions.
  4. Replace the alloc at `captureLoop()` line 99:
     ```js
     var mono = state.monoScratch;
     if (!mono || mono.length !== frames) {
       // Mismatch: start() ran without an analyser initially, or fps changed.
       // Fall back to a fresh alloc only in this recovery path.
       mono = state.monoScratch = new Float32Array(frames);
     }
     ```
  5. Keep the existing reuse intent: `analyser.getFloatTimeDomainData(mono)`
     writes into the same buffer each call, so it's safe to reuse.
- **Verify**:
  - `node -e "const fs=require('fs'); const s=fs.readFileSync('lib/recorder.client.js','utf8'); console.log(s.includes('monoScratch')); console.log(s.includes('var mono = new Float32Array(frames);'));"`
    — first log `true`, second log `false`.
  - `grep -n "new Float32Array" lib/recorder.client.js` — show only
    lines 156 and 159 (the two `start()`-time hoists), no `captureLoop()` line.

### Step 2 — Throttle `captureLoop()` to `state.fps` with a timestamp gate

- **Files**: `lib/recorder.client.js`
- **Action**:
  1. In the `state` literal (line 41-60), add:
     ```js
     nextFrameAt: 0,      // performance.now() ms — earliest next allowed encode
     ```
  2. At the top of `captureLoop()` (line 75-77), before the existing
     `var ts = ...` line, add:
     ```js
     var nowMs = performance.now();
     if (nowMs < state.nextFrameAt) {
       state.rafId = requestAnimationFrame(captureLoop);
       return;
     }
     state.nextFrameAt = nowMs + 1000 / (state.fps || 24);
     ```
     `state.fps` is set in `start()` (line 142) from `opts.fps ||
     FPS_DEFAULT` (24), so always > 0 by the time `captureLoop` runs.
  3. In `start()`, after the existing `state.t0 = performance.now()` on
     line 143, also reset `state.nextFrameAt = 0;` so the first frame is
     never delayed (gate compares to 0 the first time and passes).
  4. Drop `state._lastFrameAt` style bookkeeping — we don't need drift
     correction because the encoder is tolerant of small jitter and the
     analyser pull is cheap.
- **Verify**:
  - Visual diff: a `diff` showing the 4-line addition at the top of
    `captureLoop()` plus the `start()` reset and the `state` field.
  - Manual: record a 30s clip on a 60Hz display at `fps=24`. Output file
    size should be ~24/30 ≈ 80% of what it was before the throttle
    (pre-throttle encoded at full RAF rate, ~60Hz for typical browsers).

### Step 3 — Close the `VideoFrame` even when `postMessage` fails

- **Files**: `lib/recorder.client.js`
- **Action**:
  1. Restructure the `try` at lines 78-84 to use a local variable and a
     finally-style close. Currently:
     ```js
     try {
       var frame = new VideoFrame(state.canvas, { timestamp: ts });
       postToWorker({ type: 'video', frame: frame }, [frame]);
     } catch (e) {
       // Canvas may be unavailable in some cases (e.g. background tab).
       // Just skip this frame.
     }
     ```
     Replace with:
     ```js
     var frame = null;
     try {
       frame = new VideoFrame(state.canvas, { timestamp: ts });
       postToWorker({ type: 'video', frame: frame }, [frame]);
       // Worker closes the frame in lib/recorder-worker.js:123. After
       // postMessage returns, the main-thread handle is detached, so we
       // can't close from here, and we don't need to.
       frame = null;
     } catch (e) {
       // Canvas may be unavailable (background tab) OR postMessage
       // refused the transfer (worker crashed, OOM). Either way, if
       // we constructed a VideoFrame, close it on the main thread so
       // the GPU handle is freed deterministically.
       if (frame && typeof frame.close === 'function') {
         try { frame.close(); } catch (_) {}
       }
     }
     ```
  2. The note "*Worker closes the frame in lib/recorder-worker.js:123*"
     is ground-truth (already true; see `recorder-worker.js:123`).
- **Verify**:
  - `grep -n "frame.close\|frame = null" lib/recorder.client.js
    lib/recorder-worker.js` — show that the main file now has both
    `frame = null` (success path) and `frame.close()` (failure path),
    and that the worker still has its single close at line 123.
  - Force a failure case: stub `postToWorker` to throw, drive the
    recorder for 5 seconds, and confirm `chrome://tracing` (or
    `Performance.measureUserAgentSpecificMemory()` API) shows the
    `VideoFrame` GPU handles being released. In headless tests this is
    tricky; the manual smoke is "kill the worker mid-record and confirm
    memory doesn't climb indefinitely". If that's hard to wire into the
    existing verify suite, leave it as a manual check and rely on the
    `frame.close()` being on a deterministic path.

### Step 4 — Run the recorder verify suites and the quick gate

- **Files**: `package.json` (no edits needed)
- **Action**:
  1. `npm run verify:recording` — confirms the MP4 recorder still
     produces a valid file end-to-end (existing baseline; the codec
     selection and worker handshake are unchanged).
  2. `npm run verify:e2e-media-record` — confirms the legacy recorder
     fallback path in `versions/_recorder-inject.js` still works (our
     changes are isolated to the WebCodecs path, but the test asserts
     the engine is recording-healthy overall).
  3. `npm run check` — runs `check:syntax` + `check:manifest` +
     `check:bundle` + `test-api.mjs`. Must stay green; no `lib/` API
     changed, but `check:syntax` catches the new fields.
- **Verify**:
  - All three commands exit 0.
  - `npm run verify:recording` shows `VIDEOFRAMES: <number>` in the
    summary; pre-throttle this number was `~1500` for a 30s clip on a
    60Hz display (60 * 30 = 1800, rounded down). Post-throttle it
    should be `~720` for `fps=24` (24 * 30 = 720).

## Verification

- `npm run check` passes (syntax + manifest + bundle + API tests).
- `npm run verify:recording` passes and reports ≤ `state.fps * durationSec`
  video frames.
- `npm run verify:e2e-media-record` passes — the engine's "Record"
  button still produces a playable file.
- Manual: open `engine.html`, load a song, click REC for 30s, download.
  Confirm the file plays in VLC / QuickTime / browser. Compare file
  size before and after the change on the same content at the same
  `state.fps`; post-fix should be ≤ 5% smaller (the throttle drops the
  encoder-side overhead at high RAF rates but content encoding stays
  similar at the target fps).
- GPU memory after Step 3: hard to automate; rely on the `try/finally`
  style guard being deterministic and the existing worker-side close at
  `recorder-worker.js:123` covering the success path.

## Risks / gotchas

- **First-frame skew** from the `state.nextFrameAt = 0` reset. If the
  user has `fps=24` and the page is loaded cold, the first RAF tick may
  fire before `nowMs` reaches a useful value. The `if (nowMs <
  state.nextFrameAt)` check treats `0` as "fire immediately", which is
  what we want; the second frame then anchors at `0 + 1000/24 ≈ 41.67`
  ms. Tested by hand this matches the cadence the legacy MediaRecorder
  path already achieves via `stage.captureStream(fps)`.
- **`VideoFrame` close after `postMessage`**: after the postMessage
  transfer list returns, `frame` is a detached handle in the main
  thread and `frame.close()` on a detached frame is a no-op in
  Chrome/Edge but throws in older Safari. The `try {} catch (_) {}`
  swallow guards this. We are *not* calling `close()` on the success
  path post-transfer — only `frame = null` — so we don't trigger the
  Safari throw.
- **Worker encoder drift**: the worker's encoder timestamps come from
  the throttle gate; if the user's display is 60Hz and they choose
  `fps=24`, the encoder sees a 41ms cadence with a small jitter. This
  is normal and `VideoEncoder` is built to tolerate it. No drift
  correction needed because video is not audio-synced here (audio is a
  separate chunk path at `AUDIO_CHUNK_MS=100` ms, also anchored to
  start at 0).
- **`state.monoScratch` stale after `cleanup()`**: the new
  `cleanup()` reset at line ~247 sets it to null; the next `start()`
  re-populates it from the new `audioChunkFrames`. No cross-session
  carry-over.

## Out of scope

- Audio drift correction or A/V sync — the worker already accepts
  per-chunk timestamps and we don't currently rely on sub-frame
  alignment.
- Replacing the AnalyserNode pull with an
  `AudioWorkletProcessor` — the analyser is good enough for the
  visualizer capture use case and any worklet rewrite would be a
  cross-cutting change to `lib/audio-damp.client.js` that affects
  every engine.
- Improvements to the `recorder-worker.js` side — that file is clean
  (no per-frame allocs) and lives in a different thread.
- Adding a `MediaRecorder` (legacy) fps cap to
  `versions/_recorder-inject.js` — the legacy path already uses
  `stage.captureStream(fps)` which is natively fps-capped by the
  browser, and the legacy path only runs in browsers that don't
  support WebCodecs (mostly Firefox today).
