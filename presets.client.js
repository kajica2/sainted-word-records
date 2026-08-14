// presets.client.js — engine-side manifest fetch + diff + apply.
// Phase 2 of the self-evolving engine roadmap.
//
// Public API on window.SWR_PRESETS:
//   .load()                  — fetch + parse manifest, return {known, new, all}
//   .getAll()                — return the cached manifest (or [] if not loaded)
//   .getNew()                — return only the presets the user hasn't seen yet
//   .markSeen(id)            — add to localStorage['swr.presets.known']
//   .markAllSeen()           — mark every loaded preset as seen
//   .apply(id)               — apply preset to the engine (fx_state + palette)
//   .isAvailable()           — true if the engine state is ready for apply
//
// Events:
//   swr-presets-loaded   — { manifest, new: [...], known: [...] }
//   swr-preset-applied   — { id, preset }
//   swr-presets-error    — { error, stage }

(function () {
  'use strict';
  if (window.SWR_PRESETS) return;

  const MANIFEST_URL = '/presets/manifest.json';
  const LS_KNOWN = 'swr.presets.known';
  const LS_LAST_SEEN = 'swr.presets.lastSeenAt';

  const state = {
    manifest: null,
    known: new Set(),
    lastFetchedAt: null,
  };

  function readKnown() {
    try {
      const raw = localStorage.getItem(LS_KNOWN);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) {
      return new Set();
    }
  }

  function writeKnown(s) {
    try { localStorage.setItem(LS_KNOWN, JSON.stringify([...s])); } catch (_) {}
  }

  // The engine's FX object exposes set* methods for these 14 keys. 'bloom'
  // from the daily preset spec is acknowledged in the manifest but skipped
  // at apply time (the engine has no setBloom — bloom is part of the
  // compositor, not the post-FX). It's a future enhancement to add it.
  const FX_SETTER = {
    liquid: 'setLiquid', pearl: 'setPearl', glitch: 'setGlitch',
    grain: 'setGrain', chroma: 'setChroma', vignette: 'setVignette',
    sepia: 'setSepia', glow: 'setGlow', grayscale: 'setGrayscale',
    blur: 'setBlur', mut: 'setMut', mutAlgo: 'setAlgo',
    temp: 'setTemp', posterize: 'setPosterize',
  };

  function applyPresetFx(fxState) {
    if (!window.FX) return { applied: 0, skipped: ['bloom'].length };
    let applied = 0;
    const skipped = [];
    for (const k of Object.keys(fxState)) {
      const method = FX_SETTER[k];
      if (!method || typeof window.FX[method] !== 'function') {
        skipped.push(k);
        continue;
      }
      const v = fxState[k];
      try {
        if (k === 'posterize') {
          // posterize on engine is 0..1 (slider), not 1..16 (spec)
          window.FX[method](Math.max(0, Math.min(1, Number(v) / 16)));
        } else if (k === 'mutAlgo') {
          window.FX[method](Math.round(Number(v)));
        } else {
          window.FX[method](Number(v));
        }
        applied += 1;
      } catch (e) {
        skipped.push(k + ':' + e.message);
      }
    }
    return { applied, skipped };
  }

  function applyPresetPalette(palette) {
    if (!palette) return;
    const root = document.documentElement;
    if (palette.bg)        root.style.setProperty('--bg-1', palette.bg);
    if (palette.primary)   root.style.setProperty('--accent', palette.primary);
    if (palette.secondary) root.style.setProperty('--accent-2', palette.secondary);
    if (palette.accent)    root.style.setProperty('--gold', palette.accent);
  }

  function apply(id) {
    if (!state.manifest) return { ok: false, error: 'manifest not loaded' };
    const preset = state.manifest.presets.find(p => p.id === id);
    if (!preset) return { ok: false, error: 'preset not found: ' + id };
    const fxResult = applyPresetFx(preset.fx_state || {});
    applyPresetPalette(preset.palette);
    try { localStorage.setItem(LS_LAST_SEEN, JSON.stringify({ id, at: Date.now() })); } catch (_) {}
    window.dispatchEvent(new CustomEvent('swr-preset-applied', { detail: { id, preset, fxResult } }));
    if (typeof setStatus === 'function') {
      setStatus('applied preset: ' + preset.name + (fxResult.skipped.length ? ' (' + fxResult.skipped.length + ' skipped)' : ''), 'ok');
    }
    return { ok: true, preset, fxResult };
  }

  async function load() {
    state.known = readKnown();
    let manifest;
    try {
      const r = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      manifest = await r.json();
    } catch (e) {
      const err = { error: String(e), stage: 'fetch' };
      window.dispatchEvent(new CustomEvent('swr-presets-error', { detail: err }));
      return { ok: false, error: e };
    }
    if (!manifest || !Array.isArray(manifest.presets)) {
      const err = { error: 'manifest missing presets array', stage: 'parse' };
      window.dispatchEvent(new CustomEvent('swr-presets-error', { detail: err }));
      return { ok: false, error: err };
    }
    state.manifest = manifest;
    state.lastFetchedAt = new Date().toISOString();
    const all = manifest.presets;
    const known = all.filter(p => state.known.has(p.id));
    const fresh = all.filter(p => !state.known.has(p.id));
    window.dispatchEvent(new CustomEvent('swr-presets-loaded', { detail: { manifest, all, known, fresh } }));
    return { ok: true, all, known, fresh };
  }

  function getAll() { return state.manifest ? state.manifest.presets : []; }
  function getNew() {
    if (!state.manifest) return [];
    return state.manifest.presets.filter(p => !state.known.has(p.id));
  }
  function markSeen(id) { state.known.add(id); writeKnown(state.known); }
  function markAllSeen() {
    if (!state.manifest) return;
    state.manifest.presets.forEach(p => state.known.add(p.id));
    writeKnown(state.known);
  }
  function isAvailable() {
    return !!(window.FX && typeof window.FX.setTemp === 'function');
  }

  window.SWR_PRESETS = { load, getAll, getNew, markSeen, markAllSeen, apply, isAvailable, _state: state };
})();
