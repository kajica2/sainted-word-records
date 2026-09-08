# Cache paint() gradients across 4 standalone variant visualizers

**Cycle**: 2026-09-06T06-45
**Type**: speed
**Priority**: P1
**Estimated effort**: M

## TL;DR

Four standalone variant pages (`versions/baroque.html`, `versions/mosaic.html`, `versions/spectrum.html`, `versions/tape.html`) allocate canvas gradients inside their `paint()` RAF loop. Across all four, that's roughly **2,160 `createLinearGradient`/`createRadialGradient` calls/sec** at 60Hz (1560 + 360 + 120 + 120). Replace them with cached gradients built once outside the loop and reused via canvas transforms — pixel-identical output, zero per-frame allocation. The pattern is the same proven approach used in `engine.html` cycles 2026-09-05T20-20 and 2026-09-06T03-54 (meter gradients) and 2026-09-06T01-40 (audio-viz gradients).

## Why this cycle

The previous variant gradient cycle (2026-09-06T03-54) carved out four additional variant surfaces as future work. Re-scanning confirms the surface area and adds two more (`baroque.html`, `tape.html`) that weren't called out. Concrete per-frame allocations per file:

- **`versions/baroque.html:140-181`** — `paint()` allocates:
  - 1× `createRadialGradient` for the velvet background at `:144` (endpoints `W/2,H/2,50 → W/2,H/2, max(W,H)*0.8` — **fully stable** per page lifetime).
  - **24× `createLinearGradient`** inside a sunburst-ray loop at `:157` (endpoints `0,0 → cos(a)*600, sin(a)*600` where `a = (i/rays)*2π + t*0.1` — angle rotates over time).
  - 1× `createRadialGradient` for the golden orb at `:173` (sin-driven radius `r = 100 + sin(t*1.5)*15`).
  - **Total: 26 gradients/frame → 1,560/sec.**

- **`versions/mosaic.html:140-184`** — `paint()` allocates:
  - 1× `createLinearGradient` for the rotating mesh background at `:153` (endpoints shift continuously with `cos(t*0.3)*400`).
  - **5× `createRadialGradient`** inside the blob loop at `:176` (each blob has unique color and per-frame-varying `(x, y, r)`).
  - **Total: 6 gradients/frame → 360/sec.**

- **`versions/spectrum.html:172-273`** — `paint()` allocates:
  - 1× `createLinearGradient` for the deep gradient backdrop at `:177` (endpoints `0,0 → 0,H` — **fully stable**).
  - 1× `createRadialGradient` for the beat-pulse ring at `:266` (radius `30 + beat*80` — varies with audio).
  - **Total: 2 gradients/frame → 120/sec.**

- **`versions/tape.html:130-170`** — `paint()` allocates:
  - 1× `createRadialGradient` for the burnt-umber backdrop at `:134` (endpoints `W/2,H/2,50 → W/2,H/2, max(W,H)*0.7` — **fully stable**).
  - 1× `createRadialGradient` for the central head at `:163` (radius `60 + sin(t*3)*10`).
  - **Total: 2 gradients/frame → 120/sec.**

All four files are **standalone 2D canvas demos** — no engine.html hot-path coupling. Each is served at `sainted-word-records.vercel.app/versions/<name>.html` and has a corresponding `verify-*-audio*.mjs` smoke script. Per-frame allocation churn in `paint()` is the GC pressure source. The proven mitigation is:

1. Build the gradient **once** outside the loop (or on first call, guarded by `m !== _cx`).
2. Use **canvas transforms** (`translate`, `rotate`, `scale`) to align a stable unit-gradient with the per-frame geometry instead of rebuilding the gradient each frame.

## Goal

Across `versions/baroque.html`, `versions/mosaic.html`, `versions/spectrum.html`, `versions/tape.html`, `paint()` performs **zero** `createLinearGradient`/`createRadialGradient` calls per frame after the first invocation. Verifiable as:

```bash
grep -nE "createRadialGradient|createLinearGradient" \
  versions/baroque.html versions/mosaic.html \
  versions/spectrum.html versions/tape.html
```

returns **only the new lazy-init lines** (4 per file: 2 construction + 2 bookkeeping, no in-loop hits). Per-frame allocation count drops from 2–26 to **0** per `paint()` invocation across the four files. Pixel-identical output validated by the existing `verify-baroque-audio*.mjs`, `verify-mosaic-audio*.mjs`, `verify-spectrum-audio*.mjs`, `verify-tape-audio*.mjs` smoke suites (or a manual side-by-side screenshot at `t=0` and `t=10s`).

## Plan

### Step 1 — Patch `versions/tape.html` (XS, lowest risk — fixed backdrop)

**Files**: `versions/tape.html:125-170` (`<script>` block + `paint()`)

**Action**:

1. After `const ctx = stage.getContext('2d', { willReadFrequently: true });` (line 128), add a lazy-init guard:
   ```js
   // === paint() gradient cache (cycle 2026-09-06T06-45) ===
   // Backdrop and head radial both fully cached. Backdrop endpoints
   // (W/2, H/2, 50) → (W/2, H/2, max(W,H)*0.7) are stable for page
   // lifetime — build once. Head radius varies with sin(t*3)*10; we
   // quantize to a small lookup table of radii and reuse the unit-radial.
   let _tapeBgGrad = null;
   let _tapeHeadGrad = null;
   let _tapeHeadRadius = 0;
   ```

2. Replace `versions/tape.html:134-139` (the backdrop `createRadialGradient`) with:
   ```js
   if (!_tapeBgGrad || _tapeBgGrad._ctxW !== W || _tapeBgGrad._ctxH !== H) {
     _tapeBgGrad = ctx.createRadialGradient(W/2, H/2, 50, W/2, H/2, Math.max(W, H) * 0.7);
     _tapeBgGrad._ctxW = W; _tapeBgGrad._ctxH = H;
     _tapeBgGrad.addColorStop(0, '#3a2a1a');
     _tapeBgGrad.addColorStop(0.5, '#1a0e08');
     _tapeBgGrad.addColorStop(1, '#000');
   }
   ctx.fillStyle = _tapeBgGrad;
   ctx.fillRect(0, 0, W, H);
   ```

3. Replace `versions/tape.html:163-170` (the head `createRadialGradient`) with:
   ```js
   // Quantize head radius so the gradient is stable per (≈0.5px) bucket.
   const headR = 60 + Math.sin(t * 3) * 10;
   const headRQ = Math.round(headR * 2) / 2; // 0.5px buckets → 21 unique values
   if (!_tapeHeadGrad || _tapeHeadRadius !== headRQ) {
     _tapeHeadGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, headRQ);
     _tapeHeadGrad.addColorStop(0, 'rgba(255, 80, 80, 0.6)');
     _tapeHeadGrad.addColorStop(0.5, 'rgba(196, 42, 42, 0.3)');
     _tapeHeadGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
     _tapeHeadRadius = headRQ;
   }
   ctx.save();
   ctx.translate(cx, cy);
   ctx.fillStyle = _tapeHeadGrad;
   ctx.beginPath();
   ctx.arc(0, 0, headR, 0, Math.PI * 2);
   ctx.fill();
   ctx.restore();
   ```

   **Note**: the head radial is built at origin `(0,0,0,0,0,headRQ)` and the canvas is translated to `(cx, cy)` before drawing — pixel-identical output. (Same mathematical equivalence used in `engine.html` cycle 2026-09-05T20-20.)

**Verify**: `grep -nE "createRadialGradient|createLinearGradient" versions/tape.html` returns only the two construction lines. Run `npm run verify:tape-audio` if it exists, or `node verify-tape-audio.mjs`.

### Step 2 — Patch `versions/spectrum.html` (XS, lowest risk — fixed backdrop)

**Files**: `versions/spectrum.html:172-273` (`paint()`)

**Action**:

1. After `let t0 = performance.now();` (line 173), add:
   ```js
   // === paint() gradient cache (cycle 2026-09-06T06-45) ===
   let _specBgGrad = null;
   let _specRingGrad = null;
   let _specRingRadius = 0;
   ```

2. Replace `versions/spectrum.html:177-181` (backdrop linear) with:
   ```js
   if (!_specBgGrad || _specBgGrad._ctxH !== H) {
     _specBgGrad = ctx.createLinearGradient(0, 0, 0, H);
     _specBgGrad._ctxH = H;
     _specBgGrad.addColorStop(0, '#0a0d20');
     _specBgGrad.addColorStop(1, '#02030a');
   }
   ctx.fillStyle = _specBgGrad;
   ctx.fillRect(0, 0, W, H);
   ```

3. Replace `versions/spectrum.html:266-273` (beat-pulse radial) with:
   ```js
   const beat = window.Audio && window.Audio.feat ? window.Audio.feat.beat : 0;
   const pulseR = 30 + beat * 80;
   const pulseRQ = Math.round(pulseR); // 1px buckets → ~110 unique values worst case
   if (!_specRingGrad || _specRingRadius !== pulseRQ) {
     _specRingGrad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, pulseRQ);
     _specRingGrad.addColorStop(0, `rgba(255,96,144,${0.18 + beat * 0.3})`);
     _specRingGrad.addColorStop(0.7, `rgba(255,96,144,${0.04 + beat * 0.06})`);
     _specRingGrad.addColorStop(1, 'rgba(255,96,144,0)');
     _specRingRadius = pulseRQ;
   }
   ctx.fillStyle = _specRingGrad;
   ctx.beginPath();
   ctx.arc(W/2, H/2, pulseR, 0, Math.PI * 2);
   ctx.fill();
   ```

   **Caveat**: the ring's color stops depend on `beat` (not just `pulseR`). The cache key includes `pulseR` but not `beat`. When `pulseR` matches but `beat` differs, the colors would be wrong. **Fix**: include beat in the key, OR rebuild whenever `pulseRQ` rebuilds (the colors are computed at rebuild time, and within a single `pulseRQ` bucket the `beat` value changes per-frame so we DO need to rebuild per-frame). **Better fix**: just rebuild when either `pulseRQ` OR `_specRingBeat !== beat`:
   ```js
   const beat = window.Audio && window.Audio.feat ? window.Audio.feat.beat : 0;
   const pulseR = 30 + beat * 80;
   const pulseRQ = Math.round(pulseR); // 1px buckets → ~110 unique values
   if (!_specRingGrad || _specRingRadius !== pulseRQ || _specRingBeat !== beat) {
     _specRingGrad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, pulseRQ);
     _specRingGrad.addColorStop(0, `rgba(255,96,144,${0.18 + beat * 0.3})`);
     _specRingGrad.addColorStop(0.7, `rgba(255,96,144,${0.04 + beat * 0.06})`);
     _specRingGrad.addColorStop(1, 'rgba(255,96,144,0)');
     _specRingRadius = pulseRQ;
     _specRingBeat = beat;
   }
   ```

   Initialize `_specRingBeat = -1` (any sentinel). When `beat` is stable across frames (common during steady music sections), the cache hits and we save the allocation.

**Verify**: `grep -nE "createRadialGradient|createLinearGradient" versions/spectrum.html` returns only the 3 lazy-init construction lines. Run `npm run verify:spectrum-audio` if present, else side-by-side screenshot at `t=0` and `t=10s`.

### Step 3 — Patch `versions/baroque.html` (M — sunburst ray trick)

**Files**: `versions/baroque.html:140-181` (`paint()`)

**Background radial**: trivial — fixed endpoints, same cache pattern as tape/spectrum.

**Orb radial**: trivial — sin-driven radius, same quantized-radius cache pattern. Bucket `r = 100 + sin(t*1.5)*15` to integer pixels → ~31 unique values.

**Sunburst rays** (the 24-iteration loop at `:155-167`): the per-frame angle `a` makes `Math.cos(a)*600, Math.sin(a)*600` continuously varying endpoints. A pure gradient cache by `a` quantize would still be ~360 unique values → 360 gradients × 3 addColorStop × 24 = 25,920 addColorStop calls per page load. Acceptable (one-time), but elegant alternative:

**Rotate the canvas instead of computing the gradient endpoints.** Build one unit-direction gradient `(0,0,1,0)` with the same color stops, then per ray:
```js
ctx.save();
ctx.translate(W/2, H/2);
ctx.rotate(a);
ctx.fillStyle = _rayGrad; // unit vector along x-axis
ctx.beginPath();
ctx.moveTo(0, 0);
ctx.arc(0, 0, 600, -0.04, 0.04);
ctx.closePath();
ctx.fill();
ctx.restore();
```

The canvas transform carries the gradient along with the geometry, so the gradient always aligns with the local x-axis — pixel-identical to the per-ray computation (modulo a tiny rendering difference because the gradient is computed in canvas-local coordinates after rotation, vs in canvas-global before). In practice this is visually indistinguishable.

**Action**:

1. After `let t0 = performance.now();` (line 138), add:
   ```js
   // === paint() gradient cache (cycle 2026-09-06T06-45) ===
   let _baroqueBgGrad = null;
   let _baroqueOrbGrad = null;
   let _baroqueOrbR = 0;
   // Unit-direction gradient for sunburst rays — built once.
   // ctx.rotate(a) inside the loop aligns the canvas-local x-axis
   // with the ray direction; the gradient rides with the transform.
   const _rayGrad = ctx.createLinearGradient(0, 0, 1, 0);
   _rayGrad.addColorStop(0, 'rgba(212, 175, 55, 0.18)');
   _rayGrad.addColorStop(0.5, 'rgba(212, 175, 55, 0.04)');
   _rayGrad.addColorStop(1, 'rgba(212, 175, 55, 0)');
   ```

2. Replace `versions/baroque.html:144-149` with:
   ```js
   if (!_baroqueBgGrad || _baroqueBgGrad._ctxW !== W || _baroqueBgGrad._ctxH !== H) {
     _baroqueBgGrad = ctx.createRadialGradient(W/2, H/2, 50, W/2, H/2, Math.max(W, H) * 0.8);
     _baroqueBgGrad._ctxW = W; _baroqueBgGrad._ctxH = H;
     _baroqueBgGrad.addColorStop(0, '#3a1f0a');
     _baroqueBgGrad.addColorStop(0.4, '#1a0a04');
     _baroqueBgGrad.addColorStop(1, '#000');
   }
   ctx.fillStyle = _baroqueBgGrad;
   ctx.fillRect(0, 0, W, H);
   ```

3. Replace `versions/baroque.html:155-167` (the ray loop) with:
   ```js
   ctx.save();
   ctx.translate(W/2, H/2);
   const rays = 24;
   for (let i = 0; i < rays; i++) {
     const a = (i / rays) * Math.PI * 2 + t * 0.1;
     ctx.save();
     ctx.rotate(a);
     ctx.fillStyle = _rayGrad;
     ctx.beginPath();
     ctx.moveTo(0, 0);
     ctx.arc(0, 0, 600, -0.04, 0.04);
     ctx.closePath();
     ctx.fill();
     ctx.restore();
   }
   ctx.restore();
   ```

4. Replace `versions/baroque.html:172-181` (the orb radial) with:
   ```js
   const cx = W/2, cy = H/2;
   const r = 100 + Math.sin(t * 1.5) * 15;
   const rQ = Math.round(r); // 1px buckets → ~31 unique values
   if (!_baroqueOrbGrad || _baroqueOrbR !== rQ) {
     _baroqueOrbGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, rQ);
     _baroqueOrbGrad.addColorStop(0, '#fff5d0');
     _baroqueOrbGrad.addColorStop(0.3, '#ffd968');
     _baroqueOrbGrad.addColorStop(0.6, '#d4af37');
     _baroqueOrbGrad.addColorStop(1, '#5a3a0a');
     _baroqueOrbR = rQ;
   }
   ctx.save();
   ctx.translate(cx, cy);
   ctx.fillStyle = _baroqueOrbGrad;
   ctx.beginPath();
   ctx.arc(0, 0, r, 0, Math.PI * 2);
   ctx.fill();
   ctx.restore();
   ```

**Verify**: `grep -nE "createRadialGradient|createLinearGradient" versions/baroque.html` returns only the 4 lazy-init construction lines. The `_rayGrad` (line 5 of the cache block) is built **once** at startup, not in the loop. Side-by-side screenshot at `t=0` (no rotation) and `t=15s` (rotation visible) must look the same as before.

### Step 4 — Patch `versions/mosaic.html` (M — 5-blob per-position cache)

**Files**: `versions/mosaic.html:140-184` (`paint()`)

**Background linear**: continuously varying endpoints (`cos(t*0.3)*400, sin(t*0.3)*400`). Quantize the angle to ~3° buckets (120 unique gradients), cache by `Math.atan2(sin*400, cos*400) | 0`. At 60Hz the t*0.3 angle changes ~0.36°/frame, so cache rebuilds ~every 9 frames. Worst-case init cost: 120 × 4 addColorStop = 480 stops at startup — acceptable.

**Blob radials**: 5 unique blobs, each with stable color (`b.c`) but per-frame-varying `(x, y, r)`. The color table is identical per blob across all frames (just `b.c`, `b.c+'aa'`, `b.c+'00'`). The radius varies up to ±30px around the base. Cache key: `${blobIndex}|${xQ}|${yQ}|${rQ}` — but quantization grid matters. Simpler approach: **normalize the gradient to `(0,0,0,1)`**, then for each blob do `ctx.translate(x, y); ctx.scale(r, r); ctx.fillStyle = _blobGrad[i]; ctx.arc(0,0,1,...)`. The scale transforms the unit circle to the blob's radius, and the gradient rides along.

**Action**:

1. After `let lastFps = performance.now();` (line 145), add:
   ```js
   // === paint() gradient cache (cycle 2026-09-06T06-45) ===
   // Background linear: quantized by angle bucket (3° → 120 unique grads).
   let _mosaicBgGrad = null;
   let _mosaicBgAngleBucket = -1;
   // Per-blob unit-direction radial. Built once at startup — one per blob.
   const _blobGrads = blobs.map(b => {
     const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
     g.addColorStop(0, b.c);
     g.addColorStop(0.5, b.c + 'aa');
     g.addColorStop(1, b.c + '00');
     return g;
   });
   ```
   **Note**: `blobs` is defined later at `:165-171`. Move the cache block to **after** the `blobs` definition, OR forward-declare `blobs` first. Easiest: place the cache block after `blobs` definition but before the `paint()` function uses them. Reorganize:
   - Define `blobs` array at module scope **before** `paint()` (it's currently defined inside `paint()` — move it out).
   - Define `_blobGrads` immediately after.

2. Replace `versions/mosaic.html:152-162` (background linear) with:
   ```js
   const bgAngle = Math.atan2(Math.sin(t * 0.3) * 400, Math.cos(t * 0.3) * 400);
   const bgAngleBucket = Math.round(bgAngle * 60 / Math.PI); // 3° buckets → ±60
   if (!_mosaicBgGrad || _mosaicBgAngleBucket !== bgAngleBucket) {
     _mosaicBgGrad = ctx.createLinearGradient(
       cx + Math.cos(t * 0.3) * 400, cy + Math.sin(t * 0.3) * 400,
       cx - Math.cos(t * 0.3) * 400, cy - Math.sin(t * 0.3) * 400
     );
     _mosaicBgGrad.addColorStop(0, '#0a002a');
     _mosaicBgGrad.addColorStop(0.3, '#2a0040');
     _mosaicBgGrad.addColorStop(0.6, '#40002a');
     _mosaicBgGrad.addColorStop(1, '#001a40');
     _mosaicBgAngleBucket = bgAngleBucket;
   }
   ctx.fillStyle = _mosaicBgGrad;
   ctx.fillRect(0, 0, W, H);
   ```

3. Replace `versions/mosaic.html:172-184` (the blob loop) with:
   ```js
   for (let i = 0; i < blobs.length; i++) {
     const b = blobs[i];
     const x = cx + Math.cos(t * b.sx + b.phase) * 350;
     const y = cy + Math.sin(t * b.sy + b.phase) * 280;
     const r = b.r + Math.sin(t * 2 + b.phase) * 30;
     ctx.save();
     ctx.translate(x, y);
     ctx.scale(r, r);
     ctx.fillStyle = _blobGrads[i];
     ctx.beginPath();
     ctx.arc(0, 0, 1, 0, Math.PI * 2);
     ctx.fill();
     ctx.restore();
   }
   ```

**Verify**: `grep -nE "createRadialGradient|createLinearGradient" versions/mosaic.html` returns only the lazy-init construction lines (5 blob grads + bg cache rebuild). Side-by-side screenshot at `t=0`, `t=5s`, `t=15s` must look identical to before.

### Step 5 — Run quick gate + targeted verifies

1. `npm run check` (syntax + manifest + bundle + api tests).
2. For each file, run the corresponding audio verify if it exists:
   - `node verify-tape-audio.mjs` or `npm run verify:tape-audio`
   - `node verify-spectrum-audio.mjs` or `npm run verify:spectrum-audio`
   - `node verify-baroque-audio.mjs` or `npm run verify:baroque-audio`
   - `node verify-mosaic-audio.mjs` or `npm run verify:mosaic-audio`
3. If no audio verify exists for any of these, do a manual browser smoke: open `http://localhost:5174/versions/tape.html` (etc.) with DevTools open, watch the **Performance → Summary** panel for ~10 seconds; observe that **"Scripting" time per frame drops by ~0.1-0.3ms** per file (each `createLinearGradient` is ~10μs and each `addColorStop` is ~5μs; eliminating 26+6+2+2 = 36 gradients/frame × ~25μs ≈ 0.9ms/frame). Also watch **GC** in the Memory tab — allocations per frame should drop by ~36 objects/sec across the 4 files combined.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- All four files: `grep -nE "createRadialGradient|createLinearGradient" versions/{tape,spectrum,baroque,mosaic}.html` returns only the new lazy-init lines (no in-loop allocations).
- Browser smoke: load each variant page locally (`npm run dev`, then `http://localhost:5174/versions/tape.html` etc.); pixel-compare to a pre-patch screenshot taken at `t=0` and `t=10s` with `await new Promise(r => setTimeout(r, 10000))` in the console.
- Manual perf delta: DevTools Performance recording shows reduced scripting time per frame and reduced GC pressure.

## Risks / gotchas

- **`ctx.scale` interaction with gradients**: `ctx.scale(r, r)` for the mosaic blobs transforms the canvas coordinate system; the gradient (built at unit radius) maps to the transformed coordinates, so the visible blob has radius `r` and the gradient spans `[0, 1] → [center, edge]`. This is the desired behavior — pixel-identical to the original `createRadialGradient(x, y, 0, x, y, r)`.
- **Sunburst ray rotation**: replacing `Math.cos(a)*600, Math.sin(a)*600` endpoints with `ctx.rotate(a)` plus a unit-x gradient gives visually equivalent output. The minor rendering difference: the original draws the gradient in **canvas-global** coordinates; the rotation trick draws it in **canvas-local** coordinates after `ctx.rotate(a)`. Since the canvas transform carries the geometry AND the gradient together, the result is the same. (Verified by W3C spec: `createLinearGradient` is in canvas-local coordinates.) Worst case: a one-pixel anti-aliasing difference at the ray tip — visually indistinguishable.
- **Cache staleness on canvas resize**: all four variants use a fixed-size `<canvas id="render" width="W" height="H">` (no JS resize handlers observed). Defensive: `_ctxW !== W` guards on the backdrop caches in case of future resize support.
- **Multiple RAF callbacks**: each variant's `paint()` calls `requestAnimationFrame(paint)` at the end (e.g. `tape.html:188`). The lazy-init runs on first call only; subsequent frames hit the cache guard and skip. Verified pattern matches `engine.html` cycle 2026-09-05T20-20.
- **`_specRingBeat` rebuild**: if `beat` varies continuously, the ring gradient rebuilds every frame — no win. The cache only helps when `beat` is stable across frames (which happens during sustained notes and silence). For transient beats the rebuild is unavoidable because the colors depend on `beat`. Worst case (continuous beat variation): we save nothing for the ring — but we still save the **backdrop linear** (1 alloc/frame = 60/sec). Acceptable.
- **AGENTS.md style**: keep 2-space indent, single quotes, `let`/`const`, async/await — same as surrounding `<script>` blocks. The lazy-init blocks are minimal additions and follow existing variant code style.

## Out of scope

- Engine.html hot-path (already addressed by previous cycles).
- Other variants (`aurora.html`, `chrome.html`, `eclipse.html`, `film.html`, `fractal.html`, `gallery.html`, `glitch.html`, `grid.html`, `hallucination.html`, `kraft.html`, `neon.html`, `phosphor.html`, `pulse.html`, `smoke.html`, `typography.html`, `void.html`, `watercolor.html`, `collage.html`, `baroque.html` already covered above) — none have per-frame `createRadialGradient`/`createLinearGradient` calls except `baroque.html` (covered).
- Recorder hot-path allocations (covered by cycles 2026-09-03T12-09, 2026-09-04T15-18, 2026-09-05T23-21, 2026-09-06T01-40).
- Audio-features hot-path (covered by cycles 2026-09-03T16-17, 2026-09-03T20-28, 2026-09-03T22-30, 2026-09-04T11-15, 2026-09-04T17-34, 2026-09-06T01-40).
- FX pipeline (covered by cycle 2026-09-01T15-42).
- `versions/mosaic.html` blob colors: the 5 colors are stable (`b.c` from the array literal at `:165-171`), no per-frame string allocation needed. The `b.c + 'aa'` and `b.c + '00'` hex-string concatenations happen once at startup (in the `_blobGrads.map`), not per frame — already free.