// api/_lib/http.js — small response helpers shared by every handler.
// Vercel Functions receive (req, res). We avoid frameworks; this is
// ~30 lines of stable glue.

export const COOKIE_NAME = 'swrc_session';

export function setSessionCookie(res, token, maxAgeSec = 30 * 24 * 60 * 60) {
  const flags = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production') flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
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
  // Tight CORS: same-origin by default (return no ACAO header so the
  // browser refuses any cross-origin attempt). When an explicit Origin
  // is present AND it looks like an http(s) URL, echo it back — this
  // enables separate preview domains (e.g. a Vercel preview URL).
  // The literal string "same-origin" is NOT a valid origin and would
  // cause browsers to refuse the response.
  if (origin && /^https?:\/\//i.test(origin)) {
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
