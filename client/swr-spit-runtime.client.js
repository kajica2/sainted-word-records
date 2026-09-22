// client/swr-spit-runtime.client.js
//
// SWRSpitRuntime — page runtime for /spit (Spit Live, PR 2 of 4).
// Owns the page state machine, beat loading + analysis, mic/camera
// integration, and the reactive canvas driver. FX (Task 3) is a
// separate module; triggerFx() returns a guarded failure if it's
// missing.
//
// Public API (window.SWR_SPIT):
//   create(stageCanvas, options)              — factory; returns SpitRuntime
//   STATES                                    — { LOADING, READY, RECORDING, SAVED }
//   ANALYZER_FFT_SIZE / CANVAS_DEFAULT_W/H    — test hooks
//
// SpitRuntime instance (10 methods): loadBeat, playBeat, pauseBeat,
// seekBeat, toggleMic, triggerFx, startRecording, stopRecording,
// getState, destroy.
//
// State: LOADING → READY → RECORDING → SAVED → READY.

(function () {
  'use strict';
  if (window.SWR_SPIT) return;

  // ---- Constants ---------------------------------------------------------
  var STATES = { LOADING: 'loading', READY: 'ready', RECORDING: 'recording', SAVED: 'saved' };
  var ANALYZER_FFT_SIZE = 1024;
  var CANVAS_DEFAULT_W = 1080;
  var CANVAS_DEFAULT_H = 1920;
  var BEAT_DECAY = 0.92;
  var BEAT_THRESHOLD = 0.012;
  var VOCAL_AMPLITUDE_SCALE = 0.012;
  var BEAT_PULSE_GAIN = 80;
  var FX_HOLD_MS = 700;
  var HIDDEN_STR = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
  var CLS_ACTIVE = 'is-active';
  var CLS_HIDDEN = 'is-hidden';

  // ---- Helpers -----------------------------------------------------------
  function $(id) { if (typeof document === 'undefined') return null; try { return document.getElementById(id); } catch (_) { return null; } }
  function _warn(m, e) { if (typeof console !== 'undefined' && console && console.warn) console.warn(m, e || ''); }
  function _isAudio(f) { return !!(f && typeof f === 'object' && f.type && String(f.type).toLowerCase().indexOf('audio/') === 0); }
  function _fmtDur(s) { if (!isFinite(s) || s < 0) return '—'; var m = Math.floor(s / 60), ss = Math.floor(s - m * 60); return m + ':' + (ss < 10 ? '0' : '') + ss; }
  function _fmtKey(k, sc) { return k ? String(k).toUpperCase() + (sc === 'minor' ? 'm' : '') : '—'; }
  function _rm(el) { if (el && el.parentNode) { try { el.parentNode.removeChild(el); } catch (_) {} } }
  function _mkCtx() {
    if (typeof window === 'undefined') return null;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { return new C(); } catch (_) { try { return new C(); } catch (e) { _warn('swr-spit: AudioContext failed', e); return null; } }
  }

  // ---- Constructor -------------------------------------------------------
  function SpitRuntime(stageCanvas, options) {
    options = options || {};
    this._stageCanvas = stageCanvas || null;
    this._options = {
      beatSelector: options.beatSelector || null, micSelector: options.micSelector || null,
      onStateChange: typeof options.onStateChange === 'function' ? options.onStateChange : null,
      onBeatLoad: typeof options.onBeatLoad === 'function' ? options.onBeatLoad : null,
      onFxTrigger: typeof options.onFxTrigger === 'function' ? options.onFxTrigger : null,
      onError: typeof options.onError === 'function' ? options.onError : null,
    };
    this._state = STATES.LOADING; this._lastError = null;
    this._micOn = false; this._cameraOn = false; this._recording = false;
    this._fxQueue = []; this._beatInfo = null; this._destroyed = false;
    this._els = null; this._audioEl = null; this._fileInput = null; this._currentBlobUrl = null;
    this._beatAudioContext = null; this._beatSourceNode = null;
    this._beatAnalyser = null; this._beatFreqData = null;
    this._lastBassEnergy = 0; this._beatPulse = 0; this._vocalAmp = 0;
    this._mediaInput = null; this._cameraMount = null;
    this._micMeterMount = null; this._meter = null;
    this._rafId = null; this._handlers = [];
    this._lastSavedBlob = null; this._micGainValue = 100; this._vocalEnhance = false;
  }

  // ---- DOM wiring --------------------------------------------------------
  SpitRuntime.prototype._on = function (el, type, fn, cap) {
    if (!el || typeof el.addEventListener !== 'function') return;
    var c = !!cap;
    try { el.addEventListener(type, fn, c); } catch (e) { return; }
    this._handlers.push({ el: el, type: type, fn: fn, capture: c });
  };
  SpitRuntime.prototype._unwire = function () {
    for (var i = 0; i < this._handlers.length; i++) {
      var h = this._handlers[i];
      try { h.el.removeEventListener(h.type, h.fn, h.capture); } catch (_) {}
    }
    this._handlers = [];
  };
  SpitRuntime.prototype._initDOMElements = function () {
    var e = function (id) { return $(id); };
    this._els = {
      beatStatus: e('beat-status'), micStatus: e('mic-status'), recStatus: e('rec-status'),
      btnLoadBeat: e('btn-load-beat'), btnMicCheck: e('btn-mic-check'),
      btnRec: e('btn-rec'), btnRecTransport: e('btn-rec-transport'),
      beatDrop: e('beat-drop'), beatLoaded: e('beat-loaded'),
      beatWaveformCanvas: e('beat-waveform-canvas'),
      beatBpm: e('beat-bpm'), beatKey: e('beat-key'), beatDuration: e('beat-duration'),
      btnBeatPrev: e('btn-beat-prev'), btnBeatPlay: e('btn-beat-play'), btnBeatNext: e('btn-beat-next'),
      micSource: e('mic-source'), micGain: e('mic-gain'),
      micMonitor: e('mic-monitor'), micVocalEnhance: e('mic-vocal-enhance'),
      canvas: e('spit-canvas'), layerIndicators: e('layer-indicators'),
      lyricOverlay: e('lyric-overlay'), punchFx: e('punch-fx'),
      spitPrev: e('spit-prev'), spitBack: e('spit-back'), spitPlay: e('spit-play'),
      spitForward: e('spit-forward'), spitNext: e('spit-next'),
      spitTime: e('spit-time'), spitSave: e('spit-save'),
    };
    if (!this._stageCanvas && this._els.canvas) this._stageCanvas = this._els.canvas;
  };

  // ---- MediaInput + Camera + Mic wiring ---------------------------------
  SpitRuntime.prototype._initMediaInput = function () {
    if (!window.SWR_MEDIA_INPUT || typeof window.SWR_MEDIA_INPUT.create !== 'function') {
      _warn('swr-spit: SWR_MEDIA_INPUT missing'); this._emitError('MediaInputMissing', 'window.SWR_MEDIA_INPUT missing'); return null;
    }
    this._mediaInput = window.SWR_MEDIA_INPUT.create({});
    return this._mediaInput;
  };
  SpitRuntime.prototype._initCameraPreview = function () {
    if (!window.SWR_CAMERA_PREVIEW || typeof window.SWR_CAMERA_PREVIEW.mount !== 'function' || !this._mediaInput) return null;
    var target = $('spit-camera-overlay');
    if (!target) {
      target = document.createElement('div');
      target.id = 'spit-camera-overlay';
      target.style.cssText = 'position:absolute;top:12px;right:12px;width:120px;height:160px;z-index:3;border-radius:8px;overflow:hidden;opacity:0.9;pointer-events:none;';
      var frame = this._els.canvas && this._els.canvas.parentNode;
      if (frame) frame.appendChild(target);
    }
    try { this._cameraMount = window.SWR_CAMERA_PREVIEW.mount(target, {
      mediaInput: this._mediaInput, size: 'small', autoStart: false, showControls: false, showFaceGuide: false, mirrored: true,
    }); } catch (e) { _warn('swr-spit: camera mount failed', e); return null; }
    return this._cameraMount;
  };
  SpitRuntime.prototype._initMicMeter = function () {
    if (!window.SWR_MIC_METER || typeof window.SWR_MIC_METER.mount !== 'function' || !this._mediaInput) return null;
    var target = $('spit-mic-meter');
    if (!target) {
      target = document.createElement('div'); target.id = 'spit-mic-meter';
      var panel = $('mic-source') && $('mic-source').closest('.spit-panel');
      if (panel) panel.appendChild(target);
      else if (this._els.btnMicCheck && this._els.btnMicCheck.parentNode) this._els.btnMicCheck.parentNode.appendChild(target);
    }
    if (!target) return null;
    try {
      this._micMeterMount = window.SWR_MIC_METER.mount(target, { mediaInput: this._mediaInput, autoStart: false });
      this._meter = this._micMeterMount && this._micMeterMount.meter ? this._micMeterMount.meter : null;
    } catch (e) { _warn('swr-spit: mic meter mount failed', e); return null; }
    return this._micMeterMount;
  };

  // ---- Reactive canvas --------------------------------------------------
  SpitRuntime.prototype._initReactiveCanvas = function () {
    if (!this._stageCanvas || typeof this._stageCanvas.getContext !== 'function') return;
    if (!this._stageCanvas.width)  this._stageCanvas.width  = CANVAS_DEFAULT_W;
    if (!this._stageCanvas.height) this._stageCanvas.height = CANVAS_DEFAULT_H;
    var ctx = this._stageCanvas.getContext('2d'); if (!ctx) return;
    var self = this, last = 0;
    function loop(now) {
      if (self._destroyed) return;
      var t = last ? (now - last) : 16; last = now;
      try { self._tick(ctx, now, t); } catch (e) { _warn('swr-spit: tick failed', e); }
      if (!self._destroyed && typeof requestAnimationFrame === 'function') self._rafId = requestAnimationFrame(loop);
    }
    self._rafId = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(loop) : null;
  };
  SpitRuntime.prototype._tick = function (ctx, now) {
    var bp = this._computeBeatPulse(), va = this._computeVocalAmp();
    this._drawBackground(ctx, bp, va, now);
    this._drawLayerIndicators(bp > 0.4, va > 0.4);
    this._updateTimeReadout();
  };
  SpitRuntime.prototype._computeBeatPulse = function () {
    var an = this._beatAnalyser;
    if (!an || !this._beatFreqData) { this._beatPulse *= BEAT_DECAY; if (this._beatPulse < 0.005) this._beatPulse = 0; return this._beatPulse; }
    try {
      an.getByteFrequencyData(this._beatFreqData);
      var sum = 0, n = 0;
      for (var i = 1; i <= 8 && i < this._beatFreqData.length; i++) { sum += this._beatFreqData[i]; n++; }
      var bass = n > 0 ? (sum / n) / 255 : 0;
      var diff = bass - this._lastBassEnergy; this._lastBassEnergy = bass;
      if (diff > BEAT_THRESHOLD) this._beatPulse = 1.0;
      else { this._beatPulse *= BEAT_DECAY; if (this._beatPulse < 0.005) this._beatPulse = 0; }
    } catch (_) { this._beatPulse *= BEAT_DECAY; }
    return this._beatPulse;
  };
  SpitRuntime.prototype._computeVocalAmp = function () {
    if (!this._mediaInput || typeof this._mediaInput.getAudioData !== 'function') return 0;
    var d = this._mediaInput.getAudioData(); if (!d) return 0;
    var e = ((d.bass || 0) + (d.mid || 0) + (d.high || 0)) / 3;
    var a = (e / 255) * VOCAL_AMPLITUDE_SCALE * 100;
    if (a > 1) a = 1; if (a < 0) a = 0;
    this._vocalAmp = this._vocalAmp * 0.7 + a * 0.3;
    return this._vocalAmp;
  };
  SpitRuntime.prototype._drawBackground = function (ctx, beatPulse, vocalAmp, t) {
    var w = ctx.canvas.width, h = ctx.canvas.height;
    var grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#0a0d12'); grd.addColorStop(1, '#1a1e28');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    for (var i = 0; i < 3; i++) {
      var radius = (h * 0.3) * (0.5 + i * 0.25) + beatPulse * BEAT_PULSE_GAIN * (1 + i * 0.3);
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 107, 0, ' + (0.15 - i * 0.04) + ')';
      ctx.lineWidth = 2 + beatPulse * 4;
      ctx.stroke();
    }
    ctx.beginPath();
    var yc = h / 2;
    for (var x = 0; x < w; x += 4) {
      var phase = (x / w) * 8 + t * 0.001;
      var y = yc + Math.sin(phase) * (vocalAmp * 80) * Math.sin((x / w) * Math.PI);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255, 0, 80, 0.7)'; ctx.lineWidth = 3; ctx.stroke();
  };
  SpitRuntime.prototype._drawLayerIndicators = function (beatActive, vocalActive) {
    if (!this._els || !this._els.layerIndicators) return;
    var badges = this._els.layerIndicators.querySelectorAll('[data-layer]');
    for (var i = 0; i < badges.length; i++) {
      var b = badges[i], layer = b.getAttribute('data-layer');
      var show = (layer === 'beat' && beatActive) || (layer === 'vocal' && vocalActive);
      if (b.classList) b.classList.toggle(CLS_HIDDEN, !show);
    }
  };
  SpitRuntime.prototype._updateTimeReadout = function () {
    if (!this._els || !this._els.spitTime || !this._audioEl) return;
    var cur = isFinite(this._audioEl.currentTime) ? this._audioEl.currentTime : 0;
    var dur = isFinite(this._audioEl.duration) ? this._audioEl.duration : 0;
    this._els.spitTime.textContent = _fmtDur(cur) + ' / ' + _fmtDur(dur);
  };

  // ---- Programmatic nodes ------------------------------------------------
  SpitRuntime.prototype._createProgrammaticNodes = function () {
    if (typeof document === 'undefined') return;
    var audio = document.createElement('audio');
    audio.id = 'spit-runtime-audio'; audio.preload = 'auto';
    audio.style.cssText = HIDDEN_STR; audio.setAttribute('aria-hidden', 'true');
    if (document.body) document.body.appendChild(audio);
    var self = this;
    var setBtn = function (playing) {
      if (!self._els) return;
      var c = playing ? '⏸' : '▶';
      if (self._els.btnBeatPlay) self._els.btnBeatPlay.textContent = c;
      if (self._els.spitPlay) self._els.spitPlay.textContent = c;
    };
    audio.addEventListener('play', function () { setBtn(true); });
    audio.addEventListener('pause', function () { setBtn(false); });
    audio.addEventListener('ended', function () { setBtn(false); });
    this._audioEl = audio;

    var input = document.createElement('input');
    input.type = 'file'; input.id = 'spit-runtime-file'; input.accept = 'audio/*';
    input.style.cssText = HIDDEN_STR; input.setAttribute('aria-hidden', 'true');
    if (document.body) document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (f) self.loadBeat(f).catch(function (e) { _warn('swr-spit: loadBeat failed', e); });
      try { input.value = ''; } catch (_) {}
    });
    this._fileInput = input;
  };

  // ---- UI handlers ------------------------------------------------------
  SpitRuntime.prototype._wireUIHandlers = function () {
    var els = this._els, self = this;
    var fileClick = function () { if (self._fileInput) self._fileInput.click(); };
    if (els.btnLoadBeat) this._on(els.btnLoadBeat, 'click', fileClick);
    if (els.beatDrop) {
      this._on(els.beatDrop, 'click', fileClick);
      this._on(els.beatDrop, 'dragover', function (e) { if (e && e.preventDefault) e.preventDefault(); if (els.beatDrop.classList) els.beatDrop.classList.add('is-drag-over'); });
      this._on(els.beatDrop, 'dragleave', function () { if (els.beatDrop.classList) els.beatDrop.classList.remove('is-drag-over'); });
      this._on(els.beatDrop, 'drop', function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (els.beatDrop.classList) els.beatDrop.classList.remove('is-drag-over');
        var f = e && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) self.loadBeat(f).catch(function (err) { _warn('swr-spit: drop loadBeat failed', err); });
      });
    }
    var togglePlay = function () { if (!self._audioEl) return; if (self._audioEl.paused) self.playBeat(); else self.pauseBeat(); };
    if (els.btnBeatPlay) this._on(els.btnBeatPlay, 'click', togglePlay);
    if (els.spitPlay) this._on(els.spitPlay, 'click', togglePlay);
    var seekCur = function (d) { return function () { self.seekBeat((self._audioEl ? self._audioEl.currentTime : 0) + d); }; };
    var toEnd = function () { if (self._audioEl && isFinite(self._audioEl.duration)) self.seekBeat(self._audioEl.duration - 0.01); else self.seekBeat(5); };
    if (els.btnBeatPrev) this._on(els.btnBeatPrev, 'click', function () { self.seekBeat(0); });
    if (els.btnBeatNext) this._on(els.btnBeatNext, 'click', toEnd);
    if (els.spitBack) this._on(els.spitBack, 'click', seekCur(-5));
    if (els.spitForward) this._on(els.spitForward, 'click', seekCur(5));
    if (els.spitPrev) this._on(els.spitPrev, 'click', function () { self.seekBeat(0); });
    if (els.spitNext) this._on(els.spitNext, 'click', toEnd);

    if (els.btnMicCheck) this._on(els.btnMicCheck, 'click', function () { self.toggleMic(); });
    if (els.micSource) this._on(els.micSource, 'change', function () {
      var did = els.micSource.value; if (!self._mediaInput) return;
      self._mediaInput.stopMic(); self._micOn = false; self._updateMicStatus();
      self._mediaInput.startMic(did || undefined).then(function (r) {
        if (r && r.success) { self._micOn = true; self._updateMicStatus(); if (self._meter) self._meter.start(); }
        else self._emitError((r && r.error) || 'MicStartFailed', (r && r.message) || 'mic start failed');
      }).catch(function (e) { self._emitError('MicStartException', String(e && e.message || e)); });
    });
    if (els.micGain) this._on(els.micGain, 'input', function () { self._micGainValue = parseFloat(els.micGain.value) || 100; });
    if (els.micMonitor) this._on(els.micMonitor, 'change', function () {
      if (!self._mediaInput) return;
      if (els.micMonitor.checked && typeof self._mediaInput.startMonitor === 'function') {
        self._mediaInput.startMonitor().then(function () {
          if (self._mediaInput._audio && self._mediaInput._audio.stream && self._mediaInput._audioContext && self._mediaInput._monitorGain) {
            try { var src = self._mediaInput._audioContext.createMediaStreamSource(self._mediaInput._audio.stream); src.connect(self._mediaInput._monitorGain); } catch (_) {}
          }
        }).catch(function (e) { _warn('swr-spit: monitor failed', e); });
      } else if (self._mediaInput && self._mediaInput._monitorGain) {
        try { self._mediaInput._monitorGain.disconnect(); } catch (_) {} self._mediaInput._monitorGain = null;
      }
    });
    if (els.micVocalEnhance) this._on(els.micVocalEnhance, 'change', function () { self._vocalEnhance = !!els.micVocalEnhance.checked; });
    if (els.btnRec) this._on(els.btnRec, 'click', function () { self._toggleRecording(); });
    if (els.btnRecTransport) this._on(els.btnRecTransport, 'click', function () { self._toggleRecording(); });
    if (els.spitSave) this._on(els.spitSave, 'click', function () {
      if (self._lastSavedBlob && self._lastSavedBlob.url) {
        var a = document.createElement('a'); a.href = self._lastSavedBlob.url; a.download = 'spit-' + Date.now() + '.webm';
        if (document.body) document.body.appendChild(a); a.click(); _rm(a);
      } else self._emitError('NoRecording', 'no recording available to save');
    });

    if (typeof document !== 'undefined') {
      var fxBtns = document.querySelectorAll('.spit-fx-btn');
      for (var i = 0; i < fxBtns.length; i++) (function (btn) {
        self._on(btn, 'click', function () {
          var name = btn.getAttribute('data-fx') || 'punch';
          var r = self.triggerFx(name);
          if (r && r.success && btn.classList) {
            btn.classList.add(CLS_ACTIVE);
            setTimeout(function () { if (btn.classList) btn.classList.remove(CLS_ACTIVE); }, FX_HOLD_MS);
          }
        });
      })(fxBtns[i]);
    }
  };

  // ---- 1. loadBeat ------------------------------------------------------
  SpitRuntime.prototype.loadBeat = function (file) {
    var self = this;
    if (this._destroyed) return Promise.resolve({ success: false, error: 'destroyed' });
    if (!file || typeof file !== 'object') return Promise.resolve({ success: false, error: 'no_file' });
    if (!_isAudio(file)) return Promise.resolve({ success: false, error: 'unsupported_type', message: 'expected audio/* file' });
    this._setState(STATES.LOADING);

    var prevUrl = this._currentBlobUrl, blobUrl = '';
    try { blobUrl = URL.createObjectURL(file); }
    catch (e) { return Promise.resolve({ success: false, error: 'blob_url_failed' }); }
    this._currentBlobUrl = blobUrl;
    if (prevUrl) { try { URL.revokeObjectURL(prevUrl); } catch (_) {} }

    if (this._audioEl) {
      try { this._audioEl.pause(); this._audioEl.src = blobUrl; this._audioEl.load(); } catch (_) {}
    }

    return new Promise(function (resolve) {
      if (typeof file.arrayBuffer !== 'function') { self._setState(STATES.READY); resolve({ success: false, error: 'no_arrayBuffer' }); return; }
      file.arrayBuffer().then(function (ab) {
        var Ctor = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
        if (!Ctor) { self._setState(STATES.READY); resolve({ success: false, error: 'no_AudioContext' }); return; }
        var ctx = _mkCtx();
        if (!ctx) { self._setState(STATES.READY); resolve({ success: false, error: 'AudioContextConstructionFailed' }); return; }
        var onOK = function (audioBuffer) {
          try { ctx.close(); } catch (_) {}
          if (!audioBuffer) { self._setState(STATES.READY); resolve({ success: false, error: 'decode_failed' }); return; }
          if (!window.AudioAnalysisV2 || typeof window.AudioAnalysisV2.analyzeBuffer !== 'function') {
            self._beatInfo = { bpm: 0, key: '', scale: '', duration: audioBuffer.duration || 0, fileName: file.name || 'beat', blobUrl: blobUrl, audioBuffer: audioBuffer };
            self._renderBeatInfo(); self._setState(STATES.READY);
            resolve({ success: false, error: 'analysis_unavailable', duration: audioBuffer.duration || 0 });
            return;
          }
          var analysis = {};
          try { analysis = window.AudioAnalysisV2.analyzeBuffer(audioBuffer) || {}; }
          catch (e) { self._setState(STATES.READY); resolve({ success: false, error: 'analysis_threw', message: String(e && e.message || e) }); return; }
          self._beatInfo = {
            bpm: typeof analysis.bpm === 'number' ? analysis.bpm : 0,
            key: analysis.key || '', scale: analysis.scale || '',
            duration: typeof analysis.duration === 'number' ? analysis.duration : (audioBuffer.duration || 0),
            fileName: file.name || 'beat', blobUrl: blobUrl, audioBuffer: audioBuffer,
          };
          self._renderBeatInfo(); self._setState(STATES.READY); self._emitBeatLoad(self._beatInfo);
          resolve({ success: true, bpm: self._beatInfo.bpm, key: self._beatInfo.key, scale: self._beatInfo.scale, duration: self._beatInfo.duration });
        };
        var onErr = function (err) {
          try { ctx.close(); } catch (_) {}
          self._setState(STATES.READY);
          resolve({ success: false, error: (err && err.name) || 'decode_failed' });
        };
        try { ctx.decodeAudioData(ab.slice(0), onOK, onErr); }
        catch (e) { try { ctx.close(); } catch (_) {} self._setState(STATES.READY); resolve({ success: false, error: 'decode_threw', message: String(e && e.message || e) }); }
      }).catch(function (err) {
        self._setState(STATES.READY);
        resolve({ success: false, error: 'read_failed', message: String(err && err.message || err) });
      });
    });
  };
  SpitRuntime.prototype._renderBeatInfo = function () {
    var els = this._els, info = this._beatInfo; if (!els || !info) return;
    if (els.beatBpm) els.beatBpm.textContent = info.bpm ? Math.round(info.bpm) : '—';
    if (els.beatKey) els.beatKey.textContent = _fmtKey(info.key, info.scale);
    if (els.beatDuration) els.beatDuration.textContent = _fmtDur(info.duration);
    if (els.beatLoaded && els.beatLoaded.classList) els.beatLoaded.classList.remove(CLS_HIDDEN);
    if (els.beatStatus) {
      els.beatStatus.textContent = info.fileName ? 'Beat Loaded' : 'No Beat';
      if (els.beatStatus.classList) els.beatStatus.classList.add(CLS_ACTIVE);
    }
  };

  // ---- 2-4. playBeat / pauseBeat / seekBeat ----------------------------
  SpitRuntime.prototype.playBeat = function () {
    if (this._destroyed || !this._audioEl || !this._audioEl.src) return false;
    this._ensureBeatAnalyser();
    var p = this._audioEl.play();
    if (p && typeof p.catch === 'function') p.catch(function (e) { _warn('swr-spit: play() rejected', e); });
    if (this._state === STATES.LOADING) this._setState(STATES.READY);
    return true;
  };
  SpitRuntime.prototype.pauseBeat = function () {
    if (this._destroyed || !this._audioEl) return false;
    try { this._audioEl.pause(); } catch (_) {} return true;
  };
  SpitRuntime.prototype.seekBeat = function (seconds) {
    if (this._destroyed || !this._audioEl) return false;
    var t = Math.max(0, Number(seconds) || 0);
    try { this._audioEl.currentTime = t; return true; } catch (e) { return false; }
  };

  // ---- 5. toggleMic -----------------------------------------------------
  SpitRuntime.prototype.toggleMic = function () {
    if (this._destroyed) return { success: false, enabled: false, error: 'destroyed' };
    if (!this._mediaInput) return { success: false, enabled: false, error: 'no_mediaInput' };
    if (this._micOn) {
      this._mediaInput.stopMic(); this._micOn = false;
      if (this._meter) this._meter.stop();
      this._updateMicStatus();
      return { success: true, enabled: false };
    }
    var self = this;
    return this._mediaInput.startMic().then(function (r) {
      if (r && r.success) {
        self._micOn = true; self._updateMicStatus();
        if (self._meter) { self._meter.setAnalyser(self._mediaInput._analyser || null); self._meter.start(); }
        return { success: true, enabled: true };
      }
      self._emitError((r && r.error) || 'MicStartFailed', (r && r.message) || 'mic start failed');
      return { success: false, enabled: false, error: (r && r.error) || 'MicStartFailed' };
    }).catch(function (e) {
      self._emitError('MicStartException', String(e && e.message || e));
      return { success: false, enabled: false, error: 'exception', message: String(e && e.message || e) };
    });
  };
  SpitRuntime.prototype._updateMicStatus = function () {
    if (!this._els || !this._els.micStatus) return;
    if (this._micOn) {
      this._els.micStatus.textContent = 'Mic On';
      if (this._els.micStatus.classList) this._els.micStatus.classList.add(CLS_ACTIVE);
    } else {
      this._els.micStatus.textContent = 'Mic Off';
      if (this._els.micStatus.classList) this._els.micStatus.classList.remove(CLS_ACTIVE);
    }
  };

  // ---- 6. triggerFx -----------------------------------------------------
  SpitRuntime.prototype.triggerFx = function (name) {
    if (this._destroyed) return { success: false, fx: name, error: 'destroyed' };
    if (!window.SWR_SPIT_FX || typeof window.SWR_SPIT_FX.trigger !== 'function') {
      _warn('swr-spit: SWR_SPIT_FX not loaded — triggerFx(' + name + ') returning failure');
      return { success: false, fx: name, error: 'fx_not_loaded' };
    }
    var ctx = this._stageCanvas && typeof this._stageCanvas.getContext === 'function' ? this._stageCanvas.getContext('2d') : null;
    if (!ctx) return { success: false, fx: name, error: 'no_canvas_context' };
    var res = {};
    try { res = window.SWR_SPIT_FX.trigger(name, ctx) || {}; }
    catch (e) { return { success: false, fx: name, error: 'fx_threw', message: String(e && e.message || e) }; }
    this._fxQueue.push({ name: name, t: Date.now() });
    if (this._fxQueue.length > 32) this._fxQueue = this._fxQueue.slice(-32);
    if (this._options.onFxTrigger) { try { this._options.onFxTrigger({ name: name, result: res }); } catch (_) {} }
    return { success: true, fx: name };
  };

  // ---- 7-8. startRecording / stopRecording ------------------------------
  SpitRuntime.prototype.startRecording = function () {
    var self = this;
    if (this._destroyed) return Promise.resolve({ success: false, error: 'destroyed' });
    if (this._recording) return Promise.resolve({ success: false, error: 'already_recording' });
    if (!this._mediaInput || typeof this._mediaInput.startRecording !== 'function') return Promise.resolve({ success: false, error: 'no_mediaInput' });
    var beatDestination = null;
    if (this._audioEl && typeof this._audioEl.captureStream === 'function') {
      try { beatDestination = { stream: this._audioEl.captureStream() }; } catch (e) { _warn('swr-spit: audio.captureStream failed', e); }
    }
    var r = this._mediaInput.startRecording(this._stageCanvas, { canvasFps: 30, timeslice: 100, beatDestination: beatDestination });
    return Promise.resolve(r).then(function (res) {
      if (res && res.success) {
        self._recording = true; self._setState(STATES.RECORDING);
        if (self._els && self._els.recStatus && self._els.recStatus.classList) self._els.recStatus.classList.remove(CLS_HIDDEN);
        return { success: true, state: res.state, mimeType: res.mimeType };
      }
      self._emitError((res && res.error) || 'RecordingStartFailed', (res && res.message) || 'recording start failed');
      return { success: false, error: (res && res.error) || 'RecordingStartFailed' };
    });
  };
  SpitRuntime.prototype.stopRecording = function () {
    var self = this;
    if (this._destroyed) return Promise.resolve({ success: false, error: 'destroyed' });
    if (!this._mediaInput || typeof this._mediaInput.stopRecording !== 'function') return Promise.resolve({ success: false, error: 'no_mediaInput' });
    return Promise.resolve(this._mediaInput.stopRecording()).then(function (out) {
      self._recording = false; self._setState(STATES.SAVED);
      if (!out || !out.blob) {
        self._setState(STATES.READY);
        if (self._els && self._els.recStatus && self._els.recStatus.classList) self._els.recStatus.classList.add(CLS_HIDDEN);
        return { success: false, error: 'no_recording' };
      }
      self._lastSavedBlob = out;
      try {
        var a = document.createElement('a'); a.href = out.url; a.download = 'spit-' + Date.now() + '.webm';
        if (document.body) document.body.appendChild(a); a.click(); _rm(a);
      } catch (e) { _warn('swr-spit: download click failed', e); }
      setTimeout(function () {
        if (self._destroyed) return;
        self._setState(STATES.READY);
        if (self._els && self._els.recStatus && self._els.recStatus.classList) self._els.recStatus.classList.add(CLS_HIDDEN);
      }, 50);
      return { success: true, blob: out.blob, url: out.url, size: out.size, duration: out.duration };
    });
  };
  SpitRuntime.prototype._toggleRecording = function () {
    if (this._destroyed) return;
    if (this._recording) this.stopRecording().catch(function (e) { _warn('swr-spit: stopRecording failed', e); });
    else this.startRecording().catch(function (e) { _warn('swr-spit: startRecording failed', e); });
  };

  // ---- 9. getState ------------------------------------------------------
  SpitRuntime.prototype.getState = function () {
    return {
      state: this._state,
      hasBeat: !!this._beatInfo,
      beatInfo: this._beatInfo ? {
        bpm: this._beatInfo.bpm, key: this._beatInfo.key, scale: this._beatInfo.scale,
        duration: this._beatInfo.duration, fileName: this._beatInfo.fileName,
      } : null,
      micOn: !!this._micOn,
      cameraOn: !!(this._cameraMount && this._mediaInput && this._mediaInput._video && this._mediaInput._video.enabled),
      recording: !!this._recording, fxQueue: this._fxQueue.slice(), lastError: this._lastError,
    };
  };

  // ---- 10. destroy ------------------------------------------------------
  SpitRuntime.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._rafId != null && typeof cancelAnimationFrame === 'function') { try { cancelAnimationFrame(this._rafId); } catch (_) {} }
    this._rafId = null;
    if (this._mediaInput) { try { this._mediaInput.stopMic(); } catch (_) {} try { this._mediaInput.stopCamera(); } catch (_) {} }
    if (this._meter) { try { this._meter.stop(); } catch (_) {} }
    if (this._beatSourceNode) { try { this._beatSourceNode.disconnect(); } catch (_) {} }
    if (this._beatAnalyser) { try { this._beatAnalyser.disconnect(); } catch (_) {} }
    if (this._beatAudioContext) { try { this._beatAudioContext.close(); } catch (_) {} }
    this._beatSourceNode = null; this._beatAnalyser = null; this._beatAudioContext = null; this._beatFreqData = null;
    if (this._audioEl) { try { this._audioEl.pause(); this._audioEl.removeAttribute('src'); this._audioEl.load(); } catch (_) {} _rm(this._audioEl); }
    this._audioEl = null;
    if (this._currentBlobUrl) { try { URL.revokeObjectURL(this._currentBlobUrl); } catch (_) {} } this._currentBlobUrl = null;
    if (this._fileInput) _rm(this._fileInput); this._fileInput = null;
    this._unwire();
    if (this._mediaInput && typeof this._mediaInput.destroy === 'function') { try { this._mediaInput.destroy(); } catch (_) {} }
    this._mediaInput = null; this._cameraMount = null; this._micMeterMount = null; this._meter = null;
    this._setState(STATES.LOADING);
  };

  // ---- Internal helpers --------------------------------------------------
  SpitRuntime.prototype._setState = function (n) {
    if (this._destroyed || this._state === n) return;
    var prev = this._state; this._state = n;
    if (this._options.onStateChange) { try { this._options.onStateChange(prev, n); } catch (e) { _warn('swr-spit: onStateChange threw', e); } }
  };
  SpitRuntime.prototype._emitError = function (code, message) {
    this._lastError = { code: code, message: message, t: Date.now() };
    if (this._options.onError) { try { this._options.onError(this._lastError); } catch (_) {} }
    else _warn('swr-spit: ' + code + ' — ' + message);
  };
  SpitRuntime.prototype._emitBeatLoad = function (info) {
    if (this._options.onBeatLoad) { try { this._options.onBeatLoad(info); } catch (e) { _warn('swr-spit: onBeatLoad threw', e); } }
  };
  SpitRuntime.prototype._ensureBeatAnalyser = function () {
    if (this._beatAnalyser || !this._audioEl) return;
    var ctx = _mkCtx(); if (!ctx) return;
    this._beatAudioContext = ctx;
    try { this._beatSourceNode = ctx.createMediaElementSource(this._audioEl); }
    catch (e) { _warn('swr-spit: createMediaElementSource failed', e); return; }
    try {
      this._beatAnalyser = ctx.createAnalyser();
      this._beatAnalyser.fftSize = ANALYZER_FFT_SIZE;
      this._beatAnalyser.smoothingTimeConstant = 0.6;
      this._beatSourceNode.connect(this._beatAnalyser);
      this._beatFreqData = new Uint8Array(this._beatAnalyser.frequencyBinCount);
    } catch (e) { _warn('swr-spit: beat analyser setup failed', e); }
  };

  // ---- Boot + factory ----------------------------------------------------
  SpitRuntime.prototype._boot = function () {
    if (this._destroyed) return;
    this._initDOMElements();
    this._createProgrammaticNodes();
    this._initMediaInput();
    this._initCameraPreview();
    this._initMicMeter();
    this._initReactiveCanvas();
    this._wireUIHandlers();
    this._setState(STATES.READY);
  };
  function create(stageCanvas, options) {
    var rt = new SpitRuntime(stageCanvas, options || {});
    try { rt._boot(); } catch (e) { _warn('swr-spit: boot failed', e); rt._emitError('BootFailed', String(e && e.message || e)); }
    return rt;
  }
  window.SWR_SPIT = {
    create: create, STATES: STATES,
    ANALYZER_FFT_SIZE: ANALYZER_FFT_SIZE,
    CANVAS_DEFAULT_W: CANVAS_DEFAULT_W, CANVAS_DEFAULT_H: CANVAS_DEFAULT_H,
  };
})();
