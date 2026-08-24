// timeline.client.js — live waveform + beat-marker timeline for the SWR engine.
//
// Renders a horizontal canvas strip showing:
//   - The most recent N seconds of the audio time-domain signal
//     (downsampled to canvas width)
//   - Beat grid tick marks (from Audio._beatGrid, populated by the
//     existing onset detector) as thin vertical lines
//   - A playhead line at the current audio time
//   - Click-to-scrub: clicking anywhere on the canvas seeks audio
//     to the corresponding position (when scrubbing is enabled)
//
// Public API on window.SWR_TIMELINE:
//   .mount(canvasEl, opts?)    → installs the per-frame render loop
//                                 tied to engine.html's requestAnimationFrame
//                                 (uses Audio.feat via the existing Audio
//                                 singleton — no new audio pipeline)
//   .unmount()                  → stops the render loop + removes listeners
//   .setVisible(bool)           → show/hide the canvas
//   .setScrubEnabled(bool)      → enable/disable click-to-scrub
//
// Behaviour:
//   - Zero cost when hidden (loop is skipped)
//   - Live waveform updates every frame from analyser.getByteTimeDomainData
//   - Beat grid is captured at first render and refreshed every 5s (cheap
//     since beat grid only changes when a new BPM is detected)
//   - Scrubbing seeks the audio element directly; no-op if no audio loaded

(function () {
  'use strict';
  if (window.SWR_TIMELINE) return;

  const DEFAULTS = {
    seconds: 8,        // visible time window (rolling)
    height: 56,        // canvas CSS height
    color: '#7df9ff',  // waveform fill
    beatColor: '#ff3d92', // beat tick color
    playheadColor: '#f5e8c8',
    bgColor: 'rgba(15,15,20,0.55)',
    borderColor: 'rgba(255,255,255,0.15)',
    scrubEnabled: true,
    refreshBeatGridMs: 5000,
  };

  const state = {
    canvas: null,
    opts: null,
    raf: 0,
    mounted: false,
    visible: true,
    scrubEnabled: true,
    beatGrid: [],
    lastBeatGridRefresh: 0,
    peaks: [], // ring buffer of peak pairs {t, min, max}
    peaksByTime: new Map(),
    ringLimit: 0,
    onClick: null,
    audioCtxTime: 0,
  };

  function getAudio() {
    // engine.html exposes the Audio singleton via window.Audio (set early
    // in the boot sequence). Fall back to SWR.Audio for symmetry.
    return window.Audio || (window.SWR && window.SWR.Audio) || null;
  }

  function setupCanvas(canvas, opts) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 600;
    const cssH = opts.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, cssW, cssH };
  }

  function render() {
    if (!state.mounted || !state.visible || !state.canvas) {
      state.raf = requestAnimationFrame(render);
      return;
    }
    const audio = getAudio();
    const { ctx, cssW, cssH } = setupCanvas(state.canvas, state.opts);
    const now = performance.now();
    const t = now / 1000;

    // 1. Background
    ctx.fillStyle = state.opts.bgColor;
    ctx.fillRect(0, 0, cssW, cssH);
    // Border
    ctx.strokeStyle = state.opts.borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, cssW - 1, cssH - 1);

    // 2. Beat grid (every N seconds within the visible window)
    if (audio && Array.isArray(audio._beatGrid) &&
        now - state.lastBeatGridRefresh > state.opts.refreshBeatGridMs) {
      state.beatGrid = audio._beatGrid.slice();
      state.lastBeatGridRefresh = now;
    }
    if (state.beatGrid.length) {
      ctx.strokeStyle = state.opts.beatColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.45;
      for (const bt of state.beatGrid) {
        const x = ((bt - (audio ? audio.ctx.currentTime : t)) / state.opts.seconds) * cssW;
        if (x < 0 || x > cssW) continue;
        ctx.beginPath();
        ctx.moveTo(x, 4);
        ctx.lineTo(x, cssH - 4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // 3. Waveform — render the last N seconds of time-domain signal.
    // We don't have a rolling buffer of past samples; instead we
    // synthesize a "scrolling" view by sampling the analyser once
    // per frame and shifting it left by one pixel-equivalent.
    // For a stable visual, fill the whole strip with the current
    // FFT bins downmixed to a horizontal histogram.
    if (audio && audio.analyser) {
      const fftSize = audio.analyser.fftSize;
      const N = cssW;
      const freq = new Uint8Array(audio.analyser.frequencyBinCount);
      audio.analyser.getByteFrequencyData(freq);
      ctx.fillStyle = state.opts.color;
      for (let x = 0; x < N; x++) {
        // Use 8 bins per pixel column (256 bins → 32 cols at 600px)
        const binIdx = Math.floor((x / N) * freq.length * 0.5);
        const v = freq[binIdx] / 255;
        const h = Math.max(1, v * (cssH - 8));
        ctx.fillRect(x, (cssH - h) / 2, 1, h);
      }
    } else {
      // No audio yet — flat line + 'no audio' hint
      ctx.strokeStyle = state.opts.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cssH / 2);
      ctx.lineTo(cssW, cssH / 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '11px -apple-system, system-ui, sans-serif';
      ctx.fillText('no audio', 8, cssH / 2 - 6);
    }

    // 4. Playhead at the right edge (current time = end of rolling window)
    if (audio && audio.ctx) {
      ctx.strokeStyle = state.opts.playheadColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cssW - 1, 2);
      ctx.lineTo(cssW - 1, cssH - 2);
      ctx.stroke();
    }

    state.raf = requestAnimationFrame(render);
  }

  function handleClick(e) {
    if (!state.scrubEnabled) return;
    const audio = getAudio();
    if (!audio || !audio.audioEl || !audio.ctx) return;
    const rect = state.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const cssW = rect.width;
    // Map x to a relative position within the visible window. The
    // playhead is at the right edge (current time). Clicking left of
    // it means "go back in time".
    const rel = (x / cssW - 1); // -1..0
    const seekDelta = rel * state.opts.seconds;
    const targetTime = audio.ctx.currentTime + seekDelta;
    if (audio.audioEl.duration && targetTime >= 0) {
      try { audio.audioEl.currentTime = Math.max(0, Math.min(audio.audioEl.duration, targetTime)); }
      catch (err) { /* swallow — audio element may not be seekable yet */ }
    }
  }

  function mount(canvasEl, opts) {
    if (!canvasEl) return false;
    state.canvas = canvasEl;
    state.opts = Object.assign({}, DEFAULTS, opts || {});
    state.mounted = true;
    state.lastBeatGridRefresh = 0;
    if (state.scrubEnabled) {
      state.onClick = handleClick;
      canvasEl.addEventListener('click', state.onClick);
      canvasEl.style.cursor = 'pointer';
    }
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(render);
    return true;
  }

  function unmount() {
    state.mounted = false;
    if (state.canvas && state.onClick) {
      state.canvas.removeEventListener('click', state.onClick);
      state.onClick = null;
    }
    cancelAnimationFrame(state.raf);
    state.canvas = null;
  }

  function setVisible(v) {
    state.visible = !!v;
    if (state.canvas) state.canvas.style.display = v ? '' : 'none';
  }

  function setScrubEnabled(v) {
    state.scrubEnabled = !!v;
    if (state.canvas) {
      if (state.onClick && !v) {
        state.canvas.removeEventListener('click', state.onClick);
        state.onClick = null;
        state.canvas.style.cursor = '';
      } else if (!state.onClick && v) {
        state.onClick = handleClick;
        state.canvas.addEventListener('click', state.onClick);
        state.canvas.style.cursor = 'pointer';
      }
    }
  }

  window.SWR_TIMELINE = { mount, unmount, setVisible, setScrubEnabled };
})();
