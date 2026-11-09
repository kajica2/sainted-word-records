// client/remo-shapes.client.js
// Remo Panel 2.0 — envelope shapes, curves, and Float32 LUT bake/read.

(function () {
  'use strict';
  if (window.SWR_REMO_SHAPES) return;

  var LUT_SIZE = 512;

  function clamp01(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t;
  }

  function curve(kind, x) {
    var t = clamp01(x);
    if (kind === 'exp') return t * t;
    if (kind === 'log') return Math.sqrt(t);
    if (kind === 'smooth') return t * t * (3 - 2 * t);
    return t;
  }

  function sampleAdsr(t, a, d, s, r) {
    var attack = Math.max(a, 0.0001);
    var decay = Math.max(d, 0);
    var release = Math.max(r, 0);
    var sustain = clamp01(s);
    var holdEnd = attack + decay;
    var total = holdEnd + release;
    if (total <= 0) return 0;
    var u = t * total;
    if (u < attack) return u / attack;
    if (u < holdEnd) {
      var dd = decay <= 0 ? 0 : (u - attack) / decay;
      return 1 - (1 - sustain) * dd;
    }
    if (release <= 0) return 0;
    var rr = (u - holdEnd) / release;
    return sustain * (1 - rr);
  }

  function sampleAd(t, a, d) {
    return sampleAdsr(t, a, d, 0, 0);
  }

  function sampleStep(t, steps) {
    if (!steps || !steps.length) return 0;
    var i = Math.min(steps.length - 1, Math.floor(clamp01(t) * steps.length));
    return clamp01(+steps[i] || 0);
  }

  function asPoint(p) {
    if (Array.isArray(p)) return { t: +p[0] || 0, v: +p[1] || 0 };
    return { t: +(p && p.t) || 0, v: +(p && p.v) || 0 };
  }

  function sampleBreakpoints(t, points) {
    if (!points || !points.length) return 0;
    var sorted = points.map(asPoint).sort(function (a, b) { return a.t - b.t; });
    var x = clamp01(t);
    if (x <= sorted[0].t) return clamp01(sorted[0].v);
    var last = sorted[sorted.length - 1];
    if (x >= last.t) return clamp01(last.v);
    for (var i = 0; i < sorted.length - 1; i++) {
      var a = sorted[i];
      var b = sorted[i + 1];
      if (x >= a.t && x <= b.t) {
        var span = b.t - a.t;
        var u = span <= 0 ? 0 : (x - a.t) / span;
        return clamp01(a.v + (b.v - a.v) * u);
      }
    }
    return 0;
  }

  function sampleShape(shape, t) {
    if (!shape) return 0;
    if (shape.kind === 'ADSR') return sampleAdsr(t, shape.a, shape.d, shape.s, shape.r);
    if (shape.kind === 'AD') return sampleAd(t, shape.a, shape.d);
    if (shape.kind === 'STEP') return sampleStep(t, shape.steps);
    if (shape.kind === 'BREAKPOINT') return sampleBreakpoints(t, shape.points);
    return 0;
  }

  var PRESETS = {
    pluck: { kind: 'AD', a: 0.01, d: 0.25, seconds: 0.25, loop: false, label: 'pluck' },
    swell: { kind: 'ADSR', a: 1.2, d: 0.4, s: 0.9, r: 1.2, seconds: 3, loop: false, label: 'swell' },
    pump: {
      kind: 'BREAKPOINT',
      points: [{ t: 0, v: 0 }, { t: 0.15, v: 1 }, { t: 0.45, v: 0.2 }, { t: 1, v: 0 }],
      seconds: 0.5,
      timeBase: 'beats',
      beats: 1,
      loop: true,
      label: 'pump',
    },
    wobble: { kind: 'STEP', steps: [1, 0.2, 0.85, 0.15, 0.7, 0.1, 0.55, 0], seconds: 2, loop: true, label: 'wobble' },
    gate: { kind: 'STEP', steps: [1, 0], seconds: 0.5, loop: true, label: 'gate' },
    riser: { kind: 'AD', a: 0.01, d: 2, seconds: 2, curve: 'log', loop: false, label: 'riser' },
    drift: {
      kind: 'BREAKPOINT',
      points: [
        { t: 0, v: 0.35 }, { t: 0.2, v: 0.55 }, { t: 0.45, v: 0.3 },
        { t: 0.7, v: 0.7 }, { t: 1, v: 0.4 },
      ],
      seconds: 4,
      loop: true,
      label: 'drift',
    },
  };

  function buildLUT(shape, size) {
    var n = size > 0 ? size : LUT_SIZE;
    var lut = new Float32Array(n);
    var curveKind = (shape && shape.curve) || 'linear';
    for (var i = 0; i < n; i++) {
      var t = n <= 1 ? 0 : i / (n - 1);
      lut[i] = curve(curveKind, sampleShape(shape, t));
    }
    return lut;
  }

  function readLUT(lut, t) {
    if (!lut || !lut.length) return 0;
    var x = clamp01(t) * (lut.length - 1);
    var i = Math.floor(x);
    var f = x - i;
    var a = lut[i];
    var b = lut[Math.min(lut.length - 1, i + 1)];
    return a + (b - a) * f;
  }

  function presetIds() {
    return Object.keys(PRESETS);
  }

  function preset(id) {
    var p = PRESETS[id];
    if (!p) return null;
    return JSON.parse(JSON.stringify(p));
  }

  window.SWR_REMO_SHAPES = {
    LUT_SIZE: LUT_SIZE,
    PRESETS: PRESETS,
    presetIds: presetIds,
    preset: preset,
    curve: curve,
    sampleShape: sampleShape,
    buildLUT: buildLUT,
    readLUT: readLUT,
  };
})();
