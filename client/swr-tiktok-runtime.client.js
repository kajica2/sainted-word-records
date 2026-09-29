// client/swr-tiktok-runtime.client.js — TikTok Studio runtime (PR 3 of 4).
//
// Owns everything audio-reactive for /tiktok: the audio graph, the feature
// analysis (bass/mid/treble/onset from an AnalyserNode; BPM + key from the
// repo's audio-analysis-v2.js over the decoded buffer), hook detection, the
// 12 vibe presets, and the six-layer 9:16 renderer.
//
// Contract (the page owns the DOM; this module owns the canvas):
//   window.SWR_TIKTOK.create(stageCanvas, audioEl, options) -> instance
//     options: { onState(s), onFeatures(f), onHook(seconds), onError(err) }
//       s: 'idle' | 'loading' | 'ready' | 'previewing' | 'exporting'
//       f: { bpm, key, bass, mid, treble, onset, rms }
//     methods: loadAudio(file) -> Promise<{duration, bpm, key, hook}>,
//              pickVibe(tab, vibeId), setTrim(startS, endS), play(), pause(),
//              seek(sec), getState(), destroy()
//   Vibe ids: g-electronic g-hiphop g-indie g-pop | m-hype m-chill m-sad
//             m-aggressive | c-sunset c-ocean c-neon c-mono
//
// The audio graph is published on window.SWR_TIKTOK_AUDIO so the export module
// can reuse it: createMediaElementSource() may only be called once per element,
// and the export needs the same node to record the same sound.
(function () {
  'use strict';
  if (window.SWR_TIKTOK) return;

  var W = 1080, H = 1920;          // the canvas contract (tiktok.html)
  var HOOK_SCAN_S = 60;            // hook detection window
  var FEATURE_MS = 100;            // onFeatures throttle

  // ---- vibe presets --------------------------------------------------------
  // palette = [primary, secondary, ground]; intensity scales every amplitude;
  // motion picks the time envelope; layerWeights gates each renderer layer.
  function vibe(palette, intensity, motion, layers) {
    return { palette: palette, intensity: intensity, motion: motion, layers: layers };
  }
  var VIBES = {
    'g-electronic': vibe(['#00f2ea', '#ff0050', '#070b10'], 0.95, 'pulse', { bg: 1, rings: 1, wave: 0.7, particles: 1, burst: 1 }),
    'g-hiphop':     vibe(['#ff7a00', '#ffd400', '#0e0c0a'], 0.8, 'calm',  { bg: 1, rings: 1, wave: 0.5, particles: 0.4, burst: 1 }),
    'g-indie':      vibe(['#ffd9c7', '#a7d8c9', '#22222a'], 0.55, 'wave', { bg: 1, rings: 0.5, wave: 1, particles: 0.35, burst: 0.7 }),
    'g-pop':        vibe(['#ff6ec7', '#ffd166', '#101014'], 0.85, 'pulse', { bg: 1, rings: 0.8, wave: 0.8, particles: 0.8, burst: 1 }),
    'm-hype':       vibe(['#ff0050', '#ffd400', '#12060a'], 1.0, 'pulse',  { bg: 1, rings: 1, wave: 0.8, particles: 1, burst: 1.2 }),
    'm-chill':      vibe(['#4aa3ff', '#59d9a5', '#08131a'], 0.4, 'calm',   { bg: 1, rings: 0.6, wave: 0.7, particles: 0.3, burst: 0.5 }),
    'm-sad':        vibe(['#8a6bd1', '#8d8d8d', '#0d0b12'], 0.4, 'wave',   { bg: 1, rings: 0.5, wave: 0.9, particles: 0.25, burst: 0.4 }),
    'm-aggressive': vibe(['#ff2b2b', '#ffffff', '#0e0c0a'], 1.0, 'pulse',  { bg: 1, rings: 1.2, wave: 0.6, particles: 0.9, burst: 1.3 }),
    'c-sunset':     vibe(['#ff8a3d', '#ff5c8a', '#1a0f14'], 0.75, 'calm',  { bg: 1, rings: 0.8, wave: 0.7, particles: 0.5, burst: 0.8 }),
    'c-ocean':      vibe(['#1f6feb', '#00d4ff', '#040d1a'], 0.75, 'wave',  { bg: 1, rings: 0.9, wave: 1, particles: 0.6, burst: 0.8 }),
    'c-neon':       vibe(['#ff0050', '#00f2ea', '#07070c'], 0.95, 'pulse', { bg: 1, rings: 1, wave: 0.8, particles: 0.9, burst: 1 }),
    'c-mono':       vibe(['#ffffff', '#8a8a8a', '#0e0c0a'], 0.6, 'calm',   { bg: 1, rings: 0.8, wave: 0.6, particles: 0.4, burst: 0.7 })
  };

  var DEFAULTS = { tab: 'genre', vibe: 'g-electronic', trim: [0, 0] };

  function nowS() { return performance.now() / 1000; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hexToRgb(hex) {
    var h = String(hex || '#000').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }

  // ---- feature analysis over the decoded buffer ---------------------------
  // BPM + key come from audio-analysis-v2.js (window.AudioAnalysisV2: chromagram,
  // estimateBPM(onsetTimes), estimateKey(chroma)). Hook = the strongest energy
  // RISE inside the first HOOK_SCAN_S seconds, which is what a "hook" is in
  // practice: where the track lifts. Everything is best-effort by nature.
  function analyseBuffer(buffer) {
    var out = { bpm: 0, key: '', hook: 0, envelope: null, hopSec: 0 };
    var AA = window.AudioAnalysisV2;
    if (!buffer || !buffer.length) return out;
    var sr = buffer.sampleRate;
    var data = buffer.getChannelData(0);
    var hop = 1024;
    var frames = Math.min(Math.floor(data.length / hop), Math.floor((HOOK_SCAN_S * sr) / hop));
    var env = new Float32Array(frames);
    var onsets = [];
    var chromaAcc = null;
    var prev = 0;
    for (var i = 0; i < frames; i++) {
      var start = i * hop, sum = 0;
      for (var j = 0; j < hop; j++) { var s = data[start + j] || 0; sum += s * s; }
      var rms = Math.sqrt(sum / hop);
      env[i] = rms;
      var at = (i * hop) / sr;
      // Onset = a clear rise, with a 150 ms refractory so one attack cannot
      // register several times and smear the inter-onset intervals the BPM
      // estimator reads.
      if (i > 2 && rms > prev * 1.6 && rms > 0.02 && (!onsets.length || at - onsets[onsets.length - 1] > 0.15)) onsets.push(at);
      prev = rms;
    }
    out.envelope = env;
    out.hopSec = hop / sr;
    if (AA && typeof AA.estimateBPM === 'function' && onsets.length > 4) {
      try {
        var b = AA.estimateBPM(onsets);
        out.bpm = typeof b === 'number' ? b : (b && b.bpm) || 0;
      } catch (e) { /* best-effort */ }
    }
    if (!out.bpm) {
      // Fallback: autocorrelation of the onset envelope over 60-200 BPM.
      var best = 0, bestScore = 0;
      for (var bpm = 60; bpm <= 200; bpm += 1) {
        var lag = Math.round((60 / bpm) * sr / hop);
        if (lag < 1 || lag >= frames) continue;
        var score = 0;
        for (var k = lag; k < frames; k++) score += env[k] * env[k - lag];
        if (score > bestScore) { bestScore = score; best = bpm; }
      }
      out.bpm = best;
    }
    // Hook: biggest rise in a 1s window vs the 1s before it.
    var win = Math.max(1, Math.round(1 / out.hopSec));
    var bestRise = 0, bestAt = 0;
    for (var w = win; w + win < frames; w += Math.max(1, Math.round(win / 4))) {
      var a = 0, b2 = 0;
      for (var m = 0; m < win; m++) { a += env[w - win + m]; b2 += env[w + m]; }
      var rise = b2 - a;
      if (rise > bestRise) { bestRise = rise; bestAt = (w * out.hopSec); }
    }
    out.hook = bestAt;
    // Key: chroma over a strided slice (every 4th frame is plenty for a profile).
    if (AA && typeof AA.chromagram === 'function' && typeof AA.computeMagnitudes === 'function' && typeof AA.estimateKey === 'function') {
      try {
        var fftSize = 2048;
        chromaAcc = new Float32Array(12);
        var used = 0;
        for (var f = 0; f + fftSize < data.length && used < 200; f += hop * 4) {
          var slice = data.subarray(f, f + fftSize);
          var mags = AA.computeMagnitudes(slice, sr, fftSize);
          var ch = AA.chromagram(mags, sr);
          if (ch && ch.length) { for (var c = 0; c < 12; c++) chromaAcc[c] += (ch[c] || 0); used++; }
        }
        if (used) {
          var res = AA.estimateKey(chromaAcc);
          if (res && res.key) out.key = res.key + (res.scale ? ' ' + res.scale : '');
        }
      } catch (e) { /* best-effort */ }
    }
    return out;
  }

  // ---- instance ------------------------------------------------------------
  function create(stageCanvas, audioEl, options) {
    options = options || {};
    var state = 'idle';
    var stage = stageCanvas || null;
    var ctx = stage && stage.getContext ? stage.getContext('2d') : null;
    var audio = audioEl || null;
    var audioCtx = null, analyser = null, sourceNode = null, freq = null, time = null;
    var features = { bpm: 0, key: '', bass: 0, mid: 0, treble: 0, onset: 0, rms: 0 };
    var vibeId = DEFAULTS.vibe, vibeTab = DEFAULTS.tab, preset = VIBES[vibeId];
    var trim = { start: 0, end: 0 };
    var duration = 0, hook = 0;
    var raf = 0, particles = [], lastOnset = -1, lastFeatureAt = 0, burstAt = -99;
    var destroyed = false;
    var local = readLocal();

    function emit(kind, payload) {
      try { if (typeof options[kind] === 'function') options[kind](payload); } catch (e) { /* listener error is not ours */ }
    }
    function setState(s) { state = s; emit('onState', s); }
    function readLocal() {
      var o = { vibe: null, name: '' };
      try { o.vibe = JSON.parse(localStorage.getItem('swr.tiktok.lastVibe') || 'null'); } catch (e) {}
      try { o.name = localStorage.getItem('swr.tiktok.lastAudioName') || ''; } catch (e) {}
      return o;
    }
    function writeLocal() {
      try { localStorage.setItem('swr.tiktok.lastVibe', JSON.stringify({ tab: vibeTab, vibeId: vibeId })); } catch (e) {}
    }

    // ---- audio graph (created once per element; shared with the exporter) --
    function graph() {
      if (audioCtx || !audio) return audioCtx;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        audioCtx = new AC();
        sourceNode = audioCtx.createMediaElementSource(audio);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.72;
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
        freq = new Uint8Array(analyser.frequencyBinCount);
        time = new Uint8Array(analyser.fftSize);
        // Published so the export module records the same graph instead of
        // calling createMediaElementSource again (throws on a second call).
        window.SWR_TIKTOK_AUDIO = { ctx: audioCtx, source: sourceNode, analyser: analyser, element: audio };
      } catch (e) { emit('onError', e); }
      return audioCtx;
    }
    function bandMean(from, to) {
      if (!freq) return 0;
      var sum = 0, n = 0;
      for (var i = from; i < to; i++) { sum += freq[i]; n++; }
      return n ? (sum / n) / 255 : 0;
    }
    function readFeatures() {
      if (!analyser) {
        // No audio: a slow synthetic breath keeps the preview alive.
        var t = nowS();
        features.bass = 0.35 + 0.12 * Math.sin(t * 0.9);
        features.mid = 0.3 + 0.1 * Math.sin(t * 1.3 + 1);
        features.treble = 0.25 + 0.1 * Math.sin(t * 1.7 + 2);
        features.onset = 0;
        features.rms = features.bass;
        return;
      }
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(time);
      var bins = freq.length;
      features.bass = bandMean(0, Math.floor(bins * 0.08));
      features.mid = bandMean(Math.floor(bins * 0.08), Math.floor(bins * 0.35));
      features.treble = bandMean(Math.floor(bins * 0.35), Math.floor(bins * 0.8));
      var sum = 0;
      for (var i = 0; i < time.length; i += 8) { var v = (time[i] - 128) / 128; sum += v * v; }
      features.rms = Math.sqrt(sum / (time.length / 8));
      var flux = features.bass * 0.5 + features.mid * 0.3 + features.treble * 0.4;
      var rising = flux > (features._fl || 0) * 1.35 && flux > 0.25;
      features._fl = flux;
      var t2 = nowS();
      if (rising && t2 - lastOnset > 0.12) { lastOnset = t2; features.onset = 1; }
      else features.onset = Math.max(0, features.onset - 0.08);
    }

    // ---- renderer: six layers --------------------------------------------
    function motionEnvelope(t) {
      var m = preset.motion, i = preset.intensity;
      if (m === 'pulse') return i * (0.55 + 0.45 * Math.sin(t * 2.4));
      if (m === 'wave') return i * (0.45 + 0.35 * Math.sin(t * 0.9) + 0.2 * Math.sin(t * 2.1));
      return i * 0.5;                        // calm
    }
    function ensureParticles() {
      if (particles.length) return;
      for (var i = 0; i < 90; i++) {
        particles.push({ x: Math.random() * W, y: Math.random() * H, r: 1.5 + Math.random() * 3.5, v: 20 + Math.random() * 90, a: 0.15 + Math.random() * 0.5 });
      }
    }
    function render() {
      if (!ctx) return;
      var L = preset.layers, pal = preset.palette;
      var t = nowS();
      var env = motionEnvelope(t);
      var bass = features.bass * preset.intensity, mid = features.mid * preset.intensity, treb = features.treble * preset.intensity;

      // 1 · gradient ground
      var g = ctx.createLinearGradient(0, 0, W * 0.4, H);
      g.addColorStop(0, pal[2]);
      g.addColorStop(0.55, rgba(pal[0], 0.16 + 0.14 * env));
      g.addColorStop(1, pal[2]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // 2 · concentric rings, breathing with bass
      if (L.rings > 0) {
        var cx = W / 2, cy = H * 0.46;
        var rings = 5;
        for (var i = 0; i < rings; i++) {
          var rr = (140 + i * 96) * (1 + bass * 0.35 * L.rings) + Math.sin(t * 1.1 + i) * 6 * env;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(i % 2 ? pal[1] : pal[0], 0.10 + 0.30 * bass * L.rings);
          ctx.lineWidth = 3 + 10 * bass * L.rings;
          ctx.stroke();
        }
      }

      // 3 · waveform ribbon, driven by mid + the live time-domain frames
      if (L.wave > 0 && time) {
        ctx.beginPath();
        var y0 = H * 0.72;
        var amp = (60 + 260 * mid) * L.wave;
        for (var x = 0; x <= W; x += 12) {
          var idx = Math.floor((x / W) * time.length);
          var v = (time[idx] - 128) / 128;
          var y = y0 + v * amp * (0.6 + 0.4 * Math.sin(t * 1.6 + x / W * 4));
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgba(pal[0], 0.35 + 0.4 * mid);
        ctx.lineWidth = 5;
        ctx.stroke();
      }

      // 4 · treble particle field
      if (L.particles > 0) {
        ensureParticles();
        for (var p = 0; p < particles.length; p++) {
          var pt = particles[p];
          pt.y -= pt.v * (0.12 + treb * 0.9 * L.particles) * 0.016;
          if (pt.y < -10) { pt.y = H + 10; pt.x = Math.random() * W; }
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.r * (1 + treb * 0.8), 0, Math.PI * 2);
          ctx.fillStyle = rgba(pal[1], pt.a * (0.4 + treb));
          ctx.fill();
        }
      }

      // 5 · hook burst — a flash + expanding ring where the track lifts
      if (L.burst > 0 && hook > 0 && audio) {
        var at = audio.currentTime;
        if (Math.abs(at - hook) < 0.35 && nowS() - burstAt > 2) burstAt = nowS();
        var since = nowS() - burstAt;
        if (since >= 0 && since < 0.55) {
          var k = 1 - since / 0.55;
          ctx.fillStyle = rgba(pal[1], 0.5 * k * L.burst);
          ctx.fillRect(0, 0, W, H);
          ctx.beginPath();
          ctx.arc(W / 2, H * 0.46, 200 + (1 - k) * 700, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(pal[0], 0.8 * k);
          ctx.lineWidth = 14 * k;
          ctx.stroke();
        }
      }

      // 6 · watermark — always on, bottom-right, matches the free-tier promise
      ctx.globalAlpha = 0.9;
      ctx.font = '600 34px "JetBrains Mono", monospace';
      var label = 'SWR · tiktok';
      var tw = ctx.measureText(label).width;
      var pad = 18, bw = tw + pad * 2, bh = 58, bx = W - bw - 40, by = H - bh - 46;
      ctx.fillStyle = 'rgba(8,8,10,0.45)';
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(bx, by, bw, bh, 14); ctx.fill(); }
      else ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(label, bx + pad, by + 39);
      ctx.globalAlpha = 1;
    }

    function loop() {
      if (destroyed) return;
      raf = requestAnimationFrame(loop);
      readFeatures();
      render();
      var t = nowS();
      if (t - lastFeatureAt > FEATURE_MS / 1000) {
        lastFeatureAt = t;
        emit('onFeatures', { bpm: features.bpm, key: features.key, bass: features.bass, mid: features.mid, treble: features.treble, onset: features.onset, rms: features.rms });
      }
      if (audio && !audio.paused && state === 'ready') setState('previewing');
      if (audio && audio.paused && state === 'previewing') setState('ready');
    }

    // ---- public API -------------------------------------------------------
    function loadAudio(file) {
      if (!file) return Promise.reject(new Error('no file'));
      setState('loading');
      graph();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
      return file.arrayBuffer().then(function (buf) {
        var analysis = { bpm: 0, key: '', hook: 0 };
        var decoded = null;
        var AC = window.AudioContext || window.webkitAudioContext;
        var decode = (AC && audioCtx) ? audioCtx.decodeAudioData(buf.slice(0)) : Promise.resolve(null);
        return decode.then(function (b) {
          decoded = b;
          duration = b ? b.duration : 0;
          analysis = analyseBuffer(b);
          hook = analysis.hook || 0;
          features.bpm = analysis.bpm || 0;
          features.key = analysis.key || '';
          emit('onHook', hook);
          if (audio) {
            try { audio.src = URL.createObjectURL(file); } catch (e) {}
            audio.load();
          }
          trim = { start: 0, end: duration };
          try { localStorage.setItem('swr.tiktok.lastAudioName', file.name || ''); } catch (e) {}
          setState('ready');
          if (!raf) loop();
          return { duration: duration, bpm: features.bpm, key: features.key, hook: hook };
        });
      }).catch(function (err) {
        setState('idle');
        emit('onError', err);
        throw err;
      });
    }

    function pickVibe(tab, id) {
      if (id && VIBES[id]) { vibeId = id; preset = VIBES[id]; }
      if (tab) vibeTab = tab;
      writeLocal();
    }
    function setTrim(a, b) {
      trim.start = Math.max(0, a || 0);
      trim.end = Math.max(trim.start, b || 0);
      if (audio && (audio.currentTime < trim.start || audio.currentTime > trim.end)) audio.currentTime = trim.start;
    }
    function play() {
      if (!audio) return;
      if (audio.currentTime < trim.start || audio.currentTime > trim.end) audio.currentTime = trim.start;
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
      var p = audio.play();
      if (p && p.catch) p.catch(function (err) { emit('onError', err); });
      else setState('previewing');
    }
    function pause() { if (audio) audio.pause(); }
    function seek(sec) { if (audio) audio.currentTime = clamp(sec || 0, 0, duration || 0); }

    // restore last vibe choice
    if (local.vibe && local.vibe.vibeId && VIBES[local.vibe.vibeId]) {
      vibeId = local.vibe.vibeId;
      vibeTab = local.vibe.tab || vibeTab;
      preset = VIBES[vibeId];
    }
    if (audio) {
      audio.addEventListener('ended', function () { setState('ready'); });
      audio.addEventListener('play', function () { setState('previewing'); });
      audio.addEventListener('pause', function () { if (state === 'previewing') setState('ready'); });
    }
    if (ctx) loop();                      // the preview is alive before any audio

    var instance = {
      VIBES: VIBES,
      loadAudio: loadAudio,
      pickVibe: pickVibe,
      setTrim: setTrim,
      play: play,
      pause: pause,
      seek: seek,
      getState: function () {
        return {
          state: state, vibeId: vibeId, vibeTab: vibeTab, preset: preset,
          duration: duration, hook: hook, trim: { start: trim.start, end: trim.end },
          features: { bpm: features.bpm, key: features.key, bass: features.bass, mid: features.mid, treble: features.treble, onset: features.onset, rms: features.rms },
          hasAudio: !!audio, hasAnalyser: !!analyser
        };
      },
      destroy: function () {
        destroyed = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (audio) { try { audio.pause(); } catch (e) {} }
      }
    };
    return instance;
  }

  window.SWR_TIKTOK = { create: create, VIBES: VIBES, DEFAULTS: DEFAULTS };
})();
