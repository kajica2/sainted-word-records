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

  /** @type {Record<string, { id: string, label: string, skipVerify: boolean, invoke: function(): * }>} */
  var controls = {};

  function invalidateRender() {
    try {
      if (window.SWR_RENDER && typeof window.SWR_RENDER.invalidate === 'function') {
        window.SWR_RENDER.invalidate();
      }
    } catch (_) {}
  }

  function regControl(el, id, meta) {
    if (!el || !id || !meta || typeof meta.invoke !== 'function') return;
    el.setAttribute('data-demo-control', id);
    if (meta.skipVerify) el.setAttribute('data-demo-skip-verify', '1');
    controls[id] = {
      id: id,
      label: meta.label || id,
      skipVerify: !!meta.skipVerify,
      invoke: meta.invoke,
    };
  }

  function assertAllControlsBound() {
    if (!state.root) return;
    var missing = [];
    state.root.querySelectorAll('[data-demo-control]').forEach(function (el) {
      var id = el.getAttribute('data-demo-control');
      var c = controls[id];
      if (!c || typeof c.invoke !== 'function') missing.push(id || '(empty id)');
    });
    if (missing.length) {
      throw new Error('SWR_NEON_DEMO unbound demo controls: ' + missing.join(', '));
    }
  }

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
    invalidateRender();
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
    invalidateRender();
    return true;
  }

  function applyLookFilter(slot) {
    var K = window.SWR_LOOK_FILTER_CYCLER;
    if (!K || typeof K.apply !== 'function') return false;
    K.apply(slot);
    state.activeFilter = slot;
    paintFilterButtons();
    invalidateRender();
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
      invalidateRender();
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
      var inv = function () { return applyShortcutPreset(id); };
      regControl(b, 'fx:' + id, { label: 'FX ' + presetLabel(id), invoke: inv });
      b.addEventListener('click', inv);
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
        var inv = function () { return applyGradePreset(id); };
        regControl(b, 'grade:' + id, { label: 'Grade ' + presetLabel(id), invoke: inv });
        b.addEventListener('click', inv);
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
        var skipF = slot === 9 && isDistortionFxOff();
        if (skipF) {
          b.disabled = true;
          b.title = 'Disabled while distortion FX are suppressed';
          b.setAttribute('data-demo-disabled', '1');
        }
        var invF = function () { return applyLookFilter(slot); };
        regControl(b, 'filter:' + slot, {
          label: 'Filter ' + label,
          skipVerify: skipF,
          invoke: invF,
        });
        b.addEventListener('click', invF);
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
        var invSc = function () {
          if (window.SWR_SCENES && typeof window.SWR_SCENES.recall === 'function') {
            return window.SWR_SCENES.recall(idx);
          }
          return false;
        };
        regControl(b, 'scene:' + idx, { label: 'Scene ' + (idx + 1), invoke: invSc });
        b.addEventListener('click', invSc);
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
      ['automix-toggle', 'Toggle', 'automix:toggle'],
      ['automix-freeze', 'Freeze', 'automix:freeze'],
      ['automix-lock', 'Lock', 'automix:lock'],
      ['automix-save', 'Save blend', 'automix:save'],
    ].forEach(function (pair) {
      var b = mk('button', null, pair[1]);
      b.type = 'button';
      b.setAttribute('data-demo-layer-always', '1');
      var invAm = function () { return clickId(pair[0]); };
      regControl(b, pair[2], { label: pair[1], invoke: invAm });
      b.addEventListener('click', invAm);
      amRow.appendChild(b);
    });
    if (window.SWR_AUTOMAP) {
      var recipe = mk('button', null, 'Next recipe');
      recipe.type = 'button';
      recipe.setAttribute('data-demo-layer-always', '1');
      var invRec = function () {
        if (document.getElementById('automix-toggle') && window.SWR_AUTOMAP) {
          var M = window.SWR_AUTOMAP;
          var all = M.list();
          if (!all || !all.length) return false;
          var cur = M.pageIdFromBody ? M.pageIdFromBody() : null;
          var idx = all.findIndex(function (r) { return r.id === cur; });
          var next = all[(idx + 1 + all.length) % all.length];
          M.apply(next.id);
          return true;
        }
        return runKeysAction('cycleNextRecipe');
      };
      regControl(recipe, 'automix:nextRecipe', { label: 'Next recipe', invoke: invRec });
      recipe.addEventListener('click', invRec);
      amRow.appendChild(recipe);
      var remap = mk('button', null, 'Re-map');
      remap.type = 'button';
      remap.setAttribute('data-demo-layer-always', '1');
      var invMap = function () { return runKeysAction('cycleAutoMap'); };
      regControl(remap, 'automix:remap', { label: 'Re-map', invoke: invMap });
      remap.addEventListener('click', invMap);
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
      var invG = function () {
        var el = document.getElementById(id);
        if (!el) return false;
        var cur = parseFloat(el.value);
        var next = Number.isFinite(cur) ? Math.min(parseFloat(el.max), cur + (parseFloat(el.max) - parseFloat(el.min)) * 0.15) : el.value;
        range.value = String(next);
        el.value = String(next);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        invalidateRender();
        return true;
      };
      regControl(range, 'global:' + id, { label: 'Global ' + id, invoke: invG });
      range.addEventListener('input', function () {
        var el = document.getElementById(id);
        if (!el) return;
        el.value = range.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        invalidateRender();
      });
      row.appendChild(range);
      secGlobal.appendChild(row);
    });
    var globBtns = mk('div', 'demo-grid');
    [
      ['Mirror', 'cycleMirror', 'keys:mirror'],
      ['Blackout', 'toggleBlackout', 'keys:blackout'],
      ['Home layers', 'home', 'keys:home'],
    ].forEach(function (pair) {
      var b = mk('button', null, pair[0]);
      b.type = 'button';
      b.setAttribute('data-demo-layer-always', '1');
      var invK = function () {
        if (pair[1] === 'home') {
          if (window.SWR_KEYS && typeof window.SWR_KEYS.home === 'function') {
            window.SWR_KEYS.home();
            invalidateRender();
            return true;
          }
          return false;
        }
        var ok = runKeysAction(pair[1]);
        if (ok) invalidateRender();
        return ok;
      };
      regControl(b, pair[2], { label: pair[0], invoke: invK });
      b.addEventListener('click', invK);
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
    var invBlend = function () {
      var sel = selectedLayer();
      if (!sel) return false;
      var i = BLENDS.indexOf(sel.blend || 'screen');
      var next = BLENDS[(i + 1) % BLENDS.length];
      blendSel.value = next;
      sel.blend = next;
      var L = layers();
      if (L && L.render) L.render();
      invalidateRender();
      return true;
    };
    regControl(blendSel, 'layer:blend', { label: 'Layer blend', invoke: invBlend });
    blendSel.addEventListener('change', function () {
      var sel = selectedLayer();
      if (!sel) return;
      sel.blend = blendSel.value;
      var L = layers();
      if (L && L.render) L.render();
      invalidateRender();
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
      var skipLayer = false;
      if (spec[2] === 'baseScale' && isZoomOff()) {
        input.disabled = true;
        input.title = 'Scale disabled while zoom motion is off';
        input.setAttribute('data-demo-disabled', '1');
        skipLayer = true;
      }
      if (spec[2] === 'mutate' && isDistortionFxOff()) {
        input.disabled = true;
        input.title = 'Mutate disabled while distortion FX are suppressed';
        input.setAttribute('data-demo-disabled', '1');
        skipLayer = true;
      }
      (function (field, min, max, inp) {
        var invL = function () {
          var sel = selectedLayer();
          if (!sel || inp.disabled) return false;
          var cur = sel[field];
          var bump = (max - min) * 0.35;
          var v = Number.isFinite(cur) && cur < (min + max) / 2 ? cur + bump : min + bump;
          inp.value = String(Math.max(min, Math.min(max, v)));
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        };
        regControl(inp, 'layer:' + field, { label: 'Layer ' + field, skipVerify: skipLayer, invoke: invL });
      })(spec[2], spec[3], spec[4], input);
      row.appendChild(input);
      layerHost.appendChild(row);
      bindLayerInput(input, spec[2], spec[3], spec[4]);
    });

    var layerBtns = mk('div', 'demo-grid');
    var cycleBlendBtn = mk('button', null, 'Cycle blend');
    cycleBlendBtn.type = 'button';
    var invCycleBlend = function () {
      var ok = runKeysAction('cycleBlend');
      syncLayerControlsFromSelection();
      invalidateRender();
      return ok;
    };
    regControl(cycleBlendBtn, 'layer:cycleBlend', { label: 'Cycle blend', invoke: invCycleBlend });
    cycleBlendBtn.addEventListener('click', invCycleBlend);
    layerBtns.appendChild(cycleBlendBtn);
    var rotBtn = mk('button', null, 'Master rot');
    rotBtn.type = 'button';
    var rotOff = isRotationOff();
    var invRot = function () { return runKeysAction('toggleMasterRotation'); };
    regControl(rotBtn, 'layer:masterRot', { label: 'Master rot', skipVerify: rotOff, invoke: invRot });
    if (rotOff) {
      rotBtn.disabled = true;
      rotBtn.title = 'Rotation is globally disabled';
    } else {
      rotBtn.addEventListener('click', invRot);
    }
    layerBtns.appendChild(rotBtn);
    var reactBtn = mk('button', null, 'Next reactors');
    reactBtn.type = 'button';
    var invReact = function () {
      var sel = selectedLayer();
      if (!sel) return false;
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
      invalidateRender();
      return true;
    };
    regControl(reactBtn, 'layer:nextReactors', { label: 'Next reactors', invoke: invReact });
    reactBtn.addEventListener('click', invReact);
    layerBtns.appendChild(reactBtn);
    layerHost.appendChild(layerBtns);
    secLayer.appendChild(layerHost);
    body.appendChild(secLayer);

    var actions = mk('div', 'demo-actions');
    var demoAll = mk('button', null, 'Demo all');
    demoAll.type = 'button';
    demoAll.setAttribute('data-demo-all', '1');
    demoAll.setAttribute('data-demo-layer-always', '1');
    var invDemoAll = function () {
      if (state.demoAllTimer || state.demoBeatRaf) {
        stopDemoAll();
        return true;
      }
      startDemoAll();
      return !!(state.demoAllTimer || state.demoBeatRaf);
    };
    regControl(demoAll, 'demo:demoAll', { label: 'Demo all', invoke: invDemoAll });
    demoAll.addEventListener('click', invDemoAll);
    actions.appendChild(demoAll);
    var resetBtn = mk('button', null, 'Reset');
    resetBtn.type = 'button';
    resetBtn.setAttribute('data-demo-layer-always', '1');
    var invReset = function () { resetDemo(); return true; };
    regControl(resetBtn, 'demo:reset', { label: 'Reset', invoke: invReset });
    resetBtn.addEventListener('click', invReset);
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
    assertAllControlsBound();
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

  function listControls() {
    return Object.keys(controls).sort().map(function (id) {
      var c = controls[id];
      return { id: id, label: c.label, skipVerify: c.skipVerify };
    });
  }

  function invokeControl(id) {
    var c = controls[id];
    if (!c || typeof c.invoke !== 'function') return { ok: false, error: 'unknown_control' };
    try {
      var result = c.invoke();
      return { ok: result !== false, result: result };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  function readProbe(id) {
    var fxSnap = function () {
      if (!window.FX || !window.FX.state) return null;
      var s = window.FX.state;
      return [s.temp, s.grain, s.glow, s.sepia, s.vignette, s.grayscale, s.blur].join(',');
    };
    if (id.indexOf('fx:') === 0) {
      return { preset: window.__swrCurrentPreset, fx: fxSnap() };
    }
    if (id.indexOf('grade:') === 0) {
      return { grade: id.split(':')[1], preset: window.__swrCurrentPreset, fx: fxSnap() };
    }
    if (id.indexOf('filter:') === 0) {
      var slot = parseInt(id.split(':')[1], 10);
      var cur = window.SWR_LOOK_FILTER_CYCLER && window.SWR_LOOK_FILTER_CYCLER.get
        ? window.SWR_LOOK_FILTER_CYCLER.get() : {};
      return { filterSlot: cur.slot, fx: fxSnap(), slot: slot };
    }
    if (id.indexOf('scene:') === 0) {
      var sens = document.getElementById('sens');
      return { sens: sens ? parseFloat(sens.value) : null };
    }
    if (id.indexOf('automix:') === 0) {
      var lab = document.getElementById('automix-state');
      return { automix: lab ? lab.textContent : null };
    }
    if (id.indexOf('global:') === 0) {
      var gid = id.split(':')[1];
      var el = document.getElementById(gid);
      return { value: el ? parseFloat(el.value) : null };
    }
    if (id.indexOf('keys:') === 0) {
      return {
        blackout: window.SWR_KEYS && window.SWR_KEYS.isBlackoutActive
          ? window.SWR_KEYS.isBlackoutActive() : null,
        mirror: window.SWR_NATURAL && typeof window.SWR_NATURAL.mirror === 'function'
          ? window.SWR_NATURAL.mirror() : null,
      };
    }
    if (id.indexOf('layer:') === 0) {
      var sel = selectedLayer();
      if (!sel) return { layer: null };
      var field = id.split(':')[1];
      if (field === 'blend') return { blend: sel.blend };
      if (field === 'cycleBlend') return { blend: sel.blend };
      if (field === 'masterRot') return { rotationEnabled: sel.rotationEnabled };
      if (field === 'nextReactors') return { reactors: JSON.stringify(sel.reactors || []) };
      return { layerField: field, value: sel[field] };
    }
    if (id === 'demo:demoAll') {
      return { running: !!(state.demoAllTimer || state.demoBeatRaf) };
    }
    if (id === 'demo:reset') {
      return { preset: state.activePreset, filter: state.activeFilter };
    }
    return {};
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
    listControls: listControls,
    invokeControl: invokeControl,
    readProbe: readProbe,
    assertAllControlsBound: assertAllControlsBound,
    getState: function () { return { collapsed: state.collapsed, activePreset: state.activePreset, activeFilter: state.activeFilter }; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mount(); }, { once: true });
  } else {
    mount();
  }
})();
