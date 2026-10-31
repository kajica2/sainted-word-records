// lib/command-center.client.js — the "Studio Command Center".
//
// ONE extended frontend for EVERY engine surface.
//
// WHY THIS EXISTS
// ---------------
// The repo ships 33 engine variants (aurora, chrome, eclipse, film, grid,
// hallucination, neon, pulse, smoke, void, watercolor …) and each one grew
// its own chrome: its own rails, its own sliders, its own debug panels. The
// depth an operator actually wants — live spectrum, the FX stack, the hook
// detector, the render-cost ledger — is either duplicated per variant or
// missing entirely.
//
// This module is the opposite: ONE control surface, injected into every
// variant, bound to the API they all share. It does not re-implement the
// engine and it does not touch the variant's own UI — it reads the same
// globals the variant already publishes and drives the same setters.
//
// THE SHARED CONTRACT (every variant exposes these)
// --------------------------------------------------
//   window.SWR.Audio / Library / Layers / Recorder / stage / ctx
//   window.Audio.feat        bass mid treble air sub rms centroid
//                             beat onset beatPulse onsetPulse bpm
//   window.Audio.params      { sens, gate, decay }
//   window.FX.state          the whole WebGL FX stack + its setters
//   window.SWR_STATS         record() / summary() -> render-cost ledger
//   window.SWR_HOOK_DETECTOR lastResult / detect() / exportHook()
//   window.SWR_MOOD          lastAnalysis / analyze() / applySuggestion()
//   window.SWR_SCENES        list() / save() / recall()
//   window.SWR_REACTORS      the shared reactor contract
//
// CLASSIC SCRIPT, NOT ESM
// -----------------------
// Every page in this repo is a global-script surface, and vite's
// `strip-absolute-module-scripts` plugin rewrites `type="module"` tags into
// plain defer classic scripts. See the LOADING section of
// lib/apply-reactors.js for the full reasoning.
//
// ACTIVATION
// ----------
//   ?cc=1        opens the Command Center on load
//   the ◈ launcher button (injected bottom-right of every variant)
//   Escape       closes it
//
// Nothing renders until it is opened, so a variant that never uses it pays
// one script tag and nothing else.

(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var WANTS_OPEN = params.get('cc') === '1';

  // ── helpers ──────────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

  // The engine API, resolved once and re-resolved if a variant is slow to
  // boot. `SWR.*` is the common denominator; the bare globals are the
  // fallback for surfaces that publish them directly.
  var api = { audio: null, library: null, layers: null, recorder: null, fx: null, stats: null, hook: null, mood: null, scenes: null };

  function resolveApi() {
    var G = window;
    var swr = G.SWR || {};
    api.audio = (G.Audio && G.Audio.feat) ? G.Audio : (swr.Audio || G.Audio || null);
    api.library = G.Library || swr.Library || null;
    api.layers = G.Layers || swr.Layers || null;
    api.recorder = G.Recorder || swr.Recorder || null;
    api.fx = G.FX || null;
    api.stats = G.SWR_STATS || null;
    api.hook = G.SWR_HOOK_DETECTOR || null;
    api.mood = G.SWR_MOOD || null;
    api.scenes = G.SWR_SCENES || null;
    return api;
  }

  function feat(name) {
    var f = api.audio && api.audio.feat;
    if (!f) return 0;
    var v = f[name];
    return typeof v === 'number' && isFinite(v) ? v : 0;
  }

  // ── state ────────────────────────────────────────────────────────────
  var state = {
    open: false,
    section: 'engine',      // engine | personas | library | audio | record | pt
    filters: {              // local mirror of FX.state so the sliders can bind
      brightness: 1, contrast: 1, saturate: 1, blur: 0, grayscale: 0, sepia: 0,
      temp: 0, glow: 0, chroma: 0, vignette: 0, posterize: 0, grain: 0,
    },
    layerHistory: [],       // rolling lifecycle samples
    renderHistory: [],      // rolling cost samples
    autoDrift: false,
    credits: null,
    personaFamily: 'all',
    presetCatalog: null,   // { id -> family } from /api/presets when available
    presetCatalogLoading: false,
  };

  var PERSONA_FAMILY_CHIPS = [
    ['all', 'All'],
    ['original', 'Original'],
    ['generative', 'Generative'],
    ['morpha', 'MORPHA'],
    ['train', 'Train'],
  ];

  var root = null;
  var rafId = 0;
  var lastFrame = 0;
  var destroyed = false;
  var mirrorCanvas = null;
  var spectrumCanvas = null;
  var spectrumCtx = null;
  var layersCtx = null;
  var hookCtx = null;
  var confidenceCtx = null;
  var costCtx = null;
  var layersCanvas = null;
  var gaugeCanvas = null;
  var hookCanvas = null;
  var costCanvas = null;

  // The implementation's own stylesheet, loaded on demand for the same
  // reason the implementation itself is: a variant visitor who never opens
  // the Command Center should not download 20 KB of CSS for it.
  function loadStylesheet() {
    return new Promise(function (resolve) {
      if (document.querySelector('link[data-swr-cc-css]')) return resolve();
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/lib/command-center.css';
      link.setAttribute('data-swr-cc-css', '');
      var done = false;
      var finish = function () { if (done) return; done = true; resolve(); };
      link.onload = finish;
      link.onerror = finish;
      document.head.appendChild(link);
      setTimeout(finish, 3000);
    });
  }

  // The launcher (lib/command-center-launcher.client.js) owns the ◈ button
  // and loads this file on demand — 47 KB of implementation is not something
  // every variant visitor should parse for a panel they did not open.
  var REQUESTED = !!window.__swrCCRequested;

  // ── DOM ──────────────────────────────────────────────────────────────
  function panel(title, extraClass) {
    var p = el('section', 'swr-cc-panel' + (extraClass ? ' ' + extraClass : ''));
    var h = el('header', 'swr-cc-panel-head');
    h.appendChild(el('h2', 'swr-cc-panel-title', title));
    var tools = el('div', 'swr-cc-panel-tools');
    h.appendChild(tools);
    p.appendChild(h);
    var body = el('div', 'swr-cc-panel-body');
    p.appendChild(body);
    p._tools = tools;
    p._body = body;
    return p;
  }

  function buildShell() {
    var shell = el('div', 'swr-cc');
    shell.id = 'swr-cc';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-label', 'Studio Command Center');
    shell.setAttribute('aria-modal', 'false');

    // ── top bar ──
    var top = el('header', 'swr-cc-top');
    var brand = el('div', 'swr-cc-brand');
    brand.appendChild(el('span', 'swr-cc-brand-mark', 'SWR'));
    brand.appendChild(el('span', 'swr-cc-brand-text', 'Studio Command Center'));
    top.appendChild(brand);

    var nav = el('nav', 'swr-cc-nav');
    nav.setAttribute('aria-label', 'Command Center sections');
    var sections = [
      ['engine', 'Engine'], ['personas', 'Personas'], ['library', 'Library'],
      ['audio', 'Audio'], ['record', 'Record'], ['pt', 'PT'],
    ];
    for (var i = 0; i < sections.length; i++) {
      var b = el('button', 'swr-cc-nav-btn', sections[i][1]);
      b.type = 'button';
      b.setAttribute('data-cc-section', sections[i][0]);
      b.setAttribute('aria-pressed', sections[i][0] === 'engine' ? 'true' : 'false');
      nav.appendChild(b);
    }
    top.appendChild(nav);

    var close = el('button', 'swr-cc-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close the Command Center');
    close.addEventListener('click', function () { toggle(false); });
    top.appendChild(close);
    shell.appendChild(top);

    // ── three columns ──
    var grid = el('div', 'swr-cc-grid');

    var left = el('div', 'swr-cc-col swr-cc-col--left');
    left.appendChild(buildAudioPanel());
    left.appendChild(buildPersonaPanel());
    left.appendChild(buildLayersPanel());
    grid.appendChild(left);

    var centre = el('div', 'swr-cc-col swr-cc-col--centre');
    centre.appendChild(buildStagePanel());
    grid.appendChild(centre);

    var right = el('div', 'swr-cc-col swr-cc-col--right');
    right.appendChild(buildLibraryPanel());
    right.appendChild(buildFiltersPanel());
    right.appendChild(buildRecordPanel());
    right.appendChild(buildMoodPanel());
    right.appendChild(buildScenesPanel());
    grid.appendChild(right);

    shell.appendChild(grid);

    // ── bottom bar ──
    var bottom = el('div', 'swr-cc-bottom');
    bottom.appendChild(buildConfidencePanel());
    bottom.appendChild(buildHookPanel());
    bottom.appendChild(buildAutoDriftPanel());
    bottom.appendChild(buildCreditsPanel());
    bottom.appendChild(buildCostPanel());
    shell.appendChild(bottom);

    return shell;
  }

  // ── panel: audio analysis ────────────────────────────────────────────
  function buildAudioPanel() {
    var p = panel('Audio Analysis');
    var body = p._body;

    var specWrap = el('div', 'swr-cc-spectrum');
    var cv = el('canvas', 'swr-cc-spectrum-canvas');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Live frequency spectrum');
    specWrap.appendChild(cv);
    body.appendChild(specWrap);
    spectrumCanvas = cv;
    spectrumCtx = cv.getContext('2d');

    var knobs = el('div', 'swr-cc-knobs');
    var knobDefs = [
      ['key', 'Key'], ['chroma', 'Chromagram'], ['phase', 'Beat phase'],
    ];
    for (var i = 0; i < knobDefs.length; i++) {
      var k = el('div', 'swr-cc-knob');
      var face = el('div', 'swr-cc-knob-face');
      face.setAttribute('data-cc-knob', knobDefs[i][0]);
      face.setAttribute('role', 'meter');
      face.setAttribute('aria-label', knobDefs[i][1]);
      face.setAttribute('aria-valuemin', '0');
      face.setAttribute('aria-valuemax', '100');
      face.setAttribute('aria-valuenow', '0');
      var arc = el('i', 'swr-cc-knob-arc');
      face.appendChild(arc);
      k.appendChild(face);
      k.appendChild(el('span', 'swr-cc-knob-label', knobDefs[i][1]));
      var val = el('span', 'swr-cc-knob-value', '—');
      val.setAttribute('data-cc-knob-value', knobDefs[i][0]);
      k.appendChild(val);
      knobs.appendChild(k);
    }
    body.appendChild(knobs);

    var demand = el('div', 'swr-cc-demand');
    demand.appendChild(el('span', 'swr-cc-demand-title', 'Peak demand'));
    var bars = el('div', 'swr-cc-demand-bars');
    var bandDefs = [['a1', 'A1'], ['low', 'LIN'], ['high', 'LIN'], ['air', 'CD']];
    for (var b = 0; b < bandDefs.length; b++) {
      var col = el('div', 'swr-cc-demand-col');
      var stack = el('div', 'swr-cc-demand-stack');
      for (var seg = 0; seg < 12; seg++) {
        var s = el('i', 'swr-cc-demand-seg');
        s.setAttribute('data-cc-band', bandDefs[b][0]);
        s.setAttribute('data-cc-seg', String(seg));
        stack.appendChild(s);
      }
      col.appendChild(stack);
      col.appendChild(el('span', 'swr-cc-demand-label', bandDefs[b][1]));
      bars.appendChild(col);
    }
    demand.appendChild(bars);
    body.appendChild(demand);

    var reactHead = el('div', 'swr-cc-subhead');
    reactHead.appendChild(el('span', null, 'Audio reactivity'));
    body.appendChild(reactHead);
    var react = el('div', 'swr-cc-audio-params');
    react.setAttribute('data-cc-audio-params', '');
    var audioParamDefs = [
      ['sens', 'Sensitivity', 0.2, 3, 0.05],
      ['gate', 'Gate', 1.05, 2.5, 0.05],
      ['decay', 'Decay', 0.5, 0.99, 0.01],
    ];
    for (var ap = 0; ap < audioParamDefs.length; ap++) {
      var pd = audioParamDefs[ap];
      var row = el('label', 'swr-cc-filter swr-cc-audio-param');
      row.appendChild(el('span', 'swr-cc-filter-label', pd[1]));
      var input = el('input', 'swr-cc-filter-range');
      input.type = 'range';
      input.setAttribute('data-cc-audio-param', pd[0]);
      input.min = String(pd[2]);
      input.max = String(pd[3]);
      input.step = String(pd[4]);
      input.setAttribute('aria-label', pd[1]);
      row.appendChild(input);
      var pval = el('span', 'swr-cc-filter-value', '—');
      pval.setAttribute('data-cc-audio-param-value', pd[0]);
      row.appendChild(pval);
      react.appendChild(row);
    }
    body.appendChild(react);
    return p;
  }

  // ── panel: personas ──────────────────────────────────────────────────
  // Each source knows how to hand back a LIST. Some publish an array, some
  // publish a map keyed by id, and SWR_LOOKS is an API OBJECT whose `list`
  // is a FUNCTION — reading Object.keys() off it yields the method names
  // (list, groups, apply, current, refresh), which is not a persona list.
  var PERSONA_SOURCES = [
    { g: 'SWR_PERSONA', k: 'PERSONAS' },
    { g: 'SWR_LOOKS', fn: 'list' },
    { g: 'LOOKS', fn: 'list' },
    { g: 'SWR_LOOKS', k: null, map: true },
    { g: 'LOOKS', k: null, map: true },
    { g: 'VISUAL_PRESETS', k: null, map: true },
  ];

  function personaListPush(byId, item, extras) {
    if (!item) return;
    var id = typeof item === 'string' ? item : (item.id || item.name);
    if (!id) return;
    id = String(id);
    if (byId[id]) return;
    var name = typeof item === 'string' ? item
      : (item.name || item.label || item.title || id);
    var row = { id: id, name: name };
    if (extras) {
      if (extras.family) row.family = extras.family;
      if (extras.source) row.source = extras.source;
    } else if (item.family) row.family = item.family;
    if (item.source) row.source = item.source;
    byId[id] = row;
  }

  function personaList() {
    var byId = {};
    for (var i = 0; i < PERSONA_SOURCES.length; i++) {
      var spec = PERSONA_SOURCES[i];
      var src = window[spec.g];
      if (!src) continue;
      var arr = null;
      if (spec.k && src[spec.k]) arr = src[spec.k];
      else if (spec.fn && typeof src[spec.fn] === 'function') {
        try { arr = src[spec.fn](); } catch (_) { arr = null; }
      }
      if (!arr && spec.map) {
        // A map of id -> preset. Only accept it when the values look like
        // presets (they carry a name), never when it is a bag of functions.
        var keys = Object.keys(src);
        var ok = keys.length && keys.some(function (k) {
          var v = src[k];
          return v && typeof v === 'object' && (v.name || v.label || v.title);
        });
        if (ok) arr = keys.map(function (k) { return { id: k, name: src[k].name || src[k].label || src[k].title || k }; });
      }
      if (!arr) continue;
      var list = Array.isArray(arr) ? arr : Object.keys(arr).map(function (k) {
        var v = arr[k];
        return (v && typeof v === 'object') ? v : { id: k, name: k };
      });
      for (var j = 0; j < list.length; j++) personaListPush(byId, list[j]);
    }
    if (window.SWR_PRESETS && typeof window.SWR_PRESETS.getAll === 'function') {
      var presets = window.SWR_PRESETS.getAll();
      for (var p = 0; p < presets.length; p++) {
        var pr = presets[p];
        if (!pr || !pr.id) continue;
        personaListPush(byId, pr, {
          family: (pr.family || 'GENERATIVE').toLowerCase(),
          source: 'preset',
        });
      }
    }
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function personaFamilyOf(item) {
    if (item.family) {
      var f = String(item.family).toLowerCase();
      if (f.indexOf('morpha') >= 0) return 'morpha';
      if (f.indexOf('train') >= 0) return 'train';
      if (f.indexOf('generative') >= 0) return 'generative';
      return f;
    }
    var id = String(item.id || item.name || '').toLowerCase();
    if (/^train|trainstage/.test(id)) return 'train';
    if (state.presetCatalog && state.presetCatalog[item.id]) {
      var cat = String(state.presetCatalog[item.id]).toLowerCase();
      if (cat.indexOf('morpha') >= 0) return 'morpha';
      if (cat.indexOf('train') >= 0) return 'train';
      return cat.indexOf('generative') >= 0 ? 'generative' : cat;
    }
    if (item.source === 'preset') return 'generative';
    return 'original';
  }

  function personaMatchesFamily(item) {
    var f = state.personaFamily;
    if (!f || f === 'all') return true;
    return personaFamilyOf(item) === f;
  }

  function buildPersonaPanel() {
    var p = panel('Personas', 'swr-cc-panel--personas');
    var body = p._body;
    var chips = el('div', 'swr-cc-family-chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Filter personas by family');
    for (var c = 0; c < PERSONA_FAMILY_CHIPS.length; c++) {
      var chip = el('button', 'swr-cc-family-chip', PERSONA_FAMILY_CHIPS[c][1]);
      chip.type = 'button';
      chip.setAttribute('data-cc-persona-family', PERSONA_FAMILY_CHIPS[c][0]);
      chip.setAttribute('aria-pressed', PERSONA_FAMILY_CHIPS[c][0] === 'all' ? 'true' : 'false');
      chips.appendChild(chip);
    }
    body.appendChild(chips);
    var grid = el('div', 'swr-cc-personas');
    grid.setAttribute('data-cc-personas', '');
    body.appendChild(grid);
    var meta = el('p', 'swr-cc-empty', 'No personas published on this surface.');
    meta.setAttribute('data-cc-personas-empty', '');
    meta.hidden = true;
    body.appendChild(meta);
    return p;
  }

  function fetchPresetCatalog() {
    if (state.presetCatalog || state.presetCatalogLoading) return;
    state.presetCatalogLoading = true;
    fetch('/api/presets').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      state.presetCatalogLoading = false;
      if (!data || !Array.isArray(data.presets)) return;
      var map = {};
      for (var i = 0; i < data.presets.length; i++) {
        var pr = data.presets[i];
        if (pr && pr.id) map[pr.id] = pr.family || 'GENERATIVE';
      }
      state.presetCatalog = map;
      renderPersonas(true);
    }).catch(function () { state.presetCatalogLoading = false; });
  }

  function renderPersonas(force) {
    var grid = $('[data-cc-personas]');
    if (!grid) return;
    var list = personaList().filter(personaMatchesFamily);
    var empty = $('[data-cc-personas-empty]');
    if (empty) empty.hidden = list.length > 0;
    var sig = state.personaFamily + ':' + list.map(function (it) { return it.id; }).join('|');
    if (!force && grid.getAttribute('data-sig') === sig) return;
    grid.setAttribute('data-sig', sig);
    grid.innerHTML = '';
    if (!list.length) return;
    for (var i = 0; i < list.length; i++) {
      (function (item) {
        var b = el('button', 'swr-cc-persona', item.name);
        b.type = 'button';
        b.setAttribute('data-cc-persona', item.id);
        b.setAttribute('aria-pressed', 'false');
        b.title = item.name;
        b.addEventListener('click', function () { applyPersona(item); });
        grid.appendChild(b);
      })(list[i]);
    }
  }

  function applyPersona(item) {
    var ok = false;
    try {
      if (window.SWR_LOOKS && typeof window.SWR_LOOKS.apply === 'function') {
        ok = !!window.SWR_LOOKS.apply(item.id);
      }
      if (!ok && window.SWR_PRESETS && typeof window.SWR_PRESETS.apply === 'function') {
        ok = !!window.SWR_PRESETS.apply(item.id);
      }
      if (!ok && api.fx && typeof api.fx.setPersona === 'function') { api.fx.setPersona(item.id); ok = true; }
      if (!ok && typeof window.applyPreset === 'function' && window.VISUAL_PRESETS && window.VISUAL_PRESETS[item.id]) {
        window.applyPreset(item.id); ok = true;
      }
    } catch (_) {}
    $$('[data-cc-persona]').forEach(function (n) {
      n.setAttribute('aria-pressed', n.getAttribute('data-cc-persona') === item.id ? 'true' : 'false');
    });
    if (ok && window.setStatus) window.setStatus('persona · ' + item.name, 'ok');
  }

  // ── panel: layers lifecycle ──────────────────────────────────────────
  function buildLayersPanel() {
    var p = panel('Layers lifecycle');
    var body = p._body;
    var cv = el('canvas', 'swr-cc-spark');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Layer lifecycle over time');
    body.appendChild(cv);
    layersCtx = cv.getContext('2d');
    layersCanvas = cv;
    var legend = el('div', 'swr-cc-legend');
    legend.appendChild(el('span', 'swr-cc-legend-item', 'layers'));
    legend.appendChild(el('span', 'swr-cc-legend-item', 'energy'));
    body.appendChild(legend);
    return p;
  }

  // ── panel: stage (live mirror of the variant's own canvas) ───────────
  function buildStagePanel() {
    var p = panel('Program', 'swr-cc-panel--stage');
    var body = p._body;
    body.classList.add('swr-cc-stage-body');
    var cv = el('canvas', 'swr-cc-mirror');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Live mirror of the engine output');
    body.appendChild(cv);
    mirrorCanvas = cv;
    var hud = el('div', 'swr-cc-stage-hud');
    var stats = el('span', 'swr-cc-hud-item');
    stats.setAttribute('data-cc-hud', 'stats');
    stats.textContent = '—';
    hud.appendChild(stats);
    var lyrs = el('span', 'swr-cc-hud-item');
    lyrs.setAttribute('data-cc-hud', 'layers');
    lyrs.textContent = '—';
    hud.appendChild(lyrs);
    body.appendChild(hud);
    return p;
  }

  // ── panel: library ───────────────────────────────────────────────────
  function buildLibraryPanel() {
    var p = panel('Library');
    var body = p._body;
    var list = el('div', 'swr-cc-library');
    list.setAttribute('data-cc-library', '');
    body.appendChild(list);
    return p;
  }

  function renderLibrary() {
    var host = $('[data-cc-library]');
    if (!host) return;
    var items = (api.library && api.library.items) ? api.library.items : [];
    var sig = items.length + ':' + items.slice(0, 6).map(function (i) { return i && i.name; }).join('|');
    if (host.getAttribute('data-sig') === sig) return;
    host.setAttribute('data-sig', sig);
    host.innerHTML = '';
    if (!items.length) {
      host.appendChild(el('p', 'swr-cc-empty', 'Library empty — drop clips on the engine surface.'));
      return;
    }
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var row = el('div', 'swr-cc-lib-row');
      row.appendChild(el('span', 'swr-cc-lib-idx', String(i + 1)));
      row.appendChild(el('span', 'swr-cc-lib-name', it.name || it.type || 'asset'));
      var badge = el('span', 'swr-cc-lib-badge', (it.type || '?').toUpperCase());
      row.appendChild(badge);
      host.appendChild(row);
    }
  }

  // ── panel: filters ───────────────────────────────────────────────────
  // The FX stack is REAL: window.FX.state carries every value and
  // window.FX.set* is the setter for each one. These sliders drive the
  // variant's own WebGL pipeline, not a mock.
  var FILTER_DEFS = [
    { key: 'brightness', label: 'Brightness', fx: 'setEnabled' },
    { key: 'contrast', label: 'Contrast' },
    { key: 'saturate', label: 'Saturate' },
    { key: 'blur', label: 'Blur' },
    { key: 'grayscale', label: 'Grayscale' },
    { key: 'sepia', label: 'Sepia' },
    { key: 'temp', label: 'Temperature', fx: 'setTemp' },
    { key: 'glow', label: 'Glow', fx: 'setGlow' },
    { key: 'chroma', label: 'Chroma', fx: 'setChroma' },
    { key: 'vignette', label: 'Vignette', fx: 'setVignette' },
    { key: 'posterize', label: 'Posterize', fx: 'setPosterize' },
    { key: 'grain', label: 'Grain', fx: 'setGrain' },
  ];

  function buildFiltersPanel() {
    var p = panel('Filters');
    var body = p._body;

    var sub = el('div', 'swr-cc-subhead');
    sub.appendChild(el('span', null, 'CSS filters'));
    body.appendChild(sub);

    var css = el('div', 'swr-cc-filters');
    css.setAttribute('data-cc-filters', 'css');
    body.appendChild(css);

    var sub2 = el('div', 'swr-cc-subhead');
    sub2.appendChild(el('span', null, 'WebGL FX stack'));
    var fxState = el('span', 'swr-cc-fxstate');
    fxState.setAttribute('data-cc-fxstate', '');
    fxState.textContent = 'off';
    sub2.appendChild(fxState);
    body.appendChild(sub2);

    var fx = el('div', 'swr-cc-filters');
    fx.setAttribute('data-cc-filters', 'fx');
    body.appendChild(fx);

    for (var i = 0; i < FILTER_DEFS.length; i++) {
      var d = FILTER_DEFS[i];
      var row = el('label', 'swr-cc-filter');
      row.appendChild(el('span', 'swr-cc-filter-label', d.label));
      var input = el('input', 'swr-cc-filter-range');
      input.type = 'range';
      input.setAttribute('data-cc-filter', d.key);
      input.min = isCssFilter(d.key) ? '0' : '-100';
      input.max = isCssFilter(d.key) ? '200' : '100';
      input.step = '1';
      input.value = '0';
      input.setAttribute('aria-label', d.label);
      row.appendChild(input);
      var val = el('span', 'swr-cc-filter-value', '0');
      val.setAttribute('data-cc-filter-value', d.key);
      row.appendChild(val);
      (isCssFilter(d.key) ? css : fx).appendChild(row);
    }
    return p;
  }

  function isCssFilter(key) {
    return ['brightness', 'contrast', 'saturate', 'blur', 'grayscale', 'sepia'].indexOf(key) !== -1;
  }

  // CSS filters are applied to the mirror canvas, not the engine — the
  // variant's own WebGL pipeline is driven through FX.set* instead.
  function applyCssFilters() {
    if (!mirrorCanvas) return;
    var f = state.filters;
    mirrorCanvas.style.filter =
      'brightness(' + f.brightness + ') contrast(' + f.contrast + ') saturate(' + f.saturate +
      ') blur(' + f.blur + 'px) grayscale(' + f.grayscale + ') sepia(' + f.sepia + ')';
  }

  function setFilter(key, value) {
    state.filters[key] = value;
    var val = $('[data-cc-filter-value="' + key + '"]');
    if (val) val.textContent = String(value);
    if (isCssFilter(key)) { applyCssFilters(); return; }
    // The FX stack: call the variant's own setter.
    var def = null;
    for (var i = 0; i < FILTER_DEFS.length; i++) if (FILTER_DEFS[i].key === key) def = FILTER_DEFS[i];
    if (!def || !api.fx) return;
    var setter = def.fx || ('set' + key.charAt(0).toUpperCase() + key.slice(1));
    if (typeof api.fx[setter] === 'function') {
      try { api.fx[setter](value / 100); } catch (_) {}
    }
  }

  // ── panel: mood ──────────────────────────────────────────────────────
  function buildMoodPanel() {
    var p = panel('Mood');
    var body = p._body;
    var hint = el('p', 'swr-cc-empty', 'Reference image → palette + slider suggestions.');
    body.appendChild(hint);
    var fileRow = el('div', 'swr-cc-mood-row');
    var file = el('input', 'swr-cc-mood-file');
    file.type = 'file';
    file.accept = 'image/*';
    file.setAttribute('data-cc-mood-file', '');
    file.setAttribute('aria-label', 'Mood reference image');
    fileRow.appendChild(file);
    body.appendChild(fileRow);
    var actions = el('div', 'swr-cc-rec-row');
    var applyBtn = el('button', 'swr-cc-btn', 'Apply suggestion');
    applyBtn.type = 'button';
    applyBtn.setAttribute('data-cc-mood-apply', '');
    actions.appendChild(applyBtn);
    body.appendChild(actions);
    var status = el('div', 'swr-cc-mood-status');
    status.setAttribute('data-cc-mood-status', '');
    status.textContent = 'Upload a reference image.';
    body.appendChild(status);
    file.addEventListener('change', function (e) {
      resolveApi();
      if (!api.mood || typeof api.mood.analyze !== 'function') return;
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          api.mood.analyze(img).then(function (result) {
            if (api.mood.setOverlayImage) api.mood.setOverlayImage(reader.result);
            if (api.mood.setOverlayVisible) api.mood.setOverlayVisible(true);
            renderMoodStatus(result);
            syncAudioParamsFromEngine();
          }).catch(function () {
            status.textContent = 'Analysis failed.';
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
    });
    applyBtn.addEventListener('click', function () {
      resolveApi();
      if (!api.mood || typeof api.mood.applySuggestion !== 'function') return;
      if (api.mood.applySuggestion()) {
        status.textContent = 'Suggestion applied to engine sliders.';
        syncAudioParamsFromEngine();
      }
    });
    return p;
  }

  function renderMoodStatus(result) {
    var status = $('[data-cc-mood-status]');
    if (!status) return;
    if (!result) {
      status.textContent = api.mood && api.mood.lastAnalysis ? 'Analysis ready — apply or upload again.' : 'Upload a reference image.';
      return;
    }
    var f = result.features || {};
    var s = result.suggestion || {};
    status.textContent = 'bright ' + num(f.meanBright, 0).toFixed(2)
      + ' · sat ' + num(f.meanSat, 0).toFixed(2)
      + ' · ' + (s.warmth || '—')
      + ' · sens ' + num(s.sens, 0).toFixed(2);
  }

  // ── panel: scenes ────────────────────────────────────────────────────
  function buildScenesPanel() {
    var p = panel('Scenes');
    var body = p._body;
    body.appendChild(el('p', 'swr-cc-empty', 'Click recall · hold 1s to save'));
    var host = el('div', 'swr-cc-scenes');
    host.setAttribute('data-cc-scenes', '');
    body.appendChild(host);
    renderScenesPads();
    window.addEventListener('swr-scenes-changed', renderScenesPads);
    return p;
  }

  function renderScenesPads() {
    var host = $('[data-cc-scenes]');
    if (!host) return;
    resolveApi();
    if (!api.scenes || typeof api.scenes.list !== 'function') {
      host.innerHTML = '<p class="swr-cc-empty">Scenes module not loaded on this surface.</p>';
      return;
    }
    var scenes = api.scenes.list();
    host.innerHTML = '';
    var grid = el('div', 'swr-cc-scenes-grid');
    for (var i = 0; i < scenes.length; i++) {
      (function (idx, scene) {
        var pad = el('button', 'swr-cc-scene-pad', scene.label || ('Scene ' + (idx + 1)));
        pad.type = 'button';
        pad.setAttribute('data-cc-scene', String(idx));
        if (scene.snapshot) pad.classList.add('has-snapshot');
        pad.title = scene.snapshot ? 'Recall saved scene' : 'Empty pad — hold to save';
        wireScenePad(pad, idx);
        grid.appendChild(pad);
      })(i, scenes[i] || {});
    }
    host.appendChild(grid);
  }

  // Variant pages use #sens / #gate; engine.html uses #sensitivity / #beat-gate.
  var AUDIO_PARAM_DOM_IDS = {
    sens: ['sens', 'sensitivity'],
    gate: ['gate', 'beat-gate'],
    decay: ['decay'],
  };

  function audioParamDomIds(key) {
    return AUDIO_PARAM_DOM_IDS[key] || [key];
  }

  function setAudioParamDomValue(id, value) {
    var dom = document.getElementById(id);
    if (!dom) return;
    dom.value = String(value);
    dom.dispatchEvent(new Event('input', { bubbles: true }));
    var readout = document.getElementById(id + '-v');
    if (readout) readout.textContent = value.toFixed(2);
  }

  function wireScenePad(pad, idx) {
    var activePointer = null;

    function beginHold() {
      if (api.scenes.startCapture) api.scenes.startCapture(idx);
      pad.classList.add('is-holding');
    }

    function endHold(recallOnShort) {
      pad.classList.remove('is-holding');
      if (!api.scenes.cancelCapture) return;
      if (recallOnShort && api.scenes.cancelCapture()) {
        if (api.scenes.recall && api.scenes.recall(idx)) syncAudioParamsFromEngine();
      } else {
        api.scenes.cancelCapture();
      }
    }

    pad.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      activePointer = e.pointerId;
      if (pad.setPointerCapture) pad.setPointerCapture(e.pointerId);
      beginHold();
    });
    pad.addEventListener('pointerup', function (e) {
      if (activePointer != null && e.pointerId !== activePointer) return;
      activePointer = null;
      endHold(true);
    });
    pad.addEventListener('pointercancel', function () {
      activePointer = null;
      endHold(false);
    });
    pad.addEventListener('pointerleave', function (e) {
      if (activePointer == null || e.pointerId !== activePointer) return;
      activePointer = null;
      endHold(false);
    });
    pad.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (api.scenes.recall && api.scenes.recall(idx)) syncAudioParamsFromEngine();
    });
  }

  function audioParamValue(key) {
    var A = api.audio;
    if (A && A.params && typeof A.params[key] === 'number') return A.params[key];
    var ids = audioParamDomIds(key);
    for (var d = 0; d < ids.length; d++) {
      var dom = document.getElementById(ids[d]);
      if (dom && dom.value !== '') return parseFloat(dom.value);
    }
    return null;
  }

  function syncAudioParamsFromEngine() {
    var keys = ['sens', 'gate', 'decay'];
    for (var i = 0; i < keys.length; i++) {
      var v = audioParamValue(keys[i]);
      if (v == null || !isFinite(v)) continue;
      var input = $('[data-cc-audio-param="' + keys[i] + '"]');
      if (input) input.value = String(v);
      var val = $('[data-cc-audio-param-value="' + keys[i] + '"]');
      if (val) val.textContent = v.toFixed(keys[i] === 'decay' ? 2 : 2);
    }
  }

  function setAudioParam(key, value) {
    if (!isFinite(value)) return;
    var A = api.audio;
    if (A && A.params) A.params[key] = value;
    var ids = audioParamDomIds(key);
    for (var d = 0; d < ids.length; d++) setAudioParamDomValue(ids[d], value);
    var val = $('[data-cc-audio-param-value="' + key + '"]');
    if (val) val.textContent = value.toFixed(2);
  }

  // ── panel: recording / export ────────────────────────────────────────
  function buildRecordPanel() {
    var p = panel('Recording / Export');
    var body = p._body;

    var row = el('div', 'swr-cc-rec-row');
    var webm = el('button', 'swr-cc-btn swr-cc-btn--primary', 'WebM');
    webm.type = 'button';
    webm.setAttribute('data-cc-rec', 'webm');
    var mp4 = el('button', 'swr-cc-btn', 'MP4');
    mp4.type = 'button';
    mp4.setAttribute('data-cc-rec', 'mp4');
    row.appendChild(webm);
    row.appendChild(mp4);
    body.appendChild(row);

    var toggles = el('div', 'swr-cc-toggles');
    var defs = [
      ['watermark', 'Watermark', 'window.SWR_WATERMARK'],
      ['credits', 'PT credits', null],
    ];
    for (var i = 0; i < defs.length; i++) {
      var b = el('button', 'swr-cc-chip', defs[i][1]);
      b.type = 'button';
      b.setAttribute('data-cc-toggle', defs[i][0]);
      b.setAttribute('aria-pressed', 'false');
      b.title = defs[i][1];
      toggles.appendChild(b);
    }
    body.appendChild(toggles);

    var hint = el('p', 'swr-cc-empty', 'Export runs from the engine surface.');
    body.appendChild(hint);
    return p;
  }

  // ── bottom: beat confidence ──────────────────────────────────────────
  function buildConfidencePanel() {
    var p = panel('Beat confidence', 'swr-cc-panel--bottom');
    var body = p._body;
    body.classList.add('swr-cc-conf-body');
    var cv = el('canvas', 'swr-cc-gauge');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Beat confidence');
    body.appendChild(cv);
    confidenceCtx = cv.getContext('2d');
    gaugeCanvas = cv;
    var list = el('ul', 'swr-cc-conf-list');
    list.setAttribute('data-cc-conf-list', '');
    body.appendChild(list);
    return p;
  }

  // ── bottom: hook detector ────────────────────────────────────────────
  function buildHookPanel() {
    var p = panel('Hook detector', 'swr-cc-panel--bottom');
    var body = p._body;
    var cv = el('canvas', 'swr-cc-spark swr-cc-spark--hook');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Hook detector energy over time');
    body.appendChild(cv);
    hookCtx = cv.getContext('2d');
    hookCanvas = cv;
    var val = el('div', 'swr-cc-hook-val');
    val.setAttribute('data-cc-hook', '');
    val.textContent = 'no hook detected';
    body.appendChild(val);
    return p;
  }

  // ── bottom: auto-drift ───────────────────────────────────────────────
  function buildAutoDriftPanel() {
    var p = panel('Auto-drift', 'swr-cc-panel--bottom');
    var body = p._body;
    var t = el('button', 'swr-cc-switch');
    t.type = 'button';
    t.setAttribute('data-cc-toggle', 'autodrift');
    t.setAttribute('aria-pressed', 'false');
    t.setAttribute('role', 'switch');
    t.setAttribute('aria-label', 'Auto-drift');
    t.appendChild(el('span', 'swr-cc-switch-track'));
    t.appendChild(el('span', 'swr-cc-switch-label', 'Status'));
    body.appendChild(t);

    var rows = el('div', 'swr-cc-drift-rows');
    var defs = [['cycle', 'Next look'], ['mutate', 'Mutate'], ['evolve', 'Evolve']];
    for (var i = 0; i < defs.length; i++) {
      var b = el('button', 'swr-cc-chip', defs[i][1]);
      b.type = 'button';
      b.setAttribute('data-cc-drift', defs[i][0]);
      b.title = defs[i][1];
      rows.appendChild(b);
    }
    body.appendChild(rows);
    return p;
  }

  // ── bottom: credits ──────────────────────────────────────────────────
  function buildCreditsPanel() {
    var p = panel('Credits', 'swr-cc-panel--bottom');
    var body = p._body;
    var v = el('div', 'swr-cc-credits');
    v.setAttribute('data-cc-credits', '');
    v.textContent = '—';
    body.appendChild(v);
    var note = el('p', 'swr-cc-empty', 'Sign in to see a balance.');
    body.appendChild(note);
    return p;
  }

  // ── bottom: lifecycle cost ───────────────────────────────────────────
  function buildCostPanel() {
    var p = panel('Lifecycle cost / render time', 'swr-cc-panel--bottom');
    var body = p._body;
    var cv = el('canvas', 'swr-cc-spark swr-cc-spark--cost');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'Render cost per run');
    body.appendChild(cv);
    costCtx = cv.getContext('2d');
    costCanvas = cv;
    var val = el('div', 'swr-cc-cost-val');
    val.setAttribute('data-cc-cost', '');
    val.textContent = '—';
    body.appendChild(val);
    return p;
  }

  // ── open / close ──────────────────────────────────────────────────────
  function toggle(open) {
    state.open = open;
    if (open) {
      if (!root) {
        root = buildShell();
        document.body.appendChild(root);
      }
      document.body.classList.add('swr-cc-open');
      root.hidden = false;
      resolveApi();
      renderPersonas(true);
      syncFiltersFromFx();
      syncAudioParamsFromEngine();
      fetchPresetCatalog();
      renderMoodStatus(api.mood && api.mood.lastAnalysis);
      renderScenesPads();
      var launcher = document.getElementById('swr-cc-launch');
      if (launcher) launcher.setAttribute('aria-pressed', 'true');
      if (!rafId) rafId = requestAnimationFrame(tick);
    } else {
      document.body.classList.remove('swr-cc-open');
      if (root) root.hidden = true;
      var l2 = document.getElementById('swr-cc-launch');
      if (l2) l2.setAttribute('aria-pressed', 'false');
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }
  }

  function syncFiltersFromFx() {
    if (!api.fx || !api.fx.state) return;
    var st = api.fx.state;
    for (var i = 0; i < FILTER_DEFS.length; i++) {
      var d = FILTER_DEFS[i];
      if (isCssFilter(d.key)) continue;
      if (typeof st[d.key] !== 'number') continue;
      state.filters[d.key] = Math.round(st[d.key] * 100);
      var input = $('[data-cc-filter="' + d.key + '"]');
      if (input) input.value = String(state.filters[d.key]);
      var val = $('[data-cc-filter-value="' + d.key + '"]');
      if (val) val.textContent = String(state.filters[d.key]);
    }
    var badge = $('[data-cc-fxstate]');
    if (badge) badge.textContent = st.enabled ? 'on' : 'off';
  }

  // ── per-frame drawing ────────────────────────────────────────────────
  function fitCanvas(cv, ctx) {
    if (!cv || !ctx) return null;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h };
  }

  // The variant's own output canvas, whatever it is called.
  function sourceCanvas() {
    var c = document.getElementById('render')
      || document.getElementById('fx-canvas')
      || document.querySelector('canvas[id="stage"], canvas#basic-canvas');
    return c || null;
  }

  function drawMirror() {
    if (!mirrorCanvas) return;
    var size = fitCanvas(mirrorCanvas, mirrorCanvas.getContext('2d'));
    if (!size) return;
    var g = mirrorCanvas.getContext('2d');
    g.clearRect(0, 0, size.w, size.h);
    var src = sourceCanvas();
    if (!src || !src.width || !src.height) {
      g.fillStyle = 'rgba(255,160,60,.5)';
      g.font = '12px ui-monospace, Menlo, monospace';
      g.fillText('no output canvas on this surface', 14, 22);
      return;
    }
    // Cover-fit the source into the panel.
    var sw = src.width, sh = src.height;
    var scale = Math.max(size.w / sw, size.h / sh);
    var dw = sw * scale, dh = sh * scale;
    try {
      g.drawImage(src, (size.w - dw) / 2, (size.h - dh) / 2, dw, dh);
    } catch (_) {}
  }

  function analyser() {
    var A = api.audio || {};
    return A.analyser || A.an || null;
  }

  function drawSpectrum() {
    if (!spectrumCanvas) return;
    var size = fitCanvas(spectrumCanvas, spectrumCtx);
    if (!size) return;
    var g = spectrumCtx;
    g.clearRect(0, 0, size.w, size.h);

    var an = analyser();
    var bins = null;
    if (an && an.frequencyBinCount) {
      var n = an.frequencyBinCount;
      if (!spectrumBuf || spectrumBuf.length !== n) spectrumBuf = new Uint8Array(n);
      try { an.getByteFrequencyData(spectrumBuf); bins = spectrumBuf; } catch (_) { bins = null; }
    }
    if (!bins) {
      // No analyser on this surface — fall back to the engine's own feature
      // envelopes, which every variant publishes, so the panel is never dead.
      var f = api.audio && api.audio.feat;
      if (f) {
        var fk = ['bass', 'mid', 'treble', 'air'];
        var n2 = 48;
        bins = [];
        for (var i = 0; i < n2; i++) {
          var t = i / (n2 - 1);
          var v = 0;
          for (var j = 0; j < fk.length; j++) {
            var centre = j / (fk.length - 1);
            var w = Math.exp(-Math.pow((t - centre) * 3.2, 2));
            v += (num(f[fk[j]], 0)) * w;
          }
          bins.push(clamp(v, 0, 1) * 255);
        }
      }
    }
    if (!bins) {
      g.fillStyle = 'rgba(255,170,80,.45)';
      g.font = '11px ui-monospace, Menlo, monospace';
      g.fillText('no spectrum source', 12, 20);
      return;
    }

    // Log-spaced curve, fire gradient.
    var W = size.w, H = size.h;
    var grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, '#ff4d2e');
    grad.addColorStop(0.5, '#ff8a3d');
    grad.addColorStop(1, '#ffd66b');
    g.strokeStyle = grad;
    g.lineWidth = 1.6;
    g.beginPath();
    var count = Math.min(bins.length, 96);
    for (var k = 0; k < count; k++) {
      // Log spacing so the low end is not crushed.
      var t = k / (count - 1);
      var idx = Math.floor(Math.pow(t, 1.7) * (bins.length - 1));
      var amp = (bins[idx] || 0) / 255;
      var x = t * W;
      var y = H - amp * H * 0.94 - H * 0.03;
      if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }

  var spectrumBuf = null;

  // Band energies for the "peak demand" columns.
  function bandEnergies() {
    var an = analyser();
    var out = { a1: 0, low: 0, high: 0, air: 0 };
    if (!an || !an.frequencyBinCount) {
      // Fall back to the published envelopes.
      out.a1 = clamp(feat('sub') * 0.6 + feat('bass') * 0.4, 0, 1);
      out.low = clamp(feat('bass') * 0.5 + feat('mid') * 0.5, 0, 1);
      out.high = clamp(feat('mid') * 0.5 + feat('treble') * 0.5, 0, 1);
      out.air = clamp(feat('air'), 0, 1);
      return out;
    }
    var n = an.frequencyBinCount;
    if (!spectrumBuf || spectrumBuf.length !== n) spectrumBuf = new Uint8Array(n);
    try { an.getByteFrequencyData(spectrumBuf); } catch (_) { return out; }
    function avg(lo, hi) {
      var a = Math.floor(lo * n), b = Math.floor(hi * n);
      if (b <= a) return 0;
      var s = 0;
      for (var i = a; i < b; i++) s += spectrumBuf[i];
      return clamp((s / (b - a)) / 255, 0, 1);
    }
    out.a1 = avg(0, 0.04);
    out.low = avg(0.04, 0.18);
    out.high = avg(0.18, 0.48);
    out.air = avg(0.48, 1);
    return out;
  }

  function drawDemand() {
    var bands = bandEnergies();
    var keys = ['a1', 'low', 'high', 'air'];
    for (var i = 0; i < keys.length; i++) {
      var segs = $$('[data-cc-band="' + keys[i] + '"]');
      var lit = Math.round(bands[keys[i]] * segs.length);
      for (var j = 0; j < segs.length; j++) {
        segs[j].classList.toggle('is-lit', j < lit);
      }
    }
  }

  function drawLayersSpark() {
    var size = layersCtx ? fitCanvas(layersCanvas, layersCtx) : null;
    if (!size || !layersCtx) return;
    var g = layersCtx;
    g.clearRect(0, 0, size.w, size.h);
    var hist = state.layerHistory;
    if (hist.length < 2) return;
    g.strokeStyle = '#ff8a3d';
    g.lineWidth = 1.6;
    g.beginPath();
    for (var i = 0; i < hist.length; i++) {
      var x = (i / (hist.length - 1)) * size.w;
      var y = size.h - clamp(hist[i].n / 6, 0, 1) * size.h * 0.92 - 2;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.strokeStyle = 'rgba(255,61,146,.8)';
    g.beginPath();
    for (var j = 0; j < hist.length; j++) {
      var x2 = (j / (hist.length - 1)) * size.w;
      var y2 = size.h - clamp(hist[j].e, 0, 1) * size.h * 0.92 - 2;
      if (j === 0) g.moveTo(x2, y2); else g.lineTo(x2, y2);
    }
    g.stroke();
  }

  function drawHook() {
    var cv = hookCanvas;
    if (!cv || !hookCtx) return;
    var size = fitCanvas(cv, hookCtx);
    if (!size) return;
    var g = hookCtx;
    g.clearRect(0, 0, size.w, size.h);
    var hist = state.hookHistory || [];
    if (hist.length < 2) return;
    g.strokeStyle = '#ff3d92';
    g.lineWidth = 1.6;
    g.beginPath();
    for (var i = 0; i < hist.length; i++) {
      var x = (i / (hist.length - 1)) * size.w;
      var y = size.h - clamp(hist[i], 0, 1) * size.h * 0.92 - 2;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  state.hookHistory = [];

  function drawConfidence() {
    var cv = gaugeCanvas;
    if (!cv || !confidenceCtx) return;
    var size = fitCanvas(cv, confidenceCtx);
    if (!size) return;
    var g = confidenceCtx;
    g.clearRect(0, 0, size.w, size.h);
    var conf = clamp(feat('beat') * 0.6 + feat('onset') * 0.4, 0, 1);
    var cx = size.w / 2, cy = size.h * 0.82, r = Math.min(size.w, size.h) * 0.62;
    // Track
    g.lineWidth = Math.max(5, r * 0.16);
    g.strokeStyle = 'rgba(255,255,255,.08)';
    g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.86, Math.PI * 2.14); g.stroke();
    // Value
    var grad = g.createLinearGradient(cx - r, 0, cx + r, 0);
    grad.addColorStop(0, '#ff4d2e');
    grad.addColorStop(1, '#ffd66b');
    g.strokeStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, Math.PI * 0.86, Math.PI * 0.86 + Math.PI * 1.28 * conf);
    g.stroke();
    g.fillStyle = '#ffe6c2';
    g.font = '600 ' + Math.round(r * 0.52) + 'px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    g.fillText((conf * 10).toFixed(1), cx, cy - r * 0.08);
    g.textAlign = 'left';
  }

  function drawCost() {
    var cv = costCanvas;
    if (!cv || !costCtx) return;
    var size = fitCanvas(cv, costCtx);
    if (!size) return;
    var g = costCtx;
    g.clearRect(0, 0, size.w, size.h);
    var hist = state.renderHistory;
    if (!hist.length) return;
    var max = 1;
    for (var i = 0; i < hist.length; i++) if (hist[i] > max) max = hist[i];
    var bw = size.w / hist.length;
    for (var j = 0; j < hist.length; j++) {
      var h = (hist[j] / max) * size.h * 0.92;
      var grad = g.createLinearGradient(0, size.h, 0, size.h - h);
      grad.addColorStop(0, 'rgba(255,77,46,.45)');
      grad.addColorStop(1, '#ffb347');
      g.fillStyle = grad;
      g.fillRect(j * bw + 0.5, size.h - h, Math.max(1, bw - 1), h);
    }
  }

  // ── the frame loop ───────────────────────────────────────────────────
  function tick(ts) {
    if (destroyed) return;
    rafId = requestAnimationFrame(tick);
    if (!state.open) return;
    if (document.hidden) return;
    if (ts - lastFrame < 66) return;    // ~15fps
    lastFrame = ts;

    resolveApi();

    drawMirror();
    drawSpectrum();
    drawDemand();
    drawConfidence();
    drawHook();
    drawCost();
    drawLayersSpark();
    renderLibrary();
    renderPersonas();

    // Lifecycle samples.
    var layerCount = (api.layers && api.layers.list) ? api.layers.list.length : 0;
    state.layerHistory.push({ n: layerCount, e: clamp(feat('rms'), 0, 1) });
    if (state.layerHistory.length > 90) state.layerHistory.shift();

    state.hookHistory.push(clamp(feat('onset'), 0, 1));
    if (state.hookHistory.length > 90) state.hookHistory.shift();

    // HUD readouts.
    var hudStats = $('[data-cc-hud="stats"]');
    if (hudStats) {
      var s = null;
      try { s = api.stats && api.stats.summary ? api.stats.summary() : null; } catch (_) {}
      hudStats.textContent = s
        ? (s.totalRenders + ' renders · ' + (s.totalMinutes || 0).toFixed(1) + ' min · ' + (s.totalSizeMB || 0).toFixed(1) + ' MB')
        : '—';
      var cost = $('[data-cc-cost]');
      if (cost) {
        cost.textContent = s ? (s.totalRenders + ' runs · ' + (s.totalSizeMB || 0).toFixed(1) + ' MB') : '—';
        if (s && typeof s.totalRenders === 'number') {
          state.renderHistory.push(s.last30Count || 0);
          if (state.renderHistory.length > 24) state.renderHistory.shift();
        }
      }
    }
    var hudLayers = $('[data-cc-hud="layers"]');
    if (hudLayers) hudLayers.textContent = layerCount + ' layers';

    // Knobs.
    var keyVal = feat('key');
    setKnob('key', 0.5, keyVal === undefined || keyVal === null ? '—' : String(keyVal));
    setKnob('chroma', clamp(feat('centroid'), 0, 1), Math.round(clamp(feat('centroid'), 0, 1) * 100) + '%');
    setKnob('phase', clamp(feat('beatPhase'), 0, 1), Math.round(clamp(feat('beatPhase'), 0, 1) * 100) + '%');

    // Hook readout.
    var hookOut = $('[data-cc-hook]');
    if (hookOut) {
      var last = api.hook && api.hook.lastResult;
      hookOut.textContent = last
        ? (last.confidence != null ? Math.round(last.confidence * 100) + '% · ' : '') + (last.label || last.reason || 'detected')
        : 'no hook detected';
    }

    // Credits.
    var cred = $('[data-cc-credits]');
    if (cred && state.credits !== null) cred.textContent = String(state.credits);
  }

  function setKnob(name, v, text) {
    var face = $('[data-cc-knob="' + name + '"]');
    if (face) {
      face.style.setProperty('--swr-cc-knob', String(clamp(v, 0, 1)));
      face.setAttribute('aria-valuenow', String(Math.round(clamp(v, 0, 1) * 100)));
      if (text !== undefined) face.setAttribute('aria-valuetext', text);
    }
    var val = $('[data-cc-knob-value="' + name + '"]');
    if (val && text !== undefined) val.textContent = text;
  }

  // ── interaction ──────────────────────────────────────────────────────
  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var navBtn = t.closest('.swr-cc-nav [data-cc-section]');
    if (navBtn) {
      state.section = navBtn.getAttribute('data-cc-section');
      $$('.swr-cc-nav [data-cc-section]').forEach(function (n) {
        n.setAttribute('aria-pressed', n.getAttribute('data-cc-section') === state.section ? 'true' : 'false');
      });
      applySection();
      return;
    }

    var familyChip = t.closest('[data-cc-persona-family]');
    if (familyChip) {
      state.personaFamily = familyChip.getAttribute('data-cc-persona-family') || 'all';
      $$('[data-cc-persona-family]').forEach(function (n) {
        n.setAttribute('aria-pressed', n.getAttribute('data-cc-persona-family') === state.personaFamily ? 'true' : 'false');
      });
      renderPersonas(true);
      return;
    }

    var filter = t.closest('[data-cc-filter]');
    if (filter) {
      setFilter(filter.getAttribute('data-cc-filter'), parseFloat(filter.value));
      return;
    }

    var drift = t.closest('[data-cc-drift]');
    if (drift) { runDrift(drift.getAttribute('data-cc-drift')); return; }

    var recBtn = t.closest('[data-cc-rec]');
    if (recBtn) { runExport(recBtn.getAttribute('data-cc-rec')); return; }

    var toggleBtn = t.closest('[data-cc-toggle]');
    if (toggleBtn) {
      var id = toggleBtn.getAttribute('data-cc-toggle');
      if (id === 'autodrift') {
        state.autoDrift = !state.autoDrift;
        toggleBtn.setAttribute('aria-pressed', state.autoDrift ? 'true' : 'false');
        return;
      }
      if (id === 'watermark') {
        var wm = window.SWR_WATERMARK;
        var on = !(wm && wm.enabled);
        if (wm && typeof wm.setEnabled === 'function') { try { wm.setEnabled(on); } catch (_) {} }
        toggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        return;
      }
      if (id === 'credits') {
        toggleBtn.setAttribute('aria-pressed', toggleBtn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        return;
      }
    }
  }

  function onInput(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var key = t.getAttribute('data-cc-filter');
    if (key) setFilter(key, parseFloat(t.value));
    var ap = t.getAttribute('data-cc-audio-param');
    if (ap) setAudioParam(ap, parseFloat(t.value));
  }

  function runDrift(kind) {
    if (kind === 'cycle') {
      if (typeof window.applyPreset === 'function' && window.VISUAL_PRESETS) {
        var keys = Object.keys(window.VISUAL_PRESETS);
        var cur = keys.indexOf(window._activePreset && window._activePreset.id);
        var next = keys[(cur + 1 + keys.length) % keys.length];
        window.applyPreset(next);
      }
      return;
    }
    if (kind === 'mutate') {
      var L = api.layers;
      if (L && typeof L.render === 'function') { try { L.render(); } catch (_) {} }
      if (api.fx && typeof api.fx.setMut === 'function') {
        try { api.fx.setMut(Math.min(1, (api.fx.state.mut || 0) + 0.15)); } catch (_) {}
      }
      return;
    }
    if (kind === 'evolve') {
      var L2 = api.layers;
      if (L2 && typeof L2.autoMap === 'function') { try { L2.autoMap(); } catch (_) {} }
    }
  }

  function runExport(kind) {
    // The export path lives on the engine surface; the Command Center
    // triggers it rather than re-implementing the recorder.
    var rec = api.recorder;
    if (rec && typeof rec.start === 'function') {
      try {
        if (kind === 'mp4' && window.SWR_RECORDER && window.SWR_RECORDER.canUseWebCodecs
            && window.SWR_RECORDER.canUseWebCodecs()) {
          window.SWR_RECORDER.start({ canvas: sourceCanvas(), fps: 24 });
          if (window.setStatus) window.setStatus('recording · MP4', 'live');
          return;
        }
        rec.start();
        if (window.setStatus) window.setStatus('recording · WebM', 'live');
        return;
      } catch (_) {}
    }
    // Fall back to the engine's own export button if it has one.
    var btn = document.getElementById('export-video') || document.getElementById('rec');
    if (btn) { btn.click(); return; }
    if (window.setStatus) window.setStatus('export is not available on this surface', 'warn');
  }

  function applySection() {
    // The section nav re-frames which panels are prominent. Everything stays
    // live; the emphasis changes.
    var root2 = document.getElementById('swr-cc');
    if (!root2) return;
    root2.setAttribute('data-cc-active-section', state.section);
    $$('.swr-cc-nav [data-cc-section]').forEach(function (n) {
      n.classList.toggle('is-active', n.getAttribute('data-cc-section') === state.section);
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && state.open) { toggle(false); }
  }

  // ── boot ─────────────────────────────────────────────────────────────
  function boot() {
    if (destroyed) return;
    // Loaded but not asked for: stay out of the way. The launcher asks for
    // it, and only the launcher.
    if (!REQUESTED && !WANTS_OPEN) return;
    resolveApi();
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);
    if (REQUESTED || WANTS_OPEN) {
      // The stylesheet comes first so the shell never paints unstyled.
      loadStylesheet().then(function () { toggle(true); });
    }
  }

  function destroy() {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (root && root.parentNode) root.parentNode.removeChild(root);
    var l = document.getElementById('swr-cc-launch');
    if (l && l.parentNode) l.parentNode.removeChild(l);
    document.body.classList.remove('swr-cc-open');
    root = null;
  }

  window.SWR_COMMAND_CENTER = {
    version: '1.0.0',
    state: state,
    open: function () { toggle(true); },
    close: function () { toggle(false); },
    toggle: toggle,
    api: api,
    isOpen: function () { return state.open; },
    personaList: personaList,
    destroy: destroy,
  };

  window.addEventListener('swr-presets-loaded', function () {
    if (state.open) renderPersonas(true);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
