// client/automix-composition.client.js — L3 composition coupling
//
// The arc (client/automix-arc.client.js) owns the macro FX direction.
// This layer extends the act into the MEDIA composition: each act carries
// a cutting profile — how often the layer scheduler swaps clips — so the
// arrangement of clips on screen changes with the song, not just the
// colour grade. Peak acts cut fast (2.5–5s), breakdowns hold one mood
// (12–20s), intros establish slowly.
//
// Listens for the runtime's swr-automix-tick events (which carry
// mixed.arc when the arc is engaged) and re-configures the layer
// scheduler on act changes. Defensive throughout: no scheduler, no arc,
// or no act info → no-op, and the page's manual scheduler settings win
// whenever the user touches the panel (act changes re-apply on the next
// act boundary, not on every knob move).
//
// Act → cutting profile (seconds between clip swaps):
//   intro      9–14   establishing, slow
//   lift       6–10   building
//   peak       2.5–5  fast cutting
//   breakdown  12–20  one long mood
//   outro      8–14   settling
// Unknown act names fall back to 6–10.

(function () {
  'use strict';

  if (window.SWR_AUTOMIX_COMPOSITION) return;
  window.SWR_AUTOMIX_COMPOSITION = true;

  var PROFILES = {
    intro:     { minSeconds: 9,    maxSeconds: 14 },
    lift:      { minSeconds: 6,    maxSeconds: 10 },
    peak:      { minSeconds: 2.5,  maxSeconds: 5 },
    breakdown: { minSeconds: 12,   maxSeconds: 20 },
    outro:     { minSeconds: 8,    maxSeconds: 14 },
  };
  var DEFAULT_PROFILE = { minSeconds: 6, maxSeconds: 10 };

  var lastActIndex = null;
  var lastApplied = null;

  function apply(actName, reason) {
    var sched = window.SWR_LAYER_SCHEDULER;
    if (!sched || typeof sched.setConfig !== 'function') return false;
    var profile = PROFILES[actName] || DEFAULT_PROFILE;
    // Never fight the user mid-edit: if the panel's values already match
    // what we applied, still push (cheap) — but skip redundant DOM churn.
    var same = lastApplied &&
      lastApplied.minSeconds === profile.minSeconds &&
      lastApplied.maxSeconds === profile.maxSeconds;
    if (same) return true;
    sched.setConfig({
      enabled: true,
      minSeconds: profile.minSeconds,
      maxSeconds: profile.maxSeconds,
      beatSync: true, // fades land on the beat — visibly tighter cuts
    });
    lastApplied = profile;
    try {
      document.dispatchEvent(new CustomEvent('swr-composition-change', {
        detail: { act: actName, profile: profile, reason: reason || 'act-change' },
      }));
    } catch (_) {}
    return true;
  }

  // The runtime's _emit dispatches on window (not document) — listen there.
  window.addEventListener('swr-automix-tick', function (ev) {
    var detail = ev.detail || {};
    var mixed = detail.mixed || {};
    var arc = mixed.arc;
    if (!arc) return; // legacy path (no arc) — leave the scheduler alone
    if (arc.actIndex === lastActIndex) return;
    lastActIndex = arc.actIndex;
    apply(arc.actName, 'act-change');
  });

  // Re-apply when the arc rebuilds (new song) — resets act tracking.
  window.addEventListener('swr-automix-arc', function () {
    lastActIndex = null;
    lastApplied = null;
  });

  // Manual API for the debug panel / power users.
  window.SWR_AUTOMIX_COMPOSITION = {
    apply: apply,
    PROFILES: PROFILES,
  };
})();
