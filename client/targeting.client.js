// client/targeting.client.js — the Targeted Engine runtime.
//
// Watches in-session signals (surface visits, preset changes, transition
// fires), classifies the session into one of the 28 workflow personas in
// marketing/personas/full/ and one of the 4 marketing segments in
// marketing/scripts/, then adapts the engine UI: reorders the #variant
// <select>, pins transitions in the #swr-tx-pick <select>, and offers a
// dismissible banner.
//
// PRIVACY CONTRACT (NFR-3, FR-14): nothing leaves the device. Every signal,
// correction and dismissal lives in the IndexedDB database `swr-targeting`,
// which nothing else reads and no code ever uploads. There is no network call
// other than the one local fetch of /targeting/rules.json (and that is skipped
// when the build inlined the table into the page).
//
// PUBLIC API — window.SWR_TARGETING
//   .version                       artifact version string
//   .signals.record({kind,payload})  kinds: visit | preset | transition |
//                                    session_start | session_end | entry
//   .signals.list()                the in-memory rolling window (≤200)
//   .signals.flush()                persist the window to IDB now
//   .classify()                    -> { personaId, segmentId, personaScore,
//                                        segmentScore, alternatives }
//   .maybeReorderVariants(sel, ids)  called by client/variant-switcher.client.js
//   .applyVariantOrder(sel, order)
//   .applyTransitionPins(ids)
//   .showBanner({surface, copy, cta}) -> { shown, reason?, copy?, cta? }
//   .dismissBanner(surface)
//   .notMe()                       "Not me" correction on the current persona
//   .voice.lint(text)              -> { ok, hits }
//   .persona() / .segment()        current classification result
//   ._debug                        test hooks
//
// GRACEFUL DEGRADATION (NFR-10): every public method is wrapped so a missing
// rules table, a throwing classifier or a blocked IDB leaves the engine in its
// default untargeted state. Nothing here ever throws into a caller.
//
// Loaded by engine.html with `defer`, before client/variant-switcher.client.js
// so window.SWR_TARGETING exists when that module's wireUI() runs.

(function () {
  'use strict';
  if (window.SWR_TARGETING) return;

  var VERSION = 'swr-targeting/v1';
  var DB_NAME = 'swr-targeting';
  var DB_VERSION = 1;
  var STORES = ['signals', 'corrections', 'dismissed'];
  var MAX_SIGNALS = 200;
  var RECLASSIFY_MS = 30000;        // FR-3: re-evaluate periodically
  var CORRECTION_HALF_LIFE_DAYS = 14;
  var DISMISS_DAYS = 7;
  var MIN_SCORE = 2;                // below this the session is untargeted
  var RULES_URL = '/targeting/rules.json';

  // FR-10: the only auth affordance the targeting layer may ever point at.
  // Anything else (oauth, google, github, sso, …) is dropped before it can
  // reach the DOM, so the magic-link-only rule is enforced in code and not
  // only by convention.
  var ALLOWED_AUTH_HINTS = { 'magic-link': 1, magic: 1, verify: 1, code: 1, email: 1 };

  var NEUTRAL_COPY = 'Free, in your browser, no signup.';

  // pathname → surface code (marketing/personas/full/README.md surface codes).
  var PATH_SURFACE = [
    [/^\/ar-loop/, 'AR'],
    [/^\/engine-ar-loop/, 'AR'],
    [/^\/versions\//, 'VER'],
    [/^\/personas\/v\//, 'VER'],
    [/^\/storyboard/, 'STORY'],
    [/^\/dashboard/, 'AAP'],
    [/^\/engine/, 'ENG'],
  ];

  // Signature rules from the PRD's use cases (UC-001 … UC-007). Each is a
  // booster on top of the surface-overlap score below.
  var SIGNATURE_RULES = [
    { persona: 'ar-loop-poster', score: 6, when: function (c) { return c.surface.AR >= 2 && c.surface.PST >= 1; } },
    { persona: 'fx-surgeon', score: 6, when: function (c) { return c.surface.FX >= 3 && c.presets >= 2; } },
    { persona: 'live-vj', score: 6, when: function (c) { return c.surface.TX >= 3 && c.transitions >= 5; } },
    { persona: 'bedroom-producer', score: 5, when: function (c) { return c.surface.PST >= 4 && c.surface.LIB >= 2 && !c.surface.AR; } },
    { persona: 'transition-choreo', score: 5, when: function (c) { return c.transitions >= 5 && c.surface.TX >= 2; } },
    { persona: 'tag-janitor', score: 4, when: function (c) { return c.surface.LIB >= 3 && !c.surface.AR && c.presets === 0 && c.transitions === 0; } },
  ];

  var state = {
    signals: [],
    corrections: {},
    dismissed: {},
    rules: null,
    result: null,
    variantSelect: null,
    variantIds: null,
    timer: null,
    flushTimer: null,
    ready: false,
  };

  // ── small helpers ─────────────────────────────────────────────────────────

  function now() { return Date.now(); }

  function safe(fn, fallback) {
    try { return fn(); } catch (_) { return fallback; }
  }

  function pathname() {
    return (typeof location !== 'undefined' && location && location.pathname) || '/';
  }

  function surfaceForPath(p) {
    for (var i = 0; i < PATH_SURFACE.length; i++) {
      if (PATH_SURFACE[i][0].test(p)) return PATH_SURFACE[i][1];
    }
    return 'ENG';
  }

  function decayFactor(ts) {
    var days = (now() - ts) / 86400000;
    if (days <= 0) return 1;
    return Math.exp((-days / CORRECTION_HALF_LIFE_DAYS) * Math.LN2);
  }

  // ── IndexedDB (best effort — a blocked IDB must never break the engine) ────

  function openDB() {
    return new Promise(function (resolve) {
      var idb = window.indexedDB;
      if (!idb) return resolve(null);
      var req;
      try { req = idb.open(DB_NAME, DB_VERSION); } catch (_) { return resolve(null); }
      req.onupgradeneeded = function () {
        var db = req.result;
        for (var i = 0; i < STORES.length; i++) {
          if (!db.objectStoreNames.contains(STORES[i])) {
            db.createObjectStore(STORES[i], { keyPath: STORES[i] === 'signals' ? 'id' : (STORES[i] === 'dismissed' ? 'surface' : 'personaId') });
          }
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
  }

  function tx(db, store, mode, fn) {
    return new Promise(function (resolve) {
      if (!db) return resolve(null);
      var t;
      try { t = db.transaction(store, mode); } catch (_) { return resolve(null); }
      var os = t.objectStore(store);
      var out = null;
      try { out = fn(os); } catch (_) { return resolve(null); }
      t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
      t.onerror = function () { resolve(null); };
      t.onabort = function () { resolve(null); };
    });
  }

  function all(db, store) {
    return new Promise(function (resolve) {
      if (!db) return resolve([]);
      var t;
      try { t = db.transaction(store, 'readonly'); } catch (_) { return resolve([]); }
      var req = t.objectStore(store).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { resolve([]); };
    });
  }

  var _dbPromise = null;
  function db() {
    if (!_dbPromise) _dbPromise = openDB();
    return _dbPromise;
  }

  function persistSignals() {
    db().then(function (d) {
      if (!d) return;
      var t;
      try { t = d.transaction('signals', 'readwrite'); } catch (_) { return; }
      try {
        var os = t.objectStore('signals');
        os.clear();
        state.signals.forEach(function (s) { os.put(s); });
      } catch (_) { /* quota / blocked — in-memory window still works */ }
    });
  }

  function persistCorrection(c) {
    db().then(function (d) { if (d) tx(d, 'corrections', 'readwrite', function (os) { os.put(c); }); });
  }

  function persistDismissal(surface, ts) {
    db().then(function (d) { if (d) tx(d, 'dismissed', 'readwrite', function (os) { os.put({ surface: surface, ts: ts }); }); });
  }

  // ── rules load ────────────────────────────────────────────────────────────

  function inlineRules() {
    var el = document.getElementById('swrc-targeting-rules');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (_) { return null; }
  }

  function fetchRules() {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(RULES_URL)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function loadRules() {
    var inline = safe(inlineRules, null);
    if (inline) return Promise.resolve(inline);
    return fetchRules();
  }

  // ── classifier ────────────────────────────────────────────────────────────

  function tally(signals) {
    var c = { surface: Object.create(null), presets: 0, transitions: 0, visits: 0, total: 0 };
    for (var i = 0; i < signals.length; i++) {
      var s = signals[i];
      c.total++;
      if (s.kind === 'visit') {
        c.visits++;
        var surf = (s.payload && s.payload.surface) || s.surface || 'ENG';
        c.surface[surf] = (c.surface[surf] || 0) + 1;
      } else if (s.kind === 'preset') {
        c.presets++;
        c.surface.PST = (c.surface.PST || 0) + 1;
      } else if (s.kind === 'transition') {
        c.transitions++;
        c.surface.TX = (c.surface.TX || 0) + 1;
      }
    }
    return c;
  }

  function scoreAll(counts, rules, corrections) {
    var out = Object.create(null);
    var surfaces = rules.personaSurfaces || {};
    Object.keys(rules.personaToSegment || {}).forEach(function (pid) {
      var s = 0;
      var ps = surfaces[pid] || [];
      for (var i = 0; i < ps.length; i++) s += (counts.surface[ps[i]] || 0);
      out[pid] = s;
    });
    for (var r = 0; r < SIGNATURE_RULES.length; r++) {
      var rule = SIGNATURE_RULES[r];
      if (out[rule.persona] === undefined) continue;
      if (safe(function () { return rule.when(counts); }, false)) out[rule.persona] += rule.score;
    }
    // FR-11/12/13: a "Not me" correction lowers that persona's score, and the
    // penalty decays with a 14-day half-life so it never becomes permanent.
    Object.keys(corrections).forEach(function (pid) {
      if (out[pid] === undefined) return;
      var c = corrections[pid];
      out[pid] -= (c.weight || 1) * decayFactor(c.ts || 0) * 3;
    });
    return out;
  }

  function classifyWith(signals, rules, corrections) {
    if (!rules || !rules.personaToSegment) return { personaId: null, segmentId: null, personaScore: 0, segmentScore: 0, alternatives: [] };
    var counts = tally(signals);
    var scores = scoreAll(counts, rules, corrections);
    var ranked = Object.keys(scores).sort(function (a, b) {
      return scores[b] - scores[a] || (a < b ? -1 : a > b ? 1 : 0);
    });
    var top = ranked[0];
    if (!top || scores[top] < MIN_SCORE) {
      return { personaId: null, segmentId: null, personaScore: 0, segmentScore: 0, alternatives: ranked.slice(0, 3).map(function (id) { return { id: id, score: scores[id] }; }) };
    }
    var segmentId = rules.personaToSegment[top] || null;
    return {
      personaId: top,
      segmentId: segmentId,
      personaScore: scores[top],
      segmentScore: segmentId ? counts.surface[segmentId] || 0 : 0,
      alternatives: ranked.slice(0, 3).map(function (id) { return { id: id, score: scores[id] }; }),
    };
  }

  // ── UI adapter ────────────────────────────────────────────────────────────

  function applyVariantOrder(sel, order) {
    if (!sel || !order || !order.length) return false;
    var current = sel.value;
    var byId = Object.create(null);
    var opts = sel.querySelectorAll('option');
    var offOpt = null;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].value === 'off') offOpt = opts[i];
      else byId[opts[i].value] = opts[i];
    }
    // detach everything except the "off" placeholder
    for (var j = 0; j < opts.length; j++) {
      if (opts[j] !== offOpt) sel.removeChild(opts[j]);
    }
    var seen = Object.create(null);
    order.forEach(function (id) {
      if (seen[id] || !byId[id]) return;
      seen[id] = 1;
      sel.appendChild(byId[id]);
    });
    Object.keys(byId).forEach(function (id) {
      if (!seen[id]) sel.appendChild(byId[id]);
    });
    sel.value = (current && (current === 'off' || byId[current])) ? current : (offOpt ? 'off' : sel.value);
    return true;
  }

  function orderFor(personaId) {
    var rules = state.rules;
    if (!rules || !personaId || !rules.personaToVariants || !rules.personaToVariants[personaId]) return null;
    var wanted = rules.personaToVariants[personaId];
    var all = state.variantIds || wanted;
    var rest = all.filter(function (id) { return wanted.indexOf(id) === -1; });
    return wanted.filter(function (id) { return all.indexOf(id) !== -1; }).concat(rest);
  }

  function applyTransitionPins(ids) {
    var sel = document.getElementById('swr-tx-pick');
    if (!sel) return false;
    var wanted = Object.create(null);
    (ids || []).forEach(function (id) { wanted[id] = 1; });
    var opts = sel.querySelectorAll('option');
    for (var i = 0; i < opts.length; i++) {
      if (wanted[opts[i].value]) opts[i].setAttribute('data-swr-pin', '1');
      else opts[i].removeAttribute('data-swr-pin');
    }
    return true;
  }

  function mountBanner(el) {
    var host = document.getElementById('swr-targeting-banner');
    if (!host) return false;
    if (!el) { host.hidden = true; host.innerHTML = ''; return true; }
    host.innerHTML = '';
    var text = document.createElement('span');
    text.className = 'swr-targeting-banner__text';
    text.textContent = el.copy;
    host.appendChild(text);
    if (el.cta) {
      var a = document.createElement('a');
      a.className = 'swr-targeting-banner__cta';
      a.href = el.cta.href || '/auth/login.html';
      a.textContent = el.cta.label || 'Save this? Magic link.';
      host.appendChild(a);
    }
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'swr-targeting-banner__close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', function () { dismissBanner(el.surface); });
    host.appendChild(close);
    host.hidden = false;
    return true;
  }

  function showBanner(opts) {
    opts = opts || {};
    var surface = opts.surface || surfaceForPath(pathname());
    var cta = opts.cta || null;
    // FR-10 hard guard: a non-magic-link auth hint invalidates the whole
    // banner. Refusing loudly (returning a reason) means the mistake surfaces
    // in tests instead of shipping an OAuth CTA.
    if (cta && !ALLOWED_AUTH_HINTS[cta.kind]) {
      return { shown: false, reason: 'cta-not-allowed' };
    }
    var dis = state.dismissed[surface];
    if (dis && (now() - dis) < DISMISS_DAYS * 86400000) {
      return { shown: false, reason: 'dismissed' };
    }
    var copy = opts.copy || NEUTRAL_COPY;
    if (!voiceLint(copy).ok) copy = NEUTRAL_COPY;
    var mounted = safe(function () { return mountBanner({ surface: surface, copy: copy, cta: cta }); }, false);
    if (!mounted) return { shown: false, reason: 'no-host' };
    return { shown: true, copy: copy, cta: cta };
  }

  function dismissBanner(surface) {
    surface = surface || surfaceForPath(pathname());
    state.dismissed[surface] = now();
    persistDismissal(surface, state.dismissed[surface]);
    safe(function () { mountBanner(null); }, false);
    return true;
  }

  // ── voice lint (PRD §7.6 — targeting-originated copy only) ────────────────

  function voiceLint(text) {
    var banned = (state.rules && state.rules.banned) || [];
    if (!text) return { ok: true, hits: [] };
    var lower = String(text).toLowerCase();
    var hits = banned.filter(function (b) { return lower.indexOf(b) !== -1; });
    return { ok: hits.length === 0, hits: hits };
  }

  // ── orchestration ─────────────────────────────────────────────────────────

  function reclassify() {
    state.result = safe(function () { return classifyWith(state.signals, state.rules, state.corrections); }, null)
      || { personaId: null, segmentId: null, personaScore: 0, segmentScore: 0, alternatives: [] };
    var order = orderFor(state.result.personaId);
    if (order && state.variantSelect) applyVariantOrder(state.variantSelect, order);
    if (state.rules && state.result.personaId) {
      var pins = state.rules.personaToTransitions && state.rules.personaToTransitions[state.result.personaId];
      if (pins) applyTransitionPins(pins);
    }
    return state.result;
  }

  function maybeOfferBanner() {
    var r = state.result;
    if (!r || !r.personaId) return null;
    var note = state.rules.personaToNote && state.rules.personaToNote[r.personaId];
    if (!note) return null;
    var surface = 'persona:' + r.personaId;
    if (state.dismissed[surface]) return null;
    return showBanner({ surface: surface, copy: note, cta: { kind: 'magic-link', href: '/auth/login.html', label: 'Save this? Magic link.' } });
  }

  function record(sig) {
    if (!sig || !sig.kind) return false;
    var s = {
      id: (now().toString(36) + Math.random().toString(36).slice(2, 8)),
      kind: sig.kind,
      payload: sig.payload || null,
      surface: (sig.payload && sig.payload.surface) || surfaceForPath(pathname()),
      page: pathname(),
      ts: now(),
    };
    state.signals.push(s);
    if (state.signals.length > MAX_SIGNALS) state.signals = state.signals.slice(-MAX_SIGNALS);
    if (state.ready) {
      reclassify();
      maybeOfferBanner();
    }
    if (state.flushTimer) clearTimeout(state.flushTimer);
    state.flushTimer = setTimeout(function () { safe(persistSignals, null); }, 500);
    return true;
  }

  function notMe() {
    var r = state.result;
    if (!r || !r.personaId) return false;
    state.corrections[r.personaId] = { personaId: r.personaId, weight: 1, ts: now() };
    persistCorrection(state.corrections[r.personaId]);
    reclassify();
    return true;
  }

  function maybeReorderVariants(sel, ids) {
    state.variantSelect = sel || state.variantSelect;
    state.variantIds = ids || state.variantIds;
    if (!state.variantSelect) return false;
    if (!state.rules) return false; // not ready yet — init() re-applies
    return safe(function () {
      var order = orderFor(state.result && state.result.personaId);
      return order ? applyVariantOrder(state.variantSelect, order) : false;
    }, false);
  }

  function init() {
    var path = pathname();
    record({ kind: 'session_start', payload: { surface: surfaceForPath(path) } });

    // Cross-page/back-forward visit tracking.
    safe(function () {
      window.addEventListener('popstate', function () { record({ kind: 'visit', payload: { surface: surfaceForPath(pathname()), path: pathname() } }); });
      window.addEventListener('pagehide', function () { safe(persistSignals, null); });
      record({ kind: 'visit', payload: { surface: surfaceForPath(path), path: path } });
    }, null);

    return Promise.all([db(), loadRules()]).then(function (pair) {
      var d = pair[0], rules = pair[1];
      if (rules) {
        state.rules = rules;
        if (!state.rules.banned) state.rules.banned = [];
      }
      return d ? Promise.all([all(d, 'signals'), all(d, 'corrections'), all(d, 'dismissed')]) : [[], [], []];
    }).then(function (res) {
      if (res[0] && res[0].length) {
        var ids = Object.create(null);
        state.signals.forEach(function (s) { ids[s.id] = 1; });
        res[0].forEach(function (s) { if (s && s.id && !ids[s.id]) state.signals.push(s); });
        state.signals.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
        if (state.signals.length > MAX_SIGNALS) state.signals = state.signals.slice(-MAX_SIGNALS);
      }
      (res[1] || []).forEach(function (c) { if (c && c.personaId) state.corrections[c.personaId] = c; });
      (res[2] || []).forEach(function (x) { if (x && x.surface) state.dismissed[x.surface] = x.ts || 0; });

      state.ready = true;
      reclassify();
      maybeOfferBanner();
      if (state.timer) clearInterval(state.timer);
      state.timer = setInterval(function () { safe(reclassify, null); }, RECLASSIFY_MS);
    }).catch(function () { state.ready = true; });
  }

  window.SWR_TARGETING = {
    version: VERSION,
    signals: {
      record: function (s) { return safe(function () { return record(s); }, false); },
      list: function () { return state.signals.slice(); },
      flush: function () { return safe(function () { persistSignals(); return true; }, false); },
    },
    classify: function () { return reclassify(); },
    persona: function () { return state.result && state.result.personaId; },
    segment: function () { return state.result && state.result.segmentId; },
    maybeReorderVariants: maybeReorderVariants,
    applyVariantOrder: applyVariantOrder,
    applyTransitionPins: applyTransitionPins,
    showBanner: function (o) { return safe(function () { return showBanner(o); }, { shown: false, reason: 'error' }); },
    dismissBanner: function (s) { return safe(function () { return dismissBanner(s); }, false); },
    notMe: function () { return safe(notMe, false); },
    voice: { lint: function (t) { return safe(function () { return voiceLint(t); }, { ok: true, hits: [] }); } },
    ready: function () { return state.ready; },
    _debug: {
      CLASSIFY: classifyWith,
      recordRaw: record,
      ALLOWED_AUTH_HINTS: ALLOWED_AUTH_HINTS,
      decodeFactor: decayFactor,
      setRules: function (r) { state.rules = r; },
      setSignals: function (s) { state.signals = s || []; },
      setCorrections: function (c) { state.corrections = c || {}; },
      state: state,
    },
  };

  safe(init, null);
})();
