// api/_lib/contract/projects.mjs — request/response shapes for the
// /api/projects endpoints (CRUD + share).

import { z } from 'zod';
import { Uuid, Ok, ErrorBody, IsoDate } from './_shared.mjs';

// A project is the unit of saved state in the engine. The shape
// here is the contract; the actual record stored in db.js has the
// same keys plus server-only fields (tier patch dates, lastOpened
// timestamp) which the contract does not promise.
export const ProjectReq = z.object({
  name: z.string().min(1).max(120),
  notes: z.string().max(8_000).optional(),
  // Initial layer preset id. The handler will look this up against
  // PRESETS; an unknown id returns 422.
  presetId: z.string().min(1).max(64).optional(),
  // Server may accept a seed value (e.g. seedable RNG initial state).
  seed: z.number().finite().optional(),
});

export const ProjectPatchReq = z.object({
  name: z.string().min(1).max(120).optional(),
  notes: z.string().max(8_000).optional(),
  presetId: z.string().min(1).max(64).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'patch must include at least one field' });

export const Project = z.object({
  id: Uuid,
  name: z.string(),
  notes: z.string().optional(),
  presetId: z.string().optional(),
  seed: z.number().optional(),
  ownerId: Uuid,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});

export const ProjectListRes = z.object({
  ok: z.literal(true),
  projects: z.array(Project),
});

export const ProjectRes = z.union([
  Project,
  ErrorBody.extend({ error: z.enum(['not_found', 'rate_limited', 'unauthorized', 'forbidden', 'method_not_allowed']) }),
]);

// Share link payload — the engine generates a token server-side and
// the client opens the link to a read-only view. The token is
// short-lived (default 24h).
export const ShareReq = z.object({
  ttlMs: z.number().int().min(60_000).max(7 * 24 * 60 * 60 * 1000).optional(),
});
export const ShareRes = z.object({
  ok: z.literal(true),
  url: z.string().url(),
  token: z.string(),
  expiresAt: IsoDate,
});
