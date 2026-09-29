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
    nav.setAttribute('aria-label', 'Main navigation');

    // First tab stop on every page carrying the nav — visually hidden until it
    // takes focus (see .swr-skip in components.css). init() guarantees the
    // #main target exists whenever the page has a <main>.
    const skip = document.createElement('a');
    skip.className = 'swr-skip';
    skip.href = '#main';
    skip.textContent = 'Skip to content';
    nav.appendChild(skip);

    const inner = document.createElement('div');
    inner.className = 'swr-nav__inner';

    // Brand
    const brand = document.createElement('a');
    brand.className = 'swr-nav__brand';
    brand.href = '/';
    brand.innerHTML = '<span class="dot"></span>Sainted Word Records';
    inner.appendChild(brand);

    // Links — desktop row + the mobile drawer's copy of the same tree
    const links = document.createElement('div');
    links.className = 'swr-nav__links';
    const drawerList = document.createElement('div');
    drawerList.className = 'swr-nav__drawer-links';
    (map.nav || []).forEach(item => {
      const a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      if (isActive(item.href)) a.setAttribute('aria-current', 'page');
      if (item.children && item.children.length > 0) {
        // Dropdown: hover for pointers, focus for keyboards, Escape to
        // dismiss — the link itself still navigates on click.
        a.style.position = 'relative';
        a.setAttribute('aria-haspopup', 'true');
        a.setAttribute('aria-expanded', 'false');
        a.addEventListener('mouseenter', () => showDropdown(a, item.children));
        a.addEventListener('mouseleave', () => hideDropdown(a));
        a.addEventListener('focus', () => showDropdown(a, item.children));
        a.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideDropdown(a); });
      }
      links.appendChild(a);

      // Mobile mirror: parent link plus its children, always expanded — the
      // drawer has the room, and a hidden disclosure would cost a tap.
      const group = document.createElement('div');
      group.className = 'swr-nav__drawer-group';
      const ga = document.createElement('a');
      ga.href = item.href;
      ga.textContent = item.label;
      if (isActive(item.href)) ga.setAttribute('aria-current', 'page');
      group.appendChild(ga);
      if (item.children && item.children.length > 0) {
        const sub = document.createElement('div');
        sub.className = 'swr-nav__drawer-sub';
        item.children.forEach(child => {
          const ca = document.createElement('a');
          ca.href = child.href;
          ca.textContent = child.label;
          if (isActive(child.href)) ca.setAttribute('aria-current', 'page');
          sub.appendChild(ca);
        });
        group.appendChild(sub);
      }
      drawerList.appendChild(group);
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

    // CTA — in the bar on desktop, inside the drawer on mobile.
    let cta = null;
    if (!opts.hideCta && map.footer && map.footer[0]) {
      cta = document.createElement('a');
      cta.className = 'swr-nav__cta';
      cta.href = map.footer[0].href;
      cta.textContent = map.footer[0].label;
      inner.appendChild(cta);
    }

    // Mobile menu button — components.css hides the link row and the bar CTA
    // at ≤720px and shows this instead; the drawer carries the same tree.
    const burger = document.createElement('button');
    burger.type = 'button';
    burger.className = 'swr-nav__burger';
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-controls', 'swr-nav-drawer');
    burger.setAttribute('aria-label', 'Open menu');
    burger.innerHTML = '<span></span><span></span><span></span>';
    inner.appendChild(burger);

    const drawer = document.createElement('div');
    drawer.className = 'swr-nav__drawer';
    drawer.id = 'swr-nav-drawer';
    drawer.hidden = true;
    drawer.appendChild(drawerList);
    if (cta) {
      const dCta = document.createElement('a');
      dCta.className = 'swr-nav__cta swr-nav__drawer-cta';
      dCta.href = cta.getAttribute('href');
      dCta.textContent = cta.textContent;
      drawer.appendChild(dCta);
    }

    function setDrawer(open) {
      drawer.hidden = !open;
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    burger.addEventListener('click', () => setDrawer(drawer.hidden));
    drawer.addEventListener('click', (e) => { if (e.target.closest('a')) setDrawer(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !drawer.hidden) { setDrawer(false); burger.focus(); }
    });
    document.addEventListener('click', (e) => {
      if (!drawer.hidden && !nav.contains(e.target)) setDrawer(false);
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 720 && !drawer.hidden) setDrawer(false);
    });

    nav.appendChild(inner);
    nav.appendChild(drawer);
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
    if (parent.setAttribute) parent.setAttribute('aria-expanded', 'true');
  }

  function hideDropdown(parent) {
    const dd = parent.querySelector('.swr-nav__dropdown');
    if (dd) dd.style.display = 'none';
    if (parent.setAttribute) parent.setAttribute('aria-expanded', 'false');
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

    // The skip link targets #main — give the page's <main> an id if it lacks
    // one, so the first tab stop always lands on the content.
    const main = document.querySelector('main');
    if (main && !main.id) main.id = 'main';

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
