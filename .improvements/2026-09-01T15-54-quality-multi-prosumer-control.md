# Multi-prosumer control: project-shared live sessions

**Cycle**: 2026-09-01T15-54
**Type**: quality
**Priority**: P1
**Estimated effort**: L

## TL;DR

Add a thin "project sharing" layer that lets an owner grant one or more authenticated users edit access to a specific project, then re-use the existing `visualizer-controller.js` WebSocket bus (already shipped, in-repo) to multiplex per-project live state between those users' tabs. Concretely, the win is "DJ A starts a render; DJ B takes over the deck mid-song without losing the project doc or re-uploading audio" — a real prosumer workflow that already maps onto primitives we have. No new infra: per-project ACL lives next to the project doc in `data/projects/<id>.json`, the WS hub is a single Vercel serverless route added under `api/realtime/`, and the client subscribes through `window.VC` so every existing visualizer gets it for free.

## Why this cycle

The repo already ships three collaboration-shaped primitives; nothing on top of them connects them.

1. **Auth + per-user project storage** — `api/_lib/session.js:19` (`requireUser`) + `api/_lib/db.js:282-343` (`listProjects` filters by `userId === caller`, `getProject` returns null when `p.userId !== userId`). One owner per project; no ACL column exists, but the `doc` blob is a free-form JSON so we can embed `acl` without a schema migration.
2. **Signed per-userId storage URLs** — `api/_lib/db.js:346-360` (storage scoped to `data/storage/<userId>/`) + `lib/storage.client.js:25-50` (upload/download keyed under userId). Shared projects need shared *blobs*; a single `acl` allowlist lets invitees reuse the owner's signed-download URL or copy-on-grant into their own namespace.
3. **Live wire bus** — `client/visualizer-controller.js:1-100` is a working pubsub-over-WebSocket layer with `on/emit/setParam`, reconnect, param/action/load/hello protocol, and `window.VC` global. It currently targets `ws://<host>:8787` (visualizer-controller.js:79-81) — no project scope. We extend it with a `project:<id>` room instead of inventing a new transport.
4. **Project save/load UI already exists** — `project.js:413-525` has "Save to cloud / Open from cloud" wired to `SWR_STORAGE.listProjects/loadProject/upsertProject`. The "Open from cloud" list is the obvious place to surface a "Shared with me" tab.
5. **No existing collab primitives** — grep for `socket|ws://|EventSource|BroadcastChannel|SharedWorker|crdt|presence|collaborat` finds zero hits in `client/`, `lib/`, `api/_lib/`, `api/projects/`. The VC bus is the only realtime plumbing, and it isn't project-scoped today.

The user-flagged direction is "multi-prosumer control" — interpreted concretely as **shared project sessions between two or more authenticated users**, with the VC bus as the realtime layer. This plan is the smallest end-to-end cut that lands the value.

## Goal

An owner of a project can share it by email; the invitee can open it in `Open from cloud → Shared with me`, edits sync through the VC bus to the owner's session in < 1 s, and either side can `Save to cloud` to write back without losing the other's in-flight layer changes.

## Plan

### Step 1 — Extend project doc with `acl`
- **Files**: `api/_lib/db.js:282-343` (`getProject`, `upsertProject`)
- **Action**: Add a sibling `acl.json` at `data/projects/<id>.acl.json` shaped `{ ownerId, invites: [{ email, role: 'editor'|'viewer', invitedAt, acceptedAt? }] }`. Refactor `getProject(userId, id)` so that if the caller is in `invites` (by email match against `users.json`) AND `acceptedAt` is set, the project is returned with a `meta.role` field. Keep the existing `userId === caller` path so legacy projects keep working.
- **Verify**: `npm run check:full` still green; add a small unit-style script at `scripts/test-project-acl.mjs` that exercises: owner sees project; non-owner, non-invitee gets `null`; invited-and-accepted user sees project with `meta.role === 'editor'`.

### Step 2 — `api/projects/[id]/share.js` invite + revoke endpoint
- **Files**: new `api/projects/[id]/share.js`; register in `vercel.json` rewrites next to `api/projects/[id].js`.
- **Action**: `POST { email, role }` requires the caller to be the owner. Looks up user by email (`findUserByEmail` already exists at `api/_lib/db.js:114`); if the email has no user yet, stores a pending invite by email only (resolved on first login via a `_resolvePendingInvites(user)` helper called at the end of `auth/magic.js`'s verify handler). `DELETE ?email=` revokes. Both reuse the existing `proj-write:${ctx.user.id}` rate limit at `api/projects/[id].js:30`.
- **Verify**: `scripts/test-api.mjs` gets a new case `share → invite non-existent email → resolves on magic-link verify → invited user can GET project`.

### Step 3 — `Open from cloud → Shared with me` tab
- **Files**: `project.js:513-525` (the cloud-open modal), `lib/storage.client.js:53-60`.
- **Action**: Add `SWR_STORAGE.listSharedProjects()` which calls `GET /api/projects?shared=1`. The endpoint filters `PROJECTS_INDEX` by entries whose `<id>.acl.json` lists the caller. Render a second tab in the modal next to "My projects"; each row shows the owner's email and the role badge.
- **Verify**: Manual smoke: owner invites `b@x.com`, `b@x.com` logs in, sees project in "Shared with me", opens it; verify the engine loads with all layers/FX intact.

### Step 4 — Realtime hub: `api/realtime/[projectId].js` (Vercel serverless WebSocket via `socket.io` or a tiny `ws` shim)
- **Files**: new `api/realtime/[projectId].js`; new `scripts/dev-realtime.mjs` for local WS server (parallel to existing `scripts/dev-api.mjs`); `client/visualizer-controller.js:77-100`.
- **Action**: The hub authenticates the upgrade via `swrc_session` cookie (already set by `auth/login.html` + `api/_lib/http.js`), checks the project ACL (read `data/projects/<id>.acl.json`), and joins a room keyed on `projectId`. Inbound `set`/`action`/`load` messages are rebroadcast to every other socket in the room. Use the existing `ws` package (zero-runtime-dep philosophy preserved — `ws` is added as a regular dep, not bundled into the browser). On the client, change `VC.connect(url)` default to read `?room=<projectId>` from the URL, so opening `?room=<id>` in any `/versions/*.html` page joins the right room. The server stamps every rebroadcast with `source: 'ws'` so `VC.emit` doesn't loop.
- **Verify**: Two browser tabs logged in as different users on the same `?room=<id>`; changing `sens` slider in tab A updates tab B's `A.params.sens` and the `<input>` in under 1 s. Verify owner-only ops (e.g. `delete layer`) reject with `{ error: 'forbidden_role' }` for viewers.

### Step 5 — `client/visualizer-controller.js` room multiplexing
- **Files**: `client/visualizer-controller.js:44-100` (bus), `:84-100` (open).
- **Action**: Extend the bus to carry a `room` field on every inbound/outbound message. Add `VC.joinRoom(roomId)` / `VC.leaveRoom()` that resubscribes and clears prior subscriptions. Map `setParam` outbound events to `{type:'param', param, value, room}` and filter inbound by the active room so the bus still works on the no-room default (current visualizer-only mode).
- **Verify**: Existing `verify-visualizer-controller.mjs` still passes (no-room mode unchanged); add a new `verify-shared-session.mjs` that opens two pages, joins the same room, and asserts param sync.

### Step 6 — Save-back conflict policy (last-write-wins, with audit trail)
- **Files**: `api/_lib/db.js:297-326` (`upsertProject`), `project.js` save handlers.
- **Action**: When a non-owner calls `PUT /api/projects/<id>` (now allowed for editors), include the editor's `userId` in the persisted `meta.lastEditorId` + `meta.lastEditedAt`. The owner's `Save to cloud` still works; nothing changes for the single-user path. No CRDT — keep it last-write-wins for the M1 cut; document the gotcha in `SECURITY.md`.
- **Verify**: Two editors save 200 ms apart; the later save wins; the audit fields reflect the right user; no data loss compared to the no-shared-write path (project still loads).

### Step 7 — Docs + marketing surface
- **Files**: `SECURITY.md` (add an "ACL" subsection), new `share.html` (a thin landing page explaining shared projects + a CTA into `/engine/?room=demo`), `marketplace.html` (one-line mention under the existing "prosumer" copy).
- **Action**: Keep it minimal. `share.html` reuses the engine's existing CSS; the demo button opens a pre-wired room that any signed-in user can join.
- **Verify**: `npm run build` succeeds; new HTML page serves at `/share`.

## Verification

- `npm run check` passes (syntax + manifest + bundle + api tests).
- `npm run check:full` passes (adds verify smoke).
- `npm run verify:visualizer-controller` still green (no-room mode unchanged).
- New `verify-shared-session.mjs` (added in Step 5): two contexts, one project, edits sync round-trip in < 1 s.
- New `verify-project-acl.mjs` (Step 1): owner / editor / viewer / non-invitee matrix returns the right shape and 401/403/404 codes.
- Manual browser smoke: owner invites → invitee accepts → both tabs see the same `A.params.*` after a slider change → either tab saves successfully.

## Risks / gotchas

- **Vercel serverless WebSocket**: Vercel's `@vercel/edge` runtime supports WebSockets but Functions-as-a-Service don't reliably; the WS hub will likely need to ship to a small Fly/Render/Railway sidecar. Mitigation: ship the `dev-realtime.mjs` Node WS server first, document the Fly deploy in `SECURITY.md`, and gate the "real-time sync" copy on `SWR_REALTIME_URL` being set. Fall back to polling-every-2s for the no-sidecar path so the feature still works offline.
- **CRDT temptation**: This is a prosumer flow with two-to-five concurrent editors, not Figma. Last-write-wins + a clear `lastEditorId` is enough. Resist the urge to add Yjs.
- **Storage scoping**: Per-`userId` storage means the owner's audio blobs aren't directly fetchable by invitees. Two acceptable cuts: (a) the share endpoint also issues a one-shot signed-download URL for the invitee, or (b) on accept, copy the blobs into the invitee's `data/storage/<inviteeId>/`. (b) is simpler and keeps the existing `safeKey` invariant intact; do that.
- **ACL file races** — `withLock` in `api/_lib/db.js:59-77` already serializes; share endpoint must use the same lock for ACL writes. Easy to miss; add it explicitly.
- **Rate-limit collision** — `proj-write:${userId}` at `api/projects/[id].js:30` is per-user; an invitee spamming saves won't affect the owner. Good. Make sure the share endpoint uses its own bucket `share-write:${ownerId}` so the owner can't be DoS'd by being heavily shared.
- **`session.js` 401 vs 403**: `requireUser` returns 401 for unauthenticated; the share handler needs to return 403 for "you're logged in but not on the ACL". Add a `requireProjectAccess` helper that returns the right code.

## Out of scope

- Real-time cursor / selection presence (Phase 2 — `presence` event type can be added later, the room abstraction already supports it).
- Multi-device single-user (already covered by cookie-based auth + cloud save).
- Public shareable links (no-auth). That's a separate product decision and an abuse vector; punt until the auth-bounded case is proven.
- WebRTC peer-to-peer. Server-relayed is fine at this scale; P2P adds complexity without a win for < 5 concurrent editors.
- CRDT / OT merge. Last-write-wins is the documented behavior.
- Migrating the existing `vc-bridge` (mobile) driver to the new room-aware VC bus. That's a one-line change once the room filter ships, but it's a follow-up plan.