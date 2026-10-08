// api/auth/google.js — Google OAuth2 for Drive access.
//
// GET  /api/auth/google          → initiate OAuth (redirect to Google)
// POST /api/auth/google/callback  → exchange auth code for tokens, save to user
//
// Env required (set in .env):
//   GOOGLE_CLIENT_ID      — OAuth 2.0 client ID from Google Cloud Console
//   GOOGLE_CLIENT_SECRET  — OAuth 2.0 client secret
//   GOOGLE_REDIRECT_URI   — must match one registered in Google Cloud Console
//                           e.g. https://yourdomain.com/api/auth/google/callback
//
// Scopes requested:
//   openid profile email   — identify the user
//   https://www.googleapis.com/auth/drive.readonly — browse + import files
//
// Token storage: user.googleDrive: { accessToken, refreshToken, tokenExpiry, linkedAt }
// Tokens are never exposed to the client — all Drive ops go through server endpoints.

import { readJsonBody, sendJson, redirect, setCors } from '../_lib/http.js';
import { getCurrentUser, requireUser } from '../_lib/session.js';
import { updateUser, getUser } from '../_lib/db.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';
const SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

function googleAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',        // get refresh token
    prompt: 'consent',              // always show consent (offline access)
    state: state || '',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// GET /api/auth/google — redirect to Google consent screen.
// ?redirect=... param preserved so callback can redirect back after linking.
export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'GET') {
    // No session required to start OAuth — callback links to existing account.
    // Preserve a return-to path in the state param.
    const rawUrl = (req.url || '').replace(/^\?/, '');
    const qsIdx = rawUrl.indexOf('?');
    const params = qsIdx >= 0 ? new URLSearchParams(rawUrl.slice(qsIdx + 1)) : new URLSearchParams();
    const redirectTo = params.get('redirect') || '/';
    const state = JSON.stringify({ redirect: redirectTo });
    const authUrl = googleAuthUrl(state);
    if (!CLIENT_ID) {
      return sendJson(res, 503, { error: 'google_oauth_not_configured' });
    }
    return redirect(res, authUrl);
  }

  // POST /api/auth/google/callback — called by the popup callback page.
  // Body: { code, state }
  if (req.method === 'POST') {
    const { user } = await getCurrentUser(req);
    if (!user) return sendJson(res, 401, { error: 'not_authenticated' });

    const body = await readJsonBody(req);
    const code = body && String(body.code || '').trim();
    if (!code) return sendJson(res, 400, { error: 'missing_code' });

    let state = {};
    try { state = JSON.parse(body.state || '{}'); } catch (_) {}

    if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
      return sendJson(res, 503, { error: 'google_oauth_not_configured' });
    }

    // Exchange auth code for tokens.
    let tokens;
    try {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });
      tokens = await resp.json();
      if (!resp.ok) {
        console.error('[google] token exchange failed:', tokens);
        return sendJson(res, 502, { error: 'google_token_exchange_failed' });
      }
    } catch (e) {
      return sendJson(res, 502, { error: 'google_network_error' });
    }

    const { access_token, refresh_token, expires_in } = tokens;

    // Save tokens to user record.
    const googleDrive = {
      accessToken: access_token,
      refreshToken: refresh_token || undefined,
      tokenExpiry: expires_in ? Date.now() + expires_in * 1000 : null,
      linkedAt: new Date().toISOString(),
    };

    await updateUser(user.id, { googleDrive });

    return sendJson(res, 200, {
      ok: true,
      linkedAt: googleDrive.linkedAt,
      redirect: state.redirect || '/',
    });
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}
