// api/_lib/contract/pt.mjs — request/response shapes for the PT
// (Personal Tier) endpoints: verify (public) and operator-import
// (admin). Two separate contracts because the security model is
// different (the verify endpoint is rate-limited per-IP, the
// operator-import requires the admin secret).

import { z } from 'zod';
import { Email, Ok, ErrorBody, IsoDate } from './_shared.mjs';

// The key is normalised to lowercase server-side; the contract
// accepts any case but tier is the one decoded by the regex.
export const VerifyReq = z.object({
  key: z.string().min(1).max(64),  // format checked by the handler
});
export const VerifyRes = z.union([
  z.object({
    ok: z.literal(true),
    valid: z.literal(true),
    tier: z.string(),                  // 'solo' | 'band' | 'label'
    tierName: z.string().optional(),
    slots: z.number().int().optional(),
    slotsRemaining: z.number().int().optional(),
    grantedAt: IsoDate.optional(),
    sessionId: z.string().nullable().optional(),
  }),
  z.object({
    ok: z.literal(true),
    valid: z.literal(false),
    error: z.string().optional(),     // 'key not found' | 'key format invalid' | 'tier mismatch' | 'tier retired'
  }),
  ErrorBody.extend({ error: z.enum(['rate_limited', 'method_not_allowed']) }),
]);

// Admin-side: bulk-import keys minted by the operator. Requires
// the admin secret in the x-import-secret header (not part of the
// body contract; enforced by handler middleware).
export const ImportReq = z.object({
  keys: z.array(
    z.union([
      z.string(),  // just the key string; tier parsed from the key
      z.object({  // or explicit metadata
        key: z.string().min(1).max(64),
        tier: z.enum(['solo', 'band', 'label']).optional(),
        email: Email.optional(),
        sessionId: z.string().min(1).max(256).optional(),
        slots: z.number().int().min(1).max(1000).optional(),
      }),
    ]),
  ).min(1).max(500),
});
export const ImportRes = z.union([
  z.object({
    ok: z.literal(true),
    imported: z.number().int().min(0),
    skipped: z.number().int().min(0),
    skippedKeys: z.array(z.string()).optional(),
    errors: z.array(z.object({
      key: z.string(),
      error: z.string(),
    })).optional(),
  }),
  ErrorBody.extend({ error: z.enum(['unauthorized', 'rate_limited', 'invalid_request']) }),
]);
