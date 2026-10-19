// lib/version-watcher.client.js — proactive stale-page detector.
//
// Catches the case where a user has the engine open across a deploy:
// the version chrome (lib/app-version-bust.js) only fires on page
// load, the SW update toast only fires when the SW itself updates,
// and a user who never reloads would otherwise see the old version
// indefinitely. This module polls /lib/app-version.js every 60s
// while the tab is visible, and once on tab focus. A version
// mismatch shows the same top-right toast the PWA uses for SW
// updates, so the visual language is consistent and the click
// handler reuses the existing SKIP_WAITING + reload flow.
//
// Order in the page: this script must load AFTER pwa-bootstrap.js
// (or whichever module injects the .pwa-update-toast styles) so the
// toast inherits the existing glassmorphism styling. The codemod
// injects this immediately after /lib/version-badge.client.js.
(function () {
  'use strict';
  if (window.SWR_VERSION_WATCHER) return;
  window.SWR_VERSION_WATCHER = true;

  const POLL_MS = 60_000;
  const VERSION_URL = '/lib/app-version.js';
  // The version we observed at page load. May be 'dev' in `npm run dev`.
  const currentVersion = window.SWR_APP_VERSION;

  // Bail in dev — no point polling a dev server for "new versions"
  // (every save re-emits a new build artifact with a fresh timestamp).
  if (currentVersion === 'dev' || currentVersion === undefined) return;

  // Bail if the SW update flow is not active. The pwa-bootstrap.js
  // script (or the engine's own registration) is the producer of
  // .pwa-update-toast styles. Without it the toast is unstyled.
  if (!('serviceWorker' in navigator)) return;

  let toastEl = null;
  let lastSeen = currentVersion;
  let dismissedFor = null;
  let pollTimer = null;

  function parseVersion(text) {
    // The file is the auto-generated Vite output:
    //   window.SWR_APP_VERSION = "2026.10.13.1";
    // Extract the string literal without eval.
    const m = text.match(/window\.SWR_APP_VERSION\s*=\s*["']([^"']+)["']/);
    return m ? m[1] : null;
  }

  async function check() {
    if (document.visibilityState !== 'visible') return;
    try {
      const res = await fetch(VERSION_URL, { cache: 'no-store' });
      if (!res || !res.ok) return;
      const text = await res.text();
      const next = parseVersion(text);
      if (!next || next === lastSeen) return;
      // Version changed since the last check (or since page load).
      lastSeen = next;
      // If the user already dismissed the toast for this exact
      // version, don't re-show. If a *newer* version has shipped,
      // the user should know.
      if (next === dismissedFor) return;
      showToast(next);
    } catch (_) {
      // Offline / network error — silently ignore. The next tick
      // will try again. The version bust on next page load is the
      // safety net.
    }
  }

  function showToast(nextVersion) {
    if (toastEl) return;  // already showing
    toastEl = document.createElement('div');
    toastEl.className = 'pwa-update-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-label', 'New version available, click to refresh');
    toastEl.style.display = 'block';
    toastEl.innerHTML = '<span class="pwa-refresh">↻ new version</span> · refresh';

    const reload = async () => {
      // If the SW has a waiting worker, let it take over first so the
      // new bundle is in place by the time the reload lands. The
      // existing pwa-bootstrap.js controllerchange listener will also
      // reload; this is the explicit path.
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            // Give the new worker a tick to claim, then reload.
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      } catch (_) { /* noop */ }
      try { localStorage.setItem('swr_app_version_seen', nextVersion); } catch (_) {}
      location.reload();
    };

    // Dismiss handler: hide the toast but track the version we
    // dismissed FOR so a subsequent newer version can still re-show.
    const dismiss = () => {
      dismissedFor = nextVersion;
      if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
      toastEl = null;
    };

    // Right-click or Escape to dismiss without reloading.
    toastEl.addEventListener('contextmenu', (e) => { e.preventDefault(); dismiss(); });
    toastEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });
    toastEl.tabIndex = 0;  // focusable for keyboard
    toastEl.addEventListener('click', reload);
    document.body.appendChild(toastEl);
  }

  function start() {
    // Page lifecycle hooks.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    window.addEventListener('focus', check);

    // 60s tick — only checks when the tab is visible (the function
    // early-returns otherwise).
    pollTimer = setInterval(check, POLL_MS);

    // Stop polling when the page is about to be unloaded; otherwise
    // we'd leak timers during a fast navigate.
    window.addEventListener('beforeunload', () => {
      if (pollTimer) clearInterval(pollTimer);
    }, { once: true });
  }

  // Don't fight pwa-bootstrap — if it shows a toast first (because
  // the SW itself updated), the user already knows. We still poll
  // so we catch the case where the SW hasn't updated yet but the
  // server has a new build.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
