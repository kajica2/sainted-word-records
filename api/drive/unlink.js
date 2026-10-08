// api/drive/unlink.js — remove Google Drive link from the authenticated user's account.
//
// POST /api/drive/unlink
// Response: { ok: true }
//
// Does NOT revoke the Google OAuth token (Google revokes happen via the
// Google account security settings). It simply clears googleDrive from the
// user record so the Drive tabs disappear from SWR.

import { sendJson, setCors } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { updateUser } from '../_lib/db.js';

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

  // Clear googleDrive — set to null (the DB layer supports field deletion
  // by setting a field to null, which removes the key via JSON spread).
  await updateUser(user.id, { googleDrive: null });

  return sendJson(res, 200, { ok: true });
}
