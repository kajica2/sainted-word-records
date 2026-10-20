// lib/ease.js - the one shared reactor easing curve map (plan P1.4).
//
// `function ease(name, t)` was copy-pasted into 15 variant pages under
// versions/, in three subtly different bodies:
//
//   flavor A (aurora, chrome, fractal, glitch, music_video,
//             music_video_mtv, neon, pulse, void, watercolor)
//     soft -> {0:0, 0.5:0.5, 1:1}[((t*2)|0)/2] || (t*t*(3-2*t))
//     That lookup is not a curve. For every t in [0.5, 1) the index
//     resolves to 0.5, the lookup returns a truthy 0.5, the `||` fallback
//     never fires, and `soft` returns a CONSTANT 0.5 across the whole upper
//     half of the range. The intended curve is the fallback that never ran:
//     smoothstep, t*t*(3-2*t).
//
//   flavor B (grid, hallucination, smoke) and flavor C (film, eclipse)
//     soft -> t*t*(3-2*t); everything else falls through to identity.
//     B and C are behaviorally identical: `if (name === 'smooth') return t`
//     is a no-op sitting in front of a trailing `return t`.
//
// This module is flavor B/C, which is also what flavor A meant to write.
// So the only behavior change the extraction makes is that A's 10 pages stop
// freezing `soft` at 0.5 once the input passes the midpoint. Every other
// name on every page is bit-identical.
//
// The enum actually in use across the repo (reactor configs are
// user-authored JSON in engine.html, engine-automap.client.js and each
// variant page):
//
//   soft        smoothstep, the S-curve. The default spelling for `soft`.
//   smoothstep  alias of `soft`, for callers that want the curve by name.
//   sharp       Math.pow(t, 0.4): rises fast off the floor, then flattens.
//   smooth      identity.
//   release     identity in all 15 original bodies. None of them had a
//               `release` branch - it fell through the trailing `return t`
//               - yet engine.html ships 20 `ease: 'release'` reactors, so
//               it is named explicitly here instead of being left to an
//               accident that a future edit could easily break.
//   none        identity, the explicit "do not ease" spelling.
//
// Unknown names fall back to identity, which is what every one of the 15
// bodies did. Reactor configs come from disk and from users, so a typo must
// not throw.
//
// The lookup goes through hasOwnProperty rather than a bare `MAP[name]`
// because a bare lookup on an object literal resolves inherited keys -
// `ease('constructor', 0.5)` would return Object's constructor instead of
// a curve, and `ease('toString', 0.5)` would return a string.
//
// Loading. This is a blocking (non-defer) CLASSIC script on purpose, and
// the tag must not carry type="module":
//
//   - The variant pages bind `const ease = window.SWR_EASE.ease` from a
//     classic inline <script> that runs at parse time. A `defer` tag would
//     land after that script had already read the global.
//   - vite.config.js's `strip-absolute-module-scripts` plugin rewrites
//     `<script type="module" src="/...">` into a plain defer classic
//     script, so an ESM tag would be stripped into a SyntaxError at load.
//
// The root-absolute path `/lib/ease.js` resolves from every surface that
// needs it: /versions/<id>.html, /engine/, and the dist build (vite's
// copy-static plugin copies the whole lib/ directory).

(function (global) {
  'use strict';

  var IDENTITY = function (t) { return t; };
  var SMOOTHSTEP = function (t) { return t * t * (3 - 2 * t); };
  var SHARP = function (t) { return Math.pow(t, 0.4); };

  var MAP = {
    soft: SMOOTHSTEP,
    smoothstep: SMOOTHSTEP,
    sharp: SHARP,
    smooth: IDENTITY,
    release: IDENTITY,
    none: IDENTITY
  };

  function has(name) {
    return Object.prototype.hasOwnProperty.call(MAP, name);
  }

  function ease(name, t) {
    return has(name) ? MAP[name](t) : IDENTITY(t);
  }

  // Both spellings work: `window.SWR_EASE(name, t)` and the
  // `window.SWR_EASE.ease` the variant pages bind. The second one is not
  // redundant - the pages destructure `.ease`, so without it every
  // `const ease = window.SWR_EASE.ease;` binds undefined and applyR() only
  // fails later, at render time, on the first layer with a reactor, behind
  // SWR_RENDER.frame()'s try/catch, which skips the layer silently.
  ease.ease = ease;
  ease.MAP = MAP;
  ease.FALLBACK = IDENTITY;
  ease.names = Object.keys(MAP);
  ease.has = has;

  global.SWR_EASE = ease;
  global.SWR_EASE_MAP = MAP;
})(typeof window !== 'undefined' ? window : globalThis);