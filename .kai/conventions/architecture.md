# Architecture

## System Shape

Algorithmic audio-reactive video engine. Two surfaces:

1. **Browser** — Vite-built static SPA-ish surface, vanilla JS, ESM. No React/Vue/Svelte.
   PWA-shell + engine runtime + marketing/landing pages.
2. **API** — thin M1 serverless layer (Vercel) for auth (magic-link), media storage
   (signed URLs), and project persistence.

```
                  ┌────────────────────────────────────────────┐
   user browser ───►  landing.html / engine.html (Vite SPA-ish) │
                       │                                       │
                       ├── engine-*.client.js   (engine runtime) │
                       ├── lib/*.client.js      (shared)        │
                       ├── versions/<variant>.html              │
                       └── variants/<name>.automix.json         │
                  ┌────────────────────────────────────────────┘
                                       │
                                       │ HTTPS (signed URLs)
                                       ▼
                  ┌────────────────────────────────────────────┐
                  │ api/  (Vercel serverless)                  │
                  │   ├── auth/      magic-link login          │
                  │   ├── storage/   signed upload/download    │
                  │   ├── projects/  project persistence      │
                  │   └── _lib/      shared helpers           │
                  └────────────────────────────────────────────┘
```

## Source-of-Truth Files

| File                | Owns                                              | Generator                            |
| ------------------- | ------------------------------------------------- | ------------------------------------ |
| `site-map.json`     | IA: nav, footer, auth, legal, tools, archived      | hand-edited                          |
| `vercel.json`       | Rewrites (`/` → `landing.html`, `/engine` → …)    | `scripts/generate-vercel-rewrites.mjs` (run after editing site-map.json) |
| `vite.config.js`    | Build, `rootFiles`, plugins, copy-static          | hand-edited (with `BUILD_MARKER_v*`) |
| `manifest.webmanifest` | PWA manifest                                    | hand-edited                          |
| `presets/*.json`    | Daily preset specs (append-only)                  | `preset-pipeline/generate.py` (local cron)   |
| `versions/<variant>.html` | Each engine variant's markup                | hand-edited per variant              |

**Process rule**: any change to `site-map.json` requires running
`node scripts/generate-vercel-rewrites.mjs` to regenerate `vercel.json`. New pages
also need `node scripts/migrate-html.mjs <page.html>` to wire shared CSS/JS links.

## Engine Variants

32 HTML files live in `versions/` (`ls versions/*.html` is the canonical
list; the taxonomy below is 5 + 9 + 9 + 1 + 8 = 32):

- **5 core** (reactive): `neon`, `film`, `smoke`, `hallucination`, `music_video`
- **9 artistic-preset** (reactive, share the engine-genops shell):
  `glitch`, `aurora`, `pulse`, `void`, `chrome`, `watercolor`, `fractal`,
  `eclipse`, `music_video_mtv`
- **9 decorative / non-reactive**: `baroque`, `collage`, `echo-manifold`,
  `kraft`, `mosaic`, `phosphor`, `spectrum`, `tape`, `typography`
  (own paint loops, do NOT load engine-genops)
- **8 content pages** (no render loop of their own): `index`, `console`,
  `gallery`, `music-video-gallery`, `bachdrop`, `clean`, `simple`,
  `temple-of-control`
- **1 standalone variant**: `grid` (CRT-grid; its visual identity is DOM
  overlays rather than a canvas `drawFx`, so the switcher doesn't drive it)

15 pages load `engine-genops.client.js` and run the common
`engine-render.client.js` pipeline: the 5 core, the 9 artistic, and
`grid`. 14 of those 15 are reachable from the engine's `#looks` dropdown -
the `VARIANTS` table in `client/variant-switcher.client.js` omits `grid`
and `baroque`. The decorative pages keep their own bespoke render loops.

Each `versions/<variant>.html` is a COMMITTED page, not a template
rendered from anything: the shared `engine-*.client.js` subsystems and
the variant's own inline scripts all live in that file. The visual
identity of each variant lives in its `drawLayer` inline script - the
part that's actually variant-specific research. The shared plumbing
(mobile header, responsive media queries, watermark, audio-damp,
FX-grade chain) is applied by the hand-run codemods in
`versions/_*.js`, which EDIT THE VARIANT IN PLACE and leave a
`SWR-*-MARKER` comment behind so the pass is visible in the file.
`scripts/check-variant-codemods.mjs` re-runs each codemod in dry-run and
compares what it plans to inject against the markers actually present in
the tree; a divergence is a drift case and fails the gate.

## Shared Design System

Every page loads:

- **`lib/design-tokens.css`** — CSS custom properties (colors, fonts, spacing, shadows)
  for light + dark themes.
- **`lib/components.css`** — shared classes (`.btn`, `.card`, `.tile`, `.nav`, `.footer`).
- **`lib/nav.client.js`** — `<swr-nav>` Web Component + `window.SWR_NAV` API. Fetches
  `/site-map.json`, renders sticky top nav with theme toggle, dropdowns, active state.

Theme toggle ships in the nav; pages must not duplicate their own theme bootstrap
script (the `migrate-html.mjs` script enforces this — it strips duplicates when run).

## PWA Shell

- `pwa-bootstrap.js`, `sw.js`, `manifest.webmanifest`, `offline.html`.
- Service worker registers after first load; offline page handles network failures.
- Engine state persists in IndexedDB via `lib/media-store.client.js`. On
  QuotaExceededError the rejected error is augmented with `{usage, quota}` from
  `navigator.storage.estimate()` (50 ms ceiling) BEFORE the rejection is
  observed by callers, so the consumer at `lib/user-media-mount.client.js:115-137`
  can show concrete "X MB / Y MB used" usage numbers and a Library-Hygiene
  prompt. Without the estimate, the storage-full error was thrown without
  any quota data and the only available action was a generic "Storage full"
  message. Verified by `scripts/check-quota-estimate-unit.mjs`.
- A full disk is NOT a lost upload. The write path in
  `lib/media-store.client.js` catches QuotaExceededError, fills `err.usage`
  if it is still null, then calls `evictOldestOne()` and retries the batch
  exactly ONCE. The policy is deliberately the most conservative one that
  still works: exactly one record is dropped, the oldest by `createdAt`
  (ties broken by id; undated records sort last so they are never the
  victim); `favorite === true` is never a candidate; eviction is LOCAL ONLY
  (no tombstone, cloud copy untouched, and a session-scoped `_evictedIds`
  set keeps the sync pull from re-downloading the file that was just freed);
  a second failure rethrows the ORIGINAL error so a genuinely full disk
  cannot spin. `getEvictionStats()` returns `{count, total, day}` from three
  deliberately un-namespaced `localStorage` keys -
  `quota-evictions-count` (today, resets at local midnight),
  `quota-evictions-day` (`YYYY-MM-DD` the count belongs to) and
  `quota-evictions-total` (life of the library) - and every drop also emits
  an `evicted` event, so a UI can say "auto-cleaned N times today" instead
  of letting an item quietly vanish. Verified by
  `scripts/check-quota-eviction.mjs`. (Before this, no eviction code existed
  anywhere in the repo and the quota error carried no usage data at all.)

## API Threat Model (excerpt from SECURITY.md)

- All storage goes through signed URLs scoped to `userId/...`; never bypass
  `/api/storage/sign-upload` / `sign-download`.
- `safeKey()` rejects keys with `..`, leading `/`, or `\` — **keep this invariant**.
- `swrc_session` cookie: HttpOnly, SameSite=Lax, Secure in production; 30-day rolling TTL.
- Rate limits (return 429 + `Retry-After`):
  - `/api/auth/magic` — 10/min/IP
  - `/api/storage/sign-upload` — 60/min/user
  - `/api/storage/sign-download` — 120/min/user
  - `/api/projects` writes — 30/min/user
- `TRUSTED_PROXIES` env must be set when deploying outside Vercel, otherwise
  `x-forwarded-for` is spoofable and bypasses per-IP rate limits.

## Build Pipeline

- **Local dev**: `npm run dev` → Vite on `:5174` with `swrc-api-middleware`
  proxying `/api/*` to `scripts/dev-api.mjs`.
- **Build**: `npm run build` → `dist/`. Build size ≈ 153MB (measured
  2026-10-18: audios 40 + videos 30 + packs 22 + keyart 43 + portfolio
  15 + ~6 elsewhere). `ci.yml:168` enforces 155MB; the 130MB and
  140MB figures in `.kai/tech-debt/register.md:210` and the
  earlier comment are stale.
- **Deploy**: Vercel auto-deploys on push to `main`. GitHub committer identity
  must match an authorized user (currently `kajica2 <kai.djuric@gmail.com>`)
  — see `.kai/memory.yaml#owner`.

## Out-of-Scope (Archived)

- `library/` — curated demo asset library **removed 2026-09-13**. Users bring
  their own assets via the Media Manager upload affordance.
- `_archive/` — gitignored experimental pages (landing-personas variants,
  internal docs, dev tools). Excluded from deploy.

## Preset Pipeline (out-of-band)

- `preset-pipeline/generate.py` (Python) — daily preset generator
- `preset-pipeline/verify.mjs` (Node) — schema verifier
- Local entrypoint: `preset-pipeline/cron.sh` (LaunchAgent on dev box)
- Output: append-only `presets/*.json`
- `cron.sh:52-64` auto-commits AND `git push origin main`s the new
  presets. Vercel auto-deploys from `main`. This is unattended: a
  laptop sleep for two weeks is two weeks of missing presets with
  no signal except `manifest.json#updated_at`. The log lives at
  `preset-pipeline/out/cron.log` (gitignored).