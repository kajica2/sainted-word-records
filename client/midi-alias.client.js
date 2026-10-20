// client/midi-alias.client.js / MIDI auto-mapping for the engine.
//
// On navigator.requestMIDIAccess() success, every detected input gets
// default control-to-layer bindings applied automatically:
//
//   - fader CC 1..8          → layer[N-1].opacity     (vol = opacity)
//   - knob   CC 16..23        → layer[N-1].baseScale  (size)
//   - mod wheel (CC 1, channel-wide)
//                            → selectedLayer.rotOffset
//   - expression (CC 11)      → selectedLayer.opacity
//   - sustain pedal (CC 64)   → freeze the auto-swap auto-swap scheduler
//                                 (when SWR_AUTOMIX is present)
//
// The mapping is re-applied on every new layer added. The user can
// override per-control with MAPPING overrides in localStorage.
//
// The Web MIDI API is available in Chromium-family browsers; on Safari
// and Firefox it may be missing or behind a flag. The module no-ops
// when MIDI is unavailable rather than throwing.

(function () {
  'use strict';
  if (window.SWR_MIDI) return;

  const MAPPING_KEY = 'swr.midi.aliases.v1';
  const ENABLED_KEY = 'swr.midi.enabled.v1';
  const DEVICE_KEY  = 'swr.midi.lastDevice.v1';

  // ---- state ----
  const state = {
    available: !!(navigator && navigator.requestMIDIAccess),
    permission: 'unknown',         // 'granted' | 'denied' | 'prompt' | 'unknown'
    access: null,                  // MIDIAccess object
    inputs: [],                    // MIDIInput[]
    outputs: [],
    byId: Object.create(null),     // id -> MIDIInput
    enabled: readBool(ENABLED_KEY, true),
    lastDeviceId: localStorage.getItem(DEVICE_KEY) || null,
    aliases: loadAliases(),
    listeners: new Set(),           // UI subscribers
    mappingLog: [],                 // recent CC -> target events
  };

  function readBool(k, fallback) {
    try { const v = localStorage.getItem(k); return v == null ? fallback : v === '1'; }
    catch (_) { return fallback; }
  }
  function writeBool(k, v) {
    try { localStorage.setItem(k, v ? '1' : '0'); } catch (_) {}
  }
  function loadAliases() {
    try {
      const raw = JSON.parse(localStorage.getItem(MAPPING_KEY) || '{}');
      return (raw && typeof raw === 'object') ? raw : {};
    } catch (_) { return {}; }
  }
  function saveAliases() {
    try { localStorage.setItem(MAPPING_KEY, JSON.stringify(state.aliases)); } catch (_) {}
  }

  function emit() {
    for (const fn of state.listeners) {
      try { fn(state); } catch (_) {}
    }
    try {
      window.dispatchEvent(new CustomEvent('swr-midi', { detail: snapshot() }));
    } catch (_) {}
  }
  function snapshot() {
    return {
      available: state.available,
      permission: state.permission,
      enabled: state.enabled,
      lastDeviceId: state.lastDeviceId,
      inputCount: state.inputs.length,
      inputNames: state.inputs.map(function (i) { return i.name || '(unnamed)'; }),
    };
  }

  // ---- the auto-mapping logic ----
  // CC messages: data[0] = status byte (0xB0 for CC, 0x90 for note-on),
  //             data[1] = controller number (0..127), data[2] = value (0..127).
  function applyCC(input, e) {
    if (!state.enabled) return;
    if (e.data.length < 3) return;
    const status = e.data[0] & 0xF0;
    if (status !== 0xB0) return;          // not a CC message
    const cc = e.data[1];
    const val = e.data[2] / 127;          // 0..1 normalized
    const t = translateCC(cc, val);
    if (!t) return;
    t.apply();
    state.mappingLog.unshift({ input: input.name || input.id, cc: cc, val: val, target: t.label, t: Date.now() });
    if (state.mappingLog.length > 50) state.mappingLog.length = 50;
    emit();
  }

  // Look up an alias first; fall back to the default mapping.
  function translateCC(cc, val) {
    const k = String(cc);
    const alias = state.aliases[k];
    if (alias && typeof alias === 'string' && alias[0] === ':') {
      return applyBoundLayer(alias.slice(1).split(':')[0], val, alias.split(':')[1]);
    }
    // Default map: faders 1..8 → layer 0..7 opacity, knobs 16..23 → baseScale
    if (cc >= 1 && cc <= 8) {
      const layerIdx = cc - 1;
      return applyBoundLayer(String(layerIdx), 'opacity', val);
    }
    if (cc >= 16 && cc <= 23) {
      const layerIdx = cc - 16;
      return applyBoundLayer(String(layerIdx), 'baseScale', val);
    }
    if (cc === 1)  return { label: 'modwheel:selected', apply: function () { setSelected('rotOffset',  (val - 0.5) * 90); } };
    if (cc === 11) return { label: 'expr:selected',     apply: function () { setSelected('opacity',    val); } };
    if (cc === 64) return { label: 'sustain:freeze',     apply: function () { freezeAutoSwap(val > 0.5); } };
    return null;
  }

  function applyBoundLayer(idxStr, field, val) {
    return {
      label: 'layer' + idxStr + ':' + field,
      apply: function () {
        const L = window.Layers;
        if (!L || !L.list || !L.list.length) return;
        const idx = parseInt(idxStr, 10);
        if (idx < 0 || idx >= L.list.length) return;
        const layer = L.list[idx];
        if (field === 'opacity')   layer.opacity   = clamp(val, 0, 1);
        if (field === 'baseScale') layer.baseScale = clamp(val * 2, 0.1, 3);
        if (typeof L.render === 'function') L.render();
        if (window.setStatus) {
          try { window.setStatus('midi: layer ' + (idx + 1) + ' ' + field + ' = ' + val.toFixed(2), 'ok'); }
          catch (_) {}
        }
      },
    };
  }

  function setSelected(field, val) {
    const L = window.Layers;
    if (!L || !L.selected) return;
    if (field === 'rotOffset') {
      L.selected.rotOffset = val;
    } else if (field === 'opacity') {
      L.selected.opacity = clamp(val, 0, 1);
    }
    if (typeof L.render === 'function') L.render();
  }

  function freezeAutoSwap(frozen) {
    // Hook: ask the engine's auto-swap layer (if any) to pause.
    if (window.SWR_AUTOMIX && typeof window.SWR_AUTOMIX.setFrozen === 'function') {
      try { window.SWR_AUTOMIX.setFrozen(!!frozen); } catch (_) {}
    }
    if (window.setStatus) {
      try { window.setStatus('midi: auto-swap ' + (frozen ? 'frozen' : 'live'), 'ok'); } catch (_) {}
    }
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---- connect / reattach ----
  function attachAll() {
    if (!state.access) return;
    const inputs = state.access.inputs.values();
    state.inputs = [];
    state.byId = Object.create(null);
    for (const input of inputs) {
      if (input && input.id) {
        state.inputs.push(input);
        state.byId[input.id] = input;
        input.onmidimessage = function (e) { applyCC(input, e); };
      }
    }
    state.outputs = Array.from(state.access.outputs.values());
    state.lastDeviceId = state.inputs[0] ? state.inputs[0].id : null;
    if (state.lastDeviceId) {
      try { localStorage.setItem(DEVICE_KEY, state.lastDeviceId); } catch (_) {}
    }
    emit();
  }

  // ---- public ----
  function requestAccess(opts) {
    opts = opts || {};
    if (!navigator || !navigator.requestMIDIAccess) {
      state.available = false; state.permission = 'denied'; emit();
      return Promise.resolve(false);
    }
    return navigator.requestMIDIAccess({ sysex: !!opts.sysex })
      .then(function (access) {
        state.access = access;
        state.permission = access.state || 'granted';
        state.available = true;
        access.onstatechange = function () {
          state.permission = access.state;
          if (access.state === 'connected') attachAll();
          emit();
        };
        attachAll();
        return true;
      })
      .catch(function () {
        state.permission = 'denied';
        state.available = false;
        emit();
        return false;
      });
  }

  function setEnabled(v) {
    state.enabled = !!v;
    writeBool(ENABLED_KEY, state.enabled);
    emit();
  }
  function setAlias(cc, target) {
    state.aliases[String(cc)] = target;
    saveAliases();
    emit();
  }
  function clearAlias(cc) {
    delete state.aliases[String(cc)];
    saveAliases();
    emit();
  }
  function getState() {
    return {
      available: state.available,
      permission: state.permission,
      enabled: state.enabled,
      lastDeviceId: state.lastDeviceId,
      inputs: state.inputs.map(function (i) { return { id: i.id, name: i.name }; }),
      aliases: Object.assign({}, state.aliases),
      mappingLog: state.mappingLog.slice(0, 20),
    };
  }
  function subscribe(fn) {
    state.listeners.add(fn);
    return function () { state.listeners.delete(fn); };
  }

  // Auto-start unless the user has disabled it
  if (state.enabled && state.available) {
    // Defer so pages can register listeners first
    setTimeout(function () { requestAccess(); }, 0);
  }

  window.SWR_MIDI = {
    requestAccess,
    setEnabled,
    setAlias,
    clearAlias,
    getState,
    subscribe,
    snapshot,
  };
})();
