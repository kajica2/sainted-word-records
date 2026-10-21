// client/swr-live-input.client.js
//
// SWRLiveInput — camera and microphone as engine inputs.
//
//   Camera → a live video layer in the composition. Shoot yourself into
//            the video and it reacts like any other layer.
//   Mic    → the engine hears you. The stream is routed into the engine's
//            own analyser, so the layers react to the room.
//
// The mic is deliberately NOT monitored to the speakers: a live mic
// feeding the composition and the speakers at the same time is a
// feedback loop. The engine already plays the song; the mic only adds
// to what the analyser hears.
//
// Requires swr-media-input.client.js (window.SWR_MEDIA_INPUT) loaded
// first. The picture and the level readout come from
// swr-camera-preview.client.js and swr-mic-meter.client.js, which are
// optional — without them the module still works, it just has no
// preview and no meter.
//
// Public API (window.SWR_LIVE_INPUT):
//   startCamera()   → Promise<{ ok, layerId?, error?, message? }>
//   stopCamera()
//   startMic()      → Promise<{ ok, routed?, error?, message? }>
//   stopMic()
//   toggleCamera()  → Promise<…>
//   toggleMic()     → Promise<…>
//   state()         → { camera, mic, layerId, message }
//   mount()         → attach the control to the page
//   unmount()       → detach it, and stop anything still running

(function () {
  'use strict';
  if (window.SWR_LIVE_INPUT) return;

  // A 1×1 transparent GIF, so the layers panel has something to show for
  // a live asset that has no file behind it.
  var BLANK_THUMB =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  var state = {
    media: null,
    cameraOn: false,
    micOn: false,
    cameraLayer: null,
    cameraEl: null,
    cameraHost: null,
    cameraPause: null,
    micSource: null,
    preview: null,
    meter: null,
    button: null,
    panel: null,
    statusEl: null,
    host: null,
  };

  // ---- plumbing ----------------------------------------------------------

  function mediaInput() {
    if (!state.media && window.SWR_MEDIA_INPUT) {
      state.media = window.SWR_MEDIA_INPUT.create();
    }
    return state.media;
  }

  function engine() {
    return (window.SWR && window.SWR.Layers) ? window.SWR : null;
  }

  function setStatus(text, isError) {
    if (!state.statusEl) return;
    state.statusEl.textContent = text || '';
    state.statusEl.style.color = isError ? '#ff6b6b' : '';
  }

  // ---- camera ------------------------------------------------------------

  function startCamera() {
    var mi = mediaInput();
    if (!mi) {
      return Promise.resolve({
        ok: false,
        error: 'NoMediaInput',
        message: 'swr-media-input.client.js is not loaded',
      });
    }
    return mi.startCamera().then(function (res) {
      if (!res.success) {
        setStatus(res.message || 'camera unavailable', true);
        return { ok: false, error: res.error, message: res.message };
      }
      var S = engine();
      if (!S) {
        mi.stopCamera();
        return { ok: false, error: 'NoEngine', message: 'this page has no engine' };
      }

      // A live <video> the engine can draw like any other video layer.
      var v = document.createElement('video');
      v.srcObject = res.stream;
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;

      // The engine pauses video clips while the transport is stopped —
      // right for a clip, wrong for a live source: a camera that freezes
      // when the song pauses is not a camera. A live element ignores
      // pause(); the original is restored when the layer is removed.
      var realPause = v.pause.bind(v);
      v.pause = function () {};
      state.cameraPause = function () {
        try {
          v.pause = realPause;
          v.pause();
        } catch (_) {}
      };

      // The element has to be IN the document. Chrome does not run a media
      // pipeline for a detached element, so a live camera that is never
      // attached sits at readyState 0 forever and never delivers a frame.
      // It is parked off-screen and invisible rather than display:none,
      // which would stop it rendering at all.
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;' +
        'opacity:0;pointer-events:none;z-index:-1';
      document.body.appendChild(v);
      state.cameraHost = v;

      var p = v.play();
      if (p && p.catch) p.catch(function () {});

      var asset = {
        id: 'live-camera',
        name: 'Camera',
        type: 'video',
        url: '',
        thumb: BLANK_THUMB,
        w: (res.resolution && res.resolution.width) || 1280,
        h: (res.resolution && res.resolution.height) || 720,
        _el: v,
        live: true,
      };
      S.Layers.add(asset);
      state.cameraLayer = S.Layers.list[S.Layers.list.length - 1] || null;
      // A new layer inherits a blend mode from the page's shuffle, and
      // some of them (multiply, and difference over black) make a live
      // feed invisible on a dark stage. A camera wants to be seen.
      if (state.cameraLayer) {
        state.cameraLayer.blend = 'screen';
        state.cameraLayer.opacity = 1;
        state.cameraLayer.baseScale = 1;
      }
      state.cameraEl = v;
      state.cameraOn = true;

      mountPreview();
      setStatus('camera on — live layer in the composition');
      return { ok: true, layerId: state.cameraLayer && state.cameraLayer.id };
    });
  }

  function stopCamera() {
    if (state.cameraLayer) {
      var S = engine();
      if (S) {
        var i = S.Layers.list.indexOf(state.cameraLayer);
        if (i >= 0) {
          S.Layers.list.splice(i, 1);
          if (typeof S.Layers.render === 'function') S.Layers.render();
        }
      }
      state.cameraLayer = null;
    }
    if (state.preview) {
      try { window.SWR_CAMERA_PREVIEW.unmount(state.preview.id); } catch (_) {}
      state.preview = null;
    }
    if (state.cameraPause) {
      state.cameraPause();
      state.cameraPause = null;
    }
    if (state.cameraEl) {
      try { state.cameraEl.srcObject = null; } catch (_) {}
      state.cameraEl = null;
    }
    if (state.cameraHost && state.cameraHost.parentNode) {
      state.cameraHost.parentNode.removeChild(state.cameraHost);
    }
    state.cameraHost = null;
    var mi = mediaInput();
    if (mi) mi.stopCamera();
    state.cameraOn = false;
    setStatus('camera off');
    return { ok: true };
  }

  // ---- microphone --------------------------------------------------------

  function startMic() {
    var mi = mediaInput();
    if (!mi) {
      return Promise.resolve({
        ok: false,
        error: 'NoMediaInput',
        message: 'swr-media-input.client.js is not loaded',
      });
    }
    // The device lookup behind startMic can stall; a mic that never comes
    // up should say so rather than hang.
    var timeout = new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ success: false, error: 'Timeout', message: 'the microphone did not start' });
      }, 10000);
    });
    return Promise.race([mi.startMic(), timeout]).then(function (res) {
      if (!res.success) {
        setStatus(res.message || 'microphone unavailable', true);
        return { ok: false, error: res.error, message: res.message };
      }

      // Route the mic into the engine's own analyser so the layers react
      // to the room as well as to the song.
      //
      // The analyser is named differently on the two surfaces: the shared
      // lib/audio.client.js calls it `analyser` and hangs off window.Audio
      // (engine.html), while a variant's inline engine calls it `an` and
      // hangs off window.SWR.Audio.
      //
      // A variant only builds its audio graph when a song is loaded, so
      // the graph has to be asked for before there is anything to route
      // into. unlock() is what the engine itself calls on the first play.
      var S = window.SWR;
      var A = (S && S.Audio) || window.Audio;
      if (A && !A.ctx && typeof A.unlock === 'function') {
        try { A.unlock(); } catch (e) { /* the graph stays closed */ }
      }
      var analyser = A && (A.an || A.analyser);
      var routed = false;
      if (A && A.ctx && analyser && typeof A.ctx.createMediaStreamSource === 'function') {
        try {
          state.micSource = A.ctx.createMediaStreamSource(res.stream);
          state.micSource.connect(analyser);
          routed = true;
        } catch (e) {
          state.micSource = null;
        }
      }

      state.micOn = true;
      mountMeter(res.analyser);
      setStatus(routed
        ? 'mic on — the engine is listening'
        : 'mic on — level only (this page has no engine analyser)');
      return { ok: true, routed: routed };
    });
  }

  function stopMic() {
    if (state.micSource) {
      try { state.micSource.disconnect(); } catch (_) {}
      state.micSource = null;
    }
    if (state.meter) {
      try { window.SWR_MIC_METER.unmount(state.meter.id); } catch (_) {}
      state.meter = null;
    }
    var mi = mediaInput();
    if (mi) mi.stopMic();
    state.micOn = false;
    setStatus('mic off');
    return { ok: true };
  }

  // ---- the optional picture and meter ------------------------------------

  function mountPreview() {
    if (state.preview || !window.SWR_CAMERA_PREVIEW) return;
    var host = document.getElementById('swr-live-cam-host');
    if (!host) return;
    try {
      state.preview = window.SWR_CAMERA_PREVIEW.mount(host, {
        mediaInput: state.media,
        size: 'small',
        showControls: false,
      });
    } catch (e) { state.preview = null; }
  }

  function mountMeter(analyser) {
    if (state.meter || !window.SWR_MIC_METER) return;
    var host = document.getElementById('swr-live-mic-host');
    if (!host) return;
    try {
      state.meter = window.SWR_MIC_METER.mount(host, { analyser: analyser });
    } catch (e) { state.meter = null; }
  }

  // ---- the control -------------------------------------------------------

  function findHost() {
    return document.querySelector('aside.lib .head') ||
      document.querySelector('aside#library .panel-head') ||
      document.querySelector('#media .head') ||
      null;
  }

  function buildPanel() {
    var panel = document.createElement('div');
    panel.id = 'swr-live-input';
    panel.style.cssText = [
      'padding:8px 10px',
      'border-bottom:1px solid rgba(255,255,255,0.08)',
      'display:none',
    ].join(';');

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:flex-start';

    var camHost = document.createElement('div');
    camHost.id = 'swr-live-cam-host';
    camHost.style.cssText = 'width:132px;flex:none;min-height:22px';

    var micHost = document.createElement('div');
    micHost.id = 'swr-live-mic-host';
    micHost.style.cssText = 'flex:1;min-width:0;min-height:22px';

    var buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex:none';

    var camBtn = document.createElement('button');
    camBtn.type = 'button';
    camBtn.className = 'tbtn';
    camBtn.textContent = 'Camera';
    camBtn.style.cssText = 'font-size:9px;padding:3px 8px;white-space:nowrap';
    camBtn.addEventListener('click', function () { toggleCamera(); });

    var micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.className = 'tbtn';
    micBtn.textContent = 'Mic';
    micBtn.style.cssText = 'font-size:9px;padding:3px 8px;white-space:nowrap';
    micBtn.addEventListener('click', function () { toggleMic(); });

    buttons.appendChild(camBtn);
    buttons.appendChild(micBtn);

    row.appendChild(camHost);
    row.appendChild(micHost);
    row.appendChild(buttons);

    var status = document.createElement('div');
    status.style.cssText = 'font-size:9px;color:#8a7aa0;margin-top:6px;line-height:1.4';
    status.textContent = 'Camera becomes a live layer. Mic is heard by the engine.';

    panel.appendChild(row);
    panel.appendChild(status);
    state.statusEl = status;
    state.panel = panel;
    return panel;
  }

  function mount() {
    if (state.button) return;
    var host = findHost();
    if (!host) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tbtn';
    btn.textContent = 'Live';
    btn.title = 'Camera and microphone input';
    btn.style.cssText = 'font-size:9px;padding:3px 8px;margin-left:2px';
    btn.addEventListener('click', function () {
      if (!state.panel) {
        var panel = buildPanel();
        if (host.parentNode) host.parentNode.insertBefore(panel, host.nextSibling);
      }
      var open = state.panel.style.display === 'none';
      state.panel.style.display = open ? 'block' : 'none';
      btn.classList.toggle('is-on', open);
    });

    host.appendChild(btn);
    state.button = btn;
    state.host = host;
  }

  function unmount() {
    if (state.cameraOn) stopCamera();
    if (state.micOn) stopMic();
    if (state.button && state.button.parentNode) {
      state.button.parentNode.removeChild(state.button);
    }
    if (state.panel && state.panel.parentNode) {
      state.panel.parentNode.removeChild(state.panel);
    }
    state.button = null;
    state.panel = null;
    state.statusEl = null;
  }

  // ---- actions -----------------------------------------------------------

  function toggleCamera() {
    return state.cameraOn ? (stopCamera(), Promise.resolve({ ok: true })) : startCamera();
  }

  function toggleMic() {
    return state.micOn ? (stopMic(), Promise.resolve({ ok: true })) : startMic();
  }

  var api = {
    startCamera: startCamera,
    stopCamera: stopCamera,
    startMic: startMic,
    stopMic: stopMic,
    toggleCamera: toggleCamera,
    toggleMic: toggleMic,
    state: function () {
      return {
        camera: state.cameraOn,
        mic: state.micOn,
        routed: !!state.micSource,
        layerId: state.cameraLayer ? state.cameraLayer.id : null,
        message: state.statusEl ? state.statusEl.textContent : '',
      };
    },
    mount: mount,
    unmount: unmount,
  };

  window.SWR_LIVE_INPUT = api;

  // The engine's media panel exists once the page has booted, so the
  // control goes in when it does.
  function attach() {
    if (state.button) return;
    if (findHost()) mount();
    else setTimeout(attach, 400);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }
})();
