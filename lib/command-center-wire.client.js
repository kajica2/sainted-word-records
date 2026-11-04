// lib/command-center-wire.client.js
// Completes remaining UI → API bindings on the Studio Command Center.
// Loaded by the launcher after the main Command Center. Classic script.

(function () {
  'use strict';
  if (window.SWR_CC_WIRE) return;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function resolve() {
    var G = window;
    var swr = G.SWR || {};
    return {
      library: G.Library || swr.Library,
      mood: G.SWR_MOOD,
      scenes: G.SWR_SCENES,
      watermark: G.SWR_WATERMARK,
      credits: G.SWR_CREDITS || G.Credits,
      user: G.SWR_USER || G.User
    };
  }

  function wireLibrary() {
    var host = $('[data-cc-library]');
    if (!host || host._wired) return;
    host._wired = true;
    host.addEventListener('click', function (e) {
      var row = e.target.closest('.swr-cc-lib-row');
      if (!row) return;
      var idx = Array.prototype.indexOf.call(host.children, row);
      var api = resolve();
      var items = (api.library && api.library.items) || [];
      var item = items[idx];
      if (!item) return;
      if (typeof api.library.load === 'function') {
        try { api.library.load(item); } catch (_) {}
      } else if (typeof api.library.select === 'function') {
        try { api.library.select(idx); } catch (_) {}
      }
      $$('.swr-cc-lib-row', host).forEach(function (r, i) {
        r.style.outline = i === idx ? '1px solid #ff9a4d' : '';
      });
    });
  }

  function wireRecordToggles() {
    $$('[data-cc-toggle]').forEach(function (btn) {
      if (btn._wired) return;
      btn._wired = true;
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-cc-toggle');
        var next = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', next ? 'true' : 'false');
        var api = resolve();
        if (key === 'watermark' && api.watermark) {
          if (typeof api.watermark.setEnabled === 'function') api.watermark.setEnabled(next);
          else api.watermark.enabled = next;
        }
        if (key === 'credits' && api.credits && typeof api.credits.setEnabled === 'function') {
          api.credits.setEnabled(next);
        }
      });
    });
  }

  function refreshCredits() {
    var el = $('[data-cc-credits]');
    if (!el) return;
    var api = resolve();
    var val = '—';
    if (api.credits) {
      if (typeof api.credits.balance === 'function') {
        try { val = String(api.credits.balance()); } catch (_) {}
      } else if (typeof api.credits.balance === 'number') {
        val = String(api.credits.balance);
      }
    }
    el.textContent = val;
  }

  function wireMoodApply() {
    var btn = $('[data-cc-mood-apply]');
    if (!btn || btn._wired) return;
    btn._wired = true;
    btn.addEventListener('click', function () {
      var api = resolve();
      if (api.mood && typeof api.mood.applySuggestion === 'function') {
        try { api.mood.applySuggestion(); } catch (_) {}
      }
    });
  }

  function wireScenePads() {
    $$('[data-cc-scene]').forEach(function (pad) {
      if (pad._wired) return;
      pad._wired = true;
      pad.addEventListener('click', function () {
        var id = pad.getAttribute('data-cc-scene');
        var api = resolve();
        if (api.scenes && typeof api.scenes.recall === 'function') {
          try { api.scenes.recall(id); } catch (_) {}
        }
      });
    });
  }

  function injectSaveButton() {
    var host = $('[data-cc-scenes]');
    if (!host || host._saveInjected) return;
    host._saveInjected = true;
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin:6px 0';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swr-cc-btn swr-cc-btn--primary';
    btn.textContent = 'Save';
    btn.title = 'Save current state to the next empty scene pad';
    btn.addEventListener('click', function () {
      var api = resolve();
      if (!api.scenes || typeof api.scenes.save !== 'function' || typeof api.scenes.list !== 'function') {
        btn.title = 'Scene saving is unavailable';
        return;
      }
      var list;
      try { list = api.scenes.list(); } catch (_) { return; }
      if (!Array.isArray(list)) return;
      var idx = list.findIndex(function (scene) { return !scene || !scene.snapshot; });
      if (idx < 0) {
        btn.title = 'All scene pads are full; recall or clear a pad before saving';
        if (typeof window.setStatus === 'function') window.setStatus('all scene pads are full', 'error');
        return;
      }
      try {
        if (api.scenes.save(idx) !== true) {
          if (typeof window.setStatus === 'function') window.setStatus('could not save scene', 'error');
          return;
        }
        if (typeof window.setStatus === 'function') window.setStatus('saved scene ' + (idx + 1), 'ok');
      } catch (_) {
        if (typeof window.setStatus === 'function') window.setStatus('could not save scene', 'error');
      }
    });
    row.appendChild(btn);
    host.parentNode.insertBefore(row, host);
  }

  // Settings + Profile in the top bar. Re-injects if the shell is rebuilt.
  function injectTopBarActions() {
    var top = document.querySelector('.swr-cc-top');
    if (!top) return;
    if (top.querySelector('.swr-cc-top-actions')) return;

    var actions = document.createElement('div');
    actions.className = 'swr-cc-top-actions';
    actions.style.cssText = 'display:flex;gap:8px;margin-left:auto;align-items:center;padding-right:8px';

    function makeBtn(label, onClick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swr-cc-nav-btn';
      b.textContent = label;
      b.style.cssText = 'font-size:11px;padding:4px 10px;opacity:.85';
      b.addEventListener('click', onClick);
      return b;
    }

    var settings = makeBtn('Settings', function () {
      if (window.SWR_SETTINGS && typeof window.SWR_SETTINGS.open === 'function') {
        try { window.SWR_SETTINGS.open(); return; } catch (_) {}
      }
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:20000;display:flex;align-items:center;justify-content:center';
      var box = document.createElement('div');
      box.style.cssText = 'background:#1b130c;border:1px solid rgba(255,176,102,.4);border-radius:10px;padding:20px;color:#f4e7d6;max-width:320px';
      box.innerHTML = '<h3 style="margin:0 0 8px">Settings</h3><p style="font-size:12px;opacity:.8">Settings panel not wired on this surface yet.</p><button style="margin-top:10px;padding:6px 12px;border:0;border-radius:6px;background:#ff9a4d;color:#1a0f06;cursor:pointer">Close</button>';
      box.querySelector('button').onclick = function () { overlay.remove(); };
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });

    var profile = makeBtn('Profile', function () {
      var api = resolve();
      if (api.user && typeof api.user.open === 'function') {
        try { api.user.open(); return; } catch (_) {}
      }
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:20000;display:flex;align-items:center;justify-content:center';
      var box = document.createElement('div');
      box.style.cssText = 'background:#1b130c;border:1px solid rgba(255,176,102,.4);border-radius:10px;padding:20px;color:#f4e7d6;max-width:320px';
      box.innerHTML = '<h3 style="margin:0 0 8px">Profile</h3><p style="font-size:12px;opacity:.8">Sign in to view account details and credits.</p><button style="margin-top:10px;padding:6px 12px;border:0;border-radius:6px;background:#ff9a4d;color:#1a0f06;cursor:pointer">Close</button>';
      box.querySelector('button').onclick = function () { overlay.remove(); };
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });

    actions.appendChild(settings);
    actions.appendChild(profile);

    var close = top.querySelector('.swr-cc-close');
    if (close) top.insertBefore(actions, close);
    else top.appendChild(actions);
  }

  function tick() {
    if (!document.getElementById('swr-cc')) return;
    wireLibrary();
    wireRecordToggles();
    wireMoodApply();
    wireScenePads();
    injectSaveButton();
    injectTopBarActions();
    refreshCredits();
  }

  function start() {
    setInterval(tick, 800);
    tick();
    // Also re-check after a short delay in case the shell builds late.
    setTimeout(tick, 200);
    setTimeout(tick, 1200);
  }

  window.SWR_CC_WIRE = { start: start, refreshCredits: refreshCredits, injectTopBarActions: injectTopBarActions };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    setTimeout(start, 100);
  }
})();
