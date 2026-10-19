// lib/app-version-bust.js — runs synchronously in <head>, AFTER app-version.js.
//
// If the user has a stale version in localStorage, we clear all SWR-owned
// state and reload once. The version constant is set by lib/app-version.js
// (which is loaded immediately before this script), so window.SWR_APP_VERSION
// is defined by the time this runs.
//
// Reload-loop protection: 3 reloads in 60s max, then we give up. Better to
// show a stale page than to lock the user out. The counter lives at
// localStorage.swr_app_version_reload_count and is cleared after 60s.
//
// The current SW cache version is also matched here — bump it in
// scripts/check-codepaths.mjs (and sw.js) when the version chrome ships, and
// keep them in sync. The bust deletes every swr-v* cache that isn't the
// current one, so old assets never linger.
//
// Order in <head>:
//   <script src="/lib/app-version.js"></script>       <!-- 1. sets window.SWR_APP_VERSION -->
//   <script src="/lib/app-version-bust.js"></script>  <!-- 2. checks + reloads if stale -->
(function () {
  'use strict';

  // Current SW cache version. Must match CACHE_VERSION in sw.js — keep
  // these in sync when bumping. The bust deletes every swr-v* cache that
  // isn't this one, so old assets never linger after a reload.
  var SWR_CACHE_VERSION = 'swr-v5';

  var current = window.SWR_APP_VERSION;
  if (!current) return;  // app-version.js didn't load — bail, don't break the page

  // ----- loop protection -----
  var LOOP_KEY = 'swr_app_version_reload_count';
  var LOOP_MAX = 3;
  var LOOP_WINDOW_MS = 60000;
  var count = 0;
  try { count = parseInt(localStorage.getItem(LOOP_KEY) || '0', 10); } catch (_) {}
  if (!isFinite(count) || count < 0) count = 0;
  if (count >= LOOP_MAX) {
    console.warn('[swr] version-bust: reload loop detected, breaking out');
    try { localStorage.removeItem(LOOP_KEY); } catch (_) {}
    return;  // load anyway, stale is better than locked out
  }
  try { localStorage.setItem(LOOP_KEY, String(count + 1)); } catch (_) {}
  setTimeout(function () { try { localStorage.removeItem(LOOP_KEY); } catch (_) {} }, LOOP_WINDOW_MS);

  // ----- version check -----
  var SEEN_KEY = 'swr_app_version_seen';
  var prev = null;
  try { prev = localStorage.getItem(SEEN_KEY); } catch (_) {}
  if (prev === current) return;  // up to date — the common path, exit fast

  // ----- stale: clear + reload -----
  try {
    // Clear SWR-owned localStorage keys. Prefix-based, plus the well-known
    // airlock keys. Anything user-owned is left alone.
    var keys = Object.keys(localStorage);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf('swr.') === 0 || k.indexOf('swr_') === 0 ||
          k === 'airlock_logs' || k === 'airlock_version' ||
          k === SEEN_KEY || k === LOOP_KEY) {
        try { localStorage.removeItem(k); } catch (_) {}
      }
    }
  } catch (_) {}

  // Clear session storage (always safe; it's tab-scoped)
  try { sessionStorage.clear(); } catch (_) {}

  // Clear SW caches. The service worker registers later, but its old caches
  // are still readable. We can't wait for the SW to do it on activate (this
  // is the page that's about to reload), so we delete them directly. Match
  // the sw.js CACHE_VERSION exactly: delete every swr-v* that isn't current.
  if (typeof caches !== 'undefined' && caches.keys) {
    try {
      caches.keys().then(function (names) {
        for (var j = 0; j < names.length; j++) {
          var n = names[j];
          if (n.indexOf('swr-v') === 0 && n !== SWR_CACHE_VERSION) {
            try { caches.delete(n); } catch (_) {}
          }
        }
      }).catch(function () {});
    } catch (_) {}
  }

  // ----- record + reload -----
  try { localStorage.setItem(SEEN_KEY, current); } catch (_) {}
  // Hard reload — bypasses the SW cache for this navigation. The
  // `?v=` query is harmless and signals to any proxy that this is a
  // fresh request.
  window.location.reload();
})();
