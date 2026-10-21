// client/engine-debugger.client.js
//
// SWR visual debugger — a standalone overlay that exposes the engine's
// live internal state on any SWR engine page.
//
// Designed to be injected on demand (bookmarklet, console paste, CDP) and
// to work without touching the host page's markup:
//
//   <script src="/client/engine-debugger.client.js"></script>
//   SWR_DEBUGGER.mount();
//
// Or paste this file's source into the console.
//
// ── Instrumentation principle ─────────────────────────────────────────────
// The debugger NEVER re-computes engine state and NEVER calls engine
// functions to obtain it. It wraps the two seams the renderer already
// exposes and records exactly what passes through them:
//
//   1. SWR_RENDER.frame(…, applyR, …)  →  the resolved per-layer transform
//   2. SWR_RENDER.imageEvolve(l, r)     →  the transform actually drawn
//
// Both wrappers forward to the original and return its value unchanged, so
// call count, call order and the audio damper's internal state are all
// untouched. The debugger cannot change what the engine renders.
//
// (Re-deriving the values instead — e.g. re-implementing applyR — would
// be wrong: SWR_AUDIO_DAMP.damp() is stateful, so an extra call advances
// the damper and changes the picture the debugger claims to describe.)
//
// Public API on window.SWR_DEBUGGER:
//   mount()                  → attach the overlay, start sampling
//   unmount()                → detach the overlay, release the wrappers
//   toggle()                 → mount/unmount
//   snapshot()               → current frame snapshot (probe-friendly)
//   history(n)               → last n feature history samples
//   SURFACES                 → the surface ids the overlay renders
//   version                  → '1.0.0'

(function () {
  'use strict';
  if (window.SWR_DEBUGGER) return;

  var VERSION = '1.0.0';

  // The surfaces the overlay renders. Each is emitted as a node carrying
  // data-surface="<id>" so an automated probe can assert coverage without
  // scraping presentation text.
  var SURFACES = [
    'audio-bars',
    'audio-bpm',
    'audio-pulse',
    'layer-rows',
    'layer-transform',
    'reactor-rows',
    'scope-canvas',
    'perf-stats',
    'master-states',
    'module-list',
    'layer-geometry',
    'drift-readout',
    'beat-strip',
  ];

  // Transform fields worth surfacing, with the short labels the engine's
  // own layer rows already use so the two panels read the same way.
  var FIELDS = [
    { key: 'scale', label: 'sc' },
    { key: 'opacity', label: 'op' },
    { key: 'hue', label: 'hu' },
    { key: 'contrast', label: 'ct' },
    { key: 'brightness', label: 'br' },
    { key: 'x', label: 'x' },
    { key: 'y', label: 'y' },
    { key: 'rot', label: 'rt' },
  ];

  // Audio features drawn as bars. `pulse` ones are booleans and are drawn
  // as indicators instead of bars.
  var BAR_FEATURES = ['bass', 'sub', 'mid', 'treble', 'air', 'rms', 'centroid'];
  var PULSE_FEATURES = ['beat', 'onset'];

  var HISTORY_MAX = 260;
  var PAINT_INTERVAL_MS = 90;   // overlay repaint cadence
  var SCOPE_INTERVAL_MS = 55;   // scope canvas cadence
  var MODULE_REFRESH_MS = 1200;

  var state = {
    mounted: false,
    frameIndex: 0,
    lastFrame: null,
    feat: {},
    history: [],
    modules: [],
    modulesAt: 0,
    perf: { fps: 0, frameMs: 0, dpr: 1 },
    lastPaint: 0,
    lastScope: 0,
    painted: null,
    dom: {},
    stage: { canvas: null, ctx: null, host: null },
    // The layer currently being drawn, set while the engine's drawToCtx
    // runs, so a captured drawImage can be attributed to it.
    currentLayer: null,
    // layerId → the geometry the engine last drew for that layer, in CSS
    // pixels. Persists across frames on purpose: the renderer caches a
    // layer's offscreen and skips its draw on a cache hit, so "where did
    // this layer last land" is the honest answer, not "where did it land
    // this frame".
    drawsByLayer: {},
    unwrap: [],
    _fpsAcc: [],
  };

  // ── helpers ────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  function num(v, digits) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    return v.toFixed(digits === undefined ? 2 : digits);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function now() { return performance.now(); }

  // ── instrumentation ─────────────────────────────────────────────────────

  // Record where the engine actually drew the current layer.
  //
  // This is the whole point of the geometry overlay: every variant has its
  // own draw convention (cover vs contain, rotation thresholds, the
  // engine-supplied offscreen), so modelling it would be wrong on at
  // least one page. Observing the real draw is right on all of them.
  //
  // The draw happens inside the context's own transform, which carries the
  // device-pixel-ratio scale and any rotation the page applied. Dividing
  // the transformed corners back out gives CSS pixels.
  function recordDraw(src, dx, dy, dw, dh) {
    var layer = state.currentLayer;
    if (!layer) return;
    var t;
    try { t = this.getTransform(); } catch (_) { return; }
    var dpr = Math.hypot(t.a, t.b) || 1;
    var corners = [[dx, dy], [dx + dw, dy], [dx + dw, dy + dh], [dx, dy + dh]];
    var css = corners.map(function (q) {
      return [(t.a * q[0] + t.c * q[1] + t.e) / dpr, (t.b * q[0] + t.d * q[1] + t.f) / dpr];
    });
    state.drawsByLayer[layer.id] = {
      quad: css,
      w: dw,
      h: dh,
      ox: dx,
      oy: dy,
      stageW: state.stageSize ? state.stageSize.W : 0,
      stageH: state.stageSize ? state.stageSize.H : 0,
      at: performance.now(),
    };
  }

  // Wrap a property on an object, remembering how to undo it.
  function wrapProp(obj, key, makeWrapper) {
    if (!obj) return false;
    var original = obj[key];
    if (typeof original !== 'function') return false;
    if (original.__swrDebuggerWrapped) return true;
    var wrapper = makeWrapper(original);
    wrapper.__swrDebuggerWrapped = true;
    wrapper.__swrDebuggerOriginal = original;
    obj[key] = wrapper;
    state.unwrap.push(function () { obj[key] = original; });
    return true;
  }

  // 1) Capture the resolved per-layer transform and the real draw.
  //
  // The engine calls applyR(l) once per layer per frame and passes the
  // result into its fade/LFO stage. We substitute a recording wrapper so
  // the value we show is the engine's own, not a recomputation.
  //
  // drawToCtx is wrapped for two reasons: it marks which layer is being
  // drawn (so a captured drawImage can be attributed), and it lets us
  // watch the engine-supplied offscreen context — the variant that draws
  // into it never touches the stage canvas directly.
  function instrumentFrame() {
    var R = window.SWR_RENDER;
    if (!R) return false;
    return wrapProp(R, 'frame', function (original) {
      return function (stage, ctx, layers, applyR, drawToCtx, opts) {
        var idx = ++state.frameIndex;
        var t = now();
        var captured = [];

        var recording = function (l) {
          var r = applyR(l);
          captured.push({ id: l.id, name: l.asset ? l.asset.name : '(empty)', asset: l.asset, r: r });
          return r;
        };

        var traced = function (l, r, c, cssW, cssH) {
          var prev = state.currentLayer;
          state.currentLayer = l;
          var restore = null;
          if (c && typeof c.drawImage === 'function' && !c.__swrDebuggerWrapped) {
            var orig = c.drawImage;
            c.drawImage = function (src, dx, dy, dw, dh) {
              recordDraw.call(this, src, dx, dy, dw, dh);
              return orig.apply(this, arguments);
            };
            restore = function () { c.drawImage = orig; };
          }
          try {
            return drawToCtx(l, r, c, cssW, cssH);
          } finally {
            if (restore) restore();
            state.currentLayer = prev;
          }
        };

        var result;
        try {
          result = original.call(this, stage, ctx, layers, recording, traced, opts);
        } finally {
          state.lastFrame = {
            index: idx,
            t: t,
            layers: captured,
            resolved: captured.map(function (c) { return c.r; }),
            drawn: state.drawnById,
          };
          state.drawnById = null;
        }
        return result;
      };
    });
  }

  // 2) Capture the transform that is actually painted.
  //
  // Pages call SWR_RENDER.imageEvolve(l, applyR(l)) from their own draw
  // path, so wrapping the exported property sees the final geometry —
  // including the Ken Burns drift the renderer adds on top of the
  // resolved transform.
  function instrumentImageEvolve() {
    var R = window.SWR_RENDER;
    if (!R) return false;
    return wrapProp(R, 'imageEvolve', function (original) {
      return function (l, r) {
        var out = original.apply(this, arguments);
        if (!state.drawnById) state.drawnById = {};
        state.drawnById[l.id] = out;
        return out;
      };
    });
  }

  // 3) Capture draws that land on the stage canvas itself. Variants that
  // draw into the engine's offscreen are covered by the drawToCtx wrapper
  // above; the ones that draw straight onto the stage are covered here.
  function instrumentStageCanvas() {
    var ctx = window.SWR && window.SWR.ctx;
    if (!ctx || typeof ctx.drawImage !== 'function') return false;
    return wrapProp(ctx, 'drawImage', function (original) {
      return function (src, dx, dy, dw, dh) {
        recordDraw.call(this, src, dx, dy, dw, dh);
        return original.apply(this, arguments);
      };
    });
  }

  function instrument() {
    var ok = false;
    if (instrumentFrame()) ok = true;
    if (instrumentImageEvolve()) ok = true;
    if (instrumentStageCanvas()) ok = true;
    return ok;
  }

  function uninstrument() {
    state.unwrap.forEach(function (fn) { try { fn(); } catch (_) {} });
    state.unwrap = [];
  }

  // ── sampling ───────────────────────────────────────────────────────────

  function sampleAudio() {
    var A = window.SWR && window.SWR.Audio;
    if (!A || !A.feat) return;
    state.feat = A.feat;
    // A pre-allocated ring buffer: this runs every frame, and allocating
    // a fresh sample object each time is pure GC pressure for no benefit.
    if (!state.historyBuf) {
      state.historyBuf = [];
      for (var i = 0; i < HISTORY_MAX; i++) {
        state.historyBuf.push({ t: 0, bass: 0, mid: 0, treble: 0, air: 0, rms: 0, beat: 0, onset: 0, bpm: 0 });
      }
      state.historyLen = 0;
    }
    var slot = state.historyBuf[state.historyLen % HISTORY_MAX];
    slot.t = now();
    slot.bass = A.feat.bass;
    slot.mid = A.feat.mid;
    slot.treble = A.feat.treble;
    slot.air = A.feat.air;
    slot.rms = A.feat.rms;
    slot.beat = A.feat.beat;
    slot.onset = A.feat.onset;
    slot.bpm = A.feat.bpm;
    state.historyLen++;
  }

  // The recorded samples, oldest first.
  function historyArray() {
    if (!state.historyBuf) return [];
    var count = Math.min(state.historyLen, HISTORY_MAX);
    var out = [];
    var start = state.historyLen - count;
    for (var i = 0; i < count; i++) {
      out.push(state.historyBuf[(start + i) % HISTORY_MAX]);
    }
    return out;
  }

  function samplePerf(dt) {
    if (dt > 0) {
      state._fpsAcc.push(1 / dt);
      if (state._fpsAcc.length > 30) state._fpsAcc.shift();
    }
    var sum = 0;
    for (var i = 0; i < state._fpsAcc.length; i++) sum += state._fpsAcc[i];
    state.perf.fps = state._fpsAcc.length ? sum / state._fpsAcc.length : 0;
    state.perf.dpr = window.devicePixelRatio || 1;
  }

  function refreshModules() {
    var names = [];
    for (var k in window) {
      if (k.length > 3 && k.slice(0, 3) === 'SWR' && k !== 'SWR_DEBUGGER') names.push(k);
    }
    names.sort();
    state.modules = names;
    state.modulesAt = now();
  }

  // ── overlay construction ───────────────────────────────────────────────

  var CSS = [
    '#swr-debugger{position:fixed;top:44px;right:0;bottom:36px;width:330px;z-index:10050;',
    'display:flex;flex-direction:column;background:rgba(10,6,18,0.93);',
    'border-left:1px solid #2a1d3e;color:#f5e9ff;',
    'font:9px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;',
    'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}',
    '#swr-debugger .d-head{flex:none;display:flex;align-items:center;gap:8px;padding:7px 10px;',
    'border-bottom:1px solid #2a1d3e;letter-spacing:0.16em;text-transform:uppercase;',
    'font-size:8px;color:#8a7aa0}',
    '#swr-debugger .d-head b{color:#ff2d8a;font-weight:700;text-shadow:0 0 8px rgba(255,45,138,0.6)}',
    '#swr-debugger .d-head .sp{flex:1}',
    '#swr-debugger .d-head button{background:none;border:none;color:#8a7aa0;cursor:pointer;',
    'font:11px/1 ui-monospace,monospace;padding:0 2px}',
    '#swr-debugger .d-head button:hover{color:#ff2d8a}',
    '#swr-debugger .d-body{flex:1 1 auto;overflow-y:auto;min-height:0}',
    '#swr-debugger section{border-bottom:1px solid #150b22}',
    '#swr-debugger .s-h{display:flex;align-items:center;gap:6px;padding:5px 10px 3px;',
    'font-size:8px;letter-spacing:0.16em;text-transform:uppercase;color:#8a7aa0}',
    '#swr-debugger .s-h .sp{flex:1}',
    '#swr-debugger .s-h em{font-style:normal;color:#00f0ff;font-size:8px}',
    '#swr-debugger .s-b{padding:2px 10px 8px}',
    '#swr-debugger .row{display:flex;align-items:center;gap:6px;margin:2px 0}',
    '#swr-debugger .row .k{width:58px;flex:none;color:#8a7aa0;letter-spacing:0.06em}',
    '#swr-debugger .row .v{width:46px;flex:none;text-align:right;color:#f5e9ff}',
    '#swr-debugger .bar{flex:1;height:5px;background:#0a0612;border:1px solid #2a1d3e;',
    'border-radius:2px;overflow:hidden;position:relative}',
    '#swr-debugger .bar i{position:absolute;left:0;top:0;bottom:0;width:0;',
    'background:linear-gradient(90deg,#ff2d8a,#fff04a);transition:none}',
    '#swr-debugger .bar.c i{background:linear-gradient(90deg,#00f0ff,#00ffa3)}',
    '#swr-debugger .led{width:7px;height:7px;border-radius:50%;background:#0a0612;',
    'border:1px solid #2a1d3e;flex:none}',
    '#swr-debugger .led.on{background:#ff2d8a;box-shadow:0 0 7px #ff2d8a}',
    '#swr-debugger .led.c.on{background:#00f0ff;box-shadow:0 0 7px #00f0ff}',
    '#swr-debugger .lay{border:1px solid #2a1d3e;border-radius:3px;padding:4px 6px;margin:3px 0;',
    'background:#150b22}',
    '#swr-debugger .lay .t{display:flex;align-items:center;gap:6px}',
    '#swr-debugger .lay .t .n{color:#ff2d8a;width:10px;flex:none}',
    '#swr-debugger .lay .t .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#swr-debugger .lay .t .bl{color:#00f0ff;flex:none;font-size:8px}',
    '#swr-debugger .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px 6px;margin-top:3px}',
    '#swr-debugger .grid div{display:flex;gap:4px;align-items:baseline}',
    '#swr-debugger .grid span{color:#8a7aa0;font-size:8px;width:14px;flex:none}',
    '#swr-debugger .grid b{font-weight:400;color:#f5e9ff}',
    '#swr-debugger .rx{display:flex;gap:6px;align-items:center;margin:1px 0;color:#8a7aa0}',
    '#swr-debugger .rx .f{color:#00f0ff;flex:none;width:52px;overflow:hidden;',
    'text-overflow:ellipsis;white-space:nowrap}',
    '#swr-debugger .rx .t2{color:#f5e9ff;flex:none;width:54px}',
    '#swr-debugger .rx .s{color:#8a7aa0;flex:none;width:34px;text-align:right}',
    '#swr-debugger .rx .vv{margin-left:auto;color:#ff2d8a}',
    '#swr-debugger canvas{display:block;width:100%;height:64px;background:#05030a;',
    'border:1px solid #2a1d3e;border-radius:3px}',
    '#swr-debugger .mods{color:#8a7aa0;word-break:break-all;line-height:1.5}',
    '#swr-debugger .mods i{font-style:normal;color:#00ffa3}',
    '#swr-debugger .mast{display:flex;flex-wrap:wrap;gap:4px}',
    '#swr-debugger .mast span{border:1px solid #2a1d3e;border-radius:2px;padding:1px 5px;',
    'color:#8a7aa0}',
    '#swr-debugger .mast span.on{color:#00ffa3;border-color:#00ffa3}',
    '#swr-debugger .mast span.off{color:#8a7aa0}',
    '#swr-debugger .empty{color:#8a7aa0;padding:2px 0}',
  ].join('');

  function buildOverlay() {
    var style = document.createElement('style');
    style.id = 'swr-debugger-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    var root = el('div');
    root.id = 'swr-debugger';

    var head = el('div', 'd-head');
    head.appendChild(el('b', null, 'SWR Debug'));
    head.appendChild(el('span', null, 'v' + VERSION));
    head.appendChild(el('span', 'sp'));
    var close = el('button', null, '×');
    close.title = 'Close (unmounts and releases the engine wrappers)';
    close.addEventListener('click', function () { api.unmount(); });
    head.appendChild(close);
    root.appendChild(head);

    var body = el('div', 'd-body');
    root.appendChild(body);

    function section(id, title) {
      var s = el('section');
      s.setAttribute('data-surface', id);
      var h = el('div', 's-h');
      h.appendChild(el('span', null, title));
      h.appendChild(el('span', 'sp'));
      var em = el('em');
      h.appendChild(em);
      s.appendChild(h);
      var b = el('div', 's-b');
      s.appendChild(b);
      body.appendChild(s);
      state.dom[id] = { root: s, head: em, body: b };
      return b;
    }

    // AUDIO
    var audioBody = section('audio-bars', 'Audio');
    state.dom['audio-bars'].bars = {};
    BAR_FEATURES.forEach(function (f, i) {
      var row = el('div', 'row');
      row.appendChild(el('span', 'k', f));
      var bar = el('div', i >= 5 ? 'bar c' : 'bar');
      var fill = el('i');
      bar.appendChild(fill);
      row.appendChild(bar);
      var val = el('span', 'v');
      row.appendChild(val);
      audioBody.appendChild(row);
      state.dom['audio-bars'].bars[f] = { fill: fill, val: val };
    });

    var bpmBody = section('audio-bpm', 'Tempo');
    var bpmRow = el('div', 'row');
    bpmRow.appendChild(el('span', 'k', 'bpm'));
    var bpmVal = el('span', 'v');
    bpmRow.appendChild(bpmVal);
    bpmBody.appendChild(bpmRow);
    state.dom['audio-bpm'].val = bpmVal;

    var pulseBody = section('audio-pulse', 'Pulse');
    var pulseRow = el('div', 'row');
    PULSE_FEATURES.forEach(function (f) {
      pulseRow.appendChild(el('span', 'k', f));
      var led = el('span', 'led' + (f === 'onset' ? ' c' : ''));
      pulseRow.appendChild(led);
      var v = el('span', 'v');
      pulseRow.appendChild(v);
      state.dom['audio-pulse'][f] = { led: led, val: v };
    });
    pulseBody.appendChild(pulseRow);

    // LAYERS
    var layersBody = section('layer-rows', 'Layers');
    state.dom['layer-rows'].items = [];

    // TRANSFORM
    var tfBody = section('layer-transform', 'Transform');
    state.dom['layer-transform'].items = [];

    // REACTORS
    var rxBody = section('reactor-rows', 'Reactors');
    state.dom['reactor-rows'].items = [];

    // SCOPE
    var scopeBody = section('scope-canvas', 'Scope');
    var canvas = document.createElement('canvas');
    canvas.width = 620;
    canvas.height = 128;
    scopeBody.appendChild(canvas);
    state.dom['scope-canvas'].canvas = canvas;
    state.dom['scope-canvas'].ctx = canvas.getContext('2d');

    // PERF
    var perfBody = section('perf-stats', 'Perf');
    state.dom['perf-stats'].rows = {};
    ['fps', 'frame', 'dpr', 'tier', 'stage'].forEach(function (k) {
      var row = el('div', 'row');
      row.appendChild(el('span', 'k', k));
      var v = el('span', 'v');
      v.style.width = 'auto';
      v.style.flex = '1';
      v.style.textAlign = 'left';
      row.appendChild(v);
      perfBody.appendChild(row);
      state.dom['perf-stats'].rows[k] = v;
    });

    // MASTERS
    var mastBody = section('master-states', 'Masters');
    var mast = el('div', 'mast');
    mastBody.appendChild(mast);
    state.dom['master-states'].wrap = mast;

    // MODULES
    var modsBody = section('module-list', 'Modules');
    var mods = el('div', 'mods');
    modsBody.appendChild(mods);
    state.dom['module-list'].wrap = mods;

    // GEOMETRY — the overlay drawn on the stage itself
    var geoBody = section('layer-geometry', 'Geometry');
    var geoNote = el('div', 'empty', 'no layers');
    geoBody.appendChild(geoNote);
    state.dom['layer-geometry'].note = geoNote;

    // DRIFT — resolved transform vs the transform actually drawn
    var driftBody = section('drift-readout', 'Drift');
    state.dom['drift-readout'].items = [];

    // BEAT STRIP
    var stripBody = section('beat-strip', 'Rhythm');
    var strip = document.createElement('canvas');
    strip.width = 620;
    strip.height = 40;
    stripBody.appendChild(strip);
    state.dom['beat-strip'].canvas = strip;
    state.dom['beat-strip'].ctx = strip.getContext('2d');

    document.body.appendChild(root);
    buildStageOverlay();
    return root;
  }

  // The stage overlay: a set of absolutely positioned boxes drawn over
  // the engine's own canvas, showing where each layer actually lands.
  // This is the "visual" in visual debugger — the side panel explains,
  // this shows.
  //
  // Boxes rather than a canvas: a full-stage canvas overlay adds a
  // composited layer the browser must blend on every frame, which
  // measurably costs the host page. A handful of thin borders does not.
  function buildStageOverlay() {
    var stage = window.SWR && window.SWR.stage;
    var host = stage && stage.parentElement;
    if (!host) return;
    var wrap = document.createElement('div');
    wrap.id = 'swr-debugger-stage';
    wrap.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:4;overflow:hidden;';
    host.appendChild(wrap);
    state.stage.canvas = wrap;
    state.stage.host = host;
  }

  function destroyStageOverlay() {
    if (state.stage.canvas && state.stage.canvas.parentNode) {
      state.stage.canvas.parentNode.removeChild(state.stage.canvas);
    }
    state.stage.canvas = null;
    // The boxes belong to the overlay that just went away; keeping them
    // would leave a remount reusing detached elements.
    state.stage.boxes = [];
  }

  // ── painting ───────────────────────────────────────────────────────────

  function paintAudio() {
    var d = state.dom['audio-bars'];
    if (!d || !d.bars) return;
    var f = state.feat || {};
    BAR_FEATURES.forEach(function (name) {
      var slot = d.bars[name];
      if (!slot) return;
      var v = typeof f[name] === 'number' ? f[name] : 0;
      slot.fill.style.width = Math.max(0, Math.min(1, v)) * 100 + '%';
      slot.val.textContent = num(v, 3);
    });
    if (state.dom['audio-bpm'] && state.dom['audio-bpm'].val) {
      state.dom['audio-bpm'].val.textContent = f.bpm ? String(Math.round(f.bpm)) : '—';
    }
    var pd = state.dom['audio-pulse'];
    if (pd) {
      PULSE_FEATURES.forEach(function (name) {
        var slot = pd[name];
        if (!slot) return;
        var on = !!f[name + 'Pulse'];
        slot.led.className = 'led' + (name === 'onset' ? ' c' : '') + (on ? ' on' : '');
        slot.val.textContent = num(typeof f[name] === 'number' ? f[name] : 0, 2);
      });
    }
  }

  function layerEntries() {
    var frame = state.lastFrame;
    if (!frame) return [];
    var drawn = frame.drawn || {};
    return frame.layers.map(function (c) {
      var d = drawn[c.id];
      return { id: c.id, name: c.name, asset: c.asset, resolved: c.r || {}, drawn: d || null };
    });
  }

  // The engine's CSS drawing dimensions. SWR_RENDER.fit() is the only
  // authority on these (it applies the 640×360 floor and the DPR cap),
  // so the debugger asks rather than re-deriving.
  function engineSize() {
    var stage = window.SWR && window.SWR.stage;
    if (!stage) return null;
    if (window.SWR_RENDER && window.SWR_RENDER.fit) {
      var f = window.SWR_RENDER.fit(stage);
      state.stageSize = { W: f.cssW, H: f.cssH, dpr: f.dpr };
      return { W: f.cssW, H: f.cssH, dpr: f.dpr, stage: stage };
    }
    state.stageSize = {
      W: Math.max(640, Math.round(stage.clientWidth)),
      H: Math.max(360, Math.round(stage.clientHeight)),
      dpr: window.devicePixelRatio || 1,
    };
    return {
      W: state.stageSize.W,
      H: state.stageSize.H,
      dpr: state.stageSize.dpr,
      stage: stage,
    };
  }

  // Where a layer lands on the stage, in CSS pixels.
  //
  // Preferred answer: the engine's own last draw, observed directly. Every
  // variant draws differently — cover fit vs contain, a rotation
  // threshold of 0.3 vs 0.5, the engine-supplied offscreen vs the stage
  // canvas — so modelling the convention would be wrong somewhere.
  //
  // Fallback for a layer that has not drawn yet: the same cover fit the
  // engine uses, centred on the stage and offset by the transform's
  // x/y, except when the layer is rotated, where the engine rotates
  // about the stage centre and drops the x/y offset entirely.
  function layerQuad(entry, W, H) {
    var recorded = state.drawsByLayer[entry.id];
    if (recorded && recorded.quad && recorded.stageW === W && recorded.stageH === H) {
      return {
        quad: recorded.quad,
        w: recorded.w,
        h: recorded.h,
        rot: 0,
        centered: false,
        observed: true,
      };
    }

    var r = entry.drawn || entry.resolved;
    if (!r) return null;
    var scale = r.scale || 1;
    var ar = 1;
    var a = entry.asset;
    if (a) {
      var sw = a.w || (a._el && a._el.naturalWidth) || (a._el && a._el.videoWidth) || 0;
      var sh = a.h || (a._el && a._el.naturalHeight) || (a._el && a._el.videoHeight) || 0;
      if (sw && sh) ar = sw / sh;
    }
    var car = W / H;
    var dw, dh;
    if (ar > car) { dh = H * scale; dw = dh * ar; } else { dw = W * scale; dh = dw / ar; }
    var rot = r.rot || 0;
    if (Math.abs(rot) > 0.5) {
      var rad = rot * Math.PI / 180;
      var cos = Math.cos(rad), sin = Math.sin(rad);
      var cx = W / 2, cy = H / 2;
      var quad = [[-dw / 2, -dh / 2], [dw / 2, -dh / 2], [dw / 2, dh / 2], [-dw / 2, dh / 2]].map(function (p) {
        return [cx + p[0] * cos - p[1] * sin, cy + p[0] * sin + p[1] * cos];
      });
      return { quad: quad, w: dw, h: dh, rot: rot, centered: true, observed: false };
    }
    var dx = (W - dw) / 2 + (r.x || 0);
    var dy = (H - dh) / 2 + (r.y || 0);
    return {
      quad: [[dx, dy], [dx + dw, dy], [dx + dw, dy + dh], [dx, dy + dh]],
      w: dw, h: dh, rot: 0, centered: false, observed: false,
    };
  }

  var LAYER_COLORS = ['#ff2d8a', '#00f0ff', '#fff04a', '#00ffa3'];

  function paintGeometry() {
    var wrap = state.stage.canvas;
    if (!wrap) return;
    var size = engineSize();
    if (!size) return;

    var entries = layerEntries();
    var note = state.dom['layer-geometry'] && state.dom['layer-geometry'].note;
    if (note) note.style.display = entries.length ? 'none' : '';

    // Reuse the boxes; only add or remove when the stack changes.
    var boxes = state.stage.boxes || (state.stage.boxes = []);
    while (boxes.length > entries.length) {
      var extra = boxes.pop();
      if (extra && extra.parentNode) extra.parentNode.removeChild(extra);
    }

    entries.forEach(function (e, i) {
      var q = layerQuad(e, size.W, size.H);
      if (!q) return;
      var box = boxes[i];
      if (!box) {
        box = document.createElement('div');
        box.style.cssText = 'position:absolute;left:0;top:0;border:1px solid currentColor;' +
          'transform-origin:0 0;will-change:transform;';
        wrap.appendChild(box);
        boxes[i] = box;
      }
      var color = LAYER_COLORS[i % LAYER_COLORS.length];
      var ax = q.quad[1][0] - q.quad[0][0];
      var ay = q.quad[1][1] - q.quad[0][1];
      var bx = q.quad[3][0] - q.quad[0][0];
      var by = q.quad[3][1] - q.quad[0][1];
      var w = Math.hypot(ax, ay);
      var h = Math.hypot(bx, by);
      var ang = Math.atan2(ay, ax);
      var cx = (q.quad[0][0] + q.quad[2][0]) / 2;
      var cy = (q.quad[0][1] + q.quad[2][1]) / 2;
      box.style.color = color;
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      box.style.transform = 'translate(' + (cx - w / 2) + 'px,' + (cy - h / 2) + 'px) rotate(' + ang + 'rad)';
      if (box.getAttribute('data-layer') !== e.id) {
        box.setAttribute('data-layer', e.id);
        box.setAttribute('data-label', 'L' + (i + 1));
        box.textContent = '';
        var tag = document.createElement('span');
        tag.textContent = 'L' + (i + 1);
        tag.style.cssText = 'position:absolute;left:2px;top:0;font:9px ui-monospace,monospace;color:' + color;
        box.appendChild(tag);
      }
    });
  }

  function paintDrift() {
    var d = state.dom['drift-readout'];
    if (!d) return;
    var entries = layerEntries();

    if (d.items.length !== entries.length) {
      d.body.innerHTML = '';
      d.items = [];
      entries.forEach(function (e, i) {
        var row = el('div');
        row.style.margin = '4px 0';

        var a = el('div', 'row');
        a.appendChild(el('span', 'k', 'L' + (i + 1) + ' res'));
        var av = el('span', 'v');
        av.style.width = 'auto';
        av.style.flex = '1';
        av.style.textAlign = 'left';
        a.appendChild(av);

        var b = el('div', 'row');
        b.appendChild(el('span', 'k', 'drawn'));
        var bv = el('span', 'v');
        bv.style.width = 'auto';
        bv.style.flex = '1';
        bv.style.textAlign = 'left';
        bv.style.color = '#00f0ff';
        b.appendChild(bv);

        row.appendChild(a);
        row.appendChild(b);
        d.body.appendChild(row);
        d.items.push({ res: av, drawn: bv });
      });
    }

    entries.forEach(function (e, i) {
      var slot = d.items[i];
      if (!slot) return;
      var r = e.resolved || {};
      var rec = state.drawsByLayer[e.id];
      slot.res.textContent = 'sc ' + num(r.scale, 2) + '  x ' + num(r.x, 1) + '  y ' + num(r.y, 1);
      slot.drawn.textContent = rec
        ? 'x ' + num(rec.ox, 1) + '  y ' + num(rec.oy, 1) +
          '  ' + Math.round(rec.w) + '×' + Math.round(rec.h)
        : 'not drawn yet';
    });
  }

  function paintBeatStrip() {
    var d = state.dom['beat-strip'];
    if (!d || !d.ctx) return;
    var g = d.ctx;
    var w = d.canvas.width;
    var h = d.canvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#05030a';
    g.fillRect(0, 0, w, h);

    var hist = historyArray();
    if (hist.length < 2) return;
    var n = hist.length;
    var step = w / Math.max(1, HISTORY_MAX - 1);
    var x0 = w - (n - 1) * step;

    for (var i = 0; i < n; i++) {
      var x = x0 + i * step;
      if (hist[i].onset > 0.6) {
        g.fillStyle = '#00f0ff';
        g.fillRect(x, 0, 1, 8);
      }
      if (hist[i].beat > 0.6) {
        g.fillStyle = '#ff2d8a';
        g.fillRect(x, h - 8, 1, 8);
      }
    }
  }

  function paintLayers() {
    var entries = layerEntries();
    var listDom = state.dom['layer-rows'];
    var tfDom = state.dom['layer-transform'];
    var rxDom = state.dom['reactor-rows'];
    if (!listDom || !tfDom || !rxDom) return;

    // Layer list
    if (listDom.items.length !== entries.length) {
      listDom.body.innerHTML = '';
      listDom.items = [];
      entries.forEach(function () {
        var box = el('div', 'lay');
        var t = el('div', 't');
        t.appendChild(el('span', 'n', String(listDom.items.length + 1)));
        t.appendChild(el('span', 'nm'));
        t.appendChild(el('span', 'bl'));
        box.appendChild(t);
        listDom.body.appendChild(box);
        listDom.items.push({ box: box, nm: t.children[1], bl: t.children[2] });
      });
    }
    entries.forEach(function (e, i) {
      var slot = listDom.items[i];
      if (!slot) return;
      slot.nm.textContent = e.name;
      slot.bl.textContent = e.resolved.blend || '';
    });

    // Transform grid — one row per layer, resolved values with the drawn
    // value in parentheses when the page's draw path reports one. The
    // rows are built once and updated in place; rebuilding them on every
    // repaint is the single most expensive thing this panel could do.
    var tf = tfDom;
    if (tf.items.length !== entries.length) {
      tf.body.innerHTML = '';
      tf.items = [];
      entries.forEach(function (e, i) {
        var row = el('div', 'row');
        row.appendChild(el('span', 'k', 'L' + (i + 1)));
        var grid = el('div', 'grid');
        grid.style.flex = '1';
        var cells = {};
        FIELDS.forEach(function (fld) {
          var cell = el('div');
          cell.appendChild(el('span', null, fld.label));
          var b = el('b', null, '—');
          b.setAttribute('data-field', fld.key);
          b.setAttribute('data-layer', e.id);
          cell.appendChild(b);
          grid.appendChild(cell);
          cells[fld.key] = b;
        });
        row.appendChild(grid);
        tf.body.appendChild(row);
        tf.items.push({ row: row, cells: cells });
      });
    }
    entries.forEach(function (e, i) {
      var slot = tf.items[i];
      if (!slot) return;
      FIELDS.forEach(function (fld) {
        var b = slot.cells[fld.key];
        if (b) b.textContent = num(e.resolved[fld.key], 2);
      });
    });

    // Reactors — the wiring plus the live feature that drives it.
    rxDom.body.innerHTML = '';
    var Layers = window.SWR && window.SWR.Layers;
    var list = Layers && Layers.list ? Layers.list : [];
    var any = false;
    list.forEach(function (l, i) {
      var reactors = l.reactors || [];
      if (!reactors.length) return;
      any = true;
      reactors.forEach(function (r) {
        var row = el('div', 'rx');
        row.appendChild(el('span', 'f', 'L' + (i + 1) + ' ' + r.feature));
        row.appendChild(el('span', 't2', '→ ' + r.target));
        row.appendChild(el('span', 's', '×' + num(r.scale, 2)));
        var vv = el('span', 'vv');
        var live = state.feat ? state.feat[r.feature] : undefined;
        vv.textContent = num(live, 2);
        row.appendChild(vv);
        rxDom.body.appendChild(row);
      });
    });
    if (!any) rxDom.body.appendChild(el('div', 'empty', 'no reactors'));
  }

  function paintPerf() {
    var d = state.dom['perf-stats'];
    if (!d || !d.rows) return;
    var p = state.perf;
    d.rows.fps.textContent = p.fps ? num(p.fps, 1) + ' fps' : '—';
    d.rows.frame.textContent = p.frameMs ? num(p.frameMs, 2) + ' ms' : '—';
    d.rows.dpr.textContent = num(p.dpr, 2);
    var tier = window.SWR_TIER && window.SWR_TIER.profile ? window.SWR_TIER.profile
      : (window.SWR_TIER && window.SWR_TIER.name) || '—';
    d.rows.tier.textContent = String(tier);
    var stage = window.SWR && window.SWR.stage;
    d.rows.stage.textContent = stage ? stage.width + '×' + stage.height : '—';
  }

  function paintMasters() {
    var d = state.dom['master-states'];
    if (!d || !d.wrap) return;
    var items = [
      ['tx', window.SWR_TX_MASTER ? window.SWR_TX_MASTER.enabled !== false : false],
      ['rot', window.SWR_ROT_MASTER ? window.SWR_ROT_MASTER.enabled === true : false],
      ['automix', window.SWR_AUTOMIX ? !!window.SWR_AUTOMIX.enabled : false],
      ['grade', !!window.SWR_GRADE],
      ['narrative', !!window.SWR_NARRATIVE],
      ['damp', !!window.SWR_AUDIO_DAMP],
      ['life', !!window.SWR_LIFE],
      ['fx', !!window.FX],
    ];
    d.wrap.innerHTML = '';
    items.forEach(function (it) {
      var s = el('span', it[1] ? 'on' : 'off', it[0]);
      d.wrap.appendChild(s);
    });
  }

  function paintModules() {
    var d = state.dom['module-list'];
    if (!d || !d.wrap) return;
    if (!state.modules.length || now() - state.modulesAt > MODULE_REFRESH_MS) refreshModules();
    d.wrap.innerHTML = '';
    var head = el('div');
    head.appendChild(el('i', null, String(state.modules.length) + ' loaded'));
    d.wrap.appendChild(head);
    var list = el('div');
    list.textContent = state.modules.join(' · ');
    d.wrap.appendChild(list);
  }

  function paintScope() {
    var d = state.dom['scope-canvas'];
    if (!d || !d.ctx) return;
    var g = d.ctx;
    var w = d.canvas.width;
    var h = d.canvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#05030a';
    g.fillRect(0, 0, w, h);

    var hist = historyArray();
    if (hist.length < 2) return;

    var series = [
      { key: 'bass', color: '#ff2d8a' },
      { key: 'mid', color: '#00f0ff' },
      { key: 'treble', color: '#fff04a' },
      { key: 'rms', color: '#00ffa3' },
    ];

    var n = hist.length;
    var step = w / Math.max(1, HISTORY_MAX - 1);
    var x0 = w - (n - 1) * step;

    // beat ticks along the bottom
    g.fillStyle = 'rgba(255,45,138,0.22)';
    for (var i = 0; i < n; i++) {
      if (hist[i].beat > 0.6) g.fillRect(x0 + i * step, h - 5, 1, 5);
    }

    series.forEach(function (s) {
      g.beginPath();
      g.strokeStyle = s.color;
      g.lineWidth = 1;
      for (var i = 0; i < n; i++) {
        var v = typeof hist[i][s.key] === 'number' ? hist[i][s.key] : 0;
        var y = h - 2 - Math.max(0, Math.min(1, v)) * (h - 8);
        if (i === 0) g.moveTo(x0, y); else g.lineTo(x0 + i * step, y);
      }
      g.stroke();
    });
  }

  function paint() {
    if (!state.mounted) return;
    paintAudio();
    paintLayers();
    paintPerf();
    paintMasters();
    paintModules();
    paintDrift();
    paintGeometry();
    // Capture what was just painted. The overlay repaints on a timer, so
    // the live snapshot and the painted DOM are necessarily a few frames
    // apart — this records the painted state so a probe can compare the
    // two without racing.
    state.painted = snapshotNow();
  }

  // ── loop ───────────────────────────────────────────────────────────────

  var lastTick = 0;

  function tick() {
    if (!state.mounted) return;
    var t = now();
    var dt = lastTick ? (t - lastTick) / 1000 : 0;
    lastTick = t;
    samplePerf(dt);
    sampleAudio();
    if (t - state.lastPaint > PAINT_INTERVAL_MS) {
      state.lastPaint = t;
      paint();
    }
    if (t - state.lastScope > SCOPE_INTERVAL_MS) {
      state.lastScope = t;
      paintScope();
    }
    requestAnimationFrame(tick);
  }

  // ── public API ─────────────────────────────────────────────────────────

  // The live engine state as of the last observed frame.
  function snapshotNow() {
    var frame = state.lastFrame;
    var size = engineSize();
    return {
      version: VERSION,
      mounted: state.mounted,
      frameIndex: state.frameIndex,
      perf: { fps: state.perf.fps, dpr: state.perf.dpr },
      feat: state.feat,
      size: size ? { W: size.W, H: size.H, dpr: size.dpr } : null,
      layers: layerEntries().map(function (e) {
        var el = e.asset && e.asset._el;
        var q = size ? layerQuad(e, size.W, size.H) : null;
        var rec = state.drawsByLayer[e.id];
        return {
          id: e.id,
          name: e.name,
          resolved: e.resolved,
          drawn: e.drawn,
          // A stable key for the element the layer actually draws, so a
          // probe can match a real draw call to this layer.
          elKey: el ? el.tagName + '#' + String(el.src || '').slice(-24) : '',
          quad: q ? q.quad : null,
          quadSize: q ? { w: q.w, h: q.h, rot: q.rot, centered: q.centered } : null,
          // True when the quad came from an observed engine draw rather
          // than from the modelled fallback.
          observed: q ? !!q.observed : false,
          drawOrigin: rec ? { x: rec.ox, y: rec.oy, w: rec.w, h: rec.h } : null,
        };
      }),
    };
  }

  var api = {
    version: VERSION,
    SURFACES: SURFACES,

    mount: function () {
      if (state.mounted) return api;
      if (!instrument()) {
        // The engine may not have booted yet — retry shortly.
        setTimeout(function () { if (!state.mounted) api.mount(); }, 250);
        return api;
      }
      state.mounted = true;
      buildOverlay();
      refreshModules();
      requestAnimationFrame(tick);
      return api;
    },

    unmount: function () {
      if (!state.mounted) return api;
      state.mounted = false;
      uninstrument();
      destroyStageOverlay();
      var root = $('swr-debugger');
      if (root && root.parentNode) root.parentNode.removeChild(root);
      var style = $('swr-debugger-style');
      if (style && style.parentNode) style.parentNode.removeChild(style);
      state.dom = {};
      state.painted = null;
      return api;
    },

    toggle: function () {
      return state.mounted ? api.unmount() : api.mount();
    },

    isMounted: function () { return state.mounted; },

    snapshot: function () {
      return snapshotNow();
    },

    // The state the overlay last rendered. The overlay repaints on a
    // timer, so this trails snapshot() by up to one paint interval.
    painted: function () {
      return state.painted;
    },

    history: function (n) {
      n = n || HISTORY_MAX;
      return historyArray().slice(-n);
    },
  };

  window.SWR_DEBUGGER = api;

  // Auto-mount when the file is injected directly (bookmarklet, console
  // paste, CDP). SWR_DEBUGGER.unmount() releases the engine wrappers and
  // removes the overlay again.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { api.mount(); }, { once: true });
  } else {
    api.mount();
  }
})();
