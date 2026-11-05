// lib/engine-chrome-dock.client.js — one floating panel at a time on engine surfaces.
(function () {
  'use strict';
  if (window.SWR_CHROME_DOCK) return;

  function qs(id) { return document.getElementById(id); }

  function collapseDemo() {
    if (window.SWR_NEON_DEMO && typeof window.SWR_NEON_DEMO.collapse === 'function') {
      window.SWR_NEON_DEMO.collapse();
      return;
    }
    var root = qs('swr-neon-demo');
    if (!root || root.classList.contains('collapsed')) return;
    root.classList.add('collapsed');
    var toggle = root.querySelector('.swr-neon-demo-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function hideAutomixDebug() {
    var panel = qs('automix-debug-panel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    var btn = qs('automix-debug');
    if (btn) btn.setAttribute('aria-pressed', 'false');
  }

  function hideKeysHelp() {
    if (window.SWR_KEYS && typeof window.SWR_KEYS.hideHelp === 'function') {
      window.SWR_KEYS.hideHelp();
    } else {
      var help = qs('swr-keys-help');
      if (help) help.style.display = 'none';
    }
  }

  function polishPanels() {
    var dbg = qs('automix-debug-panel');
    if (dbg) dbg.classList.add('swr-chrome-panel');
  }

  function wireExclusive() {
    polishPanels();
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#swr-neon-demo .swr-neon-demo-toggle')) {
        hideAutomixDebug();
        hideKeysHelp();
        return;
      }
      if (t.closest('#automix-debug')) {
        collapseDemo();
        hideKeysHelp();
        return;
      }
      if (t.closest('#swr-keys-help-btn')) {
        collapseDemo();
        hideAutomixDebug();
      }
    }, true);
  }

  window.SWR_CHROME_DOCK = {
    collapseDemo: collapseDemo,
    hideAutomixDebug: hideAutomixDebug,
    hideKeysHelp: hideKeysHelp,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireExclusive, { once: true });
  } else {
    wireExclusive();
  }
})();
