// lib/mask-illusions.client.js — mask illusion controller.
// One global, window.MaskIllusions. The recorded picture is the WebGL
// mask in fx-postprocess.js (mutAlgo 6..11). This module applies the
// MASK personas and reports the empty state. It does not build an SVG scene.

(function () {
  if (window.MaskIllusions) return;

  var KEYS = ['maskThreshold', 'maskGooey', 'maskSlit', 'maskChromaBand', 'maskHalftone', 'maskKaleido'];
  var LABELS = ['Develop', 'Bloom', 'Ribbed', 'Fringe', 'Print', 'Wedge'];
  var HINT = 'A moving mask, not a new image. Bass, mid, and treble reveal different parts.';
  var EMPTY = 'Add a still or clip to use mask illusions.';

  function noPicture() {
    var L = window.Layers;
    var lib = window.Library;
    var layers = L && Array.isArray(L.list) ? L.list : null;
    var items = lib && Array.isArray(lib.items) ? lib.items : null;
    if (!layers && !items) return false;
    return (layers ? layers.length : 0) + (items ? items.length : 0) === 0;
  }

  function apply(name) {
    if (noPicture() && typeof window.setStatus === 'function') {
      window.setStatus(EMPTY, 'warn');
    }
    if (window.Personas && typeof window.Personas.apply === 'function') {
      window.Personas.apply(name);
      return;
    }
    var table = window.Personas && window.Personas.PERSONAS;
    var persona = table && table[name];
    if (persona && window.FX && typeof window.FX.setPersona === 'function') {
      window.FX.setPersona(persona);
    }
  }

  function list() {
    var cyc = window.SWR_LOOK_FILTER_CYCLER;
    if (cyc && typeof cyc.list === 'function') {
      return cyc.list().filter(function (f) { return f.id >= 10 && f.id <= 15; });
    }
    return KEYS.map(function (key, i) {
      return { id: 10 + i, key: key, label: LABELS[i] };
    });
  }

  window.MaskIllusions = {
    apply: apply,
    list: list,
    keys: KEYS.slice(),
    labels: LABELS.slice(),
    hint: HINT,
    empty: EMPTY,
  };
})();
