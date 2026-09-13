# Hoist recorder's per-RAF mono Float32Array to module state

**Cycle**: 2026-09-04T15-18
**Type**: speed
**Priority**: P2
**Estimated effort**: XS

## TL;DR

`lib/recorder.client.js:99` allocates a fresh `Float32Array(frames)` every
single RAF tick inside the WebCodecs `captureLoop()`:

```js
var mono = new Float32Array(frames);          // line 99 — every frame
analyser.getFloatTimeDomainData(mono);
```

The file already documents the intent on line 51 (`// timeBuffer is a
Float32Array reused across frames to avoid GC pressure.`) and the sibling
`state.audioChunkBuffer` is hoisted (allocated once in `start()`, line 156,
cleared in `cleanup()`). The `mono` intermediate buffer was missed.
At 48 kHz × 100 ms = 4800 samples × 4 bytes = 19.2 KB/frame; at 30 fps
that's **~576 KB/sec of typed-array churn during every recording session**
for no reason. Hoist `state.audioMono` into the existing `state` initialiser,
allocate it next to `audioChunkBuffer` in `start()`, drop the reference in
`cleanup()`. One-line edit in three spots; identical audio output.

## Why this cycle

- `covered_topics` in `.improvements/STATE.json` lists `recorder-fps-cap`,
  `recorder-float32-allocs`, `webcodecs-hotpath`, but no
  `recorder-mono-buffer` / `recorder-captureLoop` topic. The recent recorder
  rewrite (commits `ad6bf96 feat(recording): record in MP4` and
  `bc1a89c feat(recording): upgrade Recorder across all 19 variants`) shipped
  `captureLoop()` on 2026-09-04; this is the obvious hoist that the
  rewrite missed.
- The codebase already hoists `audioChunkBuffer` correctly (line 156). The
  `mono` buffer is the literal next-door neighbour of that hoisted buffer
  in the same function — the diff is symmetrical and easy to review.
- Memory churn during recording matters more than during normal playback
  because the user is generating an artifact (often multi-minute sessions
  on phones, where GC pauses can cause recording jank / dropped frames).
  Smaller-than-render-path but still measurable.
- Memory hygiene is already handled: `cleanup()` nulls `audioChunkBuffer`
  on line 246 and the matching `audioChunkFrames` / `audioChunkBytes` /
  `audioSampleRate` lines. Adding one more null keeps the invariant.

## Goal

`captureLoop()` runs zero allocations per RAF tick when audio capture is
enabled. The mono Float32Array is allocated exactly once per recording
session (in `start()`), reused on every subsequent tick, and dropped on
`cleanup()`.

## Plan

### Step 1 — declare the field on the existing state object
- **Files**: `lib/recorder.client.js:41-60`
- **Action**: add `audioMono: null,` to the `state` initialiser, next to
  the existing `audioChunkBuffer: null,` on line 58. Update the trailing
  comment style (one short sentence on each field) so a future reader
  sees both buffers belong to the same lifetime.
- **Verify**: `grep -n "audioMono" lib/recorder.client.js` shows exactly one
  match in the `state` declaration.

### Step 2 — allocate the buffer next to its sibling
- **Files**: `lib/recorder.client.js:155-157` (inside `start()`, just after
  `state.audioChunkBuffer = new Float32Array(...)`)
- **Action**: insert
  ```js
  state.audioMono = new Float32Array(state.audioChunkFrames);
  ```
  immediately after the existing `state.audioChunkBuffer = …` line.
  Size matches `audioChunkFrames` (the analyser's `getFloatTimeDomainData`
  buffer) — not `audioChunkFrames * channels` — because the mono buffer
  holds one sample per frame and the channel expansion happens in the
  next loop (lines 103-108) by reading from this buffer.
- **Verify**: `grep -n "state.audioMono" lib/recorder.client.js` shows
  the new allocation line.

### Step 3 — reuse it in captureLoop
- **Files**: `lib/recorder.client.js:99` (inside `captureLoop()`)
- **Action**: replace
  ```js
  var mono = new Float32Array(frames);
  analyser.getFloatTimeDomainData(mono);
  ```
  with
  ```js
  analyser.getFloatTimeDomainData(state.audioMono);
  ```
  The inner loop that reads `mono[i]` (line 104) must change to
  `state.audioMono[i]`. The `frames` local (line 92) stays as is — it's
  the same `state.audioChunkFrames` value used as the bound for the
  existing interleave loop.
- **Verify**: `grep -n "new Float32Array" lib/recorder.client.js` now
  returns only two hits: the new `audioMono` allocation in `start()`
  and the existing `audioChunkBuffer` allocation (also in `start()`).
  Zero hits inside `captureLoop()`.

### Step 4 — drop the reference in cleanup
- **Files**: `lib/recorder.client.js:236-251` (inside `cleanup()`)
- **Action**: add `state.audioMono = null;` immediately after
  `state.audioChunkBuffer = null;` on line 246. This matches the
  surrounding cleanup shape (one line per state field, no fanout).
- **Verify**: `grep -nE "audioChunkBuffer = null|audioMono = null"
  lib/recorder.client.js` returns two consecutive lines in the right
  order.

### Step 5 — verify with the gate
- **Action**: run `npm run check` (syntax + manifest + bundle + api
  tests). No new tests needed; the change is mechanical and the
  existing recorder E2E (`verify:e2e-media-record`) exercises the path.
- **Action**: optional manual smoke — record a 10-second clip via
  `verify:e2e-media-record`, confirm the resulting MP4 plays back with
  audio identical to the pre-change output (same sample rate, same
  channel count, no audible glitch). A simple before/after `ffprobe`
  on the output confirms channel_layout and sample_rate match.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run verify:e2e-media-record` passes (existing recorder E2E
  exercises the WebCodecs MP4 path on every variant).
- `grep -n "new Float32Array" lib/recorder.client.js` returns exactly
  two matches, both in `start()`, neither inside `captureLoop()`.
- Before/after memory: heap snapshot during a 30-second recording shows
  zero typed-array allocations of size `audioChunkFrames * 4` bytes
  (visible in DevTools → Memory → "Allocation instrumentation" timeline
  as a flat line where before there was a regular saw-tooth at the
  rAF cadence).
- Behavioural: recorded MP4 plays back identically — same number of
  audio chunks, same sample rate, same channel count, same byte size
  to within ±1 chunk (the chunk-boundary timing is deterministic given
  the same `AUDIO_CHUNK_MS` window).

## Risks / gotchas

- **Re-entrancy during cleanup**: if a RAF tick fires after `cleanup()`
  has run (e.g. user clicks Stop and then a stale rAF gets delivered
  before `state.ready = false` cancels the loop), `captureLoop()` will
  read `state.audioMono == null` and the `getFloatTimeDomainData` call
  will throw inside the `try { … } catch (_) {}` on lines 89-125. Same
  shape of error swallowing the file already uses for
  `audioChunkBuffer == null` / AudioData construction failures. Safe.
- **`audioNumberOfChannels == 0` start path**: the `start()` block at
  line 152 only runs when the caller passes a real audio source. If
  `state.audioAnalyser` ends up null (the catch on line 166), the
  per-RAF path at line 88 (`if (state.audioAnalyser)`) is skipped
  entirely, so the unused `state.audioMono` just sits as a zero-length
  Float32Array. No leak, no alloc. Fine.
- **Memory hygiene on early failure**: if `start()` throws after
  allocating `audioMono` but before returning (e.g. worker init
  failure), `cleanup()` is **not** called — the existing `audioChunkBuffer`
  has the same exposure today. Out of scope for this plan; a separate
  cycle could add a `try/finally` around `start()` to guarantee cleanup
  on all paths.
- **Float32Array element type**: `getFloatTimeDomainData` requires
  Float32Array (per spec). The hoisted buffer is also Float32Array.
  No type drift.
- **Multi-track sources**: today `audioNumberOfChannels` is set by the
  caller to a fixed value at `start()` time; `audioMono` only needs to
  be `audioChunkFrames` long (one sample per frame, mono). The channel
  duplication happens in the interleave loop. No change to that
  loop is needed.

## Out of scope

- Switching the analyser tap to true stereo via `ChannelMergerNode`
  (mentioned in the comment on lines 96-98). That's a quality change,
  not a perf hoist, and the recorded output would change audibly.
- Adding a `try/finally` around `start()` to guarantee `cleanup()` on
  failure paths. Worth doing in a follow-up but unrelated to the
  per-RAF allocation.
- Hoisting other per-RAF allocations in `captureLoop()` (the
  `AudioData` construction on line 111 is once per 100 ms = once
  every 6 frames at 60 fps; not worth hoisting because the API
  requires a fresh instance per chunk). Leave as is.
- Replacing the `var` declarations with `const` / `let` across the
  file. AGENTS.md says "follow the surrounding style"; this file
  uses `var` throughout, so `var` it is.
- Other `new Float32Array(...)` calls elsewhere in the codebase. A
  repo-wide grep is a separate cycle — this plan scopes tightly to
  the recorder's per-RAF path.
