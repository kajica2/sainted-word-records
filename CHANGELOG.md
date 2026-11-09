# Changelog

All notable changes to **Sainted Word Records** are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/)
once it hits 1.0.

## [Unreleased]

### Changed
- The stage holds at most 3 layers. A fourth add is refused, a remap assigns three roles, and a saved stack restores only the first three. Starting the camera when the stage is already full leaves the existing layers in place.

### Added
- **Responsive overflow gate** (`check:responsive-overflow`, in the `check`
  group) — asserts that no page scrolls sideways at 390×844 or 1440×900, and
  names the element that crosses the viewport and by how much. It also
  asserts that the dashboard's Auto-rotate master toggle is on screen: that
  control had run 143px past the right edge of the console, so it was
  invisible and unclickable. Reverting any one of the four fixes it covers
  makes the gate fail with the pre-fix number.
- Repository guide with task-based entry points, module responsibilities, and product voice guidance; README introduction distinguishes browser rendering from optional cloud services.
- **Guest sign-in with Firebase Anonymous Auth** — a "Continue as guest"
  button on the login page: no consent screen, no test-user list. The
  browser signs in anonymously with the Firebase Web SDK, and the ID
  token is exchanged at `POST /api/auth/firebase-anon` for an ordinary
  `swrc_session` cookie — the session model does not change, the token is
  only an identity assertion at exchange time. The public Firebase web
  config is **served by the server** (`GET /api/auth/firebase-anon?action=config`),
  so one build works across projects and the key is rotated by changing
  an env var; the client never hard-codes one. The button only appears
  when the server says the feature is configured.
- **Firestore as the auth store (opt-in)** — `SWR_AUTH_STORE=firestore`
  moves the users, the provider links, the sessions, the verification
  tokens and the per-user connect blob into Firestore. `api/_lib/db.js`
  keeps every export name, so no route changes; the switch is read per
  call and is **off by default**. The trade-off against the project's
  "Local-first" rule is stated plainly in
  `docs/plans/firestore-auth-store.md`.
- `zod` is now a declared **runtime** dependency. The contract layer
  already imported it at runtime from two routes while it was undeclared,
  which was a latent production-deploy failure.
- The **Studio Command Center** — one extended frontend for every engine
  surface. It loads ON DEMAND: a 2 KB launcher draws the ◈ button and pulls
  the implementation the first time it is used, so a variant visitor who
  never opens the Command Center does not download its 67 KB. The 13 full variants (the ones with a Layers stack, a Library
  and a live output canvas) each grew their own chrome, and the depth an
  operator wants — live spectrum, the FX stack, the hook detector, the
  render-cost ledger — was duplicated per variant or missing. The Command
  Center is a single control surface bound to the API the variants
  already publish: `SWR.Audio/Library/Layers`, `Audio.feat`, `FX.state`,
  `SWR_STATS`, `SWR_HOOK_DETECTOR`, `SWR_LOOKS`. Nothing in it is
  mocked — the filters drive the surface's own `FX.set*`, the cost ledger
  reads `SWR_STATS.summary()`, and the personas are the surface's own
  looks. It opens with a `◈` launcher or `?cc=1`, and Escape closes it.
  Injected by the codemod system, so `versions/manifest.json` records it
  and `versions/verify-codemods.mjs` re-runs it in a sandbox.
- The **`/alternate` "Chain" view** — an Ozone-style mastering surface
  over the same engine. Five module cards, a three-position mode knob,
  threshold / ceiling / character, four output faders with live Peak and
  LUFS, and a live response curve. The Ozone controls are not decorative:
  the eight reactor targets in `lib/apply-reactors.js` are partitioned
  across the modules, so powering one off removes exactly its own
  contribution, and the mode knob swaps the engine's own ease curve. It
  wraps `applyReactor` rather than forking the engine, and the default
  state leaves every target active — mounting the chain must not change
  what the engine does until the user asks it to. Reachable at
  `/alternate`, `/engine.html?chain=1` and `/engine.html#chain`.
- The **`/play` deep-link variant** — the engine with three URL toggles
  (`?video`, `?loop`, `?photo_slide`). The URL is the source of truth
  and the toolbar pills mirror it. It reuses the engine rather than
  copying it, so it inherits upstream engine fixes instead of needing a
  re-port after every upstream move.
- The **Media Source** panel — where the audio comes from, next to the
  loaded video instead of buried in a global settings page. The source is
  the video's own track, a separate audio file, or nothing; the panel also
  carries the sync toggle and the audio offset (milliseconds, **positive
  delays the audio**). The engine behind it changed with it: the media
  element's `MediaElementAudioSourceNode` is now built on
  `loadedmetadata` / `canplay` instead of at load time, and **one clock
  drives everything** — the bar counter, the beat timestamps and the beat
  phase read the media element's `currentTime` (the external file's, when
  one is loaded) rather than an independent `requestAnimationFrame` timer.
  A separate file becomes the master: the music is what you hear and what
  the visuals react to, and the picture is corrected onto it (80 ms
  threshold, so it never jitters). With the video's own track the picture
  and the sound are the same element, so the sync and the offset are
  disabled with a note saying why — they have nothing to trim.
- The export now records **the audio the preview hears**. All three export
  paths tap the engine's analyser, whose input is the current audio
  source, so the file carries whatever the panel is set to — with no
  second set of export controls that could disagree with the preview. (Two
  of the three paths passed a string and a media element where the
  recorder needs an `AudioNode`, so they produced video-only files.)
- A video song becomes a layer, in sync with the audio. Load a video file
  as the song and its picture joins the stage automatically: the layer
  shares the song's **own** `<video>` element rather than a second one, so
  play, pause, seek and rate move the picture and the sound together —
  the sync is structural, not corrected frame by frame, and an exported
  music video cannot drift from its track. The layer is left out of saved
  compositions (the song's own restore path brings it back), and the
  engine's renderer no longer drives the element, so nothing can restart
  the song from zero mid-playback.
- The shipped media off-site — the curated packs (582 files, 39.6 MB) can be
  served from an off-site host instead of the deploy. Set `PACKS_BASE` and
  the build ships only `packs/manifest.json`, with its `base` rewritten to
  that URL; the media is fetched cross-origin and never enters the build.
  `npm run media:publish` uploads the packs to Vercel Blob or the Hugging
  Face Hub, prints the `PACKS_BASE=` line for the deploy environment, and
  verifies that the host serves `access-control-allow-origin` — the engine
  fetches the media from its own origin, so a host without CORS would break
  the packs at runtime. Unset, nothing changes: the whole directory ships
  exactly as before.
- The store — one data file (`site-map.json` → `store`) drives the whole
  storefront. `lib/store.client.js` paints the download catalogue into any
  `[data-store]` container (the marketplace lists the products itself — add
  one to the data file and it appears, with no HTML edit), and wires every
  `[data-stripe-product]` button to its Stripe Payment Link. A product
  without a link renders as "Coming soon" / a disabled button, never as a
  dead `buy.stripe.com` URL — the placeholder URLs the shop and the
  campaign used to ship are gone. The links can also come from the build
  (`GUMROAD_STORE_URL`, `GUMROAD_LINKS`, `STRIPE_LINKS`).
- Off-site hosting for the download products — `npm run store:build`
  packages each product's sources into `out/store/<id>.zip` (outside
  `dist/`, so the payloads never ship with the site) and
  `npm run store:publish` pushes them to Vercel Blob or the Hugging Face
  Hub and writes the public URL back into the manifest.
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
- The **one shared reactor contract** — `lib/apply-reactors.js` publishes
  `window.SWR_REACTORS`: one `UNIT` table, one `CLAMP` table, one
  `TARGETS` allowlist and one dispatch loop, and all 15 variant pages
  plus `engine.html` call it — 16 surfaces. Every surface used to
  hand-type its own reactor chain with its own unit table: `x` was 250 on
  film, 300 on smoke and 180 on eclipse, `scale` was unclamped on all of
  them, `opacity` clamped to 1.0 on fourteen surfaces and 1.5 on two
  (engine.html and hallucination), and `versions/grid.html`
  dropped `x` and `y` silently, so a preset that said `{target:'x'}` did
  nothing at all and nothing warned. The historical tables are still
  there — one line each — as the named compatibility `UNITS` tables, and
  the gate `scripts/check-apply-reactor-unit.mjs` asserts the shared table
  and its clamps, so the next page cannot reintroduce a private
  multiplier.
- The **section cue** — `client/automix-arc.client.js` now consumes the
  section the detector finds. The arc is built offline from a decoded
  buffer while `client/section-detector.client.js` detects boundaries
  live from the engine's own audio features, so a detected section
  reached the chapter scheduler but never the arc. A boundary now only
  BIASES which transition the next act boundary picks, and the cue is
  additive — a cue's opinion overrides the act plan's, and with no cue
  armed the original warmth/intensity rule is untouched — and one-shot:
  the next act transition consumes it, so four boundaries in one section
  cannot stack four votes into a single pick.
  `client/section-detector.client.js` also fires `swr-section-reset`, a
  separate event from `swr-section-change`, carrying
  `detail: { reason, dropped }`, whenever it restarts its stream: an
  emptied map is never dressed up as a boundary, and a cue from the
  previous song cannot bias the new song's first act.

### Fixed
- **Movie files never reached the mix.** A `.mov`, `.mkv` or `.avi` often arrives with an empty `File.type` (or `application/octet-stream`). Both import paths kept only `video/*` and `image/*`, so the file was skipped before it could become a layer. The kind now comes from the extension in that case, the file dialog lists those extensions, and a click on the stored movie stages it as video. Neon's own importer uses that classifier too, so an empty-type movie dropped there becomes a video layer instead of being skipped or stored as a still.
- **The last song is preloaded on the next visit.** Loading a song already writes it to this browser. The next open reads that record back onto a media element that lives in the page, so the browser fetches it before Play. The default clip no longer steps in while that record is waiting, and the restore runs once so it cannot interrupt playback.
- **The NEON demo verify named a stalled control.** A control that stopped delivering animation frames used to sit until Puppeteer's 180s protocol timeout, and the log said `verify run` with no id. Each step now has a Node-side deadline that names the control, and the frame wait itself fails after 5s when the page is still alive but frames never arrive. The run after `layer:baseScale` was the one that hung (`layer:blend`).
- **Neon auto-start threw `Audio.load is not a function`.** The shared
  audio core (`lib/audio.client.js`) only published `loadFile`, while the
  start overlay on `versions/neon.html` and `neon.html` — and `swr-sets` —
  still call `SWR.Audio.load(file)`. Neon publishes that core as
  `SWR.Audio`, so the default song never started. `load` is now the same
  path as `loadFile`.
- **The engine page logged a WebGL failure, a document 504, and a long frame on every paint.** Post-process now follows the WebGL gate: with it off (the default) it does not call `getContext` and does not warn, and it still publishes `window.FX` so looks and sliders have somewhere to write. The warning stays only when the page asked for WebGL and the browser refused a context. A navigation that throws or comes back 5xx is served from the precached shell (`/engine`, `/engine.html`, `/`, `/offline.html`) instead of the gateway response. The stage palette tint is rasterised once per size and palette and blitted, rather than rebuilt as two full-canvas gradients inside every animation frame.
- **Five more pages scrolled sideways, and one threw on every load.** The
  KAI SWARM QA surface went from seventeen routes to a hundred and forty-eight
  — every route that resolves the same way in preview and in production —
  and found five more real defects. Four were the class cycle 2 already
  fixed: a flex row with `flex-wrap: nowrap` whose children cannot shrink,
  so the last child ran past the viewport — `/versions/gallery`'s back link
  (27px), `/versions/temple-of-control`'s status bar (20px), `/shop`'s CTA
  (106px) and `/director-mode-sainted-word`'s theme toggle (101px). The
  fifth was different: `/engine-personas` read `currentPalette` about six
  lines above the `let` that declares it, so every load threw
  `ReferenceError: Cannot access 'currentPalette' before initialization`
  and the page's canvas never painted. `check:page-errors` is the new gate
  for that class.
- **A smoke could serve a stale page.** `scripts/with-dist.mjs` decided
  whether `dist/` was current by watching 14 named files and **no pages at
  all**, while the repo ships 114 root HTML files — so changing a page left
  `dist/` "fresh" and the smoke tested the old build. It bit for real: the
  preset-editor smoke asserted a tick budget while the served page was nine
  minutes older than the source. The check now watches every root page plus
  `site-map.json` and `package.json`, and two new unit cases pin it.
- **The preset editor's tick budget was one sample of one tick.** The 2ms
  budget was measured from a single tick, which swung from 0.000ms
  standalone to 2.200ms inside the full gate — noise, not a regression. It
  now measures the steady state, the median of seven ticks, and reports the
  worst alongside it. A genuinely slow tick still fails the gate.
- **CI could spend thirty minutes on an unreachable apt mirror.** The
  ffmpeg step tried apt three times, each attempt bounded at roughly ten
  minutes, before reaching the static build that actually works. One
  bounded attempt, then the static fallback: worst case ~5 minutes.
- **Four pages scrolled sideways, and one of them hid a control off-screen.**
  The KAI SWARM QA pass widened its surface from three routes to seventeen and
  found four pages whose content ran past the viewport. Each was measured
  against the deployed site as well as a local preview of the same build, so
  none was a preview artifact. `/persona-library` carried a 402px nowrap
  label in a wrapping flex row (32px over at 390px); `/style-guide` and
  `/tiktok` each had a grid track flooring at min-content, because a bare
  `1fr` replaced a `minmax(0, 1fr)` (213px and 20px over at 390px); and
  `/dashboard` ran 143px past the right edge at 1440px, which pushed the
  Auto-rotate master toggle — the control that drives every layer at once —
  completely off-screen. The dashboard's own mobile rules were not taking
  effect: Tailwind's CDN injects its utility sheet after the page's `<style>`,
  so a plain class rule lost to `.flex` at equal specificity. Each fix is the
  smallest one that addresses its own cause.
- **The bench gate demanded five frame samples from a host that could not
  draw five frames.** `check:bench-smoke` asserted `report.samples >= 5` — a
  flat floor. On the CI runner of run 42118548118 the bench page rendered at
  1.30 fps, so a 3.5 s run held 4 frame samples, and the gate failed a report
  whose measurement was sound. The count is now derived from the host's own
  measured frame rate, with one frame of phase slack, and it is capped at the
  flat requirement — so a fast host still has to carry all five. Same shape as
  the A/V depth floor beside it.
- **Five more gates had the same orphan-server bug.** `test:asset-curator`,
  `check:variant-switcher-smoke`, `check:photo-slideshow`,
  `check:default-library` and `verify:site-nav` spawn a
  `python3 -m http.server` and killed it only on the success path, so any
  early exit orphaned it. The orphan kept the fixed port, the next run's
  own server could not bind, and the gate polled the STALE server until it
  reported `server timeout` — a failure with nothing to do with the code
  under test. All five now kill their server from a `process.on('exit')`
  handler. Mutation-tested: force an early exit and count the listeners —
  with the fix the port is free (0), without it the server leaks (1).
- **CI could fail because the runner's apt mirror was down.** The `Install ffmpeg`
  step installs the `ffprobe` the generations gate measures the media with. Its
  apt path was already bounded and retried, but all three bounded attempts can
  fail against the same unreachable mirror — which happened on runs 42103655663
  and 42137248795, and blocked a merge each time. The step now falls back to a
  STATIC ffmpeg build: one tarball, no package manager, so a mirror that is
  down cannot fail the whole build.
- **The media-budget gate counted files the deploy never receives.** It summed
  `dist/<dir>` on disk, but the deploy ships the git tree. `keyart/` is the case
  in point: 58 files are force-tracked and ship (~9.4M), while 20 ignored `.png`
  originals also sit in the tree (~33M) and never ship — so the gate was red on
  the developer's own machine for a payload the deploy never received. The gate
  now skips a dist file whose source exists in the tree but is not tracked, and
  prints every skip so the exclusion is visible rather than silent. In a clean
  checkout the measurement is byte-for-byte what it was.
- **The KAI SWARM QA pass found three real defects and could not act on any of
  them.** The read-only QA pass over `/`, `/engine/` and `/versions` produced six findings
  in four tasks — two of them duplicates, and none actionable, because the runner stored
  `err.message` with no stack, recorded overflow as a bare boolean, and never looked at
  the HTTP status of the scripts it loaded. Three fixes: `versions.html` read
  `[].concat(buckets.entries())`, and `Array.prototype.concat` does not spread an
  iterator, so `group[1]` was `undefined` and the preset timeline threw
  `Cannot read properties of undefined (reading 'length')` the moment any preset arrived
  (`Array.from` instead); the QA route was `/engine/`, which `vite preview` resolves to
  the **home page** through its SPA fallback, so the engine app was never tested (now
  `/engine`); and the home page's header row overflowed a 390px viewport by 107px (the
  brand is `nowrap` at 226px plus a 148px CTA — the same header was on
  `for-creators.html`). The runner now captures the error's stack frame, the console
  message's location, every script's status and the elements that cross the viewport.
  The same three routes now report **zero** findings.
- **The bench gate asked a slow host for frames it could not draw in the time it
  allowed.** `runTest` ends on a wall-clock timer, but the measurement arrives at the
  host's frame rate: the sampler primes on one rAF callback and records an interval on
  the next, and the A/V samples come from the same render loop. On a host whose frame
  time exceeds half the window the timer fires before the first frame is presented, so
  the report is compiled with no video and no A/V samples, `scoreReport` returns
  `invalid`, and the advisor has no grade to give — CI run `42219635267` failed five
  advisor assertions with `grade: null` on a report the suite itself had graded `F`.
  The run window is now derived from the host's own measured frame rate (`runWindowFor`),
  with the window the gate always asked for as the floor and a ceiling so a broken host
  cannot hang the gate.
- **The swarm's ledger priced a Grok reservation and settled it, and the day file
  never said that MiniMax did the work.** The reservation is deliberately priced at the
  chain's most expensive member, so a chain that lands on a cheap model still holds the
  expensive rate — correct, and conservative. But the *settlement* record carried only the
  amount and the token counts: no model. The day's file therefore could not attribute a
  spend to the provider that actually served it, and a multi-provider day's costs could
  not be told apart. The settlement now records the model that answered — even when that
  model could not be priced (the attribution is not the pricing), and `null` when the
  caller reports none, because a wrong attribution is worse than a missing one.
- **The WebGL gate went red on a navigation, not on WebGL.** CI run `42244823136` failed
  `check:webgl-default-off` with "Execution context was destroyed, most likely because of a
  navigation" — on its FIRST assertion, while the other ten passed. The cause is the PWA
  bootstrap: when the service worker takes control for the first time it reloads the page,
  and on a cold Chrome profile that install happens during the gate's first load, so the
  reload can land while the gate is reading the page. Only the first assertion saw it,
  because every later page in the same profile is already controlled and never reloads. The
  gate now treats a destroyed context as "the page is reloading" — it waits for the reload
  to land and reads the page it lands on — and rethrows every other error untouched, so the
  assertion keeps its teeth. A new gate (`check:webgl-nav-probe`) reproduces the destroyed
  context deterministically and pins both halves of that contract.
- **A gate that passed in CI failed in every fresh worktree.** `check:auth-store-dispatch-unit`
  copies `api/_lib` into a temp directory so the shipped code runs unmodified, and symlinks
  `node_modules` next to the copy so `import '@vercel/blob'` resolves. It symlinked
  `ROOT/node_modules` — but a git worktree has no `node_modules` of its own; the real one lives
  in the main checkout one level up. The symlink dangled, the import failed with
  `ERR_MODULE_NOT_FOUND`, and the gate reported a failure that had nothing to do with the code
  it tests. It now looks for the nearest `node_modules` above the checkout.
- **The PWA reloaded the page for no reason — and that is what broke two gates.**
  `pwa-bootstrap.js` reloaded on every `controllerchange`. Because `sw.js` calls
  `clients.claim()`, the FIRST registration takes the client over immediately, so on a cold
  profile the page reloaded itself seconds after it loaded — when there was nothing to reload,
  because it had just been fetched from the network with the current assets. The reload tore the
  page down underneath whatever was reading it: `check:webgl-default-off` lost its first read
  ("Execution context was destroyed, most likely because of a navigation") and `check:live-input`
  lost the camera it had just started. The page now reloads only when an UPDATED worker takes
  over a page that was ALREADY controlled — which is the update toast's flow, and it still
  works. A new gate (`check:pwa-sw-reload`) counts page loads in `sessionStorage` and pins both
  directions: the first takeover does not reload, an update still does.
- **A gate that failed early left its test server running, and the next run
  on the same fixed port failed for the wrong reason.** `check:command-center`,
  `check:chain-view` and `check:targeting-smoke` spawn a
  `python3 -m http.server` and killed it only on the success path — so any
  early `process.exit(1)` orphaned it. The orphan kept the port, the next
  run's own server could not bind, and the gate polled the STALE server
  until it reported `server timeout`: a failure that had nothing to do with
  the code under test. One such orphan was found squatting on port 54041
  for 36 hours, serving 404s from a worktree that no longer existed. Each
  of the three now kills its server from a `process.on('exit')` handler, so
  the server dies on every exit path. Verified by forcing an early failure:
  with the fix the port is free afterwards (0 listeners), without it the
  server leaks (1 listener).
- **The swarm agent's chat crashed on Node 24+ when stdin reached EOF during
  a turn.** `software-factory/swr-agent.mjs` called `rl.prompt()` on a
  readline interface that stdin had already closed. Node 22 made that a
  silent no-op; Node 24 and later throw `ERR_USE_AFTER_CLOSE`, so the CLI
  exited 1 instead of 0 on a perfectly normal `/exit`. The prompts are now
  guarded by `rl.closed` — which is `undefined` while open and `true` once
  closed on both runtimes — so the agent works on Node 22 and Node 26
  alike. The swarm-guard wiring suite fails 49/1 on Node 26 without the
  guard and passes 50/50 with it; it passes 50/50 on Node 22, Node 24 and
  Node 26.
- **The bench smoke's A/V depth floor was a flat 2, so it failed on a slow
  CI runner that could only ever produce 1.** The gate asserts "every run
  measured the clock" — every run records at least one A/V sample, and the
  typical run records at least two. The second half was a constant, which
  is right for a HOST that samples once per run but wrong for a slow
  MACHINE: on a CI runner measured on 2026-11-05 (run `42024230323`)
  **every** run produced exactly one sample — `[1,1,1,1,1,1,1,1,1,1]` —
  because the bench page renders at ~0.29 fps there and a 3.5 s run can
  only contain one frame. The gate failed a measurement that was perfect:
  the injected lag read 12.0 ms, the clean run read 0.0 ms, the
  differential was exact, and both interpolation assertions passed. The only
  red line was the depth floor. The earlier warm-up fix had addressed the
  COLD first run; it could not address a runner where every run yields 1.
  The floor is now **derived from the host's own measured frame rate**
  (`scripts/lib/bench-depth.mjs`): a run can only hold as many samples as
  the host can draw frames, with one frame of phase slack. Where the host
  is fast enough for two, the floor is still 2 — so a host that renders at
  speed but samples once per run is still caught. Pinned by a new unit gate
  (`check:bench-depth-unit`) that fails if the rule is reverted to a flat 2.
- **A reader could keep a crashed worker's lease lock alive, wedging the
  agent pool.** `software-factory/worker-lease.mjs` refreshed the lock file
  from `_readLeases()`, and `_readLeases()` is called by READERS (a
  `status()` call, any process watching the pool) as well as by the lock
  HOLDER. So merely LOOKING at the pool refreshed the lock of a holder
  that had already crashed. The lock's age is the only signal the
  staleness check has, so a dead lock kept looking alive: it never aged
  past `staleLockMs`, `claim()` waited the full `lockWaitMs` and threw
  *"could not acquire the lease lock"*, and the pool stayed wedged for as
  long as anything read the status. Reproduced with two processes — with
  no reader the crashed lock was broken in 8 ms; with an external monitor
  polling `status()` every 200 ms the claim threw after the full wait.
  (The single-process case hides it: the claim's own busy-wait starves
  the reader's timer, so the lock ages out during the wait anyway.) Only
  the HOLDER may refresh a lock now: `_touchLock()` moved from
  `_readLeases()` into `_withLock()`. The regression test fails on the
  old behaviour and passes on the fix.
- **Twelve CI gates were red on `main` and one branch fixes all of them.**
  The failures shared eight root causes, each of which had taken out a
  gate that had nothing to do with the change that caused it:
  - `check:no-rotate-zoom` shelled out to `rg`, which the CI runner does
    not have; the swallowed `catch {}` left it with an empty file list
    and a green-looking pass. It now walks the tree with Node's own
    `fs` and has no external dependency at all.
  - `check:site-chrome` failed on `artists/index.html`'s canonical URL
    (`/artists` against a route that serves `/artists/`).
  - `check:command-center` read a stale `aria-pressed`: the Command
    Center set it, then the companion wire script bound the same
    attribute and wrote the OLD value back. The Command Center now
    publishes the toggles it owns (`ownedToggles`) and the wire script
    skips them. The watermark handler also read a `wm.enabled` property
    the module does not expose — it has `isEnabled()` — so the watermark
    could never be switched off.
  - `check:chain-view` asserted a scale the engine deliberately silences
    when the global zoom kill-switch is off. The kill-switch stays; the
    assertion now knows about it.
  - `check:default-library`, `verify:rotation-enabled`, `check:automix-smoke`
    and `check:layer-groups-smoke` failed because `SWR_IMAGE_LANE` diverts
    image assets away from `Layers.list`. The gates now read the lanes
    the engine actually uses.
  - `check:bench-smoke` bound a hardcoded port (5187); one collision made
    every one of its 42 assertions fail identically. It binds an
    OS-assigned ephemeral port now.
  - `verify:genops` expected keymap bindings that were replaced, and
    `verify-story-graph` set `opacity` on an undefined value.
- **The NEON regression guards ran nowhere.** `check:neon-v2-phase1` and
  `check:neon-audio-v3` shipped with their branches but were in neither
  `package.json` nor the check group nor CI. A guard nobody runs is a
  comment; both are registered now.
- **Two presets generated by the daily pipeline never reached `main`** —
  "Dune Plasma Lateral" and "Vapor Curl Counter" (2026-08-23) existed
  only on a dead branch. Their files are restored and the manifest is
  synced, so `preset-pipeline/verify.mjs` reports 74/74.
- **`check:grade-smoke` sampled the DOM mid-transition and made the whole
  `check` group red.** The gate asserts that the house grade sits on the
  **topmost visible** canvas — the fx overlay when it is up, the stage
  otherwise — and it read the DOM **once**, immediately after `SWR_NATURAL`
  appeared. It failed intermittently (3/3 locally on `origin/main`) because
  the grade is re-applied every animation frame by
  `lib/swr-natural.client.js` while the fx overlay's **visibility** is
  toggled on its own rAF loop by `fx-postprocess.js`. A read landing
  between those two loops sees the grade still on the canvas that was
  topmost one frame ago — both directions occur (overlay just shown, grade
  still on the stage; overlay just hidden, grade still on the overlay).
  Measured with a per-frame probe: the invariant holds within **one** frame
  and then holds for 58-60 consecutive frames. The check now waits for it
  to hold across 5 consecutive frames and asserts the settled state — still
  falsifiable, since a grade on the wrong canvas never settles (the
  mutation test inverting `gradeTopmost` fails it with
  `gotTopmost:false, settled:false`).
- **The CI workflow published the SAME check-run context twice for one
  commit, and its job timeout was too tight to survive a slow step.** Three
  defects in `.github/workflows/ci.yml`:
  1. The `push` trigger and the `pull_request` trigger both fire for a
     branch that has an open PR, and both publish a check-run with the
     **identical context name** (`check + verify + build-size`) for the same
     SHA. GitHub matches a required status check by **context name**, so the
     pair is ambiguous: the branch-protection ruleset on `main` (which
     requires exactly that context) is decided by whichever twin finished
     last. This predates the consolidation — `origin/main`'s
     `push.branches-ignore: [main]` fires the push event for a non-`main`
     branch too, and the 2026-11-03 SHA showed the same shape (push
     **failure** alongside pull_request **success**). Measured on
     2026-11-04: the PR-event run passed all 33 steps while its push-event
     twin was cancelled — a green commit showing `UNSTABLE`, and a ruleset
     would have blocked the merge. The trigger is now `push.branches:
     [main]`, so there is exactly ONE run per commit (the PR run for a
     branch, the push run once it lands on `main`), matching
     `visual-correct.yml`. This also keeps the `main`-push gate the
     production-readiness plan asks for ("CI runs on main and PRs"), which
     dropping the trigger filter had been threatening to cost.
  2. `timeout-minutes` was **45** (added by the consolidation), against a
     chain that takes ~22m — not enough headroom for one slow step.
  3. The ffmpeg install was **unbounded**. One run stalled **34m22s** in
     `apt-get update` (against 51s on the twin PR run of the same commit)
     and was then killed by the timeout with `check:full` never started — a
     red CI that had proved nothing. The install is now bounded
     (`timeout 120` on the update, `timeout 300` on the install), retried
     three times, and repairs dpkg's lock between attempts so a killed
     install cannot make every later attempt fail for the wrong reason. The
     job ceiling is now **90 minutes**.
- **The bench smoke's sampling-error margin was a fixed 4 ms, and the
  measurement it guards is phase-dependent.** Without interpolation the run
  presents the NEWEST sample, so its sampling error is the age of that
  sample — the time since the last fill. How old that is depends on where
  the render loop lands relative to the fill timer. When the render rate
  matches the fill rate the phase locks and every frame sees the SAME age:
  measured **3.5 ms** on one CI runner, **9.7 ms** on another, and as little
  as **1.4 ms** when the render lands just after a fill — with the fill
  rate identical (60 Hz) in every case. The interpolated run read **0.0 ms**
  throughout, so the difference was only ever as large as the phase
  allowed, and **no fixed margin can work**: a 4 ms margin failed at 3.5 ms,
  and scaling it to 10% of the period (1.7 ms) still failed at 1.4 ms.
  The assertion now rests on a **deterministic sweep** of the buffer:
  asked for a label deliberately *between* two buffered samples, the
  non-interpolated path is off by that distance and the interpolated path
  lands exactly on target — so the measured difference is half a period
  (8.3 ms at 16.7 ms) whatever the render loop is doing. The sweep runs
  again on the buffer the *lagged* runs leave behind, so the lagged pair is
  measured on its own buffer. The run-based figures are still reported and
  the neighbouring assertions still pin the run-based behaviour.
  Falsifiability is unchanged and re-proved by mutation: disabling
  interpolation fails **three** assertions (the clean sweep, the
  ideal-label check and the lagged sweep). Two further fixes in the same
  gate: the buffer-fill wait watched `pushes` while the assertion watched
  the ring's length, and the suite clears the buffer at the start of a run,
  so a wait that ended on the 10th push could meet a ring holding exactly
  10 — and `10 > 10` is false. The wait now watches the same quantity the
  assertion does. And **"every run measured the clock"** required **two**
  A/V samples from *every* run, but a CI runner's bench page renders at
  well under 1 fps, so a 3.5s run yields about **two** samples there — and
  the *cold* first run (render loop not yet settled) yielded **one**,
  failing the gate on a run that measured perfectly well. The suite now
  does a **discarded warm-up run** so every measured run starts from the
  same warm state, and the floor is one sample per run with the depth
  requirement in the median — so one unlucky frame in one run no longer
  fails the gate, while a host that measures nothing (or only once per
  run) still does. Re-proved by mutation: a suite that never records an
  A/V sample fails **seven** assertions.
- `check:live-input` **sampled for the Live control instead of waiting for
  it**, so it reported a missing control whenever the media panel had not
  mounted yet. The panel is built by a deferred module which loads three
  more in order; sampling once as soon as the document is ready measures
  the machine's load, not the feature, and the step duly failed inside a
  full 33-step run while passing on its own. It now polls for the control
  (15 s) — the assertion still requires it, and a mutated selector fails
  it exactly as before.
- **The preset editor's ramps ran on the wrong clock**, so a rule or a
  scene transition started from the rulebook could be stamped in the
  future and never arrive. `frame(now)` now keeps `runtime.renderNow`, and
  `startRamp()` stamps a ramp's `t0` from that clock instead of the
  caller's `now` — `tickRamps(now)` interpolates against the render clock,
  so those two numbers have to be on the same timebase. A host driving
  `R.logic.tick()` with its own clock (the gate does, deliberately) used
  to leave `global.bloom` stuck part-way through a 400 ms ramp forever,
  and the scene ramp in `setScene()` shared the bug, so "the scene eases
  in" was equally unreachable. The rulebook's `ctx.now` is still the
  *evaluation* clock (sustain, cooldown, `elapsed`, `sequencePosition`);
  only the animation moved.
- **`jumpToSection()` did not survive the next frame.** The playhead is
  derived: `tickSequence()` recomputes the bar position from
  `(now - runtime.seq.startedMs)` on every frame, re-derives the section
  from it, and re-anchors the origin to `now` whenever the sequence is not
  running. A jump set only `startedMs` and `section`, so the first frame
  after the click re-anchored the origin and the playhead snapped back to
  bar 0 (loop mode also rewrites the origin, which can erase a jump a
  second way). The jump now marks the sequence running, moves the bar, and
  anchors the origin on `runtime.renderNow` — the same timebase the next
  frame's `now` is in — so the derived position is at least the section's
  first bar and the section scan agrees with the click instead of landing
  on the previous section by a fractional bar.
- `check:preset-editor-smoke` **could pass without testing anything, and
  was failing for the wrong reason.** Its timeline assertion read
  `#tlSections button` straight after assigning `preset.sequence`, but the
  timeline is painted only by `renderTimeline()` — which runs from UI
  handlers, never from the frame loop — so the node list was empty and the
  `if (jump) jump.click()` guard made the assertion vacuous; it also
  asserted `afterJump.section === 0` after clicking the *first* button,
  which is indistinguishable from "the jump did nothing". The test now
  switches the sequence on through `#seqEnabled` (the user's own path),
  asserts the timeline rendered a button per section, clicks the **second**
  section, and asserts the playhead moved to it **and stayed** there and
  that the section brought its scene and the render with it. The rule test
  now drives the rulebook synchronously and owns `preset.logic.rules` only
  for that drive, so the live loop cannot evaluate the same rule against
  the demo signal between two ticks and fire a spurious falling edge that
  replaces the ramp under test; the hold test asserts the rule *was
  refused* (its own log entry) and never fired, rather than that some
  `held` entry exists — the manual edit logs one itself.
- Every audio frame was ingested **twice** by the section detector, so the
  song's structure was computed over a self-similarity matrix with every
  row duplicated — the boundaries it found were weaker and noisier than the
  music deserved. The detector dedupes on the frame's timestamp, but the
  live feature object carried no timestamp, so it fell back to a wall clock,
  and the wall clock differs between the engine's render loop and the
  automix runtime's own tick: two callers, one frame, two "different"
  frames. The producer now stamps `feat.tMs` — the **media** clock, in
  milliseconds — on every frame, so both callers carry the same timestamp
  for the same frame and the second call is a no-op. The media clock (not a
  wall clock) also means a paused song **freezes** the analysis instead of
  feeding the detector the same frozen frame over and over.
- The **canvas vanished on every narrow window reached by resizing**.
  `#timeline-host` carries an inline `grid-column: 2 / 3` (it sits under
  the layers column on the desktop template); in the narrow single-column
  template that inline placement creates an implicit ~389px column,
  which squeezes the `1fr` column holding `#stage` to 0px. Loading *at*
  390px was fine, which is why `check:engine-mobile` never caught it —
  it loaded each viewport fresh instead of resizing. The gate now
  resizes as well.
- `drawLayer` composited **from a 0x0 canvas**. It draws from
  `this.proc`, the offscreen processing canvas, which is 0x0 while the
  stage is `display:none` in Basic mode. `drawImage()` with a 0x0 canvas
  source is illegal, and the throw escaped into the render loop and
  killed the whole frame.
- The **rotation pre-pass built a 0x0 canvas** when the source asset had
  no intrinsic size — an image still decoding, or one that failed to
  load. Same illegal `drawImage`, same killed frame.
- `versions/play.html` carried **two `<link rel="canonical">` tags**,
  which failed the site-chrome gate. It now carries one, pointing at
  `/versions/play`.
- The export hung on browsers without an H.264 encoder (Firefox, and the
  Chromium builds that ship without the proprietary codecs): the WebCodecs
  worker reported the unusable codec **asynchronously**, so the promise
  rejected after the `try` block that handled it had already run. The
  button said "recording" and no frame was ever encoded. The fallback to
  the MediaRecorder path is now attached to the promise, so the export
  falls back instead of hanging.
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
- `check:automix-arc-smoke` measured the wrong song, and then a stale arc.
  The gate loaded its demo song only as a FALLBACK: the default library
  seeds `audios/test-clip.mp3` (60s) on its own schedule, and whichever won
  was a race. The two songs produce different arcs — the 60s default yields
  a 4-act arc whose last two acts are both low-energy, so the act-to-act
  displacement the gate measures lands at ~0.21 and the 0.3 bar failed on a
  design choice rather than on a regression. The gate now waits for the
  default library to settle, loads the demo song unconditionally, and pins
  the arc to that song's duration (the runtime replaces the arc only after
  its async analysis resolves, so a leftover arc already satisfied the act
  count). It also neutralises the service worker, whose `controllerchange`
  reload was destroying the execution context mid-assertion.
- Four smokes bound a fixed port for their static server
  (`check:webgl-default-off` 5396, `check:svg-grade-integration` 5394,
  `check:variants-smoke` 5392, `check:automix-arc-smoke` 5185). An
  unrelated outbound connection that the OS handed the same port to killed
  the gate with EADDRINUSE before it asserted anything. They now bind an
  ephemeral port and read the assigned one back, like `check:store-smoke`
  and `check:dashboard`.
- `verify-autoplay.mjs` failed about half the time with *"Execution context
  was destroyed, most likely because of a navigation"*. The engine page
  reloads itself twice on a cold profile — the service worker claims the
  page and `pwa-bootstrap.js` reloads on `controllerchange`, and
  `lib/app-version-bust.js` hard-reloads when the stored version is stale —
  and either reload destroys the context an assertion is running in. The
  verifier now neutralises both, the same way `verify-rotation-enabled.mjs`
  and `scripts/check-capture-smoke.mjs` do.
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
- The **engine and the neon variant now run one contract** instead of two
  implementations of it. Neon loads the engine's audio core rather than its own
  inline copy, the engine loads the shared binding layer instead of wiring the
  stats, hooks, mood and scene buttons a second time, and four inline copies on
  the engine that were overwritten before anything could read them are gone.
  A new gate, `npm run check:engine-parity`, fails when a page loads a module
  whose dependency the page does not publish — the failure that shows up as a
  feature that quietly does nothing. It found two: the engine's "+ 3D" button
  led to an error because the module it needed was never loaded, and the mood
  overlay never restored its saved position.
- **The sign-in page now says what an account is for.** The headline is
  "Save it here. Open it on any device." and the one-sentence value prop is
  a four-line list: your song stays in your browser, your Drive files stay
  in your Drive, no password, your projects open on any device, one link to
  share. The old line claimed "Your audio never leaves your browser" — an
  absolute the platform could not keep.
- **The Drive browser now states where the files are**: "We read from your
  Drive. Your files stay there." Importing one file still copies that file.
- **The in-engine sign-in banner no longer argues against signing up.** The
  notes keep their persona line and gain a benefit clause — "Free, no signup
  — sign in to keep it." — and the CTA reads "Save this" instead of naming
  the magic-link mechanic. The stale "Twenty-nine looks" in the
  version-hopper note is now "Dozens of looks" (24 variant pages, 22 in the
  engine's dropdown), and the gallery-curator note's "Everything stays on
  your machine" is scoped to "Your clips".
- **`legal/privacy.html` now matches the product.** It says what leaves your
  device: the account and the projects you save to it, the read-only Drive
  connection, and the `.zip` we build when you publish a project to the
  marketplace. "We can't see your library" is now scoped to the two cases
  where we do hold a file.
- The build no longer ships **138 KB of orphaned assets**. Vite built
  `engine.html` as its only Rollup input so that `transformIndexHtml`
  would fire on it, but `copy-static` ships `dist/engine.html` as a plain
  file copy — so Vite's output for that page was overwritten anyway, and
  the extracted `dist/assets/engine-*.js` and `engine-*.css` were
  referenced by nothing. Vite still needs one input, so
  `scripts/vite-noop-entry.js` is an empty module and a plugin removes
  the chunk it emits. Headroom against the 180 MB build budget went from
  20 KB to 158 KB.
- `scripts/generate-vercel-rewrites.mjs` **no longer deletes the `/play`
  rules**. The generator emitted nothing for `/play` (it only emits a
  rule when the target file exists at the path the route implies, and
  `/play.html` does not), so the two hand-written rules were the only
  thing keeping the route alive — and the next run would have 404'd
  `/play` in production. Both variants' rules now live in the generator,
  which is the single source of truth.
- The **parameter bench** moved into the **control centre** at
  `/super-admin`. The bench is unchanged in substance — the same fourteen
  URL parameters, the same URL builder, the same reference table — but it
  now mounts as a card and takes the host's colours, so it reads as part
  of the page instead of a page of its own. The standalone `/lab/params`
  page is gone, and the debugger's header link points at the new home.
- The **control centre** (`super-admin.html`, `/super-admin`) is wired to
  real endpoints instead of simulated cards. Pipeline reads the real
  workflow runs, Git the real branch and commits, Health probes the real
  pages, System reports the instance it is running on and says so. The
  header badge is derived from those probes rather than asserted, and the
  actions that need a token refuse and explain themselves rather than
  pretending. It ships unlisted and `noindex`, like `/make-video` and
  `/atlas`.
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
