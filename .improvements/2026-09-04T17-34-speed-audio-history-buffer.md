# Remove per-frame allocation from audio spectral-flux history

**Cycle**: 2026-09-04T17-34
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

The audio sampler in every shipped `versions/*.html` engine copies its entire 1024-bin frequency spectrum with `Uint8Array.from(this.fft)` on every animation frame, only so the next frame can compare the previous spectrum for onset detection. The shared `engine.html` sampler has the same issue at `engine.html:1996`; its `Audio.sample()` is called from the main RAF at `engine.html:4315`. The copy is unnecessary: allocate a second fixed-size `Uint8Array` once when the analyser is unlocked, compare against it, then copy the current analyser buffer into that existing array with `.set()` after all reads finish. Apply the same mechanical replacement to the 13 variant pages, preserving their distinct gates/smoothing values and the existing `hist.prev = null` reset semantics. This removes one ~1 KiB typed-array allocation per audio frame per running page (about 60 allocations/sec/page) without changing spectral-flux values or beat/onset timing.

## Why this cycle

The working tree is dirty, but the dirty paths are root-level marketing PNG deletions, `references/`, `package.json:24-41`, temporary `.improvements/` files, and existing improvement plans. The clean audio engine files targeted here are not part of those edits. Recent commits are recording/WebCodecs and library work; `git log -- engine.html versions/*.html` shows no recent history changing this sampler. Existing improvement plans already cover recorder buffers, render-cache strings, LFO/timing allocations, offscreen canvases, variant extra-draw arrays, and the variant WebGL upload gate. None covers the audio sampler's previous-spectrum copy.

### Concrete scan evidence

- `engine.html:1918-1996` is the main sampler. It pulls the analyser into the persistent `this.fft`/`this.time` buffers at `:1920-1921`, computes flux against `this.history.prev` at `:1963-1968`, and allocates `this.history.prev = Uint8Array.from(this.fft)` at `:1996`.
- `engine.html:4314-4315` calls `Audio.sample()` from the main animation loop whenever audio is playing, so this allocation occurs once per RAF during playback.
- `engine.html:1744` initialises `history` with `prev: null`; `engine.html:1838` resets it on every new song. Both places need to retain the buffer rather than discard it.
- The 13 pages loaded through `versions-presets.js` each contain the same history-copy pattern. A direct scan found exactly these 13 real source sites: `versions/aurora.html:440`, `chrome.html:440`, `eclipse.html:575`, `film.html:575`, `fractal.html:440`, `glitch.html:440`, `grid.html:568`, `hallucination.html:706`, `neon.html:577`, `pulse.html:558`, `smoke.html:571`, `void.html:440`, and `watercolor.html:440`. Each has `this.fft` and `this.time` allocated once in `unlock()` (for example `versions/film.html:526` and `versions/aurora.html:385`) and compares the previous buffer in the same `sample()` method.
- The other version pages (`baroque`, `kraft`, `mosaic`, `phosphor`, `tape`, `collage`, `gallery`, `spectrum`, and `typography`) do not contain this exact previous-spectrum copy path. Do not touch them under this plan.
- The allocation is not needed for correctness: the analyser writes the current data into `this.fft` before the flux loop, and the copy is only read until the next sampler call. `Uint8Array#set()` preserves the same byte values in a stable buffer and does not alter the current `this.fft`.

## Goal

During audio playback, the main engine and all 13 affected variants reuse one fixed previous-spectrum `Uint8Array` per analyser instead of allocating `Uint8Array.from(this.fft)` on every `Audio.sample()` call, while onset/beat behavior remains identical for the same analyser input sequence.

## Plan

### Step 1 — Add a persistent previous-spectrum buffer to the main engine

- **Files**: `engine.html:1726-1784` (the `Audio` object and `unlock()`), `engine.html:1744` (`history` initialiser), and `engine.html:1838-1840` (song-load reset).
- **Action**:
  1. Add a field beside `fft` and `time`, for example `prevFft: null`, to `Audio`. Keep `history.prev` as the logical previous frame reference for minimal behavioral diff, or make the field the canonical storage if the implementation chooses one representation. The invariant must be explicit: the buffer is allocated once after `analyser.fftSize` is known and is never replaced per frame.
  2. In `unlock()`, immediately after `this.fft = new Uint8Array(this.analyser.frequencyBinCount)` and `this.time = new Uint8Array(this.analyser.fftSize)`, allocate `this.prevFft = new Uint8Array(this.analyser.frequencyBinCount)`. The analyser is created only once (`if (this.ctx) return` at `:1773`), so this is one allocation per AudioContext, not per frame.
  3. Reset the previous-frame validity when a new song loads. The simplest safe form is `this.history.prev = null;` as today plus `this.prevFft.fill(0)` if the buffer exists. The first post-load sample must skip flux exactly as it does today because `history.prev` is null; do not leave a stale old song spectrum active.
  4. If the chosen implementation uses `history.prev` itself as the persistent buffer, initialise it to `null`, assign `new Uint8Array(...)` only in `unlock()` or the first valid sample, and use a boolean such as `history.hasPrev` to distinguish an all-zero first spectrum from “no previous frame.” Do not use the typed-array truthiness alone as the first-frame guard.
- **Verify**: read the diff and confirm `new Uint8Array` occurs in `unlock()` only for persistent buffers, no `new` or `Uint8Array.from` is introduced in `Audio.sample()`, and the song-load reset cannot compare the new song's first spectrum with the previous song.

### Step 2 — Replace the main sampler's copy with an in-place typed-array copy

- **Files**: `engine.html:1962-1996`.
- **Action**: Keep the existing flux loop and its `this.history.prev` guard unchanged in meaning. After all code that reads `this.fft` for the current frame has finished — immediately where `this.history.prev = Uint8Array.from(this.fft)` currently occurs — copy into the persistent buffer:

  ```js
  if (!this.prevFft) this.prevFft = new Uint8Array(this.fft.length);
  this.prevFft.set(this.fft);
  this.history.prev = this.prevFft;
  ```

  Prefer allocating `prevFft` in `unlock()` from Step 1 so the fallback is defensive only and not part of the normal path. If the implementation stores the buffer directly in `history.prev`, use `history.prev.set(this.fft)` and ensure the first-frame validity flag is updated after the copy.

  Do not copy before the flux loop: doing so would make `this.history.prev` equal the current frame and force flux to zero. Do not replace `.set()` with `this.history.prev = this.fft`; the analyser overwrites `this.fft` on the next call and would destroy the previous-frame snapshot.
- **Verify**: `grep -n "Uint8Array.from(this.fft)" engine.html` returns zero; the source order remains “read old `history.prev` → compute flux → `.set(this.fft)`.”

### Step 3 — Reset and reuse the previous spectrum in all 13 shared-pipeline variants

- **Files**: `versions/aurora.html:382-440`, `versions/chrome.html:382-440`, `versions/eclipse.html:517-575`, `versions/film.html:523-575`, `versions/fractal.html:382-440`, `versions/glitch.html:382-440`, `versions/grid.html:516-568`, `versions/hallucination.html:654-706`, `versions/neon.html:519-577`, `versions/pulse.html:500-558`, `versions/smoke.html:519-571`, `versions/void.html:382-440`, and `versions/watercolor.html:382-440`.
- **Action**: Apply the same two-part change to each page, preserving local formatting and behavior:
  1. Add a persistent field alongside each page's `fft`/`time` fields, such as `prevFft:null` (or the page's surrounding spacing style). Allocate it in that page's `unlock()` next to the existing `new Uint8Array(this.an.frequencyBinCount)` allocation. The `frequencyBinCount` is fixed by the analyser's `fftSize = 2048`, so it remains the correct length.
  2. Replace that page's `this.hist.prev = Uint8Array.from(this.fft);` with `this.prevFft.set(this.fft); this.hist.prev = this.prevFft;` (split into two lines where the surrounding style is multiline). The assignment must remain after the flux loop and all current-frame spectrum reads.
  3. At each page's `load(file)`/`load(f)` reset, keep `this.hist = {prev:null,bassAvg:0,fluxAvg:0}` or its spaced equivalent. Add `if (this.prevFft) this.prevFft.fill(0);` after the reset so a prior song's spectrum is not retained if a future refactor accidentally removes the null guard. The `hist.prev = null` guard itself remains the authoritative first-frame behavior.
- **Verify**: run a source scan over `versions/*.html` and assert exactly 13 `getByteFrequencyData` pages also have `prevFft` allocation, `.set(this.fft)`, and one `hist.prev = null` reset. Assert zero `Uint8Array.from(this.fft)` matches in `versions/` and no non-target version page was modified.

### Step 4 — Keep reset semantics explicit and avoid unnecessary clearing if the implementation proves it safe

- **Files**: `engine.html:1838`, the 13 variant song-load reset lines listed in Step 3.
- **Action**: Confirm whether `history.prev = null` is enough to prevent stale data. If every flux loop checks `if (this.history.prev)` before reading, `.fill(0)` is not required for correctness and may be omitted to avoid a 1 KiB write on each song change. If `.fill(0)` is retained for defensive hygiene, it must be outside the RAF sampler and only run on load/reset. Document the choice in a short comment if it is not obvious from the code. Do not turn the per-frame operation into `history.prev = this.fft`.
- **Verify**: load a song, sample once, load a second song, sample once; the second song's first sample has zero/initial flux exactly as before. On the second sample, flux compares the second frame against the second song's first frame.

### Step 5 — Add a focused allocation/regression verifier

- **Files**: new `verify-audio-history-buffer.mjs`; `package.json:24-41` for a `verify:audio-history-buffer` script entry. The script is planned, but `package.json` is already an untracked modified target (`?? package.json:24-41`), so merge the new command carefully with that in-progress state rather than overwriting unrelated package changes.
- **Action**: Follow the repository's standalone Puppeteer verifier style. The verifier should:
  1. Start/connect to the local Vite server using the same helper pattern as existing `verify-*.mjs` scripts and open `/engine/` (or `engine.html` if that is the established route).
  2. Assert that the main page source contains no `Uint8Array.from(this.fft)` and exposes a test-only read or counter for the previous-spectrum buffer if needed. Prefer a narrow test hook only under an unmistakable flag; do not ship console logging in `sample()`.
  3. Exercise the pure buffer invariant with a small browser-side fixture if Web Audio permission/media setup is unavailable in headless mode: create two `Uint8Array` values, call the same `.set()` sequence, assert the destination object identity remains stable and the copied bytes match. This fixture is supplemental, not a substitute for source/runtime assertions.
  4. For runtime coverage, load a short known audio source through the existing engine path, sample at least three frames, and assert the previous-spectrum buffer identity stays constant while its values track the prior frame. If headless audio cannot produce deterministic analyser values, mark only that environment-dependent portion as an explicit env skip following the repository's `env skip` convention; do not claim runtime coverage from a skipped step.
  5. Scan the 13 variant source files and assert there are zero `Uint8Array.from(this.fft)` occurrences and 13 persistent allocations plus 13 `.set(this.fft)` copies.
- **Verify**: `npm run verify:audio-history-buffer` exits 0 in the normal local environment, or reports a literal environment skip for the media-dependent subsection while the static/codemod assertions still execute and pass.

### Step 6 — Run repository gates and the affected engine smoke checks

- **Files**: no additional source changes unless a focused verifier exposes a real regression.
- **Action**: Run `npm run check`, `npm run build`, and `npm run verify:audio-history-buffer`. Run the existing relevant rendering checks, at minimum `npm run verify:genops` and `npm run verify:render-dpr` if they are wired in the current `package.json`. Use a browser smoke on `/engine/` with a song and on representative variants (`versions/film.html`, `versions/aurora.html`, `versions/grid.html`) to confirm beat/onset LEDs and audio-reactive movement still respond.
- **Verify**: all commands that are available exit 0; any unavailable command is recorded as an explicit environment limitation rather than silently omitted. The source scan shows no per-frame typed-array clone and the first-frame/second-frame flux sequence is unchanged.

## Verification

- `npm run check` passes: syntax, manifest, bundle, and API tests.
- `npm run build` passes and includes the updated main engine plus all 13 variant pages.
- `npm run verify:audio-history-buffer` passes its static assertions and any available browser runtime assertions; media-dependent env skips are literal and isolated.
- `grep -R -n "Uint8Array.from(this.fft)" engine.html versions/*.html` returns zero hits.
- Source scan confirms exactly 14 persistent previous-spectrum buffers: one in `engine.html` and one in each of the 13 target variants. Each sampler copies with `.set(this.fft)` only after the flux loop.
- Behavioral regression: with a controlled spectrum sequence `S0, S1, S2`, the first sampled frame has no previous-spectrum flux, frame `S1` compares against `S0`, and frame `S2` compares against `S1`, with the same onset/beat thresholds and UI flags as before.
- Identity regression: the previous-spectrum typed-array object is identical across all steady-state samples in a recording session and changes only when a new analyser context is created.
- Browser smoke: `/engine/` and representative variant pages continue rendering non-blank output and reacting to loaded audio; no new console error or WebGL error appears.
- Performance target: one `Uint8Array` allocation per page/session instead of one ~1024-byte allocation per audio RAF. At 60 RAF/s this removes approximately 60 short-lived typed-array allocations per active page per second (14 pages only if opened concurrently; normal use is one page).

## Risks / gotchas

- **Copy order is correctness-critical**: `.set(this.fft)` must happen after the flux comparison. If it moves before the loop, onset flux becomes zero and beat/onset behavior changes silently.
- **Do not alias `this.fft`**: assigning `history.prev = this.fft` makes the next analyser write overwrite the “previous” frame. The destination must be a separate typed array.
- **Song-load reset**: `history.prev = null` is the current first-frame sentinel. Keep it, even if a persistent buffer exists, and optionally clear the bytes outside the hot path. Otherwise the first frame of a new song could compare against the prior song.
- **Duplicate implementation surfaces**: the 13 variant pages have near-identical but not byte-identical samplers; do not mass-replace a formatting-specific block without checking each diff. `film`, `grid`, `hallucination`, `smoke`, and `neon` have minor formatting differences and distinct smoothing constants.
- **Non-target pages**: `baroque`, `kraft`, `mosaic`, `phosphor`, and `tape` use separate older/manual renderers and do not have the exact `hist.prev` copy. `spectrum` has analyser buffers for a diagnostic page but no spectral-history copy. Keep all out of scope unless a scan proves a matching bug.
- **Main engine versus versions**: `engine.html` uses `history.prev` and the variants use `hist.prev`; the field/reset names must match each page's local object. Do not assume a shared Audio module exists.
- **Persistent typed-array retention**: the buffer stays alive for the page's AudioContext lifetime, approximately 1 KiB. This is intentional and negligible versus the analyser buffers and media elements. If a future `Audio` teardown is added, null it with the other buffers.
- **Headless analyser behavior**: Web Audio may be suspended or silent in Puppeteer. Keep deterministic source scans separate from media assertions and use the repository's explicit env-skip convention only for the unavailable media portion.
- **Dirty package file**: `package.json:24-41` is already modified/untracked in the working tree. The agent implementing this plan must inspect and merge that diff before adding the verifier script entry; it must not overwrite it.
- **Do not broaden to every historical renderer**: this plan intentionally targets the exact 14 duplicated hot paths; adding a shared audio module for all 19 version pages is an architectural rewrite and would make the acceptance criterion harder to validate.

## Out of scope

- Moving audio analysis to an `AudioWorklet`, Worker, or `OfflineAudioContext`. Those are larger scheduling/latency changes, not the fixed-buffer allocation fix.
- Rewriting the analyser's feature extraction, frequency bands, RMS, centroid, onset thresholds, smoothing constants, or beat/BPM algorithm. Numerical and audible behavior must remain unchanged.
- Replacing `Uint8Array` with `Float32Array`, changing `fftSize`, or changing `smoothingTimeConstant`.
- Pooling or reusing the renderer's `ImageData`, offscreen canvases, WebGL textures, or recorder buffers. Those have separate plans and lifetimes.
- Refactoring the 13 variant pages into a shared imported Audio module. Keep this plan a mechanical, reviewable codemod across existing surfaces.
- Touching `audio-analysis-v2.js` batch analysis. Its FFT caches and returned magnitudes are a separate offline-analysis path, not the RAF sampler.
- Adding a new industry template, persona copy, image prompt, or multi-prosumer collaboration feature in this cycle.
