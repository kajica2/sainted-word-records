// client/shop-decorator.client.js
//
// Decorates every .gallery-card on a gallery page with a "Buy on tee or cup"
// CTA that links to /shop.html with the gallery slug + card index as query
// params. Runs at DOMContentLoaded, no dependencies, no build step.
//
// Card numbering:
//   featured card  -> c=0 (always the hero / first card)
//   standard cards -> c=1..7 in DOM order
//
// Gallery slug detection:
//   reads location.pathname (/gallery-music.html -> "music")
//   or /gallery/<slug> via the vercel rewrite target
//
// Public surface: window.SWR_SHOP = { products, decorate, buildShopUrl }

(function () {
  'use strict';

  // ---- Inline CSS for the Buy CTA overlay -------------------------------
  // Appended once on first run; idempotent.
  function injectStyles() {
    if (document.getElementById('swr-shop-decorator-styles')) return;
    var s = document.createElement('style');
    s.id = 'swr-shop-decorator-styles';
    s.textContent = [
      '.gallery-card__buy {',
      '  position: absolute; left: 12px; bottom: 12px; right: 12px;',
      '  display: flex; align-items: center; justify-content: space-between; gap: 8px;',
      '  padding: 9px 14px; border-radius: 999px;',
      '  background: rgba(0,0,0,0.62); color: #f5ead8;',
      '  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;',
      '  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;',
      '  backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.18);',
      '  text-decoration: none; transition: transform 0.15s ease, background 0.15s ease;',
      '  z-index: 2;',
      '}',
      '.gallery-card__buy:hover {',
      '  background: rgba(255, 45, 138, 0.92); color: #0e0c0a;',
      '  transform: translateY(-1px); text-decoration: none;',
      '}',
      '.gallery-card__buy-arrow { font-size: 14px; opacity: 0.85; }',
      '.gallery-card__buy:hover .gallery-card__buy-arrow { opacity: 1; transform: translateX(2px); }',
      // Hide on very small cards if you want; on by default.
      '.gallery-card--featured .gallery-card__buy { font-size: 12px; padding: 11px 18px; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ---- 3-product catalog -------------------------------------------------
  // The catalogue lives in site-map.json → store.products (surface "shop"),
  // which is the single source of truth for prices and Stripe Payment
  // Links. This list is only the fallback for a page that has no store
  // data (no inlined slice and no /site-map.json yet): it carries no
  // payment links at all, because a product without a link must never
  // render a dead checkout URL.
  const PRODUCTS = [
    {
      id: 'logo-tee',
      name: 'Logo Tee',
      blurb: 'Front-pocket print, single color on cotton.',
      price: 25,
      currency: 'EUR',
      stripeUrl: '',
    },
    {
      id: 'graphic-tee',
      name: 'Graphic Tee',
      blurb: 'Full back print, large format on cotton.',
      price: 25,
      currency: 'EUR',
      stripeUrl: '',
    },
    {
      id: 'mug',
      name: 'Mug',
      blurb: '11oz ceramic, both-sides print.',
      price: 15,
      currency: 'EUR',
      stripeUrl: '',
    },
  ];

  // The store catalogue when it is available, the local fallback otherwise.
  function catalogue() {
    var store = window.SWR_STORE;
    if (store && store.products) {
      var list = store.products('shop');
      if (list && list.length) return list;
    }
    return PRODUCTS;
  }

  function isLiveLink(url) {
    var s = String(url || '').trim();
    if (!s) return false;
    if (!/^https:\/\//i.test(s)) return false;
    if (/REPLACE_|YOUR_|SWR_[A-Z_]*_\d/i.test(s)) return false;
    return !/^https:\/\/xxx(\.|\/|$)/i.test(s);
  }

  // ---- Gallery slug detection --------------------------------------------
  // Three URL shapes:
  //   1. /gallery-<slug>.html  (direct file)
  //   2. /gallery/<slug>       (vercel rewrite to gallery-<slug>.html)
  //   3. /gallery/<slug>/      (vercel rewrite with trailing slash)
  function detectGallerySlug() {
    var path = location.pathname;
    var m = path.match(/gallery-([a-z0-9-]+)\.html$/i);
    if (m) return m[1];
    m = path.match(/\/gallery\/([a-z0-9-]+)\/?$/i);
    if (m) return m[1];
    // /gallery or /gallery/ -> default to music
    if (/^\/gallery\/?$/.test(path)) return 'music';
    return null;
  }

  // ---- Shop URL builder ---------------------------------------------------
  // client_reference_id format: g=<slug>&c=<n>&p=<product>
  // matches what the fulfillment email looks for (per swr-stripe-setup.html).
  function buildShopUrl(gallerySlug, cardIndex, productId) {
    var p = new URLSearchParams({
      g: gallerySlug,
      c: String(cardIndex),
      p: productId || '',
    });
    return '/shop.html?' + p.toString();
  }

  function buildStripeUrl(productId, gallerySlug, cardIndex) {
    var product = catalogue().find(function (p) { return p.id === productId; });
    if (!product) return null;
    // BUG-017: a product without a live Payment Link yields no URL at all
    // instead of a dead checkout page. Callers (shop.html, decorateCard)
    // render a 'Coming soon' state.
    if (!isLiveLink(product.stripeUrl)) return null;
    var url = new URL(product.stripeUrl);
    url.searchParams.set('client_reference_id',
      'g=' + gallerySlug + '&c=' + cardIndex + '&p=' + productId);
    return url.toString();
  }

  // ---- Decorate one card --------------------------------------------------
  function decorateCard(card, gallerySlug, cardIndex) {
    if (!card || card.__swrShopDecorated) return;
    card.__swrShopDecorated = true;

    var art = card.querySelector('.gallery-card__art');
    if (!art) return;

    // Build the CTA overlay
    var cta = document.createElement('a');
    cta.className = 'gallery-card__buy';
    cta.href = buildShopUrl(gallerySlug, cardIndex, '');
    cta.setAttribute('aria-label', 'Buy this design on a tee or cup');
    cta.innerHTML =
      '<span class="gallery-card__buy-label">Buy on tee or cup</span>' +
      '<span class="gallery-card__buy-arrow" aria-hidden="true">→</span>';

    art.appendChild(cta);
  }

  function decorateAll() {
    var slug = detectGallerySlug();
    if (!slug) return;
    injectStyles();
    var cards = document.querySelectorAll('.gallery-card');
    cards.forEach(function (card, idx) {
      // Featured card comes first in DOM order (verified across all 15 galleries).
      decorateCard(card, slug, idx);
    });
  }

  // Expose
  window.SWR_SHOP = {
    get products() { return catalogue(); },
    decorate: decorateAll,
    buildShopUrl: buildShopUrl,
    buildStripeUrl: buildStripeUrl,
    detectGallerySlug: detectGallerySlug,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decorateAll);
  } else {
    decorateAll();
  }
})();