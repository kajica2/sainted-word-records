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
                       └── versions/inject/*.js  (per-variant)  │
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
| `presets/*.json`    | Daily preset specs (append-only)                  | `preset-pipeline/generate.py` (CI daily cron) |
| `versions/<variant>.html` | Each engine variant's markup                | hand-edited per variant              |

**Process rule**: any change to `site-map.json` requires running
`node scripts/generate-vercel-rewrites.mjs` to regenerate `vercel.json`. New pages
also need `node scripts/migrate-html.mjs <page.html>` to wire shared CSS/JS links.

## Engine Variants

5 audio-reactive variants live in `versions/`:

- **neon** — magenta-cyan glow, high-contrast
- **film** — warm vignette + grain + 24fps cadence
- **grid** — CRT-grid + flash overlays
- **smoke** — soft, desaturated, particle haze
- **hallucination** — multi-layer kaleidoscope, high motion

Each variant HTML loads shared `engine-*.client.js` subsystems; per-variant
behavior comes from `versions/inject/<variant>.js`.

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
- Engine state persists in IndexedDB via `lib/media-store.client.js` (with
  lazy-evict quota handling).

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
- **Build**: `npm run build` → `dist/`. Build size ≈ 66MB (down from ~140MB
  pre-2026-09-13 after the curated demo library removal).
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
- CI entrypoint: `preset-pipeline/cron.sh`
- Output: append-only `presets/*.json`
- Auto-committed by `presets-daily.yml` GitHub Action.