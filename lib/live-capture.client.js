// lib/live-capture.client.js — camera + audio feed for realtime recording.
// Classic script. Floating panel: open feed, preview, record canvas+mic or camera.

(function () {
  'use strict';
  if (window.SWR_LIVE_CAPTURE) return;

  var state = { stream: null, recorder: null, chunks: [], mode: 'canvas' };

  function setStatus(msg) {
    var s = document.querySelector('[data-lc-status]');
    if (s) s.textContent = msg;
  }

  function pickMime() {
    var types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    for (var i = 0; i < types.length; i++) {
      try { if (MediaRecorder.isTypeSupported(types[i])) return types[i]; } catch (_) {}
    }
    return '';
  }

  async function openFeed() {
    if (state.stream) return state.stream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('getUserMedia not available');
      return null;
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      var video = document.querySelector('[data-lc-preview]');
      if (video) { video.srcObject = state.stream; video.play().catch(function () {}); }
      setStatus('Camera + mic open');
      return state.stream;
    } catch (e) {
      setStatus('Permission denied or no device');
      return null;
    }
  }

  function closeFeed() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
      state.stream = null;
    }
    var video = document.querySelector('[data-lc-preview]');
    if (video) video.srcObject = null;
    setStatus('Feed closed');
  }

  function canvasStream() {
    var canvas = document.querySelector('canvas');
    if (!canvas || typeof canvas.captureStream !== 'function') return null;
    return canvas.captureStream(30);
  }

  function mixedStream() {
    var base = state.mode === 'camera' ? state.stream : canvasStream();
    if (!base) return null;
    if (state.mode === 'canvas' && state.stream) {
      var audio = state.stream.getAudioTracks()[0];
      if (audio) base.addTrack(audio);
    }
    return base;
  }

  function startRecording() {
    if (state.recorder && state.recorder.state !== 'inactive') return;
    var stream = mixedStream();
    if (!stream) { setStatus('No stream — open feed or ensure a canvas exists'); return; }
    var mime = pickMime();
    try {
      state.recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 })
        : new MediaRecorder(stream);
    } catch (e) { setStatus('MediaRecorder failed'); return; }
    state.chunks = [];
    state.recorder.ondataavailable = function (e) {
      if (e.data && e.data.size) state.chunks.push(e.data);
    };
    state.recorder.onstop = function () {
      var blob = new Blob(state.chunks, { type: state.recorder.mimeType || 'video/webm' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'swr-live-' + new Date().toISOString().replace(/[:.]/g, '-') + '.webm';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      setStatus('Saved ' + a.download);
      var btn = document.querySelector('[data-lc-rec]');
      if (btn) btn.textContent = 'Record';
    };
    state.recorder.start();
    setStatus('Recording…');
    var btn = document.querySelector('[data-lc-rec]');
    if (btn) btn.textContent = 'Stop';
  }

  function stopRecording() {
    if (state.recorder && state.recorder.state !== 'inactive') {
      try { state.recorder.stop(); } catch (_) {}
    }
  }

  function toggleRecord() {
    if (state.recorder && state.recorder.state === 'recording') stopRecording();
    else startRecording();
  }

  function buildUI() {
    if (document.getElementById('swr-live-capture')) return;
    var bar = document.createElement('div');
    bar.id = 'swr-live-capture';
    bar.style.cssText = 'position:fixed;bottom:72px;left:16px;z-index:10070;display:flex;flex-direction:column;gap:6px;width:240px;padding:10px;border-radius:10px;background:rgba(12,9,6,.92);border:1px solid rgba(255,176,102,.3);color:#f4e7d6;font:12px/1.3 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5)';
    bar.innerHTML = '<div>Live capture</div>';
    var video = document.createElement('video');
    video.setAttribute('data-lc-preview', '');
    video.muted = true;
    video.playsInline = true;
    video.style.cssText = 'width:100%;height:120px;background:#000;border-radius:6px;object-fit:cover';
    bar.appendChild(video);
    var status = document.createElement('div');
    status.setAttribute('data-lc-status', '');
    status.textContent = 'Idle';
    status.style.cssText = 'font-size:10px;opacity:.75';
    bar.appendChild(status);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px';
    var open = document.createElement('button');
    open.type = 'button'; open.textContent = 'Open feed';
    open.style.cssText = 'flex:1;padding:6px;border-radius:6px;border:0;background:#ff9a4d;color:#1a0f06;font-weight:700;cursor:pointer';
    open.addEventListener('click', openFeed);
    var close = document.createElement('button');
    close.type = 'button'; close.textContent = 'Close';
    close.style.cssText = 'padding:6px 10px;border-radius:6px;border:1px solid rgba(255,176,102,.4);background:transparent;color:#f4e7d6;cursor:pointer';
    close.addEventListener('click', closeFeed);
    row.appendChild(open); row.appendChild(close);
    bar.appendChild(row);
    var mode = document.createElement('div');
    mode.style.cssText = 'display:flex;gap:6px;font-size:10px';
    var camBtn = document.createElement('button');
    var cvsBtn = document.createElement('button');
    camBtn.type = 'button'; camBtn.textContent = 'Camera';
    cvsBtn.type = 'button'; cvsBtn.textContent = 'Canvas+mic';
    [camBtn, cvsBtn].forEach(function (b) {
      b.style.cssText = 'flex:1;padding:4px;border-radius:4px;border:1px solid rgba(255,176,102,.4);background:transparent;color:#f4e7d6;cursor:pointer';
    });
    camBtn.addEventListener('click', function () { state.mode = 'camera'; setStatus('Mode: camera'); });
    cvsBtn.addEventListener('click', function () { state.mode = 'canvas'; setStatus('Mode: canvas + mic'); });
    mode.appendChild(camBtn); mode.appendChild(cvsBtn);
    bar.appendChild(mode);
    var rec = document.createElement('button');
    rec.type = 'button'; rec.textContent = 'Record';
    rec.setAttribute('data-lc-rec', '');
    rec.style.cssText = 'padding:6px;border-radius:6px;border:0;background:#ff4d2e;color:#fff;font-weight:700;cursor:pointer';
    rec.addEventListener('click', toggleRecord);
    bar.appendChild(rec);
    document.body.appendChild(bar);
  }

  window.SWR_LIVE_CAPTURE = {
    open: openFeed, close: closeFeed,
    start: startRecording, stop: stopRecording,
    setMode: function (m) { state.mode = m === 'camera' ? 'camera' : 'canvas'; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
  else setTimeout(buildUI, 300);
})();
