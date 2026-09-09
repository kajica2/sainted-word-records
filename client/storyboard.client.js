// client/storyboard.client.js — Storyboard Creation orchestrator.
//
// Composes SWR_SONG + SWR_STRUCTURE + SWR_TRANSITIONS_PLANNER + SWR_SHOTS
// into a single `build({ audioBuffer, library, opts })` call. Also exposes
// save/load/list helpers via SWR_STORYBOARD_DB (optional — fails gracefully
// when the DB module isn't loaded).
//
// Storyboard shape:
//
//   {
//     id: 'sb-2026-09-09T...-<rand>',
//     schemaVersion: 1,
//     createdAt: ISOString,
//     songMeta: { title?, duration, bpm, key, scale },
//     libraryId: 'lib-default',
//     seed: number,
//     opts: { cutResolution, noRepeatBars, … },
//     storyboard: {
//       profile: SongProfile,
//       scenes: StagedScene[],
//       cuts: Cut[],
//     },
//   }
//
// Public API on window.SWR_STORYBOARD:
//
//   SWR_STORYBOARD.build({ audioBuffer, library, opts? }) -> Promise<{ storyboard, profile }>
//   SWR_STORYBOARD.regenerate(prevId, opts?)              -> Promise<{ storyboard, profile }>
//   SWR_STORYBOARD.refine(storyboard, sceneId, feedback?)  -> Storyboard (mutates copy)
//   SWR_STORYBOARD.list()                                -> Array<MetaRecord>
//   SWR_STORYBOARD.load(id)                              -> Storyboard
//   SWR_STORYBOARD.save(storyboard)                      -> Promise<id>
//   SWR_STORYBOARD.delete(id)                            -> Promise<void>
//   SWR_STORYBOARD.buildSeed(songMeta, libraryId, opts)  -> number (deterministic)
//
// All inputs feed the seeded RNG so the same (audio, library, opts) tuple
// yields the same storyboard. The DB layer is opt-in.

(function () {
  'use strict';
  if (window.SWR_STORYBOARD) return;

  const SCHEMA_VERSION = 1;

  function uuid() {
    // Cheap RFC4122-ish uuid (not cryptographically random).
    return 'sb-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' +
      Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0');
  }

  function buildSeed(songMeta, libraryId, opts) {
    // FNV-1a 32-bit hash over the concatenation of inputs. Same inputs → same seed.
    const s = JSON.stringify({
      title: songMeta && songMeta.title,
      duration: songMeta && songMeta.duration,
      bpm: songMeta && songMeta.bpm,
      key: songMeta && songMeta.key,
      scale: songMeta && songMeta.scale,
      libraryId: libraryId || 'default',
      opts: opts || {},
    });
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  async function build(input) {
    if (!input || !input.audioBuffer) throw new Error('build: audioBuffer is required');
    if (!Array.isArray(input.library)) throw new Error('build: library must be an array');
    const opts = input.opts || {};
    const libId = input.libraryId || 'lib-default';

    // 1. Emotional Analysis (Task 1)
    const profile = window.SWR_SONG
      ? await window.SWR_SONG.analyze(input.audioBuffer, opts.song)
      : { bpm: 120, duration: input.audioBuffer.length / input.audioBuffer.sampleRate,
          sections: [], bars: [], moodArc: [], loudness: new Float32Array(), centroid: new Float32Array(), beatsPerBar: 4,
          downbeats: [], phrases: [], drops: [], breakdowns: [] };

    // 2. Scene Identification (Task 2)
    const scenes = window.SWR_STRUCTURE
      ? window.SWR_STRUCTURE.segment(profile, opts.structure)
      : [{ id: 'sc-001', kind: 'verse', startSec: 0, endSec: profile.duration, startBar: 0, endBar: 0, energy: 0.5, tags: { mood: 'warm', motion: 'med' }, suggestedCutEvery: '2bar' }];

    // 3. Shot Documentation (Task 4)
    const seed = opts.seed != null ? opts.seed : buildSeed(profile, libId, opts);
    const history = Array.isArray(opts.history) ? opts.history : [];
    const stagedScenes = window.SWR_SHOTS
      ? window.SWR_SHOTS.pick(scenes, input.library, profile, history, Object.assign({}, opts.shots, { seed }))
      : scenes.map(s => Object.assign({}, s, { layers: [] }));

    // 4. Transition Deconstruction (Task 3)
    const txPlan = window.SWR_TRANSITIONS_PLANNER
      ? window.SWR_TRANSITIONS_PLANNER.plan(stagedScenes, profile, opts.transitions)
      : { sceneList: stagedScenes, cuts: [] };

    const storyboard = {
      meta: {
        id: uuid(),
        schemaVersion: SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        songMeta: {
          title: opts.songTitle || null,
          duration: profile.duration,
          bpm: profile.bpm,
          key: profile.key,
          scale: profile.scale,
        },
        libraryId: libId,
        seed,
        opts: { cutResolution: (opts.transitions && opts.transitions.cutResolution) || 'auto',
                noRepeatBars: (opts.shots && opts.shots.noRepeatBars) || 8 },
      },
      storyboard: {
        profile,
        scenes: txPlan.sceneList,
        cuts: txPlan.cuts,
      },
    };

    // Pattern learning hook (optional)
    if (window.SWR_PATTERNS) {
      try { window.SWR_PATTERNS.learn(storyboard); } catch (_) { /* swallow */ }
    }

    return { storyboard, profile };
  }

  async function regenerate(prevId, opts) {
    const prev = load(prevId);
    if (!prev) throw new Error('regenerate: storyboard not found: ' + prevId);
    // Re-build with bumped seed.
    const newOpts = Object.assign({}, prev.meta.opts, opts || {}, {
      seed: (prev.meta.seed + 1) >>> 0,
    });
    // We don't have audioBuffer here — caller must supply via opts.audioBuffer.
    if (!opts || !opts.audioBuffer) throw new Error('regenerate: audioBuffer required');
    const result = await build({ audioBuffer: opts.audioBuffer, library: opts.library, libraryId: prev.meta.libraryId, opts: newOpts });
    return result;
  }

  function refine(storyboard, sceneId, feedback) {
    // v1: swap a specific scene's layers with the next best-scoring alternative.
    if (!storyboard || !storyboard.storyboard || !storyboard.storyboard.scenes) return storyboard;
    const out = JSON.parse(JSON.stringify(storyboard));
    const idx = out.storyboard.scenes.findIndex(s => s.id === sceneId);
    if (idx < 0) return storyboard;
    const sc = out.storyboard.scenes[idx];
    // Bump the seed by 1 and re-pick only this scene.
    const newSeed = (storyboard.meta.seed + (feedback && feedback.skip || 1)) >>> 0;
    if (window.SWR_SHOTS && feedback && feedback.library) {
      const oneScenePicked = window.SWR_SHOTS.pick([sc], feedback.library, out.storyboard.profile, [], { seed: newSeed });
      if (oneScenePicked.length > 0) {
        sc.layers = oneScenePicked[0].layers;
      }
    }
    out.meta.seed = newSeed;
    out.meta.refinedAt = new Date().toISOString();
    return out;
  }

  // ───── DB bridge (optional) ─────

  function list() {
    if (window.SWR_STORYBOARD_DB && window.SWR_STORYBOARD_DB.listStoryboards) {
      return window.SWR_STORYBOARD_DB.listStoryboards();
    }
    // localStorage fallback (read-only)
    try {
      const raw = localStorage.getItem('swr.storyboards.v1');
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (_) { return []; }
  }

  function load(id) {
    if (window.SWR_STORYBOARD_DB && window.SWR_STORYBOARD_DB.loadStoryboard) {
      return window.SWR_STORYBOARD_DB.loadStoryboard(id);
    }
    try {
      const raw = localStorage.getItem('swr.storyboards.v1');
      if (!raw) return null;
      const arr = JSON.parse(raw);
      return arr.find(s => s && s.meta && s.meta.id === id) || null;
    } catch (_) { return null; }
  }

  async function save(storyboard) {
    if (!storyboard || !storyboard.meta || !storyboard.meta.id) {
      throw new Error('save: storyboard missing meta.id');
    }
    if (window.SWR_STORYBOARD_DB && window.SWR_STORYBOARD_DB.saveStoryboard) {
      await window.SWR_STORYBOARD_DB.saveStoryboard(storyboard);
      return storyboard.meta.id;
    }
    // localStorage fallback
    try {
      const raw = localStorage.getItem('swr.storyboards.v1') || '[]';
      const arr = JSON.parse(raw);
      // Replace if exists
      const idx = arr.findIndex(s => s && s.meta && s.meta.id === storyboard.meta.id);
      if (idx >= 0) arr[idx] = storyboard;
      else arr.push(storyboard);
      localStorage.setItem('swr.storyboards.v1', JSON.stringify(arr));
    } catch (e) {
      // Quota exceeded etc — log but don't throw.
      console.warn('[SWR_STORYBOARD] save failed:', e);
    }
    return storyboard.meta.id;
  }

  async function deleteStoryboard(id) {
    if (window.SWR_STORYBOARD_DB && window.SWR_STORYBOARD_DB.deleteStoryboard) {
      return window.SWR_STORYBOARD_DB.deleteStoryboard(id);
    }
    try {
      const raw = localStorage.getItem('swr.storyboards.v1');
      if (!raw) return;
      const arr = JSON.parse(raw);
      const filtered = arr.filter(s => !(s && s.meta && s.meta.id === id));
      localStorage.setItem('swr.storyboards.v1', JSON.stringify(filtered));
    } catch (_) { /* swallow */ }
  }

  window.SWR_STORYBOARD = {
    build,
    regenerate,
    refine,
    list,
    load,
    save,
    delete: deleteStoryboard,
    buildSeed,
    SCHEMA_VERSION,
  };
})();
