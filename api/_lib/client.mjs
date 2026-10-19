// api/_lib/client.mjs — typed client SDK for the SWR API, driven by
// the Zod contracts in api/_lib/contract/.
//
// Stage 4 of the easy-testing & integration API plan (9a57a7f).
// The mock server (scripts/api-mock.mjs) is the test harness; this
// SDK is the production-facing surface the engine + scripts use to
// talk to /api/*.
//
// Public surface:
//
//   const api = createClient({ base });
//   const res = await api.auth.magic({ email: 'me@x.com' });
//   // → { status, body, headers }
//
// Each route is a method. The shape mirrors the contract —
// request body / query validated by Zod before send, response
// parsed by Zod after recv. The Zod schemas are the single source
// of truth for what the SDK accepts and emits.
//
// Cookies: tracked in a Map<string, string>. After a response with
// `Set-Cookie: name=value; ...`, the SDK parses the first pair and
// stores it. Every subsequent request automatically attaches the
// jar as `Cookie: name=value; ...`.
//
// Headers: a parallel Map for caller-set headers (Authorization,
// X-Request-Id, …). Set with api.setHeader(k, v).
//
// Why client-side, not just server-side: the engine's lib/client/
// code (lib/auth.client.js, lib/storage.client.js, etc.) currently
// hand-rolls fetch() with its own error handling per route. The
// SDK replaces that with one shared implementation whose error
// envelope handling matches the contract's ErrorBody shape.

import {
  MagicReq, MagicRes,
  VerifyReq as AuthVerifyReq, VerifyRes as AuthVerifyRes,
  SessionRes, GoogleRes,
} from './contract/auth.mjs';
import {
  EarlyAccessReq, EarlyAccessRes, ManifestRes,
} from './contract/_public.mjs';
import {
  VerifyReq as PtVerifyReq, VerifyRes as PtVerifyRes,
  ImportReq, ImportRes,
} from './contract/pt.mjs';
import {
  ProjectReq, ProjectPatchReq, Project,
  ProjectListRes, ProjectRes, ShareReq, ShareRes,
} from './contract/projects.mjs';
import { PresetsQuery, PresetsRes } from './contract/presets.mjs';

// ---- Error classes ----
//
// The SDK throws a typed error on:
//   - Zod input parse failure (bad input the caller asked for)
//   - Zod response parse failure (server returned a shape that
//     doesn't match the contract — early signal of contract drift)
//   - Network failure (fetch rejected — usually a real outage)
//
// The caller can catch `ApiError` to handle any of these uniformly;
// or check `error.code` to branch.

export class ApiError extends Error {
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;          // 'invalid_input' | 'invalid_response' | 'network' | 'http_error'
    this.status = opts.status; // HTTP status if from a response
    this.body = opts.body;     // response body if available
    this.issues = opts.issues; // Zod issues if input/output drift
  }
}

// ---- Cookie + header jars ----

function parseSetCookie(setCookieValue) {
  // We only store the first pair of `name=value` — the SDK is
  // for browser-side fetch() where the rest (Path, Expires, …)
  // is server-side and the browser would normally enforce. For
  // Node-fetch (no automatic cookie jar) the caller is responsible
  // for session lifetime via the Map.
  const m = setCookieValue.match(/^\s*([^=]+)=([^;,\s]*)/);
  return m ? { name: m[1].trim(), value: m[2].trim() } : null;
}

function cookieJarToHeader(jar) {
  if (!jar.size) return '';
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ---- Generic requester ----

async function rawRequest({ base, fetchImpl, method, path, query, body,
                          reqSchema, resSchema, headers, cookies,
                          throwOnHmac }) {
  const url = new URL(path, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  // Build request headers: caller-set + Cookie jar.
  const reqHeaders = { Accept: 'application/json' };
  for (const [k, v] of headers.entries()) reqHeaders[k] = v;
  const cookieHeader = cookieJarToHeader(cookies);
  if (cookieHeader) reqHeaders.cookie = cookieHeader;

  let bodyJson = null;
  if (body !== undefined && body !== null) {
    if (reqSchema) {
      const parse = reqSchema.safeParse(body);
      if (!parse.success) {
        const issue = parse.error.issues[0];
        const path = issue && issue.path.length ? issue.path.join('.') : null;
        throw new ApiError('invalid_input',
          path ? `${path}: ${issue.message}` : issue.message,
          { issues: parse.error.issues });
      }
      bodyJson = JSON.stringify(parse.data);
    } else {
      bodyJson = JSON.stringify(body);
    }
    reqHeaders['content-type'] = 'application/json';
  }

  let res;
  try {
    res = await fetchImpl(url, { method, headers: reqHeaders, body: bodyJson });
  } catch (e) {
    throw new ApiError('network', e.message || 'fetch failed');
  }

  // Capture Set-Cookie.
  const setCookie = res.headers && res.headers.get('set-cookie');
  if (setCookie) {
    const parsed = parseSetCookie(setCookie);
    if (parsed) cookies.set(parsed.name, parsed.value);
  }

  let resBody = null;
  const contentType = (res.headers && res.headers.get('content-type')) || '';
  // 204 has no body. For everything else, prefer JSON unless the
  // content-type header explicitly says otherwise. Some fetch
  // implementations (and some test mocks) don't set content-type;
  // assume JSON unless the response explicitly says text/*.
  if (res.status !== 204) {
    if (contentType.includes('application/json') || !contentType) {
      try {
        // Read as text first so a malformed JSON response falls back
        // gracefully (raw text instead of throwing). The validator
        // catches invalid_response below.
        const txt = await res.text();
        resBody = txt ? JSON.parse(txt) : null;
      } catch {
        // Not JSON; try as plain text.
        try { resBody = await res.text(); } catch { resBody = null; }
      }
    } else {
      try { resBody = await res.text(); }
      catch { resBody = null; }
    }
  }

  // Validate response shape if a schema was provided.
  if (resSchema && resBody !== null && typeof resBody === 'object') {
    const parse = resSchema.safeParse(resBody);
    if (!parse.success) {
      throw new ApiError('invalid_response',
        `response from ${method} ${path} did not match contract`,
        { status: res.status, body: resBody, issues: parse.error.issues });
    }
    resBody = parse.data;
  }

  // 4xx / 5xx — surface as errors. The server returns ErrorBody
  // envelopes (`{ error, hint?, retryAfterMs? }`); the SDK
  // throws an ApiError carrying the code.
  if (res.status >= 400) {
    const errCode = (resBody && resBody.error) || 'http_' + res.status;
    throw new ApiError(errCode,
      `${method} ${path} → ${res.status} ${errCode}`,
      { status: res.status, body: resBody });
  }

  return {
    status: res.status,
    body: resBody,
    headers: res.headers,
  };
}

// ---- Factory ----

export function createClient(opts = {}) {
  const {
    base,
    fetchImpl = (typeof fetch !== 'undefined') ? fetch : null,
    // throwOnInvalidInput defaults true: bad input should fail fast.
    // Tests can flip it to false to assert the error path.
    throwOnInvalidInput = true,
  } = opts;

  if (!base) throw new TypeError('createClient: { base } required');
  if (!fetchImpl) throw new TypeError('createClient: fetch not available; pass { fetch: impl }');

  const cookies = new Map();
  const headers = new Map();

  function request(spec) { return rawRequest({ ...spec, base, fetchImpl, cookies, headers }); }

  const client = {
    cookies,
    headers,

    setHeader(k, v) { headers.set(k.toLowerCase(), v); },
    clearHeader(k)  { headers.delete(k.toLowerCase()); },
    setCookie(k, v)  { cookies.set(k, v); },
    clearCookies()   { cookies.clear(); },

    auth: {
      magic(input) {
        return request({
          method: 'POST',
          path: '/api/auth/magic',
          body: input,
          reqSchema: MagicReq, resSchema: MagicRes,
        });
      },
      verify(input) {
        return request({
          method: 'GET',
          path: '/api/auth/verify',
          query: input,
          reqSchema: AuthVerifyReq, resSchema: AuthVerifyRes,
        });
      },
      session() {
        return request({
          method: 'GET',
          path: '/api/auth/session',
          resSchema: SessionRes,
        });
      },
      google(input) {
        return request({
          method: 'POST',
          path: '/api/auth/google',
          body: input,
          resSchema: GoogleRes,
        });
      },
    },

    public: {
      earlyAccess(input) {
        return request({
          method: 'POST',
          path: '/api/early-access',
          body: input,
          reqSchema: EarlyAccessReq, resSchema: EarlyAccessRes,
        });
      },
      manifest() {
        return request({
          method: 'GET',
          path: '/api/manifest',
          resSchema: ManifestRes,
        });
      },
    },

    pt: {
      verify(input) {
        return request({
          method: 'GET',
          path: '/api/pt/verify',
          query: input,
          reqSchema: PtVerifyReq, resSchema: PtVerifyRes,
        });
      },
      importKeys(input) {
        return request({
          method: 'POST',
          path: '/api/admin/pt/keys/import',
          body: input,
          reqSchema: ImportReq, resSchema: ImportRes,
        });
      },
    },

    presets: {
      list(query) {
        return request({
          method: 'GET',
          path: '/api/presets',
          query,
          reqSchema: PresetsQuery, resSchema: PresetsRes,
        });
      },
    },

    projects: {
      list() {
        return request({
          method: 'GET',
          path: '/api/projects',
          resSchema: ProjectListRes,
        });
      },
      create(input) {
        return request({
          method: 'POST',
          path: '/api/projects',
          body: input,
          reqSchema: ProjectReq, resSchema: ProjectRes,
        });
      },
      get(id) {
        if (!id) throw new ApiError('invalid_input', 'id required');
        return request({
          method: 'GET',
          path: `/api/projects/${id}`,
          resSchema: Project,
        });
      },
      patch(id, input) {
        if (!id) throw new ApiError('invalid_input', 'id required');
        return request({
          method: 'PATCH',
          path: `/api/projects/${id}`,
          body: input,
          reqSchema: ProjectPatchReq, resSchema: ProjectRes,
        });
      },
      share(id, input) {
        if (!id) throw new ApiError('invalid_input', 'id required');
        return request({
          method: 'POST',
          path: `/api/projects/${id}/share`,
          body: input,
          reqSchema: ShareReq, resSchema: ShareRes,
        });
      },
    },

    raw: request,
  };

  return client;
}

export default createClient;