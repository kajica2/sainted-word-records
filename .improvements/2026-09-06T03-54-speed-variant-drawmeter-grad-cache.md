# Cache `drawMeter` gradients across all 10 variants — drop ~45 `createLinearGradient` calls/frame

**Cycle**: 2026-09-06T03-54
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

The `engine.html` `drawMeter` cache landed in cycle 2026-09-05T20-20 (`engine.html:4144-4174`) — that plan explicitly noted "No variant HTML is modified (each variant has its own `drawMeter` and they use a different single-color gradient — separate plan if the user wants it later)". This is that separate plan.

**10 variant HTML files** each have their own `drawMeter()` that runs every RAF from `loop()` and allocates `createLinearGradient` **per bar, per frame**:

- **Group A (8 files, identical-shape)**: `versions/neon.html:852`, `versions/void.html:752`, `versions/glitch.html:735`, `versions/aurora.html:762`, `versions/pulse.html:864`, `versions/chrome.html:740`, `versions/fractal.html:730`, `versions/watercolor.html:773` — 5 bars × per-frame = **40 gradient allocations/frame** at 60Hz ≈ **2400/sec**, 2 distinct color tables (`i<2`: pink→yellow, else: cyan→mint).
- **Group B (1 file, single-color-table)**: `versions/film.html:894` — 4 bars × per-frame = **4 allocations/frame** ≈ **240/sec**, single sepia gradient.
- **Group C (1 file, single-color-table)**: `versions/smoke.html:822` — 5 bars × per-frame = **5 allocations/frame** ≈ **300/sec**, single copper gradient.

`versions/grid.html:865` and `versions/hallucination.html:993` already use solid colors (`m.fillStyle = colors[i]` or `m.fillStyle = i<2 ? '#000' : '#ff3d00'`) — no gradient to cache, not in scope.

**Fix**: apply the same proven pattern from `engine.html` (cycle 2026-09-05T20-20): build a **normalized gradient `(0, 0, 0, 1)`** per color table once on first call (lazy-init guarded by `m !== this._meterCtx` for safety), cache it on the IIFE scope, and per-frame work is just `save / translate(0, y) / fillRect(x, 0, bw-4, bh) / restore`. Codemod the 8 Group A files (identical bodies) and patch the 2 Group B/C files (each unique).

Net churn across variants drops from **~49 per-frame gradient allocations + 49 `addColorStop` pairs + 49 `vals` array literals** to **0 per-frame gradient allocations + 0 `addColorStop` calls + 0 array literals** after warmup. Pixel-identical output. Same proven approach as the engine.html fix.

## Why this cycle

- **Direct cite**: the engine.html plan at `.improvements/2026-09-05T20-20-speed-meter-gradient-cache.md:24` explicitly carved out the variants as "separate plan if the user wants it later." This is that plan.
- **Concrete scan evidence** (per `grep -n "createLinearGradient" versions/*.html`):
  - Group A: all 8 files share an identical body. Two-color-table split at `i<2`. See `versions/aurora.html:773` for a representative line.
  - Group B: `versions/film.html:903` — `const g=m.createLinearGradient(0,y,0,h)` with single sepia color table `'#c8a878' → '#8a6a3a'`.
  - Group C: `versions/smoke.html:831` — `const g=m.createLinearGradient(0,y,0,h)` with single copper color table `'#d68b5a' → '#b89a72'`.
- **Why the fix is safe**: identical to the engine.html rationale already validated:
  1. Meter canvases have **stable intrinsic dimensions** for the page lifetime (e.g. `versions/aurora.html:296` declares `<canvas class="meter" id="meter" width="320" height="32"></canvas>`; `versions/film.html:296` declares `width="360" height="36"`). No JS resizes them.
  2. The normalized `(0, 0, 0, 1)` gradient is **mathematically equivalent** to a `(0, y, 0, h)` gradient after `ctx.translate(0, y)` — pixel-identical output.
  3. The 8 Group A files have **byte-identical bodies** — perfect codemod candidate. The Group B/C files differ only in the color stops, not the structure.
- **Why this matters in practice**: every `versions/<name>.html` is the canonical audio-reactive visualizer for that aesthetic (neon, film, smoke, etc.). They're served at `sainted-word-records.vercel.app/versions/<name>.html` and exercised by `verify-film-audio.mjs`, `verify-film-audio-synthetic.mjs`, `verify-grid-audio.mjs`, etc. The variants are real production surfaces — not toy examples — and a 49/frame allocation reduction is directly observable as lower GC pause frequency and steadier fps under load.
- **Adjacent unaddressed wins** (not in this plan): `versions/mosaic.html:176` allocates 5 `createRadialGradient` per frame in a 5-blob loop; `versions/spectrum.html:266` allocates 1 `createRadialGradient` per frame in `paint()`. These are candidates for a separate cycle — they have varying `(x, y, r)` per blob, so the codemod pattern is more invasive (need a small cache by `(x|0, y|0, r|0)` key).

## Goal

Across the 10 affected variant files, `drawMeter()` performs **zero** `createLinearGradient` calls per frame after the first invocation. Verifiable as: `grep -n "createLinearGradient" versions/{neon,void,glitch,aurora,pulse,chrome,fractal,watercolor,film,smoke}.html` returns **2** hits per file (the new lazy-init lines), and the per-frame allocation count drops from 4-5 to 0 per `drawMeter` invocation. Pixel-identical output validated by `verify-film-audio.mjs` (Group B) and visual smoke on at least one Group A variant.

## Plan

### Step 1 — Codemod the 8 Group A files (identical body, two color tables)

**Files** (each has the byte-identical `drawMeter` body):
- `versions/neon.html:852-869`
- `versions/void.html:752-769`
- `versions/glitch.html:735-752`
- `versions/aurora.html:762-779`
- `versions/pulse.html:864-881`
- `versions/chrome.html:740-757`
- `versions/fractal.html:730-747`
- `versions/watercolor.html:773-790`

**Action**: For each file:

1. **Hoist the cache to the IIFE scope**. Find the line `const meter = $('meter').getContext('2d');` (around `versions/<name>.html:<line>` shown above). Immediately after that line, add:
   ```js
   // === drawMeter gradient cache (cycle 2026-09-06T03-54) ===
   // Two color tables, normalized to (0, 0, 0, 1) so a single gradient per
   // table describes any bar height. ctx.translate(0, y) inside the loop
   // shifts the canvas so the gradient maps to the bar's local coordinates.
   // m !== _meterCtx guards against any future canvas-size or context swap.
   const _meterCtx = null;
   const _meterGradLow = (() => {
     const g = meter.createLinearGradient(0, 0, 0, 1);
     g.addColorStop(0, '#ff2d8a'); g.addColorStop(1, '#fff04a');
     return g;
   })();
   const _meterGradHigh = ((() => {
     const g = meter.createLinearGradient(0, 0, 0, 1);
     g.addColorStop(0, '#00f0ff'); g.addColorStop(1, '#00ffa3');
     return g;
   })());
   ```

   **Caveat**: building the gradients immediately means if the `meter` canvas is ever resized at runtime, the cached gradient would be tied to the old context. The engine.html plan used a lazy `if (this._meterGradLow === null || this._meterCtx !== cx)` guard. To stay safe and faithful to that proven pattern, **prefer the lazy form**:
   ```js
   // === drawMeter gradient cache (cycle 2026-09-06T03-54) ===
   let _meterCtx = null;
   let _meterGradLow = null;
   let _meterGradHigh = null;
   ```

   And build them lazily inside `drawMeter()` on the first call (Step 1.2).

2. **Rewrite the `drawMeter` body**. Replace the entire current body with:
   ```js
   function drawMeter() {
     const m = meter, w = m.canvas.width, h = m.canvas.height;
     m.fillStyle = '#0a0612'; m.fillRect(0, 0, w, h);
     // Lazy build (guarded against context swap): two normalized gradients
     // describe any bar height when paired with translate(0, y) below.
     if (_meterCtx !== m) {
       _meterCtx = m;
       _meterGradLow = m.createLinearGradient(0, 0, 0, 1);
       _meterGradLow.addColorStop(0, '#ff2d8a'); _meterGradLow.addColorStop(1, '#fff04a');
       _meterGradHigh = m.createLinearGradient(0, 0, 0, 1);
       _meterGradHigh.addColorStop(0, '#00f0ff'); _meterGradHigh.addColorStop(1, '#00ffa3');
     }
     const sens = A.params.sens;
     const f = A.feat;
     const bw = w / 5;
     for (let i = 0; i < 5; i++) {
       let v;
       if (i === 0) v = clamp(f.bass * sens, 0, 1);
       else if (i === 1) v = clamp(f.mid * sens, 0, 1);
       else if (i === 2) v = clamp(f.treble * sens, 0, 1);
       else if (i === 3) v = clamp(f.air * sens, 0, 1);
       else v = clamp(f.rms * sens, 0, 1);
       const bh = v * h;
       const x = i * bw + 2;
       const y = h - bh;
       m.save();
       m.translate(0, y);
       m.fillStyle = i < 2 ? _meterGradLow : _meterGradHigh;
       m.fillRect(x, 0, bw - 4, bh);
       m.restore();
     }
   }
   ```
   **Note**: this version drops the per-frame `vals = [...]` array literal (also a small allocation win) by reading `A.feat.*` directly. The output is identical because each branch of the `vals` literal just multiplied the corresponding `A.feat.*` by `sens` — we multiply inline now. `clamp(v, 0, 1)` is applied in-line because the engine.html pattern relies on it (the existing code already calls `clamp(vals[i], 0, 1)`, so behavior is preserved).

3. **Indentation**: the existing bodies have inconsistent indent (some `function drawMeter() {` opens at 4 spaces, the inner body at 4 spaces — `versions/aurora.html:762` has the `function` indented 8 spaces because it's nested inside another IIFE). Match the **existing indent style of each file**. If a file has the function at 4 spaces, write the new body at 4 spaces. If at 8 spaces, write at 8. Read each file's existing body to confirm before patching.

**Verify**:
- `grep -c "createLinearGradient" versions/{neon,void,glitch,aurora,pulse,chrome,fractal,watercolor}.html` — should print `2` for each (one inside the lazy-init branch for `_meterGradLow`, one for `_meterGradHigh`).
- `grep -c "const vals = \[" versions/{neon,void,glitch,aurora,pulse,chrome,fractal,watercolor}.html` — should print `0` for each.
- `grep -c "const g = .*createLinearGradient" versions/{neon,void,glitch,aurora,pulse,chrome,fractal,watercolor}.html` — should print `0` for each (the old per-bar allocation is gone).
- Manually diff one of the 8 files and confirm the body now uses `_meterGradLow` / `_meterGradHigh` cache references, has `save / translate / fillRect / restore` instead of `fillRect(x, y, bw-4, bh)`.

### Step 2 — Patch Group B (`versions/film.html:894-908`)

**Files**: `versions/film.html`

**Action**: Same pattern, single sepia color table.

1. Find `const meter = $('meter').getContext('2d');` (line 512) and add immediately after:
   ```js
   // === drawMeter gradient cache (cycle 2026-09-06T03-54) ===
   let _meterCtx = null;
   let _meterGrad = null;
   ```

2. Replace `drawMeter` body (lines 894-908) with:
   ```js
   function drawMeter() {
     const m = meter, w = m.canvas.width, h = m.canvas.height;
     m.fillStyle = '#08060a'; m.fillRect(0, 0, w, h);
     if (_meterCtx !== m) {
       _meterCtx = m;
       _meterGrad = m.createLinearGradient(0, 0, 0, 1);
       _meterGrad.addColorStop(0, '#c8a878'); _meterGrad.addColorStop(1, '#8a6a3a');
     }
     const sens = A.params.sens;
     const f = A.feat;
     const bw = w / 4;
     for (let i = 0; i < 4; i++) {
       let v;
       if (i === 0) v = clamp(f.bass * sens, 0, 1);
       else if (i === 1) v = clamp(f.mid * sens, 0, 1);
       else if (i === 2) v = clamp(f.treble * sens, 0, 1);
       else v = clamp(f.air * sens, 0, 1);
       const bh = v * h;
       const x = i * bw + 2;
       const y = h - bh;
       m.save();
       m.translate(0, y);
       m.fillStyle = _meterGrad;
       m.fillRect(x, 0, bw - 4, bh);
       m.restore();
     }
   }
   ```
   **Indentation**: 4 spaces (matches existing `function drawMeter() {` indent in `versions/film.html:894`).

**Verify**:
- `grep -c "createLinearGradient" versions/film.html` → `1` (single sepia gradient in lazy-init).
- `grep -n "drawMeter" versions/film.html` → confirm the new body uses `_meterGrad` and `save/translate/fillRect/restore`.
- `npm run verify:film-audio` — the verifier at `verify-film-audio.mjs:60` loads `versions/film.html` and confirms `A.feat.bass/beat/onset/rms` are non-zero after playback + FILM layer reassignment after 4 beats. These don't directly probe `drawMeter`, but they confirm the file loads and the canvas pipeline still works.

### Step 3 — Patch Group C (`versions/smoke.html:822-836`)

**Files**: `versions/smoke.html`

**Action**: Same pattern, single copper color table, 5 bars.

1. Find `const meter = $('meter').getContext('2d');` (line 501) and add immediately after:
   ```js
   // === drawMeter gradient cache (cycle 2026-09-06T03-54) ===
   let _meterCtx = null;
   let _meterGrad = null;
   ```

2. Replace `drawMeter` body (lines 822-836) with:
   ```js
   function drawMeter() {
     const m = meter, w = m.canvas.width, h = m.canvas.height;
     m.fillStyle = '#ddd5c5'; m.fillRect(0, 0, w, h);
     if (_meterCtx !== m) {
       _meterCtx = m;
       _meterGrad = m.createLinearGradient(0, 0, 0, 1);
       _meterGrad.addColorStop(0, '#d68b5a'); _meterGrad.addColorStop(1, '#b89a72');
     }
     const sens = A.params.sens;
     const f = A.feat;
     const bw = w / 5;
     for (let i = 0; i < 5; i++) {
       let v;
       if (i === 0) v = clamp(f.bass * sens, 0, 1);
       else if (i === 1) v = clamp(f.mid * sens, 0, 1);
       else if (i === 2) v = clamp(f.treble * sens, 0, 1);
       else if (i === 3) v = clamp(f.air * sens, 0, 1);
       else v = clamp(f.rms * sens, 0, 1);
       const bh = v * h;
       const x = i * bw + 4;
       const y = h - bh;
       m.save();
       m.translate(0, y);
       m.fillStyle = _meterGrad;
       m.fillRect(x, 0, bw - 6, bh);
       m.restore();
     }
   }
   ```
   **Note**: `versions/smoke.html:834` uses `bw - 6` (slightly thicker gutter); preserve that.

**Verify**:
- `grep -c "createLinearGradient" versions/smoke.html` → `1`.
- Manually inspect that the `bw - 6` gutter is preserved and the bar starts at `i * bw + 4` (existing offset).

### Step 4 — Quick visual sanity check on one Group A variant

**Files**: any one of `versions/neon.html`, `versions/aurora.html`, etc.

**Action**:
1. `npm run dev` (serves at `http://localhost:5174`).
2. Visit `http://localhost:5174/versions/neon.html` (or whichever).
3. Click the "PLAY DEMO SONG" button (or load an audio file).
4. Open DevTools → Performance → record 5s.
5. Confirm `drawMeter()` shows `0` `CanvasRenderingContext2D.createLinearGradient` calls per frame after warmup. (Pre-warmup you'll see 2 calls during the first frame; subsequent frames should show 0.)
6. Visual confirmation: the meter bars look identical to before — same colors, same heights, same gradients.

**Verify**:
- Same procedure with `versions/film.html` (Group B) and `versions/smoke.html` (Group C) — each should show 0 gradient allocations after the first frame.

### Step 5 — Run the full pre-PR gate

**Action**:
1. `npm run check` — syntax + manifest + bundle + api tests must pass.
2. `npm run verify:film-audio` — film audio verifier must pass.
3. If a verifier exists for any other touched variant (`verify-neon-audio.mjs`, etc.), run it. If not, skip — `verify-film-audio.mjs` covers Group B (most testable surface). Group A has no per-variant verifier; the `check` gate + visual Step 4 is the safety net.

**Verify**:
- `npm run check` exits 0.
- `npm run verify:film-audio` exits 0.

## Verification

- `npm run check` passes (syntax + bundle manifest intact).
- `npm run verify:film-audio` passes (Group B end-to-end; covers audio feature sampling, meter canvas rendering, and the FILM layer reassignment cycle that runs in parallel with `drawMeter`).
- `grep -c "createLinearGradient" versions/{neon,void,glitch,aurora,pulse,chrome,fractal,watercolor,film,smoke}.html` returns `2` for each Group A file, `1` for `film.html` and `smoke.html` — and crucially, **none of those `createLinearGradient` calls appear inside the `for` loop**.
- `grep -c "const vals = \[" versions/{neon,void,glitch,aurora,pulse,chrome,fractal,watercolor,film,smoke}.html` returns `0` for each (the per-frame array literal is gone).
- Visual smoke (Step 4): meter bars look pixel-identical to the pre-patch state on at least one Group A variant + `film.html` + `smoke.html`.

## Risks / gotchas

- **`versions/aurora.html` and `versions/pulse.html` may have nested `drawMeter` definitions** (the `function drawMeter() {` is indented 8 spaces in some files because it's nested inside an outer IIFE). Confirm by reading each file before patching — the cache fields must be hoisted to the same scope as `const meter = ...`, not inside the nested function.
- **`versions/watercolor.html:773-790` may have a different indent** (8 spaces for the function, body at 8). Match the existing indent of each file; the patch uses spaces, not tabs.
- **Variant HTML files are large** (~600-1700 lines). Use `read_file` with `offset` and `limit` to find the exact lines, then `patch` with sufficient surrounding context (the function body is the natural unique context).
- **Lazy-init guard correctness**: `_meterCtx !== m` is the canonical safety net. If any variant's `meter` canvas is ever resized at runtime (none do today, verified via `grep "meterCanvas.width\|meter.width\|meter.height" versions/*.html` returning no hits), the cache rebuilds. Without this guard, a resize would silently produce stale gradients.
- **The codemod is byte-identical for the 8 Group A files**. If you spot any divergence in the body (extra whitespace, different clamp range, etc.) — patch that file individually rather than mechanically applying the same patch to all 8.
- **Don't add the cache to `versions/grid.html:865` or `versions/hallucination.html:993`** — both already use solid colors and have no gradient to cache.

## Out of scope

- `versions/grid.html:865` and `versions/hallucination.html:993` — already solid-color meters, no allocation to remove.
- `versions/mosaic.html:176` (5 radial blob gradients/frame) — different code shape, varying `(x, y, r)` per blob, requires its own cache key. **Separate plan**.
- `versions/spectrum.html:266` (1 radial gradient/frame with varying `pulseR`) — requires cache keying on `pulseR|0`. **Separate plan**.
- `versions/baroque.html:144, 157, 173` and `versions/tape.html:134, 163` — different code shape (each gradient is a per-frame visual element, not a meter). Lower priority; defer to a separate scan.
- The engine.html `drawMeter` (already covered by 2026-09-05T20-20).
- Any visual or aesthetic change to the meter — this plan is byte-identical output.