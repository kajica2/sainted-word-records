// lib/auto-setup.client.js — auto-setup that fires when a song loads in
// the engine.
//
// Two behaviors, both gated behind a single opt-out:
//
//   1. STARTER LAYER
//      If Library has items and Layers is empty, apply the default
//      'pulse' visual preset. The applyPreset() function in engine.html
//      already auto-adds N images as layers when applied to an empty
//      stage (see applyPreset at engine.html:4169). So this is one
//      call — no separate "add first item" code path needed.
//
//   2. PRESET AUTO-CYCLE
//      Every N bars (default 4), advance to the next preset in
//      window.VISUAL_PRESETS. The cycle respects the detected BPM
//      because Audio.bar is updated by the same _bar tick used by
//      transitions, storyboard, and the bar counter UI.
//
// Opt-out:
//   - ?plan=off              in the URL
//   - localStorage['swr-plan-disabled'] = '1'
//   - SWR_AUTO_SETUP.disable() in devtools
//
// Hook contract:
//   engine.html's Audio.loadFile() ends with a single line:
//     if (typeof window.__swrOnSongLoaded === 'function') window.__swrOnSongLoaded(file);
//   so this module just defines that global and lets the engine drive
//   the timing — no polling, no setTimeout-based race conditions.

(function () {
  'use strict';
  if (window.__SWR_AUTO_SETUP__) return;
  window.__SWR_AUTO_SETUP__ = true;

  // --- Opt-out checks -------------------------------------------------
  let disabled = false;
  try {
    if (/[?&]plan=off\b/.test(location.search)) disabled = true;
    if (localStorage.getItem('swr-plan-disabled') === '1') disabled = true;
  } catch (_) { /* localStorage blocked (private mode etc.) — assume enabled */ }

  // --- Module state --------------------------------------------------
  const PRESET_ORDER = ['pulse', 'drift', 'strobe', 'warp', 'mosh'];
  const BARS_PER_PRESET = 4;            // change a preset every N bars
  const CYCLE_TICK_MS = 200;             // poll interval for bar changes
  let presetIdx = 0;
  let lastBar = -1;
  let cycleTimer = null;
  let currentSongName = null;

  // --- Public enable/disable -----------------------------------------
  window.SWR_AUTO_SETUP = {
    enabled: !disabled,
    disable: function () {
      disabled = true;
      window.SWR_AUTO_SETUP.enabled = false;
      stopCycle();
      try { localStorage.setItem('swr-plan-disabled', '1'); } catch (_) {}
    },
    enable: function () {
      disabled = false;
      window.SWR_AUTO_SETUP.enabled = true;
      try { localStorage.removeItem('swr-plan-disabled'); } catch (_) {}
    },
    cycleNow: function () {
      advancePreset('manual');
    },
    status: function () {
      return {
        enabled: !disabled,
        currentPreset: PRESET_ORDER[presetIdx],
        bar: (window.A && window.A.bar) || 0,
        songName: currentSongName,
      };
    },
  };

  if (disabled) {
    console.info('[auto-setup] disabled (opt-out via ?plan=off or localStorage flag)');
  }

  // --- Core: when a song is loaded ----------------------------------
  function onSongLoaded(file) {
    if (disabled) return;
    currentSongName = (file && file.name) || '(song)';

    // 1. STARTER LAYER — apply 'pulse' if Layers is empty + Library has items.
    //    applyPreset() auto-adds up to N images as layers (see engine.html
    //    applyPreset line ~4169), so this is the only call needed.
    const Audio = window.SWR && window.SWR.Audio;
    const Library = window.SWR && window.SWR.Library;
    const Layers = window.SWR && window.SWR.Layers;
    const applyPreset = window.applyVisualPreset || (window.SWR && window.SWR.applyPreset);
    const VISUAL_PRESETS = (window.SWR && window.SWR.VISUAL_PRESETS) || window.VISUAL_PRESETS || {};

    if (!Audio || !Layers) {
      console.warn('[auto-setup] Audio or Layers not on window.SWR — skipping');
      return;
    }
    if (typeof setStatus === 'function') {
      setStatus('🎬 auto-setup: planning…', '');
    }

    if (Layers.list && Layers.list.length === 0 && Library && Library.items && Library.items.length) {
      // Apply the default 'pulse' preset if available, else 'pulse', else first.
      const key = VISUAL_PRESETS['pulse'] ? 'pulse' : PRESET_ORDER.find((k) => VISUAL_PRESETS[k]) || Object.keys(VISUAL_PRESETS)[0];
      if (key && typeof applyPreset === 'function') {
        try {
          applyPreset(key);
          console.info('[auto-setup] applied starter preset:', key);
        } catch (e) {
          console.warn('[auto-setup] applyPreset failed', e);
        }
      } else {
        // No preset available — at least add the first library asset.
        try {
          Layers.add(Library.items[0]);
          if (typeof setStatus === 'function') setStatus(`♪ added ${Library.items[0].name} as starter layer`, 'ok');
        } catch (e) { console.warn('[auto-setup] starter layer add failed', e); }
      }
    } else if (Layers.list && Layers.list.length > 0) {
      // Stage already populated — don't trample the user's work. Apply
      // pulse's blend/scale/reactors only if no preset is currently active.
      if (!window._activePreset && typeof applyPreset === 'function') {
        const key = VISUAL_PRESETS['pulse'] ? 'pulse' : Object.keys(VISUAL_PRESETS)[0];
        if (key) {
          try { applyPreset(key); } catch (_) {}
        }
      }
    }

    // 2. PRESET CYCLE — start a small interval that watches Audio.bar and
    //    advances the preset when it advances by BARS_PER_PRESET.
    startCycle();
  }

  function startCycle() {
    stopCycle();
    if (disabled) return;
    if (!window.A || typeof window.A.bar !== 'number') return;
    lastBar = window.A.bar;
    presetIdx = 0; // start of cycle (matches what we just applied)
    cycleTimer = setInterval(cycleTick, CYCLE_TICK_MS);
    console.info('[auto-setup] cycle started — ' + BARS_PER_PRESET + ' bars per preset');
  }

  function stopCycle() {
    if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; }
  }

  function cycleTick() {
    if (disabled || !window.A || typeof window.A.bar !== 'number') return;
    const b = window.A.bar;
    if (b - lastBar >= BARS_PER_PRESET && window.A.feat && window.A.feat.bpm > 0) {
      advancePreset('bar-' + b);
      lastBar = b;
    } else if (b === lastBar) {
      // no progress — keep waiting
    } else if (b < lastBar) {
      // bar counter reset (e.g., seek to 0) — re-anchor
      lastBar = b;
    }
  }

  function advancePreset(reason) {
    presetIdx = (presetIdx + 1) % PRESET_ORDER.length;
    const key = PRESET_ORDER[presetIdx];
    const applyPreset = window.applyVisualPreset || (window.SWR && window.SWR.applyPreset);
    const VISUAL_PRESETS = (window.SWR && window.SWR.VISUAL_PRESETS) || window.VISUAL_PRESETS || {};
    if (!VISUAL_PRESETS[key] || typeof applyPreset !== 'function') {
      console.warn('[auto-setup] cannot advance to', key, '(missing)');
      return;
    }
    try {
      applyPreset(key);
      console.info('[auto-setup] →', key, '(' + reason + ')');
      if (typeof setStatus === 'function') {
        setStatus('🎬 preset: ' + (VISUAL_PRESETS[key].name || key), 'ok');
      }
    } catch (e) {
      console.warn('[auto-setup] advance failed', e);
    }
  }

  // --- Hook registration --------------------------------------------
  // engine.html ends Audio.loadFile() with this single line:
  //   if (typeof window.__swrOnSongLoaded === 'function') window.__swrOnSongLoaded(file);
  // Defining that global here is enough to receive every song-load event.
  window.__swrOnSongLoaded = function (file) {
    try { onSongLoaded(file); } catch (e) { console.error('[auto-setup] onSongLoaded threw', e); }
  };
})();
