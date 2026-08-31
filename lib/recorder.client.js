// lib/recorder.client.js — main-thread orchestrator for the WebCodecs
// recording path. The H.264 encode runs in a Web Worker; the main
// thread just feeds it VideoFrames from the running page canvas.
//
// Public API:
//
//   SWR_RECORDER.canUseWebCodecs() → boolean
//   SWR_RECORDER.start({ canvas, width, height, fps, videoBitsPerSecond })
//   SWR_RECORDER.stop()  →  Promise<{ blob, videoFrames, mime }>
//   SWR_RECORDER.isActive() → boolean
//
// Feature gate: window.SWR_RECORDER_WORKER must be truthy AND the
// browser must support VideoEncoder + VideoFrame. Otherwise start()
// rejects with an { unsupported: true } error so the caller can fall
// back to the legacy MediaRecorder path.
//
// Audio note: this first cut is video-only. The existing MediaRecorder
// path remains the audio-bearing default; a follow-up commit will wire
// the worker-side AudioEncoder + MediaStreamTrackGenerator.
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
  };

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
    try {
      var ts = (performance.now() - state.t0) * 1000; // microseconds
      var frame = new VideoFrame(state.canvas, { timestamp: ts });
      postToWorker({ type: 'video', frame: frame }, [frame]);
    } catch (e) {
      // Canvas may be unavailable in some cases (e.g. background tab).
      // Just skip this frame.
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
      audioSampleRate: 0,           // audio wiring lands in a follow-up
      audioNumberOfChannels: 0,
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
})();
