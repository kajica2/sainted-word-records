// lib/personal-presets.client.js — SWR_PRESETS_PERSONAL
//
// Per-user saved filters built on engine-genops.client.js's
// snapshot()/restore() API. Each filter captures the FX preset,
// per-layer config (blend, opacity, hue, brightness, ...), and
// reactors. Storage: localStorage with key swr:personal:presets:v1.
// Schema is JSON-safe; export/import roundtrips for sharing.
//
// Public surface:
//   SWR_PRESETS_PERSONAL = {
//     list():        [{ name, at, snapshot }, ...]
//     save(name):    capture current → store
//     apply(name):   restore → apply to engine
//     delete(name):  remove
//     rename(from, to): atomic rename
//     exportJson():    JSON.stringify payload
//     importJson(str): load JSON → replace current list
//     count():        number of saved filters
//     open():         show picker (mobile-first bottom-sheet)
//     close():        hide picker
//     isOpen():       boolean
//   }
//
// Loads after engine-genops.client.js so window.SWR_GENOPS is available.

(function () {
  if (window.SWR_PRESETS_PERSONAL) return;

  var STORAGE_KEY = 'swr:personal:presets:v1';

  function readAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (_) { return []; }
  }

  function writeAll(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); return true; }
    catch (_) { return false; }
  }

  function safeName(name) {
    var s = String(name || '').trim().slice(0, 48);
    return s || 'untitled';
  }

  function uniqueName(base, list) {
    var taken = new Set(list.map(function (p) { return p.name; }));
    if (!taken.has(base)) return base;
    for (var i = 2; taken.has(base + ' (' + i + ')'); i++);
    return base + ' (' + i + ')';
  }

  function snapshot() {
    var G = window.SWR_GENOPS;
    if (!G || typeof G._snapshot !== 'function') return null;
    return G._snapshot();
  }

  function restore(p) {
    var G = window.SWR_GENOPS;
    if (!G || typeof G._restore !== 'function') return false;
    return G._restore(p);
  }

  function save(name) {
    var list = readAll();
    var base = safeName(name);
    var finalName = uniqueName(base, list);
    var snap = snapshot();
    if (!snap) return null;
    list.push({ name: finalName, at: Date.now(), snapshot: snap });
    if (!writeAll(list)) return null;
    refreshUI();
    return finalName;
  }

  function apply(name) {
    var list = readAll();
    var entry = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) { entry = list[i]; break; }
    }
    if (!entry) return false;
    return !!restore(entry.snapshot);
  }

  function delete_(name) {
    var list = readAll();
    var next = list.filter(function (p) { return p.name !== name; });
    if (next.length === list.length) return false;
    writeAll(next);
    refreshUI();
    return true;
  }

  function rename(from, to) {
    var list = readAll();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === from) { idx = i; break; }
    }
    if (idx < 0) return false;
    var base = safeName(to);
    var finalName = (from === base) ? base : uniqueName(base, list.filter(function (_, j) { return j !== idx; }));
    list[idx] = Object.assign({}, list[idx], { name: finalName, at: Date.now() });
    writeAll(list);
    refreshUI();
    return finalName;
  }

  function list() { return readAll().slice(); }

  function count() { return readAll().length; }

  function exportJson() {
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      presets: readAll(),
    }, null, 2);
  }

  function importJson(str) {
    try {
      var v = JSON.parse(str);
      if (!v || !Array.isArray(v.presets)) throw new Error('not a presets payload');
      writeAll(v.presets);
      refreshUI();
      return v.presets.length;
    } catch (e) { return null; }
  }

  // Mobile-first bottom-sheet picker UI
  var host = null;
  var listEl = null;
  var open = false;

  function ensureStyles() {
    if (document.getElementById('swr-presets-personal-css')) return;
    var s = document.createElement('style');
    s.id = 'swr-presets-personal-css';
    s.textContent =
      '.swr-presets-personal{position:fixed;left:0;right:0;bottom:0;display:none;flex-direction:column;max-height:70dvh;background:var(--panel,#13131a);color:var(--fg,#e8e8f0);font-family:system-ui,-apple-system,sans-serif;border-top-left-radius:16px;border-top-right-radius:16px;box-shadow:0 -8px 32px rgba(0,0,0,0.5);z-index:9995;padding:14px 16px max(16px,env(safe-area-inset-bottom,0px));animation:swr-presets-sheet-up 0.24s cubic-bezier(0.32,0.72,0,1)}' +
      '.swr-presets-personal.open{display:flex}' +
      '@keyframes swr-presets-sheet-up{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}' +
      '.swr-presets-personal .pp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.06)}' +
      '.swr-presets-personal .pp-head h3{margin:0;font-size:14px;font-weight:600}' +
      '.swr-presets-personal .pp-list{list-style:none;padding:0;margin:0;overflow-y:auto;max-height:50vh}' +
      '.swr-presets-personal .pp-list li{display:flex;align-items:center;gap:10px;padding:12px 8px;border-bottom:1px solid rgba(255,255,255,0.04);min-height:48px}' +
      '.swr-presets-personal .pp-list li:last-child{border-bottom:none}' +
      '.swr-presets-personal .pp-list .name{flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.swr-presets-personal .pp-list .meta{font-size:11px;opacity:0.55}' +
      '.swr-presets-personal button{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:inherit;border-radius:4px;padding:0 12px;min-height:36px;font-size:12px;cursor:pointer}' +
      '.swr-presets-personal button:hover{background:rgba(255,255,255,0.12)}' +
      '.swr-presets-personal button.primary{background:var(--accent,#ff3d92);color:#fff;border-color:var(--accent)}' +
      '.swr-presets-personal .pp-empty{padding:24px;text-align:center;opacity:0.6}' +
      '.swr-presets-personal .pp-form{display:flex;gap:6px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);margin-top:8px}' +
      '.swr-presets-personal input{flex:1;min-height:36px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);color:inherit;border-radius:4px;padding:0 10px;font-size:13px}' +
      '@media (prefers-reduced-motion:reduce){.swr-presets-personal{animation:none}}' +
      '.swr-presets-personal::before{content:"";width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,0.18);margin:0 auto 8px}';
    document.head.appendChild(s);
  }

  function buildHost() {
    var wrap = document.createElement('div');
    wrap.className = 'swr-presets-personal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Personal filter presets');

    var head = document.createElement('div');
    head.className = 'pp-head';
    var h = document.createElement('h3');
    h.textContent = 'Personal presets';
    head.appendChild(h);
    var close = document.createElement('button');
    close.textContent = '\u00d7';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeSheet);
    head.appendChild(close);
    wrap.appendChild(head);

    listEl = document.createElement('ul');
    listEl.className = 'pp-list';
    listEl.setAttribute('aria-label', 'Saved presets');
    wrap.appendChild(listEl);

    var form = document.createElement('div');
    form.className = 'pp-form';
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Save current as\u2026';
    input.id = 'swr-presets-personal-name';
    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'primary';
    saveBtn.addEventListener('click', function () {
      var name = input.value.trim();
      if (!name) return;
      var finalName = save(name);
      if (finalName) { input.value = ''; renderList(); }
    });
    form.appendChild(input);
    form.appendChild(saveBtn);
    wrap.appendChild(form);

    return wrap;
  }

  function renderList() {
    if (!listEl) return;
    var items = readAll();
    listEl.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'pp-empty';
      empty.textContent = 'No saved presets yet \u2014 give your current setup a memorable name above.';
      listEl.appendChild(empty);
      return;
    }
    for (var i = items.length - 1; i >= 0; i--) {
      var p = items[i];
      var li = document.createElement('li');

      var info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = p.name;
      info.appendChild(name);
      var meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = new Date(p.at).toLocaleString();
      info.appendChild(meta);

      var applyBtn = document.createElement('button');
      applyBtn.textContent = 'Apply';
      applyBtn.className = 'primary';
      applyBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        apply(p.name);
        closeSheet();
      });

      var delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        delete_(p.name);
        renderList();
      });

      li.appendChild(info);
      li.appendChild(applyBtn);
      li.appendChild(delBtn);
      listEl.appendChild(li);
    }
  }

  function openSheet() {
    if (open) return;
    ensureStyles();
    if (!host || !host.isConnected) {
      host = buildHost();
      document.body.appendChild(host);
    }
    host.classList.add('open');
    host.style.display = 'flex';
    open = true;
    renderList();
    setTimeout(function () {
      document.addEventListener('click', backdropClick, { capture: true });
    }, 0);
  }

  function backdropClick(e) {
    if (!open) return;
    if (host && host.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#swr-presets-personal-toggle')) return;
    closeSheet();
  }

  function closeSheet() {
    if (!open) return;
    if (host) {
      host.classList.remove('open');
      host.style.display = 'none';
    }
    open = false;
    document.removeEventListener('click', backdropClick, { capture: true });
  }

  function refreshUI() {
    if (open) renderList();
  }

  function ensureToggle() {
    var btn = document.getElementById('swr-presets-personal-toggle');
    if (btn && btn.isConnected) return btn;
    btn = document.createElement('button');
    btn.id = 'swr-presets-personal-toggle';
    btn.textContent = '\u2605 Presets';
    btn.title = 'Personal filter presets (per-user)';
    btn.style.cssText = 'background:var(--panel-2);border:1px solid var(--line);color:var(--fg);padding:0 12px;min-height:36px;border-radius:4px;cursor:pointer;font-size:11px;font-family:var(--font-mono);';
    btn.addEventListener('click', function () { open ? closeSheet() : openSheet(); });
    var helpBtn = document.getElementById('swr-keys-help-btn');
    if (helpBtn && helpBtn.parentNode) {
      helpBtn.parentNode.insertBefore(btn, helpBtn);
    } else {
      document.body.appendChild(btn);
    }
    return btn;
  }

  window.SWR_PRESETS_PERSONAL = {
    list: list, save: save, apply: apply, delete: delete_, rename: rename,
    exportJson: exportJson, importJson: importJson, count: count,
    open: openSheet, close: closeSheet, isOpen: function () { return open; },
    _ensureToggle: ensureToggle
  };

  function autoMount() {
    if (!window.SWR_GENOPS || !window.SWR_KEYS) return false;
    ensureToggle();
    return true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(autoMount, 200); });
  } else {
    setTimeout(autoMount, 200);
  }
})();
