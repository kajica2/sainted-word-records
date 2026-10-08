// lib/tone-slider.client.js — FX tone/desaturation slider
//
// Two-way bound range input for window.FX.tone (fx-postprocess.js): one mood
// knob that pulls saturation down while split-toning (warm highlights, cool
// shadows) — the way a film stock reads. Same contract as
// lib/intensity-slider.client.js:
//
// Mount patterns (either works, idempotent):
//   <input type="range" id="fx-tone" min="0" max="1" step="0.05">
//   <span data-fx-tone-mount></span>   ← the input is created here
//
// Canonical value lives in localStorage['swr.fx.tone']. When window.FX.setTone
// exists it is the writer of record (clamps + persists); otherwise this client
// clamps + persists itself and mirrors the number onto window.SWR_FX_TONE.
//
// Emits `fx-tone-change` on document with { value } after every change.

(function () {
  'use strict';

  if (window.__SWR_TONE_SLIDER_LOADED) return;
  window.__SWR_TONE_SLIDER_LOADED = true;

  function clamp01(v) {
    var n = typeof v === 'number' && isFinite(v) ? v : parseFloat(v);
    if (!isFinite(n)) return null;
    return Math.max(0, Math.min(1, n));
  }

  function get() {
    if (window.FX && typeof window.FX.tone === 'number') return window.FX.tone;
    if (typeof window.SWR_FX_TONE === 'number') return window.SWR_FX_TONE;
    try {
      var v = clamp01(parseFloat(localStorage.getItem('swr.fx.tone')));
      if (v !== null) return v;
    } catch (_) {}
    return 0;
  }

  function set(v) {
    var n = clamp01(v);
    if (n === null) return get();
    if (window.FX && typeof window.FX.setTone === 'function') {
      window.FX.setTone(n); // clamps
      window.SWR_FX_TONE = window.FX.tone;
    } else {
      window.SWR_FX_TONE = n;
    }
    // Persist regardless: the FX setter family only clamps (matching
    // setTemp/setGrayscale); the canonical stored value is this module's.
    try { localStorage.setItem('swr.fx.tone', String(n)); } catch (_) {}
    try {
      document.dispatchEvent(new CustomEvent('fx-tone-change', { detail: { value: n } }));
    } catch (_) {}
    return n;
  }

  function mount(input) {
    if (!input || input.__swrToneBound) return;
    input.__swrToneBound = true;
    if (input.type === 'range') {
      if (!input.min) input.min = '0';
      if (!input.max) input.max = '1';
      if (!input.step) input.step = '0.05';
      input.value = String(get());
      input.addEventListener('input', function () {
        var n = set(input.value);
        input.value = String(n);
      });
      document.addEventListener('fx-tone-change', function (e) {
        var n = e && e.detail ? clamp01(e.detail.value) : null;
        if (n !== null && Math.abs(parseFloat(input.value) - n) > 1e-4) input.value = String(n);
      });
    }
  }

  function mountAll() {
    var direct = document.getElementById('fx-tone');
    if (direct) mount(direct);
    var spots = document.querySelectorAll('[data-fx-tone-mount]');
    for (var i = 0; i < spots.length; i++) {
      if (spots[i].__swrToneMounted) continue;
      spots[i].__swrToneMounted = true;
      if (document.getElementById('fx-tone')) break; // a direct input already exists
      var input = document.createElement('input');
      input.type = 'range';
      input.id = 'fx-tone';
      input.min = '0'; input.max = '1'; input.step = '0.05';
      input.title = 'Tone / desaturation — warm highlights, cool shadows';
      spots[i].appendChild(input);
      mount(input);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }

  window.SWR_TONE_SLIDER = { get: get, set: set, mountAll: mountAll };
})();
