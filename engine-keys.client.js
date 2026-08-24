// engine-keys.client.js — centralized keyboard navigation for the SWR engine.
//
// One document-level keydown handler that dispatches to a small set of
// well-known actions (panel toggles, layer selection, auto-map cycling,
// GENOPS remap/randomize, settings menu). The handler is no-op when the
// active element is a form field (input/select/textarea/contentEditable) so
// the user can type values into panel sliders without triggering shortcuts.
//
// Every keypress also dispatches a `swr-keys-press` CustomEvent with
// detail = { key, code, mods, action } so the existing scripts (or future
// ones) can react without re-registering their own listeners.
//
// Public API on window.SWR_KEYS:
//   .help()            — returns the full keymap as an array of
//                        {keys, label, action} rows (used by the help
//                        panel and the test script)
//   .setEnabled(bool)  — disable / re-enable the global handler
//   .isEnabled()       — current state
//   .simulate(key)     — programmatically fire a keydown for tests + macros
//
// Keymap (mod = shift / alt / ctrl as appropriate):
//
//   Space              play / pause           (Audio.play or Audio.pause)
//   R                  remap                  (SWR_GENOPS.remap)
//   N                  randomize              (SWR_GENOPS.randomize)
//   M                  toggle AUTO-SWAP panel
//   T                  toggle TIMING panel
//   L                  toggle LFOs panel
//   S or ?             open settings menu      (SWR_SETTINGS.open)
//                       Also reveals the ⚙ gear in the top-right so
//                       the user has a persistent entry point after
//                       first use.
//   Esc                close settings menu    (SWR_SETTINGS.close)
//   ↑ / ↓              select prev / next layer
//   1..9               select layer by index  (1-based; 0 = layer 0)
//   0                  deselect               (L.sel = null)
//   A                  cycle auto-map recipe (randomized) — within page
//   Shift+A            cycle to next engine's recipe
//   + / -              bump fadeInMs / fadeOutMs by 100ms for selected layer
//   Shift+R            force auto-swap now    (LayerScheduler.swapNow)
//   Space (no audio)   bloom layers            (SWR_TIMING.staggeredFadeIn)
//   ?                  show keymap help overlay
//
// Notes:
// - Engine.html's existing Space + R behavior is preserved. The page-level
//   handler runs first (during overlay dismissal), then SWR_KEYS picks up
//   subsequent presses for the rest of the session.
// - The keydown listener is attached to `window` (not document) so it fires
//   even when focus is on the canvas / a non-tabbable element.
// - No hot-module pattern: SWR_KEYS is plain singleton, no events emitted
//   during overlay dismissal.

(function () {
  'use strict';
  if (window.SWR_KEYS) return;

  const state = { enabled: true, helpVisible: false };

  // ---- keymap --------------------------------------------------------

  // Each entry: { keys: 'human-readable', label, action(code, ev) }.
  // `code` is the KeyboardEvent.code (layout-independent). `ev` is the
  // original keydown event so handlers can read modifiers.
  const ACTIONS = {
    play: {
      keys: 'Space',
      label: 'Play / pause',
      action: function () {
        const A = window.SWR && window.SWR.Audio;
        if (!A || !A.el) return;
        try { A.playing ? A.pause() : A.play(); } catch (_) {}
      },
    },
    remap: {
      keys: 'R',
      label: 'Remap (GENOPS)',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.remap === 'function') G.remap();
      },
    },
    randomize: {
      keys: 'N',
      label: 'Randomize (GENOPS)',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.randomize === 'function') G.randomize();
      },
    },
    toggleAutoSwap: {
      keys: 'M',
      label: 'Toggle AUTO-SWAP panel',
      action: function () {
        if (window.SWR_SETTINGS) window.SWR_SETTINGS.togglePanel('ls-panel-swap');
      },
    },
    toggleTiming: {
      keys: 'T',
      label: 'Toggle TIMING panel',
      action: function () {
        if (window.SWR_SETTINGS) window.SWR_SETTINGS.togglePanel('ls-panel-timing');
      },
    },
    toggleLfOs: {
      keys: 'L',
      label: 'Toggle LFOs panel',
      action: function () {
        if (window.SWR_SETTINGS) window.SWR_SETTINGS.togglePanel('ls-panel-lfo');
      },
    },
    openSettings: {
      keys: 'S or ?',
      label: 'Open settings menu',
      action: function () {
        if (window.SWR_SETTINGS) window.SWR_SETTINGS.open();
      },
    },
    closeSettings: {
      keys: 'Esc',
      label: 'Close settings menu / help',
      action: function () {
        if (window.SWR_SETTINGS) window.SWR_SETTINGS.close();
        hideHelp();
      },
    },
    selectPrev: {
      keys: '↑',
      label: 'Select previous layer',
      action: function () { cycleLayer(-1); },
    },
    selectNext: {
      keys: '↓',
      label: 'Select next layer',
      action: function () { cycleLayer(+1); },
    },
    cycleAutoMap: {
      keys: 'A',
      label: 'Re-randomize auto-map (current page)',
      action: function () {
        const M = window.SWR_AUTOMAP;
        if (!M) return;
        const pageId = M.pageIdFromBody ? M.pageIdFromBody() : null;
        M.randomize(pageId);
      },
    },
    cycleNextRecipe: {
      keys: 'Shift+A',
      label: 'Apply next engine recipe',
      action: function () {
        const M = window.SWR_AUTOMAP;
        if (!M) return;
        const all = M.list();
        const cur = M.pageIdFromBody ? M.pageIdFromBody() : null;
        const idx = all.findIndex(r => r.id === cur);
        const next = all[(idx + 1 + all.length) % all.length];
        M.apply(next.id);
      },
    },
    bumpFadeIn: {
      keys: '+',
      label: 'Bump fadeInMs by 100ms (selected layer)',
      action: function () { bumpFade(+100, 'fadeInMs'); },
    },
    bumpFadeOut: {
      keys: '-',
      label: 'Bump fadeOutMs by 100ms (selected layer)',
      action: function () { bumpFade(+100, 'fadeOutMs'); },
    },
    forceSwap: {
      keys: 'Shift+R',
      label: 'Force an auto-swap now',
      action: function () {
        if (window.LayerScheduler && typeof window.LayerScheduler.swapNow === 'function') {
          window.LayerScheduler.swapNow();
        }
      },
    },
    bloom: {
      keys: 'Space (no audio)',
      label: 'Bloom layers (re-stagger fade-in)',
      action: function () {
        const T = window.SWR_TIMING;
        const L = window.SWR && window.SWR.Layers;
        if (T && L && L.list && L.list.length) T.staggeredFadeIn(L.list);
      },
    },
    showHelp: {
      keys: '?',
      label: 'Show keymap help',
      action: showHelp,
    },
  };

  // ---- helpers --------------------------------------------------------

  function layers() { return window.SWR && window.SWR.Layers; }
  function audio()  { return window.SWR && window.SWR.Audio; }

  function cycleLayer(dir) {
    const L = layers();
    if (!L || !L.list || !L.list.length) return;
    let idx = L.list.indexOf(L.sel);
    if (idx < 0) idx = dir > 0 ? -1 : L.list.length;
    idx = (idx + dir + L.list.length) % L.list.length;
    L.sel = L.list[idx];
    if (typeof L.render === 'function') L.render();
    if (typeof window.setStatus === 'function') {
      window.setStatus('layer: ' + (L.list[idx].id || ('#' + idx)) + ' (' + (idx + 1) + '/' + L.list.length + ')', 'ok');
    }
  }

  function bumpFade(delta, field) {
    const L = layers();
    const T = window.SWR_TIMING;
    if (!L || !L.sel || !T) return;
    const layer = L.sel;
    const before = layer[field] || 0;
    const after  = Math.max(0, before + delta);
    if (typeof T.setFade === 'function') T.setFade(layer, field === 'fadeInMs' ? after : undefined, field === 'fadeOutMs' ? after : undefined);
    if (typeof window.setStatus === 'function') {
      window.setStatus(field + ': ' + before + ' → ' + after, 'ok');
    }
  }

  // ---- help overlay --------------------------------------------------

  let helpEl = null;
  function showHelp() {
    if (helpEl) { helpEl.style.display = ''; state.helpVisible = true; return; }
    helpEl = document.createElement('div');
    helpEl.id = 'swr-keys-help';
    helpEl.style.cssText = [
      'position:fixed', 'top:60px', 'right:14px', 'z-index:10002',
      'min-width:280px', 'max-width:360px',
      'background:rgba(10,6,18,0.97)', 'color:#f5e9ff',
      'border:1px solid #ff3d92', 'border-radius:10px',
      'padding:14px 16px', 'font:12px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'box-shadow:0 12px 40px rgba(255,61,146,0.25)',
      'user-select:none',
    ].join(';');
    const rows = help().map(function (r) {
      return '<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;">' +
               '<span style="color:#ff3d92;font-family:monospace;flex-shrink:0;">' + r.keys + '</span>' +
               '<span style="text-align:right;color:#ccc;">' + r.label + '</span>' +
             '</div>';
    }).join('');
    helpEl.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">' +
        '<strong style="font-size:13px;letter-spacing:0.04em;">⌨ KEYBOARD</strong>' +
        '<span style="font-size:10px;color:#888;margin-left:auto;">esc to close</span>' +
      '</div>' + rows;
    document.body.appendChild(helpEl);
    state.helpVisible = true;
  }
  function hideHelp() {
    if (helpEl) helpEl.style.display = 'none';
    state.helpVisible = false;
  }

  // ---- main keydown handler -----------------------------------------

  function isFormField(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function handle(ev) {
    if (!state.enabled) return;
    if (isFormField(ev.target)) return;

    const code = ev.code;
    const key = ev.key;
    let action = null;

    // ---- navigation + panel toggles (no modifier) ----
    if (!ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      switch (code) {
        case 'Space':           action = ev.shiftKey ? ACTIONS.bloom : ACTIONS.play; break;
        case 'KeyR':            action = ev.shiftKey ? ACTIONS.forceSwap : ACTIONS.remap; break;
        case 'KeyN':            action = ACTIONS.randomize; break;
        case 'KeyM':            action = ACTIONS.toggleAutoSwap; break;
        case 'KeyT':            action = ACTIONS.toggleTiming; break;
        case 'KeyL':            action = ACTIONS.toggleLfOs; break;
        case 'KeyS':            action = ACTIONS.openSettings; break;
        case 'ArrowUp':         action = ACTIONS.selectPrev; ev.preventDefault(); break;
        case 'ArrowDown':       action = ACTIONS.selectNext; ev.preventDefault(); break;
        case 'KeyA':            action = ev.shiftKey ? ACTIONS.cycleNextRecipe : ACTIONS.cycleAutoMap; break;
        case 'Equal':           // +
        case 'NumpadAdd':       action = ACTIONS.bumpFadeIn; break;
        case 'Minus':           // -
        case 'NumpadSubtract':  action = ACTIONS.bumpFadeOut; break;
        case 'Escape':          action = ACTIONS.closeSettings; break;
      }
      // ? key as a literal (some keyboards send Slash with shift)
      if (!action && (key === '?' || (ev.shiftKey && code === 'Slash'))) {
        action = ACTIONS.showHelp;
      }
      // 1..9 to select layer 0..8; 0 to deselect
      if (!action && !ev.shiftKey && /^[1-9]$/.test(key)) {
        const L = layers();
        if (L && L.list && L.list.length) {
          const idx = parseInt(key, 10) - 1;
          if (idx < L.list.length) {
            L.sel = L.list[idx];
            if (typeof L.render === 'function') L.render();
            if (typeof window.setStatus === 'function') {
              window.setStatus('layer: ' + (L.list[idx].id || ('#' + idx)), 'ok');
            }
            // Don't dispatch further — 1..9 handled inline.
            try { window.dispatchEvent(new CustomEvent('swr-keys-press', {
              detail: { key, code, mods: { shift: !!ev.shiftKey, alt: !!ev.altKey }, action: 'select-layer-' + idx }
            })); } catch (_) {}
            return;
          }
        }
      }
      if (!action && key === '0') {
        const L = layers();
        if (L) L.sel = null;
        if (typeof window.setStatus === 'function') window.setStatus('layer: —', 'ok');
        try { window.dispatchEvent(new CustomEvent('swr-keys-press', {
          detail: { key, code, mods: { shift: !!ev.shiftKey }, action: 'deselect' }
        })); } catch (_) {}
        return;
      }
    }

    if (!action) return;

    // Prevent default for keys we handle so the page doesn't double-react
    // (e.g. Space scrolling, Arrow keys moving the slider).
    if (ev.preventDefault) ev.preventDefault();

    try { action.action(); } catch (_) {}

    try { window.dispatchEvent(new CustomEvent('swr-keys-press', {
      detail: { key, code, mods: { shift: !!ev.shiftKey, alt: !!ev.altKey, ctrl: !!ev.ctrlKey, meta: !!ev.metaKey }, action: action.label }
    })); } catch (_) {}
  }

  // ---- public --------------------------------------------------------

  function help() {
    return [
      { keys: 'Space',          label: 'play / pause' },
      { keys: 'Space (no audio)', label: 'bloom layers (staggered fade-in)' },
      { keys: 'R',              label: 'remap (GENOPS)' },
      { keys: 'Shift+R',        label: 'force auto-swap now' },
      { keys: 'N',              label: 'randomize (GENOPS)' },
      { keys: 'A',              label: 're-randomize auto-map (this page)' },
      { keys: 'Shift+A',        label: 'cycle to next engine recipe' },
      { keys: '↑ / ↓',          label: 'select prev / next layer' },
      { keys: '1..9',           label: 'select layer by index (1-based)' },
      { keys: '0',              label: 'deselect layer' },
      { keys: 'M / T / L',      label: 'toggle AUTO-SWAP / TIMING / LFOs' },
      { keys: 'S or ?',         label: 'open settings menu' },
      { keys: '+ / -',          label: 'bump fadeIn / fadeOut by 100ms' },
      { keys: 'Esc',            label: 'close settings menu / help' },
      { keys: '?',              label: 'show this help overlay' },
    ];
  }

  window.SWR_KEYS = {
    help: help,
    setEnabled: function (b) { state.enabled = !!b; },
    isEnabled:  function () { return !!state.enabled; },
    simulate: function (keyOrCode, mods) {
      // Programmatic keypress for tests + future macros. Calls handle()
      // directly with a synthetic event shape.
      const ev = {
        code: keyOrCode,
        key:  keyOrCode,
        shiftKey:  !!(mods && mods.shift),
        ctrlKey:   !!(mods && mods.ctrl),
        altKey:    !!(mods && mods.alt),
        metaKey:   !!(mods && mods.meta),
        target:    document.body,
        preventDefault: function () {},
      };
      handle(ev);
    },
    showHelp: showHelp,
    hideHelp: hideHelp,
  };

  // ---- install --------------------------------------------------------

  function install() {
    if (state._installed) return;
    window.addEventListener('keydown', handle, { passive: false });
    state._installed = true;
    // Wire the clickable "?" help icon (if the page exposes one) so users
    // who don't know the keyboard shortcut can still open the overlay.
    // The button is opt-in — pages that want it add a
    //   <button id="swr-keys-help-btn">?</button>
    // somewhere in their header; this listener is a no-op otherwise.
    function bindHelpButton() {
      const btn = document.getElementById('swr-keys-help-btn');
      if (!btn) return false;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (state.helpVisible) hideHelp(); else showHelp();
      });
      btn.title = 'Keyboard shortcuts (?)';
      try { console.log('[swr-keys] help button bound'); } catch (_) {}
      return true;
    }
    if (!bindHelpButton()) {
      // Page may mount the button after SWR_KEYS loads — try once more on
      // a short delay, then give up.
      try { console.log('[swr-keys] help button not yet in DOM, retrying in 250ms'); } catch (_) {}
      window.setTimeout(function () {
        if (!bindHelpButton()) {
          try { console.log('[swr-keys] help button still missing after retry'); } catch (_) {}
        }
      }, 250);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
