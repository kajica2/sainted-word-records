// client/swr-camera-preview.client.js
//
// SWRCameraPreview — reusable camera preview UI component. Wraps a
// <video> + overlay controls (switch, mute, LIVE indicator, optional
// face guide) on top of SWRMediaInput. Reusable across Spit Live (PR 2
// of the 4-PR live-camera-mic sequence), TikTok Studio (PR 3), and any
// future surface that needs a live camera preview.
//
// Public API (window.SWR_CAMERA_PREVIEW):
//   mount(target, options)   → { id, mediaInput, videoEl, controls }
//                                target may be an HTMLElement or CSS selector.
//   unmount(targetOrId)      → boolean (true if a mount was removed)
//
// Size constants: SIZE_SMALL 160x120, SIZE_MEDIUM 320x240 (default),
// SIZE_LARGE 480x360, SIZE_FULL 100%/16:9.
//
// Lifecycle contract:
//   - If you pass options.mediaInput (your own SWRMediaInput instance),
//     the preview does NOT own it. unmount() still calls stopCamera()
//     so the device light goes off, but the instance stays alive for
//     the caller to reuse or destroy.
//   - If you omit options.mediaInput, the preview creates one via
//     window.SWR_MEDIA_INPUT.create(), owns it, and destroy()s it on
//     unmount. Lets callers drop the preview in standalone without
//     managing two lifecycles.
//
// Browser-only. The mounted <video> sets autoplay + playsinline + muted
// per PRD §3 line 390.

(function () {
  'use strict';
  if (window.SWR_CAMERA_PREVIEW) return;

  // ---- Constants ---------------------------------------------------------
  var SIZE_SMALL = 'small';
  var SIZE_MEDIUM = 'medium';
  var SIZE_LARGE = 'large';
  var SIZE_FULL = 'full';

  var CLASS_PREVIEW = 'swr-camera-preview';
  var CLASS_FEED = 'swr-camera-feed';
  var CLASS_CONTROLS = 'swr-camera-controls';
  var CLASS_BTN = 'swr-cam-btn';
  var CLASS_INDICATOR = 'swr-cam-indicator';
  var CLASS_FACE_GUIDE = 'swr-face-guide';

  var SIZE_CLASS_PREFIX = 'swr-cam-';
  var STYLE_ELEMENT_ID = 'swr-camera-preview-style';

  // ---- State (closure-scoped) -------------------------------------------
  // Mount registry. id → { wrapperEl, mediaInput, ownedInput, videoEl }
  // Kept here (not on the instance) so unmount can find + clean up.
  var _mounts = {};
  var _mountCounter = 0;
  var _styleEl = null;

  // ---- Helpers -----------------------------------------------------------
  function _warn(msg, err) {
    if (typeof console !== 'undefined' && console && console.warn) {
      console.warn(msg, err || '');
    }
  }

  // Resolve a target spec to an HTMLElement. Accepts an element directly
  // or a CSS selector. Returns null on miss.
  function _getTarget(target) {
    if (!target) return null;
    if (typeof target === 'string') {
      if (typeof document === 'undefined') return null;
      try { return document.querySelector(target); }
      catch (_) { return null; }
    }
    if (typeof target === 'object' && target && target.nodeType === 1) return target;
    return null;
  }

  function _nextMountId() {
    _mountCounter += 1;
    return 'swrcp-' + _mountCounter;
  }

  function _normalizeSize(size) {
    return size === SIZE_SMALL || size === SIZE_LARGE || size === SIZE_FULL
      ? size
      : SIZE_MEDIUM;
  }

  // CSS injected once into <head>. Mirrors the capture-runtime pattern
  // (client/capture-runtime.client.js:246-252). Idempotent.
  function _injectStyles() {
    if (_styleEl) return;
    if (typeof document === 'undefined' || !document.head) return;
    _styleEl = document.createElement('style');
    _styleEl.id = STYLE_ELEMENT_ID;
    _styleEl.textContent = PREVIEW_CSS;
    document.head.appendChild(_styleEl);
  }

  // Build the wrapper element + children. DOM shape mirrors PRD §3
  // lines 388-410 (camera-feed / camera-controls / cam-btn / cam-indicator
  // / rec-dot / face-guide / guide-frame / guide-text), prefixed so
  // tests + page CSS don't collide.
  function _buildDOM(options) {
    var wrapper = document.createElement('div');
    var size = _normalizeSize(options.size);
    wrapper.className = CLASS_PREVIEW + ' ' + SIZE_CLASS_PREFIX + size;

    var video = document.createElement('video');
    video.className = CLASS_FEED + (options.mirrored ? ' mirrored' : '');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    wrapper.appendChild(video);

    var controls = null;
    if (options.showControls !== false) {
      controls = document.createElement('div');
      controls.className = CLASS_CONTROLS;

      var switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = CLASS_BTN;
      switchBtn.setAttribute('data-action', 'switch');
      switchBtn.setAttribute('title', 'Switch camera');
      switchBtn.setAttribute('aria-label', 'Switch camera');
      switchBtn.textContent = '🔄';
      controls.appendChild(switchBtn);

      var muteBtn = document.createElement('button');
      muteBtn.type = 'button';
      muteBtn.className = CLASS_BTN;
      muteBtn.setAttribute('data-action', 'mute');
      muteBtn.setAttribute('title', 'Toggle video');
      muteBtn.setAttribute('aria-label', 'Toggle video');
      muteBtn.textContent = '📹';
      controls.appendChild(muteBtn);

      var indicator = document.createElement('div');
      indicator.className = CLASS_INDICATOR;
      var dot = document.createElement('span');
      dot.className = 'swr-cam-rec-dot';
      indicator.appendChild(dot);
      indicator.appendChild(document.createTextNode(' LIVE'));
      controls.appendChild(indicator);

      wrapper.appendChild(controls);
    }

    var faceGuide = null;
    if (options.showFaceGuide) {
      faceGuide = document.createElement('div');
      faceGuide.className = CLASS_FACE_GUIDE + ' active';
      var frame = document.createElement('div');
      frame.className = 'swr-face-guide-frame';
      var txt = document.createElement('div');
      txt.className = 'swr-face-guide-text';
      txt.textContent = 'Center your face';
      faceGuide.appendChild(frame);
      faceGuide.appendChild(txt);
      wrapper.appendChild(faceGuide);
    }

    return {
      wrapper: wrapper,
      video: video,
      controls: controls,
      indicator: controls ? controls.querySelector('.' + CLASS_INDICATOR) : null,
      faceGuide: faceGuide,
    };
  }

  // Attach the mediaInput's current video stream to the <video> element.
  // Calls play() because the autoplay attribute alone isn't reliable on
  // programmatic attach (Safari, mobile). Swallows play() rejection —
  // many browsers throw NotAllowedError until user gesture.
  function _attachStream(videoEl, mediaInput) {
    if (!videoEl || !mediaInput) return;
    var stream = mediaInput._video && mediaInput._video.stream;
    if (stream) {
      try { videoEl.srcObject = stream; }
      catch (_) {
        try { videoEl.srcObject = null; videoEl.srcObject = stream; }
        catch (_) {}
      }
    }
    try {
      var p = videoEl.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (_) {}
  }

  // Wire the overlay buttons (switch + mute) and the LIVE indicator
  // listener. loadedmetadata fires once <video> has dimensions, which
  // is our signal the stream is live.
  function _wireControls(handles, mediaInput, options) {
    var videoEl = handles.video;

    if (options.showLiveIndicator !== false && handles.indicator) {
      videoEl.addEventListener('loadedmetadata', function () {
        var stream = mediaInput._video && mediaInput._video.stream;
        var tracks = stream && stream.getVideoTracks ? stream.getVideoTracks() : [];
        if (tracks.length > 0) handles.indicator.classList.add('active');
      });
    }

    if (!handles.controls) return;
    var btns = handles.controls.querySelectorAll('.' + CLASS_BTN);
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var action = btn.getAttribute('data-action');
          if (action === 'switch') {
            if (handles.indicator) handles.indicator.classList.remove('active');
            if (mediaInput && typeof mediaInput.switchCamera === 'function') {
              mediaInput.switchCamera().then(function (res) {
                if (res && res.success && res.stream) {
                  try { videoEl.srcObject = res.stream; } catch (_) {}
                  try {
                    var p = videoEl.play();
                    if (p && typeof p.catch === 'function') p.catch(function () {});
                  } catch (_) {}
                  return;
                }
                if (typeof options.onError === 'function') {
                  options.onError({
                    error: (res && res.error) || 'SwitchFailed',
                    message: (res && res.message) || 'switchCamera returned failure'
                  });
                } else {
                  _warn('swr-camera-preview: switchCamera failed', res);
                }
              }).catch(function (err) {
                if (typeof options.onError === 'function') {
                  options.onError({ error: 'Error', message: String((err && err.message) || err) });
                } else {
                  _warn('swr-camera-preview: switchCamera rejected', err);
                }
              });
            }
          } else if (action === 'mute') {
            // Toggle visibility only — keep the stream alive so unmute
            // is instant. PRD §3 line 397: "Toggle video".
            videoEl.style.display = videoEl.style.display === 'none' ? '' : 'none';
          }
        });
      })(btns[i]);
    }
  }

  // ---- Public: mount(target, options) ------------------------------------
  function mount(target, options) {
    options = options || {};
    var host = _getTarget(target);
    if (!host) { _warn('swr-camera-preview: target not found', target); return null; }
    if (typeof document === 'undefined') { _warn('swr-camera-preview: document unavailable'); return null; }

    _injectStyles();

    // Resolve mediaInput. Auto-create when omitted — caller-managed
    // when passed. Owns only what we create.
    var mediaInput = options.mediaInput || null;
    var ownedInput = false;
    if (!mediaInput) {
      if (!window.SWR_MEDIA_INPUT || typeof window.SWR_MEDIA_INPUT.create !== 'function') {
        _warn('swr-camera-preview: SWR_MEDIA_INPUT not available; cannot auto-create mediaInput');
        return null;
      }
      mediaInput = window.SWR_MEDIA_INPUT.create({});
      ownedInput = true;
    }

    var handles = _buildDOM({
      size: options.size,
      mirrored: options.mirrored !== false,
      showControls: options.showControls,
      showFaceGuide: options.showFaceGuide,
    });

    host.appendChild(handles.wrapper);

    var id = _nextMountId();
    _mounts[id] = {
      wrapperEl: handles.wrapper,
      mediaInput: mediaInput,
      ownedInput: ownedInput,
      videoEl: handles.video,
    };

    _wireControls(handles, mediaInput, options);

    // autoStart flow: pre-attach any pre-existing stream, then call
    // startCamera() and re-attach once the new stream lands.
    if (options.autoStart !== false) {
      _attachStream(handles.video, mediaInput);
      if (typeof mediaInput.startCamera === 'function') {
        mediaInput.startCamera().then(function (res) {
          if (!res || !res.success) {
            if (typeof options.onError === 'function') {
              options.onError({ error: (res && res.error) || 'Error', message: (res && res.message) || 'startCamera failed' });
            } else {
              _warn('swr-camera-preview: startCamera failed', res);
            }
            return;
          }
          _attachStream(handles.video, mediaInput);
        });
      }
    } else {
      // Caller will start the stream themselves. Still pre-attach if
      // mediaInput already has one (caller re-used an instance).
      _attachStream(handles.video, mediaInput);
    }

    return {
      id: id,
      mediaInput: mediaInput,
      videoEl: handles.video,
      controls: handles.controls,
    };
  }

  // ---- Public: unmount(targetOrId) ---------------------------------------
  function unmount(targetOrId) {
    var id = null;
    if (typeof targetOrId === 'string') {
      id = targetOrId;
    } else {
      for (var k in _mounts) {
        if (Object.prototype.hasOwnProperty.call(_mounts, k) && _mounts[k].wrapperEl === targetOrId) {
          id = k;
          break;
        }
      }
    }

    if (!id || !Object.prototype.hasOwnProperty.call(_mounts, id)) return false;
    var entry = _mounts[id];
    delete _mounts[id];

    // Stop camera regardless of ownership — preview is going away.
    if (entry.mediaInput && typeof entry.mediaInput.stopCamera === 'function') {
      try { entry.mediaInput.stopCamera(); } catch (_) {}
    }
    // Owned inputs get destroyed (releases tracks, closes AudioContext).
    if (entry.ownedInput && entry.mediaInput && typeof entry.mediaInput.destroy === 'function') {
      try { entry.mediaInput.destroy(); } catch (_) {}
    }
    // Detach stream from <video> before removing the wrapper so the
    // element releases its MediaStream reference cleanly.
    if (entry.videoEl) {
      try { entry.videoEl.pause(); } catch (_) {}
      try { entry.videoEl.srcObject = null; } catch (_) {}
    }
    if (entry.wrapperEl && entry.wrapperEl.parentNode) {
      try { entry.wrapperEl.parentNode.removeChild(entry.wrapperEl); } catch (_) {}
    }
    return true;
  }

  // ---- CSS ---------------------------------------------------------------
  // Names prefixed (swr-camera-* / swr-cam-* / swr-face-guide-* /
  // swr-cam-rec-dot / swrcp-blink) so future page CSS can't collide
  // with this component.
  var PREVIEW_CSS =
    '.' + CLASS_PREVIEW + '{position:relative;background:#000;border-radius:var(--radius-lg,12px);overflow:hidden;display:block;}' +
    '.' + CLASS_PREVIEW + '.' + SIZE_CLASS_PREFIX + SIZE_SMALL + '{width:160px;height:120px;}' +
    '.' + CLASS_PREVIEW + '.' + SIZE_CLASS_PREFIX + SIZE_MEDIUM + '{width:320px;height:240px;}' +
    '.' + CLASS_PREVIEW + '.' + SIZE_CLASS_PREFIX + SIZE_LARGE + '{width:480px;height:360px;}' +
    '.' + CLASS_PREVIEW + '.' + SIZE_CLASS_PREFIX + SIZE_FULL + '{width:100%;height:100%;aspect-ratio:16/9;}' +
    '.' + CLASS_FEED + '{width:100%;height:100%;object-fit:cover;display:block;}' +
    '.' + CLASS_FEED + '.mirrored{transform:scaleX(-1);}' +
    '.' + CLASS_CONTROLS + '{position:absolute;top:12px;right:12px;display:flex;gap:8px;z-index:10;}' +
    '.' + CLASS_BTN + '{width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,0.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.2);color:#fff;cursor:pointer;font-size:0.9rem;padding:0;line-height:1;display:flex;align-items:center;justify-content:center;transition:background 150ms ease;}' +
    '.' + CLASS_BTN + ':hover{background:rgba(255,255,255,0.2);}' +
    '.' + CLASS_INDICATOR + '{padding:6px 12px;background:rgba(0,0,0,0.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:16px;font-size:0.7rem;font-weight:700;color:#ff0050;display:flex;align-items:center;gap:6px;opacity:0;transition:opacity 200ms ease;}' +
    '.' + CLASS_INDICATOR + '.active{opacity:1;}' +
    '.swr-cam-rec-dot{width:8px;height:8px;border-radius:50%;background:#ff0050;animation:swrcp-blink 1s infinite;}' +
    '@keyframes swrcp-blink{0%,100%{opacity:1;}50%{opacity:0.3;}}' +
    '.' + CLASS_FACE_GUIDE + '{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;opacity:0;transition:opacity 300ms ease;}' +
    '.' + CLASS_FACE_GUIDE + '.active{opacity:1;}' +
    '.swr-face-guide-frame{width:200px;height:250px;border:2px dashed rgba(255,255,255,0.3);border-radius:50% 50% 45% 45%;}' +
    '.swr-face-guide-text{margin-top:16px;font-size:0.85rem;color:rgba(255,255,255,0.6);}';

  // ---- Public surface ----------------------------------------------------
  window.SWR_CAMERA_PREVIEW = {
    mount: mount,
    unmount: unmount,
    SIZE_SMALL: SIZE_SMALL,
    SIZE_MEDIUM: SIZE_MEDIUM,
    SIZE_LARGE: SIZE_LARGE,
    SIZE_FULL: SIZE_FULL,
    CLASS_PREVIEW: CLASS_PREVIEW,
    CLASS_FEED: CLASS_FEED,
    CLASS_CONTROLS: CLASS_CONTROLS,
    CLASS_BTN: CLASS_BTN,
    CLASS_INDICATOR: CLASS_INDICATOR,
    CLASS_FACE_GUIDE: CLASS_FACE_GUIDE,
  };
})();
