// client/dashboard-engine.client.js — audio-reactive canvas engine for the dashboard
// Loaded by dashboard.html via <script src="...">.
// 
// Primary render mode: WebGL2 (Console pixel shader). Falls through to the
// original 2D-canvas layer pipeline when WebGL2 is unavailable.
//
// Public API on window.__SWR_ENGINE:
//   .audio          — the <audio> element
//   .loadFile(f)    — load an audio File into the engine
//   .features()     — { bass, mid, high, rms, onset, level } (0..1)
//   .bpm()          — rolling BPM estimate
//   .stop()         — cancel the RAF loop
//   .mode           — 'gl' | '2d'

(function () {
  'use strict';
  const canvasEl = document.getElementById('render-canvas');
  if (!canvasEl) return;
  const W = 540, H = 675;
  canvasEl.width = W;
  canvasEl.height = H;

  // ---- Overlay canvas (always 2D) for transitions — stacks above GL ----
  const overlayEl = document.createElement('canvas');
  overlayEl.width = W; overlayEl.height = H;
  overlayEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10';
  if (canvasEl.parentElement) canvasEl.parentElement.appendChild(overlayEl);
  const octx = overlayEl.getContext('2d');

  // ---- WebGL2 bootstrap — fall through on failure ----
  let mode = '2d';
  let gl, glProg, glLoc = {}, glBuf;
  let glReady = false;
  let bands32 = new Float32Array(32);
  let signalRGB = new Float32Array([1, 0.4196, 0.1020]);   // #FF6B1A
  let bgRGB     = new Float32Array([0.0392, 0.0392, 0.0431]);// #0A0A0B

  // Reserve the canvas for WebGL — if this succeeds the 2D fallback ctx
  // is never created (the overlay canvas covers transitions).
  gl = canvasEl.getContext('webgl2', {
    alpha: false, preserveDrawingBuffer: true, antialias: false
  });

  function hexVec3(h) {
    // safari CSS returns triples, others #hex
    const raw = String(h).trim();
    // if already rgb/rgba — simple parse in the form #<hex6> or #<hex3>
    if (raw.length < 6) return new Float32Array([1, 0.4196, 0.1020]);
    const n = parseInt(raw.replace('#', ''), 16);
    if (isNaN(n)) return new Float32Array([1, 0.4196, 0.1020]);
    return new Float32Array([
      ((n >> 16) & 255) / 255,
      ((n >> 8)  & 255) / 255,
      (n & 255) / 255
    ]);
  }

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw 'compile ' + (type === gl.VERTEX_SHADER ? 'vert' : 'frag') + ': ' + gl.getShaderInfoLog(s);
    return s;
  }

  if (gl) {
    // async: fetch the GLSL, compile+link, then signal ready
    initGL().catch(e => {
      console.warn('[dashboard] GL init error, 2D fallback:', e.message);
      gl = null; glProg = null;
      mode = '2d';
    }).finally(() => { glReady = true; });

    function initGL() {
      return fetch('/client/console-shader.glsl').then(r => r.text()).then(src => {
        const vs = '#version 300 es\nin vec2 a_pos; void main(){ gl_Position=vec4(a_pos,0.0,1.0); }';
        const fs = '#version 300 es\n' + src;
        const vsh = compileShader(gl.VERTEX_SHADER, vs);
        const fsh = compileShader(gl.FRAGMENT_SHADER, fs);
        glProg = gl.createProgram();
        gl.attachShader(glProg, vsh);
        gl.attachShader(glProg, fsh);
        gl.linkProgram(glProg);
        if (!gl.getProgramParameter(glProg, gl.LINK_STATUS))
          throw 'link: ' + gl.getProgramInfoLog(glProg);
        gl.useProgram(glProg);

        // Fullscreen triangle
        glBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1, 3]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(glProg, 'a_pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        // Uniform locations
        const uNames = ['u_resolution','u_time','u_dt','u_bpm','u_beatPulse','u_signal','u_bg','u_signalAlpha'];
        uNames.forEach(n => glLoc[n] = gl.getUniformLocation(glProg, n));
        glLoc.u_bands = gl.getUniformLocation(glProg, 'u_bands');

        // Read accent colors
        const cs = getComputedStyle(document.documentElement);
        signalRGB = hexVec3(cs.getPropertyValue('--signal'));
        bgRGB     = hexVec3(cs.getPropertyValue('--bg'));

        mode = 'gl';
      });
    }
  } else {
    glReady = true;  // no GL at all — straight to 2D fallback
  }

  // ---- 2D fallback context (used only when GL is unavailable) ----
  // The '2d' context cannot coexist with a WebGL context on the same canvas.
  // We never allocate it above; if GL is absent the RA loop uses the overlay.
  // For the full 2D fallback path a hidden canvas carries the layer compositing:
  let fbCanvas, fbCtx;
  if (!gl) {
    fbCanvas = document.createElement('canvas');
    fbCanvas.width = W; fbCanvas.height = H;
    fbCtx = fbCanvas.getContext('2d');
  }

  // ---- Audio plumbing (unchanged) ───────────────────────────
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

    // Re-map 512 bins → 32 bands (16-bin averages, normalized)
    if (freqData) {
      const per = Math.floor(n / 32);
      for (let i = 0; i < 32; i++) {
        let s = 0;
        for (let j = 0; j < per; j++) s += freqData[i * per + j] / 255;
        bands32[i] = s / per;
      }
    }
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
  let transition = 'cut';
  let transitionT = 0;
  let prevFrame = null;
  let TRANSITION_MS = 400;
  const filters = { brightness: 0.5, contrast: 0.5, saturation: 0.5, sharp: 0, denoise: 0, vignette: 0 };

  function applyFilters() {
    const b = 0.5 + filters.brightness;
    const c = filters.contrast;
    const s = filters.saturation;
    canvasEl.style.filter = `brightness(${b.toFixed(2)}) contrast(${c.toFixed(2)}) saturate(${s.toFixed(2)})`;
  }

  function triggerTransition() {
    if (transition === 'cut') { prevFrame = null; transitionT = 0; return; }
    try {
      prevFrame = document.createElement('canvas');
      prevFrame.width = W; prevFrame.height = H;
      prevFrame.getContext('2d').drawImage(canvasEl, 0, 0);
    } catch (_) { prevFrame = null; }
    transitionT = 0;
  }

  // ---- GL render path ----
  function glRender() {
    gl.useProgram(glProg);
    gl.viewport(0, 0, W, H);
    gl.uniform2f(glLoc.u_resolution, W, H);
    gl.uniform1f(glLoc.u_time, performance.now() / 1000);
    gl.uniform1f(glLoc.u_dt, 1 / 60);
    gl.uniform1f(glLoc.u_bpm, bpmEstimate || 0);
    gl.uniform1f(glLoc.u_beatPulse, beatPulse);
    gl.uniform1fv(glLoc.u_bands, bands32);
    gl.uniform3fv(glLoc.u_signal, signalRGB);
    gl.uniform3fv(glLoc.u_bg, bgRGB);
    gl.uniform1f(glLoc.u_signalAlpha, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---- 2D fallback render path ----
  function draw2d() {
    fbCtx.fillStyle = 'rgba(10, 10, 11, 0.18)';
    fbCtx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    const glowR = 220 + features.bass * 180 + beatPulse * 80;
    const grad = fbCtx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, 'rgba(120, 30, 50, ' + (0.35 + features.bass * 0.4) + ')');
    grad.addColorStop(0.5, 'rgba(58, 13, 24, 0.25)');
    grad.addColorStop(1, 'rgba(10, 10, 11, 0)');
    fbCtx.fillStyle = grad;
    fbCtx.beginPath();
    fbCtx.arc(cx, cy, glowR, 0, Math.PI * 2);
    fbCtx.fill();

    const rows = document.querySelectorAll('#layers-list > details');
    rows.forEach((row, idx) => {
      if (!row.open) return;
      renderLayer2d(idx, row);
    });

    if (features.onset > 0.04) {
      fbCtx.strokeStyle = 'rgba(255, 138, 61, ' + Math.min(1, features.onset * 6) + ')';
      fbCtx.lineWidth = 1;
      const r = 60 + features.onset * 240;
      fbCtx.beginPath();
      fbCtx.arc(cx, cy, r, 0, Math.PI * 2);
      fbCtx.stroke();
    }

    // Blit the 2D frame onto the main canvas (canvasEl), which is displayed
    canvasEl.width = W; canvasEl.height = H;
    const c2d = canvasEl.getContext('2d');
    c2d.drawImage(fbCanvas, 0, 0);
  }

  function renderLayer2d(idx, row) {
    const sliders = row.querySelectorAll('input[type=range]');
    const opacity = parseFloat(sliders[0] && sliders[0].value || 100) / 100;
    const base = parseFloat(sliders[1] && sliders[1].value || 50) / 100;
    const scale = parseFloat(sliders[2] && sliders[2].value || 100) / 100;
    const hue = parseFloat(sliders[3] && sliders[3].value || 0);
    const rot = parseFloat(sliders[4] && sliders[4].value || 0);
    const blend = (row.querySelector('select') || {}).value || 'over';
    fbCtx.save();
    fbCtx.globalAlpha = opacity;
    fbCtx.globalCompositeOperation = blendMode2d(blend);
    fbCtx.translate(W / 2, H / 2);
    fbCtx.rotate((rot * Math.PI) / 180);
    fbCtx.scale(scale, scale);
    switch (idx) {
      case 0: drawShared2d(features.bass, base, hue); break;
      case 1: drawAura2d(features.mid, base, hue); break;
      case 2: drawGrain2d(features.high, base); break;
      case 3: drawHalo2d(features.onset, beatPulse, base, hue); break;
      case 4: drawMarker2d(beatPulse, base); break;
    }
    fbCtx.restore();
  }

  function blendMode2d(s) {
    return ({ over: 'source-over', overlay: 'overlay', screen: 'screen', multiply: 'multiply' })[s] || 'source-over';
  }
  function drawShared2d(bass, base, hue) {
    const r = 80 + bass * 220 * base + beatPulse * 60;
    fbCtx.strokeStyle = 'hsla(' + ((20 + hue) % 360) + ', 80%, 60%, 0.7)';
    fbCtx.lineWidth = 2 + bass * 6;
    fbCtx.beginPath();
    fbCtx.arc(0, 0, r, 0, Math.PI * 2);
    fbCtx.stroke();
  }
  function drawAura2d(mid, base, hue) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = 60 + mid * 200 * base + Math.sin(a * 3) * 20;
      fbCtx.fillStyle = 'hsla(' + ((200 + hue + i * 30) % 360) + ', 70%, 55%, ' + (0.25 + mid * 0.3) + ')';
      fbCtx.beginPath();
      fbCtx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 40 + mid * 80 * base, 0, Math.PI * 2);
      fbCtx.fill();
    }
  }
  function drawGrain2d(high, base) {
    const n = Math.floor(40 * base + high * 200);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * W * 1.4;
      const y = (Math.random() - 0.5) * H * 1.4;
      fbCtx.fillStyle = 'rgba(255, 255, 255, ' + (0.05 + Math.random() * 0.25) + ')';
      fbCtx.fillRect(x, y, 1.5, 1.5);
    }
  }
  function drawHalo2d(onset, pulse, base, hue) {
    const r = 40 + onset * 280 + pulse * 140;
    const g = fbCtx.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
    g.addColorStop(0, 'hsla(' + ((0 + hue) % 360) + ', 90%, 60%, 0)');
    g.addColorStop(0.6, 'hsla(' + ((0 + hue) % 360) + ', 90%, 60%, ' + (0.15 + onset * 0.5) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fbCtx.fillStyle = g;
    fbCtx.fillRect(-W, -H, W * 2, H * 2);
  }
  function drawMarker2d(pulse, base) {
    const len = 30 + pulse * 60 * base;
    fbCtx.strokeStyle = 'rgba(255, 255, 255, ' + (0.4 + pulse * 0.6) + ')';
    fbCtx.lineWidth = 2;
    const r = 100;
    for (let a = 0; a < 4; a++) {
      const ang = (a / 4) * Math.PI * 2 + Math.PI / 4;
      fbCtx.beginPath();
      fbCtx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
      fbCtx.lineTo(Math.cos(ang) * (r + len), Math.sin(ang) * (r + len));
      fbCtx.stroke();
    }
  }

  // ---- Frame loop ----
  let lastFrameTs = 0;
  let beatGate = 0.6;
  let lastBeatPulseAt = 0;

  function frame(ts) {
    updateFeatures();
    beatPulse *= 0.9;

    // beat-driven transition
    if (audio && !audio.paused && features.onset > beatGate && prevFrame === null) {
      const now = performance.now();
      if (now - lastBeatPulseAt > 250) {
        lastBeatPulseAt = now;
        triggerTransition();
      }
    }

    if (beatCount++ % 10 === 0) {
      if (bpmEl && bpmEstimate > 0) bpmEl.textContent = bpmEstimate;
      if (keyEl) keyEl.textContent = audio.src ? KEY_NAMES[estimateKey()] : '08';
    }

    render(ts);
    raf = requestAnimationFrame(frame);
  }

  function render(ts) {
    // 1. Transition overlay on overlayEl
    const dtMs = lastFrameTs ? ts - lastFrameTs : 16;
    lastFrameTs = ts;
    if (prevFrame && transitionT < 1) {
      transitionT = Math.min(1, transitionT + dtMs / TRANSITION_MS);
      const a = Math.max(0, 1 - transitionT);
      octx.save();
      switch (transition) {
        case 'crossfade':
          octx.globalAlpha = a;
          octx.drawImage(prevFrame, 0, 0);
          break;
        case 'zoom':
          octx.globalAlpha = a;
          octx.translate(W / 2, H / 2);
          octx.scale(1 + 0.25 * transitionT, 1 + 0.25 * transitionT);
          octx.translate(-W / 2, -H / 2);
          octx.drawImage(prevFrame, 0, 0);
          break;
        case 'dip':
          octx.globalAlpha = a * 0.85;
          octx.fillStyle = '#000';
          octx.fillRect(0, 0, W, H);
          break;
        case 'flash':
          octx.globalAlpha = Math.min(1, a * 4);
          octx.fillStyle = '#fff';
          octx.fillRect(0, 0, W, H);
          break;
        case 'warp':
          octx.globalAlpha = a;
          octx.translate(40 * transitionT, 0);
          octx.drawImage(prevFrame, 0, 0);
          break;
      }
      octx.restore();
      if (transitionT >= 1) { prevFrame = null; octx.clearRect(0, 0, W, H); }
    } else {
      octx.clearRect(0, 0, W, H);
    }

    // 2. Main content
    if (mode === 'gl' && gl && glProg) {
      glRender();
    } else if (fbCtx) {
      draw2d();
    }
  }

  // Layer reorder (unchanged API)
  window.__SWR_REMAPPED_ONCE = false;
  function remapLayers() {
    const list = document.getElementById('layers-list');
    if (!list) return [];
    const rows = Array.from(list.querySelectorAll(':scope > details'));
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      rows[i].parentNode.insertBefore(rows[j], rows[i]); // careful: placeholder
    }
    if (rows.length) rows[0].setAttribute('open', '');
    window.__SWR_REMAPPED_ONCE = true;
    return rows;
  }

  // ─── Start the loop after GL is ready (or determined impossible) ──
  (async function start() {
    if (!glReady) await new Promise(r => { const t = setInterval(() => { if (glReady) { clearInterval(t); r(); } }, 50); });
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    applyFilters();
  })();

  window.__SWR_ENGINE = {
    audio, loadFile, features: () => features, bpm: () => bpmEstimate,
    // mode flips 2d→gl asynchronously once the shader compiles — expose as
    // a getter so callers always read the live state.
    get mode() { return mode; },
    setTransition: (id) => { transition = String(id || 'cut'); return transition; },
    pulseTransition: () => { triggerTransition(); return transition; },
    remapLayers: () => remapLayers(),
    setBeatGate: (v) => { beatGate = Math.max(0, Math.min(1, Number(v) || 0.6)); return beatGate; },
    setFilter: (key, value) => {
      if (!(key in filters)) return false;
      filters[key] = Number(value) || 0;
      applyFilters();
      return true;
    },
    record: (durationMs = 8000) => {
      if (!window.MediaRecorder) return Promise.reject(new Error('MediaRecorder unsupported'));
      const stream = canvasEl.captureStream(30);
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start();
      return new Promise((resolve) => {
        setTimeout(() => {
          rec.stop();
          stream.getTracks().forEach(t => t.stop());
          resolve(new Blob(chunks, { type: 'video/webm' }));
        }, durationMs);
      });
    },
    stop: () => { if (raf) cancelAnimationFrame(raf); },
  };
})();