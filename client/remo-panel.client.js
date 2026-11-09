// client/remo-panel.client.js
// Remo Panel 2.0 — ENV editor + Patch Matrix. Only mounts when ?env=1.

(function () {
  'use strict';
  if (window.SWR_REMO_PANEL) return;

  function envEnabled() {
    try {
      return /(?:\?|&)env=1(?:&|$)/.test(location.search || '');
    } catch (_) {
      return false;
    }
  }

  var state = {
    enabled: false,
    root: null,
    tab: 'env',
    activeId: null,
    filter: '',
    canvas: null,
    mounted: false,
  };

  function P() { return window.SWR_REMO_PARAMS; }
  function E() { return window.SWR_REMO_ENV; }
  function W() { return window.SWR_REMO_WIRES; }
  function H() { return window.SWR_REMO_HISTORY; }
  function S() { return window.SWR_REMO_SHAPES; }

  function mk(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function seedStarter() {
    var bus = E();
    var shapes = S();
    if (!bus || !shapes || bus.listSources().length) return;
    var ids = shapes.presetIds();
    for (var i = 0; i < ids.length; i++) {
      var id = 'env_' + ids[i];
      var preset = shapes.preset(ids[i]);
      bus.addSource({
        id: id,
        preset: ids[i],
        timeBase: preset.timeBase || 'seconds',
        seconds: preset.seconds || 0.5,
        beats: preset.beats || 1,
        loop: !!preset.loop,
        trigger: ids[i] === 'pump' || ids[i] === 'pluck' || ids[i] === 'gate' ? 'beat' : 'manual',
      });
    }
    state.activeId = 'env_swell';
  }

  function drawEnv(canvas, env) {
    if (!canvas || !env || !env.lut) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth || 280;
    var h = canvas.clientHeight || 120;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,45,138,0.12)';
    ctx.strokeStyle = '#ff2d8a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var lut = env.lut;
    for (var i = 0; i < lut.length; i++) {
      var x = (i / (lut.length - 1)) * w;
      var y = h - lut[i] * (h - 8) - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    // playhead
    if (env.state !== 'idle' && env.seconds > 0) {
      var px = (env.t / env.seconds) * w;
      ctx.strokeStyle = '#00f0ff';
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }

  function paintEnv() {
    var env = E() && state.activeId ? E().getSource(state.activeId) : null;
    drawEnv(state.canvas, env);
  }

  function snapshotV2() {
    return {
      schemaVersion: 2,
      params: P() ? P().snapshot() : {},
      envelopes: E() ? E().snapshot() : [],
      wires: W() ? W().snapshot() : [],
    };
  }

  function migrateV1toV2(v1) {
    var params = Object.create(null);
    if (v1 && v1.stage && typeof v1.stage.zoom === 'number') params['stage.zoom'] = v1.stage.zoom;
    if (v1 && v1.stage && typeof v1.stage.hue === 'number') params['fx.hue'] = v1.stage.hue;
    if (v1 && v1.look && typeof v1.look.brightness === 'number') params['look.brightness'] = v1.look.brightness;
    if (v1 && typeof v1.fx === 'number') params['fx.hue'] = v1.fx;
    var layers = (v1 && v1.scene && v1.scene.layers) || [];
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i] || {};
      params['layers.' + i + '.opacity'] = l.opacity != null ? l.opacity : 1;
      params['layers.' + i + '.scale'] = l.scale != null ? l.scale : 1;
      params['layers.' + i + '.rotation'] = l.rotation != null ? l.rotation : 0;
    }
    return { schemaVersion: 2, params: params, envelopes: [], wires: [] };
  }

  function applySnapshot(raw) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid' };
    var snap = raw;
    if (raw.schemaVersion == null) snap = migrateV1toV2(raw);
    if (snap.schemaVersion !== 2) return { ok: false, error: 'unsupported_version' };
    if ((snap.envelopes && snap.envelopes.length > 64) || (snap.wires && snap.wires.length > 256)) {
      return { ok: false, error: 'too_large' };
    }
    if (P()) P().restore(snap.params || {});
    if (E()) E().restore(snap.envelopes || []);
    if (W()) W().restore(snap.wires || []);
    // A v1 migration (or an empty v2) leaves no envelopes. Seed the
    // starter bank so preset chips and the matrix stay usable.
    var list = E() ? E().listSources() : [];
    if (!list.length) {
      seedStarter();
      list = E() ? E().listSources() : [];
    }
    state.activeId = list[0] ? list[0].id : null;
    renderBody();
    return { ok: true };
  }

  function toast(msg) {
    var t = state.root && state.root.querySelector('[data-remo-toast]');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    setTimeout(function () { t.hidden = true; }, 2800);
  }

  function selectPreset(presetId) {
    var bus = E();
    var envId = state.activeId;
    if (!bus || !envId) return;
    var prev = bus.snapshot().find(function (e) { return e.id === envId; });
    bus.updateSource(envId, { preset: presetId, shape: null });
    if (H()) {
      H().push({
        label: 'preset ' + presetId,
        undo: function () {
          if (prev) bus.updateSource(envId, prev);
          state.activeId = envId;
          renderBody();
        },
        redo: function () {
          bus.updateSource(envId, { preset: presetId, shape: null });
          state.activeId = envId;
          renderBody();
        },
      });
    }
    renderBody();
  }

  function setCellWire(sourceId, target, depth) {
    var store = W();
    if (!store) return;
    var existing = store.findWire(sourceId, target);
    if (existing) {
      var wireId = existing.id;
      var before = existing.depth;
      store.updateWire(wireId, { depth: depth });
      if (H()) {
        H().push({
          label: 'depth',
          coalesceKey: 'wire:depth:' + wireId,
          undo: function () {
            var w = store.findWire(sourceId, target);
            if (w) store.updateWire(w.id, { depth: before });
            renderBody();
          },
          redo: function () {
            var w = store.findWire(sourceId, target);
            if (w) store.updateWire(w.id, { depth: depth });
            else store.addWire({ id: wireId, sourceId: sourceId, target: target, depth: depth, polarity: 'uni', curve: 'smooth', mode: 'add' });
            renderBody();
          },
        });
      }
    } else {
      var wire = store.addWire({ sourceId: sourceId, target: target, depth: depth, polarity: 'uni', curve: 'smooth', mode: 'add' });
      if (H() && wire) {
        var addedId = wire.id;
        var snap = {
          id: addedId,
          sourceId: sourceId,
          target: target,
          depth: depth,
          polarity: 'uni',
          curve: 'smooth',
          mode: 'add',
        };
        H().push({
          label: 'add wire',
          undo: function () {
            var w = store.findWire(sourceId, target);
            if (w) store.removeWire(w.id);
            renderBody();
          },
          redo: function () {
            store.addWire(snap);
            renderBody();
          },
        });
      }
    }
    renderBody();
  }

  function deleteCellWire(sourceId, target) {
    var store = W();
    if (!store) return;
    var existing = store.findWire(sourceId, target);
    if (!existing) return;
    var snap = {
      id: existing.id,
      sourceId: existing.sourceId,
      target: existing.target,
      depth: existing.depth,
      polarity: existing.polarity,
      curve: existing.curve,
      mode: existing.mode,
    };
    store.removeWire(existing.id);
    if (H()) {
      H().push({
        label: 'delete wire',
        undo: function () { store.addWire(snap); renderBody(); },
        redo: function () {
          var w = store.findWire(snap.sourceId, snap.target);
          if (w) store.removeWire(w.id);
          renderBody();
        },
      });
    }
    renderBody();
  }

  function renderEnvTab(host) {
    var bus = E();
    var shapes = S();
    if (!bus || !shapes) return;
    var env = state.activeId ? bus.getSource(state.activeId) : null;
    var chips = mk('div', 'remo-chips');
    shapes.presetIds().forEach(function (id) {
      var b = mk('button', null, id);
      b.type = 'button';
      if (env && env.preset === id) b.classList.add('is-active');
      b.addEventListener('click', function () { selectPreset(id); });
      chips.appendChild(b);
    });
    host.appendChild(chips);

    if (!env) {
      host.appendChild(mk('p', 'remo-hint', 'Pick a preset to start.'));
      return;
    }

    var list = mk('div', 'remo-env-list');
    bus.listSources().forEach(function (src) {
      var b = mk('button', null, src.id.replace(/^env_/, ''));
      b.type = 'button';
      if (src.id === state.activeId) b.classList.add('is-active');
      b.addEventListener('click', function () { state.activeId = src.id; renderBody(); });
      list.appendChild(b);
    });
    host.appendChild(list);

    var canvas = mk('canvas', 'remo-env-canvas');
    canvas.setAttribute('aria-label', 'Envelope shape');
    state.canvas = canvas;
    host.appendChild(canvas);
    drawEnv(canvas, env);

    var row = mk('div', 'remo-controls');
    var len = mk('label', null, 'Length ');
    var lenIn = mk('input');
    lenIn.type = 'number';
    lenIn.min = '0.05';
    lenIn.step = '0.05';
    lenIn.value = String(env.timeBase === 'beats' ? env.beats : env.seconds);
    lenIn.addEventListener('change', function () {
      var v = +lenIn.value;
      if (env.timeBase === 'beats') bus.updateSource(env.id, { beats: v });
      else bus.updateSource(env.id, { seconds: v });
      paintEnv();
    });
    len.appendChild(lenIn);
    row.appendChild(len);

    var loop = mk('label', null, ' Loop ');
    var loopIn = mk('input');
    loopIn.type = 'checkbox';
    loopIn.checked = !!env.loop;
    loopIn.addEventListener('change', function () { bus.updateSource(env.id, { loop: loopIn.checked }); });
    loop.appendChild(loopIn);
    row.appendChild(loop);

    var trig = mk('label', null, ' Trigger ');
    var trigSel = mk('select');
    ['manual', 'beat', 'scene:change', 'layer:enter', 'remap', 'key:space'].forEach(function (name) {
      var o = mk('option', null, name);
      o.value = name;
      if (env.trigger === name) o.selected = true;
      trigSel.appendChild(o);
    });
    trigSel.addEventListener('change', function () { bus.updateSource(env.id, { trigger: trigSel.value }); });
    trig.appendChild(trigSel);
    row.appendChild(trig);

    var test = mk('button', null, '▶ Test');
    test.type = 'button';
    test.addEventListener('click', function () { bus.trigger(env.id); paintEnv(); });
    row.appendChild(test);

    var rel = mk('button', null, 'Release');
    rel.type = 'button';
    rel.addEventListener('click', function () { bus.release(env.id); paintEnv(); });
    row.appendChild(rel);
    host.appendChild(row);
  }

  function renderMatrixTab(host) {
    var bus = E();
    var store = W();
    var params = P();
    if (!bus || !store || !params) return;

    var search = mk('input', 'remo-search');
    search.type = 'search';
    search.placeholder = 'Search params';
    search.value = state.filter;
    search.setAttribute('aria-label', 'Filter matrix targets');
    search.addEventListener('input', function () {
      state.filter = search.value.trim().toLowerCase();
      renderBody();
    });
    host.appendChild(search);

    var sources = bus.listSources();
    var targets = params.list().filter(function (p) {
      if (p.path === 'tempo') return false;
      if (!state.filter) return true;
      return p.path.toLowerCase().indexOf(state.filter) >= 0 || p.label.toLowerCase().indexOf(state.filter) >= 0;
    });

    if (!targets.length) {
      host.appendChild(mk('p', 'remo-hint', 'No matching params.'));
      return;
    }
    if (!sources.length) {
      host.appendChild(mk('p', 'remo-hint', 'Add an envelope in ENV first.'));
      return;
    }

    var table = mk('div', 'remo-matrix');
    table.setAttribute('role', 'grid');
    table.setAttribute('aria-label', 'Patch matrix');
    var head = mk('div', 'remo-matrix-row remo-matrix-head');
    head.appendChild(mk('div', 'remo-matrix-corner', 'target \\ source'));
    sources.forEach(function (src) {
      var col = mk('button', 'remo-matrix-col', src.id.replace(/^env_/, ''));
      col.type = 'button';
      col.title = 'Test ' + src.id;
      col.addEventListener('click', function () { bus.trigger(src.id); });
      head.appendChild(col);
    });
    table.appendChild(head);

    targets.forEach(function (param) {
      var row = mk('div', 'remo-matrix-row');
      row.appendChild(mk('div', 'remo-matrix-target', param.label || param.path));
      sources.forEach(function (src) {
        var wire = store.findWire(src.id, param.path);
        var cell = mk('button', 'remo-matrix-cell');
        cell.type = 'button';
        cell.setAttribute('role', 'gridcell');
        var depthPct = wire ? Math.round(wire.depth * 100) : null;
        cell.textContent = depthPct == null ? '—' : String(depthPct);
        cell.setAttribute('aria-label', src.id + ' → ' + param.path + ', ' + (depthPct == null ? 'none' : depthPct + '%'));
        if (wire) cell.classList.add('has-wire');
        cell.addEventListener('click', function (ev) {
          if (ev.detail === 2) {
            deleteCellWire(src.id, param.path);
            return;
          }
          if (!wire) setCellWire(src.id, param.path, 0.5);
          else setCellWire(src.id, param.path, Math.min(1, wire.depth + 0.1));
        });
        cell.addEventListener('keydown', function (ev) {
          if (ev.key === 'Delete' || ev.key === 'Backspace') {
            ev.preventDefault();
            deleteCellWire(src.id, param.path);
          }
          if (/^[0-9]$/.test(ev.key)) {
            ev.preventDefault();
            setCellWire(src.id, param.path, (+ev.key) / 10);
          }
        });
        row.appendChild(cell);
      });
      table.appendChild(row);
    });
    host.appendChild(table);
    if (!store.listWires().length) {
      host.appendChild(mk('p', 'remo-hint', 'Tap a cell to wire this param.'));
    }
  }

  function renderBody() {
    if (!state.root) return;
    var body = state.root.querySelector('[data-remo-body]');
    if (!body) return;
    body.textContent = '';
    if (state.tab === 'env') renderEnvTab(body);
    else renderMatrixTab(body);
  }

  function ensureCss() {
    if (document.getElementById('swr-remo-css')) return;
    var style = document.createElement('style');
    style.id = 'swr-remo-css';
    style.textContent = [
      '.swr-remo{position:fixed;right:12px;bottom:12px;z-index:10020;width:min(420px,calc(100vw - 24px));',
      'max-height:min(70vh,560px);display:flex;flex-direction:column;background:rgba(10,6,18,.94);',
      'border:1px solid var(--line,#333);border-radius:10px;color:#eee;font:12px/1.35 ui-monospace,monospace;',
      'box-shadow:0 12px 40px rgba(0,0,0,.45)}',
      '.swr-remo.collapsed .swr-remo-body,.swr-remo.collapsed .swr-remo-tabs{display:none}',
      '.swr-remo-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #2a2236}',
      '.swr-remo-head strong{flex:1;letter-spacing:.08em;text-transform:uppercase;font-size:11px}',
      '.swr-remo-tabs{display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid #2a2236}',
      '.swr-remo-tabs button,.remo-chips button,.remo-env-list button,.remo-controls button,.swr-remo-head button{',
      'background:#16101f;border:1px solid #3a2f4d;color:#eee;border-radius:6px;padding:6px 8px;cursor:pointer}',
      '.swr-remo-tabs button.is-active,.remo-chips button.is-active,.remo-env-list button.is-active{border-color:#ff2d8a;color:#ff2d8a}',
      '.swr-remo-body{padding:8px;overflow:auto;flex:1}',
      '.remo-chips,.remo-env-list{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}',
      '.remo-env-canvas{width:100%;height:120px;background:#0a0612;border:1px solid #2a2236;border-radius:6px;display:block}',
      '.remo-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}',
      '.remo-controls input[type=number]{width:64px;background:#0a0612;border:1px solid #3a2f4d;color:#eee;border-radius:4px;padding:4px}',
      '.remo-search{width:100%;margin-bottom:8px;background:#0a0612;border:1px solid #3a2f4d;color:#eee;border-radius:6px;padding:8px}',
      '.remo-matrix{display:flex;flex-direction:column;gap:2px}',
      '.remo-matrix-row{display:grid;grid-template-columns:minmax(110px,1.4fr) repeat(auto-fit,minmax(48px,1fr));gap:2px;align-items:center}',
      '.remo-matrix-target,.remo-matrix-corner{font-size:10px;color:#9aa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.remo-matrix-cell,.remo-matrix-col{min-height:44px;min-width:44px}',
      '.remo-matrix-cell.has-wire{border-color:#00f0ff;color:#00f0ff}',
      '.remo-hint{color:#8a8098;margin:8px 0 0}',
      '.remo-toast{position:absolute;left:10px;right:10px;bottom:10px;background:#2a1020;border:1px solid #ff2d8a;padding:8px;border-radius:6px}',
      '@media (prefers-reduced-motion:reduce){.swr-remo *{transition:none!important}}',
    ].join('');
    document.head.appendChild(style);
  }

  function mount() {
    if (!envEnabled()) return null;
    if (state.mounted) return state.root;
    ensureCss();
    seedStarter();
    var root = mk('aside', 'swr-remo');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Remo modulation panel');
    var head = mk('div', 'swr-remo-head');
    head.appendChild(mk('strong', null, 'Remo 2.0'));
    var undo = mk('button', null, 'Undo');
    undo.type = 'button';
    undo.addEventListener('click', function () { if (H()) H().undo(); renderBody(); });
    var redo = mk('button', null, 'Redo');
    redo.type = 'button';
    redo.addEventListener('click', function () { if (H()) H().redo(); renderBody(); });
    var exp = mk('button', null, 'Export');
    exp.type = 'button';
    exp.addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(snapshotV2(), null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'remo-preset.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    var imp = mk('button', null, 'Import');
    imp.type = 'button';
    var file = mk('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var json = JSON.parse(String(reader.result || ''));
          var res = applySnapshot(json);
          if (!res.ok) toast('Preset is invalid (' + res.error + '). Not applied.');
          else toast('Preset applied.');
        } catch (_) {
          toast('Preset is invalid. Not applied.');
        }
      };
      reader.readAsText(f);
      file.value = '';
    });
    imp.addEventListener('click', function () { file.click(); });
    var toggle = mk('button', null, '▾');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.addEventListener('click', function () {
      root.classList.toggle('collapsed');
      var open = !root.classList.contains('collapsed');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? '▾' : '▸';
    });
    head.appendChild(undo);
    head.appendChild(redo);
    head.appendChild(exp);
    head.appendChild(imp);
    head.appendChild(toggle);
    root.appendChild(head);
    root.appendChild(file);

    var tabs = mk('div', 'swr-remo-tabs');
    var envTab = mk('button', 'is-active', 'ENV');
    envTab.type = 'button';
    envTab.setAttribute('aria-pressed', 'true');
    var matrixTab = mk('button', null, 'MATRIX');
    matrixTab.type = 'button';
    matrixTab.setAttribute('aria-pressed', 'false');
    envTab.addEventListener('click', function () {
      state.tab = 'env';
      envTab.classList.add('is-active');
      matrixTab.classList.remove('is-active');
      envTab.setAttribute('aria-pressed', 'true');
      matrixTab.setAttribute('aria-pressed', 'false');
      renderBody();
    });
    matrixTab.addEventListener('click', function () {
      state.tab = 'matrix';
      matrixTab.classList.add('is-active');
      envTab.classList.remove('is-active');
      matrixTab.setAttribute('aria-pressed', 'true');
      envTab.setAttribute('aria-pressed', 'false');
      renderBody();
    });
    tabs.appendChild(envTab);
    tabs.appendChild(matrixTab);
    root.appendChild(tabs);

    var body = mk('div', 'swr-remo-body');
    body.setAttribute('data-remo-body', '1');
    root.appendChild(body);
    var toastEl = mk('div', 'remo-toast');
    toastEl.setAttribute('data-remo-toast', '1');
    toastEl.hidden = true;
    root.appendChild(toastEl);

    document.body.appendChild(root);
    state.root = root;
    state.mounted = true;
    state.enabled = true;
    renderBody();
    return root;
  }

  function tick(dt) {
    if (!state.enabled) return;
    var bus = E();
    var store = W();
    var params = P();
    if (!params || !bus || !store) return;
    params.commitModulation();
    bus.tick(dt);
    store.applyWires();
    if (state.tab === 'env' && state.canvas) paintEnv();
  }

  function boot() {
    if (!envEnabled()) return;
    mount();
  }

  window.SWR_REMO_PANEL = {
    enabled: envEnabled,
    mount: mount,
    tick: tick,
    snapshot: snapshotV2,
    applySnapshot: applySnapshot,
    migrateV1toV2: migrateV1toV2,
  };

  // Alias used by the NEON frame
  window.SWR_REMO = {
    get enabled() { return !!state.enabled; },
    tick: tick,
    mount: mount,
    snapshot: snapshotV2,
    applySnapshot: applySnapshot,
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
