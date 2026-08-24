// engine-lfo-panel.client.js — draggable LFO/modulator panel sibling to the
// existing AUTO-SWAP + TIMING panels (engine.html + versions/*.html).
//
// Lists the 9 modules registered in SWR_LFOS. Each row shows the module
// id + kind + version + a compact set of controls:
//
//   - target: which engine parameter the modulator drives (opacity | scale |
//             x | y | hue | rot | brightness | contrast)
//   - gain:   0–1, attenuates the modulator output before merge
//   - module-specific param sliders (from SWR_LFOS.list[i].params)
//   - attach/detach: mutates layer.modulators[] via SWR_LFOS.attach/detach
//
// "Attach" operates on whichever layer the user has selected in the
// engine's existing Layers panel (L.sel / window.SWR.Layers.sel). If no
// layer is selected the buttons are disabled.
//
// Desktop: independent draggable panel positioned at a default spot.
// Mobile (max-width:720px): folds into the ls-panel-host tabs alongside
// AUTO-SWAP and (existing) TIMING. See A4 in
// .hermes-plans/plan-fade-timing-and-lfos.md.

(function () {
  'use strict';
  if (window.SWR_LFO_PANEL) return;

  const PANEL_ID = 'ls-panel-lfo';
  const POS_KEY = 'swr.lfo-panel.pos';

  // Default target per module kind — modulators with kind='mod' (audio-aware)
  // default to 'opacity' (unipolar feels right for envelopes); pure LFOs
  // default to 'scale' (multiplicative reads more naturally than additive).
  const DEFAULT_TARGET = { lfo: 'scale', mod: 'opacity' };

  // ---- UI build --------------------------------------------------------

  function lfos() { return window.SWR_LFOS; }

  function getSelectedLayer() {
    const L = window.SWR && window.SWR.Layers;
    return L && L.sel ? L.sel : (L && L.list && L.list[0]) || null;
  }

  function moduleHasAttached(modId) {
    const layer = getSelectedLayer();
    if (!layer || !layer.modulators) return false;
    return layer.modulators.some(m => m.id === modId);
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const LFO = lfos();
    if (!LFO) return;  // engine-lfos.client.js not loaded — bail

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'ls-panel ls-panel-lfo';
    panel.style.cssText = [
      'position:fixed', 'bottom:14px', 'right:14px', 'z-index:9999',
      'background:rgba(15,15,20,0.92)', 'color:#eee',
      'border:1px solid #444', 'border-radius:10px',
      'padding:10px 12px', 'font:12px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'box-shadow:0 4px 18px rgba(0,0,0,0.4)', 'user-select:none',
      'min-width:300px', 'max-width:380px'
    ].join(';');

    // Build the module rows up front. Each module gets its own block with
    // attach/detach + a target select + a gain slider + module-specific
    // param sliders. Sliders are rebuilt on attach (so initial values are
    // pulled from the module's defaults); afterwards the user edits them
    // directly via setParam().
    const moduleRows = LFO.list.map(function (mod) {
      const targetOptions = ['opacity','scale','x','y','hue','rot','brightness','contrast']
        .map(function (t) { return '<option value="' + t + '">' + t + '</option>'; })
        .join('');
      const paramSliders = Object.keys(mod.params || {}).map(function (k) {
        const p = mod.params[k];
        return '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:#aaa;">' +
               '<span style="width:48px;">' + k + '</span>' +
               '<input type="range" data-mod="' + mod.id + '" data-param="' + k + '"' +
                      ' min="' + p.min + '" max="' + p.max + '" step="' + p.step + '"' +
                      ' value="' + mod.defaults[k] + '" style="flex:1;">' +
               '<span data-mod-display="' + mod.id + '-' + k + '" style="width:36px;text-align:right;font-family:monospace;">' +
               mod.defaults[k] + '</span>' +
               '</label>';
      }).join('');
      return '<div class="lfo-row" data-mod-id="' + mod.id + '" ' +
             'style="border:1px solid #333;border-radius:6px;padding:8px;margin-bottom:8px;">' +
             '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
               '<strong style="font-size:11px;color:#ff3d92;">' + mod.id + '</strong>' +
               '<span style="font-size:9px;color:#666;">v' + mod.version + ' ' + mod.kind + '</span>' +
               '<span data-attach-status="' + mod.id + '" ' +
                     'style="margin-left:auto;font-size:9px;color:#7f7;">not attached</span>' +
             '</div>' +
             '<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;font-size:10px;">' +
               '<span style="width:48px;color:#aaa;">target</span>' +
               '<select data-mod-target="' + mod.id + '" style="flex:1;font-size:10px;">' +
                 targetOptions +
               '</select>' +
               '<span style="width:36px;color:#aaa;">gain</span>' +
               '<input type="range" data-mod-gain="' + mod.id + '" min="0" max="1" step="0.05" value="0.5" style="flex:1;">' +
             '</div>' +
             (paramSliders ? '<div style="display:flex;flex-direction:column;gap:2px;">' + paramSliders + '</div>' : '') +
             '<div style="display:flex;gap:6px;margin-top:6px;">' +
               '<button data-mod-attach="' + mod.id + '" ' +
                       'style="flex:1;padding:4px;background:#1a4d2e;color:#7f7;border:1px solid #2a6d3e;border-radius:4px;cursor:pointer;font-size:10px;">' +
                 'attach to layer' +
               '</button>' +
               '<button data-mod-detach="' + mod.id + '" ' +
                       'style="flex:1;padding:4px;background:#4d1a1a;color:#ff7f7f;border:1px solid #6d2a2a;border-radius:4px;cursor:pointer;font-size:10px;">' +
                 'detach' +
               '</button>' +
             '</div>' +
           '</div>';
    }).join('');

    panel.innerHTML =
      '<div class="ls-drag-handle" style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">' +
        '<strong style="font-size:12px;letter-spacing:0.04em;">∿ LFOs</strong>' +
        '<span style="font-size:10px;color:#888;">' + LFO.list.length + ' modules</span>' +
        '<span id="lfo-status" style="margin-left:auto;font-size:10px;color:#888;">layer: —</span>' +
      '</div>' +
      '<div style="max-height:60vh;overflow-y:auto;padding-right:4px;">' +
        moduleRows +
      '</div>' +
      '<div id="lfo-stats" style="margin-top:6px;font-size:10px;color:#888;">' +
        'select a layer in the Layers panel, then attach modulators.' +
      '</div>';

    document.body.appendChild(panel);

    // ---- drag (same pattern as the timing + scheduler panels) -------
    try {
      const saved = localStorage.getItem(POS_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
          panel.style.left = p.x + 'px';
          panel.style.top  = p.y + 'px';
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
    function statusFor(modId) {
      return panel.querySelector('[data-attach-status="' + modId + '"]');
    }
    function targetSelectFor(modId) {
      return panel.querySelector('[data-mod-target="' + modId + '"]');
    }
    function gainInputFor(modId) {
      return panel.querySelector('[data-mod-gain="' + modId + '"]');
    }
    function paramInputsFor(modId) {
      return Array.from(panel.querySelectorAll('input[type=range][data-mod="' + modId + '"][data-param]'));
    }

    function refreshStatus() {
      const layer = getSelectedLayer();
      const stats = panel.querySelector('#lfo-stats');
      const header = panel.querySelector('#lfo-status');
      if (header) {
        header.textContent = 'layer: ' + (layer && layer.id ? layer.id : '—');
        header.style.color = layer ? '#7f7' : '#888';
      }
      LFO.list.forEach(function (mod) {
        const s = statusFor(mod.id);
        if (!s) return;
        const attached = moduleHasAttached(mod.id);
        s.textContent = attached ? 'attached' : 'not attached';
        s.style.color = attached ? '#7f7' : '#888';
        // Pre-fill the target + gain selects from the layer's actual modulator entry.
        if (layer && layer.modulators) {
          const m = layer.modulators.find(function (x) { return x.id === mod.id; });
          if (m) {
            const ts = targetSelectFor(mod.id);
            if (ts && ts.value !== m.target) ts.value = m.target;
            const gi = gainInputFor(mod.id);
            if (gi && gi.value !== String(m.gain)) gi.value = m.gain;
            if (m.params) {
              Object.keys(m.params).forEach(function (k) {
                const el = panel.querySelector('input[type=range][data-mod="' + mod.id + '"][data-param="' + k + '"]');
                if (el && el.value !== String(m.params[k])) el.value = m.params[k];
              });
            }
          }
        }
      });
      if (stats) {
        const enabled = (layer && layer.modulators) ? layer.modulators.length : 0;
        stats.textContent = enabled
          ? enabled + ' modulator' + (enabled === 1 ? '' : 's') + ' attached to layer ' + layer.id
          : 'select a layer in the Layers panel, then attach modulators.';
      }
    }

    LFO.list.forEach(function (mod) {
      const attachBtn = panel.querySelector('[data-mod-attach="' + mod.id + '"]');
      const detachBtn = panel.querySelector('[data-mod-detach="' + mod.id + '"]');
      const ts = targetSelectFor(mod.id);
      const gi = gainInputFor(mod.id);

      // Default the target select to the module's preferred target.
      if (ts && !ts.value) ts.value = DEFAULT_TARGET[mod.kind] || 'opacity';

      if (attachBtn) attachBtn.addEventListener('click', function () {
        const layer = getSelectedLayer();
        if (!layer) return;
        const params = {};
        paramInputsFor(mod.id).forEach(function (el) {
          params[el.getAttribute('data-param')] = parseFloat(el.value);
        });
        LFO.attach(layer, mod.id, {
          target: ts ? ts.value : DEFAULT_TARGET[mod.kind] || 'opacity',
          gain:   gi  ? parseFloat(gi.value) : 0.5,
          params: params,
        });
        refreshStatus();
      });

      if (detachBtn) detachBtn.addEventListener('click', function () {
        const layer = getSelectedLayer();
        if (!layer) return;
        LFO.detach(layer, mod.id);
        refreshStatus();
      });

      // Per-param slider: live update the displayed value + push to the
      // active modulator entry on the currently selected layer (if any).
      paramInputsFor(mod.id).forEach(function (el) {
        const display = panel.querySelector('[data-mod-display="' + mod.id + '-' + el.getAttribute('data-param') + '"]');
        const sync = function () {
          if (display) display.textContent = el.value;
          const layer = getSelectedLayer();
          if (!layer || !layer.modulators) return;
          const m = layer.modulators.find(function (x) { return x.id === mod.id; });
          if (!m) return;
          if (!m.params) m.params = {};
          m.params[el.getAttribute('data-param')] = parseFloat(el.value);
        };
        el.addEventListener('input', sync);
        sync();
      });
    });

    // Re-render the status block whenever the selected layer changes.
    // Layers panel usually dispatches a 'change' event or mutates L.sel
    // directly — we poll L.sel every 500ms since there's no canonical
    // event for layer-selection changes.
    setInterval(refreshStatus, 500);
    refreshStatus();
  }

  // ---- mobile fold-in (A4) -----------------------------------------
  // Stubs the same way as the TIMING panel — desktop panels work, mobile
  // tabs queued for the final mobile-tidy pass. The DOM IDs are already
  // locked (ls-panel-lfo) so the future tab host can pick them up.
  function installMobileFold() {
    if (window.matchMedia && !window.matchMedia('(max-width: 720px)').matches) return;
  }

  // ---- boot ---------------------------------------------------------

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
  window.SWR_LFO_PANEL = { build: buildPanel, panelId: PANEL_ID };
})();
