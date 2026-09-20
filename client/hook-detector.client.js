// client/hook-detector.client.js
//
// Hook / drop detector + clip exporter. Detects the first major energy
// spike after the 8-second intro window and snaps it to the nearest
// onset. Exports teaser (3s pre-drop), hook (5s pre-drop), or full
// 15s clip as a watermarked MP4/WebM via SWR_RECORDER.
//
// Extracted from versions/music_video.html:2621-2759 (Phase 1b).
//
// Public API on window.SWR_HOOK_DETECTOR:
//   detect()             → { ok, result? | reason }
//   exportHook(preset)   → { ok, filename? | reason }   preset ∈ teaser|hook|clip
//   lastResult           Latest detection result (or null)
//
// Requires: window.SWR_LAST_SONG, window.AudioAnalysisV2,
//           window.SWR_RECORDER, window.A.el (audio element).

(function () {
  'use strict';
  if (window.SWR_HOOK_DETECTOR) return;

  function setStatus(msg, kind) {
    if (typeof window.setStatus === 'function') window.setStatus(msg, kind);
  }

  function hookDownloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  var detector = {
    lastResult: null,

    detect: async function () {
      var blob;
      try {
        var song = await window.SWR_LAST_SONG;
        if (song && song.blob) blob = song.blob;
      } catch (_) {}
      if (!blob) return { ok: false, reason: 'no song loaded' };

      var audioBuffer;
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        var audioCtx = new Ctx();
        audioBuffer = await audioCtx.decodeAudioData(await blob.arrayBuffer());
      } catch (e) {
        return { ok: false, reason: 'decode failed: ' + e.message };
      }

      var onsets = [];
      if (window.AudioAnalysisV2 && window.AudioAnalysisV2.analyzeBuffer) {
        try {
          var analysis = window.AudioAnalysisV2.analyzeBuffer(audioBuffer);
          onsets = (analysis && analysis.onsets) || [];
        } catch (_) {}
      }

      var sampleRate = audioBuffer.sampleRate;
      var samples = audioBuffer.getChannelData(0);
      var win = Math.floor(sampleRate * 0.02);
      var hop = Math.floor(sampleRate * 0.01);
      var nFrames = Math.max(1, Math.floor(samples.length / hop));
      var energies = new Float32Array(nFrames);
      for (var f = 0; f < nFrames; f++) {
        var start = f * hop;
        var sum = 0;
        for (var j = 0; j < win && start + j < samples.length; j++) {
          var s = samples[start + j];
          sum += s * s;
        }
        energies[f] = Math.sqrt(sum / win);
      }

      var introFrames = Math.min(nFrames, Math.floor(8 * sampleRate / hop));
      var introMean = 0;
      for (var i = 0; i < introFrames; i++) introMean += energies[i];
      introMean /= introFrames;

      var dropFrame = -1;
      for (var i2 = introFrames; i2 < nFrames; i2++) {
        if (energies[i2] > 2 * introMean) { dropFrame = i2; break; }
      }
      if (dropFrame < 0) {
        this.lastResult = null;
        return { ok: false, reason: 'no drop detected (no spike > 2× intro)' };
      }

      var dropTime = (dropFrame * hop) / sampleRate;
      var energyRatio = energies[dropFrame] / Math.max(introMean, 1e-6);

      var snapped = dropTime;
      if (onsets.length > 0) {
        var bestDelta = Infinity;
        for (var oi = 0; oi < onsets.length; oi++) {
          var delta = onsets[oi] - dropTime;
          if (Math.abs(delta) < Math.abs(bestDelta)) bestDelta = delta;
        }
        if (Math.abs(bestDelta) < 0.2) snapped = dropTime + bestDelta;
      }

      var result = {
        time: Math.round(snapped * 100) / 100,
        confidence: 0.85,
        energy: Math.round(energyRatio * 100) / 100,
        label: 'Drop 1',
        introMean: Math.round(introMean * 1000) / 1000,
      };
      this.lastResult = result;
      return { ok: true, result: result };
    },

    exportHook: async function (preset) {
      if (!this.lastResult) return { ok: false, reason: 'no drop detected; run detect() first' };
      if (!window.A || !window.A.el) return { ok: false, reason: 'no audio element' };
      var r = this.lastResult;
      var startTime, duration;
      if (preset === 'teaser') { startTime = Math.max(0, r.time - 3); duration = 3; }
      else if (preset === 'hook') { startTime = Math.max(0, r.time - 5); duration = 5; }
      else if (preset === 'clip') { startTime = 0; duration = 15; }
      else { return { ok: false, reason: 'unknown preset: ' + preset }; }

      if (!window.SWR_RECORDER || !window.SWR_RECORDER.start) {
        return { ok: false, reason: 'SWR_RECORDER not loaded' };
      }
      var stage = document.getElementById('render');
      if (!stage) return { ok: false, reason: 'no render canvas' };

      try { window.A.el.currentTime = startTime; } catch (_) {}

      var rec;
      try {
        rec = window.SWR_RECORDER.start({
          canvas: stage,
          audioSource: window.A.el,
          audioSampleRate: 44100,
          audioNumberOfChannels: 2,
          width: stage.width,
          height: stage.height,
          fps: 30,
          videoBitsPerSecond: 2000000,
        });
      } catch (e) {
        return { ok: false, reason: 'record failed: ' + e.message };
      }

      setStatus('recording ' + preset + ' (' + duration + 's)…', 'ok');
      await new Promise(function (res) { setTimeout(res, duration * 1000 + 200); });
      var result = await window.SWR_RECORDER.stop();
      if (!result || !result.blob) {
        return { ok: false, reason: 'no recording produced' };
      }

      var ext = (result.mime || 'video/mp4').includes('webm') ? 'webm' : 'mp4';
      var filename = preset + '-' + Math.round(r.time * 100) / 100 + 's.' + ext;
      hookDownloadBlob(result.blob, filename);
      setStatus('downloaded ' + filename + ' (' + Math.round(result.blob.size / 1024) + ' KB)', 'ok');
      return { ok: true, filename: filename };
    },
  };

  window.SWR_HOOK_DETECTOR = detector;
})();