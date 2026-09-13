# Hoist per-frame `Float32Array(128)` allocations out of `versions/spectrum.html` paint loop

**Cycle**: 2026-09-06T22-45
**Type**: speed
**Priority**: P1
**Estimated effort**: XS

## TL;DR

`versions/spectrum.html`'s `paint()` RAF loop (the 60 Hz spectrum-bar visualizer) allocates **2 to 3 typed arrays per frame**: `spec = new Float32Array(128)` at line 187, `peakHold = new Float32Array(128)` at line 201, and a third inside `syntheticSpectrum()` at line 156 (fallback path when no audio is loaded). Hoist all three to module scope, lazy-init on first paint, and reuse them in-place — write into `peakHold[i]` in the existing decay loop and read `spec[i]` (the same buffer the FFT branch fills). Zero per-frame allocation, pixel-identical output, no behavior change. Mirrors the proven hoist pattern from `engine-timing.client.js` and the spectrum/audio-viz gradient fixes in cycles 2026-09-06T01-40 / 06-45.

## Why this cycle

### Scan evidence

```text
$ grep -nE "new (Float32Array|Uint8Array)\(.*128" versions/spectrum.html
187:        spec = new Float32Array(128);
201:        const peakHold = new Float32Array(128);

$ grep -nE "new Float32Array\(bins\)" versions/spectrum.html
156:      const out = new Float32Array(bins);
```

`paint()` runs at 60 Hz (it calls `requestAnimationFrame(paint)` at line 302). Each invocation:

1. Line 184–195 — calls `pullAudioFeatures()`. If `audioPull.ok && fftData`, allocates a fresh `spec = new Float32Array(128)` (line 187). Else calls `syntheticSpectrum(t)` which allocates its own `out = new Float32Array(bins)` at line 156 and returns it. Either way, **128 floats (512 bytes) allocated and immediately GC-eligible every frame**.
2. Line 201 — `const peakHold = new Float32Array(128);` allocates a second 512-byte buffer that is read+written for decay tracking (lines 203-206) and then read at line 211. **The decay loop only reads/writes the buffer, it does not depend on previous-frame contents being a fresh allocation — perfect hoist candidate.**
3. Lines 203-206 — the loop:
   ```js
   for (let i = 0; i < 128; i++) {
     if (spec[i] > peakHold[i]) peakHold[i] = spec[i];
     else peakHold[i] = Math.max(0, peakHold[i] - 0.012);
   }
   ```
   uses the buffer in-place across iterations. Hoisting is safe.

### Why no prior cycle caught it

- Cycle `2026-09-06T01-40-speed-audio-viz-gradient-allocs.md` — focused on gradients in `engine.html` / `engine-*.client.js`, didn't audit standalone variants.
- Cycle `2026-09-06T06-45-speed-variant-2d-paint-gradients.md` — cached `bgGrad` (line 177) and `ringGrad` (line 266) for `spectrum.html`, **explicitly scoped to gradients only**. The plan even notes on line 36 of the related drawmeter plan that the variants still have other per-frame allocs.
- Cycle `2026-09-06T03-54-speed-variant-drawmeter-grad-cache.md` — `paint-2d-spectrum-beat-ring-radial` tag covers only line 266. **No plan yet addresses lines 187 / 201 / 156 typed-array allocs.**

The 2026-09-06T06-45 plan included `variant-paint-2d-spectrum-backdrop-linear` (line 177) and `variant-paint-2d-spectrum-beat-ring-radial` (line 266) but missed the typed-array hot path. This cycle fills the gap.

### Why it scores high

| Axis | Score | Reason |
|---|---|---|
| Impact | 4 | 2–3 × 512B = 1.0–1.5 KB of GC-eligible allocation per frame at 60 Hz = **60–90 KB/sec garbage pressure** in a hot visualizer loop. Eliminates that completely. Lower visual delta than a missing feature (P0 latent bug), but cumulatively matters across the user's long sessions. |
| Confidence | 5 | The `peakHold` decay loop is in-place — no dependency on fresh allocation. `spec` reuse requires writing in-place in the FFT mapping loop (already does), and the synthetic path writes into `out[i]` (also already does). Identical observable behavior. |
| Novelty | 5 | New topic: `variant-spectrum-paint-spec-allocs`, `variant-spectrum-paint-peakh-alloc`, `variant-spectrum-synthetic-spec-allocs`. Not in any prior plan or STATE tag list. |

Total: 14/15. Tie-break (speed > quality > template) makes this the pick.

## Goal

A fresh agent applies Steps 1–3 below and the result is:

- `paint()` performs **zero** `new Float32Array` / `new Uint8Array` calls per frame after the first invocation.
- Visible output is pixel-identical: same spectrum bars, same peak-hold decay, same beat-pulse ring.
- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run build` passes.

## Plan

### Step 1 — Hoist `peakHold` to module scope

- **Files**: `versions/spectrum.html:201`
- **Action**: declare `let peakHold;` at module scope (near the existing `let fftData; let waveform;` declarations around line 134). Replace line 201 with:
  ```js
  if (!peakHold) peakHold = new Float32Array(128);
  // Decay peaks
  for (let i = 0; i < 128; i++) { ... }
  ```
- **Verify**: `grep -nE "peakHold" versions/spectrum.html` shows exactly one `new Float32Array` call (in the init guard) and the reuse in `paint()`.

### Step 2 — Hoist `spec` to module scope (FFT branch)

- **Files**: `versions/spectrum.html:184-195`
- **Action**: declare `let specBuf;` at module scope. Replace lines 184-195 with:
  ```js
  let spec;
  if (!specBuf) specBuf = new Float32Array(128);
  const audioPull = pullAudioFeatures();
  if (audioPull.ok && fftData) {
    spec = specBuf;
    for (let i = 0; i < 128; i++) {
      const bin = Math.floor(Math.pow(i / 128, 1.6) * (fftData.length - 1));
      spec[i] = fftData[bin] / 255;
    }
  } else {
    spec = syntheticSpectrum(t);   // still allocs internally — fix in Step 3
  }
  ```
  Note: `spec` is already mutated in-place in the FFT mapping loop and read elsewhere as `spec[i]`. Reusing the buffer is safe.
- **Verify**: `grep -nE "new Float32Array\(128\)" versions/spectrum.html` shows at most one match (the init guard for `specBuf`).

### Step 3 — Hoist `syntheticSpectrum` output buffer

- **Files**: `versions/spectrum.html:147-170` (`syntheticSpectrum` function definition)
- **Action**: change signature so it fills a caller-provided buffer instead of allocating:
  ```js
  // _syntheticBuf declared at module scope alongside specBuf
  function syntheticSpectrum(t, out) {
    const bass = 0.5 + Math.sin(t * 1.5) * 0.4;
    const mid = 0.5 + Math.sin(t * 0.8 + 0.5) * 0.3;
    const tr = 0.4 + Math.abs(Math.sin(t * 4)) * 0.4;
    const bins = 128;
    for (let i = 0; i < bins; i++) {
      const f = i / bins;
      let amp;
      if (f < 0.05) amp = bass * 0.6;
      else if (f < 0.2) amp = bass * (1 - (f - 0.05) / 0.15);
      else if (f < 0.5) amp = mid * (1 - (f - 0.2) / 0.3) * 0.9;
      else if (f < 0.8) amp = tr * (1 - (f - 0.5) / 0.3) * 0.7;
      else amp = tr * 0.3 * (1 - (f - 0.8) / 0.2);
      amp *= 0.85 + 0.15 * Math.sin(t * 3 + i * 0.4);
      out[i] = Math.max(0, Math.min(1, amp));
    }
  }
  ```
  Caller side (Step 2 fallback branch):
  ```js
  } else {
    if (!_syntheticBuf) _syntheticBuf = new Float32Array(128);
    syntheticSpectrum(t, _syntheticBuf);
    spec = _syntheticBuf;
  }
  ```
- **Verify**: `grep -nE "new Float32Array" versions/spectrum.html` shows exactly 3 lines (1× fftData, 1× waveform init guards, 1× specBuf init guard, 1× _syntheticBuf init guard — note `fftData`/`waveform` are already lazy-init, count those plus the 2 new guards). All four occur inside `if (!buf) buf = new Float32Array(...)` lazy-init patterns. Zero allocations on the hot path.

### Step 4 — Sanity-check adjacent variants

- **Files**: `versions/pulse.html:503-504` already lazy-init `fft` and `time` buffers correctly — no change needed.
- **Action**: `grep -nE "new (Float32Array|Uint8Array)" versions/{pulse,neon,grid,aurora,chrome,fractal,glitch,void,smoke,watercolor}.html | grep -v "if (!"` and confirm no other variant has the same pattern. If a similar alloc-in-RAF shows up, mention it in the plan but do not change here.
- **Verify**: terminal command above returns empty (or only the same `if (!buf)` init guards already in place).

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run build` passes.
- Open `versions/spectrum.html` in browser, load any audio, observe FPS counter (line 884 — `$('fps').textContent`) — should report same or better FPS than pre-fix. DevTools Memory tab → take a heap snapshot before and after 10 s of playback: post-fix snapshot shows no growth in `(Float32Array × 128)` arrays after the first frame.
- `grep -nE "new (Float32Array|Uint8Array)" versions/spectrum.html | grep -v "if (!"` returns empty.

## Risks / gotchas

- **Float32Array reuse aliasing**: if any code path stores `spec` across frames expecting immutable snapshot semantics, reuse would corrupt it. Audit: `spec` is only used within `paint()` (lines 200, 204-205, 211, 220, 240, 247, 296-298). Lines 296-298 read `spec[10]/spec[64]/spec[110]` to feed `window.SWR.Audio.feat`. **This is on the same callstack within `paint()`** — safe. The recorder's `captureLoop` runs in its own RAF and reads from `stage`/`fftData`, not `spec`. Confirmed safe.
- **`syntheticSpectrum` is not called from anywhere else in `spectrum.html`** (single grep call site at line 194). Signature change is internal — no other consumer.
- **Behavioral regression risk on the audio-fallback path**: pre-fix, `syntheticSpectrum(t)` returned a fresh buffer every call; post-fix, it fills the same buffer. The function writes to `out[i]` in-place already, so the output array contents are identical at the moment `paint()` finishes the call. No observable change.
- **Bundle size**: removing the typed-array allocations has no bundle-size impact (V8 hoists/inlines either way), but the resulting `if (!buf) buf = new Float32Array(128)` pattern adds 2 lines per buffer — net ~6 lines, +200 bytes minified.

## Out of scope

- Caching `bgGrad` / `ringGrad` — already covered by cycle `2026-09-06T06-45`.
- Replacing the per-frame template-literal `rgba(...)` strings (lines 239, 251-253) — pre-built fillStyle arrays would be a separate cycle (would also eliminate string-alloc pressure).
- Variant codemod for other RAF paint loops (mosaic, baroque, collage, typography, etc.) — separate cycle if a scan shows similar `new Float32Array` patterns.
- Audio sampling rate / FFT size changes — unrelated.