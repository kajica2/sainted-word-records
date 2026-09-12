// lib/generated-audio.client.js — single seam between rendered MP3/M4A blobs
// and the SWR engine audio bus. No new dependencies.
//
//   SWR_GENERATED_AUDIO.importMp3(blob, { filename?, autoplay?, onProgress? })
//   SWR_GENERATED_AUDIO.fromUrl(url, opts?)
//   SWR_GENERATED_AUDIO.fromFile(file)
//   SWR_GENERATED_AUDIO.isAvailable()
//
// All paths funnel through SWR.Audio.load() so the engine's analyser,
// BPM detection, and captureStream() work on the imported track the same
// as on a manually-dropped file.
//
// Idempotent: re-evaluation returns the cached singleton.

(function () {
  'use strict';
  if (window.SWR_GENERATED_AUDIO) return;

  function ext(blob) {
    var t = (blob && blob.type) || '';
    if (t.indexOf('mp4') !== -1 || t.indexOf('m4a') !== -1) return 'm4a';
    if (t.indexOf('mpeg') !== -1 || t.indexOf('mp3') !== -1) return 'mp3';
    if (t.indexOf('wav') !== -1) return 'wav';
    if (t.indexOf('ogg') !== -1) return 'ogg';
    if (t.indexOf('webm') !== -1) return 'webm';
    return 'bin';
  }

  function safeFilename(blob, override) {
    if (override) return override;
    var ts = new Date().toISOString().replace(/[:.]/g, '-');
    return 'generated-' + ts + '.' + ext(blob);
  }

  // Resolve the load function the active Audio object exposes. The engine
  // uses loadFile(); the MVM bus (and earlier stand-ins) use load(). Either
  // is fine — we just call whatever's there.
  function resolveLoadFn() {
    var a = window.SWR && window.SWR.Audio;
    if (!a) return null;
    if (typeof a.loadFile === 'function') return a.loadFile.bind(a);
    if (typeof a.load === 'function') return a.load.bind(a);
    return null;
  }

  function isAvailable() {
    return resolveLoadFn() !== null;
  }

  function fromFile(file) {
    if (!isAvailable()) return Promise.reject({ unsupported: true });
    if (!(file instanceof Blob)) return Promise.reject({ invalid: 'not-a-blob' });
    var load = resolveLoadFn();
    load(file);
    return Promise.resolve(file);
  }

  function fromBlob(blob, opts) {
    opts = opts || {};
    var filename = safeFilename(blob, opts.filename);
    var file = new File([blob], filename, { type: (blob && blob.type) || 'audio/mpeg' });
    return fromFile(file).then(function (f) {
      if (opts.autoplay !== false && window.SWR.Audio.play) {
        try { window.SWR.Audio.play(); } catch (_) { /* engine may autoplay-gate */ }
      }
      return f;
    });
  }

  async function fromUrl(url, opts) {
    opts = opts || {};
    if (opts.onProgress) opts.onProgress('fetching', 0);
    var res;
    try { res = await fetch(url); }
    catch (_) { return Promise.reject({ cors: true }); }
    if (!res.ok) return Promise.reject({ http: res.status });
    var blob = await res.blob();
    if (opts.onProgress) opts.onProgress('decoding', 0.5);
    var f = await fromBlob(blob, opts);
    if (opts.onProgress) opts.onProgress('ready', 1);
    return f;
  }

  window.SWR_GENERATED_AUDIO = {
    isAvailable: isAvailable,
    fromFile: fromFile,
    importMp3: fromBlob,   // historical name — accepts any blob, not just mp3
    fromUrl: fromUrl,
  };
})();