// api/_lib/contract/auth.mjs — request/response shapes for the auth
// endpoints (magic-link, verify, session, google).
//
// Zod-first, idiomatic to the Node codebase. The handler imports the
// shape, parses the body with Req.parse, builds the response, and
// returns Res.parse(response) before sendJson. Tests import the same
// shapes and run them through the handler to assert parity.

import { z } from 'zod';
import { Email, Uuid, Ok, ErrorBody } from './_shared.mjs';

export const MagicReq = z.object({
  email: Email,
});
export const MagicRes = z.union([
  Ok,                                     // { ok: true }
  ErrorBody.extend({                       // { error: 'invalid_email' | 'rate_limited' }
    error: z.enum(['invalid_email', 'rate_limited', 'method_not_allowed', 'unauthorized']),
  }),
]);

export const VerifyReq = z.object({
  token: z.string().min(8).max(256),
  email: Email.optional(),  // legacy: magic.js can use the email as a second factor
});
export const VerifyRes = z.union([
  z.object({ ok: z.literal(true), session: z.string().optional() }),
  ErrorBody.extend({
    error: z.enum(['invalid_token', 'expired_token', 'rate_limited', 'unauthorized', 'method_not_allowed']),
  }),
]);

export const SessionRes = z.union([
  z.object({
    ok: z.literal(true),
    user: z.object({ id: Uuid, email: Email, name: z.string().nullable(), tier: z.string().nullable() }),
    swr: z.string().optional(),  // opaque session token (kept for parity)
  }),
  z.object({ ok: z.literal(false) }),  // { ok: false } when not signed in
  ErrorBody.extend({ error: z.enum(['unauthorized', 'method_not_allowed']) }),
]);

// Google OAuth (one-shot callback). The shape is fixed by the
// provider; we just record that the contract accepts whatever Google
// returns. Handlers do their own redirect.
export const GoogleReq = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});
export const GoogleRes = z.union([
  z.object({ ok: z.literal(true) }),  // redirected with Set-Cookie
  ErrorBody.extend({ error: z.enum(['oauth_failed', 'rate_limited']) }),
]);
