// lib/google-drive.client.js — SWR_GDRIVE module.
//
// Provides:
//   SWR_GDRIVE.authUrl(redirect?)  — URL to redirect browser for OAuth
//   SWR_GDRIVE.link()             — open OAuth popup, exchange code, save tokens
//   SWR_GDRIVE.unlink()           — remove Drive link from user account
//   SWR_GDRIVE.listFiles(opts)   — list Drive files { folderId, q, pageSize, pageToken }
//   SWR_GDRIVE.importFile(file)   — import a Drive file to SWR storage
//   SWR_GDRIVE.isLinked()         — check if Drive is linked (GET /api/auth/session includes it)
//
// Usage:
//   const url = SWR_GDRIVE.authUrl('/some-return-path');
//   window.open(url, '_blank', 'width=600,height=700');
//   // or use link() which opens the popup for you.
//
// Popup callback: /auth/google-callback.html handles the OAuth redirect in a
// popup window and signals the opener via postMessage.

(function () {
  'use strict';

  const GDRIVE_BASE = '/api/drive';
  const AUTH_BASE = '/api/auth/google';

  // Build the Google OAuth URL. Optionally pass a return path.
  function authUrl(redirect) {
    const params = new URLSearchParams();
    if (redirect) params.set('redirect', redirect);
    return `${AUTH_BASE}?${params}`;
  }

  // Open OAuth popup, exchange code, save tokens, return Promise<{ linkedAt, redirect }>
  function link(redirect) {
    return new Promise((resolve, reject) => {
      const url = authUrl(redirect);
      const name = 'google_oauth';
      const w = window.open(url, name, 'width=600,height=700,left=100,top=100');

      if (!w) {
        reject(new Error('popup_blocked'));
        return;
      }

      // Listen for the postMessage from the callback page.
      function onMessage(event) {
        if (!event.data || event.data.type !== 'swr-google-oauth-callback') return;
        window.removeEventListener('message', onMessage);
        clearTimeout(timeout);
        w.close();
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve({ linkedAt: event.data.linkedAt, redirect: event.data.redirect });
        }
      }

      const timeout = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        try { w.close(); } catch (_) {}
        reject(new Error('oauth_timeout'));
      }, 120_000);

      window.addEventListener('message', onMessage);
    });
  }

  // Remove Drive link from the user's account.
  async function unlink() {
    const res = await fetch('/api/drive/unlink', { method: 'POST' });
    if (!res.ok) throw new Error('unlink_failed');
    return res.json();
  }

  // List Drive files.
  async function listFiles(opts) {
    const params = new URLSearchParams();
    if (opts && opts.folderId) params.set('folderId', opts.folderId);
    if (opts && opts.q) params.set('q', opts.q);
    if (opts && opts.pageSize) params.set('pageSize', String(opts.pageSize));
    if (opts && opts.pageToken) params.set('pageToken', opts.pageToken);

    const res = await fetch(`${GDRIVE_BASE}/files?${params}`);
    if (res.status === 409) throw new Error('not_linked');
    if (!res.ok) throw new Error('list_failed');
    return res.json(); // { files, nextPageToken }
  }

  // Import a Drive file into SWR storage.
  // file: { id, name, mimeType }
  async function importFile(file) {
    const res = await fetch(`${GDRIVE_BASE}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || data.message || 'import_failed');
    }
    return data; // { ok, storageKey, size, mimeType }
  }

  window.SWR_GDRIVE = {
    authUrl,
    link,
    unlink,
    listFiles,
    importFile,
  };

})();
