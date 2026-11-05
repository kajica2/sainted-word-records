// lib/chain-ui.client.js — the "Chain" view: an Ozone-style mastering
// surface over the engine's existing audio-reactive pipeline.
//
// WHAT THIS IS
// ------------
// A second way to drive the SAME engine. It adds no new rendering path and
// forks no engine code: every control here binds to a piece of engine state
// that already exists (the reactor contract, the per-layer base scale, the
// active visual preset, the audio analyser).
//
// WHY A QUERY PARAM AND NOT A COPIED HTML FILE
// ---------------------------------------------
// The repo's dist/ build has ~95 KB of headroom against its 180 MB CI budget
// gate. A second copy of engine.html (~470 KB) does not fit. So the Chain
// view is the SAME engine.html with `?chain=1`, which costs one <script> tag
// and one <link> tag and inherits every upstream engine fix for free.
//
// THE MODULE -> TARGET MAP
// ------------------------
// lib/apply-reactors.js defines exactly eight reactor targets:
// x, y, rot, hue, opacity, scale, brightness, contrast. Each Chain module
// owns a DISJOINT slice of them, so powering a module off removes exactly
// its own contribution and nothing else:
//
//   Vintage Tape   -> opacity              (analog transparency)
//   Vintage EQ     -> brightness, contrast (tonal shaping)
//   Vintage Comp   -> scale                (contour / level)
//   Imager         -> hue, rot             (phase / width)
//   Vintage Limiter-> (none)               (its job IS the ceiling clamp)
//   Vintage Width  -> x, y                 (movement / position)
//
// The Limiter having no target of its own is deliberate: a limiter is a
// ceiling. It is off => no clamp. It is on => out.opacity is capped at the
// Ceiling value. That is a real behaviour change, not a label.
//
// CLASSIC SCRIPT, NOT ESM
// -----------------------
// Every page in this repo is a global-script surface, and vite's
// `strip-absolute-module-scripts` plugin rewrites `type="module"` tags into
// plain defer classic scripts. See the LOADING section of
// lib/apply-reactors.js for the full reasoning.

(function () {
  'use strict';

  // Three ways in, because a rewrite is not the only way this URL arrives:
  //   ?chain=1        — the /alternate rewrite's destination
  //   /alternate      — the path itself, if the rewrite kept the address bar
  //   #chain          — a hand-typed fragment
  //
  // The rewrite's query string is the primary signal, but relying on a
  // rewrite destination's query surviving the proxy is a bet. Checking the
  // path as well means the view comes up even if the query is dropped —
  // the failure mode of a dropped query would otherwise be a silent
  // "the link went to the plain engine", which is exactly the kind of
  // thing nobody notices until someone reports the link is broken.
  var params = new URLSearchParams(location.search);
  var wantsChain = params.get('chain') === '1'
    || /(?:^|\/)alternate\/?$/.test(location.pathname)
    || location.hash === '#chain';
  if (!wantsChain) return;

  var MODULES = [
    { id: 'tape',    name: 'Vintage Tape',    glyph: '◉', targets: ['opacity'],
      note: 'Controls the opacity reactors — the analog transparency of each layer.' },
    { id: 'eq',      name: 'Vintage EQ',      glyph: '≋', targets: ['brightness', 'contrast'],
      variants: [['brightness', 'contrast'], ['brightness'], ['contrast']],
      note: 'Controls the brightness and contrast reactors — the tonal shaping.' },
    { id: 'comp',    name: 'Vintage Comp',    glyph: '◐', targets: ['scale'],
      note: 'Controls the scale reactors — how hard each layer breathes.' },
    { id: 'imager',  name: 'Imager',          glyph: '◈', targets: ['hue', 'rot'],
      variants: [['hue', 'rot'], ['hue'], ['rot']],
      note: 'Controls the hue and rotation reactors — the phase and spin.' },
    { id: 'limiter', name: 'Vintage Limiter', glyph: '▮', targets: [], ceiling: true,
      note: 'Caps the output level at the Ceiling value. Off means unclamped.' },
    { id: 'width',   name: 'Vintage Width',   glyph: '↔', targets: ['x', 'y'], addable: true,
      note: 'Controls the x and y reactors — how far layers travel. Absent from the rack by default, in which case those targets stay active.' }
  ];

  var MODES = [
    { id: 'tube',   label: 'Tube',   ease: 'soft' },
    { id: 'analog', label: 'Analog', ease: null },     // null = the engine's linear default
    { id: 'modern', label: 'Modern', ease: 'sharp' }
  ];

  var UTILS = ['bypass', 'gainmatch', 'reference', 'codec', 'other'];

  var state = {
    enabled: true,
    modules: { tape: true, eq: true, comp: true, imager: true, limiter: true, width: null },
    variants: {},                 // module id -> index into MODULES[i].variants
    mode: 'analog',
    character: 10,
    threshold: -60,              // dB. -60 disables gating (see dbToUnit).
    ceiling: -0.1,               // dB
    faders: [0, 0, 0, 0],        // dB per layer, -60..+6
    bypass: false,
    gainMatch: false,
    reference: false,
    codec: false,
    other: false,
    brand: 'ozone',
    tab: 'curve',
    preset: 'Full Mix',
    emaMag: 0                    // EMA of the magnitude the chain removed
  };

  var undoStack = [];
  var lastTransform = null;      // the post-chain transform of the last frame
  var lastReference = null;      // the pre-chain transform of the last frame
  var root = null;
  var graphCanvas = null;
  var graphCtx = null;
  var rafId = 0;
  var lastFrame = 0;
  var tdBuf = null;
  var freqBuf = null;
  var destroyed = false;
  var chainObserver = null;
  var engineSurfacePrepared = false;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  // dB -> linear amplitude fraction. -60 dB is effectively silence (0.001),
  // 0 dB is full scale (1.0). This is the physically correct reading of a
  // dB threshold, so the Threshold control behaves like a real one.
  function dbToUnit(db) { return clamp(Math.pow(10, db / 20), 0, 1); }

  // dB -> the opacity ceiling the Limiter applies. The engine clamps opacity
  // to 1.5, so the ceiling range maps onto 0..1.5.
  function dbToCeiling(db) { return clamp(1.5 * (db + 60) / 60, 0, 1.5); }

  function dbToGain(db) { return db <= -60 ? 0 : Math.pow(10, db / 20); }

  function formatDb(db) {
    if (db <= -60) return '-Inf';
    return (db > 0 ? '+' : '') + db.toFixed(1);
  }

  function modById(id) {
    for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i];
    return null;
  }

  // The targets a module currently owns, honouring its variant.
  function targetsFor(id) {
    var m = modById(id);
    if (!m) return [];
    if (m.variants) {
      var vi = state.variants[id] || 0;
      return m.variants[vi] || m.targets;
    }
    return m.targets;
  }

  // The union of every target that is not explicitly switched OFF.
  //
  // The semantics matter: a target is ACTIVE unless a module that owns it
  // is powered down. The addable "Vintage Width" module owns x and y and
  // is absent from the rack by default, so x/y stay active — which is what
  // keeps the chain's default state behaviourally identical to the plain
  // engine. (The first cut of this file used "enabled modules only", and
  // that silently switched off every x/y reactor the moment the chain
  // mounted: the layers stopped moving. The rack must not change what the
  // engine does until the user asks it to.)
  function activeTargets() {
    var out = [];
    for (var i = 0; i < MODULES.length; i++) {
      var m = MODULES[i];
      if (state.modules[m.id] === false) continue;   // explicitly off
      var ts = targetsFor(m.id);
      for (var j = 0; j < ts.length; j++) if (out.indexOf(ts[j]) === -1) out.push(ts[j]);
    }
    return out;
  }

  function modeEase() {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].id === state.mode) return MODES[i].ease;
    return null;
  }

  // We wrap window.SWR_REACTORS.applyReactor rather than editing the engine,
  // so the engine keeps its own source of truth and the Chain view can be
  // switched off completely (state.enabled) without touching it.
  function installEngineHook() {
    var RX = window.SWR_REACTORS;
    if (!RX || typeof RX.applyReactor !== 'function') return false;
    if (RX.__swrChainInstalled) return true;

    var orig = RX.applyReactor;

    RX.applyReactor = function (layer, audio, dt, opts) {
      if (!state.enabled) return orig(layer, audio, dt, opts);

      var o = opts || {};

      // Reference: capture the PRE-chain transform. applyReactor mutates the
      // base object it is handed, so the same opts cannot be run twice — the
      // reference pass gets its own copy.
      var ref = null;
      if (state.reference) {
        try {
          var copied = {};
          for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) copied[k] = o[k];
          if (o.base) copied.base = Object.assign({}, o.base);
          ref = orig(layer, audio, dt, copied);
        } catch (_) { ref = null; }
      }

      // Bypass: an empty allow-list suppresses every reactor target. The
      // layer's base transform still applies, which is exactly what bypass
      // means — the chain is out, the layer is not.
      if (state.bypass) {
        var bOpts = {};
        for (var k2 in o) if (Object.prototype.hasOwnProperty.call(o, k2)) bOpts[k2] = o[k2];
        bOpts.targets = [];
        var bOut = orig(layer, audio, dt, bOpts);
        // Gain Match: put back an EMA of what the chain was contributing so
        // the perceived level does not jump when you flip bypass.
        if (state.gainMatch && state.emaMag > 0.0005) {
          bOut.scale = bOut.scale * (1 + state.emaMag);
          bOut.opacity = bOut.opacity * (1 + state.emaMag * 0.5);
        }
        lastTransform = bOut;
        lastReference = ref;
        return bOut;
      }

      // 1. Module rack -> target allow-list.
      o.targets = activeTargets();

      // 2. Mode knob -> ease family. 'release' is this engine's own contour
      //    curve (an ease-out here, unlike lib/ease.js) and is always kept;
      //    every other ease name becomes the mode's curve.
      var origEase = o.ease;
      if (origEase) {
        var mEase = modeEase();
        o.ease = function (name, t) {
          var n = (name === 'release' || !mEase) ? name : mEase;
          return origEase(n, t);
        };
      }

      // 3. Threshold + Character -> the feature accessor.
      var origFeature = o.feature;
      if (origFeature) {
        var thr = dbToUnit(state.threshold);
        var ch = state.character / 10;
        o.feature = function (r) {
          var v = origFeature(r);
          if (typeof v !== 'number' || !isFinite(v)) v = 0;
          // 'key' resolves to a hue ANGLE (0..360), not an envelope, so a
          // threshold on it would be meaningless. Scale it, never gate it.
          if (thr > 0 && v < thr && !(r && r.feature === 'key')) v = 0;
          return v * ch;
        };
      }

      var out = orig(layer, audio, dt, o);

      // 4. Ceiling -> the Limiter's actual job, and only while it is on.
      if (state.modules.limiter && state.ceiling < 0) {
        var cap = dbToCeiling(state.ceiling);
        if (out.opacity > cap) out.opacity = cap;
      }

      // 5. Track what the chain removed, for Gain Match.
      if (ref) {
        var mag = Math.abs(out.scale - ref.scale) + Math.abs(out.opacity - ref.opacity);
        state.emaMag = state.emaMag * 0.9 + mag * 0.1;
      }

      lastTransform = out;
      lastReference = ref;
      return out;
    };

    RX.__swrChainInstalled = true;
    return true;
  }

  // layer.baseScale is the per-layer gain the engine already uses (it is
  // seeded from preset.fills). A fader multiplies it, remembering the
  // pre-fader value so a fader can always return to unity.
  function applyFader(i, db) {
    var layers = window.Layers && window.Layers.list;
    if (!layers || !layers[i]) return;
    var l = layers[i];
    if (typeof l.__swrChainBase !== 'number') l.__swrChainBase = l.baseScale || 1;
    var gain = dbToGain(db);
    // A fader at -Inf should mute, not produce a negative or NaN scale.
    l.baseScale = Math.max(0.02, l.__swrChainBase * (gain || 0.02));
    if (window.Layers && typeof window.Layers.render === 'function') {
      try { window.Layers.render(); } catch (_) {}
    }
  }

  function resetFaderBases() {
    var layers = window.Layers && window.Layers.list;
    if (!layers) return;
    for (var i = 0; i < layers.length; i++) delete layers[i].__swrChainBase;
    for (var j = 0; j < state.faders.length; j++) applyFader(j, state.faders[j]);
  }

  function presetKeys() {
    var p = window.VISUAL_PRESETS;
    return p ? Object.keys(p) : [];
  }

  function applyPreset(key) {
    var applied = false;
    try {
      if (typeof window.applyVisualPreset === 'function') {
        window.applyVisualPreset(key);
        applied = true;
      } else if (typeof window.applyPreset === 'function') {
        window.applyPreset(key);
        applied = true;
      }
    } catch (_) {}
    if (applied) {
      var p = window.VISUAL_PRESETS && window.VISUAL_PRESETS[key];
      state.preset = (p && p.name) || key;
      resetFaderBases();
      render();
    }
    return applied;
  }

  function cyclePreset(delta) {
    var keys = presetKeys();
    if (!keys.length) return false;
    var cur = -1;
    for (var i = 0; i < keys.length; i++) {
      var p = window.VISUAL_PRESETS[keys[i]];
      if ((p && p.name) === state.preset || keys[i] === state.preset) { cur = i; break; }
    }
    if (cur === -1) cur = 0;
    var next = keys[(cur + delta + keys.length) % keys.length];
    return applyPreset(next);
  }

  function analyser() {
    var A = window.A || window.Audio;
    return A && A.analyser ? A.analyser : null;
  }

  function readMeter() {
    var an = analyser();
    if (!an) return null;
    var n = an.fftSize || 2048;
    if (!tdBuf || tdBuf.length !== n) tdBuf = new Uint8Array(n);
    try { an.getByteTimeDomainData(tdBuf); } catch (_) { return null; }
    var peak = 0, sum = 0;
    for (var i = 0; i < n; i++) {
      var v = (tdBuf[i] - 128) / 128;
      var a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sum += v * v;
    }
    var rms = Math.sqrt(sum / n);
    return { peak: peak, rms: rms };
  }

  function readSpectrum() {
    var an = analyser();
    if (!an) return null;
    var n = an.frequencyBinCount || 1024;
    if (!freqBuf || freqBuf.length !== n) freqBuf = new Uint8Array(n);
    try { an.getByteFrequencyData(freqBuf); } catch (_) { return null; }
    return freqBuf;
  }

  // The curve is the LIVE audio spectrum off the engine's own analyser.
  // The Threshold is drawn as a rule; the curve is gated at that rule so
  // you can see what the gate is cutting. With Reference on, the ungated
  // spectrum is drawn behind as a ghost.
  function drawGraph() {
    if (!graphCanvas || !graphCtx) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = graphCanvas.clientWidth, chh = graphCanvas.clientHeight;
    if (!cw || !chh) return;
    if (graphCanvas.width !== Math.round(cw * dpr) || graphCanvas.height !== Math.round(chh * dpr)) {
      graphCanvas.width = Math.round(cw * dpr);
      graphCanvas.height = Math.round(chh * dpr);
    }
    var g = graphCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, chh);

    var spec = readSpectrum();
    var thr = dbToUnit(state.threshold);

    // Grid.
    g.strokeStyle = 'rgba(255,255,255,.07)';
    g.lineWidth = 1;
    for (var i = 1; i < 5; i++) {
      var y = (chh / 5) * i;
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(cw, y + 0.5); g.stroke();
    }

    // The 0 dB reference — the top of the well. Always drawn, so the panel
    // reads as a response curve even before a track is loaded.
    g.strokeStyle = 'rgba(63,200,216,.35)';
    g.lineWidth = 1;
    var zero = chh * 0.04;
    g.beginPath(); g.moveTo(0, zero + 0.5); g.lineTo(cw, zero + 0.5); g.stroke();

    if (!spec) {
      var hint = root && root.querySelector('.swr-chain__graph-hint');
      if (hint) hint.hidden = false;
      return;
    }
    var hintEl = root && root.querySelector('.swr-chain__graph-hint');
    if (hintEl) hintEl.hidden = true;

    var bins = spec.length;

    // Ghost: the raw, ungated spectrum.
    if (state.reference) {
      g.strokeStyle = 'rgba(232,68,127,.45)';
      g.lineWidth = 1.5;
      g.beginPath();
      for (var b = 0; b < bins; b++) {
        var vx = (b / (bins - 1)) * cw;
        var vy = chh - (spec[b] / 255) * chh * 0.92 - chh * 0.04;
        if (b === 0) g.moveTo(vx, vy); else g.lineTo(vx, vy);
      }
      g.stroke();
    }

    // The gated curve.
    g.strokeStyle = '#3fc8d8';
    g.lineWidth = 2;
    g.beginPath();
    for (var b2 = 0; b2 < bins; b2++) {
      var amp = spec[b2] / 255;
      var gated = (thr > 0 && amp < thr) ? 0 : amp;
      var x2 = (b2 / (bins - 1)) * cw;
      var y2 = chh - gated * chh * 0.92 - chh * 0.04;
      if (b2 === 0) g.moveTo(x2, y2); else g.lineTo(x2, y2);
    }
    g.stroke();

    // The threshold rule.
    if (thr > 0) {
      var ty = chh - thr * chh * 0.92 - chh * 0.04;
      g.strokeStyle = 'rgba(232,68,127,.7)';
      g.setLineDash([4, 4]);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, ty); g.lineTo(cw, ty); g.stroke();
      g.setLineDash([]);
    }
  }

  // The markup is static, so it is written as one template per region and
  // parsed once. That keeps this file inside the dist/ size budget (which
  // has ~11 KB of headroom) without giving up the markup's structure.
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function parse(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function buildTop() {
    var toggles = '';
    for (var i = 0; i < 5; i++) {
      var m = MODULES[i];
      toggles += '<button type="button" class="swr-chain__modtoggle" data-chain-toggle="' + m.id +
        '" aria-pressed="true" aria-label="' + esc(m.name) + ' on/off" title="' + esc(m.name) + ' — ' +
        esc(m.note) + '">' + m.glyph + '</button>';
    }
    var tools = '';
    var toolDefs = [
      ['edit', '✎', 'Edit chain', 'Show the chain detail view'],
      ['undo', '↺', 'Undo', 'Undo the last chain change'],
      ['settings', '⚙', 'Settings', 'Show the ungated spectrum behind the gated curve'],
      ['help', '?', 'Help', 'Show what each module does']
    ];
    for (var t = 0; t < toolDefs.length; t++) {
      tools += '<button type="button" class="swr-chain__tool" data-chain-action="' + toolDefs[t][0] +
        '" aria-label="' + esc(toolDefs[t][2]) + '" title="' + esc(toolDefs[t][3]) + '">' + toolDefs[t][1] + '</button>';
    }
    return parse(
      '<header class="swr-chain__top" data-chain-top>' +
        '<div class="swr-chain__brand">' +
          '<span class="swr-chain__logo">SWR</span>' +
          '<span class="swr-chain__logo-alt">Chain</span>' +
        '</div>' +
        '<button type="button" class="swr-chain__mix" data-chain-action="full-mix" aria-pressed="false" ' +
          'title="Reset the chain to full-mix defaults">Full Mix</button>' +
        '<div class="swr-chain__modtoggles" role="group" aria-label="Module bypass">' + toggles + '</div>' +
        '<div class="swr-chain__preset" role="group" aria-label="Chain preset">' +
          '<button type="button" class="swr-chain__nav" data-chain-action="preset-prev" aria-label="Previous preset">◀</button>' +
          '<span class="swr-chain__preset-name" data-chain-preset-name>Full Mix</span>' +
          '<button type="button" class="swr-chain__nav" data-chain-action="preset-next" aria-label="Next preset">▶</button>' +
        '</div>' +
        '<div class="swr-chain__tools">' + tools + '</div>' +
      '</header>'
    );
  }

  // The card names the reactor targets this module currently owns, so the
  // mapping is visible rather than implied. A module with variants shows
  // the variant in play.
  function targetLabel(m) {
    if (m.ceiling) return 'ceiling clamp';
    var ts = targetsFor(m.id);
    if (!ts.length) return 'no target';
    if (m.variants) {
      var vi = state.variants[m.id] || 0;
      return ts.join(' \u00b7 ') + (m.variants.length > 1 ? '  (' + (vi + 1) + '/' + m.variants.length + ')' : '');
    }
    return ts.join(' \u00b7 ');
  }

  function moduleCardHTML(m) {
    return '<article class="swr-chain__module" data-chain-module="' + m.id + '">' +
      '<div class="swr-chain__module-head">' +
        '<button type="button" class="swr-chain__power" data-chain-power="' + m.id + '" aria-pressed="true" ' +
          'aria-label="' + esc(m.name) + ' on/off" title="' + esc(m.name) + ' — ' + esc(m.note) + '">●</button>' +
        '<span class="swr-chain__module-name">' + esc(m.name) + '</span>' +
        (m.addable
          ? '<button type="button" class="swr-chain__module-x" data-chain-remove="' + m.id +
            '" aria-label="Remove ' + esc(m.name) + '">✕</button>'
          : '') +
      '</div>' +
      '<div class="swr-chain__module-body">' +
        '<span class="swr-chain__module-icon" aria-hidden="true">' + m.glyph + '</span>' +
        (m.variants
          ? '<button type="button" class="swr-chain__module-menu" data-chain-module-menu="' + m.id +
            '" aria-label="' + esc(m.name) + ' target variants" title="Cycle which targets this module owns">≡</button>'
          : '') +
      '</div>' +
      '<div class="swr-chain__module-targets">' + targetLabel(m) + '</div>' +
      '<div class="swr-chain__module-meter" aria-hidden="true"><i style="--v:0"></i></div>' +
    '</article>';
  }

  function buildRack() {
    var cards = '';
    for (var i = 0; i < MODULES.length; i++) {
      if (!MODULES[i].addable) cards += moduleCardHTML(MODULES[i]);
    }
    return parse(
      '<section class="swr-chain__rack" data-chain-rack role="group" aria-label="Chain modules">' + cards +
        '<article class="swr-chain__module swr-chain__module--empty" data-chain-addslot="width">' +
          '<button type="button" class="swr-chain__add" data-chain-action="add-module" ' +
            'aria-label="Add Vintage Width module" ' +
            'title="Add Vintage Width — gives the x and y reactors their own switch. ' +
            'They stay active while the module is absent, so the chain starts out ' +
            'behaving exactly like the plain engine.">+</button>' +
        '</article>' +
      '</section>'
    );
  }

  function buildMain() {
    var modes = '';
    for (var k = 0; k < MODES.length; k++) {
      modes += '<li data-knob-label="' + MODES[k].id + '">' + MODES[k].label + '</li>';
    }
    var readouts = '';
    var rDefs = [
      ['True Peak', 'truepeak', 'meter', '-Inf'],
      ['Threshold', 'threshold', 'value', 'Off'],
      ['Ceiling', 'ceiling', 'value', '-0.1 dB'],
      ['Character', 'character', 'value', '10.00']
    ];
    for (var r = 0; r < rDefs.length; r++) {
      readouts += '<div class="swr-chain__readout"><dt>' + rDefs[r][0] + '</dt>' +
        '<dd data-chain-' + rDefs[r][2] + '="' + rDefs[r][1] + '">' + rDefs[r][3] + '</dd></div>';
    }
    var inputs = '';
    var iDefs = [
      ['threshold', -60, 0, 0.1, 'Threshold dB', state.threshold],
      ['ceiling', -60, 0, 0.1, 'Ceiling dB', state.ceiling],
      ['character', 0, 10, 0.01, 'Character', state.character]
    ];
    for (var i = 0; i < iDefs.length; i++) {
      inputs += '<input type="range" data-chain-input="' + iDefs[i][0] + '" min="' + iDefs[i][1] +
        '" max="' + iDefs[i][2] + '" step="' + iDefs[i][3] + '" value="' + iDefs[i][5] +
        '" aria-label="' + iDefs[i][4] + '">';
    }
    var tabs = '';
    var tabDefs = [['curve', 'Curve'], ['chain', 'Chain']];
    for (var t = 0; t < tabDefs.length; t++) {
      var on = tabDefs[t][0] === 'curve' ? 'true' : 'false';
      tabs += '<button type="button" role="tab" class="swr-chain__viewtab" data-chain-tab="' + tabDefs[t][0] +
        '" id="swr-chain-tab-' + tabDefs[t][0] + '" aria-pressed="' + on + '" aria-selected="' + on + '">' +
        tabDefs[t][1] + '</button>';
    }
    var scale = '';
    var sLabels = ['0', '-5', '-10', '-15', '-20'];
    for (var s = 0; s < sLabels.length; s++) scale += '<span>' + sLabels[s] + '</span>';

    var main = parse(
      '<main class="swr-chain__main" data-chain-main>' +
        '<div class="swr-chain__mainhead">' +
          '<button type="button" class="swr-chain__brandtab" data-chain-brand="ozone" aria-pressed="true">Ozone</button>' +
          '<button type="button" class="swr-chain__brandtab" data-chain-brand="delta" aria-pressed="false" ' +
            'title="Delta is a simplified chain: EQ and Limiter only">Delta</button>' +
          '<div class="swr-chain__viewtabs" role="tablist" aria-label="Main view">' + tabs + '</div>' +
        '</div>' +
        '<div class="swr-chain__curveview" data-chain-view="curve" role="tabpanel" aria-labelledby="swr-chain-tab-curve">' +
          '<div class="swr-chain__graph">' +
            '<canvas data-chain-graph role="img" aria-label="Live audio response curve"></canvas>' +
            '<div class="swr-chain__graph-scale" aria-hidden="true">' + scale + '</div>' +
            '<div class="swr-chain__graph-hint">no audio — load a track to see the response</div>' +
          '</div>' +
          '<div class="swr-chain__knobwrap">' +
            '<div class="swr-chain__knob" data-chain-knob role="slider" tabindex="0" ' +
              'aria-label="Character mode" aria-valuemin="0" aria-valuemax="2" aria-valuenow="1" aria-valuetext="Analog">' +
              '<span class="swr-chain__knob-dial"></span></div>' +
            '<ul class="swr-chain__knoblabels" aria-hidden="true">' + modes + '</ul>' +
          '</div>' +
          '<dl class="swr-chain__readouts">' + readouts + '</dl>' +
          '<div class="swr-chain__faderwrap">' + inputs + '</div>' +
        '</div>' +
        '<div class="swr-chain__chainview" data-chain-view="chain" role="tabpanel" ' +
          'aria-labelledby="swr-chain-tab-chain" hidden>' +
          '<ul class="swr-chain__chainlist" data-chain-chainlist></ul>' +
        '</div>' +
      '</main>'
    );
    graphCanvas = main.querySelector('[data-chain-graph]');
    return main;
  }

  function buildOutput() {
    var faders = '';
    var scaleLabels = ['0', '-3', '-6', '-10', '-15', '-20', '-30', '-40', '-50', '-Inf'];
    var sc = '';
    for (var s = 0; s < scaleLabels.length; s++) sc += '<span>' + scaleLabels[s] + '</span>';
    for (var i = 0; i < 4; i++) {
      faders += '<div class="swr-chain__fader" data-chain-fader="' + i + '">' +
        '<div class="swr-chain__fader-scale" aria-hidden="true">' + sc + '</div>' +
        '<div class="swr-chain__fader-track">' +
          '<i class="swr-chain__fader-thumb" data-chain-thumb="' + i + '" tabindex="0" role="slider" ' +
            'aria-label="Layer ' + (i + 1) + ' gain" aria-valuemin="-60" aria-valuemax="6" ' +
            'aria-valuenow="0" aria-valuetext="0.0 dB"></i>' +
        '</div>' +
      '</div>';
    }
    var utils = '';
    var uDefs = [
      ['bypass', 'Bypass', 'Suppress every reactor target — the layers stop reacting'],
      ['gainmatch', 'Gain Match', 'Hold the perceived level steady while bypassing'],
      ['reference', 'Reference', 'Draw the ungated spectrum behind the gated curve'],
      ['codec', 'Codec', 'Draft preview — caps the canvas at 1x device pixel ratio'],
      ['other', 'Other', 'Toggle the engine debug overlay']
    ];
    for (var u = 0; u < uDefs.length; u++) {
      utils += '<button type="button" class="swr-chain__util" data-chain-toggle="' + uDefs[u][0] +
        '" aria-pressed="false" title="' + esc(uDefs[u][2]) + '">' + uDefs[u][1] + '</button>';
    }
    return parse(
      '<aside class="swr-chain__output" data-chain-output>' +
        '<div class="swr-chain__faders">' + faders + '</div>' +
        '<div class="swr-chain__meters">' +
          '<span data-chain-meter="peak">Peak -Inf</span>' +
          '<span data-chain-meter="lufs">LUFS -Inf</span>' +
        '</div>' +
        '<div class="swr-chain__utilities">' + utils + '</div>' +
      '</aside>'
    );
  }

  function setPressed(node, on) {
    if (node) node.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function render() {
    if (!root) return;

    // Module rack + top-bar toggles.
    $$('[data-chain-power]').forEach(function (n) {
      var id = n.getAttribute('data-chain-power');
      var on = state.modules[id] !== false;
      setPressed(n, on);
      var card = n.closest('.swr-chain__module');
      if (card) card.classList.toggle('is-off', !on);
    });
    $$('[data-chain-toggle]').forEach(function (n) {
      var id = n.getAttribute('data-chain-toggle');
      if (modById(id)) setPressed(n, state.modules[id] !== false);
    });

    // Preset name.
    var pn = $('[data-chain-preset-name]');
    if (pn) pn.textContent = state.preset;

    // Brand switch.
    $$('[data-chain-brand]').forEach(function (n) {
      setPressed(n, n.getAttribute('data-chain-brand') === state.brand);
    });

    // Tabs.
    $$('[data-chain-tab]').forEach(function (n) {
      var on = n.getAttribute('data-chain-tab') === state.tab;
      setPressed(n, on);
      n.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('[data-chain-view]').forEach(function (v) {
      v.hidden = v.getAttribute('data-chain-view') !== state.tab;
    });

    // Readouts.
    var th = $('[data-chain-value="threshold"]');
    if (th) th.textContent = state.threshold <= -60 ? 'Off' : formatDb(state.threshold) + ' dB';
    var ce = $('[data-chain-value="ceiling"]');
    if (ce) ce.textContent = formatDb(state.ceiling) + ' dB';
    var ch = $('[data-chain-value="character"]');
    if (ch) ch.textContent = state.character.toFixed(2);

    // Knob.
    var knob = $('[data-chain-knob]');
    if (knob) {
      var mi = 0;
      for (var i = 0; i < MODES.length; i++) if (MODES[i].id === state.mode) mi = i;
      knob.setAttribute('aria-valuenow', String(mi));
      knob.setAttribute('aria-valuetext', MODES[mi].label);
      // -135deg..+135deg across three positions.
      var angle = -135 + (mi / (MODES.length - 1)) * 270;
      knob.style.setProperty('--swr-knob-angle', angle.toFixed(1) + 'deg');
      var rootEl = root;
      if (rootEl) rootEl.style.setProperty('--swr-knob-angle', angle.toFixed(1) + 'deg');
    }
    $$('[data-knob-label]').forEach(function (li) {
      li.classList.toggle('is-active', li.getAttribute('data-knob-label') === state.mode);
    });

    // Range inputs.
    $$('[data-chain-input]').forEach(function (n) {
      var k = n.getAttribute('data-chain-input');
      var v = k === 'threshold' ? state.threshold : (k === 'ceiling' ? state.ceiling : state.character);
      if (parseFloat(n.value) !== v) n.value = String(v);
    });

    // Faders.
    for (var fi = 0; fi < state.faders.length; fi++) {
      var db = state.faders[fi];
      var thumb = $('[data-chain-thumb="' + fi + '"]');
      if (thumb) {
        thumb.setAttribute('aria-valuenow', String(db));
        thumb.setAttribute('aria-valuetext', formatDb(db) + ' dB');
        // -60..+6 dB mapped to 0..1, 1 = top of the track.
        var pos = (db + 60) / 66;
        thumb.style.setProperty('--swr-fader-pos', pos.toFixed(4));
        thumb.style.setProperty('--swr-fader-fill', pos.toFixed(4));
        var wrap = thumb.closest('.swr-chain__fader');
        if (wrap) {
          wrap.style.setProperty('--swr-fader-pos', pos.toFixed(4));
          wrap.style.setProperty('--swr-fader-fill', pos.toFixed(4));
        }
      }
    }

    // Utilities.
    UTILS.forEach(function (k) {
      var n = $('[data-chain-toggle="' + k + '"]');
      if (n) setPressed(n, !!state[k]);
    });

    renderModuleLabels();
    renderChainList();
  }

  function renderModuleLabels() {
    for (var i = 0; i < MODULES.length; i++) {
      var m = MODULES[i];
      var card = $('[data-chain-module="' + m.id + '"]');
      if (!card) continue;
      var lab = card.querySelector('.swr-chain__module-targets');
      if (lab) lab.textContent = targetLabel(m);
    }
  }

  function renderChainList() {
    var list = $('[data-chain-chainlist]');
    if (!list) return;
    list.innerHTML = '';
    for (var i = 0; i < MODULES.length; i++) {
      var m = MODULES[i];
      var li = el('li', 'swr-chain__chainitem');
      if (state.modules[m.id] === false) li.classList.add('is-off');
      var nm = el('span', 'swr-chain__chainitem-name', m.name);
      li.appendChild(nm);
      var tg = el('span', 'swr-chain__chainitem-targets');
      var ts = targetsFor(m.id);
      tg.textContent = m.ceiling ? 'ceiling clamp' : (ts.length ? ts.join(' · ') : 'no target');
      li.appendChild(tg);
      var note = el('span', 'swr-chain__chainitem-note', m.note);
      li.appendChild(note);
      list.appendChild(li);
    }
  }

  function snapshot() {
    return JSON.stringify({
      modules: state.modules,
      variants: state.variants,
      mode: state.mode,
      character: state.character,
      threshold: state.threshold,
      ceiling: state.ceiling,
      faders: state.faders,
      bypass: state.bypass,
      gainMatch: state.gainMatch,
      reference: state.reference,
      codec: state.codec,
      other: state.other,
      brand: state.brand,
      tab: state.tab
    });
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 20) undoStack.shift();
    var undoBtn = $('[data-chain-action="undo"]');
    if (undoBtn) undoBtn.disabled = false;
  }

  function undo() {
    var s = undoStack.pop();
    if (!s) return false;
    var o;
    try { o = JSON.parse(s); } catch (_) { return false; }
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) state[k] = o[k];
    var undoBtn = $('[data-chain-action="undo"]');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    for (var i = 0; i < state.faders.length; i++) applyFader(i, state.faders[i]);
    render();
    return true;
  }

  function setModule(id, on) {
    pushUndo();
    state.modules[id] = !!on;
    render();
  }

  function setBrand(b) {
    pushUndo();
    state.brand = b;
    // Ozone is the full five-module chain; Delta is the simplified pair.
    if (b === 'delta') {
      state.modules.tape = false;
      state.modules.comp = false;
      state.modules.imager = false;
      if (state.modules.width === null) state.modules.width = false;
    } else {
      state.modules.tape = true;
      state.modules.eq = true;
      state.modules.comp = true;
      state.modules.imager = true;
      state.modules.limiter = true;
    }
    render();
  }

  function setMode(m) {
    pushUndo();
    state.mode = m;
    render();
  }

  function setFader(i, db) {
    state.faders[i] = clamp(db, -60, 6);
    applyFader(i, state.faders[i]);
    render();
  }

  function setCodec(on) {
    state.codec = !!on;
    // Draft preview: cap the canvas at 1x device pixel ratio.
    try {
      var c = document.getElementById('render');
      if (c) {
        c.style.imageRendering = state.codec ? 'auto' : '';
        window.__swrChainDprCap = state.codec ? 1 : 0;
        if (typeof window.Layers !== 'undefined' && window.Layers.render) window.Layers.render();
      }
    } catch (_) {}
    render();
  }

  function setOther(on) {
    state.other = !!on;
    try {
      if (state.other) {
        if (!window.SWR_DEBUG_OVERLAY && typeof window.SWR_DEBUG_OVERLAY_BUILD === 'function') {
          window.SWR_DEBUG_OVERLAY_BUILD();
        }
      } else if (window.SWR_DEBUG_OVERLAY && typeof window.SWR_DEBUG_OVERLAY.destroy === 'function') {
        window.SWR_DEBUG_OVERLAY.destroy();
      }
    } catch (_) {}
    render();
  }

  function resetChain() {
    pushUndo();
    state.modules = { tape: true, eq: true, comp: true, imager: true, limiter: true, width: null };
    state.variants = {};
    state.mode = 'analog';
    state.character = 10;
    state.threshold = -60;
    state.ceiling = -0.1;
    state.faders = [0, 0, 0, 0];
    state.bypass = false;
    state.gainMatch = false;
    state.reference = false;
    state.preset = 'Full Mix';
    for (var i = 0; i < state.faders.length; i++) applyFader(i, 0);
    render();
  }

  function addModule(id) {
    if (state.modules[id]) return false;
    pushUndo();
    state.modules[id] = true;
    var rack = $('[data-chain-rack]');
    if (rack) {
      var slot = $('[data-chain-addslot]');
      var m = modById(id);
      if (slot && m) {
        var card = buildModuleCard(m);
        slot.parentNode.insertBefore(card, slot);
        slot.hidden = true;
      }
    }
    render();
    return true;
  }

  function removeModule(id) {
    if (!state.modules[id]) return false;
    pushUndo();
    // null = absent from the rack, NOT off. Its targets return to the
    // default (active), which is what 'no visible control' means here.
    state.modules[id] = null;
    var card = $('[data-chain-module="' + id + '"]');
    if (card) card.remove();
    var slot = $('[data-chain-addslot]');
    if (slot) slot.hidden = false;
    render();
    return true;
  }

  function cycleVariant(id) {
    var m = modById(id);
    if (!m || !m.variants) return false;
    pushUndo();
    var cur = state.variants[id] || 0;
    state.variants[id] = (cur + 1) % m.variants.length;
    render();
    return true;
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var powerBtn = t.closest('[data-chain-power]');
    if (powerBtn) {
      var pid = powerBtn.getAttribute('data-chain-power');
      setModule(pid, !state.modules[pid]);
      return;
    }

    var rmBtn = t.closest('[data-chain-remove]');
    if (rmBtn) { removeModule(rmBtn.getAttribute('data-chain-remove')); return; }

    var menuBtn = t.closest('[data-chain-module-menu]');
    if (menuBtn) { cycleVariant(menuBtn.getAttribute('data-chain-module-menu')); return; }

    var toggleBtn = t.closest('[data-chain-toggle]');
    if (toggleBtn) {
      var tid = toggleBtn.getAttribute('data-chain-toggle');
      if (modById(tid)) { setModule(tid, !state.modules[tid]); return; }
      if (UTILS.indexOf(tid) === -1) return;
      pushUndo();
      if (tid === 'codec') { setCodec(!state.codec); return; }
      if (tid === 'other') { setOther(!state.other); return; }
      state[tid] = !state[tid];
      render();
      return;
    }

    var brandBtn = t.closest('[data-chain-brand]');
    if (brandBtn) { setBrand(brandBtn.getAttribute('data-chain-brand')); return; }

    var tabBtn = t.closest('[data-chain-tab]');
    if (tabBtn) {
      pushUndo();
      state.tab = tabBtn.getAttribute('data-chain-tab');
      render();
      return;
    }

    var actionBtn = t.closest('[data-chain-action]');
    if (!actionBtn) return;
    var action = actionBtn.getAttribute('data-chain-action');
    if (action === 'preset-prev') { cyclePreset(-1); return; }
    if (action === 'preset-next') { cyclePreset(1); return; }
    if (action === 'full-mix') { resetChain(); return; }
    if (action === 'undo') { undo(); return; }
    if (action === 'edit') {
      pushUndo();
      state.tab = state.tab === 'chain' ? 'curve' : 'chain';
      render();
      return;
    }
    if (action === 'settings') {
      pushUndo();
      state.reference = !state.reference;
      render();
      return;
    }
    if (action === 'help') {
      pushUndo();
      state.tab = state.tab === 'chain' ? 'curve' : 'chain';
      render();
      return;
    }
    if (action === 'add-module') { addModule('width'); return; }
  }

  function onInput(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;

    var key = t.getAttribute('data-chain-input');
    if (key === 'threshold') { state.threshold = parseFloat(t.value); render(); return; }
    if (key === 'ceiling') { state.ceiling = parseFloat(t.value); render(); return; }
    if (key === 'character') { state.character = parseFloat(t.value); render(); return; }
  }

  var dragging = null;

  function faderDbFromEvent(e, track) {
    var r = track.getBoundingClientRect();
    if (!r.height) return 0;
    var y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    var frac = 1 - clamp(y / r.height, 0, 1);       // 1 = top
    return clamp(-60 + frac * 66, -60, 6);
  }

  function onPointerDown(e) {
    var thumb = e.target.closest && e.target.closest('[data-chain-thumb]');
    if (!thumb) return;
    var idx = parseInt(thumb.getAttribute('data-chain-thumb'), 10);
    var track = thumb.closest('.swr-chain__fader-track');
    if (!track) return;
    dragging = { idx: idx, track: track };
    e.preventDefault();
    setFader(idx, faderDbFromEvent(e, track));
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    setFader(dragging.idx, faderDbFromEvent(e, dragging.track));
  }

  function onPointerUp() { dragging = null; }

  function onKeyDown(e) {
    var knob = e.target.closest && e.target.closest('[data-chain-knob]');
    if (knob) {
      var mi = 0;
      for (var i = 0; i < MODES.length; i++) if (MODES[i].id === state.mode) mi = i;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMode(MODES[(mi + 1) % MODES.length].id);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        setMode(MODES[(mi - 1 + MODES.length) % MODES.length].id);
      }
      return;
    }
    var thumb = e.target.closest && e.target.closest('[data-chain-thumb]');
    if (thumb) {
      var idx = parseInt(thumb.getAttribute('data-chain-thumb'), 10);
      var step = e.shiftKey ? 6 : 1;
      if (e.key === 'ArrowUp') { e.preventDefault(); setFader(idx, state.faders[idx] + step); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setFader(idx, state.faders[idx] - step); }
      else if (e.key === 'Home') { e.preventDefault(); setFader(idx, 0); }
      else if (e.key === 'End') { e.preventDefault(); setFader(idx, -60); }
    }
  }

  function tick(ts) {
    if (destroyed) return;
    rafId = requestAnimationFrame(tick);
    if (document.hidden) return;
    if (ts - lastFrame < 66) return;   // ~15fps
    lastFrame = ts;

    var m = readMeter();
    if (m) {
      var peakDb = m.peak > 0 ? 20 * Math.log10(m.peak) : -Infinity;
      var lufs = m.rms > 0 ? 20 * Math.log10(m.rms) - 0.691 : -Infinity;
      var pe = $('[data-chain-meter="peak"]');
      if (pe) pe.textContent = 'Peak ' + (isFinite(peakDb) ? peakDb.toFixed(1) + ' dB' : '-Inf');
      var lu = $('[data-chain-meter="lufs"]');
      if (lu) lu.textContent = 'LUFS ' + (isFinite(lufs) ? lufs.toFixed(1) : '-Inf');
      var tp = $('[data-chain-meter="truepeak"]');
      if (tp) tp.textContent = isFinite(peakDb) ? peakDb.toFixed(1) + ' dB' : '-Inf';
    }

    // Module activity meters: how much each module is currently moving.
    var t = lastTransform;
    if (t) {
      var act = {
        tape: Math.abs(t.opacity - (lastReference ? lastReference.opacity : t.opacity)),
        eq: Math.abs(t.brightness - (lastReference ? lastReference.brightness : t.brightness)),
        comp: Math.abs(t.scale - (lastReference ? lastReference.scale : t.scale)),
        imager: Math.abs(t.hue - (lastReference ? lastReference.hue : t.hue)),
        limiter: 0
      };
      for (var k in act) {
        var bar = $('[data-chain-module="' + k + '"] .swr-chain__module-meter i');
        if (bar) bar.style.setProperty('--v', clamp(act[k], 0, 1).toFixed(3));
      }
    }

    drawGraph();
  }

  // The Chain view is a power-user surface, so it puts the engine into
  // Advanced mode — Basic mode hides #stage entirely and shows a simplified
  // first-run UI, which would leave the chain floating over nothing. The
  // stored preference is NOT changed (setMode's second argument skips the
  // localStorage write), so visiting /alternate does not silently switch
  // the user's default engine mode.
  //
  // The first-run persona picker is also dismissed for the same reason: it
  // is a full-screen modal at z-index 9999, above the chain overlay, and it
  // says itself that the persona can be changed later from the engine menu.
  // Switch the engine to Advanced mode so #stage is visible behind the
  // overlay. The engine's own basic-mode client re-applies its stored mode
  // when it initialises, and it initialises on DOMContentLoaded — AFTER
  // this deferred script runs. So a one-shot "set advanced" here can be
  // undone moments later, which put the chain over a hidden stage.
  //
  // A timer cannot fix that reliably. A MutationObserver on body's class
  // attribute can: whenever the engine's class flips away from
  // engine-advanced-mode, the chain re-asserts it. Deterministic, and it
  // costs nothing while nothing changes.
  //
  // This has to happen BEFORE the overlay mounts, not after: the overlay
  // waits for its stylesheet, and in that gap the engine is still in
  // Basic mode with #stage hidden — so the engine's render loop can draw
  // into a 0x0 canvas, which is an illegal drawImage source and kills the
  // frame. It also means a service-worker reload does not leave the chain
  // sitting over a blank stage.
  function ensureAdvanced() {
    var M = window.SWR_ENGINE_MODE;
    if (!M || typeof M.setMode !== 'function') return;   // not initialised yet
    var body = document.body;
    if (!body) return;
    var basic = body.classList.contains('engine-basic-mode');
    var advanced = body.classList.contains('engine-advanced-mode');
    // Neither yet: the engine's mode client has not initialised. Wait.
    if (!basic && !advanced) return;
    if (advanced) return;
    try { M.setMode('advanced', true); } catch (_) { return; }
    // The stage was display:none a moment ago, so the engine sized its
    // offscreen processing canvas to 0x0 and only re-fits on a resize.
    // drawImage() with a 0x0 canvas source is illegal and throws, killing
    // the render frame — so re-fit explicitly as well as via resize.
    try {
      var R = window.SWR && window.SWR.Renderer;
      if (R && typeof R.fit === 'function') R.fit();
    } catch (_) {}
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  }

  function prepareEngineSurface() {
    if (engineSurfacePrepared) { ensureAdvanced(); return; }
    engineSurfacePrepared = true;

    try {
      var observer = new MutationObserver(ensureAdvanced);
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      chainObserver = observer;
    } catch (_) {}

    // Also poll for a while: the mode client may not have run yet at all.
    var tries = 0;
    (function attempt() {
      if (destroyed) return;
      ensureAdvanced();
      if (++tries < 60) setTimeout(attempt, 150);
    })();
  }


  // The chain stylesheet is loaded ON DEMAND rather than through a <link>
  // in engine.html's <head>. Two reasons:
  //
  //   1. Bandwidth. With a <link>, every engine page view downloaded 22 KB
  //      of chain CSS that the overwhelming majority of visitors — who
  //      never open the chain — never use.
  //   2. Build size. Vite's engine entry bundle carried a dead 16 KB copy
  //      of it (see the rollupOptions.input note in vite.config.js).
  //
  // The overlay waits for the stylesheet before it mounts, so it never
  // appears unstyled. The engine page is visible underneath the whole
  // time, so a cold cache costs one extra request, not a blank screen.
  function loadStylesheet() {
    return new Promise(function (resolve) {
      if (document.querySelector('link[data-chain-style]')) return resolve();
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/lib/chain-ui.css';
      link.setAttribute('data-chain-style', '');
      var done = false;
      var finish = function () { if (done) return; done = true; resolve(); };
      link.onload = finish;
      link.onerror = finish;          // mount unstyled rather than not at all
      document.head.appendChild(link);
      setTimeout(finish, 3000);       // never block the UI on the stylesheet
    });
  }

  function boot() {
    if (destroyed) return;
    if (document.getElementById('swr-chain')) return;
    loadStylesheet().then(mount);
  }

  function mount() {
    if (destroyed) return;
    if (document.getElementById('swr-chain')) return;

    root = el('div', 'swr-chain');
    root.id = 'swr-chain';
    root.setAttribute('data-chain-root', '');
    root.setAttribute('aria-label', 'Chain mastering view');

    root.appendChild(buildTop());
    root.appendChild(buildRack());
    root.appendChild(buildMain());
    root.appendChild(buildOutput());

    document.body.appendChild(root);
    document.body.classList.add('swr-chain-active');
    document.documentElement.setAttribute('data-chain', '1');

    graphCtx = graphCanvas ? graphCanvas.getContext('2d') : null;

    // The engine may still be booting; retry the hook briefly.
    var tries = 0;
    (function tryHook() {
      if (destroyed) return;
      if (installEngineHook()) return;
      if (++tries < 60) setTimeout(tryHook, 100);
    })();

    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);

    render();
    rafId = requestAnimationFrame(tick);
    prepareEngineSurface();
  }

  function destroy() {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (chainObserver) { try { chainObserver.disconnect(); } catch (_) {} chainObserver = null; }
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerUp, true);
    if (root && root.parentNode) root.parentNode.removeChild(root);
    document.body.classList.remove('swr-chain-active');
    root = null;
  }

  window.SWR_CHAIN = {
    version: '1.0.0',
    state: state,
    modules: MODULES,
    modes: MODES,
    setModule: setModule,
    toggleModule: function (id) { return setModule(id, !state.modules[id]); },
    setMode: setMode,
    setCharacter: function (v) { state.character = clamp(v, 0, 10); render(); },
    setThreshold: function (db) { state.threshold = clamp(db, -60, 0); render(); },
    setCeiling: function (db) { state.ceiling = clamp(db, -60, 0); render(); },
    setFader: setFader,
    setBypass: function (on) { state.bypass = !!on; render(); },
    setGainMatch: function (on) { state.gainMatch = !!on; render(); },
    setReference: function (on) { state.reference = !!on; render(); },
    setCodec: setCodec,
    setOther: setOther,
    setBrand: setBrand,
    setTab: function (t) { state.tab = t; render(); },
    applyPreset: applyPreset,
    cyclePreset: cyclePreset,
    presetKeys: presetKeys,
    reset: resetChain,
    undo: undo,
    addModule: addModule,
    removeModule: removeModule,
    cycleVariant: cycleVariant,
    activeTargets: activeTargets,
    targetsFor: targetsFor,
    lastTransform: function () { return lastTransform; },
    lastReference: function () { return lastReference; },
    readMeter: readMeter,
    isEngineHooked: function () {
      return !!(window.SWR_REACTORS && window.SWR_REACTORS.__swrChainInstalled);
    },
    destroy: destroy
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
