// scripts/api-mock-defaults.js — default route registry for the mock
// server (script./api-mock.mjs). Each route is registered with the
// matching Zod contract from api/_lib/contract/, a canned success
// payload, and the canonical HTTP status. Tests can `import './api-mock-defaults.js'`
// (auto-runs on import) or call `registerDefaults()` explicitly to
// pick the order of side effects.
//
// Stage 3 of the easy-testing & integration API plan. The goal is
// every route the real handlers expose is mockable with the same
// shape, so client SDK tests can hit a fresh mock without port
// collisions or Postgres fixtures.
//
// What's mocked:
//   - Auth family: /api/auth/magic, /api/auth/verify, /api/auth/session,
//     /api/auth/google (OAuth callback shape)
//   - Public family: /api/early-access, /api/manifest
//   - PT family: /api/pt/verify, /api/admin/pt/keys/import
//   - Presets family: /api/presets (the persona-preset catalogue)
//   - Projects family: /api/projects (the engine's saved-state CRUD)
//
// What's NOT mocked (out of scope for stage 3):
//   - Stripe webhook (needs real signature verification)
//   - Storage signed URLs (depends on Vercel Blob credentials)
//   - Drive integration (third-party OAuth)
//   - Slots + booking endpoints (require Postgres fixtures)

import { apiMock } from './api-mock.mjs';
import {
  MagicReq, MagicRes,
  VerifyReq as AuthVerifyReq, VerifyRes as AuthVerifyRes,
  SessionRes, GoogleRes,
  FirebaseAnonReq, FirebaseAnonRes, FirebaseConfigRes,
} from '../api/_lib/contract/auth.mjs';
import { EarlyAccessReq, EarlyAccessRes, ManifestRes } from '../api/_lib/contract/_public.mjs';
import {
  VerifyReq as PtVerifyReq, VerifyRes as PtVerifyRes,
  ImportReq, ImportRes,
} from '../api/_lib/contract/pt.mjs';
import {
  ProjectReq, ProjectPatchReq, Project,
  ProjectListRes, ProjectRes, ShareReq, ShareRes,
} from '../api/_lib/contract/projects.mjs';
import { Preset, PresetsRes, PresetsQuery } from '../api/_lib/contract/presets.mjs';

// ---- Canned responses ----
// Each is the minimal payload that satisfies the response contract's
// success path. Tests can override at call time via
// apiMock.handle({ override: { canned: {...} } }) without re-registering.

const CANNED = {
  manifest: {
    name: 'swr',
    version: 'mock-2026.10.13.1',
    knownFiles: ['engine.html', 'client/variant-switcher.client.js'],
    serverTime: '2026-10-13T12:00:00.000Z',
    build: 'mock-build',
  },
  authMagicOk: { ok: true },
  authVerifyOk: { ok: true, session: 'mock-session-token' },
  authSessionOk: {
    ok: true,
    user: {
      id: '11111111-2222-3333-4444-555555555555',
      email: 'mock@example.com',
      name: 'Mock User',
      tier: 'free',
    },
    swr: 'mock-session-token',
  },
  authSessionSignedOut: { ok: false },
  googleCallbackOk: { ok: true },
  firebaseAnonOk: {
    ok: true,
    user: {
      id: '11111111-2222-3333-4444-555555555555',
      name: 'Guest',
      email: 'anon-mock@guest.swr.local',
      anonymous: true,
    },
  },
  firebaseConfigOk: {
    ok: true,
    config: {
      apiKey: 'mock-api-key',
      authDomain: 'mock-project.firebaseapp.com',
      projectId: 'mock-project',
      appId: '1:2:web:mock',
    },
  },
  earlyAccessOk: { ok: true, queued: 1 },
  ptVerifyInvalid: { ok: true, valid: false, error: 'key not found' },
  ptVerifyValid: {
    ok: true, valid: true, tier: 'band', tierName: 'PT Band',
    slots: 30, slotsRemaining: 28,
    grantedAt: '2026-10-01T00:00:00.000Z',
    sessionId: 'cs_mock_test_1',
  },
  ptImportOk: { ok: true, imported: 2, skipped: 0 },
  presetsList: {
    ok: true,
    families: ['AMBIENT', 'RAW', 'CLASSICAL', 'ELECTRONIC'],
    presets: [
      {
        id: 'aura', name: 'Aura', family: 'AMBIENT',
        desc: 'Soft drifting pad with stem-tinted filter', tags: ['pad', 'soft'],
        tier: 'free', updatedAt: '2026-10-13T12:00:00.000Z',
      },
      {
        id: 'static', name: 'Static', family: 'RAW',
        desc: 'Hard-edged static noise with no modulation', tags: ['noise', 'raw'],
        tier: 'free', updatedAt: '2026-10-13T12:00:00.000Z',
      },
    ],
  },
  projectList: {
    ok: true,
    projects: [
      {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        name: 'Demo project',
        notes: 'created by mock',
        presetId: 'aura',
        ownerId: '11111111-2222-3333-4444-555555555555',
        createdAt: '2026-10-13T12:00:00.000Z',
        updatedAt: '2026-10-13T13:00:00.000Z',
      },
    ],
  },
  projectCreate: {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: 'Mock project',
    notes: 'created by mock',
    presetId: 'aura',
    ownerId: '11111111-2222-3333-4444-555555555555',
    createdAt: '2026-10-13T12:00:00.000Z',
    updatedAt: '2026-10-13T12:00:00.000Z',
  },
  projectShare: {
    ok: true,
    url: 'https://example.com/s/mock-share-token',
    token: 'mock-share-token',
    expiresAt: '2026-10-14T12:00:00.000Z',
  },
};

let _registered = false;

function registerDefaults() {
  // Allow re-registration after `apiMock.clear()` (the in-process
  // test pattern). The guard would otherwise turn the second call
  // into a silent no-op, leaving the registry empty.
  _registered = true;

  // ---- Public endpoints ----
  apiMock.register({
    method: 'POST', path: '/api/early-access',
    reqSchema: EarlyAccessReq, resSchema: EarlyAccessRes,
    canned: CANNED.earlyAccessOk, status: 200,
  });
  apiMock.register({
    method: 'GET', path: '/api/manifest',
    resSchema: ManifestRes,
    canned: CANNED.manifest, status: 200,
  });

  // ---- Auth family ----
  apiMock.register({
    method: 'POST', path: '/api/auth/magic',
    reqSchema: MagicReq, resSchema: MagicRes,
    canned: CANNED.authMagicOk, status: 200,
  });
  // GET /api/auth/verify?token=…&email=…  (legacy form, see contract)
  apiMock.register({
    method: 'GET', path: '/api/auth/verify',
    reqSchema: AuthVerifyReq, resSchema: AuthVerifyRes,
    canned: CANNED.authVerifyOk, status: 200,
  });
  apiMock.register({
    method: 'GET', path: '/api/auth/session',
    resSchema: SessionRes,
    canned: CANNED.authSessionOk, status: 200,
  });
  // POST /api/auth/google — body { code, state } from the OAuth provider.
  apiMock.register({
    method: 'POST', path: '/api/auth/google',
    resSchema: GoogleRes,
    canned: CANNED.googleCallbackOk, status: 200,
  });
  // POST /api/auth/firebase-anon — body { idToken } exchanged for a session.
  apiMock.register({
    method: 'POST', path: '/api/auth/firebase-anon',
    reqSchema: FirebaseAnonReq, resSchema: FirebaseAnonRes,
    canned: CANNED.firebaseAnonOk, status: 200,
  });
  // GET /api/auth/firebase-anon?action=config — the public web config.
  apiMock.register({
    method: 'GET', path: '/api/auth/firebase-anon',
    resSchema: FirebaseConfigRes,
    canned: CANNED.firebaseConfigOk, status: 200,
  });

  // ---- PT family ----
  apiMock.register({
    method: 'GET', path: '/api/pt/verify',
    reqSchema: PtVerifyReq, resSchema: PtVerifyRes,
    canned: CANNED.ptVerifyInvalid, status: 200,
  });
  apiMock.register({
    method: 'POST', path: '/api/admin/pt/keys/import',
    reqSchema: ImportReq, resSchema: ImportRes,
    canned: CANNED.ptImportOk, status: 200,
  });

  // ---- Presets family ----
  apiMock.register({
    method: 'GET', path: '/api/presets',
    reqSchema: PresetsQuery, resSchema: PresetsRes,
    canned: CANNED.presetsList, status: 200,
  });

  // ---- Projects family ----
  apiMock.register({
    method: 'GET', path: '/api/projects',
    resSchema: ProjectListRes,
    canned: CANNED.projectList, status: 200,
  });
  apiMock.register({
    method: 'POST', path: '/api/projects',
    reqSchema: ProjectReq, resSchema: ProjectRes,
    canned: CANNED.projectCreate, status: 201,
  });
  // GET /api/projects/[id] — path param, matched literally.
  apiMock.register({
    method: 'GET', path: '/api/projects/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    resSchema: Project,
    canned: CANNED.projectCreate, status: 200,
  });
  // PATCH /api/projects/[id]
  apiMock.register({
    method: 'PATCH', path: '/api/projects/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    reqSchema: ProjectPatchReq, resSchema: ProjectRes,
    canned: CANNED.projectCreate, status: 200,
  });
  // POST /api/projects/[id]/share
  apiMock.register({
    method: 'POST', path: '/api/projects/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/share',
    reqSchema: ShareReq, resSchema: ShareRes,
    canned: CANNED.projectShare, status: 200,
  });
}

export { registerDefaults, CANNED };

// Auto-register on import. Tests that want a clean registry should
// call `apiMock.clear()` first or use `registerDefaults()` explicitly.
registerDefaults();