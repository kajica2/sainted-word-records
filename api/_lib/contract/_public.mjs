// api/_lib/contract/_public.mjs — shapes for the unauthenticated
// public endpoints: early-access (waitlist) and manifest.

import { z } from 'zod';
import { Ok, ErrorBody, IsoDate } from './_shared.mjs';

// Early-access waitlist signup. POST { email, name?, useCase?, agreed }
// where agreed must be true (beta-test terms acceptance).
export const EarlyAccessReq = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  useCase: z.enum(['personal', 'label', 'creator', 'other']).optional(),
  agreed: z.literal(true),
});
export const EarlyAccessRes = z.union([
  Ok.extend({ queued: z.number().int().nonnegative().optional() }),
  ErrorBody.extend({ error: z.enum(['invalid_email', 'rate_limited', 'terms_not_agreed', 'method_not_allowed']) }),
]);

// /api/manifest — the engine's startup manifest. GET only.
export const ManifestRes = z.object({
  name: z.string(),
  version: z.string(),
  // Each entry is a known-files[] hint the engine uses to pre-resolve
  // asset paths. The shape is intentionally loose; handlers do their
  // own validation.
  knownFiles: z.array(z.string()).optional(),
  // Server time so the client can detect clock drift.
  serverTime: IsoDate,
  // Last-deployed build identifier (commit SHA or short hash).
  build: z.string().optional(),
});
