// client/record.client.js - record.html driver.
//
// Renders the engine output at the chosen aspect ratio (16:9 / 9:16 /
// 1:1) and pipes both the canvas and the engine audio into a
// recorder module (lib/recorder.client.js → WebCodecs path). On stop,
// a downloadable WebM file is offered in the result panel.
//
// The canvas aspect ratio is the contract. The CSS-scaled preview keeps
// the live view comfortable at every device size; the recorded video
// is captured at the FULL pixel dimensions of the chosen format
// regardless of the preview size on screen.

(() => {
  'use strict';
  if (window.SWR_RECORD) return;
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const DOM = document;
  const preview = DOM.getElementById('r-preview');
  const canvas = DOM.getElementById('r-canvas');
  const playBtn = DOM.getElementById('r-play');
  const recBtn = DOM.getElementById('r-record');
  const recLabel = DOM.getElementById('r-record-label');
  const recDot = DOM.getElementById('r-rec-dot');
  const recState = DOM.getElementById('r-rec-state');
  const timerEl = DOM.getElementById('r-timer');
  const resultEl = DOM.getElementById('r-result');
  const fileNameEl = DOM.getElementById('r-file-name');
  const fileMetaEl = DOM.getElementById('r-file-meta');
  const dlLink = DOM.getElementById('r-download');
  const copyBtn = DOM.getElementById('r-copy');
  const orientBadge = DOM.getElementById('r-orient-name');
  const fpsEl = DOM.getElementById('r-fps');
  const bitrateEl = DOM.getElementById('r-bitrate');
  const orientGrid = DOM.getElementById('r-orient-grid');

  if (!canvas) return;
  const cx = canvas.getContext('2d', { alpha: false });

  // ---- Orientation table (canvas WxH + label + a no-em-dash slug) ----
  const ORIENTS = {
    '169': { w: 1920, h: 1080, label: 'Landscape', aspect: '16:9' },
    '916': { w: 1080, h: 1920, label: 'Portrait',  aspect: '9:16' },
    '11':  { w: 1080, h: 1080, label: 'Square',    aspect: '1:1'  },
  };
  let activeOrient = '169';

  function applyOrient(slug) {
    if (!ORIENTS[slug]) return;
    activeOrient = slug;
    const o = ORIENTS[slug];
    canvas.width = o.w;
    canvas.height = o.h;
    canvas.style.aspectRatio = o.aspect.replace(':', ' / ');
    preview.style.aspectRatio = o.aspect.replace(':', ' / ');
    orientBadge.textContent = o.aspect;
    // Update the aria-pressed state on every orient button.
    const buttons = orientGrid.querySelectorAll('.orient');
    buttons.forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.orient === slug ? 'true' : 'false');
    });
    // Bust the existing record state if the user switches mid-record.
    if (state === 'recording') {
      // Cancel current run; user must start a new one.
      cancelRecord('orientation changed');
    }
  }

  // ---- Audio-reactive canvas paint ----
  let stageT = 0;
  let audioFeatures = { bpm: 0, key: '', rms: 0, bass: 0, mid: 0, treble: 0, beatPulse: false, onsetPulse: false };

  function paint(t) {
    stageT = t;
    const o = ORIENTS[activeOrient];
    const W = o.w, H = o.h;
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, W, H);
    const a = audioFeatures;
    const rms = a.rms || 0;
    const bass = a.bass || 0;
    const treble = a.treble || 0;

    // Amber wash bottom-left, cyan wash top-right. The engine's
    // signature halos, sized to the current canvas.
    const g1 = cx.createRadialGradient(W * 0.5, H * 0.6, 0, W * 0.5, H * 0.6, W * 0.65);
    g1.addColorStop(0, 'rgba(251,191,36,' + (0.10 + bass * 0.32) + ')');
    g1.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = g1;
    cx.fillRect(0, 0, W, H);
    const g2 = cx.createRadialGradient(W * 0.7, H * 0.3, 0, W * 0.7, H * 0.3, W * 0.5);
    g2.addColorStop(0, 'rgba(103,232,249,' + (0.08 + treble * 0.28) + ')');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = g2;
    cx.fillRect(0, 0, W, H);

    // Spectrum bars along the bottom, sized to canvas.
    const N = activeOrient === '916' ? 24 : 40;
    const bw = W / N;
    const barH = H * (activeOrient === '916' ? 0.06 : 0.12);
    for (let i = 0; i < N; i++) {
      const tt = (i / N);
      const lvl = Math.max(0, Math.min(1, rms * 0.7 +
        Math.sin(t * 6 + tt * 7.3) * 0.10 + Math.sin(t * 11 + tt * 13) * 0.06));
      const h = lvl * barH;
      const x = i * bw;
      const y = H - h;
      cx.fillStyle = i % 2 ? 'rgba(103,232,249,.55)' : 'rgba(251,191,36,.55)';
      cx.fillRect(x + 1, y, bw - 2, h);
    }

    // Central disc breathing with bass
    const radius = Math.min(W, H) * (0.10 + bass * 0.10);
    cx.save();
    cx.translate(W / 2, H * (activeOrient === '916' ? 0.42 : 0.45));
    const grad = cx.createRadialGradient(0, 0, 0, 0, 0, radius * 2.4);
    grad.addColorStop(0, 'rgba(251,191,36,.18)');
    grad.addColorStop(0.6, 'rgba(248,113,113,.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = grad;
    cx.beginPath(); cx.arc(0, 0, radius * 2.4, 0, Math.PI * 2); cx.fill();
    cx.restore();
  }

  // ---- Audio polling ----
  function bindAudio() {
    if (!window.Audio) return;
    const loop = () => {
      const f = (window.Audio.feat && window.Audio.feat) || null;
      if (f) {
        audioFeatures = {
          bpm: f.bpm || 0,
          key: f.key || '',
          rms: f.rms || 0,
          bass: f.bass || 0,
          mid: f.mid || 0,
          treble: f.treble || 0,
          beatPulse: !!f.beatPulse,
          onsetPulse: !!f.onsetPulse,
        };
        fpsEl.textContent = (24).toString();
        bitrateEl.textContent = (6).toString();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---- Render loop ----
  let rafId = null;
  let lastT = 0;
  function loop(now) {
    const t = (now || 0) / 1000;
    const dt = Math.min(0.05, t - lastT);
    lastT = t;
    paint(t);
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  // ---- Audio playback + record state ----
  let audioReady = false;
  let audioPlaying = false;
  let state = 'idle'; // idle | recording | finalizing

  function updatePlayUI() {
    playBtn.disabled = !audioReady || state === 'recording';
    playBtn.setAttribute('aria-label', audioPlaying ? 'Pause' : 'Play');
    playBtn.innerHTML = audioPlaying
      ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>';
  }
  function updateRecordUI() {
    if (state === 'recording') {
      recBtn.classList.add('stop');
      recBtn.removeAttribute('disabled');
      recLabel.textContent = 'Stop recording';
      recDot.hidden = false;
      recDot.classList.add('recording');
      recState.textContent = 'REC';
      timerEl.hidden = false;
    } else {
      recBtn.classList.remove('stop');
      recBtn.disabled = !audioReady || state === 'finalizing';
      recLabel.textContent = state === 'finalizing' ? 'Finalizing' : 'Record';
      recDot.hidden = true;
      recDot.classList.remove('recording');
      timerEl.hidden = true;
    }
  }

  // Hidden audio file input so the user can pick a song here too.
  const audioInput = DOM.createElement('input');
  audioInput.type = 'file';
  audioInput.accept = 'audio/*';
  audioInput.style.display = 'none';
  document.body.appendChild(audioInput);

  async function loadAudio(file) {
    if (window.Audio && typeof window.Audio.loadFile === 'function') {
      try {
        await window.Audio.loadFile(file);
        audioReady = true;
        updatePlayUI();
        updateRecordUI();
        // Auto-play after a song is picked
        await window.Audio.play();
      } catch (e) {
        console.warn('[record] loadFile failed:', e && e.message);
      }
    }
  }
  audioInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) await loadAudio(f);
    audioInput.value = '';
  });

  playBtn.addEventListener('click', () => {
    if (!audioReady || !window.Audio) return;
    if (audioPlaying) window.Audio.pause && window.Audio.pause();
    else window.Audio.play && window.Audio.play();
  });
  if (window.Audio) {
    if (typeof window.Audio.on === 'function') {
      window.Audio.on('play',  () => { audioPlaying = true;  updatePlayUI(); });
      window.Audio.on('pause', () => { audioPlaying = false; updatePlayUI(); });
      window.Audio.on('ended', () => { audioPlaying = false; updatePlayUI(); });
    }
  }

  // ---- Timer ----
  let recStart = 0;
  let timerHandle = 0;
  function tickTimer() {
    if (state !== 'recording') return;
    const sec = (performance.now() - recStart) / 1000;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    timerEl.textContent = String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
    timerHandle = requestAnimationFrame(tickTimer);
  }

  // ---- Recording ----
  let recHandle = null;

  async function startRecord() {
    if (!audioReady || !window.SWR_RECORDER) {
      console.warn('[record] recorder not available');
      return;
    }
    if (!window.SWR_RECORDER.canUseWebCodecs || !window.SWR_RECORDER.canUseWebCodecs()) {
      status('WebCodecs not available in this browser. Use the legacy MediaRecorder path.');
      return;
    }
    const o = ORIENTS[activeOrient];
    // Grab the engine audio source if available; otherwise the recorder
    // falls back to video-only. (The engine exposes a global
    // `Audio.sound` AudioNode for this purpose.)
    let audioSource = null;
    try { audioSource = (window.Audio && window.Audio.sound) || null; } catch (_) {}
    try {
      recHandle = await window.SWR_RECORDER.start({
        canvas,
        audioSource,
        audioSampleRate: 48000,
        audioNumberOfChannels: 2,
        width: o.w,
        height: o.h,
        fps: 24,
        videoBitsPerSecond: 6_000_000,
      });
    } catch (e) {
      status('record failed: ' + (e && e.message || e));
      return;
    }
    recStart = performance.now();
    state = 'recording';
    updateRecordUI();
    tickTimer();
  }

  async function stopRecord() {
    if (state !== 'recording' || !recHandle) return;
    state = 'finalizing';
    updateRecordUI();
    if (timerHandle) cancelAnimationFrame(timerHandle);
    let result;
    try {
      result = await window.SWR_RECORDER.stop();
    } catch (e) {
      status('stop failed: ' + (e && e.message || e));
      state = 'idle';
      updateRecordUI();
      return;
    }
    if (!result || !result.blob) {
      status('recorder returned no blob');
      state = 'idle';
      updateRecordUI();
      return;
    }
    const o = ORIENTS[activeOrient];
    const ext = (result.blob.type && result.blob.type.indexOf('mp4') > -1) ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = 'swr-' + activeOrient + '-' + stamp + '.' + ext;
    const url = URL.createObjectURL(result.blob);
    const sizeMB = (result.blob.size / (1024 * 1024)).toFixed(1);
    fileNameEl.textContent = name;
    fileMetaEl.textContent = o.w + ' × ' + o.h + '  ·  ' + sizeMB + ' MB  ·  ' + (result.blob.type || 'video/webm');
    dlLink.href = url;
    dlLink.setAttribute('download', name);
    dlLink.dataset.url = url;
    resultEl.hidden = false;
    state = 'idle';
    updateRecordUI();
    // Note: we keep the URL alive; on the next record we replace it
    // (the old one is GC'd when the result panel re-renders).
  }

  function cancelRecord(reason) {
    if (state !== 'recording' || !recHandle) return;
    if (window.SWR_RECORDER && typeof window.SWR_RECORDER.stop === 'function') {
      window.SWR_RECORDER.stop().finally(() => {
        state = 'idle';
        if (timerHandle) cancelAnimationFrame(timerHandle);
        updateRecordUI();
        if (reason) status('cancelled: ' + reason);
      });
    } else {
      state = 'idle';
      updateRecordUI();
    }
  }

  recBtn.addEventListener('click', () => {
    if (state === 'recording') stopRecord();
    else startRecord();
  });

  copyBtn.addEventListener('click', () => {
    const url = dlLink.dataset.url;
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        () => { copyBtn.textContent = 'Copied'; setTimeout(() => { copyBtn.innerHTML = 'Copy URL'; }, 1200); },
        () => { /* ignore */ }
      );
    }
  });

  // ---- Status line ----
  const statusEl = document.createElement('div');
  statusEl.id = 'r-status';
  statusEl.style.cssText = 'margin-top:10px;font:500 12px/1.4 system-ui;color:var(--r-mute-2);min-height:16px;';
  function status(msg) { statusEl.textContent = msg; }
  resultEl.parentNode.insertBefore(statusEl, resultEl.nextSibling);

  // ---- Orient selector ----
  orientGrid.addEventListener('click', (e) => {
    const b = e.target.closest('.orient');
    if (!b) return;
    applyOrient(b.dataset.orient);
  });

  // ---- Boot ----
  applyOrient('169');
  bindAudio();
  updatePlayUI();
  updateRecordUI();
  // Show a friendly nudge if no song is loaded yet.
  status('Pick a song to begin. Tap an orientation above to swap formats.');

  // ---- Public surface ----
  window.SWR_RECORD = {
    setOrient: applyOrient,
    getOrient: () => activeOrient,
    getState: () => state,
    getAudioReady: () => audioReady,
  };
})();
