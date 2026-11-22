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
// its time-domain samples via AnalyserNode and ship them as AudioData
// chunks at 100ms granularity, and the worker AAC-encodes them. The
// pull hands over ONLY the samples the graph has produced since the last
// pull — getFloatTimeDomainData returns the LAST N samples of the
// analyser's window, not the new ones — and every chunk carries the clock
// time of its first sample.
//
// THE CLOCK
// ---------
// The audio graph's clock (ctx.currentTime), for the video frames as well
// as the audio chunks. The picture is drawn from the audio analysis, so a
// frame that shows a beat has to carry that beat's time; stamping the
// frames with performance.now() (the wall clock) and the audio with
// something else put the two tracks on different timelines, and the
// export could not follow the beat. Falls back to the wall clock when
// there is no audio to share one with.
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
    // Audio capture — a puller over an AnalyserNode that hands out only the
    // samples the graph has produced since the last pull.
    audioSource: null,
    audioCtx: null,
    audioPuller: null,
    audioSampleRate: 0,
    audioNumberOfChannels: 0,
    audioChunkFrames: 0,
    audioPlanes: null,      // Float32Array — one plane per channel
    lastVideoTs: -1,        // the last frame's timestamp, in microseconds
  };
  var AUDIO_CHUNK_MS = 100;

  function postToWorker(msg, transfer) {
    if (transfer && transfer.length) {
      state.worker.postMessage(msg, transfer);
    } else {
      state.worker.postMessage(msg);
    }
  }

  // ---- the audio puller -------------------------------------------------
  // An AnalyserNode's fftSize must be a power of two, and it must hold
  // more than one chunk so a slow frame does not lose samples. (The old
  // code set sampleRate * 0.1 * 2 — 9600 at 48 kHz — which THREW, and the
  // throw was swallowed: the analyser was dropped and the MP4 came out
  // with no audio track at all.)
  //
  // The pull hands over only the samples the graph has produced since the
  // last pull. getFloatTimeDomainData returns the LAST N samples of the
  // analyser's window, not the new ones, so taking the whole window every
  // frame handed out the same audio over and over — and the timeline, a
  // counter that advanced 100 ms per frame while the song advanced ~16 ms,
  // ran several times too fast.
  function createPuller(ctx, sourceNode) {
    var sr = ctx.sampleRate;
    var chunkFrames = Math.max(1, Math.round(sr * AUDIO_CHUNK_MS / 1000));
    var fftSize = 1;
    while (fftSize < chunkFrames * 2) fftSize *= 2;

    var analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;
    sourceNode.connect(analyser);

    var ring = new Float32Array(fftSize);      // the analyser's time-domain window
    var chunk = new Float32Array(chunkFrames);  // reused; AudioData copies it
    var consumed = 0;   // global sample index already taken
    var filled = 0;     // samples currently in `chunk`
    var clock0 = ctx.currentTime;

    function pull() {
      analyser.getFloatTimeDomainData(ring);
      // How many samples the graph has produced since the take began.
      var produced = Math.round((ctx.currentTime - clock0) * sr);
      if (produced < consumed) produced = consumed;
      while (filled < chunkFrames && consumed < produced) {
        var j = consumed - (produced - fftSize);
        // j < 0: the sample aged out of the window (a long stall). It is
        // gone, so the chunk moves on without it.
        if (j >= 0) chunk[filled++] = ring[j];
        consumed++;
      }
      if (filled < chunkFrames) return null;
      var firstIndex = consumed - chunkFrames;
      filled = 0;
      return {
        samples: chunk,
        firstIndex: firstIndex,
        timestampUs: (firstIndex / sr) * 1e6,
      };
    }

    return {
      sampleRate: sr,
      chunkFrames: chunkFrames,
      // The clock, in microseconds since the take began.
      nowUs: function () { return (ctx.currentTime - clock0) * 1e6; },
      pull: pull,
      close: function () {
        try { sourceNode.disconnect(analyser); } catch (_) {}
        try { analyser.disconnect(); } catch (_) {}
      },
    };
  }

  // ---- per-rAF VideoFrame capture ---------------------------------------
  // Each tick creates a GPU-backed VideoFrame from the page canvas and
  // hands it to the worker. The frame is closed in the worker to free
  // GPU memory.
  function captureLoop() {
    if (!state.worker || !state.ready || !state.canvas) return;
    // Forced watermark: this path builds VideoFrames straight off a canvas, so
    // the frame comes from the compositor (live frame + mark) when available.
    var frameSource = state.canvas;
    if (window.SWR_WATERMARK && window.SWR_WATERMARK.frameSource) {
      try { frameSource = window.SWR_WATERMARK.frameSource(state.canvas) || state.canvas; } catch (e) { /* capture the raw canvas */ }
    }
    // The shared clock. With audio it is the audio graph's clock, so the
    // frame that shows a beat carries that beat's time and the export can
    // follow the beat. Without audio it is the wall clock.
    var ts = state.audioPuller
      ? state.audioPuller.nowUs()
      : (performance.now() - state.t0) * 1000; // microseconds
    if (!(ts >= 0)) ts = 0;
    // Timestamps must not go backwards: the muxer rejects a track whose
    // samples are out of order.
    if (ts <= state.lastVideoTs) ts = state.lastVideoTs + 1;
    state.lastVideoTs = ts;
    try {
      var frame = new VideoFrame(frameSource, { timestamp: ts });
      postToWorker({ type: 'video', frame: frame }, [frame]);
    } catch (e) {
      // Canvas may be unavailable in some cases (e.g. background tab).
      // Just skip this frame.
    }
    // Audio: hand over the samples the graph produced since the last pull,
    // as one chunk, stamped with the clock time of its first sample.
    if (state.audioPuller) {
      try {
        var chunk = state.audioPuller.pull();
        if (chunk) {
          var frames = chunk.samples.length;
          var ch = state.audioNumberOfChannels;
          // f32-planar: one plane per channel, laid out back to back.
          for (var c = 0; c < ch; c++) state.audioPlanes.set(chunk.samples, c * frames);
          var ad = new AudioData({
            format: 'f32-planar',
            sampleRate: state.audioSampleRate,
            numberOfFrames: frames,
            numberOfChannels: ch,
            timestamp: chunk.timestampUs,
            data: state.audioPlanes,
          });
          postToWorker({ type: 'audio', data: ad }, [ad]);
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

    // Audio: tap the caller's audioSource so the export carries the song
    // the user is hearing. The tap is a puller of its own (the caller
    // passes an AnalyserNode; we read the time-domain data from it and
    // hand over only what is new). We never connect it to the
    // destination — the caller's existing audio graph already routes to
    // the speakers. We only tap, never inject.
    state.audioSampleRate = opts.audioSampleRate || 0;
    state.audioNumberOfChannels = opts.audioNumberOfChannels || 0;
    if (opts.audioSource && state.audioSampleRate && state.audioNumberOfChannels) {
      try {
        var ctx = opts.audioSource.context;
        state.audioCtx = ctx;
        state.audioPuller = createPuller(ctx, opts.audioSource);
        state.audioChunkFrames = state.audioPuller.chunkFrames;
        state.audioPlanes = new Float32Array(state.audioChunkFrames * state.audioNumberOfChannels);
      } catch (e) {
        state.audioPuller = null;
      }
    }

    state.worker = new Worker('../lib/recorder-worker.js', { type: 'module' });
    var settle, settleReady;
    state.pending = new Promise(function (resolve, reject) { settle = { resolve: resolve, reject: reject }; });
    // 'ready' and 'done' are two different moments: the encoder is streaming
    // frames at 'ready', and the MP4 only exists at 'done'. A caller that
    // flips its own UI on start() has to wait for the FIRST one - start()
    // returns state.pending, which settles at the second, so flipping on it
    // means the take never appears to start.
    state.readyPromise = new Promise(function (resolve, reject) { settleReady = { resolve: resolve, reject: reject }; });
    state.pending.videoFrames = 0;
    state.pending.errored = false;
    state.pending.mime = 'video/mp4';

    state.worker.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'ready') {
        state.ready = true;
        settleReady.resolve(true);
        captureLoop();
      } else if (m.type === 'unsupported') {
        state.pending.errored = true;
        var err = Object.assign(new Error('SWR_RECORDER: ' + m.reason), { unsupported: true });
        settleReady.reject(err);
        settle.reject(err);
        cleanup();
      } else if (m.type === 'error') {
        state.pending.errored = true;
        var e2 = new Error('SWR_RECORDER worker: ' + m.message);
        settleReady.reject(e2);
        settle.reject(e2);
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
      var e3 = new Error('SWR_RECORDER worker onerror: ' + (e.message || 'unknown'));
      settleReady.reject(e3);
      settle.reject(e3);
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
    if (state.audioPuller) {
      try { state.audioPuller.close(); } catch (_) {}
    }
    state.audioSource = null;
    state.audioPuller = null;
    state.audioCtx = null;
    state.audioSampleRate = 0;
    state.audioNumberOfChannels = 0;
    state.audioChunkFrames = 0;
    state.audioPlanes = null;
    state.lastVideoTs = -1;
    state.worker = null;
    state.ready = false;
    state.canvas = null;
  }

  window.SWR_RECORDER = {
    canUseWebCodecs: canUseWebCodecs,
    start: start,
    stop: stop,
    isActive: isActive,
    // The audio puller, exposed so it can be tested on its own. The
    // WebCodecs path needs an H.264 encoder to reach the encoder at all,
    // so a browser without one (CI included) cannot exercise the audio
    // through a real take — but the puller is where the timing lives, and
    // it can be driven with a known signal.
    createPuller: createPuller,
    // Resolves when the encoder is streaming frames ('ready'), rejects if the
    // codec is unsupported. start()'s own promise settles at 'done' (the MP4
    // blob), which is far too late for a caller wiring its record button.
    ready: function () { return state.readyPromise || Promise.resolve(false); },
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
