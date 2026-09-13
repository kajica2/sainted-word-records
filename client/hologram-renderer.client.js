// client/hologram-renderer.client.js
//
// Phase D (Phase 4 of plan-doc) of the music_video.html hologram
// preset engine. Pure integration layer — no inline edits to
// versions/music_video.html required.
//
// Two exports:
//
//   SWR_HOLOGRAM_INSTALL.wrapApplyR(originalApplyR, layer, audio,
//                                    hologramInstance, hState)
//     Returns a new applyR function that delegates to originalApplyR
//     after scaling each reactor's `scale` by a hologram blend
//     multiplier Σ blend[presetId] * presetGain(preset, feature).
//     `presetGain(preset, feature)` is the audio_reactivity lookup
//     in each manifest preset, returning 1.0 when the feature is
//     mapped to at least one effect in that preset, 0.0 otherwise.
//
//   SWR_HOLOGRAM_INSTALL.mountPanel({ asideEl, canvasEl,
//                                     neighboursListEl,
//                                     hologramInstance, audioRef,
//                                     hStateRef, synthPillEl,
//                                     presetNames })
//     Renders the existing 200×200 gradient canvas as a 2D
//     (intensity × warmth) scatter of all presets, with the focus
//     preset highlighted and lines drawn to the top-N neighbours
//     weighted by `blend[presetId]`. Updates the neighbours-list
//     text. Returns a `redraw()` function that callers invoke on
//     RAF or scene change.
//
// The wrapper is intentionally **a function that returns a
// function**: it does not touch any DOM, does not read window, does
// not assign globals. Mounting is its own separate path. This
// keeps the applyR integration unit-testable in plain Node, and
// matches the score-evolution Phase 2 pattern.
//
// Why we don't ship this as a single mega-script: the page is
// 1275 lines and has its own IIFE. Editing inline would couple
// the renderer to the page's local state (`A.feat`, _rnd, etc.)
// and make the integration untestable. Keeping the integration
// here lets us regression-test the math without spinning Chrome.
//
// Loaded after hologram-presets.client.js. Idempotent.

(function (root) {
  'use strict';
  if (root.SWR_HOLOGRAM_INSTALL) return;

  // ---- presetGain -------------------------------------------------------
  //
  // Each manifest preset's audio_reactivity maps feature →
  // effect-name[]. We define the per-feature gain as:
  //
  //   - 1.0 if the preset's audio_reactivity[feature] has at least
  //     one entry (it cares about that feature);
  //   - 0.0 otherwise.
  //
  // Reason: rather than guessing per-effect magnitudes (which would
  // require inspecting what each effect does in the layer reactor
  // pipeline), we treat each preset as a binary contributor and
  // weigh by the blend weight. The 0/1 gain keeps the math simple:
  // the blended gain becomes Σ blend[i] (over presets that care
  // about this feature), which the blend map already sums to ≤1.
  function presetGain(preset, feature) {
    var ar = (preset && preset.audio_reactivity) || {};
    var arr = ar[feature];
    if (Array.isArray(arr) && arr.length > 0) return 1.0;
    return 0.0;
  }

  // ---- blendMultiplierFor ----------------------------------------------
  //
  // Given the current blend map (presetId → weight, summing to 1)
  // and the manifest presets, return the multiplier for a given
  // audio feature. Each preset's contribution is blend[i] * presetGain.
  function blendMultiplierFor(blend, manifestPresets, feature) {
    var total = 0;
    for (var i = 0; i < manifestPresets.length; i++) {
      var p = manifestPresets[i];
      var w = blend[p.id];
      if (typeof w !== 'number' || !isFinite(w) || w === 0) continue;
      total += w * presetGain(p, feature);
    }
    return total;
  }

  // ---- wrapApplyR ------------------------------------------------------
  //
  // `originalApplyR` — the page's existing applyR(layer) →
  //   { scale, x, y, rot, opacity, hue, brightness, contrast, _v }
  // `layer` — the layer object the page passes in. We use it for
  //   its reactors (l.reactors) and as the call target.
  // `audio` — the page's A.feat object, used in originalApplyR; we
  //   re-pass it untouched.
  // `hologramInstance` — SWR_HOLOGRAM.build(presetList) result.
  // `hState` — HologramState { depth, neighbours, focus?, features? }.
  //   `features` is the 4D audio vector (from SWR_AUDIO_TO_FEATURES).
  //   If absent, fall back to neutral (0.5, 0.5, 0.5, 0.5) so the
  //   page still renders something.
  //
  // Returns a function with the same signature as originalApplyR.
  function wrapApplyR(originalApplyR, hologramInstance, hState) {
    if (typeof originalApplyR !== 'function') {
      throw new Error('wrapApplyR: originalApplyR must be a function');
    }
    if (!hologramInstance) {
      // Without a hologram instance, return the original unchanged.
      return originalApplyR;
    }

    // Cache the manifest preset list so wrapApplyR doesn't reach
    // back into the instance on every call.
    var presetList = (function () {
      // SWR_HOLOGRAM.build(presets) doesn't expose presets directly;
      // however list() returns ids. We can pull manifests from the
      // page context if available, else the caller must pre-populate
      // _presets on hologramInstance (see SWR_HOLOGRAM_INSTALL.attach).
      if (Array.isArray(hologramInstance._presets)) return hologramInstance._presets;
      return [];
    })();

    return function wrapped(layer) {
      // Compute the blend once per call.
      var features = (hState && hState.features)
        || { mood: 0.5, complexity: 0.5, motion: 0.5, color_temp: 0.5 };
      var focus = (hState && hState.focus) || null;
      var depth = (hState && hState.depth) || 0;
      var focusAmount = (hState && hState.focusAmount) || 0;

      var blend = hologramInstance.computeBlend(
        features, focus, depth, focusAmount
      );

      // Rebuild the reactors with scaled gains. Mutating the
      // original `layer.reactors` would persist between frames; we
      // shallow-copy the array (the objects inside are still the
      // originals) and only override `r.scale` per call.
      var origReactors = (layer && layer.reactors) || [];
      var newReactors = new Array(origReactors.length);
      for (var i = 0; i < origReactors.length; i++) {
        var r = origReactors[i];
        if (!r) { newReactors[i] = r; continue; }
        var mult = blendMultiplierFor(blend, presetList, r.feature);
        var scaled = Object.assign({}, r);
        // mult=0 means no preset cares about this feature in this
        // song → effectively mute the reactor. Still call original
        // applyR so target gain=0 zeroes that target.
        scaled.scale = (r.scale || 0) * mult;
        newReactors[i] = scaled;
      }

      // Build a shallow copy of `layer` with the new reactors, so
      // originalApplyR sees the scaled gains and the caller's
      // layer object stays intact.
      var layerCopy = Object.assign({}, layer, { reactors: newReactors });

      var out = originalApplyR(layerCopy);

      // Stash blend info onto the out object for diagnostics.
      out._hologram = {
        mult: blend,
        features: features,
      };
      return out;
    };
  }

  // ---- attach ----------------------------------------------------------
  //
  // Convenience: attaches a preset list to a hologram instance so
  // wrapApplyR can find it later without the caller having to
  // remember to set _presets every time.
  function attach(hologramInstance, presetList) {
    if (!hologramInstance) return hologramInstance;
    hologramInstance._presets = presetList || [];
    return hologramInstance;
  }

  // ---- mountPanel ------------------------------------------------------
  //
  // Wires the existing UI scaffolding into the renderer's data path.
  // Returns a `redraw()` the caller should call on RAF or whenever
  // `hStateRef.current` changes meaningfully.
  //
  // Inputs (all optional except asideEl, canvasEl, hologramInstance):
  //   asideEl          <aside class="layers"> wrapper (unused for now,
  //                     reserved for future inline UI like an axis
  //                     legend).
  //   canvasEl         the existing <canvas id="gradient" width=216
  //                     height=216>. 2D scatter drawn on its 2D
  //                     context. The default map is the same as the
  //                     current page's gradient canvas (warmth →
  //                     horizontal, intensity → vertical), but the
  //                     draw call here shows preset dots + focus +
  //                     blend-weighted top-N lines. The original
  //                     gradient filled-axis background is preserved
  //                     as the first paint so the panel still reads
  //                     "gradient view" at-a-glance.
  //   neighboursListEl the existing <div id="neighbours-list">. Shows
  //                     the top-N neighbour ids with their weights.
  //   hologramInstance SWR_HOLOGRAM.build(presets), needed for the
  //                     preset positions and current blend.
  //   audioRef         { current: audioResult | null } — the same
  //                     shape returned by SWR_TRACK_ANALYZE. Its
  //                     chromagram drives the background gradient
  //                     hue tint.
  //   hStateRef        { current: { depth, neighbours, focus?, features? } }
  //   synthPillEl      the existing <span id="synth-pill">. Updates
  //                     text to "BPM X · KEY/SCALE · DR dB" on
  //                     each redraw when audio is present.
  function mountPanel(opts) {
    var canvasEl = opts.canvasEl;
    var neighboursListEl = opts.neighboursListEl;
    var synthPillEl = opts.synthPillEl;
    var hologramInstance = opts.hologramInstance;
    var audioRef = opts.audioRef || { current: null };
    var hStateRef = opts.hStateRef || { current: { depth: 0.5 } };

    var ctx2d = canvasEl ? canvasEl.getContext('2d') : null;
    var W = canvasEl ? canvasEl.width : 216;
    var H = canvasEl ? canvasEl.height : 216;

    function readPresetsForPanel() {
      if (!hologramInstance || !Array.isArray(hologramInstance._presets)) {
        return [];
      }
      var map = hologramInstance.presetMap;
      var ps = hologramInstance._presets;
      var out = [];
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        var anchor = map.get(p.id);
        if (!anchor) continue;
        out.push({ id: p.id, name: (p.name || p.id), warmth: anchor.warmth, intensity: anchor.intensity });
      }
      return out;
    }

    // Compute the gradient rect background that the existing
    // gradient panel uses — a left-to-right cool→warm wash. This
    // remains visually identical to the inline IIFE so existing
    // screenshots don't change.
    function paintBackground() {
      if (!ctx2d) return;
      var grad = ctx2d.createLinearGradient(0, 0, W, 0);
      var audio = audioRef.current;
      // Hue shift slightly toward the chromagram peak when available
      var tint = (audio && Array.isArray(audio.chromagram) && audio.chromagram.length)
        ? (audio.chromagram[Math.floor(audio.chromagram.length/2)] || 0) * 60
        : 0;
      grad.addColorStop(0,   'hsl(' + (210 - tint) + ', 70%, 14%)');
      grad.addColorStop(0.5, 'hsl(' + (280 - tint) + ', 50%, 18%)');
      grad.addColorStop(1,   'hsl(' + (350 - tint) + ', 70%, 22%)');
      ctx2d.fillStyle = grad;
      ctx2d.fillRect(0, 0, W, H);
    }

    function scatter() {
      var presets = readPresetsForPanel();
      if (!presets.length || !ctx2d) return [];

      var dpr = (typeof root.devicePixelRatio === 'number' && root.devicePixelRatio > 0)
        ? root.devicePixelRatio : 1;
      var pad = 8;

      var blend = null;
      var hState = hStateRef.current || {};
      var features = hState.features
        || { mood: 0.5, complexity: 0.5, motion: 0.5, color_temp: 0.5 };
      if (hologramInstance && typeof hologramInstance.computeBlend === 'function') {
        blend = hologramInstance.computeBlend(
          features, hState.focus, hState.depth, hState.focusAmount
        );
      }

      // Each preset dot.
      ctx2d.save();
      for (var i = 0; i < presets.length; i++) {
        var p = presets[i];
        var x = pad + p.warmth * (W - 2 * pad);
        var y = (H - pad) - p.intensity * (H - 2 * pad);
        var r = 3 * dpr;
        ctx2d.beginPath();
        ctx2d.arc(x, y, r, 0, Math.PI * 2);
        ctx2d.fillStyle = 'rgba(255,255,255,0.55)';
        ctx2d.fill();
      }

      // Blend-weighted top-N lines to focus.
      var neighbours = hState.neighbours || 4;
      var focusId = hState.focus;
      var focus = focusId
        ? presets.find(function (p) { return p.id === focusId; })
        : null;
      if (focus && blend) {
        var sorted = presets.slice()
          .filter(function (p) { return p.id !== focusId; })
          .map(function (p) { return { id: p.id, w: (blend[p.id] || 0), anchor: p }; })
          .sort(function (a, b) { return b.w - a.w; })
          .slice(0, neighbours);
        var fx = pad + focus.warmth * (W - 2 * pad);
        var fy = (H - pad) - focus.intensity * (H - 2 * pad);
        for (var k = 0; k < sorted.length; k++) {
          var s = sorted[k];
          if (s.w <= 0) continue;
          var nx = pad + s.anchor.warmth * (W - 2 * pad);
          var ny = (H - pad) - s.anchor.intensity * (H - 2 * pad);
          ctx2d.strokeStyle = 'rgba(255, 45, 138, ' + Math.min(1, 0.3 + s.w * 0.7) + ')';
          ctx2d.lineWidth = Math.max(1, s.w * 4 * dpr);
          ctx2d.beginPath();
          ctx2d.moveTo(fx, fy);
          ctx2d.lineTo(nx, ny);
          ctx2d.stroke();
        }
        // Focus dot larger.
        ctx2d.beginPath();
        ctx2d.arc(fx, fy, 5 * dpr, 0, Math.PI * 2);
        ctx2d.fillStyle = '#ff2d8a';
        ctx2d.fill();
      }

      // Track dot for current audio features, if available.
      if (audioRef.current && hologramInstance) {
        var audioAnchor = hologramInstance.embed(features);
        var tx = pad + audioAnchor.color_temp * (W - 2 * pad);
        var ty = (H - pad) - audioAnchor.mood * (H - 2 * pad);
        ctx2d.beginPath();
        ctx2d.arc(tx, ty, 4 * dpr, 0, Math.PI * 2);
        ctx2d.strokeStyle = '#00f0ff';
        ctx2d.lineWidth = 2 * dpr;
        ctx2d.stroke();
        ctx2d.beginPath();
        ctx2d.arc(tx, ty, 1.5 * dpr, 0, Math.PI * 2);
        ctx2d.fillStyle = '#00f0ff';
        ctx2d.fill();
      }

      ctx2d.restore();
      return presets;
    }

    function paintNeighbours(presets) {
      if (!neighboursListEl) return;
      var hState = hStateRef.current || {};
      var neighbours = hState.neighbours || 4;
      var focusId = hState.focus;
      var features = hState.features
        || { mood: 0.5, complexity: 0.5, motion: 0.5, color_temp: 0.5 };
      if (!hologramInstance || !presets.length) {
        neighboursListEl.textContent = '';
        return;
      }
      var blend = hologramInstance.computeBlend(
        features, focusId, hState.depth, hState.focusAmount
      );
      var sorted = presets.slice()
        .filter(function (p) { return p.id !== focusId; })
        .map(function (p) { return { name: p.name, w: (blend[p.id] || 0) }; })
        .sort(function (a, b) { return b.w - a.w; })
        .slice(0, neighbours);
      var lines = [];
      if (focusId) lines.push('focus: ' + focusId);
      for (var i = 0; i < sorted.length; i++) {
        lines.push(sorted[i].name + ' (' + (sorted[i].w * 100).toFixed(1) + '%)');
      }
      neighboursListEl.textContent = lines.join(' · ');
    }

    function paintPill() {
      if (!synthPillEl) return;
      var audio = audioRef.current;
      if (!audio) {
        synthPillEl.textContent = '— no track';
        return;
      }
      var dur = audio.duration ? (audio.duration).toFixed(1) + 's' : '';
      var chromaIndex = audio.chromagram
        ? indexOfMax(Array.from(audio.chromagram)) : -1;
      var noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      var keyTxt = chromaIndex >= 0
        ? (noteNames[chromaIndex] + ' ' + (audio.scale || 'maj'))
        : (audio.key || 'C');
      var drTxt = audio.dynamicRange != null
        ? 'dr ' + (audio.dynamicRange * 30).toFixed(0) + 'dB'
        : '';
      var bpmTxt = audio.bpm ? (audio.bpm.toFixed(0) + 'bpm') : '';
      synthPillEl.textContent = [bpmTxt, keyTxt, drTxt, dur].filter(Boolean).join(' · ');
    }

    function indexOfMax(arr) {
      var m = -Infinity, idx = -1;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] > m) { m = arr[i]; idx = i; }
      }
      return idx;
    }

    function redraw() {
      if (!ctx2d) return;
      paintBackground();
      var presets = scatter();
      paintNeighbours(presets);
      paintPill();
    }

    return { redraw: redraw };
  }

  // ---- public ---------------------------------------------------------

  root.SWR_HOLOGRAM_INSTALL = {
    wrapApplyR: wrapApplyR,
    mountPanel: mountPanel,
    attach: attach,
    _impl: {
      presetGain: presetGain,
      blendMultiplierFor: blendMultiplierFor,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
