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
//   Shift+1..9         advance story chapters (FRAGMENTS / SIGNAL / …)
//   Cmd+1..9 / Ctrl+1..9  legacy FX palette preset (PULSE / NEON / …)
//                        Applies a known FX configuration (temp, vignette,
//                        glow, …) to the running engine. The page stays put;
//                        only the look changes.
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
  //
  // Naming convention used in the help overlay:
  //   Cmd / Ctrl  is shown as "Cmd" (the action works with either; meta on
  //   macOS, ctrl elsewhere — this is what video editors do).
  //
  // Layout (left hand = top row, right hand = bracket/punctuation block):
  //
  //   Transport     Space  ·  M
  //   Generation    R  ·  N  ·  A  ·  Ctrl+Z/Shift+Ctrl+Z  ·  Ctrl+S  ·  Ctrl+O
  //   Layers        1..9  ·  0  ·  ↑/↓  ·  [/]  ·  ;/'  ·  ,/.  ·  /  ·  Shift+/  ·  Del
  //   View          F  ·  Esc
  //   Panels        M  ·  T  ·  L  ·  S  ·  ?
  //   Recording     Ctrl+R  ·  Shift+R
  //
  // Bracket pattern (Photoshop-style nudges) maps to the most-used
  // per-layer knobs: alpha [ ], hue , ., scale ; '. The legacy "+/-"
  // stays for fadeIn/fadeOut bump but is supplemented by Shift+/Shift-.
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
    mute: {
      keys: 'M',
      label: 'Toggle mute (audio still plays, gain→0)',
      action: function () {
        const A = audio();
        if (!A || !A.gain) return;
        try {
          const before = A.gain.gain.value;
          A.gain.gain.value = before > 0.01 ? 0 : 1;
          if (window.setStatus) window.setStatus('mute: ' + (A.gain.gain.value < 0.01 ? 'on' : 'off'), 'ok');
        } catch (_) {}
      },
    },
    remap: {
      keys: 'R',
      label: 'Remap (GENOPS) — new assets, same patch',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.remap === 'function') G.remap();
      },
    },
    randomize: {
      keys: 'N',
      label: 'Randomize (GENOPS) — full re-roll of the patch',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.randomize === 'function') G.randomize();
      },
    },
    mutate: {
      keys: 'Shift+N',
      label: 'Mutate (GENOPS) — small perturbation (smaller than randomize)',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.mutate === 'function') G.mutate();
      },
    },
    toggleAutoSwap: {
      keys: 'Shift+M',
      label: 'Toggle AUTO-SWAP panel',
      action: function () {
        if (window.SWR_SETTINGS) window.SWR_SETTINGS.togglePanel('ls-panel-swap');
      },
    },
    toggleTiming: {
      keys: 'Shift+T',
      label: 'Toggle TIMING panel',
      action: function () {
        if (window.SWR_SETTINGS) window.SWR_SETTINGS.togglePanel('ls-panel-timing');
      },
    },
    toggleLfOs: {
      keys: 'Shift+L',
      label: 'Toggle LFOs panel',
      action: function () {
        if (window.SWR_SETTINGS) window.SWR_SETTINGS.togglePanel('ls-panel-lfo');
      },
    },
    openSettings: {
      keys: 'S',
      label: 'Open settings menu',
      action: function () {
        if (window.SWR_SETTINGS) window.SWR_SETTINGS.open();
      },
    },
    closeSettings: {
      keys: 'Esc',
      label: 'Close settings menu / help overlay',
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
      label: 'Re-randomize auto-map (this engine)',
      action: function () {
        const M = window.SWR_AUTOMAP;
        if (!M) return;
        const pageId = M.pageIdFromBody ? M.pageIdFromBody() : null;
        M.randomize(pageId);
      },
    },
    cycleNextRecipe: {
      keys: 'Shift+A',
      label: 'Apply next engine recipe (cross-page)',
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
      keys: 'Shift++',
      label: 'Bump fadeInMs by 100ms (selected layer)',
      action: function () { bumpFade(+100, 'fadeInMs'); },
    },
    bumpFadeOut: {
      keys: 'Shift+-',
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
      keys: 'B',
      label: 'Bloom layers (stagger fade-in)',
      action: function () {
        const T = window.SWR_TIMING;
        const L = window.SWR && window.SWR.Layers;
        if (T && L && L.list && L.list.length) T.staggeredFadeIn(L.list);
      },
    },
    crossfade: {
      keys: 'X',
      label: 'Crossfade all layers (A2 swap)',
      action: function () {
        const T = window.SWR_TIMING;
        const L = window.SWR && window.SWR.Layers;
        if (!T || !L || !L.list || !L.list.length) return;
        L.list.forEach(function (l) { try { T.crossfade(l); } catch (_) {} });
        if (window.setStatus) window.setStatus('crossfade: ' + L.list.length + ' layers', 'ok');
      },
    },
    showHelp: {
      keys: '?',
      label: 'Show this help overlay',
      action: showHelp,
    },

    // ---- universal editor conventions (Cmd / Ctrl modifiers) ----

    undo: {
      keys: 'Cmd+Z',
      label: 'Undo last GENOPS op (Cmd/Ctrl+Z)',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.undo === 'function') G.undo();
      },
    },
    redo: {
      keys: 'Cmd+Shift+Z',
      label: 'Redo last undone op (Cmd/Ctrl+Shift+Z)',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.redo === 'function') G.redo();
      },
    },
    commit: {
      keys: 'Cmd+Enter',
      label: 'Commit current GENOPS state to history',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.commit === 'function') G.commit();
      },
    },
    saveProject: {
      keys: 'Cmd+S',
      label: 'Save project (.swr-project download)',
      action: function () {
        if (window.SWR_PROJECT && typeof window.SWR_PROJECT.save === 'function') {
          try { window.SWR_PROJECT.save(); } catch (_) {}
        }
      },
    },
    openProject: {
      keys: 'Cmd+O',
      label: 'Open project (.swr-project file picker)',
      action: function () {
        if (window.SWR_PROJECT && typeof window.SWR_PROJECT.loadFromFile === 'function') {
          try { window.SWR_PROJECT.loadFromFile(); } catch (_) {}
        }
      },
    },
    toggleRecord: {
      keys: 'Cmd+R',
      label: 'Start / stop recording (Cmd/Ctrl+R)',
      action: function () {
        const recBtn = document.getElementById('rec');
        if (recBtn) recBtn.click();
      },
    },
    fullscreen: {
      keys: 'F',
      label: 'Toggle fullscreen',
      action: function () {
        if (document.fullscreenElement) {
          try { document.exitFullscreen(); } catch (_) {}
        } else if (document.documentElement.requestFullscreen) {
          try { document.documentElement.requestFullscreen(); } catch (_) {}
        }
      },
    },

    // ---- per-layer tweaks (Photoshop-bracket pattern) ----
    // The selected layer is mutated directly. Default nudge = 5% of the
    // field's typical range; Shift+key = 4x nudge (Photoshop convention).

    nudgeAlphaDown: {
      keys: '[',
      label: '− alpha (selected layer, ×0.05 / Shift ×0.20)',
      action: function () { nudgeLayer('alpha', -0.05, 0, 1.5); },
    },
    nudgeAlphaUp: {
      keys: ']',
      label: '+ alpha (selected layer)',
      action: function () { nudgeLayer('alpha', +0.05, 0, 1.5); },
    },
    nudgeHueDown: {
      keys: ',',
      label: '− hue (selected layer, −6° / Shift −24°)',
      action: function () { nudgeLayer('hue', -6, -180, 180); },
    },
    nudgeHueUp: {
      keys: '.',
      label: '+ hue (selected layer)',
      action: function () { nudgeLayer('hue', +6, -180, 180); },
    },
    nudgeScaleDown: {
      keys: ';',
      label: '− scale (selected layer, −0.05)',
      action: function () { nudgeLayer('baseScale', -0.05, 0.1, 3); },
    },
    nudgeScaleUp: {
      keys: "'",
      label: "+ scale (selected layer)",
      action: function () { nudgeLayer('baseScale', +0.05, 0.1, 3); },
    },
    nudgeContrastDown: {
      keys: 'Shift+,',
      label: '− contrast (selected layer, −0.05 / Shift ×0.20)',
      action: function () { nudgeLayer('contrast', -0.05, 0.1, 2.5); },
    },
    nudgeContrastUp: {
      keys: 'Shift+.',
      label: '+ contrast (selected layer)',
      action: function () { nudgeLayer('contrast', +0.05, 0.1, 2.5); },
    },
    nudgeBrightnessDown: {
      keys: 'Shift+;',
      label: '− brightness (selected layer, −0.05)',
      action: function () { nudgeLayer('brightness', -0.05, 0.1, 2.5); },
    },
    nudgeBrightnessUp: {
      keys: "Shift+'",
      label: '+ brightness (selected layer)',
      action: function () { nudgeLayer('brightness', +0.05, 0.1, 2.5); },
    },
    nudgeMutateDown: {
      keys: 'Shift+[',
      label: '− mutate jitter (selected layer)',
      action: function () { nudgeLayer('mutate', -0.05, 0, 1); },
    },
    nudgeMutateUp: {
      keys: 'Shift+]',
      label: '+ mutate jitter (selected layer)',
      action: function () { nudgeLayer('mutate', +0.05, 0, 1); },
    },
    nudgeOpacityUp: {
      keys: 'Shift+/',
      label: '+ opacity (selected layer, +0.05)',
      action: action_nudgeOpacityUp,
    },
    nudgeOpacityDown: {
      keys: '/',
      label: '− opacity (selected layer, −0.05)',
      action: action_nudgeOpacityDown,
    },

    // ---- per-layer ops (vim-style single keys) ----

    cycleBlend: {
      keys: 'C',
      label: 'Cycle blend mode (selected layer)',
      action: function () { cycleBlend(); },
    },
    duplicateLayer: {
      keys: 'Y',
      label: 'Duplicate selected layer',
      action: function () { duplicateLayer(); },
    },
    deleteLayer: {
      keys: 'Del',
      label: 'Remove selected layer',
      action: function () { deleteSelectedLayer(); },
    },
  };

  // Per-layer nudges. The Shift = ×4 multiplier is read from the most
  // recently dispatched keyboard event (stashed on window.__swrLastKeydown
  // by handle()). This lets nudgeLayer stay a pure value-tweaker with no
  // KeyboardEvent plumbing.
  function nudgeLayer(field, delta, lo, hi) {
    const L = layers();
    if (!L || !L.sel) return;
    const ev = window.__swrLastKeydown;
    const shift = ev && ev.shiftKey;
    const step = delta * (shift ? 4 : 1);
    const before = L.sel[field];
    if (typeof before !== 'number') return;
    const after = Math.max(lo, Math.min(hi, before + step));
    L.sel[field] = after;
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) {
      window.setStatus(field + ': ' + before.toFixed(2) + ' → ' + after.toFixed(2), 'ok');
    }
  }

  function action_nudgeOpacityUp() {
    // Bound to Shift+/ — Photoshop-style opacity nudge up
    const L = layers();
    if (!L || !L.sel) return;
    const before = L.sel.opacity;
    const after = Math.max(0, Math.min(1, before + 0.05));
    L.sel.opacity = after;
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) window.setStatus('opacity: ' + before.toFixed(2) + ' → ' + after.toFixed(2), 'ok');
  }
  function action_nudgeOpacityDown() {
    const L = layers();
    if (!L || !L.sel) return;
    const before = L.sel.opacity;
    const after = Math.max(0, Math.min(1, before - 0.05));
    L.sel.opacity = after;
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) window.setStatus('opacity: ' + before.toFixed(2) + ' → ' + after.toFixed(2), 'ok');
  }

  function cycleBlend() {
    const L = layers();
    if (!L || !L.sel) return;
    const BLENDS = ['source-over','screen','lighter','multiply','overlay','difference','soft-light','lighten','darken'];
    const cur = L.sel.blend || 'source-over';
    const i = BLENDS.indexOf(cur);
    L.sel.blend = BLENDS[(i + 1) % BLENDS.length];
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) window.setStatus('blend: ' + L.sel.blend, 'ok');
  }

  function duplicateLayer() {
    const L = layers();
    if (!L || !L.sel || !L.list) return;
    const src = L.sel;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = 'L' + (Date.now() % 100000);
    copy.asset = src.asset;
    const idx = L.list.indexOf(src);
    L.list.splice(idx + 1, 0, copy);
    L.sel = copy;
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) window.setStatus('layer duplicated', 'ok');
  }

  function deleteSelectedLayer() {
    const L = layers();
    if (!L || !L.sel || !L.list || !L.list.length) return;
    if (L.list.length <= 1) {
      if (window.setStatus) window.setStatus('cannot delete last layer', 'err');
      return;
    }
    const id = L.sel.id;
    L.list = L.list.filter(function (l) { return l.id !== id; });
    L.sel = L.list[0] || null;
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) window.setStatus('layer removed', 'ok');
  }

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
      'min-width:340px', 'max-width:440px', 'max-height:calc(100vh - 100px)',
      'overflow-y:auto',
      'background:rgba(10,6,18,0.97)', 'color:#f5e9ff',
      'border:1px solid #ff3d92', 'border-radius:10px',
      'padding:14px 16px', 'font:11px/1.45 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'box-shadow:0 12px 40px rgba(255,61,146,0.25)',
      'user-select:none',
    ].join(';');
    const rows = help().map(function (r) {
      return '<div style="display:flex;justify-content:space-between;gap:12px;padding:2px 0;border-bottom:1px solid rgba(255,61,146,0.08);">' +
               '<span style="color:#ff3d92;font-family:monospace;flex-shrink:0;min-width:90px;">' + r.keys + '</span>' +
               '<span style="text-align:right;color:#ccc;">' + r.label + '</span>' +
             '</div>';
    }).join('');
    helpEl.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid rgba(255,61,146,0.4);">' +
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

    // ---- Cmd / Ctrl combos first (universal editor conventions) ----
    const cmd = ev.ctrlKey || ev.metaKey;
    if (cmd && !ev.altKey) {
      switch (code) {
        case 'KeyZ': action = ev.shiftKey ? ACTIONS.redo : ACTIONS.undo; break;
        case 'KeyS': action = ACTIONS.saveProject; break;
        case 'KeyO': action = ACTIONS.openProject; break;
        case 'KeyR': action = ACTIONS.toggleRecord; break;
        case 'Enter': action = ACTIONS.commit; break;
      }
    }

    // ---- main keydown handler (no Ctrl/Meta) ----
    if (!action && !cmd && !ev.altKey) {
      switch (code) {
        case 'Space':           action = ACTIONS.play; break;
        case 'KeyR':            action = ev.shiftKey ? ACTIONS.forceSwap : ACTIONS.remap; break;
        case 'KeyN':            action = ev.shiftKey ? ACTIONS.mutate : ACTIONS.randomize; break;
        case 'KeyA':            action = ev.shiftKey ? ACTIONS.cycleNextRecipe : ACTIONS.cycleAutoMap; break;
        case 'KeyM':            action = ev.shiftKey ? ACTIONS.toggleAutoSwap : ACTIONS.mute; break;
        case 'KeyT':            action = ev.shiftKey ? ACTIONS.toggleTiming : null; break;
        case 'KeyL':            action = ev.shiftKey ? ACTIONS.toggleLfOs : null; break;
        case 'KeyB':            action = ACTIONS.bloom; break;
        case 'KeyX':            action = ACTIONS.crossfade; break;
        case 'KeyS':            action = ACTIONS.openSettings; break;
        case 'KeyC':            action = ACTIONS.cycleBlend; break;
        case 'KeyY':            action = ACTIONS.duplicateLayer; break;
        case 'KeyF':            action = ACTIONS.fullscreen; break;
        case 'ArrowUp':         action = ACTIONS.selectPrev; ev.preventDefault(); break;
        case 'ArrowDown':       action = ACTIONS.selectNext; ev.preventDefault(); break;
        case 'Equal':           // +/=
        case 'NumpadAdd':       action = ev.shiftKey ? ACTIONS.bumpFadeIn : ACTIONS.nudgeOpacityUp; break;
        case 'Minus':           // -
        case 'NumpadSubtract':  action = ev.shiftKey ? ACTIONS.bumpFadeOut : ACTIONS.nudgeOpacityDown; break;
        case 'BracketLeft':     action = ev.shiftKey ? ACTIONS.nudgeMutateUp : ACTIONS.nudgeAlphaDown; break;
        case 'BracketRight':    action = ev.shiftKey ? ACTIONS.nudgeMutateDown : ACTIONS.nudgeAlphaUp; break;
        case 'Comma':           action = ev.shiftKey ? ACTIONS.nudgeContrastUp : ACTIONS.nudgeHueDown; break;
        case 'Period':          action = ev.shiftKey ? ACTIONS.nudgeContrastDown : ACTIONS.nudgeHueUp; break;
        case 'Semicolon':       action = ev.shiftKey ? ACTIONS.nudgeBrightnessUp : ACTIONS.nudgeScaleDown; break;
        case 'Quote':           action = ev.shiftKey ? ACTIONS.nudgeBrightnessDown : ACTIONS.nudgeScaleUp; break;
        case 'Slash':           action = ACTIONS.nudgeOpacityDown; break;
        case 'Delete':
        case 'Backspace':       action = ACTIONS.deleteLayer; break;
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
            try { window.dispatchEvent(new CustomEvent('swr-keys-press', {
              detail: { key, code, mods: { shift: !!ev.shiftKey, alt: !!ev.altKey }, action: 'select-layer-' + idx }
            })); } catch (_) {}
            return;
          }
        }
      }
      // Shift+1..9 to advance the STORY runtime through its 9 chapters
      // (Fragments, Signal, Pursuit, Fracture, Revelation, Overload,
      // Afterimage, Memory, Loop). This is the performer's "director
      // override" — always wins regardless of mode (manual / guided /
      // auto / generative). The legacy FX-palette shortcut map moved
      // to Cmd/Ctrl+1..9 below.
      //
      // Digits via `code` (layout-independent): on US keyboards, Shift+Digit2
      // produces key='@' which would fail a regex test. We check `code` for
      // Digit1..Digit9 so any keyboard layout works.
      if (!action && ev.shiftKey && /^Digit[1-9]$/.test(code || '')) {
        const slot = parseInt(code.replace('Digit', ''), 10) - 1;
        const Story = window.SWR && window.SWR.Story;
        if (Story && Array.isArray(Story.ORDER)) {
          const id = Story.ORDER[slot];
          if (id) {
            Story.enter(id, 'keyboard');
            if (typeof window.setStatus === 'function') {
              window.setStatus('story: ' + (slot + 1) + ' → ' + id, 'ok');
            }
            try { window.dispatchEvent(new CustomEvent('swr-keys-press', {
              detail: { key, code, mods: { shift: !!ev.shiftKey }, action: 'story-' + id }
            })); } catch (_) {}
            if (ev.preventDefault) ev.preventDefault();
            return;
          }
        }
      }
      // Cmd/Ctrl+1..9 — legacy FX palette preset shortcuts (preserved
      // verbatim from the previous behavior; uses VersionsPresets.SHORTCUT_PRESETS).
      // Same DigitN handling so Cmd+2 works on every layout.
      if (!action && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey && /^Digit[1-9]$/.test(code || '')) {
        const slot = parseInt(code.replace('Digit', ''), 10) - 1;
        const VP = window.VersionsPresets;
        if (VP && Array.isArray(VP.SHORTCUT_PRESETS)) {
          const pageKey = VP.SHORTCUT_PRESETS[slot];
          if (pageKey) {
            const ok = VP.applyPreset(pageKey);
            if (ok !== false) {
              const label = (VP.PRESETS && VP.PRESETS[pageKey] && VP.PRESETS[pageKey].label) || pageKey.toUpperCase();
              if (typeof window.setStatus === 'function') {
                window.setStatus('fx preset: ' + label + ' (' + (slot + 1) + ')', 'ok');
              }
              try { window.dispatchEvent(new CustomEvent('swr-keys-press', {
                detail: { key, code, mods: { meta: !!ev.metaKey, ctrl: !!ev.ctrlKey },
                          action: 'fx-preset-' + pageKey }
              })); } catch (_) {}
              if (ev.preventDefault) ev.preventDefault();
              return;
            }
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

    // Stash the original event so nudgeLayer() / etc. can read modifiers
    // for the "Shift = 4x nudge" Photoshop convention.
    window.__swrLastKeydown = ev;

    try { action.action(); } catch (_) {}

    try { window.dispatchEvent(new CustomEvent('swr-keys-press', {
      detail: { key, code, mods: { shift: !!ev.shiftKey, alt: !!ev.altKey, ctrl: !!ev.ctrlKey, meta: !!ev.metaKey }, action: action.label }
    })); } catch (_) {}
  }

  // ---- public --------------------------------------------------------

  function help() {
    // Grouped by category. The render code looks for an optional `group`
    // property to insert a section heading.
    return [
      // ---- Transport ----
      { keys: 'Space',          label: 'play / pause' },
      { keys: 'M',              label: 'toggle mute' },
      { keys: 'F',              label: 'fullscreen' },
      { keys: 'Esc',            label: 'close settings / help overlay' },

      // ---- Generation ----
      { keys: 'R',              label: 'remap (GENOPS — new assets)' },
      { keys: 'N',              label: 'randomize (full re-roll)' },
      { keys: 'Shift+N',        label: 'mutate (small perturbation)' },
      { keys: 'A',              label: 're-randomize auto-map (this engine)' },
      { keys: 'Shift+A',        label: 'cycle to next engine recipe' },
      { keys: 'B',              label: 'bloom layers (stagger fade-in)' },
      { keys: 'X',              label: 'crossfade all layers (A2 swap)' },
      { keys: 'Shift+R',        label: 'force auto-swap now' },

      // ---- Undo / Save ----
      { keys: 'Cmd+Z',          label: 'undo (Cmd/Ctrl+Z)' },
      { keys: 'Cmd+Shift+Z',    label: 'redo (Cmd/Ctrl+Shift+Z)' },
      { keys: 'Cmd+Enter',      label: 'commit current state to history' },
      { keys: 'Cmd+S',          label: 'save project (.swr-project)' },
      { keys: 'Cmd+O',          label: 'open project (.swr-project picker)' },
      { keys: 'Cmd+R',          label: 'start / stop recording' },

      // ---- Layer selection ----
      { keys: '↑ / ↓',          label: 'select prev / next layer' },
      { keys: '1..9',           label: 'select layer by index (1-based)' },
      { keys: '0',              label: 'deselect layer' },

      // ---- Presets ----
      { keys: 'Shift+1..9',     label: 'story chapter (FRAGMENTS / SIGNAL / …)' },
      { keys: 'Cmd+1..9',       label: 'FX palette preset (PULSE / NEON / GRID / …)' },

      // ---- Per-layer tweaks (right-hand bracket pattern) ----
      { keys: '[ / ]',          label: '− / + alpha' },
      { keys: ', / .',          label: '− / + hue (±6°)' },
      { keys: "; / '",           label: '− / + scale' },
      { keys: '/',              label: '− opacity' },
      { keys: 'Shift+/',        label: '+ opacity (legacy: bump fadeIn)' },
      { keys: 'Shift+,',        label: '− contrast  ·  Shift = ×4 nudge' },
      { keys: 'Shift+.',        label: '+ contrast' },
      { keys: 'Shift+;',        label: '− brightness' },
      { keys: "Shift+'",        label: '+ brightness' },
      { keys: 'Shift+[',        label: '− mutate jitter' },
      { keys: 'Shift+]',        label: '+ mutate jitter' },

      // ---- Per-layer ops ----
      { keys: 'C',              label: 'cycle blend mode' },
      { keys: 'Y',              label: 'duplicate selected layer' },
      { keys: 'Del / Bksp',     label: 'remove selected layer' },
      { keys: 'Shift+T',        label: 'bump fadeInMs by 100ms' },
      { keys: 'Shift+-',        label: 'bump fadeOutMs by 100ms' },

      // ---- Panels ----
      { keys: 'Shift+M',        label: 'toggle AUTO-SWAP panel' },
      { keys: 'Shift+T',        label: 'toggle TIMING panel' },
      { keys: 'Shift+L',        label: 'toggle LFOs panel' },
      { keys: 'S',              label: 'open settings menu' },

      // ---- Help ----
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
      return true;
    }
    if (!bindHelpButton()) {
      // Page may mount the button after SWR_KEYS loads — try once more on
      // a short delay, then give up.
      window.setTimeout(function () { bindHelpButton(); }, 250);
    }

    // Master rotation toggle: a sibling icon button placed directly
    // before the "?" help button. When the page has a swr-keys-help-btn,
    // we insert <button id="swr-rot-master">↻</button> immediately before
    // it. Click: flips window.SWR_ROT_MASTER.enabled, walks every existing
    // layer in window.Layers, sets rotationEnabled on each, and re-renders
    // the layer panel so the per-layer toggles + [rot off] tags update.
    // Pages without the "?" button get no button (no-op).
    var ROT_MASTER_KEY = 'swr.rotMaster.enabled';
    function loadMasterEnabled() {
      try {
        var v = localStorage.getItem(ROT_MASTER_KEY);
        return v === null ? true : v === '1';
      } catch (_) { return true; }
    }
    function saveMasterEnabled(v) {
      try { localStorage.setItem(ROT_MASTER_KEY, v ? '1' : '0'); } catch (_) {}
    }
    window.SWR_ROT_MASTER = { enabled: loadMasterEnabled() };
    function applyMasterToLayers() {
      var L = window.Layers;
      if (!L || !Array.isArray(L.list) || !L.list.length) return 0;
      var count = 0;
      for (var i = 0; i < L.list.length; i++) {
        var lay = L.list[i];
        if (!lay) continue;
        lay.rotationEnabled = window.SWR_ROT_MASTER.enabled;
        count += 1;
      }
      if (typeof L.render === 'function') L.render();
      return count;
    }
    function paintMasterButton(btn) {
      if (!btn) return;
      if (window.SWR_ROT_MASTER.enabled) {
        btn.textContent = '↻';
        btn.style.opacity = '1';
        btn.title = 'Master rotation: ON · click = toggle off · Shift-click = clear all asset rotations';
        btn.dataset.on = '1';
      } else {
        btn.textContent = '↻';
        btn.style.opacity = '0.45';
        btn.title = 'Master rotation: OFF · click = toggle on · Shift-click = clear all asset rotations';
        btn.dataset.on = '0';
      }
    }
    function bindRotMasterButton() {
      var helpBtn = document.getElementById('swr-keys-help-btn');
      if (!helpBtn) return false;
      // If already injected (e.g. page mounted twice), reuse it.
      var btn = document.getElementById('swr-rot-master');
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'swr-rot-master';
        btn.className = helpBtn.className || 'tbtn';
        // Match the "??" button's box; the icon is single-glyph.
        btn.style.cssText = (helpBtn.getAttribute('style') || '') + 'font-weight:700;';
        btn.textContent = '↻';
        helpBtn.parentNode.insertBefore(btn, helpBtn);
      }
      paintMasterButton(btn);
      // Long-press / contextmenu handler: clears every Library item's
          // per-asset manual rotation override (`item.rotation`) back to 0.
          // Pairs with the per-asset `↻` button added in engine.html — clicking
          // each thumbnail cycles 0/90/180/270, but if the user has cycled
          // many clips across many keys they need a bulk-reset affordance.
          // (Originally the master toggle existed as a workaround for sideways
          // uploads; now that intrinsic orientation is auto-applied at upload,
          // this is its real job.)
          function clearAllAssetRotations() {
            var Lib = window.Library;
            if (!Lib || !Array.isArray(Lib.items) || !Lib.items.length) return 0;
            var n = 0;
            for (var i = 0; i < Lib.items.length; i++) {
              var it = Lib.items[i];
              if (!it || !it.rotation) continue;
              it.rotation = 0;
              it.thumb = null;        // forces _buildThumb to redraw
              if (it._rotated) it._rotated = null;
              it.rotationUserSet = false;
              n += 1;
            }
            // Rebuild every thumb so the badge disappears and the artwork refreshes.
            if (typeof Lib.render === 'function') Lib.render();
            for (var j = 0; j < Lib.items.length; j++) {
              try { Lib._buildThumb(Lib.items[j]); } catch (_) {}
            }
            // Persist each cleared asset to IDB.
            if (typeof Lib._save === 'function') {
              for (var k = 0; k < Lib.items.length; k++) {
                try { Lib._save(Lib.items[k]); } catch (_) {}
              }
            }
            return n;
          }
          function flashMasterHint(msg) {
            // Mirror the help-button hint styling for a short toast without
            // dragging in a new module. Tooltip-only by default (cheap, non-modal).
            try { btn.title = msg; } catch (_) {}
            if (typeof window.setStatus === 'function') window.setStatus(msg, 'ok');
          }
          btn.addEventListener('click', function (e) {
            // Shift+click (or middle-click) = bulk-clear asset rotations.
            // Plain click = toggle audio rotation on/off as before.
            if (e.shiftKey || e.button === 1 || e.metaKey || e.ctrlKey) {
              e.preventDefault();
              e.stopPropagation();
              var cleared = clearAllAssetRotations();
              flashMasterHint('cleared ' + cleared + ' asset rotation' + (cleared === 1 ? '' : 's'));
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            window.SWR_ROT_MASTER.enabled = !window.SWR_ROT_MASTER.enabled;
            saveMasterEnabled(window.SWR_ROT_MASTER.enabled);
            applyMasterToLayers();
            paintMasterButton(btn);
            // Re-paint in case any panel observer is listening
            try { document.dispatchEvent(new CustomEvent('swr-rot-master-change', { detail: { enabled: window.SWR_ROT_MASTER.enabled } })); } catch (_) {}
          });
          btn.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            var cleared = clearAllAssetRotations();
            flashMasterHint('cleared ' + cleared + ' asset rotation' + (cleared === 1 ? '' : 's') + ' (right-click)');
          });
      return true;
    }
    if (!bindRotMasterButton()) {
      window.setTimeout(function () { bindRotMasterButton(); }, 250);
    }

    // Wrap window.Layers.add so every newly created layer inherits the
    // current master value. Patches the prototype-style: the function is
    // replaced with a wrapper that calls the original then forces the
    // field. Idempotent — only wraps once.
    (function wrapLayersAdd() {
      var L = window.Layers;
      if (!L || typeof L.add !== 'function' || L.add.__swrRotMasterWrapped) return;
      var orig = L.add.bind(L);
      var wrapped = function (asset) {
        var ret = orig(asset);
        try {
          var last = L.list && L.list[L.list.length - 1];
          if (last) last.rotationEnabled = window.SWR_ROT_MASTER.enabled;
          if (typeof L.render === 'function') L.render();
        } catch (_) {}
        return ret;
      };
      wrapped.__swrRotMasterWrapped = true;
      L.add = wrapped;
    })();

    // Apply master state to whatever layers already exist on first load.
    applyMasterToLayers();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
