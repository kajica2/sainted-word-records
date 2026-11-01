// client/neon-demo-panel.client.js — collapsible Demo panel for /versions/neon.
// Buttons/toggles mirror engine-keys + VersionsPresets without requiring keyboard shortcuts.

(function () {
  'use strict';
  if (window.SWR_NEON_DEMO) return;

  var BLENDS = ['source-over', 'screen', 'lighter', 'multiply', 'overlay', 'difference', 'soft-light'];
  var REACTOR_PRESETS = [
    [{ feature: 'bass', target: 'scale', scale: 0.7, ease: 'sharp' }, { feature: 'beat', target: 'opacity', scale: 0.6, ease: 'sharp' }],
    [{ feature: 'mid', target: 'hue', scale: 200, ease: 'smooth' }, { feature: 'rms', target: 'scale', scale: 0.4, ease: 'soft' }],
    [{ feature: 'treble', target: 'rot', scale: 3, ease: 'smooth' }, { feature: 'air', target: 'y', scale: 80, ease: 'smooth' }],
    [{ feature: 'rms', target: 'scale', scale: 0.8, ease: 'soft' }, { feature: 'onset', target: 'brightness', scale: 0.8, ease: 'sharp' }],
    [{ feature: 'centroid', target: 'hue', scale: 300, ease: 'smooth' }, { feature: 'treble', target: 'scale', scale: 0.5, ease: 'soft' }],
    [{ feature: 'bass', target: 'scale', scale: 1.0, ease: 'sharp' }, { feature: 'beat', target: 'opacity', scale: 0.9, ease: 'sharp' }],
  ];

  var state = {
    mounted: false,
    collapsed: true,
    activePreset: null,
    activeFilter: null,
    demoAllTimer: null,
    demoBeatRaf: null,
    lastBeatPulse: 0,
    reactorIdx: 0,
    root: null,
  };

  function mk(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function motionKill() {
    return window.SWR_MOTION_KILL || null;
  }

  function isRotationOff() {
    var MK = motionKill();
    return MK && typeof MK.isRotationGloballyEnabled === 'function' && !MK.isRotationGloballyEnabled();
  }

  function isZoomOff() {
    var MK = motionKill();
    return MK && typeof MK.isZoomGloballyEnabled === 'function' && !MK.isZoomGloballyEnabled();
  }

  function isDistortionFxOff() {
    var MK = motionKill();
    return MK && MK.IMAGE_CLARITY_ENABLED === true;
  }

  function layers() {
    return window.Layers || null;
  }

  function selectedLayer() {
    var L = layers();
    if (!L) return null;
    return L.sel || L.selected || null;
  }

  function listShortcutPresets() {
    var VP = window.VersionsPresets;
    if (VP && Array.isArray(VP.SHORTCUT_PRESETS)) return VP.SHORTCUT_PRESETS.slice();
    return ['pulse', 'neon', 'grid', 'eclipse', 'smoke', 'aurora', 'film', 'glitch', 'void'];
  }

  function listGradePresets() {
    var table = window.__SWR_PRESETS;
    if (!table || typeof table !== 'object') return [];
    var exclude = new Set(['gallery', 'mtv']);
    return Object.keys(table).filter(function (k) { return !exclude.has(k); }).sort();
  }

  function presetLabel(id) {
    var VP = window.VersionsPresets;
    if (VP && VP.PRESETS && VP.PRESETS[id] && VP.PRESETS[id].label) return VP.PRESETS[id].label;
    return String(id).toUpperCase();
  }

  function applyShortcutPreset(pageKey) {
    var VP = window.VersionsPresets;
    if (!VP || !pageKey) return false;
    if (VP.setPresetOverride) VP.setPresetOverride(pageKey);
    var ok = VP.applyPreset && VP.applyPreset(pageKey);
    if (ok === false) return false;
    window.__swrCurrentPreset = pageKey;
    if (window.SWR_PRESET_PICK && typeof window.SWR_PRESET_PICK.save === 'function') {
      window.SWR_PRESET_PICK.save(pageKey);
    }
    if (window.SWR && window.SWR.Gradient && typeof window.SWR.Gradient.setAutomixAnchor === 'function') {
      window.SWR.Gradient.setAutomixAnchor(pageKey);
    }
    state.activePreset = pageKey;
    paintPresetButtons();
    return true;
  }

  function applyGradePreset(id) {
    if (window.SWR_LOOKS && typeof window.SWR_LOOKS.apply === 'function') {
      if (window.SWR_LOOKS.apply('grade:' + id)) {
        state.activePreset = id;
        paintPresetButtons();
        return true;
      }
    }
    var table = window.__SWR_PRESETS;
    if (!table || !table[id] || !window.FX || typeof window.FX.setPersona !== 'function') return false;
    window.FX.setPersona(table[id]);
    window.__swrCurrentPreset = id;
    state.activePreset = id;
    paintPresetButtons();
    return true;
  }

  function applyLookFilter(slot) {
    var K = window.SWR_LOOK_FILTER_CYCLER;
    if (!K || typeof K.apply !== 'function') return false;
    K.apply(slot);
    state.activeFilter = slot;
    paintFilterButtons();
    return true;
  }

  function paintPresetButtons() {
    if (!state.root) return;
    state.root.querySelectorAll('[data-demo-preset]').forEach(function (btn) {
      var id = btn.getAttribute('data-demo-preset');
      var on = id === state.activePreset;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-active', on);
    });
  }

  function paintFilterButtons() {
    if (!state.root) return;
    state.root.querySelectorAll('[data-demo-filter]').forEach(function (btn) {
      var slot = btn.getAttribute('data-demo-filter');
      var on = String(state.activeFilter) === String(slot);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-active', on);
    });
  }

  function syncLayerControlsFromSelection() {
    if (!state.root) return;
    var sel = selectedLayer();
    var host = state.root.querySelector('[data-demo-layer-fields]');
    if (!host) return;
    var disabled = !sel;
    host.querySelectorAll('input, select, button').forEach(function (el) {
      if (el.hasAttribute('data-demo-layer-always')) return;
      el.disabled = disabled || el.hasAttribute('data-demo-disabled');
    });
    if (!sel) return;
    var map = {
      'demo-blend': sel.blend,
      'demo-opacity': sel.opacity,
      'demo-scale': sel.baseScale,
      'demo-hue': sel.hue,
      'demo-contrast': sel.contrast,
      'demo-brightness': sel.brightness,
      'demo-alpha': sel.alpha,
      'demo-mutate': sel.mutate,
    };
    Object.keys(map).forEach(function (id) {
      var input = host.querySelector('#' + id);
      if (input && typeof map[id] === 'number') input.value = String(map[id]);
    });
  }

  function bindLayerInput(input, field, min, max) {
    if (!input) return;
    input.addEventListener('input', function () {
      var sel = selectedLayer();
      if (!sel) return;
      var v = +input.value;
      if (!Number.isFinite(v)) return;
      sel[field] = Math.max(min, Math.min(max, v));
      var L = layers();
      if (L && typeof L.render === 'function') L.render();
    });
  }

  function runKeysAction(name) {
    if (window.SWR_KEYS && typeof window.SWR_KEYS.run === 'function') {
      return window.SWR_KEYS.run(name);
    }
    return false;
  }

  function clickId(id) {
    var el = document.getElementById(id);
    if (el) el.click();
    return !!el;
  }

  function stopDemoAll() {
    if (state.demoAllTimer) {
      clearInterval(state.demoAllTimer);
      state.demoAllTimer = null;
    }
    if (state.demoBeatRaf) {
      cancelAnimationFrame(state.demoBeatRaf);
      state.demoBeatRaf = null;
    }
    var btn = state.root && state.root.querySelector('[data-demo-all]');
    if (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = 'Demo all';
    }
  }

  function startDemoAll() {
    stopDemoAll();
    var ids = listShortcutPresets();
    if (!ids.length || !window.SWR_PRESET_CYCLE) return;
    var cur = state.activePreset || window.__swrCurrentPreset || ids[0];
    var btn = state.root.querySelector('[data-demo-all]');
    if (btn) {
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = 'Stop demo';
    }
    function step() {
      cur = window.SWR_PRESET_CYCLE.next(cur);
      applyShortcutPreset(cur);
    }
    var useBeat = window.A && window.A.feat && typeof window.A.feat.beatPulse === 'number';
    if (useBeat) {
      state.lastBeatPulse = window.A.feat.beatPulse || 0;
      function beatLoop() {
        if (!state.demoBeatRaf) return;
        var pulse = (window.A && window.A.feat && window.A.feat.beatPulse) || 0;
        if (pulse > 0.5 && state.lastBeatPulse <= 0.5) step();
        state.lastBeatPulse = pulse;
        state.demoBeatRaf = requestAnimationFrame(beatLoop);
      }
      state.demoBeatRaf = requestAnimationFrame(beatLoop);
    } else {
      state.demoAllTimer = setInterval(step, 4000);
      step();
    }
  }

  function resetDemo() {
    stopDemoAll();
    if (window.SWR_LOOK_FILTER_CYCLER && typeof window.SWR_LOOK_FILTER_CYCLER.reset === 'function') {
      window.SWR_LOOK_FILTER_CYCLER.reset();
    } else if (window.SWR_LOOK_FILTER_CYCLER && typeof window.SWR_LOOK_FILTER_CYCLER.apply === 'function') {
      window.SWR_LOOK_FILTER_CYCLER.apply(0);
    }
    state.activeFilter = 0;
    applyShortcutPreset('neon');
    if (window.SWR_KEYS && typeof window.SWR_KEYS.isBlackoutActive === 'function' && window.SWR_KEYS.isBlackoutActive()) {
      runKeysAction('toggleBlackout');
    }
    if (window.SWR_KEYS && typeof window.SWR_KEYS.home === 'function') {
      window.SWR_KEYS.home();
    }
    paintFilterButtons();
  }

  function injectStyles() {
    if (document.getElementById('swr-neon-demo-styles')) return;
    var s = document.createElement('style');
    s.id = 'swr-neon-demo-styles';
    s.textContent = [
      '#swr-neon-demo{position:fixed;z-index:6;left:max(8px,var(--safe-left));bottom:max(44px,calc(var(--safe-bottom) + 40px));max-width:min(320px,calc(100vw - 16px - var(--safe-left) - var(--safe-right));font:10px/1.35 ui-monospace,Menlo,monospace;color:var(--ink);pointer-events:none;}',
      '#swr-neon-demo *{box-sizing:border-box;}',
      '#swr-neon-demo .swr-neon-demo-toggle{pointer-events:auto;display:block;width:100%;padding:8px 10px;border-radius:4px 4px 0 0;border:1px solid var(--line);background:var(--panel-2);color:var(--m);cursor:pointer;font:inherit;letter-spacing:.12em;text-transform:uppercase;text-align:left;}',
      '#swr-neon-demo .swr-neon-demo-toggle:focus-visible{outline:2px solid var(--c);outline-offset:2px;}',
      '#swr-neon-demo.collapsed .swr-neon-demo-body{display:none;}',
      '#swr-neon-demo:not(.collapsed) .swr-neon-demo-toggle{border-radius:4px 4px 0 0;}',
      '#swr-neon-demo.collapsed .swr-neon-demo-toggle{border-radius:4px;}',
      '#swr-neon-demo .swr-neon-demo-body{pointer-events:auto;max-height:min(52vh,420px);overflow:auto;border:1px solid var(--line);border-top:none;background:rgba(14,8,24,.94);padding:8px;border-radius:0 0 4px 4px;}',
      '#swr-neon-demo .demo-sec{margin-bottom:8px;}',
      '#swr-neon-demo .demo-sec h3{margin:0 0 4px;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600;}',
      '#swr-neon-demo .demo-grid{display:flex;flex-wrap:wrap;gap:3px;}',
      '#swr-neon-demo .demo-grid button{padding:4px 6px;font:inherit;font-size:9px;border:1px solid var(--line);border-radius:3px;background:var(--bg-2);color:var(--ink);cursor:pointer;}',
      '#swr-neon-demo .demo-grid button.is-active,#swr-neon-demo .demo-grid button[aria-pressed="true"]{border-color:var(--m);color:var(--m);box-shadow:0 0 0 1px var(--m);}',
      '#swr-neon-demo .demo-grid button:disabled{opacity:.35;cursor:not-allowed;}',
      '#swr-neon-demo .demo-row{display:flex;align-items:center;gap:6px;margin:3px 0;flex-wrap:wrap;}',
      '#swr-neon-demo .demo-row label{min-width:3.5em;color:var(--muted);font-size:8px;text-transform:uppercase;}',
      '#swr-neon-demo .demo-row input[type=range]{flex:1;min-width:80px;}',
      '#swr-neon-demo .demo-actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;}',
      '#swr-neon-demo .demo-actions button{padding:5px 8px;font:inherit;font-size:9px;border:1px solid var(--line);border-radius:3px;background:var(--panel-2);color:var(--ink);cursor:pointer;}',
      '#swr-neon-demo .demo-note{font-size:8px;color:var(--muted);margin-top:2px;}',
    ].join('');
    document.head.appendChild(s);
  }

  function buildPanel() {
    injectStyles();
    var root = mk('div', 'swr-neon-demo collapsed');
    root.id = 'swr-neon-demo';
    state.root = root;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Demo controls');

    var toggle = mk('button', 'swr-neon-demo-toggle', 'Demo panel');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'swr-neon-demo-body');
    toggle.addEventListener('click', function () {
      state.collapsed = !state.collapsed;
      root.classList.toggle('collapsed', state.collapsed);
      toggle.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
      if (!state.collapsed) syncLayerControlsFromSelection();
    });
    root.appendChild(toggle);

    var body = mk('div', 'swr-neon-demo-body');
    body.id = 'swr-neon-demo-body';

    var secPresets = mk('div', 'demo-sec');
    secPresets.appendChild(mk('h3', null, 'FX presets (1–9)'));
    var gridShort = mk('div', 'demo-grid');
    listShortcutPresets().forEach(function (id) {
      var b = mk('button', null, presetLabel(id));
      b.type = 'button';
      b.setAttribute('data-demo-preset', id);
      b.addEventListener('click', function () { applyShortcutPreset(id); });
      gridShort.appendChild(b);
    });
    secPresets.appendChild(gridShort);
    body.appendChild(secPresets);

    var grades = listGradePresets();
    if (grades.length) {
      var secGrades = mk('div', 'demo-sec');
      secGrades.appendChild(mk('h3', null, 'All grade presets'));
      var gridGrades = mk('div', 'demo-grid');
      grades.forEach(function (id) {
        var b = mk('button', null, presetLabel(id));
        b.type = 'button';
        b.setAttribute('data-demo-preset', id);
        b.addEventListener('click', function () { applyGradePreset(id); });
        gridGrades.appendChild(b);
      });
      secGrades.appendChild(gridGrades);
      body.appendChild(secGrades);
    }

    var secFilter = mk('div', 'demo-sec');
    secFilter.appendChild(mk('h3', null, 'Look filters (5–9 / T+0–9)'));
    var gridF = mk('div', 'demo-grid');
    for (var f = 0; f <= 9; f++) {
      (function (slot) {
        var label = slot === 0 ? 'Off' : String(slot);
        var b = mk('button', null, label);
        b.type = 'button';
        b.setAttribute('data-demo-filter', String(slot));
        if (slot === 9 && isDistortionFxOff()) {
          b.disabled = true;
          b.title = 'Disabled while distortion FX are suppressed';
          b.setAttribute('data-demo-disabled', '1');
        }
        b.addEventListener('click', function () { applyLookFilter(slot); });
        gridF.appendChild(b);
      })(f);
    }
    secFilter.appendChild(gridF);
    body.appendChild(secFilter);

    var secScenes = mk('div', 'demo-sec');
    secScenes.appendChild(mk('h3', null, 'Scenes'));
    var gridSc = mk('div', 'demo-grid');
    for (var si = 0; si < 4; si++) {
      (function (idx) {
        var b = mk('button', null, 'Scene ' + (idx + 1));
        b.type = 'button';
        b.addEventListener('click', function () {
          if (window.SWR_SCENES && typeof window.SWR_SCENES.recall === 'function') {
            window.SWR_SCENES.recall(idx);
          }
        });
        b.addEventListener('mousedown', function () {
          if (window.SWR_SCENES && typeof window.SWR_SCENES.startCapture === 'function') {
            window.SWR_SCENES.startCapture(idx);
          }
        });
        b.addEventListener('mouseup', function () {
          if (window.SWR_SCENES && typeof window.SWR_SCENES.cancelCapture === 'function') {
            window.SWR_SCENES.cancelCapture();
          }
        });
        gridSc.appendChild(b);
      })(si);
    }
    secScenes.appendChild(gridSc);
    secScenes.appendChild(mk('p', 'demo-note', 'Click recall · hold 1s to save'));
    body.appendChild(secScenes);

    var secAm = mk('div', 'demo-sec');
    secAm.appendChild(mk('h3', null, 'Automix'));
    var amRow = mk('div', 'demo-grid');
    [
      ['automix-toggle', 'Toggle'],
      ['automix-freeze', 'Freeze'],
      ['automix-lock', 'Lock'],
      ['automix-save', 'Save blend'],
    ].forEach(function (pair) {
      var b = mk('button', null, pair[1]);
      b.type = 'button';
      b.setAttribute('data-demo-layer-always', '1');
      b.addEventListener('click', function () { clickId(pair[0]); });
      amRow.appendChild(b);
    });
    if (window.SWR_AUTOMAP) {
      var recipe = mk('button', null, 'Next recipe');
      recipe.type = 'button';
      recipe.setAttribute('data-demo-layer-always', '1');
      recipe.addEventListener('click', function () { runKeysAction('cycleNextRecipe'); });
      amRow.appendChild(recipe);
      var remap = mk('button', null, 'Re-map');
      remap.type = 'button';
      remap.setAttribute('data-demo-layer-always', '1');
      remap.addEventListener('click', function () { runKeysAction('cycleAutoMap'); });
      amRow.appendChild(remap);
    }
    secAm.appendChild(amRow);
    body.appendChild(secAm);

    var secGlobal = mk('div', 'demo-sec');
    secGlobal.appendChild(mk('h3', null, 'Audio + stage'));
    ['sens', 'gate', 'decay'].forEach(function (id) {
      var row = mk('div', 'demo-row');
      row.appendChild(mk('label', null, id));
      var range = document.createElement('input');
      range.type = 'range';
      range.id = 'demo-global-' + id;
      var src = document.getElementById(id);
      if (src) {
        range.min = src.min;
        range.max = src.max;
        range.step = src.step;
        range.value = src.value;
      }
      range.addEventListener('input', function () {
        var el = document.getElementById(id);
        if (!el) return;
        el.value = range.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      row.appendChild(range);
      secGlobal.appendChild(row);
    });
    var globBtns = mk('div', 'demo-grid');
    [
      ['Mirror', 'cycleMirror'],
      ['Blackout', 'toggleBlackout'],
      ['Home layers', 'home'],
    ].forEach(function (pair) {
      var b = mk('button', null, pair[0]);
      b.type = 'button';
      b.setAttribute('data-demo-layer-always', '1');
      b.addEventListener('click', function () { runKeysAction(pair[1]); });
      globBtns.appendChild(b);
    });
    secGlobal.appendChild(globBtns);
    body.appendChild(secGlobal);

    var secLayer = mk('div', 'demo-sec');
    secLayer.appendChild(mk('h3', null, 'Selected layer'));
    var layerHost = mk('div', null);
    layerHost.setAttribute('data-demo-layer-fields', '1');

    var blendRow = mk('div', 'demo-row');
    blendRow.appendChild(mk('label', null, 'blend'));
    var blendSel = document.createElement('select');
    blendSel.id = 'demo-blend';
    BLENDS.forEach(function (b) {
      var o = document.createElement('option');
      o.value = b;
      o.textContent = b;
      blendSel.appendChild(o);
    });
    blendSel.addEventListener('change', function () {
      var sel = selectedLayer();
      if (!sel) return;
      sel.blend = blendSel.value;
      var L = layers();
      if (L && L.render) L.render();
    });
    blendRow.appendChild(blendSel);
    layerHost.appendChild(blendRow);

    [
      ['demo-opacity', 'op', 'opacity', 0, 1, 0.01],
      ['demo-scale', 'scale', 'baseScale', 0.1, 3, 0.01],
      ['demo-hue', 'hue', 'hue', -180, 180, 1],
      ['demo-contrast', 'ct', 'contrast', 0.1, 2.5, 0.01],
      ['demo-brightness', 'br', 'brightness', 0.1, 2.5, 0.01],
      ['demo-alpha', 'α', 'alpha', 0, 1.5, 0.01],
      ['demo-mutate', 'mt', 'mutate', 0, 1, 0.01],
    ].forEach(function (spec) {
      var row = mk('div', 'demo-row');
      row.appendChild(mk('label', null, spec[1]));
      var input = document.createElement('input');
      input.type = 'range';
      input.id = spec[0];
      input.min = String(spec[3]);
      input.max = String(spec[4]);
      input.step = String(spec[5]);
      if (spec[2] === 'baseScale' && isZoomOff()) {
        input.disabled = true;
        input.title = 'Scale disabled while zoom motion is off';
        input.setAttribute('data-demo-disabled', '1');
      }
      if (spec[2] === 'mutate' && isDistortionFxOff()) {
        input.disabled = true;
        input.title = 'Mutate disabled while distortion FX are suppressed';
        input.setAttribute('data-demo-disabled', '1');
      }
      row.appendChild(input);
      layerHost.appendChild(row);
      bindLayerInput(input, spec[2], spec[3], spec[4]);
    });

    var layerBtns = mk('div', 'demo-grid');
    var cycleBlendBtn = mk('button', null, 'Cycle blend');
    cycleBlendBtn.type = 'button';
    cycleBlendBtn.addEventListener('click', function () { runKeysAction('cycleBlend'); syncLayerControlsFromSelection(); });
    layerBtns.appendChild(cycleBlendBtn);
    var rotBtn = mk('button', null, 'Master rot');
    rotBtn.type = 'button';
    if (isRotationOff()) {
      rotBtn.disabled = true;
      rotBtn.title = 'Rotation is globally disabled';
    } else {
      rotBtn.addEventListener('click', function () { runKeysAction('toggleMasterRotation'); });
    }
    layerBtns.appendChild(rotBtn);
    var reactBtn = mk('button', null, 'Next reactors');
    reactBtn.type = 'button';
    reactBtn.addEventListener('click', function () {
      var sel = selectedLayer();
      if (!sel) return;
      state.reactorIdx = (state.reactorIdx + 1) % REACTOR_PRESETS.length;
      var preset = REACTOR_PRESETS[state.reactorIdx];
      if (isRotationOff()) {
        preset = preset.filter(function (r) { return r.target !== 'rot'; });
      }
      if (isZoomOff()) {
        preset = preset.filter(function (r) { return r.target !== 'scale'; });
      }
      sel.reactors = JSON.parse(JSON.stringify(preset.length ? preset : REACTOR_PRESETS[0]));
      var L = layers();
      if (L && L.render) L.render();
    });
    layerBtns.appendChild(reactBtn);
    layerHost.appendChild(layerBtns);
    secLayer.appendChild(layerHost);
    body.appendChild(secLayer);

    var actions = mk('div', 'demo-actions');
    var demoAll = mk('button', null, 'Demo all');
    demoAll.type = 'button';
    demoAll.setAttribute('data-demo-all', '1');
    demoAll.setAttribute('data-demo-layer-always', '1');
    demoAll.addEventListener('click', function () {
      if (state.demoAllTimer || state.demoBeatRaf) stopDemoAll();
      else startDemoAll();
    });
    actions.appendChild(demoAll);
    var resetBtn = mk('button', null, 'Reset');
    resetBtn.type = 'button';
    resetBtn.setAttribute('data-demo-layer-always', '1');
    resetBtn.addEventListener('click', resetDemo);
    actions.appendChild(resetBtn);
    body.appendChild(actions);

    root.appendChild(body);
    state.root = root;
    state.activePreset = window.__swrCurrentPreset || 'neon';
    paintPresetButtons();
    return root;
  }

  function mount(host) {
    if (state.mounted) return state.root;
    var el = buildPanel();
    (host || document.body).appendChild(el);
    state.mounted = true;
    window.addEventListener('swr:preset-applied', function (ev) {
      if (ev.detail && ev.detail.pageKey) {
        state.activePreset = ev.detail.pageKey;
        paintPresetButtons();
      }
    });
    window.addEventListener('swr-keys-press', function (ev) {
      if (!ev.detail || !ev.detail.action) return;
      if (String(ev.detail.action).indexOf('filter-') === 0) {
        state.activeFilter = parseInt(String(ev.detail.action).replace('filter-', ''), 10);
        paintFilterButtons();
      }
      if (String(ev.detail.action).indexOf('fx-preset-') === 0) {
        state.activePreset = String(ev.detail.action).replace('fx-preset-', '');
        paintPresetButtons();
      }
    });
    document.addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('#layers .l')) {
        setTimeout(syncLayerControlsFromSelection, 0);
      }
    }, true);
    return el;
  }

  function unmount() {
    stopDemoAll();
    if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
    state.root = null;
    state.mounted = false;
  }

  window.SWR_NEON_DEMO = {
    mount: mount,
    unmount: unmount,
    listShortcutPresets: listShortcutPresets,
    listGradePresets: listGradePresets,
    applyShortcutPreset: applyShortcutPreset,
    applyGradePreset: applyGradePreset,
    applyLookFilter: applyLookFilter,
    isRotationOff: isRotationOff,
    isZoomOff: isZoomOff,
    isDistortionFxOff: isDistortionFxOff,
    getState: function () { return { collapsed: state.collapsed, activePreset: state.activePreset, activeFilter: state.activeFilter }; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mount(); }, { once: true });
  } else {
    mount();
  }
})();
