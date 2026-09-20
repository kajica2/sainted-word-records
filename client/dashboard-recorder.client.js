// client/dashboard-recorder.client.js — canvas + audio → WebM recorder
// Wired into dashboard.html via <script src> defer. Pairs with the
// dashboard-engine's render canvas + audio element.
//
// Public API on window.__SWR_RECORDER:
//   .start(opts?)  -> Promise<void>  opts: { videoBitsPerSecond, audioBitsPerSecond }
//   .stop()        -> Promise<Blob>  resolves with the recorded WebM Blob
//   .isRecording() -> boolean
//
// Notes:
// - MediaRecorder only supports audio+video mux when both streams exist.
// - If no audio is playing, the recording is video-only (silent WebM).
// - We DO NOT depend on engine features; the recorder wires its own
//   captureStream + MediaStreamAudioDestinationNode from the engine's
//   audio element via a globally-exposed `audioCtx` + `sourceNode`
//   when present (window.__SWR_ENGINE.audio).

(function () {
  'use strict';
  const recBtn = document.getElementById('rec-btn');
  const recIndicator = document.getElementById('rec-indicator');
  const recTime = document.getElementById('rec-time');
  if (!recBtn) return;

  let mediaRecorder = null;
  let chunks = [];
  let startedAt = 0;
  let tickInterval = null;
  let combinedStream = null;

  function fmtElapsed(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
  }

  function setIndicator(on) {
    if (!recIndicator) return;
    recIndicator.classList.toggle('hidden', !on);
    recIndicator.classList.toggle('flex', on);
  }

  function tick() {
    if (recTime) recTime.textContent = fmtElapsed(performance.now() - startedAt);
  }

  function buildStream() {
    const canvas = document.getElementById('render-canvas');
    const engine = window.__SWR_ENGINE;
    if (!canvas || !engine || !engine.audio) return null;

    // Video stream from canvas
    const videoStream = canvas.captureStream(60);

    // Audio stream from the engine's AudioContext.
    // The engine exposes `audio` but NOT the AudioContext — we add a
    // small hook below to capture that context when it boots.
    const audioCtx = window.__SWR_AUDIO_CTX;
    const audioSourceNode = window.__SWR_AUDIO_SOURCE;
    let audioTracks = [];
    if (audioCtx && audioSourceNode) {
      try {
        const dest = audioCtx.createMediaStreamDestination();
        audioSourceNode.connect(dest);
        audioTracks = dest.stream.getAudioTracks();
      } catch (_) {
        // Source may already be connected once; ignore.
      }
    }

    combinedStream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioTracks,
    ]);
    return combinedStream;
  }

  async function start(opts) {
    if (mediaRecorder && mediaRecorder.state === 'recording') return;
    const stream = buildStream();
    if (!stream) return;

    chunks = [];
    const config = {
      mimeType: 'video/webm;codecs=vp9,opus',
      videoBitsPerSecond: (opts && opts.videoBitsPerSecond) || 4_000_000,
      audioBitsPerSecond: (opts && opts.audioBitsPerSecond) || 128_000,
    };
    // Some headless contexts (Safari, older Chrome) don't support vp9/opus.
    // Fall back to a permissive default.
    if (!MediaRecorder.isTypeSupported(config.mimeType)) {
      delete config.mimeType;
    }
    mediaRecorder = new MediaRecorder(stream, config);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.start(1000); // emit a chunk every 1s for crash recovery
    startedAt = performance.now();
    setIndicator(true);
    tick();
    tickInterval = setInterval(tick, 250);

    recBtn.innerHTML = '<i class="fa-solid fa-stop text-xs"></i>';
    recBtn.style.color = '#ff8a3d';
    recBtn.title = 'Stop recording';
  }

  function stop() {
    return new Promise((resolve) => {
      if (!mediaRecorder || mediaRecorder.state !== 'recording') {
        resolve(null);
        return;
      }
      mediaRecorder.onstop = () => {
        clearInterval(tickInterval);
        tickInterval = null;
        const blob = new Blob(chunks, { type: 'video/webm' });
        chunks = [];
        combinedStream && combinedStream.getTracks().forEach((t) => t.stop());
        combinedStream = null;
        mediaRecorder = null;

        setIndicator(false);
        recBtn.innerHTML = '<i class="fa-solid fa-circle text-xs"></i>';
        recBtn.style.color = '#ff4a4a';
        recBtn.title = 'Record canvas + audio (saves WebM)';

        // Trigger download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'swr-recording-' + Date.now() + '.webm';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        resolve(blob);
      };
      mediaRecorder.stop();
    });
  }

  recBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') stop();
    else start();
  });

  window.__SWR_RECORDER = {
    start,
    stop,
    isRecording: () => !!(mediaRecorder && mediaRecorder.state === 'recording'),
  };
})();
