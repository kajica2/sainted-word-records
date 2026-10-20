# Firestore User Library Menu — Plan

A floating action button (FAB) + collapsible dropdown menu on the
engine page that exposes Firestore-backed user library operations.

## Goal

- One persistent affordance for "your library in the cloud" — no
  hunting through settings panels.
- Symmetric pairs (push / pull) so a user can sync *to* Firestore and
  *from* Firestore without leaving the page.
- Discoverable: the FAB lives at the same screen-relative position
  on every page (bottom-right of the library panel).

## Why

The user's library lives in IndexedDB today (`sainted-word-records/assets`).
IndexedDB is browser-local — no cross-device, no cross-machine. The
Kits path already exposes Firestore (see `api/_lib/projects-store.js`),
but it only carries project docs, not the asset blobs themselves.

Three things happen on this plan:

1. **Push library to Firestore** — serialize user library entries +
   blobs to a `users/<id>/library/<assetId>` Firestore collection.
   This is the "save my library" gesture.
2. **Pull library from Firestore** — read the same collection and
   merge entries into the local IDB so the user sees their cloud
   library on a new device. Conflict policy: cloud wins for assets
   that have a newer `updatedAt` than local; local wins for asset
   blobs missing on the cloud side.
3. **Watch mode** — opt into a background subscription that
   auto-pulls new cloud library entries when they arrive. Off by
   default (the cost of an always-on listener isn't trivial).

## UI

Floating menu (FAB) anchored bottom-right of the library panel:

```
              ┌──────────────────────────┐
              │ ☁  Cloud library          │
              │ ─────────────────────────│
              │ ↥  Push library          │
              │ ↧  Pull library          │
              │ ⟳  Sync (push, then pull) │
              │ ─────────────────────────│
              │ ⚙  Watch: off  ▢        │ ← toggle
              │ ─────────────────────────│
              │ status:  last sync 3m ago│
              └──────────────────────────┘
                            ▲
                            │
                       [☁ SWR]
                    (floating button)
```

The button:

- Round, 44×44, bottom-right of `#library`, fixed position.
- Inactive state: outline only.
- Active state: filled, shows cloud icon with a dot when a sync is in
  progress or there's an error to read.
- Click → menu toggles open/closed.
- Tap outside → menu closes (with a backdrop click handler).

Status line shows:

- Last sync timestamp (relative: "3m ago").
- Live count: "47 assets · 312 MB".
- Sync state: idle / pushing / pulling / error.

The keyboard handler:

- `Cmd/Ctrl + L` — open / close the menu (parallel to the bare `0`
  home key in `engine-keys.client.js`).
- `Cmd/Ctrl + Shift + L` — trigger a sync (push, then pull).

## Data shape (Firestore)

### Collection: `users/{userId}/library/{assetId}`

Document body:

```js
{
  id: 'asset-id',
  name: 'holo-3.webp',
  type: 'image' | 'video' | 'audio',
  w: 200,
  h: 200,
  duration: 0,          // seconds, for video/audio
  size: 12345,         // bytes
  thumbDataUrl: 'data:image/jpeg;base64,…',  // ≤ 200 KB target
  cloudBlobPath: 'users/<uid>/library/<id>',   // pointer to Cloud Storage
  updatedAt: '2026-10-20T07:00:00.000Z',
  source: 'browser' | 'import' | 'share',
}
```

### Blobs

Don't store blobs inline in Firestore (1 MiB doc cap). Instead use a
**Cloud Storage bucket** for blobs and store a *pointer* on the doc:

```
gs://<bucket>/users/<uid>/library/<assetId>
```

`firebase-admin` + `@google-cloud/storage` is the simplest path on the
server. The client uses signed URLs (same pattern as the existing Vercel
Blob store at `api/_lib/storage.js`).

### Manifest

One doc per user:

```js
users/{userId}/libraryManifest/{userId}
{
  userId,
  count: 47,
  sizeBytes: 327_155_712,
  lastSyncAt: '2026-10-20T07:00:00.000Z',
  schema: 'swr-user-library/v1',
}
```

This is what the menu reads to render "47 assets · 312 MB" without
enumerating every asset (Firestore bill protection).

## Auth

Two roles: **owner** (the signed-in user) and **read-only share** (a
shareId that the user mints for a public read-only view).

- `api/_lib/firestore.js` already lazy-loads `firebase-admin` when
  `SWR_PROJECTS_STORE=firestore`. **Reuse the same module** — this
  path is dormant on the same env flag.
- New env vars:

```
SWR_PROJECTS_STORE=firestore   (existing)
FIREBASE_PROJECT_ID=…          (existing)
FIREBASE_SERVICE_ACCOUNT=…     (existing, JSON string)
SWR_USER_BUCKET=<bucket-name>  (NEW — Cloud Storage bucket for assets)
SWR_USER_LIBRARY=on            (NEW — gate the user library menu)
SWR_USER_LIBRARY_DEFAULT_SIZE_MB=512  (NEW — per-user quota, default 512)
```

If `SWR_USER_LIBRARY=on` is missing, the menu is hidden entirely (the
FAB doesn't render). That keeps production deploys opt-in.

## API endpoints

Five new handlers live under `api/library/`:

### `api/library/index.js`

- `GET` → list cloud library manifest (`{count, sizeBytes, lastSyncAt}`)
- `POST` → push local library to cloud (bulk upload via signed URLs)
- `DELETE` → wipe cloud library (rare; confirm gated)

### `api/library/[id].js`

- `GET` → return asset metadata + a fresh signed download URL
- `PUT` → update metadata (name, w, h, duration) — not the blob
- `DELETE` → delete a single cloud asset

### `api/library/sign-upload.js`

- `POST {name, contentType}` → returns `{uploadUrl, cloudPath}` for
  the client to PUT the blob directly to Cloud Storage. Mirrors
  `api/storage/sign-upload.js`.

### `api/library/sign-download.js`

- `GET {cloudPath}` → returns a short-lived signed download URL. Same
  pattern as `api/storage/sign-download.js`.

### `api/library/sync.js`

- `POST` → for-conflict resolution: compare local + remote
  `updatedAt` per asset, return the merged set. The client then
  downloads winners via signed URLs and uploads losers via signed
  upload URLs.

All five endpoints reuse `requireUser()` from `api/_lib/session.js` —
the same session gate the project + kit endpoints already use. Sharing
is anonymous-read only and uses a shareId (mirrors P3.4).

## Client module

New file: `client/cloud-library.client.js` — exposes
`window.SWR_CLOUD_LIBRARY`:

```js
window.SWR_CLOUD_LIBRARY = {
  async push(localItems, { onProgress })
  async pull({ onProgress })
  async sync()         // push + pull with progress events
  async listCloud()    // returns manifest only
  setWatch(on: bool)
  get status()         // { state, lastSyncAt, error, count, sizeBytes }
}
```

Module loads only when the menu FAB is on the page (gated by the
`SWR_USER_LIBRARY=on` env var rendering the FAB). Skips cleanly when
no Firestore backend — falls back to a "Cloud disabled" status so the
menu still renders and explains.

Module emits a `swr-cloud-library` CustomEvent for the debug overlay
(`swr-keys-press` / `swr-look-filter` already exist; this matches their
shape).

## Front-end (the FAB + menu)

Component: `client/cloud-library-fab.client.js`

```html
<button class="cloud-fab" id="cloud-fab" aria-haspopup="true" aria-expanded="false">
  <svg viewBox="0 0 24 24"><path d="…" fill="currentColor"/></svg>
</button>
<div class="cloud-menu" id="cloud-menu" role="menu" hidden>
  <header>Cloud library</header>
  <button role="menuitem" data-act="push">↥ Push library</button>
  <button role="menuitem" data-act="pull">↧ Pull library</button>
  <button role="menuitem" data-act="sync">⟳ Sync</button>
  <hr>
  <label><input type="checkbox" id="cloud-watch"/> Watch (auto-sync)</label>
  <footer class="cloud-status" id="cloud-status">idle</footer>
</div>
```

CSS: `<style>` inline in `engine.html` (page-local). Anchored
bottom-right of the library panel. Mobile: full-width drawer at the
bottom of the viewport.

Backdrop click closes the menu (no native `dialog` — keeps the
component footprint tiny; the engine already loads lots).

Status updates:

- A `tick()` polls `SWR_CLOUD_LIBRARY.status()` every 1s while the
  menu is open. Closes → polling stops.
- Progress: a thin bar appears under the status line while a sync is
  in flight.

## Conflict resolution policy

When sync() detects a conflict (same assetId on both sides, different
`updatedAt`):

1. Larger size wins (more bytes = more recent / richer data).
2. Tie → cloud wins (cloud is the "official" copy once push completes).
3. Push a "winners applied" event so the debug overlay logs it.

Per-asset winners are downloaded to local IDB via signed-download
URLs (parallel; cap at 4 concurrent to avoid hammering Cloud Storage).
The losers are then uploaded via signed-upload URLs in the same cap.

## Tests

Three unit tests + one smoke test:

- `scripts/check-cloud-library-unit.mjs` — module API contract:
  push/pull/sync calls, status shape, watch toggle persists across
  reloads.
- `scripts/check-cloud-library-fab-unit.mjs` — UI behaviour:
  FAB toggles menu, status updates render, disable when env off,
  keyboard shortcut opens menu.
- `scripts/check-user-library-unit.mjs` — server routes:
  api/library/[id] (GET/PUT/DELETE), sign-upload, sign-download round
  trip. Mocks `firebase-admin` to avoid real network.
- `scripts/check-cloud-library-smoke.mjs` — real Firestore emulator
  round-trip via `FIRESTORE_EMULATOR_HOST=localhost:8080`.

## Open questions

- Quota enforcement. Per-user cap = `SWR_USER_LIBRARY_DEFAULT_SIZE_MB`
  default 512 MB. Push returns 413 when over cap. We'll surface
  the cap in the menu so users know it exists.

- Share mode. An anonymous shareId gives read-only access to a
  specific asset (or a curated subset). Implementation deferred —
  the kits endpoint already covers share-as-zip, so user-library
  sharing can wait.

- Cloud Storage auth path. firebase-admin initializes Google Cloud
  Storage with `getStorage()` from `firebase-admin/storage`. If the
  project doesn't have GCS enabled, the menu returns a friendly
  error rather than crashing.

## Files Touched

### New

- `client/cloud-library.client.js`
- `client/cloud-library-fab.client.js`
- `api/library/index.js`, `api/library/[id].js`
- `api/library/sign-upload.js`, `api/library/sign-download.js`
- `api/library/sync.js`
- `scripts/check-cloud-library-unit.mjs`
- `scripts/check-cloud-library-fab-unit.mjs`
- `scripts/check-user-library-unit.mjs`
- `scripts/check-cloud-library-smoke.mjs`
- `docs/PLANS/firestore-user-library-menu.md`  ← this file

### Modified

- `engine.html` — add the FAB + menu DOM, lazy-load on `SWR_USER_LIBRARY=on`
- `api/_lib/firestore.js` — bucket + storage helpers
- `package.json` — new check scripts
- `vercel.json` — registers `/api/library/*` routes
- `site-map.json` — adds the menu to the site IA as a hidden nav item
  (it's an in-page widget, no top-level nav entry)

### Untouched

- `lib/library.client.js` — local IDB API stays unchanged; the cloud
  module reads + writes via the existing `Library.items` surface.

## Verification

- Open the engine page with `SWR_USER_LIBRARY=on`. FAB appears.
- Click → menu opens with idle status.
- Click "Push library" → modal progress bar; status flips to
  "pushing…"; ends in "synced 47 assets · 312 MB · 4s".
- Refresh the page → status persists (from localStorage).
- Sign in to a second browser. Open the engine. Click "Pull library"
  → 47 assets land in local IDB.
- Watch mode ON → local IDB stays in sync with cloud automatically.

## Rollout

Phase 1 — Module + UI scaffold + 1 handler (`api/library/index.js`).
Phase 2 — Sync endpoint + signed upload/download. Phase 3 — Watch mode
+ tests against the emulator. Phase 4 — Documentation + product
changelog entry.
