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

    // Auto-populate the stage: variants don't auto-add library items as
    // layers (that's engine-only behaviour), so a user with clips in the
    // library but nothing on stage had NOTHING for the scheduler to
    // swap — the #1 cause of "automix isn't evolving my clips". Add up
    // to 3 layers from the library, once per session.
    var SWR = window.SWR;
    var Layers = SWR && SWR.Layers;
    var Library = SWR && SWR.Library;
    if (Layers && Library && typeof Layers.add === 'function' &&
        (!Layers.list || !Layers.list.length) && Library.items && Library.items.length) {
      for (var li = 0; li < Math.min(3, Library.items.length); li++) {
        try { Layers.add(Library.items[li]); } catch (_) {}
      }
    }

    var profile = PROFILES[actName] || DEFAULT_PROFILE;
    var minSeconds = profile.minSeconds;
    var maxSeconds = profile.maxSeconds;
    // Global invariant: a clip never stays visible longer than 8 bars.
    // Bars are tempo-dependent — 8 bars = 32 beats = 32·60/bpm seconds —
    // so the cap is computed from a SANITIZED bpm: the realtime beat
    // estimator can produce garbage (e.g. 1000+ on synthetic tones),
    // which once clamped every profile to 1s. Outside 30–250 BPM the
    // value is not trusted and 120 is used.
    var bpm = (SWR && SWR.Audio && SWR.Audio.feat && SWR.Audio.feat.bpm) || 0;
    if (!(bpm >= 30 && bpm <= 250)) bpm = 120;
    var cap8 = (32 * 60 / bpm);
    if (maxSeconds > cap8) maxSeconds = cap8;
    if (minSeconds > maxSeconds) minSeconds = maxSeconds;
    var same = lastApplied &&
      lastApplied.minSeconds === minSeconds &&
      lastApplied.maxSeconds === maxSeconds;
    if (same) return true;
    sched.setConfig({
      enabled: true,
      minSeconds: minSeconds,
      maxSeconds: maxSeconds,
      beatSync: true, // fades land on the beat — visibly tighter cuts
    });
    lastApplied = { minSeconds: minSeconds, maxSeconds: maxSeconds };
    try {
      document.dispatchEvent(new CustomEvent('swr-composition-change', {
        detail: { act: actName, profile: { minSeconds: minSeconds, maxSeconds: maxSeconds }, reason: reason || 'act-change' },
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
