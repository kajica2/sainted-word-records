# Plan: Easy-Testing & Integration API

## 0. The ask

Make the API surface **easy to test against** (by us, by sister repos, by
external integrations) and **easy to integrate** (so the engine,
the marketing pages, the sister "sainted-word" subdomains, and
third-party scripts can all call the API without re-implementing
the auth flow, error mapping, or shape conventions).

The current state is good but uneven:

- **In-process unit tests** (`scripts/test-api.mjs`) call handlers
  directly. Fast, but they bypass the HTTP layer — auth middleware,
  CORS preflight, JSON shape contracts, status codes are not
  exercised.
- **HTTP-level unit tests** (`scripts/check-auth-unit.mjs`,
  `scripts/check-email-relay-smoke.mjs`) use `fetch` against a
  booted dev server. Slow (~10s per boot) and depend on the dev
  middleware being correctly wired.
- **Puppeteer E2E** (`verify-*.mjs`) covers user-flow integration.
  Heavy (~30-60s per test) and slow CI.
- **The contract itself** is invisible: there's no OpenAPI / Swagger
  spec, no JSON Schema, no client SDK. The engine's `swr-app.html`
  hand-rolls `fetch('api/projects/...')` calls; an external
  integration would have to do the same against a spec that lives
  only in the route handlers' source.

## 1. The four things that need to exist

### 1.1 A documented request/response contract

A single source of truth that says "this endpoint accepts X,
returns Y, fails with Z." Two options:

- **Option A — OpenAPI 3.1 spec (`openapi.yaml`).** Industry standard,
  consumable by Postman / Insomnia / any client-generator. CI can
  validate handlers against it. ~500 lines of YAML for our surface.
- **Option B — Zod schema files (`api/_lib/contract/*.mjs`).** Native
  to Node, can be `import`-ed directly by handlers, by tests, and
  by the client SDK. Smaller surface, fewer features, but
  idiomatic to this codebase (already a Node-only repo).

The recommended path is **B (Zod)** as the source of truth, **A
(OpenAPI) generated FROM the Zod**. A small `scripts/generate-api-spec.mjs`
reads every `api/_lib/contract/*.mjs`, runs them through
`zod-to-openapi` (lightweight, 1 dep), and emits `docs/api-spec.yaml`.
That gives us:
- One source of truth (Zod) that's `import`-ed by handlers.
- A derived spec file for external tools.
- A schema-test in CI that walks every endpoint and asserts
  handler input and output match the schema.

### 1.2 A mock API server for local development

The dev server (`scripts/dev-api.mjs`) wires 27 routes by hand. New
routes take a code change there. A mock server that reads the
same Zod contract and serves pre-canned responses would let:
- `swr-app.html` develop against a stable contract before the
  handler ships.
- Marketing pages script against a fake API without Vercel.
- Sister subdomains (`sainted-word.test` is in the existing test
  infra) get a stable local target.

A mock server is small: ~150 lines of `node:http` that reads
`api/_lib/contract/*.mjs`, instantiates a `Map<route, handler>`,
and returns canned responses for each route. It can run
in-process in tests (no boot, no port) or as a sidecar
(`node scripts/api-mock.js --port=5175`).

The trick: share the *handler function* with the real handler. The
mock server imports the real `api/early-access.js`, wraps it with
a fake `req`/`res` if a unit test asks, and serves the response
verbatim. That makes the mock not a copy of the handler — it's
the same code.

### 1.3 An HTTP-level test harness

Replace some `check-*-unit.mjs` with a single helper that does
the wire-level work:

```
import { api } from './api-client.mjs';

await api('auth/magic', { method: 'POST', body: { email } })
  .expect(200)
  .expectJson('ok', true)
  .expectHeader('set-cookie', /swrc_session/);
```

The helper:
- Boots the handler in-process (or hits a booted dev server
  with `--live`).
- Encodes the request (querystring, body) and decodes the response
  (cookies, status, JSON, content-type).
- Throws on the first expectation failure with a clear diff
  ("expected 200, got 401; body: ...").
- Chains. So you write one test, get one failure or one pass.

This is ~80 lines on top of `fetch` (or `node:http`'s
`request`). It does NOT replace the in-process unit tests (those
are still useful for fast iteration); it augments them with the
shape and middleware coverage the in-process tests miss.

### 1.4 A tiny client SDK

A single `api-client.mjs` (browser + Node compatible, ~100 lines
for the routes that ship today) that wraps `fetch` and exposes:

```js
import { createClient } from './api-client.mjs';
const swr = createClient({ base: '/api' });

// Auth
const { token } = await swr.auth.magic({ email: 'me@x.com' });
await swr.auth.verify({ token });

// Projects
const list = await swr.projects.list();
const p = await swr.projects.create({ name: 'demo' });

// Variants (the new family)
const ok = await swr.pt.verify({ key: 'swr-band-A2B3C4D5' });
```

Why a hand-rolled SDK instead of `openapi-typescript`-generated:
- Our surface is 27 routes. The auto-gen tool has setup cost; the
  manual SDK is 100 lines and grows at the rate the API does.
- The SDK is also a documentation artifact — it shows the way
  the engine / sister repos should call the API. The shape of
  the wrapper is itself a teaching tool.
- When a handler's contract changes, the SDK test fails (because
  the test runs the handler and asserts the response shape). The
  SDK is updated as part of the PR.

The SDK lives at `api/_lib/client.mjs` (browser + Node) and gets
re-exported from the root via a small barrel file. Marketing
pages and the engine can `<script type="module" src="/api/_lib/client.mjs">`
or `import { createClient } from '/api/_lib/client.mjs'`.

## 2. Components

```
                ┌───────────────────────────────────────────────┐
                │  api/_lib/contract/*.mjs                      │
                │    auth: z.object({ email: z.string()...})    │
                │    projects: z.object({ name: z.string()...}) │
                │    pt: z.object({ key: z.string()...})        │
                │    etc.                                        │
                └──┬──────────────┬──────────────┬─────────────┘
                   │              │              │
                   │              │              │
   ┌───────────────┘              │              └────────────────┐
   │                              │                               │
   ▼                              ▼                               ▼
┌─────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  Handlers       │  │  scripts/             │  │  api/_lib/           │
│  (api/*/*.js)   │  │  generate-api-spec.mjs│  │  client.mjs          │
│  parse req body │  │  reads the Zod files, │  │  (browser + Node)    │
│  call store,    │  │  emits docs/api-spec. │  │  wraps fetch,        │
│  write response │  │  yaml + a smoke that  │  │  returns typed       │
│                 │  │  re-validates every   │  │  promises, surfaces  │
│                 │  │  route.               │  │  cookies, etc.       │
└─────────────────┘  └─────────────────────┘  └─────────────────────┘
```

### 2.1 The contract files

Lives at `api/_lib/contract/`. One file per family:

```js
// api/_lib/contract/auth.mjs
import { z } from 'zod';

export const MagicReq = z.object({
  email: z.string().email(),
});
export const MagicRes = z.object({
  ok: z.literal(true),
  sent: z.boolean(),
});

export const SessionRes = z.object({
  user: z.object({ id: z.string(), email: z.string() }),
  swr: z.unknown().optional(), // opaque token
});

// etc.
```

Handlers `import` their contract. Tests `import` the same contract
and run it through Zod to assert the response.

### 2.2 The OpenAPI generator

`scripts/generate-api-spec.mjs`:

- Imports every `*.mjs` in `api/_lib/contract/`.
- For each family, builds a `zod-to-openapi` registry.
- Emits `docs/api-spec.yaml` (or `api-spec.json` for tooling).
- Runs a smoke that imports the real handler, dispatches a fake
  request, parses the response with the contract, and reports any
  drift.

### 2.3 The mock server

`scripts/api-mock.js`:

- Reads every contract file and registers a route.
- For each route, builds a `Map<route, handler>` from canned JSON.
- Boots `node:http` on a configurable port.
- Tests can `import { apiMock } from './api-mock.js'` and call
  `apiMock.handle({ url: '/api/auth/magic', method: 'POST', body: {...} })`
  without binding a port.

### 2.4 The client SDK

`api/_lib/client.mjs`:

- A factory: `createClient({ base })`.
- Each route is a method. The shape mirrors the contract
  (TypeScript-style typing where possible; in plain JS via JSDoc
  and runtime assertions).
- Cookies are stored in a `Map<name, value>` and attached to
  every request. Use `client.auth.login({ email })` → call returns
  the response and the cookie; use `client.projects.list()` →
  cookie is sent.

## 3. The contract surface

Today the API has these families. Each gets a Zod file:

| Family | Method | Path | Notes |
|---|---|---|---|
| auth/magic | POST | /api/auth/magic | Send magic link |
| auth/verify | GET | /api/auth/verify?token= | Verify token |
| auth/session | GET | /api/auth/session | Current session |
| auth/google | (callback) | /api/auth/google | OAuth flow |
| early-access | POST | /api/early-access | Waitlist |
| projects (list, create, get, update, delete, share) | CRUD | /api/projects, /api/projects/[id] | Project CRUD |
| manifest | GET | /api/manifest | Engine manifest |
| presets (list, search) | GET | /api/presets | Persona presets |
| catalogue (list, get, create) | CRUD | /api/catalogue, /api/catalogue/[id] | Catalogue |
| marketplace | GET | /api/marketplace | Marketplace |
| checkout (start) | POST | /api/checkout | Stripe checkout |
| slots (list, grant) | GET, POST | /api/slots, /api/slots/grant | Video slots |
| pt (verify) | GET | /api/pt/verify | PT key check |
| pt (operator-import) | POST | /api/admin/pt/keys/import | Bulk import |
| drive (import, list, unlink) | POST/GET | /api/drive/* | Drive integration |
| storage (sign-upload, sign-download, object) | GET, POST | /api/storage/* | Blob signed URLs |
| bookings | GET, POST | /api/bookings | Booking CRUD |
| invite (redeem, register) | POST | /api/invite/* | Invite codes |
| webhooks (stripe) | POST | /api/webhooks/stripe | Stripe webhooks |

This is ~20 routes, not 27 — many routes share a contract family.
Roughly 30-50 Zod schemas total, <200 lines of Zod source.

## 4. Why this matters

- **For us:** faster iteration. The test harness catches shape
  drift before CI runs the slow E2E suite. New routes are
  contract-tested in 30 seconds, not 60.
- **For sister repos:** `sainted-word.test` (the staging
  subdomain) and any other sub-project get a stable contract
  with auto-generated client code. The `DIGITAL-TWIN-BRIEF.md`
  mentions "consider CI integration for E2E tests against
  `sainted-word.test`" — that test infra can now consume the
  contract instead of guessing at field names.
- **For external integrations:** the OpenAPI spec is the canonical
  reference. Postman / Insomnia / any client-generator can read it
  and produce a typed client.
- **For the test pyramid:** the unit tests get faster (in-process
  contract is faster than HTTP), the HTTP tests get cheaper
  (mock server is faster than dev middleware), and the E2E tests
  stay at the top.

## 5. Sequence

1. **Pick the contract library.** Zod (Node, small, idiomatic,
   fast) is the choice. `npm install zod`.
2. **Write `api/_lib/contract/{auth,projects,pt,early-access,manifest,presets,slots,...}.mjs`.** 1 day.
3. **Refactor 3 representative handlers to consume their contract.**
   auth/magic, projects/index, pt/verify. The pattern is:
   parse body with `MagicReq.parse(JSON.parse(req.body))`, return
   `sendJson(res, 200, MagicRes.parse(response))`. 1 day.
4. **Write `scripts/api-mock.js`.** Reads the contract, serves canned
   responses. ~150 lines. 1 day.
5. **Write `api/_lib/client.mjs`.** Browser + Node SDK. ~100 lines.
   1 day.
6. **Write `scripts/generate-api-spec.mjs`.** Zod → OpenAPI 3.1. ~100
   lines plus a 50-line smoke. 1 day.
7. **Wire into the test gate.** `check:contract` gate that runs the
   Zod smoke + the OpenAPI generator. 0.5 day.
8. **Migrate the remaining 17 handlers** to consume their contract
   over the next 1-2 weeks. Each handler is a 5-line edit.
9. **Wire `swr-app.html` and marketing pages to use the SDK.**
   The marketing pages' hardcoded fetch calls become
   `swr.projects.list()` etc.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Zod adds a runtime dep to the API | Zod is 14KB, tree-shakeable, zero deps. Worth it. |
| The contract drifts from the handler | The smoke in `check:contract` runs every handler through Zod, so any drift fails CI before merge. |
| The OpenAPI spec drifts from the contract | The generator runs in CI; a generated file's mtime doesn't matter — the smoke tests the contract against the handler, not the spec. |
| The mock server diverges from real handler behavior | The mock is intentionally simple (canned JSON). It tests contract, not behavior. Real behavior is covered by E2E. |
| The SDK is a maintenance burden | The SDK is a thin wrapper over `fetch`. Each route is a 3-line method. Auto-generating from the contract is possible but the manual SDK is small enough that the maintenance cost is low. |

## 7. What's verifiable

- `npm run check:contract` passes (contract → handler roundtrip).
- `docs/api-spec.yaml` is generated and checked in.
- `swr-app.html` boots and can call `swr.projects.list()` against the
  mock server with no Vercel dependency.
- The existing `scripts/test-api.mjs` continues to pass; the new
  harness (`scripts/api-harness.mjs`) is additive.
- The new SDK + mock + contract replace the ad-hoc
  `fetch('api/...')` calls in marketing pages.

## 8. Out of scope

- **Auto-generated TypeScript client** — possible (zod-to-ts + openapi-fetch) but adds deps. The plain JS SDK is good enough for now.
- **GraphQL / tRPC layer** — too much. The JSON-over-HTTP API is fine.
- **A full mocking server in a Docker image** — overkill. The mock is a Node script; CI runs it in-process.

---

This is a plan, not a PR. The user should sign off on the
"contract-as-Zod" choice (vs OpenAPI-first, vs a different
validator) before I start writing Zod files. Once approved, the
implementation is ~6 days of work over 2 weeks, with the
mock + client + generator shipping first (so they exist when
the contract migration begins).
