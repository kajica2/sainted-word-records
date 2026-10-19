// api/_lib/contract/_shared.mjs — Zod helpers and common patterns
// shared by every contract file. Importing this avoids duplicating
// regex/format validators across families.
//
// Conventions:
//   - Field names use snake_case (matches the JSON the handlers
//     already emit).
//   - Optional fields are explicitly marked `.optional()`, not
//     `.nullable()`. The contract tells consumers what's required.
//   - Errors are validated as the union: handler returns
//     `{ error: 'code' }` (Zod i18n for free), and consumers can
//     branch on the code without parsing a human message.

import { z } from 'zod';

// An RFC-5322-ish email pattern. The handler does its own check
// server-side; the contract just rejects obviously-invalid input
// at the Zod parse step.
export const Email = z.string().email().min(3).max(254);
// A 36-char UUIDv4 (with hyphens).
export const Uuid = z.string().uuid();
// A 1-12 alphanumeric code (matches PT_KEY_RE).
export const KeyCode = z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/);
// Standard 5xx-style error envelope used by every handler.
export const ErrorBody = z.object({
  error: z.string(),
  // Optional human-readable hint (rate-limit responses use this).
  hint: z.string().optional(),
  retryAfterMs: z.number().optional(),
});
// Common response status helpers.
export const Ok = z.object({ ok: z.literal(true) });
// An ISO 8601 timestamp.
export const IsoDate = z.string().datetime({ offset: true });
