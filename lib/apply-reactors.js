// lib/apply-reactors.js - the ONE shared reactor contract (plan P1.1).
//
// THE PROBLEM
// -----------
// `versions/grid.html` dropped `x` / `y` reactors silently: its applyR had
// branches for `scale`, `opacity`, `hue` and `rot` and nothing else, so a
// preset that said `{target:'x'}` did nothing at all and nothing warned.
// Every surface had its own hand-typed reactor chain (a named `applyR` on
// the variant pages, an inline chain on engine.html) with its own per-target
// unit table:
//
//   unit table          pages   x      y     rot   hue   opacity  brightness contrast  scale
//   gain200                7  200    200    30    60    x0.5     x0.5      x0.5       raw
//   eclipse                1  180    180    25    60    x0.6     x0.5      x0.5       raw
//   film                   1  250    250    12    40    x0.4     x0.3      x0.3       raw
//   smoke                  1  300    300     8    50    x0.3     x0.2      x0.2       raw
//   hallucination          1  150    150    45    80    x0.7     x0.7      x0.7       raw
//   naturalHalfGrade       3    1      1      1      1    x0.5     x0.5      x0.5       raw
//   natural                1    1      1      1      1    1        1         1        raw
//   grid                   1  MISS   MISS    12   180   blend     MISS      MISS       raw
//
// (which pages used which table is named in UNITS below)
//
// and seven distinct clamp expressions on top of that: `scale` was UNCLAMPED
// everywhere (a negative reactor gain or a `mutate` jitter tick could drive
// it to 0 or below, and a non-positive scale is a silent no-op in
// `drawImage`), opacity clamped to 1.0 on fourteen of the sixteen surfaces
// and 1.5 on engine.html and hallucination, and brightness / contrast to 3 on
// hallucination, 2.5 on the fourteen surfaces that had those branches at all
// - grid had no brightness or contrast branch at all.
//
// THE CONTRACT
// ------------
// One unit table, one clamp table, one dispatch loop:
//
//   target       unit            clamp
//   ---------    --------------  ----------------
//   x            250             -
//   y            250             -
//   rot          12              -
//   hue          1               -
//   opacity      1               [0, 1.5]
//   scale        1               [0.05, 4]
//   brightness   1               [0.1, 2.5]
//   contrast     1               [0.1, 2.5]
//   (anything else)  100         -
//
// Note on `hue`: the plan's sketch snippet wrote `hue: 40`, the task contract
// writes "no clamp, no scale". The task contract wins here, and 1 is also
// what engine.html, neon, music_video and music_video_mtv already shipped
// (their `r.scale` for hue is a degree count), so 1 is the only value that is
// simultaneously the spec AND behaviour-preserving on four surfaces.
//
// WHY `UNITS` STILL EXISTS (read this before "simplifying" it away)
// -----------------------------------------------------------------
// `r.scale` is NOT one unit across the repo. Four surfaces already read it
// as a gain in the target's NATURAL units (engine.html presets say
// `{target:'x', scale:44}` meaning 44 px; neon says `{target:'y', scale:80}`
// meaning 80 px), and the other twelve variant pages read it as a normalised
// 0..1 gain that the page then multiplied by its own px/deg constant. Those
// two readings cannot both be served by one table without a data migration
// of every shipped preset AND every user's persisted project.
//
// So the shared table is the DEFAULT, and `opts.units` is the named,
// explicit compatibility table for a surface whose presets are authored in
// the other unit. Every historical table is now ONE line in UNITS below
// instead of a hand-typed if/else chain in 16 HTML files (fifteen named
// `applyR`s plus engine.html's inline chain), and deleting an entry from
// UNITS (and the `units:` option at the call site) is the whole migration
// once the preset data is normalised. That is what "the divergent unit
// tables collapse to one" means in practice: eight named tables in one
// file, one place to see them, one place to change them. (The plan's own
// recount corrected its original "six divergent unit tables" headline to
// fifteen pages; the tree actually carried eight distinct tables.)
//
// WHAT THE EXTRACTION ACTUALLY FIXES, on every surface, immediately
// ------------------------------------------------------------------
//   1. `scale` is clamped to [0.05, 4] everywhere. It was unclamped on all
//      sixteen surfaces.
//   2. opacity clamps to [0, 1.5] everywhere (it was 1.0 on fourteen of the
//      sixteen surfaces) and brightness / contrast to [0.1, 2.5] everywhere
//      (3 on hallucination; grid had neither branch at all). engine.html's
//      and hallucination's [0, 1.5] were already right; the other fourteen
//      now match them.
//   3. grid gains `x`, `y`, `brightness` and `contrast`. The audit's named
//      missing-target bug.
//   4. The missing-target bug is structurally impossible: the dispatch is
//      `out[target] += delta` against a fixed key set, so a new target is a
//      row in UNIT, not a new else-if branch in 16 files.
//
// KNOWN, DELIBERATE DELTAS (each one is a bug fix, not a regression)
// -----------------------------------------------------------------
//   - neon / music_video / music_video_mtv: their `x`/`y`/`rot`/`hue`/
//     `scale` branches apply `r.scale`, but their opacity / brightness /
//     contrast branches never did (`v` had `* r.scale` removed from it in an
//     earlier refactor and only five of the eight branches were updated).
//     Through the shared loop `r.scale` applies to all of them, so those
//     three grades are now scaled by the preset's own gain like every other
//     surface. Presets there carry `scale: 0.6`-`0.9`, so the grade is a
//     little gentler than before and it now responds to the slider.
//   - grid: it had no `x` / `y` / `brightness` / `contrast` branch at all
//     (a preset that targeted one of them did nothing at all), and its
//     opacity was an INVERSE blend (`opacity * (1 - v)`, louder music dimmed
//     the layer) instead of the additive form the other fifteen surfaces
//     use. Both are corrected. grid is a standalone page, it is not in the
//     engine's variant dropdown, and its shipped presets only target
//     `opacity` and `scale`, so nothing on it was reading the fixed
//     behaviour.
//   - grid also gains the audio damper the other fourteen variant pages
//     read (engine.html never read one - it passes `damp: false`). See
//     `opts.damp`.
//   - neon / music_video / music_video_mtv: their `v` did NOT carry
//     `r.scale` (the other twelve pages' `v` did: `v = ease(...) * r.scale
//     * sens`), because their gain rode on the branch instead - `out.x += v
//     * r.scale`. The `mutate` jitter is added to `v`, so on those three the
//     jitter was scaled by `r.scale` a SECOND time: once inside the jitter
//     itself (`* Math.abs(r.scale)`) and again by the branch's `* r.scale`.
//     Through the shared loop the jitter is added AFTER the gain and BEFORE
//     the unit, exactly as the other twelve pages computed it, so it is no
//     longer multiplied by `r.scale` a second time. The reaction itself is
//     unchanged; only the randomness around it is slightly larger. At a
//     gain of 0.6 and a mutate of 0.4 the `x` delta moves 0.744 -> 0.84 px.
//     This is the same placement the module's own comment below describes,
//     so the shared contract is the deliberate one and these three pages
//     are the ones that move.
//     (engine.html is unaffected: it never had a `mutate` jitter at all.)
//
// LOADING
// -------
// A blocking (non-defer) CLASSIC script, for the same reason lib/ease.js is:
// the variant pages bind `const ease = window.SWR_EASE.ease` from a classic
// inline <script> that runs at parse time, and a `defer` tag would land
// after it had already read the global. The tag must not carry
// type="module": vite.config.js's `strip-absolute-module-scripts` plugin
// rewrites `<script type="module" src="/...">` into a plain defer classic
// script, so an ESM tag would be stripped into a SyntaxError at load. The
// root-absolute path `/lib/apply-reactors.js` resolves from every surface
// that needs it (/versions/<id>.html, /engine/, and the dist build, whose
// copy-static plugin ships the whole lib/ directory).
//
// This module is deliberately NOT ESM. See the "What I will not do" section
// of docs/PLANS/architecture-audit-2026-10.md: the zero-dependency "drop in
// a folder" claim outranks tree-shaking, and every page in the repo is a
// global-script surface.

(function (global) {
  'use strict';

  // ---- the default tables -------------------------------------------------
  //
  // Lookups go through hasOwnProperty, never a bare `UNIT[target]`: a bare
  // lookup on an object literal resolves inherited keys, so `UNIT['scale']`
  // would be fine but `UNIT['toString']` on a user-authored target name
  // would return Object.prototype.toString and `v * UNIT[target]` would be
  // NaN. Reactor configs come from disk, from presets/*.json and from users.

  var UNIT = {
    x: 250,
    y: 250,
    rot: 12,
    hue: 1,
    opacity: 1,
    scale: 1,
    brightness: 1,
    contrast: 1
  };

  // Every target with no row of its own. 100 is the contract's "all other
  // targets" number; in practice the only way to reach it is a typo in a
  // preset, and a typo then moves something by a visible-but-finite amount
  // instead of silently doing nothing (grid's old failure mode) or moving
  // by Infinity.
  var DEFAULT_UNIT = 100;

  var CLAMP = {
    scale: [0.05, 4],
    opacity: [0, 1.5],
    brightness: [0.1, 2.5],
    contrast: [0.1, 2.5]
  };

  // The eight targets the render pipeline actually reads. Anything outside
  // this set falls through to DEFAULT_UNIT but is never clamped and never
  // seeded, so it can only ever ADD to a number the caller put in `base`.
  var TARGETS = ['scale', 'x', 'y', 'rot', 'opacity', 'hue', 'brightness', 'contrast'];

  // ---- the historical tables, now one line each --------------------------
  //
  // Every surface that had its own if/else chain, named by the page(s) that
  // used it. See the header for why these are still here.

  var UNITS = {
    // r.scale is ALREADY a gain in the target's natural units (px, degrees,
    // hue degrees), so every unit is 1 and the table is the identity.
    // engine.html.
    natural: { x: 1, y: 1, rot: 1, hue: 1, opacity: 1, scale: 1, brightness: 1, contrast: 1 },

    // r.scale is a normalised 0..1 gain and the page multiplied by these.
    // The seven-page artistic family: aurora, chrome, fractal, glitch,
    // pulse, void, watercolor.
    gain200: { x: 200, y: 200, rot: 30, hue: 60, opacity: 0.5, scale: 1, brightness: 0.5, contrast: 0.5 },

    // Same natural-unit reading as `natural` but with the half-strength
    // grade the music-video cuts shipped. neon, music_video,
    // music_video_mtv.
    naturalHalfGrade: { x: 1, y: 1, rot: 1, hue: 1, opacity: 0.5, scale: 1, brightness: 0.5, contrast: 0.5 },

    // versions/eclipse.html
    eclipse: { x: 180, y: 180, rot: 25, hue: 60, opacity: 0.6, scale: 1, brightness: 0.5, contrast: 0.5 },

    // versions/film.html
    film: { x: 250, y: 250, rot: 12, hue: 40, opacity: 0.4, scale: 1, brightness: 0.3, contrast: 0.3 },

    // versions/smoke.html
    smoke: { x: 300, y: 300, rot: 8, hue: 50, opacity: 0.3, scale: 1, brightness: 0.2, contrast: 0.2 },

    // versions/hallucination.html
    hallucination: { x: 150, y: 150, rot: 45, hue: 80, opacity: 0.7, scale: 1, brightness: 0.7, contrast: 0.7 },

    // versions/grid.html. The four rows grid never had (x, y, brightness,
    // contrast) fall back to the contract default rather than staying
    // missing; the two it did have (rot 12, hue 180) are spelled out.
    grid: { x: 250, y: 250, rot: 12, hue: 180, opacity: 1, scale: 1, brightness: 1, contrast: 1 }
  };

  // ---- helpers ------------------------------------------------------------

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function unitFor(units, target) {
    var u = units && own(units, target) && typeof units[target] === 'number' ? units[target] : null;
    if (u !== null) return u;
    if (own(UNIT, target)) return UNIT[target];
    return DEFAULT_UNIT;
  }

  // The clamp table has no per-surface override: every historical clamp
  // differed only by being WRONG, and the whole point of the extraction is
  // that there is one range per target now. A surface that genuinely needs a
  // different one adds a row here, deliberately, in one place.
  function boundsFor(target) {
    return own(CLAMP, target) ? CLAMP[target] : null;
  }

  function finite(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  /**
   * Seed the transform from a layer. The common shape is the one all
   * fifteen variant pages build by hand: `baseScale`, a zeroed x/y, the
   * layer's own opacity / hue / brightness / contrast, and a rot that ten
   * pages seed from `l.hue * 0.05`, one (hallucination) from `l.hue * 0.1`
   * and four leave at 0. Pass `over.rot` to choose, or pass a whole `base`
   * to applyReactor and skip this.
   */
  function motionKill() {
    return global && global.SWR_MOTION_KILL;
  }

  function globalAllowRotation() {
    var mk = motionKill();
    if (mk && typeof mk.isRotationGloballyEnabled === 'function' && !mk.isRotationGloballyEnabled()) {
      return false;
    }
    return true;
  }

  function globalAllowZoom() {
    var mk = motionKill();
    if (mk && typeof mk.isZoomGloballyEnabled === 'function' && !mk.isZoomGloballyEnabled()) {
      return false;
    }
    return true;
  }

  function baseTransform(layer, over) {
    var l = layer || {};
    var o = over || {};
    var rotSeed = finite(o.rot, 0);
    if (!globalAllowRotation()) rotSeed = 0;
    return {
      scale: finite(l.baseScale, 1),
      x: finite(l.x, 0),
      y: finite(l.y, 0),
      rot: rotSeed,
      opacity: finite(l.opacity, 1),
      hue: finite(l.hue, 0),
      brightness: finite(l.brightness, 1),
      contrast: finite(l.contrast, 1)
    };
  }

  /**
   * The one reactor loop.
   *
   * @param {object} layer    the layer: `.reactors[]`, `.mutate`,
   *                          `.rotationEnabled`, and the resting values
   *                          baseTransform() seeds from.
   * @param {object} audio    `{ feat: {...}, params: { sens } }`. `sens`
   *                          defaults to 1 when absent (engine.html has no
   *                          `params.sens`).
   * @param {number} dt       frame delta in seconds, forwarded to
   *                          `opts.feature(reactor, dt)`. Reserved so the
   *                          signature does not break when the frame-rate
   *                          independent damper moves in here.
   * @param {object} [opts]
   * @param {object} [opts.base]        the transform to write into. A fresh
   *                                    baseTransform(layer) when omitted.
   * @param {object} [opts.units]       compatibility unit table (UNITS.*).
   *                                    The contract's UNIT when omitted.
   * @param {string[]} [opts.targets]   allowlist. Omitted = every target.
   * @param {function} [opts.ease]      (name, t) => curved t.
   *                                    Identity when omitted.
   * @param {function} [opts.feature]   (reactor, dt) => raw 0..1-ish value.
   *                                    `audio.feat[reactor.feature] ?? 0`
   *                                    when omitted.
   * @param {function} [opts.damp]      (raw, reactor) => smoothed value, for
   *                                    surfaces that read the audio damper
   *                                    themselves. `false` disables it.
   * @param {number} [opts.dampHalfLife] damper half-life, default 0.28.
   * @param {boolean} [opts.allowRotation=true]  when false, `rot` targets
   *                                    are skipped (the rot-master toggle).
   * @param {boolean} [opts.wrapRotation=true]   fold rot into (-180, 180]
   *                                    so accumulation stays continuous.
   * @param {function} [opts.random]    () => 0..1 for the `mutate` jitter.
   *                                    None when omitted.
   * @returns {object} the transform, mutated in place when `base` was given.
   */
  function applyReactor(layer, audio, dt, opts) {
    var o = opts || {};
    var l = layer || {};
    var a = audio || {};
    var out = o.base || baseTransform(l, o);
    var feat = a.feat || {};
    var sens = a.params ? finite(a.params.sens, 1) : 1;
    // The fallback has to take BOTH arguments. `ease` is called as
    // ease(reactor.ease, clampedValue), so a one-arg identity would return
    // the CURVE NAME and every default-eased reactor would add undefined.
    var ease = typeof o.ease === 'function' ? o.ease : identity;
    var units = o.units;
    var allow = Array.isArray(o.targets) ? o.targets : null;
    var allowRot = o.allowRotation !== false && globalAllowRotation();
    var wrapRot = o.wrapRotation !== false;
    var halfLife = finite(o.dampHalfLife, 0.28);
    var damp = o.damp === false ? null
             : (typeof o.damp === 'function' ? o.damp : globalDamp());
    var random = typeof o.random === 'function' ? o.random : null;
    var mutate = finite(l.mutate, 0);

    // Defensive: legacy persisted state may not include `reactors`, and a
    // malformed one may contain nulls. Skip rather than crash every frame
    // behind SWR_RENDER.frame()'s try/catch, which drops the layer silently.
    var list = Array.isArray(l.reactors) ? l.reactors : [];

    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object' || typeof r.target !== 'string') continue;
      var target = r.target;
      if (allow && allow.indexOf(target) === -1) continue;
      if (target === 'rot' && !allowRot) continue;
      if (!globalAllowZoom() && target === 'scale') continue;
      var mk = motionKill();
      if (mk && typeof mk.isReactorTargetAllowed === 'function' && !mk.isReactorTargetAllowed(target)) continue;

      var raw = typeof o.feature === 'function' ? o.feature(r, dt) : feat[r.feature];
      raw = finite(raw, 0);
      if (damp) raw = damp(raw, halfLife, r);

      var gain = finite(r.scale, 0);
      var v = ease(r.ease, clamp(raw, 0, 1));
      // The exact historical shape:
      //     v = ease(...) * r.scale * sens;
      //     if (mutate) v += (rand() - 0.5) * 2 * mutate * |r.scale|;
      //     out[target] += v * unit;
      // The jitter lands AFTER the gain and the sensitivity but BEFORE the
      // unit, so it is not multiplied by them. Moving it earlier would
      // silently rescale the mutation randomness by r.scale * sens.
      var delta = v * gain * sens;
      if (mutate > 0 && random) delta += (random() - 0.5) * 2 * mutate * Math.abs(gain);
      delta *= unitFor(units, target);

      if (!own(out, target)) out[target] = 0;
      out[target] += delta;

      var bounds = boundsFor(target);
      if (bounds) out[target] = clamp(out[target], bounds[0], bounds[1]);
    }

    // Fold the accumulated angle so it stays continuous across many audio
    // frames. The old asin(sin(x)) form produced sign flips every ~180 deg
    // of accumulation, which read as the layer "tumbling"; this formula
    // preserves the sign and only wraps at the boundary.
    if (wrapRot && out.rot) out.rot = ((out.rot + 540) % 360) - 180;

    return out;
  }

  // Two arguments, because that is how `ease` is called: the curve NAME then
  // the value. A one-arg identity returns the NAME (usually undefined, since
  // `ease` is optional on a reactor) and every default-eased reactor adds
  // undefined to its target.
  function identity(name, t) { return t; }

  // The repo-wide audio damper, resolved lazily at CALL time rather than at
  // load time: lib/audio-damp.client.js is loaded as a defer on the pages
  // that use it, so it may not exist yet when this IIFE runs. A surface that
  // never loads it just reads the raw analyser value, which is what every
  // page did before lib/audio-damp.client.js existed.
  //
  // It returns `damp.damp`, not the namespace, and it returns a wrapper
  // rather than the bare function: `damp` is called as a free function
  // everywhere in the repo and must not pick up a receiver.
  function globalDamp() {
    var d = global && global.SWR_AUDIO_DAMP;
    if (!d || typeof d.damp !== 'function') return null;
    return function (raw, halfLife, key) { return d.damp(raw, halfLife, key); };
  }

  var api = {
    applyReactor: applyReactor,
    baseTransform: baseTransform,
    UNIT: UNIT,
    CLAMP: CLAMP,
    UNITS: UNITS,
    TARGETS: TARGETS,
    DEFAULT_UNIT: DEFAULT_UNIT,
    clamp: clamp,
    unitFor: unitFor,
    boundsFor: boundsFor
  };

  global.SWR_REACTORS = api;
  // The bare spelling, for a page that wants the contract in one call.
  global.SWR_APPLY_REACTOR = applyReactor;
})(typeof window !== 'undefined' ? window : globalThis);