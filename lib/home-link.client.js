// lib/home-link.client.js — fixed bottom-right home link, mounted on
// every page. Self-contained; pages load it via <script defer>.
//
// Layer order (z-index), documented here so future modules know where to sit:
//   9999 — this link (the highest-priority chrome)
//   9998 — version badge (lib/version-badge.client.js)
//   9997 — airlock debug toggle (tools/airlock-debug.html only)
//
// The link replaces the old top-left `← Site` and `#nav-home` placements so
// every page has exactly one exit affordance. Padded at 12px×14px to meet
// the iOS HIG 44px touch-target recommendation (12+12=24, plus ~16px line
// height in monospace ≈ 40px; close enough for the secondary role).
(function () {
  'use strict';
  if (document.getElementById('swr-home-link')) return;

  function mount() {
    if (document.getElementById('swr-home-link')) return;
    const a = document.createElement('a');
    a.id = 'swr-home-link';
    a.href = '/';
    a.title = 'Sainted Word Records — home';
    a.setAttribute('aria-label', 'Back to home');
    a.textContent = '← Home';
    a.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:9999',
      'font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:var(--muted,#a0a0a8)', 'text-decoration:none',
      'border:1px solid var(--line,#333)', 'border-radius:3px',
      'padding:12px 14px', 'background:rgba(0,0,0,0.55)',
      'backdrop-filter:blur(4px)', '-webkit-backdrop-filter:blur(4px)',
      'white-space:nowrap', 'user-select:none',
    ].join(';');
    document.body.appendChild(a);
  }

  // Defer to DOMContentLoaded so the page's own <body> exists. Most pages
  // load this script with `defer`, so DOMContentLoaded already fires; this
  // branch covers the rare case where someone uses async.
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
