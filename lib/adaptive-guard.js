// lib/adaptive-guard.js — frame-budget watchdog.
//
// The tier (lib/tier-runtime.js) is a first-frame guess. This is the
// correction: it watches actual rAF deltas and, when the budget is blown
// for long enough, steps work down in the order that is cheapest and least
// visible first. It only acts when internal degradation is exhausted —
// lib/swr-natural.client.js already sheds its second mirror ghost, then the
// whole frame pass, before this fires; the guard is the cross-subsystem
// step that reduces how much the page is ASKING for.
//
// Step-down order (cheap + invisible first):
//   1. cssFilters off   — swaps the filmic grade for the raw look
//   2. feedbackRes down — smaller echo buffer (visually softer trail)
//   3. overlaySkip up   — the overlay's GPU pass runs every Nth frame
//   4. maxClips down    — the scheduler keeps fewer clips decoding
//   5. minCutMs up      — slower cut cadence (fewer decodes, calmer)
//   6. tier step down   — the structural fork (renderScale/DPR/fft)
//
// Recovery is deliberately slower than degradation (2x the window) and only
// climbs back to the DETECTED tier, never above it: a device that had to step
// down once will have to earn each notch back with sustained headroom.
//
// Public surface (window.SWR_ADAPTIVE):
//   .start() / .stop()
//   .stats()   → { ema, downCount, upCount, state: 'ok'|'pressure', steps }
//   .on(fn)    → subscribe to { kind: 'down'|'up', reducer, tier }
//
// Consumers read `window.SWR_ADAPTIVE.state()` (a reducer bitmask) and adapt:
//   if (SWR_ADAPTIVE.state().cssFilters) → apply grade
//   if (SWR_ADAPTIVE.state().feedbackRes) → use that resolution

(function () {
  'use strict';
  if (window.SWR_ADAPTIVE) return;

  var DOWN_MS = 5000;    // sustained pressure before stepping down
  var UP_MS = 10000;     // sustained headroom before giving a notch back
  var SLOW_MS = 40;      // frame budget blown above this
  var FAST_MS = 20;      // comfortable below this
  var EMA_A = 0.08;

  // The reducer ladder: each entry removes one demand. `key` is what
  // consumers read off state(); `apply` mutates the shared state object.
  var LADDER = [
    {
      key: 'cssFilters',
      label: 'css filters off',
      apply: function (s) {
        s.cssFilters = false;
        // lib/swr-natural.client.js owns the grade; tell it to drop it.
        try { if (window.SWR_NATURAL && window.SWR_NATURAL.setGrade) window.SWR_NATURAL.setGrade(false); } catch (_) {}
      },
    },
    {
      key: 'feedbackRes',
      label: 'feedback resolution down',
      apply: function (s) { s.feedbackRes = Math.max(0.25, (s.feedbackRes || 0.5) / 2); },
    },
    {
      key: 'overlaySkip',
      label: 'webgl overlay every other frame',
      apply: function (s) {
        // Halve the overlay's GPU cost WITHOUT removing it: on engine the
        // overlay IS the composite, so FX.setEnabled(false) would blank the
        // look (and freeze FX.state — the automix displacement contract's
        // signal). Frame-skip keeps both.
        s.overlaySkip = Math.min(4, (s.overlaySkip || 1) + 1);
        try { if (window.FX && window.FX.setFrameSkip) window.FX.setFrameSkip(s.overlaySkip); } catch (_) {}
      },
    },
    {
      key: 'maxClips',
      label: 'fewer concurrent clips',
      apply: function (s) { s.maxClips = Math.max(1, (s.maxClips || 3) - 1); },
    },
    {
      key: 'minCutMs',
      label: 'slower cut cadence',
      apply: function (s) { s.minCutMs = Math.min(6000, (s.minCutMs || 1200) + 800); },
    },
    {
      key: 'tier',
      label: 'tier step down',
      apply: function (s) {
        if (window.SWR_TIER) {
          var before = window.SWR_TIER.current();
          if (window.SWR_TIER.step('adaptive-guard')) {
            var p = window.SWR_TIER.profile();
            s.renderScale = p.renderScale;
            s.maxDPR = p.maxDPR;
            s.fftSize = p.fftSize;
            s.overlaySkip = 1;
            s.cssFilters = p.cssFilters;
            s.note = before + ' → ' + window.SWR_TIER.current();
          }
        }
      },
    },
  ];

  function seed() {
    var p = (window.SWR_TIER && window.SWR_TIER.profile()) || {};
    return {
      cssFilters: p.cssFilters !== false,
      feedbackRes: p.feedbackRes || 0.5,
      overlaySkip: 1,
      maxClips: p.maxClips || 3,
      minCutMs: p.minCutMs || 1200,
      renderScale: p.renderScale || 1,
      maxDPR: p.maxDPR || 1.5,
      fftSize: p.fftSize || 2048,
      note: '',
    };
  }

  var state = seed();
  var ladderIdx = 0;
  var ema = 16;
  var slowFor = 0;
  var fastFor = 0;
  var stats = { downCount: 0, upCount: 0, steps: [], running: false };
  var subs = [];
  var rafId = 0;

  function emit(evt) {
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](evt); } catch (_) {}
    }
    try {
      document.dispatchEvent(new CustomEvent('swr-adaptive-' + evt.kind, { detail: evt }));
    } catch (_) {}
  }

  function stepDown() {
    if (ladderIdx >= LADDER.length) return false;
    var rung = LADDER[ladderIdx++];
    rung.apply(state);
    stats.downCount++;
    var evt = { kind: 'down', reducer: rung.key, label: rung.label, tier: window.SWR_TIER && window.SWR_TIER.current(), state: snapshot() };
    stats.steps.push(evt);
    emit(evt);
    return true;
  }

  function stepUp() {
    if (ladderIdx <= 0) return false;
    var rung = LADDER[--ladderIdx];
    // Restore what the rung removed (the inverse), then re-seed from the
    // (possibly lower) detected tier so we never climb above it.
    var base = seed();
    // Reapply rungs below the new index so the ladder stays consistent.
    for (var i = 0; i < ladderIdx; i++) LADDER[i].apply(state);
    state.cssFilters = base.cssFilters && !LADDER.slice(0, ladderIdx).some(function (r) { return r.key === 'cssFilters'; });
    if (ladderIdx === 0) state.cssFilters = base.cssFilters;
    stats.upCount++;
    var evt = { kind: 'up', reducer: rung.key, tier: window.SWR_TIER && window.SWR_TIER.current(), state: snapshot() };
    stats.steps.push(evt);
    emit(evt);
    return true;
  }

  function snapshot() {
    return {
      cssFilters: state.cssFilters, feedbackRes: state.feedbackRes,
      maxClips: state.maxClips, minCutMs: state.minCutMs,
      overlaySkip: state.overlaySkip, renderScale: state.renderScale,
      ladder: ladderIdx, note: state.note,
    };
  }

  var last = 0;
  function frame(now) {
    if (!stats.running) return;
    rafId = requestAnimationFrame(frame);
    var dt = last ? now - last : 16;
    last = now;
    if (dt > 250) dt = 250;           // tab-switch / sleep: not a real frame
    ema += (dt - ema) * EMA_A;

    if (ema > SLOW_MS) { slowFor += dt; fastFor = 0; }
    else if (ema < FAST_MS) { fastFor += dt; slowFor = 0; }
    else { slowFor = Math.max(0, slowFor - dt * 0.5); fastFor = Math.max(0, fastFor - dt * 0.5); }

    if (slowFor >= DOWN_MS) { slowFor = 0; stepDown(); }
    else if (fastFor >= UP_MS) { fastFor = 0; stepUp(); }
  }

  window.SWR_ADAPTIVE = {
    start: function () {
      if (stats.running) return;
      stats.running = true;
      last = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop: function () {
      stats.running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    state: snapshot,
    stats: function () { return { ema: +ema.toFixed(2), downCount: stats.downCount, upCount: stats.upCount, state: ema > SLOW_MS ? 'pressure' : 'ok', ladder: ladderIdx, running: stats.running, steps: stats.steps.slice(-6) }; },
    // Test hooks: drive the ladder directly (the verify script uses these
    // after CDP CPU throttling, where a real 5s wait is wasteful).
    _forceDown: stepDown,
    _forceUp: stepUp,
    reset: function () { ladderIdx = 0; state = seed(); ema = 16; slowFor = 0; fastFor = 0; },
    on: function (fn) { if (typeof fn === 'function') subs.push(fn); },
  };

  // Auto-start: the guard is cheap (one rAF callback) and its whole job is
  // to be running before the page gets heavy.
  window.SWR_ADAPTIVE.start();
})();
