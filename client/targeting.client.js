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
// INTERNAL MODULES — one file, one global (the repo's client-module shape),
// six seams with explicit boundaries:
//   Store     IndexedDB; incremental signal writes (see persistSignals).
//   Rules     inline <script id="swrc-targeting-rules"> → fetch fallback.
//   Classify  pure classifier (no DOM, no IDB, no state): tally → score → rank.
//   Voice     banned-phrase lint for targeting-originated copy.
//   UI        DOM adapters; every apply is idempotent (see applyVariantOrder).
//   Runtime   state, orchestration and the public surface.
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

  // ── constants ─────────────────────────────────────────────────────────────

  var VERSION = 'swr-targeting/v1';
  var DB_NAME = 'swr-targeting';
  var DB_VERSION = 1;
  // store name → its keyPath
  var STORES = { signals: 'id', corrections: 'personaId', dismissed: 'surface' };
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

  // The one place the runtime, orchestration and UI agree on what a session
  // shaped like "no persona" looks like.
  function untargeted(alternatives) {
    return {
      personaId: null,
      segmentId: null,
      personaScore: 0,
      segmentScore: 0,
      alternatives: alternatives || [],
    };
  }

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

  // ── helpers ───────────────────────────────────────────────────────────────

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

  // FR-8/9: a dismissal suppresses its surface for DISMISS_DAYS. Both dismissal
  // consumers (the persona banner and an explicit showBanner call) go through
  // this one predicate so the window is enforced identically.
  function isDismissed(surface) {
    var ts = state.dismissed[surface];
    return !!(ts && (now() - ts) < DISMISS_DAYS * 86400000);
  }

  function banned() { return (state.rules && state.rules.banned) || []; }

  // ── Store — IndexedDB, best effort ────────────────────────────────────────
  // A blocked or quota-limited IDB degrades to in-memory only; it must never
  // break the engine (NFR-10). Every method resolves, none rejects.

  var Store = (function () {
    var _dbPromise = null;
    var _persisted = Object.create(null);   // signals.id → 1, the rows already in IDB

    function open() {
      return new Promise(function (resolve) {
        var idb = window.indexedDB;
        if (!idb) return resolve(null);
        var req;
        try { req = idb.open(DB_NAME, DB_VERSION); } catch (_) { return resolve(null); }
        req.onupgradeneeded = function () {
          var db = req.result;
          Object.keys(STORES).forEach(function (name) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: STORES[name] });
          });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      });
    }

    function db() {
      if (!_dbPromise) _dbPromise = open();
      return _dbPromise;
    }

    // Run fn(objectStore) inside one transaction. Resolves with fn's return
    // value once the transaction completes, or null on any failure.
    function withStore(store, mode, fn) {
      return db().then(function (d) {
        if (!d) return null;
        var t;
        try { t = d.transaction(store, mode); } catch (_) { return null; }
        var out = null;
        try { out = fn(t.objectStore(store)); } catch (_) { return null; }
        return new Promise(function (resolve) {
          t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
          t.onerror = function () { resolve(null); };
          t.onabort = function () { resolve(null); };
        });
      });
    }

    function load() {
      // withStore resolves the request's .result once the transaction commits,
      // so a getAll() is the whole read.
      return Promise.all([
        withStore('signals', 'readonly', function (os) { return os.getAll(); }),
        withStore('corrections', 'readonly', function (os) { return os.getAll(); }),
        withStore('dismissed', 'readonly', function (os) { return os.getAll(); }),
      ]).then(function (res) {
        // The rows we just read are already in IDB — seed the incremental
        // tracker so the first flush only writes what this session added.
        _persisted = Object.create(null);
        var sigs = res[0] || [];
        for (var i = 0; i < sigs.length; i++) {
          if (sigs[i] && sigs[i].id) _persisted[sigs[i].id] = 1;
        }
        return {
          signals: sigs,
          corrections: res[1] || [],
          dismissed: res[2] || [],
        };
      });
    }

    // Incremental: put the rows the window gained, delete the ones it trimmed.
    // (The previous implementation cleared the store and re-put all ≤200 rows
    // on every flush — O(window) per flush, O(window²) per session.)
    function persistSignals(signals) {
      var list = signals || [];
      var next = Object.create(null);
      var added = [];
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s || !s.id) continue;
        next[s.id] = 1;
        if (!_persisted[s.id]) added.push(s);
      }
      var removed = [];
      for (var id in _persisted) {
        if (!next[id]) removed.push(id);
      }
      if (!added.length && !removed.length) return Promise.resolve(true);
      return db().then(function (d) {
        if (!d) return false;
        var t;
        try { t = d.transaction('signals', 'readwrite'); } catch (_) { return false; }
        try {
          var os = t.objectStore('signals');
          for (var k = 0; k < added.length; k++) os.put(added[k]);
          for (var m = 0; m < removed.length; m++) os.delete(removed[m]);
        } catch (_) { return false; }
        return new Promise(function (resolve) {
          // Mark rows persisted only once the transaction commits, so a
          // quota/abort failure is retried by the next flush.
          t.oncomplete = function () { _persisted = next; resolve(true); };
          t.onerror = function () { resolve(false); };
          t.onabort = function () { resolve(false); };
        });
      });
    }

    function persistCorrection(c) {
      return withStore('corrections', 'readwrite', function (os) { os.put(c); });
    }

    function persistDismissal(surface, ts) {
      return withStore('dismissed', 'readwrite', function (os) { return os.put({ surface: surface, ts: ts }); });
    }

    return {
      load: load,
      persistSignals: persistSignals,
      persistCorrection: persistCorrection,
      persistDismissal: persistDismissal,
    };
  })();

  // ── Rules — the persona/segment tables ────────────────────────────────────

  var Rules = (function () {
    function inline() {
      var el = document.getElementById('swrc-targeting-rules');
      if (!el) return null;
      try { return JSON.parse(el.textContent); } catch (_) { return null; }
    }

    function fetchRemote() {
      if (typeof fetch !== 'function') return Promise.resolve(null);
      return fetch(RULES_URL)
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }

    function load() {
      var memo = safe(inline, null);
      if (memo) return Promise.resolve(memo);
      return fetchRemote();
    }

    return { load: load };
  })();

  // ── Classify — pure: signals + rules + corrections → result ───────────────
  // No DOM, no IDB, no state. The whole scoring model lives here.

  var Classify = (function () {
    // The persona id list comes from the rules table, which is immutable once
    // loaded — cache by identity instead of rebuilding it per classification.
    var _memoRules = null;
    var _memoIds = null;

    function personaIds(rules) {
      if (rules !== _memoRules) {
        _memoRules = rules;
        _memoIds = Object.keys(rules.personaToSegment || {});
      }
      return _memoIds;
    }

    function ruleFires(rule, counts) {
      try { return !!rule.when(counts); } catch (_) { return false; }
    }

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

    function scores(counts, rules, corrections) {
      var out = Object.create(null);
      var ids = personaIds(rules);
      var surfaces = rules.personaSurfaces || {};
      for (var i = 0; i < ids.length; i++) {
        var ps = surfaces[ids[i]] || [];
        var s = 0;
        for (var j = 0; j < ps.length; j++) s += (counts.surface[ps[j]] || 0);
        out[ids[i]] = s;
      }
      for (var r = 0; r < SIGNATURE_RULES.length; r++) {
        var rule = SIGNATURE_RULES[r];
        if (out[rule.persona] === undefined) continue;
        if (ruleFires(rule, counts)) out[rule.persona] += rule.score;
      }
      // FR-11/12/13: a "Not me" correction lowers that persona's score, and the
      // penalty decays with a 14-day half-life so it never becomes permanent.
      var corrected = Object.keys(corrections);
      for (var k = 0; k < corrected.length; k++) {
        var pid = corrected[k];
        if (out[pid] === undefined) continue;
        var c = corrections[pid];
        out[pid] -= (c.weight || 1) * decayFactor(c.ts || 0) * 3;
      }
      return out;
    }

    function rankTop(scoresById, ranked) {
      var out = [];
      var n = Math.min(3, ranked.length);
      for (var i = 0; i < n; i++) out.push({ id: ranked[i], score: scoresById[ranked[i]] });
      return out;
    }

    function run(signals, rules, corrections) {
      if (!rules || !rules.personaToSegment) return untargeted();
      var counts = tally(signals);
      var byId = scores(counts, rules, corrections);
      var ranked = Object.keys(byId).sort(function (a, b) {
        return byId[b] - byId[a] || (a < b ? -1 : a > b ? 1 : 0);
      });
      var top = ranked[0];
      if (!top || byId[top] < MIN_SCORE) return untargeted(rankTop(byId, ranked));
      var segmentId = rules.personaToSegment[top] || null;
      return {
        personaId: top,
        segmentId: segmentId,
        personaScore: byId[top],
        segmentScore: segmentId ? counts.surface[segmentId] || 0 : 0,
        alternatives: rankTop(byId, ranked),
      };
    }

    return { tally: tally, scores: scores, run: run };
  })();

  // ── Voice — PRD §7.6 lint, targeting-originated copy only ─────────────────

  function voiceLint(text, bannedList) {
    if (!text) return { ok: true, hits: [] };
    var lower = String(text).toLowerCase();
    var hits = (bannedList || []).filter(function (b) { return lower.indexOf(b) !== -1; });
    return { ok: hits.length === 0, hits: hits };
  }

  // ── UI — DOM adapters ─────────────────────────────────────────────────────
  // Each apply reads the current DOM first and writes only when it differs, so
  // callers can re-assert the same target state as often as they like (per
  // signal, per 30 s tick) without touching the document.

  var UI = (function () {
    var mountedKey = null;      // identity of the banner payload on screen
    var onDismiss = null;

    function options(sel) {
      return sel ? sel.querySelectorAll('option') : [];
    }

    function currentOrder(sel) {
      var opts = options(sel);
      var out = [];
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value !== 'off') out.push(opts[i].value);
      }
      return out;
    }

    // The sequence applyVariantOrder would leave behind: the requested order
    // (deduped, restricted to ids present), then every other present id in its
    // current relative position. "off" is never moved.
    function desiredOrder(present, order) {
      var has = Object.create(null);
      for (var i = 0; i < present.length; i++) has[present[i]] = 1;
      var seen = Object.create(null);
      var out = [];
      for (var j = 0; j < order.length; j++) {
        var id = order[j];
        if (seen[id] || !has[id]) continue;
        seen[id] = 1;
        out.push(id);
      }
      for (var k = 0; k < present.length; k++) {
        if (!seen[present[k]]) {
          seen[present[k]] = 1;
          out.push(present[k]);
        }
      }
      return out;
    }

    // Reorder the variant select (persona preference first, "off" preserved).
    // Returns true when the DOM changed, false when it already matched.
    function applyVariantOrder(sel, order) {
      if (!sel || !order || !order.length) return false;
      var current = sel.value;
      var opts = options(sel);
      var byId = Object.create(null);
      var offOpt = null;
      var present = [];
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === 'off') offOpt = opts[i];
        else {
          byId[opts[i].value] = opts[i];
          present.push(opts[i].value);
        }
      }
      var desired = desiredOrder(present, order);
      if (present.join('\u0000') === desired.join('\u0000')) return false;
      // Detach everything except the "off" placeholder, then re-append in the
      // desired order (leftovers keep their relative position via byId).
      for (var j = 0; j < opts.length; j++) {
        if (opts[j] !== offOpt) sel.removeChild(opts[j]);
      }
      for (var k = 0; k < desired.length; k++) sel.appendChild(byId[desired[k]]);
      sel.value = (current && (current === 'off' || byId[current])) ? current : (offOpt ? 'off' : sel.value);
      return true;
    }

    // Mark the persona's transitions with data-swr-pin="1". Scan first, write
    // only on a real difference — same idempotence as applyVariantOrder.
    function applyTransitionPins(ids) {
      var sel = document.getElementById('swr-tx-pick');
      if (!sel) return false;
      var wanted = Object.create(null);
      var list = ids || [];
      for (var i = 0; i < list.length; i++) wanted[list[i]] = 1;
      var opts = options(sel);
      var changed = false;
      for (var j = 0; j < opts.length; j++) {
        var shouldPin = !!wanted[opts[j].value];
        var isPinned = opts[j].getAttribute('data-swr-pin') === '1';
        if (shouldPin !== isPinned) changed = true;
      }
      if (!changed) return false;
      for (var k = 0; k < opts.length; k++) {
        if (wanted[opts[k].value]) opts[k].setAttribute('data-swr-pin', '1');
        else opts[k].removeAttribute('data-swr-pin');
      }
      return true;
    }

    function bannerKey(payload) {
      var cta = payload.cta;
      return payload.surface + '\u0000' + payload.copy + '\u0000'
        + (cta ? (cta.href || '') + '\u0000' + (cta.label || '') : '');
    }

    // Mount `payload`, or clear the host when payload is null. Re-rendering an
    // already-visible identical payload is a no-op (the previous code rebuilt
    // the three nodes + the close listener on every reclassify).
    function mountBanner(payload) {
      var host = document.getElementById('swr-targeting-banner');
      if (!host) return false;
      if (!payload) {
        if (mountedKey !== null || !host.hidden) { host.innerHTML = ''; host.hidden = true; }
        mountedKey = null;
        return true;
      }
      var key = bannerKey(payload);
      if (key === mountedKey && !host.hidden && host.children && host.children.length) return true;
      host.innerHTML = '';
      var text = document.createElement('span');
      text.className = 'swr-targeting-banner__text';
      text.textContent = payload.copy;
      host.appendChild(text);
      if (payload.cta) {
        var a = document.createElement('a');
        a.className = 'swr-targeting-banner__cta';
        a.href = payload.cta.href || '/auth/login.html';
        a.textContent = payload.cta.label || 'Save this? Magic link.';
        host.appendChild(a);
      }
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'swr-targeting-banner__close';
      close.setAttribute('aria-label', 'Dismiss');
      close.textContent = '×';
      close.addEventListener('click', function () {
        if (onDismiss) safe(function () { onDismiss(payload.surface); }, null);
      });
      host.appendChild(close);
      host.hidden = false;
      mountedKey = key;
      return true;
    }

    function setDismissHandler(fn) { onDismiss = fn; }

    return {
      applyVariantOrder: applyVariantOrder,
      applyTransitionPins: applyTransitionPins,
      mountBanner: mountBanner,
      setDismissHandler: setDismissHandler,
    };
  })();

  // ── Runtime — state, orchestration, public surface ────────────────────────

  function orderFor(personaId) {
    var rules = state.rules;
    if (!rules || !personaId || !rules.personaToVariants || !rules.personaToVariants[personaId]) return null;
    var wanted = rules.personaToVariants[personaId];
    var all = state.variantIds || wanted;
    var rest = all.filter(function (id) { return wanted.indexOf(id) === -1; });
    return wanted.filter(function (id) { return all.indexOf(id) !== -1; }).concat(rest);
  }

  // Classify the session and assert the persona's UI state. Safe to call at any
  // time: the UI applies are idempotent, so repeating a call is free.
  function reclassify() {
    var result = safe(function () {
      return Classify.run(state.signals, state.rules, state.corrections);
    }, null) || untargeted();
    state.result = result;
    var order = orderFor(result.personaId);
    if (order && state.variantSelect) UI.applyVariantOrder(state.variantSelect, order);
    if (result.personaId && state.rules) {
      var pins = state.rules.personaToTransitions && state.rules.personaToTransitions[result.personaId];
      if (pins) UI.applyTransitionPins(pins);
    }
    return result;
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
    if (isDismissed(surface)) return { shown: false, reason: 'dismissed' };
    var copy = opts.copy || NEUTRAL_COPY;
    if (!voiceLint(copy, banned()).ok) copy = NEUTRAL_COPY;
    var mounted = safe(function () { return UI.mountBanner({ surface: surface, copy: copy, cta: cta }); }, false);
    if (!mounted) return { shown: false, reason: 'no-host' };
    return { shown: true, copy: copy, cta: cta };
  }

  function dismissBanner(surface) {
    surface = surface || surfaceForPath(pathname());
    state.dismissed[surface] = now();
    Store.persistDismissal(surface, state.dismissed[surface]);
    safe(function () { UI.mountBanner(null); }, false);
    return true;
  }

  function maybeOfferBanner() {
    var r = state.result;
    if (!r || !r.personaId || !state.rules) return null;
    var note = state.rules.personaToNote && state.rules.personaToNote[r.personaId];
    if (!note) return null;
    // FR-8/9: the persona's copy, dismissible; showBanner() owns the dismissal
    // window and the mount itself.
    return showBanner({
      surface: 'persona:' + r.personaId,
      copy: note,
      cta: { kind: 'magic-link', href: '/auth/login.html', label: 'Save this? Magic link.' },
    });
  }

  function record(sig) {
    if (!sig || !sig.kind) return false;
    var ts = now();
    var s = {
      id: ts.toString(36) + Math.random().toString(36).slice(2, 8),
      kind: sig.kind,
      payload: sig.payload || null,
      surface: (sig.payload && sig.payload.surface) || surfaceForPath(pathname()),
      page: pathname(),
      ts: ts,
    };
    state.signals.push(s);
    if (state.signals.length > MAX_SIGNALS) state.signals = state.signals.slice(-MAX_SIGNALS);
    if (state.ready) {
      reclassify();
      maybeOfferBanner();
    }
    if (state.flushTimer) clearTimeout(state.flushTimer);
    state.flushTimer = setTimeout(function () {
      safe(function () { Store.persistSignals(state.signals); }, null);
    }, 500);
    return true;
  }

  function notMe() {
    var r = state.result;
    if (!r || !r.personaId) return false;
    var c = { personaId: r.personaId, weight: 1, ts: now() };
    state.corrections[r.personaId] = c;
    Store.persistCorrection(c);
    reclassify();
    return true;
  }

  function maybeReorderVariants(sel, ids) {
    state.variantSelect = sel || state.variantSelect;
    state.variantIds = ids || state.variantIds;
    if (!state.variantSelect) return false;
    if (!state.rules) return false;      // not ready yet — init() re-applies
    var order = orderFor(state.result && state.result.personaId);
    if (!order) return false;
    return safe(function () { return UI.applyVariantOrder(state.variantSelect, order); }, false);
  }

  // Fold what IDB had into the in-memory window. The live session wins: an id
  // that is already in memory is not re-added.
  function merge(loaded) {
    var sigs = loaded.signals || [];
    if (sigs.length) {
      var ids = Object.create(null);
      state.signals.forEach(function (s) { ids[s.id] = 1; });
      sigs.forEach(function (s) { if (s && s.id && !ids[s.id]) state.signals.push(s); });
      state.signals.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      if (state.signals.length > MAX_SIGNALS) state.signals = state.signals.slice(-MAX_SIGNALS);
    }
    (loaded.corrections || []).forEach(function (c) {
      if (c && c.personaId) state.corrections[c.personaId] = c;
    });
    (loaded.dismissed || []).forEach(function (x) {
      if (x && x.surface) state.dismissed[x.surface] = x.ts || 0;
    });
  }

  function start() {
    var path = pathname();
    record({ kind: 'session_start', payload: { surface: surfaceForPath(path) } });

    // Cross-page/back-forward visit tracking.
    safe(function () {
      window.addEventListener('popstate', function () {
        record({ kind: 'visit', payload: { surface: surfaceForPath(pathname()), path: pathname() } });
      });
      window.addEventListener('pagehide', function () {
        safe(function () { Store.persistSignals(state.signals); }, null);
      });
      record({ kind: 'visit', payload: { surface: surfaceForPath(path), path: path } });
    }, null);

    return Promise.all([Store.load(), Rules.load()]).then(function (pair) {
      var loaded = pair[0] || { signals: [], corrections: [], dismissed: [] };
      var rules = pair[1];
      if (rules) {
        state.rules = rules;
        if (!state.rules.banned) state.rules.banned = [];
      }
      merge(loaded);
      state.ready = true;
      reclassify();
      maybeOfferBanner();
      if (state.timer) clearInterval(state.timer);
      state.timer = setInterval(function () { safe(reclassify, null); }, RECLASSIFY_MS);
    }).catch(function () { state.ready = true; });
  }

  // ── public surface ────────────────────────────────────────────────────────

  UI.setDismissHandler(dismissBanner);

  window.SWR_TARGETING = {
    version: VERSION,
    signals: {
      record: function (s) { return safe(function () { return record(s); }, false); },
      list: function () { return state.signals.slice(); },
      flush: function () { return safe(function () { Store.persistSignals(state.signals); return true; }, false); },
    },
    classify: function () { return reclassify(); },
    persona: function () { return state.result && state.result.personaId; },
    segment: function () { return state.result && state.result.segmentId; },
    maybeReorderVariants: maybeReorderVariants,
    applyVariantOrder: UI.applyVariantOrder,
    applyTransitionPins: UI.applyTransitionPins,
    showBanner: function (o) { return safe(function () { return showBanner(o); }, { shown: false, reason: 'error' }); },
    dismissBanner: function (s) { return safe(function () { return dismissBanner(s); }, false); },
    notMe: function () { return safe(notMe, false); },
    voice: { lint: function (t) { return safe(function () { return voiceLint(t, banned()); }, { ok: true, hits: [] }); } },
    ready: function () { return state.ready; },
    _debug: {
      CLASSIFY: Classify.run,
      recordRaw: record,
      ALLOWED_AUTH_HINTS: ALLOWED_AUTH_HINTS,
      decodeFactor: decayFactor,
      setRules: function (r) { state.rules = r; },
      setSignals: function (s) { state.signals = s || []; },
      setCorrections: function (c) { state.corrections = c || {}; },
      state: state,
    },
  };

  safe(start, null);
})();
