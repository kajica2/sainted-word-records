// client/automix-style.client.js — named styles for the automixer
//
// Each style is a preset of HOW the visuals evolve: which named anchors
// the blend may draw from, how quickly it re-blends, how much it drifts
// per beat, and how fast clips cut. Picking a style is how one engine
// renders six visibly different videos instead of six variations on the
// same one.
//
// Why a new module and not config in variants/<name>.automix.json: those
// files describe ONE variant's fixed personality and are baked at build
// time. A style is a per-session user choice applied across every variant,
// and must be switchable at runtime without a reload.
//
// What a style may and may not change:
//   - anchor pool      → SWR_AUTOMIX.setAnchorPool()        (runtime settable)
//   - tick cadence     → SWR_AUTOMIX._setTuning()           (runtime settable)
//   - beat drift       → SWR_AUTOMIX._setDriftAmplitude()   (runtime settable)
//   - cutting profiles → SWR_AUTOMIX_COMPOSITION.PROFILES   (public object)
//   - act arc shape    → NOT settable. MIN_ACTS / MAX_ACTS / the per-act
//     {mut, grain, glow} numbers are IIFE-private consts in
//     client/automix-arc.client.js. A style deliberately cannot rewrite the
//     dramatic structure — it only steers where the arc is allowed to go.
//
// Public API (window.SWR_AUTOMIX_STYLE):
//   list()          -> [{ id, label, hint, anchorIds }] in dropdown order
//   ids()           -> ['auto', 'cinematic', …] — `auto` is always first
//   get()           -> active style id
//   set(id, opts)   -> apply a style; opts.persist !== false stores it
//   apply(id)       -> re-apply without touching storage
//   current()       -> the full style object (or the default)
//   mount(select)   -> wire a <select> to the registry
//   KEY             -> localStorage key

(function () {
  'use strict';
  if (window.SWR_AUTOMIX_STYLE) return;

  var KEY = 'swr.automix.style.v1';

  // Anchor ids must exist in client/preset-anchor-map.client.js's table.
  // A typo here silently yields an empty pool, which nearestAnchors()
  // widens back to the full map — so validate against the live map at
  // apply() time rather than trusting this table.
  var STYLES = [
    {
      id: 'auto',
      label: 'Auto (full palette)',
      hint: 'All 19 anchors — the original behaviour.',
      anchorIds: null,
    },
    {
      id: 'cinematic',
      label: 'Cinematic',
      hint: 'Grain, sepia, slow holds. film · chrome · kraft · baroque · watercolor',
      anchorIds: ['film', 'chrome', 'kraft', 'baroque', 'watercolor'],
      // Long, rare re-blends: the picture settles rather than pulses.
      tuning: { barsPerTick: 16 },
      driftAmplitude: { base: 0.006, beatScale: 0.010 },
      cutting: { intro: [10, 16], lift: [8, 13], peak: [4, 8], breakdown: [16, 24], outro: [10, 16] },
    },
    {
      id: 'glitch',
      label: 'Glitch',
      hint: 'Hard cuts, posterize, scanlines. glitch · grid · phosphor · void',
      anchorIds: ['glitch', 'grid', 'phosphor', 'void'],
      // Fast re-blends on every few bars.
      tuning: { barsPerTick: 4 },
      driftAmplitude: { base: 0.020, beatScale: 0.045 },
      cutting: { intro: [5, 8], lift: [3, 5], peak: [1.5, 3], breakdown: [7, 11], outro: [4, 7] },
    },
    {
      id: 'dreamy',
      label: 'Dreamy',
      hint: 'Soft glow, low mutation, wide drift. aurora · eclipse · watercolor · pulse · smoke',
      anchorIds: ['aurora', 'eclipse', 'watercolor', 'pulse', 'smoke'],
      tuning: { barsPerTick: 12 },
      driftAmplitude: { base: 0.014, beatScale: 0.022 },
      cutting: { intro: [12, 18], lift: [9, 14], peak: [6, 10], breakdown: [18, 28], outro: [12, 18] },
    },
    {
      id: 'raw',
      label: 'Raw / Acid',
      hint: 'Maximum mutation and chroma. neon · hallucination · fractal · glitch · grid',
      anchorIds: ['neon', 'hallucination', 'fractal', 'glitch', 'grid'],
      tuning: { barsPerTick: 4 },
      driftAmplitude: { base: 0.028, beatScale: 0.060 },
      cutting: { intro: [6, 10], lift: [4, 7], peak: [2, 4], breakdown: [9, 14], outro: [6, 10] },
    },
    {
      id: 'warm',
      label: 'Warm / Analog',
      hint: 'Sepia, tape, soft contrast. film · kraft · baroque · watercolor · smoke',
      anchorIds: ['film', 'kraft', 'baroque', 'watercolor', 'smoke'],
      tuning: { barsPerTick: 10 },
      driftAmplitude: { base: 0.010, beatScale: 0.018 },
      cutting: { intro: [9, 14], lift: [7, 11], peak: [3, 6], breakdown: [14, 20], outro: [9, 14] },
    },
  ];

  var DEFAULT_ID = 'auto';

  function byId(id) {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i];
    return null;
  }

  function _read() {
    try {
      var v = localStorage.getItem(KEY);
      return v && byId(v) ? v : DEFAULT_ID;
    } catch (_) { return DEFAULT_ID; }
  }

  function _write(id) {
    try { localStorage.setItem(KEY, id); } catch (_) { /* private mode */ }
  }

  // Keep only anchors the live map actually knows about. A pool referencing
  // an unknown id would narrow to nothing and nearestAnchors() would widen
  // back to everything — the style would silently do nothing.
  function _resolvePool(ids) {
    if (!ids || !ids.length) return null;
    var map = window.SWR_ANCHOR_MAP;
    if (!map || typeof map.get !== 'function') return ids.slice();
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      if (map.get(ids[i])) out.push(ids[i]);
    }
    return out.length ? out : null;
  }

  function apply(id) {
    var style = byId(id) || byId(DEFAULT_ID);
    var A = window.SWR_AUTOMIX;

    if (!A) return null;   // automix not loaded on this page — inert

    // 1. anchor pool
    if (typeof A.setAnchorPool === 'function') {
      A.setAnchorPool(style.anchorIds ? _resolvePool(style.anchorIds) : null);
    }

    // 2. cadence + drift. Only override when the style states one; the
    //    variant's own variants/<name>.automix.json tuning stays in force
    //    otherwise (styles win, but only where they speak).
    if (style.tuning && typeof A._setTuning === 'function') {
      A._setTuning(undefined, undefined, style.tuning.barsPerTick);
    }
    if (style.driftAmplitude && typeof A._setDriftAmplitude === 'function') {
      A._setDriftAmplitude(style.driftAmplitude.base, style.driftAmplitude.beatScale);
    }

    // 3. cutting profiles. Merged per act so a style that names only some
    //    acts leaves the rest on the composition module's defaults.
    if (style.cutting && window.SWR_AUTOMIX_COMPOSITION &&
        window.SWR_AUTOMIX_COMPOSITION.PROFILES) {
      var P = window.SWR_AUTOMIX_COMPOSITION.PROFILES;
      for (var act in style.cutting) {
        if (!Object.prototype.hasOwnProperty.call(style.cutting, act)) continue;
        var pair = style.cutting[act];
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        if (!P[act]) P[act] = {};
        P[act].minSeconds = pair[0];
        P[act].maxSeconds = pair[1];
      }
    }

    // 4. Rebuild the arc when one is live so the new pool shapes it from
    //    this song's next analysis. Clearing the guard makes _ensureArc()
    //    rebuild on the next 1s glide tick.
    var rt = window.automix;
    if (rt && rt.arc) {
      rt.arc = null;
      rt._arcBuiltFor = null;
    }

    return style;
  }

  function set(id, opts) {
    var style = byId(id);
    if (!style) return null;   // unknown id → no change, no write
    var applied = apply(style.id);
    if (opts && opts.persist === false) return applied;
    _write(style.id);
    _syncSelect();
    return applied;
  }

  // ---- <select> wiring ---------------------------------------------------

  var _select = null;

  function _syncSelect() {
    if (!_select) return;
    var cur = get();
    if (_select.value !== cur) _select.value = cur;
  }

  function mount(select) {
    if (!select) return false;
    _select = select;
    // Populate once; a re-mount on an already-populated select is a no-op.
    if (!select.options || select.options.length !== STYLES.length) {
      select.innerHTML = '';
      for (var i = 0; i < STYLES.length; i++) {
        var o = document.createElement('option');
        o.value = STYLES[i].id;
        o.textContent = STYLES[i].label;
        if (STYLES[i].hint) o.title = STYLES[i].hint;
        select.appendChild(o);
      }
    }
    _select = select;
    select.value = get();
    select.addEventListener('change', function () { set(select.value); });
    return true;
  }

  function get() { return _read(); }
  function current() { return byId(_read()) || byId(DEFAULT_ID); }

  window.SWR_AUTOMIX_STYLE = {
    list: function () { return STYLES.slice(); },
    ids: function () { return STYLES.map(function (s) { return s.id; }); },
    get: get,
    current: current,
    set: set,
    apply: apply,
    mount: mount,
    _syncSelect: _syncSelect,
    KEY: KEY,
    DEFAULT_ID: DEFAULT_ID,
  };
})();