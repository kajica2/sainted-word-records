# Invite codes → unlock the export watermark

## What it does

Operators issue short codes (`XXXXX-XXXXX-XXXXX`) that, when a visitor
enters one, suppress the forced-rec watermark (`lib/watermark.client.js`)
for that visitor's exports — forever per browser, until they clear
localStorage.

Codes are **admin-issued, first-come/first-served, reusable** — same
code unlocks the watermark for anyone who enters it. There is no
per-user ledger, no single-use, no email-based self-service. The unlock
is purely a license, not a token.

## What it doesn't do

- Doesn't remove the on-screen preview watermark (only exports are
  affected).
- Doesn't affect the per-project `branding.wordmark` painted on
  share-view.html — that's project-level branding, not the forced-rec
  mark.
- Doesn't unlock server-side watermarks (there are none).
- Doesn't sync across browsers — each browser holds its own
  `swr.inviteUnlocked` localStorage flag.

## Architecture

```
   visitor → engine.html / share-view.html
              │
              │  withInviteGate(() => rec/export action)
              │    │
              │    └── if !unlocked: pop modal
              │       └── on unlock:  POST /api/invite/redeem
              │       │     │
              │       │     └── reads invite:<CODE> from the invite store
              │       │            │
              │       │            └── { ok: true } | 404
              │       │
              │       └── on success: localStorage.setItem('swr.inviteUnlocked','1')
              │                        window.SWR_WATERMARK.setEnabled(false)
              │       └── on skip:    close modal, run action with watermark still on
              │
              └── lib/watermark.client.js → setEnabled(false) makes drawMark a no-op
                                             (compositor stays alive, toggle is instant)
```

## Env

Invite codes live in the app's own durable store (`api/_lib/kv.js`,
the same backend-transparent JSON layer that holds auth, sessions,
projects and the slot ledger):

- `DATABASE_URL` set → **Postgres**, the `kv` table. This is what
  production and preview run; confirm it with one GET:
  `curl /api/manifest?action=health` → `"store":"postgres"`.
- otherwise → JSON files under `SWRC_DATA_DIR` (`./data` locally;
  `/tmp` on Vercel, which is per-instance and dies with it — never the
  production path).

No invite-specific env vars, and nothing to claim or renew before it
expires. The endpoint returns `503 { error: "invite_store_unavailable" }`
when the store itself is unreachable — kept distinct from the `404`
that means "no such code", so an outage and a bad code never look the
same in the logs.

## Admin: issuing / revoking codes

```bash
# Generate a random code (XXXXX-XXXXX-XXXXX, no 0/O/1/I for copy-paste safety)
node scripts/grant-invite.mjs create

# Issue a specific code (e.g. for a launch recipient)
node scripts/grant-invite.mjs create --code ABCDE-FGHJK-LMNOP --label "alice launch"

# Revoke / re-enable
node scripts/grant-invite.mjs disable ABCDE-FGHJK-LMNOP
node scripts/grant-invite.mjs enable  ABCDE-FGHJK-LMNOP

# Inspect
node scripts/grant-invite.mjs inspect ABCDE-FGHJK-LMNOP

# Delete entirely
node scripts/grant-invite.mjs delete ABCDE-FGHJK-LMNOP
```

To point the CLI at the production store rather than local files, run
`vercel env pull .env` first so `DATABASE_URL` resolves. Batch
registration from `data/invite-codes.csv` does not use this CLI: it
goes through the deployed `/api/invite/register` endpoint, driven by
`.github/workflows/invite-codes.yml`, which registers every code and
then reads each one back through `/api/invite/redeem` to prove it
persisted.

Stored shape:

```
invite:<CODE>     JSON  { enabled: true, createdAt: ISO, label: string|null }
schemaVersion:invite     "1"
```

## Public contract

### `POST /api/invite/redeem`

```json
{ "code": "ABCDE-FGHJK-LMNOP" }
```

Responses:

- `200 { ok: true }`  — code is enabled, visitor can flip the flag.
- `400 { error: "invalid_code" }`  — bad shape.
- `404 { error: "invalid_or_disabled_code" }`  — not found or disabled.
- `429 { error: "rate_limited" }`  — 30/min/IP, returns `Retry-After`.
- `503 { error: "invite_store_unavailable" }`  — KV env vars missing.

### `window.SWR_WATERMARK.setEnabled(bool)` / `isEnabled()`

The watermark module exposes a runtime toggle. Default `enabled = true`.
Compositor stays alive; the toggle makes `drawMark()` a no-op, so
re-enabling is instant.

### `window.SWR_INVITE_UNLOCK.{isUnlocked, unlock, revoke, applyToCurrentPage}`

```js
// Check the visitor's flag (source of truth: localStorage 'swr.inviteUnlocked')
SWR_INVITE_UNLOCK.isUnlocked() -> boolean

// Redeem a code against /api/invite/redeem, flip the flag and the
// watermark on success, return whether it worked.
SWR_INVITE_UNLOCK.unlock('ABCDE-FGHJK-LMNOP') -> Promise<boolean>

// Visitor-initiated: clear the flag and re-enable the watermark.
SWR_INVITE_UNLOCK.revoke() -> void

// Re-apply the current flag to SWR_WATERMARK (call after a programmatic
// setItem on the flag). Called automatically at module load.
SWR_INVITE_UNLOCK.applyToCurrentPage() -> void
```

### `window.SWR_INVITE_MODAL.{show, hide}`

```js
// Pop the modal (lazily mounted on first call). Dispatches
// 'swr-invite-unlocked' (with detail: { code }) or 'swr-invite-skipped'
// on document.
SWR_INVITE_MODAL.show({ code?: string }) -> void
SWR_INVITE_MODAL.hide() -> void
```

## Local development

With no `DATABASE_URL` in the environment, `scripts/grant-invite.mjs`
and the API fall back to `./data/invite-store/*.json` — zero setup,
and the files are gitignored (the CSV is the source of truth).

`api/invite/redeem.js` returns 503 when the store is unreachable, so
the modal shows "Code not recognized." and the visitor can still record
with the watermark — no degraded-but-broken state.

The unit + smoke tests stub `fetch` for `POST /api/invite/redeem` and
do not need a real store to pass.

## Files touched

| Path | What |
|---|---|
| `package.json` | no invite-specific dep — the store reuses `pg` + Node built-ins |
| `api/_lib/kv.js` | invite store: key shape, code shape, path mapping |
| `api/invite/redeem.js` | POST endpoint, rate-limited, 503 when the store is down |
| `lib/watermark.client.js` | adds `setEnabled(bool)` / `isEnabled()` |
| `lib/invite-unlock.client.js` | owns the flag + watermark toggle |
| `lib/invite-modal.client.js` | the modal |
| `engine.html` | loads the two new modules + wraps `#rec` / `#export-video` clicks in `withInviteGate(...)` |
| `share-view.html` | loads the two new modules (so the flag hydrates on any page) |
| `scripts/grant-invite.mjs` | admin CLI |
| `scripts/check-invite-unlock-unit.mjs` | unit gate |
| `scripts/check-invite-redemption-smoke.mjs` | Puppeteer smoke |

## Verifying

```bash
npm run check:invite-unlock-unit        # 7 assertions, node:vm
npm run check:invite-redemption-smoke   # 28 assertions, Puppeteer
npm run check                           # the unit is in this group
npm run check:full                      # the smoke is in this group
```

## Known limits / future work

- **No self-service issuance.** Codes are admin-only. Adding email-based
  self-issue would reuse `api/_lib/email.js` and a new `api/invite/issue.js`.
- **No audit log.** Who redeemed what, when. Trivial to add via a
  second KV key written on each `POST /api/invite/redeem`.
- **No per-code usage counter.** A code with `enabled: true` is reusable.
  Flipping that to "N redemptions then disabled" is a one-line check.
- **No cross-key transaction.** Each key write is atomic (one upsert /
  one atomic rename), but a read-modify-write spanning two keys — the
  batch CLI's "look up the email index, then mint" — is not. Harmless
  at admin-invite volume: two writers never race on the same code.

## Migration / deprecation notes

The store has moved twice, both times because the platform retired the
thing underneath it:

| Era | Backend | Why it ended |
|---|---|---|
| v1 | `@vercel/kv` + `KV_REST_API_*` | Vercel KV was sunset Dec 2024; stores migrated to Upstash. |
| v2 | `@upstash/redis` + `UPSTASH_REDIS_REST_*` | An agent-provisioned Upstash database is deleted in days unless an account claims it, and claiming needs a human login. Not a durable home for codes people redeem months later. |
| v3 | `db.js` JSON store → Postgres (`kv` table) | Nothing to claim, no second vendor, no invite-specific env vars. It is the same store that already holds users, sessions and projects — so it is as durable as signing in is. |

Evidence that v3 is live: `curl /api/manifest?action=health` reports
`"store":"postgres"`. If that ever says `"filesystem"`, `DATABASE_URL`
is missing and invite codes will not survive a cold start.

Both `@vercel/kv` and `@upstash/redis` were removed from `package.json`;
`api/_lib/kv.js` now imports only `api/_lib/db.js`.
