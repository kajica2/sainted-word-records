# AGENTS.md

Algorithmic audio-reactive video engine. Drop in a song, drop in a library of videos / GIFs / images, get a reactive layered composition. Browser-native, Vercel-deployed, with a thin M1 serverless API for auth, storage, and projects.

## Setup commands

- Install deps:    `npm install`
- Start dev:       `npm run dev`               # http://localhost:5174
- Build (local):   `npm run build`             # prebuild runs `scripts/fetch-library.mjs`; outputs `dist/`
- Build (Vercel):  `npm run build:vercel`      # same as build, used in `vercel.json` buildCommand
- Preview:         `npm run preview`           # http://localhost:4173
- Clean:           `npm run clean`             # wipes `dist/`, `dist-dev/`, `.vite/`

Node 20+ required (see `.nvmrc`). npm only — `package-lock.json` is the source of truth.

## Project layout

- `engine.html` — main engine, served at `/engine/` (the PWA entrypoint)
- `landing.html`, `campaign.html`, `personas.html`, `weddings.html`, `marketplace.html`, `make-video.html`, `intro.html`, `about.html`, `changelog.html`, `press.html`, `status.html`, `thanks.html`, `portfolio.html`, `tutorial-30s.html`, `interactive-howto.html`, `market-study.html`, `profit-plan.html` — marketing + educational surfaces
- `engine-*.client.js`, `presets*.client.js`, `pt*.client.js`, `persona-*.js`, `project.js`, `wizard.js`, `*.client.js` — browser subsystems; each `<name>.client.js` is global-script design (attaches to `window`), loaded via `defer`
- `audio-analysis-v2.js` — zero-deps BPM (autocorrelation) + key (Krumhansl-Schmuckler) + chromagram
- `fx-postprocess.js`, `video-fx.css` — 14-FX WebGL fullscreen-quad pipeline
- `pwa-bootstrap.js`, `sw.js`, `manifest.webmanifest`, `offline.html` — PWA shell
- `api/` — Vercel serverless handlers (auth, storage, projects, health) + `_lib/` shared helpers
- `auth/` — magic-link login + verify pages and their client scripts
- `client/`, `lib/` — shared browser client modules (visualizer-controller, auth, media-store, library-manager, library-switcher, migrate)
- `audios/` — per-engine demo MP3s (auto-loaded by each variant)
- `library/` — curated demo media (27 assets + `manifest.json`); populated at prebuild via `scripts/fetch-library.mjs` from `LIBRARY_BLOB_URL`
- `versions/` — 5 audio-reactive engine variants (neon, film, grid, smoke, hallucination) + injected scripts
- `preset-pipeline/` — Python daily generator (`generate.py`) + Node schema verifier (`verify.mjs`); CI calls `./cron.sh`
- `presets/` — JSON preset specs (one per file, append-only, daily-generated)
- `marketplace/curated/`, `portfolio/`, `press/`, `promo/`, `keyart/`, `icons/`, `legal/` — content
- `scripts/` — build / test / dev scripts (`check-syntax.mjs`, `check-manifest.mjs`, `build-magenta-dsp-bundle.sh`, `fetch-library.mjs`, `dev-api.mjs`, `test-api.mjs`, `upload-library.mjs`, `downsize-library.py`)
- `tools/` — dev tools (`deploy-vercel.sh`, `hf-publish.html`, `dev-up.sh`/`dev-ps.sh`/`dev-down.sh`, `freq-bridge.js`, `agentic-set.mjs`)
- `verify-*.mjs` — Puppeteer E2E suites at repo root (~80 files)
- `verify-screenshots/`, `out/`, `docs/` — research + audit artifacts
- `vite.config.js` — custom `copy-static` + `swrc-api-middleware` + `strip-absolute-module-scripts` plugins
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
- E2E: `npm run verify:<name>` (e.g. `verify:cloud-auth`, `verify:story-graph`, `verify:hallucination-story`, `verify:autoplay`, `verify:e2e-media-record`, `verify:music-video-maker`, `verify:weddings`); Puppeteer auto-logs-in via stored cookies when needed
- Each `verify-*.mjs` is standalone (no shared harness); they're discovered and run individually. Add a new `verify-<feature>.mjs` at repo root and wire it as `npm run verify:<feature>` in `package.json`
- After every sprint / non-trivial change, run the relevant E2E scripts before claiming done — typecheck + build do not catch runtime bugs (Canvas/WebGL/PWA/audio permission flows, infinite re-render loops, IndexedDB persistence, Vercel deploy quirks)
- `preset-pipeline/cron.sh` is the canonical daily-preset entry point; it generates then verifies
- **Env-skip pattern**: tests that need resources outside this repo (e.g. `verify:hf-publish` requires the sibling `~/Documents/autodashboard/magenta-dsp-procedural` source) print `(env skip: ...)` and pass when the resource is absent, matching the design intent of `scripts/build-magenta-dsp-bundle.sh:74-88`. Keep the marker literal so a real failure still surfaces

## PR & commit conventions

- Branch from `main`; never push to it directly
- Conventional commits (`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`); recent examples: `fix(hallucination): surface auto-loaded song`, `fix(deploy): capture stderr from vercel ls`
- Repo-local git config is unset — assistant commits ship as the global user (`kajica2 <kai.djuric@gmail.com>`). If you ever set a repo-local `user.name`/`user.email`, unset it (or pass `-c user.name=… -c user.email=…` on the commit) — Vercel blocks deploys whose GitHub committer identity is unknown
- GitHub Actions: `presets-daily.yml` runs the preset pipeline on a daily cron and auto-commits new presets; no standard CI yet (the `npm run check:full` gate is local)

## Security

- Never commit secrets — `.env` is in `.gitignore`; copy `.env.example` to `.env` for local dev
- API threat model is in `SECURITY.md`; key rules:
  - All storage goes through signed URLs scoped to `userId/...`; never bypass `/api/storage/sign-upload` / `sign-download`
  - `safeKey()` rejects keys with `..`, leading `/`, or `\` — keep this invariant
  - `swrc_session` cookie: HttpOnly, SameSite=Lax, Secure in production; 30-day rolling TTL
  - Rate limits on `/api/auth/magic` (10/min/IP), `/api/storage/sign-upload` (60/min/user), `sign-download` (120/min/user), `/api/projects` writes (30/min/user) — return 429 with `Retry-After`
  - `TRUSTED_PROXIES` must be set if deploying outside Vercel, otherwise `x-forwarded-for` is spoofable and bypasses the per-IP rate limit
- Vercel deploys are auto on push to `main`; the `library/` directory is curated at build time to stay under the 100MB Vercel Hobby cap
- **Production library fetch:** `scripts/fetch-library.mjs` runs in `prebuild` and downloads the curated library from `LIBRARY_BLOB_URL` (Vercel Blob). Without this env var the script logs "skipping" and ships an empty library — manifests/loop audio files 404, two-phase loader fires but `Lib.items` stays empty, and `verify:e2e-media-record` fails. Set `LIBRARY_BLOB_URL=https://<id>.public.blob.vercel-storage.com/library.tar.gz` in the Vercel project environment so the build pre-populates `library/`. Locally, missing `LIBRARY_BLOB_URL` is expected — the engine just has nothing to demo.
