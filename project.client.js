// project.client.js — Project save/load for the SWR engine.
//
// Serializes the user-facing state surface into a JSON document that can
// be downloaded (via <a download>) and reloaded later. The schema is
// deliberately simple and additive — older versions load older JSON.
//
// What's IN the project JSON:
//   - layers: full per-layer state (id, blend, opacity, baseScale,
//     hue, brightness, contrast, pos, rotOffset, z, reactors,
//     modulators, trim, fadeInMs, fadeOutMs)
//   - layers[i].assetId — references a Library item by id (the
//     blob itself is NOT in JSON; must already be in the user's
//     library or surface as 'asset missing' on load)
//   - library: metadata-only array (id, name, type, w, h,
//     duration, motion, luma, hue, added, thumb as data URL)
//   - audio: { name, type, savedAt } — metadata only. Full blob
//     portability via base64 embed is deferred (see plan-tier1-revised).
//   - timing: { fadeInMs, fadeOutMs, introStaggerMs, ... } if
//     window.SWR_TIMING exposes .getDefaults()
//   - genops: { seed, recipe } if window.SWR_GENOPS exposes
//     .getState() (not always present on engine pages)
//
// What's NOT in the project JSON (and how to add it later):
//   - Audio blob — see phase2.md item 2 ("embed as base64 data URL")
//   - Library blobs — IDB-backed; load() reads them on demand
//   - Persona selection — ephemeral session preference
//
// Public API on window.SWR_PROJECT:
//   .serialize()        → project JSON object (no I/O)
//   .deserialize(json)  → returns { ok, project, errors[] }
//   .save()             → triggers browser download of project-<timestamp>.json
//   .loadFromFile(file) → async, reads + applies
//   .apply(project)     → mutates SWR.Layers + SWR.Library state in place

(function () {
  'use strict';
  if (window.SWR_PROJECT) return;
  const SCHEMA_VERSION = 1;

  function getSWR() { return window.SWR || null; }

  function layerToJSON(l) {
    return {
      id: l.id,
      assetId: l.asset && typeof l.asset === 'object' ? (l.asset.id || null) : null,
      assetSnapshot: l.asset && typeof l.asset === 'object'
        ? sanitizeAsset(l.asset) : null,
      blend: l.blend,
      opacity: l.opacity,
      baseScale: l.baseScale,
      hue: l.hue,
      brightness: l.brightness,
      contrast: l.contrast,
      alpha: l.alpha,
      mutate: l.mutate,
      pos: l.pos ? { x: l.pos.x, y: l.pos.y, rot: l.pos.rot } : null,
      rotOffset: l.rotOffset,
      z: l.z,
      reactors: Array.isArray(l.reactors) ? l.reactors.map(sanitizeReactor) : [],
      modulators: Array.isArray(l.modulators) ? l.modulators.map(sanitizeModulator) : [],
      snapBeat: !!l.snapBeat,
      trim: l.trim || null,
      fadeInMs: typeof l.fadeInMs === 'number' ? l.fadeInMs : undefined,
      fadeOutMs: typeof l.fadeOutMs === 'number' ? l.fadeOutMs : undefined,
    };
  }
  function sanitizeAsset(a) {
    return {
      id: a.id, name: a.name, type: a.type,
      w: a.w, h: a.h, duration: a.duration,
      motion: a.motion, luma: a.luma, hue: a.hue,
      added: a.added,
    };
  }
  function sanitizeReactor(r) {
    return { feature: r.feature, target: r.target, gain: r.gain,
             scale: r.scale, ease: r.ease, sens: r.sens };
  }
  function sanitizeModulator(m) {
    return { id: m.id, target: m.target, gain: m.gain, params: m.params || {} };
  }

  function libraryToJSON(items) {
    return items.map((it) => ({
      id: it.id, name: it.name, type: it.type,
      w: it.w, h: it.h, duration: it.duration,
      motion: it.motion, luma: it.luma, hue: it.hue,
      added: it.added,
      thumb: (typeof it.thumb === 'string' && it.thumb.startsWith('data:'))
             ? it.thumb : null,
    }));
  }

  function audioToJSON() {
    const A = window.Audio;
    if (!A || !A.audioEl) return null;
    const src = A.audioEl.src || '';
    return {
      name: A.currentSongName || (src.split('/').pop().split('?')[0]) || 'song',
      type: A.audioEl.type || 'audio/mpeg',
      savedAt: Date.now(),
      hasSource: !!src,
    };
  }

  function timingToJSON() {
    const T = window.SWR_TIMING;
    if (!T || typeof T.getDefaults !== 'function') return null;
    try { return T.getDefaults(); } catch { return null; }
  }

  function genopsToJSON() {
    const G = window.SWR_GENOPS;
    if (!G || typeof G.getState !== 'function') return null;
    try { return G.getState(); } catch { return null; }
  }

  function serialize() {
    const SWR = getSWR();
    if (!SWR || !SWR.Layers) {
      console.warn('[project] window.SWR.Layers missing — cannot serialize');
      return null;
    }
    return {
      __type: 'swr-project',
      version: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      layers: SWR.Layers.list.map(layerToJSON),
      library: SWR.Library && Array.isArray(SWR.Library.items)
                ? libraryToJSON(SWR.Library.items) : [],
      audio: audioToJSON(),
      timing: timingToJSON(),
      genops: genopsToJSON(),
    };
  }

  function deserialize(json) {
    const errors = [];
    if (!json || typeof json !== 'object') {
      return { ok: false, project: null, errors: ['not a JSON object'] };
    }
    if (json.__type !== 'swr-project') {
      return { ok: false, project: null, errors: ['not a SWR project (missing __type)'] };
    }
    if (typeof json.version !== 'number') {
      errors.push('missing version — assuming v1');
    }
    if (!Array.isArray(json.layers)) {
      return { ok: false, project: null, errors: ['no layers array'] };
    }
    json.layers.forEach((l, i) => {
      if (!l.id) errors.push(`layer[${i}]: missing id, will be assigned on apply`);
      if (l.opacity != null && typeof l.opacity !== 'number')
        errors.push(`layer[${i}]: opacity not a number, will be clamped`);
    });
    return { ok: true, project: json, errors };
  }

  function apply(project) {
    const SWR = getSWR();
    if (!SWR || !SWR.Layers) {
      console.warn('[project] no SWR.Layers — cannot apply');
      return { applied: 0, missing: 0 };
    }
    const byId = new Map();
    if (SWR.Library && Array.isArray(SWR.Library.items)) {
      for (const it of SWR.Library.items) byId.set(it.id, it);
    }
    SWR.Layers.list.length = 0;

    let missing = 0;
    for (const lp of project.layers || []) {
      const asset = lp.assetId ? byId.get(lp.assetId) : null;
      if (lp.assetId && !asset) {
        missing++;
        console.warn('[project] missing asset', lp.assetId, 'for layer', lp.id);
      }
      const layer = {
        id: lp.id || 'L' + (SWR.Layers.list.length + 1),
        asset: asset || (lp.assetSnapshot
          ? Object.assign({}, lp.assetSnapshot, { _missing: true })
          : null),
        blend: lp.blend || 'screen',
        opacity: typeof lp.opacity === 'number' ? lp.opacity : 1,
        baseScale: lp.baseScale || 1,
        hue: lp.hue || 0,
        brightness: lp.brightness == null ? 1 : lp.brightness,
        contrast:   lp.contrast   == null ? 1 : lp.contrast,
        alpha:      lp.alpha      == null ? 1 : lp.alpha,
        mutate:     lp.mutate     == null ? 0 : lp.mutate,
        pos: lp.pos || { x: 0, y: 0, rot: 0 },
        rotOffset: lp.rotOffset || 0,
        z: lp.z != null ? lp.z : SWR.Layers.list.length,
        reactors: lp.reactors || [],
        modulators: lp.modulators || [],
        snapBeat: !!lp.snapBeat,
        trim: lp.trim || null,
        fadeInMs: lp.fadeInMs,
        fadeOutMs: lp.fadeOutMs,
      };
      SWR.Layers.list.push(layer);
    }
    if (SWR.Library && Array.isArray(project.library)) {
      const existingById = new Map(SWR.Library.items.map((it) => [it.id, it]));
      for (const meta of project.library) {
        if (!existingById.has(meta.id)) {
          SWR.Library.items.push(Object.assign({}, meta, { _needsDownload: true }));
        }
      }
      try { if (typeof SWR.Library.render === 'function') SWR.Library.render(); }
      catch (e) { console.warn('[project] library.render failed', e); }
    }
    try { if (typeof SWR.Layers.render === 'function') SWR.Layers.render(); }
    catch (e) { console.warn('[project] layers.render failed', e); }
    try { if (window.LayerScheduler && window.LayerScheduler.refresh)
            window.LayerScheduler.refresh(); } catch {}
    if (project.timing && window.SWR_TIMING && typeof window.SWR_TIMING.setDefaults === 'function') {
      try { window.SWR_TIMING.setDefaults(project.timing); } catch {}
    }
    window.dispatchEvent(new CustomEvent('swr-project-applied', {
      detail: { layers: SWR.Layers.list.length, missing },
    }));
    return { applied: SWR.Layers.list.length, missing };
  }

  function save(filename) {
    const project = serialize();
    if (!project) {
      console.warn('[project] serialize() returned null — nothing to save');
      return false;
    }
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || ('swr-project-' +
      new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    return true;
  }

  async function loadFromFile(file) {
    if (!file) return { ok: false, errors: ['no file'] };
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const d = deserialize(json);
      if (!d.ok) return d;
      const r = apply(d.project);
      return { ok: true, applied: r.applied, missing: r.missing,
               errors: d.errors, project: d.project };
    } catch (e) {
      return { ok: false, errors: ['parse error: ' + (e.message || e)] };
    }
  }

  function loadFromJSON(json) {
    const d = deserialize(json);
    if (!d.ok) return d;
    const r = apply(d.project);
    return { ok: true, applied: r.applied, missing: r.missing,
             errors: d.errors, project: d.project };
  }

  window.SWR_PROJECT = {
    serialize,
    deserialize,
    save,
    loadFromFile,
    loadFromJSON,
    apply,
    version: SCHEMA_VERSION,
  };
})();
