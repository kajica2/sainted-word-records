// client/narrative-state.client.js — emergent-narrative accumulator for
// the score-evolution plan (P3.7).
//
// The neon engine reacts to audio frame-by-frame. This module makes the
// visuals *accumulate* over time so they reflect the song's journey, not
// just its instantaneous features. Pure module: tracks five state
// variables that the renderer (Stage 2) consumes; no DOM, no canvas.
//
// Exposes window.SWR_NARRATIVE:
//   .state           { tension, peak, drift:{x,y}, warmth, age }
//   .init(bpm, dur)  // call once on song-load with track metadata
//   .step(A)         // call once per RAF with the audio feature vector
//   .reset()         // call on song-end / new song
//   .phaseMultiplier(expectedDurationSec)  // Stage 3 — exposed early so
//                                         // the renderer can read it once
//                                         // Stage 3 lands.
//
// Determinism: the drift walker is seeded from `bpm * durationSec` so the
// same song always produces the same drift on the same browser session.
// Without seeding, `Math.random()` would yield a different visual on
// every reload, which makes A/B comparison between recordings impossible.
//
// Tuning constants (half-lives, drift bounds) are documented inline.
// They are intentional defaults; eyes-on-tweaks belong to Stage 6
// polish, not Stage 1.

(function () {
  'use strict';
  if (window.SWR_NARRATIVE) return;

  // ---- Tuning constants ----
  // Half-life at 60fps, in frames. tension at 0.0625/frame ≈ 4s window.
  var TENSION_LERP = 0.0625;
  // Peak decay: 0.97/frame ≈ 1.5s half-life.
  var PEAK_DECAY = 0.97;
  // Drift walker step base. Multiplied by (bpm/100) and by tension.
  var DRIFT_STEP_BASE = 0.02;
  // Mean-reversion strength when tension is low (passages drift more).
  var MEAN_REVERT_BASE = 0.05;
  // Drift bounds: clamped to [-1, +1] per axis. Renderer maps to ±80px.
  var DRIFT_BOUND = 1.0;
  // Warmth: 0.02/frame ≈ 50-frame half-life at 60fps ≈ long color-temp
  // averaging. Slow drift over the song.
  var WARMTH_LERP = 0.02;

  // ---- Internal state ----
  // Keep a stable mutable object as the public `state` reference so
  // callers always read the latest values, even after init()/reset()
  // reassign fields.
  var state = blankState();
  var cfg = { bpm: 120, dur: 0, rngSeed: 1 };
  // Stage 4 — beat counter and transient drift-amp boost. Reset on
  // init/reset. Beat counter increments only when beatPulse is true.
  var beatCount = 0;
  var microAmp = 1.0;
  // Seeded RNG (mulberry32) so drift is reproducible per song.
  function rng() {
    cfg.rngSeed |= 0; cfg.rngSeed = (cfg.rngSeed + 0x6D2B79F5) | 0;
    var t = cfg.rngSeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function blankState() {
    return {
      tension: 0, peak: 0,
      drift: { x: 0, y: 0 },
      warmth: 0.5, age: 0,
    };
  }

  function init(bpm, durationSec) {
    cfg.bpm = (typeof bpm === 'number' && bpm > 0) ? bpm : 120;
    cfg.dur = (typeof durationSec === 'number' && durationSec > 0) ? durationSec : 0;
    // Seed = bpm * durationSec, then map to int32.
    cfg.rngSeed = Math.floor(cfg.bpm * Math.max(cfg.dur, 1)) | 0;
    // Reset state fields in-place so the public reference stays valid.
    var s = state;
    s.tension = 0; s.peak = 0;
    s.drift.x = 0; s.drift.y = 0;
    s.warmth = 0.5; s.age = 0;
    // Stage 4 reset.
    beatCount = 0; microAmp = 1.0;
  }

  function reset() {
    init(cfg.bpm, cfg.dur);
  }

  function clamp(x, lo, hi) {
    return x < lo ? lo : (x > hi ? hi : x);
  }

  function step(A) {
    if (!A) return;

    // Tension: short-window RMS average. Lerp toward the current rms.
    if (typeof A.rms === 'number') {
      state.tension = state.tension + (A.rms - state.tension) * TENSION_LERP;
    }

    // Peak: max of recent beat, slow decay.
    var beat = (typeof A.beat === 'number') ? A.beat : 0;
    state.peak = Math.max(beat, state.peak * PEAK_DECAY);

    // Drift: bounded random walk scaled by bpm and tension.
    // Mean-reversion pulls toward 0 in quiet passages so the visual
    // settles rather than wandering off.
    var stepScale = DRIFT_STEP_BASE * (cfg.bpm / 100) * (0.5 + state.tension);
    state.drift.x += (rng() - 0.5) * 2 * stepScale;
    state.drift.y += (rng() - 0.5) * 2 * stepScale;
    var revert = MEAN_REVERT_BASE * (1 - state.tension) * 0.5;
    state.drift.x -= state.drift.x * revert;
    state.drift.y -= state.drift.y * revert;
    state.drift.x = clamp(state.drift.x, -DRIFT_BOUND, DRIFT_BOUND);
    state.drift.y = clamp(state.drift.y, -DRIFT_BOUND, DRIFT_BOUND);

    // Warmth: long-term centroid average. Slow drift over the song.
    if (typeof A.centroid === 'number') {
      state.warmth = state.warmth + (A.centroid - state.warmth) * WARMTH_LERP;
    }

    // Age: monotonic. Caller passes dt in seconds via A.dt (optional).
    var dt = (typeof A.dt === 'number' && A.dt >= 0) ? A.dt : (1 / 60);
    state.age += dt;
  }

  // ---- Stage 4: beat-locked micro-evolution ----
  // Tracks the number of beat-pulses seen since init/reset. Returns
  // { count, firedThisStep } where firedThisStep is true on every 4th
  // beat (count % 4 === 0 and count > 0). Call once per RAF, passing
  // the audio engine's beatPulse flag.
  function onBeat(beatPulse) {
    if (beatPulse) {
      beatCount += 1;
      var fired = (beatCount > 0 && beatCount % 4 === 0);
      if (fired) {
        // Bump peak so the visual flashes even without a hard beat.
        state.peak = Math.max(state.peak, 0.6);
        // Bump drift amplitudes briefly — recorded as a transient in
        // microAmp that decays back to 1.0 over the next ~2 beats.
        microAmp = 1.5;
      }
    }
    // Decay microAmp toward 1.0 at a rate that completes in ~2 beats
    // at 120 BPM (~1s). Per-frame factor at 60fps: ~0.94.
    microAmp = microAmp + (1.0 - microAmp) * 0.06;
    return { count: beatCount, microAmp: microAmp };
  }

  function getMicroAmp() {
    return microAmp;
  }

  // Stage 3 hook — exposed here so callers that import the module in
  // Stage 2 wiring don't need to upgrade their import path.
  // Continuous phases as a function of state.age / expectedDurationSec:
  //   opening (0–25%): dampen motion, low openness
  //   middle  (25–75%): full strength
  //   climax  (75–100%): amplified drift + center pullback
  function phaseMultiplier(expectedDurationSec) {
    var dur = (typeof expectedDurationSec === 'number' && expectedDurationSec > 0)
      ? expectedDurationSec : 1;
    var t = clamp(state.age / dur, 0, 1);
    var openness = t < 0.25 ? 0.4 : (t < 0.75 ? 1.0 : 0.7);
    var driftAmp = t < 0.25 ? 0.3 : (t < 0.75 ? 1.0 : 1.4);
    var pullback = t < 0.75 ? 0.0 : (t - 0.75) * 4; // 0..1 in last 25%
    return { openness: openness, driftAmp: driftAmp, pullback: pullback };
  }

  // ---- Public API ----
  window.SWR_NARRATIVE = {
    state: state, // stable reference; fields are reset in init()/reset()
    init: init,
    step: step,
    reset: reset,
    phaseMultiplier: phaseMultiplier,
    onBeat: onBeat,        // Stage 4 — call once per RAF with beatPulse flag
    getMicroAmp: getMicroAmp, // Stage 4 — current drift-amp boost (1.0 baseline)
    // Exposed for tests/debug; do not mutate from outside.
    _config: function () { return { bpm: cfg.bpm, dur: cfg.dur }; },
  };
})();