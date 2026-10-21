# Changelog

All notable changes to **Sainted Word Records** are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/)
once it hits 1.0.

## [Unreleased]

### Added
- `scripts/media-budget.mjs` (`npm run check:media-budget`) — a per-directory
  budget for the media the build ships, wired into the CI after the build.
  The build-size gate is one number for the whole `dist/`: it says the build
  is too big, not which directory did it. On 2026-10-21 the answer was
  "sixteen media directories, no single culprit" — the shipped media is
  156M of a 173M build.
- `scripts/media-optimize.mjs` (`npm run media:optimize`) — re-encodes the
  shipped video and audio to a delivery bitrate, in place, so no filename,
  URL, manifest or page changes. Dry run by default; `--apply` writes. It
  refuses any output that is larger than its source, or that drifts in
  duration or dimensions, and leaves files that are already under the cap
  alone. On the 2026-10-21 media it would save 31.9M across 19 files.
- `docs/plans/2026-10-21-shipped-media-budget.md` — the plan: what the
  build ships, what the media costs, and the seven slices to get from
  173M back under the original 155M ceiling.

### Fixed
- `tour.html` — 12-stop Jakob Nielsen usability tour (sweep / step / reset).
- `shortcuts-movie.html` — 60-second hyperframe walkthrough of every
  keyboard shortcut (Space, ←/→, number-jump).
- `echo.html` — standalone 30-min black-PNG crossfade art piece.
- `layer-lifecycle.html` — self-contained demo of `Layers.retire` /
  `Layers.unretire` / `Layers.homeAll`.
- `Layers.addText(text, opts)` — user-typed text layers
  (`Layers.setText`, render path with fillText + glow).
- `Layers.retire(id, ms)` / `Layers.unretire(id)` — eases opacity → 0,
  baseScale → 0.4, and rotates the layer 360° over RETIRE_MS; respects
  the `rotationEnabled` gate.
- `Layers.homeAll(ms)` — slides every layer back to its defaults.
- Shift+↑/↓/←/→ — nudge the selected layer's pos.x / pos.y in canvas
  units.
- T+0..9 — look-filter cycler with a 5-step intensity ramp on repeated
  presses; bare 1..9 dispatch the same cycler (no rotation contract).
- Cloud-library FAB + menu (Push / Pull / Sync / Watch) on the engine
  library panel.
- `client/cloud-library.client.js` — `SWR_CLOUD_LIBRARY` API surface.
- `api/library/index.js` + `api/_lib/library-store.js` — local-FS
  manifest + sample zops.
- Debug overlay (`?debug=1`) — fixed bottom-right HUD that logs
  key/filter events + audio features + layer state.
- Unit tests for retire/unretire, layer-text, cloud-library,
  library-store, tour-client, debug-overlay, look-filter cycler,
  engine-keys digit filter, engine-keys keypress dispatch, layer
  lifecycle, layer retire, kit-zip.

### Fixed
- The dashboard loaded `/api/auth/session.js` as a browser script. That is a
  Vercel ES module handler, so the page threw *"Cannot use import statement
  outside a module"* and took the whole dashboard's JavaScript with it. It
  now loads `lib/auth.client.js` — the client the button handler actually
  reads — as a classic script, before the handler runs.
- `window.SWR_AUTH.get()` did not exist. The engine, the dashboard and ten
  variant pages call it to read the session; the auth client only exposed
  `session()`. Every Drive button was calling a missing function and
  rejecting. `get` is now an alias of `session` — same signature, same
  return.
- `vercel.json` lost the `/campaign → /campaign.html` rewrite in a merge,
  so the campaign page 404'd and `check:sitemap` failed. Regenerated with
  `scripts/generate-vercel-rewrites.mjs`.
- `check:dashboard` served the page without production's routing, so every
  route link 404'd and the console error failed the gate; and the session
  endpoint — a Vercel function — could not run in the local static server.
  The check now applies `vercel.json`'s rewrites and answers
  `/api/auth/session` with the contract the function documents for an
  anonymous visitor.
- `check:default-library` served the engine from `python3 -m http.server`,
  which handles one request at a time. The engine asks for a dozen files
  in parallel, the server reset the overflow, and the request for
  `client/default-library.client.js` was among the casualties — so the
  script never ran and the check reported "SWR_DEFAULT_LIBRARY missing",
  "items=0", "layers=0": the seeded set absent, which is exactly the
  symptom the check exists to catch. The cause was the server. It now
  uses a threaded Node server, and the smoke takes 2s instead of timing
  out for 125s.
- `scripts/check-cross-tab-unit.mjs` had a misplaced bracket in the
  localStorage stub — `delete data[String(k));` instead of
  `delete data[String(k)];` — so the file did not parse and the syntax
  gate failed on it.
- The redesign home page (`index.html`) had no route. The site's root is
  `landing.html` (vercel.json rewrites `/` → `/landing.html`), and
  `routes.mjs` mapped *both* files to `/`, so no route could be resolved
  back to a single file: "index.html: route / does not serve this file".
  `index.html` now keeps its own route (`/index`), the rewrite
  generator emits `/index → /index.html` (Vercel serves `/index.html`
  at the root, not at `/index`), and the sitemap lists the two new
  pages.
- `for-creators.html` shipped without the shared chrome — no `<swr-nav>`,
  no `<swr-footer>`, no `og:image`, no `canonical` — so the site-chrome
  gate failed on it.
- Engine "Hooks" button could only ever answer *"no song loaded"*.
  `client/hook-detector.client.js` reads the song to analyse from
  `window.SWR_LAST_SONG`; the engine never loaded the saved-song bridge
  (`versions/last-song.js`) even though `lib/audio.client.js` was already
  writing the identical IndexedDB record it reads. The engine now loads the
  bridge, and `lib/audio.client.js` refreshes it on every song load (file
  picker, drag-and-drop, generated audio) — the bridge caches its promise
  once at load time.
- `versions/neon.html` published no core globals, so 21 of the 53 shared
  modules silently no-op'd there: `window.Audio` (saved projects carried no
  song, grade presets rendered without audio reactivity), `window.Layers`,
  `window.Library`, `window.setStatus` and `window.A` are now published, and
  `A.audioEl` aliases the page's `A.el` so modules written against either
  naming convention find the same element.
- `api/_lib/kv.js`: invite-code schema marker v1 → v2 auto-migration
  (unblocks the `Register Invite Codes` GH Action).
- Library thumbnails: corrupt base64 detection + stale-blob fallback
  placeholder; auto-purge on boot via `lib/library-hygiene.client.js`.
- WebGL uniform errors: `null` location guards in `fx-postprocess.js`
  and `versions-presets.js`.
- Reserve / void warnings on missing-pristine transitions.
- The CI gate was red on `main` itself (it only runs on pull requests, so
  the breakage after the `/campaign` launch went unnoticed). Six causes,
  all fixed: eight pages were missing the shared chrome (`<swr-nav>`,
  `<swr-footer>`, `og:image`, `canonical`); `campaign.html` shipped a
  rewrite but was never copied into `dist/`; the link checks treated a
  `#fragment` as part of the path, so `/composer#onboarding` read as
  dead (the composer's onboarding pill now carries that id);
  `check:svg-grade-integration` called `.equals()` on the `Uint8Array`
  Puppeteer returns; two doc claims contradicted the tree; and the
  automix smoke asserted the engine's globals after a fixed 400 ms
  wait instead of waiting for the deferred module that publishes them.
- Video layers could stay invisible (black stage, no clip) while the same
  file played on the engine. Two Chrome behaviours did it: a video
  paused while it is still loading has its media pipeline suspended and
  drops back to `readyState 1`, and while a `play()` promise is pending
  `paused` stays true, so the next frame called `play()` again — and a
  second `play()` on a pending element resets it to `readyState 1`. The
  render gate (`readyState < 2`) then skipped the layer. The shared
  render core made it worse: it paused the video of every layer whose
  opacity was `<= 0.004`, which is every new layer for the length of
  its fade-in. New `lib/video-sync.client.js` drives playback without
  trusting `paused` (one play in flight, re-arm a stalled element at
  most once a second); the core no longer pauses a still-loading video;
  the engine and the 15 variant pages call the helper.
- Video library thumbnails came out as black rectangles on the variant
  pages. The thumbnail was captured at t=0, and t=0 is black on
  anything that fades in — which is most real footage (the same clip
  also read `luma: 0`, so the library's colour analysis was wrong too).
  The engine already avoided this: `lib/library.client.js` seeks to a
  poster frame before grabbing the thumb. New
  `lib/video-thumb.client.js` applies the same rule to the 16 variant
  pages — seek to 1s, or the middle of anything shorter, and fall back
  to the current frame if the clip cannot be seeked.

### Changed
- Bare 1..9 no longer selects layers (the previous behaviour
  surfaced audio rot reactors and caused accidental rotation).
- Help text remapped: digit row = filter slots, T-prefix = alias.
- `VersionsPresets.SHORTCUT_PRESETS` (Cmd+1..9) and `Layer.autoMapLayer`
  (Alt+1..6) preserved for muscle memory.
- `client/look-filter-cycler.client.js`: `applyScaled()` no longer
  scales `mutAlgo` (Trap 5).
- `client/debug-overlay.client.js`: only mounts when `?debug=1` or
  `localStorage['swr.debug'] = '1'`.

### Removed
- Implicit layer rotation on bare-digit selection.

## [0.x] — initial engine era (2025-01 → 2026-10)

Internal development; no formal releases prior to v1.0.

[Unreleased]: https://github.com/kajica2/sainted-word-records/compare/HEAD...HEAD
