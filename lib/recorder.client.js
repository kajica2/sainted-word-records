// lib/recorder.client.js — main-thread orchestrator for the WebCodecs
// recording path. The H.264 encode runs in a Web Worker; the main
// thread feeds VideoFrames from the page canvas and AudioData from a
// Web Audio node.
//
// Public API:
//
//   SWR_RECORDER.canUseWebCodecs() → boolean
//   SWR_RECORDER.start({ canvas, audioSource, audioSampleRate, audioNumberOfChannels,
//                        width, height, fps, videoBitsPerSecond })
//   SWR_RECORDER.stop()  →  Promise<{ blob, videoFrames, audioChunks, mime }>
//   SWR_RECORDER.isActive() → boolean
//
// Feature gate: VideoEncoder + VideoFrame + AudioEncoder must all exist
// in the runtime. Otherwise start() rejects with an { unsupported: true }
// error so the caller can fall back to the legacy MediaRecorder path.
//
// Audio path: the caller passes an `audioSource` (any AudioNode). We pull
// its time-domain samples via AnalyserNode on each rAF, build AudioData
// chunks at 100ms granularity, and ship them to the worker. The worker
// AAC-encodes them. Falls back to video-only if AnalyserNode is not
// available at the source.
//
// Idempotent: re-evaluation returns the cached singleton.

(function () {
  'use strict';
  if (window.SWR_RECORDER) return;

  var FPS_DEFAULT = 24;

  function canUseWebCodecs() {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return false;
    if (typeof VideoEncoder === 'undefined') return false;
    if (typeof VideoFrame === 'undefined') return false;
    if (typeof AudioEncoder === 'undefined') return false;
    if (typeof AudioData === 'undefined') return false;
    return true;
  }

  var state = {
    worker: null,
    pending: null,
    ready: false,
    canvas: null,
    width: 0,
    height: 0,
    fps: FPS_DEFAULT,
    rafId: 0,
    // Audio capture — analyser-driven sample-pull at AUDIO_CHUNK_MS cadence.
    // `timeBuffer` is a Float32Array reused across frames to avoid GC pressure.
    audioSource: null,
    audioAnalyser: null,
    audioSampleRate: 0,
    audioNumberOfChannels: 0,
    audioChunkFrames: 0,
    audioChunkStart: 0,        // microseconds
    audioChunkBuffer: null,    // Float32Array of audioChunkFrames * channels
    audioChunkBytes: 0,        // position inside buffer
  };
  var AUDIO_CHUNK_MS = 100;

  function postToWorker(msg, transfer) {
    if (transfer && transfer.length) {
      state.worker.postMessage(msg, transfer);
    } else {
      state.worker.postMessage(msg);
    }
  }

  // ---- per-rAF VideoFrame capture ---------------------------------------
  // Each tick creates a GPU-backed VideoFrame from the page canvas and
  // hands it to the worker. The frame is closed in the worker to free
  // GPU memory.
  function captureLoop() {
    if (!state.worker || !state.ready || !state.canvas) return;
    var ts = (performance.now() - state.t0) * 1000; // microseconds
    try {
      var frame = new VideoFrame(state.canvas, { timestamp: ts });
      postToWorker({ type: 'video', frame: frame }, [frame]);
    } catch (e) {
      // Canvas may be unavailable in some cases (e.g. background tab).
      // Just skip this frame.
    }
    // Audio: pull samples from the analyser and accumulate them into a
    // chunk buffer sized for AUDIO_CHUNK_MS. When the chunk buffer is
    // full, ship it as an AudioData chunk to the worker.
    if (state.audioAnalyser) {
      try {
        var analyser = state.audioAnalyser;
        var ch = state.audioNumberOfChannels;
        var frames = state.audioChunkFrames;
        // The analyser only gives us mono time-domain (frames), so we
        // route one mono capture to every channel — cheap and good enough
        // for music visualizer playback where the source is already mono
        // in many cases. If the source is true stereo and we want to
        // preserve it, the caller can pass a ChannelMergerNode as the
        // analyser tap; for now, expand the mono buffer across channels.
        var mono = new Float32Array(frames);
        analyser.getFloatTimeDomainData(mono);
        // Interleave / duplicate into the chunk buffer
        var pos = state.audioChunkBytes;
        for (var i = 0; i < frames; i++) {
          var v = mono[i];
          for (var c = 0; c < ch; c++) {
            state.audioChunkBuffer[pos++] = v;
          }
        }
        state.audioChunkBytes = pos;
        if (state.audioChunkBytes >= state.audioChunkBuffer.length) {
          var ad = new AudioData({
            format: 'f32-planar',
            sampleRate: state.audioSampleRate,
            numberOfFrames: frames,
            numberOfChannels: ch,
            timestamp: state.audioChunkStart,
            data: state.audioChunkBuffer,
          });
          postToWorker({ type: 'audio', data: ad }, [ad]);
          state.audioChunkStart += AUDIO_CHUNK_MS * 1000; // microseconds
          state.audioChunkBytes = 0;
        }
      } catch (e) {
        // AudioData may be unsupported in some browsers; skip silently.
      }
    }
    state.rafId = requestAnimationFrame(captureLoop);
  }

  // ---- lifecycle -------------------------------------------------------
  async function start(opts) {
    if (state.worker) {
      throw new Error('SWR_RECORDER: already running');
    }
    if (!canUseWebCodecs()) {
      throw Object.assign(new Error('WebCodecs path unsupported'), { unsupported: true });
    }

    state.canvas = opts.canvas;
    state.width  = (opts.width  != null) ? opts.width  : opts.canvas.width;
    state.height = (opts.height != null) ? opts.height : opts.canvas.height;
    state.fps    = opts.fps || FPS_DEFAULT;
    state.t0     = performance.now();

    // Audio: tap the caller's audioSource through an AnalyserNode so we
    // can pull time-domain samples without disturbing the existing audio
    // graph (the analyser is a passthrough — it just buffers the last N
    // frames). The analyser must have fftSize large enough to hold the
    // AUDIO_CHUNK_MS window: fftSize = sampleRate * AUDIO_CHUNK_MS / 1000.
    state.audioSampleRate = opts.audioSampleRate || 0;
    state.audioNumberOfChannels = opts.audioNumberOfChannels || 0;
    if (opts.audioSource && state.audioSampleRate && state.audioNumberOfChannels) {
      try {
        var ctx = opts.audioSource.context;
        state.audioChunkFrames = Math.round(state.audioSampleRate * AUDIO_CHUNK_MS / 1000);
        state.audioChunkBuffer = new Float32Array(state.audioChunkFrames * state.audioNumberOfChannels);
        state.audioChunkBytes = 0;
        state.audioChunkStart = 0;
        state.audioAnalyser = ctx.createAnalyser();
        state.audioAnalyser.fftSize = state.audioChunkFrames * 2;
        state.audioAnalyser.smoothingTimeConstant = 0;
        opts.audioSource.connect(state.audioAnalyser);
        // We do NOT connect the analyser to destination — the caller's
        // existing audio graph already routes to destination. We only
        // tap, never inject.
      } catch (e) {
        state.audioAnalyser = null;
      }
    }

    state.worker = new Worker('../lib/recorder-worker.js', { type: 'module' });
    var settle;
    state.pending = new Promise(function (resolve, reject) { settle = { resolve: resolve, reject: reject }; });
    state.pending.videoFrames = 0;
    state.pending.errored = false;
    state.pending.mime = 'video/mp4';

    state.worker.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'ready') {
        state.ready = true;
        captureLoop();
      } else if (m.type === 'unsupported') {
        state.pending.errored = true;
        settle.reject(Object.assign(new Error('SWR_RECORDER: ' + m.reason), { unsupported: true }));
        cleanup();
      } else if (m.type === 'error') {
        state.pending.errored = true;
        settle.reject(new Error('SWR_RECORDER worker: ' + m.message));
        cleanup();
      } else if (m.type === 'done') {
        state.pending.videoFrames = m.videoFrames;
        var blob = new Blob([m.buffer], { type: 'video/mp4' });
        settle.resolve({
          blob: blob,
          videoFrames: m.videoFrames,
          mime: 'video/mp4',
        });
        cleanup();
      }
    };
    state.worker.onerror = function (e) {
      state.pending.errored = true;
      settle.reject(new Error('SWR_RECORDER worker onerror: ' + (e.message || 'unknown')));
      cleanup();
    };

    postToWorker({
      type: 'init',
      width: state.width,
      height: state.height,
      fps: state.fps,
      videoBitsPerSecond: opts.videoBitsPerSecond || 4_000_000,
      videoCodec: 'avc1.42E01E',
      audioSampleRate: state.audioAnalyser ? state.audioSampleRate : 0,
      audioNumberOfChannels: state.audioAnalyser ? state.audioNumberOfChannels : 0,
    });

    return state.pending;
  }

  async function stop() {
    if (!state.worker) {
      throw new Error('SWR_RECORDER: not running');
    }
    state.ready = false;
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }
    postToWorker({ type: 'stop' });
    return state.pending; // resolves on 'done'
  }

  function isActive() {
    return !!state.worker;
  }

  function cleanup() {
    if (state.audioAnalyser) {
      try { state.audioSource && state.audioSource.disconnect(state.audioAnalyser); } catch (_) {}
      try { state.audioAnalyser.disconnect(); } catch (_) {}
    }
    state.audioSource = null;
    state.audioAnalyser = null;
    state.audioSampleRate = 0;
    state.audioNumberOfChannels = 0;
    state.audioChunkFrames = 0;
    state.audioChunkBuffer = null;
    state.audioChunkBytes = 0;
    state.worker = null;
    state.ready = false;
    state.canvas = null;
  }

  window.SWR_RECORDER = {
    canUseWebCodecs: canUseWebCodecs,
    start: start,
    stop: stop,
    isActive: isActive,
  };

  // Default SWR_RECORDER_WORKER to on for browsers that support WebCodecs.
  // The flag is opt-out: explicit '0' in localStorage keeps the legacy
  // MediaRecorder path. The flag used to be opt-in (had to be set before
  // page boot); the worker path has been stable enough across Chrome/Edge
  // 94+ and Safari 16.4+ to make the worker the default for capable
  // browsers, falling back automatically on any failure inside _startWebCodecs.
  // Firefox still has no WebCodecs support so it transparently uses the
  // MediaRecorder fallback regardless of this default.
  try {
    const userOverride = localStorage.getItem('swr.recorder.worker');
    if (userOverride === '0') {
      window.SWR_RECORDER_WORKER = false;
    } else if (userOverride === '1') {
      window.SWR_RECORDER_WORKER = true;
    } else if (typeof window.SWR_RECORDER_WORKER === 'undefined') {
      window.SWR_RECORDER_WORKER = canUseWebCodecs();
    }
  } catch (_) {
    // localStorage unavailable (private mode, etc) — fall through to feature check.
    if (typeof window.SWR_RECORDER_WORKER === 'undefined') {
      window.SWR_RECORDER_WORKER = canUseWebCodecs();
    }
  }
})();
