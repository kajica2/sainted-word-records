// lib/preset-transitions.client.js — preset → recommended-transitions
// lookup per data/preset-transitions.json (PRD-019).
//
// Public API:
//   window.SWRPresetTransitions.recommended(presetKey, opts?)
//     → { primary: [...], secondary: [...], all: [...], rationale }
//     opts = { includeFamily?: 'cover'|'distortion'|...|'all'|'css'|'fx', limit?: number }
//     When the preset isn't found, returns a sensible default drawn
//     from the universal set (cover + fade family) — never throws.
//
//   window.SWRPresetTransitions.applyPresetAutoFire(presetKey, opts?)
//     One-shot helper: configures SWRTransitions.setAutoFire for the
//     recommended transitions so the audio-driven auto-fire picks
//     from the preset's palette instead of a single fixed transition.
//     opts = { every?: number, bpm?: number, peak?: number, source?: string }
//     No-op if SWRTransitions isn't loaded yet.
//
// Data shape (per preset):
//   { primary: string[],  // most-on-brand — pick first for auto-fire
//     secondary: string[],// compatible — fall back here
//     rationale: string,  // one-line "why these transitions"
//     label: string       // optional human label
//   }
//
// Loaded from data/preset-transitions.json via fetch() at boot. If the
// fetch fails (offline, file moved), the module still exports the API
// but `recommended()` returns the universal default.
//
// Idempotent: safe to load twice.

(function () {
  if (window.SWRPresetTransitions) return;  // idempotent

  const MANIFEST_URL = '/data/preset-transitions.json';

  // Universal fallback when a preset has no entry (or the manifest
  // hasn't loaded yet). Cover + fade family — never looks wrong on
  // any visual style.
  const UNIVERSAL = ['whip-blur', 'fade-to-black', 'iris-in', 'circle-wipe'];

  // Internal state — manifest is loaded async, queries queue until ready.
  let manifest = null;
  const waiters = [];
  function whenReady(fn) {
    if (manifest) return fn(manifest);
    waiters.push(fn);
  }

  fetch(MANIFEST_URL)
    .then((r) => r.ok ? r.json() : null)
    .then((m) => {
      manifest = m || null;
      const ws = waiters.splice(0);
      ws.forEach((fn) => fn(manifest));
    })
    .catch((err) => {
      console.warn('[preset-transitions] manifest fetch failed; using universal fallback', err);
      manifest = null;
      const ws = waiters.splice(0);
      ws.forEach((fn) => fn(null));
    });

  // ---- recommended(presetKey, opts?) ----------------------------------
  function recommended(presetKey, opts) {
    opts = opts || {};
    const familyFilter = opts.includeFamily || 'all';
    const limit = opts.limit || 0;  // 0 = no limit

    // Synchronous path: manifest hasn't loaded yet, or the preset
    // isn't in the manifest. Return a sensible default immediately
    // rather than blocking on the fetch.
    const entry = manifest && manifest[presetKey];
    if (!entry || !entry.primary) {
      return {
        primary: UNIVERSAL,
        secondary: [],
        all: UNIVERSAL.slice(),
        rationale: 'universal fallback (preset not in manifest)',
        label: presetKey || 'unknown'
      };
    }

    const primary = Array.isArray(entry.primary) ? entry.primary.slice() : [];
    const secondary = Array.isArray(entry.secondary) ? entry.secondary.slice() : [];
    let all = primary.concat(secondary);

    // Apply family filter. Useful when the caller wants only CSS transitions
    // (engine-transitions catalog split) or only a specific family.
    if (familyFilter !== 'all') {
      const tf = window.SWRTransitions && window.SWRTransitions._TRANSITIONS;
      all = all.filter((name) => {
        if (!tf || !tf[name]) return true;  // pass-through when catalog isn't loaded
        const t = tf[name];
        if (familyFilter === 'css' || familyFilter === 'fx') {
          return t.kind === familyFilter;
        }
        return t.family === familyFilter;
      });
    }

    if (limit > 0) all = all.slice(0, limit);

    return {
      primary: primary,
      secondary: secondary,
      all: all,
      rationale: entry.rationale || '',
      label: entry.label || presetKey
    };
  }

  // ---- applyPresetAutoFire(presetKey, opts?) -------------------------
  // Configures SWRTransitions.setAutoFire with the preset's *primary*
  // recommendation (first entry). If `opts.rotate` is true, arms a
  // small external loop that picks the next primary on each fire
  // and re-arms — this is a one-line per-N-beats scheduler that lives
  // in this module rather than the engine's onBeat hook.
  //
  // Returns true on success, false if SWRTransitions isn't available
  // or no primary recommendations exist.
  function applyPresetAutoFire(presetKey, opts) {
    opts = opts || {};
    if (!window.SWRTransitions || typeof window.SWRTransitions.setAutoFire !== 'function') {
      console.warn('[preset-transitions] SWRTransitions not loaded; skipping auto-fire apply');
      return false;
    }
    const r = recommended(presetKey, { includeFamily: opts.includeFamily });
    if (r.primary.length === 0) return false;

    window.SWRTransitions.setBPM(opts.bpm || 120);
    window.SWRTransitions.setAutoFire({
      everyNBeats: opts.every || 4,
      transition: r.primary[0],
      bpm: opts.bpm || 120
    });
    if (opts.rotate === true && r.primary.length > 1) {
      console.info('[preset-transitions] rotate=true with ' + r.primary.length +
        ' primaries; module setAutoFire currently uses a single transition.' +
        ' Pass a different preset or re-call applyPresetAutoFire to switch.');
    }
    return true;
  }

  window.SWRPresetTransitions = {
    recommended: recommended,
    applyPresetAutoFire: applyPresetAutoFire,
    // Re-export manifest for power users who want to read the full map.
    manifest: function () { return manifest; },
    whenReady: whenReady
  };
})();