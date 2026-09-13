// client/storyboard-shots.client.js — Shot Documentation.
//
// Given scenes (from SWR_STRUCTURE), a library (raw media items), a
// SongProfile, and a pattern history (from SWR_PATTERNS), pick a layer
// stack per scene. Pure function.
//
// Library asset shape (input):
//   {
//     id: 'lib-asset-001',
//     src: 'library/c01-rooftop.mp4',
//     kind: 'image'|'video'|'gif',
//     durationSec?: number,        // for images: default 8s
//     tags: {
//       mood?: string[],
//       palette?: string[],        // e.g. ['warm', 'cool', 'high-contrast']
//       motion?: 'low'|'med'|'high',
//       subject?: string,          // 'portrait'|'landscape'|'abstract'|...
//     },
//     allowRepeat?: boolean,       // default false (mascot rule)
//   }
//
// StagedScene shape (output — extends Scene with layers):
//   {
//     ...scene fields,
//     layers: Array<ShotLayer>,
//   }
//
// Public API on window.SWR_SHOTS:
//
//   SWR_SHOTS.pick(scenes, library, profile, history?, opts?)
//     -> StagedScene[]
//   SWR_SHOTS.score(asset, scene, historyRef, lastUsedBars) -> number
//   SWR_SHOTS.layerStackFor(kind) -> template

(function () {
  'use strict';
  if (window.SWR_SHOTS) return;

  // ───── seeded RNG (mulberry32) so the picker is deterministic ─────
  function rngFromSeed(seed) {
    let t = (seed | 0) || 1;
    return function () {
      t |= 0; t = (t + 0x6D2B79F5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ───── scoring primitives ─────

  // 0..1 if any of the asset's mood tags match the scene mood.
  function moodMatch(asset, scene) {
    if (!asset.tags || !asset.tags.mood || !scene.tags || !scene.tags.mood) return 0.5; // unknown → neutral
    return asset.tags.mood.includes(scene.tags.mood) ? 1 : 0;
  }

  // 0..1 if motion tag matches (high-energy scene prefers high-motion assets).
  function energyMatch(asset, scene) {
    if (!asset.tags || !asset.tags.motion) return 0.5;
    const motionMap = { low: 0.2, med: 0.5, high: 0.85 };
    const want = scene.energy || 0.5;
    const have = motionMap[asset.tags.motion] != null ? motionMap[asset.tags.motion] : 0.5;
    return 1 - Math.abs(want - have);
  }

  // 0..1 if palette overlap.
  function paletteMatch(asset, scene) {
    if (!asset.tags || !asset.tags.palette || !scene.tags || !scene.tags.palette) return 0.5;
    return asset.tags.palette.includes(scene.tags.palette) ? 1 : 0.3;
  }

  // Penalize if asset was used too recently. lastUsedBar: bar index of last use, or -Infinity.
  // Returns a multiplier 0..1; 0 = forbidden, 1 = no penalty.
  function recencyPenalty(asset, sceneStartBar, lastUsedBars) {
    const lastBar = lastUsedBars[asset.id];
    if (lastBar == null) return 1; // never used → no penalty
    if (asset.allowRepeat) return 1;
    const dist = sceneStartBar - lastBar;
    if (dist < 0) return 1;
    // Strong penalty at short distances so the scorer actually rotates.
    if (dist < 1) return 0;          // immediately next bar → forbidden
    if (dist < 2) return 0.001;     // 1 bar apart → near-zero
    if (dist < 4) return 0.05;
    if (dist < 8) return 0.3;
    if (dist < 16) return 0.7;
    return 1;
  }

  // Small bonus for matching scene kind (e.g. chorus prefers videos).
  function kindBonus(asset, sceneKind) {
    if (!asset.kind) return 0.5;
    const bonus = {
      'chorus':    asset.kind === 'video' ? 1 : 0.4,
      'drop':      asset.kind === 'video' ? 1 : 0.3,
      'breakdown': asset.kind === 'image' ? 1 : 0.6,
      'intro':     asset.kind === 'video' ? 0.8 : 0.7,
      'verse':     asset.kind === 'image' ? 0.9 : 0.7,
      'pre-chorus':asset.kind === 'video' ? 0.9 : 0.7,
      'bridge':    asset.kind === 'image' ? 0.8 : 0.7,
      'outro':     asset.kind === 'image' ? 0.9 : 0.6,
    };
    return bonus[sceneKind] != null ? bonus[sceneKind] : 0.5;
  }

  function score(asset, scene, lastUsedBars) {
    const rp = recencyPenalty(asset, scene.startBar, lastUsedBars);
    if (rp === 0) return -Infinity; // hard exclude — recently used
    // Use the penalty as a *multiplier* on the total, so a 0.001 penalty
    // crushes the score rather than just adding a tiny term.
    const base = moodMatch(asset, scene) * 3.0
               + energyMatch(asset, scene) * 2.0
               + paletteMatch(asset, scene) * 1.5
               + kindBonus(asset, scene.kind) * 0.5;
    return base * rp;
  }

  // ───── layer-stack templates per scene kind ─────

  function layerStackFor(kind) {
    switch (kind) {
      case 'intro':
        return [
          { role: 'background', kindPref: 'video', scale: 1.0, opacity: 1.0, blend: 'normal' },
          { role: 'foreground', kindPref: 'image', scale: 0.4, opacity: 0.85, blend: 'screen' },
        ];
      case 'verse':
        return [
          { role: 'background', kindPref: 'image', scale: 1.0, opacity: 1.0, blend: 'normal' },
          { role: 'midground',  kindPref: 'video', scale: 0.6, opacity: 0.5, blend: 'screen' },
        ];
      case 'pre-chorus':
        return [
          { role: 'background', kindPref: 'video', scale: 1.0, opacity: 0.9, blend: 'normal' },
          { role: 'midground',  kindPref: 'image', scale: 0.55, opacity: 0.65, blend: 'screen' },
          { role: 'foreground', kindPref: 'image', scale: 0.3, opacity: 0.7, blend: 'overlay' },
        ];
      case 'chorus':
        return [
          { role: 'background', kindPref: 'video', scale: 1.0, opacity: 1.0, blend: 'normal' },
          { role: 'midground',  kindPref: 'video', scale: 0.6, opacity: 0.55, blend: 'screen' },
          { role: 'foreground', kindPref: 'image', scale: 0.4, opacity: 0.75, blend: 'overlay' },
        ];
      case 'bridge':
        return [
          { role: 'background', kindPref: 'image', scale: 1.05, opacity: 0.9, blend: 'normal' },
          { role: 'midground',  kindPref: 'image', scale: 0.7, opacity: 0.5, blend: 'multiply' },
        ];
      case 'breakdown':
        return [
          { role: 'background', kindPref: 'image', scale: 1.0, opacity: 1.0, blend: 'normal' },
        ];
      case 'drop':
        return [
          { role: 'background', kindPref: 'video', scale: 1.1, opacity: 1.0, blend: 'normal' },
        ];
      case 'outro':
        return [
          { role: 'background', kindPref: 'image', scale: 1.0, opacity: 0.95, blend: 'normal' },
        ];
      default:
        return [
          { role: 'background', kindPref: 'image', scale: 1.0, opacity: 1.0, blend: 'normal' },
        ];
    }
  }

  // FX preset ID per scene kind. These map to the engine's preset-anchor-map
  // 19 anchors (film/grid/neon/etc). The render layer resolves these.
  function fxPresetFor(kind) {
    switch (kind) {
      case 'intro':      return 'film';
      case 'verse':      return 'gallery';
      case 'pre-chorus': return 'pulse';
      case 'chorus':     return 'neon';
      case 'bridge':     return 'aurora';
      case 'breakdown':  return 'smoke';
      case 'drop':       return 'glitch';
      case 'outro':      return 'kraft';
      default:           return 'grid';
    }
  }

  // Pick an asset from library for a given (scene, layer-template slot).
  function pickAssetForLayer(library, scene, slot, lastUsedBars, rand) {
    // First pass: assets whose kind matches slot.kindPref.
    let pool = library.filter(a => a.kind === slot.kindPref);
    if (pool.length === 0) pool = library.slice();
    if (pool.length === 0) return null;
    // Score each asset in the pool. Add generous jitter so different seeds
    // can shuffle the order on close-scored assets.
    const scored = pool.map(a => ({
      asset: a,
      score: score(a, scene, lastUsedBars) + rand() * 0.5,  // jitter for variety
    })).filter(s => isFinite(s.score));  // exclude hard-banned (recency=0)
    if (scored.length === 0) return pool[Math.floor(rand() * pool.length)]; // fallback
    scored.sort((a, b) => b.score - a.score);
    return scored[0].asset;
  }

  function pick(scenes, library, profile, history, opts) {
    opts = opts || {};
    const seed = opts.seed != null ? opts.seed : 1;
    const noRepeatBars = opts.noRepeatBars != null ? opts.noRepeatBars : 8;
    const rand = rngFromSeed(seed);

    const lastUsedBars = {};
    // Seed lastUsedBars from history so prior storyboards' assets get penalty.
    if (Array.isArray(history)) {
      for (const sb of history) {
        if (!sb || !sb.scenes) continue;
        for (const s of sb.scenes) {
          if (!s.layers) continue;
          for (const layer of s.layers) {
            if (layer.assetId) lastUsedBars[layer.assetId] = s.endBar;
          }
        }
      }
    }

    const staged = [];
    for (const scene of scenes) {
      const template = layerStackFor(scene.kind);
      const layers = [];
      for (const slot of template) {
        const asset = pickAssetForLayer(library, scene, slot, lastUsedBars, rand);
        if (!asset) continue;
        // Determine default transform — use the slot template.
        const layer = {
          assetId: asset.id,
          role: slot.role,
          transform: {
            scale: slot.scale,
            x: 0, y: 0,
            rotate: 0,
            opacity: slot.opacity,
          },
          fxPresetId: fxPresetFor(scene.kind),
          blend: slot.blend,
          src: asset.src,
          kind: asset.kind,
        };
        layers.push(layer);
        lastUsedBars[asset.id] = scene.endBar;
      }
      staged.push(Object.assign({}, scene, { layers }));
    }

    // Pattern reuse (preliminary v1): if we have any patterns, walk staged
    // scenes left-to-right and replace layers where a matching template exists.
    // The full pattern lookup is wired in via SWR_PATTERNS by the orchestrator
    // (storyboard.client.js). Here we expose an opt-in patternTemplates param
    // so callers can inject pattern data without SWR_PATTERNS being loaded.
    if (opts.patternTemplates) {
      applyPatterns(staged, opts.patternTemplates, library, rand, noRepeatBars);
    }

    return staged;
  }

  // Apply pattern templates to scenes whose shape matches. patternTemplates
  // is an array of { fingerprint, template: [{ role, fxPresetId, blend }] }.
  // We only borrow the *composition* (role/fx/blend), not the asset IDs.
  function applyPatterns(staged, patterns, library, rand, noRepeatBars) {
    for (const sc of staged) {
      const shape = shapeOf(sc);
      const pat = patterns.find(p => p.fingerprint === shape);
      if (!pat || !Array.isArray(pat.template) || pat.template.length === 0) continue;
      // Reset layers: re-pick assets matching the pattern's role list.
      const newLayers = [];
      for (const slot of pat.template) {
        const kindPref = slot.role === 'background' ? 'image' : 'video';
        let pool = library.filter(a => a.kind === kindPref);
        if (pool.length === 0) pool = library.slice();
        if (pool.length === 0) break;
        const asset = pool[Math.floor(rand() * pool.length)];
        newLayers.push({
          assetId: asset.id,
          role: slot.role,
          transform: { scale: 1, x: 0, y: 0, rotate: 0, opacity: 1 },
          fxPresetId: slot.fxPresetId,
          blend: slot.blend,
          src: asset.src,
          kind: asset.kind,
        });
      }
      if (newLayers.length > 0) sc.layers = newLayers;
    }
  }

  function shapeOf(scene) {
    // Crude shape fingerprint: kind + barCount (bucketized into 1-2, 3-4, 5-8, 9+)
    const barCount = (scene.endBar || 0) - (scene.startBar || 0) + 1;
    let bucket = '1-2';
    if (barCount >= 9) bucket = '9+';
    else if (barCount >= 5) bucket = '5-8';
    else if (barCount >= 3) bucket = '3-4';
    const energyBucket = scene.energy < 0.3 ? 'low' : scene.energy < 0.7 ? 'med' : 'high';
    return scene.kind + ':' + bucket + ':' + energyBucket;
  }

  window.SWR_SHOTS = {
    pick,
    score,
    layerStackFor,
    fxPresetFor,
    shapeOf,
    _internals: {
      moodMatch, energyMatch, paletteMatch, recencyPenalty, kindBonus,
      rngFromSeed, pickAssetForLayer, applyPatterns,
    },
  };
})();
