// api/_lib/google.js — Google OAuth2 core, shared by the sign-in flow and
// the Drive-link flow.
//
// Two flows, one client:
//
//   signin — the visitor has no session. Google returns an authorization
//            code, we resolve the account, create a session and set the
//            session cookie. This is what "Continue with Google" on
//            /auth/login uses.
//   drive  — the visitor already has a session. Google returns a code, we
//            store the Drive tokens on that user (the popup flow).
//
// The signed `state` carries everything the callback needs: the return path,
// the exact redirect_uri the authorization request used (it MUST match byte
// for byte at the token exchange) and the flow mode. It is HMAC-signed with
// the client secret, so a tampered or replayed state is rejected.

import crypto from 'node:crypto';
import { appOrigin } from './http.js';
import { createUser, findUserByEmail, findUserByProvider, linkAccount, updateUser } from './db.js';

// Minimal scope for signing in. The Drive scope is only requested by the
// Drive-link flow — asking a plain sign-in for read access to the user's
// Drive is both wrong and a much scarier consent screen.
export const SCOPES_SIGNIN = 'openid email profile';
export const SCOPES_DRIVE = `${SCOPES_SIGNIN} https://www.googleapis.com/auth/drive.readonly`;

const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

// Resolve the OAuth configuration for this request.
//
// GOOGLE_REDIRECT_URI wins when set — that is the URI registered in the
// Google Cloud Console, and the token exchange compares it byte for byte.
// Without it we fall back to the API callback route on this very host, which
// is what local dev and preview deployments use.
export function googleConfig(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = (process.env.GOOGLE_REDIRECT_URI || '').trim() || defaultRedirectUri(req);
  return {
    clientId,
    clientSecret,
    redirectUri,
    configured: Boolean(clientId && clientSecret && redirectUri),
  };
}

export function defaultRedirectUri(req) {
  const origin = appOrigin(req);
  return origin ? `${origin}/api/auth/google/callback` : '';
}

// The secret used to sign `state`. The client secret is already a required,
// stable, secret value for this flow, so it doubles as the HMAC key rather
// than inventing another environment variable to keep in sync.
export function stateSecret() {
  return process.env.GOOGLE_CLIENT_SECRET || '';
}

// Only same-origin paths survive. A return path is attacker-controlled (it
// arrives in a query string), so anything that could leave the site — a
// scheme, a protocol-relative "//host", a backslash — falls back to "/".
export function sanitizeRedirect(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(raw)) return '/';
  return raw;
}

export function signState(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

// Verify and decode a state. Returns null for anything that is not a state we
// signed recently: wrong signature, malformed body, or older than the TTL.
export function verifyState(state, secret, { maxAgeMs = STATE_TTL_MS, now = Date.now() } = {}) {
  if (!state || !secret) return null;
  const parts = String(state).split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.ts !== 'number' || now - payload.ts > maxAgeMs) return null;
  return payload;
}

export function buildAuthUrl({ clientId, redirectUri, state, scopes, offline = false, prompt = 'select_account' }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    state: state || '',
  });
  if (offline) {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  } else {
    params.set('access_type', 'online');
    params.set('prompt', prompt);
  }
  return `${AUTH_URL}?${params}`;
}

// Exchange an authorization code for tokens. `redirectUri` must be the exact
// URI the authorization request used — Google compares it byte for byte.
export async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error('google_token_exchange_failed');
    err.status = 502;
    err.detail = body;
    throw err;
  }
  return body;
}

// The signed-in identity. Fetched from Google's userinfo endpoint with the
// access token rather than decoded out of the id_token, so the email we act
// on is the one Google itself vouches for.
export async function fetchGoogleProfile(accessToken) {
  const resp = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error('google_userinfo_failed');
    err.status = 502;
    err.detail = body;
    throw err;
  }
  return {
    sub: String(body.sub || ''),
    email: String(body.email || '').toLowerCase(),
    name: body.name || null,
    picture: body.picture || null,
    emailVerified: body.email_verified !== false,
  };
}

// Map a Google profile onto a SWR user.
//
// Order: the linked account first (so a Google identity is stable even if the
// email changes), then the email (so a magic-link user and a Google user are
// the same person), then a new account.
export async function resolveGoogleUser(profile) {
  if (!profile || !profile.sub) {
    const err = new Error('google_profile_incomplete');
    err.status = 400;
    throw err;
  }
  if (!profile.email) {
    const err = new Error('google_no_email');
    err.status = 400;
    throw err;
  }

  let user = await findUserByProvider('google', profile.sub);
  if (!user) user = await findUserByEmail(profile.email);
  if (!user) {
    user = await createUser({
      email: profile.email,
      name: profile.name,
      image: profile.picture,
      provider: 'google',
    });
  } else if (profile.picture && !user.image) {
    user = await updateUser(user.id, { image: profile.picture });
  }

  await linkAccount({ userId: user.id, provider: 'google', providerAccountId: profile.sub });
  return user;
}

// The public shape of a user, shared by the sign-in endpoints.
export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    provider: user.provider,
    membershipTier: user.membershipTier || 'free',
    joinedAt: user.joinedAt || user.createdAt || null,
  };
}
