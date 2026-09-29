// client/swr-tiktok-export.client.js — recording pipeline for /tiktok (PR 3 of 4).
//
// Contract:
//   window.SWR_TIKTOK_EXPORT.export(canvas, audioEl, options)
//     -> Promise<{ blob, url, duration, size, filename }>
//     options: { type: 'teaser'|'hook'|'clip'|'behind', startS, endS, hookTime,
//                fps = 30, bitrate = 8000000, onProgress({progress, elapsed, total}) }
//
// The canvas is captured as-is, which is the point: the runtime draws the SWR
// watermark into it (layer 6), so what the user sees is what the file holds.
//
// Audio routing: audioEl.captureStream() is not a real API. The element is
// routed through AudioContext.createMediaElementSource -> createMediaStreamDestination.
// That call may only be made ONCE per element, so this module reuses the graph
// the runtime publishes on window.SWR_TIKTOK_AUDIO when it exists, and otherwise
// builds its own behind a registry guard.
(function () {
  'use strict';
  if (window.SWR_TIKTOK_EXPORT) return;

  var LENGTHS = { teaser: 3, hook: 5, clip: 15, behind: 60 };
  var TAIL_MS = 120;                       // let the last frame land before stop()

  function pickMime() {
    var candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < candidates.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return 'video/webm';
  }

  // ---- audio ---------------------------------------------------------------
  function buildAudioStream(audioEl) {
    if (!audioEl) return { stream: null, cleanup: function () {} };
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return { stream: null, cleanup: function () {} };

    var shared = window.SWR_TIKTOK_AUDIO;
    if (shared && shared.ctx && shared.source) {
      var dest = shared.ctx.createMediaStreamDestination();
      shared.source.connect(dest);
      return {
        stream: dest.stream,
        cleanup: function () { try { shared.source.disconnect(dest); } catch (e) {} }
      };
    }
    // No runtime graph: build one, remembering the node per element (a second
    // createMediaElementSource on the same element throws InvalidStateError).
    var reg = window.__swrMediaElementSources || (window.__swrMediaElementSources = new WeakMap());
    var entry = reg.get(audioEl);
    var ctx, source;
    if (entry) { ctx = entry.ctx; source = entry.source; }
    else {
      ctx = new AC();
      source = ctx.createMediaElementSource(audioEl);
      reg.set(audioEl, { ctx: ctx, source: source });
    }
    var d2 = ctx.createMediaStreamDestination();
    source.connect(d2);
    return {
      stream: d2.stream,
      cleanup: function () { try { source.disconnect(d2); } catch (e) {} }
    };
  }

  // ---- export --------------------------------------------------------------
  function exportVideo(canvas, audioEl, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      if (!canvas || typeof canvas.captureStream !== 'function') { reject(new Error('no canvas to capture')); return; }
      if (!window.MediaRecorder) { reject(new Error('MediaRecorder is not available in this browser')); return; }

      var type = LENGTHS[options.type] ? options.type : 'clip';
      var want = LENGTHS[type];
      var fps = options.fps || 30;
      var bitrate = options.bitrate || 8000000;
      var onProgress = typeof options.onProgress === 'function' ? options.onProgress : function () {};

      // Where to start: teaser/hook open on the hook when we have one.
      var start = Math.max(0, options.startS || 0);
      if ((type === 'teaser' || type === 'hook') && options.hookTime > 0) {
        start = Math.max(start, options.hookTime - 0.4);
      }
      var end = options.endS > 0 ? options.endS : start + want;
      var total = Math.max(0.5, Math.min(want, end - start));

      var audioSink = buildAudioStream(audioEl);
      var videoStream;
      try { videoStream = canvas.captureStream(fps); }
      catch (e) { audioSink.cleanup(); reject(e); return; }

      var tracks = [];
      videoStream.getVideoTracks().forEach(function (t) { tracks.push(t); });
      if (audioSink.stream) audioSink.stream.getAudioTracks().forEach(function (t) { tracks.push(t); });
      var stream = new MediaStream(tracks);

      var mime = pickMime();
      var rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate }); }
      catch (e) { teardown(); reject(e); return; }

      var chunks = [];
      var stopTimer = 0, progressTimer = 0, startedAt = 0, wasPlaying = false, prevTime = 0;

      function teardown() {
        clearTimeout(stopTimer);
        clearInterval(progressTimer);
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        audioSink.cleanup();
      }

      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };

      rec.onerror = function (e) { teardown(); reject(e.error || new Error('recorder error')); };

      rec.onstop = function () {
        clearInterval(progressTimer);
        var blob = new Blob(chunks, { type: mime });
        var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        var filename = 'sainted-word-tiktok-' + type + '-' + stamp + '.webm';
        var url = URL.createObjectURL(blob);
        // hand the file to the user
        try {
          var a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        } catch (e) { /* the returned url still works */ }
        // restore the transport
        if (audioEl) {
          try {
            audioEl.pause();
            audioEl.currentTime = prevTime;
            if (wasPlaying) audioEl.play().catch(function () {});
          } catch (e) {}
        }
        teardown();
        resolve({ blob: blob, url: url, duration: total, size: blob.size, filename: filename, mime: mime });
      };

      // Seek, then record. The recorder starts one animation frame AFTER the
      // stream exists: a canvas captureStream sampled in the same task can hand
      // the encoder a pre-paint frame (measured as a black opening frame), and
      // the stream frames emitted before start() are simply not recorded.
      if (audioEl) {
        prevTime = audioEl.currentTime || 0;
        wasPlaying = !audioEl.pause;
        try { audioEl.currentTime = start; } catch (e) {}
      }
      requestAnimationFrame(function () {
        if (audioEl) { var p = audioEl.play(); if (p && p.catch) p.catch(function () {}); }
        rec.start(250);
        startedAt = performance.now();
        stopTimer = setTimeout(function () {
          if (rec.state !== 'inactive') rec.stop();
        }, total * 1000 + TAIL_MS);
        progressTimer = setInterval(function () {
          var elapsed = (performance.now() - startedAt) / 1000;
          onProgress({ progress: Math.max(0, Math.min(1, elapsed / total)), elapsed: elapsed, total: total });
        }, 200);
      });
    });
  }

  window.SWR_TIKTOK_EXPORT = { export: exportVideo, LENGTHS: LENGTHS, pickMime: pickMime };
})();
