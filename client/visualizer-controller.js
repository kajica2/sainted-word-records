/*
 * visualizer-controller.js — Tiny pubsub bus + WebSocket client.
 *
 * Purpose: a single transport layer through which OSC / Bluetooth / mobile
 * / agentic surfaces can drive any Sainted Word Records visualizer (the
 * 12 versions/*.html pages) without per-driver rewiring.
 *
 * API surface (window.VC):
 *   connect(url?)        — open a WebSocket. Default ws://<host>:8787.
 *   on(event, fn)        — subscribe. Returns an unsubscribe fn.
 *   off(event, fn)       — unsubscribe.
 *   emit(event, payload) — broadcast locally and over the wire.
 *   setParam(id, value)  — convenience: write a sens/gate/decay/etc value
 *                          into both the matching <input id="..."> and
 *                          A.params[id]. Idempotent.
 *
 * Inbound protocol (any peer can send these as JSON over WS):
 *   {type:"set", param:"sens", value:1.7}
 *   {type:"action", name:"play"}       — fires a synthetic click on
 *                                          document.querySelector(`.js-${name}`)
 *                                          if present (UI affordances),
 *                                          and emits event "action:<name>"
 *   {type:"load", version:"aurora"}    — navigate to /versions/<version>.html
 *   {type:"raw", data:{...}}            — opaque pass-through; surfaces as
 *                                          a "raw" event on the bus.
 *
 * Outbound protocol (the visualizer publishes these so drivers can react):
 *   {type:"param", param:"sens", value:1.7, source:"dom"|"ws"|"local"}
 *   {type:"action", name:"play", state:false}
 *   {type:"hello", version:"aurora", params:["sens","gate","decay",...]}
 *
 * Robustness:
 *   - reconnects every 1.5s on drop.
 *   - inbound messages are sandboxed via (try/catch); a malformed payload
 *     never crashes the bus.
 *   - if window.A.params doesn't exist yet (DOM-based visualizers without
 *     the A namespace), setParam falls back to the DOM input alone.
 *
 * No deps. Designed to be loaded by any HTML page with one <script> tag.
 *
 * Author: Kai Djuric · 2026-08-25
 */

(function () {
  'use strict';

  // -------------------------------------------------------------------
  // The bus — a tiny event emitter, no deps.
  // -------------------------------------------------------------------
  const listeners = new Map(); // event -> Set<fn>
  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => off(event, fn);
  }
  function off(event, fn) {
    const set = listeners.get(event);
    if (set) set.delete(fn);
  }
  function emit(event, payload) {
    const set = listeners.get(event);
    if (set) for (const fn of set) {
      try { fn(payload); } catch (e) { console.error('[VC] listener error', e); }
    }
  }

  // -------------------------------------------------------------------
  // WebSocket transport. Single connection per page (modules that want
  // many connections should not use this — they're not the audience).
  // -------------------------------------------------------------------
  let ws = null;
  let wsUrl = '';
  let reconnectAttempt = 0;
  const RECONNECT_BASE_MS = 1500;
  const RECONNECT_MAX_MS = 30000;

  function connect(url) {
    wsUrl = url || (
      (location.protocol === 'https:' ? 'wss://' : 'ws://') +
      location.hostname + ':8787'
    );
    open();
  }
  function open() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.warn('[VC] ws open failed', e);
      scheduleReconnect();
      return;
    }
    ws.addEventListener('open', () => {
      reconnectAttempt = 0;
      emit('ws:open', { url: wsUrl });
      // Hello message so the server can route us.
      sendRaw({
        type: 'hello',
        version: (document.body && document.body.dataset && document.body.dataset.version) || (location.pathname.match(/\/versions\/([a-z]+)\.html/) || [])[1] || 'unknown',
        path: location.pathname,
        params: detectParams(),
        paramsInitial: snapshotParams(),
      });
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      try { handleInbound(msg); } catch (e) { console.error('[VC] inbound error', e); }
    });
    ws.addEventListener('close', () => {
      emit('ws:close', { url: wsUrl });
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      try { ws.close(); } catch (_) { /* */ }
    });
  }
  function scheduleReconnect() {
    reconnectAttempt++;
    // Quick retries in the first 5 seconds to ride out races in headless
    // and dev-server boot. Switch to exponential backoff after that.
    let delay;
    if (reconnectAttempt <= 5) {
      delay = 800 * reconnectAttempt; // 800, 1600, 2400, 3200, 4000
    } else {
      delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
    }
    setTimeout(open, delay);
  }
  function sendRaw(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch (_) { /* */ }
    }
  }

  // -------------------------------------------------------------------
  // Inbound: route to local bus + visualizer DOM/A.params.
  // -------------------------------------------------------------------
  function handleInbound(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'set': {
        if (typeof msg.param === 'string' && msg.value !== undefined) {
          setParam(msg.param, msg.value, 'ws');
        }
        emit('inbound:set', msg);
        return;
      }
      case 'action': {
        // Try a JS-controlled UI affordance; then fan out.
        if (msg.name) {
          const el = document.querySelector(`.js-${msg.name}`);
          if (el && typeof el.click === 'function') el.click();
        }
        emit('action:' + (msg.name || ''), msg);
        return;
      }
      case 'load': {
        if (msg.version) {
          const safe = String(msg.version).replace(/[^a-z0-9-]/gi, '');
          if (safe) location.href = `/versions/${safe}.html`;
        }
        return;
      }
      case 'raw': {
        emit('raw', msg.data || {});
        return;
      }
    }
    emit('inbound:unknown', msg);
  }

  // -------------------------------------------------------------------
  // Outbound: when DOM sliders change OR A.params is mutated, publish.
  // -------------------------------------------------------------------
  function detectParams() {
    const found = new Set();
    document.querySelectorAll('input[type="range"][id]').forEach((el) => {
      found.add(el.id);
    });
    if (window.A && A.params && typeof A.params === 'object') {
      Object.keys(A.params).forEach((k) => found.add(k));
    }
    return Array.from(found);
  }
  function snapshotParams() {
    const out = {};
    for (const id of detectParams()) out[id] = readParam(id);
    return out;
  }
  function readParam(id) {
    const dom = document.getElementById(id);
    if (dom && 'value' in dom) {
      const v = dom.value;
      const f = parseFloat(v);
      return Number.isFinite(f) ? f : v;
    }
    if (window.A && A.params && Object.prototype.hasOwnProperty.call(A.params, id)) {
      return A.params[id];
    }
    return null;
  }

  // -------------------------------------------------------------------
  // setParam — the one canonical write path. Writes DOM + A.params and
  // publishes the change so listeners and remote peers stay in sync.
  // -------------------------------------------------------------------
  function setParam(id, value, source) {
    const parsed = (typeof value === 'string') ? parseFloat(value) : value;
    const numeric = Number.isFinite(parsed) ? parsed : value;
    let domOk = false;
    const dom = document.getElementById(id);
    if (dom && 'value' in dom) {
      dom.value = numeric;
      dom.dispatchEvent(new Event('input', { bubbles: true }));
      domOk = true;
    }
    if (window.A && A.params && typeof A.params === 'object') {
      A.params[id] = numeric;
    }
    sendRaw({ type: 'param', param: id, value: numeric, source: source || 'local' });
    emit('param:set', { id, value: numeric, source: source || 'local', domOk });
  }

  // -------------------------------------------------------------------
  // DOM observer — when a slider the visualizer controls moves, mirror
  // it onto the bus so remote peers (other tabs, drivers) see it.
  // -------------------------------------------------------------------
  function wireDomObserver() {
    for (const id of detectParams()) {
      const el = document.getElementById(id);
      if (!el || el.__vc_hooked) continue;
      el.addEventListener('input', () => {
        // Skip if the value came from us; only forward genuine user input.
        // Cheap heuristic: only emit source='dom' when we're handling the
        // event ourselves in handleInbound and pass 'ws' explicitly.
      });
      el.addEventListener('change', () => {
        setParam(id, el.value, 'dom');
      });
      el.__vc_hooked = true;
    }
  }

  // One-time wiring once DOM is ready. Also re-scan when new inputs
  // appear (e.g.Engine boot may inject them dynamically).
  function boot() {
    wireDomObserver();
    // engine boot often happens AFTER this script loads. Poll twice.
    setTimeout(wireDomObserver, 250);
    setTimeout(() => {
      wireDomObserver();
      sendRaw({
        type: 'hello',
        version: (document.body && document.body.dataset && document.body.dataset.version) ||
                 (location.pathname.match(/\/versions\/([a-z]+)\.html/) || [])[1] || 'unknown',
        path: location.pathname,
        params: detectParams(),
        paramsInitial: snapshotParams(),
      });
    }, 1500);

    // Reduced-motion auto-stop on visibility change.
    document.addEventListener('visibilitychange', () => {
      emit('visibility', { hidden: document.hidden });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // -------------------------------------------------------------------
  // Public API.
  // -------------------------------------------------------------------
  const VC = {
    on, off, emit,
    connect,
    setParam,
    readParam,
    snapshotParams,
    detectParams,
  };
  Object.freeze(VC);
  window.VC = VC;

  // Auto-connect on load — the default contract is "any visualizer that
  // includes visualizer-controller.js is reachable over the dev WS
  // bridge". Pages can opt out by setting
  // <body data-vc-no-autoconnect="1"> before this script runs.
  // Skip in non-browsers (vitest, SSR, etc.).
  //
  // IMPORTANT: this script may load in <head> when <body> is not yet
  // defined. We defer the entire guard check until DOMContentLoaded.
  if (typeof window !== 'undefined' && typeof document !== 'undefined' &&
      typeof WebSocket !== 'undefined') {
    const tryAutoConnect = () => {
      if (document.body && document.body.dataset.vcNoAutoconnect === '1') return;
      // Production deploys (Vercel) don't run a local freq-bridge at
      // :8787 — skip the connect attempt so console stays clean.
      //
      // import.meta.env.PROD is the Vite-injected production flag, but
      // this script is loaded as a plain <script> (not type="module"),
      // so `import.meta` itself is undefined at parse time in any
      // browser that supports it — and a SyntaxError in browsers that
      // don't. The original script is loaded as a plain defer script,
      // not as ESM; we can't safely reference `import.meta` here. Use
      // location.hostname heuristics instead: localhost / 127.0.0.1 /
      // *.local / vercel preview hostnames are dev; production
      // hostnames are skipped.
      const h = location.hostname;
      const isDevHost = h === 'localhost' || h === '127.0.0.1' || /\.local$/.test(h);
      const isVercelPreview = /\.vercel\.app$/.test(h) && h.includes('-git-'); // git-branch previews
      if (!isDevHost && !isVercelPreview) return; // production: skip
      try { VC.connect(); } catch (_) { /* swallow */ }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryAutoConnect, { once: true });
    } else {
      tryAutoConnect();
    }
    window.addEventListener('load', tryAutoConnect, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) tryAutoConnect();
    });
  }
})();
