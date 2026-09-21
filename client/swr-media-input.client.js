// client/swr-media-input.client.js
//
// SWRMediaInput — unified camera + mic primitive. Browser-native, zero
// deps. Owns its own state, localStorage persistence, MediaRecorder
// lifecycle, and AnalyserNode graph. Foundation for Spit Live (PR 2)
// and TikTok Studio (PR 3) — both will load this module explicitly.
//
// Public API (window.SWR_MEDIA_INPUT):
//   create(options)              — factory; returns a fresh SWRMediaInput
//   KEY_LAST_DEVICES             — localStorage key (test hook)
//   RECORDING_MIME_PREFERENCE    — codec preference list (test hook)
//   DEFAULT_VIDEO_RESOLUTION     — { width: 1280, height: 720 } (test hook)
//   DEFAULT_VIDEO_FRAMERATE      — 30 (test hook)
//   DEFAULT_AUDIO_SAMPLE_RATE    — 48000 (test hook)
//   FFT_SIZE                     — 2048 (test hook)
//   SMOOTHING_TIME_CONSTANT      — 0.8 (test hook)
//   TRANSIENT_THRESHOLD          — 30 (test hook)
//   MONITOR_GAIN                 — 0.7 (test hook)
//
// SWRMediaInput instance:
//   startCamera(preferredDevice?)    → { success, stream?, resolution?, deviceInfo?, error?, message? }
//   stopCamera()
//   switchCamera()                    → wraps through video inputs
//   startMic(preferredDevice?)       → { success, stream?, analyser?, deviceInfo?, error?, message? }
//   stopMic()
//   setupAudioAnalysis()             → returns AnalyserNode
//   getAudioData()                    → { frequency, time, bass, lowMid, mid, high, presence, energy, voiceFundamental, transient } | null
//   startMonitor()                    → returns GainNode (caller connects sources to it)
//   startRecording(canvas?, options) → { success, state, mimeType } | { success:false, error:'no_streams' }
//   stopRecording()                   → Promise<{ blob, url, size, duration } | null>
//   getDevices(kind?)                 → MediaDeviceInfo[]
//   getDeviceInfo(kind, deviceId)     → MediaDeviceInfo | null
//   requestPermissions()              → single-shot prompt; { camera, mic, error? }
//   destroy()                         — idempotent; stops everything
//
// Persistence keys:
//   swr.media.lastDevices  — JSON { videoDeviceId, audioDeviceId, videoFacingMode }
//
// Fix vs the PRD: MediaRecorder.isTypeSupported is the real method name
// (the PRD's `isTypeMime` at line 296 doesn't exist on MediaRecorder).
//
// Browser-only. Cannot be loaded under Node — relies on navigator,
// MediaStream, MediaRecorder, AudioContext. Tests use a node:vm sandbox
// with shimmed globals.

(function () {
  'use strict';
  if (window.SWR_MEDIA_INPUT) return;

  // ---- Constants ---------------------------------------------------------
  var KEY_LAST_DEVICES = 'swr.media.lastDevices';
  var RECORDING_MIME_PREFERENCE = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  var DEFAULT_VIDEO_RESOLUTION = { width: 1280, height: 720 };
  var DEFAULT_VIDEO_FRAMERATE = 30;
  var DEFAULT_AUDIO_SAMPLE_RATE = 48000;
  var FFT_SIZE = 2048;
  var SMOOTHING_TIME_CONSTANT = 0.8;
  var TRANSIENT_THRESHOLD = 30;
  var MONITOR_GAIN = 0.7;
  var DEFAULT_VIDEO_BITRATE = 8000000;
  var DEFAULT_AUDIO_BITRATE = 128000;
  var DEFAULT_CANVAS_FPS = 30;
  var DEFAULT_TIMESLICE_MS = 100;

  // ---- Helpers -----------------------------------------------------------
  function _safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function _safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }
  function _warn(msg, err) {
    if (typeof console !== 'undefined' && console && console.warn) console.warn(msg, err || '');
  }
  function _hasMediaDevices() {
    return typeof navigator !== 'undefined' && navigator &&
      navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
  }
  function _pickSupportedMime() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    for (var i = 0; i < RECORDING_MIME_PREFERENCE.length; i++) {
      try { if (MediaRecorder.isTypeSupported(RECORDING_MIME_PREFERENCE[i])) return RECORDING_MIME_PREFERENCE[i]; }
      catch (_) { /* ignore probe errors */ }
    }
    return '';
  }
  function _readLastDevices() {
    var raw = _safeGet(KEY_LAST_DEVICES);
    if (!raw) return null;
    try { var p = JSON.parse(raw); return (p && typeof p === 'object') ? p : null; }
    catch (_) { return null; }
  }
  function _writeLastDevices(patch) {
    var cur = _readLastDevices() || {};
    if (patch.videoDeviceId !== undefined) cur.videoDeviceId = patch.videoDeviceId || null;
    if (patch.audioDeviceId !== undefined) cur.audioDeviceId = patch.audioDeviceId || null;
    if (patch.videoFacingMode !== undefined) cur.videoFacingMode = patch.videoFacingMode || null;
    try { _safeSet(KEY_LAST_DEVICES, JSON.stringify(cur)); } catch (_) {}
  }

  function _averageRange(data, start, end) {
    if (!data || data.length === 0) return 0;
    var hi = Math.min(end, data.length), lo = Math.min(start, hi);
    if (hi <= lo) return 0;
    var sum = 0;
    for (var i = lo; i < hi; i++) sum += data[i];
    return sum / (hi - lo);
  }
  function _detectPitch(self, timeData) {
    if (!timeData || timeData.length < 2 || !self._audioContext) return 0;
    var crossings = 0;
    for (var i = 1; i < timeData.length; i++) {
      var p = timeData[i - 1], c = timeData[i];
      if ((p < 128 && c >= 128) || (p >= 128 && c < 128)) crossings++;
    }
    var sr = self._audioContext.sampleRate || DEFAULT_AUDIO_SAMPLE_RATE;
    var dur = timeData.length / sr;
    return dur > 0 ? crossings / (2 * dur) : 0;
  }
  function _detectTransient(self, frequencyData) {
    var cur = _averageRange(frequencyData, 0, 20);
    var prev = typeof self._lastTransient === 'number' ? self._lastTransient : 0;
    var diff = cur - prev;
    self._lastTransient = cur;
    return diff > TRANSIENT_THRESHOLD ? cur : 0;
  }
  function _stopStream(ref) {
    if (ref && ref.track) { try { ref.track.stop(); } catch (_) {} ref.track = null; }
    if (ref && ref.stream) {
      var tracks = ref.stream.getTracks();
      for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (_) {} }
      ref.stream = null;
    }
  }
  function _closeAudioContext(self) {
    if (self._audioContext) { try { self._audioContext.close(); } catch (_) {} self._audioContext = null; }
    self._analyser = null;
    self._monitorGain = null;
  }

  // ---- Constructor ------------------------------------------------------
  function SWRMediaInput(options) {
    options = options || {};
    var opts = (typeof options === 'object' && options) || {};
    var persisted = _readLastDevices();
    var persistedVideoId = persisted && persisted.videoDeviceId ? persisted.videoDeviceId : null;
    var persistedAudioId = persisted && persisted.audioDeviceId ? persisted.audioDeviceId : null;
    var persistedFacing = persisted && persisted.videoFacingMode === 'environment' ? 'environment' : 'user';

    this._options = {
      videoResolution: opts.videoResolution || DEFAULT_VIDEO_RESOLUTION,
      videoFrameRate: typeof opts.videoFrameRate === 'number' ? opts.videoFrameRate : DEFAULT_VIDEO_FRAMERATE,
      audioSampleRate: typeof opts.audioSampleRate === 'number' ? opts.audioSampleRate : DEFAULT_AUDIO_SAMPLE_RATE,
      echoCancellation: opts.echoCancellation === undefined ? false : !!opts.echoCancellation,
      noiseSuppression: opts.noiseSuppression === undefined ? false : !!opts.noiseSuppression,
      autoGainControl: opts.autoGainControl === undefined ? false : !!opts.autoGainControl,
    };
    this._video = {
      stream: null, track: null, enabled: false,
      deviceId: persistedVideoId, facingMode: persistedFacing,
      resolution: this._options.videoResolution, frameRate: this._options.videoFrameRate,
    };
    this._audio = {
      stream: null, track: null, enabled: false, deviceId: persistedAudioId,
      sampleRate: this._options.audioSampleRate,
      echoCancellation: this._options.echoCancellation,
      noiseSuppression: this._options.noiseSuppression,
      autoGainControl: this._options.autoGainControl,
    };
    this._audioContext = null;
    this._analyser = null;
    this._monitorGain = null;
    this._mediaRecorder = null;
    this._recordedChunks = [];
    this._lastTransient = 0;
    this._recordingStartedAt = null;
    this._destroyed = false;
  }

  // ---- CAMERA -----------------------------------------------------------
  SWRMediaInput.prototype.startCamera = function (preferredDevice) {
    var self = this;
    return new Promise(function (resolve) {
      if (self._destroyed) return resolve({ success: false, error: 'destroyed', message: 'instance destroyed' });
      if (!_hasMediaDevices()) return resolve({ success: false, error: 'Unsupported', message: 'mediaDevices unavailable' });
      var vc = {
        width: { ideal: self._video.resolution.width },
        height: { ideal: self._video.resolution.height },
        frameRate: { ideal: self._video.frameRate },
        facingMode: self._video.facingMode,
      };
      var did = preferredDevice || self._video.deviceId;
      if (did) vc.deviceId = { exact: did };
      navigator.mediaDevices.getUserMedia({ video: vc }).then(function (stream) {
        self._video.stream = stream;
        var tracks = stream.getVideoTracks();
        self._video.track = tracks.length ? tracks[0] : null;
        self._video.enabled = !!self._video.track;
        if (self._video.track && typeof self._video.track.getSettings === 'function') {
          var s = self._video.track.getSettings();
          if (s && s.width && s.height) self._video.resolution = { width: s.width, height: s.height };
          if (s && s.deviceId) self._video.deviceId = s.deviceId;
          if (s && (s.facingMode === 'environment' || s.facingMode === 'user')) self._video.facingMode = s.facingMode;
        }
        _writeLastDevices({ videoDeviceId: self._video.deviceId, videoFacingMode: self._video.facingMode });
        if (!self._video.track) return resolve({ success: false, error: 'NoVideoTrack', message: 'stream had no video track' });
        self.getDeviceInfo('videoinput', self._video.deviceId).then(function (info) {
          resolve({ success: true, stream: stream, resolution: self._video.resolution, deviceInfo: info });
        });
      }).catch(function (err) {
        resolve({ success: false, error: (err && err.name) || 'Error', message: (err && err.message) || String(err) });
      });
    });
  };

  SWRMediaInput.prototype.stopCamera = function () {
    _stopStream(this._video);
    if (this._video) this._video.enabled = false;
  };

  SWRMediaInput.prototype.switchCamera = function () {
    var self = this;
    return this.getDevices('videoinput').then(function (devices) {
      if (!devices || devices.length === 0) return { success: false, error: 'NoDevices', message: 'no video inputs' };
      var idx = -1;
      for (var i = 0; i < devices.length; i++) {
        if (devices[i].deviceId === self._video.deviceId) { idx = i; break; }
      }
      var next = devices[(idx + 1) % devices.length];
      self.stopCamera();
      var label = (next && next.label) || '';
      self._video.facingMode = label.toLowerCase().indexOf('back') !== -1 ? 'environment' : 'user';
      return self.startCamera(next && next.deviceId ? next.deviceId : null);
    });
  };

  // ---- MICROPHONE -------------------------------------------------------
  SWRMediaInput.prototype.startMic = function (preferredDevice) {
    var self = this;
    return new Promise(function (resolve) {
      if (self._destroyed) return resolve({ success: false, error: 'destroyed', message: 'instance destroyed' });
      if (!_hasMediaDevices()) return resolve({ success: false, error: 'Unsupported', message: 'mediaDevices unavailable' });
      var ac = {
        sampleRate: { ideal: self._audio.sampleRate },
        echoCancellation: self._audio.echoCancellation,
        noiseSuppression: self._audio.noiseSuppression,
        autoGainControl: self._audio.autoGainControl,
        channelCount: 1,
      };
      var did = preferredDevice || self._audio.deviceId;
      if (did) ac.deviceId = { exact: did };
      navigator.mediaDevices.getUserMedia({ audio: ac }).then(function (stream) {
        self._audio.stream = stream;
        var tracks = stream.getAudioTracks();
        self._audio.track = tracks.length ? tracks[0] : null;
        self._audio.enabled = !!self._audio.track;
        if (self._audio.track && typeof self._audio.track.getSettings === 'function') {
          var s = self._audio.track.getSettings();
          if (s && s.deviceId) self._audio.deviceId = s.deviceId;
        }
        _writeLastDevices({ audioDeviceId: self._audio.deviceId });
        return self.setupAudioAnalysis().then(function () {
          return self.getDeviceInfo('audioinput', self._audio.deviceId).then(function (info) {
            resolve({ success: true, stream: stream, analyser: self._analyser, deviceInfo: info });
          });
        });
      }).catch(function (err) {
        resolve({ success: false, error: (err && err.name) || 'Error', message: (err && err.message) || String(err) });
      });
    });
  };

  SWRMediaInput.prototype.stopMic = function () {
    _stopStream(this._audio);
    if (this._audio) this._audio.enabled = false;
    _closeAudioContext(this);
  };

  // ---- AUDIO ANALYSIS ---------------------------------------------------
  SWRMediaInput.prototype.setupAudioAnalysis = function () {
    var self = this;
    return new Promise(function (resolve) {
      if (!self._audio || !self._audio.stream) return resolve(null);
      var Ctor = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
      if (!Ctor) { _warn('swr-media-input: AudioContext unavailable'); return resolve(null); }
      if (!self._audioContext) {
        try { self._audioContext = new Ctor({ sampleRate: self._audio.sampleRate }); }
        catch (_) {
          try { self._audioContext = new Ctor(); } catch (e2) {
            _warn('swr-media-input: AudioContext construction failed', e2);
            return resolve(null);
          }
        }
      }
      if (!self._analyser) {
        self._analyser = self._audioContext.createAnalyser();
        self._analyser.fftSize = FFT_SIZE;
        self._analyser.smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;
      }
      try {
        var source = self._audioContext.createMediaStreamSource(self._audio.stream);
        source.connect(self._analyser);
        // Intentionally NOT connected to audioContext.destination — monitor output is opt-in.
      } catch (e) { _warn('swr-media-input: analyser connect failed', e); }
      self._lastTransient = 0;
      resolve(self._analyser);
    });
  };

  SWRMediaInput.prototype.getAudioData = function () {
    if (!this._analyser) return null;
    var binCount = this._analyser.frequencyBinCount;
    var frequencyData = new Uint8Array(binCount);
    var timeData = new Uint8Array(binCount);
    try {
      this._analyser.getByteFrequencyData(frequencyData);
      this._analyser.getByteTimeDomainData(timeData);
    } catch (e) { _warn('swr-media-input: getAudioData read failed', e); return null; }
    var self = this;
    return {
      frequency: frequencyData,
      time: timeData,
      bass: _averageRange(frequencyData, 0, 10),
      lowMid: _averageRange(frequencyData, 10, 40),
      mid: _averageRange(frequencyData, 40, 100),
      high: _averageRange(frequencyData, 100, 200),
      presence: _averageRange(frequencyData, 60, 80),
      energy: _averageRange(frequencyData, 0, 200),
      voiceFundamental: _detectPitch(self, timeData),
      transient: _detectTransient(self, frequencyData),
    };
  };

  SWRMediaInput.prototype.startMonitor = function () {
    var self = this;
    return new Promise(function (resolve) {
      if (!self._audioContext) return resolve(null);
      var gain = self._audioContext.createGain();
      try { gain.gain.value = MONITOR_GAIN; } catch (_) {}
      try { gain.connect(self._audioContext.destination); } catch (e) { _warn('swr-media-input: monitor connect failed', e); }
      self._monitorGain = gain;
      resolve(gain);
    });
  };

  // ---- RECORDING --------------------------------------------------------
  SWRMediaInput.prototype.startRecording = function (canvas, options) {
    var self = this;
    options = options || {};
    return new Promise(function (resolve) {
      if (typeof MediaRecorder === 'undefined') return resolve({ success: false, error: 'Unsupported', message: 'MediaRecorder unavailable' });
      var tracks = [];
      if (self._video && self._video.stream) {
        var v = self._video.stream.getVideoTracks();
        for (var i = 0; i < v.length; i++) tracks.push(v[i]);
      }
      if (canvas && typeof canvas.captureStream === 'function') {
        try {
          var cs = canvas.captureStream(options.canvasFps || DEFAULT_CANVAS_FPS);
          var cv = cs.getVideoTracks();
          for (var j = 0; j < cv.length; j++) tracks.push(cv[j]);
        } catch (e) { _warn('swr-media-input: canvas.captureStream failed', e); }
      }
      if (self._audio && self._audio.stream) {
        var a = self._audio.stream.getAudioTracks();
        for (var k = 0; k < a.length; k++) tracks.push(a[k]);
      }
      if (options.beatDestination && options.beatDestination.stream) {
        try {
          var b = options.beatDestination.stream.getAudioTracks();
          for (var l = 0; l < b.length; l++) tracks.push(b[l]);
        } catch (_) {}
      }
      if (tracks.length === 0) return resolve({ success: false, error: 'no_streams' });
      var mixedStream = new MediaStream(tracks);
      var mimeType = _pickSupportedMime();
      var recOpts = {
        videoBitsPerSecond: typeof options.videoBitrate === 'number' ? options.videoBitrate : DEFAULT_VIDEO_BITRATE,
        audioBitsPerSecond: typeof options.audioBitrate === 'number' ? options.audioBitrate : DEFAULT_AUDIO_BITRATE,
      };
      if (mimeType) recOpts.mimeType = mimeType;
      try { self._mediaRecorder = new MediaRecorder(mixedStream, recOpts); }
      catch (e) { return resolve({ success: false, error: 'RecorderInit', message: (e && e.message) || String(e) }); }
      self._recordedChunks = [];
      self._mediaRecorder.ondataavailable = function (ev) {
        if (ev && ev.data && ev.data.size > 0) self._recordedChunks.push(ev.data);
      };
      try { self._mediaRecorder.start(options.timeslice || DEFAULT_TIMESLICE_MS); }
      catch (e) { return resolve({ success: false, error: 'RecorderStart', message: (e && e.message) || String(e) }); }
      self._recordingStartedAt = Date.now();
      resolve({ success: true, state: self._mediaRecorder.state, mimeType: (self._mediaRecorder.mimeType || mimeType || '') });
    });
  };

  SWRMediaInput.prototype.stopRecording = function () {
    var self = this;
    return new Promise(function (resolve) {
      if (!self._mediaRecorder || self._mediaRecorder.state === 'inactive') return resolve(null);
      self._mediaRecorder.onstop = function () {
        var mime = (self._mediaRecorder && self._mediaRecorder.mimeType) || 'video/webm';
        var blob = new Blob(self._recordedChunks, { type: mime });
        var url = '';
        try { url = URL.createObjectURL(blob); } catch (_) { url = ''; }
        var duration = self._recordingStartedAt ? Date.now() - self._recordingStartedAt : 0;
        self._recordingStartedAt = null;
        resolve({ blob: blob, url: url, size: blob.size, duration: duration });
      };
      try { self._mediaRecorder.stop(); }
      catch (e) { _warn('swr-media-input: mediaRecorder.stop failed', e); resolve(null); }
    });
  };

  // ---- DEVICE MANAGEMENT -----------------------------------------------
  SWRMediaInput.prototype.getDevices = function (kind) {
    return new Promise(function (resolve) {
      if (!_hasMediaDevices() || typeof navigator.mediaDevices.enumerateDevices !== 'function') return resolve([]);
      navigator.mediaDevices.enumerateDevices().then(function (devices) {
        if (!devices) return resolve([]);
        if (!kind) return resolve(devices);
        var out = [];
        for (var i = 0; i < devices.length; i++) if (devices[i].kind === kind) out.push(devices[i]);
        resolve(out);
      }).catch(function () { resolve([]); });
    });
  };

  SWRMediaInput.prototype.getDeviceInfo = function (kind, deviceId) {
    return this.getDevices(kind).then(function (devices) {
      if (!devices || !deviceId) return null;
      for (var i = 0; i < devices.length; i++) if (devices[i].deviceId === deviceId) return devices[i];
      return null;
    });
  };

  SWRMediaInput.prototype.requestPermissions = function () {
    return new Promise(function (resolve) {
      if (!_hasMediaDevices()) return resolve({ camera: false, mic: false, error: 'Unsupported' });
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(function (stream) {
        if (stream) {
          var tracks = stream.getTracks();
          for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (_) {} }
        }
        resolve({ camera: true, mic: true });
      }).catch(function (err) {
        resolve({ camera: false, mic: false, error: (err && err.name) || 'Error', message: (err && err.message) || String(err) });
      });
    });
  };

  // ---- CLEANUP ----------------------------------------------------------
  SWRMediaInput.prototype.destroy = function () {
    if (this._destroyed) return;
    this.stopCamera();
    this.stopMic();
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      try { this._mediaRecorder.stop(); } catch (_) {}
    }
    this._mediaRecorder = null;
    this._recordedChunks = [];
    this._recordingStartedAt = null;
    this._lastTransient = 0;
    this._destroyed = true;
  };

  // ---- Factory + public surface ----------------------------------------
  function create(options) { return new SWRMediaInput(options || {}); }

  window.SWR_MEDIA_INPUT = {
    create: create,
    KEY_LAST_DEVICES: KEY_LAST_DEVICES,
    RECORDING_MIME_PREFERENCE: RECORDING_MIME_PREFERENCE,
    DEFAULT_VIDEO_RESOLUTION: DEFAULT_VIDEO_RESOLUTION,
    DEFAULT_VIDEO_FRAMERATE: DEFAULT_VIDEO_FRAMERATE,
    DEFAULT_AUDIO_SAMPLE_RATE: DEFAULT_AUDIO_SAMPLE_RATE,
    FFT_SIZE: FFT_SIZE,
    SMOOTHING_TIME_CONSTANT: SMOOTHING_TIME_CONSTANT,
    TRANSIENT_THRESHOLD: TRANSIENT_THRESHOLD,
    MONITOR_GAIN: MONITOR_GAIN,
  };

  // No boot work — factory is lazy.
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {});
  }
})();