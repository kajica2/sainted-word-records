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
  var DEFAULT_MS = 3000;
  var MIN_MS = 200;
  var MAX_MS = 120000;

  var state = {
    cues: [],
    raw: '',
    index: -1,
    playing: false,
    timer: null,
    caption: '',
    startedAt: 0,
    cueUntil: 0,
  };

  function lane() {
    return global.SWR_IMAGE_LANE || null;
  }

  function stylesApi() {
    return global.SWR_IMAGE_STYLES || null;
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

  function applyStill(asset) {
    if (!asset) return false;
    var L = lane();
    if (L && typeof L.add === 'function') {
      // Prefer stepping within the lane when the asset is already there.
      if (Array.isArray(L.list) && L.list.length) {
        for (var i = 0; i < L.list.length; i++) {
          var layer = L.list[i];
          if (layer && layer.asset && (layer.asset === asset || layer.asset.id === asset.id)) {
            if (typeof L.select === 'function') L.select(layer);
            var styles = stylesApi();
            var cur = L.selected || L.list[0];
            if (cur && cur.asset !== asset) {
              if (styles && typeof styles.swap === 'function') styles.swap(cur, asset);
              else if (typeof L.stepStill === 'function') {
                // Fall through to index jump via asset replace + style.
                if (styles && typeof styles.swap === 'function') styles.swap(cur, asset);
                else cur.asset = asset;
              } else {
                cur.asset = asset;
              }
            }
            return true;
          }
        }
        // Asset not in lane yet — add it.
        L.add(asset);
        return true;
      }
      L.add(asset);
      return true;
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
    if (L && typeof L.stepStill === 'function' && L.list && L.list.length) {
      return !!L.stepStill(delta);
    }
    var assets = stillAssets();
    if (assets.length < 2) return false;
    var cur = focusLayer();
    var curAsset = cur && cur.asset;
    var idx = 0;
    for (var i = 0; i < assets.length; i++) {
      if (curAsset && (assets[i] === curAsset || assets[i].id === curAsset.id)) {
        idx = i;
        break;
      }
    }
    var next = assets[(idx + (delta < 0 ? -1 : 1) + assets.length) % assets.length];
    var styles = stylesApi();
    if (cur && styles && typeof styles.swap === 'function') {
      return !!styles.swap(cur, next);
    }
    return applyStill(next);
  }

  function showCue(cue) {
    state.caption = cue && cue.text ? String(cue.text) : '';
    var assets = stillAssets();
    if (cue && cue.still) {
      var hit = resolveStill(cue.still, assets);
      if (hit) applyStill(hit);
      else advanceStill(1);
    } else if (cue) {
      // Default: step forward on every cue after the first.
      if (state.index > 0) advanceStill(1);
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
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    state.cueUntil = now + cue.durationMs;
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
    }, cue.durationMs);
  }

  function load(text, opts) {
    opts = opts || {};
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
    };
  }

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
    DEFAULT_SCRIPT: [
      '# duration_ms | caption | optional still (1-based or name)',
      '2500 | NEON · SWR',
      '3500 | drop a song. drop your stills.',
      '4000 | the picture follows the beat.',
      '3000 |',
    ].join('\n'),
  };
})(typeof window !== 'undefined' ? window : globalThis);
