// freq-bridge.js — cross-app parameter pump.
//
// Sits in sainted-word-records/tools/freq-bridge.js (NOT in freq-lab's
// repo: stays reversible; drop one file to undo). Once loaded by any
// freq-lab page (curl'd direct, or via a tiny <script src> pin), it
// watches freq-lab's DOM controls and forwards parameter changes onto
// the same ws://<host>:8787 transport the SWR visualizers already
// speak. The path back is identical: any parameter set over WS lands
// on freq-lab's DOM controls.
//
// Why DOM, not window.state:
//   freq-lab's `state` is a const inside the main inline script —
//   module-private, never assigned to window. The author had to
//   write a feature module to get the state reference passed in.
//   Without that cooperation, the only stable observation surface
//   is the DOM (sliders, mode tabs, waveform dropdown, play button).
//   The DOM IS freq-lab's external API: state mutations flow back
//   through the same `input` / `change` events the controls
//   dispatch naturally.
//
// What it forwards (read from DOM):
//   #carrier         Hz                (input[type=range])
//   #beat            Hz                (input[type=range])
//   #volume          0..1              (input[type=range])
//   [name=mode]      binaural/monaural/isochronic (radio/select)
//   [name=waveform]  sine/triangle/square/sawtooth (radio/select)
//   #amDepth, ambience, fade, timer — best-effort, ignored if not present
//
// What it receives (writes to DOM):
//   set: <param> <value>     → writes the corresponding input.value +
//                              dispatches `input` event so freq-lab's
//                              own input handler runs.
//   action: <verb>           → clicks #playBtn / #resetBtn / #recBtn etc.
//
// Pattern follows freq-lab's other feature modules: self-contained
// IIFE registering on window.FreqLabFeatures['swr-vc-bridge']. Works
// whether freq-lab's init() loop calls our setup() or not — this
// bridge self-initializes on DOMContentLoaded.
//
// Defaults to ws://<location.hostname>:8787. Override via
// <body data-vc-no-autoconnect="1"> to skip or via
// FreqLabFeatures['swr-vc-bridge'].connect(url).
//
// Author: Kai Djuric · 2026-08-25

(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  // DOM mapping — input.value is the canonical truth.
  const DOM = [
    { id: 'carrier',      param: 'carrier',   type: 'range' },
    { id: 'beat',         param: 'beat',      type: 'range' },
    { id: 'volume',       param: 'volume',    type: 'range' },
    { id: 'amDepth',      param: 'amDepth',   type: 'range' },
    { id: 'waveform',     param: 'waveform',  type: 'select' },
    { id: 'fadeOut',      param: 'fade-out',  type: 'select' },
    { id: 'sessionTimer', param: 'timer',     type: 'select' },
  ];

  // Action verbs the bridge can fire.
  const ACTIONS = {
    play:   'playBtn',
    pause:  'playBtn',     // toggles
    stop:   'playBtn',
    reset:  'resetBtn',
    record: 'recBtn',
    export: 'exportBtn',
  };

  // ---- WS plumbing -------------------------------------------------
  let ws = null;
  let wsUrl = '';
  let lastSnapshot = '';

  function defaultUrl() {
    const proto = (location.protocol === 'https:') ? 'wss://' : 'ws://';
    return proto + location.hostname + ':8787';
  }
  function connect(url) {
    if (url) wsUrl = url;
    if (!wsUrl) wsUrl = defaultUrl();
    if (typeof WebSocket === 'undefined') return;

    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.warn('[freq-bridge] ws open failed', e);
      setTimeout(connect, 1500);
      return;
    }
    ws.addEventListener('open', () => {
      sendRaw({ type: 'hello', role: 'freq-bridge', source: 'freq-lab' });
      sendRaw({ type: 'stateSnapshot', values: snapshot() });
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      handleInbound(msg);
    });
    ws.addEventListener('close', () => setTimeout(connect, 1500));
    ws.addEventListener('error', () => { try { ws.close(); } catch (_) {} });
  }
  function sendRaw(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch (_) {}
    }
  }

  // ---- DOM reader --------------------------------------------------
  function readRange(el) {
    if (!el) return null;
    const v = parseFloat(el.value);
    if (!Number.isFinite(v)) return null;
    return v;
  }
  function readSelect(el) {
    if (!el) return null;
    const v = el.value;
    return v || null;
  }

  function snapshot() {
    const out = {};
    for (const m of DOM) {
      let v;
      if (m.type === 'select') {
        v = readSelect(document.getElementById(m.id));
      } else {
        v = readRange(document.getElementById(m.id));
      }
      if (v !== null && v !== undefined) {
        out[m.param] = v;
      }
    }
    return out;
  }

  // ---- Forward: DOM → WS ------------------------------------------
  function pollOnce() {
    const s = snapshot();
    const sig = JSON.stringify(s);
    if (sig === lastSnapshot) return;
    lastSnapshot = sig;
    for (const k of Object.keys(s)) {
      sendRaw({ type: 'set', param: k, value: s[k] });
    }
  }
  let pollTimer = null;
  function startPolling(intervalMs) {
    if (pollTimer) return;
    pollTimer = setInterval(pollOnce, intervalMs || 250);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ---- Reverse: WS → DOM ------------------------------------------
  function findInputForParam(param) {
    for (const m of DOM) if (m.param === param) return document.getElementById(m.id);
    return null;
  }
  function applyValue(el, value) {
    if (!el) return false;
    const num = Number(value);
    if (Number.isFinite(num)) {
      el.value = String(num);
    } else {
      el.value = String(value);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function applyAction(verb) {
    const id = ACTIONS[verb];
    if (!id) return;
    const el = document.getElementById(id);
    if (el && typeof el.click === 'function') el.click();
  }

  function handleInbound(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'set': {
        const el = findInputForParam(msg.param);
        if (el) applyValue(el, msg.value);
        return;
      }
      case 'action': {
        if (msg.name) applyAction(msg.name);
        return;
      }
      case 'load':
      case 'raw':
      case 'hello':
      case 'param':
        return;
    }
  }

  // ---- Feature-module registration --------------------------------
  const feature = {
    name: 'swr-vc-bridge',
    description: 'Freq Lab <-> Sainted Word Records visualizer parameter bridge over ws://<host>:8787 (DOM observer).',
    setup(_ctx) {
      // Accept freq-lab's setup() if it ever calls us, but don't need
      // a ctx — DOM is our source of truth.
      boot();
      return this;
    },
    connect,
    disconnect() {
      stopPolling();
      if (ws) { try { ws.close(); } catch (_) {} ws = null; }
    },
    pollNow: pollOnce,
    snapshot,
  };

  function boot() {
    if (document.body && document.body.dataset.vcNoAutoconnect === '1') return;
    connect();
    startPolling(250);
  }

  window.FreqLabFeatures = window.FreqLabFeatures || {};
  window.FreqLabFeatures['swr-vc-bridge'] = feature;

  // Self-init: freq-lab's main script registers AND calls setup() on
  // its whitelisted feature names — ours is not in that list, so we
  // either wait for setup() OR boot ourselves. We boot ourselves on
  // DOMContentLoaded so we work whether freq-lab's setup() ever
  // calls us or not.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Defer half a second so freq-lab's main DOM is fully wired.
      setTimeout(boot, 250);
    }, { once: true });
  } else {
    setTimeout(boot, 250);
  }
})();
