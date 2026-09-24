// api/_lib/google-oauth.js — Google OAuth 2.0 (authorization-code + PKCE)
// for the YouTube upload integration.
//
// Scopes are deliberately narrow: youtube.upload allows inserting videos
// into the user's channel and nothing else. We do NOT request youtube.readonly
// or youtube.force-ssl — a video uploader does not need to read the user's
// watch history or private data, and Google's consent screen is more likely
// to be approved with a minimal ask.
//
// offline + prompt=consent: a refresh token is issued ONLY on the first
// consent for a client, so without prompt=consent a user who has connected
// before gets an access token and no refresh token — the integration would
// silently stop working an hour later. Asking every time costs one extra
// click and removes that entire failure mode.
//
// Credentials (all required for the feature to work):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REDIRECT_URI   e.g. https://host/api/auth/youtube/callback

import { createHash, randomBytes } from 'node:crypto';

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
];

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CHANNELS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels';

export const STATE_COOKIE = 'swrc_yt_oauth';

export function googleOAuthConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

export function missingOAuthEnv() {
  const missing = [];
  if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!process.env.GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI');
  return missing;
}

function base64url(buf) {
  return buf.toString('base64url');
}

// PKCE: the verifier never leaves the cookie; only its SHA-256 digest goes
// to Google. An intercepted authorization code is therefore useless without
// the verifier, which closes the interception window for this flow.
export function createPkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function createState() {
  return base64url(randomBytes(16));
}

export function buildConsentUrl({ state, codeChallenge }) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = (json && (json.error_description || json.error)) || `http_${res.status}`;
    const err = new Error(`google_token_failed: ${detail}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export async function exchangeCode({ code, codeVerifier }) {
  return tokenRequest({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
  });
}

export async function refreshAccessToken(refreshToken) {
  return tokenRequest({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
}

// Best-effort: the channel name is for display only, so a failure here must
// not abort the connection — we just lose the friendly label.
export async function fetchChannel(accessToken) {
  try {
    const res = await fetch(`${CHANNELS_ENDPOINT}?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const ch = json.items && json.items[0];
    if (!ch) return null;
    return { id: ch.id, title: (ch.snippet && ch.snippet.title) || null };
  } catch (_) {
    return null;
  }
}

// ---- state cookie ----------------------------------------------------
// Carries PKCE verifier + CSRF state. HttpOnly (script cannot read the
// verifier), SameSite=Lax (survives Google's top-level redirect back but
// blocks cross-site POST), short TTL, and cleared as soon as it is used.

export function setStateCookie(res, { state, verifier }, maxAgeSec = 600) {
  const value = Buffer.from(JSON.stringify({ state, verifier }), 'utf8').toString('base64url');
  const flags = [
    `${STATE_COOKIE}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production') flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

export function clearStateCookie(res) {
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

export function readStateCookie(req) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(/;\s*/)) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx) !== STATE_COOKIE) continue;
    try {
      const json = Buffer.from(part.slice(idx + 1), 'base64url').toString('utf8');
      const parsed = JSON.parse(json);
      return parsed && parsed.state && parsed.verifier ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}
