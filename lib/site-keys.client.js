// lib/site-keys.client.js — sitewide keyboard shortcuts for the marketing +
// docs surfaces (the pages that load nav.client.js).
//
// Scope, deliberately tiny: six bindings, no per-page logic, no new UI. The
// engine surfaces already have a rich keymap (engine-keys.client.js, 16 pages);
// this layer is for the OTHER ~70 pages that have nothing at all today.
//
// It must never fight a page:
//   - ignores keystrokes in inputs / textareas / selects / contentEditable
//   - ignores anything with Ctrl / Meta / Alt held
//   - DEFERS to engine-keys: if window.SWR_KEYS exists, any key that registry
//     claims is skipped here (queried from its own help() list, so the two
//     cannot drift apart)
//   - if window.SWR_SITE_KEYS_DISABLE === true, the whole layer is inert
//     (the 5 pages with their own handlers can opt out without edits here)
//
// Bindings:
//   ?          toggle the shortcut help overlay
//   Esc        close the overlay
//   /          focus the nav's search field, when a page has one
//   T          toggle the light/dark theme (SWR_NAV.toggleTheme)
//   G then H   go home (/)
//   G then M   go to the music-video engine (/versions/music_video.html)
//
// Why 'G'-prefixed navigation instead of single letters: marketing pages are
// full of prose and users press lone letters to trigger the browser's find.
// The two-stroke prefix (the GitHub convention) keeps single keys free.
//
// Public API (window.SWR_SITE_KEYS):
//   .help()           — the binding table (used by the overlay + tests)
//   .isEnabled()      — false when the page opted out
//   .simulate(key)    — fire a keypress programmatically (tests / macros)
//   .showHelp() / .hideHelp()

(function () {
  'use strict';
  if (window.SWR_SITE_KEYS) return;

  var G_TIMEOUT_MS = 1200;   // how long the 'G' prefix stays armed

  // Single-key bindings. `match(ev, lower)` decides whether the binding owns
  // the keystroke; `action()` returns true when it handled it (which also
  // claims preventDefault). `keys` is display-only.
  var BINDINGS = [
    {
      keys: '?',
      label: 'Show this shortcut list',
      match: function (ev, lower) { return ev.key === '?' || (ev.shiftKey && ev.code === 'Slash'); },
      action: function () { showHelp(); return true; },
    },
    {
      keys: 'Esc',
      label: 'Close the shortcut list',
      match: function (ev) { return ev.key === 'Escape' && state.helpVisible; },
      action: function () { hideHelp(); return true; },
    },
    {
      keys: '/',
      label: 'Focus the nav search field',
      match: function (ev, lower) { return lower === '/' && !ev.shiftKey; },
      // A page with no search field does not own this key — let the browser
      // keep its own quick-find behaviour.
      action: function () {
        var el = findSearchInput();
        if (!el) return false;
        try { el.focus(); el.select(); } catch (_) { return false; }
        return true;
      },
    },
    {
      keys: 'T',
      label: 'Toggle light / dark theme',
      // Plain T only: Shift+T is left alone for future use / page chrome.
      match: function (ev, lower) { return lower === 't' && !ev.shiftKey; },
      action: function () {
        var nav = window.SWR_NAV;
        if (!nav || typeof nav.toggleTheme !== 'function') return false;
        try { nav.toggleTheme(); } catch (_) { return false; }
        return true;
      },
    },
  ];

  // Go-to sequences: press G, then one of these.
  var GOTO = {
    h: { target: '/', label: 'Go home' },
    m: { target: '/versions/music_video.html', label: 'Go to the music video engine' },
  };

  var state = { helpVisible: false, gArmedAt: 0 };
  var helpEl = null;

  // ---- guards ------------------------------------------------------------

  function isFormField(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
    return !!el.isContentEditable;
  }

  function isDisabled() {
    return window.SWR_SITE_KEYS_DISABLE === true;
  }

  // Keys claimed by engine-keys on this page (if it is loaded). Cached, since
  // the registry is static after load.
  var engineClaimed = null;
  function claimedByEngineKeys() {
    if (engineClaimed) return engineClaimed;
    engineClaimed = Object.create(null);
    try {
      var k = window.SWR_KEYS;
      if (k && typeof k.help === 'function') {
        var rows = k.help() || [];
        for (var i = 0; i < rows.length; i++) {
          var keys = String((rows[i] && rows[i].keys) || '');
          if (!keys) continue;
          // Rows look like 'Space', 'Shift+R', 'Cmd+Z', 'V', '?'. Register the
          // last token (the physical key) so 'V' here never shadows it.
          var parts = keys.split('+');
          var last = parts[parts.length - 1].trim().toLowerCase();
          if (last) engineClaimed[last] = true;
        }
      }
    } catch (_) {}
    return engineClaimed;
  }

  // engine-keys registers event.code-style names for some keys ('Slash',
  // 'Space', 'Escape'); normalise our display keys to the same vocabulary
  // before asking.
  var CODE_ALIAS = { '/': 'slash', '?': 'slash', esc: 'escape', escape: 'escape' };
  function engineOwns(key) {
    if (!window.SWR_KEYS) return false;
    var k = String(key).toLowerCase();
    var claimed = claimedByEngineKeys();
    return claimed[k] === true || (CODE_ALIAS[k] !== undefined && claimed[CODE_ALIAS[k]] === true);
  }

  function findSearchInput() {
    var sel = [
      'input[type="search"]',
      '.swr-nav__search input',
      '#nav-search',
      'input[data-nav-search]',
    ];
    for (var i = 0; i < sel.length; i++) {
      var el = document.querySelector(sel[i]);
      if (el) return el;
    }
    return null;
  }

  // ---- help overlay ------------------------------------------------------

  function help() {
    var rows = BINDINGS.map(function (b) { return { keys: b.keys, label: b.label }; });
    Object.keys(GOTO).forEach(function (k) {
      rows.push({ keys: 'G then ' + k.toUpperCase(), label: GOTO[k].label });
    });
    return rows;
  }

  function showHelp() {
    if (helpEl) { helpEl.style.display = ''; state.helpVisible = true; return; }
    helpEl = document.createElement('div');
    helpEl.id = 'swr-site-keys-help';
    helpEl.setAttribute('role', 'dialog');
    helpEl.setAttribute('aria-label', 'Keyboard shortcuts');
    helpEl.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'z-index:100000', 'min-width:300px', 'max-width:min(440px,92vw)',
      'background:rgba(10,6,18,0.97)', 'color:#f5e9ff',
      'border:1px solid #ff3d92', 'border-radius:12px',
      'padding:16px 18px',
      'font:12px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'box-shadow:0 18px 50px rgba(0,0,0,0.55)', 'user-select:none',
    ].join(';');
    var body = help().map(function (r) {
      return '<div style="display:flex;justify-content:space-between;gap:14px;padding:3px 0;border-bottom:1px solid rgba(255,61,146,0.08);">' +
               '<span style="color:#ff3d92;font-family:ui-monospace,monospace;flex-shrink:0;min-width:96px;">' + r.keys + '</span>' +
               '<span style="text-align:right;color:#ccc;">' + r.label + '</span>' +
             '</div>';
    }).join('');
    helpEl.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(255,61,146,0.4);">' +
        '<strong style="font-size:13px;letter-spacing:0.04em;">\u2328 SHORTCUTS</strong>' +
        '<span style="font-size:10px;color:#888;margin-left:auto;">esc to close</span>' +
      '</div>' + body;
    document.body.appendChild(helpEl);
    state.helpVisible = true;
  }

  function hideHelp() {
    if (helpEl) helpEl.style.display = 'none';
    state.helpVisible = false;
  }

  function goto(slot) {
    var g = GOTO[slot];
    if (!g) return false;
    try { window.location.assign(g.target); } catch (_) { return false; }
    return true;
  }

  // ---- dispatch ----------------------------------------------------------

  function handle(ev) {
    if (isDisabled()) return;
    if (isFormField(ev.target)) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

    var lower = typeof ev.key === 'string' ? ev.key.toLowerCase() : '';

    // 'G' prefix: arm, then the next key picks a destination.
    if (lower === 'g' && !ev.shiftKey && !engineOwns('g')) {
      state.gArmedAt = Date.now();
      if (ev.preventDefault) ev.preventDefault();
      return;
    }
    if (state.gArmedAt && (Date.now() - state.gArmedAt) <= G_TIMEOUT_MS) {
      state.gArmedAt = 0;
      if (GOTO[lower] && !engineOwns(lower)) {
        if (ev.preventDefault) ev.preventDefault();
        goto(lower);
        return;
      }
      // Not a destination — fall through and treat it as a normal key.
    }

    for (var i = 0; i < BINDINGS.length; i++) {
      var b = BINDINGS[i];
      if (!b.match(ev, lower)) continue;
      if (engineOwns(b.keys)) return;      // engine layer owns it on this page
      if (!b.action()) continue;           // page had no use for the key
      if (ev.preventDefault) ev.preventDefault();
      return;
    }
  }

  window.addEventListener('keydown', handle);

  window.SWR_SITE_KEYS = {
    help: help,
    isEnabled: function () { return !isDisabled(); },
    showHelp: showHelp,
    hideHelp: hideHelp,
    simulate: function (key) {
      handle({ key: key, code: '', target: null, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: function () {} });
    },
  };
})();
