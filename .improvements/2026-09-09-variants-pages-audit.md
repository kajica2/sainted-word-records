# Variants + Pages Audit

**Workspace:** `/Users/kaidejuricmasscmbook/Downloads/sainted-word-records` (branch: main)
**Dev server:** `http://127.0.0.1:5174`
**Scope:** 23 variant HTMLs in `versions/` + 26 marketing/educational HTMLs at repo root (49 files total)

## Critical (blocks launch)

_None._ All 49 HTML files parse cleanly with the Python `html.parser` (parse5-compatible), each has exactly one `<body>` close and one `<html>` close, no unclosed `<script>` tags, no malformed `</script>` string-literal breaks. music_video.html (the file flagged in the brief as having a problem earlier) is now clean. Dev server returns HTTP 200 for all 49 audited pages.

## High

- **All 23 variants + marketplace.html reference `/apple-touch-icon.png` — file does not exist (404).** The repo only has `icons/apple-touch-icon-180.png` (referenced nowhere as a default touch icon). Affects 24 HTML files: every variant under `versions/` and `marketplace.html`. Browser silently falls back to other icons, but `curl`/PWA-install will see a missing touch-icon. To fix: either symlink/copy `icons/apple-touch-icon-180.png` to `/apple-touch-icon.png` at the project root (vite.config.js rootFiles already lists `apple-touch-icon.png`, so it would be copied to `dist/` automatically) or update all 24 files to point at `/icons/apple-touch-icon-180.png`.
  - Affected files: `versions/aurora.html`, `versions/baroque.html`, `versions/chrome.html`, `versions/collage.html`, `versions/eclipse.html`, `versions/film.html`, `versions/fractal.html`, `versions/gallery.html`, `versions/glitch.html`, `versions/grid.html`, `versions/hallucination.html`, `versions/kraft.html`, `versions/mosaic.html`, `versions/music_video.html`, `versions/neon.html`, `versions/phosphor.html`, `versions/pulse.html`, `versions/smoke.html`, `versions/spectrum.html`, `versions/tape.html`, `versions/typography.html`, `versions/void.html`, `versions/watercolor.html`, `marketplace.html`.

## Medium

- **`versions/music_video.html:446` — `<a id="swr-request-demo" href="/library/manifest.json">` 404s.** The `<a>` is a "request demo" link that points at the curated library manifest, which is populated at prebuild time by `scripts/fetch-library.mjs` from `LIBRARY_BLOB_URL`. Locally missing is documented as expected behavior in AGENTS.md ("Local dev: this is fine (engine has no library to demo)"). On production Vercel, the link will resolve if `LIBRARY_BLOB_URL` is set in the Vercel project environment, otherwise the link 404s post-build. The link is a user-visible footer/action button (not hidden), so the failure mode is "clicking request-demo opens a 404 page" — worth either guarding with a feature-detect or hiding it when the manifest fetch fails.
- **`landing.html:1227` — footer link `<a href="./library/manifest.json">Library manifest</a>` 404s.** Same prebuild dependency as above. Hidden inside a footer `<ul>` but still user-clickable.
- **`campaign.html:835,842,849,856,863` — 5 `<img src="library/p_0X.jpg">` 404s.** The campaign page showcases five preset sets with images (`library/p_01.jpg` … `p_05.jpg`); none exist in the repo or `library/` (which doesn't exist locally at all). These would be populated by the same `LIBRARY_BLOB_URL` prebuild step (if the bundle includes them in the manifest). Five visible broken-image placeholders on a marketing page. Same caveat as above — production depends on `LIBRARY_BLOB_URL` carrying the assets; otherwise all five images fail.

## Low

- **`marketplace.html:101` — `<a href="./marketplace/curated/" id="curated-link" style="display:none">` 404s.** Intentional directory-link fallback, hidden via inline `display:none` and only shown if a JS toggle sets `style.display = ''`. Not user-visible in the default state. The marketplace fetches concrete `.swr-set.json` files (`marketplace/curated/{neon-pulse,smoke-portrait,typography-loud,collage-mag,spectrum-bass,glitch-idm}.swr-set.json`) which **do** exist and return 200 — those are the real fetches.
- **`versions/gallery.html:405` — `<a href="/">sainted word records ↗</a>` 404s in dev.** In production, vercel.json maps `/` → `/landing.html` so the link works. Dev server (Vite) doesn't honor vercel.json rewrites, so `/` returns 404 locally. Cosmetic only — not a bug.

## Pages audited

- **23 variants** in `versions/`: `neon`, `film`, `grid`, `smoke`, `hallucination`, `aurora`, `baroque`, `chrome`, `collage`, `eclipse`, `fractal`, `gallery`, `glitch`, `kraft`, `mosaic`, `music_video`, `phosphor`, `pulse`, `spectrum`, `tape`, `typography`, `void`, `watercolor`.
- **26 marketing/educational** at root: `landing`, `marketplace`, `intro`, `swr-intro-10s`, `tutorial-30s`, `make-video`, `weddings`, `photo`, `about`, `changelog`, `portfolio`, `press`, `status`, `personas`, `interactive-howto`, `market-study`, `profit-plan`, `campaign`, `thanks`, `share-view`, `swr-app`, `swr-campaign-launch-plan`, `swr-dm-templates`, `swr-social-content`, `swr-stripe-setup`, `swr-watermark-plan`.

## Cross-link / orphan check

- All 23 variants are reachable via `/versions` → `/versions.html` (the index page lists all 23 with `/versions/<name>.html` links). No orphan variants.
- `swr-intro-10s.html` and `tutorial-30s.html` are linked from the `landing-personas-v*` series (not in this audit scope) but have no inbound cross-link from any audited file. Both are still reachable as static files in production (no vercel.json rewrite, so they require direct `.html` access). Not strictly orphans, but no in-scope page points at them.
- `photo.html`, `portfolio.html`, `status.html`, `share-view.html`, `swr-app.html`, `weddings.html` have no inbound cross-link from any other audited HTML, but each has a vercel.json rewrite (`/photo`, `/portfolio`, `/status`, `/s/:id`, `/app`, `/weddings`). They are reachable in production but not advertised in the audited surfaces.
- `landing.html` is the canonical root via vercel.json `source: /` → `destination: /landing.html`. Always reachable.

## Mismatches between `vercel.json` rewrites and `vite.config.js` copyStatic rootFiles

- All audited HTMLs that have vercel.json rewrites are present in `vite.config.js` `rootFiles` (verified by re-grep): `landing`, `marketplace`, `intro`, `make-video`, `weddings`, `photo`, `about`, `changelog`, `press`, `status`, `personas`, `thanks`, `portfolio`, `swr-app`, `share-view`. No mismatch.
- `versions/` directory is copied wholesale via `dirs[]` (`{ src: 'versions', dst: 'versions' }`), so all 23 variants deploy without per-file entries. Working as designed.
- `swr-intro-10s.html`, `tutorial-30s.html`, `interactive-howto.html`, `market-study.html`, `profit-plan.html`, `campaign.html`, `swr-campaign-launch-plan.html`, `swr-dm-templates.html`, `swr-social-content.html`, `swr-stripe-setup.html`, `swr-watermark-plan.html` — all present in `rootFiles`; no vercel.json rewrites. They ship as static HTML accessible only via direct `.html` URL. No mismatch, but no marketing funnel points at them in the audited surfaces either.

## `<script type="module">` audit

- The vite plugin `strip-absolute-module-scripts` (vite.config.js lines 386-396) only strips `type="module"` from absolute-path scripts (`src="/..."`); relative-path modules are left alone so Vite can bundle them.
- Within the 49 audited files, only **one** `type="module"` tag exists: `versions/music_video.html:3667 <script type="module" src="../brandkit.client.js">`. Relative path — left untouched, bundled by Vite. No issue.
- (For reference, `engine.html` uses ~20 absolute-path `type="module"` tags which the plugin strips; that's out of audit scope.)

## Script reference resolution

- Every `<script src>` and `<link rel="stylesheet" href>` in the 49 audited files resolves to a file shipped by `copyStatic` (`rootFiles` + `dirs[]` + `styleThumbs`) and returns HTTP 200 from the dev server. **0 missing script refs.**
- All 27 `lib/*.client.js` and 27 `lib/*.css` files referenced by `make-video.html`, `photo.html`, and the variants resolve cleanly.
- All 13 `verify-screenshots/*.png` style thumbs referenced by `versions/gallery.html` exist on disk and ship via the `styleThumbs` block in vite.config.js.

## Stats

- **Total pages audited:** 49
- **Pages with parse5 issues:** 0
- **Pages with broken hrefs/srcs:** 26 (24 due to `/apple-touch-icon.png`, 1 due to campaign images, 1 due to landing.html link; multiple issues can co-occur in one file)
- **Pages with missing `<script>` refs:** 0
- **Total broken ref instances:** 31 (24× `apple-touch-icon.png` + 5× `library/p_0X.jpg` in campaign.html + 1× `/library/manifest.json` in music_video.html + 1× `./library/manifest.json` in landing.html)
- **Orphan HTML files (no inbound cross-link from audited surfaces):** 8 (`photo.html`, `portfolio.html`, `share-view.html`, `status.html`, `swr-app.html`, `swr-intro-10s.html`, `tutorial-30s.html`, `weddings.html`). 6 of the 8 have vercel.json rewrites (still reachable). 2 (`swr-intro-10s.html`, `tutorial-30s.html`) have no rewrite and no inbound link from the audited surfaces, but are linked from `landing-personas-v*` series which is out of scope.

## Recommendation summary (no fixes applied)

1. **Highest impact, lowest risk:** ship `apple-touch-icon.png` at the project root (or change the 24 affected files to point at `/icons/apple-touch-icon-180.png`). `vite.config.js` already lists `apple-touch-icon.png` in `rootFiles`, so creating the file is sufficient.
2. **Verify the production prebuild flow:** confirm that `LIBRARY_BLOB_URL` is set in the Vercel project environment so `library/manifest.json`, `library/p_0X.jpg`, and the curated assets ship in `dist/`. Without it, landing.html, music_video.html, and campaign.html will have user-visible broken links/images in production.
3. **No action needed** for parse5, script resolution, or copyStatic/vercel.json mismatch — those layers are clean.
