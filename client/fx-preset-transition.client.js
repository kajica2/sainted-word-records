// client/fx-preset-transition.client.js — smooth preset transitions.
//
// Picking a grade preset used to SNAP: FX.setPersona() wrote sixteen
// uniforms in one frame, so the picture jumped from one grade to the next
// like a cut. A preset is a look, and a look should arrive — the grade
// should glide.
//
// This module owns the glide and nothing else. It does not define presets,
// does not decide when to apply one, and does not own the FX state: the
// presets stay in versions-presets.js, the sliders stay in personas.js, and
// FX.setPersona() stays the single writer of the state.
//
//   SWR_PRESET_TRANSITION.morph(() => FX.setPersona(preset), { ms: 420 })
//
// morph() captures the current grade, runs the caller's apply function (so
// the caller keeps full ownership of WHAT happens), then eases the state
// from the captured values to the applied ones. The apply function still
// snaps the state — that is how it has always worked and other readers
// (the recorder, the export path) depend on the final value being correct
// the instant the preset is applied. morph() simply rewinds the visible
// state to the captured values on the next frame and glides forward, so the
// final state lands exactly where the snap put it.
//
// Interruptible: a second morph() mid-flight starts from wherever the
// picture currently is, and a key that something else writes mid-flight (a
// slider the user is dragging) drops out of the glide instead of fighting
// for it.
//
// Public API:
//   morph(applyFn, opts)  — apply, then glide. opts.ms (default 420).
//   cancel()              — stop any glide in flight, leaving the state as is.
//   isMorphing()          — true while a glide is running.
//   duration(ms)          — set the default duration for later morph() calls.

(function (global) {
  'use strict';

  if (global.SWR_PRESET_TRANSITION) return;

  // The continuous grade parameters. `mutAlgo` is deliberately absent: it is
  // an enum (0..11 displace/mask illusions), not a dial. Interpolating it
  // would sweep the picture through every illusion between two presets.
  const PERSONA_KEYS = [
    'temp', 'mut', 'posterize', 'vignette', 'chroma', 'grain', 'sepia',
    'glow', 'grayscale', 'blur', 'liquid', 'pearl', 'glitch', 'tone',
    'sharp', 'cinematic',
  ];

  const DEFAULT_MS = 420;
  const EPS = 1e-6;

  let raf = 0;
  let duration = DEFAULT_MS;
  // from/to hold the glide endpoints; `written` holds what we last put into
  // the state, so we can tell "nobody touched it" from "someone else did".
  let from = null;
  let to = null;
  let written = null;
  let keys = null;
  let startedAt = 0;

  function fxState() {
    const FX = global.FX;
    return (FX && FX.state) ? FX.state : null;
  }

  // The repo has one shared easing map (lib/ease.js) and the variant pages
  // bind SWR_EASE.ease. 'soft' is the smoothstep the film dissolve uses.
  // Fall back to the same curve if the page has not loaded it.
  function ease(t) {
    const E = global.SWR_EASE;
    if (E && typeof E.ease === 'function') {
      try { return E.ease('soft', t); } catch (_) { /* fall through */ }
    }
    return t * t * (3 - 2 * t);
  }

  function now() {
    return (global.performance && typeof global.performance.now === 'function')
      ? global.performance.now()
      : Date.now();
  }

  function capture() {
    const st = fxState();
    if (!st) return null;
    const snap = {};
    for (const k of PERSONA_KEYS) {
      const v = st[k];
      if (typeof v === 'number' && isFinite(v)) snap[k] = v;
    }
    return Object.keys(snap).length ? snap : null;
  }

  function cancel() {
    if (raf) {
      global.cancelAnimationFrame(raf);
      raf = 0;
    }
    from = to = written = keys = null;
  }

  function isMorphing() {
    return !!raf;
  }

  function step() {
    const st = fxState();
    if (!st) { cancel(); return; }

    const ms = Math.max(1, duration);
    const t = Math.min(1, (now() - startedAt) / ms);
    const e = ease(t);

    for (const k of keys) {
      const want = from[k] + (to[k] - from[k]) * e;
      // Someone else wrote this key while we were gliding (a slider the
      // user is dragging, a persona apply). Give it back: their value wins.
      if (typeof st[k] === 'number' && Math.abs(st[k] - written[k]) > EPS) {
        keys.splice(keys.indexOf(k), 1);
        continue;
      }
      st[k] = want;
      written[k] = want;
    }

    if (t >= 1 || !keys.length) {
      // Land exactly on the applied values, not on an eased approximation.
      if (st) {
        for (const k of keys) st[k] = to[k];
      }
      cancel();
      return;
    }
    raf = global.requestAnimationFrame(step);
  }

  // applyFn does the real work (snap the state, swap the render pass, …).
  // We only own the glide from the old grade to the new one.
  function morph(applyFn, opts) {
    if (typeof applyFn !== 'function') return false;
    opts = opts || {};

    cancel();

    const before = capture();
    let result;
    try {
      result = applyFn();
    } catch (e) {
      cancel();
      throw e;
    }

    const st = fxState();
    if (!before || !st) return result;

    const after = capture();
    if (!after) return result;

    // Rewind the visible state to where the picture was before the apply,
    // then glide to where the apply put it. The apply's own values stay the
    // target, so anything that reads the state outside the render loop
    // still sees the new grade immediately.
    const changed = {};
    const glideKeys = [];
    for (const k of PERSONA_KEYS) {
      if (typeof before[k] !== 'number' || typeof after[k] !== 'number') continue;
      changed[k] = before[k];
      if (Math.abs(after[k] - before[k]) > EPS) glideKeys.push(k);
    }
    if (!glideKeys.length) return result;

    for (const k of glideKeys) st[k] = changed[k];

    from = changed;
    to = after;
    written = Object.assign({}, changed);
    keys = glideKeys;
    startedAt = now();
    duration = (typeof opts.ms === 'number' && isFinite(opts.ms) && opts.ms >= 0)
      ? opts.ms
      : DEFAULT_MS;

    if (!duration) {
      // A zero-length morph is a snap. Apply the target and stop.
      for (const k of glideKeys) st[k] = to[k];
      cancel();
      return result;
    }

    raf = global.requestAnimationFrame(step);
    return result;
  }

  global.SWR_PRESET_TRANSITION = {
    morph,
    cancel,
    isMorphing,
    duration(ms) {
      if (typeof ms === 'number' && isFinite(ms) && ms >= 0) duration = ms;
      return duration;
    },
  };
})(typeof window !== 'undefined' ? window : this);
