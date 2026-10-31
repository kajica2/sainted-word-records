// client/automix-image-mode.client.js
// Still-image automix: beat-synced cuts + mild grade pulses; clarity keeps
// photos sharp (no blur/glitch/chroma/grain displacement).

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

  function caps() {
    var M = mk();
    return (M && M.IMAGE_AUTOMIX_CAPS) || {
      minOpacity: 0.9,
      glowMax: 0.12,
      tempMax: 0.12,
      toneMax: 0.15,
      saturationDelta: 0.15,
      vignetteMax: 0.08,
    };
  }

  function clarityOn() {
    var M = mk();
    return !M || typeof M.isImageClarityEnabled !== 'function' || M.isImageClarityEnabled();
  }

  function swr() {
    return global.SWR || null;
  }

  function automixOn() {
    var am = global.automix;
    return !!(am && am.enabled);
  }

  function layers() {
    var lane = global.SWR_IMAGE_LANE;
    if (lane && lane.list && lane.list.length) {
      return lane.visible ? lane.visibleList() : [];
    }
    var S = swr();
    return (S && S.Layers && S.Layers.list) || [];
  }

  function hasImageLaneStills() {
    var lane = global.SWR_IMAGE_LANE;
    return !!(lane && lane.list && lane.list.length);
  }

  function audioFeat() {
    var S = swr();
    var A = S && S.Audio;
    return (A && A.feat) || {};
  }

  function shouldRun() {
    if (!automixOn()) return false;
    if (hasImageLaneStills()) return true;
    var M = mk();
    if (!M || typeof M.isImageDominantLayerStack !== 'function') return false;
    var S = swr();
    var videoList = (S && S.Layers && S.Layers.list) || [];
    return M.isImageDominantLayerStack(videoList, 0.55);
  }

  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function layerCrossfading(l) {
    if (!l) return false;
    if (l._swapPending) return true;
    if (typeof l._targetOpacity === 'number' && l._targetOpacity < caps().minOpacity - 0.02) {
      return true;
    }
    return false;
  }

  function enforceOpacityFloor() {
    if (!clarityOn()) return;
    var floor = caps().minOpacity;
    var M = mk();
    var list = layers();
    for (var i = 0; i < list.length; i++) {
      var l = list[i];
      if (!l || l.kind === 'text') continue;
      if (M && typeof M.isImageAsset === 'function' && !M.isImageAsset(l.asset)) continue;
      if (layerCrossfading(l)) continue;
      if (l.opacity != null && l.opacity < floor) l.opacity = floor;
      if (typeof l._targetOpacity === 'number' && l._targetOpacity < floor) {
        l._targetOpacity = floor;
      }
      if (typeof l._currentOpacity === 'number' && l._currentOpacity < floor) {
        l._currentOpacity = floor;
      }
    }
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
      if (clarityOn() && !layerCrossfading(l)) {
        if (l.opacity == null || l.opacity < caps().minOpacity) {
          l.opacity = Math.max(l.opacity != null ? l.opacity : 1, caps().minOpacity);
        }
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

  function buildClarityFxPreset(feat) {
    var C = caps();
    var bass = clamp01(feat.bass);
    var mid = clamp01(feat.mid);
    var rms = clamp01(feat.rms);
    var beat = feat.beatPulse ? 1 : 0;

    var preset = {
      mut: 0,
      mutAlgo: 1,
      blur: 0,
      chroma: 0,
      grain: 0,
      liquid: 0,
      glitch: 0,
      pearl: 0,
      posterize: 0,
      glow: Math.min(C.glowMax, 0.03 + bass * C.glowMax * 0.7 + beat * 0.02),
      temp: (mid - 0.5) * C.tempMax * 2,
      tone: (rms - 0.5) * C.toneMax * 2,
      vignette: Math.min(C.vignetteMax, 0.04 + (1 - rms) * C.vignetteMax * 0.5),
    };

    var M = mk();
    if (M && typeof M.sanitizeFxPresetImage === 'function') {
      M.sanitizeFxPresetImage(preset);
    }
    return preset;
  }

  function buildLegacyFxPreset(feat) {
    var bass = clamp01(feat.bass);
    var mid = clamp01(feat.mid);
    var treble = clamp01(feat.treble);
    var rms = clamp01(feat.rms);
    var onset = clamp01(feat.onset);
    var preset = Object.assign({}, {
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
    return preset;
  }

  function pushFxFromAudio() {
    var S = swr();
    if (!S) return;
    var feat = audioFeat();
    var preset = clarityOn()
      ? buildClarityFxPreset(feat)
      : buildLegacyFxPreset(feat);
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
    enforceOpacityFloor();
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

  function hookAutomixSetTarget() {
    var am = global.automix;
    if (!am || am.__imageClarityTargetHooked || typeof am._setTarget !== 'function') return;
    am.__imageClarityTargetHooked = true;
    var orig = am._setTarget.bind(am);
    am._setTarget = function (preset) {
      if (!preset) return orig(preset);
      if (shouldRun() && clarityOn()) {
        var M = mk();
        var cleaned = Object.assign({}, preset);
        if (M && typeof M.zeroImageDistortionFx === 'function') {
          M.zeroImageDistortionFx(cleaned);
        }
        if (M && typeof M.sanitizeFxPresetImage === 'function') {
          M.sanitizeFxPresetImage(cleaned);
        }
        return orig(cleaned);
      }
      return orig(preset);
    };
  }

  function hookAutomix() {
    var am = global.automix;
    if (!am || am.__imageModeHooked) return;
    am.__imageModeHooked = true;
    hookAutomixSetTarget();
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
    if (shouldRun()) {
      installReactors();
      if (clarityOn()) pushFxFromAudio();
    }
  });

  global.addEventListener('swr-composition-change', function () {
    if (shouldRun()) installReactors();
  });

  global.addEventListener('swr-image-lane-changed', function () {
    if (shouldRun()) {
      installReactors();
      if (!rafId) startLoop();
    } else if (!hasImageLaneStills()) {
      stopLoop();
    }
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
    clarityOn: clarityOn,
    caps: caps,
    installReactors: installReactors,
    pushFxFromAudio: pushFxFromAudio,
    beatCutSwap: beatCutSwap,
    buildClarityFxPreset: buildClarityFxPreset,
    enforceOpacityFloor: enforceOpacityFloor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
