// nav.client.js — global top nav for every Sainted Word Records page.
//
// Self-contained: declares a CSS string, injects it into <head>, then
// inserts a <header class="swr-topnav"> at the top of <body>. Reads
// `data-page` from <body> to mark the active destination; if no
// `data-page` matches one of the listed routes, the nav highlights
// nothing (a soft "you're somewhere else" state).
//
// Load with: <script src="/nav.client.js" defer></script>
// Idempotent — calling again (HMR) won't double the nav.

(function () {
  'use strict';
  if (window.__swrTopnav) return; // idempotent
  window.__swrTopnav = true;

  // ---- destinations (label, href) ----
  // Root-absolute paths so the nav works on every page (including
  // /versions/*.html and /auth/*.html, which would otherwise resolve
  // './photo.html' relative to the wrong directory).
  const ROUTES = [
    { key: 'engine',       label: 'Engine',         href: '/engine' },
    { key: 'enhance',      label: 'Enhance',        href: '/enhance' },
    { key: 'photo',        label: 'Photo',          href: '/photo.html' },
    { key: 'video-single', label: 'Transitions',    href: '/video_single.html' },
    { key: 'marketplace',  label: 'Market',         href: '/marketplace.html' },
    { key: 'atlas',        label: 'Atlas',          href: '/atlas' },
    { key: 'about',        label: 'About',          href: '/about.html' },
  ];

  // ---- CSS (injected once) ----
  const CSS = `
.swr-topnav {
  position: sticky;
  top: 0;
  z-index: 9998;
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 20px;
  background: rgba(10, 6, 4, 0.72);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(245, 234, 216, 0.10);
  font: 600 12px/1 var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
  color: var(--text-primary, #f5ead8);
  letter-spacing: 0.02em;
  user-select: none;
}
.swr-topnav__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
  margin-right: 24px;
  flex-shrink: 0;
}
.swr-topnav__logo {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: linear-gradient(135deg, #d4a04a 0%, #f5b860 50%, #efe2c8 100%);
  display: flex; align-items: center; justify-content: center;
  font: 700 14px ui-monospace, 'SF Mono', monospace;
  color: #1a1208;
  letter-spacing: -0.02em;
  box-shadow: 0 0 16px rgba(212, 160, 74, 0.25);
}
.swr-topnav__title {
  display: flex; flex-direction: column; line-height: 1;
}
.swr-topnav__title b {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.swr-topnav__title small {
  font-size: 9px;
  color: var(--text-muted, #8a7860);
  font-family: ui-monospace, 'SF Mono', monospace;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-top: 3px;
}
.swr-topnav__links {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.swr-topnav__link {
  padding: 8px 14px;
  border-radius: 8px;
  color: var(--text-secondary, #d4b89a);
  text-decoration: none;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  transition: background 140ms ease, color 140ms ease;
  white-space: nowrap;
}
.swr-topnav__link:hover {
  background: rgba(245, 234, 216, 0.08);
  color: var(--text-primary, #f5ead8);
}
.swr-topnav__link.active {
  background: linear-gradient(135deg, rgba(212, 160, 74, 0.18), rgba(245, 184, 96, 0.10));
  color: var(--text-primary, #f5ead8);
  box-shadow: inset 0 0 0 1px rgba(212, 160, 74, 0.30);
}
.swr-topnav__spacer { flex: 1; }
.swr-topnav__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  margin-right: 8px;
  border-radius: 8px;
  border: 1px solid rgba(245, 234, 216, 0.14);
  color: var(--text-secondary, #d4b89a);
  text-decoration: none;
  font-size: 11px;
  font-weight: 600;
  font-family: ui-monospace, 'SF Mono', monospace;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
  flex-shrink: 0;
}
.swr-topnav__back:hover {
  background: rgba(245, 234, 216, 0.08);
  color: var(--text-primary, #f5ead8);
  border-color: var(--accent-warm, #d4a04a);
}
.swr-topnav__install {
  display: none;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  background: linear-gradient(135deg, #d4a04a, #f5b860);
  color: #1a1208;
  border: none;
  font: 700 11px ui-monospace, 'SF Mono', monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  margin-left: 8px;
}
.swr-topnav__install:hover { filter: brightness(1.10); }
.swr-topnav__install.show { display: inline-flex; }
@media (max-width: 720px) {
  .swr-topnav { padding: 0 12px; height: 50px; }
  .swr-topnav__title { display: none; }
  .swr-topnav__link { padding: 8px 8px; font-size: 11px; }
  .swr-topnav__back { display: none; }
}
`;

  function injectCSS() {
    if (document.getElementById('swr-topnav-css')) return;
    const s = document.createElement('style');
    s.id = 'swr-topnav-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---- build the nav ----
  function buildNav() {
    const nav = document.createElement('header');
    nav.className = 'swr-topnav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Primary');

    // Determine current page from <body data-page="..."> or pathname
    const bodyPage = (document.body && document.body.dataset && document.body.dataset.page) || '';
    const path = (window.location && window.location.pathname) || '';

    const brand = document.createElement('a');
    brand.className = 'swr-topnav__brand';
    brand.href = '/';
    brand.innerHTML = '<span class="swr-topnav__logo">S</span>' +
      '<span class="swr-topnav__title"><b>Sainted Word</b><small>records</small></span>';

    const links = document.createElement('nav');
    links.className = 'swr-topnav__links';
    ROUTES.forEach((r) => {
      const a = document.createElement('a');
      a.className = 'swr-topnav__link';
      a.href = r.href;
      a.textContent = r.label;
      a.dataset.key = r.key;
      if (bodyPage === r.key || path.indexOf(r.key) !== -1) {
        a.classList.add('active');
      }
      links.appendChild(a);
    });

    const spacer = document.createElement('div');
    spacer.className = 'swr-topnav__spacer';

    // Back link — only when there's somewhere to go back to
    let backTarget = null;
    try {
      if (document.referrer) {
        const u = new URL(document.referrer);
        if (u.origin === window.location.origin && u.pathname !== window.location.pathname) {
          backTarget = document.referrer;
        }
      }
    } catch (_) {}
    let back = null;
    if (backTarget) {
      back = document.createElement('a');
      back.className = 'swr-topnav__back';
      back.href = backTarget;
      back.innerHTML = '← Back';
    }

    // Install button — only when the beforeinstallprompt fires AND the
    // nav is loaded. pwa-bootstrap.js handles the actual install prompt;
    // this is a thin bridge that surfaces a button in the nav.
    const install = document.createElement('button');
    install.className = 'swr-topnav__install';
    install.textContent = '⬇ Install';
    install.id = 'swr-topnav-install';
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      deferred = e;
      install.classList.add('show');
    });
    install.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (_) {}
      deferred = null;
      install.classList.remove('show');
    });
    window.addEventListener('appinstalled', () => {
      install.classList.remove('show');
    });

    nav.appendChild(brand);
    nav.appendChild(links);
    nav.appendChild(spacer);
    if (back) nav.appendChild(back);
    nav.appendChild(install);
    return nav;
  }

  function mount() {
    injectCSS();
    const body = document.body;
    if (!body) return;
    if (body.firstChild && body.firstChild.className === 'swr-topnav') {
      // Already mounted (HMR / re-run)
      return;
    }
    const nav = buildNav();
    // Insert as the first child of <body>. This makes it sit above any
    // page-specific layout without requiring a wrapper.
    body.insertBefore(nav, body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
