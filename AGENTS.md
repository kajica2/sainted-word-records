# AGENTS.md

Algorithmic audio-reactive video engine. Drop in a song, drop in a library of videos / GIFs / images, get a reactive layered composition. Browser-native, Vercel-deployed, with a thin M1 serverless API for auth, storage, and projects.

## Setup commands

- Install deps:    `npm install`
- Start dev:       `npm run dev`               # http://localhost:5174
- Build (local):   `npm run build`             # `vite build` → `dist/`
- Preview:         `npm run preview`           # http://localhost:4173
- Clean:           `npm run clean`             # wipes `dist/`, `dist-dev/`, `.vite/`

Node 20+ required (`.nvmrc` → `20`; `engines` pins `node >=20`, `npm >=10`). npm only — `package-lock.json` is the source of truth.

## Project layout

- `engine.html` — main engine, served at `/engine/` (the PWA entrypoint). It is the **only** Rollup input in `vite.config.js`; every other page ships as a static copy.
- **Page families** (~85 root `*.html`). Beyond the individually-named pages below, root pages fall into families that are easy to miss: `gallery-*.html` (19), `landing-personas-v*.html` (11), `atlas-*.html` (9), `swr-*.html` (7), `persona-*`, `engine-*` (`engine-ar-loop.html`, `engine-demos.html`), plus `versions.html`, `spit.html`, `shop.html`, `photo.html`, `packs.html`, `dashboard.html`, `enhance.html`, `ar-gif.html`, `director-mode-sainted-word.html`, `video_single.html`, `sitemap.html`, `share-view.html`, `login.html`, `terms.html`, `404.html`, `offline.html`.
  - Marketing / educational surfaces: `landing.html`, `campaign.html`, `personas.html`, `marketplace.html`, `make-video.html`, `intro.html`, `about.html`, `changelog.html`, `press.html`, `status.html`, `thanks.html`, `portfolio.html`, `tutorial-30s.html`, `interactive-howto.html`. **`weddings.html` does not exist** (and there is no `verify:weddings` script) — do not trust older docs that list it.
  - `artists/` holds the artist-profile pages (`artists/*.html`, `artists/vodolija/`).
- `engine-*.client.js`, `presets*.client.js`, `pt*.client.js`, `persona-*.js`, `project.js`, `wizard.js`, `*.client.js` — browser subsystems; each `<name>.client.js` is global-script design (an IIFE attaching exactly one upper-case global to `window`), loaded via `defer`. `engine-core.client.js` is the extracted bootstrap that exposes `window.SWR` / `Audio` / `Library` / `Layers` / `Story` / `VISUAL_PRESETS`.
- `audio-analysis-v2.js` — zero-deps `window.AudioAnalysisV2` (`analyzeBuffer` / `startLive` / `chromagram`). BPM is an **inter-onset-interval histogram** over detected onsets (not autocorrelation); key is Krumhansl-Schmuckler.
- `fx-postprocess.js` — the WebGL fullscreen-quad FX pipeline (`window.FX.state`). `FX.setPersona()` consumes exactly **14 fields** (`temp`, `mut`, `mutAlgo`, `posterize`, `vignette`, `chroma`, `grain`, `sepia`, `glow`, `grayscale`, `blur`, `liquid`, `pearl`, `glitch`); preset `fx_state` blocks carry **15 keys** — those 14 plus compositor-only `bloom`, which the shader path deliberately drops. Honours the master `FX.intensity` multiplier (0–1, render-time only — never written into state) exposed by `lib/intensity-slider.client.js` and persisted via `swr.fx.intensity`. Consumes `window.SWR._fxOverride` so automix presets can drive the pipeline.
- `video-fx.css` — **not** part of the WebGL pipeline: a standalone CSS filter/animation library of 20 numbered effects (`.kenburns` … `.loop-pingpong`).
- `pwa-bootstrap.js`, `sw.js`, `manifest.webmanifest`, `offline.html` — PWA shell. `sw.js` precaches the app shell (cache version `swr-v4`); the manifest's `start_url` / `scope` are `/engine/`.
- `api/` — 12 Vercel serverless handlers: `auth/{magic,verify,session}.js`, `storage/{object,sign-upload,sign-download}.js`, `projects/{index,[id],share/[shareId]}.js`, `users/[id].js`, `manifest.js`, `hf-upload.js`, plus `_lib/{db,email,http,session}.js`. **There is no `api/health.js`** — the health probe was folded (P3.8) into `manifest.js?action=health`, and `scripts/dev-api.mjs` rewrites `/api/health` to the manifest handler so callers keep working. `_lib/db.js` switches between Postgres + Vercel Blob and local-FS/JSON.
- `auth/` — magic-link `login.html` + `login.client.js` and `verify.html` + `verify.client.js`.
- **`lib/` (51 files) and `client/` (55 files + `client/vendor/`)** are two distinct trees, not one pool:
  - `lib/` — engine primitives and plumbing: `audio.client.js`, `media-feat.client.js` (canonical 12-field audio feat extraction from any media element, `SWR_MEDIA_FEAT.attach(el)`, used by tape for real automix features), `media-store`, `gif-decoder`, `recorder*`, `persist*`, `library-persist`, `playlist`, `storage`, `migrate`, `reset-state`, `tier-runtime`, `adaptive-guard`, `intensity-slider.client.js` (two-way FX master intensity control), the design assets `design-tokens.css` / `design-base.css` / `components.css`, and vendored `three.module.min.js` / `omggif.js` / `mp4-muxer.js`.
  - `client/` — higher-level feature stacks: automix (`automix-runtime`, `automix-arc`, `automix-composition`, `automix-session-store`, `preset-anchor-map`, `last-mix-store`), live media (`swr-media-input`, `swr-camera-preview`, `swr-mic-meter`, `swr-spit-runtime`, `swr-spit-fx`, `capture-runtime`), storyboard (`storyboard*.client.js`), dashboard (`dashboard-engine*`, `dashboard-presets`, `dashboard-recorder`), mesh (`meshify`, `mesh-renderer`, `mesh-scene`), `visualizer-controller.js` (loaded by the artistic variants, **not** from `lib/`), and page controllers (`dropzone`, `asset-curator`, `variant-switcher`, `library-packs`, `default-library`).
  - Two nav modules exist but only one is live: `lib/nav.client.js` — loaded by **112 pages** — defines the `<swr-nav>` Web Component + `window.SWR_NAV` (nav data fetched from `/site-map.json`); root `nav.client.js` is a separate self-contained header injector guarded by `window.__swrTopnav` that **no page loads any more** (it survives in Vite's `rootFiles` list and in a `personas.html` comment). A bare `grep nav.client.js` matches both — check which one the page in front of you actually links.
- `audios/` — per-engine demo MP3s (auto-loaded by each variant). The curated demo asset library (`library/`) has been removed and is `.gitignore`d — users bring their own assets via the Media Manager upload affordance. `default-library/` seeds the 7 default textures.
- `versions/` — 29 `*.html`: the **5 core variants** (neon, film, grid, smoke, hallucination), the **17 artistic preset variants** (aurora, baroque, chrome, collage, echo-manifold, eclipse, fractal, glitch, kraft, mosaic, phosphor, pulse, spectrum, tape, typography, void, watercolor), and **7 non-variant pages** (`index.html`, `gallery.html`, `console.html`, `bachdrop.html`, `music_video.html`, `music_video_mtv.html`, `music-video-gallery.html` — `music_video.html` is the 3D-hologram reference implementation, `music-video-gallery.html` the multi-video gallery, `index.html` the visual-language index).
- The automix + curator stack (originally shipped only on `music_video.html`) is wired into 16 of the 17 artistic variants via `variants/<name>.automix.json` — `echo-manifold` is the sole `enabled: false` opt-out because it has no FX surface at all (its visuals are its own generative canvas with no `fx_state` uniforms, so automix presets would have nothing to drive). `tape` was the other opt-out until the audio-feature gap was closed: it now extracts canonical features via `lib/media-feat.client.js` attached to its loaded media element (the old synthesised features remain the no-audio fallback).
- **`versions/_shared.css`** — shared stylesheet for the marketing-style visual-language pages. Loaded **only** by `versions/index.html` and `versions/console.html`; not loaded by engine variants. Page-specific tokens live in each page's `:root`.
- `versions/_*.js` — 12 standalone Node codemod scripts (render/library/shuffle injectors; the 13th `_*` file is `_shared.css`). They are **not loaded by any page**; run them manually (`node versions/_render-inject.js`).
- `variants/` — per-variant automix + curator config maps (one JSON per variant, 17 files). Inlined into the matching `versions/<name>.html` at build time by the `inline-automix-config` Vite plugin (as `<script type="application/json" id="swrc-automix-config">` — that id does not exist in source), so configs never need a runtime fetch (offline-first, matches the PWA shell ethos).
- `site-map.json` — canonical IA. Top-level keys: `nav`, `footer`, `auth`, `legal`, `tools`, `archived`, `meta`, `discovered` (108 auto-discovered pages), plus `_maintenance` prose. Source of truth for `vercel.json` rewrites and Vite `rootFiles`. `archived` is currently **empty** — nothing is archived, even though `_archive/` holds 26 older files. Edit this, then run `scripts/generate-vercel-rewrites.mjs` to regenerate `vercel.json`.
- `_archive/` — gitignored experimental pages (landing-personas variants, internal docs, dev tools, an older `404.html`/`offline.html`). Excluded from deploy.
- `score-app/` — a **separate Expo / React Native app** vendored in-repo for local dev only (its own `package.json`, `node_modules`, `app.json`, and agent files). It is `.gitignore`d and must never be part of the Vite + Vercel static deploy; its `node_modules` would blow past the size cap.
- `.worktrees/` — gitignored worktrees for in-progress parallel work.
- `public/` — gitignored and **stale**: Vite copies `public/*` into `dist` every build, then the `copy-static` plugin re-copies the canonical root files in `closeBundle`, so root always wins. Edit root files, never `public/`.
- Heavy media dirs are gitignored and mostly not part of the deploy: `launch/`, `items_/`, `keyart/`, `style-graphics/`, `style-videos*`, plus unreviewed candidate folders (`gallery-vintage/_candidates*/`, `shotlist/_candidates*/`, `artists/vodolija/_candidates*/`). **`keyart/` is the exception**: the `.gitignore:35` pattern is overridden by 38 force-tracked files (19 `.svg` + 19 `.png`, ~7MB) that *do* ship, while the other 21 files (~33MB of the 41MB local total) are untracked.

## Site-map & shared design system

The project uses a single-source-of-truth IA in `site-map.json` and shared design tokens/components loaded by every page:

- **`lib/design-tokens.css`** — CSS custom properties (colors, fonts, spacing, shadows) for light + dark themes. Loaded via `<link rel="stylesheet" href="/lib/design-tokens.css">`
- **`lib/components.css`** — shared component classes (`.btn`, `.card`, `.tile`, `.nav`, `.footer`, etc.) extracted from `landing.html`. Loaded via `<link rel="stylesheet" href="/lib/components.css">`
- **`lib/nav.client.js`** — `<swr-nav>` Web Component + `window.SWR_NAV` API. Fetches `/site-map.json` and renders a sticky top nav with theme toggle, dropdowns, and active state. Loaded via `<script src="/lib/nav.client.js" defer></script>` (112 pages)

### Build automation scripts

- `scripts/generate-site-manifest.mjs` — auto-discover HTML pages, populate `site-map.json`. Run with `--dry-run` to preview
- `scripts/generate-vercel-rewrites.mjs` — generate `vercel.json` rewrites from `site-map.json`. Run after editing `site-map.json`
- `scripts/archive-pages.mjs` — move pages in `site-map.json`'s `"archived"` array to `_archive/`. Run with `--dry-run` first
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

### Repo contents & tooling

- `preset-pipeline/` — Python daily generator (`generate.py`) + Node schema verifier (`verify.mjs`). Local-only: `./cron.sh` runs on the dev box and does generate → verify → `git commit` + `push origin main` (the GitHub Action that previously auto-committed was removed 2026-09-20; `.github/workflows/` now holds only `ci.yml`). New presets need to be committed by hand after generation
- `presets/` — JSON preset specs (one per file, append-only, daily-generated)
- Content dirs: `marketplace/curated/`, `portfolio/`, `press/`, `promo/`, `keyart/`, `icons/`, `legal/`, `logos/`, `media/`, `reels/`, `shop-designs/`, `shotlist/`, `marketing/`, `personas/`, `packs/`, `videos/`, `gallery-vintage/`
- `scripts/` — 97 build / test / dev scripts (`check-syntax.mjs`, `check-*-unit.mjs`, `check-*-smoke.mjs`, `run-steps.mjs`, `with-dist.mjs`, `dev-api.mjs`, `test-api.mjs`, `build-magenta-dsp-bundle.sh`, `lib/verify-runner.mjs`)
- `tools/` — 21 dev tools (`deploy-vercel.sh`, `worktree.sh`, `hf-publish.html`, `dev-up.sh`/`dev-ps.sh`/`dev-down.sh`, `freq-bridge.js`, `osc-bridge.py`, `agentic-set.mjs`, `manifest-editor.client.js`/`.html`, `mobile/`)
- `verify-*.mjs` — Puppeteer E2E suites at repo root (124 files; 11 are automix-related — one per surface plus `verify-automix-cross-surface.mjs` and `verify-automix-arc-displacement.mjs`). Reachability is not obvious from the filename: **51 of the 112 npm scripts are invoked by no gate** — a script counts as gated only when its name, or the script file it runs, appears in some `run-steps` group listing, in `scripts/check-verify-smoke.mjs`, or in `ci.yml`. Re-measure rather than assuming the `check:` prefix means membership: `node scripts/run-steps.mjs <group> --list` lists the groups. `.kai/conventions/testing.md` is **stale** (it cites a nonexistent `check:manifest` and does not name the curated 5) — prefer `scripts/check-verify-smoke.mjs` and `docs/CI-VERIFY-STRATEGY.md` as the authority
- `verify-screenshots/`, `out/`, `docs/` (119 files), `output/` — research + audit artifacts
- `vite.config.js` — 6 custom plugins: `copy-static`, `swrc-api-middleware`, `strip-absolute-module-scripts`, `engine-layout-inject`, `audio-damp-inject`, `inline-automix-config`. `copyStatic` copies `versions/`, a `dirs[]` table and a `rootFiles` list (`SITE_MAP_ROOT_FILES` derived from `site-map.json` + hardcoded extras) in both `buildStart` and `closeBundle`; Rollup `input` is `engine.html` only
- `vercel.json` — Vercel rewrites generated from `site-map.json` (`/` → `landing.html`, `/engine` and `/engine/` → `engine.html`, …) + headers

## Code style

- Vanilla JavaScript, ESM (`"type": "module"` in `package.json`). **No TypeScript.**
- 2-space indent, LF line endings, UTF-8, final newline, trim trailing whitespace (`.editorconfig`); lockfiles and `*.md` are exempt
- No ESLint, no Prettier — follow the surrounding style in each file. Match the existing module pattern: `<name>.client.js` is global-script; shared helpers live in `lib/`; serverless handlers live in `api/<route>.js` with shared code in `api/_lib/`
- Single quotes, `'use strict'` not needed (ESM), prefer `const`/`let`, async/await over callbacks
- File names are descriptive kebab-case; engine subsystems use the `engine-<subsystem>.client.js` convention
- `engine.html` (and most pages) reference scripts with absolute paths (e.g. `/pwa-bootstrap.js`); a Vite plugin strips `type="module"` from those so they load as plain defer'd scripts — do not re-add `type="module"` to absolute-path scripts in any `*.html`

## Testing instructions

- `check`, `check:full` and `check:storyboard` all route through `scripts/run-steps.mjs`, which executes every step in a named group and exits non-zero if ANY failed. They deliberately do **not** use `&&` chains: a chain short-circuits, so the first failure silently skipped every later step. That was not hypothetical — `check:full` truncated at `check:verify` (CI run 36323771785), silently skipping `check:automix-smoke`, `check:automix-arc-smoke`, `check:storyboard`, `verify:automix`, `check:capture-smoke`, `check:media-input-smoke` and `check:spit-live-smoke`; and `check` used to be an `&&` chain, so an early failure hid up to 38 suites. `node scripts/run-steps.mjs <check|storyboard|full> [--list]` runs or lists a group; `STEPS_ONLY=a,b` runs a subset. Groups contain exactly: `check` **39 steps**, `storyboard` **5 steps**, `full` **11 steps**.
- Quick gate: `npm run check` → the 39-step group (syntax + bundle + the unit suites + API tests + the smokes that need no browser interaction)
- Full pre-PR gate: `npm run check:full` → the 11-step group: `check` + `check:verify` + `check:automix-smoke` + `check:automix-arc-smoke` + `check:storyboard` + `verify:automix` + `verify:genops` + `verify:story-graph` + `check:capture-smoke` + `check:media-input-smoke` + `check:spit-live-smoke`
- `check:verify` — the curated 5-verifier smoke that gates PRs. The 5 are fixed in `scripts/check-verify-smoke.mjs`: `cloud-auth`, `hf-publish`, `rotation-enabled`, `autoplay`, `e2e-media-record` (API · admin UI · engine mount · feature smoke · recorder cycle). It bootstraps a Vite dev server on `:5175` with a temp `SWRC_DATA_DIR`. Every other `verify-*.mjs` is a developer aid run on demand
- `check:capture-unit` / `check:capture-smoke` — node:vm unit coverage and a Puppeteer smoke against built `dist/engine` for the periodic frame capture runtime (URL parse, localStorage, clamp, state machine, blob trigger; toolbar mount, toggle flow, interval two-way binding, URL opt-in). Unit in `check`; smoke in `check:full`
- `check:media-input-unit` / `check:media-input-smoke` — live-camera-mic foundation (MediaInput factory + codec + audio features, Camera Preview + Mic Meter contracts); smoke verifies the 3 module globals load and the factory returns an instance, skipping real camera/mic permissions. Unit in `check`; smoke in `check:full`
- `check:spit-live-unit` / `check:spit-live-smoke` — Spit Live page (`SWR_SPIT` factory + state machine + loadBeat/toggleMic/triggerFx, `SWR_SPIT_FX` validation + concurrency); smoke runs against built `dist/spit`. Unit in `check`; smoke in `check:full`
- E2E: `npm run verify:<name>` (e.g. `verify:cloud-auth`, `verify:story-graph`, `verify:hallucination-story`, `verify:autoplay`, `verify:e2e-media-record`, `verify:music-video-maker`, `verify:site-nav`); Puppeteer auto-logs-in via stored cookies when needed
- `verify:site-nav` — smoke test for the unified navigation system. Crawls every nav URL from `site-map.json`, verifies shared CSS/JS loads, checks archived pages return 404
- Each `verify-*.mjs` is standalone (no shared harness, though `scripts/lib/verify-runner.mjs` provides timeouts/`before` hooks for the curated set); they're discovered and run individually. Add a new `verify-<feature>.mjs` at repo root and wire it as `npm run verify:<feature>` in `package.json`
- `ensureDist()` from `scripts/with-dist.mjs` is what smoke scripts use instead of a manual build: it compares mtimes of `lib/ client/ versions/ packs/ default-library/ audios/` + a root-file list against `dist/engine.html` and runs `npm run build` only when dist is missing or stale
- After every sprint / non-trivial change, run the relevant E2E scripts before claiming done — typecheck + build do not catch runtime bugs (Canvas/WebGL/PWA/audio permission flows, infinite re-render loops, IndexedDB persistence, Vercel deploy quirks)
- `preset-pipeline/cron.sh` is the canonical daily-preset entry point; it generates then verifies
- **Env-skip pattern**: tests that need resources outside this repo (e.g. `verify:hf-publish` requires the sibling `~/Documents/autodashboard/magenta-dsp-procedural` source) print `(env skip: ...)` and pass when the resource is absent, matching the design intent of `scripts/build-magenta-dsp-bundle.sh:74-88`. Keep the marker literal so a real failure still surfaces

## PR & commit conventions

- Branch from `main`; never push to it directly
- Conventional commits (`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`); recent examples: `fix(hallucination): surface auto-loaded song`, `fix(deploy): capture stderr from vercel ls`
- Repo-local git config is unset — assistant commits ship as the global user (`kajica2 <kai.djuric@gmail.com>`). If you ever set a repo-local `user.name`/`user.email`, unset it (or pass `-c user.name=… -c user.email=…` on the commit) — Vercel blocks deploys whose GitHub committer identity is unknown
- GitHub Actions: `.github/workflows/ci.yml` is the only workflow. It runs on PRs against `main` and pushes to **non-main** branches (`branches-ignore: main`, so a direct push to main does not trigger it), with `timeout-minutes: 20`. Steps: `npm ci` → `npm run check:full` → `npm run check:automix-arc-smoke` (its own step) → `npm run verify:transitions` → `npm run verify:automix-cross-surface` → `npm run build` → build-size budget `≤ 130MB` (136,314,880 bytes, counted with `find dist -type f -printf '%s\n' | awk '{s+=$1}'`). Preset pipeline is local-only (`./preset-pipeline/cron.sh`)

## Security

- Never commit secrets — `.env` is in `.gitignore`; copy `.env.example` to `.env` for local dev
- API threat model is in `SECURITY.md`; key rules:
  - All storage goes through signed URLs scoped to `userId/...`; never bypass `/api/storage/sign-upload` / `sign-download`
  - `safeKey()` rejects keys with `..`, leading `/`, or `\` — keep this invariant
  - `swrc_session` cookie: HttpOnly, SameSite=Lax, Secure in production; 30-day rolling TTL
  - Rate limits on `/api/auth/magic` (10/min/IP), `/api/storage/sign-upload` (60/min/user), `sign-download` (120/min/user), `/api/projects` writes (30/min/user) — return 429 with `Retry-After`
  - `TRUSTED_PROXIES` must be set if deploying outside Vercel, otherwise `x-forwarded-for` is spoofable and bypasses the per-IP rate limit
- Vercel deploys are auto on push to `main`. Build size: **measure it the way CI does** (`find dist -type f -printf '%s\n' | awk '{s+=$1} END {print s}'`) on a *clean* build — CI reports ~66MB byte-sum against a ≤130MB budget. A local `dist/` can be far larger (99.5MB byte-sum / 119MB block-padded measured 2026-09-27; 101MB on disk 2026-09-27) because most of `keyart/` is untracked under the `.gitignore:35` pattern (only 38 of 59 files, ~7MB, are force-tracked) — so the local copy is ~41MB while CI/Vercel copy ~7MB. Do not quote a local `du` as the deployed size.
