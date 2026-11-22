// client/remo-param-store.client.js
// Remo Panel 2.0 — parameter registry. Base values stay here; wires write
// into `mod` each frame. get() returns clamp((base + mod) * mul).

(function () {
  'use strict';
  if (window.SWR_REMO_PARAMS) return;

  var params = Object.create(null);

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function defineParam(path, spec) {
    if (!path || typeof path !== 'string') return null;
    var min = spec && isFinite(+spec.min) ? +spec.min : 0;
    var max = spec && isFinite(+spec.max) ? +spec.max : 1;
    if (max < min) { var t = min; min = max; max = t; }
    var def = spec && isFinite(+spec.def) ? clamp(+spec.def, min, max) : min;
    var entry = {
      path: path,
      min: min,
      max: max,
      def: def,
      base: def,
      mod: 0,
      mul: 1,
      unit: (spec && spec.unit) || '',
      label: (spec && spec.label) || path,
    };
    params[path] = entry;
    return entry;
  }

  function ensure(path) {
    return params[path] || null;
  }

  function get(path) {
    var p = ensure(path);
    if (!p) return 0;
    return clamp((p.base + p.mod) * p.mul, p.min, p.max);
  }

  function getBase(path) {
    var p = ensure(path);
    return p ? p.base : 0;
  }

  function setBase(path, v) {
    var p = ensure(path);
    if (!p) return false;
    p.base = clamp(+v, p.min, p.max);
    return true;
  }

  function addMod(path, amount) {
    var p = ensure(path);
    if (!p) return false;
    p.mod += +amount || 0;
    return true;
  }

  function setMod(path, amount) {
    var p = ensure(path);
    if (!p) return false;
    p.mod = +amount || 0;
    return true;
  }

  function setMul(path, amount) {
    var p = ensure(path);
    if (!p) return false;
    var m = +amount;
    p.mul = isFinite(m) ? m : 1;
    return true;
  }

  function commitModulation() {
    for (var path in params) {
      params[path].mod = 0;
      params[path].mul = 1;
    }
  }

  // TDD aliases
  function resetModulation() { return commitModulation(); }
  function addModulation(path, delta) { return addMod(path, delta); }

  function list() {
    return Object.keys(params).sort().map(function (path) {
      var p = params[path];
      return {
        path: path,
        min: p.min,
        max: p.max,
        def: p.def,
        base: p.base,
        value: get(path),
        unit: p.unit,
        label: p.label,
      };
    });
  }

  function snapshot() {
    var out = Object.create(null);
    for (var path in params) out[path] = params[path].base;
    return out;
  }

  function restore(map) {
    if (!map || typeof map !== 'object') return;
    for (var path in map) {
      if (!params[path]) continue;
      setBase(path, map[path]);
    }
  }

  function seedDefaults() {
    defineParam('layers.0.opacity', { min: 0, max: 1, def: 1, label: 'Layer 0 opacity' });
    defineParam('layers.0.scale', { min: 0.1, max: 4, def: 1, label: 'Layer 0 scale' });
    defineParam('layers.0.rotation', { min: -180, max: 180, def: 0, unit: 'deg', label: 'Layer 0 rotation' });
    defineParam('layers.1.opacity', { min: 0, max: 1, def: 1, label: 'Layer 1 opacity' });
    defineParam('layers.1.scale', { min: 0.1, max: 4, def: 1, label: 'Layer 1 scale' });
    defineParam('layers.1.rotation', { min: -180, max: 180, def: 0, unit: 'deg', label: 'Layer 1 rotation' });
    defineParam('layers.2.opacity', { min: 0, max: 1, def: 1, label: 'Layer 2 opacity' });
    defineParam('layers.2.scale', { min: 0.1, max: 4, def: 1, label: 'Layer 2 scale' });
    defineParam('layers.2.rotation', { min: -180, max: 180, def: 0, unit: 'deg', label: 'Layer 2 rotation' });
    defineParam('fx.hue', { min: -180, max: 180, def: 0, unit: 'deg', label: 'FX hue' });
    defineParam('fx.blur', { min: 0, max: 1, def: 0, label: 'FX blur' });
    defineParam('look.brightness', { min: 0, max: 2, def: 1, label: 'Look brightness' });
    defineParam('stage.zoom', { min: 0.25, max: 4, def: 1, label: 'Stage zoom' });
    defineParam('tempo', { min: 40, max: 240, def: 120, unit: 'bpm', label: 'Tempo' });
  }

  seedDefaults();

  window.SWR_REMO_PARAMS = {
    defineParam: defineParam,
    get: get,
    getBase: getBase,
    setBase: setBase,
    addMod: addMod,
    addModulation: addModulation,
    setMod: setMod,
    setMul: setMul,
    commitModulation: commitModulation,
    resetModulation: resetModulation,
    list: list,
    snapshot: snapshot,
    restore: restore,
    _params: params,
  };
})();
