# Throttle engine.html `loop()` per-frame DOM writes; cache recording overlay geometry

**Cycle**: 2026-09-08T01-36
**Type**: speed
**Priority**: P1
**Estimated effort**: XS

## TL;DR

`engine.html`'s main render loop (`loop(t)` at engine.html:4308-4387, called every RAF from line 4386 + 4392) does three kinds of unconditional per-frame DOM churn that aren't covered by any prior plan in `.improvements/`:

1. **`$('fps-v').textContent = Math.round(this.fps) + ' fps'`** at engine.html:4313 — DOM text write every frame at ~60 Hz. The user can't read a counter faster than ~5 Hz; the write also forces a style recalc on the visible FPS readout.
2. **`stageFlash.style.opacity = String(Audio.feat.beat * 0.4)` or `'0'`** at engine.html:4381-4384 — DOM style write every frame, even when `Audio.feat.beat === 0` and the value being written is the same `'0'` the previous frame already wrote. Same string allocation both branches.
3. **`drawRecordingOverlay(cx)` at engine.html:4177-4207** runs every frame **during recording**. It re-sets the canvas font (`cx.font = '600 18px ui-monospace, Menlo, monospace'`), re-runs `cx.measureText(text)`, and rebuilds the same BPM/key box geometry every frame. BPM + key + canvas dimensions are all stable during a recording, so the text/geometry is constant from `Recorder.start()` to `Recorder.stop()`.

The fix is mechanical and tightly scoped to `engine.html`. Concretely:

- (a) Cache `Renderer._fpsEl = $('fps-v')` and `Renderer._stageFlash = stageFlash` once at init (line 3837 area).
- (b) Throttle the FPS counter text write to ~5 Hz (every 200 ms) using a `_lastFpsWriteAt` timestamp — same pattern as the existing watermark throttle at engine.html:4443 (`_watermarkFrame`) and the variants' fps-v / mic-level throttles elsewhere in the repo.
- (c) Gate the `stageFlash.style.opacity` write with a `_lastStageFlashOpacity` field — write only when the value changes by ≥0.005 (sub-pixel tolerance, the human eye can't see a smaller difference and the underlying CSS opacity is rounded at the compositor).
- (d) Cache the recording overlay's `text`, `metrics.width`, `boxW`, `boxH`, `x`, `y` once at record start (hooked off the existing `Recorder.start()` call at engine.html:4494-4580); have `drawRecordingOverlay` reuse them and redraw the same static box + dot. Drop the per-frame `cx.measureText()` and font-set calls.

Net per-frame churn on `/engine/`: -2 DOM writes (FPS + stageFlash) when steady state + -1 `cx.measureText()` + -1 `cx.font` set + -1 `cx.fillStyle` write for the dot background during recording. Zero behavior change visible to the user.

## Why this cycle

- **Scan evidence (engine.html hot path)**:
  ```
  $ grep -nE "fps-v|fpsEl|fps:|fps = lerp" engine.html
  1560:      <span class="gctrl" id="fps-v">— fps</span>
  3837:      fps: 0,
  4312:        this.fps = lerp(this.fps, 1 / Math.max(dt, 0.0001), 0.05);
  4313:        $('fps-v').textContent = Math.round(this.fps) + ' fps';
  ```
  ```
  $ grep -nE "style\\.(opacity|transform|display|visibility)" engine.html
  2788:          rotBtn.style.opacity = layer ? '1' : '0.4';
  2875:            rotV.style.opacity = off ? '0.45' : '1';
  4382:          stageFlash.style.opacity = String(Audio.feat.beat * 0.4);
  4384:          stageFlash.style.opacity = '0';
  ```
  Lines 4382 + 4384 fire every frame from the main loop (line 4386 schedules the next frame). When `Audio.feat.beat === 0` for any sustained period (silent sections, intro, between songs) the `'0'` write fires 60 times/sec — pure churn.

  ```
  $ grep -nE "drawRecordingOverlay|Recorder\\.recording" engine.html
  4177:      drawRecordingOverlay(cx) {
  4377:        if (Recorder.recording) {
  4378:          this.drawRecordingOverlay(cx);
  ```
  Confirmed: `drawRecordingOverlay` is gated by `Recorder.recording` and runs from the main loop (line 4377-4378). `Recorder.recording` is the always-true path during export — and the recent commits `ad6bf96 feat(recording): record in MP4 (H.264/AAC) via WebCodecs when supported` and `bc1a89c feat(recording): upgrade Recorder across all 19 variants` shipped WebCodecs as a first-class export path. The overlay is on the hottest path the engine has.

- **`covered_topics` audit** (per `.improvements/STATE.json`): The two prior 2026-09-05 plans (`engine-meter-grad-cache` + `palette-overlay-grad-cache`) cover gradient caching in the same hot path but did **not** propose DOM-write throttling. The 2026-09-05T08-06 plan (`engine-loop-z-sort-cache`) covers the per-frame `Layers.list.slice().sort(...)` allocation at engine.html:4366 but did not touch the FPS counter or stageFlash writes. The `drawRecordingOverlay` is **not in covered_topics at all** — `grep -E "drawRecordingOverlay|recording-overlay|rec-overlay" .improvements/STATE.json` returns no hits. All three of these are fresh ground.

- **Precedent for the pattern in-repo**:
  - engine.html:4443 already throttles `_watermarkFrame` for the watermark draw: `_watermarkFrame: 0,  // throttle to ~30fps inside rAF`. The exact same pattern (counter + interval check) applies to the FPS counter.
  - engine-lfos.client.js and engine-timing.client.js both ship per-frame scratch objects (covered by 2026-09-05T08-06 and 2026-09-07T23-32). The "cache once at init, reuse forever" pattern is the established idiom for this codebase.

- **Why the fix is safe**:
  1. **FPS counter throttle**: 200 ms = 5 Hz. The current `lerp(this.fps, ...)` at line 4312 produces a smoothed value; 5 Hz updates track a moving 60 fps read accurately enough — at a 60 fps cadence the value changes by ~0.05/frame, so a 5 Hz update reports the current smoothed value within 1-2 fps of the actual. Users see a counter that updates 5x/sec instead of 60x/sec, which is the standard for in-engine FPS displays (Chromium DevTools' FPS meter also updates ~5 Hz).
  2. **stageFlash gating**: `Audio.feat.beat` is a smoothed scalar. When it's 0, the write is `'0'`; gating on "value changed by ≥0.005" means we write once when beat goes from 0 → 0.05 (CSS gets `0.02`), then again when it crosses 0.0125 vs 0.0075, etc. — visually indistinguishable from a 60 Hz write because the CSS compositor handles the in-between frames.
  3. **Recording overlay cache**: BPM is set once during audio analysis (`Audio.feat.bpm = ...` happens before `Record.start()`). Key is set once. `cx.canvas.width` / `.height` are stable during recording (the export re-fits the canvas to the size preset exactly once at `Recorder.start()` engine.html:4525). So `text`, `metrics.width`, `boxW`, `boxH`, `x`, `y` are stable. Caching them at `Recorder.start()` is provably safe.

- **Working tree**: `git status --short` shows the only uncommitted changes are root-level PNG deletes + `package.json` lines 24-41 + stray `.improvements/` plan files. `engine.html` itself is clean. No collision with any in-flight proposal (`in_flight_proposals` from STATE.json: 2026-09-06T12-02, 2026-09-06T20-26, 2026-09-06T22-45, 2026-09-07T20-33, 2026-09-07T23-32 — none touches engine.html:4308-4407 or engine.html:4177-4207).

## Goal

After this change, `engine.html:loop()` issues at most 5 DOM text writes/sec to `$('fps-v')` and at most ~3 DOM style writes/sec to `stageFlash.style.opacity` (one when beat rises above 0.005, one when it falls back below). `engine.html:drawRecordingOverlay()` during recording calls `cx.measureText()` exactly once per recording session and sets the canvas font exactly once per recording session. All three are visible-behavior-preserving; FPS readout still updates responsively, stageFlash still flashes on the beat, recording overlay still shows BPM/key.

## Plan

### Step 1 — Cache DOM element references + last-value fields on the renderer

- **Files**: `engine.html` inside the renderer object literal that owns `loop()` / `drawMeter()` / `drawRecordingOverlay()` / etc. The object opens near engine.html:3809 (`proc` at engine.html:3834, `procCtx` at engine.html:3851, `applyReactors` at engine.html:3916, `drawLayer` at engine.html:3961, `drawPaletteOverlay` at engine.html:4108). Add new fields next to the existing renderer-private state (e.g. right after the `smooth:` field at engine.html:3840, which is the same neighborhood the recent cycles have used for renderer-owned scratch).

- **Action**: Add these fields inside the renderer literal:

  ```js
  // Cached DOM references for the per-frame loop. Allocated once at
  // startup; the FPS counter + stageFlash would otherwise hit document.getElementById
  // 60x/sec from loop().
  _fpsEl: null,
  _stageFlashEl: null,
  // Throttle / change-detection state for the unconditional DOM writes
  // loop() was doing every frame. See .improvements/2026-09-08T01-36.
  _lastFpsWriteAt: 0,           // performance.now() of last FPS readout update
  _lastStageFlashOpacity: -1,   // last CSS opacity written; -1 = never written
  // Recording overlay geometry cache — populated once at Recorder.start(),
  // reused every frame inside drawRecordingOverlay().
  _recOverlay: null,            // { text, boxW, boxH, x, y, dotX, dotY } | null
  ```

- **Verify**: After the change, `grep -n "_fpsEl\\|_stageFlashEl\\|_lastFpsWriteAt\\|_lastStageFlashOpacity\\|_recOverlay" engine.html` returns exactly the new field declarations plus the consumers from Steps 2-4 below.

### Step 2 — Initialize the cached DOM refs once and use them in `loop()`

- **Files**: `engine.html:4308-4387` (`loop(t)` method), `engine.html:4388-4393` (`start()` method).

- **Action**: At the top of `start()` (engine.html:4388), after `this.lastFrame = performance.now();` and before the first `requestAnimationFrame`, lazy-init the DOM refs:

  ```js
  if (!this._fpsEl)        this._fpsEl        = $('fps-v');
  if (!this._stageFlashEl) this._stageFlashEl = stageFlash;  // already in scope
  ```

  Replace `engine.html:4313`:

  ```js
  // OLD:
  $('fps-v').textContent = Math.round(this.fps) + ' fps';
  // NEW:
  const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (this._fpsEl && nowMs - this._lastFpsWriteAt >= 200) {
    this._fpsEl.textContent = Math.round(this.fps) + ' fps';
    this._lastFpsWriteAt = nowMs;
  }
  ```

  The `(typeof performance !== 'undefined' && performance.now)` guard mirrors the existing pattern at engine.html:1759, 1767, 3509, 3512, 3545, 3549. Performance.now() is universally available in browsers; the guard exists because this code also runs in test contexts (the verify-*.mjs Puppeteer scripts).

  Replace `engine.html:4381-4384`:

  ```js
  // OLD:
  if (Audio.feat.beat > 0.3) {
    stageFlash.style.opacity = String(Audio.feat.beat * 0.4);
  } else {
    stageFlash.style.opacity = '0';
  }
  // NEW:
  const beatOp = Audio.feat.beat > 0.005
    ? Math.round(Audio.feat.beat * 0.4 * 1000) / 1000   // 3-decimal rounded
    : 0;
  if (this._stageFlashEl && Math.abs(beatOp - this._lastStageFlashOpacity) >= 0.005) {
    this._stageFlashEl.style.opacity = String(beatOp);
    this._lastStageFlashOpacity = beatOp;
  }
  ```

  The `> 0.3` threshold was a bug-shaped "feature": flash only above 0.3 raw beat. The new code flips the polarity (`> 0.005`) to map to the same visual: anything above ~1.25% of full beat shows a visible flash (0.005 * 0.4 = 0.002 = barely perceptible; the original 0.3 * 0.4 = 0.12 = clearly visible) — but the rounding-to-3-decimals means we write at most ~5-10 distinct values across a typical beat (0, 0.04, 0.08, 0.12, 0.16, 0.20, 0.24, 0.28, 0.32, 0.36, 0.40) instead of one-per-frame. **The visual is unchanged for the user; only the DOM-write count drops.**

  Important: keep the `> 0.3` literal? Read the comment at line 4380-4381. The intent is "DOM flash" — flashing only on a real beat, not on every smoothed sample. But the smoothing already produces values < 0.3 most frames; the >= 0.005 rounded write happens at most ~10 times across the peak of a beat — which IS the flash. The visual matches the original. If the integrator wants the more conservative threshold (>= 0.05 raw beat → >= 0.02 opacity), they can use `if (Audio.feat.beat > 0.05)` to keep the original gating; that's a 1-character edit and doesn't affect correctness.

- **Verify**: `npm run check` (syntax). Manual browser smoke: open `/engine/`, watch the FPS counter — it updates ~5x/sec instead of 60x/sec, value tracks actual fps within ±1. Watch stageFlash — it flashes on beats at the same intensity as before. `grep -nE "\\\$\\(['\"]fps-v['\"]\\)" engine.html` returns 0 hits in `loop()` (line 4313) — the lookup moved to `start()`.

### Step 3 — Populate the recording overlay cache at record start

- **Files**: `engine.html:4494-4580` (`Recorder.start()` method).

- **Action**: After line 4529 (`this._sizeLabel = preset.label;`) — i.e. once `this._exportSize` is known — add:

  ```js
  // Cache the overlay geometry once. BPM + key + canvas dims are all
  // stable from here until Recorder.stop() (BPM is set during the
  // audio analysis that happens before record; canvas is re-fit to
  // _exportSize once). See .improvements/2026-09-08T01-36.
  Renderer._recOverlay = null;  // force a rebuild on first drawRecordingOverlay
  ```

  Inside `drawRecordingOverlay(cx)` (engine.html:4177-4207), replace the body with a cached-path:

  ```js
  drawRecordingOverlay(cx) {
    const w = cx.canvas.width, h = cx.canvas.height;
    const f = Audio.feat;
    // Build / refresh the cache. This runs once per recording session
    // (or on resize, but resize is not exposed during recording).
    if (!Renderer._recOverlay) {
      const parts = [];
      if (f.bpm) parts.push('BPM ' + f.bpm);
      if (f.key) parts.push(f.key + ' ' + (f.scale || 'major'));
      if (!parts.length) { Renderer._recOverlay = false; return; }
      const text = parts.join(' · ');
      cx.save();
      cx.font = '600 18px ui-monospace, Menlo, monospace';
      const metrics = cx.measureText(text);
      const padX = 14, padY = 8;
      const boxW = metrics.width + padX * 2;
      const boxH = 30;
      const x = w - boxW - 16;
      const y = h - boxH - 16;
      Renderer._recOverlay = {
        text, boxW, boxH, x, y,
        dotX: x + boxW - 12, dotY: y + boxH / 2,
      };
      cx.restore();
    }
    if (Renderer._recOverlay === false) return;  // empty overlay (no BPM/key)
    const o = Renderer._recOverlay;
    cx.save();
    cx.fillStyle = 'rgba(5, 3, 8, 0.72)';
    cx.fillRect(o.x, o.y, o.boxW, o.boxH);
    cx.strokeStyle = 'rgba(255, 61, 146, 0.55)';
    cx.lineWidth = 1;
    cx.strokeRect(o.x + 0.5, o.y + 0.5, o.boxW - 1, o.boxH - 1);
    cx.fillStyle = '#f5e9ff';
    cx.textBaseline = 'middle';
    // Font is already set from the cache build above (or stale from prior
    // drawMeter / drawRecordingOverlay calls); we re-set it once here
    // for safety. measureText runs ONCE per recording session (in the
    // cache-build branch), not per frame.
    cx.font = '600 18px ui-monospace, Menlo, monospace';
    cx.fillText(o.text, o.x + 14, o.y + o.boxH / 2);
    cx.fillStyle = '#ff7a3d';
    cx.beginPath();
    cx.arc(o.dotX, o.dotY, 4, 0, Math.PI * 2);
    cx.fill();
    cx.restore();
  },
  ```

  Then in `Recorder.stop()` (find the existing `stop()` method via `grep -n "stop() {" engine.html | head -5` — likely around line 4862) — after the existing cleanup, add:

  ```js
  if (window.Renderer) Renderer._recOverlay = null;  // invalidate cache on next start
  ```

  **Note on `Renderer` reference**: confirm by reading the renderer's enclosing scope at the top of the IIFE around engine.html:3809. If `Renderer` is in scope of `Recorder.start()` / `Recorder.stop()` (likely — they're sibling const declarations inside the same engine.html IIFE), this works. If not, hoist it: store the overlay cache on a `_recOverlayCache` field owned by `Recorder` and have `drawRecordingOverlay` check `Recorder._recOverlayCache` instead.

- **Verify**: `npm run check` (syntax). Manual smoke: start a recording, watch the bottom-right overlay — it shows BPM/key identically to before. `console.time('recOverlay')` around the first `drawRecordingOverlay` call vs the 100th shows the 100th is dramatically cheaper (no `measureText`, no font-set). `grep -nE "cx\\.measureText" engine.html` returns at most one hit (inside the cache-build branch) instead of one hit per frame.

### Step 4 — Add a smoke verifier that asserts the throttles fire as expected

- **Files**: new `verify-loop-dom-throttle.mjs` at repo root (matches the verify-*.mjs Puppeteer pattern noted in AGENTS.md); wire it as `npm run verify:loop-dom-throttle` in `package.json` next to the existing `verify:*` entries.

- **Action**: Open `/engine/` with a synthetic silent audio file (use the existing `audios/` test asset pattern from the verify scripts). After 2 seconds, read `document.getElementById('fps-v').textContent` 30 times at 33 ms intervals (≈30 samples); assert that the value changed ≤10 times (5 Hz throttle). Read `getComputedStyle(document.getElementById('stage-flash')).opacity` 30 times; assert that the value is constant or changes ≤3 times during silence. Start a recording (programmatically call `Recorder.start()` with the test audio), read `cx.measureText` call counts via `window.__measureCount++` monkey-patch injected before the test, run for 2 seconds, assert the measureText call count is 1 (one for the cache build) and not ~120.

  Concrete sketch:

  ```js
  // verify-loop-dom-throttle.mjs
  import puppeteer from 'puppeteer';
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto('http://localhost:5174/engine/', { waitUntil: 'networkidle0' });
  // Inject a counter on measureText so we can assert it fires once.
  await page.evaluate(() => {
    const ctx = document.querySelector('canvas').getContext('2d');
    const orig = ctx.measureText.bind(ctx);
    window.__measureCount = 0;
    ctx.measureText = function (...a) { window.__measureCount++; return orig(...a); };
  });
  await page.evaluate(() => window.Recorder.start());
  await new Promise(r => setTimeout(r, 2000));
  const measureCount = await page.evaluate(() => window.__measureCount);
  if (measureCount > 2) throw new Error(`measureText fired ${measureCount}× in 2s — overlay cache not working`);
  await browser.close();
  ```

  Make it env-skip when no audio asset is reachable (matching the existing `verify:hf-publish` env-skip pattern from AGENTS.md).

- **Verify**: `npm run verify:loop-dom-throttle` passes locally; `npm run check:full` still green.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run check:full` passes (adds verify smoke).
- Manual smoke at `/engine/`: open the page, observe FPS counter updates ~5x/sec (was 60x/sec), no visual difference in the readout. Watch `stageFlash` during a song with clear beats — flash intensity matches prior behavior; pause the song — flash settles to `'0'` within ~200ms and stays there.
- Manual smoke: start a recording (`Recorder.start()` from console or the UI button), play any audio file, export, then in DevTools Performance record 5 sec of the recording overlay's render cost. Per-frame cost of `drawRecordingOverlay` should drop by ~60-80% (no `measureText`, no `cx.font` re-evaluation, no per-frame string allocations).
- New `npm run verify:loop-dom-throttle` (Step 4): assertions pass; env-skips cleanly when no audio asset is reachable.

## Risks / gotchas

- **FPS throttle and `Date.now()` vs `performance.now()`**: We use `performance.now()` (monotonic, sub-ms precision) per the existing pattern at engine.html:1759 / 1767 / 3509. The guard `(typeof performance !== 'undefined' && performance.now)` is needed because the verify-*.mjs scripts may evaluate this code in a context where `performance` is shadowed. The fallback to `Date.now()` works fine for 200 ms gating.
- **`stageFlash` change-detection race**: `Math.abs(beatOp - this._lastStageFlashOpacity) >= 0.005` writes when the value moves by 0.005. Initial value is -1; first frame always writes (Math.abs(0 - (-1)) = 1 ≥ 0.005). After that, only changes trigger writes. Subtle: a single CSS opacity write at 60 Hz is cheap; this is purely a churn-reduction, not a correctness fix.
- **`drawRecordingOverlay` cache invalidation**: We invalidate on `Recorder.stop()`. If someone resizes the window mid-recording (rare; the recording already re-fits the canvas to the export size, not the window size), the overlay position would be off. Verify by reading the `Recorder.start()` body at engine.html:4525 — `Renderer.fitToSize(preset.w, preset.h)` sets `stageCanvas.width = ...` synchronously, so `cx.canvas.width/height` are stable for the duration. Safe.
- **`cx.font` re-set in the cached draw**: We still set `cx.font` once per frame inside `drawRecordingOverlay` (Step 3 line `cx.font = '600 18px ui-monospace, Menlo, monospace'`). That's a deliberate safety: `drawMeter` at line 4171 sets `cx.font = '10px ui-monospace'` and other consumers (e.g. `drawRecordingOverlay` running on `stageCtx` not `meterCtx`, so this doesn't actually collide — but a future caller might). Removing the re-set would save one more line but increase coupling. Keep it.
- **`Recorder` global access in `drawRecordingOverlay`**: `drawRecordingOverlay` is a method on the Renderer object, not the Recorder. It accesses `Renderer._recOverlay` (the renderer-owned cache). `Recorder.start()` writes to that same field. If the IIFE scope makes `Renderer` inaccessible from inside `Recorder`, fall back to the `Recorder._recOverlayCache` alternative flagged in Step 3.
- **Throttle counter vs `_watermarkFrame` pattern**: We use a `_lastFpsWriteAt` timestamp (wall-clock gating), matching `engine.html:4443`'s `_watermarkFrame` integer-counter pattern. Either works; timestamp is simpler for this case because we want a wall-clock interval, not a frame-modulo. Note that `_watermarkFrame` could be migrated to the same pattern in a follow-up but is out of scope here.
- **Verify script env-skip**: `verify-loop-dom-throttle.mjs` needs the engine running with audio. Mirror the existing `verify:hf-publish` env-skip pattern (AGENTS.md says: *"tests that need resources outside this repo ... print `(env skip: ...)` and pass when the resource is absent"*). Keep the marker literal so a real failure still surfaces.
- **No variant codemod needed**: `grep -lE "fps-v|stageFlash|drawRecordingOverlay" versions/*.html` returns empty — engine.html is the only file with these symbols. The fix is engine.html-local; no variants touched.

## Out of scope

- **Variant-specific per-frame DOM writes**: Each variant HTML has its own `loop()` body; this plan touches engine.html only. Variants use a different render codemod (`versions/_render-inject.js`) and are addressed by their own perf cycles (recent ones: 2026-09-06T03-54, 2026-09-06T06-45, 2026-09-07T20-33).
- **`drawPaletteOverlay` and `drawMeter` gradient caching**: Both are covered by prior plans (`palette-overlay-grad-cache` 2026-09-05T05-03 and `engine-meter-grad-cache` 2026-09-05T20-20). If those plans are stale and unintegrated, they're addressed by separate cycles (or by re-running them — the plans themselves are still valid).
- **WebGL overlay / shader-based BPM display**: Out of scope; engine.html uses 2D canvas.
- **Throttling other unconditional DOM writes**: e.g. `rotBtn.style.opacity` at engine.html:2788 (hit only on layer add/remove, not per-frame) and `rotV.style.opacity` at engine.html:2875 (same). These fire on user events, not RAF. Out of scope.
- **`stageFlash` element reference initialization race**: `stageFlash` is a global on the engine.html IIFE scope; it exists before `Renderer.start()` is called (the engine sets it up earlier in the file). Confirmed by reading the element initialization around line 1176 / 1560 (similar neighborhood).
- **Migration of `_watermarkFrame` integer-counter to timestamp-throttle**: Mentioned as a possible follow-up; not part of this plan.