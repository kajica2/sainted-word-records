# AGENTS.md

Algorithmic audio-reactive video engine. Drop in a song, drop in a library of videos / GIFs / images, get a reactive layered composition. Browser-native, Vercel-deployed, with a thin M1 serverless API for auth, storage, and projects.

## Setup commands

- Install deps:    `npm install`
- Start dev:       `npm run dev`               # http://localhost:5174
- Build (local):   `npm run build`             # outputs `dist/`
- Preview:         `npm run preview`           # http://localhost:4173
- Clean:           `npm run clean`             # wipes `dist/`, `dist-dev/`, `.vite/`

Node 20+ required (see `.nvmrc`). npm only — `package-lock.json` is the source of truth.

## Project layout

- `engine.html` — main engine, served at `/engine/` (the PWA entrypoint)
- `landing.html`, `campaign.html`, `personas.html`, `weddings.html`, `marketplace.html`, `make-video.html`, `intro.html`, `about.html`, `changelog.html`, `press.html`, `status.html`, `thanks.html`, `portfolio.html`, `tutorial-30s.html`, `interactive-howto.html` — marketing + educational surfaces
- `engine-*.client.js`, `presets*.client.js`, `pt*.client.js`, `persona-*.js`, `project.js`, `wizard.js`, `*.client.js` — browser subsystems; each `<name>.client.js` is global-script design (attaches to `window`), loaded via `defer`
- `audio-analysis-v2.js` — zero-deps BPM (autocorrelation) + key (Krumhansl-Schmuckler) + chromagram
- `fx-postprocess.js`, `video-fx.css` — 14-FX WebGL fullscreen-quad pipeline
- `pwa-bootstrap.js`, `sw.js`, `manifest.webmanifest`, `offline.html` — PWA shell
- `api/` — Vercel serverless handlers (auth, storage, projects, health) + `_lib/` shared helpers
- `auth/` — magic-link login + verify pages and their client scripts
- `client/`, `lib/` — shared browser client modules (visualizer-controller, auth, media-store, library-manager, library-switcher, migrate, design-tokens, components, nav, capture-runtime, swr-media-input, swr-camera-preview, swr-mic-meter, swr-spit-runtime, swr-spit-fx)
- `audios/` — per-engine demo MP3s (auto-loaded by each variant). The curated demo asset library (`library/`) has been removed — users bring their own assets via the Media Manager upload affordance.
- `versions/` — audio-reactive engine variants. The 5 core variants are neon, film, grid, smoke, hallucination. Plus reference implementation `music_video.html` (3D hologram) and the multi-video gallery `music-video-gallery.html`. The remaining 17 variants (aurora, baroque, chrome, collage, echo-manifold, eclipse, fractal, glitch, kraft, mosaic, phosphor, pulse, spectrum, tape, typography, void, watercolor) are individual artistic presets sharing the same runtime. The automix + curator stack (originally shipped only on `music_video.html`) is now wired into 16 of the 17 artistic variants via the per-variant config map at `variants/<name>.automix.json` — `echo-manifold` is the sole `enabled: false` opt-out because it has no FX surface at all (its visuals are its own generative canvas with no fx_state uniforms, so automix presets would have nothing to drive). `tape` was the other opt-out until the audio-feature gap was closed: it now extracts canonical features via `lib/media-feat.client.js` attached to its loaded media element (the old synthesised features remain the no-audio fallback), and `fx-postprocess.js` consumes `window.SWR._fxOverride` so automix presets reach the 14-FX pipeline variants (tape, mosaic, baroque, kraft, phosphor) just as `versions-presets.js` does for the rest
- **`versions/_shared.css`** — shared stylesheet for the marketing-style visual-language pages. Loaded by the visual-language index and the 6th-language landing page; not loaded by engine variants. Page-specific tokens live in each page's `:root`.
- `variants/` — per-variant automix + curator config maps (one JSON per variant). Inlined into the matching `versions/<name>.html` at build time by the `inline-automix-config` Vite plugin, so configs never need a runtime fetch (offline-first, matches the PWA shell ethos)
- `site-map.json` — canonical IA: nav, footer, auth, legal, tools, archived. Source of truth for `vercel.json` rewrites and Vite `rootFiles`. Edit this, then run `scripts/generate-vercel-rewrites.mjs` to regenerate vercel.json
- `_archive/` — gitignored experimental pages (landing-personas variants, internal docs, dev tools). Excluded from deploy

## Site-map & shared design system

The project uses a single-source-of-truth IA in `site-map.json` and shared design tokens/components loaded by every page:

- **`lib/design-tokens.css`** — CSS custom properties (colors, fonts, spacing, shadows) for light + dark themes. Loaded via `<link rel="stylesheet" href="/lib/design-tokens.css">`
- **`lib/components.css`** — shared component classes (`.btn`, `.card`, `.tile`, `.nav`, `.footer`, etc.) extracted from `landing.html`. Loaded via `<link rel="stylesheet" href="/lib/components.css">`
- **`lib/nav.client.js`** — `<swr-nav>` Web Component + `window.SWR_NAV` API. Fetches `/site-map.json` and renders a sticky top nav with theme toggle, dropdowns, and active state. Loaded via `<script src="/lib/nav.client.js" defer></script>`

### Build automation scripts

- `scripts/generate-site-manifest.mjs` — auto-discover HTML pages, populate `site-map.json`. Run with `--dry-run` to preview
- `scripts/generate-vercel-rewrites.mjs` — generate `vercel.json` rewrites from `site-map.json`. Run after editing `site-map.json`
- `scripts/archive-pages.mjs` — move pages marked `"archived": true` in `site-map.json` to `_archive/`. Run with `--dry-run` first
- `scripts/migrate-html.mjs` — add shared CSS/JS links to HTML pages, remove duplicate theme bootstrap scripts. Run on new pages or to refresh existing ones

### Maintaining site-map.json

To add a new page:
1. Add the page to the appropriate section in `site-map.json` (nav, footer, auth, legal, or tools)
2. Run `node scripts/generate-vercel-rewrites.mjs` to update vercel.json
3. Run `node scripts/migrate-html.mjs <page.html>` to add shared CSS/JS

To archive a page:
1. Add the filename to the `"archived"` array in `site-map.json`
2. Run `node scripts/archive-pages.mjs --dry-run` to preview
3. Run `node scripts/archive-pages.mjs` to move files to `_archive/`
4. Run `node scripts/generate-vercel-rewrites.mjs` to update vercel.json
- `preset-pipeline/` — Python daily generator (`generate.py`) + Node schema verifier (`verify.mjs`). Local-only: `./cron.sh` runs on the dev box (the GitHub Action that previously auto-committed was removed 2026-09-20). New presets need to be committed by hand after generation
- `presets/` — JSON preset specs (one per file, append-only, daily-generated)
- `marketplace/curated/`, `portfolio/`, `press/`, `promo/`, `keyart/`, `icons/`, `legal/` — content
- `scripts/` — build / test / dev scripts (`check-syntax.mjs`, `build-magenta-dsp-bundle.sh`, `dev-api.mjs`, `test-api.mjs`)
- `tools/` — dev tools (`deploy-vercel.sh`, `hf-publish.html`, `dev-up.sh`/`dev-ps.sh`/`dev-down.sh`, `freq-bridge.js`, `agentic-set.mjs`)
- `verify-*.mjs` — Puppeteer E2E suites at repo root (~110 files; the 8 automix verifies are one per surface plus a cross-surface run; the curated 5-smoke + transitions verifier are the CI gate; see `.kai/conventions/testing.md` for the full layering)
- `verify-screenshots/`, `out/`, `docs/` — research + audit artifacts
- `vite.config.js` — custom `copy-static` + `swrc-api-middleware` + `strip-absolute-module-scripts` + `inline-automix-config` plugins
- `vercel.json` — Vercel rewrites (`/` → `landing.html`, `/engine` → `engine.html`, etc.) + buildCommand

## Code style

- Vanilla JavaScript, ESM (`"type": "module"` in `package.json`). **No TypeScript.**
- 2-space indent, LF line endings, UTF-8, final newline, trim trailing whitespace (`.editorconfig`); lockfiles and `*.md` are exempt
- No ESLint, no Prettier — follow the surrounding style in each file. Match the existing module pattern: `<name>.client.js` is global-script; shared helpers live in `lib/`; serverless handlers live in `api/<route>.js` with shared code in `api/_lib/`
- Single quotes, `'use strict'` not needed (ESM), prefer `const`/`let`, async/await over callbacks
- File names are descriptive kebab-case; engine subsystems use the `engine-<subsystem>.client.js` convention
- The engine's index.html references many scripts with absolute paths (e.g. `/pwa-bootstrap.js`); a Vite plugin strips `type="module"` from those so they load as plain defer'd scripts — do not re-add `type="module"` to absolute-path scripts in any `*.html`

## Testing instructions

- Quick gate: `npm run check` → runs `check:syntax` + `check:manifest` + `check:bundle` + `scripts/test-api.mjs`
- Full pre-PR gate: `npm run check:full` → all of the above + `check:verify` (verify smoke)
- `check:capture-unit` — node:vm unit coverage for the periodic frame capture runtime (URL parse, localStorage, clamp, state machine, blob trigger). Runs as part of `npm run check`.
- `check:capture-smoke` — Puppeteer smoke against built `dist/engine`. Toolbar mount, toggle flow, interval two-way binding, URL opt-in. Runs as part of `npm run check:full`.
- `check:media-input-unit` — node:vm unit coverage for the live-camera-mic foundation (MediaInput factory + codec + audio features, Camera Preview + Mic Meter mount/unmount contracts). Runs as part of `npm run check`.
- `check:media-input-smoke` — Puppeteer smoke verifying the 3 module globals load and the factory returns an instance. Skips real camera/mic permissions (CI sandbox). Runs as part of `npm run check:full`.
- `check:spit-live-unit` — node:vm unit coverage for the Spit Live page (SWR_SPIT factory + state machine + loadBeat/toggleMic/triggerFx, SWR_SPIT_FX validation + concurrency). Runs as part of `npm run check`.
- `check:spit-live-smoke` — Puppeteer smoke against built `dist/spit`. Verifies page boots, FX buttons, canvas, runtime + FX globals. Runs as part of `npm run check:full`.
- E2E: `npm run verify:<name>` (e.g. `verify:cloud-auth`, `verify:story-graph`, `verify:hallucination-story`, `verify:autoplay`, `verify:e2e-media-record`, `verify:music-video-maker`, `verify:weddings`, `verify:site-nav`); Puppeteer auto-logs-in via stored cookies when needed
- `verify:site-nav` — smoke test for the unified navigation system. Crawls every nav URL from `site-map.json`, verifies shared CSS/JS loads, checks archived pages return 404
- Each `verify-*.mjs` is standalone (no shared harness); they're discovered and run individually. Add a new `verify-<feature>.mjs` at repo root and wire it as `npm run verify:<feature>` in `package.json`
- After every sprint / non-trivial change, run the relevant E2E scripts before claiming done — typecheck + build do not catch runtime bugs (Canvas/WebGL/PWA/audio permission flows, infinite re-render loops, IndexedDB persistence, Vercel deploy quirks)
- `preset-pipeline/cron.sh` is the canonical daily-preset entry point; it generates then verifies
- **Env-skip pattern**: tests that need resources outside this repo (e.g. `verify:hf-publish` requires the sibling `~/Documents/autodashboard/magenta-dsp-procedural` source) print `(env skip: ...)` and pass when the resource is absent, matching the design intent of `scripts/build-magenta-dsp-bundle.sh:74-88`. Keep the marker literal so a real failure still surfaces

## PR & commit conventions

- Branch from `main`; never push to it directly
- Conventional commits (`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`); recent examples: `fix(hallucination): surface auto-loaded song`, `fix(deploy): capture stderr from vercel ls`
- Repo-local git config is unset — assistant commits ship as the global user (`kajica2 <kai.djuric@gmail.com>`). If you ever set a repo-local `user.name`/`user.email`, unset it (or pass `-c user.name=… -c user.email=…` on the commit) — Vercel blocks deploys whose GitHub committer identity is unknown
- GitHub Actions: `ci.yml` runs on PR/push (npm ci + `check:full` + `verify:transitions` + `verify:automix-cross-surface` + `npm run build` + build-size budget ≤ 130MB). Preset pipeline is local-only (`./preset-pipeline/cron.sh`)

## Security

- Never commit secrets — `.env` is in `.gitignore`; copy `.env.example` to `.env` for local dev
- API threat model is in `SECURITY.md`; key rules:
  - All storage goes through signed URLs scoped to `userId/...`; never bypass `/api/storage/sign-upload` / `sign-download`
  - `safeKey()` rejects keys with `..`, leading `/`, or `\` — keep this invariant
  - `swrc_session` cookie: HttpOnly, SameSite=Lax, Secure in production; 30-day rolling TTL
  - Rate limits on `/api/auth/magic` (10/min/IP), `/api/storage/sign-upload` (60/min/user), `sign-download` (120/min/user), `/api/projects` writes (30/min/user) — return 429 with `Retry-After`
  - `TRUSTED_PROXIES` must be set if deploying outside Vercel, otherwise `x-forwarded-for` is spoofable and bypasses the per-IP rate limit
- Vercel deploys are auto on push to `main`. Build size is ~114MB (was ~66MB after the 2026-09-13 curated demo library removal; grew to ~96MB file-content / ~114MB block-padded after the 2026-09-20 audit/keyart refresh; CI asserts ≤ 130MB budget).
