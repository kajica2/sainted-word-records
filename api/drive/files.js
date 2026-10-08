// api/drive/files.js — list files in the authenticated user's Google Drive.
//
// GET /api/drive/files
//   ?folderId=...        — list contents of a specific Drive folder (root = null)
//   ?q=...               — raw Google Drive search query (e.g. "name contains 'song'")
//   ?pageSize=50         — max results (default 50, max 200)
//   ?pageToken=...       — pagination cursor from nextPageToken
//
// Response: { files: [{ id, name, mimeType, size, thumbnailLink, modifiedTime, shared }], nextPageToken }
//
// Authorised: any logged-in user with a linked Google Drive account.
// Returns 409 if the Drive account is not connected.

import { sendJson, setCors } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { getUser } from '../_lib/db.js';

async function getValidAccessToken(user) {
  const gdrive = user.googleDrive;
  if (!gdrive || !gdrive.accessToken) return null;

  // Refresh if expired (with 60s buffer).
  if (gdrive.tokenExpiry && Date.now() > gdrive.tokenExpiry - 60_000) {
    if (!gdrive.refreshToken) return null;
    try {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: gdrive.refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      const tokens = await resp.json();
      if (!resp.ok) throw new Error('refresh failed');
      const { access_token, expires_in } = tokens;
      const { updateUser } = await import('../_lib/db.js');
      await updateUser(user.id, {
        googleDrive: { ...gdrive, accessToken: access_token, tokenExpiry: Date.now() + expires_in * 1000 },
      });
      return access_token;
    } catch (e) {
      console.warn('[drive] token refresh failed:', e && e.message);
      return null;
    }
  }

  return gdrive.accessToken;
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const user = await requireUser(req).catch(() => null);
  if (!user) return sendJson(res, 401, { error: 'not_authenticated' });

  if (!user.googleDrive || !user.googleDrive.accessToken) {
    return sendJson(res, 409, { error: 'google_drive_not_linked' });
  }

  const accessToken = await getValidAccessToken(user);
  if (!accessToken) {
    return sendJson(res, 401, { error: 'google_token_invalid' });
  }

  // Parse query params manually (same pattern as manifest.js).
  const rawUrl = req.url || '';
  const qsIdx = rawUrl.indexOf('?');
  const qp = qsIdx >= 0 ? new URLSearchParams(rawUrl.slice(qsIdx + 1)) : new URLSearchParams();
  const folderId = qp.get('folderId') || null;
  const q = qp.get('q') || null;
  const pageSize = Math.min(200, parseInt(qp.get('pageSize') || '50', 10));
  const pageToken = qp.get('pageToken') || undefined;

  // Build the Drive API query.
  // Filter to files the user owns or that are accessible; exclude trashed.
  const queries = ["trashed=false"];
  if (folderId) {
    queries.push(`'${folderId}' in parents`);
  } else if (!q) {
    // Default: show root-level files and folders
    queries.push("'root' in parents");
  }
  if (q) queries.push(q);

  const params = new URLSearchParams({
    q: queries.join(' and '),
    pageSize: String(pageSize),
    fields: 'nextPageToken,files(id,name,mimeType,size,thumbnailLink,modifiedTime,shared,parents)',
    orderBy: 'folder,modifiedTime desc',
  });
  if (pageToken) params.set('pageToken', pageToken);

  try {
    const resp = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('[drive/files] API error:', data);
      return sendJson(res, 502, { error: 'google_api_error' });
    }

    const files = (data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ? parseInt(f.size, 10) : null,
      thumbnailLink: f.thumbnailLink || null,
      modifiedTime: f.modifiedTime || null,
      shared: f.shared || false,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      parents: f.parents || [],
    }));

    return sendJson(res, 200, {
      files,
      nextPageToken: data.nextPageToken || null,
    });
  } catch (e) {
    return sendJson(res, 502, { error: 'network_error' });
  }
}
