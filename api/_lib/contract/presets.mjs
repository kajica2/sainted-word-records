// api/_lib/contract/presets.mjs — the persona-presets public endpoint
// (GET /api/presets). No auth; no body.

import { z } from 'zod';
import { Ok, ErrorBody, IsoDate } from './_shared.mjs';

// The shape of a single preset entry. The server's
// presets/manifest.json is the source of truth; the contract is
// what consumers (lib/presets-dropdown.client.js, the engine's
// dropdown) can rely on.
export const Preset = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  // Family is the bucket key: 'AMBIENT' | 'RAW' | etc. Uppercase by
  // convention but the contract allows any case.
  family: z.string().min(1).max(40),
  // Free-text description, shown in the dropdown.
  desc: z.string().max(280).optional(),
  // Tags are short labels for the search field.
  tags: z.array(z.string().min(1).max(40)).max(16).optional(),
  // The tier the preset requires (or 'free' for no tier). Filters
  // out locked presets for the user.
  tier: z.enum(['free', 'solo', 'band', 'label']).default('free'),
  // Sequencer parameters applied when the preset is loaded. The
  // contract keeps the shape open; each key is engine-internal.
  params: z.record(z.string(), z.unknown()).optional(),
  // When this preset was last updated; the dropdown sorts by recency
  // unless the user has filtered.
  updatedAt: IsoDate.optional(),
});
export const PresetsRes = z.union([
  z.object({
    ok: z.literal(true),
    families: z.array(z.string()),
    presets: z.array(Preset),
  }),
  ErrorBody.extend({ error: z.enum(['rate_limited', 'method_not_allowed']) }),
]);

// /api/presets accepts a few query parameters; the contract captures
// them so the route handler can be auto-validated by the smoke.
export const PresetsQuery = z.object({
  family: z.string().min(1).max(40).optional(),
  search: z.string().min(1).max(80).optional(),
  tier: z.enum(['free', 'solo', 'band', 'label']).optional(),
});
