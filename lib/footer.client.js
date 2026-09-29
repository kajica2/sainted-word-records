// lib/footer.client.js — Shared footer component for Sainted Word Records.
// Renders the same .footer markup every page used to carry inline (brand +
// columns + bottom bar) from site-map.json's `footerNav` block, so the footer
// stops being 100 diverging copies.
//
// Usage:
//   <script src="/lib/footer.client.js" defer></script>
//   <swr-footer></swr-footer>
//
// Or:
//   <div id="my-footer"></div>
//   <script>SWR_FOOTER.mount('#my-footer');</script>
//
// Content (tagline, columns, social) lives in site-map.json; the bottom bar
// adds the legal links from `site-map.json.legal`, the sitemap tool link and
// the copyright. Nothing in this file hardcodes a destination.

(function () {
  if (window.SWR_FOOTER) return;

  const YEAR = String(new Date().getFullYear());

  let cachedMap = null;
  let inflightMap = null;

  // Offline-first: the build inlines the map slice this component reads into
  // <script type="application/json" id="swr-footer-data"> on every copied page
  // (the `inline-footer-nav` Vite plugin), so the footer renders with no
  // network at all. Pages built without the block fall back to the fetch.
  function inlineMap() {
    const el = document.getElementById('swr-footer-data');
    if (!el) return null;
    try {
      const data = JSON.parse(el.textContent);
      return data && data.footerNav ? data : null;
    } catch {
      return null;
    }
  }

  async function loadSiteMap() {
    if (!cachedMap) cachedMap = inlineMap();
    if (cachedMap) return cachedMap;
    if (!inflightMap) {
      inflightMap = fetch('/site-map.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
        .finally(() => { inflightMap = null; });
    }
    cachedMap = await inflightMap;
    return cachedMap;
  }

  function isExternal(href) {
    return /^https?:\/\//i.test(href);
  }

  function link(href, label) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (isExternal(href)) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    return a;
  }

  function renderFooter(map) {
    // The component needs its IA block; without it the page keeps whatever it
    // had rather than rendering an empty shell.
    if (!map || !map.footerNav || !Array.isArray(map.footerNav.columns)) return null;

    const data = map.footerNav;
    const foot = document.createElement('footer');
    foot.className = 'footer';

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    const grid = document.createElement('div');
    grid.className = 'footer__grid';

    // Brand + tagline
    const brandCol = document.createElement('div');
    const brand = document.createElement('div');
    brand.className = 'footer__brand';
    const dot = document.createElement('span');
    dot.className = 'dot';
    brand.appendChild(dot);
    brand.appendChild(document.createTextNode('Sainted Word Records'));
    brandCol.appendChild(brand);
    if (data.tagline) {
      const tag = document.createElement('p');
      tag.className = 'footer__tag';
      tag.textContent = data.tagline;
      brandCol.appendChild(tag);
    }
    grid.appendChild(brandCol);

    // IA columns
    data.columns.forEach(col => {
      const box = document.createElement('div');
      box.className = 'footer__col';
      const h = document.createElement('h4');
      h.textContent = col.heading;
      box.appendChild(h);
      const ul = document.createElement('ul');
      (col.links || []).forEach(l => {
        const li = document.createElement('li');
        li.appendChild(link(l.href, l.label));
        ul.appendChild(li);
      });
      box.appendChild(ul);
      grid.appendChild(box);
    });

    wrap.appendChild(grid);

    // Bottom bar — copyright, social, legal, sitemap
    const bottom = document.createElement('div');
    bottom.className = 'footer__bottom';
    const copy = document.createElement('span');
    copy.textContent = `© ${YEAR} Sainted Word Records`;
    bottom.appendChild(copy);

    const nav = document.createElement('div');
    nav.className = 'footer__bottom-links';
    (data.social || []).forEach(s => nav.appendChild(link(s.href, s.label)));
    (map.legal || []).forEach(l => nav.appendChild(link(l.href, l.label)));
    const sitemapTool = (map.tools || []).find(t => t && t.href === '/sitemap');
    if (sitemapTool) nav.appendChild(link(sitemapTool.href, sitemapTool.label));
    bottom.appendChild(nav);

    wrap.appendChild(bottom);
    foot.appendChild(wrap);
    return foot;
  }

  // === WEB COMPONENT ===
  class SwrFooter extends HTMLElement {
    connectedCallback() {
      if (this._mounted) return;
      this._mounted = true;
      loadSiteMap().then(map => {
        const foot = renderFooter(map);
        if (foot) this.appendChild(foot);
      });
    }
  }

  if (!customElements.get('swr-footer')) {
    customElements.define('swr-footer', SwrFooter);
  }

  // === PROGRAMMATIC MOUNT ===
  function mount(selector) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return;
    loadSiteMap().then(map => {
      const foot = renderFooter(map);
      if (foot) el.appendChild(foot);
    });
  }

  window.SWR_FOOTER = { mount, loadSiteMap, renderFooter };
})();
