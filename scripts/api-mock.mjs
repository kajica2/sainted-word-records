// scripts/api-mock.js — generic in-process + HTTP API mock, driven by
// the Zod contracts in api/_lib/contract/.
//
// Stage 3 of the easy-testing & integration API plan (9a57a7f). The
// mock is the test-harness the plan promised: register a route, the
// engine validates the input via the contract and returns either the
// canned response or a structured error envelope. Tests can either
// call handle() in-process (no port) or boot the HTTP server with
// start({ port }) for fetch-based tests.
//
// Why a separate mock and not a wrapper around the real handlers:
//   - The real handlers do real I/O (Postgres / Vercel Blob / Stripe).
//     Unit tests want speed + determinism; the mock gives both.
//   - The mock's response shape is the contract — so tests that
//     drive the real handlers later see the same shape and don't
//     need a second set of fixtures.
//
// Usage:
//
//   import { apiMock, registerDefaults } from './api-mock.js';
//   import './api-mock-defaults.js';  // auto-registers routes on import
//   const res = await apiMock.handle({ method: 'POST', url: '/api/auth/magic', body: { email: 'a@b.com' } });
//   // { status: 200, body: { ok: true } }
//
//   const { close } = await apiMock.start({ port: 8787 });
//   await fetch('http://127.0.0.1:8787/api/auth/magic', { method: 'POST', body: JSON.stringify({email:'a@b'}) });
//   await close();

import http from 'node:http';

const handlers = new Map(); // key: 'METHOD path' → handler descriptor

function key(method, path) {
  return method.toUpperCase() + ' ' + path;
}

function matchRoute(method, path) {
  // Exact match first; fall back to a wildcard / with-trailing-slash
  // match (so /api/auth/magic and /api/auth/magic/ both resolve).
  const m = method.toUpperCase();
  const direct = handlers.get(key(m, path));
  if (direct) return direct;
  if (path.endsWith('/')) {
    const trimmed = path.slice(0, -1);
    return handlers.get(key(m, trimmed)) || null;
  }
  return null;
}

// ---- Error envelopes. The mock never throws — every path returns
// { status, body } shaped like the real handler would. The shape
// matches ErrorBody from api/_lib/contract/_shared.mjs.
function errorEnvelope(code, hint, status, retryAfterMs) {
  const body = { error: code };
  if (hint) body.hint = hint;
  if (retryAfterMs != null) body.retryAfterMs = retryAfterMs;
  return { status, body };
}

// ---- Registration API. Tests can override canned data per-call via
// ---- `handler.canned(...)`; useful for asserting different success
// ---- or error shapes without rebuilding the mock.

function register({ method, path, reqSchema = null, resSchema = null,
                   canned = null, status = 200, errorRate = 0,
                   handler = null }) {
  if (!method || !path) {
    throw new TypeError('register: method and path required');
  }
  const desc = {
    method: method.toUpperCase(),
    path,
    reqSchema, resSchema,
    canned,
    status,
    errorRate,
    handler, // optional custom function (req) => { status, body }
  };
  handlers.set(key(desc.method, desc.path), desc);
  return () => handlers.delete(key(desc.method, desc.path)); // unregister
}

function clear() { handlers.clear(); }
function list() { return [...handlers.values()].map(({ method, path }) => ({ method, path })); }

export { register, clear, list };

// ---- In-process handler. The core entry point for unit tests.
//
// `req` shape:
//   { method: 'GET', url: '/api/auth/magic', body?: object|null,
//     headers?: { ... }, override?: { canned?, status?, errorCode? } }
//
// `res` shape:
//   { status: number, body: object }
//
// Order of evaluation:
//   1. Route lookup. Miss → 404 { error: 'no_mock_route' }.
//   2. Method override (if `req.method === 'OPTIONS'`): 204, no body.
//      Always — the mock is CORS-friendly by default.
//   3. Custom `handler` function (if registered). Skips validation
//      and canned-data path; the function owns the response.
//   4. Input validation via `reqSchema.safeParse`. Fail → 400 with the
//      standard invalid_request error envelope (matches the real handler).
//   5. Stochastic error injection (`errorRate > 0`). Mock-only knob
//      to verify error-path UX in client SDK tests.
//   6. Per-call override (`req.override.canned` or `.status`). For
//      tests that want a specific response without registering a
//      new route.
//   7. Canned response. The handler MAY validate via `resSchema.parse`
//      for parity with the real handler; the default is to skip
//      validation at runtime (tests check it).

async function handle(req) {
  const method = (req.method || 'GET').toUpperCase();
  let path;
  try {
    const u = new URL(req.url, 'http://localhost');
    path = u.pathname;
  } catch {
    return errorEnvelope('invalid_request', 'malformed url', 400);
  }

  // OPTIONS: synthetic CORS preflight, no route lookup needed.
  if (method === 'OPTIONS') {
    return { status: 204, body: {} };
  }

  const desc = matchRoute(method, path);
  if (!desc) {
    return errorEnvelope('no_mock_route', `no handler registered for ${method} ${path}`, 404);
  }

  // Custom handler bypasses everything else.
  if (typeof desc.handler === 'function') {
    return await desc.handler(req);
  }

  // Input validation.
  if (desc.reqSchema && req.body != null) {
    const parse = desc.reqSchema.safeParse(req.body);
    if (!parse.success) {
      const issue = parse.error.issues[0];
      const path = issue && issue.path.length ? issue.path.join('.') : null;
      const hint = path ? `${path}: ${issue.message}` : issue.message;
      return errorEnvelope('invalid_request', hint, 400);
    }
  }

  // Stochastic error injection. Useful for the client SDK's
  // retry-on-rate-limited tests.
  if (desc.errorRate > 0 && Math.random() < desc.errorRate) {
    return errorEnvelope('rate_limited', 'mock-injected error', 429, 1000);
  }

  // Per-call override. Order matters: errorCode is the most specific
  // (forces an error envelope regardless of status); canned replaces
  // the body; status bumps the status without changing the body.
  if (req.override) {
    if (req.override.errorCode) {
      return errorEnvelope(req.override.errorCode, req.override.hint, req.override.status ?? 400);
    }
    if (req.override.canned != null) {
      return { status: req.override.status ?? desc.status, body: req.override.canned };
    }
    if (req.override.status != null) {
      return { status: req.override.status, body: req.override.canned ?? desc.canned ?? {} };
    }
  }

  return { status: desc.status, body: desc.canned };
}

// ---- HTTP server. Boots on a random ephemeral port by default.
// ---- Returns { port, baseUrl, close }. Tests can `await fetch()`
// ---- against baseUrl without binding a fixed port that may collide
// ---- with another parallel test.

async function start({ port = 0, host = '127.0.0.1' } = {}) {
  const server = http.createServer(async (req, res) => {
    // CORS headers, matching api/_lib/http.js setCors(). Tests don't
    // need the allowlist here — the mock is local-only and accepts
    // any origin.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    let body = null;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const chunks = [];
      let total = 0;
      for await (const c of req) {
        total += c.length;
        if (total > 1_000_000) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'payload_too_large' }));
          return;
        }
        chunks.push(c);
      }
      const buf = Buffer.concat(chunks);
      if (buf.length) {
        try { body = JSON.parse(buf.toString('utf8')); }
        catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_request', hint: 'body must be valid JSON' }));
          return;
        }
      }
    }

    const result = await handle({ method: req.method, url: req.url, body, headers: req.headers });
    res.statusCode = result.status;
    if (result.status !== 204) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(result.body));
    } else {
      res.end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve();
      // surface via outer scope
    });
  });

  // Re-resolve the actual port for the returned object (port=0 means
  // the OS picks one).
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;

  return {
    port: actualPort,
    host,
    baseUrl: `http://${host}:${actualPort}`,
    server,
    close: () => new Promise((r) => server.close(r)),
  };
}

export const apiMock = {
  register,
  clear,
  list,
  handle,
  start,
};

export default apiMock;