// client/preset-anchor-map.client.js
//
// Maps the engine's 19 named presets (film, grid, neon, smoke, hallucination,
// eclipse, aurora, chrome, fractal, glitch, pulse, void, watercolor,
// baroque, gallery, kraft, mosaic, phosphor, tape) into a 2D gradient
// space (warmth × intensity) so the music_video page can render them as
// anchor dots and blend them by proximity to the current track.
//
// Why 2D and not N-dimensional: the user sees and reasons about a 2D
// canvas. The synth table (Phase C) maps audio features onto the same
// axes, so a dropped track lands at coordinates that are visually
// comparable to a preset's coordinates. "How close is this track to
// `film`?" becomes a distance check on this canvas.
//
// Why we don't store warmth/intensity in presets/manifest.json: the
// 19 presets are defined in versions-presets.js with their own schema
// (temp, mut, chroma, sepia, grain, glow, etc.) — adding a new field
// would mean migrating the manifest and re-rendering the GLSL presets.
// The embedding is computed once on page boot and cached.

(function () {
  'use strict';
  if (window.SWR_ANCHOR_MAP) return;

  // ---- Embedding formula ----------------------------------------------
  // warmth  = sepia warmth + temperature warmth + a small chroma warmth
  //           component. Negative temp (cool presets like neon) maps to
  //           warmth = 0 — the formula only counts *positive* warmth
  //           because cold/blue is the absence of warmth, not its
  //           opposite. (The horizontal axis reads left→right as
  //           cool→warm.)
  //
  // intensity = a weighted blend of mut, grain, chroma, posterize, and a
  //           small inverse-glow term. mut dominates because the
  //           mutAlgo effect is the single biggest perceptual "intensity
  //           lever" in the GLSL presets.
  //
  // The raw values are then blended 60/40 with the within-population
  // rank percentile so the cluster spreads across the full 0..1 range
  // even when the absolute values cluster in one quadrant. The 60/40
  // split keeps the raw ordering meaningful (a cool preset never
  // becomes warmer than a warm one) while spreading the visual layout.
  function rawEmbed(p) {
    var warmth =
      Math.max(0, p.sepia || 0) * 0.7 +
      Math.max(0, p.temp || 0) * 0.6 +
      Math.max(0, p.chroma || 0) * 0.1;
    var intensity =
      (p.mut || 0) * 0.45 +
      (p.grain || 0) * 0.25 +
      (p.chroma || 0) * 0.15 +
      (p.posterize || 0) * 0.10 +
      (1 - (p.glow || 0)) * 0.05;
    return {
      warmth: Math.max(0, Math.min(1, warmth)),
      intensity: Math.max(0, Math.min(1, intensity)),
    };
  }

  // 19 GLSL presets — mirrors versions-presets.js. Keep in sync if a
  // page is added or a field changes.
  var PRESETS = {
    film:          { temp:  0.3,  mut: 0.20, sepia: 0.70, chroma: 0.0,  grain: 0.85, glow: 0.15, grayscale: 0.0,  posterize: 0.0  },
    grid:          { temp:  0.0,  mut: 0.85, sepia: 0.0,  chroma: 0.0,  grain: 0.10, glow: 0.0,  grayscale: 1.0,  posterize: 0.95 },
    neon:          { temp: -0.3,  mut: 0.55, sepia: 0.0,  chroma: 0.85, grain: 0.40, glow: 0.4,  grayscale: 0.0,  posterize: 0.10 },
    smoke:         { temp:  0.2,  mut: 0.15, sepia: 0.35, chroma: 0.0,  grain: 0.15, glow: 0.4,  grayscale: 0.0,  posterize: 0.0  },
    hallucination: { temp: -0.5,  mut: 0.95, sepia: 0.0,  chroma: 1.0,  grain: 0.90, glow: 0.5,  grayscale: 0.0,  posterize: 0.0  },
    eclipse:       { temp: -0.15, mut: 0.10, sepia: 0.0,  chroma: 0.2,  grain: 0.20, glow: 0.85, grayscale: 0.0,  posterize: 0.15 },
    aurora:        { temp: -0.2,  mut: 0.25, sepia: 0.0,  chroma: 0.2,  grain: 0.05, glow: 0.55, grayscale: 0.0,  posterize: 0.0  },
    chrome:        { temp: -0.05, mut: 0.05, sepia: 0.0,  chroma: 0.3,  grain: 0.05, glow: 0.45, grayscale: 0.25, posterize: 0.20 },
    fractal:       { temp:  0.0,  mut: 0.40, sepia: 0.0,  chroma: 0.6,  grain: 0.35, glow: 0.3,  grayscale: 0.0,  posterize: 0.30 },
    glitch:        { temp:  0.0,  mut: 0.90, sepia: 0.0,  chroma: 0.7,  grain: 0.50, glow: 0.1,  grayscale: 0.0,  posterize: 0.35 },
    pulse:         { temp: -0.2,  mut: 0.10, sepia: 0.0,  chroma: 0.15, grain: 0.15, glow: 0.4,  grayscale: 0.0,  posterize: 0.0  },
    void:          { temp: -0.45, mut: 0.05, sepia: 0.0,  chroma: 0.05, grain: 0.55, glow: 0.1,  grayscale: 0.4,  posterize: 0.60 },
    watercolor:    { temp:  0.15, mut: 0.05, sepia: 0.10, chroma: 0.05, grain: 0.20, glow: 0.3,  grayscale: 0.0,  posterize: 0.10 },
    baroque:       { temp:  0.2,  mut: 0.0,  sepia: 0.30, chroma: 0.0,  grain: 0.10, glow: 0.2,  grayscale: 0.0,  posterize: 0.0  },
    gallery:       { temp:  0.0,  mut: 0.0,  sepia: 0.0,  chroma: 0.0,  grain: 0.0,  glow: 0.0,  grayscale: 0.0,  posterize: 0.0  },
    kraft:         { temp:  0.1,  mut: 0.0,  sepia: 0.50, chroma: 0.0,  grain: 0.35, glow: 0.0,  grayscale: 0.0,  posterize: 0.10 },
    mosaic:        { temp: -0.1,  mut: 0.0,  sepia: 0.0,  chroma: 0.2,  grain: 0.10, glow: 0.2,  grayscale: 0.0,  posterize: 0.40 },
    phosphor:      { temp: -0.3,  mut: 0.0,  sepia: 0.0,  chroma: 0.0,  grain: 0.10, glow: 0.5,  grayscale: 0.3,  posterize: 0.20 },
    tape:          { temp:  0.05, mut: 0.10, sepia: 0.10, chroma: 0.2,  grain: 0.30, glow: 0.1,  grayscale: 0.0,  posterize: 0.10 },
  };

  // Compute raw embeddings and rank-normalize in one pass.
  function buildAnchorMap() {
    var raw = {};
    var ids = Object.keys(PRESETS);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      raw[id] = rawEmbed(PRESETS[id]);
    }

    // Rank percentile by warmth ascending, by intensity ascending.
    var byW = ids.slice().sort(function (a, b) { return raw[a].warmth - raw[b].warmth; });
    var byI = ids.slice().sort(function (a, b) { return raw[a].intensity - raw[b].intensity; });
    var wRank = {}, iRank = {};
    for (var j = 0; j < byW.length; j++) wRank[byW[j]] = j / Math.max(1, byW.length - 1);
    for (var k = 0; k < byI.length; k++) iRank[byI[k]] = k / Math.max(1, byI.length - 1);

    // 60% raw + 40% rank — keeps raw ordering but spreads visually.
    var anchors = {};
    for (var m = 0; m < ids.length; m++) {
      var id2 = ids[m];
      anchors[id2] = {
        warmth:    raw[id2].warmth    * 0.6 + wRank[id2] * 0.4,
        intensity: raw[id2].intensity * 0.6 + iRank[id2] * 0.4,
        preset:    PRESETS[id2],
      };
    }
    return anchors;
  }

  // Public API ----------------------------------------------------------------
  //
  // window.SWR_ANCHOR_MAP.list()  → string[] of preset ids
  // window.SWR_ANCHOR_MAP.get(id) → { warmth, intensity, preset } | null
  // window.SWR_ANCHOR_MAP.embed(presetObj) → { warmth, intensity }
  //        — for any preset-like object (synthesized, manifest, anchor)
  //          that has the same fx_state fields as PRESETS. Synthesized
  //          presets use this so they can be plotted on the same canvas.
  // window.SWR_ANCHOR_MAP.neighbours(coords, n) → [{ id, dist, anchor }, …]
  //        — sorted ascending by euclidean distance to (warmth, intensity)
  //          in the 2D space. n defaults to 4.
  var ANCHORS = buildAnchorMap();

  window.SWR_ANCHOR_MAP = {
    list: function () { return Object.keys(PRESETS); },
    get: function (id) { return ANCHORS[id] || null; },
    embed: function (p) { return rawEmbed(p); },
    // Embed a fully-derived preset (raw fx_state values, not rank-blended)
    // so a synthesized preset can be placed on the same canvas as the
    // rank-spread anchors. To keep synthesized presets visually
    // comparable, callers may add a small rank-bias here too — but the
    // synth preset's raw values are what users perceive, so we leave
    // the embedding raw and let the rank-bias live only on the anchors.
    rawEmbed: rawEmbed,
    neighbours: function (coords, n) {
      n = n || 4;
      var ids = Object.keys(ANCHORS);
      var withDist = [];
      for (var i = 0; i < ids.length; i++) {
        var a = ANCHORS[ids[i]];
        var dx = a.warmth - coords.warmth;
        var dy = a.intensity - coords.intensity;
        withDist.push({ id: ids[i], dist: Math.sqrt(dx * dx + dy * dy), anchor: a });
      }
      withDist.sort(function (a, b) { return a.dist - b.dist; });
      return withDist.slice(0, n);
    },
    // For tests + diagnostics
    _all: function () { return ANCHORS; },
    _rawEmbed: rawEmbed,
  };
})();
