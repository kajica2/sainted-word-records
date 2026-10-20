// scripts/check-contract.mjs — smoke gate for the API contract.
//
// Goals:
//   1. Every contract file imports cleanly under Zod and exports
//      valid schemas (no parse errors at definition time).
//   2. Zod can round-trip a "minimal valid" example for each schema
//      (catches typos in the type definitions).
//   3. Zod rejects the "obviously invalid" cases (a malformed
//      body for a POST, an invalid email, a key that doesn't match
//      the PT-key regex, etc.). This is the contract test pyramid's
//      base layer.
//
// The gate is small and fast (~5-10 ms total). The deeper test
// — handler / contract parity — is the work done in `check-*-unit.mjs`
// and the `check:contract-parity` gate that runs the real handler
// against the same schemas.
//
// Run: node scripts/check-contract.mjs
// Exit 0 on green, 1 on red.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_DIR = join(__dirname, '..', 'api', '_lib', 'contract');

let failed = 0;
function check(name, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`  ${status}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed += 1;
}

console.log('contract:');

const files = readdirSync(CONTRACT_DIR).filter((f) =>
  f.endsWith('.mjs') && f !== '_shared.mjs');

for (const f of files) {
  const mod = await import(join(CONTRACT_DIR, f));
  // Each module is expected to export at least one Zod schema.
  // Collect any field whose value is a Zod schema (heuristic: a
  // function with a safeParse method).
  const schemas = [];
  for (const [name, value] of Object.entries(mod)) {
    if (value && typeof value.safeParse === 'function') {
      schemas.push([name, value]);
    }
  }
  check(`${f}: exports at least one Zod schema`, schemas.length > 0,
    `found ${schemas.length} schemas`);
  for (const [name, schema] of schemas) {
    const sentinel = schema.safeParse({});
    check(`  ${f} :: ${name} is a real Zod schema`, sentinel !== undefined,
      `safeParse returned ${sentinel === undefined ? 'undefined' : typeof sentinel}`);
  }
}

// --- Per-schema round-trip tests ---
// Auth contracts
const { MagicReq, MagicRes, VerifyReq, VerifyRes, SessionRes } =
  await import('../api/_lib/contract/auth.mjs');

check('MagicReq accepts { email: "me@x.com" }', MagicReq.safeParse({ email: 'me@x.com' }).success);
check('MagicReq rejects { email: "nope" }', !MagicReq.safeParse({ email: 'nope' }).success);
check('MagicReq rejects {}', !MagicReq.safeParse({}).success);
check('MagicRes accepts { ok: true }', MagicRes.safeParse({ ok: true }).success);
check('MagicRes accepts { error: "rate_limited", hint: "x", retryAfterMs: 1000 }',
  MagicRes.safeParse({ error: 'rate_limited', hint: 'x', retryAfterMs: 1000 }).success);
check('SessionRes accepts { ok: false } (signed out)', SessionRes.safeParse({ ok: false }).success);
check('VerifyReq accepts valid token', VerifyReq.safeParse({ token: 'abcdef0123456789' }).success);
check('VerifyReq rejects empty token', !VerifyReq.safeParse({ token: '' }).success);

// Projects contracts
const { ProjectReq, ProjectPatchReq, Project, ProjectListRes, ShareRes } =
  await import('../api/_lib/contract/projects.mjs');

check('ProjectReq accepts minimal { name }', ProjectReq.safeParse({ name: 'demo' }).success);
check('ProjectReq rejects empty name', !ProjectReq.safeParse({ name: '' }).success);
check('ProjectReq rejects too-long name (121 chars)', !ProjectReq.safeParse({ name: 'x'.repeat(121) }).success);
check('ProjectPatchReq rejects empty patch', !ProjectPatchReq.safeParse({}).success);
check('ProjectPatchReq accepts { name }', ProjectPatchReq.safeParse({ name: 'x' }).success);
check('Project accepts a full record', Project.safeParse({
  id: '11111111-2222-3333-4444-555555555555',
  name: 'demo',
  notes: 'x',
  ownerId: '11111111-2222-3333-4444-555555555555',
  createdAt: '2026-10-12T12:00:00.000Z',
  updatedAt: '2026-10-12T12:00:00.000Z',
}).success);
check('ProjectListRes accepts { ok, projects: [] }',
  ProjectListRes.safeParse({ ok: true, projects: [] }).success);
check('ShareRes accepts a real-looking payload',
  ShareRes.safeParse({ ok: true, url: 'https://x.y/z', token: 'abc', expiresAt: '2026-10-13T12:00:00.000Z' }).success);

// PT contracts
const { VerifyReq: PtVerifyReq, VerifyRes: PtVerifyRes, ImportReq, ImportRes } =
  await import('../api/_lib/contract/pt.mjs');

check('PtVerifyReq accepts any non-empty key', PtVerifyReq.safeParse({ key: 'swr-band-A2B3C4D5' }).success);
check('PtVerifyRes accepts valid:true with tier',
  PtVerifyRes.safeParse({ ok: true, valid: true, tier: 'band' }).success);
check('PtVerifyRes accepts valid:false with error',
  PtVerifyRes.safeParse({ ok: true, valid: false, error: 'key not found' }).success);
check('PtVerifyRes accepts invalid_request error envelope',
  PtVerifyRes.safeParse({ error: 'invalid_request', hint: 'key required' }).success);
check('PtVerifyRes accepts rate_limited error envelope',
  PtVerifyRes.safeParse({ error: 'rate_limited', retryAfterMs: 2000 }).success);
check('PtVerifyRes accepts method_not_allowed error envelope',
  PtVerifyRes.safeParse({ error: 'method_not_allowed' }).success);
check('ImportReq accepts a string-key array',
  ImportReq.safeParse({ keys: ['swr-band-A2B3C4D5', 'swr-solo-N2P3P4P5'] }).success);
check('ImportReq accepts an object-key array',
  ImportReq.safeParse({ keys: [{ key: 'swr-band-A2B3C4D5', tier: 'band', email: 'me@x.com' }] }).success);
check('ImportReq rejects empty array',
  !ImportReq.safeParse({ keys: [] }).success);
check('ImportRes accepts { ok, imported, skipped }',
  ImportRes.safeParse({ ok: true, imported: 5, skipped: 0 }).success);
check('ImportRes accepts unauthorized error',
  ImportRes.safeParse({ error: 'unauthorized' }).success);

// PT license-verify contracts (POST /api/license/verify, P0.3)
const { LicenseVerifyReq, LicenseVerifyRes } =
  await import('../api/_lib/contract/pt.mjs');

check('LicenseVerifyReq accepts a well-formed code',
  LicenseVerifyReq.safeParse({ code: 'swr-band-A2B3C4D5' }).success);
check('LicenseVerifyReq rejects an empty code',
  !LicenseVerifyReq.safeParse({ code: '' }).success);
check('LicenseVerifyRes accepts valid:true with tier + entitlements',
  LicenseVerifyRes.safeParse({ valid: true, tier: 'band', creditsRemaining: 150, slotCount: 30 }).success);
check('LicenseVerifyRes accepts valid:true with slotsRemaining null',
  LicenseVerifyRes.safeParse({ valid: true, tier: 'solo', creditsRemaining: 50, slotCount: 10, slotsRemaining: null }).success);
check('LicenseVerifyRes accepts valid:false unknown_code',
  LicenseVerifyRes.safeParse({ valid: false, reason: 'unknown_code' }).success);
check('LicenseVerifyRes accepts valid:false expired',
  LicenseVerifyRes.safeParse({ valid: false, reason: 'expired' }).success);
check('LicenseVerifyRes rejects valid:false with an unknown reason',
  !LicenseVerifyRes.safeParse({ valid: false, reason: 'nope' }).success);
check('LicenseVerifyRes accepts the rate_limited envelope',
  LicenseVerifyRes.safeParse({ error: 'rate_limited', retryAfterMs: 1234 }).success);
check('LicenseVerifyRes accepts the store_unavailable envelope',
  LicenseVerifyRes.safeParse({ error: 'license_store_unavailable' }).success);
check('LicenseVerifyRes accepts the method_not_allowed envelope',
  LicenseVerifyRes.safeParse({ error: 'method_not_allowed' }).success);

// Public contracts
const { EarlyAccessReq, EarlyAccessRes, ManifestRes } =
  await import('../api/_lib/contract/_public.mjs');

check('EarlyAccessReq accepts valid signup',
  EarlyAccessReq.safeParse({ email: 'me@x.com', agreed: true }).success);
check('EarlyAccessReq rejects missing agreed: true',
  !EarlyAccessReq.safeParse({ email: 'me@x.com' }).success);
check('EarlyAccessReq rejects useCase not in enum',
  !EarlyAccessReq.safeParse({ email: 'me@x.com', agreed: true, useCase: 'robot' }).success);
check('EarlyAccessRes accepts { ok: true }',
  EarlyAccessRes.safeParse({ ok: true }).success);
check('ManifestRes accepts full payload',
  ManifestRes.safeParse({
    name: 'swr', version: '2026.10.13.1', knownFiles: ['a.js'],
    serverTime: '2026-10-13T12:00:00.000Z', build: 'abc1234',
  }).success);

// Presets contracts
const { Preset, PresetsRes, PresetsQuery } =
  await import('../api/_lib/contract/presets.mjs');

check('Preset accepts full entry',
  Preset.safeParse({
    id: 'aura', name: 'Aura', family: 'AMBIENT', desc: 'x', tags: ['a'],
    tier: 'free', updatedAt: '2026-10-12T12:00:00.000Z',
  }).success);
check('Preset defaults tier to free', Preset.parse({ id: 'x', name: 'X', family: 'A' }).tier === 'free');
check('Preset rejects unknown tier enum',
  !Preset.safeParse({ id: 'x', name: 'X', family: 'A', tier: 'platinum' }).success);
check('PresetsRes accepts { ok, families, presets }',
  PresetsRes.safeParse({ ok: true, families: ['AMBIENT'], presets: [] }).success);
check('PresetsQuery accepts empty object',
  PresetsQuery.safeParse({}).success);
check('PresetsQuery accepts { family }',
  PresetsQuery.safeParse({ family: 'AMBIENT' }).success);

console.log('');
if (failed) {
  console.log(`FAIL — ${failed} contract check(s) failed`);
  process.exit(1);
} else {
  console.log('PASS — all API contract schemas load and round-trip valid examples');
  process.exit(0);
}
