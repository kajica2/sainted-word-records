// client/automix-image-mode.client.js
// Still-image automix: when the layer stack is mostly photos/GIFs, drive only
// kill-switch-allowed motion (opacity/grade/hue, JS crossfades, glitch FX).

(function (global) {
  'use strict';

  if (global.SWR_AUTOMIX_IMAGE) return;

  var rafId = 0;
  var active = false;
  var lastBeat = false;
  var crossfadeMs = { out: 220, in: 280 };

  function mk() {
    return global.SWR_MOTION_KILL || null;
  }

  function swr() {
    return global.SWR || null;
  }

  function automixOn() {
    var am = global.automix;
    return !!(am && am.enabled);
  }

  function layers() {
    var S = swr();
    return (S && S.Layers && S.Layers.list) || [];
  }

  function audioFeat() {
    var S = swr();
    var A = S && S.Audio;
    return (A && A.feat) || {};
  }

  function shouldRun() {
    if (!automixOn()) return false;
    var M = mk();
    if (!M || typeof M.isImageDominantLayerStack !== 'function') return false;
    return M.isImageDominantLayerStack(layers(), 0.55);
  }

  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function installReactors() {
    var M = mk();
    var list = layers();
    if (!M || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var l = list[i];
      if (!l || l.kind === 'text') continue;
      if (typeof M.isImageAsset === 'function' && !M.isImageAsset(l.asset)) continue;
      if (typeof M.applyImageAutomixReactors === 'function') {
        M.applyImageAutomixReactors(l, i);
      }
    }
  }

  function beatCutSwap() {
    var feat = audioFeat();
    var beat = !!feat.beatPulse;
    var rising = beat && !lastBeat;
    lastBeat = beat;
    if (!rising) return;
    var LS = global.LayerScheduler;
    var S = swr();
    var Lib = S && S.Library;
    if (!LS || !Lib || !Lib.items || !Lib.items.length) return;
    var imgs = Lib.items.filter(function (it) {
      return it && it.url && mk() && mk().isImageAsset(it);
    });
    if (imgs.length < 2) return;
    var list = layers();
    if (!list.length) return;
    var layer = list[0];
    if (!layer || !mk().isImageAsset(layer.asset)) return;
    var curId = layer.asset && layer.asset.id;
    var candidates = imgs.filter(function (it) { return it.id !== curId; });
    if (!candidates.length) return;
    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (global.SWR_TIMING && typeof global.SWR_TIMING.crossfade === 'function') {
      global.SWR_TIMING.attach(layer);
      global.SWR_TIMING.crossfade(layer, pick, {
        fadeOutMs: crossfadeMs.out,
        fadeInMs: crossfadeMs.in,
      });
    } else {
      layer.asset = pick;
    }
  }

  function pushFxFromAudio() {
    var S = swr();
    if (!S) return;
    var feat = audioFeat();
    var bass = clamp01(feat.bass);
    var mid = clamp01(feat.mid);
    var treble = clamp01(feat.treble);
    var rms = clamp01(feat.rms);
    var onset = clamp01(feat.onset);

    var preset = Object.assign({}, S._fxOverride || {}, {
      mutAlgo: 1,
      mut: clamp01(0.08 + onset * 0.55 + feat.beatPulse * 0.25),
      blur: clamp01(0.02 + (1 - treble) * 0.12 - onset * 0.04),
      chroma: clamp01(0.04 + treble * 0.2),
      grain: clamp01(0.05 + rms * 0.15),
      temp: clamp01((mid - 0.5) * 0.35),
      glow: clamp01(0.05 + bass * 0.25),
      vignette: clamp01(0.15 + (1 - rms) * 0.1),
    });

    var M = mk();
    if (M && typeof M.sanitizeFxPresetImage === 'function') {
      M.sanitizeFxPresetImage(preset);
    }
    S._fxOverride = preset;
  }

  function tick() {
    rafId = 0;
    if (!shouldRun()) {
      active = false;
      return;
    }
    active = true;
    beatCutSwap();
    pushFxFromAudio();
    rafId = global.requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId) return;
    installReactors();
    rafId = global.requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) global.cancelAnimationFrame(rafId);
    rafId = 0;
    active = false;
    lastBeat = false;
  }

  function onAutomixStart() {
    installReactors();
    startLoop();
  }

  function onAutomixStop() {
    stopLoop();
  }

  function hookAutomix() {
    var am = global.automix;
    if (!am || am.__imageModeHooked) return;
    am.__imageModeHooked = true;
    var origStart = am.start.bind(am);
    var origStop = am.stop.bind(am);
    am.start = function () {
      var r = origStart();
      try { onAutomixStart(); } catch (_) {}
      return r;
    };
    am.stop = function () {
      try { onAutomixStop(); } catch (_) {}
      return origStop();
    };
    if (am.enabled) onAutomixStart();
  }

  global.addEventListener('swr-automix-glide', function () {
    if (shouldRun()) installReactors();
  });

  global.addEventListener('swr-composition-change', function () {
    if (shouldRun()) installReactors();
  });

  function boot() {
    hookAutomix();
    if (automixOn() && shouldRun()) startLoop();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      setTimeout(boot, 0);
    }
  } else {
    boot();
  }

  global.SWR_AUTOMIX_IMAGE = {
    shouldRun: shouldRun,
    isActive: function () { return active; },
    installReactors: installReactors,
    pushFxFromAudio: pushFxFromAudio,
    beatCutSwap: beatCutSwap,
  };
})(typeof window !== 'undefined' ? window : globalThis);
