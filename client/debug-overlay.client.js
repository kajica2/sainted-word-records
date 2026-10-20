// client/debug-overlay.client.js — Debug overlay for the engine.
//
// Subscribe to swr-keys-press events + audio features + layer state;
// render to a fixed-position HUD bottom-right that lists the last 12
// key/UI actions plus live audio feature values. Toggle with
// `?debug=1` in the URL or `localStorage.setItem('swr.debug', '1')`.
//
// Why? When something happens on a key combo (T+1..9, layer select,
// home) and the visual reaction looks wrong, this overlay makes the
// state machine visible without opening DevTools.
//
//   key       last key the engine dispatched
//   action    the resolved action label
//   idx       which slot/layer/etc. was acted on
//   audio     live rms/bass/mid/treble/beat/centroid from window.Audio.feat
//
// Marked noauto so the engine doesn't auto-mount it; the URL flag is
// enough.

(() => {
  'use strict';
  if (window.SWR_DEBUG_OVERLAY) return;

  // Enable via ?debug=1 or localStorage swr.debug = '1'
  function enabled() {
    if (typeof location !== 'undefined') {
      try {
        const qs = new URLSearchParams(location.search).get('debug');
        if (qs === '1' || qs === 'on' || qs === 'true') return true;
      } catch (_) {}
    }
    try {
      if (localStorage.getItem('swr.debug') === '1') return true;
    } catch (_) {}
    return false;
  }

  if (!enabled()) return;

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // ---- DOM scaffold ------------------------------------------------------
  const root = el('div', 'swr-debug-overlay');
  root.style.cssText = [
    'position:fixed', 'right:10px', 'bottom:10px', 'z-index:999999',
    'background:rgba(0,0,0,.78)', 'color:#cfd', 'font:11px/1.4 var(--font-mono, monospace)',
    'padding:8px 10px', 'border:1px solid #3a6', 'border-radius:4px',
    'min-width:240px', 'max-width:340px', 'pointer-events:none',
    'white-space:pre', 'box-shadow:0 4px 18px rgba(0,0,0,.4)',
  ].join(';');
  const head = el('div'); head.style.cssText = 'color:#9c6;font-weight:bold;margin-bottom:4px;';
  head.textContent = 'SWRS debug';
  const logEl = el('div'); logEl.style.cssText = 'border-top:1px dashed #364; padding-top:4px;';
  const audioEl = el('div'); audioEl.style.cssText = 'color:#69c; margin-top:6px;';
  const layersEl = el('div'); layersEl.style.cssText = 'color:#fc6; margin-top:4px;';
  const lookEl = el('div'); lookEl.style.cssText = 'color:#f9a; margin-top:4px;';

  root.appendChild(head);
  root.appendChild(logEl);
  root.appendChild(audioEl);
  root.appendChild(layersEl);
  root.appendChild(lookEl);
  // Append at the very end so it sits above other content
  (document.body || document.documentElement).appendChild(root);

  // ---- state -------------------------------------------------------------
  const ring = [];
  const RING_MAX = 12;

  function pushLog(line) {
    ring.unshift(line);
    if (ring.length > RING_MAX) ring.length = RING_MAX;
    logEl.textContent = ring.join('\n');
  }

  // ---- listeners ---------------------------------------------------------

  document.addEventListener('swr-keys-press', (ev) => {
    const d = (ev && ev.detail) || {};
    const key = d.key || '?';
    const code = d.code || '';
    const mods = d.mods || {};
    const act = d.action || '';
    const modStr = (mods.shift ? '⇧' : '') + (mods.alt ? '⌥' : '')
                + (mods.meta ? '⌘' : '') + (mods.ctrl ? '⌃' : '');
    pushLog((modStr + (key.length === 1 ? key : `<${code || key}>`)).padEnd(7) + ' ' + act);
  });

  document.addEventListener('swr-look-filter', (ev) => {
    const d = (ev && ev.detail) || {};
    const label = d.label || 'none';
    const slot = d.slot != null ? d.slot : 0;
    const k = (typeof d.intensity === 'number') ? d.intensity.toFixed(2) : '';
    pushLog('look    slot=' + slot + ' "' + label + '"' + (k ? ' k=' + k : ''));
    lookEl.textContent = 'look: ' + slot + ' · ' + label + (k ? ' (k=' + k + ')' : '');
  });

  // ---- live polling ------------------------------------------------------
  let lastTick = 0;
  let lastLayers = '';

  function tick(now) {
    if (now - lastTick >= 200) {
      lastTick = now;
      const A = (window.Audio && window.Audio.feat) || null;
      if (A) {
        const rms = (A.rms || 0).toFixed(2);
        const bass = (A.bass || 0).toFixed(2);
        const mid = (A.mid || 0).toFixed(2);
        const tre = (A.treble || 0).toFixed(2);
        const beat = A.beatPulse ? '★' : '·';
        const on = (A.playing ? '▶' : '❚❚');
        audioEl.textContent = `audio ${on} rms=${rms} bass=${bass} mid=${mid} tre=${tre} ${beat}`;
      }
      const L = (window.Layers && window.Layers.list) || [];
      if (L.length) {
        const lines = L.map((l, i) => {
          const sel = (window.Layers && window.Layers.selected === l) ? '★' : '·';
          const x = (l.pos && l.pos.x) || 0;
          const y = (l.pos && l.pos.y) || 0;
          return `#${i+1} ${sel} x=${x.toFixed(0)} y=${y.toFixed(0)} s=${(l.baseScale||1).toFixed(2)} a=${l.algo || '—'}`;
        });
        const next = `${L.length} layers\n` + lines.join('\n');
        if (next !== lastLayers) {
          layersEl.textContent = next;
          lastLayers = next;
        }
      } else {
        layersEl.textContent = 'no layers';
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  pushLog('debug overlay ready');
  let rafId = requestAnimationFrame(tick);

  window.SWR_DEBUG_OVERLAY = {
    destroy() {
      cancelAnimationFrame(rafId);
      if (root.parentNode) root.parentNode.removeChild(root);
      delete window.SWR_DEBUG_OVERLAY;
    },
  };
})();
