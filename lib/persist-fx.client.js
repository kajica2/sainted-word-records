// lib/persist-fx.client.js — minimal FX persona persistence for stage-only
// pages (no library, no layers). Reads the saved persona at boot, applies it
// via FX.setPersona(); on slider/temp changes, schedules a debounced save.
//
// USAGE
//   <script src="../lib/persist.client.js"></script>
//   <script src="../lib/persist-fx.client.js"></script>
//
// Page expectations:
//   - body[data-page] is set (used as pageId).
//   - Either fx-postprocess.js (so window.FX exists) or just the temp slider
//     from temp-slider.js (which sets FX.state.temp).
//
// Out of scope:
//   - Library / layers persistence (those pages don't have that UI).

(function () {
  'use strict';
  if (window.SWR_GRID_PERSIST_FX) return;
  window.SWR_GRID_PERSIST_FX = true;

  const P = window.SWR_GRID_PERSIST;
  if (!P) return;

  function pageId() {
    return (document.body && document.body.getAttribute('data-page')) ||
           (location.pathname.split('/').pop().replace(/\.html$/, '')) ||
           'unknown';
  }

  function snapshotFX() {
    const FX = window.FX;
    if (!FX || !FX.state) return null;
    const s = FX.state;
    return {
      temp:      s.temp      || 0,
      mut:       s.mut       || 0,
      mutAlgo:   s.mutAlgo   || 0,
      posterize: s.posterize || 0,
      vignette:  s.vignette  || 0,
      chroma:    s.chroma    || 0,
      grain:     s.grain     || 0,
      sepia:     s.sepia     || 0,
      glow:      s.glow      || 0,
      grayscale: s.grayscale || 0,
      blur:      s.blur      || 0,
      liquid:    s.liquid    || 0,
      pearl:     s.pearl     || 0,
      glitch:    s.glitch    || 0,
    };
  }

  // Wrap FX setters to also push a save — but ONLY the per-knob
  // setters. We explicitly skip setPersona because the page calls
  // setPersona at boot to apply its OWN defaults. Hooking setPersona
  // would mean the boot's defaults get re-saved before our saved
  // persona can be applied (timer race). Skipping it is intentional.
  let fxHooked = false;
  function hookFXSetters() {
    const FX = window.FX;
    if (fxHooked || !FX) return;
    fxHooked = true;
    const setters = [
      'setTemp', 'setMut', 'setAlgo', 'setMutAlgo',
      'setPosterize', 'setVignette', 'setChroma', 'setGrain',
      'setSepia', 'setGlow', 'setGrayscale', 'setBlur',
      'setLiquid', 'setPearl', 'setGlitch', 'setEnabled',
    ];
    for (const name of setters) {
      if (typeof FX[name] !== 'function' || FX[name].__persist_hooked) continue;
      const orig = FX[name].bind(FX);
      FX[name] = function (...args) {
        const r = orig.apply(this, args);
        scheduleFxSave();
        return r;
      };
      FX[name].__persist_hooked = true;
    }
  }

  let saveTimer = null;
  function scheduleFxSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const snap = snapshotFX();
      if (snap) P.saveFxPersona(pageId(), snap);
    }, 250);
  }

  function applyFxOnBoot() {
    const FX = window.FX;
    if (!FX) return;
    const persona = P.loadFxPersona(pageId());
    if (persona && typeof FX.setPersona === 'function') {
      try { FX.setPersona(persona); } catch (_) {}
    }
    hookFXSetters();
    // Re-apply in 50ms, 200ms — covers the race where the page's
    // own fxScript.onload (which sets its defaults) lands AFTER our
    // first apply. The page's setPersona runs in a dynamic
    // <script> onload, which sometimes fires after persist-fx's
    // first poll resolves.
    const reapply = () => {
      const p = P.loadFxPersona(pageId());
      if (!p) return;
      if (typeof FX.setPersona === 'function') {
        try { FX.setPersona(p); } catch (_) {}
      }
    };
    setTimeout(reapply, 50);
    setTimeout(reapply, 200);
    document.addEventListener('input', (ev) => {
      if (ev.target.matches && ev.target.matches('input, select, textarea')) scheduleFxSave();
    });
    document.addEventListener('change', scheduleFxSave);
  }

  function boot() {
    if (!P) return;
    if (!window.FX) { setTimeout(boot, 30); return; }
    applyFxOnBoot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
