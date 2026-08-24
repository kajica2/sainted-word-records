// engine-lfos.client.js — registry + 9 LFO/modulator modules for SWR engine
// layers. Sits between SWR_TIMING.step() and the per-layer draw call inside
// SWR_RENDER.frame() — reads each layer's `l.modulators` array, calls
// sample() on every attached module, and merges the result into the reactive
// `r` that the engine's own drawLayer() consumes.
//
// Each module is the same shape:
//   { id, kind, version, defaults, needsAudio, unipolar,
//     sample(dt, ctx) -> number in [-1, +1] (or [0,1] if unipolar),
//     onAttach(layer), onDetach(layer), params }
//
// Modules attached to a layer via:
//   l.modulators = [{ id: 'lfo-cluster', target: 'opacity', gain: 0.3, params: { rateHz: 0.25 } }]
//
// `target` matches the existing reactor targets in applyR():
//   'opacity'    additive, clamped [0, 1]
//   'scale'      multiplicative, baseScale * (1 + value * gain)
//   'x' / 'y'    additive in CSS pixels (gain as multiplier)
//   'hue'        additive degrees, clamped to [-180, 180]
//   'rot'        additive degrees (note: applyR folds rot into [-90, 90])
//   'brightness' multiplicative, * (1 + value * gain)
//   'contrast'   multiplicative, * (1 + value * gain)
//
// Public API on window.SWR_LFOS:
//   .list                 — registry of all built-in modules
//   .get(id)              — fetch a module by id
//   .attach(layer, id, opts) — convenience wrapper
//   .detach(layer, id)    — remove a module from a layer
//   .apply(dt, layer, r)  — called by SWR_RENDER.frame() each frame
//   .setParam(id, layer, k, v) — edit a module's params on a specific layer
//
// Output is opt-in: a fresh layer has `modulators: []` and no LFOs are
// applied. The LFO panel or future scripts populate `l.modulators` per-layer.

(function () {
  'use strict';
  if (window.SWR_LFOS) return;

  // ---- module factory helpers -------------------------------------------

  // LFO step — phase advances by dt * rateHz, wraps in [0, 1).
  function makeLfoPhase(rateHz) {
    let phase = 0;
    return {
      step(dt) { phase = (phase + dt * rateHz) % 1; return phase; },
      reset(p) { phase = p || 0; },
    };
  }

  // ---- the 9 modules ----------------------------------------------------

  const modules = [];

  // lfo-cluster — 3 detuned sines on prime ratios, lush organic modulation.
  modules.push({
    id: 'lfo-cluster', kind: 'lfo', version: '9.0',
    defaults: { rateHz: 0.18, depth: 0.7 },
    needsAudio: false, unipolar: false,
    params: { rateHz: { type: 'number', min: 0.01, max: 5, step: 0.01 },
              depth:  { type: 'number', min: 0,    max: 1, step: 0.05 } },
    onAttach() { this._phase = 0; this._t = 0; },
    sample(dt) {
      this._t += dt;
      const r = (this._params && this._params.rateHz) || this.defaults.rateHz;
      const p = (this._t * r) % 1;
      const a = Math.sin(2 * Math.PI * p);
      const b = Math.sin(2 * Math.PI * p * 1.005);
      const c = Math.sin(2 * Math.PI * p * 0.997);
      const depth = (this._params && this._params.depth) || this.defaults.depth;
      return (a + b + c) / 3 * depth;
    },
  });

  // lfo-pnoise — Perlin-style value noise, smooth dt-interpolated.
  modules.push({
    id: 'lfo-pnoise', kind: 'lfo', version: '4.2',
    defaults: { rateHz: 2.5, depth: 0.6 },
    needsAudio: false, unipolar: true,
    params: { rateHz: { type: 'number', min: 0.1, max: 20, step: 0.1 },
              depth:  { type: 'number', min: 0,   max: 1,  step: 0.05 } },
    onAttach() { this._t = 0; this._last = Math.random(); this._next = Math.random(); this._switchAt = 1 / ((this._params && this._params.rateHz) || this.defaults.rateHz); },
    sample(dt) {
      const r = (this._params && this._params.rateHz) || this.defaults.rateHz;
      this._switchAt = 1 / r;
      this._t += dt;
      while (this._t >= this._switchAt) {
        this._t -= this._switchAt;
        this._last = this._next;
        this._next = Math.random();
      }
      const f = this._t / this._switchAt;
      // Smoothstep interpolation
      const s = f * f * (3 - 2 * f);
      const v = this._last * (1 - s) + this._next * s;
      const depth = (this._params && this._params.depth) || this.defaults.depth;
      return (v * 2 - 1) * depth;   // [0,1] -> [-1,+1]
    },
  });

  // mod-floe — sample-and-hold on Audio.feat.centroid. Output steps every holdMs.
  modules.push({
    id: 'mod-floe', kind: 'mod', version: '1.2',
    defaults: { holdMs: 600, depth: 0.8 },
    needsAudio: true, unipolar: false,
    params: { holdMs: { type: 'number', min: 100, max: 4000, step: 50 },
              depth:  { type: 'number', min: 0,   max: 1,    step: 0.05 } },
    onAttach() { this._held = 0; this._lastSwitch = 0; },
    sample(dt, ctx) {
      const audio = (ctx && ctx.audio) || (window.SWR && window.SWR.Audio);
      const centroid = (audio && audio.feat && audio.feat.centroid) || 0;
      const holdMs = (this._params && this._params.holdMs) || this.defaults.holdMs;
      const now = (ctx && ctx.now) ? ctx.now() : performance.now();
      if (now - this._lastSwitch >= holdMs) {
        this._held = centroid;
        this._lastSwitch = now;
      }
      const depth = (this._params && this._params.depth) || this.defaults.depth;
      // centroid is in [0, 1]; centre it to [-1, +1] before applying depth.
      return (this._held * 2 - 1) * depth;
    },
  });

  // lfo-seq — stepped sequencer over a 16-step pattern array.
  modules.push({
    id: 'lfo-seq', kind: 'lfo', version: '1.1',
    defaults: { stepHz: 2, depth: 0.7 },
    needsAudio: false, unipolar: false,
    params: { stepHz: { type: 'number', min: 0.1, max: 20, step: 0.1 },
              depth:  { type: 'number', min: 0,   max: 1,  step: 0.05 } },
    // Default 16-step pattern: rising-then-falling sine-ish.
    onAttach() { this._step = 0; this._t = 0; this._pattern = [
      0.0, 0.4, 0.7, 0.9, 0.6, 0.2, -0.2, -0.6,
      -0.9, -0.6, -0.2, 0.2, 0.6, 0.9, 0.7, 0.4,
    ]; },
    sample(dt) {
      const hz = (this._params && this._params.stepHz) || this.defaults.stepHz;
      this._t += dt;
      const stepDur = 1 / hz;
      while (this._t >= stepDur) { this._t -= stepDur; this._step = (this._step + 1) % this._pattern.length; }
      const depth = (this._params && this._params.depth) || this.defaults.depth;
      return this._pattern[this._step] * depth;
    },
  });

  // lfo-morf — morph between two waveforms (sine ↔ triangle) over morphSec.
  modules.push({
    id: 'lfo-morf', kind: 'lfo', version: '10.4',
    defaults: { rateHz: 0.3, depth: 0.6, morphSec: 8 },
    needsAudio: false, unipolar: false,
    params: { rateHz: { type: 'number', min: 0.01, max: 5, step: 0.01 },
              depth:  { type: 'number', min: 0,    max: 1, step: 0.05 },
              morphSec: { type: 'number', min: 1, max: 60, step: 1 } },
    onAttach() { this._phase = 0; this._morphT = 0; },
    sample(dt) {
      const r = (this._params && this._params.rateHz) || this.defaults.rateHz;
      const morphSec = (this._params && this._params.morphSec) || this.defaults.morphSec;
      this._phase = (this._phase + dt * r) % 1;
      this._morphT = (this._morphT + dt / morphSec) % 1;
      const sine = Math.sin(2 * Math.PI * this._phase);
      const tri  = (2 * Math.abs(2 * ((this._phase + 0.25) % 1) - 1) - 1);
      const mix = (Math.sin(2 * Math.PI * this._morphT) + 1) / 2;   // 0..1
      const depth = (this._params && this._params.depth) || this.defaults.depth;
      return (sine * (1 - mix) + tri * mix) * depth;
    },
  });

  // lfo-rrnd — random walk on a 1D float, recentred to [-1,+1] every recenterMs.
  modules.push({
    id: 'lfo-rrnd', kind: 'lfo', version: '8.1',
    defaults: { depth: 0.7, recenterMs: 4000 },
    needsAudio: false, unipolar: false,
    params: { depth:      { type: 'number', min: 0,   max: 1,    step: 0.05 },
              recenterMs: { type: 'number', min: 200, max: 20000, step: 100 } },
    onAttach() { this._v = 0; this._lastRecenter = 0; },
    sample(dt, ctx) {
      const now = (ctx && ctx.now) ? ctx.now() : performance.now();
      const recenterMs = (this._params && this._params.recenterMs) || this.defaults.recenterMs;
      if (now - this._lastRecenter >= recenterMs) {
        this._v = (Math.random() * 2 - 1);
        this._lastRecenter = now;
      }
      // Small per-frame jitter
      this._v += (Math.random() * 2 - 1) * 0.02;
      this._v = Math.max(-1, Math.min(1, this._v));
      const depth = (this._params && this._params.depth) || this.defaults.depth;
      return this._v * depth;
    },
  });

  // lfo-sketch — hand-drawn-style path (Bezier control points drift on slow noise).
  // Output is a slow drifting scalar in [-1, +1] for x or y target use.
  modules.push({
    id: 'lfo-sketch', kind: 'lfo', version: '3.4',
    defaults: { rateHz: 0.4, depth: 0.8 },
    needsAudio: false, unipolar: false,
    params: { rateHz: { type: 'number', min: 0.05, max: 3, step: 0.05 },
              depth:  { type: 'number', min: 0,    max: 1, step: 0.05 } },
    onAttach() { this._phase1 = 0; this._phase2 = 0; },
    sample(dt) {
      const r = (this._params && this._params.rateHz) || this.defaults.rateHz;
      this._phase1 = (this._phase1 + dt * r) % 1;
      this._phase2 = (this._phase2 + dt * r * 1.618) % 1;   // golden-ratio drift
      const a = Math.sin(2 * Math.PI * this._phase1);
      const b = Math.sin(2 * Math.PI * this._phase2);
      const depth = (this._params && this._params.depth) || this.defaults.depth;
      // Crossfade the two drifts — produces the wandering hand-drawn feel.
      const w = (Math.sin(2 * Math.PI * (this._phase1 + this._phase2) / 2) + 1) / 2;
      return (a * (1 - w) + b * w) * depth;
    },
  });

  // lfo-d3 — 3D position oscillator; projects to 2D for x/y target use.
  modules.push({
    id: 'lfo-d3', kind: 'lfo', version: '5.2',
    defaults: { rateHz: 0.07, depth: 0.6 },
    needsAudio: false, unipolar: false,
    params: { rateHz: { type: 'number', min: 0.01, max: 2, step: 0.01 },
              depth:  { type: 'number', min: 0,    max: 1, step: 0.05 } },
    onAttach() { this._t = 0; },
    sample(dt) {
      const r = (this._params && this._params.rateHz) || this.defaults.rateHz;
      this._t += dt * r;
      // Rotate a unit vector on three axes at golden-ratio ratios, project to x.
      const x = Math.cos(this._t * 2 * Math.PI) * Math.cos(this._t * 2 * Math.PI * 0.618);
      const depth = (this._params && this._params.depth) || this.defaults.depth;
      return x * depth;
    },
  });

  // mod-atrg — audio-triggered envelope: on each Audio beat onset, fire an
  // exponential decay e^(-t/tau). Default tau = 180ms.
  modules.push({
    id: 'mod-atrg', kind: 'mod', version: '5.1',
    defaults: { tauMs: 180, depth: 0.9 },
    needsAudio: true, unipolar: true,
    params: { tauMs: { type: 'number', min: 50, max: 2000, step: 10 },
              depth: { type: 'number', min: 0,   max: 1,    step: 0.05 } },
    onAttach() { this._lastBeat = 0; this._v = 0; },
    sample(dt, ctx) {
      const audio = (ctx && ctx.audio) || (window.SWR && window.SWR.Audio);
      const beat = (audio && audio.feat && audio.feat.beat) || 0;
      const now = (ctx && ctx.now) ? ctx.now() : performance.now();
      // Edge-trigger on beatPulse rising.
      if (beat > 0.5 && !this._lastBeat) {
        this._v = 1;
        this._lastFireAt = now;
      }
      this._lastBeat = beat > 0.5;
      if (this._v > 0) {
        const tau = ((this._params && this._params.tauMs) || this.defaults.tauMs) / 1000;
        this._v = Math.exp(-(now - (this._lastFireAt || now)) / 1000 / tau);
        if (this._v < 0.001) this._v = 0;
      }
      const depth = (this._params && this._params.depth) || this.defaults.depth;
      return this._v * depth;
    },
  });

  // ---- instance helpers -------------------------------------------------

  function instantiate(mod, layer) {
    const inst = {
      id: mod.id, version: mod.version, kind: mod.kind, unipolar: mod.unipolar,
      defaults: mod.defaults, params: mod.params, needsAudio: mod.needsAudio,
      _params: Object.assign({}, mod.defaults, (layer && layer._lfoOverrides && layer._lfoOverrides[mod.id]) || {}),
    };
    // Copy methods from the module spec to the instance. We deliberately
    // rebind `this` so they can read instance fields (_params, _phase, etc).
    for (const k of ['sample', 'onAttach', 'onDetach']) {
      if (mod[k]) inst[k] = mod[k].bind(inst);
    }
    if (mod.onAttach) mod.onAttach.call(inst, layer);
    return inst;
  }

  function getModule(id) { return modules.find(m => m.id === id) || null; }

  // ---- per-layer instance cache ----------------------------------------

  // layer._lfoInsts = { id -> instance } — built lazily on first apply().
  function ensureInsts(layer) {
    if (!layer._lfoInsts) layer._lfoInsts = {};
    const wanted = (layer.modulators || []).map(m => m.id);
    // Drop stale instances (modulator removed).
    for (const k of Object.keys(layer._lfoInsts)) {
      if (wanted.indexOf(k) === -1) {
        const inst = layer._lfoInsts[k];
        if (inst.onDetach) try { inst.onDetach.call(inst, layer); } catch (_) {}
        delete layer._lfoInsts[k];
      }
    }
    // Build new ones.
    for (const m of layer.modulators || []) {
      if (!layer._lfoInsts[m.id]) {
        const mod = getModule(m.id);
        if (mod) layer._lfoInsts[m.id] = instantiate(mod, layer);
      }
      // Sync param overrides onto the existing instance.
      const inst = layer._lfoInsts[m.id];
      if (inst && m.params) {
        inst._params = Object.assign({}, inst.defaults, m.params);
      }
    }
    return layer._lfoInsts;
  }

  // ---- merger: read each instance.sample() and combine into r ----------

  function apply(dt, layer, r) {
    if (!layer || !layer.modulators || !layer.modulators.length) return r;
    const insts = ensureInsts(layer);
    if (!r) r = {};
    const ctx = { now: () => performance.now(), audio: window.SWR && window.SWR.Audio };
    // Shallow-clone r so we don't poison the engine's cached object.
    const out = {};
    for (const k in r) out[k] = r[k];
    for (const spec of layer.modulators) {
      const inst = insts[spec.id];
      if (!inst) continue;
      const v = (() => { try { return inst.sample(dt, ctx); } catch (_) { return 0; } })();
      const gain = typeof spec.gain === 'number' ? spec.gain : 1;
      const t = spec.target || 'opacity';
      switch (t) {
        case 'opacity':
          out.opacity = Math.max(0, Math.min(1, (out.opacity || 0) + v * gain * 0.5));
          break;
        case 'scale':
          // Multiplicative on top of baseScale.
          out.scale = (out.scale || 1) * (1 + v * gain * 0.3);
          break;
        case 'x':
          out.x = (out.x || 0) + v * gain * 80;
          break;
        case 'y':
          out.y = (out.y || 0) + v * gain * 80;
          break;
        case 'hue':
          out.hue = ((out.hue || 0) + v * gain * 60) % 360;
          if (out.hue > 180) out.hue -= 360;
          if (out.hue < -180) out.hue += 360;
          break;
        case 'rot':
          out.rot = (out.rot || 0) + v * gain * 15;
          break;
        case 'brightness':
          out.brightness = Math.max(0.1, (out.brightness || 1) * (1 + v * gain * 0.3));
          break;
        case 'contrast':
          out.contrast = Math.max(0.1, (out.contrast || 1) * (1 + v * gain * 0.3));
          break;
        default:
          // Unknown target — no-op (defensive against typos).
          break;
      }
    }
    out._v = (r && r._v) || '0';
    return out;
  }

  // ---- attach / detach / setParam (panel-facing helpers) ---------------

  function attach(layer, id, opts) {
    if (!layer || !id) return false;
    const mod = getModule(id);
    if (!mod) return false;
    if (!layer.modulators) layer.modulators = [];
    // Drop any existing instance for the same id so params take effect.
    for (let i = 0; i < layer.modulators.length; i++) {
      if (layer.modulators[i].id === id) {
        layer.modulators.splice(i, 1);
        break;
      }
    }
    layer.modulators.push(Object.assign({ id, target: mod.unipolar ? 'opacity' : 'scale', gain: 0 }, opts || {}));
    return true;
  }

  function detach(layer, id) {
    if (!layer || !layer.modulators) return false;
    const before = layer.modulators.length;
    layer.modulators = layer.modulators.filter(m => m.id !== id);
    return layer.modulators.length < before;
  }

  function setParam(id, layer, k, v) {
    if (!layer || !layer.modulators) return false;
    for (const m of layer.modulators) {
      if (m.id !== id) continue;
      if (!m.params) m.params = {};
      m.params[k] = v;
      return true;
    }
    return false;
  }

  // ---- public exposure -------------------------------------------------

  window.SWR_LFOS = {
    list: modules.map(m => ({ id: m.id, version: m.version, kind: m.kind,
                              unipolar: m.unipolar, defaults: m.defaults,
                              params: m.params, needsAudio: m.needsAudio })),
    get: getModule,
    attach,
    detach,
    apply,
    setParam,
    _instantiate: instantiate,
  };
})();
