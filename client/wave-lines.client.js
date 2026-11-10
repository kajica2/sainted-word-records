// client/wave-lines.client.js
// NEON audio top layer: SVG polylines above the media stack. The picture
// stays on the canvas; this sheet redraws from A.feat every frame.
// Public API alias: window.SWR_AUDIO_TOP === window.SWR_WAVE_LINES.

(function () {
  'use strict';
  if (window.SWR_WAVE_LINES) return;

  // Full catalogue (internal + public). `public: true` marks the few
  // presets the Demo panel exposes. `audioMix` is Phase B multi-band.
  var PRESETS = [
    { id: 'tide', label: 'Tide', lines: 3, amp: 0.07, freq: 1.4, speed: 0.28, width: 1.6, kind: 'sine', colors: ['#ff2d8a', '#00f0ff', '#fff04a'], audio: 'bass', audioAmt: 0.45, audioMix: { bass: 1 }, public: false },
    { id: 'ripple', label: 'Ripple', lines: 9, amp: 0.018, freq: 7, speed: 1.6, width: 1, kind: 'sine', colors: ['#00f0ff'], audio: 'treble', audioAmt: 0.9, audioMix: { treble: 1 }, public: false },
    { id: 'pulse', label: 'Pulse', lines: 4, amp: 0.028, freq: 2.2, speed: 0.9, width: 2, kind: 'sine', colors: ['#ff2d8a'], audio: 'bass', audioAmt: 2.6, audioMix: { bass: 0.7, beat: 0.3 }, beatSnap: true, public: true },
    { id: 'scan', label: 'Scan', lines: 5, amp: 0.012, freq: 3, speed: 0.22, width: 1.2, kind: 'scan', colors: ['#fff04a', '#00f0ff'], audio: 'rms', audioAmt: 0.7, audioMix: { rms: 0.55, treble: 0.45 }, public: true },
    { id: 'ribbon', label: 'Ribbon', lines: 2, amp: 0.11, freq: 1.1, speed: 0.4, width: 3.2, kind: 'sine', colors: ['#ff2d8a', '#fff04a'], audio: 'mid', audioAmt: 0.55, audioMix: { mid: 0.75, rms: 0.25 }, public: true },
    { id: 'stack', label: 'Stack', lines: 7, amp: 0.02, freq: 2, speed: 0.55, width: 1.1, kind: 'stack', colors: ['#ff2d8a', '#00f0ff', '#fff04a', '#00ffa3'], audio: 'beat', audioAmt: 0.5, audioMix: { beat: 1 }, public: false },
    { id: 'spike', label: 'Spike', lines: 1, amp: 0.02, freq: 8, speed: 0.7, width: 1.8, kind: 'spike', colors: ['#00ffa3'], audio: 'onset', audioAmt: 4, audioMix: { onset: 1 }, onsetDecay: true, public: true },
    { id: 'off', label: 'Off', lines: 0, amp: 0, freq: 1, speed: 0, width: 0, kind: 'off', colors: [], audio: 'rms', audioAmt: 0, audioMix: {}, public: true },
  ];

  // Stable public order for the Demo panel (few presets + Off).
  var PRESETS_PUBLIC = ['pulse', 'spike', 'scan', 'ribbon', 'off']
    .map(function (id) {
      for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
      return null;
    })
    .filter(Boolean);
  var STORAGE_KEY = 'swr.neon.audioTop.preset';
  var STEPS = 48;
  var state = {
    id: 'pulse',
    phase: 0,
    svg: null,
    paths: [],
    sens: 1,
    onsetEnv: 0,
    lastOnset: 0,
    lastBeat: 0,
    opacity: 1,
  };

  function presetById(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  function featOf(feat, name) {
    var n = feat && +feat[name];
    return n > 0 ? n : 0;
  }

  function resolveSens(feat) {
    var s = +state.sens;
    if (!isFinite(s) || s <= 0) s = 1;
    var live = feat && feat._sens;
    if (live == null && typeof window !== 'undefined' && window.Audio && window.Audio.params) {
      live = window.Audio.params.sens;
    }
    if (live == null && typeof window !== 'undefined' && window.A && window.A.params) {
      live = window.A.params.sens;
    }
    var n = +live;
    if (isFinite(n) && n > 0) s = n;
    return s;
  }

  function mixAudio(preset, feat) {
    var mix = preset.audioMix;
    if (!mix || !Object.keys(mix).length) {
      return featOf(feat, preset.audio);
    }
    var sum = 0;
    var wsum = 0;
    for (var key in mix) {
      if (!Object.prototype.hasOwnProperty.call(mix, key)) continue;
      var w = +mix[key];
      if (!(w > 0)) continue;
      var v = key === 'onset' && preset.onsetDecay ? state.onsetEnv : featOf(feat, key);
      sum += v * w;
      wsum += w;
    }
    return wsum > 0 ? sum / wsum : 0;
  }

  function updateEnvelopes(dt, feat, preset) {
    var onset = featOf(feat, 'onset');
    var beat = featOf(feat, 'beat');
    // Rising-edge onset → punch the envelope; otherwise exponential decay.
    if (onset > state.lastOnset + 0.08 && onset > 0.2) {
      state.onsetEnv = Math.max(state.onsetEnv, Math.min(1, onset));
    } else {
      var decay = Math.exp(-dt / 0.18);
      state.onsetEnv *= decay;
      if (state.onsetEnv < 0.001) state.onsetEnv = 0;
    }
    state.lastOnset = onset;

    if (preset && preset.beatSnap && beat > state.lastBeat + 0.12 && beat > 0.35) {
      state.phase += 0.08;
    }
    state.lastBeat = beat;

    // Opacity breathe from rms (quiet → softer sheet).
    var rms = featOf(feat, 'rms');
    var target = 0.35 + Math.min(1, rms * 1.4) * 0.65;
    state.opacity += (target - state.opacity) * Math.min(1, dt * 6);
  }

  function yAt(preset, line, xNorm, phase, feat, h) {
    if (preset.kind === 'off') return h * 0.5;
    var sens = resolveSens(feat);
    var audio = mixAudio(preset, feat) * sens;
    var amp = h * preset.amp * (1 + audio * preset.audioAmt);
    var n = preset.lines;
    if (preset.kind === 'scan') {
      var travel = (line / n + phase) % 1;
      return travel * h + Math.sin(xNorm * Math.PI * 2 * preset.freq + phase * Math.PI * 2) * amp;
    }
    if (preset.kind === 'stack') {
      var band = ((line + 0.5) / n) * h;
      return band + Math.sin(xNorm * Math.PI * 2 * preset.freq + phase * Math.PI * 2 + line * 0.7) * amp;
    }
    if (preset.kind === 'spike') {
      var s = Math.sin(xNorm * Math.PI * 2 * preset.freq + phase * Math.PI * 4);
      var peak = s > 0 ? Math.pow(s, 8) : 0;
      var spikeAudio = (preset.onsetDecay ? state.onsetEnv : featOf(feat, 'onset')) * sens;
      return h * 0.5 - peak * h * (0.04 + spikeAudio * preset.audioAmt * 0.04);
    }
    var spread = (line - (n - 1) / 2) * h * 0.08;
    return h * 0.5 + spread + Math.sin(xNorm * Math.PI * 2 * preset.freq + phase * Math.PI * 2 + line * 0.9) * amp;
  }

  function buildPaths(preset, phase, feat, w, h) {
    var out = [];
    if (!preset || preset.kind === 'off' || preset.lines <= 0) return out;
    var width = w > 0 ? w : 1;
    var height = h > 0 ? h : 1;
    for (var line = 0; line < preset.lines; line++) {
      var d = '';
      for (var i = 0; i <= STEPS; i++) {
        var xNorm = i / STEPS;
        var x = (xNorm * width).toFixed(1);
        var y = yAt(preset, line, xNorm, phase, feat, height).toFixed(1);
        d += (i === 0 ? 'M' : 'L') + x + ' ' + y;
      }
      out.push({
        d: d,
        stroke: preset.colors[line % preset.colors.length],
        width: preset.width,
      });
    }
    return out;
  }

  function rangeOf(preset, phase, feat, h) {
    var min = Infinity;
    var max = -Infinity;
    if (!preset || preset.kind === 'off' || preset.lines <= 0) {
      return { min: 0, max: 0, span: 0 };
    }
    for (var line = 0; line < preset.lines; line++) {
      for (var i = 0; i <= STEPS; i++) {
        var y = yAt(preset, line, i / STEPS, phase, feat, h);
        if (y < min) min = y;
        if (y > max) max = y;
      }
    }
    return { min: min, max: max, span: max - min };
  }

  function ensureSvg(host) {
    if (state.svg) return state.svg;
    var doc = host.ownerDocument || document;
    var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'swr-wave-lines';
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('data-wave', state.id);
    svg.setAttribute('data-audio-top', state.id);
    // The renderer floors its drawing size at 640×360, so the viewBox can
    // be a different shape from the stage. Stretch to the element, the
    // same way the canvas bitmap stretches into its CSS box.
    svg.setAttribute('preserveAspectRatio', 'none');
    var canvas = host.querySelector ? host.querySelector('#render') : null;
    if (canvas && canvas.nextSibling) host.insertBefore(svg, canvas.nextSibling);
    else host.appendChild(svg);
    state.svg = svg;
    return svg;
  }

  function syncNodes(preset) {
    var svg = state.svg;
    if (!svg) return;
    var need = preset && preset.lines > 0 ? preset.lines : 0;
    while (state.paths.length < need) {
      var path = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      state.paths.push(path);
    }
    for (var i = 0; i < state.paths.length; i++) {
      state.paths[i].style.display = i < need ? '' : 'none';
    }
  }

  function applyVisibility(preset) {
    if (!state.svg) return;
    var off = !preset || preset.kind === 'off' || preset.lines <= 0;
    state.svg.style.display = off ? 'none' : '';
    state.svg.style.opacity = off ? '0' : String(state.opacity);
  }

  function paint(preset, feat, w, h) {
    if (!state.svg) return;
    applyVisibility(preset);
    if (!preset || preset.kind === 'off' || preset.lines <= 0) {
      state.svg.setAttribute('data-wave', 'off');
      state.svg.setAttribute('data-audio-top', 'off');
      syncNodes(preset);
      return;
    }
    state.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    state.svg.setAttribute('data-wave', preset.id);
    state.svg.setAttribute('data-audio-top', preset.id);
    var built = buildPaths(preset, state.phase, feat, w, h);
    syncNodes(preset);
    for (var i = 0; i < built.length; i++) {
      var node = state.paths[i];
      node.setAttribute('d', built[i].d);
      node.setAttribute('stroke', built[i].stroke);
      node.setAttribute('stroke-width', String(built[i].width));
    }
  }

  function persist(id) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, id);
    } catch (_) { /* private mode */ }
  }

  function restoreId() {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function setPreset(id) {
    var preset = presetById(id);
    if (!preset) return false;
    state.id = preset.id;
    if (state.svg) {
      state.svg.setAttribute('data-wave', preset.id);
      state.svg.setAttribute('data-audio-top', preset.id);
      applyVisibility(preset);
    }
    persist(preset.id);
    return true;
  }

  function setEnabled(on) {
    if (on) {
      if (state.id === 'off') return setPreset('pulse');
      return setPreset(state.id);
    }
    return setPreset('off');
  }

  function setSens(v) {
    var n = +v;
    if (!isFinite(n) || n <= 0) n = 1;
    state.sens = n;
    return state.sens;
  }

  function frame(dt, feat, w, h) {
    var preset = presetById(state.id);
    if (!preset || !state.svg) return false;
    var d = +dt;
    if (!isFinite(d) || d < 0) d = 0;
    if (d > 0.05) d = 0.05;
    var f = feat || {};
    updateEnvelopes(d, f, preset);
    if (preset.kind !== 'off' && !(typeof document !== 'undefined' && document.hidden)) {
      state.phase += d * preset.speed;
    }
    var width = w > 0 ? w : state.svg.clientWidth || 1;
    var height = h > 0 ? h : state.svg.clientHeight || 1;
    paint(preset, f, width, height);
    return true;
  }

  function mount(host) {
    var stage = host || (document.querySelector && document.querySelector('section.stage'));
    if (!stage) return null;
    ensureSvg(stage);
    if (!document.getElementById('swr-wave-lines-css')) {
      var style = document.createElement('style');
      style.id = 'swr-wave-lines-css';
      style.textContent = '#swr-wave-lines{position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;overflow:visible}';
      document.head.appendChild(style);
    }
    var saved = restoreId();
    if (saved && presetById(saved)) state.id = saved;
    paint(presetById(state.id), {}, stage.clientWidth || 640, stage.clientHeight || 360);
    return state.svg;
  }

  var api = {
    PRESETS: PRESETS,
    PRESETS_PUBLIC: PRESETS_PUBLIC,
    STORAGE_KEY: STORAGE_KEY,
    presetById: presetById,
    buildPaths: buildPaths,
    rangeOf: rangeOf,
    yAt: yAt,
    mixAudio: mixAudio,
    setPreset: setPreset,
    setEnabled: setEnabled,
    setSens: setSens,
    getPreset: function () { return presetById(state.id); },
    getEnabled: function () {
      var p = presetById(state.id);
      return !!(p && p.kind !== 'off');
    },
    frame: frame,
    mount: mount,
    _state: state,
  };

  window.SWR_WAVE_LINES = api;
  window.SWR_AUDIO_TOP = api;

  function boot() {
    if (!document.querySelector) return;
    mount(document.querySelector('section.stage'));
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
