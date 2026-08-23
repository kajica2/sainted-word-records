// engine-genops.client.js — the generative control system for the engine pages.
//
// One coherent set of four operations, shared by every versions/*.html engine:
//
//   REMAP      rewire audio features to parameters. Keeps the look, changes the reactions.
//   RANDOMIZE  fresh unrelated variation within the current scope.
//   MUTATE     small perturbation of the current patch. Amount controls the size.
//   EVOLVE     successive guided variants; keep / breed / discard, then commit.
//
// Everything is driven through the page's own `window.SWR = { Audio, Library, Layers }`
// handle, so this module needs zero per-page logic. Pages opt in by loading it
// (see versions/_genops-inject.js).
//
// NOT to be confused with presets-evolve.client.js / SWR_PRESETS_EVOLVE, which
// evolves *personas* from usage history. This module evolves the *current patch*.
//
// Public API on window.SWR_GENOPS:
//   .remap() .randomize() .mutate() .evolve(opts) .pauseEvolve() .commit()
//   .undo() .redo() .keep(id) .breed(idA, idB) .discard(id)
//   .setSeed(n) .reroll() .setScope(s) .setAmount(n) .setPreserve(k, v) .setDeterministic(b)
//   .toggleLock(layerId, field) .rand() .rngFrom(seed) .getState() .shareUrl()
//   ._snapshot() ._restore(patch)   (testing hooks)
//
// Events (all on window):
//   swr-genops-seed        { seed }
//   swr-genops-history     { index, length }
//   swr-genops-op          { op, label }
//   swr-genops-evolve      { running }
//   swr-genops-generation  { n, total }

(function () {
  'use strict';
  if (window.SWR_GENOPS) return;

  // ---- constants -----------------------------------------------------------

  const BLENDS   = ['source-over', 'screen', 'multiply', 'overlay', 'soft-light', 'difference'];
  const FEATURES = ['bass', 'mid', 'treble', 'air', 'sub', 'rms', 'centroid', 'beat', 'onset'];
  const TARGETS  = ['scale', 'x', 'y', 'rot', 'opacity', 'hue', 'brightness', 'contrast'];
  const EASES    = ['linear', 'soft', 'sharp', 'smooth'];

  // Sane reactor amount ranges per target, matching applyR()'s multipliers in the pages.
  const TARGET_RANGE = {
    scale:      [0.10, 1.00],
    x:          [5, 40],
    y:          [5, 40],
    rot:        [1, 8],
    opacity:    [0.05, 0.40],
    hue:        [10, 60],
    brightness: [0.10, 0.60],
    contrast:   [0.10, 0.60],
  };

  // Visual parameter ranges, used by both randomize (absolute) and mutate (jitter).
  const VISUAL_RANGE = {
    opacity:    [0.40, 1.00],
    baseScale:  [0.50, 2.10],
    hue:        [-180, 180],
    brightness: [0.70, 1.60],
    contrast:   [0.80, 1.60],
  };

  const LOCKABLE = ['asset', 'blend', 'opacity', 'scale', 'hue', 'mappings'];

  // Which lock guards which model field.
  const LOCK_OF = {
    asset: 'asset', blend: 'blend', opacity: 'opacity',
    baseScale: 'scale', hue: 'hue',
    brightness: 'scale', contrast: 'scale',
    reactors: 'mappings',
  };

  const MAX_HISTORY    = 32;
  const MAX_VARIATIONS = 8;
  const BEATS_PER_GEN  = 8;   // ≈2 bars in 4/4

  const LS_SEED = 'swr.genops.seed';

  // ---- state ---------------------------------------------------------------

  const state = {
    seed: 0,
    rng: null,
    deterministic: false,
    scope: 'all',            // selected | all | mappings | visuals
    amount: 0.4,             // 0..1
    preserve: { assets: true, mappings: false, blend: false },
    history: [],
    hIndex: -1,
    variations: [],          // [{ id, patch, label }] newest first
    lastOp: null,
    evolving: false,
    generation: 0,
  };

  // ---- seeded RNG (mulberry32) --------------------------------------------

  function rngFrom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function setSeed(n) {
    state.seed = n >>> 0;
    state.rng = rngFrom(state.seed);
    try { localStorage.setItem(LS_SEED, String(state.seed)); } catch (_) {}
    emit('swr-genops-seed', { seed: state.seed });
    return state.seed;
  }

  function reroll() { return setSeed((Math.random() * 0xFFFFFFFF) >>> 0); }

  // The single randomness source for this module AND for the pages (see Task 3b:
  // the engines' remap()/__shuffle_once() call through here). In deterministic
  // mode this is the seeded stream, so the same seed reproduces asset selection
  // as well as parameters.
  function rand() {
    if (state.deterministic) {
      if (!state.rng) state.rng = rngFrom(state.seed);
      return state.rng();
    }
    return Math.random();
  }

  function setDeterministic(on) {
    state.deterministic = !!on;
    if (state.deterministic) state.rng = rngFrom(state.seed);  // restart the stream
    return state.deterministic;
  }

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (_) {}
  }

  // ---- page handles --------------------------------------------------------

  function layersObj() { return (window.SWR && window.SWR.Layers) || null; }
  function libraryObj() { return (window.SWR && window.SWR.Library) || null; }
  function audioFeat() {
    return (window.SWR && window.SWR.Audio && window.SWR.Audio.feat) || {};
  }
  function libItem(id) {
    const lib = libraryObj();
    if (!lib || !lib.items) return null;
    for (const it of lib.items) if (it.id === id) return it;
    return null;
  }

  // ---- patch snapshot / restore -------------------------------------------

  function snapshot() {
    const L = layersObj();
    if (!L) return null;
    return {
      seed: state.seed,
      at: Date.now(),
      label: null,
      layers: L.list.map(function (l) {
        return {
          id: l.id,
          assetId: l.asset ? l.asset.id : null,
          blend: l.blend,
          opacity: l.opacity,
          baseScale: l.baseScale,
          hue: l.hue,
          brightness: l.brightness,
          contrast: l.contrast,
          locks: l.locks ? Object.assign({}, l.locks) : {},
          reactors: l.reactors.map(function (r) { return Object.assign({}, r); }),
        };
      }),
    };
  }

  function restore(patch) {
    const L = layersObj();
    if (!L || !patch || !patch.layers) return false;
    L.list = patch.layers.map(function (p) {
      return {
        id: p.id,
        asset: libItem(p.assetId),
        blend: p.blend,
        opacity: p.opacity,
        baseScale: p.baseScale,
        hue: p.hue,
        brightness: p.brightness,
        contrast: p.contrast,
        locks: Object.assign({}, p.locks),
        reactors: p.reactors.map(function (r) { return Object.assign({}, r); }),
      };
    });
    // Keep the selection pointing at a live object.
    L.sel = L.list.length ? L.list[0] : null;
    if (typeof L.render === 'function') L.render();
    return true;
  }

  // ---- history + variation ring -------------------------------------------

  function pushHistory(label) {
    const p = snapshot();
    if (!p) return;
    p.label = label || 'edit';
    state.history = state.history.slice(0, state.hIndex + 1);
    state.history.push(p);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.hIndex = state.history.length - 1;
    if (label && label !== 'initial') {
      state.variations.unshift({ id: 'v' + p.at, patch: p, label: p.label });
      state.variations = state.variations.slice(0, MAX_VARIATIONS);
    }
    emit('swr-genops-history', { index: state.hIndex, length: state.history.length });
  }

  // Ensures undo returns to the pre-op state: baseline is pushed before the first op.
  function withHistory(label, fn) {
    if (state.hIndex < 0) pushHistory('initial');
    fn();
    state.lastOp = label;
    pushHistory(label);
    emit('swr-genops-op', { op: label, label: label });
  }

  function undo() {
    if (state.hIndex <= 0) return false;
    state.hIndex -= 1;
    restore(state.history[state.hIndex]);
    emit('swr-genops-history', { index: state.hIndex, length: state.history.length });
    return true;
  }

  function redo() {
    if (state.hIndex >= state.history.length - 1) return false;
    state.hIndex += 1;
    restore(state.history[state.hIndex]);
    emit('swr-genops-history', { index: state.hIndex, length: state.history.length });
    return true;
  }

  // ---- scope + lock gates -------------------------------------------------

  function inScope(l) {
    const L = layersObj();
    if (state.scope === 'selected') return !!(L && L.sel === l);
    return true;   // all | mappings | visuals span every layer
  }

  // `field` is a model field name (blend, opacity, baseScale, hue, brightness,
  // contrast, reactors, asset).
  function canTouch(l, field) {
    const lock = LOCK_OF[field];
    if (lock && l.locks && l.locks[lock]) return false;
    if (field === 'asset'    && state.preserve.assets)   return false;
    if (field === 'blend'    && state.preserve.blend)    return false;
    if (field === 'reactors' && state.preserve.mappings) return false;
    if (state.scope === 'mappings' && field !== 'reactors') return false;
    if (state.scope === 'visuals'  && field === 'reactors') return false;
    return true;
  }

  function toggleLock(layerId, field) {
    const L = layersObj();
    if (!L || LOCKABLE.indexOf(field) === -1) return false;
    for (const l of L.list) {
      if (l.id !== layerId) continue;
      if (!l.locks) l.locks = {};
      l.locks[field] = !l.locks[field];
      if (typeof L.render === 'function') L.render();
      return l.locks[field];
    }
    return false;
  }

  // ---- value helpers ------------------------------------------------------

  function pick(arr) { return arr[(rand() * arr.length) | 0]; }

  function pickIn(range, spread) {
    const lo = range[0], hi = range[1];
    const mid = (lo + hi) / 2;
    const half = (hi - lo) / 2 * (spread == null ? 1 : spread);
    return +(mid - half + rand() * half * 2).toFixed(3);
  }

  function jitter(v, range) {
    const span = (range[1] - range[0]) * state.amount * 0.5;
    const nv = v + (rand() * 2 - 1) * span;
    return +Math.max(range[0], Math.min(range[1], nv)).toFixed(3);
  }

  function newReactor() {
    const t = pick(TARGETS);
    const r = TARGET_RANGE[t];
    return {
      feature: pick(FEATURES),
      target: t,
      ease: pick(EASES),
      scale: +(r[0] + rand() * (r[1] - r[0])).toFixed(2),
    };
  }

  function newReactorPair() { return [newReactor(), newReactor()]; }

  // ---- the four operations ------------------------------------------------

  // REMAP — rewire audio features to parameters. Assets and visual parameters
  // are untouched unless preserve.assets is off, in which case the page's own
  // content-aware remap() also reassigns clips.
  function remap() {
    const L = layersObj();
    if (!L || !L.list.length) return false;
    withHistory('remap', function () {
      if (!state.preserve.assets && typeof L.remap === 'function') L.remap();
      for (const l of L.list) {
        if (!inScope(l) || !canTouch(l, 'reactors')) continue;
        l.reactors = newReactorPair();
      }
      if (typeof L.render === 'function') L.render();
    });
    return true;
  }

  // RANDOMIZE — fresh, unrelated absolute values inside the current scope.
  // `amount` widens the sampled range (0 = centre of range, 1 = full range).
  function randomize() {
    const L = layersObj();
    if (!L || !L.list.length) return false;
    const spread = 0.3 + state.amount * 0.7;
    withHistory('randomize', function () {
      for (const l of L.list) {
        if (!inScope(l)) continue;
        if (canTouch(l, 'blend'))      l.blend      = pick(BLENDS);
        if (canTouch(l, 'opacity'))    l.opacity    = pickIn(VISUAL_RANGE.opacity, spread);
        if (canTouch(l, 'baseScale'))  l.baseScale  = pickIn(VISUAL_RANGE.baseScale, spread);
        if (canTouch(l, 'hue'))        l.hue        = Math.round(pickIn(VISUAL_RANGE.hue, spread));
        if (canTouch(l, 'brightness')) l.brightness = pickIn(VISUAL_RANGE.brightness, spread);
        if (canTouch(l, 'contrast'))   l.contrast   = pickIn(VISUAL_RANGE.contrast, spread);
        if (canTouch(l, 'reactors'))   l.reactors   = newReactorPair();
      }
      if (typeof L.render === 'function') L.render();
    });
    return true;
  }

  // MUTATE — perturb what is already there. Never swaps asset or blend unless
  // both are unlocked AND the user has pushed amount past 0.7.
  function mutate() {
    const L = layersObj();
    if (!L || !L.list.length) return false;
    const bold = state.amount > 0.7;
    withHistory('mutate', function () {
      for (const l of L.list) {
        if (!inScope(l)) continue;
        if (canTouch(l, 'opacity'))    l.opacity    = jitter(l.opacity,    VISUAL_RANGE.opacity);
        if (canTouch(l, 'baseScale'))  l.baseScale  = jitter(l.baseScale,  VISUAL_RANGE.baseScale);
        if (canTouch(l, 'hue'))        l.hue        = Math.round(jitter(l.hue, VISUAL_RANGE.hue));
        if (canTouch(l, 'brightness')) l.brightness = jitter(l.brightness, VISUAL_RANGE.brightness);
        if (canTouch(l, 'contrast'))   l.contrast   = jitter(l.contrast,   VISUAL_RANGE.contrast);
        if (bold && canTouch(l, 'blend')) l.blend = pick(BLENDS);
        if (canTouch(l, 'reactors')) {
          for (const r of l.reactors) {
            const range = TARGET_RANGE[r.target] || [0, 1];
            r.scale = jitter(r.scale, range);
            // At high amount, occasionally re-point one mapping.
            if (bold && rand() < 0.25) { const nr = newReactor(); r.feature = nr.feature; r.ease = nr.ease; }
          }
        }
      }
      if (typeof L.render === 'function') L.render();
    });
    return true;
  }

  // EVOLVE — successive guided variants. Advances on the beat (one generation
  // every BEATS_PER_GEN beats) whenever audio is playing; falls back to a
  // wall-clock timer when idle. Each generation is a half-strength mutate, so
  // the run drifts rather than thrashes.
  let evoTimer = null;
  let evoBeats = 0;
  let evoTotal = 0;
  let evoBeatHook = null;

  function evolveStep() {
    const savedAmount = state.amount;
    state.amount = savedAmount * 0.5;
    mutate();
    state.amount = savedAmount;
    state.generation += 1;
    emit('swr-genops-generation', { n: state.generation, total: evoTotal });
    if (evoTotal > 0 && state.generation >= evoTotal) pauseEvolve();
  }

  function evolve(opts) {
    const o = Object.assign({ rate: 2000, generations: 8, bars: 2 }, opts || {});
    pauseEvolve();
    state.evolving = true;
    state.generation = 0;
    evoTotal = o.generations;
    evoBeats = 0;
    const beatsPerGen = Math.max(1, Math.round((o.bars || 2) * 4));

    // Beat-driven when a song is playing, wall-clock otherwise. Re-checked each
    // tick so starting playback mid-run switches it over.
    evoBeatHook = function () {
      const f = audioFeat();
      if (f.beatPulse) { evoBeats += 1; if (evoBeats >= beatsPerGen) { evoBeats = 0; evolveStep(); } }
    };
    let elapsed = 0;
    evoTimer = setInterval(function () {
      const playing = !!(window.SWR && window.SWR.Audio && window.SWR.Audio.playing);
      if (playing) { evoBeatHook(); elapsed = 0; return; }
      elapsed += 50;
      if (elapsed >= o.rate) { elapsed = 0; evolveStep(); }
    }, 50);
    emit('swr-genops-evolve', { running: true });
    return true;
  }

  function pauseEvolve() {
    if (evoTimer) { clearInterval(evoTimer); evoTimer = null; }
    evoBeatHook = null;
    if (state.evolving) { state.evolving = false; emit('swr-genops-evolve', { running: false }); }
    return true;
  }

  // ---- selection: keep / breed / discard / commit -------------------------

  function variation(id) {
    for (const v of state.variations) if (v.id === id) return v;
    return null;
  }

  // Make a stored variation the live patch again.
  function keep(id) {
    const v = variation(id);
    if (!v) return false;
    withHistory('keep', function () { restore(v.patch); });
    return true;
  }

  // Per-field coin flip between two stored patches, layer by layer.
  function breed(idA, idB) {
    const a = variation(idA), b = variation(idB);
    if (!a || !b) return false;
    const FIELDS = ['assetId', 'blend', 'opacity', 'baseScale', 'hue', 'brightness', 'contrast'];
    const n = Math.min(a.patch.layers.length, b.patch.layers.length);
    const child = { seed: state.seed, at: Date.now(), label: 'breed', layers: [] };
    for (let i = 0; i < n; i++) {
      const pa = a.patch.layers[i], pb = b.patch.layers[i];
      const kid = { id: pa.id, locks: Object.assign({}, pa.locks) };
      for (const f of FIELDS) kid[f] = (rand() < 0.5 ? pa : pb)[f];
      const src = rand() < 0.5 ? pa : pb;
      kid.reactors = src.reactors.map(function (r) { return Object.assign({}, r); });
      child.layers.push(kid);
    }
    withHistory('breed', function () { restore(child); });
    return true;
  }

  function discard(id) {
    const before = state.variations.length;
    state.variations = state.variations.filter(function (v) { return v.id !== id; });
    emit('swr-genops-history', { index: state.hIndex, length: state.history.length });
    return state.variations.length < before;
  }

  // Freeze the current patch as the new baseline; clears pending variations and
  // stops any running evolve.
  function commit() {
    pauseEvolve();
    const p = snapshot();
    if (!p) return false;
    p.label = 'commit';
    state.history = [p];
    state.hIndex = 0;
    state.variations = [];
    state.generation = 0;
    emit('swr-genops-history', { index: 0, length: 1 });
    emit('swr-genops-op', { op: 'commit', label: 'commit' });
    return true;
  }

  // ---- setters ------------------------------------------------------------

  function setScope(s) {
    if (['selected', 'all', 'mappings', 'visuals'].indexOf(s) === -1) return state.scope;
    state.scope = s;
    return s;
  }
  function setAmount(n) {
    state.amount = Math.max(0, Math.min(1, +n || 0));
    return state.amount;
  }
  function setPreserve(key, val) {
    if (!(key in state.preserve)) return null;
    state.preserve[key] = !!val;
    return state.preserve[key];
  }

  // ---- share URL (seed only — patches are not portable) -------------------
  //
  // Library assets are local blobs with per-session ids, so serializing layers
  // into a URL would restore with null assets on any other machine. Seed +
  // scope + amount is the smallest honest reproducible unit.

  function shareUrl() {
    const base = location.origin + location.pathname;
    return base + '#seed=' + state.seed + '&scope=' + state.scope + '&amount=' + state.amount.toFixed(2);
  }

  function readHash() {
    const h = (location.hash || '').replace(/^#/, '');
    if (!h) return false;
    const q = {};
    for (const part of h.split('&')) {
      const i = part.indexOf('=');
      if (i > 0) q[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
    }
    if (!q.seed) return false;
    setSeed(parseInt(q.seed, 10) || 0);
    setDeterministic(true);
    if (q.scope) setScope(q.scope);
    if (q.amount) setAmount(parseFloat(q.amount));
    return true;
  }

  function getState() {
    return {
      seed: state.seed,
      deterministic: state.deterministic,
      scope: state.scope,
      amount: state.amount,
      preserve: Object.assign({}, state.preserve),
      historyIndex: state.hIndex,
      historyLength: state.history.length,
      canUndo: state.hIndex > 0,
      canRedo: state.hIndex < state.history.length - 1,
      variations: state.variations.map(function (v) { return { id: v.id, label: v.label }; }),
      evolving: state.evolving,
      generation: state.generation,
      lastOp: state.lastOp,
    };
  }

  // ---- init ---------------------------------------------------------------

  if (!readHash()) {
    let stored = null;
    try { stored = localStorage.getItem(LS_SEED); } catch (_) {}
    if (stored != null && stored !== '') setSeed(parseInt(stored, 10) || 0);
    else reroll();
  }

  window.SWR_GENOPS = {
    // ops
    remap: remap, randomize: randomize, mutate: mutate,
    evolve: evolve, pauseEvolve: pauseEvolve, commit: commit,
    // selection
    keep: keep, breed: breed, discard: discard,
    // history
    undo: undo, redo: redo,
    // config
    setSeed: setSeed, reroll: reroll, setScope: setScope, setAmount: setAmount,
    setPreserve: setPreserve, setDeterministic: setDeterministic, toggleLock: toggleLock,
    // randomness (pages call this — see versions/_genops-inject.js)
    rand: rand, rngFrom: rngFrom,
    // introspection
    getState: getState, shareUrl: shareUrl,
    // constants, shared with the UI + layer cards
    BLENDS: BLENDS, FEATURES: FEATURES, TARGETS: TARGETS, EASES: EASES,
    TARGET_RANGE: TARGET_RANGE, LOCKABLE: LOCKABLE,
    // testing hooks
    _snapshot: snapshot, _restore: restore, _state: state,
  };

  // =========================================================================
  // UI — the action bar, mounted above the Layers list on every engine page.
  // =========================================================================

  const OP_DESC = {
    remap:     'REMAP — rewire audio features to parameters. Keeps the look, changes the reactions.',
    randomize: 'RANDOMIZE — fresh unrelated variation within the current scope.',
    mutate:    'MUTATE — small perturbation of the current patch. Amount controls the size.',
    evolve:    'EVOLVE — successive guided variants; keep / breed / discard, then commit.',
  };

  let ui = null;          // { root, desc, seed, undo, redo, strip, gen, evolveBtn }
  let ghostPatch = null;   // patch held during press-and-hold A/B preview

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function describe(text) { if (ui && ui.desc) ui.desc.textContent = text || ''; }

  function mountUI() {
    const host = document.querySelector('aside.layers');
    if (!host || host.querySelector('.genops')) return false;

    const root = el('details', 'genops');
    root.open = window.innerHeight > 720;
    root.appendChild(el('summary', null, 'generative'));

    // --- four ops ---
    const ops = el('div', 'genops-ops');
    const mk = function (key, label) {
      const b = el('button', null, label);
      b.type = 'button';
      b.dataset.op = key;
      b.title = OP_DESC[key];
      b.addEventListener('mouseenter', function () { describe(OP_DESC[key]); });
      ops.appendChild(b);
      return b;
    };
    const bRemap = mk('remap', 'remap');
    const bRand  = mk('randomize', 'randomize');
    const bMut   = mk('mutate', 'mutate');
    const bEvo   = mk('evolve', 'evolve');
    root.appendChild(ops);

    const desc = el('div', 'genops-desc', OP_DESC.randomize);
    root.appendChild(desc);

    // --- scope + amount ---
    const r1 = el('div', 'genops-row');
    r1.appendChild(el('label', null, 'scope'));
    const scopeSel = el('select');
    [['selected', 'selected layer'], ['all', 'all layers'],
     ['mappings', 'mappings only'], ['visuals', 'visuals only']]
      .forEach(function (o) {
        const opt = el('option', null, o[1]); opt.value = o[0]; scopeSel.appendChild(opt);
      });
    scopeSel.value = state.scope;
    scopeSel.title = 'Which layers and which parameter families the operations touch.';
    r1.appendChild(scopeSel);
    root.appendChild(r1);

    const r2 = el('div', 'genops-row');
    r2.appendChild(el('label', null, 'amount'));
    const amtIn = el('input');
    amtIn.type = 'range'; amtIn.min = '0'; amtIn.max = '1'; amtIn.step = '0.05';
    amtIn.value = String(state.amount);
    amtIn.title = 'Strength. Randomize widens its range; Mutate takes bigger steps.';
    const amtOut = el('b', null, state.amount.toFixed(2));
    r2.appendChild(amtIn); r2.appendChild(amtOut);
    root.appendChild(r2);

    // --- preserve ---
    const r3 = el('div', 'genops-row');
    r3.appendChild(el('label', null, 'preserve'));
    const chks = {};
    [['assets', 'assets'], ['mappings', 'mappings'], ['blend', 'blend']].forEach(function (p) {
      const wrap = el('label', 'genops-chk' + (state.preserve[p[0]] ? ' on' : ''));
      const c = el('input'); c.type = 'checkbox'; c.checked = !!state.preserve[p[0]];
      wrap.appendChild(c); wrap.appendChild(document.createTextNode(p[1]));
      wrap.title = 'Keep ' + p[1] + ' untouched by every operation.';
      c.addEventListener('change', function () {
        setPreserve(p[0], c.checked);
        wrap.classList.toggle('on', c.checked);
      });
      chks[p[0]] = c;
      r3.appendChild(wrap);
    });
    root.appendChild(r3);

    // --- seed + history ---
    const r4 = el('div', 'genops-row');
    r4.appendChild(el('label', null, 'seed'));
    const seedOut = el('span', 'genops-seed', String(state.seed));
    const bReroll = el('button', 'genops-mini', '↻');
    bReroll.type = 'button'; bReroll.title = 'New random seed';
    const bCopy = el('button', 'genops-mini', 'copy');
    bCopy.type = 'button'; bCopy.title = 'Copy a shareable link carrying this seed, scope and amount';
    const detWrap = el('label', 'genops-chk' + (state.deterministic ? ' on' : ''));
    const detChk = el('input'); detChk.type = 'checkbox'; detChk.checked = state.deterministic;
    detWrap.appendChild(detChk); detWrap.appendChild(document.createTextNode('det'));
    detWrap.title = 'Deterministic mode: the same seed reproduces the same result, including asset selection.';
    r4.appendChild(seedOut); r4.appendChild(bReroll); r4.appendChild(bCopy); r4.appendChild(detWrap);
    root.appendChild(r4);

    const r5 = el('div', 'genops-row');
    const bUndo = el('button', 'genops-mini', 'undo');
    const bRedo = el('button', 'genops-mini', 'redo');
    bUndo.type = 'button'; bRedo.type = 'button';
    bUndo.title = 'Undo the last generative operation (⌘/Ctrl+Z)';
    bRedo.title = 'Redo (⇧⌘/Ctrl+Z)';
    const bCommit = el('button', 'genops-mini', 'commit');
    bCommit.type = 'button';
    bCommit.title = 'Freeze the current patch as the new baseline and clear the variation strip';
    const genOut = el('span', 'genops-gen', '');
    r5.appendChild(bUndo); r5.appendChild(bRedo); r5.appendChild(bCommit); r5.appendChild(genOut);
    root.appendChild(r5);

    // --- variation strip ---
    const strip = el('div', 'genops-strip');
    strip.title = 'Recent variations. Click to keep, press and hold to preview, × to discard.';
    root.appendChild(strip);

    // Insert above the layer list, below the panel heading.
    const body = host.querySelector('.body');
    if (body) host.insertBefore(root, body);
    else host.appendChild(root);

    ui = { root: root, desc: desc, seed: seedOut, undo: bUndo, redo: bRedo,
           strip: strip, gen: genOut, evolveBtn: bEvo };

    // --- wiring ---
    bRemap.addEventListener('click', function () { remap(); describe(OP_DESC.remap); });
    bRand.addEventListener('click',  function () { randomize(); describe(OP_DESC.randomize); });
    bMut.addEventListener('click',   function () { mutate(); describe(OP_DESC.mutate); });
    bEvo.addEventListener('click',   function () {
      if (state.evolving) { pauseEvolve(); }
      else { evolve({ generations: 8, bars: 2, rate: 2000 }); }
      describe(OP_DESC.evolve);
    });
    scopeSel.addEventListener('change', function () { setScope(scopeSel.value); });
    amtIn.addEventListener('input', function () {
      amtOut.textContent = setAmount(amtIn.value).toFixed(2);
    });
    bReroll.addEventListener('click', function () { reroll(); });
    bCopy.addEventListener('click', function () {
      const url = shareUrl();
      if (navigator.clipboard) navigator.clipboard.writeText(url).catch(function () {});
      describe('copied ' + url);
    });
    detChk.addEventListener('change', function () {
      setDeterministic(detChk.checked);
      detWrap.classList.toggle('on', detChk.checked);
    });
    bUndo.addEventListener('click', function () { undo(); });
    bRedo.addEventListener('click', function () { redo(); });
    bCommit.addEventListener('click', function () { commit(); renderUI(); });

    // keyboard: skip while typing in a field
    document.addEventListener('keydown', function (ev) {
      const t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && (ev.key === 'z' || ev.key === 'Z')) {
        ev.preventDefault();
        if (ev.shiftKey) redo(); else undo();
        return;
      }
      if (mod) return;
      if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); randomize(); describe(OP_DESC.randomize); }
      else if (ev.key === 'm' || ev.key === 'M') { ev.preventDefault(); mutate(); describe(OP_DESC.mutate); }
    });

    renderUI();
    return true;
  }

  // Rebuild the volatile parts of the bar (seed, history buttons, strip, gen counter).
  function renderUI() {
    if (!ui) return;
    const s = getState();
    ui.seed.textContent = String(s.seed);
    ui.undo.disabled = !s.canUndo;
    ui.redo.disabled = !s.canRedo;
    ui.evolveBtn.classList.toggle('live', s.evolving);
    ui.gen.textContent = s.evolving ? ('gen ' + s.generation + '/8') : '';

    ui.strip.innerHTML = '';
    const cur = el('div', 'chip current', 'current');
    ui.strip.appendChild(cur);
    state.variations.forEach(function (v, i) {
      const chip = el('div', 'chip');
      chip.appendChild(document.createTextNode('v' + (i + 1)));
      const kill = el('span', 'kill', '×');
      chip.appendChild(kill);
      chip.title = v.label + ' — click to keep, hold to preview';
      // press-and-hold ghost preview: restore while held, snap back on release
      chip.addEventListener('mousedown', function (ev) {
        if (ev.target === kill) return;
        ghostPatch = snapshot();
        restore(v.patch);
        chip.classList.add('ghost');
      });
      const release = function () {
        if (!ghostPatch) return;
        restore(ghostPatch);
        ghostPatch = null;
        chip.classList.remove('ghost');
      };
      chip.addEventListener('mouseup', release);
      chip.addEventListener('mouseleave', release);
      chip.addEventListener('click', function (ev) {
        if (ev.target === kill) { ev.stopPropagation(); discard(v.id); renderUI(); return; }
        ghostPatch = null;
        chip.classList.remove('ghost');
        keep(v.id);
      });
      ui.strip.appendChild(chip);
    });
  }

  ['swr-genops-seed', 'swr-genops-history', 'swr-genops-op',
   'swr-genops-evolve', 'swr-genops-generation'].forEach(function (n) {
    window.addEventListener(n, renderUI);
  });

  // =========================================================================
  // Layer card augmentation — per-parameter locks, a live mapping matrix and an
  // advanced drawer, applied to whatever markup the page's own render() built.
  //
  // Pages keep their existing Layers.render(); this decorates the result, so a
  // page that changes its card markup degrades gracefully instead of breaking.
  // =========================================================================

  const LOCK_ROWS = { blend: 'blend', opacity: 'opacity', scale: 'scale', hue: 'hue' };

  function layerFor(card, index) {
    const L = layersObj();
    if (!L) return null;
    return L.list[index] || null;
  }

  function addLock(target, l, field) {
    if (!l) return;
    if (!l.locks) l.locks = {};
    const on = !!l.locks[field];
    const b = el('button', 'lockbtn' + (on ? ' on' : ''), on ? '☐\ufe0e' : '\u25a1');
    // Above: a checked box when locked, an empty box when unlocked. Both render
    // from the page's own font fallback (no emoji needed).
    b.dataset.glyph = on ? 'locked' : 'unlocked';
    b.type = 'button';
    b.title = (l.locks[field] ? 'Unlock' : 'Lock') + ' ' + field +
              ' — locked parameters survive every generative operation';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleLock(l.id, field);
    });
    target.appendChild(b);
  }

  // Replace the static `rms→scale ×0.40` text with real controls.
  function buildMappingMatrix(l) {
    const box = el('div', 'mapmx');
    const rebuild = function () {
      box.innerHTML = '';
      l.reactors.forEach(function (r, ri) {
        const row = el('div', 'mapr');

        const fSel = el('select');
        FEATURES.forEach(function (f) {
          const o = el('option', null, f); o.value = f; fSel.appendChild(o);
        });
        fSel.value = r.feature;
        fSel.title = 'Audio feature (source)';

        row.appendChild(fSel);
        row.appendChild(el('span', 'arrow', '→'));

        const tSel = el('select');
        TARGETS.forEach(function (t) {
          const o = el('option', null, t); o.value = t; tSel.appendChild(o);
        });
        tSel.value = r.target;
        tSel.title = 'Parameter (destination)';
        row.appendChild(tSel);

        const eSel = el('select');
        EASES.forEach(function (e) {
          const o = el('option', null, e); o.value = e; eSel.appendChild(o);
        });
        eSel.value = r.ease;
        eSel.title = 'Response curve';
        row.appendChild(eSel);

        const range = TARGET_RANGE[r.target] || [0, 1];
        const amt = el('input');
        amt.type = 'range';
        amt.min = String(range[0]); amt.max = String(range[1]);
        amt.step = String((range[1] - range[0]) / 100);
        amt.value = String(r.scale);
        amt.title = 'Depth';
        const amtOut = el('span', 'amt', (+r.scale).toFixed(2));
        row.appendChild(amt); row.appendChild(amtOut);

        addLock(row, l, 'mappings');

        const kill = el('button', 'lockbtn', '×');
        kill.type = 'button';
        kill.title = 'Remove this mapping';
        kill.addEventListener('click', function (ev) {
          ev.stopPropagation();
          l.reactors.splice(ri, 1);
          rebuild();
        });
        row.appendChild(kill);

        fSel.addEventListener('change', function () { r.feature = fSel.value; });
        tSel.addEventListener('change', function () {
          r.target = tSel.value;
          const nr = TARGET_RANGE[r.target] || [0, 1];
          amt.min = String(nr[0]); amt.max = String(nr[1]);
          amt.step = String((nr[1] - nr[0]) / 100);
          r.scale = Math.max(nr[0], Math.min(nr[1], r.scale));
          amt.value = String(r.scale);
          amtOut.textContent = (+r.scale).toFixed(2);
        });
        eSel.addEventListener('change', function () { r.ease = eSel.value; });
        amt.addEventListener('input', function () {
          r.scale = +amt.value;
          amtOut.textContent = (+r.scale).toFixed(2);
        });

        box.appendChild(row);
      });

      if (l.reactors.length < 4) {
        const add = el('button', 'mapadd', '+ mapping');
        add.type = 'button';
        add.title = 'Add another audio → parameter mapping';
        add.addEventListener('click', function (ev) {
          ev.stopPropagation();
          l.reactors.push(newReactor());
          rebuild();
        });
        box.appendChild(add);
      }
    };
    rebuild();
    return box;
  }

  // brightness/contrast already exist in the model and in applyR(); expose them
  // so the visible parameter set matches what randomization can touch.
  function buildAdvanced(l) {
    const d = el('details', 'adv');
    d.appendChild(el('summary', null, 'advanced'));
    [['brightness', VISUAL_RANGE.brightness], ['contrast', VISUAL_RANGE.contrast]]
      .forEach(function (spec) {
        const key = spec[0], range = spec[1];
        const row = el('div', 'r');
        row.appendChild(el('label', null, key));
        const inp = el('input');
        inp.type = 'range';
        inp.min = String(range[0]); inp.max = String(range[1]); inp.step = '0.01';
        inp.value = String(l[key] == null ? 1 : l[key]);
        inp.addEventListener('input', function () { l[key] = +inp.value; });
        row.appendChild(inp);
        d.appendChild(row);
      });
    return d;
  }

  function decorateCards() {
    const L = layersObj();
    const host = document.getElementById('layers');
    if (!L || !host) return;
    const cards = host.querySelectorAll('.l');
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (card.dataset.genops === '1') continue;
      const l = layerFor(card, i);
      if (!l) continue;
      card.dataset.genops = '1';
      if (!l.locks) l.locks = {};

      // asset lock in the header, next to the name
      const head = card.querySelector('.lh');
      if (head) {
        const x = head.querySelector('.x');
        const holder = el('span');
        addLock(holder, l, 'asset');
        if (x) head.insertBefore(holder.firstChild, x); else head.appendChild(holder.firstChild);
      }

      // one lock per parameter row, keyed off the row's label text
      const rows = card.querySelectorAll('.r');
      for (const row of rows) {
        const lab = row.querySelector('label');
        if (!lab) continue;
        const field = LOCK_ROWS[lab.textContent.trim()];
        if (field) addLock(row, l, field);
      }

      // live mapping matrix replaces the static react text
      const react = card.querySelector('.react');
      if (react) {
        react.textContent = '';
        react.appendChild(buildMappingMatrix(l));
      } else {
        card.appendChild(buildMappingMatrix(l));
      }

      // advanced drawer
      card.appendChild(buildAdvanced(l));

      // route the page's per-layer dice through genops so it lands in history
      const rnd = card.querySelector('.rnd');
      if (rnd && !rnd.dataset.genops) {
        rnd.dataset.genops = '1';
        const clone = rnd.cloneNode(true);   // drop the page's own handler
        rnd.parentNode.replaceChild(clone, rnd);
        clone.title = "Randomize this layer only (scoped Randomize — undoable)";
        clone.addEventListener('click', function (ev) {
          ev.stopPropagation();
          const prevScope = state.scope;
          const prevSel = L.sel;
          L.sel = l;
          setScope('selected');
          randomize();
          setScope(prevScope);
          L.sel = prevSel;
          clone.classList.add('flash');
          setTimeout(function () { clone.classList.remove('flash'); }, 220);
        });
      }
    }
  }

  // Wrap the page's Layers.render() so cards are decorated after every rebuild.
  function hookRender() {
    const L = layersObj();
    if (!L || typeof L.render !== 'function' || L.render.__genops) return false;
    const orig = L.render.bind(L);
    const wrapped = function () {
      const r = orig.apply(null, arguments);
      try { decorateCards(); } catch (e) { /* never break the page's render */ }
      return r;
    };
    wrapped.__genops = true;
    L.render = wrapped;
    if (L.list && L.list.length) L.render();
    return true;
  }

  // The pages define window.SWR at the end of their IIFE, and the library loads
  // asynchronously, so poll briefly rather than assuming it exists at load.
  let hookTries = 0;
  const hookTimer = setInterval(function () {
    hookTries += 1;
    if (hookRender() || hookTries > 60) clearInterval(hookTimer);
  }, 100);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUI);
  } else {
    mountUI();
  }
  window.SWR_GENOPS.mountUI = mountUI;
  window.SWR_GENOPS.renderUI = renderUI;
  window.SWR_GENOPS.decorateCards = decorateCards;
  window.SWR_GENOPS.hookRender = hookRender;
})();
