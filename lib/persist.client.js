// lib/persist.client.js — shared localStorage persistence surface for
// the entire SWR app (engine.html + 22 versions/*.html).
//
// One set of versioned keys, one set of helpers. Pages call these
// instead of touching localStorage directly. When we swap localStorage
// for IndexedDB later (the file-bytes belong there, metadata here),
// this file is the only thing that changes.
//
// Five keys:
//
//   swr:grid:library:v1   Array of asset records (id, name, type, tags,
//                         builtIn, needsRelink). src is stored as a
//                         relative URL for built-ins ('library/<name>');
//                         null for user imports that need relink.
//
//   swr:grid:state:v1     Map<pageId, snapshot>. Each page keeps its
//                         own composition. Snapshots include the
//                         per-page selection, layer list, global
//                         controls, and presets.
//
//   swr:fx:persona:v1     Map<pageId, persona>. FX profiles (temp,
//                         vignette, grain, sepia, …) per page. Used by
//                         the stage-only pages so the FX you set on
//                         BAROQUE sticks when you come back.
//
//   swr:grid:presets:v1   Map<pageId, presets>. Per-page preset bank.
//
//   swr:grid:relink-queue:v1  Reserved for future relink-UX state.
//                              Empty by default; exported here so the
//                              reset path covers it.
//
// All reads and writes go through these versions and quotas:
//
//   - try/catch around JSON.parse: corrupted JSON falls back to the
//     supplied default rather than blowing up the page.
//   - try/catch around setItem: catches QuotaExceededError in private-
//     mode browsers; logs once, returns false, the caller keeps going.
//   - Every stored value is wrapped as {version, savedAt, payload} so we
//     have a migration point when the schema needs to change.
//
// Public API on window.SWR_GRID_PERSIST:
//   loadLibrary()            → array (possibly empty)
//   saveLibrary(arr)         → boolean
//   loadEngineState(pageId)  → snapshot | null
//   saveEngineState(pageId, snapshot)  → boolean
//   loadFxPersona(pageId)    → persona | null
//   saveFxPersona(pageId, persona)     → boolean
//   loadPresets(pageId)      → array
//   savePresets(pageId, presets)       → boolean
//   resetLocalData()         → boolean (removes all five keys)
//   exportSnapshot()         → JSON-safe object
//   importSnapshot(snapshot) → boolean
//   KEYS                     → constant map for callers that want to peek
//
// Idempotent: safe to load multiple times.

(function () {
  'use strict';
  if (window.SWR_GRID_PERSIST) return;

  const KEYS = {
    library: 'swr:grid:library:v1',
    state:   'swr:grid:state:v1',
    fx:      'swr:fx:persona:v1',
    presets: 'swr:grid:presets:v1',
    relink:  'swr:grid:relink-queue:v1',
  };

  const SCHEMA_VERSION = 1;
  let quotaWarned = false;

  // ---- low-level read / write ----

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      const v = JSON.parse(raw);
      if (!v || typeof v !== 'object') return fallback;
      return v;
    } catch (_) {
      return fallback;
    }
  }

  function write(key, payload) {
    const wrapped = { version: SCHEMA_VERSION, savedAt: Date.now(), payload };
    try {
      localStorage.setItem(key, JSON.stringify(wrapped));
      return true;
    } catch (e) {
      if (!quotaWarned) {
        quotaWarned = true;
        console.warn('[SWR_GRID_PERSIST] write failed', key, e && e.name);
      }
      return false;
    }
  }

  function payloadOf(stored) {
    if (!stored || typeof stored !== 'object') return null;
    return ('payload' in stored) ? stored.payload : stored; // future-proof
  }

  // ---- library (global, not per-page) ----

  function loadLibrary() {
    const stored = read(KEYS.library, null);
    const payload = payloadOf(stored);
    return Array.isArray(payload) ? payload : [];
  }

  function saveLibrary(arr) {
    return write(KEYS.library, Array.isArray(arr) ? arr : []);
  }

  // ---- engine state (per-page) ----

  function loadEngineState(pageId) {
    if (!pageId) return null;
    const stored = read(KEYS.state, null);
    const all = payloadOf(stored) || {};
    return all[pageId] || null;
  }

  function saveEngineState(pageId, snapshot) {
    if (!pageId) return false;
    const stored = read(KEYS.state, null);
    const all = payloadOf(stored) || {};
    all[pageId] = snapshot;
    return write(KEYS.state, all);
  }

  // ---- FX persona (per-page) ----

  function loadFxPersona(pageId) {
    if (!pageId) return null;
    const stored = read(KEYS.fx, null);
    const all = payloadOf(stored) || {};
    const pages = all.pagePersonas || {};
    return pages[pageId] || null;
  }

  function saveFxPersona(pageId, persona) {
    if (!pageId) return false;
    const stored = read(KEYS.fx, null);
    const all = payloadOf(stored) || {};
    all.pagePersonas = all.pagePersonas || {};
    all.pagePersonas[pageId] = persona;
    return write(KEYS.fx, all);
  }

  // ---- presets (per-page) ----

  function loadPresets(pageId) {
    if (!pageId) return [];
    const stored = read(KEYS.presets, null);
    const all = payloadOf(stored) || {};
    return Array.isArray(all[pageId]) ? all[pageId] : [];
  }

  function savePresets(pageId, presets) {
    if (!pageId) return false;
    const stored = read(KEYS.presets, null);
    const all = payloadOf(stored) || {};
    all[pageId] = Array.isArray(presets) ? presets : [];
    return write(KEYS.presets, all);
  }

  // ---- reset / export / import ----

  function resetLocalData() {
    try {
      Object.keys(KEYS).forEach(function (k) {
        try { localStorage.removeItem(KEYS[k]); } catch (_) {}
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function exportSnapshot() {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      library:     loadLibrary(),
      engineState: payloadOf(read(KEYS.state,   null)) || {},
      fxPersona:   payloadOf(read(KEYS.fx,      null)) || { pagePersonas: {} },
      presets:     payloadOf(read(KEYS.presets, null)) || {},
    };
  }

  function importSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    var ok = true;
    if (Array.isArray(snapshot.library)) ok = saveLibrary(snapshot.library) && ok;
    if (snapshot.engineState && typeof snapshot.engineState === 'object') ok = write(KEYS.state, snapshot.engineState) && ok;
    if (snapshot.fxPersona   && typeof snapshot.fxPersona   === 'object') ok = write(KEYS.fx,    snapshot.fxPersona)   && ok;
    if (snapshot.presets     && typeof snapshot.presets     === 'object') ok = write(KEYS.presets, snapshot.presets) && ok;
    return ok;
  }

  window.SWR_GRID_PERSIST = {
    KEYS: KEYS,
    loadLibrary:       loadLibrary,
    saveLibrary:       saveLibrary,
    loadEngineState:   loadEngineState,
    saveEngineState:   saveEngineState,
    loadFxPersona:     loadFxPersona,
    saveFxPersona:     saveFxPersona,
    loadPresets:       loadPresets,
    savePresets:       savePresets,
    resetLocalData:    resetLocalData,
    exportSnapshot:    exportSnapshot,
    importSnapshot:    importSnapshot,
    SCHEMA_VERSION:    SCHEMA_VERSION,
  };
})();
