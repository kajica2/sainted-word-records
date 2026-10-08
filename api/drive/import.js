// api/drive/import.js — import a file from Google Drive into SWR storage.
//
// POST /api/drive/import
//   Body: { fileId: string, fileName: string, mimeType: string }
// Response: { ok: true, storageKey: string, size: number }
//
// The file is downloaded from Google Drive (or exported for Google Docs) and
// written to Vercel Blob at storage/<userId>/drive/<fileId>.
// The storageKey returned is the Vercel Blob public URL or the internal path.
//
// Authorised: any logged-in user with a linked Google Drive account.

import { sendJson, setCors } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { getUser, storagePut } from '../_lib/db.js';

// Supported audio/video/image MIME types for import.
const ALLOWED_MIME_PREFIXES = [
  'audio/',
  'video/',
  'image/',
  'application/vnd.google-apps.audio',  // Google Keep audio
  'application/vnd.google-apps.video',  // Google Docs video
];

// Google Docs that can be exported to a useful format.
const EXPORTABLE_GOOGLE_DOCS = {
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
};

function isAllowedMime(mimeType) {
  if (!mimeType) return false;
  return (
    ALLOWED_MIME_PREFIXES.some((p) => mimeType.startsWith(p)) ||
    mimeType in EXPORTABLE_GOOGLE_DOCS
  );
}

async function getValidAccessToken(user) {
  const gdrive = user.googleDrive;
  if (!gdrive || !gdrive.accessToken) return null;

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
      console.warn('[drive/import] token refresh failed:', e && e.message);
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

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const user = await requireUser(req).catch(() => null);
  if (!user) return sendJson(res, 401, { error: 'not_authenticated' });

  if (!user.googleDrive || !user.googleDrive.accessToken) {
    return sendJson(res, 409, { error: 'google_drive_not_linked' });
  }

  const body = await (async () => {
    const { readJsonBody } = await import('../_lib/http.js');
    return readJsonBody(req);
  })();

  const fileId = body && String(body.fileId || '').trim();
  const fileName = body && String(body.fileName || '').trim();
  const mimeType = body && String(body.mimeType || '').trim();

  if (!fileId || !fileName) return sendJson(res, 400, { error: 'missing_params' });
  if (!isAllowedMime(mimeType)) {
    return sendJson(res, 415, { error: 'unsupported_media_type', message: 'Only audio, video, and image files can be imported.' });
  }

  const accessToken = await getValidAccessToken(user);
  if (!accessToken) return sendJson(res, 401, { error: 'google_token_invalid' });

  // Determine download URL and (for Google Docs) export MIME.
  let downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const isExportable = EXPORTABLE_GOOGLE_DOCS[mimeType];
  if (isExportable) {
    const exportMime = isExportable;
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
  }

  let fileData;
  let finalMime = mimeType;
  try {
    const resp = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      console.error('[drive/import] download failed:', resp.status, err);
      return sendJson(res, 502, { error: 'google_download_failed' });
    }
    fileData = await resp.arrayBuffer();
    if (isExportable) finalMime = isExportable;
  } catch (e) {
    return sendJson(res, 502, { error: 'network_error' });
  }

  // Write to Vercel Blob: storage/<userId>/drive/<fileId>__<sanitizedName>
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  const storageKey = `drive/${fileId}__${safeName}`;

  try {
    const result = await storagePut(user.id, storageKey, Buffer.from(fileData), finalMime);
    return sendJson(res, 200, {
      ok: true,
      storageKey: result.url || result.key || storageKey,
      size: fileData.byteLength,
      mimeType: finalMime,
    });
  } catch (e) {
    console.error('[drive/import] storagePut failed:', e && e.message);
    return sendJson(res, 502, { error: 'storage_error' });
  }
}
