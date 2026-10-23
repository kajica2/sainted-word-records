// client/engine-params.client.js
//
// SWR_PARAMS — the parameter bench.
//
// Every URL parameter the engine and the site read, what it applies to,
// the values it accepts, and what it actually does. Plus a URL builder
// that composes a set of them, and a readout of what the current page
// *resolved* rather than what was asked for.
//
// Mounts into any host, so it can live in a standalone page or in a card
// on the control centre:
//
//   SWR_PARAMS.mount(document.getElementById('params'));
//   SWR_PARAMS.unmount();
//
// The colours come from the host's own tokens (--bg-card, --text,
// --border, --accent) with the lab page's values as the fallback, so the
// bench looks native wherever it is mounted.

(function () {
  'use strict';
  if (window.SWR_PARAMS) return;

  // Every URL parameter the site and the engine read, with the pages it
  // applies to. `page` scopes it to one page; `pages` lists several.
  var PARAMS = [
    { name: 'swrdebug', page: '/versions/neon.html', values: ['1'],
      what: 'Injects the visual debugger and mounts it — live audio features, per-layer transforms, reactor wiring, and each layer\'s footprint drawn on the stage.' },
    { name: 'debug', page: '/engine', values: ['1'],
      what: 'Mounts the engine\'s own debug HUD — recent key presses, the active look filter, and a coarse audio and layer summary.' },
    { name: 'diag', page: '/engine', values: ['1'],
      what: 'Writes a read-only diagnostics payload into the document title: IDB state, FX state, active preset, transitions log, last audio error, music-theory features. For headless verifiers.' },
    { name: 'look', pages: ['/versions/neon.html', '/versions/film.html'], values: ['clean', 'film'],
      what: 'Look variant. clean is a light grade with a little grain; film is contrast-reduced, desaturated, sepia-tinted and grainier. Sets data-look on the document element.' },
    { name: 'tier', pages: ['/versions/neon.html', '/versions/film.html', '/engine'], values: ['low', 'medium', 'high'],
      what: 'Forces the device tier instead of detecting it. Tier decides the analysis resolution, the frame budget and how much the engine is allowed to spend per frame.' },
    { name: 'webgl', pages: ['/versions/neon.html', '/engine'], values: ['1', '0'],
      what: 'Forces WebGL on or off. 1 makes a test path assume a GPU is present; 0 makes it assume there is none, which is how CI exercises the fallback.' },
    { name: 'layout', page: '/engine', values: ['studio', 'wide', 'fullscreen'],
      what: 'Engine layout: the three-column studio, full-bleed wide, or a fullscreen field. Also remembered in localStorage under swr.layout.' },
    { name: 'automix', page: '/versions/music_video.html', values: ['1'],
      what: 'Starts the automix on load — it blends the clip stack against the music.' },
    { name: 'automix-debug', page: '/versions/music_video.html', values: ['1'],
      what: 'Opens the automix debug readout on load.' },
    { name: 'automix-frozen', page: '/versions/music_video.html', values: ['1'],
      what: 'Starts the automix frozen — the blend is held instead of following the music.' },
    { name: 'automix-locked', page: '/versions/music_video.html', values: ['1'],
      what: 'Starts the automix locked to the nearest anchor clip.' },
    { name: 'preset', page: '/versions.html', values: ['<preset id>'],
      what: 'Deep-links to a preset — the versions index opens straight onto it.' },
    { name: 'variant', page: '/engine', values: ['<variant name>'],
      what: 'Switches the engine to a named visual language on load.' },
    { name: 'id', page: '/personas', values: ['<persona id>'],
      what: 'Loads a specific persona. Without it the page takes the id from its path.' }
  ];

  var BASE_PAGES = [
    { path: '/versions/neon.html', label: 'neon — the demo variant' },
    { path: '/versions/film.html', label: 'film — a sibling variant' },
    { path: '/engine', label: 'engine — the main app' },
    { path: '/versions/music_video.html', label: 'music_video — the music video page' },
    { path: '/versions.html', label: 'versions — the variant index' },
    { path: '/personas', label: 'personas' }
  ];

  var STYLE_ID = 'swr-params-style';
  var CSS = [
    '.swr-params{--p-surface:var(--bg-card,var(--bg-2,#161310));--p-ink:var(--text,var(--ink,#f5ead8));',
    '--p-dim:var(--text-dim,var(--muted,#8a7a66));--p-line:var(--border,var(--line,#2c2419));',
    '--p-accent:var(--accent,var(--blue,#3b82f6));color:var(--p-ink);font-size:12px;line-height:1.5}',
    '.swr-params a{color:var(--p-accent);text-decoration:none}',
    '.swr-params a:hover{text-decoration:underline}',
    '.swr-params h3{font-size:13px;margin:0 0 10px;font-weight:600}',
    '.swr-params .p-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}',
    '@media (max-width:900px){.swr-params .p-cols{grid-template-columns:1fr}}',
    '.swr-params .p-block{border:1px solid var(--p-line);border-radius:6px;padding:12px}',
    '.swr-params .p-label{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--p-dim);margin-bottom:8px}',
    '.swr-params .p-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-top:1px dashed var(--p-line)}',
    '.swr-params .p-row:first-of-type{border-top:none}',
    '.swr-params .p-name{width:96px;flex:none;color:var(--p-dim)}',
    '.swr-params select{background:transparent;color:var(--p-ink);border:1px solid var(--p-line);',
    'border-radius:4px;padding:4px 6px;font:inherit;font-size:11px}',
    '.swr-params .p-url{margin-top:10px;padding:9px 10px;border:1px solid var(--p-line);border-radius:4px;',
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;word-break:break-all}',
    '.swr-params .p-actions{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}',
    '.swr-params .p-btn{background:var(--p-accent);color:#fff;border:none;border-radius:4px;',
    'padding:6px 12px;font:inherit;font-size:11px;cursor:pointer}',
    '.swr-params .p-btn--ghost{background:transparent;color:var(--p-ink);border:1px solid var(--p-line)}',
    '.swr-params .p-note{color:var(--p-dim);font-size:11px;margin-top:8px}',
    '.swr-params table{width:100%;border-collapse:collapse;font-size:11px}',
    '.swr-params th{text-align:left;font-size:9px;letter-spacing:.1em;text-transform:uppercase;',
    'color:var(--p-dim);font-weight:600;padding:0 8px 6px 0;border-bottom:1px solid var(--p-line)}',
    '.swr-params td{padding:7px 8px 7px 0;border-bottom:1px solid var(--p-line);vertical-align:top;color:var(--p-dim)}',
    '.swr-params tr:last-child td{border-bottom:none}',
    '.swr-params td.p-k{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--p-ink);white-space:nowrap}',
    '.swr-params td.p-v{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;white-space:nowrap}',
    '.swr-params .p-here{display:inline-block;background:var(--p-accent);color:#fff;border-radius:3px;',
    'padding:1px 5px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;margin-left:6px}',
    '.swr-params .p-live{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--p-dim)}'
  ].join('');

  var state = { host: null, root: null, els: {}, controls: [] };

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function appliesTo(p, path) {
    if (p.page) return p.page === path;
    if (p.pages) return p.pages.indexOf(path) !== -1;
    return false;
  }

  function currentParams() {
    try { return new URLSearchParams(location.search); } catch (_) { return new URLSearchParams(); }
  }

  function buildUrl() {
    var path = state.base || BASE_PAGES[0].path;
    var parts = [];
    state.controls.forEach(function (c) {
      if (c.select.value) parts.push(encodeURIComponent(c.name) + '=' + encodeURIComponent(c.select.value));
    });
    return location.origin + path + (parts.length ? '?' + parts.join('&') : '');
  }

  function update() {
    if (!state.els.url) return;
    state.els.url.textContent = buildUrl();
    var set = state.controls.filter(function (c) { return !!c.select.value; }).length;
    state.els.note.textContent = state.controls.length + ' parameter' + (state.controls.length === 1 ? '' : 's') +
      ' apply to ' + (state.base || '') + ' — ' + set + ' set.';
  }

  function renderControls() {
    var path = state.base;
    state.els.controls.innerHTML = '';
    state.controls = [];
    PARAMS.filter(function (p) { return appliesTo(p, path); }).forEach(function (p) {
      var row = el('div', 'p-row');
      row.appendChild(el('span', 'p-name', p.name));
      var sel = el('select');
      var off = el('option', null, '— not set —');
      off.value = '';
      sel.appendChild(off);
      p.values.forEach(function (v) {
        var o = el('option', null, v);
        o.value = v;
        sel.appendChild(o);
      });
      var cur = currentParams().get(p.name);
      if (cur && p.values.indexOf(cur) !== -1) sel.value = cur;
      sel.addEventListener('change', update);
      row.appendChild(sel);
      state.els.controls.appendChild(row);
      state.controls.push({ name: p.name, select: sel });
    });
    update();
  }

  function renderTable() {
    var body = state.els.rows;
    body.innerHTML = '';
    var here = currentParams();
    PARAMS.forEach(function (p) {
      var tr = el('tr');

      var name = el('td', 'p-k');
      name.appendChild(document.createTextNode('?' + p.name));
      if (here.get(p.name)) {
        var badge = el('span', 'p-here', 'here');
        name.appendChild(badge);
      }
      tr.appendChild(name);

      tr.appendChild(el('td', null, p.page || (p.pages || []).join(', ')));
      tr.appendChild(el('td', 'p-v', p.values.join(' | ')));
      tr.appendChild(el('td', null, p.what));

      var tryCell = el('td');
      var target = p.page || (p.pages && p.pages[0]) || '/versions/neon.html';
      var a = el('a', null, 'open with ?' + p.name + '=' + p.values[0]);
      a.href = target + '?' + p.name + '=' + encodeURIComponent(p.values[0]);
      a.target = '_blank';
      a.rel = 'noopener';
      tryCell.appendChild(a);
      tr.appendChild(tryCell);

      body.appendChild(tr);
    });
  }

  function pageIsEnginePage() {
    var here = location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    return BASE_PAGES.some(function (b) {
      var bp = b.path.replace(/\.html$/, '').replace(/\/+$/, '');
      return bp === here;
    });
  }

  function renderLive() {
    // Mounted on the control centre, the bench still builds URLs and lists
    // the parameters — but there is nothing here to "resolve", so say so
    // rather than showing an empty readout.
    if (!pageIsEnginePage()) {
      state.els.live.textContent = 'this page reads no engine parameters';
      state.els.resolved.textContent = 'open an engine page with a parameter to see what it resolved';
      if (state.els.reload) state.els.reload.style.display = 'none';
      return;
    }
    if (state.els.reload) state.els.reload.style.display = '';

    var p = currentParams();
    var lines = [];
    PARAMS.forEach(function (param) {
      if (p.has(param.name)) lines.push('?' + param.name + '=' + p.get(param.name));
    });
    state.els.live.textContent = lines.length ? lines.join('  ') : 'no parameters on this page';

    var resolved = [];
    try {
      if (window.SWR_TIER) resolved.push('tier=' + (window.SWR_TIER.profile || window.SWR_TIER.name || '?'));
    } catch (_) {}
    try {
      var look = document.documentElement.getAttribute('data-look');
      if (look) resolved.push('look=' + look);
    } catch (_) {}
    try {
      if (window.__swrLayout) resolved.push('layout=' + window.__swrLayout);
    } catch (_) {}
    try {
      if (window.SWR_DEBUGGER) resolved.push('debugger=mounted');
    } catch (_) {}
    try {
      if (window.SWR_DEBUG_OVERLAY) resolved.push('engine-debug=mounted');
    } catch (_) {}
    state.els.resolved.textContent = resolved.length ? resolved.join('  ') : 'nothing resolved on this page';
  }

  function mount(host, opts) {
    if (!host) return null;
    if (state.host === host && state.root) return state.root;
    unmount();
    injectStyle();

    opts = opts || {};
    var root = el('div', 'swr-params');
    host.appendChild(root);
    state.host = host;
    state.root = root;

    var cols = el('div', 'p-cols');

    // ---- build ----
    var build = el('div', 'p-block');
    build.appendChild(el('div', 'p-label', 'Build'));
    build.appendChild(el('h3', null, 'Compose a URL'));

    var baseRow = el('div', 'p-row');
    baseRow.appendChild(el('span', 'p-name', 'base page'));
    var base = el('select');
    BASE_PAGES.forEach(function (b) {
      var o = el('option', null, b.label);
      o.value = b.path;
      base.appendChild(o);
    });
    state.base = opts.base || BASE_PAGES[0].path;
    base.value = state.base;
    base.addEventListener('change', function () {
      state.base = base.value;
      renderControls();
    });
    baseRow.appendChild(base);
    build.appendChild(baseRow);

    var controls = el('div');
    build.appendChild(controls);

    var url = el('div', 'p-url', '—');
    build.appendChild(url);

    var actions = el('div', 'p-actions');
    var openBtn = el('button', 'p-btn', 'Open');
    openBtn.addEventListener('click', function () { location.href = buildUrl(); });
    var copyBtn = el('button', 'p-btn p-btn--ghost', 'Copy');
    copyBtn.addEventListener('click', function () {
      var u = buildUrl();
      if (navigator.clipboard) navigator.clipboard.writeText(u);
      var was = copyBtn.textContent;
      copyBtn.textContent = 'Copied';
      setTimeout(function () { copyBtn.textContent = was; }, 1200);
    });
    var resetBtn = el('button', 'p-btn p-btn--ghost', 'Reset');
    resetBtn.addEventListener('click', function () {
      state.controls.forEach(function (c) { c.select.value = ''; });
      update();
    });
    actions.appendChild(openBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(resetBtn);
    build.appendChild(actions);

    var note = el('div', 'p-note', '');
    build.appendChild(note);

    // ---- this page ----
    var liveBlock = el('div', 'p-block');
    liveBlock.appendChild(el('div', 'p-label', 'This page'));
    liveBlock.appendChild(el('h3', null, 'What is live right now'));
    var live = el('div', 'p-live', '—');
    var liveResolved = el('div', 'p-live', '—');
    liveResolved.style.marginTop = '8px';
    liveBlock.appendChild(live);
    liveBlock.appendChild(liveResolved);
    var reloadBtn = el('button', 'p-btn p-btn--ghost', 'Reload with the same parameters');
    reloadBtn.style.marginTop = '10px';
    reloadBtn.addEventListener('click', function () { location.reload(); });
    liveBlock.appendChild(reloadBtn);

    cols.appendChild(build);
    cols.appendChild(liveBlock);
    root.appendChild(cols);

    // ---- reference ----
    var ref = el('div', 'p-block');
    ref.style.marginTop = '16px';
    ref.appendChild(el('div', 'p-label', 'Reference'));
    ref.appendChild(el('h3', null, 'All parameters'));
    var table = el('table');
    var thead = el('thead');
    var htr = el('tr');
    ['Parameter', 'Applies to', 'Values', 'What it does', 'Try'].forEach(function (h) {
      htr.appendChild(el('th', null, h));
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    var tbody = el('tbody');
    table.appendChild(tbody);
    ref.appendChild(table);
    root.appendChild(ref);

    state.els = { controls: controls, url: url, note: note, live: live, resolved: liveResolved, rows: tbody, reload: reloadBtn };
    state.controls = [];

    renderControls();
    renderTable();
    renderLive();

    // Keep the "this page" readout honest if the page navigates.
    window.addEventListener('popstate', renderLive);

    return root;
  }

  function unmount() {
    if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
    state.root = null;
    state.host = null;
    state.els = {};
    state.controls = [];
  }

  window.SWR_PARAMS = {
    mount: mount,
    unmount: unmount,
    data: PARAMS,
    basePages: BASE_PAGES,
    version: '1.0.0',
  };
})();
