// api/_lib/http.js — small response helpers shared by every handler.
// Vercel Functions receive (req, res). We avoid frameworks; this is
// ~30 lines of stable glue.

export const COOKIE_NAME = 'swrc_session';

// 302 redirect — call as `return redirect(res, url)`.
export function redirect(res, url, status = 302) {
  res.writeHead(status, { Location: String(url) });
  res.end();
}

export function setSessionCookie(res, token, maxAgeSec = 30 * 24 * 60 * 60) {
  const flags = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'SameSite=Lax',
    'Secure', // Always set - app only runs on HTTPS
  ];
  res.setHeader('Set-Cookie', flags.join('; '));
}

export function clearSessionCookie(res) {
  // Mirrors setSessionCookie(): same flags including Secure, so the deletion
  // matches the cookie being deleted. The plan P2.2 fix - app is HTTPS only.
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`
  );
}

export function readSessionCookie(req) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return null;
  const parts = raw.split(/;\s*/);
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k === COOKIE_NAME && v) return v;
  }
  return null;
}

export function send(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  if (status === 204) {
    res.end();
    return;
  }
  const isJson = typeof body === 'object';
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
  }
  res.end(isJson ? JSON.stringify(body) : String(body));
}

export function sendJson(res, status, obj) {
  send(res, status, obj);
}

export async function readJsonBody(req, { maxBytes = 1_000_000 } = {}) {
  // Vercel Node 20 functions expose req as IncomingMessage. Body may
  // be a Buffer (raw), a string (already parsed), or pre-parsed on req.body.
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return null; }
    }
    return req.body;
  }
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        req.destroy();
        resolve({ __error: 'payload_too_large', __size: total });
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (!buf.length) return resolve({});
      try {
        resolve(JSON.parse(buf.toString('utf8')));
      } catch {
        resolve({ __error: 'invalid_json' });
      }
    });
    req.on('error', () => resolve({ __error: 'body_error' }));
  });
}

// Raw request body as a Buffer, for handlers that need the EXACT bytes
// (e.g. Stripe webhook signature verification — re-stringifying a parsed
// body would break the HMAC). In the Vite dev middleware (dev-api.mjs) the
// body is pre-buffered as a utf8 string on req.body; on Vercel it may be a
// Buffer, a string, or unparsed on the stream — all three are handled.
// An object on req.body (a framework that already JSON-parsed) cannot be
// trusted for signatures, so we fall through to the stream in that case.
export function readRawBody(req, { maxBytes = 2_000_000 } = {}) {
  const b = req.body;
  if (b !== undefined && (Buffer.isBuffer(b) || typeof b === 'string')) {
    return Promise.resolve(Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8'));
  }
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        req.destroy();
        resolve(Buffer.alloc(0));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

export function setCors(res, origin) {
  // Strict CORS with an explicit allowlist (3 entries):
  //   1. process.env.SWRC_APP_ORIGIN  — the production app origin, set
  //      in Vercel env. Defaults to the canonical Vercel URL.
  //   2. http://localhost:5174         — Vite dev server.
  //   3. http://localhost:4173         — Vite preview server.
  // No "echo back" — an unknown Origin gets NO Access-Control-Allow-
  // Origin header, so the browser refuses the response. The previous
  // "echo any http(s) origin" comment was wrong: the actual code has
  // always had the allowlist below (it was added in the M1 backend
  // hardening pass on 2026-09-29). The mistake is that the comment
  // described the OLD behaviour and was never updated.
  //
  // Trade-off: this rejects Vercel preview URLs. Vercel preview
  // domains (*.vercel.app) are NOT in the allowlist, so a preview
  // build can serve the app but cross-origin requests from a preview
  // URL back to the production API are blocked. That is deliberate:
  // previews are meant to be a static snapshot of the SPA, and the
  // production API should never trust preview origins. Add a preview
  // domain to the allowlist only if you can constrain the wildcard
  // to a known prefix (e.g. 'https://swr-<sha>-kai.vercel.app') — do
  // NOT wildcard the entire *.vercel.app namespace.
  const ALLOWED_ORIGINS = [
    process.env.SWRC_APP_ORIGIN || 'https://sainted-word-records.vercel.app',
    'http://localhost:5174',
    'http://localhost:4173',
  ];
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  send(res, 405, { error: 'method_not_allowed', allowed });
}

// Resolve the public origin of a request (x-forwarded-* first, then host,
// then SWRC_APP_ORIGIN / localhost) — shared by the checkout handlers.
export function appOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').toString();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) return `${proto}://${host}`;
  return process.env.SWRC_APP_ORIGIN || `http://localhost:5174`;
}
