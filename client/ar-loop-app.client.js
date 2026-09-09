// client/ar-loop-app.client.js — AR Animation Loop page controller.
//
// Global side effects: wires #fileInput / #recordBtn / #resetBtn /
// #shareBtn, toggles body.no-camera when no usable webcam is available,
// drives the upload → ready → recording → done state machine.
//
// State machine:
//   idle → uploading → ready → recording → exporting → done
//                    ↘ error
//
// Public surface (read-only): window.SWR_AR_LOOP = { state, reset, share }
// `state` is a live reference — callers can read .phase, .file, .objectUrl.
//
// Manual test checklist (verify-ar-loop.mjs covers the first three):
//   1. Page loads with no console errors.
//   2. Camera permission prompt appears (or body.no-camera is set).
//   3. With camera granted, the live webcam feed is visible behind the empty plane.
//   4. Click "Choose GIF or image" → select any small GIF or PNG.
//   5. Within ~1s the image appears as a rotating plane in front of the camera.
//   6. Click "Record 5s" → status changes to "Recording 5s…" → after 5s a .webm file downloads.
//   7. Click "Reset" → plane disappears, status returns to "Drop a file to begin."
//   8. Reload, dismiss camera permission → page still works (plane spins on a static background).

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const STATE = {
    phase: 'idle',           // idle | uploading | ready | recording | exporting | done | error
    file: null,              // File object
    objectUrl: null,         // blob: URL for the uploaded image
    mediaRecorder: null,
    chunks: [],
  };

  function setStatus(text, isErr) {
    const el = $('#status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('err', !!isErr);
  }
  function setPill(phase) {
    STATE.phase = phase;
    const pill = $('#pill-state');
    if (pill) {
      pill.textContent = phase;
      pill.classList.remove('ready', 'recording', 'error');
      if (phase === 'ready' || phase === 'done') pill.classList.add('ready');
      else if (phase === 'recording' || phase === 'exporting') pill.classList.add('recording');
      else if (phase === 'error') pill.classList.add('error');
    }
  }
  function setButtonsForPhase() {
    $('#recordBtn').disabled = STATE.phase !== 'ready';
    $('#resetBtn').disabled = STATE.phase === 'idle';
    $('#shareBtn').disabled = !(STATE.phase === 'ready' || STATE.phase === 'done');
  }

  // ── camera detection ────────────────────────────────────────────────
  async function detectCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      document.body.classList.add('no-camera');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch (_) {
      document.body.classList.add('no-camera');
      return false;
    }
  }

  // ── file loading ───────────────────────────────────────────────────
  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setStatus('File too large (max 10 MB).', true);
      setPill('error');
      return;
    }
    setPill('uploading');
    setStatus('Loading ' + file.name + '…');

    if (STATE.objectUrl) URL.revokeObjectURL(STATE.objectUrl);
    STATE.file = file;
    STATE.objectUrl = URL.createObjectURL(file);

    const img = document.getElementById('userGif');
    if (!img) {
      setStatus('A-Frame scene not ready.', true);
      setPill('error');
      return;
    }
    img.onload = () => {
      setPill('ready');
      setStatus(file.name + ' ready.');
      setButtonsForPhase();
      // Resize the plane to fit aspect ratio.
      const plane = document.getElementById('plane');
      if (plane && img.naturalWidth && img.naturalHeight) {
        const aspect = img.naturalWidth / img.naturalHeight;
        const baseHeight = 1.5;
        plane.setAttribute('width', (baseHeight * aspect).toFixed(3));
        plane.setAttribute('height', String(baseHeight));
      }
    };
    img.onerror = () => {
      setStatus('Failed to decode image.', true);
      setPill('error');
    };
    img.src = STATE.objectUrl;
  }

  // ── recording ─────────────────────────────────────────────────────
  function pickMimeType() {
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    for (const m of candidates) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
    }
    return '';
  }

  async function startRecording() {
    if (STATE.phase !== 'ready') return;
    setPill('recording');
    setStatus('Recording 5s…');

    const scene = $('#scene');
    if (!scene || typeof scene.captureStream !== 'function') {
      setStatus('captureStream not supported in this browser.', true);
      setPill('error');
      return;
    }

    let stream;
    try {
      stream = scene.captureStream(30);
    } catch (e) {
      setStatus('Could not capture stream: ' + (e && e.message || 'unknown'), true);
      setPill('error');
      return;
    }

    const mime = pickMimeType();
    let rec;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 })
                  : new MediaRecorder(stream);
    } catch (e) {
      setStatus('MediaRecorder failed: ' + (e && e.message || 'unknown'), true);
      setPill('error');
      return;
    }
    STATE.chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) STATE.chunks.push(e.data); };
    rec.onstop = () => {
      setPill('exporting');
      setStatus('Exporting WebM…');
      try {
        const blob = new Blob(STATE.chunks, { type: rec.mimeType || 'video/webm' });
        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = URL.createObjectURL(blob);
        a.download = 'ar-loop-' + stamp + '.webm';
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Release the object URL after a tick (browser needs it for the download).
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        setPill('done');
        setStatus('Saved ' + a.download);
      } catch (e) {
        setStatus('Export failed: ' + (e && e.message || 'unknown'), true);
        setPill('error');
      }
      setButtonsForPhase();
    };
    rec.onerror = (e) => {
      setStatus('Recorder error: ' + (e && e.error && e.error.name || 'unknown'), true);
      setPill('error');
    };
    try {
      rec.start();
      STATE.mediaRecorder = rec;
    } catch (e) {
      setStatus('Could not start recorder: ' + (e && e.message || 'unknown'), true);
      setPill('error');
      return;
    }
    setTimeout(() => {
      if (STATE.mediaRecorder && STATE.mediaRecorder.state !== 'inactive') {
        try { STATE.mediaRecorder.stop(); } catch (_) {}
      }
    }, 5000);
  }

  // ── reset / share ──────────────────────────────────────────────────
  function reset() {
    if (STATE.mediaRecorder && STATE.mediaRecorder.state !== 'inactive') {
      try { STATE.mediaRecorder.stop(); } catch (_) {}
    }
    if (STATE.objectUrl) { URL.revokeObjectURL(STATE.objectUrl); STATE.objectUrl = null; }
    STATE.file = null;
    STATE.chunks = [];
    const img = document.getElementById('userGif');
    if (img) img.removeAttribute('src');
    setPill('idle');
    setStatus('Drop a file to begin.');
    setButtonsForPhase();
    const fi = $('#fileInput'); if (fi) fi.value = '';
  }

  async function share() {
    const url = new URL(window.location.href);
    url.searchParams.set('demo', '1');
    const urlStr = url.toString();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(urlStr);
        setStatus('Share URL copied to clipboard.');
      } else {
        setStatus('Share URL: ' + urlStr);
      }
    } catch (_) {
      setStatus('Could not copy. URL: ' + urlStr);
    }
  }

  // ── boot ──────────────────────────────────────────────────────────
  async function boot() {
    const fi = $('#fileInput');
    if (fi) fi.addEventListener('change', onFile);
    const rb = $('#recordBtn'); if (rb) rb.addEventListener('click', startRecording);
    const resetBtn = $('#resetBtn'); if (resetBtn) resetBtn.addEventListener('click', reset);
    const sb = $('#shareBtn'); if (sb) sb.addEventListener('click', share);
    setButtonsForPhase();
    await detectCamera();

    // If gif-shader failed to load (CDN blocked, offline, etc.), surface a
    // hint in the status bar. Static images still work via the default material.
    if (window.__gifShaderFailed) {
      setStatus('Animated GIF support unavailable (CDN blocked). Static images still work.');
    }

    // Expose for tests / devtools.
    window.SWR_AR_LOOP = {
      state: STATE,
      reset,
      share,
      pickMimeType,  // exposed for unit testing
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
