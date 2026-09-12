# Industry template — fitness / workout coaching

**Cycle**: 2026-09-08T13-54
**Type**: industry-template
**Priority**: P2
**Estimated effort**: L

## TL;DR

Add a `fitness.html` industry-template landing page in the same shape as `weddings.html` (217 LOC, playlist-driven CTA into `make-video.html`). Drop in five BPM-curated playlists — Warm-up (90-110), Cardio / HIIT (140-160), Strength (110-130), Cooldown / Yoga (60-80), Sprint intervals (160-180) — and surface them as "Workout segments" cards. The Music Video Maker already accepts a pre-loaded playlist via `lib/playlist.client.js` (see weddings.css + weddings.html:51 for the exact integration), so this is a content + marketing page plus a `personas/preset-packs/fitness.json` preset bundle that pre-configures the engine for high-tempo, BPM-locked visuals. The engine variant pitch: `pulse` (heartbeat name), `spectrum` (audio-reactive EQ bars map naturally onto tempo/beat visibility), `neon` (high-energy aesthetic), `baroque` (ornate for yoga/cooldown), `glitch` (HIIT intensity bursts). The vertical is a strong market match: short-form workout content dominates TikTok/IG Reels, audio-reactive output is a real differentiator vs. static stock-video fitness apps, and the existing weddings page proves the template pattern ships fast.

## Why this cycle

- **Industry novelty**: `.improvements/` has zero `industry-template` plans (verified via `ls .improvements/ | grep -E "industry|template|use-case"` → empty). Only `multi-prosumer-control` (2026-09-01) and the speed/quality backlog have been drafted. New industry vertical = 5/5 novelty.
- **Pattern is proven**: `weddings.html` (217 LOC) + `weddings.css` already ship the exact pattern this plan reuses: hero → curated cards → "Open the Music Video Maker" CTA → `lib/playlist.client.js` for pre-loading the engine. `weddings.html:51` shows the integration (`SWR_PLAYLIST.preload(list)` before navigating). No new infra needed.
- **Speed/quality saturation**: 29 prior cycles of speed work have covered every hot-path subsystem (`versions-presets.js`, `fx-postprocess.js`, `engine-render.client.js`, `engine-lfos.client.js`, `lib/recorder.client.js`, every variant HTML). The currently in-flight `STATE.json:in_flight_proposals` lists 7 speed plans that the user hasn't actioned during the music-video sprint — adding another speed plan adds to a backlog the user is consciously de-prioritizing in favor of the music-video work. Industry template is content + copy, low integration cost, easy to defer.
- **No dirty-tree conflict**: the working tree is dirty on `package.json` (scripts block), `docs/music-video.md` (new doc), `.worktrees/feat-auto-*`, and `.improvements/2026-09-08T05-40*` / `07-45*` / `09-47*` (the un-shipped speed plans). None of these touch a new industry landing page or `weddings.html`'s pattern.
- **Strong market signal**: `landing.html:1095` already uses "live · 80 bpm" as engine-mini copy (`landing.html:1134` defines `bpm = 80, beat = 60 / bpm`). The landing page narrative already gestures at BPM-driven output; fitness is the obvious vertical that monetizes that capability.
- **Asset reusability**: `library/manifest.json` + `scripts/fetch-library.mjs` populate 27 curated assets at prebuild. A fitness template doesn't need new assets — it needs a curated subset (high-motion, high-contrast, abstract — not faces/people, which weddings uses). Pick from existing `library/` items, no new blob work.

## Goal

A new `/fitness` route (served as `fitness.html` from repo root, wired through `vercel.json` like the weddings rewrite) that (a) markets five BPM-curated workout-segment playlists, (b) pre-loads the selected playlist into the Music Video Maker via the existing `lib/playlist.client.js` `SWR_PLAYLIST.preload()` API, and (c) ships a `presets/fitness-default.json` preset bundle that the engine picks up on page load (auto-detected by the existing `applyPreset()` chain). Acceptance: open `/fitness`, click a playlist, the MVM opens with that playlist queued, the engine is in a high-tempo visualizer (`pulse` or `spectrum`), BPM readout in the UI matches the playlist's target range.

## Plan

### Step 1 — copy the weddings.html skeleton as fitness.html

- **Files**: new `fitness.html` at repo root, new `fitness.css` next to it (mirror `weddings.css` structure)
- **Action**: duplicate `weddings.html` (217 LOC, `weddings.html:1-217`) and rename class prefix `wed-` → `fit-`. Replace hero copy with fitness narrative ("Workout segments that drive the visualizer — pick a BPM range, the engine matches the intensity"). Replace playlist data with five fitness-segment entries (see Step 2). Update `<title>`, `<meta description>`, header brand link. Update the `lib/playlist.client.js` script tag — same as weddings, no version bump.
- **Verify**: `diff <(grep -nE 'wed-|fitness' weddings.html) <(grep -nE 'fit-|fitness' fitness.html)` shows the only diffs are the prefix swap + playlist data + copy. Page renders in `npm run dev` at `http://localhost:5174/fitness`.

### Step 2 — author the five BPM-curated playlists

- **Files**: `fitness.html` (inline JSON in the script block, same shape as `weddings.html:51-120`)
- **Action**: define five playlists with `{id, name, bpmRange, durationLabel, description, tracks: [...]}` shape:
  1. **Warm-up** (90-110 BPM, 5-7 min) — gentle entry, low visual intensity
  2. **Cardio / HIIT** (140-160 BPM, 20-30 min) — peak intensity, glitch/pulse visualizers
  3. **Strength** (110-130 BPM, 45-60 min) — sustained tempo, neon/spectrum
  4. **Cooldown / Yoga** (60-80 BPM, 10-15 min) — slow, baroque/typography visualizers
  5. **Sprint intervals** (160-180 BPM, 10 min) — alternating high/low, glitch on peaks
  Each playlist entry gets an emoji-free segment icon (SVG or unicode symbol, NO emoji on factual lines per the user profile), a target BPM range badge, and a 1-line description.
- **Verify**: `node -e "const fs=require('fs');const h=fs.readFileSync('fitness.html','utf8');const m=h.match(/const PLAYLISTS = (\[[\s\S]*?\]);/);console.log(JSON.stringify(JSON.parse(m[1]), null, 2));"` parses cleanly and shows 5 entries.

### Step 3 — wire the Vercel rewrite

- **Files**: `vercel.json`
- **Action**: add `{ "source": "/fitness", "destination": "/fitness.html" }` to the `rewrites` array. Match the existing weddings entry verbatim (search `vercel.json` for "weddings" and copy the line, swap the path).
- **Verify**: `grep -nE "weddings|fitness" vercel.json` shows both routes.

### Step 4 — author the fitness preset bundle

- **Files**: new `presets/fitness-default.json`
- **Action**: copy the shape of an existing preset from `presets/` (any of the auto-generated ones in `presets/*.json` — use `head -1 presets/$(ls presets | head -1)` to confirm the JSON shape). Set: `mutAlgo: 4` (glitch-ish), `temp: 0.7`, `beatSensitivity: high`, `bpmRange: "auto"`, `variant: "pulse"`, `palette: "neon"`. The bundle should be detected by the existing `applyPreset()` machinery in `lib/presets.client.js` (verify by searching for where presets are auto-applied — likely a `localStorage` key or a `?preset=fitness` URL param).
- **Verify**: `node -e "JSON.parse(require('fs').readFileSync('presets/fitness-default.json'))"` parses without error. `grep -rn "fitness" lib/presets.client.js` returns 0 (no manual wiring needed — preset auto-discovery handles it).

### Step 5 — add a link from landing.html

- **Files**: `landing.html`
- **Action**: in the industries/verticals section (search for `weddings.html` href in landing.html to find the canonical spot), add `<a href="./fitness.html">Fitness / Workout segments →</a>` immediately after the weddings link. Match the existing anchor's CSS class (`persona__cta` or equivalent).
- **Verify**: `grep -nE "weddings|fitness" landing.html` shows both links in the same block.

### Step 6 — Playwright smoke test

- **Files**: new `verify-fitness.mjs` at repo root (standalone, follows the pattern of the other `verify-*.mjs` files)
- **Action**: navigate to `/fitness`, click the first playlist card, confirm `make-video.html` loads with `localStorage.swr.playlist` populated (the same key weddings writes to per `weddings.html:51`). Assert no console errors. 30 lines, Puppeteer auto-login.
- **Verify**: `npm run verify:fitness` passes; `verify-screenshots/fitness-landing.png` and `verify-screenshots/fitness-after-cta.png` are produced.

### Step 7 — optional: image asset

- **Files**: `promo/fitness-hero.png` (or `keyart/fitness-hero.png`)
- **Action**: commission an image asset for the hero card. 1200×630 OG size + a 1080×1920 IG Story crop. Per the `image-asset` plan type in this skill's table, this would be a separate cycle if accepted — flag it in the plan's "Out of scope" section but note it here as the natural follow-on if the page lands well.

## Verification

- `npm run check` passes (syntax + manifest + bundle + API tests; no manifest changes because no new library assets added)
- `npm run build` passes (prebuild re-fetches library; this plan adds no new media)
- `npm run dev` serves `fitness.html` at `http://localhost:5174/fitness`
- `npm run verify:fitness` passes (the new smoke test)
- Manual: open `/fitness`, click each of the five playlists, confirm MVM opens with the right preset and playlist queued. Capture screenshots for `verify-screenshots/`.
- `curl -s https://sainted-word-records.vercel.app/fitness` after Vercel deploy returns the rendered HTML (or the 200 from the rewrite)

## Risks / gotchas

- **Preset auto-discovery may not exist.** If `lib/presets.client.js` doesn't have an auto-discovery path for `presets/fitness-default.json`, the preset bundle in Step 4 becomes manual wire-up (add a `case 'fitness'` in the preset loader). Mitigation: do the discovery audit first (`grep -rn "presets/" lib/presets.client.js presets.client.js`); if absent, fall back to a `?preset=fitness-default` URL param the existing system already supports (search for `searchParams.get('preset')` in the engine).
- **Library has no workout-themed assets.** The curated library is 27 assets — weddings and music videos were chosen for their universal appeal; no boxing gloves, yoga mats, or treadmills. Mitigation: the fitness page should NOT show face/people thumbnails — keep it abstract (existing neon/glitch/spectrum variants generate visuals from the music). The page copy should emphasize "the engine drives the visual, the music drives the engine" rather than "pick from workout clips."
- **The music-video sprint is the user's current focus.** This is a P2 plan; do not pre-empt music-video work. The plan is intended as a ready backlog for when the music-video PRs land.
- **Music licensing.** Real workout playlists need real tracks. The `weddings.html` ships with placeholder data and a footer note ("playable audio ships in v2"). Match that pattern — the fitness page is a marketing surface with placeholder playlists, not a shipped audio product. Don't promise the user can play copyrighted tracks; mirror weddings' "v2" disclaimer.
- **No `vercel.json` rewrite conflicts.** If `/fitness` already routes somewhere (it doesn't, verified via `grep -n "fitness" vercel.json` → 0 matches), the new rewrite won't conflict. `grep -nE "fitness|weddings" vercel.json` post-edit should show exactly two matches.

## Out of scope

- Generating real workout playlists with licensed audio (deferred to a future product decision; this plan ships the template + placeholder data).
- Adding new library assets (boxing/yoga/treadmill clips). The fitness template uses the existing 27 curated assets — visuals are engine-generated from music.
- Multi-user collaboration on workout playlists (that's the multi-prosumer direction, already covered by `.improvements/2026-09-01T15-54-quality-multi-prosumer-control.md`).
- Speed work in `versions-presets.js` / `engine-render.client.js` / `lib/recorder.client.js` (7 in-flight speed plans already cover the hot path; new speed plans compete with the user's current music-video sprint).
- Image asset for the hero card (deferred to a future `image-asset` cycle if the page lands well).
- Adding `fitness.html` to the i18n / persona matrix in `personas.html` (out of scope for v1; can be added later).
- Verifying the fitness page on mobile breakpoints (the existing `verify:autoplay` and `verify:engine-demos-mobile` cover mobile render paths; re-use, don't duplicate).