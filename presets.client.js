// presets.client.js — engine-side manifest fetch + diff + apply.
// Phase 2 (daily pipeline ingest) + Phase 3 (on-device evolved variants).
//
// Public API on window.SWR_PRESETS:
//   .load()                  — fetch manifest + read local variants, return {all, fresh, known}
//   .getAll()                — return all loaded presets (manifest + local variants)
//   .getNew()                — return only the ones the user hasn't seen yet
//   .markSeen(id)            — add to localStorage['swr.presets.known']
//   .markAllSeen()           — mark every loaded preset as seen
//   .apply(id)               — apply preset to the engine (fx_state + palette)
//   .isAvailable()           — true if the engine state is ready for apply
//
// Events:
//   swr-presets-loaded   — { manifest, localVariants, all, fresh, known }
//   swr-preset-applied   — { id, preset, fxResult }
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
    const all = getAll();
    if (all.length === 0) return { ok: false, error: 'no presets loaded' };
    const preset = all.find(p => p.id === id);
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

  let loadInFlight = null;
  async function load() {
    // Dedupe concurrent loads — if a load is already running, return its
    // result. Prevents the panel from being torn down + rebuilt when both
    // the explicit verifier load and the auto-load fire in quick succession.
    if (loadInFlight) return loadInFlight;
    state.known = readKnown();
    loadInFlight = (async () => {
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

    // Phase 3: also read on-device evolved variants from localStorage
    const localVariants = (window.SWR_PRESETS_EVOLVE && window.SWR_PRESETS_EVOLVE.getVariants)
      ? window.SWR_PRESETS_EVOLVE.getVariants()
      : [];

    // Manifest + local variants, with de-dupe (local variants win on conflict)
    const seen = new Set();
    const all = [];
    for (const v of localVariants) {
      if (v && v.id && !seen.has(v.id)) { all.push(v); seen.add(v.id); }
    }
    for (const p of manifest.presets) {
      if (p && p.id && !seen.has(p.id)) { all.push(p); seen.add(p.id); }
    }

    const known = all.filter(p => state.known.has(p.id));
    const fresh = all.filter(p => !state.known.has(p.id));
    window.dispatchEvent(new CustomEvent('swr-presets-loaded', { detail: { manifest, localVariants, all, known, fresh } }));
    return { ok: true, all, known, fresh, localVariants };
    })();
    try { return await loadInFlight; } finally { loadInFlight = null; }
  }

  function getAll() {
    // Re-merge local variants on each call so a freshly generated variant
    // is visible without needing to re-run load().
    const local = (window.SWR_PRESETS_EVOLVE && window.SWR_PRESETS_EVOLVE.getVariants)
      ? window.SWR_PRESETS_EVOLVE.getVariants() : [];
    const seen = new Set();
    const out = [];
    for (const v of local)        { if (v && v.id && !seen.has(v.id)) { out.push(v); seen.add(v.id); } }
    if (state.manifest) {
      for (const p of state.manifest.presets) {
        if (p && p.id && !seen.has(p.id)) { out.push(p); seen.add(p.id); }
      }
    }
    return out;
  }
  function getNew() {
    return getAll().filter(p => !state.known.has(p.id));
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

  // Self-load on DOMContentLoaded. The engine.html also has a backup load
  // listener with a 800ms delay, but the module scripts (which define
  // window.SWR_PRESETS) are async — that listener can fire before we're
  // defined. This self-load is the primary path.
  function selfLoad() {
    setTimeout(() => { load().catch(() => {}); }, 400);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', selfLoad, { once: true });
  } else {
    selfLoad();
  }
})();
