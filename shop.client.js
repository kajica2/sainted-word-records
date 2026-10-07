// shop.client.js — buyer browse/checkout controller (window.SWR_SHOP).
//
// Loaded by buy.html into #shop-grid. Fetches the public catalogue
// (/api/catalogue/public), renders live listings, and starts a Stripe
// Checkout Session (/api/checkout) when a buyer hits Buy — bundles are
// resolved server-side so totals are never trusted from the client.
//
// Global-script IIFE per the repo's .client.js convention: attaches
// exactly one global (window.SWR_SHOP).

(function () {
  var grid = null;
  var notice = null;

  var TYPES = { song: 'Song', video: 'Video file', pack: 'Media pack' };
  var KIND = { audio: 'song', video: 'video', image: 'image' };

  function $(id) { return document.getElementById(id); }

  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.json().then(function (json) {
        return { status: r.status, json: json };
      }).catch(function () {
        return { status: r.status, json: null };
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmt(minor) { return (minor / 100).toFixed(2); }

  function showNotice(kind, msg) {
    notice.className = 'notice show ' + kind;
    notice.textContent = msg;
  }

  function init() {
    grid = $('shop-grid');
    notice = $('notice');
    if (!grid) return;

    var q = new URLSearchParams(window.location.search);
    if (q.get('pt') === 'paid') {
      showNotice('ok', 'Payment received — activating your PT licence…');
      (function pollKey(attempt) {
        fetch('/api/slots', { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            var g = d && d.grants ? d.grants.find(function (x) { return x && x.ptKey; }) : null;
            if (g) {
              showNotice('ok', 'Licence active — your key is ' + g.ptKey + '. Paste it into the PT panel in the engine.');
            } else if (attempt < 5) {
              setTimeout(function () { pollKey(attempt + 1); }, 2500);
            } else {
              showNotice('ok', 'Payment received. Your licence will appear in the PT panel shortly — refresh if needed.');
            }
          })
          .catch(function () {
            if (attempt < 5) setTimeout(function () { pollKey(attempt + 1); }, 2500);
          });
      })(0);
    } else if (q.get('pt') === 'cancelled') {
      showNotice('err', 'Checkout cancelled — no charge was made.');
    } else if (q.get('status') === 'paid') {
      showNotice('ok', 'Payment successful — your remix license is live. Check your email for the receipt and access.');
    } else if (q.get('status') === 'cancelled') {
      showNotice('err', 'Checkout cancelled — you were not charged. Come back any time.');
    }

    api('/api/catalogue/public').then(function (r) {
      if (r.status !== 200 || !r.json) {
        grid.innerHTML = '<p class="empty">Could not load the catalogue right now.</p>';
        return;
      }
      var items = r.json.items || [];
      render(items);
    }).catch(function () {
      grid.innerHTML = '<p class="empty">Could not reach the API.</p>';
    });
  }

  function render(items) {
    if (!items.length) {
      grid.innerHTML = '<div class="empty">No listings live yet — check back soon.</div>';
      return;
    }
    grid.innerHTML = items.map(function (it) {
      var bundle = (it.bundleOf || []).length
        ? ' · bundle of ' + (it.bundleOf.length + 1)
        : '';
      var media = it.mediaCount ? it.mediaCount + ' file' + (it.mediaCount === 1 ? '' : 's') : 'no media yet';
      return '<div class="card">' +
        '<span class="kind">' + esc(TYPES[it.type] || it.type) + bundle + '</span>' +
        '<h3>' + esc(it.title) + '</h3>' +
        '<p class="desc">' + esc(it.description || '') + '</p>' +
        '<p class="meta">' + media +
        (it.tags && it.tags.length ? ' · #' + esc(it.tags.join(' #')) : '') + '</p>' +
        '<div class="price-row">' +
        '<div class="price">€' + fmt(it.priceMinor) + '<span class="fee">buyer adds a service fee at checkout</span></div>' +
        '<button class="btn primary" data-buy="' + esc(it.id) + '">Buy now</button>' +
        '</div>' +
        '</div>';
    }).join('');

    Array.prototype.forEach.call(grid.querySelectorAll('button[data-buy]'), function (b) {
      b.addEventListener('click', function () { buy(b.getAttribute('data-buy'), b); });
    });
  }

  function buy(listingId, btn) {
    btn.disabled = true;
    api('/api/checkout', { method: 'POST', body: { listingId: listingId } }).then(function (r) {
      if (r.status === 401) {
        showNotice('err', 'Sign in to buy — then come back and hit Buy again.');
        btn.disabled = false;
        window.location.href = '/auth/login';
        return;
      }
      if (r.status === 503 && r.json && r.json.error === 'stripe_not_configured') {
        showNotice('err', 'Checkout is not configured yet on this deployment.');
        btn.disabled = false;
        return;
      }
      if (r.status !== 200 || !r.json || !r.json.url) {
        showNotice('err', (r.json && r.json.message) || 'Something went wrong starting checkout.');
        btn.disabled = false;
        return;
      }
      window.location.href = r.json.url;
    }).catch(function () {
      showNotice('err', 'Network error — could not start checkout.');
      btn.disabled = false;
    });
  }

  window.SWR_SHOP = { init: init };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();