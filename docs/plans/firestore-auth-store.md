# Firestore as the auth store

**Status:** implemented (opt-in) — 2026-10-24
**Scope:** `SWR_AUTH_STORE=firestore` moves the auth store out of
`api/_lib/db.js`'s own files and into Firestore.

## Problem

Every route in `api/` reaches the auth store through `api/_lib/db.js`.
That module is a JSON-file store in dev and a Postgres store when
`DATABASE_URL` is set. On Vercel without Postgres the JSON store is
ephemeral: a cold start wipes the users, the sessions and the
verification tokens, and every signed-in user is signed out.

The alternative the repo already had was a dormant Firestore path for
the Stripe Connect pilot (`SWR_CONNECT_STORE=firestore`). The same
problem — auth state that must outlive a cold start, without adding a
Postgres bill — has the same answer.

## Solution

`api/_lib/auth-firestore.js` implements the auth store over Firestore:
users, provider links, sessions, verification tokens and the per-user
connect blob. `api/_lib/db.js` keeps every export name it has; each
auth function begins with a dispatch:

```js
const store = authStore();
if (store) return store.<fn>(<args>);
```

`authStore()` returns the Firestore module when
`process.env.SWR_AUTH_STORE === 'firestore'` **and** Firestore is
configured; otherwise `null` and the local body runs. The switch is
evaluated per call, so the same process serves both backends depending
on the env.

### Why dispatch-at-the-top rather than re-exporting

`db.js`'s auth functions call each other: `createUser` calls
`findUserByEmail` and `updateUser`; `setMembershipTier` calls
`updateUser`; `saveConnectAccount` calls `getConnectAccount` and
`updateUser`. If the dispatch re-pointed those calls at the Firestore
store, a local write would read from Firestore mid-flight. Keeping the
local body untouched means the local implementation's internal calls
stay local, and the Firestore store has its own internals and is never
re-entered through `db.js`.

### Collections

| Collection | Doc id | Contents |
|---|---|---|
| `users` | user id | the user record |
| `user_emails` | `hash(email)` | the email uniqueness index |
| `accounts` | `hash(provider:providerAccountId)` | the provider-link uniqueness index |
| `sessions` | the session token | the session record |
| `verifications` | `hash(identifier:token)` | the magic-link token record |
| `user_connect_accounts` | user id | the per-user Stripe connect blob |

Firestore has no unique constraint on a field, so email and
provider-link uniqueness are enforced by *creating* a document whose id
is derived from the value. A `create()` that loses the race fails with
`ALREADY_EXISTS` (code 6), which is the only atomic test-and-set
available. The document ids are sha256 hashes, so an email address
never becomes a document path.

### The connect blob lives in its own collection

The Connect pilot (`api/_lib/connect-store.js`) has its own Firestore
path with a collection called `connect_accounts`. The auth store's
connect blob is a different record — it is the db.js-shaped blob the
auth functions read and write. Two writers sharing one collection name
with two shapes is a data-loss bug waiting for the day both switches
are on, so the auth store writes `user_connect_accounts`.

Which of the two serves the routes depends on the switches, and they
never cross:

- `SWR_CONNECT_STORE=firestore` → `connect-store.js` owns connect data
  (`connect_accounts`) and never calls `db.js` for it.
- otherwise, with `SWR_AUTH_STORE=firestore` → `db.js` dispatches to
  the auth store, and the blob lives in `user_connect_accounts`.

So a deploy has exactly one collection holding connect data.

## What this contradicts

**AGENTS.md's "Local-first" section says the running surface should
answer from local sources and that the external API should only be
reached for what the engine cannot answer locally.** A Firestore auth
store is exactly an external dependency for the auth surface.

That section's table is not wrong about the *intent* — it is about not
paying for a cloud provider to do what a local file can do — but the
auth store is the one surface where "local" means "ephemeral on
Vercel". A guest session that dies at the next cold start is not a
local-first implementation; it is a broken one.

The resolution taken here:

- **The switch is OFF by default.** Nothing changes for a local dev
  box, and the local store remains the default in every environment
  until an operator sets `SWR_AUTH_STORE=firestore`.
- **The Firebase Anonymous Auth sign-in is separate from the store.**
  The client can exchange a Firebase ID token for a `swrc_session`
  cookie against the *local* store just as well as against Firestore.
  The two features are independent: one changes how a user proves who
  they are, the other changes where the record lives.
- **The Postgres path is untouched.** `DATABASE_URL` still wins for
  anyone who wants a hosted relational store without Firebase.

If the owner decides the local-first rule is absolute, the honest
resolution is to drop the Firestore auth store and keep only the
Firebase Anonymous Auth sign-in. The dispatch in `db.js` and the
`SWR_AUTH_STORE` switch would then be dead code and should be removed
rather than left dormant.

## Verification

- `scripts/check-auth-firestore-unit.mjs` — the store's behaviour over
  an in-memory Firestore (create/find/update, email and provider-link
  uniqueness, session expiry, consume-once verification tokens, the
  connect blob, the counts). Four deliberate-mutation self-tests prove
  the suite is load-bearing.
- `scripts/check-auth-store-dispatch-unit.mjs` — proves `db.js`
  actually delegates when the switch is on and does not when it is off,
  with no live Firestore: the data lands in the fake Firestore and not
  in the local JSON files.
- `scripts/check-auth-firebase-anon-unit.mjs` — the real route over a
  real HTTP server, with the Firebase Auth emulator simulated by a
  `node:http` stub (no JVM, so the Firestore emulator cannot run).
- `scripts/check-firebase-anon-client-unit.mjs` — the shipped client
  module in a `node:vm` sandbox.

## Rejected alternatives

- **A new `api/` route for the web config.** Vercel's Hobby plan caps
  a deployment at 12 serverless functions and the repo is already
  close, so the public Firebase config is served as
  `GET /api/auth/firebase-anon?action=config` on the existing route.
- **Minting Firebase session cookies.** The `swrc_session` cookie
  model stays the single source of truth; the Firebase ID token is an
  identity assertion at exchange time, not a second session.
- **A second id/token module.** `uuid()`, `shortToken()` and
  `hashKey()` live in `api/_lib/ids.js` and are re-exported by
  `db.js`, so the Firestore store can use them without importing
  `db.js` (which would be an import cycle).
- **A live Firestore integration test.** There is no JVM on this
  machine, so the Firestore emulator cannot run. The gates use an
  in-memory fake that is faithful about the two error codes the store
  depends on (`ALREADY_EXISTS`, `NOT_FOUND`).
