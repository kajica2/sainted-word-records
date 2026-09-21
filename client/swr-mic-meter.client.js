// client/swr-mic-meter.client.js
//
// SWRMicMeter — reusable mic level meter UI component. Wraps a
// waveform canvas + 11 level bars + clip indicator on top of an
// AnalyserNode (passed directly, supplied by a SWRMediaInput, or
// created internally from a passed MediaStream).
//
// Public API (window.SWR_MIC_METER):
//   mount(target, options)   → { id, meter, canvas, levelsEl, clipEl }
//   unmount(targetOrId)      → boolean
//   meter.start() / .stop() / .setAnalyser(node) / .getState()
//
// Ownership modes (analyser > mediaInput > stream). Tunables on the
// public surface: LEVEL_BAR_COUNT=11, WARM_THRESHOLD=8, HOT_THRESHOLD=10,
// CLIP_RMS_THRESHOLD=0.95.

(function () {
  'use strict';
  if (window.SWR_MIC_METER) return;

  // Constants — exposed on the public surface.
  var LEVEL_BAR_COUNT = 11;
  var WARM_THRESHOLD = 8;
  var HOT_THRESHOLD = 10;
  var CLIP_RMS_THRESHOLD = 0.95;

  var CLASS_METER = 'swr-mic-meter';
  var CLASS_WAVEFORM = 'swr-mic-waveform';
  var CLASS_LEVELS = 'swr-mic-levels';
  var CLASS_LABELS = 'swr-mic-labels';
  var CLASS_CLIP = 'swr-mic-clip';
  var CLASS_BAR = 'swr-mic-level-bar';
  var CLASS_PEAK = 'peak';
  var STYLE_ID = 'swr-mic-meter-style';

  // State — mount registry keyed by id; keeps refs so unmount can find + clean up.
  var _mounts = {};
  var _mountCounter = 0;
  var _styleEl = null;
  // Tunables for dB-to-bar mapping.
  var DB_FLOOR = -60;
  var DB_CEIL = 6;
  var CLIP_HOLD_MS = 1000;

  function _warn(msg, err) {
    if (typeof console !== 'undefined' && console && console.warn) console.warn(msg, err || '');
  }
  function _getTarget(t) {
    if (!t) return null;
    if (typeof t === 'string') { try { return document.querySelector(t); } catch (_) { return null; } }
    return (t && t.nodeType === 1) ? t : null;
  }
  function _nextMountId() { _mountCounter += 1; return 'swrmm-' + _mountCounter; }
  function _emitError(options, error, message) {
    if (options && typeof options.onError === 'function') {
      try { options.onError({ error: error, message: message }); } catch (_) {}
    } else {
      _warn('swr-mic-meter: ' + error + ' — ' + message);
    }
  }

  // Create AudioContext + AnalyserNode owned by the meter (stream-only path).
  function _createOwnedAudioContext(stream, sampleRate, options) {
    var Ctor = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
    if (!Ctor) { _emitError(options, 'Unsupported', 'AudioContext unavailable'); return null; }
    var ac = null;
    try { ac = new Ctor({ sampleRate: sampleRate }); }
    catch (_) { try { ac = new Ctor(); } catch (e) { _emitError(options, 'AudioContextConstructionFailed', (e && e.message) || String(e)); return null; } }
    try {
      var src = ac.createMediaStreamSource(stream);
      var an = ac.createAnalyser();
      an.fftSize = 2048; an.smoothingTimeConstant = 0.8;
      src.connect(an);
      return { audioContext: ac, analyser: an };
    } catch (e) {
      try { ac.close(); } catch (_) {}
      _emitError(options, 'AnalyserSetupFailed', (e && e.message) || String(e));
      return null;
    }
  }

  function _injectStyles() {
    if (_styleEl || typeof document === 'undefined' || !document.head) return;
    _styleEl = document.createElement('style');
    _styleEl.id = STYLE_ID;
    _styleEl.textContent = METER_CSS;
    document.head.appendChild(_styleEl);
  }

  // DOM shape mirrors PRD §4 lines 525-554.
  function _mkEl(tag, cls, parent) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (parent) parent.appendChild(el);
    return el;
  }

  function _buildDOM() {
    var wrapper = _mkEl('div', CLASS_METER);
    var waveWrap = _mkEl('div', CLASS_WAVEFORM, wrapper);
    var canvas = _mkEl('canvas', CLASS_WAVEFORM + '-canvas', waveWrap);
    canvas.width = 200;
    canvas.height = 40;

    var levels = _mkEl('div', CLASS_LEVELS, wrapper);
    var bars = [];
    for (var i = 0; i < LEVEL_BAR_COUNT; i++) {
      var bar = _mkEl('div', CLASS_BAR + (i === LEVEL_BAR_COUNT - 1 ? ' ' + CLASS_PEAK : ''), levels);
      bar.style.height = '8%';
      bars.push(bar);
    }

    var labels = _mkEl('div', CLASS_LABELS, wrapper);
    var txts = ['-∞', '-12', '0', '+6'];
    for (var j = 0; j < txts.length; j++) {
      var sp = _mkEl('span', null, labels);
      sp.textContent = txts[j];
    }

    var clip = _mkEl('div', CLASS_CLIP, wrapper);
    clip.textContent = 'CLIP';

    return { wrapper: wrapper, canvas: canvas, levels: levels, bars: bars, clip: clip };
  }

  // RMS over byte time-domain buffer.
  function _computeRms(timeData) {
    var sum = 0;
    for (var i = 0; i < timeData.length; i++) { var v = (timeData[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / timeData.length);
  }

  // dB → bar count over [-60, +6]. bar_count = round((db+60)/66 * N).
  function _computeBarCount(db, n) {
    if (db <= DB_FLOOR) return 0;
    if (db >= DB_CEIL) return n;
    var c = Math.round(((db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)) * n);
    if (c < 0) return 0;
    if (c > n) return n;
    return c;
  }

  // Apply .active / .warm / .hot to bars [0, activeCount). Peak bar gets
  // .flash on clipping frames (CSS restarts via the offsetWidth reflow trick).
  function _updateLevelBars(bars, activeCount, isClipping) {
    for (var i = 0; i < bars.length; i++) {
      var bar = bars[i];
      var active = i < activeCount;
      bar.classList.toggle('active', active);
      if (active && i >= HOT_THRESHOLD) { bar.classList.add('hot'); bar.classList.remove('warm'); }
      else if (active && i >= WARM_THRESHOLD) { bar.classList.add('warm'); bar.classList.remove('hot'); }
      else { bar.classList.remove('warm'); bar.classList.remove('hot'); }
      if (i === LEVEL_BAR_COUNT - 1) {
        if (active && i >= HOT_THRESHOLD && isClipping) {
          bar.classList.remove('flash'); void bar.offsetWidth; bar.classList.add('flash');
        } else { bar.classList.remove('flash'); }
      }
    }
  }

  // Render time-domain waveform line.
  function _drawWaveform(ctx, timeData, w, h, color, bgColor) {
    ctx.fillStyle = bgColor; ctx.fillRect(0, 0, w, h);
    if (!timeData || timeData.length < 2) return;
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
    var sliceWidth = w / timeData.length, x = 0;
    for (var i = 0; i < timeData.length; i++) {
      var v = timeData[i] / 128, y = v * (h / 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();
  }

  // rAF draw loop — recursive requestAnimationFrame.
  function _draw(mountId) {
    var entry = _mounts[mountId];
    if (!entry || !entry.running) return;

    var analyser = entry.analyser;
    var rms = 0, db = DB_FLOOR, activeCount = 0, isClipping = false;

    if (analyser && typeof analyser.getByteTimeDomainData === 'function') {
      var binCount = analyser.frequencyBinCount || entry.timeData.length;
      if (entry.timeData.length !== binCount) entry.timeData = new Uint8Array(binCount);
      try {
        analyser.getByteTimeDomainData(entry.timeData);
        rms = _computeRms(entry.timeData);
        if (rms > 0) db = 20 * Math.log10(rms);
        if (db < DB_FLOOR) db = DB_FLOOR;
        if (db > DB_CEIL) db = DB_CEIL;
        activeCount = _computeBarCount(db, LEVEL_BAR_COUNT);
        isClipping = rms > CLIP_RMS_THRESHOLD;
      } catch (e) { _warn('swr-mic-meter: analyser read failed', e); }
    }

    _updateLevelBars(entry.bars, activeCount, isClipping);

    if (entry.ctx && entry.canvas) {
      _drawWaveform(entry.ctx, entry.timeData, entry.canvas.width, entry.canvas.height,
        entry.options.waveformColor || '#ff6b00',
        entry.options.bgColor || '#0a0d12');
    }

    // Clip latch — holds the indicator for CLIP_HOLD_MS so it doesn't blink off.
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (isClipping) {
      entry.clipCount += 1;
      entry.clipEl.classList.add('active');
      entry.clipActiveUntil = now + CLIP_HOLD_MS;
      if (typeof entry.options.onClip === 'function') {
        try { entry.options.onClip(rms); } catch (_) {}
      }
    } else if (now >= entry.clipActiveUntil) {
      entry.clipEl.classList.remove('active');
    }

    var st = entry.state;
    st.running = true; st.hasAnalyser = !!analyser;
    st.rms = rms; st.db = db; st.peak = activeCount; st.lastBarCount = activeCount;
    st.clipCount = entry.clipCount; st.clipActive = entry.clipEl.classList.contains('active');

    entry.rafId = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame(function () { _draw(mountId); })
      : null;
  }

  // Public: mount(target, options) → { id, meter, canvas, levelsEl, clipEl }
  function mount(target, options) {
    options = options || {};
    var host = _getTarget(target);
    if (!host) { _warn('swr-mic-meter: target not found', target); return null; }
    if (typeof document === 'undefined') { _warn('swr-mic-meter: document unavailable'); return null; }

    _injectStyles();

    // Resolve analyser source per ownership mode (analyser > mediaInput > stream).
    var analyser = null, audioContext = null, ownedContext = false;
    if (options.analyser) analyser = options.analyser;
    else if (options.mediaInput && options.mediaInput.analyser) analyser = options.mediaInput.analyser;
    else if (options.stream) {
      var owned = _createOwnedAudioContext(options.stream, options.sampleRate || 48000, options);
      if (!owned) return null;
      analyser = owned.analyser; audioContext = owned.audioContext; ownedContext = true;
    } else {
      _emitError(options, 'NoAnalyserSource', 'mount requires one of: options.analyser, options.mediaInput, options.stream');
      return null;
    }

    var dom = _buildDOM();
    host.appendChild(dom.wrapper);

    var id = _nextMountId();
    var initialBars = (analyser && analyser.frequencyBinCount) || 1024;
    var state = { running: false, hasAnalyser: !!analyser, rms: 0, db: DB_FLOOR, peak: 0, lastBarCount: 0, clipCount: 0, clipActive: false };
    var entry = {
      wrapperEl: dom.wrapper, analyser: analyser, audioContext: audioContext, ownedContext: ownedContext,
      canvas: dom.canvas, ctx: dom.canvas.getContext('2d'), levelsEl: dom.levels, bars: dom.bars, clipEl: dom.clip,
      timeData: new Uint8Array(initialBars), rafId: null, running: false, options: options,
      state: state, clipCount: 0, clipActiveUntil: 0,
    };

    var meter = {
      start: function () {
        if (entry.running || typeof requestAnimationFrame !== 'function') return;
        entry.running = true;
        entry.rafId = requestAnimationFrame(function () { _draw(id); });
      },
      stop: function () {
        entry.running = false;
        if (entry.rafId != null && typeof cancelAnimationFrame === 'function') { try { cancelAnimationFrame(entry.rafId); } catch (_) {} }
        entry.rafId = null;
        state.running = false;
      },
      setAnalyser: function (node) {
        entry.analyser = node;
        if (node && node.frequencyBinCount && entry.timeData.length !== node.frequencyBinCount) {
          entry.timeData = new Uint8Array(node.frequencyBinCount);
        }
        state.hasAnalyser = !!node;
      },
      getState: function () {
        return {
          running: entry.running, hasAnalyser: !!entry.analyser,
          rms: state.rms, db: state.db, peak: state.peak, lastBarCount: state.lastBarCount,
          clipCount: entry.clipCount, clipActive: entry.clipEl.classList.contains('active'),
        };
      },
    };

    _mounts[id] = entry;
    if (options.autoStart !== false) meter.start();

    return { id: id, meter: meter, canvas: dom.canvas, levelsEl: dom.levels, clipEl: dom.clip };
  }

  // Public: unmount(targetOrId) → boolean. Accepts element or id.
  function unmount(targetOrId) {
    var id = null;
    if (typeof targetOrId === 'string') {
      id = targetOrId;
    } else {
      for (var k in _mounts) {
        if (Object.prototype.hasOwnProperty.call(_mounts, k) && _mounts[k].wrapperEl === targetOrId) { id = k; break; }
      }
    }

    if (!id || !Object.prototype.hasOwnProperty.call(_mounts, id)) return false;
    var entry = _mounts[id];
    delete _mounts[id];

    entry.running = false;
    if (entry.rafId != null && typeof cancelAnimationFrame === 'function') { try { cancelAnimationFrame(entry.rafId); } catch (_) {} }
    entry.rafId = null;

    if (entry.ownedContext && entry.audioContext && typeof entry.audioContext.close === 'function') { try { entry.audioContext.close(); } catch (_) {} }
    if (entry.wrapperEl && entry.wrapperEl.parentNode) { try { entry.wrapperEl.parentNode.removeChild(entry.wrapperEl); } catch (_) {} }
    return true;
  }

  var METER_CSS =
    '.' + CLASS_METER + '{display:flex;flex-direction:column;gap:8px;padding:16px;background:var(--bg-surface,#1a1e28);border-radius:var(--radius-md,10px);font-family:var(--font-sans,sans-serif);}' +
    '.' + CLASS_WAVEFORM + '{height:40px;background:var(--bg-base,#0a0d12);border-radius:var(--radius-sm,6px);overflow:hidden;position:relative;}' +
    '.' + CLASS_WAVEFORM + '-canvas{width:100%;height:100%;display:block;}' +
    '.' + CLASS_LEVELS + '{display:flex;gap:2px;height:24px;align-items:flex-end;}' +
    '.' + CLASS_BAR + '{flex:1;background:var(--bg-hover,#222838);border-radius:2px 2px 0 0;transition:background 50ms ease,height 50ms ease;min-height:4px;height:8%;}' +
    '.' + CLASS_BAR + '.active{background:linear-gradient(180deg,#10b981,#059669);}' +
    '.' + CLASS_BAR + '.active.warm{background:linear-gradient(180deg,#f59e0b,#d97706);}' +
    '.' + CLASS_BAR + '.active.hot{background:linear-gradient(180deg,#ef4444,#dc2626);}' +
    '.' + CLASS_BAR + '.peak.active.hot.flash{animation:swrmm-peak-flash 0.2s ease;}' +
    '@keyframes swrmm-peak-flash{0%,100%{opacity:1;}50%{opacity:0.5;}}' +
    '.' + CLASS_LABELS + '{display:flex;justify-content:space-between;font-size:0.65rem;color:var(--text-muted,#6b7280);font-family:var(--font-mono,monospace);}' +
    '.' + CLASS_CLIP + '{text-align:center;font-size:0.75rem;font-weight:700;color:#ef4444;opacity:0;transition:opacity 150ms ease;letter-spacing:0.05em;}' +
    '.' + CLASS_CLIP + '.active{opacity:1;}';

  window.SWR_MIC_METER = {
    mount: mount,
    unmount: unmount,
    CLASS_METER: CLASS_METER,
    CLASS_WAVEFORM: CLASS_WAVEFORM,
    CLASS_LEVELS: CLASS_LEVELS,
    CLASS_LABELS: CLASS_LABELS,
    CLASS_CLIP: CLASS_CLIP,
    LEVEL_BAR_COUNT: LEVEL_BAR_COUNT,
    WARM_THRESHOLD: WARM_THRESHOLD,
    HOT_THRESHOLD: HOT_THRESHOLD,
    CLIP_RMS_THRESHOLD: CLIP_RMS_THRESHOLD,
  };
})();