// api/auth/google.js — start + exchange for Google OAuth.
//
// GET  /api/auth/google   → start the flow (302 to Google's consent screen)
//     ?intent=signin (default) — sign in with a Google account
//     ?intent=drive         — link Google Drive to the current user
//     ?redirect=<same-origin path> — where to land afterwards
//
// POST /api/auth/google   → exchange an authorization code for tokens and
//     act on it: sign the visitor in when they have no session yet, or store
//     the Drive tokens when they do. Called by the popup callback page
//     (auth/google-callback.html) and by api/auth/google/callback.js.
//
// Env required (set in .env):
//   GOOGLE_CLIENT_ID      — OAuth 2.0 client ID from Google Cloud Console
//   GOOGLE_CLIENT_SECRET  — OAuth 2.0 client secret
//   GOOGLE_REDIRECT_URI   — the URI registered in the Google Cloud Console,
//                           e.g. https://yourdomain.com/api/auth/google/callback
//                           Falls back to <this host>/api/auth/google/callback.
//
// Scopes:
//   signin → openid profile email          (identity only)
//   drive  → the above + drive.readonly    (browsing/importing files)
//
// Token storage: user.googleDrive: { accessToken, refreshToken, tokenExpiry,
// linkedAt } — never exposed to the client.

import { readJsonBody, sendJson, redirect, setCors, setSessionCookie } from '../_lib/http.js';
import { getCurrentUser } from '../_lib/session.js';
import { createSession, linkAccount, updateUser } from '../_lib/db.js';
import {
  SCOPES_DRIVE,
  SCOPES_SIGNIN,
  buildAuthUrl,
  exchangeCode,
  fetchGoogleProfile,
  googleConfig,
  publicUser,
  resolveGoogleUser,
  sanitizeRedirect,
  signState,
  stateSecret,
  verifyState,
} from '../_lib/google.js';

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const cfg = googleConfig(req);

  // ── Start ────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (!cfg.configured) {
      // A browser followed this link from the login page — send it back
      // there with a readable reason instead of a bare JSON error.
      return redirect(res, '/auth/login?error=google_oauth_not_configured');
    }
    const rawUrl = (req.url || '').replace(/^\?/, '');
    const qsIdx = rawUrl.indexOf('?');
    const params = qsIdx >= 0 ? new URLSearchParams(rawUrl.slice(qsIdx + 1)) : new URLSearchParams();
    const intent = params.get('intent') === 'drive' ? 'drive' : 'signin';
    const redirectTo = sanitizeRedirect(params.get('redirect') || '/');
    const state = signState(
      {
        redirect: redirectTo,
        redirectUri: cfg.redirectUri,
        mode: intent === 'drive' ? 'popup' : 'redirect',
        intent,
        ts: Date.now(),
      },
      stateSecret(),
    );
    const authUrl = buildAuthUrl({
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      state,
      scopes: intent === 'drive' ? SCOPES_DRIVE : SCOPES_SIGNIN,
      offline: intent === 'drive',
    });
    return redirect(res, authUrl);
  }

  // ── Exchange ─────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const code = body && String(body.code || '').trim();
    if (!code) return sendJson(res, 400, { error: 'missing_code' });
    if (!cfg.configured) {
      return sendJson(res, 503, { error: 'google_oauth_not_configured' });
    }

    // The state is signed: it carries the return path and the exact
    // redirect_uri the authorization request used, and it cannot be forged.
    const payload = verifyState(body && body.state, stateSecret());
    if (!payload) return sendJson(res, 400, { error: 'invalid_state' });

    let tokens;
    try {
      tokens = await exchangeCode({
        code,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        redirectUri: payload.redirectUri || cfg.redirectUri,
      });
    } catch (e) {
      console.error('[google] token exchange failed:', e && e.detail);
      return sendJson(res, 502, { error: 'google_token_exchange_failed' });
    }

    let profile;
    try {
      profile = await fetchGoogleProfile(tokens.access_token);
    } catch (e) {
      console.error('[google] userinfo failed:', e && e.detail);
      return sendJson(res, 502, { error: 'google_userinfo_failed' });
    }

    const { user: sessionUser } = await getCurrentUser(req);
    let user = sessionUser;
    let signedIn = false;

    if (user) {
      // Already signed in — this is the Drive-link path.
      await linkAccount({ userId: user.id, provider: 'google', providerAccountId: profile.sub });
    } else {
      // No session: this is a sign-in. Resolve the Google identity to a SWR
      // user and start a session for them.
      try {
        user = await resolveGoogleUser(profile);
      } catch (e) {
        return sendJson(res, e && e.status ? e.status : 400, { error: e && e.message ? e.message : 'google_sign_in_failed' });
      }
      const session = await createSession({ userId: user.id });
      setSessionCookie(res, session.token);
      signedIn = true;
    }

    // Drive tokens are only stored when the Drive scope was actually
    // granted — a sign-in token carries no Drive access and would 403.
    let linkedAt = null;
    if (payload.intent === 'drive') {
      const googleDrive = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiry: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
        linkedAt: new Date().toISOString(),
      };
      await updateUser(user.id, { googleDrive });
      linkedAt = googleDrive.linkedAt;
    }

    return sendJson(res, 200, {
      ok: true,
      signedIn,
      linkedAt,
      user: publicUser(user),
      redirect: sanitizeRedirect(payload.redirect || '/'),
    });
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}
