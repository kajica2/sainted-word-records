# Cache `drawMeter` gradients: 5 `createLinearGradient`/frame + DOM read → 3 cached gradients + cached sens

**Cycle**: 2026-09-05T20-20
**Type**: speed
**Priority**: P1
**Estimated effort**: S

## TL;DR

`engine.html:4144-4174` (`drawMeter`) runs every RAF from the engine's main loop at `engine.html:4375`. Every frame it allocates five `CanvasGradient` objects via `meterCtx.createLinearGradient(0, y, 0, h)` (engine.html:4161), and reads the live `sensitivity` slider value via `parseFloat($('sensitivity').value)` (engine.html:4150). The five gradients fall into three distinct color tables (engine.html:4162-4164) — only `(i, h)` choose which one — and `h` is fixed at the meter's intrinsic canvas size (360x48, declared at engine.html:1176). The slider already has an input listener at engine.html:4945 (the global slider `textContent` updater), so we just extend that listener to also cache the parsed value into a renderer-owned field.

The fix: build three normalized gradients `(0, 0, 0, 1)` once on the first frame and cache them on the renderer object; rotate the canvas through `cx.save() / cx.translate(0, y) / cx.fillRect(x, 0, barW-4, bh) / cx.restore()` so the gradient is anchored to the bar's local bottom edge; reuse a single `vals` typed scratch array (`Float64Array` is fine, 5 entries) mutated in place per frame; bind `sensitivity` once at startup and read the cached field inside `drawMeter`.

Net per-frame churn drops from 5 gradient allocations + 1 DOM read + 1 array literal + 1 parseFloat to 0 gradient allocations + 0 DOM reads + 0 array allocations + 0 parseFloat calls. Pixel-identical output.

## Why this cycle

- The main render hot path is `engine.html:4308-4386` (`loop(t)`). The draw order is `clear → drawLayer → drawSelection → drawPaletteOverlay → drawFlash → drawMeter → drawRecordingOverlay → requestAnimationFrame`. Of the always-on calls, `drawPaletteOverlay` was already covered by the 2026-09-05T05-03 plan (`palette-overlay-grad-cache`), and the 2026-09-05T08-06 plan flagged gradient caching in `drawMeter` as incorrect (see State below). This plan addresses exactly that gap: `drawMeter` gradients *can* be cached once you commit to a normalized gradient + `translate` approach, instead of the per-frame variable-coordinate gradient.
- Concrete scan evidence:
  - `engine.html:4144-4174` is `drawMeter`. 5 bars, 3 distinct color tables (i<2, i<3, else). `createLinearGradient` at `:4161`. `vals` literal at `:4151-4154`. `parseFloat($('sensitivity').value)` at `:4150`. `cx.fillStyle = '#0d0918'` and `cx.fillRect(0, 0, w, h)` background at `:4147-4148`.
  - `engine.html:1176` declares `<canvas id="meter" width="360" height="48"></canvas>` — intrinsic dims are stable for the engine lifetime; no JS code mutates `meterCanvas.width` or `.height` (verified: `grep -n "meterCanvas\.\(width\|height\)" engine.html` returns only `engine.html:4145` reads).
  - `engine.html:1355` declares the sensitivity slider (`<input type="range" id="sensitivity" min="0.2" max="3" step="0.05" value="1" />`). The existing global input loop at `engine.html:4944-4947` updates the `<b id="sensitivity-v">` text on `input` — but does *not* store the value anywhere a hot-path can read without `parseFloat($(...))`. The `sens` value is also consumed at `engine.html:2946-2955` (in the genops weight table); that site gets a single read on load and isn't hot. `drawMeter` is the per-frame consumer.
- Recent `covered_topics` (per `.improvements/STATE.json`) cover recorder buffers, render-cache strings, LFO/timing allocations, audio history, palette overlay gradients, engine z-sort + applyR scratch, fx postprocess, variants (extra-draws array, gradient codemod). None covers the meter bar gradient loop. Brand new topic: `engine-meter-grad-cache`.
- The fix is mechanical and tightly scoped to `engine.html:4144-4174` plus one extra line in the existing global slider loop at `engine.html:4944-4947` to extend that listener to also store the value onto `Render`. One file, one method, ~20 lines of net change. No shared modules touched. No variant HTML is modified (each variant has its own `drawMeter` and they use a *different* single-color gradient — separate plan if the user wants it later).

## Why prior plans declined this

The 2026-09-05T05-03 plan (palette overlay cache) deliberately punted: *"Caching `drawMeter` gradients (`createLinearGradient` on `engine.html:4161` runs once per frame; it depends on `(bh, h)` which vary per-frame, so a memo would be incorrect)."* That conclusion was right *for a gradient expressed in canvas-absolute coords* (as today): `y = h - v*h`, so the gradient endpoint `(0, y)` truly depends on `v`. The fix here re-expresses the gradient in a *normalized bar-local coordinate system* `(0, 0, 0, 1)`, then pushes the canvas `y` down with `translate` so the same gradient describes any bar height. Once the cache holds three forever-valid gradients (one per color table), the per-frame work is just `save / translate / fillRect / restore` for each of the five bars.

## Goal

`engine.html:drawMeter()` builds each bar's `CanvasGradient` at most once per page lifetime (three total), reads the sensitivity slider at most once per user interaction (cached into `Render._sens`), allocates no per-frame arrays, and emits pixel-identical output to the current implementation across the full audio feature range and the full slider range.

## Plan

### Step 1 — Add three cached gradients + a sens cache field to the renderer

- **Files**: `engine.html` inside the renderer object literal that owns `drawMeter`. The object opens at `engine.html:3809` (the first renderer field, search up from `engine.html:4144`) and contains `proc` (`engine.html:3834`), `procCtx` (`engine.html:3851`), `applyReactors` (`engine.html:3916`), `drawLayer` (`engine.html:3961`), `drawPaletteOverlay` (`engine.html:4108`). Place the new fields next to the existing palette cache hint added by the 2026-09-05T05-03 plan (which lives just above `drawLayer` per its Step 1 spec). If the palette cache isn't yet landed in the working tree when you start this work, just place them next to `proc` / `procCtx`.

  Concretely, add four fields inside the renderer literal:
  ```js
  _meterSens: 1,                  // cached parseFloat($('sensitivity').value)
  _meterGradLow: null,            // '#ff3d92' → '#ffd24a' (bars 0-1)
  _meterGradMid: null,            // '#ffd24a' → '#00e5ff' (bar 2)
  _meterGradHigh: null,           // '#00e5ff' → '#00ffa3' (bars 3-4)
  _meterVals: new Float64Array(5) // reused scratch — sub/bass/mid/treble/air * sens
  ```

- **Action**: pure field additions. No existing field names collide (verify with `grep -n "_meterSens\|_meterGradLow\|_meterGradMid\|_meterGradHigh\|_meterVals" engine.html` returning no matches). If any returns a hit, rename accordingly and update Step 2 below. The `Float64Array` is allocated once at object init; per-frame work mutates it in place (it never escapes the renderer object).

- **Verify**: read the diff and confirm the four fields are present exactly once, in object-literal form, not inside `drawMeter`.

### Step 2 — Rewrite `drawMeter` to use the cache

- **Files**: `engine.html:4144-4174` (the entire `drawMeter` body).
- **Action**: replace the function body so it:
  1. Reads `w`, `h`, `cx` as today (lines 4145-4146 unchanged).
  2. Paints the background `cx.fillStyle = '#0d0918'; cx.fillRect(0, 0, w, h)` as today (4147-4148 unchanged).
  3. **Drops the `vals` array literal and the `parseFloat($('sensitivity').value)` call.** Replaces with five mutations of `this._meterVals[i]`:
     ```js
     const f = Audio.feat, sens = this._meterSens;
     const v = this._meterVals;          // alias for clarity
     v[0] = f.sub * sens;
     v[1] = f.bass * sens;
     v[2] = f.mid * sens;
     v[3] = f.treble * sens;
     v[4] = f.air * sens;
     ```
  4. Lazy-builds the three gradients on first call (defensive — they should not be reused across runs without invalidation, since the meter canvas could theoretically be resized by future code; safer to gate on `cx !== this._meterCtx`):
     ```js
     if (this._meterGradLow === null || this._meterCtx !== cx) {
       this._meterCtx = cx;
       this._meterGradLow  = cx.createLinearGradient(0, 0, 0, 1);
       this._meterGradLow.addColorStop(0, '#ff3d92');  this._meterGradLow.addColorStop(1, '#ffd24a');
       this._meterGradMid  = cx.createLinearGradient(0, 0, 0, 1);
       this._meterGradMid.addColorStop(0, '#ffd24a');  this._meterGradMid.addColorStop(1, '#00e5ff');
       this._meterGradHigh = cx.createLinearGradient(0, 0, 0, 1);
       this._meterGradHigh.addColorStop(0, '#00e5ff'); this._meterGradHigh.addColorStop(1, '#00ffa3');
     }
     ```
  5. Walks the five bars with `for (let i = 0; i < v.length; i++)`, choosing the cached gradient, and translates the canvas origin to the bar's bottom edge before filling so the normalized gradient maps onto the bar:
     ```js
     const barW = w / v.length;
     for (let i = 0; i < v.length; i++) {
       const bv = clamp(v[i], 0, 1);
       const bh = bv * h;
       const bx = i * barW + 2;
       const by = h - bh;
       const g = i < 2 ? this._meterGradLow : i < 3 ? this._meterGradMid : this._meterGradHigh;
       cx.save();
       cx.translate(0, by);
       cx.fillStyle = g;
       cx.fillRect(bx, 0, barW - 4, bh);
       cx.restore();
     }
     ```
     Note the local rename to `bv` / `bx` / `by` to avoid stomping on `barW`. The `if (!bv)` short-circuit is *not* needed — even a zero-height bar should paint the background (the current implementation also has no short-circuit at engine.html:4156-4167, so a zero `bh` paints a 0-height rect at the bottom edge, which is invisible; behavior is preserved).
  6. BPM text block (lines 4169-4172) unchanged.
- **Verify**: pixel diff. Boot `engine.html` in Puppeteer with and without the change; capture `meterCanvas.toDataURL()` at frames 60 / 120 / 240 after starting audio playback (the demo MP3 from `audios/` works locally — `presets.client.js` auto-loads the first item). Hash both PNGs and confirm zero diff for the same audio data and sensitivity value. Then move the sensitivity slider via `$('sensitivity').value = 2.5; $('sensitivity').dispatchEvent(new Event('input'))` and re-capture — pixel diff should still be zero vs an equivalent manually-generated reference (or just confirm bar heights scale linearly). Then jump sensitivity through 0.2, 1.0, 3.0 and confirm gradient endpoints did not rebuild (i.e. `Render._meterGradLow !== null` after frame 1 and stays the same `===` reference across all slider values, which is the real perf claim).

### Step 3 — Wire the sensitivity slider listener to cache the value

- **Files**: `engine.html:4944-4947` (the global slider loop).
- **Action**: extend the listener body from
  ```js
  inp.addEventListener('input', () => { out.textContent = parseFloat(inp.value).toFixed(2); });
  ```
  to
  ```js
  inp.addEventListener('input', () => {
    const f = parseFloat(inp.value);
    out.textContent = f.toFixed(2);
    if (id === 'sensitivity' && window.Render) Render._meterSens = f;
  });
  ```

  The `window.Render` guard avoids a ReferenceError if the slider gets re-attached during PWA bootstrap before the renderer exists. The listener also runs at most once per user input event (no scroll / RAF hot path). If the renderer happens to be referenced by a non-`window` symbol (`const Render = {...}` inside the closure at engine.html:3809), substitute the closure-local name. Read engine.html:3809-3810 to confirm the binding name before patching.
- **Verify**: after the patch, drag the sensitivity slider in Puppeteer (`$('sensitivity').value = 2.5; $('sensitivity').dispatchEvent(new Event('input'))`) and assert `Render._meterSens === 2.5`. Then confirm `drawMeter` reads from that field by reading `Render._meterSens` after a frame and confirming it didn't get re-parsed from the DOM (i.e. `document.getElementById('sensitivity').value` is a string and `Render._meterSens` is a number — assert `typeof Render._meterSens === 'number'`).

### Step 4 — Confirm `parseFloat($('sensitivity').value)` is gone from the hot path

- **Files**: `engine.html` (read-only verification).
- **Action**: after the patch, `grep -n "parseFloat(.*sensitivity" engine.html` should return zero hits. The other consumer at `engine.html:2946-2955` (genops weight table) still does its own `parseFloat($('sensitivity').value)` once per call — but that site only fires during preset/feature mutation actions, not the RAF loop. Out of scope for this plan; flag as a follow-up if profiling still shows it.
- **Verify**: grep returns zero matches inside `drawMeter` (engine.html:4144-4174).

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests). The patches are pure JS in `engine.html`; no scripts or codemod template changes.
- `npm run build` passes (the prebuild `fetch-library.mjs` still logs `skipping` without `LIBRARY_BLOB_URL` and that's fine locally).
- Pixel test: boot a Puppeteer headless browser against `http://localhost:5174/engine/` (after `npm run dev` or `npm run preview`), upload `/audios/demo-1.mp3` via the existing auth path, let it run for 4 seconds, capture `meterCanvas.toDataURL()` at frame 60, 120, 240 with sensitivity at 1.00. Diff vs the un-patched `engine.html` baseline → expected 0 pixel difference for the same audio data. Confirm the cached `Render._meterSens` is the same number reference throughout. Easiest placement: extend `verify-rot-master.mjs` (which already injects into engine.html) with a one-block `Meter Cache` test that asserts `Render._meterSens === 1` after frame 1 and `Render._meterGradLow !== null` immediately.
- Browser smoke: drag the sensitivity slider in headed Chrome to 2.50, watch the audio meter bars visibly scale; no missing bars, no gradient color regression, no z-order regression (the `translate` is `restore`-d so subsequent fills are unaffected).
- Heuristic wall-clock: with the patches applied, a 60-second recording of the engine running with the demo MP3 should show 5 fewer `canvas.createLinearGradient` events per RAF than the un-patched engine when measured via Chrome DevTools' instrumentation (the `Performance` panel records `createLinearGradient` calls under `Recalculate Styles` / paint events).

## Risks / gotchas

- **Gradient endpoint drift**: the cached gradient `(0, 0, 0, 1)` plus `translate(0, by)` reproduces today's output *only* if no non-uniform scaling happens between `save` and `fillRect`. The meter canvas has no transform set elsewhere — `meterCtx` is freshly grabbed at line 4146, used, and never transformed — so `save/translate/restore` is symmetric. If a future edit sets a transform on `meterCtx` inside the loop, the gradient would compose with it; the patch is robust as long as `restore` is paired with every `save`. The proposed code does pair them.
- **`Audio.feat` mutation safety**: today's implementation reads `Audio.feat.sub`, `.bass`, `.mid`, `.treble`, `.air` and multiplies by `sens`. The proposed code reads each once into `_meterVals`. The values are never aliased elsewhere (the genops site at engine.html:2946-2955 reads `Audio.feat` directly, not `Render._meterVals`), so the in-place mutation is safe. If a future code path starts sharing the scratch array, refactor to a local.
- **Slider not yet attached**: if the sensitivity slider gets re-created during PWA bootstrap (unlikely — it's a static markup input), the input listener is re-attached at engine.html:4944 and the cache is refreshed on the next `input` event. Worst case: the meter renders with the *default* `Render._meterSens = 1` until the user touches the slider, which matches the current default `value="1"`.
- **Meter canvas resizing**: if a future patch ever sets `meterCanvas.width` or `.height` (currently never; see scan evidence), the cached gradients become stale (canvas-state-bound `CanvasGradient` is portable across canvas reconfigs in current Chromium, but the spec leaves it implementation-defined). The defensive `this._meterCtx !== cx` re-check in Step 2 handles `cx` changing. To handle canvas resizes, also wrap the canvas-width assignment (if it ever appears) with `Render._meterGradLow = Render._meterGradMid = Render._meterGradHigh = null`. There is no such assignment today, so this is purely defensive.
- **Variant pages**: variants have their own `drawMeter` with a *different* (single-color) gradient pattern (e.g. `versions/film.html:894` paints all bars with the same `'#c8a878' → '#8a6a3a'` gradient). Those are out of scope. If a future cycle tackles them, the same `save/translate/restore` pattern applies and the code reduction is even larger (5 → 1 gradient).
- **Other `sensitivity` consumers**: `engine.html:2946-2955` reads `parseFloat($('sensitivity').value)` once per genops action; that's cold-path (not RAF). Out of scope. If unified later, the `Render._meterSens` cache is the natural source.

## Out of scope

- The variant pages' `drawMeter` (e.g. `versions/film.html:894`, `versions/aurora.html:707`, `versions/grid.html:…`). Each has a different color table; a parallel cache is easy to apply per variant but is a separate plan.
- `genops.client.js` weight table at engine.html:2946-2955 (cold-path reads of sensitivity).
- `drawRecordingOverlay` (`engine.html:4177-4207`) — runs only while `Recorder.recording`, not every RAF, but does have `cx.measureText(text)` and a fresh `text` string per recording frame. Could be a future cycle if the recorder becomes hot.
- `drawFlash` (`engine.html:4135-4142`) — already early-returns at low beat; non-hot.
- Replacement of `applyReactors` scratch object (covered by the pending 2026-09-05T08-06 plan — that's `_scratchR` territory).
- Replacement of the engine z-sort `Layers.list.slice().sort(...)` (also covered by the pending 2026-09-05T08-06 plan — that's `_sortedZ` territory).
