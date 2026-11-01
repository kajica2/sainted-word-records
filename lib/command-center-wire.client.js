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
      credits: G.SWR_CREDITS || G.Credits
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

  // Explicit Save button injected into the Scenes panel.
  function injectSaveButton() {
    var host = $('[data-cc-scenes]');
    if (!host || host._saveInjected) return;
    var panel = host.closest('.swr-cc-panel');
    if (!panel) return;
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
      if (!api.scenes) return;
      var list = typeof api.scenes.list === 'function' ? api.scenes.list() : [];
      var idx = 0;
      for (var i = 0; i < list.length; i++) {
        if (!list[i] || !list[i].snapshot) { idx = i; break; }
      }
      if (typeof api.scenes.save === 'function') {
        try { api.scenes.save(idx); } catch (_) {}
      } else if (typeof api.scenes.startCapture === 'function') {
        try {
          api.scenes.startCapture(idx);
          if (api.scenes.cancelCapture) api.scenes.cancelCapture();
        } catch (_) {}
      }
      var status = $('[data-cc-mood-status]') || document.querySelector('.swr-cc-empty');
      if (status) status.textContent = 'Saved to scene ' + (idx + 1);
    });
    row.appendChild(btn);
    host.parentNode.insertBefore(row, host);
  }

  function tick() {
    if (!document.getElementById('swr-cc')) return;
    wireLibrary();
    wireRecordToggles();
    wireMoodApply();
    wireScenePads();
    injectSaveButton();
    refreshCredits();
  }

  function start() {
    setInterval(tick, 1500);
    tick();
  }

  window.SWR_CC_WIRE = { start: start, refreshCredits: refreshCredits };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    setTimeout(start, 400);
  }
})();
