// lib/store.client.js — the store: Gumroad downloads and Stripe payments.
//
// One data file: the `store` block in site-map.json. It carries the
// Gumroad store, the downloadable products and every Stripe product with
// its Payment Link. The block is inlined into every page that mounts
// <swr-footer> (the build's inline-footer-nav plugin) and can be
// overridden at build time by three env vars — GUMROAD_STORE_URL,
// GUMROAD_LINKS and STRIPE_LINKS (each a JSON object of { id: url }) — so
// a deployment can supply the links without touching the repo.
//
// Contract:
//   window.SWR_STORE.gumroad()          → { url, label, description } | null
//   window.SWR_STORE.downloads()        → the downloadable products
//   window.SWR_STORE.download(id)       → one download, or null
//   window.SWR_STORE.products(surface?) → the Stripe catalogue
//   window.SWR_STORE.product(id)        → one Stripe product, or null
//   window.SWR_STORE.link(id)           → the Stripe link, or '' when unset
//   window.SWR_STORE.paymentsLive()     → true when a Stripe link exists
//   window.SWR_STORE.apply()            → wire every [data-stripe-product]
//   window.SWR_STORE.renderStore(el)    → paint the download catalogue
//   window.SWR_STORE.mountAll()         → renderStore for every [data-store]
//
// The two switches are the whole point:
//   • apply() turns an element with data-stripe-product="<id>" into a
//     working buy button when the product has a link, and into an honest
//     disabled state when it does not. No dead buy.stripe.com URLs, and
//     no page has to know whether payments are live.
//   • renderStore() paints the download catalogue from the same data, so
//     adding a product to site-map.json puts it on the page — the
//     "automatic" listing.
//
// A product without a link is NOT an error: the catalogue is the shop's
// plan, and the links arrive when the Stripe / Gumroad dashboards have
// them.

(function () {
  'use strict';
  if (window.SWR_STORE) return;

  const SLICE_ID = 'swr-footer-data';

  let sliceCache;
  let sliceTried = false;
  let fetched = false;
  let pending = false;
  const readyCbs = [];

  // A surface that renders from the store asks for ready() instead of
  // polling: the callback fires as soon as the catalogue is known (the
  // inlined slice is there on every built page; the dev server fills it
  // in from /site-map.json a moment later).
  function ready(cb) {
    if (typeof cb !== 'function') return;
    readyCbs.push(cb);
    fireReady();
  }

  function fireReady() {
    if (!readyCbs.length) return;
    if (!store()) return;
    const cbs = readyCbs.splice(0, readyCbs.length);
    cbs.forEach(cb => {
      try {
        cb();
      } catch (e) { /* a surface must not break the store */ }
    });
  }

  function sliceData() {
    if (sliceTried) return sliceCache;
    sliceTried = true;
    sliceCache = null;
    let node = null;
    try {
      node = document.getElementById(SLICE_ID);
    } catch (e) {
      node = null;
    }
    if (!node) return null;
    try {
      sliceCache = JSON.parse(node.textContent || '{}');
    } catch (e) {
      sliceCache = null;
    }
    return sliceCache;
  }

  // The dev server does not run the inlining plugin, so the store block
  // arrives via /site-map.json there. One fetch, then every surface
  // repaints.
  function fetchStore() {
    if (fetched) return;
    fetched = true;
    if (typeof fetch !== 'function') return;
    fetch('/site-map.json', { credentials: 'same-origin' })
      .then(r => (r && r.ok ? r.json() : null))
      .then(map => {
        if (!map || !map.store) return;
        sliceCache = sliceCache || {};
        sliceCache.store = map.store;
        apply();
        mountAll();
        fireReady();
      })
      .catch(() => { /* offline: the inline slice is the primary path */ });
  }

  function store() {
    const data = sliceData();
    if (!data || !data.store) {
      if (!pending) {
        pending = true;
        fetchStore();
      }
      return null;
    }
    const s = data.store;
    return {
      gumroad: s.gumroad && s.gumroad.url ? s.gumroad : null,
      downloads: Array.isArray(s.downloads) ? s.downloads : [],
      products: Array.isArray(s.products) ? s.products : [],
    };
  }

  function gumroad() {
    const s = store();
    return s ? s.gumroad : null;
  }

  // The downloadable products: sold on Gumroad, delivered from an
  // off-site host. `downloadUrl` is the off-site file URL once the
  // packaging + publish scripts have run; `gumroadUrl` is the checkout
  // page. A product with neither is listed but not purchasable.
  function downloads() {
    const s = store();
    if (!s) return [];
    return s.downloads.filter(d => d && d.id);
  }

  function download(id) {
    return downloads().find(d => d.id === id) || null;
  }

  function price(d) {
    if (!d || typeof d.price !== 'number') return '';
    const cur = d.currency || 'EUR';
    const symbol = cur === 'EUR' ? '€' : cur === 'USD' ? '$' : cur + ' ';
    return symbol + d.price;
  }

  function products(surface) {
    const s = store();
    if (!s) return [];
    const all = s.products.filter(p => p && p.id);
    if (!surface) return all;
    return all.filter(p => String(p.surface || '') === String(surface));
  }

  function product(id) {
    if (!id) return null;
    return products().find(p => p.id === id) || null;
  }

  // A link is live when it is a real URL. The placeholder spellings the
  // repo used before (REPLACE_…, SWR_SINGLE_25) are treated as unset, so
  // a leftover placeholder can never become a live buy button.
  function isLiveLink(url) {
    const s = String(url || '').trim();
    if (!s) return false;
    if (!/^https:\/\//i.test(s)) return false;
    if (/REPLACE_|YOUR_|SWR_[A-Z_]*_\d/i.test(s)) return false;
    // A placeholder host ("https://xxx", "https://example.com/x" style
    // stubs) is not a checkout either.
    if (/^https:\/\/xxx(\.|\/|$)/i.test(s)) return false;
    return true;
  }

  function link(id) {
    const p = product(id);
    if (!p) return '';
    return isLiveLink(p.stripeUrl) ? String(p.stripeUrl).trim() : '';
  }

  function paymentsLive() {
    return products().some(p => isLiveLink(p.stripeUrl));
  }

  // Wire the buy buttons. An element opts in with
  // data-stripe-product="<id>"; a data-stripe-keep-href element keeps its
  // own href (the shop page appends client_reference_id to it).
  function apply() {
    let nodes = [];
    try {
      nodes = document.querySelectorAll('[data-stripe-product]');
    } catch (e) {
      return 0;
    }
    let wired = 0;
    nodes.forEach(node => {
      const id = node.getAttribute('data-stripe-product');
      const url = link(id);
      if (url) {
        if (!node.hasAttribute('data-stripe-keep-href')) node.setAttribute('href', url);
        node.setAttribute('data-stripe-state', 'live');
        node.removeAttribute('aria-disabled');
      } else {
        node.setAttribute('data-stripe-state', 'pending');
        node.setAttribute('aria-disabled', 'true');
        if (!node.hasAttribute('data-stripe-keep-href')) node.setAttribute('href', '#');
      }
      wired++;
    });
    // The page-level state lets a notice ("payments are not live yet")
    // hide itself the moment the links arrive.
    try {
      if (document.body) {
        document.body.setAttribute('data-store-state', paymentsLive() ? 'live' : 'pending');
      }
    } catch (e) { /* no body yet */ }
    return wired;
  }

  // Render the store into a container. The markup is built here so the
  // marketplace and any future surface can show the same catalogue
  // without hardcoding a single product.
  function renderStore(el) {
    if (!el) return 0;
    const list = downloads();
    const g = gumroad();
    el.innerHTML = '';

    if (g) {
      const storeLink = document.createElement('a');
      storeLink.className = 'store__store-link';
      storeLink.href = g.url;
      storeLink.target = '_blank';
      storeLink.rel = 'noopener';
      storeLink.textContent = g.label || 'Open the store';
      el.appendChild(storeLink);
    }

    const grid = document.createElement('div');
    grid.className = 'store__grid';
    list.forEach(d => {
      const card = document.createElement('article');
      card.className = 'store__card';
      card.setAttribute('data-store-product', d.id);

      const name = document.createElement('h4');
      name.className = 'store__name';
      name.textContent = d.name;
      card.appendChild(name);

      if (d.blurb) {
        const blurb = document.createElement('p');
        blurb.className = 'store__blurb';
        blurb.textContent = d.blurb;
        card.appendChild(blurb);
      }

      const priceEl = document.createElement('span');
      priceEl.className = 'store__price';
      priceEl.textContent = price(d);
      card.appendChild(priceEl);

      const href = isLiveLink(d.gumroadUrl) ? d.gumroadUrl : (isLiveLink(d.downloadUrl) ? d.downloadUrl : '');
      const cta = document.createElement(href ? 'a' : 'span');
      cta.className = 'store__cta';
      if (href) {
        cta.href = href;
        cta.target = '_blank';
        cta.rel = 'noopener';
        cta.textContent = isLiveLink(d.gumroadUrl) ? 'Buy on Gumroad →' : 'Download →';
      } else {
        cta.setAttribute('aria-disabled', 'true');
        cta.setAttribute('data-store-state', 'pending');
        cta.textContent = 'Coming soon';
      }
      card.appendChild(cta);

      grid.appendChild(card);
    });
    el.appendChild(grid);
    return list.length;
  }

  function mountAll() {
    let n = 0;
    let nodes = [];
    try {
      nodes = document.querySelectorAll('[data-store]');
    } catch (e) {
      return 0;
    }
    nodes.forEach(el => {
      n += renderStore(el);
    });
    return n;
  }

  window.SWR_STORE = {
    gumroad: gumroad,
    downloads: downloads,
    download: download,
    price: price,
    products: products,
    product: product,
    link: link,
    isLiveLink: isLiveLink,
    paymentsLive: paymentsLive,
    apply: apply,
    renderStore: renderStore,
    mountAll: mountAll,
    ready: ready,
  };

  apply();
  mountAll();
  fireReady();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      apply();
      mountAll();
    });
  }
})();
