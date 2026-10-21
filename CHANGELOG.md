# Changelog

All notable changes to **Sainted Word Records** are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/)
once it hits 1.0.

## [Unreleased]

### Added
- `check:live-input` — the Live control end to end in a real browser, with a
  synthetic camera and microphone: the video is actually playing, the stage
  pixels move, the mic reaches the engine's own analyser, and the devices
  are released on stop. It starts its own static server over the built
  `dist/`, so it is one command with no external setup, and it is now a
  step in the `full` group (it was reachable from no gate).
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
- The master rotation toggle defaulted to **off**, so every layer was born
  with `rotationEnabled === false` and no audio-driven or manual rotation
  ran until the user pressed the ↻ button. `engine-keys.client.js`'s
  `loadMasterEnabled()` returned `false` for a fresh profile, and the
  `Layers.add` wrapper copies the master onto every new layer — so the
  master silently overrode `Layers.add`'s own `rotationEnabled: true`. The
  master is a mute switch, so it now defaults to enabled (its sibling
  tx-master already did); an explicit `localStorage['swr.rotMaster.enabled']`
  is still honoured.
- The generation archives were not reproducible: each zip entry carried the
  **source file's filesystem mtime**, and `scripts/lib/zip.mjs`'s
  `dosDateTime()` read it with **local-time** getters, so a bare `touch` or a
  different `TZ` changed the archive bytes with identical content. Entries
  now carry one content-derived timestamp per generation
  (`generations.date` at 00:00:00Z) and the DOS time is encoded in UTC.
- `check:capture-smoke` died with *"Execution context was destroyed, most
  likely because of a navigation"*: `page.setRequestInterception()` does not
  intercept the service-worker script fetch, so blocking `/sw.js` left the
  worker free to register, claim the page and fire `pwa-bootstrap.js`'s
  `controllerchange` → `location.reload()`. The smoke now neutralises the
  worker the way the repo's other browser suites do — a launch flag
  (`--disable-features=ServiceWorker,ServiceWorkerOnUI`), a stubbed
  `navigator.serviceWorker.register`, and a seeded `swr_app_version_seen`
  so `lib/app-version-bust.js` does not hard-reload a cold profile.
- `verify-rot-master.mjs` asserted `window.SWR.RENDER`, a global that does
  not exist anywhere in the tree; `engine.html` publishes `SWR.Renderer`.
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
