// lib/song-video-layer.client.js — the song's own video, on the stage.
//
// A video file loaded as the song is decoded through a <video> element
// (lib/audio.client.js:_isVideoFile) and its audio is routed into the Web
// Audio graph. The picture used to be thrown away: the element sat off-screen
// at 1x1 px, and the stage showed nothing but the library layers.
//
// This module puts that picture on the stage, as a layer whose media element
// IS the song's element — not a second copy of it.
//
// Why the same element:
//
//   A second element would be a second clock. Its position would have to be
//   corrected against the audio's every frame, and every seek would have to
//   be pushed to it as well. The two would drift, and drift is exactly what
//   a music video must not have.
//
//   The song's element IS the audio's clock. Sharing it makes the sync
//   structural rather than corrective: play, pause, seek, rate and end all
//   move the picture and the sound together, because they are one element.
//   No second decoder, no correction pass, nothing that can disagree — and
//   the exported file (the recorder captures the stage canvas and the same
//   audio graph) inherits that sync for free.
//
// The transport already drives that element — Audio.play / pause / seek all
// act on Audio.audioEl — so the renderer must NOT also drive it. The
// SWR_VIDEO_SYNC helper's stalled-element recovery calls el.load(), which
// would restart the song from zero. The engine's draw path checks
// asset.songBound and leaves the element alone.
//
// Wiring: lib/audio.client.js ends loadFile() with
//   if (typeof window.__swrOnSongLoaded === 'function') window.__swrOnSongLoaded(file, this);
// This module subscribes to that seam by chaining onto whatever is already
// installed, so it cannot clobber another subscriber (lib/auto-setup.client.js
// claims the same seam, and is currently loaded by no page). The chain only
// survives a subscriber that REPLACES the function, so if a page ever loads
// auto-setup as well, this module has to be loaded after it.
//
// Public API (window.SWR_SONG_VIDEO_LAYER):
//   layer()   — the song-video layer currently on the stack, or null
//   remove()  — take the song-video layer off the stack
//   enabled   — false disables the behaviour (the song still plays)

(function () {
  'use strict';
  if (window.__SWR_SONG_VIDEO_LAYER__) return;
  window.__SWR_SONG_VIDEO_LAYER__ = true;

  // The asset id is a string, so it can never collide with a library item's
  // numeric id (lib/library.client.js hands out `this.nextId++`).
  var ASSET_ID = 'song-video';

  function audioApi() {
    if (window.SWR && window.SWR.Audio) return window.SWR.Audio;
    return window.Audio || null;
  }

  function layersApi() {
    return window.Layers || null;
  }

  // The song's <video> element, or null when the song is audio-only.
  function songElement(audio) {
    var el = audio && audio.audioEl;
    if (!el || el.tagName !== 'VIDEO') return null;
    return el;
  }

  // The song-video layer currently on the stack, or null.
  function songLayer() {
    var L = layersApi();
    if (!L || !Array.isArray(L.list)) return null;
    for (var i = 0; i < L.list.length; i++) {
      var a = L.list[i] && L.list[i].asset;
      if (a && a.songBound) return L.list[i];
    }
    return null;
  }

  function remove() {
    var layer = songLayer();
    if (!layer) return false;
    var L = layersApi();
    if (!L || typeof L.remove !== 'function') return false;
    L.remove(layer.id);
    return true;
  }

  // Poster frame for the layer panel. The element may not have decoded a
  // frame yet when the song loads, so wait for 'loadeddata'.
  function captureThumb(el, asset) {
    try {
      if (el.readyState < 2 || !el.videoWidth || !el.videoHeight) return;
      var w = el.videoWidth, h = el.videoHeight;
      var s = Math.min(1, 160 / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * s));
      c.height = Math.max(1, Math.round(h * s));
      c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
      asset.thumb = c.toDataURL('image/jpeg', 0.6);
      var L = layersApi();
      if (L && typeof L.render === 'function') L.render();
    } catch (_) {
      // A poster frame is a nicety, not a requirement — the layer draws
      // without one.
    }
  }

  function onSongLoaded(file, audio) {
    // A new song replaces the old one. Drop the previous song-video layer
    // first: loadFile() has already detached and reloaded that element, so
    // the old layer now points at a dead video.
    remove();
    if (!file) return;
    if (window.SWR_SONG_VIDEO_LAYER && window.SWR_SONG_VIDEO_LAYER.enabled === false) return;
    var A = audio || audioApi();
    var el = songElement(A);
    if (!el) return;   // an audio song has no picture to put on the stage

    var asset = {
      id: ASSET_ID,
      name: file.name || 'song',
      type: 'video',
      url: el.currentSrc || el.src || '',
      w: 0, h: 0, duration: 0,
      motion: 0, luma: 0.5, hue: 0,
      rotation: 0,
      thumb: null,
      // The transport owns this element: it is the song's own <video>, so
      // the engine's draw path must not drive it (see the file header).
      songBound: true,
      _el: el,
    };

    var L = layersApi();
    if (!L || typeof L.add !== 'function') return;
    L.add(asset);

    var layer = songLayer();
    if (layer) {
      // A predictable base layer: the video IS the picture, so it covers the
      // stage and is not blended away. The index-based picks inside
      // Layers.add() (blend / scale / reactors) are shaped for library media.
      layer.blend = 'source-over';
      layer.baseScale = 1;
    }

    if (el.readyState >= 2) captureThumb(el, asset);
    else el.addEventListener('loadeddata', function () { captureThumb(el, asset); }, { once: true });
  }

  window.SWR_SONG_VIDEO_LAYER = {
    enabled: true,
    layer: songLayer,
    remove: remove,
    // Exposed for tests + diagnostics.
    onSongLoaded: onSongLoaded,
  };

  // Subscribe to the song-loaded seam. Chain rather than replace, so another
  // subscriber of the same seam keeps working.
  var prev = window.__swrOnSongLoaded;
  window.__swrOnSongLoaded = function (file, audio) {
    if (typeof prev === 'function' && !prev.__swrSongVideoLayer) {
      try { prev(file, audio); } catch (e) {
        console.warn('[song-video-layer] previous song hook failed', e);
      }
    }
    try { onSongLoaded(file, audio); } catch (e) {
      console.warn('[song-video-layer] onSongLoaded failed', e);
    }
  };
  window.__swrOnSongLoaded.__swrSongVideoLayer = true;
})();
