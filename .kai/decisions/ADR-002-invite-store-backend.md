# ADR-002: Back the invite-code store with the app's own Postgres/FS JSON store

**Status:** Accepted (implemented 2026-10-08)
**Decider:** user (Kai)

## Context

Invite codes gate the watermark-free rec/export flow (`/api/invite/redeem`),
and `data/invite-codes.csv` holds the launch batch. A code is meant to be
redeemed months after it is issued, so the store has to outlive the thing it
runs on. It has now been retired out from under the codebase twice:

| Era | Backend | How it ended |
|---|---|---|
| v1 | `@vercel/kv` + `KV_REST_API_*` | Vercel KV was sunset Dec 2024. |
| v2 | `@upstash/redis` + `UPSTASH_REDIS_REST_*` | The Upstash database an agent provisioned was deleted **2026-10-11** unless an account claimed it. |

The v2 deadline forced the decision. Every account path was blocked for an
automated agent: the Vercel dashboard is login-gated, Neon's API rejected the
supplied credentials, Upstash's email verification code never arrived, and
both Google and GitHub OAuth rejected the automated browser. A store whose
dignity depends on a human completing an OAuth flow is not a store — it is a
ticking clock.

## Decision

Store invite codes in the JSON store `api/_lib/db.js` already provides
(`readJson` / `writeJson`, now plus `deleteJson`), i.e.:

- `DATABASE_URL` resolving to a `postgres://` URL → the **`kv` table** in
  Postgres. This is what production and preview run; confirmed live with
  `curl /api/manifest?action=health` → `"store":"postgres"`.
- otherwise → JSON files under `SWRC_DATA_DIR` (`./data` locally).

`api/_lib/kv.js` keeps its exported API byte-for-byte (`kvGet`/`kvSet`/`kvDel`,
`normalizeCode`, `readInvite`/`writeInvite`/`deleteInvite`,
`readEmailIndex`/`writeEmailIndex`, `_resetSchemaCache`), so
`api/invite/{redeem,register}.js` and `scripts/grant-invite.mjs` did not need
to change shape — only the backend behind them.

Keys map to paths under `<ROOT>/invite-store/`, each segment
`encodeURIComponent`-encoded so the mapping is reversible and can never
contain a separator:

```
invite:<CODE>        → invite-store/codes/<CODE>.json
invite:email:<addr>  → invite-store/emails/<addr>.json
schemaVersion:invite → invite-store/schema.json
```

## Alternatives considered

**Vercel Blob (`access: 'private'`, optimistic `ifMatch`).** Serious
runner-up: native to the project, never expires, two stores already
configured, zero new accounts. Rejected as a *second* durable store for data
that already has one — it would have meant new credential plumbing
(`db.js`'s `BLOB_OPTS` is unexported), a private-blob read path, and a
read-modify-write concurrency story, all to duplicate a table that already
holds users, sessions, projects and the slot ledger. It remains the right
answer if Postgres is ever dropped.

**Neon / Supabase / a new Postgres.** A brand-new vendor whose free tier
could not be provisioned without a human login — the exact failure mode this
decision exists to escape.

**Claiming the existing Upstash database.** Requires a human at
`upstash.com/start-redis/console/8e60c9e7-…`. Abandoned: the store below
needs no claim, so the claim is no longer load-bearing.

## Consequences

- **Nothing new to renew.** Invite codes are now exactly as durable as
  signing in is — the same rows, same table, same mutex-free single-statement
  writes as every other record in the app.
- **No invite-specific env vars.** `UPSTASH_REDIS_REST_*` and the leftover
  `KV_REST_API_*` / `@vercel/kv` / `@upstash/redis` deps are dead and removed.
- **A latent trap, closed deliberately.** The PG pool is `max: 1`, so a nested
  `withLock()` deadlocks against the connection it already holds. `kv.js`
  therefore takes **no** lock: a single key write is already atomic on both
  backends (one upsert on Postgres, tmp+rename on the filesystem). The
  comment on `db.js`'s export block states this so a future caller cannot
  discover it the hard way.
- **Runtime state stays out of the deploy.** `data/invite-store/` is
  gitignored (the CSV is the source of truth) and skipped by
  `copyDirRecursive`, because its email index can hold real addresses.
- **The store had zero server-side coverage.** The client suites stub
  `fetch`, so a backend swap could previously have shipped untested. Added
  `scripts/check-invite-api-smoke.mjs` (15 assertions over the real
  handlers), in the `check` gate, and it runs against **either** backend —
  `DATABASE_URL` set, it exercises the Postgres path production uses.
  Verified green on both, plus `check:db-postgres-unit` against a throwaway
  Postgres 16 container.
