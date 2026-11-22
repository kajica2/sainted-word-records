// client/remo-wiring-store.client.js
// Remo Panel 2.0 — wires from envelope sources into params.

(function () {
  'use strict';
  if (window.SWR_REMO_WIRES) return;

  var wires = [];
  var byId = Object.create(null);
  var seq = 0;

  function params() { return window.SWR_REMO_PARAMS; }
  function shapes() { return window.SWR_REMO_SHAPES; }
  function envBus() { return window.SWR_REMO_ENV; }

  function expandTarget(target) {
    var P = params();
    if (!P) return [];
    if (target.indexOf('*') < 0) return P._params[target] ? [target] : [];
    var parts = target.split('.');
    var out = [];
    var list = P.list();
    for (var i = 0; i < list.length; i++) {
      var path = list[i].path;
      var segs = path.split('.');
      if (segs.length !== parts.length) continue;
      var ok = true;
      for (var j = 0; j < parts.length; j++) {
        if (parts[j] !== '*' && parts[j] !== segs[j]) { ok = false; break; }
      }
      if (ok) out.push(path);
    }
    return out;
  }

  function wireId(sourceId, target) {
    return 'w_' + sourceId + '_' + String(target).replace(/\W+/g, '_');
  }

  function addWire(spec) {
    if (!spec || !spec.sourceId || !spec.target) return null;
    var id = spec.id || wireId(spec.sourceId, spec.target);
    var existing = byId[id] || findWire(spec.sourceId, spec.target);
    if (existing) {
      updateWire(existing.id, spec);
      return existing;
    }
    seq += 1;
    var wire = {
      id: id,
      sourceId: spec.sourceId,
      target: spec.target,
      expandedTargets: expandTarget(spec.target),
      depth: isFinite(+spec.depth) ? Math.max(-1, Math.min(1, +spec.depth)) : 0.5,
      polarity: spec.polarity === 'bipolar' ? 'bipolar' : 'uni',
      curve: spec.curve || 'linear',
      mode: spec.mode === 'set' || spec.mode === 'mult' ? spec.mode : 'add',
    };
    wires.push(wire);
    byId[wire.id] = wire;
    return wire;
  }

  function removeWire(id) {
    if (!byId[id]) return false;
    delete byId[id];
    wires = wires.filter(function (w) { return w.id !== id; });
    return true;
  }

  function updateWire(id, patch) {
    var wire = byId[id];
    if (!wire || !patch) return false;
    if (patch.depth != null) wire.depth = Math.max(-1, Math.min(1, +patch.depth));
    if (patch.polarity) wire.polarity = patch.polarity === 'bipolar' ? 'bipolar' : 'uni';
    if (patch.curve) wire.curve = patch.curve;
    if (patch.mode) wire.mode = patch.mode === 'set' || patch.mode === 'mult' ? patch.mode : 'add';
    if (patch.target) {
      wire.target = patch.target;
      wire.expandedTargets = expandTarget(patch.target);
    }
    if (patch.sourceId) wire.sourceId = patch.sourceId;
    return true;
  }

  function listWires() { return wires.slice(); }

  function referencesSource(id) {
    for (var i = 0; i < wires.length; i++) if (wires[i].sourceId === id) return true;
    return false;
  }

  function invalidateWildcardCache() {
    for (var i = 0; i < wires.length; i++) {
      wires[i].expandedTargets = expandTarget(wires[i].target);
    }
  }

  function applyWires() {
    var P = params();
    var E = envBus();
    var S = shapes();
    if (!P || !E) return;
    // set overrides add/mult: apply set wires last, track which targets were set
    var setTargets = Object.create(null);
    for (var i = 0; i < wires.length; i++) {
      var wire = wires[i];
      if (wire.mode !== 'set') continue;
      var src = E.getSource(wire.sourceId);
      if (!src) continue;
      var signed = wire.polarity === 'bipolar' ? src.value * 2 - 1 : src.value;
      var curved = S ? S.curve(wire.curve, Math.abs(signed)) * (signed < 0 ? -1 : 1) : signed;
      var delta = curved * wire.depth;
      for (var t = 0; t < wire.expandedTargets.length; t++) {
        var path = wire.expandedTargets[t];
        var p = P._params[path];
        if (!p) continue;
        var span = p.max - p.min;
        P.setMod(path, delta * span);
        setTargets[path] = 1;
      }
    }
    for (var j = 0; j < wires.length; j++) {
      var w = wires[j];
      if (w.mode === 'set') continue;
      var source = E.getSource(w.sourceId);
      if (!source) continue;
      var sgn = w.polarity === 'bipolar' ? source.value * 2 - 1 : source.value;
      var crv = S ? S.curve(w.curve, Math.abs(sgn)) * (sgn < 0 ? -1 : 1) : sgn;
      var dlt = crv * w.depth;
      for (var k = 0; k < w.expandedTargets.length; k++) {
        var tp = w.expandedTargets[k];
        if (setTargets[tp]) continue;
        var pd = P._params[tp];
        if (!pd) continue;
        var sp = pd.max - pd.min;
        if (w.mode === 'mult') P.setMul(tp, 1 + dlt);
        else P.addMod(tp, dlt * sp);
      }
    }
  }

  function clear() {
    wires = [];
    byId = Object.create(null);
  }

  function snapshot() {
    return wires.map(function (w) {
      return {
        sourceId: w.sourceId,
        target: w.target,
        depth: w.depth,
        polarity: w.polarity,
        curve: w.curve,
        mode: w.mode,
      };
    });
  }

  function restore(list) {
    clear();
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) addWire(list[i]);
  }

  function findWire(sourceId, target) {
    for (var i = 0; i < wires.length; i++) {
      if (wires[i].sourceId === sourceId && wires[i].target === target) return wires[i];
    }
    return null;
  }

  window.SWR_REMO_WIRES = {
    addWire: addWire,
    removeWire: removeWire,
    updateWire: updateWire,
    listWires: listWires,
    applyWires: applyWires,
    invalidateWildcardCache: invalidateWildcardCache,
    referencesSource: referencesSource,
    findWire: findWire,
    clear: clear,
    snapshot: snapshot,
    restore: restore,
  };
})();
