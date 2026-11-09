// client/wave-lines.client.js
// Top layer for NEON: SVG polylines only. The picture stays on the
// canvas; this sheet sits above it and redraws its paths every frame.
// CSS animation is off on this page, so the motion is the path data.

(function () {
  'use strict';
  if (window.SWR_WAVE_LINES) return;

  var PRESETS = [
    { id: 'tide', label: 'Tide', lines: 3, amp: 0.07, freq: 1.4, speed: 0.28, width: 1.6, kind: 'sine', colors: ['#ff2d8a', '#00f0ff', '#fff04a'], audio: 'bass', audioAmt: 0.45 },
    { id: 'ripple', label: 'Ripple', lines: 9, amp: 0.018, freq: 7, speed: 1.6, width: 1, kind: 'sine', colors: ['#00f0ff'], audio: 'treble', audioAmt: 0.9 },
    { id: 'pulse', label: 'Pulse', lines: 4, amp: 0.028, freq: 2.2, speed: 0.9, width: 2, kind: 'sine', colors: ['#ff2d8a'], audio: 'bass', audioAmt: 2.6 },
    { id: 'scan', label: 'Scan', lines: 5, amp: 0.012, freq: 3, speed: 0.22, width: 1.2, kind: 'scan', colors: ['#fff04a', '#00f0ff'], audio: 'rms', audioAmt: 0.7 },
    { id: 'ribbon', label: 'Ribbon', lines: 2, amp: 0.11, freq: 1.1, speed: 0.4, width: 3.2, kind: 'sine', colors: ['#ff2d8a', '#fff04a'], audio: 'mid', audioAmt: 0.55 },
    { id: 'stack', label: 'Stack', lines: 7, amp: 0.02, freq: 2, speed: 0.55, width: 1.1, kind: 'stack', colors: ['#ff2d8a', '#00f0ff', '#fff04a', '#00ffa3'], audio: 'beat', audioAmt: 0.5 },
    { id: 'spike', label: 'Spike', lines: 1, amp: 0.02, freq: 8, speed: 0.7, width: 1.8, kind: 'spike', colors: ['#00ffa3'], audio: 'onset', audioAmt: 4 },
  ];

  var STEPS = 48;
  var state = { id: 'tide', phase: 0, svg: null, paths: [] };

  function presetById(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  function featOf(feat, name) {
    var n = feat && +feat[name];
    return n > 0 ? n : 0;
  }

  function yAt(preset, line, xNorm, phase, feat, h) {
    var audio = featOf(feat, preset.audio);
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
      return h * 0.5 - peak * h * (0.04 + audio * preset.audioAmt * 0.04);
    }
    var spread = (line - (n - 1) / 2) * h * 0.08;
    return h * 0.5 + spread + Math.sin(xNorm * Math.PI * 2 * preset.freq + phase * Math.PI * 2 + line * 0.9) * amp;
  }

  function buildPaths(preset, phase, feat, w, h) {
    var out = [];
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
    while (state.paths.length < preset.lines) {
      var path = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      state.paths.push(path);
    }
    for (var i = 0; i < state.paths.length; i++) {
      state.paths[i].style.display = i < preset.lines ? '' : 'none';
    }
  }

  function paint(preset, feat, w, h) {
    if (!state.svg) return;
    state.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    state.svg.setAttribute('data-wave', preset.id);
    var built = buildPaths(preset, state.phase, feat, w, h);
    syncNodes(preset);
    for (var i = 0; i < built.length; i++) {
      var node = state.paths[i];
      node.setAttribute('d', built[i].d);
      node.setAttribute('stroke', built[i].stroke);
      node.setAttribute('stroke-width', String(built[i].width));
    }
  }

  function setPreset(id) {
    var preset = presetById(id);
    if (!preset) return false;
    state.id = preset.id;
    if (state.svg) state.svg.setAttribute('data-wave', preset.id);
    return true;
  }

  function frame(dt, feat, w, h) {
    var preset = presetById(state.id);
    if (!preset || !state.svg) return false;
    var d = +dt;
    if (!isFinite(d) || d < 0) d = 0;
    if (d > 0.05) d = 0.05;
    if (!(typeof document !== 'undefined' && document.hidden)) state.phase += d * preset.speed;
    var width = w > 0 ? w : state.svg.clientWidth || 1;
    var height = h > 0 ? h : state.svg.clientHeight || 1;
    paint(preset, feat || {}, width, height);
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
    paint(presetById(state.id), {}, stage.clientWidth || 640, stage.clientHeight || 360);
    return state.svg;
  }

  window.SWR_WAVE_LINES = {
    PRESETS: PRESETS,
    presetById: presetById,
    buildPaths: buildPaths,
    rangeOf: rangeOf,
    yAt: yAt,
    setPreset: setPreset,
    getPreset: function () { return presetById(state.id); },
    frame: frame,
    mount: mount,
    _state: state,
  };

  function boot() {
    if (!document.querySelector) return;
    mount(document.querySelector('section.stage'));
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
