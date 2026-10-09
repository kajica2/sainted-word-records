// marketplace-claim.client.js — free-item claim controller (window.SWR_MARKETPLACE).
//
// Loaded by marketplace.html into #marketplace-grid. Fetches available items
// from /api/marketplace (GET), renders them in a grid with type, title, creator
// type, and quantity. Handles claim button clicks via POST /api/marketplace,
// updates a live ticker showing available/claimed counts, shows countdown timers
// for clips with lifespans, and displays toast notifications for success/failure.
//
// Global-script IIFE per the repo's .client.js convention: attaches
// exactly one global (window.SWR_MARKETPLACE).

(function () {
  var grid = null;
  var ticker = null;
  var toastContainer = null;
  var countdownInterval = null;

  // Item type labels
  var TYPES = {
    clip: 'Video clip',
    audio: 'Audio clip',
    preset: 'Preset',
    asset: 'Asset pack',
    template: 'Template'
  };

  // Creator type labels
  var CREATOR = {
    official: 'Official',
    community: 'Community',
    artist: 'Artist'
  };

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

  // Toast notification system
  function showToast(kind, msg) {
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + kind;
    toast.textContent = msg;
    toastContainer.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(function () {
      toast.classList.add('show');
    });

    // Auto-remove after 4 seconds
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 4000);
  }

  // Format countdown timer
  function formatCountdown(ms) {
    if (ms <= 0) return 'Expired';
    var seconds = Math.floor(ms / 1000);
    var minutes = Math.floor(seconds / 60);
    var hours = Math.floor(minutes / 60);
    var days = Math.floor(hours / 24);

    if (days > 0) return days + 'd ' + (hours % 24) + 'h';
    if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
    if (minutes > 0) return minutes + 'm ' + (seconds % 60) + 's';
    return seconds + 's';
  }

  // Update ticker with available/claimed counts
  function updateTicker(stats) {
    if (!ticker) return;
    var available = stats.available || 0;
    var claimed = stats.claimed || 0;
    var total = available + claimed;
    ticker.innerHTML = '<span class="ticker-available">' + available + ' available</span>' +
      '<span class="ticker-sep">·</span>' +
      '<span class="ticker-claimed">' + claimed + ' claimed</span>' +
      (stats.total !== undefined ? '<span class="ticker-sep">·</span><span class="ticker-total">' + total + ' total</span>' : '');
  }

  // Start countdown timers for items with lifespans
  function startCountdowns(items) {
    if (countdownInterval) clearInterval(countdownInterval);

    function tick() {
      var now = Date.now();
      items.forEach(function (it) {
        if (!it.expiresAt) return;
        var el = document.querySelector('[data-expires="' + esc(it.id) + '"]');
        if (!el) return;

        var remaining = it.expiresAt - now;
        if (remaining <= 0) {
          el.textContent = 'Expired';
          el.classList.add('expired');
          return;
        }
        el.textContent = formatCountdown(remaining);
      });
    }

    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  // Render marketplace items in grid
  function render(items) {
    if (!items.length) {
      grid.innerHTML = '<div class="empty">No items available right now — check back soon.</div>';
      return;
    }

    // Collect items with expirations for countdown
    var expiringItems = items.filter(function (it) { return it.expiresAt; });

    grid.innerHTML = items.map(function (it) {
      var typeLabel = TYPES[it.type] || it.type || 'Item';
      var creatorLabel = CREATOR[it.creatorType] || it.creatorType || 'Unknown';
      var quantity = it.quantity !== undefined ? it.quantity : '∞';
      var available = it.available !== undefined ? it.available : quantity;
      var canClaim = available > 0 && (!it.expiresAt || it.expiresAt > Date.now());

      var countdownHtml = it.expiresAt
        ? '<span class="countdown" data-expires="' + esc(it.id) + '">' + formatCountdown(it.expiresAt - Date.now()) + '</span>'
        : '';

      var statusClass = available === 0 ? 'sold-out' : (canClaim ? 'available' : 'expired');

      return '<div class="card ' + statusClass + '">' +
        '<span class="kind">' + esc(typeLabel) + '</span>' +
        '<span class="creator">' + esc(creatorLabel) + '</span>' +
        '<h3>' + esc(it.title) + '</h3>' +
        '<p class="desc">' + esc(it.description || '') + '</p>' +
        '<p class="meta">' +
        (typeof quantity === 'number' && quantity !== Infinity
          ? 'Quantity: ' + available + ' / ' + quantity
          : 'Unlimited') +
        '</p>' +
        (countdownHtml ? '<p class="expires">' + countdownHtml + '</p>' : '') +
        '<div class="action-row">' +
        '<button class="btn primary" data-claim="' + esc(it.id) + '"' + (!canClaim ? ' disabled' : '') + '>' +
        (available === 0 ? 'Sold out' : (it.expiresAt && it.expiresAt <= Date.now() ? 'Expired' : 'Claim')) +
        '</button>' +
        '</div>' +
        '</div>';
    }).join('');

    // Attach click handlers
    Array.prototype.forEach.call(grid.querySelectorAll('button[data-claim]'), function (b) {
      b.addEventListener('click', function () { claim(b.getAttribute('data-claim'), b); });
    });

    // Start countdown timers
    if (expiringItems.length) {
      startCountdowns(items);
    }
  }

  // Handle claim action
  function claim(itemId, btn) {
    btn.disabled = true;
    btn.textContent = 'Claiming...';

    api('/api/marketplace', { method: 'POST', body: { itemId: itemId } }).then(function (r) {
      if (r.status === 401) {
        showToast('err', 'Sign in to claim items — then come back and hit Claim again.');
        btn.disabled = false;
        btn.textContent = 'Claim';
        window.location.href = '/auth/login';
        return;
      }
      if (r.status === 403) {
        showToast('err', (r.json && r.json.message) || 'You cannot claim this item.');
        btn.disabled = false;
        btn.textContent = 'Claim';
        return;
      }
      if (r.status === 409) {
        showToast('err', (r.json && r.json.message) || 'This item is no longer available.');
        btn.disabled = false;
        btn.textContent = 'Sold out';
        return;
      }
      if (r.status === 410) {
        showToast('err', (r.json && r.json.message) || 'This item has expired.');
        btn.disabled = false;
        btn.textContent = 'Expired';
        return;
      }
      if (r.status !== 200 || !r.json) {
        showToast('err', (r.json && r.json.message) || 'Something went wrong claiming this item.');
        btn.disabled = false;
        btn.textContent = 'Claim';
        return;
      }

      // Success
      showToast('ok', 'Successfully claimed: ' + (r.json.title || 'item') + '!');

      // Update the button state
      var newAvailable = r.json.available;
      if (newAvailable !== undefined) {
        var metaEl = btn.closest('.card').querySelector('.meta');
        if (metaEl && r.json.quantity !== undefined) {
          metaEl.textContent = 'Quantity: ' + newAvailable + ' / ' + r.json.quantity;
        }
        if (newAvailable === 0) {
          btn.textContent = 'Sold out';
          btn.closest('.card').classList.add('sold-out');
        } else {
          btn.disabled = false;
          btn.textContent = 'Claim';
        }
      } else {
        btn.textContent = 'Claimed';
      }

      // Update ticker if stats provided
      if (r.json.stats) {
        updateTicker(r.json.stats);
      }

    }).catch(function () {
      showToast('err', 'Network error — could not claim this item.');
      btn.disabled = false;
      btn.textContent = 'Claim';
    });
  }

  // Initialize
  function init() {
    grid = $('marketplace-grid');
    ticker = $('marketplace-ticker');

    // Create toast container if not exists
    toastContainer = $('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      document.body.appendChild(toastContainer);
    }

    if (!grid) return;

    // Show loading state
    grid.innerHTML = '<p class="empty">Loading marketplace items…</p>';

    // Fetch items
    api('/api/marketplace').then(function (r) {
      if (r.status !== 200 || !r.json) {
        grid.innerHTML = '<p class="empty">Could not load the marketplace right now.</p>';
        return;
      }

      var items = r.json.items || [];
      render(items);

      // Update ticker if stats provided
      if (r.json.stats) {
        updateTicker(r.json.stats);
      }
    }).catch(function () {
      grid.innerHTML = '<p class="empty">Could not reach the API.</p>';
    });

    // Fetch ticker data periodically
    function fetchTicker() {
      api('/api/marketplace?ticker=true').then(function (r) {
        if (r.status === 200 && r.json && r.json.ticker) {
          updateTicker(r.json.ticker);
        }
      }).catch(function () {
        // Silent fail for ticker
      });
    }

    // Initial ticker fetch
    fetchTicker();

    // Update ticker every 30 seconds
    setInterval(fetchTicker, 30000);
  }

  // Cleanup on unload
  function cleanup() {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  window.SWR_MARKETPLACE = { init: init, cleanup: cleanup };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanup);
})();
