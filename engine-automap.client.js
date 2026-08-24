// engine-automap.client.js — per-engine auto-map recipes for layer reactors
// + LFO modulators. Each recipe says "given a fresh layer in this engine
// style, attach these reactors + LFOs at these params".
//
// Auto-map reads the engine's `data-page` attribute (e.g. "neon", "aurora")
// to pick the matching recipe. Falls back to a generic "balanced" recipe
// when the page is unknown.
//
// Public API on window.SWR_AUTOMAP:
//   .getRecipe(pageId)   — return the recipe for a page id, or the fallback
//   .list()              — list every recipe (id + label + 1-line desc)
//   .apply(pageId, layer) — mutate the layer in place: clear modulators,
//                           attach reactors, attach LFOs. layer is optional;
//                           if omitted, applies to every layer in L.list.
//   .applyToAll(pageId)  — convenience: applies .apply() to every layer
//   .randomize(pageId)   — like apply() but with amount-jitter on each param
//                           so each call lands somewhere fresh within the
//                           recipe's intent (calls SWR_GENOPS.randomize()
//                           with scope=all afterward for visible variety)
//
// Engine.html itself (no data-page) gets a 'balanced' recipe that's the
// closest equivalent to what the engine's own auto-cycle would pick.
//
// Recipes are intentionally simple — 2-4 reactors + 1-2 LFOs each. The
// page already has reactive params from the audio features; auto-map is a
// way to get a tasteful starting position without manually wiring every
// reactor in every layer.

(function () {
  'use strict';
  if (window.SWR_AUTOMAP) return;

  // ---- recipes --------------------------------------------------------

  // Reactor targets are the same vocabulary as SWR_GENOPS + the LFO module's
  // `target` field: opacity | scale | x | y | hue | rot | brightness | contrast
  // Reactor features: bass | mid | treble | air | sub | rms | centroid | beat | onset
  // Reactor eases:    smooth | sharp | linear | soft

  const RECIPES = {
    // Each recipe: { label, desc, reactors: [{feature,target,scale,ease}],
    //                                          modulators: [{id,target,gain,params}] }
    // reactors and modulators arrays are non-empty — apply() does not invent
    // additional ones. Pass `null` for either to leave that dimension alone.

    neon: {
      label: 'NEON',
      desc: 'Beat-locked scale punch + glitch cluster on hue',
      reactors: [
        { feature: 'beat', target: 'scale',    scale: 0.45, ease: 'sharp' },
        { feature: 'bass', target: 'opacity',  scale: 0.30, ease: 'soft'  },
        { feature: 'rms',  target: 'brightness', scale: 0.40, ease: 'smooth'},
      ],
      modulators: [
        { id: 'lfo-cluster', target: 'hue',    gain: 0.45, params: { rateHz: 0.18, depth: 0.7 } },
      ],
    },

    aurora: {
      label: 'AURORA',
      desc: 'Soft pastel drift, slow hue morph, beat envelope',
      reactors: [
        { feature: 'centroid', target: 'hue', scale: 25, ease: 'smooth' },
        { feature: 'rms',       target: 'brightness', scale: 0.20, ease: 'soft' },
      ],
      modulators: [
        { id: 'lfo-morf',  target: 'hue',        gain: 0.4,  params: { rateHz: 0.30, depth: 0.6, morphSec: 8 } },
        { id: 'mod-atrg',  target: 'brightness', gain: 0.25, params: { tauMs: 220, depth: 0.9 } },
      ],
    },

    film: {
      label: 'FILM',
      desc: 'Cinematic: luma-driven desaturation + slow lfo-sketch drift',
      reactors: [
        { feature: 'centroid', target: 'brightness', scale: 0.25, ease: 'smooth' },
        { feature: 'bass',      target: 'y',          scale: 12,   ease: 'soft'   },
        { feature: 'rms',       target: 'scale',      scale: 0.10, ease: 'smooth' },
      ],
      modulators: [
        { id: 'lfo-sketch', target: 'x', gain: 0.5, params: { rateHz: 0.4, depth: 0.8 } },
      ],
    },

    grid: {
      label: 'GRID',
      desc: 'Beat-driven opacity + lfo-seq stepped hue',
      reactors: [
        { feature: 'beat', target: 'opacity', scale: 0.55, ease: 'sharp' },
        { feature: 'rms',  target: 'scale',    scale: 0.10, ease: 'smooth' },
      ],
      modulators: [
        { id: 'lfo-seq',     target: 'hue',     gain: 0.5,  params: { stepHz: 1.5, depth: 0.7 } },
        { id: 'lfo-cluster', target: 'scale',   gain: 0.20, params: { rateHz: 0.18, depth: 0.6 } },
      ],
    },

    smoke: {
      label: 'SMOKE',
      desc: 'Mid-band drift + soft lfo-morf hue + rms opacity',
      reactors: [
        { feature: 'mid',  target: 'scale',   scale: 0.30, ease: 'smooth' },
        { feature: 'rms',  target: 'opacity', scale: 0.45, ease: 'soft'   },
      ],
      modulators: [
        { id: 'lfo-morf', target: 'hue', gain: 0.5, params: { rateHz: 0.20, depth: 0.7, morphSec: 12 } },
      ],
    },

    eclipse: {
      label: 'ECLIPSE',
      desc: 'Sub-bass pulse + slow lfo-d3 drift',
      reactors: [
        { feature: 'sub',  target: 'scale',    scale: 0.55, ease: 'smooth' },
        { feature: 'bass', target: 'contrast', scale: 0.35, ease: 'soft'   },
      ],
      modulators: [
        { id: 'lfo-d3', target: 'x', gain: 0.45, params: { rateHz: 0.07, depth: 0.6 } },
      ],
    },

    chrome: {
      label: 'CHROME',
      desc: 'Hard treble tick + lfo-pnoise on rotation',
      reactors: [
        { feature: 'treble', target: 'scale',   scale: 0.18, ease: 'sharp' },
        { feature: 'rms',    target: 'contrast', scale: 0.40, ease: 'smooth'},
      ],
      modulators: [
        { id: 'lfo-pnoise', target: 'rot', gain: 0.4, params: { rateHz: 2.5, depth: 0.6 } },
      ],
    },

    void: {
      label: 'VOID',
      desc: 'Slow centroid-driven scale + minimal lfo-d3',
      reactors: [
        { feature: 'centroid', target: 'scale',    scale: 0.35, ease: 'smooth' },
        { feature: 'rms',      target: 'brightness', scale: 0.20, ease: 'soft' },
      ],
      modulators: [
        { id: 'lfo-d3', target: 'y', gain: 0.30, params: { rateHz: 0.05, depth: 0.5 } },
      ],
    },

    hallucination: {
      label: 'HALLUCINATION',
      desc: 'Wobble: centroid hue + lfo-cluster hue + mod-atrg on opacity',
      reactors: [
        { feature: 'centroid', target: 'hue',   scale: 30, ease: 'soft' },
        { feature: 'rms',      target: 'contrast', scale: 0.45, ease: 'smooth' },
      ],
      modulators: [
        { id: 'lfo-cluster', target: 'rot',   gain: 0.35, params: { rateHz: 0.3, depth: 0.7 } },
        { id: 'mod-atrg',    target: 'opacity', gain: 0.3, params: { tauMs: 180, depth: 0.9 } },
      ],
    },

    pulse: {
      label: 'PULSE',
      desc: 'Beat-locked scale punch + treble tick',
      reactors: [
        { feature: 'beat',   target: 'scale', scale: 0.65, ease: 'sharp' },
        { feature: 'treble', target: 'brightness', scale: 0.20, ease: 'smooth' },
      ],
      modulators: [],
    },

    fractal: {
      label: 'FRACTAL',
      desc: 'Mid-driven hue shift + lfo-rrnd random walk',
      reactors: [
        { feature: 'mid',  target: 'hue',  scale: 20,  ease: 'smooth' },
        { feature: 'rms',  target: 'scale', scale: 0.25, ease: 'soft' },
      ],
      modulators: [
        { id: 'lfo-rrnd', target: 'opacity', gain: 0.4, params: { depth: 0.7, recenterMs: 4000 } },
      ],
    },

    glitch: {
      label: 'GLITCH',
      desc: 'Onset micro-shake + mod-atrg flash + lfo-seq stepped rot',
      reactors: [
        { feature: 'onset', target: 'x',   scale: 25, ease: 'sharp' },
        { feature: 'beat',  target: 'scale', scale: 0.30, ease: 'sharp' },
      ],
      modulators: [
        { id: 'lfo-seq',  target: 'rot',     gain: 0.4, params: { stepHz: 4, depth: 0.8 } },
        { id: 'mod-atrg', target: 'contrast', gain: 0.3, params: { tauMs: 90, depth: 0.9 } },
      ],
    },

    watercolor: {
      label: 'WATERCOLOR',
      desc: 'Gentle centroid hue + lfo-morf on scale',
      reactors: [
        { feature: 'centroid', target: 'hue', scale: 18, ease: 'smooth' },
        { feature: 'rms',      target: 'brightness', scale: 0.20, ease: 'soft' },
      ],
      modulators: [
        { id: 'lfo-morf', target: 'scale', gain: 0.35, params: { rateHz: 0.15, depth: 0.5, morphSec: 14 } },
      ],
    },

    // Fallback for engine.html + any unknown data-page.
    balanced: {
      label: 'BALANCED',
      desc: 'General-purpose: beat-driven opacity + centroid hue + slow drift',
      reactors: [
        { feature: 'beat',     target: 'scale', scale: 0.30, ease: 'sharp' },
        { feature: 'centroid', target: 'hue',   scale: 18,   ease: 'smooth' },
        { feature: 'rms',      target: 'opacity', scale: 0.25, ease: 'soft' },
      ],
      modulators: [
        { id: 'lfo-cluster', target: 'hue', gain: 0.30, params: { rateHz: 0.20, depth: 0.6 } },
      ],
    },
  };

  // ---- public --------------------------------------------------------

  function getRecipe(pageId) {
    if (!pageId) return RECIPES.balanced;
    return RECIPES[pageId] || RECIPES.balanced;
  }

  function list() {
    return Object.keys(RECIPES).map(function (id) {
      return { id: id, label: RECIPES[id].label, desc: RECIPES[id].desc };
    });
  }

  // Resolve the page id from the body[data-page] attribute (set by the
  // version pages) or fall back to "balanced".
  function pageIdFromBody() {
    const body = document.body;
    if (!body) return 'balanced';
    return body.getAttribute('data-page') || 'balanced';
  }

  // Replace (not append) the layer's reactors + modulators arrays with the
  // recipe's. Idempotent: calling twice yields the same layer state.
  function apply(pageId, layer) {
    const recipe = getRecipe(pageId);
    const targets = layer ? [layer] : ((window.SWR && window.SWR.Layers && window.SWR.Layers.list) || []);
    if (!targets.length) return false;
    for (const l of targets) {
      // Build a fresh reactors array (2-4 entries). Keep any pre-existing
      // locks untouched — those are user preferences, not auto-map territory.
      l.reactors = (recipe.reactors || []).map(function (r) {
        return { feature: r.feature, target: r.target, scale: r.scale, ease: r.ease || 'smooth' };
      });
      // Build a fresh modulators array (0-2 entries).
      l.modulators = (recipe.modulators || []).map(function (m) {
        return { id: m.id, target: m.target, gain: m.gain, params: Object.assign({}, m.params || {}) };
      });
      // Mirror onto reactor/modulator keys that the timing module also reads.
      // (opacity / scale / hue / brightness / contrast are written by the
      // layer's existing applyR, but those are still computed per-frame; we
      // don't pre-bake them here.)
    }
    // If SWR_TIMING is around, re-attach so _currentOpacity/_targetOpacity
    // are valid; some recipes can leave them out of sync if the layer was
    // just freshly added.
    if (window.SWR_TIMING && typeof window.SWR_TIMING.attach === 'function') {
      for (const l of targets) window.SWR_TIMING.attach(l);
    }
    // Best-effort status message for any consumer that watches it.
    try {
      if (typeof window.setStatus === 'function') {
        window.setStatus('auto-mapped → ' + recipe.label + ' (' + targets.length + ' layer' + (targets.length === 1 ? '' : 's') + ')', 'ok');
      }
    } catch (_) {}
    return true;
  }

  function applyToAll(pageId) { return apply(pageId); }

  function randomize(pageId) {
    const ok = apply(pageId);
    if (!ok) return false;
    // Add a small amount of jitter to reactor scales so two consecutive
    // applies to the same page land on noticeably different patches.
    const factor = 0.85 + Math.random() * 0.30;  // 0.85 .. 1.15
    const list = (window.SWR && window.SWR.Layers && window.SWR.Layers.list) || [];
    for (const l of list) {
      if (Array.isArray(l.reactors)) {
        for (const r of l.reactors) r.scale = +(r.scale * factor).toFixed(3);
      }
      if (Array.isArray(l.modulators)) {
        for (const m of l.modulators) {
          if (m.gain != null) m.gain = +Math.min(1, Math.max(0, m.gain * factor)).toFixed(3);
        }
      }
    }
    try {
      if (typeof window.setStatus === 'function') {
        window.setStatus('auto-mapped (randomized) → ' + getRecipe(pageId).label, 'ok');
      }
    } catch (_) {}
    return true;
  }

  // ---- public exposure -------------------------------------------------

  window.SWR_AUTOMAP = {
    getRecipe: getRecipe,
    list: list,
    apply: apply,
    applyToAll: applyToAll,
    randomize: randomize,
    pageIdFromBody: pageIdFromBody,
    _recipes: RECIPES,
  };
})();
