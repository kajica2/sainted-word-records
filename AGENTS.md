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
- **Page families** (~85 root `*.html`). Beyond the individually-named pages below, root pages fall into families that are easy to miss: `gallery-*.html` (19), `landing-personas-v*.html` (6 — v7–v11 archived 2026-09-29, 301 → /personas), `atlas-*.html` (9), `swr-*.html` (7), `persona-*`, `engine-*` (`engine-demos.html`), plus `versions.html`, `spit.html`, `shop.html`, `photo.html`, `packs.html`, `dashboard.html`, `enhance.html`, `ar-gif.html`, `director-mode-sainted-word.html`, `preset-editor.html`, `sitemap.html`, `share-view.html`, `login.html`, `terms.html`, `404.html`, `offline.html`. (`video_single.html` was deleted; its route still 301s to `/versions` via `site-map.json`'s `redirects`.)
  - Marketing / educational surfaces: `landing.html`, `campaign.html`, `personas.html`, `marketplace.html`, `make-video.html`, `intro.html`, `about.html`, `changelog.html`, `generations.html`, `press.html`, `status.html`, `thanks.html`, `portfolio.html`, `tutorial-30s.html`, `interactive-howto.html`. **`weddings.html` does not exist** (and there is no `verify:weddings` script) — do not trust older docs that list it.
  - `artists/` holds the artist-profile pages (`artists/*.html`, `artists/vodolija/`).
- `engine-*.client.js`, `presets*.client.js`, `pt*.client.js`, `persona-*.js`, `project.js`, `wizard.js`, `*.client.js` — browser subsystems; each `<name>.client.js` is global-script design (an IIFE attaching exactly one upper-case global to `window`), loaded via `defer`. `engine-reel.client.js` is the auto-advance demo-reel player (`window.SWR_REEL`), loaded by `engine.html` next to `swr-sets.js`; its gate is `check:reel-unit` (in `check`). The engine itself is the inline `<script type="module">` in `engine.html` (`window.SWR` is assembled inside it at ≈L5432). There is no extracted core module.
- `audio-analysis-v2.js` — zero-deps `window.AudioAnalysisV2` (`analyzeBuffer` / `startLive` / `chromagram`). BPM is an **inter-onset-interval histogram** over detected onsets (not autocorrelation); key is Krumhansl-Schmuckler.
- `fx-postprocess.js` — the WebGL fullscreen-quad FX pipeline (`window.FX.state`). `FX.setPersona()` consumes **15 fields** (`temp`, `mut`, `mutAlgo`, `posterize`, `vignette`, `chroma`, `grain`, `sepia`, `glow`, `grayscale`, `blur`, `liquid`, `pearl`, `glitch`, `tone`); preset `fx_state` blocks carry **15 keys** — the classic 14 plus compositor-only `bloom` (dropped by the shader path) — and `tone` is an optional 16th the shader path honours. Honours the master `FX.intensity` multiplier (0–1, render-time only — never written into state) exposed by `lib/intensity-slider.client.js` and persisted via `swr.fx.intensity`. A sibling `lib/tone-slider.client.js` drives the `u_tone` tone/desaturation grade (warm highlights, cool shadows) via `swr.fx.tone` / `FX.setTone`; on versions-presets pages it mirrors onto `window.SWR_FX_TONE`. Consumes `window.SWR._fxOverride` so automix presets can drive the pipeline.
- `video-fx.css` — **not** part of the WebGL pipeline: a standalone CSS filter/animation library of 20 numbered effects (`.kenburns` … `.loop-pingpong`).
- `pwa-bootstrap.js`, `sw.js`, `manifest.webmanifest`, `offline.html` — PWA shell. `sw.js` precaches the app shell (cache version `swr-v4`); the manifest's `start_url` / `scope` are `/engine/`.
- `api/` — **39** Vercel serverless route files (`find api -name '*.js' -not -path '*_lib*' | wc -l`), grouped as `auth/{magic,verify,session,google}.js` + `auth/google/callback.js`, `storage/{object,sign-upload,sign-download}.js`, `projects/{index,[id],share/[shareId]}.js`, `users/[id].js`, `manifest.js`, `hf-upload.js`, plus the product trees `catalogue/`, `kits/`, `drive/`, `slots/`, `invite/`, `pt/`, `checkout/`, `bookings/`, `connect/`, `library/`, `license/`, `marketplace/`, `admin/`, `webhooks/`, and `_lib/{db,email,http,session,google}.js`. **There is no `api/health.js`** — the health probe was folded (P3.8) into `manifest.js?action=health`, and `scripts/dev-api.mjs` rewrites `/api/health` to the manifest handler so callers keep working. `_lib/db.js` switches between Postgres + Vercel Blob and local-FS/JSON.
  - **Google sign-in (`api/_lib/google.js`)** — `GET /api/auth/google?intent=signin|drive` starts the flow: it builds the consent URL, signs a `state` with HMAC-SHA256 (`GOOGLE_CLIENT_SECRET`, 10-minute TTL, timing-safe compare) and carries the same-origin return path, the flow mode and the exact `redirect_uri` in it. `POST /api/auth/google` exchanges the code: **no session → resolve the user (provider account → email → create) and issue a session cookie; a session → link Drive.** Drive scopes (`drive.readonly`) and offline tokens are requested **only** for `intent=drive`, and Drive tokens are stored only in that branch. The registered redirect URI is `api/auth/google/callback.js`: it verifies the state, exchanges, signs in, sets the cookie and 302s to the sanitised return path (`?auth=google`); in `mode=popup` it answers with a page that `postMessage`s `swr-google-oauth-callback`. Unconfigured → 302 `/auth/login?error=google_oauth_not_configured`. Gate: `check:auth-google-signin-unit`.
- `auth/` — magic-link `login.html` + `login.client.js` and `verify.html` + `verify.client.js`; `auth/google-callback.html` is the page form of the Google callback (it posts the code to `/api/auth/google` instead of exchanging it server-side).
- **`lib/` (83 `.js`/`.css` files, `ls lib/*.js lib/*.css | wc -l`) and `client/` (89 `.js` files + `client/vendor/`)** are two distinct trees, not one pool:
  - `lib/` — engine primitives and plumbing: `audio.client.js` (the audio engine: the `MediaElementAudioSourceNode` is built on `loadedmetadata`/`canplay` and cached per element, the **clock** is the element that carries the audio — the media element, or the external file when one is loaded — and the bar counter, the beat timestamps and the beat phase all read that clock instead of a wall clock; `setAudioSource('video'|'external'|'none')`, `loadExternalAudio(file)`, `setSync(bool)` and `setOffsetMs(ms)` are the Media Source panel's verbs, and every change fires the `swr:media-source` window event), `media-feat.client.js` (canonical 12-field audio feat extraction from any media element, `SWR_MEDIA_FEAT.attach(el)`, used by tape for real automix features), `media-store`, `gif-decoder`, `recorder*`, `persist*`, `library-persist`, `playlist`, `storage`, `migrate`, `reset-state`, `tier-runtime`, `adaptive-guard`, `intensity-slider.client.js` (two-way FX master intensity control), `announcements.client.js` (the auto-post feed — reads `site-map.json`'s `announcements` from the inlined `#swr-footer-data` slice, or from `/site-map.json` when the slice is absent, and paints every `[data-announcements]` container; the newest post also leads the footer's bottom bar), `song-video-layer.client.js` (a **video song becomes a layer**: it adds the song's own `<video>` element to the layer stack and marks the asset `songBound`, so the picture and the sound are one clock — the element is shared, never a second one, so play/pause/seek/rate move both together), the design assets `design-tokens.css` / `design-base.css` / `components.css`, and vendored `three.module.min.js` / `omggif.js` / `mp4-muxer.js`.
  - **`client/engine-debugger.client.js`** — the SWR **visual debugger**: a standalone overlay (`window.SWR_DEBUGGER`) that exposes the engine's live internal state — audio features, the layer stack, each layer's resolved transform, the reactor wiring, per-layer geometry drawn on the stage canvas, and the loaded module registry. It is **not loaded by any page**; it is injected on demand (bookmarklet, console paste, CDP) and works on any page that exposes `window.SWR` + `window.SWR_RENDER`. It observes the engine through two existing seams — the `applyR` argument of `SWR_RENDER.frame` and the exported `SWR_RENDER.imageEvolve` — and forwards both unchanged, so it adds no calls into the engine's stateful audio damper and cannot alter what the engine renders. See "SWR visual debugger" below.
  - `client/` — higher-level feature stacks: automix (`automix-runtime`, `automix-arc`, `automix-composition`, `automix-session-store`, `preset-anchor-map`, `last-mix-store`), live media (`swr-media-input`, `swr-camera-preview`, `swr-mic-meter`, `swr-spit-runtime`, `swr-spit-fx`, `capture-runtime`), storyboard (`storyboard*.client.js`), dashboard (`dashboard-engine*`, `dashboard-presets` — publishes `window.__SWR_LAYER_PRESETS`, *not* the `window.__SWR_PRESETS` preset catalogue from `versions-presets.js`), mesh (`meshify`, `mesh-renderer`, `mesh-scene`), `visualizer-controller.js` (loaded by the artistic variants, **not** from `lib/`), `looks-menu.client.js` (the engine's grouped **looks** dropdown — see below), `media-grouping.client.js` (the ONE rule for "which media belong together" — videos grouped by filename prefix, every static graphic in one group; shared by the media panel's group-by-name toggle and the automix layer pool), `media-source.client.js` (the engine's **Media Source** panel — `window.SWR_MEDIA_SOURCE`, mounted into `#media-source` at the top of the library panel: the loaded media, the audio source (the video's own track / an external file / none), the sync toggle and the audio offset in ms; it owns no audio graph, it drives `window.Audio` and listens for the engine's `swr:media-source` event), and page controllers (`dropzone`, `asset-curator`, `variant-switcher`, `library-packs`, `default-library`).
  - **`client/looks-menu.client.js`** — the engine's `#looks` select: one control listing every shipped look in three `<optgroup>`s. Exists because **three unsynchronised catalogues** were previously reachable by no single control — (1) `#variant` (5 entries, `neon/film/grid/smoke/hallucination`, the only ones `variant-switcher` can drive since it `fetch`es `/versions/<id>.html` and compiles that page's `drawFx` verbatim), (2) `#preset` (5 entries backed by `engine.html`'s private `VISUAL_PRESETS` — reactors/blends, not a grade), (3) `versions-presets.js`'s 23 grade presets, which the version pages read but **no engine control exposed**. The dropdown maps them 1:1: **Variant looks** → `SWR_VARIANTS.activate()`, **Grade presets** → `FX.setPersona()` (plus slider mirroring; the FX keys `temp`/`mut` are `#temperature`/`#mutations` in the DOM), **Motion presets** → sets `#preset` and dispatches `change`. Option values are group-qualified (`grade:aurora`) because `film, grid, neon, smoke, hallucination` exist in two groups at once. `gallery` and `mtv` are excluded from Grade presets by `GRADE_EXCLUDE`. The 17 artistic variants are **not** listed — variant-switcher cannot drive them without authoring 17 new `VARIANTS` records.
  - **`versions-presets.js` data-only mode** — `window.SWR_PRESETS_DATA_ONLY = 1` (set by `engine.html` before the script tag) makes the module expose `window.__SWR_PRESETS` and return **before** `init()`, because the engine already drives `#fx-canvas` via `fx-postprocess.js` and a second WebGL overlay would steal the canvas or stack two FX passes. Without this the engine would render with duplicated post-processing.
  - Two nav modules exist but only one is live: `lib/nav.client.js` — loaded by **112 pages** — defines the `<swr-nav>` Web Component + `window.SWR_NAV` (nav data fetched from `/site-map.json`); root `nav.client.js` is a separate self-contained header injector guarded by `window.__swrTopnav` that **no page loads any more** (it survives in Vite's `rootFiles` list and in a `personas.html` comment). A bare `grep nav.client.js` matches both — check which one the page in front of you actually links.
- `audios/` — per-engine demo MP3s (auto-loaded by each variant). The curated demo asset library (`library/`) has been removed and is `.gitignore`d — users bring their own assets via the Media Manager upload affordance. `default-library/` seeds the 7 default textures.
- `versions/` — 32 `*.html`. The actual count (run `ls versions/*.html | wc -l`): **5 core** (neon, film, smoke, hallucination, music_video), **9 artistic-preset** (glitch, aurora, pulse, void, chrome, watercolor, fractal, eclipse, music_video_mtv), **9 decorative** (baroque, collage, echo-manifold, kraft, mosaic, phosphor, spectrum, tape, typography), and **9 content pages** (index, console, gallery, music-video-gallery, bachdrop, clean, simple, temple-of-control, engines). The earlier count "29" (5 core + 17 artistic + 7 non-variant) is stale — the taxonomy drifted. See `client/variant-switcher.client.js` for the 22-entry `VARIANTS` table that drives the engine dropdown.
- The automix + curator stack (originally shipped only on `music_video.html`) is wired into 16 of the 17 artistic variants via `variants/<name>.automix.json` — `echo-manifold` is the sole `enabled: false` opt-out because it has no FX surface at all (its visuals are its own generative canvas with no `fx_state` uniforms, so automix presets would have nothing to drive). `tape` was the other opt-out until the audio-feature gap was closed: it now extracts canonical features via `lib/media-feat.client.js` attached to its loaded media element (the old synthesised features remain the no-audio fallback).
- **`versions/_shared.css`** — shared stylesheet for the marketing-style visual-language pages. Loaded **only** by `versions/index.html` and `versions/console.html`; not loaded by engine variants. Page-specific tokens live in each page's `:root`.
- `versions/_*.js` — 19 standalone Node codemod scripts (render/library/shuffle/tone-slider injectors; the 20th `_*` file is `_shared.css`, the stylesheet). They are **not loaded by any page**; run them manually (`node versions/_render-inject.js`). Each adds a `SWR-*-MARKER` comment to pages it touches; `scripts/check-variant-codemods.mjs` runs each in dry-run mode and reports drift.
- `variants/` — per-variant automix + curator config maps (one JSON per variant, 17 files). Inlined into the matching `versions/<name>.html` at build time by the `inline-automix-config` Vite plugin (as `<script type="application/json" id="swrc-automix-config">` — that id does not exist in source), so configs never need a runtime fetch (offline-first, matches the PWA shell ethos).
- `site-map.json` — canonical IA. Top-level keys: `nav`, `footer`, `footerNav` (the shared footer's columns/tagline/social, consumed by `lib/footer.client.js` — `footer` itself is the three-item nav CTA data), `auth`, `legal`, `tools`, `redirects` (declared 301s, emitted by `generate-vercel-rewrites.mjs` before the archived 404s), `unlisted` (shipped pages deliberately kept OUT of the navigation — owner request 2026-09-29 removed Make a video / Photo studio / Enhance / Atlas / Galleries / Artists / Shop from the nav; both `generate-vercel-rewrites.mjs` and `vite.config.js`'s rootFiles read this array, so an unlisted page keeps its route AND still ships — dropping a page from the nav without adding it here leaves a rewrite pointing at a file that never reaches `dist/`, which `check-dist-links` catches), `announcements` (the auto-post feed — an array of `{date, title, body, href, label}`; the first entry is the newest and it is published site-wide by `lib/announcements.client.js`: the footer's bottom bar shows it as "New — …" and every `[data-announcements]` container (the changelog, the marketplace) paints the list; publishing is adding an entry and deploying, never an HTML edit), `store` (the storefront — `gumroad` (the store URL/label/description), `downloads[]` (the products sold as downloads: `source` (the repo dirs to package), `price`, `gumroadUrl` (the checkout page), `downloadUrl` (the off-site file URL once published)) and `products[]` (the Stripe products: `surface` — `shop` or `campaign` — and `stripeUrl` (the Payment Link)); the catalogue is published by `lib/store.client.js`, so adding a product to this block puts it on the marketplace with no HTML edit), `archived`, `meta`, `discovered` (140 auto-discovered pages), plus `_maintenance` prose. Source of truth for `vercel.json` rewrites and Vite `rootFiles`. `archived` is currently **empty** — nothing is archived, even though `_archive/` holds 26 older files. `discovered` is **informational only** — nothing derives rewrites or `rootFiles` from it — but `sitemap.html` renders every entry as a live link, so a stale entry or a page that does not ship becomes a 404. `scripts/generate-site-manifest.mjs` rebuilds the bucket from the tracked tree (gitignore-aware, sorted, pruned) and skips the tracked pages that are deliberately not deployed: `market-study.html`, `profit-plan.html`, `engine-ar-loop.html`, `booking.html`, `super-admin.html`, and everything under `scripts/` (`scripts/_analyze-stub.html`, `scripts/_grade-smoke-fixture.html`), `pages/`, `packs/covers/` and `swr-pipeline/`. Those five extra names are tracked but have no deploy route — no `site-map` entry, so vite's copy-static never copies them into `dist/` and no rewrite points at them; listing them in `discovered` would render dead links on `sitemap.html` (`check-dist-links` asserts every `site-map` entry resolves). Run it after adding or removing a page; it also refreshes `meta.totalPages` (deployable tracked pages, currently 171). Then run `scripts/generate-vercel-rewrites.mjs` to regenerate `vercel.json`.
- `_archive/` — gitignored experimental pages (landing-personas variants, internal docs, dev tools, an older `404.html`/`offline.html`). Excluded from deploy.
- `score-app/` — a **separate Expo / React Native app** vendored in-repo for local dev only (its own `package.json`, `node_modules`, `app.json`, and agent files). It is `.gitignore`d and must never be part of the Vite + Vercel static deploy; its `node_modules` would blow past the size cap.
- `.worktrees/` — gitignored worktrees for in-progress parallel work.
- `public/` — gitignored and **stale**: Vite copies `public/*` into `dist` every build, then the `copy-static` plugin re-copies the canonical root files in `closeBundle`, so root always wins. Edit root files, never `public/`.
- Heavy media dirs are gitignored and mostly not part of the deploy: `launch/`, `items_/`, `keyart/`, `style-graphics/`, `style-videos*`, plus unreviewed candidate folders (`gallery-vintage/_candidates*/`, `shotlist/_candidates*/`, `artists/vodolija/_candidates*/`). **`keyart/` is the exception**: the `.gitignore:35` pattern is overridden by 58 force-tracked files (19 `.svg` + 19 `.png` + 20 `.webp`, ~9.4MB) that *do* ship, while the other 21 files (~33MB of the 43MB local total) are untracked. The `keyart/brutalist/*.webp` set (20 files, ~2.3MB) backs `gallery-brutalist.html`; the same-named `.png` originals stay untracked and must not be referenced (see `scripts/check-dist-links.mjs`).

## Site-map & shared design system

The project uses a single-source-of-truth IA in `site-map.json` and shared design tokens/components loaded by every page:

- **`lib/design-tokens.css`** — CSS custom properties (colors, fonts, spacing, shadows) for light + dark themes. Loaded via `<link rel="stylesheet" href="/lib/design-tokens.css">`
- **`lib/components.css`** — shared component classes (`.btn`, `.card`, `.tile`, `.nav`, `.footer`, etc.) extracted from `landing.html`. Loaded via `<link rel="stylesheet" href="/lib/components.css">`
- **`lib/nav.client.js`** — `<swr-nav>` Web Component + `window.SWR_NAV` API. Fetches `/site-map.json` and renders a sticky top nav with theme toggle, dropdowns (hover + keyboard focus, Escape to dismiss) and active state, plus a visually-hidden skip link to `#main` (the component gives the page's `<main>` that id when it lacks one) and, at ≤720px, a burger + drawer that replaces the link row. **The element renders where it sits — mount it as the first child of `<body>`; a mount at the end of `<body>` paints the nav below the content.** Loaded via `<script src="/lib/nav.client.js" defer></script>`
- **`lib/footer.client.js`** — the shared footer. `<swr-footer>` renders brand + tagline + four IA columns + a bottom bar (copyright, social, legal, sitemap) from `site-map.json`'s `footerNav` block, so no page hardcodes a destination. Same pattern as the nav: `<script src="/lib/footer.client.js" defer></script>` + `<swr-footer></swr-footer>`. Deliberate exceptions: full-viewport app shells (`engine.html`, `dashboard.html`, `spit.html`, `make-video.html`, `enhance.html`, `photo.html`, `ar-gif.html`), the six remaining `landing-personas-v*` registers and `personas.html` (their footers cross-link the register set, which the shared footer cannot serve); those pages carry the shared *header* and their own footer or none. `scripts/check-site-chrome.mjs` encodes the exception list, and requires every other shipped page to mount both.

### Build automation scripts

- `scripts/generate-site-manifest.mjs` — auto-discover HTML pages, populate `site-map.json`. Run with `--dry-run` to preview
- `scripts/generate-vercel-rewrites.mjs` — generate `vercel.json` rewrites from `site-map.json`. Run after editing `site-map.json`
- `scripts/generate-sitemap.mjs` — generate `sitemap.xml` from `site-map.json` + the shipped `dist/` (one `<loc>` per public content page, `lastmod` from the IA's `meta.lastUpdated`). Excludes `redirects`/`archived`/non-public/`noindex` pages; `npm run build:sitemap`. Run after adding or archiving a page
- `scripts/check-sitemap.mjs` — the sitemap gate (in the `check` group, needs a built `dist/`): regenerates and diffs (drift fails), and asserts no redirected/archived URL, no duplicate, and every shipped content page exactly once
- `scripts/archive-pages.mjs` — move pages in `site-map.json`'s `"archived"` array to `_archive/`. Run with `--dry-run` first
- `scripts/migrate-html.mjs` — the chrome migration tool. Adds shared CSS/JS links to HTML pages, removes duplicate theme bootstrap scripts, and with flags: `--add-nav` (mount `<swr-nav>` as the first child of `<body>`, or move an existing mount there — fixes the "nav renders below the content" class), `--apply-footer` (replace a bespoke `<footer>` with `<swr-footer>` **only when every link that footer carries is served by the shared footer**; otherwise it prints the links that would have been dropped and leaves it alone), `--add-footer`. Idempotent; `--include-apps` covers the pages in its APP_PAGES skip list. Run it with `--dry-run` and an explicit file list first — with no file arguments it processes every site-map page.
- `scripts/check-site-chrome.mjs` — the shared-chrome/IA gate (in the `check` group): every shipped content page mounts the nav at the top of `<body>`, mounts the footer (with a documented exception list), links the two shared stylesheets, has a non-empty unique `<title>`, a meta description and a `<main>` landmark; app surfaces must carry an exit link; every checked page carries exactly one absolute `<link rel="canonical">` on the route that serves it (`scripts/lib/routes.mjs`); every `site-map.json` redirect must have its 301 in `vercel.json`.
- `scripts/add-main-landmark.mjs` — converts a page's existing top-level content wrapper (`<div class="wrap">`, `#app`, …) into `<main>` **in place**, preserving its class/id so no CSS selector changes; reports pages it cannot do safely.
- `versions/_site-exit-inject.js` — codemod giving the 24 full-viewport renderers a `← Site` link (`SWR-SITE-EXIT` marker, idempotent). They deliberately do not mount the shared nav; before this, the five core variants formed a closed loop and the two music-video cuts had no `<a>` at all.

### Maintaining site-map.json

To add a new page:
1. Add the page to the appropriate section in `site-map.json` (nav, footer, auth, legal, or tools)
2. Run `node scripts/generate-vercel-rewrites.mjs` to update vercel.json
3. Run `node scripts/migrate-html.mjs <page.html>` to add shared CSS/JS
4. Run `npm run build:sitemap` — the sitemap gate fails until the new page is listed

To archive a page:
1. Add the filename to the `"archived"` array in `site-map.json`
2. Run `node scripts/archive-pages.mjs --dry-run` to preview
3. Run `node scripts/archive-pages.mjs` to move files to `_archive/`
4. Run `node scripts/generate-vercel-rewrites.mjs` to update vercel.json
5. Run `npm run build:sitemap` — the archived page's URL must leave the sitemap

### Repo contents & tooling

- `preset-pipeline/` — Python daily generator (`generate.py`) + Node schema verifier (`verify.mjs`). Local-only: `./cron.sh` runs on the dev box and does generate → verify → `git commit` + `push origin main` (the GitHub Action that previously auto-committed was removed 2026-09-20; `.github/workflows/` now holds only `ci.yml`). New presets need to be committed by hand after generation
- `targeting-pipeline/` — the **Targeted Engine** artifact generator (same shape as `preset-pipeline/`, no commit step). `parse-personas.mjs` reads `marketing/personas/full/*.md` (28 personas) → `targeting/ontology.json`; `parse-scripts.mjs` reads `marketing/scripts/0N-*.md` (4 segments) → `targeting/segments.json`; `build-rules.mjs` joins those with the real `#variant` ids from `client/variant-switcher.client.js` and the transition ids from `engine-transitions.client.js` → `targeting/rules.json`; `build-voice-lint.mjs` extracts the banned-phrase list from `marketing/scripts/README.md` → `targeting/voice-lint.json`; `verify.mjs` gates all four (28 personas, 4 segments, total persona→segment mapping, permutation-checked variant orderings, 0 orphan ids, voice-lint drift, FR-19 CTA contract, NFR-2 ≤ 200 KB combined). Run `npm run targeting:build` / `npm run targeting:verify` or `bash targeting-pipeline/cron.sh`. **The persona→segment and persona→variant tables live only in `build-rules.mjs`** — adding a persona means adding it there or `verify.mjs` fails. Runtime consumer: `client/targeting.client.js` (`window.SWR_TARGETING`), loaded by `engine.html` only; `vite.config.js` ships `targeting/` and the `inline-targeting-rules` plugin inlines `rules.json` into `dist/engine.html` for offline (NFR-15)
- `presets/` — JSON preset specs (one per file, append-only, daily-generated)
- **The living history** — `marketing/generations.json` (authored, tracked) holds one record per generation: `{id, era, kind, date, title, story, artifacts[{label,href,path}], include[globs], media[{path,embed,note}]}` plus `meta.eras` and `meta.current`. `scripts/generate-generations.mjs` merges it with the tree (only **git-tracked** files count) and measures every media file with `ffprobe` (duration, bitrate, codec, container, sample rate, channels, dimensions) → **`generations.json` (root, gitignored)** and **`generations/<id>.zip` (gitignored)**; both are build output, rebuilt by the `prebuild` script, and never committed (a committed copy would go stale the moment the daily preset pipeline commits). Each archive holds `files/<path>`, the media marked `embed: true`, `CREDITS.md` (the media table with the measured length/bitrate + the files table with lines/bytes/sha256) and `MANIFEST.json`. `scripts/lib/zip.mjs` is the dependency-free zip writer **and** reader (`createZip`, `readZipEntries`, `readZipFile`; STORE for already-compressed media, DEFLATE otherwise). `generations.html` is a **reader, not a document**: it fetches `/generations.json` and `/site-map.json` and renders the eras, the generation cards, an era/kind chip filter, the per-generation credits table and the archive links — nothing on it is hand-maintained, and adding a record to `marketing/generations.json` makes the page grow. Route: `site-map.json` → `generate-vercel-rewrites.mjs` → `build:sitemap`. Gate: `check:generations` (in `check`).
- Content dirs: `marketplace/curated/`, `portfolio/`, `press/`, `promo/`, `keyart/`, `icons/`, `legal/`, `logos/`, `media/`, `reels/`, `shop-designs/`, `shotlist/`, `marketing/`, `personas/`, `packs/`, `videos/`, `gallery-vintage/`
- `scripts/` — 98 build / test / dev scripts (`check-syntax.mjs`, `check-*-unit.mjs`, `check-*-smoke.mjs`, `check-dist-links.mjs`, `run-steps.mjs`, `with-dist.mjs`, `dev-api.mjs`, `test-api.mjs`, `build-magenta-dsp-bundle.sh`, `lib/verify-runner.mjs`)
- `tools/` — 21 dev tools (`deploy-vercel.sh`, `worktree.sh`, `hf-publish.html`, `dev-up.sh`/`dev-ps.sh`/`dev-down.sh`, `freq-bridge.js`, `osc-bridge.py`, `agentic-set.mjs`, `manifest-editor.client.js`/`.html`, `mobile/`)
- **Local nameserver (`local-dns.mjs` + `local-dns.config.json` + `local-dns-system.sh`).** These three files answer `sainted-word.test` (RFC 6761 reserved, so it can never leak or shadow a real query) with `127.0.0.1` from a root-owned `/etc/resolver/` stub and forward everything else to the machine's own resolvers, so dev can use a real hostname. They shipped alongside `dev-vercel-rewrites` in `c47adc2`, were dropped in `9c879b7`, and are now restored. Run `tools/local-dns-system.sh install` once to set up the stub resolver, then `node tools/local-dns.mjs` to start the nameserver. `allowedHosts` in `vite.config.js` already lists those hostnames. `npm run dev` now works at both `http://127.0.0.1:5174/` and `http://sainted-word.test:5174/`.
- `verify-*.mjs` — Puppeteer E2E suites at repo root (129 files; 11 are automix-related — one per surface plus `verify-automix-cross-surface.mjs` and `verify-automix-arc-displacement.mjs`). Reachability is not obvious from the filename: **81 of the 219 npm scripts are invoked by no gate**, and **65 of the 129 root verifiers are in no npm script at all** — a script counts as gated only when its name, or the script file it runs, appears in some `run-steps` group listing, in `scripts/check-verify-smoke.mjs`, or in `ci.yml`. Re-measure rather than assuming the `check:` prefix means membership: `node scripts/run-steps.mjs <group> --list` lists the groups. `.kai/conventions/testing.md` mirrors these groups and the curated 5; `scripts/check-verify-smoke.mjs`, `scripts/run-steps.mjs` and `ci.yml` remain the authority. `docs/OPTIMIZE-AND-SIMPLIFY.md` §3.2 is the plan for closing the gap
- `verify-screenshots/`, `out/`, `docs/` (143 files) — research + audit artifacts. `docs/OPTIMIZE-AND-SIMPLIFY.md` is the map of the repo's real cost centres (measured 2026-10-21) and the ordered moves that remove them
- `vite.config.js` — 9 custom plugins: `copy-static`, `swrc-api-middleware`, `strip-absolute-module-scripts`, `engine-layout-inject`, `audio-damp-inject`, `inline-automix-config`, `inline-targeting-rules`, `inline-footer-nav`, `dev-vercel-rewrites`. `copyStatic` copies `versions/`, a `dirs[]` table and a `rootFiles` list (`SITE_MAP_ROOT_FILES` derived from `site-map.json` + hardcoded extras) in both `buildStart` and `closeBundle`; Rollup `input` is `engine.html` only
- `dev-vercel-rewrites` (dev-only, `apply: 'serve'`) — applies `vercel.json`'s `rewrites` to the dev server so `npm run dev` answers the same routes as production. **Before this, `http://127.0.0.1:5174/` was a 404** while production serves the homepage at `/` (`index.html`), and every extensionless route (`/marketplace`, `/visual-languages`, `/atlas/200-steps`, `/versions/neon`) was dead locally — so local work validated links that 404 on deploy. Rules are read from `vercel.json` at config time (the same file `generate-vercel-rewrites.mjs` emits, so dev cannot drift from the deploy surface), first match wins, and external or parameterised (`/s/:id`) destinations are skipped rather than guessed at. A rewrite fires even when the destination file also exists on disk — `/marketplace` → `/marketplace.html` has to work.
  - `client/variant-switcher.client.js` (5 core + 9 artistic + 8 decorative = **22 entries**) — the switcher wires every page in `versions/` that has a canvas `drawFx(` body. The four core entries (neon/film/smoke/hallucination) were joined by 9 artistic + utility passes (music_video, glitch, aurora, pulse, void, chrome, watercolor, fractal, music_video_mtv, eclipse) and then by the 8 decorative visual languages (collage, echo-manifold, kraft, mosaic, phosphor, spectrum, tape, typography), so the engine's `#looks` `Variant looks` group lists every shipped visual language. Each entry's accent triple is that page's own `:root` palette (`--m`/`--c`/`--y`), not invented values. `compileFx()` was extended to bind a lazily-sized scratch canvas under the names `proc` and `pcx`: aurora/glitch/chrome/watercolor's drawFx bodies read `proc` (their own page-scope offscreen) and threw a ReferenceError on the first frame before that fix. (`baroque` and `grid` are reachable as standalone pages at `/versions/baroque.html` and `/versions/grid.html` but are NOT wired into the engine dropdown — baroque's drawFx is reserved for its standalone page, grid's visual identity is the DOM overlays that the engine already manages.)
  - **`drawFx` author pass for eclipse + baroque** — both pages had bespoke render paths with no canvas `drawFx`: eclipse's corona was a DOM overlay (`coronaEl`/`ringEl`), baroque's `paint()` repainted the whole frame opaquely with a velvet wash + gold sunburst. Each page now carries a canvas `drawFx` that reproduces the same gradient stops, colours and audio mapping as the original, but composites **additively** over the engine's media instead of replacing it (eclipse's shadow pass + lighter corona ring; baroque's translucent velvet wash + lighter rays + central orb + filigree). The standalone pages still call their own loops, so visiting `/versions/eclipse` and `/versions/baroque` looks identical to before.
  - **Still not switchable**: none of the visual-language pages — the 8 decorative ones (`collage`, `echo-manifold`, `kraft`, `mosaic`, `phosphor`, `spectrum`, `tape`, `typography`) each got a canvas `drawFx` written for the switcher contract, composited **additively** over the engine's media (`globalCompositeOperation='lighter'`, translucent washes, never an opaque full-frame fill) so the clips stay visible. What is left out of the dropdown is not a visual language: `versions/music-video-gallery.html` is a VIDEO PLAYER (eight `<video>` elements, 3D flip), `versions/gallery.html` is an art-direction grade reachable via the Grade presets group, and `versions/grid.html` + `versions/baroque.html` are standalone pages whose identity is delivered through their own DOM overlays / `paint()`.
  - **`targeting-pipeline/build-rules.mjs` `readVariantIds()` regex** was `[a-z0-9-]+` — it didn't match `music_video` / `music_video_mtv` (underscore) so the canonical variant list silently dropped them and `targeting:verify` failed the permutation check. Loosened to `[a-z0-9_-]+`; rebuild emits 22 variants (the 2 removed ids — `baroque` and `grid` — are filtered out of each persona's affinity list in `VARIANT_AFFINITY` before ordering).
- `vercel.json` — Vercel rewrites generated from `site-map.json` (`/` → `index.html`, `/engine` and `/engine/` → `engine.html`, …) + headers

## The store

One data file, `site-map.json` → `store`, is the whole storefront. The pages
read it; they never hardcode a product, a price or a payment link.

- `store.gumroad` — the store URL, label and description.
- `store.downloads[]` — the products sold as **downloads**: `source` (the repo
  directories that make up the product), `price`, `gumroadUrl` (the Gumroad
  checkout page), `downloadUrl` (the off-site file URL once published),
  `bytes`.
- `store.products[]` — the **Stripe** products: `surface` (`shop` or
  `campaign`) and `stripeUrl` (the Payment Link).

The catalogue is the owner's to define: one entry ships (the media packs as
one download) as the starting point, and the free material the site already
gives away (the curated `.swr-set` templates, the generation archives) is
deliberately **not** in it.

- `lib/store.client.js` — `window.SWR_STORE`. Reads the block from the
  inlined `#swr-footer-data` slice (the build's `inline-footer-nav` plugin
  now carries `store`) and falls back to `/site-map.json` on the dev server.
  - `apply()` wires every `[data-stripe-product="<id>"]` element: a live
    Payment Link becomes the `href`; a product without one becomes
    `data-stripe-state="pending"` + `aria-disabled="true"` + `href="#"`. It
    never renders a dead `buy.stripe.com` URL — the placeholders the repo
    used to ship are treated as unset.
  - `body[data-store-state]` is `live` or `pending`, so a page's
    "checkout is not live yet" notice hides itself the moment the links
    arrive (`shop.html`, `campaign.html`).
  - `renderStore()` / `mountAll()` paint the download catalogue into any
    `[data-store]` container (the marketplace): name, blurb, price and a CTA
    that is "Buy on Gumroad →", "Download →" or "Coming soon".
- **Build-time overrides** (the links do not have to be committed):
  `GUMROAD_STORE_URL`, `GUMROAD_LINKS` and `STRIPE_LINKS` (each a JSON
  `{ id: url }`), applied by `vite.config.js`'s `resolveStore()`. A malformed
  env var is ignored with a warning, never fatal.
- **Off-site hosting** — the product payloads do not ship with the site:
  - `npm run store:build` → `scripts/build-store-downloads.mjs` packages each
    `store.downloads[].source` into `out/store/<id>.zip` (**outside
    `dist/`**) and writes `out/store/manifest.json`.
  - `npm run store:publish` → `scripts/publish-store-downloads.mjs` pushes
    those archives off-site and writes the public URL back into
    `store.downloads[].downloadUrl` (a targeted text edit, so the manifest
    is not reformatted). The host is the first with a credential:
    **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`, first-party to this deploy) or
    the **Hugging Face Hub** (`HF_TOKEN` + `HF_REPO`, pushed with the `hf`
    CLI). With neither set it prints `(env skip: …)` and exits 0. For a
    product sold on Gumroad, Gumroad itself hosts the file and the
    marketplace links to the product page.
- Gates: `check:store-unit` (node:vm, in `check`) and `check:store-smoke`
  (Puppeteer over the built `dist/`, in `check:full`).

## The shipped media off-site

`packs/` is 582 files and 39.6 MB — a quarter of the build. The packs are
opt-in content and the only thing the deploy needs to serve them is
`packs/manifest.json` (the engine's library drawer, `/packs.html` and
`/photo-scrolls.html` all fetch that manifest and then load the media it
lists). That single file is the seam.

- `PACKS_BASE` (build env) — when set to an absolute URL, `vite.config.js`'s
  `copy-static` ships **only** `packs/manifest.json`, with its `base`
  rewritten to that URL; the 582 media files stay out of the build. Unset
  (the default) the whole directory ships exactly as before, so the local
  build, the CI build and the dev server are unchanged.
- `npm run media:publish` → `scripts/publish-media-offsite.mjs` uploads the
  packs to the host and prints the `PACKS_BASE=` line for the deploy env.
  The host is **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`) or the **Hugging
  Face Hub** (`HF_TOKEN` + `HF_REPO`, pushed with the `hf` CLI). With
  neither credential it prints `(env skip: …)` and exits 0. After the
  upload it **verifies the CORS header** on an uploaded file: the engine
  fetches the media from its own origin, so a host without
  `access-control-allow-origin` would break the packs at runtime.
- `scripts/lib/packs-offsite.mjs` holds the shared logic: base
  normalisation, the manifest rewrite, the copy plan and the file walk.
- Gates: `check:media-offsite-unit` (in `check`) and
  `check:media-offsite-smoke` (in `check:full`) — the smoke builds with
  `PACKS_BASE` set into a separate output directory, asserts the built
  packs directory holds the manifest and nothing else, and drives a real
  browser against a stand-in off-site host on a **different origin**: the
  pack images must point at that origin, load, and a cross-origin `fetch()`
  of a pack file must succeed.
- The manifest itself stays in the deploy — the browser fetches it
  same-origin — so the site keeps working with no off-site host at all.

## The preset editor

`preset-editor.html` (route `/preset-editor`) is a standalone NEON preset
authoring surface: a live audio-reactive canvas on the left, the preset
document on the right (Design / Audio / Layers / LFOs / JSON). It is a
**page**, not an app surface — it mounts the shared nav and footer and
carries the standard head (canonical, description, og:image).

- **Its own palette, scoped to `body.swr-pe`.** The page is dark by
  design, but the shared chrome reads the tokens in
  `/lib/design-tokens.css`. The page therefore overrides `--bg`, `--ink`,
  `--muted`, `--line`, `--accent` (and the `--bg-2`/`--bg-3` the footer
  uses) on `body.swr-pe` — the nav and the footer are inside `<body>`, so
  without that the footer inherited the light theme and rendered as a
  cream band under a black stage.
- **The engine bridge is an event, not an object.** The editor is
  standalone, so there is no engine to call into. "Apply to engine"
  dispatches `swr:preset-applied` on `window` with the preset document as
  the detail, posts the same payload to a parent frame when embedded, and
  copies the JSON to the clipboard. A host page listens with
  `window.addEventListener('swr:preset-applied', …)`.
- **Presets live in `localStorage` under `swr.presets.v1`**; a preset is
  shareable as a deep link (`#p=<base64url of the document>`), produced by
  `window.SWRPresetEditor.shareUrl()`.
- Gate: `check:preset-editor-smoke` (Puppeteer against built `dist/`, in
  `check:full`) — the page boots with the shared chrome, the stage paints,
  a control changes both the document and the pixels, layers add and
  delete, the JSON tab round-trips and rejects invalid data, a preset
  survives a reload, the bridge event fires, and the deep link restores
  its preset.

## Code style

- Vanilla JavaScript, ESM (`"type": "module"` in `package.json`). **No TypeScript.**
- 2-space indent, LF line endings, UTF-8, final newline, trim trailing whitespace (`.editorconfig`); lockfiles and `*.md` are exempt
- No ESLint, no Prettier — follow the surrounding style in each file. Match the existing module pattern: `<name>.client.js` is global-script; shared helpers live in `lib/`; serverless handlers live in `api/<route>.js` with shared code in `api/_lib/`
- Single quotes, `'use strict'` not needed (ESM), prefer `const`/`let`, async/await over callbacks
- File names are descriptive kebab-case; engine subsystems use the `engine-<subsystem>.client.js` convention
- `engine.html` (and most pages) reference scripts with absolute paths (e.g. `/pwa-bootstrap.js`); a Vite plugin strips `type="module"` from those so they load as plain defer'd scripts — do not re-add `type="module"` to absolute-path scripts in any `*.html`

## Testing instructions

- `check`, `check:full` and `check:storyboard` all route through `scripts/run-steps.mjs`, which executes every step in a named group and exits non-zero if ANY failed. They deliberately do **not** use `&&` chains: a chain short-circuits, so the first failure silently skipped every later step. That was not hypothetical — `check:full` truncated at `check:verify` (CI run 36323771785), silently skipping `check:automix-smoke`, `check:automix-arc-smoke`, `check:storyboard`, `verify:automix`, `check:capture-smoke`, `check:media-input-smoke` and `check:spit-live-smoke`; and `check` used to be an `&&` chain, so an early failure hid up to 38 suites. `node scripts/run-steps.mjs <check|storyboard|full> [--list]` runs or lists a group; `STEPS_ONLY=a,b` runs a subset. Groups contain exactly: `check` **107 steps**, `storyboard` **5 steps**, `full` **29 steps** (verified with `node scripts/run-steps.mjs <group> --list`; re-measure after adding a step rather than trusting the number here).
- Quick gate: `npm run check` → the 107-step group (syntax + bundle + the unit suites + API tests + the smokes that need no browser interaction)
- Full pre-PR gate: `npm run check:full` → the 29-step group: `check` + `check:verify` + `check:automix-smoke` + `check:automix-arc-smoke` + `check:invite-redemption-smoke` + `check:storyboard` + `verify:automix` + `verify:genops` + `verify:story-graph` + `check:capture-smoke` + `check:targeting-smoke` + `check:layer-groups-smoke` + `check:song-video-layer-smoke` + `check:media-source-smoke` + `check:announcements-smoke` + `check:store-smoke` + `check:preset-editor-smoke` + `check:media-offsite-smoke` + `check:media-input-smoke` + `check:live-input` + `check:spit-live-smoke` + `check:tiktok-smoke` + `check:camera-enhance-smoke` + `check:clip-poster-smoke` + `verify:engine-boot` + `check:variants-smoke` + `check:build-idempotent` + `check:dist-links` + `verify:site-nav`
- `check:doc-truth` — the doc-vs-code drift gate (P0.6 of `docs/PLANS/architecture-audit-2026-10.md`, the "mechanism not prose" item). Reads the current-state docs (`README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.kai/conventions/*.md`, `docs/ARCHITECTURE.md`, `docs/automix-architecture.md`, `docs/DEV-SERVER.md` - the list is explicit in the script, NOT a glob over `docs/`, because the dated audits and plans in there legitimately describe states that no longer exist) and verifies every inline-code span that asserts something about the tree: a file path must resolve (`lib/media-store.client.js`, `versions/_*.js`, `scripts/run-steps.mjs:44` - a `file:line` citation asserts the FILE, not the line, so a 20-line move in a hot file cannot red the gate), a trailing-slash directory claim must be a real directory (this is what catches a phantom module family like the `versions/inject/*.js` that never existed), a root-relative route must be a shipped file, a `vercel.json` rewrite or an `api/` handler, and a library/API/global name (`THREE.PropertyBinding`, `navigator.storage`, `SWR_NAV`) must appear in the shipped source. Additive by construction: it fails only what it can PROVE wrong, skips what it cannot (fenced blocks, future-work sections, negations, placeholders, branch names, gitignored paths, pseudocode), and prints an `ACCEPTED_DRIFT` ledger for the rest. It carries its own `--self-test` (14 synthetic cases: the 5 drift shapes must fire, the 9 legitimate-prose controls must stay quiet) because a permanently green gate that can no longer detect anything is the worst outcome a CI check can have. Counts ("32 HTML files", "19 codemods") and stale line numbers are the documented follow-up. ~0.3s. In `check`
- `check:verify` — the curated 5-verifier smoke that gates PRs. The 5 are fixed in `scripts/check-verify-smoke.mjs`: `cloud-auth`, `hf-publish`, `rotation-enabled`, `autoplay`, `e2e-media-record` (API · admin UI · engine mount · feature smoke · recorder cycle). It bootstraps a Vite dev server on `:5175` with a temp `SWRC_DATA_DIR`. Every other `verify-*.mjs` is a developer aid run on demand
- `check:capture-unit` / `check:capture-smoke` — node:vm unit coverage and a Puppeteer smoke against built `dist/engine` for the periodic frame capture runtime (URL parse, localStorage, clamp, state machine, blob trigger; toolbar mount, toggle flow, interval two-way binding, URL opt-in). Unit in `check`; smoke in `check:full`
- `check:song-video-layer-unit` / `check:song-video-layer-smoke` — the video-song layer. The unit loads `lib/song-video-layer.client.js` in a `node:vm` sandbox and pins the module's decisions (a video song adds exactly one `songBound` layer bound to the song's own element, an audio song adds none, a new song replaces the old one, the song-loaded seam chains). The smoke drives the real engine: it loads the tracked `swr-intro-10s-voice.mp4` as the song, then asserts the stage canvas (`#render`) actually draws the song's `<video>`, that the shared element advances with the sound, that `Audio.seek()` moves the picture with the sound, that the renderer never calls `load()` on the song element (`SWR_VIDEO_SYNC`'s stalled-element recovery would restart the song from zero — the draw path skips it for `songBound` assets), that the layer can be removed while the audio keeps playing, and that an audio song removes the layer. It waits for the default library's own song to settle first, or the library can replace the video song mid-run. Unit in `check`; smoke in `check:full`
- `check:media-source-unit` / `check:media-source-smoke` — the **Media Source** panel and the single-clock playback engine. The unit loads `lib/audio.client.js` in a `node:vm` sandbox (with fake media elements and a fake `AudioContext`) and pins the engine's decisions: no source node is built before the media is ready, the node is built on `loadedmetadata`, it is created once per element and reused, the clock is the element that carries the audio, the bar counter and the beat phase follow that clock (a frozen media freezes the counter; a seek does not run it backwards), "none" disconnects the analyser while the element stays captured, an external file becomes the master clock with the picture corrected onto it (a positive offset delays the audio, an 80 ms threshold stops it jittering), the transport drives both elements, and all three export paths record `Audio.analyser` (so the export inherits the preview) with no export-side audio control anywhere. The smoke drives the real engine in a browser: it loads the tracked `swr-intro-10s-voice.mp4` as the song, records every `createMediaElementSource()` call with the element's `readyState` at that moment, and asserts the panel is mounted with its four rows, the source node appears only after the metadata, the clock advances with playback, the bar counter freezes with the media (no independent wall clock), "none" silences the analyser while the picture runs, an external file becomes the clock and is what the analyser hears, a +500 ms offset puts the picture half a second ahead of the music, and the panel's controls drive the engine. Unit in `check`; smoke in `check:full`
- `check:variants-unit` / `check:variants-smoke` — full 22-variant switcher coverage. The unit loads `client/variant-switcher.client.js` in a `node:vm` sandbox with a fetch stub that reads `versions/<id>.html` from disk, then for every entry in `SWR_VARIANTS.list()` asserts the `function drawFx(` source compiles, `state.fx` is non-null and `fx.run()` does not throw against a mock canvas + `A.feat` whose known feature set is `{bass, mid, treble, beat, onset, beatPulse, rms, centroid}` (a guarded `Proxy` makes a future drawFx that reads a feature outside this set fail the gate with a clear error). The smoke boots `dist/engine` via `serveDist()`, walks every id in the runtime list, activates it, loads the variant's `audios/<id>.mp3` via `window.Audio.loadFile()` + `play()` so the engine's audio features move, then wraps `state.fx.run` with a counter and a before/after pixel check: requires the drawFx to be invoked at least twice in two rAFs AND to write to the canvas (a no-op drawFx — a body that compiles, runs without throwing, but does nothing — is caught because the 200-pixel sample of the canvas is identical before vs. after the call). Unit in `check`; smoke in `check:full`
- `check:media-input-unit` / `check:media-input-smoke` — live-camera-mic foundation (MediaInput factory + codec + audio features, Camera Preview + Mic Meter contracts); smoke verifies the 3 module globals load and the factory returns an instance, skipping real camera/mic permissions. Unit in `check`; smoke in `check:full`
- `check:spit-live-unit` / `check:spit-live-smoke` — Spit Live page (`SWR_SPIT` factory + state machine + loadBeat/toggleMic/triggerFx, `SWR_SPIT_FX` validation + concurrency); smoke runs against built `dist/spit`. Unit in `check`; smoke in `check:full`
- `check:directors-unit` — node:vm coverage for `client/engine-directors.client.js` (`window.SWR_DIRECTORS`): Scene switching + `includes()`, Loop phase/seam/energy, and the shared arc engine behind the duration-windowed `short`/`medium`/`long` directors (bar-budget clamping to 30-60s / 60-120s / 2-5min at any BPM, section walks that reach the closing section, energy interpolation + audio boost clamped to 1, `ctx.fx[].intensity === ctx.energy`, unknown-template fallback). In `check`; no smoke yet — no page loads the module
- `check:tiktok-unit` / `check:tiktok-smoke` — TikTok Studio page (`SWR_TIKTOK` factory + state machine + 12 vibe presets + the six-layer 9:16 renderer + buffer analysis for hook/BPM/key, `SWR_TIKTOK_EXPORT` capture + MediaRecorder pipeline with the four plan lengths); smoke runs against built `dist/tiktok`. Unit in `check`; smoke in `check:full`
- `check:camera-enhance-unit` / `check:camera-enhance-smoke` — Camera Enhance page (`SWR_CAMERA_ENHANCE` factory + the one per-frame renderer shared by the preview and the export, the 8 look presets with the documented grade mapping, the four fix passes — auto-exposure from live luma stats, a coarse-grid translation stabiliser, the denoise soften, the temporal blend — the 4 overlay modes, burn-ins and the forced `SWR · enhance` mark; `SWR_CAMERA_ENHANCE_EXPORT` capture + MediaRecorder pipeline with 5 formats and 3 audio modes); smoke runs against built `dist/camera-enhance`. Unit in `check`; smoke in `check:full`
- `check:targeting-unit` / `check:targeting-smoke` / `targeting:verify` / `verify:targeting` — the Targeted Engine (persona/segment classification that reorders `#variant`, pins transitions, offers a dismissible banner). Unit covers the UC-001…UC-007 signature rules, the tag-janitor precision case, the untargeted fallback, correction decay, voice lint, the FR-10 CTA guard, dismissal suppression, variant ordering and the NFR-1 50 ms budget; smoke asserts the module + rules load in the real page; `targeting:verify` gates the artifacts; `verify:targeting` drives a synthetic session end-to-end. Unit + `targeting:verify` in `check`; smoke in `check:full`; `verify:targeting` is on demand. Regenerate artifacts with `npm run targeting:build` after editing `marketing/personas/full/` or `marketing/scripts/`
- `check:announcements-unit` / `check:announcements-smoke` — the auto-post feed (`lib/announcements.client.js`). The unit (node:vm) covers the data contract: the posts come from the inlined `#swr-footer-data` slice when the page has one and from `/site-map.json` when it does not, the array order is the published order, an entry without a title is dropped, `list(limit)`/`latest()` honour the limit, and an external post's link gets `target=_blank` + `rel=noopener` while an internal one does not. The smoke (Puppeteer against built `dist/`) asserts the changelog and the marketplace paint the feed, that the footer's bottom bar carries the newest post as "New — …", and that a page with no feed container still shows it in the footer. Unit in `check`; smoke in `check:full`
- `check:dist-links` — `scripts/check-dist-links.mjs`, the deploy-surface integrity gate (in `check:full`, needs a built `dist/`). Asserts (1) every non-error `vercel.json` rewrite destination exists in `dist`, (2) every root-relative `href`/`src` in a shipped page resolves to a built file, a rewrite, or `<path>.html`/`<path>/index.html`, and (3) every `site-map.json` entry resolves likewise (the file ships and `sitemap.html` renders it into links at runtime). It is the guard for the class that produced three live 404s: `atlas.html`'s TOC had no rewrites and its nine section pages were never built, its `/docs/atlas-assets/*.webp` artwork was never copied, and `/s/<shareId>` (built by `swr-app.html`) rewrote to a file that does not exist
- `check:generations` — `scripts/check-generations.mjs`, the living-history gate (in `check`). It **rebuilds** the history (`scripts/generate-generations.mjs`) and then proves: the authored records are sound (unique ids, known eras, a real `meta.current`, ISO dates, a story each); every artifact and media file still exists; every credited media file really has a length and a bitrate; every archive is a readable zip carrying `CREDITS.md` + `MANIFEST.json`; the credits name every media file they credit; the page reads `/generations.json`, mounts the shared chrome and links the archives; and the route is wired (site-map → vercel rewrite → sitemap). It is the gate that keeps the history honest — a number on the page is measured, never remembered
- `check:auth-google-signin-unit` — `scripts/check-auth-google-signin-unit.mjs` (in `check`). Stubs `globalThis.fetch` for `oauth2.googleapis.com/token` and `www.googleapis.com/oauth2/v3/userinfo` over a real local HTTP server, then drives the whole Google flow: the start URL's scopes/`access_type`, the signed `state`, a tampered state being rejected, an off-site return path collapsing to `/`, Drive scope + popup mode, unconfigured → 302, a first-time sign-in (user row + session row + `swrc_session` cookie, **no** Drive tokens), a second sign-in resolving to the same user, Drive tokens stored only for `intent=drive`, `400 invalid_state` / `missing_code`, the callback's 302 + `?auth=google` + cookie, denied consent → `/auth/login?error=access_denied`, and the popup `postMessage` page
- E2E: `npm run verify:<name>` (e.g. `verify:cloud-auth`, `verify:story-graph`, `verify:hallucination-story`, `verify:autoplay`, `verify:e2e-media-record`, `verify:music-video-maker`, `verify:site-nav`); Puppeteer auto-logs-in via stored cookies when needed
- `verify:site-nav` — smoke test for the unified navigation system. Crawls every nav URL from `site-map.json`, verifies shared CSS/JS loads, checks archived pages return 404
- Each `verify-*.mjs` is standalone (no shared harness, though `scripts/lib/verify-runner.mjs` provides timeouts/`before` hooks for the curated set); they're discovered and run individually. Add a new `verify-<feature>.mjs` at repo root and wire it as `npm run verify:<feature>` in `package.json`
- `ensureDist()` from `scripts/with-dist.mjs` is what smoke scripts use instead of a manual build: it compares mtimes of `lib/ client/ versions/ packs/ default-library/ audios/` + a root-file list against `dist/engine.html` and runs `npm run build` only when dist is missing or stale
- After every sprint / non-trivial change, run the relevant E2E scripts before claiming done — typecheck + build do not catch runtime bugs (Canvas/WebGL/PWA/audio permission flows, infinite re-render loops, IndexedDB persistence, Vercel deploy quirks)
- `preset-pipeline/cron.sh` is the canonical daily-preset entry point; it generates then verifies
- **Env-skip pattern**: tests that need resources outside this repo (e.g. `verify:hf-publish` requires the sibling `~/Documents/autodashboard/magenta-dsp-procedural` source) print `(env skip: ...)` and pass when the resource is absent, matching the design intent of `scripts/build-magenta-dsp-bundle.sh:74-88`. Keep the marker literal so a real failure still surfaces

## Layer groups

The engine's layer panel can bundle layers under a **group** header. The gesture is **shift+click**: shift-click a layer card to mark it (the card gets the `.multi-selected` ring), shift-click more to mark more, then press the **`+ Group`** button in the layers panel head (next to `+ Layer`). A plain click is still the single-select gesture and clears the marking.

`lib/layers.client.js` owns the whole feature — the engine only supplies the button and the CSS:

- **Model** — membership lives on the layer (`layer.groupId`); `Layers.groups` holds the group records `{id, name, visible, collapsed}`. Membership is therefore derived, so reordering, adding or removing layers cannot desynchronise it.
- **API** — `toggleSelect(id)` (shift+click), `clearSelection()`, `groupSelected(name)` (needs ≥2 marked layers, otherwise it warns in the status bar), `ungroup(groupId)`, `setGroupVisible(groupId, visible)`, `toggleGroupCollapsed(groupId)`, `renameGroup(groupId, name)`, `groupsOf(layer)`, `visibleList()`.
- **Visibility is a layer flag, not a draw-path concept** — hiding a group writes `hidden: true` on every member. The draw paths (`engine.html`'s `Renderer.loop` / `Renderer.pickLayer`) skip hidden layers via `Layers.visibleList()`, so they never learn what a group is. The same list drives the engine's layer-count stepper, so hiding a group frees a slot in the top-N draw budget. `client/layer-strip.client.js` dims the hidden rows so the strip agrees with the stage.
- **Collapsing** a group drops its member cards from the panel entirely (they are not built, so their sliders cannot be grabbed by accident). The header stays, with a caret, the (editable) name, the member count, the visibility toggle and the ungroup button.
- **Persistence** — `project.js` round-trips `groupId` + `hidden` per layer and the `groups` array; `share.client.js` carries the `groups` array in the URL hash.
- Gates: `check:layer-groups-unit` (node:vm, in `check`) and `check:layer-groups-smoke` (Puppeteer against built `dist/engine`, in `check:full`).

`versions/neon.html` and the other variant pages carry their own inline `Layers` and do **not** load `lib/layers.client.js` — they have no group support.

## SWR visual debugger

`client/engine-debugger.client.js` is a standalone overlay that shows what the engine is actually doing, live. **No page loads it** — the file ships in `dist/client/` (the `copy-static` plugin copies `client/` wholesale) but nothing references it, so it is dead weight until you ask for it. Inject it when you want it:

```js
// In the console on any /versions/<name>.html page:
fetch('/client/engine-debugger.client.js').then(r => r.text()).then(t => eval(t))
```

It attaches `window.SWR_DEBUGGER` and auto-mounts. The **backquote key** toggles it, `SWR_DEBUGGER.unmount()` releases the engine wrappers and removes the overlay, and the page returns to its untouched state.

**What it shows** — audio features (bass/sub/mid/treble/air/rms/centroid), BPM, beat/onset pulses, the layer stack with each layer's resolved transform (scale, opacity, hue, contrast, brightness, x, y, rot), the reactor wiring, the gap between a layer's resolved transform and the one actually drawn, a scrolling feature scope, a beat/onset rhythm strip, perf counters, master-toggle states, the loaded `SWR_*` module registry, and — drawn over the stage itself — each layer's real footprint.

**How it observes** — it wraps `SWR_RENDER.frame`'s `applyR` argument, the exported `SWR_RENDER.imageEvolve`, and the `drawImage` calls the engine makes while drawing a layer. It never re-derives engine state: `SWR_AUDIO_DAMP.damp()` is stateful, so an extra call would advance the damper and the panel would describe a picture that was never rendered. The wrappers add no calls, so the overlay cannot perturb the engine.

It deliberately **does not model each variant's draw convention** — cover fit vs contain, a rotation threshold of 0.3 vs 0.5, the engine-supplied offscreen vs the stage canvas all differ, and modelling them was wrong on film and aurora and absent on watercolor. The overlay reports the corners the engine actually drew, so it is right on every variant.

**Scope** — the overlay observes the shared `SWR_RENDER` engine, so it covers the **variant pages** (`/versions/*.html` — neon, film, aurora, watercolor and the rest). `engine.html` runs its own renderer (`window.SWR.Renderer`: its own stage canvas, layer geometry and drift system) and is **not** covered; the overlay says so on that page rather than failing silently. Extending it to `engine.html` means a second renderer integration, not another hook.

**Reaching it** — the footer's utility row on `versions/neon.html` carries an **Inspect** control pointing at `?swrdebug=1`. A six-line bootstrap on that page injects the overlay only when the parameter is present, so without it the page does not fetch the tool at all. The link is a real URL, so the view is shareable. The overlay's header links to the parameter bench.

**Parameter bench** — `lab/params.html` (`/lab/params`) is the developer reference for every URL parameter the engine and the site read: what it applies to, the values it accepts, what it actually does, and a link that opens the page that consumes it with that value applied. It also builds a URL from a chosen set of parameters and reports what the current page *resolved*, not what was asked for — a parameter that is accepted but ignored looks identical to one that works until you check. Registered in `site-map.json` under `tools`, like the media input lab.

**Relationship to `client/debug-overlay.client.js`** — the two are complementary, not duplicates. The engine's own overlay (loaded by `engine.html`, enabled with `?debug=1`) is a *key-action log*: the last 12 keys and UI actions, the look filter, a coarse audio and layer summary. This one is a *state inspector*: live feature values, per-layer resolved transforms, reactor wiring, the audio's contribution per layer, and each layer's footprint on the stage. They use different globals (`SWR_DEBUG_OVERLAY` vs `SWR_DEBUGGER`) and neither binds a key the other uses — but both would sit in the bottom-right corner of `engine.html`, so this panel stops above the engine's overlay when it is present.

**Its metric** — `npm run check:debugger` (`scripts/check-swr-debugger.mjs`) drives headless Chrome over the DevTools Protocol with **no npm dependencies** (Node's built-in `WebSocket` does the work) and scores:

```
SCORE = 0.5 * coverage + 0.3 * accuracy + 0.2 * headroom
```

- **coverage** — of the overlay's 13 declared surfaces, how many render genuine live engine data (not placeholders)
- **accuracy** — 8 independent probes: the resolved transform matches the engine's own static fields with reactors muted; the painted DOM matches the painted snapshot and is not stale; values move; a layer mutation shows up promptly; the stage geometry matches the engine's **real `drawImage` calls**; every engine layer appears; unmount releases the wrappers and the engine keeps drawing; and no extra `applyR`/`imageEvolve` calls were introduced
- **headroom** — frame-budget headroom from the measured median frame time with and without the overlay

The score is the mean across a slice of the variant family (`--pages=neon,film,aurora,watercolor`), so a variant the debugger cannot handle costs real points. `--target=<url>` scores a single page; `--no-debugger` measures the floor; `--fail-under=<0..1>` gates a CI run.

The harness needs Chrome and network access to the deployed site, so it is a developer aid, not part of the `check` group.

## Equaliser isolation test

`audios/swr-eq-test.mp3` is a 60-second diagnostic track that fills one of the engine's frequency bands at a time — bass, mid, treble, air, silence, sub, then all four — so you can see that a layer reacts to its own band and nothing else. `npm run make:eq-test-track` regenerates it; `npm run check:eq-isolation` runs the check (`scripts/check-eq-isolation.mjs`), which plays the track through the engine's own analyser and asserts that **each layer's displacement matches the engine's own prediction** — `ease(feature) × sens × gain` — in every segment, to within 2% of that target's dynamic range.

The check is not a threshold on "no cross-talk"; it is a prediction test. Anything else moving a layer would miss its prediction.

It found three things about the engine worth knowing before tuning reactors:

- **A band's level depends on how wide it is.** A feature is the mean of its bins, so the same energy reads 0.93 in the 10-bin bass band and 0.40 in the 745-bin air band. The shipped per-target gains (`mid → hue ×200` against `treble → rot ×3`) exist to compensate.
- **Adjacent bands share a boundary FFT bin** (`bass` ends at bin 11, `mid` starts at bin 11), so a loud band always bleeds into its neighbour by one bin's worth — and the `sharp` ease curve (`t^0.4`) amplifies that: a bass-bound layer moves about half as much during a mid segment as during a bass segment.
- **Two subsystems write into the transform that have nothing to do with the music** — the narrative-state drift and the LFO registry. The check switches both off; a layer audit has to, or it measures them instead.

`docs/EQ-ISOLATION-TEST.md` has the full segment plan and the measured tables.

## Live input — camera and microphone

`client/swr-live-input.client.js` puts a **Live** control in the media panel of the engine and every SWR_RENDER variant (`engine.html`, `versions/*.html`). It gives two things:

- **Camera → a live layer.** A `<video>` carrying the camera stream is added to the layer stack, so you can shoot yourself into the video and have it react like any other layer.
- **Mic → the engine hears you.** The stream is routed into the engine's own analyser, so the layers react to the room as well as to the song. The mic is deliberately *not* monitored to the speakers — a live mic feeding the composition and the speakers at once is a feedback loop.

It builds on `swr-media-input.client.js` (the primitive), `swr-camera-preview.client.js` and `swr-mic-meter.client.js` (the picture and the level), which it loads in order.

Three things the engine does that the live input has to work around:

- **Video clips are paused when the transport stops** (`if (!A.playing && !src.paused) src.pause()` in the variant draw paths, and `SWR_VIDEO_SYNC` on the shared one). Right for a clip, wrong for a camera, so the live element ignores `pause()` and the original is restored when the layer is removed.
- **A detached video element never gets a media pipeline.** Chrome leaves it at `readyState 0` forever, so the element is parked in the document, off-screen and invisible — `display:none` would stop it rendering altogether.
- **A new layer inherits a blend mode from the page's shuffle**, and some of them (`multiply`, `difference` over black) make a live feed invisible on a dark stage. The live layer is set to `screen` at full opacity and scale 1.

The analyser is named differently on the two surfaces: the shared `lib/audio.client.js` calls it `analyser` and hangs off `window.Audio`; a variant's inline engine calls it `an` and hangs off `window.SWR.Audio`, and only builds its audio graph when a song is loaded — so the graph has to be asked for before there is anything to route into.

`npm run check:live-input` (`scripts/check-live-input.mjs`) drives headless Chrome with a **synthetic** camera and microphone (`--use-fake-device-for-media-stream`), so it runs on a machine with no camera. It asserts the control appears, the camera becomes a live layer whose frames are decoded and which reaches the stage, the mic is routed into the engine's analyser with a live meter, and stopping both releases the devices and removes the layer. The browser is launched in its own process group and torn down as one — Chrome spawns children, and leaving them behind holds the fake camera and makes the next run flaky.

## Local-first

**Plan: move the running surface onto the local device. Use the memory already on disk (`.kai/`, `agents/`, `docs/PLANS/`, `.obsidian-swr/`, the SWR journal via the orchestrator).** Do not reach the external API for anything the engine can answer from the local sources.

### What "local memory" is here

- **`.kai/`** — the project's own memory. `memory.yaml` (4 active prevention rules from real incidents), `preferences/user.yaml`, `conventions/` (architecture / coding-style / naming / repo-hygiene / testing), `decisions/` (ADR-001 + ADR-002 with their actual decision rationales and earlier stale-content retractions), `tech-debt/register.md` (12 entries, 8 closed with execution evidence). All entries are written by the project owner and describe the actual codebase; they are not advisory.
- **`docs/PLANS/`** — design proposals with the same shape as the memory system: a problem statement, a proposed solution, a contract, a verification path, and (where relevant) the rejected alternatives. Read the most recent one (`architecture-audit-2026-10.md`) before starting a new audit.
- **`agents/`** — the SWR team skills: Ops (orchestrator + TASKS.md), Twin (your digital twin), Check (read-only verifier). These do not call any external API; the Twin in particular is voice-only and the Check is a verifier.
- **`.obsidian-swr/`** — the Obsidian vault the orchestrator writes to. Daily journal at `Journal/YYYY-MM-DD.md`, Map of Contents at `MOCs/SWR.md`. The journal is appended (never rewritten) and survives across sessions.
- **`SECURITY.md`**, **`README.md`**, **`AGENTS.md` (this file)** — the curated current-state docs. The `check:doc-truth` gate verifies every inline-code span in them against the source tree on every CI run; a claim that drifts from the code (a phantom file, a misnamed route, a stale line number) flips the gate red.
- **`scripts/run-steps.mjs`** + **`scripts/check-*.mjs`** + the 100+-step `npm run check` group — the local CI. The user does not need an external CI provider to know whether a change broke anything; the gate runs in Node and exits non-zero on any failure.

### What "external" is here, and how to reduce it

| Surface | Today | Local alternative |
|---|---|---|
| Vercel serverless routes (`api/`) | The Vercel edge runs every `api/*.js` handler | `scripts/dev-api.mjs` already rewrites `/api/*` to local file handlers in dev. For production, `npm run serve:local` (below) + a `serve-repo` mirror covers the same surface without a cloud provider. |
| Vercel Blob (`api/storage/{object,sign-upload,sign-download}.js`) | Signed-URL storage for user media | Local filesystem at `data/storage/<userId>/...` (the existing `api/_lib/db.js` local-FS branch is the default in dev). Production users on Vercel keep using Blob until the local mirror is hardened. |
| Postgres (`api/_lib/db.js`) | The `DATABASE_URL` env sets Postgres on | When `DATABASE_URL` is unset, `db.js` falls back to local-FS JSON at `./data/`. The fallback is the same code path the dev server uses, so the two are already equivalent. |
| Stripe (`api/_lib/stripe.js`) | Server-side Connect for the marketplace pilot | When `STRIPE_SECRET_KEY` is unset, every Connect route returns 503 with a clean error; the pilot is opt-in only. |
| Google OAuth for Drive (`api/_lib/google.js`) | The "Connect Google Drive" button | When `GOOGLE_CLIENT_ID` is unset, the OAuth start returns 302 to `/auth/login?error=google_oauth_not_configured`. The button is honest about its state. |
| Hugging Face (`api/_lib/hf-publish.js`) | The publish pipeline | Without `HF_TOKEN`, the publish is skipped with `(env skip: ...)`. The orchestrator does not use it. |
| 3rd-party API for the engine UI (`engine.html`) | None — the render loop is local | The engine is already local-only. No change. |

### Local dev loop (the entire surface, zero external)

```bash
# 1. one-time
cp .env.example .env            # leaves every env var unset; local-FS paths apply
npm install
node tools/local-dns-system.sh install  # optional: sainted-word.test -> 127.0.0.1

# 2. daily
npm run dev                       # http://localhost:5174 with full /api/* on the dev middleware
# or
node tools/swr-vault-init.mjs    # creates .obsidian-swr/ (only if the path resolves)
npm run vault:log event test --summary "first event"  # log to the local journal

# 3. pre-PR
node scripts/run-steps.mjs check      # 100+ steps, ~30s on a laptop
node scripts/run-steps.mjs full       # adds the Puppeteer smokes (needs Chrome)
```

### Rules

- **Do not** call the external API from a context that the local sources can answer. If the local knowledge is sufficient, prefer it.
- **Do not** add new memory paths outside `.kai/`, `agents/`, `docs/PLANS/`, `.obsidian-swr/`. The vault path, the plan path and the SWR path form a closed set: anything outside them is either code, build artifact, or a stale page.
- **Do not** introduce a new external dependency without a `check:env-config-mismatch` plan. The `check:doc-truth` gate will fail the next time the claim drifts; the new dep should be enumerated in `.env.example` and in this section.
- **State transitions** for the local migration go in `docs/PLANS/` with the same shape as the audit reports: a problem statement, a proposed solution, a contract, a verification path, and a list of what was rejected and why.
- **The orchestrator** (`tools/swr-journal-log.mjs`) auto-logs every commit and every subagent run. If a local decision is made outside a commit, append a `node tools/swr-journal-log.mjs event ...` event so the journal records it.
- **The local CI** (`npm run check`) is the contract: a green run means the project is healthy locally. Don't ship to the external deployment without it.

## Local server

`npm run serve:local` (`scripts/serve-repo.mjs`) serves the repository as a static site with the same HTML transforms the build applies — absolute module scripts become plain deferred scripts, and the pages that import `engine-genops` get the shared layout and the audio damper. It needs no dependencies, which `npm run dev` does.

It is not the real build: no bundling, no minification, and the per-variant automix config is not inlined.

## Fullscreen without UI

**F** on the engine page means *fullscreen with no UI*: the stage covers the screen, every panel, bar, header and footer is hidden, and the browser's own fullscreen comes with it — so it is a real fullscreen, not a full-bleed viewport. **Escape** leaves it, and so does F again.

`window.SWR_COVER_FULLSCREEN` exposes `set(on)`, `toggle(viaKey)` and `get()`. It lives on its own global rather than on `window.SWR`, because the engine replaces `window.SWR` wholesale when it exports its API.

Two things the CSS has to out-specify rather than out-order, because the basic-mode rules are equally specific and come later in the sheet:

- the basic-mode rules bring the engine's own stage back (`section#stage`, and the `#app` ancestor it lives under) — in basic mode that stage is hidden in favour of a placeholder canvas, so without this "fullscreen, no UI" would be a fullscreen of nothing;
- the basic-mode header, clips bar and controls are hidden, so nothing is left on screen but the composition.

## PR & commit conventions

- **Auto-commit workflow**: After completing any deliverable, run tests, then commit and push to main. Skip pushing only if tests fail.
- Branch from `main`; never push to it directly
- Conventional commits (`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`); recent examples: `fix(hallucination): surface auto-loaded song`, `fix(deploy): capture stderr from vercel ls`
- Repo-local git config is unset — assistant commits ship as the global user (`kajica2 <kai.djuric@gmail.com>`). If you ever set a repo-local `user.name`/`user.email`, unset it (or pass `-c user.name=… -c user.email=…` on the commit) — Vercel blocks deploys whose GitHub committer identity is unknown
- GitHub Actions: `.github/workflows/ci.yml` is the only workflow. It runs on PRs against `main` and pushes to **non-main** branches (`branches-ignore: main`, so a direct push to main does not trigger it). Steps: `npm ci` → `npm run check:full` → `npm run check:automix-arc-smoke` (its own step) → `npm run verify:transitions` → `npm run verify:automix-cross-surface` → `npm run build` → build-size budget `≤ 180MB` (188,743,680 bytes, counted with `find dist -type f -printf '%s\n' | awk '{s+=$1}'`; the ceiling was 155MB until 2026-10-21, when `main` was measured at 173.1M — the shipped media that landed after 2026-10-19 put it over, not a code regression). Preset pipeline is local-only (`./preset-pipeline/cron.sh`)

## Security

- Never commit secrets — `.env` is in `.gitignore`; copy `.env.example` to `.env` for local dev
- API threat model is in `SECURITY.md`; key rules:
  - All storage goes through signed URLs scoped to `userId/...`; never bypass `/api/storage/sign-upload` / `sign-download`
  - `safeKey()` rejects keys with `..`, leading `/`, or `\` — keep this invariant
  - `swrc_session` cookie: HttpOnly, SameSite=Lax, Secure in production; 30-day rolling TTL
  - Rate limits on `/api/auth/magic` (10/min/IP), `/api/storage/sign-upload` (60/min/user), `sign-download` (120/min/user), `/api/projects` writes (30/min/user) — return 429 with `Retry-After`
  - `TRUSTED_PROXIES` must be set if deploying outside Vercel, otherwise `x-forwarded-for` is spoofable and bypasses the per-IP rate limit
- Vercel deploys are auto on push to `main`. Build size: **measure it the way CI does** (`find dist -type f -printf '%s\n' | awk '{s+=$1} END {print s}'`) on a *clean* build — the ceiling is **188,743,680 B (180 MiB)** and `main` measured 173.1M (2026-10-21). A local `dist/` is much larger (221,182,702 B measured 2026-10-21) because 35,054,969 B of `keyart/brutalist/` is untracked under the `.gitignore:35` pattern (58 of the 78 keyart files, 9,878,271 B, are force-tracked) — so the local copy carries ~35 MB CI never sees. Do not quote a local `du` as the deployed size; `docs/OPTIMIZE-AND-SIMPLIFY.md` §2.1 has the full provenance split.
