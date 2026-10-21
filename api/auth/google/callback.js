// api/auth/google/callback.js — the OAuth redirect_uri.
//
// Google sends the browser here with ?code=…&state=…. The state is the one
// api/auth/google.js signed when it started the flow, so it carries the
// return path, the flow mode and the exact redirect_uri that was used.
//
// Two outcomes:
//
//   mode=redirect (sign-in) — resolve the Google identity to a SWR user,
//     start a session, set the session cookie and send the visitor back to
//     where they came from. This is what "Continue with Google" does.
//
//   mode=popup (Drive link) — do the same, then hand control back to the
//     opener window with a postMessage and close, because the Drive picker
//     is opened in a popup.
//
// Register this exact URI in the Google Cloud Console:
//   https://<your-domain>/api/auth/google/callback
// It is also the default when GOOGLE_REDIRECT_URI is not set.

import { redirect, sendJson, setCors, setSessionCookie } from '../../_lib/http.js';
import { getCurrentUser } from '../../_lib/session.js';
import { createSession, linkAccount, updateUser } from '../../_lib/db.js';
import {
  exchangeCode,
  fetchGoogleProfile,
  googleConfig,
  resolveGoogleUser,
  sanitizeRedirect,
  stateSecret,
  verifyState,
} from '../../_lib/google.js';

function fail(res, reason) {
  const url = `/auth/login?error=${encodeURIComponent(reason)}`;
  return redirect(res, url);
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const cfg = googleConfig(req);
  if (!cfg.configured) {
    return fail(res, 'google_oauth_not_configured');
  }

  const rawUrl = (req.url || '').replace(/^\?/, '');
  const qsIdx = rawUrl.indexOf('?');
  const params = qsIdx >= 0 ? new URLSearchParams(rawUrl.slice(qsIdx + 1)) : new URLSearchParams();

  if (params.get('error')) {
    return fail(res, params.get('error') || 'google_denied');
  }

  const code = (params.get('code') || '').trim();
  if (!code) return fail(res, 'missing_code');

  const payload = verifyState(params.get('state'), stateSecret());
  if (!payload) return fail(res, 'invalid_state');

  let tokens;
  try {
    tokens = await exchangeCode({
      code,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUri: payload.redirectUri || cfg.redirectUri,
    });
  } catch (e) {
    console.error('[google] callback token exchange failed:', e && e.detail);
    return fail(res, 'google_token_exchange_failed');
  }

  let profile;
  try {
    profile = await fetchGoogleProfile(tokens.access_token);
  } catch (e) {
    console.error('[google] callback userinfo failed:', e && e.detail);
    return fail(res, 'google_userinfo_failed');
  }

  const { user: sessionUser } = await getCurrentUser(req);
  let user = sessionUser;
  let signedIn = false;

  if (user) {
    await linkAccount({ userId: user.id, provider: 'google', providerAccountId: profile.sub });
  } else {
    try {
      user = await resolveGoogleUser(profile);
    } catch (e) {
      return fail(res, e && e.message ? e.message : 'google_sign_in_failed');
    }
    const session = await createSession({ userId: user.id });
    setSessionCookie(res, session.token);
    signedIn = true;
  }

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

  const to = sanitizeRedirect(payload.redirect || '/');

  if (payload.mode === 'popup') {
    // Hand control back to the opener that opened the Drive picker.
    const message = JSON.stringify({
      type: 'swr-google-oauth-callback',
      linkedAt,
      signedIn,
      redirect: to,
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(`<!doctype html><meta charset="utf-8"><title>Google</title>
<script>
  try { window.opener.postMessage(${message}, '*'); } catch (e) {}
  window.close();
</script>
<p>Done — you can close this window.</p>`);
    return undefined;
  }

  // Sign-in: back to the app, with a marker so the page can greet the user.
  const separator = to.includes('?') ? '&' : '?';
  return redirect(res, `${to}${separator}auth=google`);
}
