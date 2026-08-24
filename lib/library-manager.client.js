// lib/library-manager.client.js — Library Manager UI.
//
// Public API
//
//   window.SWR_LIBRARY_MANAGER.render(target, opts)
//     target:  HTMLElement — replaced in-place.
//     opts:    {
//       onAddToPlaylist(songs):       bulk-add callback (receives the selected
//                                     UnifiedSong[]; default: mutates
//                                     SWR_PLAYLIST directly).
//       onRemove(removedUnified[]):   after bulk remove completes.
//       onPick(unifiedSong):          fired when the user clicks a row's
//                                     "play / pick" button (defaults to no-op).
//     }
//
//     Returns { root, refresh, destroy, setData }.
//       refresh()                   — re-read SWR_MEDIA and re-render rows.
//       destroy()                   — remove the panel and free listeners.
//       setData(rows, opts?)        — replace the current row set with the
//                                     given UnifiedSong[]. Used by tests and
//                                     future playlist/queue sources.
//
// Data source:
//   - Library rows come from window.SWR_MEDIA.getUserMedia() (audio mime only).
//   - Playlist rows are NOT shown here — that's the library source only.
//     The Phase-1 picker carries the cross-source tabs; this module is the
//     *manager* for the library, so the UI focus is "browse, curate,
//     dispatch to playlist."
//
// State lives in a private closure (no globals). Selection persists across
// refresh(); rows that disappear (removed/bulk-removed) silently drop out of
// the selection set.
//
// Idempotent: re-evaluating the script returns the cached singleton.

(function () {
  'use strict';

  if (window.SWR_LIBRARY_MANAGER) return;

  var STORAGE_PREFIX = 'swr.libraryManager';

  // ---- micro-helpers ----------------------------------------------------

  function el(tag, props, children) {
    var e = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === 'class') e.className = props[k];
      else if (k === 'text') e.textContent = props[k];
      else if (k === 'html') e.innerHTML = props[k];
      else if (k === 'style' && typeof props[k] === 'object') Object.assign(e.style, props[k]);
      else if (k.indexOf('on') === 0 && typeof props[k] === 'function') {
        e.addEventListener(k.slice(2).toLowerCase(), props[k]);
      } else if (props[k] != null) {
        e.setAttribute(k, props[k]);
      }
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function fmtDur(s) {
    if (!s || !isFinite(s) || s <= 0) return '—:—';
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  function initial(t) {
    if (!t) return '♪';
    var c = String(t).trim().charAt(0).toUpperCase();
    return /[A-Z0-9]/.test(c) ? c : '♪';
  }

  // ---- render() ---------------------------------------------------------

  function render(target, opts) {
    if (typeof target === 'string') target = document.querySelector(target);
    if (!target) return null;
    opts = opts || {};
    target.innerHTML = '';
    target.classList.add('lmp-root');

    var state = {
      rows: [],          // current UnifiedSong[] (filtered+searched+sorted)
      allRows: [],       // last fetched from SWR_MEDIA / setData()
      search: '',
      sortBy: 'title',  // 'title' | 'artist' | 'date'
      selected: new Set(),  // UnifiedSong.id strings
      libraryEmpty: true,
    };

    // ----- tab strip (Library only for now; future: Uploads/Playlist) ----
    var tabs = el('div', { class: 'lmp-tabs' }, [
      el('button', {
        type: 'button', class: 'lmp-tab active', 'data-source': 'library', text: 'LIBRARY',
      }),
    ]);

    // ----- toolbar (search + sort + bulk actions) ----
    var searchInput = el('input', {
      type: 'text', class: 'lmp-search', placeholder: 'Search title or artist…',
      'aria-label': 'Search library',
    });
    var sortSelect = el('select', { class: 'lmp-sort', 'aria-label': 'Sort by' }, [
      el('option', { value: 'title', text: 'Sort: Title' }),
      el('option', { value: 'artist', text: 'Sort: Artist' }),
      el('option', { value: 'date', text: 'Sort: Newest' }),
    ]);

    var selectAllBtn   = el('button', { type: 'button', class: 'lmp-bulk lmp-select-all', text: 'SELECT ALL' });
    var addToPlaylistBtn = el('button', { type: 'button', class: 'lmp-bulk lmp-add-pl', text: 'ADD TO PLAYLIST', disabled: 'disabled' });
    var removeBtn      = el('button', { type: 'button', class: 'lmp-bulk lmp-remove', text: 'REMOVE', disabled: 'disabled' });
    var clearBtn       = el('button', { type: 'button', class: 'lmp-bulk lmp-clear', text: 'CLEAR LIBRARY' });

    var counter = el('span', { class: 'lmp-counter', text: '0 selected' });

    var toolbar = el('div', { class: 'lmp-toolbar' }, [
      el('div', { class: 'lmp-toolbar-row' }, [searchInput, sortSelect]),
      el('div', { class: 'lmp-toolbar-row lmp-toolbar-bulk' }, [
        selectAllBtn, addToPlaylistBtn, removeBtn, clearBtn, counter,
      ]),
    ]);

    // ----- list + empty state ----
    var list = el('div', { class: 'lmp-list' });
    var empty = el('div', { class: 'lmp-empty', text: 'Your library is empty.' });

    var panel = el('div', { class: 'lmp-panel' }, [tabs, toolbar, list, empty]);
    target.appendChild(panel);

    // ----- row rendering ----
    function drawRow(row) {
      var checked = state.selected.has(row.id);
      var checkbox = el('input', {
        type: 'checkbox', class: 'lmp-check',
        'aria-label': 'Select ' + (row.title || 'untitled'),
      });
      checkbox.checked = checked;
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) state.selected.add(row.id);
        else state.selected.delete(row.id);
        updateCounter();
        updateBulkButtons();
      });

      var thumb;
      if (row.thumbUrl) {
        thumb = el('div', { class: 'lmp-thumb' }, [Object.assign(new Image(), { src: row.thumbUrl })]);
      } else {
        thumb = el('div', { class: 'lmp-thumb' }, [
          el('span', { class: 'lmp-thumb-fallback', text: initial(row.title) }),
        ]);
      }

      var meta = el('div', { class: 'lmp-meta' }, [
        el('div', { class: 'lmp-title', text: row.title || '(untitled)' }),
        el('div', {
          class: 'lmp-sub',
          text: (row.artist ? row.artist + ' · ' : '') + fmtDur(row.duration),
        }),
      ]);

      var play = el('button', {
        type: 'button', class: 'lmp-row-play',
        'aria-label': 'Load ' + (row.title || 'untitled'),
        title: 'Load into engine',
        text: '▶',
      });
      play.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (typeof opts.onPick === 'function') {
          try { opts.onPick(row); } catch (e) { console.warn('[SWR_LIBRARY_MANAGER onPick]', e); }
        }
      });

      var del = el('button', {
        type: 'button', class: 'lmp-row-del',
        'aria-label': 'Remove ' + (row.title || 'untitled'),
        title: 'Remove from library',
        text: '×',
      });
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        removeRow(row);
      });

      var rowEl = el('div', { class: 'lmp-row' }, [checkbox, thumb, meta, play, del]);
      rowEl.dataset.id = row.id;
      return rowEl;
    }

    function recomputeList() {
      // Filter
      var q = (state.search || '').trim().toLowerCase();
      var rows = state.allRows.filter(function (r) {
        if (!q) return true;
        return ((r.title || '').toLowerCase().indexOf(q) !== -1) ||
               ((r.artist || '').toLowerCase().indexOf(q) !== -1);
      });
      // Sort (copy first so we don't mutate caller's array)
      rows = rows.slice().sort(function (a, b) {
        if (state.sortBy === 'artist') {
          var aa = (a.artist || '').toLowerCase();
          var bb = (b.artist || '').toLowerCase();
          if (aa !== bb) return aa < bb ? -1 : 1;
          return (a.title || '').localeCompare(b.title || '');
        }
        if (state.sortBy === 'date') {
          var ad = a.createdAt || 0;
          var bd = b.createdAt || 0;
          if (ad !== bd) return bd - ad; // newest first
          return (a.title || '').localeCompare(b.title || '');
        }
        // default: title A→Z
        return (a.title || '').localeCompare(b.title || '');
      });
      state.rows = rows;

      list.innerHTML = '';
      if (!rows.length) {
        empty.style.display = '';
        empty.textContent = q
          ? 'No songs match "' + state.search + '".'
          : 'Your library is empty. Drop audio files into the Uploads panel to fill it.';
        toolbar.style.display = state.libraryEmpty ? 'none' : '';
      } else {
        empty.style.display = 'none';
        toolbar.style.display = '';
        rows.forEach(function (r) { list.appendChild(drawRow(r)); });
      }
      updateCounter();
      updateBulkButtons();
    }

    function updateCounter() {
      var n = state.selected.size;
      counter.textContent = n + ' selected';
    }

    function updateBulkButtons() {
      var n = state.selected.size;
      var hasRows = state.rows.length > 0;
      selectAllBtn.textContent = (n > 0 && n === state.rows.length) ? 'DESELECT ALL' : 'SELECT ALL';
      selectAllBtn.disabled = !hasRows;
      addToPlaylistBtn.disabled = n === 0;
      removeBtn.disabled = n === 0;
      clearBtn.disabled = state.libraryEmpty || state.allRows.length === 0;
    }

    function removeRow(row) {
      var M = window.SWR_MEDIA;
      if (!M || typeof M.deleteMedia !== 'function') {
        console.warn('[SWR_LIBRARY_MANAGER] SWR_MEDIA missing; nothing to delete.');
        return Promise.resolve();
      }
      return M.deleteMedia(row.sourceId).then(function () {
        state.selected.delete(row.id);
        return loadFromMedia();
      }, function (err) {
        console.warn('[SWR_LIBRARY_MANAGER] delete failed for', row, err);
      });
    }

    function removeSelected() {
      var rows = state.rows.filter(function (r) { return state.selected.has(r.id); });
      if (!rows.length) return Promise.resolve();
      var M = window.SWR_MEDIA;
      if (!M || typeof M.deleteMedia !== 'function') return Promise.resolve();
      return Promise.all(rows.map(function (r) {
        return M.deleteMedia(r.sourceId).catch(function (e) {
          console.warn('[SWR_LIBRARY_MANAGER] delete failed for', r, e);
          return null;
        });
      })).then(function () {
        rows.forEach(function (r) { state.selected.delete(r.id); });
        if (typeof opts.onRemove === 'function') {
          try { opts.onRemove(rows); } catch (e) {}
        }
        return loadFromMedia();
      });
    }

    function clearLibrary() {
      if (!window.confirm('Remove every song from your library? This cannot be undone.')) return Promise.resolve();
      var M = window.SWR_MEDIA;
      if (!M || typeof M.deleteAll !== 'function') return Promise.resolve();
      return M.deleteAll().then(function () {
        state.selected.clear();
        return loadFromMedia();
      });
    }

    function addSelectedToPlaylist() {
      var rows = state.rows.filter(function (r) { return state.selected.has(r.id); });
      if (!rows.length) return;
      if (typeof opts.onAddToPlaylist === 'function') {
        try { opts.onAddToPlaylist(rows); return; } catch (e) { console.warn('[SWR_LIBRARY_MANAGER onAddToPlaylist]', e); }
      }
      // Default behavior: push into SWR_PLAYLIST, with a safe row shape
      // (no blob URLs, no albumArt blob refs — playlist rows must be rest-able).
      var P = (window.SWR_PLAYLIST) || (window.SWR && window.SWR.PLAYLIST);
      if (P && typeof P.add === 'function') {
        rows.forEach(function (r) {
          P.add({
            id: r.id,
            source: r.source,
            sourceId: r.sourceId,
            title: r.title,
            artist: r.artist,
            duration: r.duration || 0,
          });
        });
      }
    }

    function selectAllToggle() {
      if (state.selected.size === state.rows.length) {
        state.selected.clear();
      } else {
        state.rows.forEach(function (r) { state.selected.add(r.id); });
      }
      // Re-render only the rows' checkbox state + counter.
      var checks = list.querySelectorAll('.lmp-check');
      var ids = state.rows.map(function (r) { return r.id; });
      checks.forEach(function (c, i) { c.checked = state.selected.has(ids[i]); });
      updateCounter();
      updateBulkButtons();
    }

    // ----- listeners ----
    searchInput.addEventListener('input', function () {
      state.search = searchInput.value;
      recomputeList();
    });
    sortSelect.addEventListener('change', function () {
      state.sortBy = sortSelect.value;
      recomputeList();
    });
    selectAllBtn.addEventListener('click', selectAllToggle);
    addToPlaylistBtn.addEventListener('click', addSelectedToPlaylist);
    removeBtn.addEventListener('click', removeSelected);
    clearBtn.addEventListener('click', function () { clearLibrary(); });

    // ----- data loading ----
    function loadFromMedia() {
      var M = window.SWR_MEDIA;
      if (!M || typeof M.getUserMedia !== 'function') {
        state.allRows = [];
        state.libraryEmpty = true;
        recomputeList();
        return Promise.resolve();
      }
      // The manager is the *library manager*, not a song picker. It shows
      // every media row the user has, regardless of mime — the picker
      // (lib/library-switcher.client.js) is the one that filters to audio/*
      // because it specifically answers "pick a song". A user who uploads
      // a video should still see and be able to remove it here.
      return M.getUserMedia().then(function (rows) {
        state.allRows = (rows || [])
          .filter(function (r) { return r && r.blob && r.mime; })
          .map(toUnifiedFromLibrary);
        state.libraryEmpty = state.allRows.length === 0;
        recomputeList();
      }, function (err) {
        console.warn('[SWR_LIBRARY_MANAGER] getUserMedia failed', err);
        state.allRows = [];
        state.libraryEmpty = true;
        recomputeList();
      });
    }

    function toUnifiedFromLibrary(r) {
      return {
        id: 'library:' + r.id,
        source: 'library',
        sourceId: r.id,
        title: r.name || '(untitled)',
        duration: 0,
        url: undefined,
        thumbUrl: undefined,
        createdAt: r.createdAt || 0,
      };
    }

    // Initial draw — triggers fresh fetch + recompute.
    loadFromMedia();

    return {
      root: panel,
      refresh: loadFromMedia,
      destroy: function () {
        target.classList.remove('lmp-root');
        target.innerHTML = '';
      },
      setData: function (rows) {
        state.allRows = Array.isArray(rows) ? rows : [];
        state.libraryEmpty = state.allRows.length === 0;
        recomputeList();
      },
    };
  }

  window.SWR_LIBRARY_MANAGER = { render: render };
})();
