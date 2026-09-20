// client/stats.client.js
//
// Local render statistics tracker. Records every render's
// { ts, durationMs, ext, size } in localStorage and exposes a
// summary() suitable for a modal widget. No backend; pure local.
//
// Extracted from versions/music_video.html:2789-2854 (Phase 1b).
//
// Public API on window.SWR_STATS:
//   record(durationMs, ext, size)   → render entry
//   summary()                       → { totalRenders, last30Count,
//                                       totalMinutes, last30Minutes,
//                                       totalSizeMB, lastPreset, recent }
//   setPreset(presetId)             Track last preset used
//   reset()                         Wipe all stats
//   STORAGE_KEY                     'swr.stats.v1'

(function () {
  'use strict';
  if (window.SWR_STATS) return;

  var stats = {
    STORAGE_KEY: 'swr.stats.v1',

    _load() {
      try {
        var raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return { renders: [], lastPreset: null };
        return JSON.parse(raw);
      } catch (_) {
        return { renders: [], lastPreset: null };
      }
    },

    _save(data) {
      try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
    },

    record(durationMs, ext, size) {
      var data = this._load();
      var render = {
        ts: Date.now(),
        durationMs: Math.round(durationMs || 0),
        ext: ext || 'mp4',
        size: Math.round(size || 0),
      };
      data.renders.push(render);
      if (data.renders.length > 100) data.renders.shift();
      this._save(data);
      return render;
    },

    summary() {
      var data = this._load();
      var renders = data.renders || [];
      var last30 = renders.filter(function (r) { return r.ts > Date.now() - 30 * 86400000; });
      var totalDurationMs = renders.reduce(function (a, r) { return a + (r.durationMs || 0); }, 0);
      var totalSize = renders.reduce(function (a, r) { return a + (r.size || 0); }, 0);
      return {
        totalRenders: renders.length,
        last30Count: last30.length,
        totalMinutes: Math.round(totalDurationMs / 60000 * 100) / 100,
        last30Minutes: Math.round(last30.reduce(function (a, r) { return a + (r.durationMs || 0); }, 0) / 60000 * 100) / 100,
        totalSizeMB: Math.round(totalSize / 1048576 * 100) / 100,
        lastPreset: data.lastPreset,
        recent: renders.slice(-5).reverse(),
      };
    },

    setPreset(presetId) {
      var data = this._load();
      data.lastPreset = presetId;
      this._save(data);
    },

    reset() {
      this._save({ renders: [], lastPreset: null });
    },
  };

  window.SWR_STATS = stats;
})();