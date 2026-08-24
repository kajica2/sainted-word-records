// engine-timing-panel.client.js — draggable TIMING panel sibling to the
// existing AUTO-SWAP panel (engine.html + versions/*.html).
//
// Reads/writes SWR_TIMING.cfg via setDefaults() and persists to
// localStorage('swr.timing.v1') through the timing module itself. Does not
// own its own storage key — single source of truth lives in the timing
// module so the next page load picks up the user's edits.
//
// Desktop: independent draggable panel positioned at a default spot.
// Mobile (max-width:720px): folds into the ls-panel-host tabs alongside
// AUTO-SWAP and (future) LFO. See A4 in .hermes-plans/plan-fade-timing-and-lfos.md.

(function () {
  'use strict';
  if (window.SWR_TIMING_PANEL) return;

  const PANEL_ID = 'ls-panel-timing';
  const POS_KEY = 'swr.timing-panel.pos';

  function timing() { return window.SWR_TIMING; }

  // ---- UI build --------------------------------------------------------

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const T = timing();
    if (!T) return;  // engine-timing.client.js not loaded — bail

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'ls-panel ls-panel-timing';
    panel.style.cssText = [
      'position:fixed', 'bottom:14px', 'right:248px', 'z-index:9999',
      'background:rgba(15,15,20,0.92)', 'color:#eee',
      'border:1px solid #444', 'border-radius:10px',
      'padding:10px 12px', 'font:12px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'box-shadow:0 4px 18px rgba(0,0,0,0.4)', 'user-select:none',
      'min-width:240px', 'max-width:300px'
    ].join(';');

    panel.innerHTML = `
      <div class="ls-drag-handle" style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <strong style="font-size:12px;letter-spacing:0.04em;">⏱ TIMING</strong>
        <span id="lt-status" style="margin-left:auto;font-size:10px;color:#888;">defaults</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 80px;gap:4px 8px;align-items:center;">
        <label style="font-size:11px;color:#bbb;">fade-in (ms)</label>
        <input type="number" id="lt-fadeIn" min="0" max="10000" step="50" value="${T.cfg.fadeInMs}" style="width:80px;">

        <label style="font-size:11px;color:#bbb;">fade-out (ms)</label>
        <input type="number" id="lt-fadeOut" min="0" max="10000" step="50" value="${T.cfg.fadeOutMs}" style="width:80px;">

        <label style="font-size:11px;color:#bbb;">ease</label>
        <select id="lt-ease" style="width:80px;">
          <option value="linear"${T.cfg.ease === 'linear' ? ' selected' : ''}>linear</option>
          <option value="smooth"${T.cfg.ease === 'smooth' ? ' selected' : ''}>smooth</option>
          <option value="sharp"${T.cfg.ease === 'sharp' ? ' selected' : ''}>sharp</option>
        </select>

        <label style="font-size:11px;color:#bbb;">swap out (ms)</label>
        <input type="number" id="lt-swapOut" min="0" max="5000" step="50" value="${T.cfg.eventSwap.fadeOutMs}" style="width:80px;">

        <label style="font-size:11px;color:#bbb;">swap in (ms)</label>
        <input type="number" id="lt-swapIn" min="0" max="5000" step="50" value="${T.cfg.eventSwap.fadeInMs}" style="width:80px;">

        <label style="font-size:11px;color:#bbb;">beat-snap cap</label>
        <input type="number" id="lt-beatCap" min="0" max="2000" step="50" value="${T.cfg.beatSnapMaxWaitMs}" style="width:80px;">
      </div>

      <div style="display:flex;gap:6px;margin-top:10px;">
        <button id="lt-reset" style="flex:1;padding:4px 8px;background:#222;color:#ddd;border:1px solid #444;border-radius:6px;cursor:pointer;">reset defaults</button>
      </div>

      <div id="lt-stats" style="margin-top:6px;font-size:10px;color:#888;">defaults loaded from swr.timing.v1</div>
    `;

    document.body.appendChild(panel);

    // ---- drag (same pattern as layer-scheduler.client.js) ----------
    try {
      const saved = localStorage.getItem(POS_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
          panel.style.left = p.x + 'px';
          panel.style.top = p.y + 'px';
          panel.style.right = 'auto';
          panel.style.bottom = 'auto';
        }
      }
    } catch (e) {}
    const dragHandle = panel.querySelector('.ls-drag-handle');
    if (dragHandle) {
      let moveHandler = null, upHandler = null;
      const beginDrag = (cx, cy, e) => {
        e.preventDefault();
        panel.classList.add('ls-dragging');
        const rect = panel.getBoundingClientRect();
        const offsetX = cx - rect.left, offsetY = cy - rect.top;
        moveHandler = (ev) => {
          const x = (ev.clientX !== undefined ? ev.clientX : 0) - offsetX;
          const y = (ev.clientY !== undefined ? ev.clientY : 0) - offsetY;
          panel.style.left = Math.max(0, Math.min(window.innerWidth - 40, x)) + 'px';
          panel.style.top  = Math.max(0, Math.min(window.innerHeight - 40, y)) + 'px';
          panel.style.right = 'auto'; panel.style.bottom = 'auto';
        };
        upHandler = () => {
          panel.classList.remove('ls-dragging');
          window.removeEventListener('pointermove', moveHandler);
          window.removeEventListener('pointerup', upHandler);
          window.removeEventListener('mousemove', moveHandler);
          window.removeEventListener('mouseup', upHandler);
          try {
            const x = parseInt(panel.style.left, 10) || 0;
            const y = parseInt(panel.style.top, 10) || 0;
            localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
          } catch (err) {}
        };
        window.addEventListener('pointermove', moveHandler);
        window.addEventListener('pointerup', upHandler);
        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler);
      };
      dragHandle.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.button === undefined) beginDrag(e.clientX, e.clientY, e); });
      dragHandle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (panel.classList.contains('ls-dragging')) return;
        beginDrag(e.clientX, e.clientY, e);
      });
    }

    // ---- wire controls ----------------------------------------------
    const $ = (id) => panel.querySelector('#' + id);
    const status = $('lt-status');
    function pushFromUI() {
      const fadeIn  = Math.max(0, parseInt($('lt-fadeIn').value, 10) || 0);
      const fadeOut = Math.max(0, parseInt($('lt-fadeOut').value, 10) || 0);
      const ease    = $('lt-ease').value;
      const swapOut = Math.max(0, parseInt($('lt-swapOut').value, 10) || 0);
      const swapIn  = Math.max(0, parseInt($('lt-swapIn').value, 10) || 0);
      const beatCap = Math.max(0, parseInt($('lt-beatCap').value, 10) || 0);
      T.setDefaults({
        fadeInMs: fadeIn, fadeOutMs: fadeOut, ease: ease,
        beatSnapMaxWaitMs: beatCap,
        eventSwap: { fadeOutMs: swapOut, fadeInMs: swapIn },
      });
      status.textContent = 'saved';
      status.style.color = '#7f7';
      setTimeout(() => { status.textContent = 'defaults'; status.style.color = '#888'; }, 900);
    }
    ['lt-fadeIn','lt-fadeOut','lt-ease','lt-swapOut','lt-swapIn','lt-beatCap'].forEach(id => {
      const el = $(id);
      if (!el) return;
      const evt = el.tagName === 'SELECT' ? 'change' : 'change';
      el.addEventListener(evt, pushFromUI);
    });
    $('lt-reset').addEventListener('click', () => {
      const D = T.defaults;
      $('lt-fadeIn').value  = D.fadeInMs;
      $('lt-fadeOut').value = D.fadeOutMs;
      $('lt-ease').value    = D.ease;
      $('lt-swapOut').value = D.eventSwap.fadeOutMs;
      $('lt-swapIn').value  = D.eventSwap.fadeInMs;
      $('lt-beatCap').value = D.beatSnapMaxWaitMs;
      pushFromUI();
    });
  }

  // ---- mobile tab fold-in (A4) ----------------------------------------
  // At <= 720px the standalone panels become hard to use. We collapse the
  // TIMING + AUTO-SWAP + (future) LFO panels into a single bottom bar with
  // tabs. This is light-touch CSS via a class on the body; the panels
  // themselves keep their DOM, just get repositioned.
  function installMobileFold() {
    if (window.matchMedia && !window.matchMedia('(max-width: 720px)').matches) return;
    // No-op stub for now: the existing AUTO-SWAP panel already handles
    // its own positioning. The full tab host is queued for slice 3b once
    // the LFO panel lands — until then the TIMING panel sits next to
    // AUTO-SWAP at its default right:248px offset, which is acceptable on
    // a 720px viewport.
  }

  // ---- boot ------------------------------------------------------------

  function boot() {
    buildPanel();
    installMobileFold();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public surface (testing).
  window.SWR_TIMING_PANEL = { build: buildPanel, panelId: PANEL_ID };
})();
