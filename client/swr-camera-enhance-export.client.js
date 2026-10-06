/* client/swr-camera-enhance-export.client.js — Camera Enhance export (PR 4).
 *
 * Records the exact composite the stage shows: the runtime's renderFrame is
 * the only renderer, so grade, fixes, overlay, burn-ins and the SWR mark all
 * come through unchanged — just at output resolution and through a
 * MediaRecorder instead of a visible canvas.
 *
 * Audio modes:
 *   original  the source element's own audio track (captureStream)
 *   mute      no audio track at all
 *   music     a local music file, decoded through WebAudio and fed from a
 *             MediaStreamDestination so it starts exactly with the capture
 *
 * MediaRecorder is realtime: a 40 s clip takes ~40 s. The page says so.
 *
 * Public API: window.SWR_CAMERA_ENHANCE_EXPORT.export(runtime, options)
 *   -> Promise<{ ok, name?, bytes?, error? }>
 */
(function () {
  'use strict';
  if (window.SWR_CAMERA_ENHANCE_EXPORT) return;

  const PREFERRED = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const m of PREFERRED) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* keep trying */ }
    }
    return '';
  }

  function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function buildAudioTracks(video, mode, musicFile) {
    if (mode === 'mute') return { tracks: [], cleanup: () => {} };
    if (mode === 'music' && musicFile) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return { tracks: [], cleanup: () => {} };
      const ctx = new AC();
      const dest = ctx.createMediaStreamDestination();
      const buf = await musicFile.arrayBuffer();
      const decoded = await new Promise((resolve, reject) => {
        ctx.decodeAudioData(buf.slice(0), resolve, reject);
      });
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.connect(dest);
      try { await ctx.resume(); } catch (e) { /* autoplay guard */ }
      return {
        tracks: dest.stream.getAudioTracks(),
        start: () => src.start(0),
        cleanup: () => { try { src.stop(); } catch (e) {} try { ctx.close(); } catch (e) {} },
      };
    }
    // original
    try {
      if (typeof video.captureStream === 'function') {
        const s = video.captureStream();
        return { tracks: s.getAudioTracks(), cleanup: () => {} };
      }
    } catch (e) { /* fall through to silence */ }
    return { tracks: [], cleanup: () => {} };
  }

  async function exportVideo(runtime, options) {
    const o = options || {};
    const st = runtime.getState ? runtime.getState() : null;
    if (!st || !st.ready) return { ok: false, error: 'not_ready' };
    const video = runtime.getVideo ? runtime.getVideo() : null;
    if (!video || !video.videoWidth) return { ok: false, error: 'not_ready' };
    const mime = pickMime();
    if (mime === null) return { ok: false, error: 'no_mediarecorder' };

    const duration = Number(video.duration) || 0;
    if (duration < 0.2) return { ok: false, error: 'too_short' };

    const onProgress = typeof o.onProgress === 'function' ? o.onProgress : () => {};

    // Output canvas at the state's format + quality, then render through the
    // runtime so the frame is identical to the stage's.
    const probe = document.createElement('canvas');
    const probeCtx = probe.getContext('2d');
    const first = runtime.renderFrame(probeCtx, {});
    if (!first) return { ok: false, error: 'render_failed' };
    const outW = first.outW;
    const outH = first.outH;
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');

    const fps = Math.min(60, Math.max(24, Math.round(1000 / 33)));
    const stream = canvas.captureStream(fps);
    const audio = await buildAudioTracks(video, o.audioMode || 'original', o.musicFile);
    audio.tracks.forEach((t) => stream.addTrack(t));

    let rec;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      audio.cleanup();
      return { ok: false, error: 'recorder_failed' };
    }

    const chunks = [];
    rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });

    const done = new Promise((resolve) => {
      rec.addEventListener('stop', () => resolve(new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] })));
    });

    const wasPlaying = !video.paused;
    runtime.pause();
    try { video.currentTime = 0; } catch (e) { /* fine */ }
    await new Promise((r) => setTimeout(r, 120));

    let raf = 0;
    let lastProgress = -1;
    const draw = () => {
      runtime.renderFrame(ctx, {});
      const t = video.currentTime || 0;
      const p = duration ? Math.min(1, t / duration) : 0;
      if (p - lastProgress > 0.01) { lastProgress = p; onProgress(p); }
      if (t < duration - 0.03 && !video.ended) raf = requestAnimationFrame(draw);
      else stop();
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { /* already stopped */ }
    };

    rec.start(250);
    if (audio.start) { try { audio.start(); } catch (e) { /* silent failure is acceptable */ } }
    try { await video.play(); } catch (e) { /* muted autoplay should be fine */ }
    raf = requestAnimationFrame(draw);

    // hard stop a beat after the clip ends in case 'ended' never fires
    const guard = setTimeout(stop, Math.ceil((duration + 2) * 1000));

    const blob = await done;
    clearTimeout(guard);
    audio.cleanup();
    if (!wasPlaying) runtime.pause();
    stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });

    if (!blob || !blob.size) return { ok: false, error: 'empty_recording' };
    const name = 'sainted-word-camera-enhance-' + outW + 'x' + outH + '-' + stamp() + '.webm';
    downloadBlob(blob, name);
    return { ok: true, name, bytes: blob.size, width: outW, height: outH, mime: mime || 'video/webm' };
  }

  window.SWR_CAMERA_ENHANCE_EXPORT = { export: exportVideo, pickMime };
})();
