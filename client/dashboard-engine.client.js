// client/dashboard-engine.client.js — audio-reactive canvas engine for the dashboard
// Loaded by dashboard.html via <script src="...">. Extracted into a separate
// file so the JS lives in its own JS-parse context, sidestepping HTML
// parser edge cases (parse5 decodes \u003c inside <script> bodies as '<').
//
// Public API on window.__SWR_ENGINE:
//   .audio        — the <audio> element
//   .loadFile(f)  — load an audio File into the engine
//   .features()   — { bass, mid, high, rms, onset, level } (0..1)
//   .bpm()        — rolling BPM estimate
//   .stop()       — cancel the RAF loop

(function () {
  'use strict';
  const canvasEl = document.getElementById('render-canvas');
  if (!canvasEl) return;
  const ctx2d = canvasEl.getContext('2d');
  const W = 540, H = 675;
  canvasEl.width = W;
  canvasEl.height = H;
  ctx2d.imageSmoothingEnabled = true;

  // ─── Audio plumbing ───────────────────────────────────────
  const audio = document.createElement('audio');
  audio.crossOrigin = 'anonymous';
  audio.loop = false;
  audio.preload = 'auto';
  audio.style.display = 'none';
  document.body.appendChild(audio);

  let audioCtx = null;
  let analyser = null;
  let freqData = null;
  let sourceNode = null;

  function ensureAudioGraph() {
    if (audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    sourceNode = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  }

  // ─── Features per frame ───────────────────────────────────
  // bass = avg of bins 1..8, mid = bins 9..40, high = bins 41..120
  const features = { bass: 0, mid: 0, high: 0, rms: 0, onset: 0, level: 0, _lastBass: 0 };
  let lastSpectrum = null;
  let beatPulse = 0;
  let bpmEstimate = 0;
  const beatTimes = [];

  function updateFeatures() {
    if (!analyser) return;
    analyser.getByteFrequencyData(freqData);
    const n = freqData.length;
    let bass = 0, mid = 0, high = 0, sumSq = 0;
    const bassEnd = 8, midEnd = 40, highEnd = Math.min(120, n);
    for (let i = 1; i < highEnd; i++) {
      const v = freqData[i] / 255;
      sumSq += v * v;
      if (i < bassEnd) bass += v;
      else if (i < midEnd) mid += v;
      else high += v;
    }
    bass = bass / Math.max(1, bassEnd - 1);
    mid = mid / Math.max(1, midEnd - bassEnd);
    high = high / Math.max(1, highEnd - midEnd);
    const rms = Math.sqrt(sumSq / highEnd);
    const level = (bass * 0.6 + mid * 0.3 + high * 0.1);

    let flux = 0;
    if (lastSpectrum) {
      for (let i = 1; i < n; i++) {
        const d = freqData[i] - lastSpectrum[i];
        if (d > 0) flux += d;
      }
      flux = flux / (n * 255);
    }
    lastSpectrum = new Uint8Array(freqData);

    features.bass = bass;
    features.mid = mid;
    features.high = high;
    features.rms = rms;
    features.onset = flux;
    features.level = level;

    // Beat detection: bass above running avg
    if (bass > 0.45 && bass > features._lastBass * 1.35) {
      const now = audio.currentTime || 0;
      beatPulse = 1.0;
      beatTimes.push(now);
      while (beatTimes.length > 2 && beatTimes[0] < now - 8) beatTimes.shift();
      if (beatTimes.length >= 4) {
        let sum = 0;
        for (let i = 1; i < beatTimes.length; i++) sum += beatTimes[i] - beatTimes[i - 1];
        const avg = sum / (beatTimes.length - 1);
        if (avg > 0) bpmEstimate = Math.round(60 / avg);
      }
    }
    features._lastBass = features._lastBass * 0.85 + bass * 0.15;
  }

  // ─── Drop / file picker ───────────────────────────────────
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('audio-file');
  const playBtn = document.getElementById('play-btn');
  const timeReadout = document.getElementById('time-readout');

  function loadFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    audio.src = url;
    audio.load();
    ensureAudioGraph();
    dropZone.classList.add('hidden');
  }

  if (dropZone && canvasEl.parentElement) {
    ['dragenter', 'dragover'].forEach((evt) =>
      canvasEl.parentElement.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('ring'); })
    );
    ['dragleave', 'drop'].forEach((evt) =>
      canvasEl.parentElement.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('ring'); })
    );
    canvasEl.parentElement.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('audio/')) loadFile(f);
    });
    dropZone.addEventListener('click', () => fileInput.click());
  }

  if (fileInput) fileInput.addEventListener('change', (e) => loadFile(e.target.files[0]));

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return m + ':' + s.toString().padStart(2, '0');
  }

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      ensureAudioGraph();
      if (!audio.src) {
        if (fileInput) fileInput.click();
        return;
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      if (audio.paused) audio.play(); else audio.pause();
    });
  }
  audio.addEventListener('play',  () => { if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>'; });
  audio.addEventListener('pause', () => { if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play"></i>'; });
  audio.addEventListener('timeupdate', () => {
    if (timeReadout) timeReadout.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
  });

  // ─── BPM / KEY display ───────────────────────────────────
  const metricEls = document.querySelectorAll('span.tabular.text-white.font-medium');
  const bpmEl = metricEls[0];
  const keyEl = metricEls[1];
  const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const chroma = new Float32Array(12);
  function estimateKey() {
    chroma.fill(0);
    if (!freqData) return 0;
    const n = freqData.length;
    const sampleRate = audioCtx ? audioCtx.sampleRate : 44100;
    const binHz = sampleRate / 2 / n;
    for (let i = 1; i < n; i++) {
      const hz = i * binHz;
      if (hz < 60) continue;
      const midi = Math.round(12 * Math.log2(hz / 440) + 69);
      const cls = ((midi % 12) + 12) % 12;
      chroma[cls] += freqData[i];
    }
    let max = 0, idx = 0;
    for (let i = 0; i < 12; i++) if (chroma[i] > max) { max = chroma[i]; idx = i; }
    return idx;
  }

  // ─── Render loop ──────────────────────────────────────────
  let raf = null;
  let beatCount = 0;
  function frame() {
    updateFeatures();
    beatPulse *= 0.9;

    if (beatCount++ % 10 === 0) {
      if (bpmEl && bpmEstimate > 0) bpmEl.textContent = bpmEstimate;
      if (keyEl) keyEl.textContent = audio.src ? KEY_NAMES[estimateKey()] : '08';
    }

    render();
    raf = requestAnimationFrame(frame);
  }

  function render() {
    ctx2d.fillStyle = 'rgba(10, 10, 11, 0.18)';
    ctx2d.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const glowR = 220 + features.bass * 180 + beatPulse * 80;
    const grad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, 'rgba(120, 30, 50, ' + (0.35 + features.bass * 0.4) + ')');
    grad.addColorStop(0.5, 'rgba(58, 13, 24, 0.25)');
    grad.addColorStop(1, 'rgba(10, 10, 11, 0)');
    ctx2d.fillStyle = grad;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx2d.fill();

    const rows = document.querySelectorAll('#layers-list > details');
    rows.forEach((row, idx) => {
      if (!row.open) return;
      renderLayer(idx, row);
    });

    if (features.onset > 0.04) {
      ctx2d.strokeStyle = 'rgba(255, 138, 61, ' + Math.min(1, features.onset * 6) + ')';
      ctx2d.lineWidth = 1;
      const r = 60 + features.onset * 240;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
      ctx2d.stroke();
    }
  }

  function renderLayer(idx, row) {
    const sliders = row.querySelectorAll('input[type=range]');
    const opacity = parseFloat(sliders[0] && sliders[0].value || 100) / 100;
    const base = parseFloat(sliders[1] && sliders[1].value || 50) / 100;
    const scale = parseFloat(sliders[2] && sliders[2].value || 100) / 100;
    const hue = parseFloat(sliders[3] && sliders[3].value || 0);
    const rot = parseFloat(sliders[4] && sliders[4].value || 0);
    const blend = (row.querySelector('select') || {}).value || 'over';

    ctx2d.save();
    ctx2d.globalAlpha = opacity;
    ctx2d.globalCompositeOperation = blendMode(blend);
    ctx2d.translate(W / 2, H / 2);
    ctx2d.rotate((rot * Math.PI) / 180);
    ctx2d.scale(scale, scale);

    switch (idx) {
      case 0: drawShared(features.bass, base, hue); break;
      case 1: drawAura(features.mid, base, hue); break;
      case 2: drawGrain(features.high, base); break;
      case 3: drawHalo(features.onset, beatPulse, base, hue); break;
      case 4: drawMarker(beatPulse, base); break;
    }
    ctx2d.restore();
  }

  function blendMode(s) {
    return ({ over: 'source-over', overlay: 'overlay', screen: 'screen', multiply: 'multiply' })[s] || 'source-over';
  }

  function drawShared(bass, base, hue) {
    const r = 80 + bass * 220 * base + beatPulse * 60;
    ctx2d.strokeStyle = 'hsla(' + ((20 + hue) % 360) + ', 80%, 60%, 0.7)';
    ctx2d.lineWidth = 2 + bass * 6;
    ctx2d.beginPath();
    ctx2d.arc(0, 0, r, 0, Math.PI * 2);
    ctx2d.stroke();
  }
  function drawAura(mid, base, hue) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = 60 + mid * 200 * base + Math.sin(a * 3) * 20;
      ctx2d.fillStyle = 'hsla(' + ((200 + hue + i * 30) % 360) + ', 70%, 55%, ' + (0.25 + mid * 0.3) + ')';
      ctx2d.beginPath();
      ctx2d.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 40 + mid * 80 * base, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }
  function drawGrain(high, base) {
    const n = Math.floor(40 * base + high * 200);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * W * 1.4;
      const y = (Math.random() - 0.5) * H * 1.4;
      ctx2d.fillStyle = 'rgba(255, 255, 255, ' + (0.05 + Math.random() * 0.25) + ')';
      ctx2d.fillRect(x, y, 1.5, 1.5);
    }
  }
  function drawHalo(onset, pulse, base, hue) {
    const r = 40 + onset * 280 + pulse * 140;
    const g = ctx2d.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
    g.addColorStop(0, 'hsla(' + ((0 + hue) % 360) + ', 90%, 60%, 0)');
    g.addColorStop(0.6, 'hsla(' + ((0 + hue) % 360) + ', 90%, 60%, ' + (0.15 + onset * 0.5) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx2d.fillStyle = g;
    ctx2d.fillRect(-W, -H, W * 2, H * 2);
  }
  function drawMarker(pulse, base) {
    const len = 30 + pulse * 60 * base;
    ctx2d.strokeStyle = 'rgba(255, 255, 255, ' + (0.4 + pulse * 0.6) + ')';
    ctx2d.lineWidth = 2;
    const r = 100;
    for (let a = 0; a < 4; a++) {
      const ang = (a / 4) * Math.PI * 2 + Math.PI / 4;
      ctx2d.beginPath();
      ctx2d.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
      ctx2d.lineTo(Math.cos(ang) * (r + len), Math.sin(ang) * (r + len));
      ctx2d.stroke();
    }
  }

  raf = requestAnimationFrame(frame);

  window.__SWR_ENGINE = {
    audio, loadFile, features: () => features, bpm: () => bpmEstimate,
    stop: () => { if (raf) cancelAnimationFrame(raf); },
  };
})();
