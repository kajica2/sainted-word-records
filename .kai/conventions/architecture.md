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
| `presets/*.json`    | Daily preset specs (append-only)                  | `preset-pipeline/generate.py` (local cron)   |
| `versions/<variant>.html` | Each engine variant's markup                | hand-edited per variant              |

**Process rule**: any change to `site-map.json` requires running
`node scripts/generate-vercel-rewrites.mjs` to regenerate `vercel.json`. New pages
also need `node scripts/migrate-html.mjs <page.html>` to wire shared CSS/JS links.

## Engine Variants

32 HTML files live in `versions/`:

- **5 core** (reactive): `neon`, `film`, `smoke`, `hallucination`, `music_video`
- **8 artistic-preset** (reactive, share the engine-genops shell):
  `glitch`, `aurora`, `pulse`, `void`, `chrome`, `watercolor`, `fractal`,
  `eclipse`, `music_video_mtv`
- **9 decorative / non-reactive**: `baroque`, `collage`, `echo-manifold`,
  `kraft`, `mosaic`, `phosphor`, `spectrum`, `tape`, `typography`
  (own paint loops, do NOT load engine-genops)
- **9 content pages**: `index`, `console`, `gallery`,
  `music-video-gallery`, `bachdrop`, `clean`, `simple`, `temple-of-control`,
  and `engines.html`? — see `ls versions/*.html` for the canonical list

The 13 reactive engines share `engine-genops.client.js` and run the
common `engine-render.client.js` pipeline. The decorative pages have
their own bespoke render loops. The reactive set is defined in
`client/variant-switcher.client.js` (the `VARIANTS` table minus
`baroque` and `grid`, which the switcher doesn't drive).

Each `versions/<variant>.html` loads the shared `engine-*.client.js`
subsystems. The visual identity of each variant lives in its `drawLayer`
inline script — the part that's actually variant-specific research.
The shared plumbing (mobile header, responsive media queries,
watermark, audio-damp, FX-grade chain) is added by hand-run codemods
in `versions/_*.js` and verified by `scripts/check-variant-codemods.mjs`.

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