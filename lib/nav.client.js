// lib/nav.client.js — Shared navigation component for Sainted Word Records.
// Fetches /site-map.json and renders a sticky top nav with mobile drawer,
// active state, and theme toggle. Web Component <swr-nav> for declarative use,
// plus window.SWR_NAV.mount() for programmatic mounting.
//
// Usage:
//   <script src="/lib/nav.client.js" defer></script>
//   <swr-nav></swr-nav>
//
// Or:
//   <div id="my-nav"></div>
//   <script>
//     SWR_NAV.mount('#my-nav', { variant: 'minimal' });
//   </script>

(function () {
  if (window.SWR_NAV) return;

  // === THEME ===
  function getTheme() {
    try {
      return localStorage.getItem('swr-theme') || 'system';
    } catch (e) { return 'system'; }
  }
  function setTheme(theme) {
    try { localStorage.setItem('swr-theme', theme); } catch (e) {}
    const resolved = theme === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-pref', theme);
    document.dispatchEvent(new CustomEvent('swr-theme-change', { detail: { theme, resolved } }));
  }
  function toggleTheme() {
    const current = getTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }

  // === SITE MAP ===
  let cachedMap = null;
  let inflightMap = null;
  async function loadSiteMap() {
    if (cachedMap) return cachedMap;
    if (inflightMap) return inflightMap;
    inflightMap = fetch('/site-map.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .finally(() => { inflightMap = null; });
    cachedMap = await inflightMap;
    return cachedMap;
  }

  // === RENDER ===
  function isActive(href) {
    const path = window.location.pathname.replace(/\/$/, '');
    const h = href.replace(/\/$/, '');
    if (h === '/') return path === '' || path === '/';
    return path === h || path.startsWith(h + '/');
  }

  function renderNav(map, opts) {
    opts = opts || {};
    const nav = document.createElement('nav');
    nav.className = 'swr-nav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Main navigation');

    const inner = document.createElement('div');
    inner.className = 'swr-nav__inner';

    // Brand
    const brand = document.createElement('a');
    brand.className = 'swr-nav__brand';
    brand.href = '/';
    brand.innerHTML = '<span class="dot"></span>Sainted Word Records';
    inner.appendChild(brand);

    // Links
    const links = document.createElement('div');
    links.className = 'swr-nav__links';
    (map.nav || []).forEach(item => {
      const a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      if (isActive(item.href)) a.setAttribute('aria-current', 'page');
      if (item.children && item.children.length > 0) {
        // Render dropdown for items with children
        a.style.position = 'relative';
        a.addEventListener('mouseenter', () => showDropdown(a, item.children));
        a.addEventListener('mouseleave', () => hideDropdown(a));
      }
      links.appendChild(a);
    });
    inner.appendChild(links);

    // Theme toggle
    const themeBtn = document.createElement('button');
    themeBtn.className = 'swr-theme-toggle';
    themeBtn.setAttribute('aria-label', 'Toggle theme');
    themeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="12" cy="12" r="9"/>
        <path d="M12 3v18M3 12h18"/>
      </svg>
    `;
    themeBtn.addEventListener('click', toggleTheme);
    inner.appendChild(themeBtn);

    // CTA
    if (!opts.hideCta && map.footer && map.footer[0]) {
      const cta = document.createElement('a');
      cta.className = 'swr-nav__cta';
      cta.href = map.footer[0].href;
      cta.textContent = map.footer[0].label;
      inner.appendChild(cta);
    }

    nav.appendChild(inner);
    return nav;
  }

  function showDropdown(parent, children) {
    let dd = parent.querySelector('.swr-nav__dropdown');
    if (!dd) {
      dd = document.createElement('div');
      dd.className = 'swr-nav__dropdown';
      dd.style.cssText = 'position:absolute;top:100%;left:0;background:var(--bg-3);border:1px solid var(--line);border-radius:var(--radius-sm);padding:8px;min-width:200px;box-shadow:var(--shadow-2);z-index:100;';
      children.forEach(child => {
        const a = document.createElement('a');
        a.href = child.href;
        a.textContent = child.label;
        a.style.cssText = 'display:block;padding:6px 10px;border-radius:4px;font-size:13px;color:var(--ink-2);text-decoration:none;';
        a.addEventListener('mouseenter', () => a.style.background = 'var(--bg-2)');
        a.addEventListener('mouseleave', () => a.style.background = '');
        dd.appendChild(a);
      });
      parent.appendChild(dd);
    }
    dd.style.display = 'block';
  }

  function hideDropdown(parent) {
    const dd = parent.querySelector('.swr-nav__dropdown');
    if (dd) dd.style.display = 'none';
  }

  // === WEB COMPONENT ===
  class SwrNav extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      const variant = this.getAttribute('variant') || 'default';
      const opts = { variant, hideCta: this.hasAttribute('hide-cta') };
      loadSiteMap().then(map => {
        if (!map) {
          this.innerHTML = '<nav class="swr-nav"><div class="swr-nav__inner"><a class="swr-nav__brand" href="/"><span class="dot"></span>SWR</a></div></nav>';
          return;
        }
        const nav = renderNav(map, opts);
        this.appendChild(nav);
      });
    }
  }

  if (!customElements.get('swr-nav')) {
    customElements.define('swr-nav', SwrNav);
  }

  // === PROGRAMMATIC MOUNT ===
  function mount(selector, opts) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return;
    loadSiteMap().then(map => {
      if (!map) return;
      const nav = renderNav(map, opts || {});
      el.appendChild(nav);
    });
  }

  // === INIT ===
  function init() {
    // Apply theme on load
    setTheme(getTheme());

    // Auto-mount <swr-nav> elements
    document.querySelectorAll('swr-nav:not([data-swr-nav-mounted])').forEach(el => {
      el.setAttribute('data-swr-nav-mounted', 'true');
    });

    // Reveal animations
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            obs.unobserve(e.target);
          }
        });
      }, { threshold: 0.1 });
      document.querySelectorAll('.reveal:not(.visible)').forEach(el => obs.observe(el));
    } else {
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SWR_NAV = {
    mount,
    loadSiteMap,
    setTheme,
    getTheme,
    toggleTheme,
  };
})();
