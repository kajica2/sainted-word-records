// client/storyboard-transitions.client.js — Transition Deconstruction.
//
// Given a Scene[] (from SWR_STRUCTURE.segment) and the SongProfile, decide
// which transition fires at every scene boundary and what duration to use.
// Pure function, deterministic for the same (scenes, profile, opts).
//
// Maps to the existing SWRTransitions CSS-driven transition pack:
//   whip-blur, swivel, glitch-block, chromatic-split, zoom-through,
//   flash-cover, lens-flare, paint-stroke, circle-wipe, warp-dissolve,
//   dip-to-color (synthetic — implemented as a color overlay in the
//   renderer)
//
// Public API on window.SWR_TRANSITIONS_PLANNER:
//
//   SWR_TRANSITIONS_PLANNER.plan(scenes, profile, opts?) -> {
//     sceneList: Scene[],                  // original scenes (untouched)
//     cuts: Array<Cut>,
//   }
//   SWR_TRANSITIONS_PLANNER.cutResolutionToBars(cutResolution, bpm) -> number

(function () {
  'use strict';
  if (window.SWR_TRANSITIONS_PLANNER) return;

  // Default transition matrix: [fromKind][toKind] -> { type, durationMs }
  // "*" is the wildcard for any from/to.
  const DEFAULT_MATRIX = {
    '*': {
      'intro':    { type: 'whip-blur',         durationMs: 800,  reason: 'opening sweep' },
      'verse':    { type: 'cut',               durationMs: 0,    reason: 'default bar cut' },
      'pre-chorus': { type: 'flash-cover',     durationMs: 200,  reason: 'rising tension' },
      'chorus':   { type: 'flash-cover',       durationMs: 120,  reason: 'high-energy section break' },
      'bridge':   { type: 'warp-dissolve',     durationMs: 1000, reason: 'section shift' },
      'breakdown': { type: 'dip-to-color',     durationMs: 1200, reason: 'contemplative break' },
      'drop':     { type: 'glitch-block',      durationMs: 80,   reason: 'transient drop' },
      'outro':    { type: 'dip-to-color',      durationMs: 1500, reason: 'winding down' },
    },
  };

  // Convert a cutResolution string to an approximate number of beats
  // between cuts. Used by the renderer to decide which scene boundaries
  // get additional sub-resolution cuts (e.g. every bar inside a chorus).
  function cutResolutionToBars(cutResolution, bpm) {
    if (cutResolution === 'bar') return 1;
    if (cutResolution === '2bar') return 2;
    if (cutResolution === 'phrase') return 4;
    if (cutResolution === 'chorus') return 0; // 0 = section-boundary only
    if (cutResolution === 'auto') {
      if (bpm >= 140) return 1;
      if (bpm <= 80) return 4;
      return 2;
    }
    return 2;
  }

  // Look up the transition for (from, to). from may be null (start of song).
  // Lookup order: matrix[from][to] → matrix[from]['*'] → matrix['*'][to] → matrix['*']['*']
  function lookupTransition(fromKind, toKind, matrix) {
    const fromRow = matrix[fromKind] || matrix['*'];
    if (!fromRow) return { type: 'cut', durationMs: 0, reason: 'no matrix' };
    return fromRow[toKind]
      || fromRow['*']
      || (matrix['*'] && matrix['*'][toKind])
      || (matrix['*'] && matrix['*']['*'])
      || { type: 'cut', durationMs: 0, reason: 'default' };
  }

  // Insert extra cuts inside a scene when cutResolution is finer than
  // the scene's natural length. Returns additional Cut entries.
  function subSceneCuts(scene, barsPerCut, fromSceneId, toSceneIdBase, profile) {
    if (barsPerCut <= 0) return [];
    const sceneBars = profile.bars.filter(b => b.startSec >= scene.startSec && b.startSec < scene.endSec);
    if (sceneBars.length <= barsPerCut) return [];
    const extra = [];
    for (let i = barsPerCut; i < sceneBars.length; i += barsPerCut) {
      const bar = sceneBars[i];
      extra.push({
        atBar: bar.idx,
        atSec: bar.startSec,
        fromSceneId: scene.id,
        toSceneId: scene.id,  // same scene — these are cuts within the scene
        type: 'cut',
        durationMs: 0,
        easing: 'linear',
        reason: 'sub-resolution cut inside ' + scene.kind + ' (every ' + barsPerCut + ' bars)',
      });
    }
    return extra;
  }

  function plan(scenes, profile, opts) {
    opts = opts || {};
    const matrix = opts.matrix || DEFAULT_MATRIX;
    const cutResolution = opts.cutResolution || 'auto';
    const bpm = profile && profile.bpm ? profile.bpm : 120;
    const barsPerCut = cutResolutionToBars(cutResolution, bpm);

    const cuts = [];
    let prevKind = null;
    let prevSceneId = null;

    // Walk scenes: each boundary generates a Cut.
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      if (i === 0) {
        // First scene: no incoming transition, but if there's a previous
        // scene-end transition spec, fire it (none in normal flow).
        // Optional: opening wipe.
        if (opts.openingTransition) {
          cuts.push({
            atBar: 0,
            atSec: 0,
            fromSceneId: null,
            toSceneId: sc.id,
            type: opts.openingTransition,
            durationMs: opts.openingDurationMs || 600,
            easing: 'smooth',
            reason: 'opening',
          });
        }
      } else {
        const tx = lookupTransition(prevKind, sc.kind, matrix);
        cuts.push({
          atBar: sc.startBar,
          atSec: sc.startSec,
          fromSceneId: prevSceneId,
          toSceneId: sc.id,
          type: tx.type,
          durationMs: tx.durationMs,
          easing: 'smooth',
          reason: tx.reason + ' (' + (prevKind || 'start') + ' → ' + sc.kind + ')',
        });
      }
      // Sub-resolution cuts inside this scene (every N bars).
      const subs = subSceneCuts(sc, barsPerCut, prevSceneId, sc.id, profile);
      cuts.push(...subs);
      prevKind = sc.kind;
      prevSceneId = sc.id;
    }

    return {
      sceneList: scenes,
      cuts: cuts.sort((a, b) => a.atSec - b.atSec),
    };
  }

  // ────────────── internals for the render layer ──────────────

  // At time `nowSec`, find which cut (if any) is currently active. Returns
  // { cut, progress } where progress is 0..1.
  function activeCutAt(cuts, nowSec) {
    for (const c of cuts) {
      const start = c.atSec;
      const end = start + (c.durationMs / 1000);
      if (nowSec >= start && nowSec < end) {
        return { cut: c, progress: (nowSec - start) / Math.max(0.001, end - start) };
      }
    }
    return null;
  }

  // The set of transition types we know how to drive. "cut" is a CSS no-op.
  function isNativeTransition(type) {
    if (!type) return false;
    return [
      'whip-blur', 'swivel', 'glitch-block', 'chromatic-split', 'zoom-through',
      'flash-cover', 'lens-flare', 'paint-stroke', 'circle-wipe', 'warp-dissolve',
    ].includes(type);
  }

  // Map "dip-to-color" to a flash-cover with a special semantic so the
  // renderer knows to dip to a fade overlay instead.
  const SYNTHETIC_TYPES = {
    'dip-to-color': 'flash-cover',
  };

  function normalizedType(type) {
    return SYNTHETIC_TYPES[type] || type;
  }

  window.SWR_TRANSITIONS_PLANNER = {
    plan,
    cutResolutionToBars,
    activeCutAt,
    isNativeTransition,
    normalizedType,
    _internals: {
      DEFAULT_MATRIX,
      lookupTransition,
      subSceneCuts,
    },
  };
})();
