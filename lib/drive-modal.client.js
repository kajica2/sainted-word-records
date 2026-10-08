// lib/drive-modal.client.js — SWR_DRIVE_MODAL
//
// Drive browser modal: shows folders / files from Google Drive, supports
// navigation into sub-folders, search, and file import.
//
// Usage:
//   SWR_DRIVE_MODAL.show(opts?)  — open modal. opts: { folderId, title }
//   SWR_DRIVE_MODAL.hide()       — close and clean up
//   SWR_DRIVE_MODAL.onImport(cb) — cb({ file, result }) when import succeeds
//   SWR_DRIVE_MODAL.onClose(cb)  — cb when modal is closed
//
// The modal is self-contained and mounts its own DOM. It requires SWR_GDRIVE
// (lib/google-drive.client.js) to be loaded first.
//
// Events dispatched on document:
//   swr-drive-imported  — detail: { file, result }
//   swr-drive-closed

(function () {
  'use strict';

  const MODAL_ID = 'swr-drive-modal';
  const MAX_NAME_LEN = 42;

  let _onImport = null;
  let _onClose = null;
  let _currentFolderId = null;
  let _breadcrumbs = []; // [{ id: null, name: 'My Drive' }, { id: ..., name: ... }]
  let _importing = false;

  // ─── helpers ──────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  function safeName(name) {
    return name.length > MAX_NAME_LEN ? name.slice(0, MAX_NAME_LEN - 1) + '…' : name;
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function mimeIcon(mimeType, isFolder) {
    if (isFolder) return `<svg width="20" height="20" viewBox="0 0 24 24" fill="#facc15" aria-hidden="true"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
    if (mimeType && mimeType.startsWith('audio/')) return `<svg width="20" height="20" viewBox="0 0 24 24" fill="#a78bfa" aria-hidden="true"><path d="M12 3v9.28a4.39 4.39 0 000 8.72V21h4v-8.72c2.08 0 3.72-1.55 3.72-3.58 0-2.27-2.1-4.08-4.72-4.28A4.36 4.36 0 0012 3z"/></svg>`;
    if (mimeType && mimeType.startsWith('video/')) return `<svg width="20" height="20" viewBox="0 0 24 24" fill="#34d399" aria-hidden="true"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>`;
    if (mimeType && mimeType.startsWith('image/')) return `<svg width="20" height="20" viewBox="0 0 24 24" fill="#60a5fa" aria-hidden="true"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`;
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="#9ca3af" aria-hidden="true"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>`;
  }

  // ─── render ───────────────────────────────────────────────────────────────

  function renderBreadcrumbs() {
    const el = $('swr-drive-breadcrumbs');
    if (!el) return;
    el.innerHTML = _breadcrumbs.map((crumb, i) => {
      const isLast = i === _breadcrumbs.length - 1;
      return `<button class="swr-drive-crumb${isLast ? ' active' : ''}"
        data-folder-id="${crumb.id ?? ''}" ${isLast ? 'disabled' : ''}>
        ${i === 0 ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>` : ''}
        ${crumb.name}
      </button>${isLast ? '' : `<span aria-hidden="true">›</span>`}`;
    }).join('');
  }

  function renderFiles(files, nextPageToken) {
    const el = $('swr-drive-file-list');
    if (!el) return;
    if (!files || files.length === 0) {
      el.innerHTML = `<div class="swr-drive-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7v13a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
        <p>No files found</p>
      </div>`;
      return;
    }
    el.innerHTML = files.map((f) => `
      <li class="swr-drive-file${f.isFolder ? ' is-folder' : ''}"
          data-id="${f.id}" data-name="${f.name}" data-mime="${f.mimeType}"
          role="button" tabindex="0" aria-label="${f.isFolder ? 'Open folder' : 'Import'}: ${f.name}">
        <span class="swr-drive-icon">${mimeIcon(f.mimeType, f.isFolder)}</span>
        <span class="swr-drive-name" title="${f.name}">${safeName(f.name)}</span>
        <span class="swr-drive-meta">${f.isFolder ? 'Folder' : formatSize(f.size)}</span>
        <span class="swr-drive-action">${f.isFolder ? 'Open' : 'Import'}</span>
      </li>`).join('');
  }

  function renderLoading(loading) {
    const spinner = $('swr-drive-spinner');
    const list = $('swr-drive-file-list');
    if (spinner) spinner.style.display = loading ? 'flex' : 'none';
    if (list && loading) list.innerHTML = '';
  }

  function renderError(msg) {
    const el = $('swr-drive-file-list');
    if (!el) return;
    el.innerHTML = `<div class="swr-drive-empty swr-drive-error">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <p>${msg}</p>
      <button class="swr-drive-btn-small" data-action="retry">Try again</button>
    </div>`;
  }

  // ─── navigation ───────────────────────────────────────────────────────────

  async function navigate(folderId, folderName) {
    // Update breadcrumbs.
    if (folderId === null) {
      _breadcrumbs = [{ id: null, name: 'My Drive' }];
    } else if (folderName) {
      // Trim breadcrumbs to this level.
      const idx = _breadcrumbs.findIndex((c) => c.id === folderId);
      if (idx !== -1) {
        _breadcrumbs = _breadcrumbs.slice(0, idx + 1);
      } else {
        _breadcrumbs.push({ id: folderId, name: folderName });
      }
    }
    _currentFolderId = folderId;
    renderBreadcrumbs();
    await loadFiles();
  }

  async function loadFiles(folderId, pageToken) {
    renderLoading(true);
    try {
      const data = await SWR_GDRIVE.listFiles({
        folderId: folderId !== undefined ? folderId : _currentFolderId,
        pageSize: 50,
        pageToken: pageToken || undefined,
      });
      renderFiles(data.files || [], data.nextPageToken);
    } catch (e) {
      if (e.message === 'not_linked') {
        renderError(`Google Drive is not connected. <button class="swr-drive-btn-small" data-action="link-drive">Connect Drive</button>`);
      } else {
        renderError('Failed to load files. Check your connection.');
      }
    } finally {
      renderLoading(false);
    }
  }

  async function handleImport(file) {
    if (_importing) return;
    _importing = true;
    const el = document.querySelector(`[data-id="${file.id}"]`);
    if (el) el.classList.add('importing');

    try {
      const result = await SWR_GDRIVE.importFile(file);
      if (_onImport) _onImport({ file, result });
      document.dispatchEvent(new CustomEvent('swr-drive-imported', { detail: { file, result } }));
    } catch (e) {
      alert(`Import failed: ${e.message}`);
    } finally {
      _importing = false;
      if (el) el.classList.remove('importing');
    }
  }

  // ─── modal DOM ─────────────────────────────────────────────────────────────

  function buildModalDOM() {
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.id = MODAL_ID;
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-modal', 'true');
    div.setAttribute('aria-label', 'Google Drive browser');
    div.innerHTML = `
    <div class="swr-drive-overlay" data-action="close"></div>
    <div class="swr-drive-panel">
      <header class="swr-drive-header">
        <h2 class="swr-drive-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#4285f4" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Google Drive
        </h2>
        <button class="swr-drive-close" data-action="close" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </header>
      <div class="swr-drive-toolbar">
        <div class="swr-drive-search-wrap">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" id="swr-drive-search" class="swr-drive-search"
            placeholder="Search file names…" autocomplete="off" />
        </div>
        <button class="swr-drive-btn-small" id="swr-drive-search-btn">Search</button>
      </div>
      <div id="swr-drive-breadcrumbs" class="swr-drive-breadcrumbs"></div>
      <div class="swr-drive-spinner" style="display:none" aria-live="polite">
        <div class="spinner"></div>
      </div>
      <ul id="swr-drive-file-list" class="swr-drive-file-list" role="list" aria-label="Files"></ul>
      <footer class="swr-drive-footer">
        <span class="swr-drive-footer-note">Only audio, video, and image files can be imported.</span>
      </footer>
    </div>`;

    document.body.appendChild(div);

    // ── event delegation ──────────────────────────────────────────────────
    div.addEventListener('click', async (e) => {
      const target = e.target.closest('[data-action]') || e.target.closest('[data-id]');
      if (!target) return;
      const action = target.dataset.action;

      if (action === 'close') { hide(); return; }
      if (action === 'link-drive') {
        try {
          await SWR_GDRIVE.link();
          await loadFiles();
        } catch (_) {}
        return;
      }
      if (action === 'retry') { await loadFiles(); return; }

      // File/folder click.
      const id = target.dataset.id;
      const name = target.dataset.name;
      const mime = target.dataset.mime;
      const isFolder = target.classList.contains('is-folder');

      if (isFolder) {
        await navigate(id, name);
      } else {
        await handleImport({ id, name, mimeType: mime });
      }
    });

    // Breadcrumb navigation.
    div.addEventListener('click', (e) => {
      const crumb = e.target.closest('[data-folder-id]');
      if (!crumb || crumb.disabled) return;
      const folderId = crumb.dataset.folderId === '' ? null : crumb.dataset.folderId;
      navigate(folderId, crumb.textContent.trim());
    });

    // Search.
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'swr-drive-search') {
        const q = e.target.value.trim();
        if (!q) return;
        renderLoading(true);
        SWR_GDRIVE.listFiles({ q, pageSize: 50 })
          .then((data) => renderFiles(data.files || []))
          .catch(() => renderError('Search failed.'))
          .finally(() => renderLoading(false));
      }
    });

    // Close on Escape.
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
    });

    // Keyboard on file items.
    div.addEventListener('keydown', (e) => {
      const item = e.target.closest('[data-id]');
      if (!item) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
      }
    });

    return div;
  }

  // ─── public API ────────────────────────────────────────────────────────────

  function show(opts) {
    _currentFolderId = opts && opts.folderId !== undefined ? opts.folderId : null;
    _breadcrumbs = [{ id: null, name: 'My Drive' }];
    _importing = false;
    buildModalDOM();
    const modal = document.getElementById(MODAL_ID);
    if (modal) {
      modal.style.display = 'flex';
      requestAnimationFrame(() => modal.classList.add('open'));
    }
    renderBreadcrumbs();
    loadFiles();
    const searchInput = $('swr-drive-search');
    if (searchInput) searchInput.focus();
  }

  function hide() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) {
      modal.classList.remove('open');
      setTimeout(() => modal.remove(), 250);
    }
    if (_onClose) _onClose();
    document.dispatchEvent(new CustomEvent('swr-drive-closed'));
  }

  function onImport(cb) { _onImport = cb; }
  function onClose(cb) { _onClose = cb; }

  window.SWR_DRIVE_MODAL = { show, hide, onImport, onClose };

})();
