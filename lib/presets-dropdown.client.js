// lib/presets-dropdown.client.js — Accessible preset browser dropdown.
//
// Replaces / augments the old "N new personalities" pill with a full
// searchable, filterable preset browser accessible from the top nav bar.
//
// Mount:
//   window.SWR_PRESETS_DROPDOWN.init();   // idempotent, auto-runs on DOMContentLoaded
//
// API:
//   window.SWR_PRESETS_DROPDOWN.refreshBadge();  // call after SWR_PRESETS marks a preset seen
//
// How it works:
//   1. The trigger button mounts where the nav pill currently lives.
//   2. On click, the dropdown panel opens — fetched lazily on first open.
//   3. All presets are fetched once from GET /api/presets and cached in memory.
//   4. Family chips + search filter the in-memory list client-side.
//   5. Apply calls window.SWR_PRESETS.apply(id), marks the preset seen, and
//      decrements the badge count.
//
// Events dispatched to document (bubble):
//   'swr-preset-applied'   detail: { id }   — forwarded from SWR_PRESETS
//   'swr-preset-dismissed' detail: { id }   — user dismissed (X) in dropdown

(function () {
  'use strict';
  if (window.SWR_PRESETS_DROPDOWN) return;

  // ─── Constants ────────────────────────────────────────────────────────────────
  const TRIGGER_ID = 'swr-presets-dropdown-trigger';
  const PANEL_ID = 'swr-presets-dropdown-panel';
  const API_URL = '/api/presets';
  const SEEN_KEY = 'swr.presets.seen.v1'; // localStorage key for seen preset IDs
  const FAMILY_KEY = 'swr.presets.dropdown.family.v1'; // last selected family filter
  const DEBOUNCE_MS = 150;

  // ─── State ─────────────────────────────────────────────────────────────────
  var state = {
    open: false,
    allPresets: [],    // full list from API
    families: [],
    activeFamily: 'ALL',
    searchQuery: '',
    focusedIndex: -1,  // keyboard nav index into filteredPresets
    fetched: false,
    loading: false,
    cache: null,       // /api/presets response
  };

  // ─── Utilities ──────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function escapeAttr(s) { return escapeHtml(s); }

  // Return a copy of the seen-IDs Set from localStorage.
  function readSeenSet() {
    try {
      var raw = localStorage.getItem(SEEN_KEY);
      if (!raw) return new Set();
      var arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) {
      return new Set();
    }
  }

  function writeSeenSet(set) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...set]));
    } catch (_) {}
  }

  function getUnseenCount() {
    var seen = readSeenSet();
    return state.allPresets.filter(function (p) { return !seen.has(p.id); }).length;
  }

  // Debounce helper.
  function debounce(fn, ms) {
    var timer;
    return function () {
      var self = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  // ─── Filtered preset list (derived) ─────────────────────────────────────────
  function filteredPresets() {
    var f = state.activeFamily.toUpperCase();
    var q = state.searchQuery.trim().toLowerCase();
    return state.allPresets.filter(function (p) {
      if (f !== 'ALL' && (p.family || 'GENERATIVE').toUpperCase() !== f) return false;
      if (q) {
        var hay = [p.name || '', p.description || '', p.family || '']
          .concat(p.tags || [])
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  // ─── Build DOM ──────────────────────────────────────────────────────────────
  function buildTrigger() {
    var btn = document.createElement('button');
    btn.id = TRIGGER_ID;
    btn.type = 'button';
    btn.className = 'swr-presets-dropdown-trigger';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-label', 'Open personality presets');
    updateTriggerContent(btn);
    btn.addEventListener('click', toggleDropdown);
    return btn;
  }

  function updateTriggerContent(btn) {
    var unseen = getUnseenCount();
    var label = 'PERSONALITIES';
    var badge = unseen > 0
      ? '<span class="swr-presets-badge">' + unseen + '</span>'
      : '';
    btn.innerHTML = '<span class="swr-presets-trigger-label">' + label + '</span>' + badge + '<span class="swr-presets-chevron" aria-hidden="true">&#9654;</span>';
    btn.setAttribute('aria-label', 'Personality presets' + (unseen > 0 ? ', ' + unseen + ' new' : ''));
  }

  function buildPanel() {
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'swr-presets-panel';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', 'Personality presets');
    panel.hidden = true;
    panel.innerHTML = [
      '<div class="swr-presets-panel-head">',
      '  <div class="swr-presets-search-wrap">',
      '    <input class="swr-presets-search" type="search" placeholder="Search personalities…" autocomplete="off" aria-label="Search presets" />',
      '  </div>',
      '  <div class="swr-presets-chips" role="group" aria-label="Filter by family"></div>',
      '  <button class="swr-presets-panel-close" type="button" aria-label="Close">&#10005;</button>',
      '</div>',
      '<div class="swr-presets-list"></div>',
      '<div class="swr-presets-panel-foot">',
      '  <span class="swr-presets-count"></span>',
      '</div>',
    ].join('');
    return panel;
  }

  function buildFamilyChips() {
    var chips = $('swr-presets-chips');
    if (!chips) return;
    chips.innerHTML = '';
    var families = ['ALL'].concat(state.families);
    families.forEach(function (fam) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'swr-presets-chip' + (fam === state.activeFamily ? ' swr-presets-chip--active' : '');
      chip.textContent = fam;
      chip.setAttribute('aria-pressed', fam === state.activeFamily ? 'true' : 'false');
      chip.addEventListener('click', function () {
        state.activeFamily = fam;
        try { localStorage.setItem(FAMILY_KEY, fam); } catch (_) {}
        refreshChips();
        renderList();
      });
      chips.appendChild(chip);
    });
  }

  function refreshChips() {
    var chips = $('swr-presets-chips');
    if (!chips) return;
    chips.querySelectorAll('.swr-presets-chip').forEach(function (c) {
      var active = c.textContent === state.activeFamily;
      c.classList.toggle('swr-presets-chip--active', active);
      c.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function audioSummary(p) {
    var a = p.audio_reactivity || {};
    var parts = [];
    if (a.bass && a.bass.length) parts.push('B: ' + a.bass.join(','));
    if (a.mid && a.mid.length) parts.push('M: ' + a.mid.join(','));
    if (a.treble && a.treble.length) parts.push('T: ' + a.treble.join(','));
    if (a.onset && a.onset.length) parts.push('On: ' + a.onset.join(','));
    return parts.join(' · ');
  }

  function renderList() {
    var list = $('swr-presets-list');
    var count = $('swr-presets-count');
    if (!list) return;
    var presets = filteredPresets();
    if (count) count.textContent = presets.length + ' preset' + (presets.length !== 1 ? 's' : '');
    if (presets.length === 0) {
      list.innerHTML = '<div class="swr-presets-empty">No personalities match. Try a different search.</div>';
      return;
    }
    var seen = readSeenSet();
    var html = '';
    presets.forEach(function (p, i) {
      var pal = p.palette || {};
      var tags = (p.tags || []).slice(0, 4);
      var isNew = !seen.has(p.id);
      var svg = (p.preview && p.preview.thumbnail_svg) || '<svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg"><rect width="72" height="72" fill="#14141a"/></svg>';
      html += [
        '<div class="swr-presets-item' + (i === state.focusedIndex ? ' swr-presets-item--focused' : '') + '"',
        '     data-index="' + i + '"',
        '     data-id="' + escapeAttr(p.id) + '"',
        '     role="option"',
        '     aria-selected="' + (i === state.focusedIndex ? 'true' : 'false') + '">',
        '  <div class="swr-presets-item-thumb">' + svg + '</div>',
        '  <div class="swr-presets-item-body">',
        '    <div class="swr-presets-item-name">' + escapeHtml(p.name || p.id) + '</div>',
        '    <div class="swr-presets-item-meta">',
        '      <span class="swr-presets-item-family">' + escapeHtml(p.family || 'GENERATIVE') + '</span>',
        isNew ? '      <span class="swr-presets-item-new">NEW</span>' : '',
        '      <span class="swr-presets-item-tags">' + tags.map(function (t) { return '<span class="swr-presets-tag">' + escapeHtml(t) + '</span>'; }).join('') + '</span>',
        '    </div>',
        '    <div class="swr-presets-item-desc">' + escapeHtml((p.description || '').slice(0, 120) + (p.description && p.description.length > 120 ? '…' : '')) + '</div>',
        '    <div class="swr-presets-item-palette">',
        '      <span class="swr-presets-color" style="background:' + escapeAttr(pal.bg || '#000') + '" title="bg"></span>',
        '      <span class="swr-presets-color" style="background:' + escapeAttr(pal.primary || '#888') + '" title="primary"></span>',
        '      <span class="swr-presets-color" style="background:' + escapeAttr(pal.secondary || '#888') + '" title="secondary"></span>',
        '      <span class="swr-presets-color" style="background:' + escapeAttr(pal.accent || '#888') + '" title="accent"></span>',
        '    </div>',
        '    <div class="swr-presets-item-audio">' + escapeHtml(audioSummary(p)) + '</div>',
        '  </div>',
        '  <div class="swr-presets-item-actions">',
        '    <button class="swr-presets-apply-btn" type="button" data-id="' + escapeAttr(p.id) + '">Apply</button>',
        '  </div>',
        '</div>',
      ].join('');
    });
    list.innerHTML = html;
    // Attach apply handlers.
    list.querySelectorAll('.swr-presets-apply-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-id');
        applyPreset(id);
      });
    });
  }

  // ─── Apply ─────────────────────────────────────────────────────────────────
  function applyPreset(id) {
    if (!window.SWR_PRESETS || typeof window.SWR_PRESETS.apply !== 'function') {
      console.warn('[presets-dropdown] SWR_PRESETS.apply not found');
      return;
    }
    var result = window.SWR_PRESETS.apply(id);
    // Mark as seen.
    var seen = readSeenSet();
    seen.add(id);
    writeSeenSet(seen);
    // Update trigger badge.
    var trigger = $(TRIGGER_ID);
    if (trigger) updateTriggerContent(trigger);
    // Refresh list (to remove NEW badge).
    renderList();
    // Fire event for other listeners (e.g. engine).
    document.dispatchEvent(new CustomEvent('swr-preset-applied', { bubbles: true, detail: { id: id } }));
    // Close dropdown.
    closeDropdown();
  }

  // ─── Open / Close ───────────────────────────────────────────────────────────
  function openDropdown() {
    var panel = $(PANEL_ID);
    var trigger = $(TRIGGER_ID);
    if (!panel || !trigger) return;
    state.open = true;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('swr-presets-trigger--open');
    // Lazy-fetch presets.
    if (!state.fetched) {
      fetchPresets();
    } else {
      renderList();
      buildFamilyChips();
    }
    // Focus the search input.
    var search = panel.querySelector('.swr-presets-search');
    if (search) { search.focus(); search.select(); }
    state.focusedIndex = -1;
  }

  function closeDropdown() {
    var panel = $(PANEL_ID);
    var trigger = $(TRIGGER_ID);
    if (!panel || !trigger) return;
    state.open = false;
    state.focusedIndex = -1;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('swr-presets-trigger--open');
  }

  function toggleDropdown(e) {
    e.stopPropagation();
    if (state.open) closeDropdown(); else openDropdown();
  }

  // ─── Fetch ─────────────────────────────────────────────────────────────────
  function fetchPresets() {
    if (state.loading) return;
    state.loading = true;
    var list = $('swr-presets-list');
    if (list) list.innerHTML = '<div class="swr-presets-loading">Loading personalities…</div>';
    fetch(API_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        state.allPresets = data.presets || [];
        state.families = data.families || [];
        state.fetched = true;
        state.loading = false;
        // Restore last family filter.
        try {
          var saved = localStorage.getItem(FAMILY_KEY);
          if (saved && state.families.indexOf(saved) >= 0) state.activeFamily = saved;
        } catch (_) {}
        renderList();
        buildFamilyChips();
      })
      .catch(function (err) {
        state.loading = false;
        var list = $('swr-presets-list');
        if (list) list.innerHTML = '<div class="swr-presets-empty">Could not load presets. Refresh and try again.</div>';
        console.warn('[presets-dropdown] fetch failed:', err);
      });
  }

  // ─── Keyboard nav ────────────────────────────────────────────────────────────
  function onKeyDown(e) {
    if (!state.open) return;
    var presets = filteredPresets();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.focusedIndex = Math.min(state.focusedIndex + 1, presets.length - 1);
      scrollFocusedIntoView();
      renderList();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.focusedIndex = Math.max(state.focusedIndex - 1, 0);
      scrollFocusedIntoView();
      renderList();
      return;
    }
    if (e.key === 'Enter' && state.focusedIndex >= 0) {
      e.preventDefault();
      var p = presets[state.focusedIndex];
      if (p) applyPreset(p.id);
      return;
    }
  }

  function scrollFocusedIntoView() {
    var item = $('swr-presets-list').querySelector('.swr-presets-item[data-index="' + state.focusedIndex + '"]');
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  // ─── Search ─────────────────────────────────────────────────────────────────
  var debouncedSearch = debounce(function () {
    state.searchQuery = ($('.swr-presets-search') && $('.swr-presets-search').value) || '';
    state.focusedIndex = -1;
    renderList();
  }, DEBOUNCE_MS);

  // ─── Init ───────────────────────────────────────────────────────────────────
  function mount() {
    // Remove any stale instances.
    var oldTrigger = $(TRIGGER_ID); if (oldTrigger) oldTrigger.remove();
    var oldPanel = $(PANEL_ID); if (oldPanel) oldPanel.remove();

    // Find mount point — wherever the existing presets pill lives.
    // If it exists, replace it. Otherwise mount next to the nav brand.
    var mountPoint = document.getElementById('status-pill')
      || document.getElementById('status')
      || document.getElementById('audioStatus')
      || document.querySelector('.status-pill, .status')
      || document.querySelector('.swr-nav__links')
      || document.body;

    var trigger = buildTrigger();
    var panel = buildPanel();

    if (mountPoint === document.body) {
      // Fixed overlay — mount as a direct child of body.
      document.body.appendChild(trigger);
      document.body.appendChild(panel);
    } else {
      // Inline in the nav/status area.
      var wrapper = document.createElement('span');
      wrapper.className = 'swr-presets-dropdown-host';
      wrapper.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:8px;';
      wrapper.appendChild(trigger);
      mountPoint.appendChild(wrapper);
      document.body.appendChild(panel);
    }

    // Event listeners.
    document.addEventListener('keydown', onKeyDown);

    // Click outside closes.
    document.addEventListener('click', function (e) {
      if (!state.open) return;
      var panel = $(PANEL_ID);
      var trigger = $(TRIGGER_ID);
      if (!panel || !trigger) return;
      if (!panel.contains(e.target) && !trigger.contains(e.target)) {
        closeDropdown();
      }
    });

    // Panel close button.
    panel.querySelector('.swr-presets-panel-close').addEventListener('click', closeDropdown);

    // Search input.
    var searchInput = panel.querySelector('.swr-presets-search');
    if (searchInput) searchInput.addEventListener('input', debouncedSearch);

    // Escape on search closes dropdown.
    if (searchInput) {
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); closeDropdown(); }
      });
    }

    // Listen for external preset-applied events (engine may apply via keyboard shortcut).
    document.addEventListener('swr-preset-applied', function (e) {
      var id = e && e.detail && e.detail.id;
      if (id) {
        var seen = readSeenSet();
        seen.add(id);
        writeSeenSet(seen);
        var trigger = $(TRIGGER_ID);
        if (trigger) updateTriggerContent(trigger);
        if (state.open) renderList();
      }
    });

    // Also listen to swr-presets-loaded (from the existing panel system).
    document.addEventListener('swr-presets-loaded', function (e) {
      // Refresh unseen count.
      var trigger = $(TRIGGER_ID);
      if (trigger) updateTriggerContent(trigger);
    });

    // Pre-fetch silently in background (cache for when dropdown opens).
    fetch( API_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        state.allPresets = data.presets || [];
        state.families = data.families || [];
        state.fetched = true;
        var trigger = $(TRIGGER_ID);
        if (trigger) updateTriggerContent(trigger);
      })
      .catch(function () {});
  }

  // ─── Public API ──────────────────────────────────────────────────────────────
  window.SWR_PRESETS_DROPDOWN = {
    init: mount,
    refreshBadge: function () {
      var trigger = $(TRIGGER_ID);
      if (trigger) updateTriggerContent(trigger);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
