// swr-build-id.client.js — build-id propagator + cache buster.
//
// What this solves: Vercel's edge cache + the browser's back-forward cache +
// service workers (sw.js) all love to serve the previous HTML/JS snapshot
// after a new deploy. The fix has three parts:
//
//   1. On every page boot, write a small build-tag into localStorage
//      keyed by the HTML's current sha-256. The first page to load sets
//      it; subsequent pages check whether their own sha matches.
//
//   2. If a page detects that the localStorage build-tag differs from its
//      own sha, OR the page's meta tag <meta name="swr-build" content="...">
//      is newer than the cached entry, fire a cache-busting reload: clear
//      all known caches, unregister all service workers, and reload with
//      a cache-bust query string.
//
//   3. As a final guard, append ?v=<page-build-id> to every <script src>
//      and <link rel="stylesheet"> on the page. This makes the URL change
//      per-deploy, so even an aggressive browser cache won't serve stale
//      bytes (the URL it cached doesn't exist anymore).
//
// The script is idempotent — running twice is fine. It's also DOM-shape-
// agnostic so it works on engine.html, every variant, every gallery,
// every landing page.
//
// How pages opt in: just add <script src="/swr-build-id.client.js" defer>
// to <head>. The build-id is computed from the page's own HTML so it
// changes whenever the source file changes, which is exactly when we
// want to bust the cache.

(function () {
  if (window.__swrBuildIdLoaded) return;
  window.__swrBuildIdLoaded = true;

  const KEY = 'swr.build.id';
  const BUILD_ID = (function () {
    // 1. Prefer an explicit <meta name="swr-build"> tag (set by build script).
    const meta = document.querySelector('meta[name="swr-build"]');
    if (meta && meta.content) return meta.content;
    // 2. Fall back to a 6-char fingerprint of the live HTML. This still
    //    changes per-deploy because the HTML bytes change per-deploy.
    try {
      const html = document.documentElement.outerHTML;
      let h = 0;
      for (let i = 0; i < html.length; i++) {
        h = ((h << 5) - h + html.charCodeAt(i)) | 0;
      }
      return 'fp' + (h >>> 0).toString(36).slice(0, 6);
    } catch (_) {
      return 'fp-unknown';
    }
  })();

  // Expose the current build-id to anything else that needs it.
  window.SWR_BUILD_ID = BUILD_ID;

  // Persist for cross-page detection.
  try { localStorage.setItem(KEY, BUILD_ID); } catch (_) {}

  // Append ?v=<build-id> to all <script src> + <link rel="stylesheet" href>
  // that don't already have a query string. This makes the URL change per
  // deploy, busting any cache (browser, SW, CDN) keyed on URL.
  function withVersion(url, v) {
    if (!url) return url;
    // Skip data: URLs and URLs that already have a version param.
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    if (/[?&]v=/.test(url)) return url;
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 'v=' + encodeURIComponent(v);
  }
  function rewrite() {
    const v = BUILD_ID;
    document.querySelectorAll('script[src]').forEach((el) => {
      el.src = withVersion(el.src, v);
    });
    document.querySelectorAll('link[rel="stylesheet"][href]').forEach((el) => {
      el.href = withVersion(el.href, v);
    });
  }

  // Inline-data marker — a hidden span carrying the build id, readable
  // by anyone querying the DOM and useful for the smoke test harness.
  function addBadge() {
    if (document.getElementById('swr-build-badge')) return;
    const b = document.createElement('meta');
    b.setAttribute('name', 'swr-build-current');
    b.setAttribute('content', BUILD_ID);
    document.head.appendChild(b);
  }

  // Cache-busting path: if we land here with a different build id in
  // localStorage than the one this page claims, force a reload. This
  // handles the back/forward cache + service-worker-old-tab case where
  // the user reopens the page after a deploy.
  function maybeReload() {
    let prev = null;
    try { prev = localStorage.getItem(KEY); } catch (_) {}
    // First visit on this device: nothing to do.
    if (!prev) {
      try { localStorage.setItem(KEY, BUILD_ID); } catch (_) {}
      return;
    }
    // Same build: nothing to do.
    if (prev === BUILD_ID) return;
    // Different build: clear localStorage key, blow away caches + SWs,
    // reload with a cache-bust query string.
    try { localStorage.setItem(KEY, BUILD_ID); } catch (_) {}
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => { try { r.unregister(); } catch (_) {} });
      }).catch(() => {});
    }
    if ('caches' in window) {
      caches.keys().then((keys) => {
        keys.forEach((k) => { try { caches.delete(k); } catch (_) {} });
      }).catch(() => {});
    }
    // Reload via location.replace so the back-button history doesn't
    // bounce the user back to the stale page.
    const u = new URL(location.href);
    u.searchParams.set('swr-reload', BUILD_ID);
    location.replace(u.toString());
  }

  // Run immediately if the DOM is parsed enough, otherwise wait.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      rewrite();
      addBadge();
      maybeReload();
    }, { once: true });
  } else {
    rewrite();
    addBadge();
    maybeReload();
  }
})();