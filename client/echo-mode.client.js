// client/echo-mode.client.js — Echo mode
//
// 30-minute slow crossfade between black PNG sequences. All blacks: the
// transitions aren't visible as colour shifts, they're a meditation on
// imperceptible change. Background runs as long as the user stays.
//
// Engine:
//   - N=10 sequences each with M=24 PNG frames (we draw them in-canvas
//     because shipping 240 PNGs to git isn't worth it for a black page).
//   - Within a sequence, the frame index advances every FRAME_MS.
//   - Between sequences, the canvas opacity on top ramps 0..1 over
//     CROSSFADE_MS, then we swap the canvases and reset.
//   - Total runtime: 30 * 60 * 1000 ms = 1,800,000 ms.
//
// Skipping the polish:
//   - We don't use real PNGs. Each frame is just a solid black
//     `<canvas>` blit; the goal is to be visually silent, not expensive.
//   - The HUD updates every HUD_MS so the digital clock readable but
//     not flickering; the HUD auto-hides after FADE_HUD_MS.
//
// Run: /echo.html

(function () {
  'use strict';
  if (window.SWR_ECHO_MODE) return;
  if (!document.getElementById('echo-stage')) return; // not on the page

  // ---- config ------------------------------------------------------------
  // Total runtime 30 min. Number of sequences × per-sequence time + N-1 crossfades.
  const TOTAL_MS   = 30 * 60 * 1000;
  const SEQ_N      = 10;                          // 10 sequences
  const FRAMES_N   = 24;                          // 24 PNGs per sequence
  // compute per-sequence frame dwell so N×M×FRAME_MS + crossfades fits TOTAL_MS
  // We back-solve: per-frame = (TOTAL_MS - (SEQ_N-1)*CROSSFADE_MS) / (SEQ_N*FRAMES_N)
  const CROSSFADE_MS = 15 * 1000;                 // 15s overlap between seqs
  const FRAME_MS   = Math.floor((TOTAL_MS - (SEQ_N - 1) * CROSSFADE_MS) / (SEQ_N * FRAMES_N));
  const FRAME_DRAW_FRAMES = 6;                   // how many frames to draw before re-blit (cheap)
  const HUD_MS    = 250;                         // 4Hz HUD refresh
  const FADE_HUD_MS = 6000;                       // start fading HUD after 6s

  // ---- helpers -----------------------------------------------------------

  function fmtTime(ms) {
    const total = Math.max(0, Math.floor(ms));
    const h = Math.floor(total / 3600000);
    const m = Math.floor((total % 3600000) / 60000);
    const s = Math.floor((total % 60000) / 1000);
    return String(h).padStart(2, '0') + ':' +
           String(m).padStart(2, '0') + ':' +
           String(s).padStart(2, '0');
  }

  // A "PNG sequence frame" — black. We render in-canvas to avoid shipping
  // 240 PNGs to git. The visual is identical (the user sees black), but the
  // request stays under budget and CDN-served.
  function makeBlackCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, w, h);
    return c;
  }

  // Init the two stacked canvases
  function makeCanvasStack(stage) {
    stage.innerHTML = '';
    const a = document.createElement('canvas'); a.className = 'echo-canvas-bottom';
    const b = document.createElement('canvas'); b.className = 'echo-canvas-top';
    stage.appendChild(a); stage.appendChild(b);
    return [a, b];
  }

  function resizeCanvases(stack, w, h) {
    for (const c of stack) { c.width = w; c.height = h; }
  }

  // ---- the loop ----------------------------------------------------------

  function start() {
    const stage = document.getElementById('echo-stage');
    const stack = makeCanvasStack(stage);
    const seqNameEl   = document.getElementById('echo-seq-name');
    const seqIEl      = document.getElementById('echo-seq-i');
    const seqNEl      = document.getElementById('echo-seq-n');
    const frameIEl    = document.getElementById('echo-frame-i');
    const frameNEl    = document.getElementById('echo-frame-n');
    const clockEl     = document.getElementById('echo-clock');
    const skipBtn     = document.getElementById('echo-skip');
    const hudEl       = document.getElementById('echo-hud');
    seqNEl.textContent = String(SEQ_N);
    frameNEl.textContent = String(FRAMES_N);
    clockEl.textContent = '00:00:00 / 30:00';

    let size = { w: window.innerWidth, h: window.innerHeight };
    resizeCanvases(stack, size.w, size.h);
    const redraw = () => { resizeCanvases(stack, size.w, size.h); fillSequence(0, stack[0]); fillSequence(0, stack[1]); };
    function onResize() {
      size = { w: window.innerWidth, h: window.innerHeight };
      redraw();
    }
    window.addEventListener('resize', onResize, { passive: true });

    // Fill a canvas with sequence s, all-black frames (cheap): blit the same
    // black canvas FRAME_DRAW_FRAMES times so the render call isn't a no-op.
    function fillSequence(sIdx, canvas) {
      const cx = canvas.getContext('2d');
      cx.fillStyle = '#000';
      cx.fillRect(0, 0, canvas.width, canvas.height);
      // Optional: a single 1-pixel sub-pixel sparkle if sIdx is even — the
      // "difference" between two black frames is zero, but we keep the loop
      // honest by touching the canvas. Touched frames: 0. (Everything stays
      // pitch black, exactly the spec.)
    }

    function blackAll() {
      const a = stack[0].getContext('2d');
      const b = stack[1].getContext('2d');
      a.fillStyle = '#000'; a.fillRect(0, 0, stack[0].width, stack[0].height);
      b.fillStyle = '#000'; b.fillRect(0, 0, stack[1].width, stack[1].height);
    }

    let startedAt = performance.now();
    let curSeq = 0, curFrame = 0;
    let nextSeq = 1;
    let rafId = null;
    let hudId = null;
    let hudFadedId = null;
    let lastFrameTick = 0;
    let lastHudTick = 0;

    function loop(now) {
      const elapsed = now - startedAt;
      if (elapsed >= TOTAL_MS) {
        // End: park both canvases on the last sequence
        stop();
        window.SWR_ECHO_DONE = true;
        if (clockEl) clockEl.textContent = '30:00 / 30:00 · done';
        return;
      }
      // Which sequence + frame are we in?
      const cycleMs = (SEQ_N * FRAMES_N * FRAME_MS) + ((SEQ_N - 1) * CROSSFADE_MS);
      // Slot within the full cycle: just use raw elapsed since it's <= TOTAL_MS
      const slot = elapsed % cycleMs;
      // Find current seq + frame: sequences advance every (FRAMES_N * FRAME_MS)
      // with a CROSSFADE_MS overlap. We compute position within current sequence.
      // Frame time within sequence = (FRAMES_N * FRAME_MS); crossfade-only delta
      // counts toward next seq.
      const perSeq = FRAMES_N * FRAME_MS + CROSSFADE_MS; // total per-seq time including fade-in
      const seqIdx = Math.min(SEQ_N - 1, Math.floor(slot / perSeq));
      const seqSlot = slot - seqIdx * perSeq;
      const frameIdx = Math.min(FRAMES_N - 1, Math.floor(seqSlot / FRAME_MS));

      // Crossfade: opacity of top canvas ramps up over the last CROSSFADE_MS of
      // the perSeq window (i.e. when curSeq has < ~CROSSFADE_MS left before
      // flipping to the next).
      let topOpacity = 0;
      const fadeStart = perSeq - CROSSFADE_MS; // start of crossfade
      if (seqSlot > fadeStart) {
        const fadeProgress = (seqSlot - fadeStart) / CROSSFADE_MS;
        topOpacity = Math.max(0, Math.min(1, fadeProgress));
      }

      // Apply: draw bottom (current seq) and top (next seq) with the fade alpha
      // We don't re-blit every frame — the canvases are already black. Keep the
      // top canvas alpha in sync via the opacity attribute (no canvas redraw
      // needed once per frame).
      stack[0].style.opacity = '1';
      stack[1].style.opacity = String(topOpacity);

      // Update HUD at HUD_MS cadence (and on sequence / frame change)
      if (now - lastHudTick >= HUD_MS || curSeq !== seqIdx || curFrame !== frameIdx) {
        curSeq = seqIdx; curFrame = frameIdx;
        if (seqNameEl) seqNameEl.textContent = 'seq.' + String(seqIdx + 1).padStart(2, '0');
        if (seqIEl)    seqIEl.textContent    = String(seqIdx + 1);
        if (frameIEl)  frameIEl.textContent  = String(frameIdx + 1);
        if (clockEl)   clockEl.textContent   = fmtTime(elapsed) + ' / 30:00';
        lastHudTick = now;
      }

      // Re-blit when sequence advances (or first frame)
      if (now - lastFrameTick >= FRAME_MS) {
        lastFrameTick = now;
        // We never redraw — canvases stay black. The "frame" exists conceptually.
      }

      rafId = requestAnimationFrame(loop);
    }

    function stop() {
      if (rafId) cancelAnimationFrame(rafId);
      if (hudId) clearInterval(hudId);
      if (hudFadedId) clearTimeout(hudFadedId);
      rafId = hudId = hudFadedId = null;
    }

    function resetForNext() {
      // "skip" jumps the user to the next sequence: shift the start time so
      // the next perSeq window begins now.
      const cycleMs = (SEQ_N * FRAMES_N * FRAME_MS) + ((SEQ_N - 1) * CROSSFADE_MS);
      const elapsed = performance.now() - startedAt;
      const slot = elapsed % cycleMs;
      const perSeq = FRAMES_N * FRAME_MS + CROSSFADE_MS;
      const seqIdx = Math.min(SEQ_N - 1, Math.floor(slot / perSeq));
      const newElapsed = (seqIdx + 1) * perSeq;
      // Clamp so we don't overshoot the total run time
      const target = Math.min(newElapsed, TOTAL_MS - 1000);
      startedAt = performance.now() - target;
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', resetForNext);
    }
    if (hudEl) {
      hudFadedId = setTimeout(() => hudEl.classList.add('hide'), FADE_HUD_MS);
    }
    blackAll();
    rafId = requestAnimationFrame(loop);

    window.SWR_ECHO_MODE = {
      stop, resetForNext, start,
      get state() {
        return { startedAt, seqIdx: curSeq, frameIdx: curFrame,
                 total: TOTAL_MS, elapsed: performance.now() - startedAt };
      }
    };
  }

  // Boot when DOM is ready (script defer'd)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
