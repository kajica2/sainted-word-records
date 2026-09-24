// lib/tier-runtime.js — device capability tier + adaptive work budget.
//
// Loaded SYNCHRONOUSLY as the first script in <head> on engine.html and the
// versions/*.html pages that consume it. It must be inline-able but is NOT:
// a plain <script src> in <head> (no defer, no type=module) blocks parsing
// and runs before any page code, which is the same guarantee without 23
// copies of the same 40 lines drifting apart.
//
// Why a tier at all: the same composition costs wildly different amounts on
// a 2015 Intel laptop and an M4 Pro. The tier is a first-frame GUESS; the
// adaptive guard (lib/adaptive-guard.js) is the correction. The tier only
// picks a starting budget, and nothing here is persisted — a "last good
// tier" cache would mask thermal throttling and weaker contexts (battery,
// other tabs) on the next visit.
//
// No GPU-string regex: `/rtx\s*(40|50)|apple\s*m[3-9]\s*(pro|max)/` goes
// stale every release and the signals below (cores, memory, save-data,
// reduced-motion) predict the budget well enough for a guess that gets
// corrected within a second anyway.
//
// Public surface (window.__TIER__ and window.SWR_TIER):
//   __TIER__   = { tier, profile, signals, reason }
//   SWR_TIER.current()            → 'low' | 'medium' | 'high'
//   SWR_TIER.profile()            → the active profile object
//   SWR_TIER.step(reason)         → step the budget down one notch (used by
//                                   the adaptive guard); fires 'swr-tier-down'
//   SWR_TIER.set(tier, reason)    → hard set (tests, URL override)
//   SWR_TIER.on(fn)               → subscribe to changes
//
// URL overrides for tests/QA: ?tier=low|medium|high (wins over detection).

(function () {
  'use strict';
  if (window.SWR_TIER) return;

  // Budget table. `renderScale`/`maxDPR` are read by pages that size their
  // backing store; `fftSize` by lib/audio.client.js before it builds the
  // AnalyserNode; `cssFilters` gates the filmic grade in
  // lib/swr-natural.client.js; `feedbackRes` its echo buffer; `overlay`
  // gates loading fx-postprocess.js at all; `maxClips` is the layer
  // scheduler's concurrency budget; `minCutMs` floors the cut cadence.
  var PROFILES = {
    low: {
      renderScale: 0.6, maxDPR: 1,
      cssFilters: false, feedbackRes: 0.25, overlay: false,
      fftSize: 512, analyserSmoothing: 0.75,
      maxClips: 2, minCutMs: 2000, targetFPS: 30,
    },
    medium: {
      renderScale: 0.8, maxDPR: 1,
      cssFilters: true, feedbackRes: 0.5, overlay: true,
      fftSize: 1024, analyserSmoothing: 0.7,
      maxClips: 3, minCutMs: 1500, targetFPS: 45,
    },
    high: {
      renderScale: 1, maxDPR: 1.5,
      cssFilters: true, feedbackRes: 0.5, overlay: true,
      fftSize: 2048, analyserSmoothing: 0.65,
      maxClips: 4, minCutMs: 1200, targetFPS: 60,
    },
  };
  var ORDER = ['low', 'medium', 'high'];

  function detect() {
    var cores = (navigator && navigator.hardwareConcurrency) || 4;
    var mem = (navigator && navigator.deviceMemory) || 4;
    var saveData = !!(navigator && navigator.connection && navigator.connection.saveData);
    var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var sig = { cores: cores, memory: mem, saveData: saveData, reducedMotion: reduced };

    var score = 2; // medium baseline: unknown devices get corrected by the guard
    if (cores >= 8) score += 2; else if (cores >= 5) score += 1; else if (cores <= 3) score -= 1;
    if (mem >= 8) score += 1; else if (mem <= 2) score -= 1;
    if (saveData) score -= 2;
    if (reduced) score -= 2;

    var tier = score <= 2 ? 'low' : score <= 3 ? 'medium' : 'high';
    var reason = 'detected (cores=' + cores + ' mem=' + mem +
      (saveData ? ' saveData' : '') + (reduced ? ' reducedMotion' : '') + ')';
    return { tier: tier, signals: sig, reason: reason };
  }

  function urlTier() {
    try {
      var t = new URLSearchParams(window.location.search).get('tier');
      if (t && ORDER.indexOf(t) !== -1) return t;
    } catch (_) {}
    return null;
  }

  var d = detect();
  var forced = urlTier();
  var state = {
    tier: forced || d.tier,
    reason: forced ? 'url override' : d.reason,
    signals: d.signals,
  };
  var listeners = [];

  function emit(kind) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i]({ tier: state.tier, profile: PROFILES[state.tier], reason: state.reason, kind: kind }); } catch (_) {}
    }
    try {
      document.dispatchEvent(new CustomEvent('swr-tier-' + kind, {
        detail: { tier: state.tier, profile: PROFILES[state.tier], reason: state.reason },
      }));
    } catch (_) {}
  }

  function apply() {
    try { document.documentElement.dataset.tier = state.tier; } catch (_) {}
    window.__TIER__ = {
      tier: state.tier, profile: PROFILES[state.tier],
      signals: state.signals, reason: state.reason,
    };
  }
  apply();

  window.SWR_TIER = {
    PROFILES: PROFILES,
    current: function () { return state.tier; },
    profile: function () { return PROFILES[state.tier]; },
    signals: function () { return state.signals; },
    reason: function () { return state.reason; },
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    // One notch down. Floor at 'low'. Called by the adaptive guard when the
    // frame budget is blown and internal degradation is exhausted.
    step: function (reason) {
      var i = ORDER.indexOf(state.tier);
      if (i <= 0) return false;
      state.tier = ORDER[i - 1];
      state.reason = reason || 'step-down';
      apply();
      emit('down');
      return true;
    },
    set: function (tier, reason) {
      if (ORDER.indexOf(tier) === -1) return false;
      state.tier = tier;
      state.reason = reason || 'set';
      apply();
      emit('change');
      return true;
    },
  };
})();
