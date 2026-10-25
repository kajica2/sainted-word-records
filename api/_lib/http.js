// api/_lib/http.js — small response helpers shared by every handler.
// Vercel Functions receive (req, res). We avoid frameworks: this is stable
// glue with no dependencies, and the one place that decides who the client
// is.

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

// A single allowlist entry. Each entry may be:
//   - a string (exact match against `Origin`)
//   - a plain object { pattern: RegExp, httpsOnly: boolean } - for wildcard
//     namespaces (currently `*.vercel.app`). The pattern is tested against
//     `new URL(origin).hostname`, so it cannot match a path, a query string
//     or a redirect target - only the host. `httpsOnly` defaults to true so
//     the `*.vercel.app` regex cannot bind a non-https origin.
function _matches(originEntry, origin) {
  if (typeof originEntry === 'string') return originEntry === origin;
  if (originEntry && typeof originEntry === 'object' && originEntry.pattern instanceof RegExp) {
    try {
      const u = new URL(origin);
      const httpsOnly = originEntry.httpsOnly !== false; // default true
      if (httpsOnly && u.protocol !== 'https:') return false;
      return originEntry.pattern.test(u.hostname);
    } catch (_) {
      return false;
    }
  }
  return false;
}

export function setCors(res, origin) {
  // Strict CORS: an explicit allowlist of EXACT ORIGINS plus regex
  // patterns for wildcard namespaces.
  //   - process.env.SWRC_APP_ORIGIN  - production app origin (Vercel env).
  //   - http://localhost:5174         - Vite dev server.
  //   - http://localhost:4173         - Vite preview server.
  //   - { pattern: /\.vercel\.app$/, httpsOnly: true } - every Vercel
  //     preview deploy (P2.1 fix). A regex namespace lets previews work
  //     without forcing a code edit for every branch URL - and the
  //     `httpsOnly: true` guard + hostname-only match keeps it from
  //     matching the wildcard against a redirect target or a path.
  // No "echo back": an unknown Origin receives NO
  // Access-Control-Allow-Origin header, so the browser refuses the
  // response.
  const ALLOWED_ORIGINS = [
    process.env.SWRC_APP_ORIGIN || 'https://sainted-word-records.vercel.app',
    'http://localhost:5174',
    'http://localhost:4173',
    { pattern: /\.vercel\.app$/, httpsOnly: true },
  ];
  if (origin && ALLOWED_ORIGINS.some((entry) => _matches(entry, origin))) {
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
// then SWRC_APP_ORIGIN / localhost) - shared by the checkout handlers.
export function appOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').toString();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) return `${proto}://${host}`;
  return process.env.SWRC_APP_ORIGIN || `http://localhost:5174`;
}

// ---------------------------------------------------------------------------
// The client IP.
//
// The client IP is the bucket key for every per-IP rate limit, so it is
// derived in exactly ONE place. `x-forwarded-for` is a REQUEST HEADER: it is
// worth reading only when a proxy we control wrote it. Everywhere else it is a
// string the client chose, so reading it hands every attacker a fresh rate
// limit bucket per request. That is the defect SECURITY.md documents.
//
// The contract:
//
//   1. `TRUSTED_PROXIES` names the reverse proxies in front of this
//      deployment: exact IPs and CIDR ranges, comma or space separated.
//   2. With a configured list the header is honoured ONLY when the immediate
//      peer (req.socket.remoteAddress) is itself one of those proxies. The
//      chain is then walked FROM THE RIGHT: entries that are trusted proxies
//      are skipped, and the first entry that is not one is the client.
//      Everything to the LEFT of that entry is whatever the client prepended,
//      so walking from the left is precisely the bug this exists to prevent.
//   3. With no configured list, Vercel is the proxy: its edge OVERWRITES
//      `x-forwarded-for` with the client's public IP and does not forward
//      external IPs ("This restriction is in place to prevent IP spoofing",
//      vercel.com/docs/headers/request-headers), so the header holds a single
//      trustworthy value and the leftmost entry is the client. Off Vercel
//      there is no evidence for the header at all, so it is ignored and the
//      peer is used.
//   4. Anything unparseable fails closed toward the peer, never toward
//      trusting the header. An absent, blank or unparseable TRUSTED_PROXIES
//      is NOT "trust everything".
//
// The two failure modes are not symmetric. A limit that is too strict (one
// shared bucket) returns 429s and someone notices; a limit that is too loose
// lets an attacker through and nobody notices. Every branch below is chosen
// so the loud failure is the possible one.
const UNKNOWN_IP = 'unknown';

// Canonical dotted-quad IPv4, or null. A component with a leading zero is
// rejected: `010.0.0.1` is a typo in nine cases out of ten and it has two
// plausible readings (octal 8, decimal 10). Rejecting keeps ONE canonical
// spelling per address, so a mis-typed proxy entry matches nothing rather
// than quietly matching some other proxy.
function _canonIpv4(raw) {
  const parts = String(raw).split('.');
  if (parts.length !== 4) return null;
  let out = '';
  for (let i = 0; i < 4; i++) {
    const p = parts[i];
    if (!/^\d{1,3}$/.test(p) || (p.length > 1 && p[0] === '0')) return null;
    const n = Number(p);
    if (n > 255) return null;
    out += (i ? '.' : '') + n;
  }
  return out;
}

// The eight 16-bit groups of an IPv6 address, or null. No embedded IPv4: an
// `::ffff:1.2.3.4` is normalized to `1.2.3.4` before it gets here, so the
// dual-stack spelling never reaches this parser.
function _ipv6Groups(raw) {
  let text = String(raw);
  if (text.indexOf(':') === -1) return null;
  // An embedded IPv4 tail (`64:ff9b::1.2.3.4`) is two hex groups, not three.
  // A socket never reports that form, but an operator can type it into
  // TRUSTED_PROXIES, and an entry we cannot parse trusts nothing.
  if (text.includes('.')) {
    const cut = text.lastIndexOf(':');
    const v4 = cut === -1 ? null : _canonIpv4(text.slice(cut + 1));
    if (!v4) return null;
    const o = v4.split('.').map(Number);
    text = `${text.slice(0, cut + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const read = (part) => {
    const out = [];
    if (part === '') return out;
    for (const chunk of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null;
      out.push(parseInt(chunk, 16));
    }
    return out;
  };
  const head = read(halves[0]);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = read(halves[1]);
  if (tail === null) return null;
  // The elided run stands for at least one group, so head + tail fills at
  // most 7 and the zeros go BETWEEN them (`2001:db8::1` is db8, five zeros,
  // then 1 - appending them would move the address).
  if (head.length + tail.length > 7) return null;
  return head.concat(new Array(8 - head.length - tail.length).fill(0), tail);
}

// RFC 5952 text: lowercase, no leading zeros, and the LONGEST run of two or
// more zero groups compressed to `::` (leftmost run on a tie).
function _formatIpv6(groups) {
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;
  let len = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (start === -1) start = i;
      len++;
      if (len > bestLen) { bestLen = len; bestStart = start; }
    } else {
      start = -1;
      len = 0;
    }
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen < 2) return hex.join(':');
  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLen).join(':');
  return `${head}::${tail}`;
}

// The canonical form of an address, used both for comparing against the
// trust list and for KEYING the rate limiter. A string that is not an address
// at all is returned trimmed and lowercased: an unrecognised peer is still a
// stable bucket, it just is not a trusted one.
export function normalizeIp(raw) {
  let s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return '';
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);            // a zone id is host-local
  if (s[0] === '[' && s[s.length - 1] === ']') s = s.slice(1, -1);
  const v4 = _canonIpv4(s);
  if (v4) return v4;
  // `::ffff:1.2.3.4` and `1.2.3.4` are the same host. A dual-stack listener
  // sees the mapped form and a v4-only listener sees the bare one, so without
  // this collapse the same client gets two buckets - and therefore two rate
  // limit budgets - depending on which socket it happened to arrive on.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return _canonIpv4(mapped[1]) || s;
  const groups = _ipv6Groups(s);
  return groups ? _formatIpv6(groups) : s;
}

// Bit width of a canonical address: 32, 128, or 0 when it is not an address.
function _ipSize(ip) {
  if (_canonIpv4(ip)) return 32;
  return _ipv6Groups(ip) ? 128 : 0;
}

// The address as an unsigned integer, so a CIDR range is a shift and a compare.
function _ipValue(ip) {
  if (_canonIpv4(ip)) {
    return ip.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(octet), 0n);
  }
  const groups = _ipv6Groups(ip);
  if (!groups) return 0n;
  return groups.reduce((acc, group) => (acc << 16n) | BigInt(group), 0n);
}

// Parse TRUSTED_PROXIES into exact entries plus CIDR ranges. An entry that
// does not parse is SKIPPED (it trusts nothing) rather than failing the whole
// list: a typo should not silently disable the proxy in front of the app, and
// skipping it cannot make the header more trusted.
function _parseProxyList(raw) {
  const exact = new Set();
  const cidr = [];
  const skipped = [];
  for (const token of String(raw == null ? '' : raw).split(/[\s,]+/)) {
    if (!token) continue;
    const slash = token.lastIndexOf('/');
    const ranged = slash !== -1;
    const ip = normalizeIp(ranged ? token.slice(0, slash) : token);
    const size = _ipSize(ip);
    const lenText = ranged ? token.slice(slash + 1) : '';
    const prefix = ranged ? Number(lenText) : size;
    if (!size || (ranged && (!/^\d{1,3}$/.test(lenText) || prefix > size))) {
      skipped.push(token);
      continue;
    }
    if (!ranged) exact.add(ip);
    else cidr.push({ value: _ipValue(ip), size, prefix });
  }
  return { exact, cidr, skipped };
}

// Parsed once per distinct value of the env var: the list is read on every
// request but it cannot change inside an instance, and the one-shot warning
// below must not repeat per request.
let _proxyCache = { raw: null, list: null };

function _trustedProxies(env) {
  const raw = env.TRUSTED_PROXIES;
  const text = String(raw == null ? '' : raw);
  if (_proxyCache.raw === text) return _proxyCache.list;
  const list = _parseProxyList(text);
  if (list.skipped.length && typeof console !== 'undefined' && console.warn) {
    console.warn(
      `[swr] TRUSTED_PROXIES: ignoring unparseable entr${list.skipped.length === 1 ? 'y' : 'ies'}: ${list.skipped.join(', ')}`
    );
  }
  _proxyCache = { raw: text, list };
  return list;
}

function _isTrustedProxy(ip, list) {
  if (list.exact.has(ip)) return true;
  const size = _ipSize(ip);
  if (!size) return false;
  const value = _ipValue(ip);
  for (const range of list.cidr) {
    if (range.size !== size) continue;
    const shift = BigInt(size - range.prefix);
    if ((value >> shift) === (range.value >> shift)) return true;
  }
  return false;
}

// The header as an ordered list, oldest hop first. Node joins duplicate
// headers into one string, but an array is accepted so a caller that built
// the request itself cannot smuggle one past the split.
function _forwardedChain(raw) {
  const text = Array.isArray(raw) ? raw.join(',') : String(raw == null ? '' : raw);
  const chain = [];
  for (const part of text.split(',')) {
    const ip = normalizeIp(part);
    if (ip) chain.push(ip);
  }
  return chain;
}

// Does the platform in front of us sanitize `x-forwarded-for` itself?
//
// Only Vercel is known to, and it says so in its own docs. `VERCEL=1` is
// injected by the platform, never by the client, so it is not forgeable. It is
// the only platform trusted implicitly: an AWS or Cloudflare or Fly
// deployment must set TRUSTED_PROXIES explicitly, because "we recognised the
// environment variable" is a weaker guarantee than "we published the address
// ranges of the thing in front of us".
//
// The cost of getting this wrong in the trusting direction (a Vercel-flagged
// process with no edge in front of it - `vercel dev` is the real case, which
// is why VERCEL_ENV=development is excluded) is the pre-gate behaviour: the
// header is honoured as if the edge had sanitised it. The cost of getting it
// wrong in the closed direction is that every per-IP limit becomes ONE bucket
// shared by all users, so the whole site rate-limits itself at once. That is
// the worse of the two failures, and it is the one we refuse to risk.
function _platformSanitisesForwardedFor(env) {
  if (!env.VERCEL) return false;
  return String(env.VERCEL_ENV || '').toLowerCase() !== 'development';
}

// The client IP for a request. Use this instead of reading the header.
export function clientIp(req) {
  const env = process.env;
  const headers = (req && req.headers) || {};
  const peer = normalizeIp((req && req.socket && req.socket.remoteAddress) || '');
  const configured = typeof env.TRUSTED_PROXIES === 'string' && env.TRUSTED_PROXIES.trim() !== '';
  const chain = _forwardedChain(headers['x-forwarded-for']);

  if (!configured) {
    // No trust configuration. Vercel's edge rewrites the header to a single
    // client IP, so there is no chain to walk and the leftmost entry IS the
    // client. Everywhere else the header is not evidence of anything.
    if (_platformSanitisesForwardedFor(env) && chain.length) return chain[0];
    return peer || UNKNOWN_IP;
  }

  // Configured, but the peer is not one of our proxies: whatever wrote the
  // header is somebody else, so the header is ignored entirely.
  const list = _trustedProxies(env);
  if (!peer || !_isTrustedProxy(peer, list)) return peer || UNKNOWN_IP;

  // Walk from the right. Each proxy appends the address of the hop in front
  // of it, so the rightmost entries are the ones our own proxies wrote and
  // the leftmost ones are whatever the client chose. The first untrusted entry
  // from the right is the last address a forger cannot influence.
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!_isTrustedProxy(chain[i], list)) return chain[i];
  }
  // Every hop in the chain is a trusted proxy (the caller is a proxy too):
  // there is no client address to report, so the peer is the honest answer.
  return peer;
}
