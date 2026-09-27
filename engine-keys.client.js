// engine-keys.client.js — centralized keyboard navigation for the SWR engine.
//
// One document-level keydown handler that dispatches to a small set of
// well-known actions (transport, panel toggles, layer selection, auto-map
// cycling, GENOPS remap/randomize). The handler is no-op when the active
// element is a form field (input/select/textarea/contentEditable) so the user
// can type values into panel sliders without triggering shortcuts.
//
// Every keypress also dispatches a `swr-keys-press` CustomEvent with
// detail = { key, code, mods, action } so the existing scripts (or future
// ones) can react without re-registering their own listeners.
//
// ---- page-scoped keymap ----
//
// This module is shared by 16 pages that do not carry the same subsystems, so
// an action declares what it needs (`requires`) and, optionally, an element it
// needs (`panel`); the binder and the help table both consult actionAllowed().
// A page therefore never binds or advertises a key it cannot honour. The
// headline case is engine.html, which loads no GENOPS module and has no
// AUTO-SWAP panel, so this whole family drops out there:
//
//   GENOPS family (requires: 'genops')  R-remap · N · Shift+N · Cmd+Z ·
//                                       Cmd+Shift+Z · Cmd+Enter
//   Shift+A / A   (requires: 'automap')
//   Shift+M       (panel: 'ls-panel-swap' — no page builds it)
//   Alt+1..6      (requires: 'layerRemap' — Layers.autoMapLayer is absent)
//   Shift+1..9    (requires: 'story')
//   Cmd+1..9      (requires: 'presets' — versions-presets.js is variant-only)
//   L / D         (requires: 'engineAffordance' — #add-layer / #drag-mode)
//
// On the 15 versions/*.html pages every one of those stays live.
//
// Public API on window.SWR_KEYS:
//   .help()            — the keymap for THIS page, as {keys, label} rows
//                        (used by the help overlay and the test script)
//   .setEnabled(bool)  — disable / re-enable the global handler
//   .isEnabled()       — current state
//   .simulate(key)     — programmatically fire a keydown for tests + macros
//
// Keymap (mod = shift / alt / ctrl as appropriate; * = page-gated, see above):
//
//   Space              play / pause           (Audio.play or Audio.pause)
//   M                  toggle mute            (gain → 0, transport keeps going)
//   R *                remap (GENOPS), or on engine.html: rotate the
//                        selected clip 90° and fall back to RE-MAP when
//                        nothing is selected
//   N / Shift+N *      randomize / mutate     (SWR_GENOPS)
//   A / Shift+A *      re-randomize auto-map (this engine) / next recipe
//   Shift+M *          toggle AUTO-SWAP panel (no page builds that panel)
//   Shift+T            toggle TIMING panel
//   Shift+L / L *      toggle LFOs panel / add a layer (engine.html)
//   D *                toggle AUTO DRIFT / manual drag
//   Esc                close the help overlay
//   ↑ / ↓              select prev / next layer
//   1..9               select layer by index  (1-based; 0 = deselect)
//   Alt+1..6 *         per-layer remap (swap one slot, others stay)
//   Shift+1..9 *       advance story chapters (FRAGMENTS / SIGNAL / …)
//   Cmd+1..9 *         legacy FX palette preset (PULSE / NEON / …)
//                        Applies a known FX configuration (temp, vignette,
//                        glow, …) to the running engine. The page stays put;
//                        only the look changes.
//   + / -              bump fadeInMs / fadeOutMs by 100ms for selected layer
//   Shift+R            force auto-swap now    (LayerScheduler.swapNow)
//   V                  mirror axis: vertical → horizontal → off
//                        (SWR_NATURAL.cycleMirror; 'off' skips both ghost
//                        passes — the cheapest manual perf rung)
//   Shift+V            mirror axis: vertical (left/right reflection)
//   B                  bloom layers            (SWR_TIMING.staggeredFadeIn)
//   X                  crossfade all layers    (SWR_TIMING.crossfade)
//   Cmd+S / Cmd+O      save / open project     (SWR_SETTINGS bridge)
//   Cmd+R              start / stop recording  (#rec)
//   ?                  show keymap help overlay
//
// Notes:
// - engine.html used to run a second, page-level keydown listener for
//   Space / R / L / D. It has been removed: this module is now the single
//   owner of every shortcut. R keeps its engine-specific meaning by calling
//   window.SWR_KEYS_HOST_ROTATE, which engine.html publishes from its own boot
//   (see rotateSelectedOrRemap there).
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

  // ---- page capabilities ---------------------------------------------
  //
  // This module is shared by 16 pages, but they do not carry the same
  // subsystems: engine.html loads no GENOPS module (no undo stack, no
  // remap/randomize/mutate/commit) and has no AUTO-SWAP panel, while the
  // versions/*.html pages load GENOPS and do. Binding a key whose
  // dependency is absent is what produced the dead-key report this gate
  // fixes, so each action declares what it needs and the binder + help
  // table both ask `actionAllowed()`.
  //
  // Resolved lazily rather than at parse time: this module is
  // `type="module"` while the modules it probes install their globals from
  // classic `defer` scripts (and engine.html publishes its rotate hook during
  // its own boot), so a parse-time read can be early.
  //
  // A flag that reads false is re-probed on the next call instead of being
  // latched, so a dependency that lands late is still picked up; once true it
  // is never re-read. On engine.html `genops` stays false forever, which costs
  // one global read per keystroke — cheaper and far more robust than latching a
  // negative and silently disabling a key for the whole session.
  const hostFlags = {
    genops: function () { return !!window.SWR_GENOPS; },
    // The recipe store lives on SWR_AUTOMAP (`_recipes`); there is no
    // `SWR.RECIPES`. Both the picker and Shift+A need it.
    automap: function () {
      return !!(window.SWR_AUTOMAP && typeof window.SWR_AUTOMAP.list === 'function');
    },
    settings: function () {
      return !!(window.SWR_SETTINGS && typeof window.SWR_SETTINGS.togglePanel === 'function');
    },
    engineRotate: function () { return typeof window.SWR_KEYS_HOST_ROTATE === 'function'; },
    // Engine-only affordances: #add-layer / #drag-mode exist on engine.html
    // alone, and these actions simply click those buttons.
    engineAffordance: function () { return !!document.getElementById('add-layer'); },
    // Story runtime (Shift+1..9) — engine.html only.
    story: function () {
      const S = window.SWR && window.SWR.Story;
      return !!(S && Array.isArray(S.ORDER) && typeof S.enter === 'function');
    },
    // Per-slot remap (Alt+1..6). `Layers.autoMapLayer` is defined by
    // engine-core.client.js, which none of these pages load — they use the
    // page-local window.Layers — so this is false everywhere today and the
    // row is correctly suppressed rather than advertised as a dead key.
    layerRemap: function () {
      const L = window.Layers;
      return !!(L && typeof L.autoMapLayer === 'function');
    },
    // Cmd/Ctrl+1..9 FX-palette presets. versions-presets.js is loaded on
    // every versions/*.html page but not on engine.html.
    presets: function () {
      const VP = window.VersionsPresets;
      return !!(VP && Array.isArray(VP.SHORTCUT_PRESETS));
    },
    // The layer MODEL is not the same on both page families. The variants'
    // inline Layers creates layers carrying `alpha` and `mutate`
    // (versions/*.html: `alpha: 1, mutate: 0`); lib/layers.client.js
    // (engine.html) creates {blend, opacity, baseScale, hue, brightness,
    // contrast, …} with no alpha and no mutate. nudgeLayer() bails when the
    // field is not a number, so those keys were inert on engine while the
    // help table still advertised them.
    //
    // Probe a live layer when one exists; otherwise fall back to the model
    // marker — `sel` is the variant model's selection property and
    // `selected` is engine's (see selectedOf below).
    layerAlpha: function () { return layerHasField('alpha'); },
    layerMutate: function () { return layerHasField('mutate'); },
  };

  function layerHasField(field) {
    const L = window.Layers || (window.SWR && window.SWR.Layers);
    if (!L) return false;
    if (Array.isArray(L.list) && L.list.length && L.list[0]) {
      return typeof L.list[0][field] === 'number';
    }
    return ('sel' in L) && !('selected' in L);
  }
  const host = {
    genops: false, automap: false, settings: false, engineRotate: false,
    engineAffordance: false, story: false, layerRemap: false, presets: false,
    layerAlpha: false, layerMutate: false,
  };
  function getHost() {
    for (const k in hostFlags) {
      if (!host[k]) host[k] = hostFlags[k]();
    }
    return host;
  }

  // True when the action's dependencies exist on this page. Actions without
  // a `requires` key are always allowed. `panel` additionally requires a
  // specific element, since a page can carry the settings module without
  // carrying every panel it knows how to toggle.
  function actionAllowed(a) {
    if (!a) return false;
    if (a.requires && !getHost()[a.requires]) return false;
    if (a.panel && !document.getElementById(a.panel)) return false;
    return true;
  }

  const ACTIONS = {
    play: {
      keys: 'Space',
      label: 'Play / pause',
      action: function () {
        const A = window.SWR && window.SWR.Audio;
        // The loaded element lives on `audioEl` (lib/audio.client.js); the
        // older `el` / `_el` names are kept as fallbacks for pages that
        // predate the rename. Reading only `el` made this action inert on
        // engine.html, whose Audio exposes `audioEl` alone.
        if (!A || !(A.el || A._el || A.audioEl)) return;
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
      requires: 'genops',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.remap === 'function') G.remap();
      },
    },
    randomize: {
      keys: 'N',
      label: 'Randomize (GENOPS) — full re-roll of the patch',
      requires: 'genops',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.randomize === 'function') G.randomize();
      },
    },
    mutate: {
      keys: 'Shift+N',
      label: 'Mutate (GENOPS) — small perturbation (smaller than randomize)',
      requires: 'genops',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.mutate === 'function') G.mutate();
      },
    },
    // Engine-only: rotate the selected clip's sticky tilt (R on engine,
    // where the GENOPS remap family does not exist). Falls through to
    // RE-MAP when nothing is selected — see SWR_KEYS_HOST_ROTATE.
    rotateClip: {
      keys: 'R',
      label: 'Rotate selected clip 90° (no selection → RE-MAP)',
      requires: 'engineRotate',
      action: function () {
        try { window.SWR_KEYS_HOST_ROTATE(); } catch (_) {}
      },
    },
    // Engine-only affordances: these two keys click buttons that exist on
    // engine.html alone (#add-layer, #drag-mode).
    addLayer: {
      keys: 'L',
      label: 'Add a layer',
      requires: 'engineAffordance',
      action: function () {
        const btn = document.getElementById('add-layer');
        if (btn) btn.click();
      },
    },
    toggleDragMode: {
      keys: 'D',
      label: 'Toggle AUTO DRIFT / manual drag',
      requires: 'engineAffordance',
      action: function () {
        const btn = document.getElementById('drag-mode');
        if (btn) btn.click();
      },
    },
    toggleAutoSwap: {
      keys: 'Shift+M',
      label: 'Toggle AUTO-SWAP panel',
      requires: 'settings',
      // No page builds #ls-panel-swap — the AUTO-SWAP behaviour lives in
      // #layer-scheduler-panel (a deliberately hidden dev panel). Gating on
      // the element keeps this row out of the help table everywhere rather
      // than advertising a key that cannot do anything.
      panel: 'ls-panel-swap',
      action: function () {
        window.SWR_SETTINGS.togglePanel('ls-panel-swap');
      },
    },
    toggleTiming: {
      keys: 'Shift+T',
      label: 'Toggle TIMING panel',
      requires: 'settings',
      panel: 'ls-panel-timing',
      action: function () {
        window.SWR_SETTINGS.togglePanel('ls-panel-timing');
      },
    },
    toggleLfOs: {
      keys: 'Shift+L',
      label: 'Toggle LFOs panel',
      requires: 'settings',
      panel: 'ls-panel-lfo',
      action: function () {
        window.SWR_SETTINGS.togglePanel('ls-panel-lfo');
      },
    },
    // "S" previously opened the gear menu, which has been removed: the
    // module is now UI-free (see engine-settings.client.js). Esc keeps
    // closing the help overlay.
    closeSettings: {
      keys: 'Esc',
      label: 'Close help overlay',
      action: function () {
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
      requires: 'automap',
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
      requires: 'automap',
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
    // ---- mirror axis (rotkey) ------------------------------------------
    // One key, three states: vertical-axis mirror → horizontal-axis mirror
    // → off. The off state is a real frame-time saving (both ghost passes
    // are skipped), so this doubles as the cheapest manual perf rung.
    cycleMirror: {
      keys: 'V',
      label: 'Mirror axis: vertical → horizontal → off',
      action: function () {
        const N = window.SWR_NATURAL;
        if (!N || typeof N.cycleMirror !== 'function') return;
        const mode = N.cycleMirror();
        if (window.setStatus) window.setStatus('mirror: ' + mode, 'ok');
      },
    },
    mirrorVertical: {
      keys: 'Shift+V',
      label: 'Mirror axis: vertical (left/right reflection)',
      action: function () {
        const N = window.SWR_NATURAL;
        if (!N || typeof N.setMirror !== 'function') return;
        N.setMirror('vertical');
        if (window.setStatus) window.setStatus('mirror: vertical', 'ok');
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
      requires: 'genops',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.undo === 'function') G.undo();
      },
    },
    redo: {
      keys: 'Cmd+Shift+Z',
      label: 'Redo last undone op (Cmd/Ctrl+Shift+Z)',
      requires: 'genops',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.redo === 'function') G.redo();
      },
    },
    commit: {
      keys: 'Cmd+Enter',
      label: 'Commit current GENOPS state to history',
      requires: 'genops',
      action: function () {
        const G = window.SWR_GENOPS;
        if (G && typeof G.commit === 'function') G.commit();
      },
    },
    saveProject: {
      keys: 'Cmd+S',
      label: 'Save project (.swr-project download)',
      action: function () {
        // engine.html exposes window.Project, versions/*.html exposes
        // window.SWR_PROJECT; SWR_SETTINGS bridges both.
        if (window.SWR_SETTINGS) { window.SWR_SETTINGS.saveProject(); return; }
        if (window.SWR_PROJECT && typeof window.SWR_PROJECT.save === 'function') {
          try { window.SWR_PROJECT.save(); } catch (_) {}
        }
      },
    },
    openProject: {
      keys: 'Cmd+O',
      label: 'Open project (.swr-project file picker)',
      action: function () {
        if (window.SWR_SETTINGS) { window.SWR_SETTINGS.openProject(); return; }
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
      // The binding is '=' (see the Equal case in handle()); Shift+/ is the
      // '?' help key. The old 'Shift+/' value was never a binding.
      keys: '=',
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
    const sel = selectedOf(L);
    if (!sel) return;
    const ev = window.__swrLastKeydown;
    const shift = ev && ev.shiftKey;
    const step = delta * (shift ? 4 : 1);
    const before = sel[field];
    if (typeof before !== 'number') return;
    const after = Math.max(lo, Math.min(hi, before + step));
    sel[field] = after;
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) {
      window.setStatus(field + ': ' + before.toFixed(2) + ' → ' + after.toFixed(2), 'ok');
    }
  }

  function action_nudgeOpacityUp() {
    // Bound to '=' — Photoshop-style opacity nudge up
    const L = layers();
    const sel = selectedOf(L);
    if (!sel) return;
    const before = sel.opacity;
    const after = Math.max(0, Math.min(1, before + 0.05));
    sel.opacity = after;
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) window.setStatus('opacity: ' + before.toFixed(2) + ' → ' + after.toFixed(2), 'ok');
  }
  function action_nudgeOpacityDown() {
    const L = layers();
    const sel = selectedOf(L);
    if (!sel) return;
    const before = sel.opacity;
    const after = Math.max(0, Math.min(1, before - 0.05));
    sel.opacity = after;
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) window.setStatus('opacity: ' + before.toFixed(2) + ' → ' + after.toFixed(2), 'ok');
  }

  function cycleBlend() {
    const L = layers();
    const sel = selectedOf(L);
    if (!sel) return;
    const BLENDS = ['source-over','screen','lighter','multiply','overlay','difference','soft-light','lighten','darken'];
    const cur = sel.blend || 'source-over';
    const i = BLENDS.indexOf(cur);
    sel.blend = BLENDS[(i + 1) % BLENDS.length];
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) window.setStatus('blend: ' + sel.blend, 'ok');
  }

  function duplicateLayer() {
    const L = layers();
    const src = selectedOf(L);
    if (!src || !L.list) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = 'L' + (Date.now() % 100000);
    copy.asset = src.asset;
    const idx = L.list.indexOf(src);
    L.list.splice(idx + 1, 0, copy);
    selectLayer(L, copy);
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) window.setStatus('layer duplicated', 'ok');
  }

  function deleteSelectedLayer() {
    const L = layers();
    const sel = selectedOf(L);
    if (!sel || !L.list || !L.list.length) return;
    if (L.list.length <= 1) {
      if (window.setStatus) window.setStatus('cannot delete last layer', 'err');
      return;
    }
    const id = sel.id;
    L.list = L.list.filter(function (l) { return l.id !== id; });
    selectLayer(L, L.list[0] || null);
    if (typeof L.render === 'function') L.render();
    if (window.setStatus) window.setStatus('layer removed', 'ok');
  }

  // ---- helpers --------------------------------------------------------

  function layers() { return window.SWR && window.SWR.Layers; }
  function audio()  { return window.SWR && window.SWR.Audio; }

  // Layer selection is NOT uniform across the two page families that share
  // this keymap:
  //   - lib/layers.client.js (engine.html): the property is `selected`, and
  //     the object exposes select(layer), which also repaints the layer card
  //     and enables/disables the ↻ ROT button.
  //   - the variants' Layers: the property is `sel`, and there is no select().
  //
  // Reading and writing only `sel` made the entire per-layer half of this
  // keymap inert on engine.html — 1..9 / ↑ / ↓ / 0 selection, every nudge, C,
  // Y and Del all operated on a property the page never reads. Verified live:
  // after pressing "2", `sel` held the layer while `selected` stayed null, so
  // nothing was visually selected and R fell through to RE-MAP. Always go
  // through the page's own selection.
  function selectedOf(L) {
    if (!L) return null;
    return (('selected' in L) ? L.selected : L.sel) || null;
  }
  function selectLayer(L, layer) {
    if (!L) return;
    if (typeof L.select === 'function') { L.select(layer); return; }   // repaints too
    L.sel = layer;
    if (typeof L.render === 'function') L.render();
  }

  function cycleLayer(dir) {
    const L = layers();
    if (!L || !L.list || !L.list.length) return;
    let idx = L.list.indexOf(selectedOf(L));
    if (idx < 0) idx = dir > 0 ? -1 : L.list.length;
    idx = (idx + dir + L.list.length) % L.list.length;
    selectLayer(L, L.list[idx]);
    if (typeof L.render === 'function') L.render();
    if (typeof window.setStatus === 'function') {
      window.setStatus('layer: ' + (L.list[idx].id || ('#' + idx)) + ' (' + (idx + 1) + '/' + L.list.length + ')', 'ok');
    }
  }

  function bumpFade(delta, field) {
    const L = layers();
    const T = window.SWR_TIMING;
    const layer = selectedOf(L);
    if (!layer || !T) return;
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
    // ---- Shortcut honesty: page-aware rows --------------------------
    //
    // music_video.html also loads client/hologram-keys.client.js,
    // which installs in the CAPTURE phase and stopPropagation()s the
    // keys it handles — so on that page "0" resets the hologram, it
    // does NOT deselect the layer, and ←/→ + h belong to the
    // hologram panel. When that module is present, relabel the rows
    // it actually swallows and append its own keys, so the ? overlay
    // matches live behavior instead of the engine.html default.
    // engine.html never loads hologram-keys, so it is unaffected.
    let helpRows = help();
    const holoKeys = window.SWR_HOLOGRAM_KEYS;
    if (holoKeys && Array.isArray(holoKeys.HELP)) {
      helpRows = helpRows.filter(function (r) { return r.keys !== '0'; });
      helpRows = helpRows.concat(holoKeys.HELP);
    }
    const rows = helpRows.map(function (r) {
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
      // Cmd/Ctrl+1..9 — legacy FX palette presets
      // (VersionsPresets.SHORTCUT_PRESETS). Keyed off `code` so it works on
      // every layout, since Shift+DigitN yields a shifted glyph in `key`.
      if (!action && !ev.shiftKey && /^Digit[1-9]$/.test(code || '')) {
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
    }

    // ---- main keydown handler (no Ctrl/Meta) ----
    if (!action && !cmd && !ev.altKey) {
      switch (code) {
        case 'Space':           action = ACTIONS.play; break;
        // R is contextual: on GENOPS pages it belongs to the remap family;
        // on engine.html (no GENOPS module) it rotates the selected clip and
        // falls back to RE-MAP when nothing is selected. Exactly one of the
        // two owners is ever allowed by actionAllowed().
        case 'KeyR':            action = getHost().genops
                                  ? (ev.shiftKey ? ACTIONS.forceSwap : ACTIONS.remap)
                                  : ACTIONS.rotateClip; break;
        case 'KeyN':            action = ev.shiftKey ? ACTIONS.mutate : ACTIONS.randomize; break;
        case 'KeyA':            action = ev.shiftKey ? ACTIONS.cycleNextRecipe : ACTIONS.cycleAutoMap; break;
        case 'KeyM':            action = ev.shiftKey ? ACTIONS.toggleAutoSwap : ACTIONS.mute; break;
        case 'KeyT':            action = ev.shiftKey ? ACTIONS.toggleTiming : null; break;
        case 'KeyL':            action = ev.shiftKey ? ACTIONS.toggleLfOs : ACTIONS.addLayer; break;
        case 'KeyD':            action = ACTIONS.toggleDragMode; break;
        case 'KeyB':            action = ACTIONS.bloom; break;
        case 'KeyX':            action = ACTIONS.crossfade; break;
        // "S" is deliberately unbound: it used to open the gear menu, which
        // no longer exists (engine-settings.client.js is UI-free now).
        case 'KeyC':            action = ACTIONS.cycleBlend; break;
        case 'KeyY':            action = ACTIONS.duplicateLayer; break;
        case 'KeyV':            action = ev.shiftKey ? ACTIONS.mirrorVertical : ACTIONS.cycleMirror; break;
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
        // '?' must be claimed INSIDE the switch, before the bare-Slash
        // case: on US layouts Shift+/ sends code 'Slash', and a plain
        // `case 'Slash': break` would swallow it — the post-switch
        // `if (!action && key === '?')` fallback below could then never
        // fire, making the help overlay unopenable by keyboard. (This
        // is exactly that bug, fixed 2026-09-14.)
        case 'Slash':
          action = (key === '?' || ev.shiftKey) ? ACTIONS.showHelp : ACTIONS.nudgeOpacityDown; break;
        case 'Delete':
        case 'Backspace':       action = ACTIONS.deleteLayer; break;
        case 'Escape':          action = ACTIONS.closeSettings; break;
      }
      // ? key as a literal (some keyboards send Slash with shift)
      if (!action && (key === '?' || (ev.shiftKey && code === 'Slash'))) {
        action = ACTIONS.showHelp;
      }
      // 1..9 to select layer 0..8. The Cmd/Ctrl/Alt guards matter because
      // this block keys off `key` alone: without them it would also fire on
      // the Cmd+1..9 palette and Alt+1..6 remap combos and strand them.
      if (!action && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey && /^[1-9]$/.test(key)) {
        const L = layers();
        if (L && L.list && L.list.length) {
          const idx = parseInt(key, 10) - 1;
          if (idx < L.list.length) {
            selectLayer(L, L.list[idx]);
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
      // (Fragments, Signal, Pursuit, Fracture, Overload, Afterimage,
      // Memory, Loop). This is the performer's "director override" —
      // always wins regardless of mode (manual / guided / auto /
      // generative). The legacy FX-palette shortcut map moved to
      // Cmd/Ctrl+1..9 below.
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
      // Alt+1..6 — per-layer remap (Phase 3 / H4). Re-maps just the
      // selected layer slot, leaving the other 5 layers alone. The
      // cross-fade swap machinery (set up in Phase 2) handles the visual
      // transition: the old asset at that slot fades out, the new
      // selection fades in. Shift+1..9 is taken for story chapters,
      // Cmd/Ctrl+1..9 is taken for FX palette presets; Alt+1..6 was
      // the cleanest unallocated key. Restricted to 1..6 because the
      // engine has 6 layers (rarely 0..5 in user-facing terms).
      if (!action && ev.altKey && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && /^Digit[1-6]$/.test(code || '')) {
        const slot = parseInt(code.replace('Digit', ''), 10) - 1;
        const L = window.Layers;
        if (L && typeof L.autoMapLayer === 'function') {
          L.autoMapLayer(slot);
          if (typeof window.setStatus === 'function') {
            window.setStatus('remap layer ' + (slot + 1), 'ok');
          }
          try { window.dispatchEvent(new CustomEvent('swr-keys-press', {
            detail: { key, code, mods: { alt: true }, action: 'remap-layer-' + (slot + 1) }
          })); } catch (_) {}
          if (ev.preventDefault) ev.preventDefault();
          return;
        }
      }
      // NOTE: the Cmd/Ctrl+1..9 FX-palette block used to live here. It sat
      // inside this `if (!action && !cmd && !ev.altKey)` guard while testing
      // `ev.metaKey || ev.ctrlKey`, so it could never run — its own condition
      // contradicted the guard enclosing it. It now lives in the Cmd/Ctrl
      // switch above, where it is reachable.
      if (!action && key === '0' && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        const L = layers();
        if (L) selectLayer(L, null);
        if (typeof window.setStatus === 'function') window.setStatus('layer: —', 'ok');
        try { window.dispatchEvent(new CustomEvent('swr-keys-press', {
          detail: { key, code, mods: { shift: !!ev.shiftKey }, action: 'deselect' }
        })); } catch (_) {}
        return;
      }
    }

    // Single choke point for every dispatch path. An action whose
    // dependencies are absent on this page never fires, whether it was
    // selected by a `case`, a fallback branch, or a digit block. This is
    // what keeps engine.html from advertising or running the GENOPS family
    // while the versions/*.html pages keep all of it.
    if (action && !actionAllowed(action)) action = null;

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

  // The help table. Rows carrying an `action` are filtered through
  // actionAllowed(), so a page never advertises a key it cannot honour — the
  // GENOPS family (R-remap / N / Shift+N / Cmd+Z / Cmd+Shift+Z / Cmd+Enter)
  // and the AUTO-SWAP toggle drop out on engine.html and stay on the
  // versions/*.html pages. Rows without an `action` are pure documentation
  // (key-range rows) and always show.
  function help() {
    const rows = [
      // ---- Transport ----
      { keys: 'Space',          label: 'play / pause',                 action: ACTIONS.play },
      { keys: 'M',              label: 'toggle mute',                  action: ACTIONS.mute },
      { keys: 'F',              label: 'fullscreen',                   action: ACTIONS.fullscreen },
      { keys: 'Esc',            label: 'close help overlay',           action: ACTIONS.closeSettings },

      // ---- Generation ----
      { keys: 'R',              label: 'remap (GENOPS — new assets)',  action: ACTIONS.remap },
      { keys: 'R',              label: 'rotate selected clip 90° (no selection → RE-MAP)', action: ACTIONS.rotateClip },
      { keys: 'N',              label: 'randomize (full re-roll)',     action: ACTIONS.randomize },
      { keys: 'Shift+N',        label: 'mutate (small perturbation)',  action: ACTIONS.mutate },
      { keys: 'A',              label: 're-randomize auto-map (this engine)', action: ACTIONS.cycleAutoMap },
      { keys: 'Shift+A',        label: 'cycle to next engine recipe',  action: ACTIONS.cycleNextRecipe },
      { keys: 'B',              label: 'bloom layers (stagger fade-in)', action: ACTIONS.bloom },
      { keys: 'X',              label: 'crossfade all layers (A2 swap)', action: ACTIONS.crossfade },
      { keys: 'Shift+R',        label: 'force auto-swap now',          action: ACTIONS.forceSwap },
      { keys: 'V',              label: 'mirror axis: vertical → horizontal → off', action: ACTIONS.cycleMirror },
      { keys: 'Shift+V',        label: 'mirror axis: vertical (left/right)', action: ACTIONS.mirrorVertical },

      // ---- Undo / Save ----
      { keys: 'Cmd+Z',          label: 'undo (Cmd/Ctrl+Z)',            action: ACTIONS.undo },
      { keys: 'Cmd+Shift+Z',    label: 'redo (Cmd/Ctrl+Shift+Z)',      action: ACTIONS.redo },
      { keys: 'Cmd+Enter',      label: 'commit current state to history', action: ACTIONS.commit },
      { keys: 'Cmd+S',          label: 'save project (.swr-project)',  action: ACTIONS.saveProject },
      { keys: 'Cmd+O',          label: 'open project (.swr-project picker)', action: ACTIONS.openProject },
      { keys: 'Cmd+R',          label: 'start / stop recording',       action: ACTIONS.toggleRecord },

      // ---- Layers (documentation-only rows; no single action) ----
      { keys: '↑ / ↓',          label: 'select prev / next layer' },
      { keys: '1..9',           label: 'select layer by index (1-based)' },
      { keys: '0',              label: 'deselect layer' },
      { keys: 'L',              label: 'add a layer',                  action: ACTIONS.addLayer },
      { keys: 'D',              label: 'toggle AUTO DRIFT / manual drag', action: ACTIONS.toggleDragMode },
      { keys: 'Alt+1..6',       label: 'per-layer remap (swap one slot, others stay)', requires: 'layerRemap' },

      // ---- Presets ----
      { keys: 'Shift+1..9',     label: 'story chapter (FRAGMENTS / SIGNAL / …)', requires: 'story' },
      { keys: 'Cmd+1..9',       label: 'FX palette preset (PULSE / NEON / GRID / …)', requires: 'presets' },

      // ---- Per-layer tweaks (right-hand bracket pattern) ----
      { keys: '[ / ]',          label: '− / + alpha',                    requires: 'layerAlpha' },
      { keys: ', / .',          label: '− / + hue (±6°)' },
      { keys: "; / '",          label: '− / + scale' },
      { keys: '/',              label: '− opacity' },
      { keys: '= / -',          label: '+ / − opacity  ·  Shift = bump fadeIn/fadeOut' },
      { keys: 'Shift+,',        label: '− contrast  ·  Shift = ×4 nudge' },
      { keys: 'Shift+.',        label: '+ contrast' },
      { keys: 'Shift+;',        label: '− brightness' },
      { keys: "Shift+'",        label: '+ brightness' },
      { keys: 'Shift+[',        label: '− mutate jitter',               requires: 'layerMutate' },
      { keys: 'Shift+]',        label: '+ mutate jitter',               requires: 'layerMutate' },

      // ---- Per-layer ops ----
      { keys: 'C',              label: 'cycle blend mode',             action: ACTIONS.cycleBlend },
      { keys: 'Y',              label: 'duplicate selected layer',     action: ACTIONS.duplicateLayer },
      { keys: 'Del / Bksp',     label: 'remove selected layer',        action: ACTIONS.deleteLayer },
      { keys: 'Shift+-',        label: 'bump fadeOutMs by 100ms',      action: ACTIONS.bumpFadeOut },

      // ---- Panels ----
      { keys: 'Shift+M',        label: 'toggle AUTO-SWAP panel',       action: ACTIONS.toggleAutoSwap },
      { keys: 'Shift+T',        label: 'toggle TIMING panel',          action: ACTIONS.toggleTiming },
      { keys: 'Shift+L',        label: 'toggle LFOs panel',            action: ACTIONS.toggleLfOs },

      // ---- Help ----
      { keys: '?',              label: 'show this help overlay',       action: ACTIONS.showHelp },
    ];
    return rows.filter(function (r) {
      if (r.requires && !getHost()[r.requires]) return false;
      return !r.action || actionAllowed(r.action);
    });
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

    // === 3D layer wiring (engine-3d.client.js) ===
    // Click "+ 3D" in the layer panel → opens a 4-button primitive picker.
    // Each picker click calls SWR_3D.createLayer(primitiveId) to mint a 3D
    // asset, then Layers.add(asset) to push it into the layer stack with
    // the same fadeIn / select / stageEmpty behavior as a regular library
    // asset. The renderer picks up the 3D layer next frame (SWR_3D.tickAll
    // runs in the render loop and writeImage's the WebGL canvas into the
    // engine's stage via the existing 2D drawImage path).
    (function wire3DLayer() {
      function add3DLayer(primitiveId) {
        if (!window.SWR_3D || typeof window.SWR_3D.createLayer !== 'function') {
          if (typeof window.setStatus === 'function') {
            window.setStatus('engine-3d.client.js not loaded', 'err');
          }
          return;
        }
        var L = window.Layers;
        if (!L || typeof L.add !== 'function') return;
        var asset = window.SWR_3D.createLayer(primitiveId);
        // The 3D asset is shaped exactly like a regular image asset
        // (type, name, w, h, get _el) so Layers.add's existing logic
        // works without modification.
        L.add(asset);
        if (typeof window.setStatus === 'function') {
          window.setStatus('3D layer: ' + primitiveId + ' (3D primitive, ' + asset.w + '\u00d7' + asset.h + ')', 'ok');
        }
      }
      // Toggle the picker when "+ 3D" is clicked.
      var add3dBtn = document.getElementById('add-3d');
      var picker = document.getElementById('3d-picker');
      if (add3dBtn && picker) {
        add3dBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          picker.classList.toggle('hidden');
        });
        // Each primitive button: add a layer + close the picker.
        picker.querySelectorAll('[data-3d]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            add3DLayer(btn.getAttribute('data-3d'));
            picker.classList.add('hidden');
          });
        });
        // Click outside the picker to close it.
        document.addEventListener('click', function (e) {
          if (picker.classList.contains('hidden')) return;
          if (e.target === add3dBtn) return;
          if (picker.contains(e.target)) return;
          picker.classList.add('hidden');
        });
      }
    })();

    // Apply master state to whatever layers already exist on first load.
    applyMasterToLayers();

    // Master transformations toggle: a sibling icon button placed directly
    // before the rot-master button. When OFF, applyR() in every version page
    // skips the entire reactor loop and returns the layer's static
    // baseScale/opacity/hue/etc — layers render at rest even while audio
    // plays. Per-layer override: l.reactorsEnabled = true re-enables
    // reactors for that layer even when the master is OFF. State persists
    // in localStorage under 'swr.txMaster.enabled'.
    var TX_MASTER_KEY = 'swr.txMaster.enabled';
    function loadTxMasterEnabled() {
      try {
        var v = localStorage.getItem(TX_MASTER_KEY);
        return v === null ? true : v === '1';
      } catch (_) { return true; }
    }
    function saveTxMasterEnabled(v) {
      try { localStorage.setItem(TX_MASTER_KEY, v ? '1' : '0'); } catch (_) {}
    }
    window.SWR_TX_MASTER = { enabled: loadTxMasterEnabled() };
    function applyTxMasterToLayers() {
      var L = window.Layers;
      if (!L || !Array.isArray(L.list) || !L.list.length) return 0;
      var count = 0;
      for (var i = 0; i < L.list.length; i++) {
        var lay = L.list[i];
        if (!lay) continue;
        lay.reactorsEnabled = window.SWR_TX_MASTER.enabled;
        count += 1;
      }
      if (typeof L.render === 'function') L.render();
      return count;
    }
    function paintTxMasterButton(btn) {
      if (!btn) return;
      if (window.SWR_TX_MASTER.enabled) {
        btn.textContent = '⏸';
        btn.style.opacity = '1';
        btn.title = 'Master transformations: ON · click = mute all audio reactors';
        btn.dataset.on = '1';
      } else {
        btn.textContent = '▶';
        btn.style.opacity = '0.45';
        btn.title = 'Master transformations: OFF · click = unmute audio reactors';
        btn.dataset.on = '0';
      }
    }
    function bindTxMasterButton() {
      var rotBtn = document.getElementById('swr-rot-master');
      var anchor = rotBtn || document.getElementById('swr-keys-help-btn');
      if (!anchor || !anchor.parentNode) return false;
      var existing = document.getElementById('swr-tx-master');
      var btn;
      if (existing) {
        btn = existing;
      } else {
        btn = document.createElement('button');
        btn.id = 'swr-tx-master';
        btn.className = (anchor.className || 'tbtn') + ' swr-tx-master';
        btn.type = 'button';
        btn.style.cssText = (anchor.getAttribute('style') || '') + 'font-weight:700;';
        anchor.parentNode.insertBefore(btn, anchor);
      }
      paintTxMasterButton(btn);
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.SWR_TX_MASTER.enabled = !window.SWR_TX_MASTER.enabled;
        saveTxMasterEnabled(window.SWR_TX_MASTER.enabled);
        applyTxMasterToLayers();
        paintTxMasterButton(btn);
        try { document.dispatchEvent(new CustomEvent('swr-tx-master-change', { detail: { enabled: window.SWR_TX_MASTER.enabled } })); } catch (_) {}
      });
      return true;
    }
    var _txRetry = 0;
    function _txTry() {
      if (bindTxMasterButton()) return;
      if (_txRetry++ < 6) window.setTimeout(_txTry, 250);
    }
    _txTry();

    (function ensureTxMasterStyle() {
      try {
        if (document.getElementById('swr-tx-master-style')) return;
        var s = document.createElement('style');
        s.id = 'swr-tx-master-style';
        s.textContent = '.swr-tx-master{font-weight:700;line-height:1;display:inline-flex;align-items:center;justify-content:center;} .swr-tx-master:hover{filter:brightness(1.2);} .swr-tx-master[disabled]{opacity:.4;cursor:not-allowed;}';
        (document.head || document.documentElement).appendChild(s);
      } catch (_) {}
    })();

    // Mirror the rot-master's new-layer inheritance: each new layer created
    // via Layers.add inherits the master's enabled state. Patches the
    // function in place (rot-master already wraps it the same way for
    // rotationEnabled; we extend the wrap to set both fields).
    (function wrapLayersAddForTx() {
      var L = window.Layers;
      if (!L || typeof L.add !== 'function' || L.add.__swrTxMasterWrapped) return;
      var orig = L.add.bind(L);
      var wrapped = function (asset) {
        var ret = orig(asset);
        try {
          var last = L.list && L.list[L.list.length - 1];
          if (last) last.reactorsEnabled = window.SWR_TX_MASTER.enabled;
          if (typeof L.render === 'function') L.render();
        } catch (_) {}
        return ret;
      };
      wrapped.__swrTxMasterWrapped = true;
      L.add = wrapped;
    })();

    // Apply master state to whatever layers already exist on first load.
    applyTxMasterToLayers();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
