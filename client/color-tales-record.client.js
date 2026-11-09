/* global window, document */
(function () {
  const EXPORT = window.SWR_COLOR_TALES_EXPORT;
  const NS = 'http://www.w3.org/2000/svg';

  let recording = null;
  let recordingUrl = null;
  let stream = null;
  let intervalId = 0;
  let canvas = null;
  let ctx = null;
  let soundtrack = null;
  let audioCapture = null;

  function getSvg() {
    return document.querySelector('#ct-canvas');
  }

  async function drawFrame() {
    const svg = getSvg();
    if (!svg || !ctx) return;
    const copy = svg.cloneNode(true);
    copy.setAttribute('xmlns', NS);
    const blob = new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      ctx.fillStyle = '#fffdf5';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function stop() {
    if (!recording || recording.state === 'inactive') return;
    recording.stop();
    clearInterval(intervalId);
    document.querySelector('#ct-record').textContent = '● Record';
    document.querySelector('#ct-record-status').textContent = 'Finishing…';
  }

  async function start() {
    const picked = EXPORT.pickRecorderMime(window.MediaRecorder);
    if (!picked.mime) throw new Error('Video recording is not supported in this browser.');
    const svg = getSvg();
    const vb = (svg.getAttribute('viewBox') || '0 0 900 550').split(/\s+/).map(Number);
    const w = vb[2] || 900;
    const h = vb[3] || 550;
    const scale = 1080 / Math.max(w, h);
    canvas = canvas || document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx = canvas.getContext('2d', { alpha: false });
    await drawFrame();
    stream = canvas.captureStream(20);
    soundtrack = document.querySelector('#ct-soundtrack');
    const CT_AUDIO = window.SWR_COLOR_TALES_AUDIO;
    if (soundtrack && CT_AUDIO) CT_AUDIO.attachSoundtrack(soundtrack);
    await CT_AUDIO?.resumeOnGesture?.();
    const audioTrack = CT_AUDIO?.recordAudioTrack?.();
    if (audioTrack) {
      try { stream.addTrack(audioTrack); } catch { /* optional */ }
    } else if (soundtrack?.captureStream) {
      try {
        const at = soundtrack.captureStream().getAudioTracks()[0];
        if (at) stream.addTrack(at);
      } catch { /* optional */ }
    }
    recording = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: 4_500_000 });
    const chunks = [];
    recording.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recording.onstop = () => {
      stream?.getVideoTracks().forEach((t) => t.stop());
      stream = null;
      const mime = chunks[0]?.type || picked.mime;
      const ext = EXPORT.extensionForMime(mime);
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
      recordingUrl = URL.createObjectURL(new Blob(chunks, { type: mime }));
      const link = document.querySelector('#ct-download');
      if (link) {
        link.href = recordingUrl;
        link.download = `color-tales.${ext}`;
        link.textContent = `Download ${ext.toUpperCase()}`;
        link.hidden = false;
      }
      document.querySelector('#ct-record-status').textContent =
        picked.supportsMp4 ? 'Recording saved (MP4)' : 'Recording saved (WebM — not renamed as MP4)';
      recording = null;
    };
    recording.start(500);
    intervalId = setInterval(() => { drawFrame().catch(() => {}); }, 67);
    document.querySelector('#ct-record').textContent = '■ Stop';
    document.querySelector('#ct-record-status').textContent =
      picked.supportsMp4 ? 'Recording MP4…' : 'Recording WebM (MP4 encoder unavailable)';
  }

  async function toggle() {
    if (recording) return stop();
    try {
      await start();
    } catch (e) {
      document.querySelector('#ct-record-status').textContent = e.message || 'Could not record';
    }
  }

  window.SWR_COLOR_TALES_RECORD = { toggle, start, stop, drawFrame };
})();
