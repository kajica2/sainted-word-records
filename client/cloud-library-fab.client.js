// client/cloud-library-fab.client.js — Floating Cloud-Library button.
//
// Renders a single round button anchored to the library panel on the
// engine page, plus a dropdown menu of push/pull/sync/watch actions.
// The widget is opt-in: the engine templates the FAB only when the
// `data-cloud-library="on"` attribute is present on the library panel
// (mirroring the SWR_USER_LIBRARY=on env var so prod deploys without
// Firestore configured never see this UI).
//
// The widget stays decoupled from `client/cloud-library.client.js` —
// it reads status from window.SWR_CLOUD_LIBRARY and emits commands
// back. If the module is missing, the FAB renders disabled with a
// tooltip explaining that the API isn't loaded.
//
// Mobile: the dropdown becomes a full-width bottom drawer (≤768px),
// anchored above the FAB. The FAB itself is the same 44×44 tap target
// on both form factors.

(() => {
  'use strict';
  if (window.SWR_CLOUD_LIB_FAB) return;
  // Wait for the page DOM (engine-templates the FAB via data attr).
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else { fn(); }
  }

  ready(function () {
    const panel = document.getElementById('library') ||
                  document.querySelector('[data-cloud-library]');
    if (!panel) return;
    if (!panel.hasAttribute('data-cloud-library')) return;

    const API = window.SWR_CLOUD_LIBRARY;
    const disabled = !API;

    // ---- DOM -----------------------------------------------------------

    const fab   = document.createElement('button');
    fab.className = 'cloud-fab';
    fab.id = 'cloud-fab';
    fab.type = 'button';
    fab.setAttribute('aria-haspopup', 'true');
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-label', disabled ? 'Cloud library (disabled — module not loaded)' : 'Cloud library');
    if (disabled) fab.disabled = true;
    fab.innerHTML = cloudSvg();

    const menu  = document.createElement('div');
    menu.className = 'cloud-menu';
    menu.id = 'cloud-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    menu.innerHTML = `
      <header class="cloud-menu__head">Cloud library</header>
      <button class="cloud-menu__row" role="menuitem" data-act="push">
        <span class="ico">↥</span><span class="lbl">Push library</span>
      </button>
      <button class="cloud-menu__row" role="menuitem" data-act="pull">
        <span class="ico">↧</span><span class="lbl">Pull library</span>
      </button>
      <button class="cloud-menu__row" role="menuitem" data-act="sync">
        <span class="ico">⟳</span><span class="lbl">Sync (push &amp; pull)</span>
      </button>
      <hr class="cloud-menu__hr">
      <label class="cloud-menu__toggle">
        <input type="checkbox" id="cloud-watch">
        <span>Watch (auto-sync)</span>
      </label>
      <footer class="cloud-menu__status" id="cloud-status">idle</footer>
    `;

    panel.appendChild(fab);
    panel.appendChild(menu);

    // ---- state bindings ------------------------------------------------

    function paintStatus() {
      if (!API) { setStatus('module not loaded'); return; }
      const s = API.getStatus();
      const verb = s.state === 'pushing' ? 'pushing…'
                 : s.state === 'pulling' ? 'pulling…'
                 : s.state === 'error'    ? 'error'
                 : s.lastSyncAt ? 'last sync ' + relTime(s.lastSyncAt)
                 : 'idle';
      const meta = s.count > 0 ? ` · ${s.count} assets` : '';
      const errTag = s.error ? ` · ${s.error.code || s.error.message || ''}` : '';
      setStatus(verb + meta + errTag);
      fab.classList.toggle('cloud-fab--active', s.state !== 'idle' && s.state !== 'error');
      fab.classList.toggle('cloud-fab--error',  s.state === 'error');
      const watch = menu.querySelector('#cloud-watch');
      if (watch && watch.checked !== s.watching) watch.checked = !!s.watching;
    }
    function setStatus(txt) {
      const el = menu.querySelector('#cloud-status');
      if (el) el.textContent = txt;
    }

    if (API) {
      paintStatus();
      try { API.subscribe(paintStatus); } catch (_) {}
    }

    // ---- open / close --------------------------------------------------

    let backdrop = null;
    function open() {
      if (disabled) return;
      menu.hidden = false;
      fab.setAttribute('aria-expanded', 'true');
      // Backdrop click closes the menu
      backdrop = document.createElement('div');
      backdrop.className = 'cloud-menu__backdrop';
      backdrop.addEventListener('click', close, { passive: true });
      document.body.appendChild(backdrop);
      // Tick the status so the user sees a fresh number after open.
      if (API) API.manifest().catch(() => {});
    }
    function close() {
      menu.hidden = true;
      fab.setAttribute('aria-expanded', 'false');
      if (backdrop) { backdrop.remove(); backdrop = null; }
    }

    fab.addEventListener('click', () => { menu.hidden ? open() : close(); });

    // ---- menu actions --------------------------------------------------

    menu.addEventListener('click', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.closest('[data-act]')) {
        const act = t.closest('[data-act]').dataset.act;
        if (!API) return;
        if (act === 'push') API.push(currentLocalItems()).catch(()=>{});
        else if (act === 'pull') API.pull().catch(()=>{});
        else if (act === 'sync') API.sync().catch(()=>{});
        close();
      } else if (t.id === 'cloud-watch') {
        if (API) API.setWatch(t.checked);
      }
    });

    // Keyboard: Esc closes
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !menu.hidden) close();
    });

    // ---- helpers -------------------------------------------------------

    function currentLocalItems() {
      const Lib = (window.Library && Array.isArray(window.Library.items)) ? window.Library.items : [];
      return Lib.slice();
    }
    function relTime(iso) {
      try {
        const t = new Date(iso).getTime();
        const dt = (Date.now() - t) / 1000;
        if (dt < 60)   return Math.max(0, Math.floor(dt)) + 's ago';
        if (dt < 3600) return Math.floor(dt / 60) + 'm ago';
        if (dt < 86400) return Math.floor(dt / 3600) + 'h ago';
        return Math.floor(dt / 86400) + 'd ago';
      } catch (_) { return '?'; }
    }
    function cloudSvg() {
      // Minimal cloud SVG — sized to fit 22×22 inside a 44×44 tap target
      return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">'
        + '<path d="M19 18H6a4 4 0 1 1 .9-7.9A6 6 0 0 1 19 11a4 4 0 0 1 0 7h0z" '
        + 'fill="currentColor"/></svg>';
    }
  });

  window.SWR_CLOUD_LIB_FAB = { ready: true };
})();
