// timeline.client.js — waveform + beat-marker timeline component.
// Renders into a <canvas> below the song-name display, draws downsampled
// peak data (RMS per ~50ms window) plus vertical tick marks at detected
// beat timestamps. Click anywhere to seek the audio element.
//
// Self-contained: it doesn't reach into SWR internals beyond Audio.audioEl
// for seek. Peak data + beat times are computed by the module itself when
// a new song loads, listening for the same beat-detect path the engine uses.

(function () {
  if (window.Timeline) return;  // idempotent

  // ---- State ----
  const state = {
    canvas: null,
    ctx: null,
    peaks: null,         // Float32Array of normalized peak values
    beatTimes: [],       // seconds
    duration: 0,
    width: 0,
    height: 0,
    hoverX: -1,
    raf: null,
    audioEl: null,       // bound when song loads
  };

  // ---- Peak extraction ----
  // Decode the audio file, compute RMS per ~50ms window, store as Float32Array.
  // Uses OfflineAudioContext so we don't disturb playback.
  async function extractPeaks(file) {
    if (!file) return null;
    try {
      const arrayBuf = await file.arrayBuffer();
      // Use a fresh AudioContext for decode (file may already be playing on the main one)
      const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuf = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
      decodeCtx.close();

      const sr = audioBuf.sampleRate;
      const windowSec = 0.05;            // 50ms windows
      const windowSamples = Math.floor(sr * windowSec);
      const numWindows = Math.floor(audioBuf.length / windowSamples);
      const channels = audioBuf.numberOfChannels;
      const peaks = new Float32Array(numWindows);

      for (let w = 0; w < numWindows; w++) {
        let sum = 0;
        const start = w * windowSamples;
        const end = start + windowSamples;
        for (let c = 0; c < channels; c++) {
          const data = audioBuf.getChannelData(c);
          for (let i = start; i < end; i++) {
            const v = data[i];
            sum += v * v;
          }
        }
        const mean = sum / (channels * windowSamples);
        peaks[w] = Math.sqrt(mean);     // RMS
      }

      // Normalize to 0..1
      let max = 0;
      for (let i = 0; i < peaks.length; i++) if (peaks[i] > max) max = peaks[i];
      if (max > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= max;

      return { peaks, duration: audioBuf.duration };
    } catch (err) {
      console.warn('[timeline] peak extraction failed:', err);
      return null;
    }
  }

  // ---- Beat-time collection ----
  // Hook into Audio.sample by polling the beat detector's beatTimes array.
  // Simpler: just snap to audioEl time and use the BPM pill — but we want
  // per-beat ticks, not BPM. Read from Audio's beatTimes if exposed.
  function captureBeats() {
    const SWR = window.SWR;
    const Audio = SWR && SWR.Audio;
    if (Audio && Array.isArray(Audio.beatTimes) && Audio.ctx) {
      // Each beat time is Audio.ctx.currentTime — convert to seconds-from-song-start
      // using the audio element's currentTime as an anchor.
      const anchorAudioNow = Audio.ctx.currentTime - (Audio.audioEl ? Audio.audioEl.currentTime : 0);
      const beats = Audio.beatTimes.map(t => t - anchorAudioNow).filter(t => t >= 0 && t < (state.duration || 9999));
      // Dedupe close beats (within 200ms)
      beats.sort((a, b) => a - b);
      const dedup = [];
      for (const b of beats) {
        if (!dedup.length || b - dedup[dedup.length - 1] > 0.2) dedup.push(b);
      }
      state.beatTimes = dedup;
    }
  }

  // ---- Rendering ----
  function draw() {
    const c = state.canvas;
    const ctx = state.ctx;
    if (!c || !ctx) return;

    const W = state.width;
    const H = state.height;

    // Background
    ctx.fillStyle = 'rgba(15, 15, 20, 0.95)';
    ctx.fillRect(0, 0, W, H);

    // Border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    if (!state.peaks || !state.duration) {
      // Empty state
      ctx.fillStyle = '#555';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Load a song to see waveform', W / 2, H / 2 + 4);
      state.raf = requestAnimationFrame(draw);
      return;
    }

    // Waveform
    const midY = H / 2;
    const amp = H * 0.45;
    const peaks = state.peaks;
    const peakStep = peaks.length / W;

    ctx.fillStyle = '#7e6cff';
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor(x * peakStep);
      const i1 = Math.floor((x + 1) * peakStep);
      let max = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) {
        if (peaks[i] > max) max = peaks[i];
      }
      const h = Math.max(1, max * amp);
      ctx.fillRect(x, midY - h, 1, h * 2);
    }

    // Beat ticks
    if (state.beatTimes.length) {
      ctx.strokeStyle = '#ff3d92';
      ctx.lineWidth = 1;
      for (const t of state.beatTimes) {
        const x = (t / state.duration) * W;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
    }

    // Playhead
    if (state.audioEl && state.duration) {
      const px = (state.audioEl.currentTime / state.duration) * W;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();
    }

    // Hover guide
    if (state.hoverX >= 0 && state.hoverX < W) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(state.hoverX, 0);
      ctx.lineTo(state.hoverX, H);
      ctx.stroke();
      ctx.setLineDash([]);
      // Time tooltip
      if (state.duration) {
        const t = (state.hoverX / W) * state.duration;
        const label = formatTime(t);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(state.hoverX + 4, 4, 44, 14);
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(label, state.hoverX + 8, 14);
      }
    }

    state.raf = requestAnimationFrame(draw);
  }

  function formatTime(t) {
    if (!isFinite(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ---- Mounting ----
  function buildUI() {
    // Mount below the transport bar (which has song-name, bpm-pill, etc.)
    // We insert it after the #song-name element's parent for layout.
    const transport = document.getElementById('transport') || document.querySelector('header#transport');
    if (!transport) {
      console.warn('[timeline] #transport not found');
      return;
    }

    const container = document.createElement('div');
    container.id = 'timeline-container';
    container.style.cssText = [
      'position:relative',
      'width:100%',
      'height:64px',
      'background:#0a0a10',
      'border-top:1px solid #222',
      'box-sizing:border-box',
    ].join(';');

    const c = document.createElement('canvas');
    c.id = 'timeline-canvas';
    c.style.cssText = 'display:block;width:100%;height:100%;cursor:crosshair;';
    container.appendChild(c);

    transport.parentElement.insertBefore(container, transport.nextSibling);

    // Size to container
    function size() {
      const r = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.width = Math.floor(r.width);
      state.height = Math.floor(r.height);
      c.width = state.width * dpr;
      c.height = state.height * dpr;
      c.style.width = state.width + 'px';
      c.style.height = state.height + 'px';
      state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    state.canvas = c;
    state.ctx = c.getContext('2d');

    size();
    window.addEventListener('resize', size);
    new ResizeObserver(size).observe(container);

    // Click-to-seek
    c.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      state.hoverX = e.clientX - r.left;
    });
    c.addEventListener('mouseleave', () => { state.hoverX = -1; });
    c.addEventListener('click', (e) => {
      if (!state.audioEl || !state.duration) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left;
      state.audioEl.currentTime = (x / state.width) * state.duration;
    });
  }

  // ---- Song-load hook ----
  // Watch the song input. On change: extract peaks + bind audioEl.
  function hookSongLoad() {
    const songInput = document.getElementById('song-input');
    if (!songInput) return;

    songInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      state.peaks = null;
      state.beatTimes = [];
      state.duration = 0;

      // Wait for Audio.loadFile to populate audioEl
      const tryBind = () => {
        const SWR = window.SWR;
        const Audio = SWR && SWR.Audio;
        if (Audio && Audio.audioEl) {
          state.audioEl = Audio.audioEl;
          state.duration = Audio.audioEl.duration || 0;
          // Poll beat times a few times during playback so we have something to draw
          let n = 0;
          const beatInt = setInterval(() => {
            captureBeats();
            if (++n > 600) clearInterval(beatInt);  // give up after 10 min
          }, 1000);
        } else {
          setTimeout(tryBind, 200);
        }
      };
      setTimeout(tryBind, 300);

      const result = await extractPeaks(file);
      if (result) {
        state.peaks = result.peaks;
        state.duration = result.duration;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { buildUI(); hookSongLoad(); });
  } else {
    setTimeout(() => { buildUI(); hookSongLoad(); }, 100);
  }

  window.Timeline = { state };
})();