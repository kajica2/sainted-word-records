// engine-settings.client.js — floating ⚙ gear icon + dropdown menu that
// provides a single entry point to every existing floating panel
// (AUTO-SWAP, TIMING, LFOs) plus the new AUTO-MAP engine presets.
//
// Renders:
//   - A fixed 36×36 circular ⚙ button in the top-right corner.
//   - On click, a dropdown menu appears below the gear with:
//       [✓] AUTO-SWAP       (toggle visibility)
//       [✓] TIMING          (toggle visibility)
//       [✓] LFOs            (toggle visibility)
//       ─────
//       AUTO-MAP ▸          (submenu: every engine page with a recipe)
//       AUTO-MAP RANDOMIZE  (randomized version of the current page's recipe)
//       ─────
//       RESET ALL PANELS    (clear localStorage positions)
//
// Panel visibility is a per-page setting persisted in localStorage so
// the user's preferences survive reloads. AUTO-MAP calls
// window.SWR_AUTOMAP.apply(pageId) (which is a separate module —
// engine-automap.client.js — for cleanliness).

(function () {
  'use strict';
  if (window.SWR_SETTINGS) return;

  const GEAR_ID  = 'swr-settings-gear';
  const MENU_ID  = 'swr-settings-menu';
  const LS_VIS   = 'swr.settings.visible';
  const PANELS = [
    { id: 'ls-panel-swap',   label: 'AUTO-SWAP', store: 'swr.swapVisible'   },
    { id: 'ls-panel-timing', label: 'TIMING',    store: 'swr.timingVisible' },
    { id: 'ls-panel-lfo',    label: 'LFOs',      store: 'swr.lfoVisible'    },
  ];

  function readVisibility() {
    try {
      const raw = localStorage.getItem(LS_VIS);
      const obj = raw ? JSON.parse(raw) : {};
      return {
        'ls-panel-swap':   obj['ls-panel-swap']   !== false,
        'ls-panel-timing': obj['ls-panel-timing'] !== false,
        'ls-panel-lfo':    obj['ls-panel-lfo']    !== false,
      };
    } catch (_) {
      return { 'ls-panel-swap': true, 'ls-panel-timing': true, 'ls-panel-lfo': true };
    }
  }

  function writeVisibility(v) {
    try { localStorage.setItem(LS_VIS, JSON.stringify(v)); } catch (_) {}
  }

  function applyVisibility(v) {
    for (const p of PANELS) {
      const el = document.getElementById(p.id);
      if (!el) continue;
      el.style.display = v[p.id] ? '' : 'none';
    }
  }

  function toggleVisibility(panelId) {
    const v = readVisibility();
    v[panelId] = !v[panelId];
    writeVisibility(v);
    applyVisibility(v);
    if (typeof window.setStatus === 'function') {
      window.setStatus('panel: ' + panelId.replace('ls-panel-', '') + ' ' + (v[panelId] ? 'shown' : 'hidden'), 'ok');
    }
  }

  function resetAllPanels() {
    for (const k of ['swr-layer-scheduler.pos', 'swr.timing-panel.pos', 'swr.lfo-panel.pos', LS_VIS]) {
      try { localStorage.removeItem(k); } catch (_) {}
    }
    // Reset visibility to default (all on).
    applyVisibility({ 'ls-panel-swap': true, 'ls-panel-timing': true, 'ls-panel-lfo': true });
    // Move panels back to their CSS default positions by clearing inline
    // left/top/right/bottom.
    for (const p of PANELS) {
      const el = document.getElementById(p.id);
      if (!el) continue;
      el.style.left = '';
      el.style.top = '';
      el.style.right = '';
      el.style.bottom = '';
    }
    if (typeof window.setStatus === 'function') {
      window.setStatus('settings: all panels reset to defaults', 'ok');
    }
  }

  // ---- menu rendering -------------------------------------------------

  function buildGear() {
    if (document.getElementById(GEAR_ID)) return;
    const btn = document.createElement('button');
    btn.id = GEAR_ID;
    btn.setAttribute('aria-label', 'Settings');
    btn.title = 'Settings';
    btn.style.cssText = [
      'position:fixed', 'top:14px', 'right:14px', 'z-index:10001',
      'width:36px', 'height:36px', 'border-radius:50%',
      'background:rgba(15,15,20,0.92)', 'color:#ff3d92',
      'border:1px solid #ff3d92', 'cursor:pointer', 'padding:0',
      'font:18px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'box-shadow:0 4px 18px rgba(255,61,146,0.25)',
      'transition:transform 0.15s ease, box-shadow 0.15s ease',
    ].join(';');
    btn.textContent = '⚙';
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'rotate(45deg)'; btn.style.boxShadow = '0 4px 22px rgba(255,61,146,0.45)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = ''; btn.style.boxShadow = '0 4px 18px rgba(255,61,146,0.25)'; });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMenu();
    });
    document.body.appendChild(btn);
  }

  function buildMenu() {
    if (document.getElementById(MENU_ID)) return;
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.style.cssText = [
      'position:fixed', 'top:58px', 'right:14px', 'z-index:10001',
      'min-width:220px', 'max-width:280px',
      'background:rgba(15,15,20,0.95)', 'color:#eee',
      'border:1px solid #444', 'border-radius:8px',
      'padding:6px 0', 'font:12px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'box-shadow:0 8px 32px rgba(0,0,0,0.5)', 'display:none',
      'user-select:none',
    ].join(';');

    const vis = readVisibility();

    // Panel toggles
    for (const p of PANELS) {
      const row = makeRow(p.label, vis[p.id] ? '☑' : '☐', () => toggleVisibility(p.id));
      menu.appendChild(row);
    }

    // Divider
    menu.appendChild(makeDivider());

    // AUTO-MAP header
    const head = document.createElement('div');
    head.style.cssText = 'padding:6px 12px 4px;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#888;';
    head.textContent = 'AUTO-MAP';
    menu.appendChild(head);

    // Per-engine auto-map buttons
    if (window.SWR_AUTOMAP && window.SWR_AUTOMAP.list) {
      const pageId = window.SWR_AUTOMAP.pageIdFromBody
        ? window.SWR_AUTOMAP.pageIdFromBody() : null;
      for (const entry of window.SWR_AUTOMAP.list()) {
        const isCurrent = entry.id === pageId;
        const label = isCurrent
          ? entry.label + '   ✓'
          : entry.label;
        const row = makeRow(label, '→', () => {
          if (window.SWR_AUTOMAP.apply(entry.id)) {
            closeMenu();
          }
        });
        if (isCurrent) row.style.color = '#7f7';
        menu.appendChild(row);
      }
      // Randomize button
      const randRow = makeRow('RANDOMIZE', '~', () => {
        if (window.SWR_AUTOMAP.randomize(pageId)) closeMenu();
      });
      menu.appendChild(randRow);
    } else {
      const note = document.createElement('div');
      note.style.cssText = 'padding:6px 12px;font-size:10px;color:#888;font-style:italic;';
      note.textContent = '(automap module not loaded)';
      menu.appendChild(note);
    }

    // Divider + reset
    menu.appendChild(makeDivider());

    // PROJECT section: save / load the user's current state as JSON.
    // project.client.js handles serialization + file I/O; settings
    // just adds the menu rows.
    menu.appendChild(makeRow('SAVE PROJECT', '↓', () => {
      if (!window.SWR_PROJECT) { setStatus('project module not loaded', 'err'); return; }
      const ok = window.SWR_PROJECT.save();
      if (ok) {
        if (typeof window.setStatus === 'function') window.setStatus('project saved', 'ok');
        closeMenu();
      } else {
        if (typeof window.setStatus === 'function') window.setStatus('project save failed', 'err');
      }
    }));
    menu.appendChild(makeRow('LOAD PROJECT', '↑', () => {
      if (!window.SWR_PROJECT) { setStatus('project module not loaded', 'err'); return; }
      ensureFileInput();
      fileInput.click();
      closeMenu();
    }));

    menu.appendChild(makeDivider());
    menu.appendChild(makeRow('RESET ALL PANELS', '×', () => { resetAllPanels(); closeMenu(); }, true));

    document.body.appendChild(menu);

    // Click outside closes the menu.
    document.addEventListener('click', function (e) {
      const menuEl = document.getElementById(MENU_ID);
      const gearEl = document.getElementById(GEAR_ID);
      if (!menuEl || !gearEl) return;
      if (e.target === gearEl || gearEl.contains(e.target)) return;
      if (menuEl.contains(e.target)) return;
      closeMenu();
    });
  }

  function makeRow(label, glyph, onClick, destructive) {
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex', 'align-items:center', 'gap:8px',
      'padding:6px 12px', 'cursor:pointer',
      'transition:background 0.08s ease',
      destructive ? 'color:#ff7a3d;' : '',
    ].join('');
    const labelEl = document.createElement('span');
    labelEl.style.cssText = 'flex:1;';
    labelEl.textContent = label;
    const glyphEl = document.createElement('span');
    glyphEl.style.cssText = 'width:14px;text-align:center;color:#888;font-family:monospace;';
    glyphEl.textContent = glyph;
    row.appendChild(labelEl);
    row.appendChild(glyphEl);
    row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,61,146,0.10)'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });
    row.addEventListener('click', onClick);
    return row;
  }

  function makeDivider() {
    const d = document.createElement('div');
    d.style.cssText = 'height:1px;background:#2a1d3a;margin:4px 0;';
    return d;
  }

  function toggleMenu() {
    const m = document.getElementById(MENU_ID);
    if (!m) return;
    m.style.display = m.style.display === 'none' ? '' : 'none';
  }
  function closeMenu() {
    const m = document.getElementById(MENU_ID);
    if (m) m.style.display = 'none';
  }

  // ---- file picker for project.loadFromFile --------------------------
  // Lazy-initialized: the <input type="file"> is appended once on
  // first LOAD click, hidden, and reused.
  let fileInput = null;
  function ensureFileInput() {
    if (fileInput) return;
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.style.cssText = 'display:none;position:absolute;left:-9999px;';
    fileInput.addEventListener('change', async function () {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';  // reset so the same file can be picked again
      if (!f || !window.SWR_PROJECT) return;
      try {
        const r = await window.SWR_PROJECT.loadFromFile(f);
        if (r && r.ok) {
          if (typeof window.setStatus === 'function')
            window.setStatus('project loaded (' + r.applied + ' layers, ' +
              (r.missing || 0) + ' missing)', 'ok');
        } else {
          const why = r && r.errors ? r.errors.join('; ') : 'unknown';
          if (typeof window.setStatus === 'function') window.setStatus('project load failed: ' + why, 'err');
        }
      } catch (e) {
        if (typeof window.setStatus === 'function') window.setStatus('project load threw: ' + e.message, 'err');
      }
    });
    document.body.appendChild(fileInput);
  }

  // ---- boot -----------------------------------------------------------

  function boot() {
    buildGear();
    buildMenu();
    applyVisibility(readVisibility());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    // Slight defer so other panels (which load just before us) are mounted.
    setTimeout(boot, 0);
  }

  // Public surface (testing + future extension).
  window.SWR_SETTINGS = {
    open: function () {
      const m = document.getElementById(MENU_ID);
      if (m) m.style.display = '';
    },
    close: closeMenu,
    togglePanel: toggleVisibility,
    resetAll: resetAllPanels,
    gearId: GEAR_ID,
    menuId: MENU_ID,
  };
})();
