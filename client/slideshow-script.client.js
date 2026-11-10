// client/slideshow-script.client.js — paste a script to drive still timing + captions.
// One global: window.SWR_SLIDESHOW.
//
// Script lines (one cue per line):
//   durationMs | text | optional still (1-based index or filename fragment)
//   # comments
// Empty text = advance photo with no caption.

(function (global) {
  'use strict';

  if (global.SWR_SLIDESHOW) return;

  var LS_KEY = 'swr.slideshowScript.v1';
  var MUSIC_LS = 'swr.slideshowMusic.v1';
  var DEFAULT_MS = 3000;
  var MIN_MS = 200;
  var MAX_MS = 120000;
  var MIN_MUSIC_SPEED = 0.25;
  var MAX_MUSIC_SPEED = 4;

  var state = {
    cues: [],
    raw: '',
    index: -1,
    playing: false,
    timer: null,
    caption: '',
    startedAt: 0,
    cueUntil: 0,
    // When musicDrive is on, cue dwell shrinks with audio energy × musicSpeed.
    // Off (default) keeps authored cue durations unchanged.
    musicDrive: false,
    musicSpeed: 1,
  };

  function lane() {
    return global.SWR_IMAGE_LANE || null;
  }

  function libraryItems() {
    if (global.SWR_LIB && Array.isArray(global.SWR_LIB.items)) return global.SWR_LIB.items;
    if (global.Library && Array.isArray(global.Library.items)) return global.Library.items;
    return [];
  }

  function status(msg, cls) {
    if (typeof global.setStatus === 'function') global.setStatus(msg, cls || 'ok');
  }

  function clampMs(n) {
    if (!Number.isFinite(n)) return DEFAULT_MS;
    return Math.max(MIN_MS, Math.min(MAX_MS, Math.round(n)));
  }

  function clampMusicSpeed(n) {
    var v = typeof n === 'number' && isFinite(n) ? n : parseFloat(n);
    if (!isFinite(v)) return 1;
    return Math.max(MIN_MUSIC_SPEED, Math.min(MAX_MUSIC_SPEED, v));
  }

  function persistMusic() {
    try {
      if (!global.localStorage) return;
      global.localStorage.setItem(MUSIC_LS, JSON.stringify({
        drive: !!state.musicDrive,
        speed: state.musicSpeed,
      }));
    } catch (_) {}
  }

  function restoreMusic() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(MUSIC_LS);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      if (typeof parsed.drive === 'boolean') state.musicDrive = parsed.drive;
      if (parsed.speed != null) state.musicSpeed = clampMusicSpeed(parsed.speed);
    } catch (_) {}
  }

  function audioFeat() {
    var A = global.A || (global.SWR && global.SWR.Audio) || null;
    return (A && A.feat) || null;
  }

  /**
   * Map cue duration → wall-clock wait. With music drive off, returns the
   * authored dwell. With drive on, louder / higher speed → shorter wait
   * (stills progress forward faster with the music).
   */
  function effectiveDuration(baseMs) {
    var base = clampMs(baseMs);
    if (!state.musicDrive) return base;
    var feat = audioFeat();
    var energy = 0;
    if (feat) {
      var rms = Number(feat.rms) || 0;
      var beat = Number(feat.beat) || 0;
      var bass = Number(feat.bass) || 0;
      energy = Math.max(0, Math.min(1, Math.max(rms, beat, bass * 0.85)));
    }
    var rate = Math.max(0.2, state.musicSpeed * (0.45 + 0.55 * energy));
    return clampMs(base / rate);
  }

  function setMusicDrive(on) {
    state.musicDrive = !!on;
    persistMusic();
    try {
      global.dispatchEvent(new CustomEvent('swr:slideshow-music', {
        detail: { drive: state.musicDrive, speed: state.musicSpeed },
      }));
    } catch (_) {}
    return state.musicDrive;
  }

  function setMusicSpeed(v) {
    state.musicSpeed = clampMusicSpeed(v);
    persistMusic();
    try {
      global.dispatchEvent(new CustomEvent('swr:slideshow-music', {
        detail: { drive: state.musicDrive, speed: state.musicSpeed },
      }));
    } catch (_) {}
    return state.musicSpeed;
  }

  /**
   * Parse absolute time "m:ss" / "mm:ss" / "h:mm:ss" into milliseconds.
   * Returns null when the token is not a clock time.
   */
  function parseClock(token) {
    var t = String(token || '').trim();
    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return null;
    var parts = t.split(':').map(function (p) { return parseInt(p, 10); });
    if (parts.some(function (n) { return !Number.isFinite(n); })) return null;
    var sec = 0;
    if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else sec = parts[0] * 60 + parts[1];
    return sec * 1000;
  }

  /**
   * Parse a slideshow script into cue objects.
   * Supports:
   *   3000 | caption | 2
   *   0:12 | caption | dancer
   * Absolute clock times become dwell durations relative to the previous cue.
   */
  function parse(text) {
    var lines = String(text || '').split(/\r?\n/);
    var cues = [];
    var lastAbs = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') continue;
      var parts = line.split('|');
      var head = (parts[0] || '').trim();
      var caption = parts.length > 1 ? String(parts[1] || '').trim() : '';
      var still = parts.length > 2 ? String(parts[2] || '').trim() : '';
      var durationMs = DEFAULT_MS;
      var abs = parseClock(head);
      if (abs != null) {
        durationMs = clampMs(Math.max(MIN_MS, abs - lastAbs));
        lastAbs = abs;
      } else {
        var n = parseFloat(head);
        if (Number.isFinite(n)) {
          // Values under 200 are treated as seconds (3 → 3000ms).
          durationMs = clampMs(n > 0 && n < 200 ? n * 1000 : n);
        } else if (parts.length === 1) {
          // Bare caption line with default dwell.
          caption = head;
        }
      }
      cues.push({
        durationMs: durationMs,
        text: caption,
        still: still || null,
        line: i + 1,
      });
    }
    return cues;
  }

  function stillAssets() {
    var L = lane();
    if (L && Array.isArray(L.list) && L.list.length) {
      return L.list.map(function (layer) { return layer && layer.asset; }).filter(Boolean);
    }
    return libraryItems().filter(function (it) {
      return it && it.type === 'image';
    });
  }

  function resolveStill(token, assets) {
    if (!token || !assets || !assets.length) return null;
    var t = String(token).trim();
    var asIndex = parseInt(t, 10);
    if (String(asIndex) === t && asIndex >= 1 && asIndex <= assets.length) {
      return assets[asIndex - 1];
    }
    var lower = t.toLowerCase();
    for (var i = 0; i < assets.length; i++) {
      var a = assets[i];
      var name = String((a && a.name) || '').toLowerCase();
      if (name && (name === lower || name.indexOf(lower) >= 0)) return a;
    }
    return null;
  }

  function focusLayer() {
    var L = lane();
    if (L && L.selected) return L.selected;
    if (L && L.list && L.list[0]) return L.list[0];
    var Layers = global.Layers;
    if (Layers && (Layers.sel || Layers.selected)) return Layers.sel || Layers.selected;
    if (Layers && Layers.list && Layers.list[0]) return Layers.list[0];
    return null;
  }

  /**
   * Slideshow shows ONE still at a time. Selecting a lower layer while
   * higher opaque stills stay visible would leave the cue covering
   * nothing on stage — hide every other lane layer and select the focus.
   */
  function focusLaneStill(layer) {
    var L = lane();
    if (!L || !layer || !Array.isArray(L.list) || !L.list.length) return false;
    for (var i = 0; i < L.list.length; i++) {
      if (!L.list[i]) continue;
      L.list[i].hidden = L.list[i] !== layer;
    }
    if (typeof L.select === 'function') L.select(layer);
    if (typeof L.render === 'function') L.render();
    try {
      if (global.SWR_RENDER && typeof global.SWR_RENDER.invalidate === 'function') {
        global.SWR_RENDER.invalidate();
      }
    } catch (_) {}
    return true;
  }

  function findLaneLayer(asset) {
    var L = lane();
    if (!L || !asset || !Array.isArray(L.list)) return null;
    for (var i = 0; i < L.list.length; i++) {
      var layer = L.list[i];
      if (layer && layer.asset && (layer.asset === asset || layer.asset.id === asset.id)) {
        return layer;
      }
    }
    return null;
  }

  function applyStill(asset) {
    if (!asset) return false;
    var L = lane();
    if (L && typeof L.add === 'function') {
      var existing = findLaneLayer(asset);
      if (existing) return focusLaneStill(existing);
      var added = L.add(asset);
      if (added) return focusLaneStill(added);
      // add() may return null when the asset was refused; try again by id.
      existing = findLaneLayer(asset);
      if (existing) return focusLaneStill(existing);
      return false;
    }
    var Layers = global.Layers;
    if (Layers && typeof Layers.add === 'function') {
      Layers.add(asset);
      return true;
    }
    return false;
  }

  function advanceStill(delta) {
    var L = lane();
    if (L && Array.isArray(L.list) && L.list.length) {
      var cur = L.selected || null;
      if (!cur) {
        for (var hi = 0; hi < L.list.length; hi++) {
          if (L.list[hi] && !L.list[hi].hidden) { cur = L.list[hi]; break; }
        }
      }
      if (!cur) cur = L.list[0];
      var idx = L.list.indexOf(cur);
      if (idx < 0) idx = 0;
      var next = L.list[(idx + (delta < 0 ? -1 : 1) + L.list.length) % L.list.length];
      return focusLaneStill(next);
    }
    var assets = stillAssets();
    if (assets.length < 2) return false;
    var focus = focusLayer();
    var curAsset = focus && focus.asset;
    var i = 0;
    for (var a = 0; a < assets.length; a++) {
      if (curAsset && (assets[a] === curAsset || assets[a].id === curAsset.id)) {
        i = a;
        break;
      }
    }
    var nextAsset = assets[(i + (delta < 0 ? -1 : 1) + assets.length) % assets.length];
    return applyStill(nextAsset);
  }

  function seedLaneFromLibrary() {
    var L = lane();
    if (!L || typeof L.add !== 'function') return false;
    if (Array.isArray(L.list) && L.list.length) return true;
    var lib = libraryItems().filter(function (it) {
      return it && it.type === 'image';
    });
    if (!lib.length) return false;
    for (var i = 0; i < lib.length; i++) {
      L.add(lib[i]);
    }
    if (L.list.length) focusLaneStill(L.list[0]);
    return L.list.length > 0;
  }

  function showCue(cue) {
    state.caption = cue && cue.text ? String(cue.text) : '';
    var assets = stillAssets();
    if (cue && cue.still) {
      var hit = resolveStill(cue.still, assets);
      if (hit) applyStill(hit);
      else advanceStill(1);
    } else if (cue) {
      // Default: step forward on every cue after the first. The opening
      // cue still needs a photo — focus the first lane still (seeded
      // from the library when the lane was empty at play()).
      if (state.index > 0) advanceStill(1);
      else {
        var L0 = lane();
        if (L0 && L0.list && L0.list.length) {
          focusLaneStill(L0.selected || L0.list[0]);
        } else if (assets[0]) {
          applyStill(assets[0]);
        }
      }
    }
    try {
      global.dispatchEvent(new CustomEvent('swr:slideshow-cue', {
        detail: {
          index: state.index,
          total: state.cues.length,
          text: state.caption,
          durationMs: cue ? cue.durationMs : 0,
        },
      }));
    } catch (_) {}
    try {
      if (global.SWR_RENDER && typeof global.SWR_RENDER.invalidate === 'function') {
        global.SWR_RENDER.invalidate();
      }
    } catch (_) {}
  }

  function clearTimer() {
    if (state.timer) {
      try { clearTimeout(state.timer); } catch (_) {}
      state.timer = null;
    }
  }

  function scheduleNext() {
    clearTimer();
    if (!state.playing) return;
    var cue = state.cues[state.index];
    if (!cue) {
      stop();
      return;
    }
    var waitMs = effectiveDuration(cue.durationMs);
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    state.cueUntil = now + waitMs;
    state.timer = setTimeout(function () {
      state.timer = null;
      if (!state.playing) return;
      if (state.index >= state.cues.length - 1) {
        stop();
        status('slideshow done', 'ok');
        return;
      }
      state.index += 1;
      showCue(state.cues[state.index]);
      scheduleNext();
    }, waitMs);
  }

  function load(text, opts) {
    opts = opts || {};
    // Replacing cues mid-play would leave the old timer armed against the
    // new list — stop first so Load never auto-advances on a stale deadline.
    stop({ keepCaption: false, silent: true });
    var raw = String(text == null ? '' : text);
    state.raw = raw;
    state.cues = parse(raw);
    state.index = -1;
    state.caption = '';
    if (opts.persist !== false) {
      try {
        if (global.localStorage) global.localStorage.setItem(LS_KEY, raw);
      } catch (_) {}
    }
    return state.cues.slice();
  }

  function play(opts) {
    opts = opts || {};
    if (!state.cues.length) {
      if (state.raw) load(state.raw, { persist: false });
    }
    if (!state.cues.length) {
      status('slideshow: paste a script first', 'warn');
      return false;
    }
    var assets = stillAssets();
    if (!assets.length) {
      status('slideshow: add stills first', 'warn');
      return false;
    }
    // Library stills with an empty lane used to play captions only on the
    // first cue, then add a single still on the second and get stuck.
    // Seed the whole library into the lane up front so numbered cues and
    // arrows have a real stack.
    seedLaneFromLibrary();
    stop({ keepCaption: true, silent: true });
    state.playing = true;
    state.index = 0;
    state.startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    showCue(state.cues[0]);
    scheduleNext();
    if (!opts.silent) status('slideshow · ' + state.cues.length + ' cues', 'ok');
    try {
      global.dispatchEvent(new CustomEvent('swr:slideshow-play', {
        detail: { cues: state.cues.length },
      }));
    } catch (_) {}
    return true;
  }

  function stop(opts) {
    opts = opts || {};
    var was = state.playing;
    state.playing = false;
    clearTimer();
    state.cueUntil = 0;
    if (!opts.keepCaption) state.caption = '';
    if (was && !opts.silent) {
      try {
        global.dispatchEvent(new CustomEvent('swr:slideshow-stop', { detail: {} }));
      } catch (_) {}
    }
    try {
      if (global.SWR_RENDER && typeof global.SWR_RENDER.invalidate === 'function') {
        global.SWR_RENDER.invalidate();
      }
    } catch (_) {}
    return true;
  }

  function toggle() {
    if (state.playing) return stop();
    return play();
  }

  function draw(ctx, W, H) {
    if (!ctx || !state.caption) return false;
    var w = W || ctx.canvas.width || 0;
    var h = H || ctx.canvas.height || 0;
    if (w < 8 || h < 8) return false;
    var text = String(state.caption);
    var size = Math.max(18, Math.min(42, Math.round(w * 0.028)));
    ctx.save();
    ctx.font = '600 ' + size + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    var x = w * 0.5;
    var y = h - Math.max(28, Math.round(h * 0.06));
    var metrics = ctx.measureText(text);
    var tw = Math.min(w * 0.86, Math.max(metrics.width + 28, 80));
    var th = size * 1.7;
    ctx.fillStyle = 'rgba(5,3,10,0.55)';
    ctx.fillRect(x - tw / 2, y - th + 6, tw, th);
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#f5e9ff';
    ctx.fillText(text, x, y - 8, w * 0.82);
    ctx.restore();
    return true;
  }

  function restoreSaved() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(LS_KEY);
      if (raw) load(raw, { persist: false });
    } catch (_) {}
  }

  function getState() {
    return {
      playing: state.playing,
      index: state.index,
      total: state.cues.length,
      caption: state.caption,
      raw: state.raw,
      cues: state.cues.slice(),
      musicDrive: !!state.musicDrive,
      musicSpeed: state.musicSpeed,
    };
  }

  restoreMusic();
  restoreSaved();

  global.SWR_SLIDESHOW = {
    parse: parse,
    load: load,
    play: play,
    stop: stop,
    toggle: toggle,
    draw: draw,
    advanceStill: advanceStill,
    prev: function () { return advanceStill(-1); },
    next: function () { return advanceStill(1); },
    getState: getState,
    getMusicDrive: function () { return !!state.musicDrive; },
    setMusicDrive: setMusicDrive,
    getMusicSpeed: function () { return state.musicSpeed; },
    setMusicSpeed: setMusicSpeed,
    effectiveDuration: effectiveDuration,
    MIN_MUSIC_SPEED: MIN_MUSIC_SPEED,
    MAX_MUSIC_SPEED: MAX_MUSIC_SPEED,
    DEFAULT_SCRIPT: [
      '# duration_ms | caption | optional still (1-based or name)',
      '2500 | NEON · SWR',
      '3500 | drop a song. drop your stills.',
      '4000 | the picture follows the beat.',
      '3000 |',
    ].join('\n'),
  };
})(typeof window !== 'undefined' ? window : globalThis);
