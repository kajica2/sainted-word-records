// lib/swr-life.client.js — one bloodstream for the composition's motion.
//
// The engine already owns a vocabulary of motion — reactors, LFOs, the Ken
// Burns drift, crossfades, the liquid FX — but each system smooths and phases
// alone. This module derives ONE shared set of physical signals from the audio
// and the clock, so every consumer moves like the same body of water:
//
//   life.energy   — spring follower of rms: carries momentum, settles, rings
//   life.pulse    — a beat impulse that rings down like a struck surface
//   life.beat     — a smoothed companion to the raw beat envelope
//   life.tide     — a slow always-running drift in [0,1] (never dead at rest)
//   life.flow     — a slow signed drift in [-1,+1] for directional effects
//   life.dt       — last clamped frame delta (s)
//
// Consumers read the values; nothing here touches the DOM or the canvas.
// Self-ticking (own rAF): pages that load this script get live signals with
// zero wiring; extra update() calls are free. All outputs are finite and
// bounded — a NaN here would poison every consumer, so the step is defensive.
//
// Public API (window.SWR_LIFE):
//   .update(nowMs?)   — step once; the rAF loop calls it, tests pass a clock
//   .stagger(i, n)    — per-layer phase fraction in [0,1) for wave spreads
//   .values()         — snapshot { energy, pulse, beat, tide, flow, t, dt }

(function () {
  'use strict';
  if (window.SWR_LIFE && window.SWR_LIFE.__loaded) return;

  var energy = 0, energyV = 0;   // spring states (position + velocity)
  var pulse = 0, pulseV = 0;
  var beat = 0, beatV = 0;
  var lastBeatPulse = false;
  var t = 0;
  var lastMs = null;
  var dtLast = 0;

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function feat() {
    var A = window.SWR && window.SWR.Audio;
    return (A && A.feat) || null;
  }

  function step(nowMs) {
    var now = (typeof nowMs === 'number') ? nowMs : performance.now();
    if (lastMs == null) lastMs = now;
    var dt = (now - lastMs) / 1000;
    lastMs = now;
    if (!isFinite(dt) || dt < 0) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;      // backgrounded tab: cap — never teleport
    dtLast = dt;
    t += dt;

    var f = feat();
    var rms = f ? clamp01(Number(f.rms) || 0) : 0;

    // energy — spring follower, slightly underdamped: momentum + settle.
    var kE = 42, dE = 7.5;
    energyV += (rms - energy) * kE * dt;
    energyV *= Math.exp(-dE * dt);
    energy += energyV * dt;

    // pulse — kick on the beat EDGE, ring down like water.
    var bp = !!(f && f.beatPulse);
    if (bp && !lastBeatPulse) pulseV += 1.6;
    lastBeatPulse = bp;
    var kP = 70, dP = 6.5;
    pulseV += (0 - pulse) * kP * dt;
    pulseV *= Math.exp(-dP * dt);
    pulse += pulseV * dt;

    // beat — a smoother companion to the raw envelope.
    var raw = f ? clamp01(Number(f.beat) || 0) : 0;
    var kB = 30, dB = 8;
    beatV += (raw - beat) * kB * dt;
    beatV *= Math.exp(-dB * dt);
    beat += beatV * dt;

    // Bounds + finiteness — defensive: a NaN here would poison consumers.
    if (!isFinite(energy)) { energy = 0; energyV = 0; }
    if (!isFinite(pulse)) { pulse = 0; pulseV = 0; }
    if (!isFinite(beat)) { beat = 0; beatV = 0; }
    energy = Math.max(0, Math.min(1.5, energy));
    pulse = Math.max(0, Math.min(2, pulse));
    beat = clamp01(beat);
  }

  function tide() {
    // Two harmonics so it never reads as a metronome.
    return 0.5 + 0.35 * Math.sin(t * 2 * Math.PI * 0.017)
               + 0.15 * Math.sin(t * 2 * Math.PI * 0.041 + 1.7);
  }

  function flow() {
    return Math.sin(t * 2 * Math.PI * 0.011 + 2.3);
  }

  window.SWR_LIFE = {
    __loaded: true,
    update: step,
    stagger: function (i, n) {
      n = Math.max(1, (n | 0) || 1);
      return (((i | 0) % n) + n) % n / n;
    },
    get energy() { return energy; },
    get pulse() { return pulse; },
    get beat() { return beat; },
    get tide() { return tide(); },
    get flow() { return flow(); },
    get dt() { return dtLast; },
    values: function () {
      return { energy: energy, pulse: pulse, beat: beat, tide: tide(), flow: flow(), t: t, dt: dtLast };
    },
  };

  // Self-tick: one rAF chain. Guarded so a test sandbox (no rAF) still loads
  // the module and can step it with a synthetic clock.
  if (typeof requestAnimationFrame === 'function') {
    var frame = function () { step(); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }
})();
