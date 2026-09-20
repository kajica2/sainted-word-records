// client/scenes.client.js
//
// Scene pads — capture and recall engine state snapshots. 4 pads;
// click to recall, hold 1s to save. Snapshot includes the four footer
// sliders, the neighbour count, the preset override, and the automix
// on/off state.
//
// Extracted from versions/music_video.html:3083-3209 (Phase 1b).
//
// Public API on window.SWR_SCENES:
//   list()                       → Array of 4 scene records
//   save(index, label?)          Capture the current state into pad #index
//   recall(index)                Restore pad #index into the live engine
//   startCapture(index)          Begin a long-press timer (1s) to save
//   cancelCapture()              Cancel an in-flight long-press
//   STORAGE_KEY                  'swr.scenes.v1'
//   MAX_SCENES                   4

(function () {
  'use strict';
  if (window.SWR_SCENES) return;

  function setStatus(msg, kind) {
    if (typeof window.setStatus === 'function') window.setStatus(msg, kind);
  }

  var scenes = {
    STORAGE_KEY: 'swr.scenes.v1',
    MAX_SCENES: 4,
    _captureTimer: null,

    _load() {
      try {
        var raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return Array.from({ length: this.MAX_SCENES }, function (_, i) {
          return { id: i, label: 'Scene ' + (i + 1), snapshot: null, createdAt: null };
        });
        var arr = JSON.parse(raw);
        while (arr.length < this.MAX_SCENES) {
          arr.push({ id: arr.length, label: 'Scene ' + (arr.length + 1), snapshot: null, createdAt: null });
        }
        return arr;
      } catch (_) {
        return Array.from({ length: this.MAX_SCENES }, function (_, i) {
          return { id: i, label: 'Scene ' + (i + 1), snapshot: null, createdAt: null };
        });
      }
    },

    _save(arr) {
      try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(arr)); } catch (_) {}
    },

    _currentSnapshot() {
      var get = function (id) {
        var el = document.getElementById(id);
        return el ? parseFloat(el.value) : null;
      };
      var presetOverride = (typeof window.__swrCurrentPreset === 'string' && window.__swrCurrentPreset)
        ? window.__swrCurrentPreset
        : 'neon';
      return {
        depth: get('depth'),
        gate: get('gate'),
        decay: get('decay'),
        sens: get('sens'),
        neighbourCount: get('neighbour-count'),
        presetOverride: presetOverride,
        automixOn: !!(document.getElementById('automix-toggle') && /ON/i.test(document.getElementById('automix-toggle').textContent || '')),
      };
    },

    _applySnapshot(s) {
      var set = function (id, val) {
        var el = document.getElementById(id);
        if (!el || val == null) return;
        el.value = String(val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('depth', s.depth);
      set('gate', s.gate);
      set('decay', s.decay);
      set('sens', s.sens);
      set('neighbour-count', s.neighbourCount);
      if (s.presetOverride && window.VersionsPresets && typeof window.VersionsPresets.setPresetOverride === 'function') {
        if (window.VersionsPresets.setPresetOverride(s.presetOverride) !== false) {
          window.__swrCurrentPreset = s.presetOverride;
          if (window.SWR_PRESET_PICK) window.SWR_PRESET_PICK.save(s.presetOverride);
        }
      }
      var toggleBtn = document.getElementById('automix-toggle');
      var currentlyOn = !!(toggleBtn && /ON/i.test(toggleBtn.textContent || ''));
      if (typeof window.automix !== 'undefined' && window.automix && typeof window.automix.toggle === 'function') {
        if (s.automixOn && !currentlyOn) window.automix.toggle();
        else if (!s.automixOn && currentlyOn) window.automix.toggle();
      }
    },

    list() { return this._load(); },

    save(index, label) {
      var arr = this._load();
      if (index < 0 || index >= this.MAX_SCENES) return false;
      arr[index] = {
        id: index,
        label: label || arr[index].label || 'Scene ' + (index + 1),
        snapshot: this._currentSnapshot(),
        createdAt: Date.now(),
      };
      this._save(arr);
      return true;
    },

    recall(index) {
      var arr = this._load();
      if (index < 0 || index >= this.MAX_SCENES) return false;
      var s = arr[index];
      if (!s || !s.snapshot) return false;
      this._applySnapshot(s.snapshot);
      return true;
    },

    startCapture(index) {
      if (this._captureTimer) clearTimeout(this._captureTimer);
      var self = this;
      this._captureTimer = setTimeout(function () {
        self._captureTimer = null;
        self.save(index, 'Scene ' + (index + 1));
        setStatus('saved scene ' + (index + 1), 'ok');
        window.dispatchEvent(new CustomEvent('swr-scenes-changed'));
      }, 1000);
    },

    cancelCapture() {
      if (this._captureTimer) {
        clearTimeout(this._captureTimer);
        this._captureTimer = null;
        return true;
      }
      return false;
    },
  };

  window.SWR_SCENES = scenes;
})();