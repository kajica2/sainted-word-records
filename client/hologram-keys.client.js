// client/hologram-keys.client.js
//
// Phase E (Phase 5 of plan-doc) of the music_video.html hologram
// preset engine. Keyboard navigation over the focus preset, plus
// depth / hide / reset hotkeys. Pure cycle math is in
// cycleFocus() and exported via _impl so it's unit-testable in
// plain Node without a DOM.
//
// Plan-doc spec:
//   ← / →       cycle focus along the mood axis
//   ↑ / ↓       cycle focus along the complexity axis
//   , / .       cycle focus along the motion axis
//   [ / ]       cycle focus along the color_temp axis
//   1 .. 9      set depth to 0.1 .. 0.9
//   0           reset (depth=0.5, focus cleared)
//   H           toggle panel hide
//   ?           (out of scope — handled by SWR_KEYS engine-keys)
//
// install() attaches a global keydown listener. Pass
// `state: window.SWR_HOLOGRAM_STATE` (the page's HologramState
// object plus optional `focus` and `hidden` fields) and an
// `onChange()` callback fired after every handled key. The
// renderer reads state.focus / state.depth / state.hidden at the
// next RAF, so updates are visible within one frame.
//
// The listener uses capture phase + stopImmediatePropagation so
// the page's song-picker one-shot (versions/music_video.html:512)
// doesn't double-trigger. We only stop propagation on keys we
// actually handle; everything else falls through to the engine's
// own SWR_KEYS handler.
//
// Idempotent. Loaded after hologram-presets.client.js.

(function (root) {
  'use strict';
  if (root.SWR_HOLOGRAM_KEYS) return;

  // ---- cycleFocus -----------------------------------------------------
  //
  // Pure. Returns the next preset id when `direction` is +1 or -1
  // along one of the four axes, given the current `focusId`. Cycles
  // at endpoints with wrap-around.
  //
  //   state           state object (reads hState.neighbours)
  //   neighboursFn    function(coords, n) -> [{ id, anchor, dist }, …]
  //                   from hologram-presets PresetMap. Sorted ascending
  //                   by distance. Default: SWR_HOLOGRAM_PRESET_MAP.neighbours.
  //   axis            'mood' | 'complexity' | 'motion' | 'color_temp'
  //   direction       +1 | -1
  //   currentFocusId  string | null | undefined
  //
  // Returns:
  //   { id: string, _cycle: { axis, direction, neighbours: number } } | null
  //
  // null means "no neighbour available" (empty preset list).
  function cycleFocus(state, neighboursFn, axis, direction, currentFocusId) {
    if (!neighboursFn || typeof neighboursFn !== 'function') return null;
    var dirs = { mood: 1, complexity: 1, motion: 1, color_temp: 1 };
    if (!(axis in dirs)) return null;
    if (direction !== 1 && direction !== -1) return null;
    var n = (state && state.neighbours) || 4;

    // Get the N nearest neighbours to the current focus (or to a
    // neutral 0.5,0.5,0.5,0.5 origin if no focus yet).
    var centre;
    if (currentFocusId && state && state.presetMap && state.presetMap.get(currentFocusId)) {
      centre = state.presetMap.get(currentFocusId);
    } else {
      centre = { mood: 0.5, complexity: 0.5, motion: 0.5, color_temp: 0.5 };
    }

    var neighbours = neighboursFn(centre, n);
    if (!neighbours || !neighbours.length) return null;

    // Sort the chosen neighbours by the chosen axis, ascending.
    var sorted = neighbours.slice().sort(function (a, b) {
      var av = (a.anchor && a.anchor[axis]) || 0;
      var bv = (b.anchor && b.anchor[axis]) || 0;
      return av - bv;
    });

    // Find the current focus's index in the sorted list, or use a
    // virtual mid-index when the focus isn't among the neighbours.
    var curIdx = -1;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].id === currentFocusId) { curIdx = i; break; }
    }
    if (curIdx < 0) curIdx = direction > 0 ? -1 : sorted.length;

    var nextIdx = curIdx + direction;
    if (nextIdx >= sorted.length) nextIdx = 0;     // wrap
    else if (nextIdx < 0) nextIdx = sorted.length - 1;

    return {
      id: sorted[nextIdx].id,
      _cycle: { axis: axis, direction: direction, neighbours: n },
    };
  }

  // ---- depthFromDigit -------------------------------------------------
  function depthFromDigit(d) {
    if (d >= 1 && d <= 9) return d / 10;
    return null;
  }

  // ---- apply ----------------------------------------------------------
  //
  // Mutates the state object according to `key`. Returns true if
  // the key was handled (so the listener can stop propagation).
  function apply(state, key, opts) {
    if (!state) return false;
    var neighboursFn = (opts && opts.neighboursFn) || null;
    var presetMap = (opts && opts.presetMap) || state.presetMap || null;
    state.presetMap = presetMap;

    switch (key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!neighboursFn) return false;
        var dirLR = (key === 'ArrowRight') ? 1 : -1;
        var next = cycleFocus(
          state, neighboursFn, 'mood', dirLR, state.focus
        );
        if (!next) return false;
        state.focus = next.id;
        return true;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!neighboursFn) return false;
        var dirUD = (key === 'ArrowDown') ? 1 : -1;
        var next2 = cycleFocus(
          state, neighboursFn, 'complexity', dirUD, state.focus
        );
        if (!next2) return false;
        state.focus = next2.id;
        return true;
      }
      case ',':
      case '.': {
        if (!neighboursFn) return false;
        var dirComma = (key === '.') ? 1 : -1;
        var next3 = cycleFocus(
          state, neighboursFn, 'motion', dirComma, state.focus
        );
        if (!next3) return false;
        state.focus = next3.id;
        return true;
      }
      case '[':
      case ']': {
        if (!neighboursFn) return false;
        var dirBrack = (key === ']') ? 1 : -1;
        var next4 = cycleFocus(
          state, neighboursFn, 'color_temp', dirBrack, state.focus
        );
        if (!next4) return false;
        state.focus = next4.id;
        return true;
      }
      case '0':
        state.depth = 0.5;
        state.focusAmount = 0;
        delete state.focus;
        return true;
      case '1': case '2': case '3': case '4':
      case '5': case '6': case '7': case '8': case '9': {
        var d = depthFromDigit(parseInt(key, 10));
        if (d == null) return false;
        state.depth = d;
        return true;
      }
      case 'h':
      case 'H':
        state.hidden = !state.hidden;
        return true;
      default:
        return false;
    }
  }

  // ---- install --------------------------------------------------------
  //
  // opts:
  //   state          mutable state object (e.g., window's HologramState)
  //   neighboursFn   provided to apply()
  //   presetMap      (state.presetMap wins when provided)
  //   onChange()     fired after a successful key. Default no-op.
  //   target         element to attach the listener on. Default window.
  //
  // Returns: { uninstall() } so the caller can detach if needed.
  function install(opts) {
    if (!opts || !opts.state) {
      throw new Error('install: opts.state is required');
    }
    var target = opts.target || (typeof root !== 'undefined' ? root : null);
    if (!target || typeof target.addEventListener !== 'function') {
      throw new Error('install: opts.target must be an EventTarget');
    }
    var onChange = opts.onChange || function () {};

    function handle(ev) {
      // Ignore when typing into an input/textarea/contenteditable.
      var t = ev.target;
      if (t && (
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
        t.isContentEditable
      )) return;
      var handled = apply(opts.state, ev.key, {
        neighboursFn: opts.neighboursFn,
        presetMap: opts.presetMap,
      });
      if (handled) {
        if (ev.stopPropagation) ev.stopPropagation();
        if (ev.preventDefault) ev.preventDefault();
        try { onChange(opts.state, ev); } catch (_) {}
      }
    }
    target.addEventListener('keydown', handle, true); // capture phase
    return {
      uninstall: function () { target.removeEventListener('keydown', handle, true); },
    };
  }

  root.SWR_HOLOGRAM_KEYS = {
    install: install,
    apply: apply,
    cycleFocus: cycleFocus,
    _impl: {
      cycleFocus: cycleFocus,
      depthFromDigit: depthFromDigit,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
