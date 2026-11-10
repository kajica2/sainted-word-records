// client/neon-demo-panel.client.js — collapsible Demo panel for /versions/neon.
// Buttons/toggles mirror engine-keys + VersionsPresets without requiring keyboard shortcuts.

(function () {
  'use strict';
  if (window.SWR_NEON_DEMO) return;

  var BLENDS = ['source-over', 'screen', 'lighter', 'multiply', 'overlay', 'difference', 'soft-light'];
  var REACTOR_PRESETS = [
    [{ feature: 'bass', target: 'scale', scale: 0.7, ease: 'sharp' }, { feature: 'beat', target: 'opacity', scale: 0.6, ease: 'sharp' }],
    [{ feature: 'mid', target: 'hue', scale: 200, ease: 'smooth' }, { feature: 'rms', target: 'scale', scale: 0.4, ease: 'soft' }],
    [{ feature: 'treble', target: 'rot', scale: 3, ease: 'smooth' }, { feature: 'air', target: 'y', scale: 80, ease: 'smooth' }],
    [{ feature: 'rms', target: 'scale', scale: 0.8, ease: 'soft' }, { feature: 'onset', target: 'brightness', scale: 0.8, ease: 'sharp' }],
    [{ feature: 'centroid', target: 'hue', scale: 300, ease: 'smooth' }, { feature: 'treble', target: 'scale', scale: 0.5, ease: 'soft' }],
    [{ feature: 'bass', target: 'scale', scale: 1.0, ease: 'sharp' }, { feature: 'beat', target: 'opacity', scale: 0.9, ease: 'sharp' }],
  ];

  var AUDIO_PRESETS = [
    { id: 'punch', label: 'Punch', sens: 2.4, gate: 1.15, decay: 0.7 },
    { id: 'club', label: 'Club', sens: 1.8, gate: 1.35, decay: 0.82 },
    { id: 'soft', label: 'Soft', sens: 0.7, gate: 1.9, decay: 0.95 },
    { id: 'tight', label: 'Tight', sens: 1.5, gate: 1.7, decay: 0.55 },
  ];
  var DEMO_CLIPS_PACK = 'dancer-video';
  var DEMO_SONG_URL = '/audios/endless-tomorrow.mp3';
  var DEMO_SONG_NAME = 'endless-tomorrow.mp3';
  var METER_BANDS = ['bass', 'mid', 'treble', 'air'];
  var CLASSIFY_WAIT_MS = 4000;
  var BEAT_STEP_MIN_MS = 2000;
  // Named frames the stage can letterbox into. "stage" is the layout cell.
  // A clip within 0.05 of a named ratio is labelled as that ratio.
  var STAGE_ASPECTS = [
    { id: 'stage', label: 'Fill', w: 0, h: 0 },
    { id: '16:9', label: '16:9', w: 16, h: 9 },
    { id: '9:16', label: '9:16', w: 9, h: 16 },
    { id: '1:1', label: '1:1', w: 1, h: 1 },
    { id: '4:5', label: '4:5', w: 4, h: 5 },
  ];

  var hooks = { reload: function (want) { return reloadPage(want); } };

  var state = {
    stage: null,
    meterRaf: null,
    mounted: false,
    collapsed: true,
    activePreset: null,
    activeAudio: null,
    activeFilter: null,
    demoAllTimer: null,
    demoBeatRaf: null,
    lastBeatPulse: 0,
    lastStepAt: 0,
    reactorIdx: 0,
    root: null,
    aspect: 'stage',
    wave: 'pulse',
    waveStamp: 0,
    imageStyle: 'fade',
    markNode: null,
    markRaf: null,
  };

  /** @type {Record<string, { id: string, label: string, skipVerify: boolean, invoke: function(): * }>} */
  var controls = {};

  function invalidateRender() {
    try {
      if (window.SWR_RENDER && typeof window.SWR_RENDER.invalidate === 'function') {
        window.SWR_RENDER.invalidate();
      }
    } catch (_) {}
  }

  function regControl(el, id, meta) {
    if (!el || !id || !meta || typeof meta.invoke !== 'function') return;
    el.setAttribute('data-demo-control', id);
    if (meta.skipVerify) el.setAttribute('data-demo-skip-verify', '1');
    controls[id] = {
      id: id,
      label: meta.label || id,
      skipVerify: !!meta.skipVerify,
      invoke: meta.invoke,
    };
  }

  function assertAllControlsBound() {
    if (!state.root) return;
    var missing = [];
    state.root.querySelectorAll('[data-demo-control]').forEach(function (el) {
      var id = el.getAttribute('data-demo-control');
      var c = controls[id];
      if (!c || typeof c.invoke !== 'function') missing.push(id || '(empty id)');
    });
    if (missing.length) {
      throw new Error('SWR_NEON_DEMO unbound demo controls: ' + missing.join(', '));
    }
  }

  function mk(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function svgEl(tag) {
    if (document.createElementNS) return document.createElementNS('http://www.w3.org/2000/svg', tag);
    return document.createElement(tag);
  }

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // Two pulses in the first half of a 1.2s cycle, then a rest. This is the
  // watermark heartbeat, drawn by writing the SVG transform. The page's
  // motion switch sets `animation: none` on every element, so a CSS
  // keyframe on this mark would never move.
  function heartbeatScale(tMs) {
    var t = +tMs;
    if (!isFinite(t)) t = nowMs();
    var p = (t % 1200) / 1200;
    if (p < 0.12) return 1 + 0.16 * (p / 0.12);
    if (p < 0.24) return 1.16 - 0.16 * ((p - 0.12) / 0.12);
    if (p < 0.36) return 1 + 0.16 * ((p - 0.24) / 0.12);
    if (p < 0.48) return 1.16 - 0.16 * ((p - 0.36) / 0.12);
    return 1;
  }

  function paintMark(t) {
    if (!state.markNode) return;
    var s = heartbeatScale(t);
    state.markNode.setAttribute('transform', 'translate(16 16) scale(' + s.toFixed(3) + ')');
  }

  function markLoop(t) {
    state.markRaf = null;
    if (!state.mounted) return;
    paintMark(t);
    state.markRaf = requestAnimationFrame(markLoop);
  }

  function startMark() {
    if (state.markRaf || typeof requestAnimationFrame !== 'function') return;
    state.markRaf = requestAnimationFrame(markLoop);
  }

  function stopMark() {
    if (state.markRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.markRaf);
    state.markRaf = null;
  }

  function addPaneSlider(parent, spec) {
    var row = mk('div', 'demo-row demo-live-slider');
    row.appendChild(mk('label', null, spec.label));
    var range = document.createElement('input');
    range.type = 'range';
    range.id = spec.domId;
    range.min = spec.min;
    range.max = spec.max;
    range.step = spec.step;
    var initial = spec.read();
    range.value = String(initial);
    var read = mk('b', 'demo-slider-v', spec.format(initial));
    read.id = spec.domId + '-v';
    regControl(range, spec.control, {
      label: spec.label,
      invoke: function () {
        return bumpSlider(spec.read, spec.write, parseFloat(spec.min), parseFloat(spec.max));
      },
    });
    range.addEventListener('input', function () { spec.write(parseFloat(range.value)); });
    row.appendChild(range);
    row.appendChild(read);
    parent.appendChild(row);
  }

  function buildMark() {
    var wrap = mk('span', 'demo-mark');
    wrap.setAttribute('aria-hidden', 'true');
    var svg = svgEl('svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    var pulse = svgEl('g');
    pulse.setAttribute('class', 'demo-mark-pulse');
    pulse.setAttribute('transform', 'translate(16 16) scale(1)');
    var inner = svgEl('g');
    inner.setAttribute('transform', 'translate(-16 -16)');
    var ring = svgEl('circle');
    ring.setAttribute('cx', '16');
    ring.setAttribute('cy', '16');
    ring.setAttribute('r', '5.5');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'currentColor');
    ring.setAttribute('stroke-width', '1.5');
    var spokes = svgEl('path');
    spokes.setAttribute('d', 'M16 4.5v3.2M16 24.3v3.2M4.5 16h3.2M24.3 16h3.2');
    spokes.setAttribute('fill', 'none');
    spokes.setAttribute('stroke', 'currentColor');
    spokes.setAttribute('stroke-width', '1.5');
    spokes.setAttribute('stroke-linecap', 'round');
    inner.appendChild(ring);
    inner.appendChild(spokes);
    pulse.appendChild(inner);
    svg.appendChild(pulse);
    wrap.appendChild(svg);
    state.markNode = pulse;
    return wrap;
  }

  function fitAspectBox(boxW, boxH, rw, rh) {
    var bw = +boxW;
    var bh = +boxH;
    var ar = (+rw) / (+rh);
    if (!(bw > 0) || !(bh > 0) || !(ar > 0)) return null;
    var cssW;
    var cssH;
    if (bw / bh > ar) { cssH = bh; cssW = bh * ar; }
    else { cssW = bw; cssH = bw / ar; }
    return { w: Math.max(2, Math.round(cssW)), h: Math.max(2, Math.round(cssH)) };
  }

  function labelAspect(w, h) {
    var rw = +w;
    var rh = +h;
    if (!(rw > 0) || !(rh > 0)) return null;
    var r = rw / rh;
    var best = null;
    var bestErr = Infinity;
    for (var i = 0; i < STAGE_ASPECTS.length; i++) {
      var a = STAGE_ASPECTS[i];
      if (!a.w || !a.h) continue;
      var err = Math.abs(r - a.w / a.h);
      if (err < bestErr) { bestErr = err; best = a; }
    }
    if (best && bestErr < 0.05) return best.label;
    return r.toFixed(2) + ':1';
  }

  function stageCanvas() {
    return document.getElementById('render');
  }

  function clipAspectLabel() {
    var items = demoClipItems();
    var w = 0;
    var h = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var el = it && it._el;
      var iw = it ? (+it.w || (el && (+el.videoWidth || +el.naturalWidth)) || 0) : 0;
      var ih = it ? (+it.h || (el && (+el.videoHeight || +el.naturalHeight)) || 0) : 0;
      if (iw > 0 && ih > 0) { w = iw; h = ih; break; }
    }
    if (!w || !h) return 'clip aspect —';
    return 'clips ' + w + '×' + h + ' · ' + labelAspect(w, h);
  }

  function paintWaveButtons() {
    if (!state.root || !state.root.querySelectorAll) return;
    state.root.querySelectorAll('[data-demo-wave]').forEach(function (btn) {
      var on = btn.getAttribute('data-demo-wave') === state.wave;
      if (btn.classList) btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function audioTopApi() {
    return window.SWR_AUDIO_TOP || window.SWR_WAVE_LINES || null;
  }

  function applyWave(id) {
    var api = audioTopApi();
    if (!api || typeof api.setPreset !== 'function' || !api.setPreset(id)) return false;
    state.wave = id;
    state.waveStamp += 1;
    paintWaveButtons();
    invalidateRender();
    return true;
  }

  function imageStylesApi() {
    return window.SWR_IMAGE_STYLES || null;
  }

  function paintImageStyleButtons() {
    if (!state.root || !state.root.querySelectorAll) return;
    state.root.querySelectorAll('[data-demo-image-style]').forEach(function (btn) {
      var on = btn.getAttribute('data-demo-image-style') === state.imageStyle;
      if (btn.classList) btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function applyImageStyle(id) {
    var api = imageStylesApi();
    if (!api || typeof api.setStyle !== 'function') return false;
    var s = api.setStyle(id);
    state.imageStyle = (s && s.id) || id;
    paintImageStyleButtons();
    invalidateRender();
    return true;
  }

  function swapImageDepth() {
    var api = imageStylesApi();
    var sel = selectedLayer();
    if (!api || !sel) return false;
    return !!api.swapDepth(sel);
  }

  function swapNextImage() {
    var api = imageStylesApi();
    var Lib = window.Library || (window.SWR && window.SWR.Library);
    var sel = selectedLayer();
    if (!api || !sel || !Lib || !Lib.items) return false;
    if (sel.locked) {
      var L = layers();
      if (L && typeof L.toggleLock === 'function') L.toggleLock(sel);
      else sel.locked = false;
    }
    var imgs = Lib.items.filter(function (it) {
      return it && it.type === 'image' && it !== sel.asset;
    });
    if (!imgs.length) {
      imgs = Lib.items.filter(function (it) { return it && it !== sel.asset; });
    }
    if (!imgs.length) return false;
    var pick = imgs[Math.floor(Math.random() * imgs.length)];
    return !!api.swap(sel, pick);
  }

  function paintAspectButtons() {
    if (!state.root || !state.root.querySelectorAll) return;
    state.root.querySelectorAll('[data-demo-aspect]').forEach(function (btn) {
      var on = btn.getAttribute('data-demo-aspect') === state.aspect;
      if (btn.classList) btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function applyStageAspect(id) {
    var spec = null;
    for (var i = 0; i < STAGE_ASPECTS.length; i++) {
      if (STAGE_ASPECTS[i].id === id) spec = STAGE_ASPECTS[i];
    }
    if (!spec) return false;
    var canvas = stageCanvas();
    var section = canvas && (canvas.parentElement || canvas.parentNode);
    if (!canvas || !section || !canvas.style) return false;
    state.aspect = id;
    if (!spec.w || !spec.h) {
      canvas.style.width = '';
      canvas.style.height = '';
      if (section.classList) section.classList.remove('is-ratio');
    } else {
      var box = fitAspectBox(section.clientWidth, section.clientHeight, spec.w, spec.h);
      if (!box) return false;
      if (section.classList) section.classList.add('is-ratio');
      canvas.style.width = box.w + 'px';
      canvas.style.height = box.h + 'px';
    }
    if (window.SWR_RENDER && typeof window.SWR_RENDER.fit === 'function') window.SWR_RENDER.fit(canvas);
    paintAspectButtons();
    paintStage();
    return true;
  }

  function motionKill() {
    return window.SWR_MOTION_KILL || null;
  }

  function isRotationOff() {
    var MK = motionKill();
    return MK && typeof MK.isRotationGloballyEnabled === 'function' && !MK.isRotationGloballyEnabled();
  }

  function isZoomOff() {
    var MK = motionKill();
    return MK && typeof MK.isZoomGloballyEnabled === 'function' && !MK.isZoomGloballyEnabled();
  }

  function isDistortionFxOff() {
    var MK = motionKill();
    return MK && MK.IMAGE_CLARITY_ENABLED === true;
  }

  function layers() {
    return window.Layers || null;
  }

  function selectedLayer() {
    var L = layers();
    if (!L) return null;
    return L.sel || L.selected || null;
  }

  function audioCore() {
    var a = window.A || (window.SWR && window.SWR.Audio) || null;
    return a && (typeof a.load === 'function' || typeof a.loadFile === 'function') ? a : null;
  }

  function hasSong(A) {
    var el = A && (A.audioEl || A.el);
    return !!(el && el.src);
  }

  function beatPulseOf(feat) {
    if (!feat) return false;
    var p = feat.beatPulse;
    if (typeof p === 'boolean') return p;
    if (typeof p === 'number') return p > 0.5;
    return (feat.beat || 0) > 0.9;
  }

  function demoLib() {
    return window.SWR_LIB || (window.SWR && window.SWR.Library) || window.Library || null;
  }

  function demoClipItems() {
    var lib = demoLib();
    if (!lib || !Array.isArray(lib.items)) return [];
    return lib.items.filter(function (it) { return it.packId === DEMO_CLIPS_PACK; });
  }

  function webglState() {
    var gate = window.SWR_WEBGL;
    var asked = !!(gate && typeof gate.isWebGLEnabled === 'function' && gate.isWebGLEnabled());
    var fx = window.FX;
    return { asked: asked, active: asked && !!fx && fx.available !== false };
  }

  function whenClassified(items, timeoutMs) {
    return new Promise(function (resolve) {
      var waited = 0;
      (function poll() {
        var pending = items.some(function (it) { return !it.thumb; });
        if (!pending || waited >= timeoutMs) return resolve();
        waited += 150;
        setTimeout(poll, 150);
      })();
    });
  }

  function installDemoClips() {
    var P = window.SWR_LIBRARY_PACKS;
    if (!P || typeof P.load !== 'function') return Promise.resolve(false);
    // The pack loader treats "already loaded" as success and does not
    // re-add the files. After the library is cleared that cache is a lie:
    // the clips are gone. Drop it before loading so Start demo installs
    // them again.
    if (!demoClipItems().length && typeof P.unload === 'function') {
      try { P.unload(DEMO_CLIPS_PACK); } catch (_) {}
    }
    return P.load(DEMO_CLIPS_PACK).then(function (res) {
      if (!res || !res.loaded) return false;
      return whenClassified(demoClipItems(), CLASSIFY_WAIT_MS).then(function () {
        var L = layers();
        if (L && typeof L.remap === 'function') L.remap();
        invalidateRender();
        paintStage();
        return true;
      });
    }).catch(function () { return false; });
  }

  function dismissStartOverlay() {
    var overlay = document.getElementById('swr-start');
    if (!overlay || !overlay.classList) return;
    overlay.classList.add('hide');
    setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 600);
  }

  function loadDemoSong() {
    var A = audioCore();
    if (!A || typeof fetch !== 'function') return Promise.resolve(false);
    return fetch(DEMO_SONG_URL).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    }).then(function (blob) {
      var file = new File([blob], DEMO_SONG_NAME, { type: blob.type || 'audio/mpeg' });
      if (typeof A.loadFile === 'function') A.loadFile(file);
      else A.load(file);
      return Promise.resolve(A.play()).then(function () {
        dismissStartOverlay();
        paintStage();
        return true;
      });
    }).catch(function () { paintStage(); return false; });
  }

  function toggleAudio() {
    var A = audioCore();
    if (!A) return Promise.resolve(false);
    if (!hasSong(A)) return loadDemoSong();
    if (A.playing) {
      if (typeof A.pause === 'function') A.pause();
      paintStage();
      return Promise.resolve(true);
    }
    return Promise.resolve(A.play()).then(function () { paintStage(); return true; }, function () { return false; });
  }

  function startDemo() {
    return installDemoClips().then(function (clipsOk) {
      return loadDemoSong().then(function (songOk) {
        applyShortcutPreset('neon');
        if (!state.demoAllTimer && !state.demoBeatRaf) startDemoAll();
        paintStage();
        return clipsOk || songOk;
      });
    });
  }

  function toggleWebGL() {
    var want = !webglState().asked;
    try {
      window.localStorage.setItem('swrWebGL', want ? '1' : '0');
    } catch (_) {
      return false;
    }
    return hooks.reload(want);
  }

  function reloadPage(want) {
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('webgl', want ? '1' : '0');
      window.location.replace(url.toString());
      return true;
    } catch (_) {
      return false;
    }
  }

  function stageSummary() {
    var A = audioCore();
    var gl = webglState();
    var clips = demoClipItems().length;
    var L = layers();
    var staged = L && Array.isArray(L.list) ? L.list.length : 0;
    var audio = !A ? 'no audio core' : (A.playing ? 'playing' : (hasSong(A) ? 'paused' : 'no song'));
    var fx = gl.active ? 'WebGL on' : (gl.asked ? 'WebGL unavailable' : 'WebGL off (2D)');
    return clips + ' clips · ' + staged + ' layers · audio ' + audio + ' · ' + fx;
  }

  function paintStage() {
    var st = state.stage;
    if (!st) return;
    var text = stageSummary();
    if (st.text !== text) {
      st.text = text;
      st.summary.textContent = text;
    }
    var A = audioCore();
    var feat = (A && A.feat) || {};
    METER_BANDS.forEach(function (band, i) {
      var v = Math.max(0, Math.min(1, +feat[band] || 0));
      var bar = st.bars[i];
      if (bar && bar.style) bar.style.transform = 'scaleX(' + v.toFixed(3) + ')';
    });
    if (st.beat && st.beat.classList) st.beat.classList.toggle('on', beatPulseOf(feat) || (feat.beat || 0) > 0.6);
    var gl = webglState();
    if (st.webgl) {
      st.webgl.setAttribute('aria-pressed', gl.asked ? 'true' : 'false');
      st.webgl.classList.toggle('is-active', gl.asked);
    }
    if (st.play) st.play.textContent = A && A.playing ? 'Pause' : 'Play';
    if (st.aspectRead) st.aspectRead.textContent = clipAspectLabel();
    mirrorPaneSlider('demo-sensitivity', readSensitivity(), function (n) { return n.toFixed(2); });
    mirrorPaneSlider('demo-temperature', readTemperature(), function (n) {
      return (n >= 0 ? '+' : '') + n.toFixed(2);
    });
  }

  function mirrorPaneSlider(id, value, format) {
    if (!Number.isFinite(value)) return;
    var range = document.getElementById(id);
    if (!range) return;
    if (document.activeElement && document.activeElement === range) return;
    var shown = parseFloat(range.value);
    if (!Number.isFinite(shown) || Math.abs(shown - value) > 0.001) range.value = String(value);
    var read = document.getElementById(id + '-v');
    if (read) read.textContent = format(value);
  }

  function meterLoop() {
    state.meterRaf = null;
    if (!state.mounted || state.collapsed || typeof requestAnimationFrame !== 'function') return;
    paintStage();
    state.meterRaf = requestAnimationFrame(meterLoop);
  }

  function startMeter() {
    if (state.meterRaf || typeof requestAnimationFrame !== 'function') return;
    state.meterRaf = requestAnimationFrame(meterLoop);
  }

  function stopMeter() {
    if (state.meterRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.meterRaf);
    state.meterRaf = null;
  }

  function listShortcutPresets() {
    var VP = window.VersionsPresets;
    if (VP && Array.isArray(VP.SHORTCUT_PRESETS)) return VP.SHORTCUT_PRESETS.slice();
    return ['pulse', 'neon', 'grid', 'eclipse', 'smoke', 'aurora', 'film', 'glitch', 'void'];
  }

  function listGradePresets() {
    var table = window.__SWR_PRESETS;
    if (!table || typeof table !== 'object') return [];
    var exclude = new Set(['gallery', 'mtv']);
    return Object.keys(table).filter(function (k) { return !exclude.has(k); }).sort();
  }

  function presetLabel(id) {
    var VP = window.VersionsPresets;
    if (VP && VP.PRESETS && VP.PRESETS[id] && VP.PRESETS[id].label) return VP.PRESETS[id].label;
    return String(id).toUpperCase();
  }

  function applyShortcutPreset(pageKey) {
    var VP = window.VersionsPresets;
    if (!VP || !pageKey) return false;
    if (VP.setPresetOverride) VP.setPresetOverride(pageKey);
    var ok = VP.applyPreset && VP.applyPreset(pageKey);
    if (ok === false) return false;
    window.__swrCurrentPreset = pageKey;
    if (window.SWR_PRESET_PICK && typeof window.SWR_PRESET_PICK.save === 'function') {
      window.SWR_PRESET_PICK.save(pageKey);
    }
    if (window.SWR && window.SWR.Gradient && typeof window.SWR.Gradient.setAutomixAnchor === 'function') {
      window.SWR.Gradient.setAutomixAnchor(pageKey);
    }
    state.activePreset = pageKey;
    paintPresetButtons();
    invalidateRender();
    return true;
  }

  function applyGradePreset(id) {
    if (window.SWR_LOOKS && typeof window.SWR_LOOKS.apply === 'function') {
      if (window.SWR_LOOKS.apply('grade:' + id)) {
        state.activePreset = id;
        paintPresetButtons();
        return true;
      }
    }
    var table = window.__SWR_PRESETS;
    if (!table || !table[id] || !window.FX || typeof window.FX.setPersona !== 'function') return false;
    window.FX.setPersona(table[id]);
    window.__swrCurrentPreset = id;
    state.activePreset = id;
    paintPresetButtons();
    invalidateRender();
    return true;
  }

  function applyLookFilter(slot) {
    var K = window.SWR_LOOK_FILTER_CYCLER;
    if (!K || typeof K.apply !== 'function') return false;
    K.apply(slot);
    state.activeFilter = slot;
    paintFilterButtons();
    invalidateRender();
    return true;
  }

  function paintPresetButtons() {
    if (!state.root) return;
    state.root.querySelectorAll('[data-demo-preset]').forEach(function (btn) {
      var id = btn.getAttribute('data-demo-preset');
      var on = id === state.activePreset;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-active', on);
    });
  }

  function audioPresetById(id) {
    for (var i = 0; i < AUDIO_PRESETS.length; i++) {
      if (AUDIO_PRESETS[i].id === id) return AUDIO_PRESETS[i];
    }
    return null;
  }

  function clampToInput(el, value) {
    var n = +value;
    if (!Number.isFinite(n) || !el) return n;
    var lo = parseFloat(el.min);
    var hi = parseFloat(el.max);
    if (Number.isFinite(lo)) n = Math.max(lo, n);
    if (Number.isFinite(hi)) n = Math.min(hi, n);
    return n;
  }

  function applyAudioPreset(id) {
    var preset = audioPresetById(id);
    if (!preset) return false;
    ['sens', 'gate', 'decay'].forEach(function (key) {
      var el = document.getElementById(key);
      if (!el) return;
      var n = clampToInput(el, preset[key]);
      el.value = String(n);
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
      var mirror = document.getElementById('demo-global-' + key);
      if (mirror) mirror.value = String(n);
    });
    var A = audioCore();
    if (A && A.params) {
      ['sens', 'gate', 'decay'].forEach(function (key) {
        var el = document.getElementById(key);
        var n = el ? parseFloat(el.value) : preset[key];
        if (Number.isFinite(n)) A.params[key] = n;
      });
    }
    state.activeAudio = id;
    paintAudioButtons();
    var sensNow = document.getElementById('sens');
    if (sensNow) writeSensitivity(parseFloat(sensNow.value));
    invalidateRender();
    return true;
  }

  function readSensitivity() {
    var el = document.getElementById('sens');
    if (el && el.value !== '') {
      var fromEl = parseFloat(el.value);
      if (Number.isFinite(fromEl)) return fromEl;
    }
    var A = audioCore();
    if (A && A.params && Number.isFinite(+A.params.sens)) return +A.params.sens;
    return 1.2;
  }

  function writeSensitivity(v) {
    var el = document.getElementById('sens');
    var n = el ? clampToInput(el, v) : Math.max(0.2, Math.min(3, +v));
    if (!Number.isFinite(n)) return false;
    if (el) {
      el.value = String(n);
      var pageRead = document.getElementById('sens-v');
      if (pageRead) pageRead.textContent = n.toFixed(2);
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    }
    var mirror = document.getElementById('demo-global-sens');
    if (mirror) mirror.value = String(n);
    var self = document.getElementById('demo-sensitivity');
    if (self) self.value = String(n);
    var read = document.getElementById('demo-sensitivity-v');
    if (read) read.textContent = n.toFixed(2);
    var A = audioCore();
    if (A && A.params) A.params.sens = n;
    var top = audioTopApi();
    if (top && typeof top.setSens === 'function') top.setSens(n);
    invalidateRender();
    return true;
  }

  function readTemperature() {
    var el = document.getElementById('temp');
    if (el && el.value !== '') {
      var fromEl = parseFloat(el.value);
      if (Number.isFinite(fromEl)) return fromEl;
    }
    if (window.FX && window.FX.state && Number.isFinite(+window.FX.state.temp)) return +window.FX.state.temp;
    return 0;
  }

  function writeTemperature(v) {
    var n = Math.max(-1, Math.min(1, +v));
    if (!Number.isFinite(+v) || !Number.isFinite(n)) return false;
    n = Math.round(n * 20) / 20;
    var el = document.getElementById('temp');
    if (el) n = clampToInput(el, n);
    if (!Number.isFinite(n)) return false;
    if (el) {
      el.value = String(n);
      var pageRead = document.getElementById('temp-v');
      if (pageRead) pageRead.textContent = (n >= 0 ? '+' : '') + n.toFixed(2);
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    }
    if (window.FX && typeof window.FX.setTemp === 'function') window.FX.setTemp(n);
    else if (window.FX && window.FX.state) window.FX.state.temp = n;
    var self = document.getElementById('demo-temperature');
    if (self) self.value = String(n);
    var read = document.getElementById('demo-temperature-v');
    if (read) read.textContent = (n >= 0 ? '+' : '') + n.toFixed(2);
    invalidateRender();
    return true;
  }

  function bumpSlider(read, write, lo, hi) {
    var cur = read();
    var span = hi - lo;
    var next = cur + span * 0.2;
    if (!(next < hi - span * 0.01)) next = lo + span * 0.2;
    return write(next);
  }

  function paintAudioButtons() {
    if (!state.root) return;
    state.root.querySelectorAll('[data-demo-audio]').forEach(function (btn) {
      var on = btn.getAttribute('data-demo-audio') === state.activeAudio;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-active', on);
    });
  }

  function paintFilterButtons() {
    if (!state.root) return;
    state.root.querySelectorAll('[data-demo-filter]').forEach(function (btn) {
      var slot = btn.getAttribute('data-demo-filter');
      var on = String(state.activeFilter) === String(slot);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-active', on);
    });
  }

  function syncLayerControlsFromSelection() {
    if (!state.root) return;
    var sel = selectedLayer();
    var host = state.root.querySelector('[data-demo-layer-fields]');
    if (!host) return;
    var disabled = !sel;
    var locked = !!(sel && sel.locked);
    host.querySelectorAll('input, select, button').forEach(function (el) {
      if (el.hasAttribute('data-demo-layer-always')) return;
      if (el.id === 'demo-layer-lock') {
        el.disabled = disabled;
        return;
      }
      el.disabled = disabled || locked || el.hasAttribute('data-demo-disabled');
    });
    var lockBtn = host.querySelector('#demo-layer-lock');
    if (lockBtn) {
      lockBtn.textContent = locked ? 'Unlock layer' : 'Lock layer';
      lockBtn.setAttribute('aria-pressed', locked ? 'true' : 'false');
    }
    if (!sel) return;
    var map = {
      'demo-blend': sel.blend,
      'demo-opacity': sel.opacity,
      'demo-scale': sel.baseScale,
      'demo-hue': sel.hue,
      'demo-contrast': sel.contrast,
      'demo-brightness': sel.brightness,
      'demo-alpha': sel.alpha,
      'demo-mutate': sel.mutate,
    };
    Object.keys(map).forEach(function (id) {
      var input = host.querySelector('#' + id);
      if (!input) return;
      if (typeof map[id] === 'number') input.value = String(map[id]);
      else if (typeof map[id] === 'string') input.value = map[id];
    });
  }

  function bindLayerInput(input, field, min, max) {
    if (!input) return;
    input.addEventListener('input', function () {
      var sel = selectedLayer();
      if (!sel || sel.locked) return;
      var v = +input.value;
      if (!Number.isFinite(v)) return;
      sel[field] = Math.max(min, Math.min(max, v));
      var L = layers();
      if (L && typeof L.render === 'function') L.render();
      invalidateRender();
    });
  }

  function runKeysAction(name) {
    if (window.SWR_KEYS && typeof window.SWR_KEYS.run === 'function') {
      return window.SWR_KEYS.run(name);
    }
    return false;
  }

  function clickId(id) {
    var el = document.getElementById(id);
    if (el) el.click();
    return !!el;
  }

  function stopDemoAll() {
    if (state.demoAllTimer) {
      clearInterval(state.demoAllTimer);
      state.demoAllTimer = null;
    }
    if (state.demoBeatRaf) {
      cancelAnimationFrame(state.demoBeatRaf);
      state.demoBeatRaf = null;
    }
    var btn = state.root && state.root.querySelector('[data-demo-all]');
    if (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = 'Demo all';
    }
  }

  function startDemoAll() {
    stopDemoAll();
    var ids = listShortcutPresets();
    if (!ids.length || !window.SWR_PRESET_CYCLE) return;
    var cur = state.activePreset || window.__swrCurrentPreset || ids[0];
    var btn = state.root.querySelector('[data-demo-all]');
    if (btn) {
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = 'Stop demo';
    }
    function step() {
      cur = window.SWR_PRESET_CYCLE.next(cur);
      applyShortcutPreset(cur);
    }
    var A = audioCore();
    var useBeat = !!(A && A.feat && A.playing);
    if (useBeat) {
      state.lastBeatPulse = beatPulseOf(A.feat) ? 1 : 0;
      function beatLoop() {
        if (!state.demoBeatRaf) return;
        var pulse = beatPulseOf(audioCore() && audioCore().feat) ? 1 : 0;
        var now = Date.now();
        if (pulse && !state.lastBeatPulse && now - state.lastStepAt >= BEAT_STEP_MIN_MS) {
          state.lastStepAt = now;
          step();
        }
        state.lastBeatPulse = pulse;
        state.demoBeatRaf = requestAnimationFrame(beatLoop);
      }
      state.demoBeatRaf = requestAnimationFrame(beatLoop);
    } else {
      state.demoAllTimer = setInterval(step, 4000);
      step();
    }
  }

  function resetDemo() {
    stopDemoAll();
    if (window.SWR_LOOK_FILTER_CYCLER && typeof window.SWR_LOOK_FILTER_CYCLER.reset === 'function') {
      window.SWR_LOOK_FILTER_CYCLER.reset();
    } else if (window.SWR_LOOK_FILTER_CYCLER && typeof window.SWR_LOOK_FILTER_CYCLER.apply === 'function') {
      window.SWR_LOOK_FILTER_CYCLER.apply(0);
    }
    state.activeFilter = 0;
    applyShortcutPreset('neon');
    if (window.SWR_KEYS && typeof window.SWR_KEYS.isBlackoutActive === 'function' && window.SWR_KEYS.isBlackoutActive()) {
      runKeysAction('toggleBlackout');
    }
    if (window.SWR_KEYS && typeof window.SWR_KEYS.home === 'function') {
      window.SWR_KEYS.home();
    }
    paintFilterButtons();
  }

  function injectStyles() {
    if (typeof document.querySelector === 'function' &&
        document.querySelector('link[href*="engine-chrome-dock.css"]')) return;
    if (document.getElementById('swr-neon-demo-styles')) return;
    var s = document.createElement('style');
    s.id = 'swr-neon-demo-styles';
    s.textContent = '#swr-neon-demo{position:fixed;z-index:10008;left:8px;bottom:44px;}';
    document.head.appendChild(s);
  }

  function collapsePanel() {
    if (!state.root) return;
    state.collapsed = true;
    stopMeter();
    state.root.classList.add('collapsed');
    var toggle = state.root.querySelector('.swr-neon-demo-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function buildPanel() {
    injectStyles();
    var root = mk('div', 'swr-neon-demo collapsed');
    root.id = 'swr-neon-demo';
    state.root = root;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Demo controls');

    var toggle = mk('button', 'swr-neon-demo-toggle', 'Demo panel');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'swr-neon-demo-body');
    toggle.addEventListener('click', function () {
      state.collapsed = !state.collapsed;
      root.classList.toggle('collapsed', state.collapsed);
      toggle.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
      if (!state.collapsed) {
        if (window.SWR_CHROME_DOCK) {
          window.SWR_CHROME_DOCK.hideAutomixDebug();
          window.SWR_CHROME_DOCK.hideKeysHelp();
        }
        syncLayerControlsFromSelection();
        startMeter();
        startMark();
      } else {
        stopMeter();
        stopMark();
      }
    });
    root.appendChild(toggle);

    var body = mk('div', 'swr-neon-demo-body swr-chrome-panel');
    body.id = 'swr-neon-demo-body';

    var secStage = mk('div', 'demo-sec demo-stage');
    secStage.appendChild(mk('h3', null, 'Demo stage'));
    var summary = mk('p', 'demo-note demo-stage-summary', '');
    summary.setAttribute('role', 'status');
    secStage.appendChild(summary);
    var meter = mk('div', 'demo-meter');
    meter.setAttribute('aria-hidden', 'true');
    var bars = METER_BANDS.map(function (band) {
      var track = mk('span', 'demo-meter-track');
      track.title = band;
      var fill = mk('i', 'demo-meter-fill');
      track.appendChild(fill);
      meter.appendChild(track);
      return fill;
    });
    var beatDot = mk('b', 'demo-meter-beat');
    meter.appendChild(beatDot);
    secStage.appendChild(meter);
    var aspectRow = mk('div', 'demo-aspect-row');
    aspectRow.appendChild(buildMark());
    var aspectRead = mk('span', 'demo-note demo-aspect-read', 'clip aspect —');
    aspectRow.appendChild(aspectRead);
    secStage.appendChild(aspectRow);
    var aspectBtns = mk('div', 'demo-grid');
    STAGE_ASPECTS.forEach(function (spec) {
      var b = mk('button', null, spec.label);
      b.type = 'button';
      b.setAttribute('data-demo-aspect', spec.id);
      regControl(b, 'aspect:' + spec.id, {
        label: 'Aspect ' + spec.label,
        invoke: function () { return applyStageAspect(spec.id); },
      });
      b.addEventListener('click', function () { applyStageAspect(spec.id); });
      aspectBtns.appendChild(b);
    });
    secStage.appendChild(aspectBtns);
    var secWave = mk('div', 'demo-sec');
    secWave.appendChild(mk('h3', null, 'Audio top layer'));
    var waveGrid = mk('div', 'demo-grid');
    var topApi = audioTopApi();
    var wavePresets = (topApi && topApi.PRESETS_PUBLIC) || (topApi && topApi.PRESETS) || [];
    wavePresets.forEach(function (preset) {
      var b = mk('button', null, preset.label);
      b.type = 'button';
      b.setAttribute('data-demo-wave', preset.id);
      b.setAttribute('data-demo-audio-top', preset.id);
      regControl(b, 'audioTop:' + preset.id, {
        label: 'Audio top ' + preset.label,
        invoke: function () { return applyWave(preset.id); },
      });
      b.addEventListener('click', function () { applyWave(preset.id); });
      waveGrid.appendChild(b);
    });
    secWave.appendChild(waveGrid);
    secWave.appendChild(mk('p', 'demo-note', 'Overlay only — Pulse / Spike / Scan / Ribbon / Off. Does not change locked media layers.'));
    secStage.appendChild(secWave);
    // Sync demo state to the live top-layer preset (may restore from localStorage).
    if (topApi && typeof topApi.getPreset === 'function') {
      var livePreset = topApi.getPreset();
      if (livePreset && livePreset.id) state.wave = livePreset.id;
    }
    paintWaveButtons();

    var secImg = mk('div', 'demo-sec');
    secImg.appendChild(mk('h3', null, 'Image swap styles'));
    var imgGrid = mk('div', 'demo-grid');
    var imgApi = imageStylesApi();
    var imgStyles = (imgApi && imgApi.STYLES) || [
      { id: 'fade', label: 'Fade' },
      { id: 'depth', label: 'Depth' },
      { id: 'move', label: 'Move' },
      { id: 'mask', label: 'Mask' },
    ];
    if (imgApi && typeof imgApi.getStyle === 'function') {
      var liveImg = imgApi.getStyle();
      if (liveImg && liveImg.id) state.imageStyle = liveImg.id;
    }
    imgStyles.forEach(function (preset) {
      var b = mk('button', null, preset.label);
      b.type = 'button';
      b.setAttribute('data-demo-image-style', preset.id);
      b.title = preset.hint || preset.label;
      regControl(b, 'imageStyle:' + preset.id, {
        label: 'Image style ' + preset.label,
        invoke: function () { return applyImageStyle(preset.id); },
      });
      b.addEventListener('click', function () { applyImageStyle(preset.id); });
      imgGrid.appendChild(b);
    });
    secImg.appendChild(imgGrid);
    var imgActs = mk('div', 'demo-grid');
    var depthBtn = mk('button', null, 'Swap depth');
    depthBtn.type = 'button';
    regControl(depthBtn, 'image:depthSwap', {
      label: 'Swap image depth',
      invoke: function () { return swapImageDepth(); },
    });
    depthBtn.addEventListener('click', function () { swapImageDepth(); });
    imgActs.appendChild(depthBtn);
    var swapBtn = mk('button', null, 'Swap media');
    swapBtn.type = 'button';
    regControl(swapBtn, 'image:swapMedia', {
      label: 'Swap image media with style',
      invoke: function () { return swapNextImage(); },
    });
    swapBtn.addEventListener('click', function () { swapNextImage(); });
    imgActs.appendChild(swapBtn);
    secImg.appendChild(imgActs);
    secImg.appendChild(mk('p', 'demo-note', 'Fade · Depth · Move · Mask — how stills leave when media swaps. Depth also reorders the stack.'));
    secStage.appendChild(secImg);
    paintImageStyleButtons();
    var sensSrc = document.getElementById('sens');
    addPaneSlider(secStage, {
      domId: 'demo-sensitivity',
      control: 'slider:sensitivity',
      label: 'Sensitivity',
      min: sensSrc && sensSrc.min ? sensSrc.min : '0.2',
      max: sensSrc && sensSrc.max ? sensSrc.max : '3',
      step: sensSrc && sensSrc.step ? sensSrc.step : '0.05',
      read: readSensitivity,
      write: writeSensitivity,
      format: function (v) { return Number.isFinite(+v) ? (+v).toFixed(2) : '—'; },
    });
    addPaneSlider(secStage, {
      domId: 'demo-temperature',
      control: 'slider:temperature',
      label: 'Temperature',
      min: '-1',
      max: '1',
      step: '0.05',
      read: readTemperature,
      write: writeTemperature,
      format: function (v) {
        var n = +v;
        return Number.isFinite(n) ? ((n >= 0 ? '+' : '') + n.toFixed(2)) : '—';
      },
    });
    var stageBtns = mk('div', 'demo-grid');
    function stageBtn(label, id, meta) {
      var b = mk('button', null, label);
      b.type = 'button';
      regControl(b, id, { label: label, skipVerify: !!meta.skipVerify, invoke: meta.invoke });
      b.addEventListener('click', function () {
        var r = meta.invoke();
        if (r && typeof r.then === 'function') r.then(paintStage, paintStage);
        else paintStage();
      });
      stageBtns.appendChild(b);
      return b;
    }
    stageBtn('Start demo', 'stage:start', { invoke: startDemo });
    stageBtn('Dance clips', 'stage:clips', { invoke: installDemoClips });
    var songBtn = stageBtn('Demo song', 'stage:song', { invoke: loadDemoSong });
    var playBtn = stageBtn('Play', 'stage:play', { invoke: toggleAudio });
    var glBtn = stageBtn('WebGL', 'stage:webgl', { invoke: toggleWebGL, skipVerify: true });
    secStage.appendChild(stageBtns);
    secStage.appendChild(mk('p', 'demo-note', 'Start demo installs the 13 dance clips, loads the demo song and cycles presets on the beat.'));
    body.appendChild(secStage);
    state.stage = { summary: summary, bars: bars, beat: beatDot, play: playBtn, song: songBtn, webgl: glBtn, aspectRead: aspectRead, text: null };
    paintAspectButtons();
    paintStage();

    var secPresets = mk('div', 'demo-sec');
    secPresets.appendChild(mk('h3', null, 'FX presets (1–9)'));
    var gridShort = mk('div', 'demo-grid');
    listShortcutPresets().forEach(function (id) {
      var b = mk('button', null, presetLabel(id));
      b.type = 'button';
      b.setAttribute('data-demo-preset', id);
      var inv = function () { return applyShortcutPreset(id); };
      regControl(b, 'fx:' + id, { label: 'FX ' + presetLabel(id), invoke: inv });
      b.addEventListener('click', inv);
      gridShort.appendChild(b);
    });
    secPresets.appendChild(gridShort);
    body.appendChild(secPresets);

    var grades = listGradePresets();
    if (grades.length) {
      var secGrades = mk('div', 'demo-sec');
      secGrades.appendChild(mk('h3', null, 'All grade presets'));
      var gridGrades = mk('div', 'demo-grid');
      grades.forEach(function (id) {
        var b = mk('button', null, presetLabel(id));
        b.type = 'button';
        b.setAttribute('data-demo-preset', id);
        var inv = function () { return applyGradePreset(id); };
        regControl(b, 'grade:' + id, { label: 'Grade ' + presetLabel(id), invoke: inv });
        b.addEventListener('click', inv);
        gridGrades.appendChild(b);
      });
      secGrades.appendChild(gridGrades);
      body.appendChild(secGrades);
    }

    var secFilter = mk('div', 'demo-sec');
    secFilter.appendChild(mk('h3', null, 'Look filters (keys 1–9)'));
    var gridF = mk('div', 'demo-grid');
    for (var f = 0; f <= 9; f++) {
      (function (slot) {
        var label = slot === 0 ? 'Off' : String(slot);
        var b = mk('button', null, label);
        b.type = 'button';
        b.setAttribute('data-demo-filter', String(slot));
        var skipF = slot === 9 && isDistortionFxOff();
        if (skipF) {
          b.disabled = true;
          b.title = 'Disabled while distortion FX are suppressed';
          b.setAttribute('data-demo-disabled', '1');
        }
        var invF = function () { return applyLookFilter(slot); };
        regControl(b, 'filter:' + slot, {
          label: 'Filter ' + label,
          skipVerify: skipF,
          invoke: invF,
        });
        b.addEventListener('click', invF);
        gridF.appendChild(b);
      })(f);
    }
    secFilter.appendChild(gridF);
    body.appendChild(secFilter);

    var secScenes = mk('div', 'demo-sec');
    secScenes.appendChild(mk('h3', null, 'Scenes'));
    var gridSc = mk('div', 'demo-grid');
    for (var si = 0; si < 4; si++) {
      (function (idx) {
        var b = mk('button', null, 'Scene ' + (idx + 1));
        b.type = 'button';
        var invSc = function () {
          if (window.SWR_SCENES && typeof window.SWR_SCENES.recall === 'function') {
            return window.SWR_SCENES.recall(idx);
          }
          return false;
        };
        regControl(b, 'scene:' + idx, { label: 'Scene ' + (idx + 1), invoke: invSc });
        b.addEventListener('click', invSc);
        b.addEventListener('mousedown', function () {
          if (window.SWR_SCENES && typeof window.SWR_SCENES.startCapture === 'function') {
            window.SWR_SCENES.startCapture(idx);
          }
        });
        b.addEventListener('mouseup', function () {
          if (window.SWR_SCENES && typeof window.SWR_SCENES.cancelCapture === 'function') {
            window.SWR_SCENES.cancelCapture();
          }
        });
        gridSc.appendChild(b);
      })(si);
    }
    secScenes.appendChild(gridSc);
    secScenes.appendChild(mk('p', 'demo-note', 'Click recall · hold 1s to save'));
    body.appendChild(secScenes);

    var secAm = mk('div', 'demo-sec');
    secAm.appendChild(mk('h3', null, 'Automix'));
    var amRow = mk('div', 'demo-grid');
    [
      ['automix-toggle', 'Toggle', 'automix:toggle'],
      ['automix-freeze', 'Freeze', 'automix:freeze'],
      ['automix-lock', 'Lock', 'automix:lock'],
      ['automix-save', 'Save blend', 'automix:save'],
    ].forEach(function (pair) {
      var b = mk('button', null, pair[1]);
      b.type = 'button';
      b.setAttribute('data-demo-layer-always', '1');
      var invAm = function () { return clickId(pair[0]); };
      regControl(b, pair[2], { label: pair[1], invoke: invAm });
      b.addEventListener('click', invAm);
      amRow.appendChild(b);
    });
    if (window.SWR_AUTOMAP) {
      var recipe = mk('button', null, 'Next recipe');
      recipe.type = 'button';
      recipe.setAttribute('data-demo-layer-always', '1');
      var invRec = function () {
        if (document.getElementById('automix-toggle') && window.SWR_AUTOMAP) {
          var M = window.SWR_AUTOMAP;
          var all = M.list();
          if (!all || !all.length) return false;
          var cur = M.pageIdFromBody ? M.pageIdFromBody() : null;
          var idx = all.findIndex(function (r) { return r.id === cur; });
          var next = all[(idx + 1 + all.length) % all.length];
          M.apply(next.id);
          return true;
        }
        return runKeysAction('cycleNextRecipe');
      };
      regControl(recipe, 'automix:nextRecipe', { label: 'Next recipe', invoke: invRec });
      recipe.addEventListener('click', invRec);
      amRow.appendChild(recipe);
      var remap = mk('button', null, 'Re-map');
      remap.type = 'button';
      remap.setAttribute('data-demo-layer-always', '1');
      var invMap = function () { return runKeysAction('cycleAutoMap'); };
      regControl(remap, 'automix:remap', { label: 'Re-map', invoke: invMap });
      remap.addEventListener('click', invMap);
      amRow.appendChild(remap);
    }
    secAm.appendChild(amRow);
    body.appendChild(secAm);

    var secGlobal = mk('div', 'demo-sec');
    secGlobal.appendChild(mk('h3', null, 'Audio + stage'));
    var audioGrid = mk('div', 'demo-grid');
    AUDIO_PRESETS.forEach(function (preset) {
      var b = mk('button', null, preset.label);
      b.type = 'button';
      b.setAttribute('data-demo-audio', preset.id);
      b.setAttribute('data-demo-layer-always', '1');
      var invA = function () { return applyAudioPreset(preset.id); };
      regControl(b, 'audio:' + preset.id, { label: 'Audio ' + preset.label, invoke: invA });
      b.addEventListener('click', invA);
      audioGrid.appendChild(b);
    });
    secGlobal.appendChild(audioGrid);
    ['sens', 'gate', 'decay'].forEach(function (id) {
      var row = mk('div', 'demo-row');
      row.appendChild(mk('label', null, id));
      var range = document.createElement('input');
      range.type = 'range';
      range.id = 'demo-global-' + id;
      var src = document.getElementById(id);
      if (src) {
        range.min = src.min;
        range.max = src.max;
        range.step = src.step;
        range.value = src.value;
      }
      var invG = function () {
        var el = document.getElementById(id);
        if (!el) return false;
        var cur = parseFloat(el.value);
        var next = Number.isFinite(cur) ? Math.min(parseFloat(el.max), cur + (parseFloat(el.max) - parseFloat(el.min)) * 0.15) : el.value;
        range.value = String(next);
        el.value = String(next);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        invalidateRender();
        return true;
      };
      regControl(range, 'global:' + id, { label: 'Global ' + id, invoke: invG });
      range.addEventListener('input', function () {
        var el = document.getElementById(id);
        if (!el) return;
        el.value = range.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        invalidateRender();
      });
      row.appendChild(range);
      secGlobal.appendChild(row);
    });
    var globBtns = mk('div', 'demo-grid');
    [
      ['Mirror', 'cycleMirror', 'keys:mirror'],
      ['Blackout', 'toggleBlackout', 'keys:blackout'],
      ['Home layers', 'home', 'keys:home'],
    ].forEach(function (pair) {
      var b = mk('button', null, pair[0]);
      b.type = 'button';
      b.setAttribute('data-demo-layer-always', '1');
      var invK = function () {
        if (pair[1] === 'home') {
          if (window.SWR_KEYS && typeof window.SWR_KEYS.home === 'function') {
            window.SWR_KEYS.home();
            invalidateRender();
            return true;
          }
          return false;
        }
        var ok = runKeysAction(pair[1]);
        if (ok) invalidateRender();
        return ok;
      };
      regControl(b, pair[2], { label: pair[0], invoke: invK });
      b.addEventListener('click', invK);
      globBtns.appendChild(b);
    });
    secGlobal.appendChild(globBtns);
    body.appendChild(secGlobal);

    var secLayer = mk('div', 'demo-sec');
    secLayer.appendChild(mk('h3', null, 'Selected layer'));
    var layerHost = mk('div', null);
    layerHost.setAttribute('data-demo-layer-fields', '1');

    var blendRow = mk('div', 'demo-row');
    blendRow.appendChild(mk('label', null, 'blend'));
    var blendSel = document.createElement('select');
    blendSel.id = 'demo-blend';
    BLENDS.forEach(function (b) {
      var o = document.createElement('option');
      o.value = b;
      o.textContent = b;
      blendSel.appendChild(o);
    });
    function unlockSelected(sel) {
      if (!sel) return sel;
      if (sel.locked) {
        var L = layers();
        if (L && typeof L.toggleLock === 'function') L.toggleLock(sel);
        else sel.locked = false;
      }
      // Always re-sync: a prior lock may have left the demo inputs
      // disabled even after Layers.toggleLock cleared the flag.
      syncLayerControlsFromSelection();
      return sel;
    }

    var invBlend = function () {
      var sel = unlockSelected(selectedLayer());
      if (!sel || sel.locked) return false;
      var i = BLENDS.indexOf(sel.blend || 'screen');
      var next = BLENDS[(i + 1) % BLENDS.length];
      blendSel.value = next;
      sel.blend = next;
      var L = layers();
      if (L && L.render) L.render();
      invalidateRender();
      return true;
    };
    regControl(blendSel, 'layer:blend', { label: 'Layer blend', invoke: invBlend });
    blendSel.addEventListener('change', function () {
      var sel = selectedLayer();
      if (!sel || sel.locked) return;
      sel.blend = blendSel.value;
      var L = layers();
      if (L && L.render) L.render();
      invalidateRender();
    });
    blendRow.appendChild(blendSel);
    layerHost.appendChild(blendRow);

    [
      ['demo-opacity', 'op', 'opacity', 0, 1, 0.01],
      ['demo-scale', 'scale', 'baseScale', 0.1, 3, 0.01],
      ['demo-hue', 'hue', 'hue', -180, 180, 1],
      ['demo-contrast', 'ct', 'contrast', 0.1, 2.5, 0.01],
      ['demo-brightness', 'br', 'brightness', 0.1, 2.5, 0.01],
      ['demo-alpha', 'α', 'alpha', 0, 1.5, 0.01],
      ['demo-mutate', 'mt', 'mutate', 0, 1, 0.01],
    ].forEach(function (spec) {
      var row = mk('div', 'demo-row');
      row.appendChild(mk('label', null, spec[1]));
      var input = document.createElement('input');
      input.type = 'range';
      input.id = spec[0];
      input.min = String(spec[3]);
      input.max = String(spec[4]);
      input.step = String(spec[5]);
      var skipLayer = false;
      if (spec[2] === 'baseScale' && isZoomOff()) {
        input.disabled = true;
        input.title = 'Scale disabled while zoom motion is off';
        input.setAttribute('data-demo-disabled', '1');
        skipLayer = true;
      }
      if (spec[2] === 'mutate' && isDistortionFxOff()) {
        input.disabled = true;
        input.title = 'Mutate disabled while distortion FX are suppressed';
        input.setAttribute('data-demo-disabled', '1');
        skipLayer = true;
      }
      (function (field, min, max, inp) {
        var invL = function () {
          var sel = unlockSelected(selectedLayer());
          if (!sel || sel.locked || inp.disabled) return false;
          var cur = sel[field];
          var bump = (max - min) * 0.35;
          var v = Number.isFinite(cur) && cur < (min + max) / 2 ? cur + bump : min + bump;
          inp.value = String(Math.max(min, Math.min(max, v)));
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        };
        regControl(inp, 'layer:' + field, { label: 'Layer ' + field, skipVerify: skipLayer, invoke: invL });
      })(spec[2], spec[3], spec[4], input);
      row.appendChild(input);
      layerHost.appendChild(row);
      bindLayerInput(input, spec[2], spec[3], spec[4]);
    });

    var layerBtns = mk('div', 'demo-grid');
    var cycleBlendBtn = mk('button', null, 'Cycle blend');
    cycleBlendBtn.type = 'button';
    var invCycleBlend = function () {
      var sel = unlockSelected(selectedLayer());
      if (sel && sel.locked) return false;
      var ok = runKeysAction('cycleBlend');
      syncLayerControlsFromSelection();
      invalidateRender();
      return ok;
    };
    regControl(cycleBlendBtn, 'layer:cycleBlend', { label: 'Cycle blend', invoke: invCycleBlend });
    cycleBlendBtn.addEventListener('click', invCycleBlend);
    layerBtns.appendChild(cycleBlendBtn);
    var rotBtn = mk('button', null, 'Master rot');
    rotBtn.type = 'button';
    var rotOff = isRotationOff();
    var invRot = function () { return runKeysAction('toggleMasterRotation'); };
    regControl(rotBtn, 'layer:masterRot', { label: 'Master rot', skipVerify: rotOff, invoke: invRot });
    if (rotOff) {
      rotBtn.disabled = true;
      rotBtn.title = 'Rotation is globally disabled';
    } else {
      rotBtn.addEventListener('click', invRot);
    }
    layerBtns.appendChild(rotBtn);
    var reactBtn = mk('button', null, 'Next reactors');
    reactBtn.type = 'button';
    var invReact = function () {
      var sel = unlockSelected(selectedLayer());
      if (!sel || sel.locked) return false;
      state.reactorIdx = (state.reactorIdx + 1) % REACTOR_PRESETS.length;
      var preset = REACTOR_PRESETS[state.reactorIdx];
      if (isRotationOff()) {
        preset = preset.filter(function (r) { return r.target !== 'rot'; });
      }
      if (isZoomOff()) {
        preset = preset.filter(function (r) { return r.target !== 'scale'; });
      }
      sel.reactors = JSON.parse(JSON.stringify(preset.length ? preset : REACTOR_PRESETS[0]));
      var L = layers();
      if (L && L.render) L.render();
      invalidateRender();
      return true;
    };
    regControl(reactBtn, 'layer:nextReactors', { label: 'Next reactors', invoke: invReact });
    reactBtn.addEventListener('click', invReact);
    layerBtns.appendChild(reactBtn);
    var lockBtn = mk('button', null, 'Lock layer');
    lockBtn.type = 'button';
    lockBtn.id = 'demo-layer-lock';
    var invLock = function () {
      var sel = selectedLayer();
      var L = layers();
      if (!sel || !L) return false;
      if (typeof L.toggleLock === 'function') {
        L.toggleLock(sel);
      } else {
        sel.locked = !sel.locked;
        if (L.render) L.render();
      }
      lockBtn.textContent = sel.locked ? 'Unlock layer' : 'Lock layer';
      lockBtn.setAttribute('aria-pressed', sel.locked ? 'true' : 'false');
      syncLayerControlsFromSelection();
      invalidateRender();
      return true;
    };
    regControl(lockBtn, 'layer:lock', { label: 'Lock layer', invoke: invLock });
    lockBtn.addEventListener('click', invLock);
    layerBtns.appendChild(lockBtn);
    layerHost.appendChild(layerBtns);
    secLayer.appendChild(layerHost);
    body.appendChild(secLayer);

    var actions = mk('div', 'demo-actions');
    var demoAll = mk('button', null, 'Demo all');
    demoAll.type = 'button';
    demoAll.setAttribute('data-demo-all', '1');
    demoAll.setAttribute('data-demo-layer-always', '1');
    var invDemoAll = function () {
      if (state.demoAllTimer || state.demoBeatRaf) {
        stopDemoAll();
        return true;
      }
      startDemoAll();
      return !!(state.demoAllTimer || state.demoBeatRaf);
    };
    regControl(demoAll, 'demo:demoAll', { label: 'Demo all', invoke: invDemoAll });
    demoAll.addEventListener('click', invDemoAll);
    actions.appendChild(demoAll);
    var resetBtn = mk('button', null, 'Reset');
    resetBtn.type = 'button';
    resetBtn.setAttribute('data-demo-layer-always', '1');
    var invReset = function () { resetDemo(); return true; };
    regControl(resetBtn, 'demo:reset', { label: 'Reset', invoke: invReset });
    resetBtn.addEventListener('click', invReset);
    actions.appendChild(resetBtn);
    body.appendChild(actions);

    root.appendChild(body);
    state.root = root;
    state.activePreset = window.__swrCurrentPreset || 'neon';
    paintPresetButtons();
    return root;
  }

  function mount(host) {
    if (state.mounted) return state.root;
    var el = buildPanel();
    (host || document.body).appendChild(el);
    state.mounted = true;
    assertAllControlsBound();
    window.addEventListener('swr:preset-applied', function (ev) {
      if (ev.detail && ev.detail.pageKey) {
        state.activePreset = ev.detail.pageKey;
        paintPresetButtons();
      }
    });
    window.addEventListener('swr-keys-press', function (ev) {
      if (!ev.detail || !ev.detail.action) return;
      if (String(ev.detail.action).indexOf('filter-') === 0) {
        state.activeFilter = parseInt(String(ev.detail.action).replace('filter-', ''), 10);
        paintFilterButtons();
      }
      if (String(ev.detail.action).indexOf('fx-preset-') === 0) {
        state.activePreset = String(ev.detail.action).replace('fx-preset-', '');
        paintPresetButtons();
      }
    });
    document.addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('#layers .l')) {
        setTimeout(syncLayerControlsFromSelection, 0);
      }
    }, true);
    window.addEventListener('resize', function () {
      if (state.aspect && state.aspect !== 'stage') applyStageAspect(state.aspect);
    });
    if (!state.collapsed) startMark();
    return el;
  }

  function unmount() {
    stopDemoAll();
    stopMeter();
    stopMark();
    state.stage = null;
    state.markNode = null;
    if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
    state.root = null;
    state.mounted = false;
  }

  function listControls() {
    return Object.keys(controls).sort().map(function (id) {
      var c = controls[id];
      return { id: id, label: c.label, skipVerify: c.skipVerify };
    });
  }

  function invokeControl(id) {
    var c = controls[id];
    if (!c || typeof c.invoke !== 'function') return { ok: false, error: 'unknown_control' };
    try {
      var result = c.invoke();
      if (result && typeof result.then === 'function') {
        return result.then(function (v) {
          return { ok: v !== false, result: v };
        }, function (err) {
          return { ok: false, error: err && err.message ? err.message : String(err) };
        });
      }
      return { ok: result !== false, result: result };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  function readProbe(id) {
    var fxSnap = function () {
      if (!window.FX || !window.FX.state) return null;
      var s = window.FX.state;
      return [s.temp, s.grain, s.glow, s.sepia, s.vignette, s.grayscale, s.blur].join(',');
    };
    if (id.indexOf('fx:') === 0) {
      return { preset: window.__swrCurrentPreset, fx: fxSnap() };
    }
    if (id.indexOf('grade:') === 0) {
      return { grade: id.split(':')[1], preset: window.__swrCurrentPreset, fx: fxSnap() };
    }
    if (id.indexOf('filter:') === 0) {
      var slot = parseInt(id.split(':')[1], 10);
      var cur = window.SWR_LOOK_FILTER_CYCLER && window.SWR_LOOK_FILTER_CYCLER.get
        ? window.SWR_LOOK_FILTER_CYCLER.get() : {};
      return { filterSlot: cur.slot, fx: fxSnap(), slot: slot };
    }
    if (id.indexOf('scene:') === 0) {
      var sens = document.getElementById('sens');
      return { sens: sens ? parseFloat(sens.value) : null };
    }
    if (id.indexOf('automix:') === 0) {
      var lab = document.getElementById('automix-state');
      return { automix: lab ? lab.textContent : null };
    }
    if (id.indexOf('audio:') === 0) {
      function num(gid) {
        var node = document.getElementById(gid);
        return node ? parseFloat(node.value) : null;
      }
      var core = audioCore();
      return {
        preset: state.activeAudio,
        sens: num('sens'),
        gate: num('gate'),
        decay: num('decay'),
        params: core && core.params ? { sens: core.params.sens, gate: core.params.gate, decay: core.params.decay } : null,
      };
    }
    if (id.indexOf('global:') === 0) {
      var gid = id.split(':')[1];
      var el = document.getElementById(gid);
      return { value: el ? parseFloat(el.value) : null };
    }
    if (id.indexOf('keys:') === 0) {
      return {
        blackout: window.SWR_KEYS && window.SWR_KEYS.isBlackoutActive
          ? window.SWR_KEYS.isBlackoutActive() : null,
        mirror: window.SWR_NATURAL && typeof window.SWR_NATURAL.mirror === 'function'
          ? window.SWR_NATURAL.mirror() : null,
      };
    }
    if (id.indexOf('layer:') === 0) {
      var sel = selectedLayer();
      if (!sel) return { layer: null };
      var field = id.split(':')[1];
      if (field === 'blend') return { blend: sel.blend, locked: !!sel.locked };
      if (field === 'cycleBlend') return { blend: sel.blend, locked: !!sel.locked };
      if (field === 'masterRot') return { rotationEnabled: sel.rotationEnabled };
      if (field === 'nextReactors') return { reactors: JSON.stringify(sel.reactors || []), locked: !!sel.locked };
      if (field === 'lock') return { locked: !!sel.locked };
      return { layerField: field, value: sel[field], locked: !!sel.locked };
    }
    if (id.indexOf('slider:') === 0) {
      return { sensitivity: readSensitivity(), temperature: readTemperature() };
    }
    if (id.indexOf('wave:') === 0 || id.indexOf('audioTop:') === 0) {
      var top = audioTopApi();
      var live = top && typeof top.getPreset === 'function' ? top.getPreset() : null;
      return { wave: live ? live.id : state.wave, stamp: state.waveStamp, audioTop: live ? live.id : state.wave };
    }
    if (id.indexOf('aspect:') === 0) {
      var canvas = stageCanvas();
      return {
        aspect: state.aspect,
        box: canvas && canvas.style ? (canvas.style.width + 'x' + canvas.style.height) : null,
      };
    }
    if (id.indexOf('stage:') === 0) {
      var A = audioCore();
      var lay = layers();
      return {
        clips: demoClipItems().length,
        layers: lay && Array.isArray(lay.list) ? lay.list.length : 0,
        song: hasSong(A),
        src: A && (A.audioEl || A.el) ? (A.audioEl || A.el).src : null,
        playing: !!(A && A.playing),
        cycling: !!(state.demoAllTimer || state.demoBeatRaf),
        preset: window.__swrCurrentPreset,
      };
    }
    if (id === 'demo:demoAll') {
      return { running: !!(state.demoAllTimer || state.demoBeatRaf) };
    }
    if (id === 'demo:reset') {
      return { preset: state.activePreset, filter: state.activeFilter };
    }
    return {};
  }

  window.SWR_NEON_DEMO = {
    mount: mount,
    unmount: unmount,
    collapse: collapsePanel,
    listShortcutPresets: listShortcutPresets,
    listGradePresets: listGradePresets,
    applyShortcutPreset: applyShortcutPreset,
    applyAudioPreset: applyAudioPreset,
    listAudioPresets: function () { return AUDIO_PRESETS.map(function (p) { return p.id; }); },
    applyGradePreset: applyGradePreset,
    applyLookFilter: applyLookFilter,
    isRotationOff: isRotationOff,
    isZoomOff: isZoomOff,
    isDistortionFxOff: isDistortionFxOff,
    installDemoClips: installDemoClips,
    loadDemoSong: loadDemoSong,
    startDemo: startDemo,
    toggleWebGL: toggleWebGL,
    webglState: webglState,
    stageSummary: stageSummary,
    fitAspectBox: fitAspectBox,
    labelAspect: labelAspect,
    heartbeatScale: heartbeatScale,
    applyStageAspect: applyStageAspect,
    writeSensitivity: writeSensitivity,
    writeTemperature: writeTemperature,
    markTransform: function () { return state.markNode ? state.markNode.getAttribute('transform') : ''; },
    hooks: hooks,
    listControls: listControls,
    invokeControl: invokeControl,
    readProbe: readProbe,
    assertAllControlsBound: assertAllControlsBound,
    getState: function () { return { collapsed: state.collapsed, activePreset: state.activePreset, activeFilter: state.activeFilter }; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mount(); }, { once: true });
  } else {
    mount();
  }
})();
