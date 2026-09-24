// lib/intensity-slider.client.js — FX intensity master slider
//
// Two-way bound range input for window.FX.intensity (fx-postprocess.js)
// with a plain-global fallback (window.SWR_FX_INTENSITY) for variants on
// the versions-presets.js renderer that don't load fx-postprocess.
//
// Mount patterns (either works, idempotent):
//   <input type="range" id="fx-intensity" min="0" max="1" step="0.05">
//   <span data-fx-intensity-mount></span>   ← input is created here
//
// Contract: canonical value lives in localStorage['swr.fx.intensity'].
// When window.FX.setIntensity exists it is the writer of record
// (it clamps + persists). Otherwise this client clamps + persists itself
// and mirrors the number onto window.SWR_FX_INTENSITY, which
// versions-presets.js reads per frame.
//
// Emits `fx-intensity-change` on document with { value } after every change.

(function () {
  'use strict';

  if (window.__SWR_INTENSITY_SLIDER_LOADED) return;
  window.__SWR_INTENSITY_SLIDER_LOADED = true;

  function clamp01(v) {
    var n = typeof v === 'number' && isFinite(v) ? v : parseFloat(v);
    if (!isFinite(n)) return null;
    return Math.max(0, Math.min(1, n));
  }

  function get() {
    if (window.FX && typeof window.FX.intensity === 'number') return window.FX.intensity;
    if (typeof window.SWR_FX_INTENSITY === 'number') return window.SWR_FX_INTENSITY;
    try {
      var v = clamp01(parseFloat(localStorage.getItem('swr.fx.intensity')));
      if (v !== null) return v;
    } catch (_) {}
    return 1;
  }

  function set(v) {
    var n = clamp01(v);
    if (n === null) return get();
    if (window.FX && typeof window.FX.setIntensity === 'function') {
      window.FX.setIntensity(n); // clamps + persists + returns clamped
      window.SWR_FX_INTENSITY = window.FX.intensity;
    } else {
      window.SWR_FX_INTENSITY = n;
      try { localStorage.setItem('swr.fx.intensity', String(n)); } catch (_) {}
    }
    try {
      document.dispatchEvent(new CustomEvent('fx-intensity-change', { detail: { value: n } }));
    } catch (_) {}
    return n;
  }

  window.SWR_FX_INTENSITY = get();

  function labelFor() {
    return 'FX';
  }

  function upgradeInput(input) {
    if (input.__swrIntensity) return input;
    input.__swrIntensity = true;
    input.min = '0';
    input.max = '1';
    input.step = '0.05';
    input.value = String(get());
    input.setAttribute('title', 'FX intensity');
    input.setAttribute('aria-label', 'FX intensity');
    input.addEventListener('input', function () {
      var v = set(parseFloat(input.value));
      var out = document.getElementById('fx-intensity-v') ||
        (input.parentElement && input.parentElement.querySelector('#fx-intensity-v'));
      if (out) out.textContent = v.toFixed(2);
    });
    document.addEventListener('fx-intensity-change', function (ev) {
      var v = ev.detail && ev.detail.value;
      if (typeof v !== 'number') return;
      if (document.activeElement !== input) input.value = String(v);
      var out = document.getElementById('fx-intensity-v') ||
        (input.parentElement && input.parentElement.querySelector('#fx-intensity-v'));
      if (out) out.textContent = v.toFixed(2);
    });
    return input;
  }

  function makeStandalone(mount) {
    if (mount.__swrIntensityMount) return;
    mount.__swrIntensityMount = true;
    var wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
    var lab = document.createElement('span');
    lab.textContent = labelFor();
    lab.style.cssText = 'letter-spacing:0.08em;';
    var input = document.createElement('input');
    input.id = 'fx-intensity';
    input.type = 'range';
    var out = document.createElement('b');
    out.id = 'fx-intensity-v';
    out.textContent = get().toFixed(2);
    wrap.appendChild(lab);
    wrap.appendChild(input);
    wrap.appendChild(out);
    mount.appendChild(wrap);
    upgradeInput(input);
    input.dispatchEvent(new Event('input', { bubbles: false }));
  }

  function mountAll() {
    var inputs = document.querySelectorAll('input#fx-intensity');
    for (var i = 0; i < inputs.length; i++) upgradeInput(inputs[i]);
    var mounts = document.querySelectorAll('[data-fx-intensity-mount]');
    for (var j = 0; j < mounts.length; j++) makeStandalone(mounts[j]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }

  window.SWR_FX_INTENSITY_SLIDER = { get: get, set: set, mountAll: mountAll };
})();
