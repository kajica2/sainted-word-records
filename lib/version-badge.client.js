// lib/version-badge.client.js — fixed bottom-right version display.
//
// Reads window.SWR_APP_VERSION (set by lib/app-version.js) and renders a
// small clickable link to the changelog at /changelog.html#v<version>.
// Sits 8px to the LEFT of the home link (lib/home-link.client.js) so the
// two never overlap; the home link z-index is higher.
//
// The version string is always ≤ 14 chars (e.g. v2026.10.13.99), so the
// fixed right offset of 78px (~54px home link width + 8px gap + 16px page
// margin) reserves enough room. If a future version is longer, bump the
// offset — the change is a single number.
(function () {
  'use strict';
  if (document.getElementById('swr-version-badge')) return;

  function mount() {
    if (document.getElementById('swr-version-badge')) return;
    const v = (window.SWR_APP_VERSION || 'unknown');
    const a = document.createElement('a');
    a.id = 'swr-version-badge';
    a.href = '/changelog.html#v' + v;
    a.textContent = 'v' + v;
    a.title = 'SWR ' + v + ' — see what changed';
    a.setAttribute('aria-label', 'App version ' + v + ', link to changelog');
    // Mobile layout: pairs with the home link at bottom-left, the
    // badge sits 60px to its right (the home link is ~46px wide at
    // 12px×14px padding + ~6 chars of monospace). The desktop
    // layout (right:78px) sits just left of the bottom-right
    // home link.
    const isNarrow = window.matchMedia && window.matchMedia('(max-width: 860px)').matches;
    const horizontal = isNarrow ? 'left:60px' : 'right:78px';
    a.style.cssText = [
      'position:fixed', 'bottom:16px', horizontal, 'z-index:9998',
      'font:9px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:var(--muted,#7a7a82)', 'text-decoration:none',
      'border:1px solid var(--line,#333)', 'border-radius:3px',
      'padding:12px 8px', 'background:rgba(0,0,0,0.4)',
      'white-space:nowrap', 'user-select:none',
    ].join(';');
    document.body.appendChild(a);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
