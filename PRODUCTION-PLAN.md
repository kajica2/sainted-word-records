# Sainted Word Records SPA — Production-Readiness Plan

> Scope: `swr-app.html` (the new SPA at https://sainted-word-records.vercel.app/app)
> Author: Hermes Agent
> Date: 2026-09-03
> Current state: 5,823 lines, 10 commits since SPA start, 27 features shipped, ALL GREEN CI

This plan sequences the work from **today's demo** to **a production-grade VJ tool** that musicians, DJs, and content creators will pay for. It is organized into 4 phases with explicit acceptance criteria per phase. Each phase ends with a **verifiable demo milestone** before the next phase begins.

---

## Current state (baseline)

The SPA is at `https://sainted-word-records.vercel.app/app`. 27 features are live and browser-verified:

- 5-tab sidebar (Presets / Layers / Media / Brand / Social)
- 7 built-in presets + 16 imported from `/presets/manifest.json` (auto-synced)
- 10 reactive sliders, all live-updating
- Floating engine window (draggable, 8 resize handles, fullscreen, dock, minimize, ESC)
- App shell (viewport-locked, Engine/Browse view toggle)
- Media Manager (75-asset curated library + 5 videos, drag-drop/paste upload, audio track library, persona-set filter pills)
- Brand kit + stage watermark + hashtag overlay
- Social share link (base64-encoded snapshot in URL hash)
- Caption generator + 4 publish-platform tiles (IG/TT/YT/X)
- Story timeline (5 fragments) + Shift+1..5 hotkeys + auto-cycle-on-beat
- Per-layer reactor (4 layers, feature→target mapping)
- Export panel (9:16/1:1/16:9, 10/15/30/60s, MP4/WebM, 24/30/60fps, 3/6/12 Mbps)
- First-run onboarding modal (mp3/mp4/mpg/png/gif/jpg + batch + drag-drop)
- localStorage persistence + deep-link share via `#s=` hash

**Known gaps** (the production-readiness work):

| # | Gap | Severity | Phase |
|---|-----|----------|-------|
| 1 | Real MediaRecorder MP4/WebM encoding (timer stub today) | **Critical** | P1 |
| 2 | Beat detector (real, not bass>0.7 proxy) | High | P1 |
| 3 | Per-layer asset assignment + composite (uploads don't reach canvas) | **Critical** | P1 |
| 4 | Auto-arrange uploaded media into a working visual | **Critical** | P1 |
| 5 | Project save/load (JSON + audio blob) | High | P1 |
| 6 | Real BPM detection (autocorrelation) | High | P2 |
| 7 | Multiple reactors per layer (currently 1) | Medium | P2 |
| 8 | Generative mutate/evolve/randomize (RE-MAP from hallucination) | Medium | P2 |
| 9 | Key detection (Krumhansl-Schmuckler) | Low | P2 |
| 10 | WebGL post-FX (bloom/glow) | Low | P3 |
| 11 | Persona assets panel (40 curated images) | Low | P3 |
| 12 | PWA / mobile fullscreen | Medium | P3 |
| 13 | Magic-link auth | High | P4 |
| 14 | Pricing/Stripe | High | P4 |
| 15 | OG share images per preset | Low | P4 |

---

## Phase 1 — "It actually records" (target: 1–2 weeks)

**Goal**: A musician can drop in an MP3, see the visual react in real time, and download a real MP4 file they can post to socials.

### 1.1 Real MediaRecorder MP4/WebM export (gap #1)

Replace the timer-based recording stub with actual canvas capture via `MediaRecorder`. The engine workspace already exposes the stage canvas; we just need to wire the existing pickers (codec/fps/bitrate) to a real `canvas.captureStream()` + `MediaRecorder` pipeline.

Acceptance:
- [ ] `Record Video` button starts a real `MediaRecorder` on the stage canvas
- [ ] WebM/VP9 with VP9 codec works in Chromium-based browsers (default for unsupported MP4 export)
- [ ] MP4/H.264 export via `MediaRecorder` `video/mp4` mime (where supported; falls back to WebM otherwise)
- [ ] Output bitrate honors the `3 / 6 / 12 Mbps` picker
- [ ] Output fps honors the `24 / 30 / 60 fps` picker (via frame-rate cap on `canvas.captureStream(fps)`)
- [ ] Output resolution matches the picked aspect ratio (9:16, 1:1, 16:9) at the canvas's native size
- [ ] Downloaded file plays back in QuickTime, VLC, and Chrome
- [ ] If MediaRecorder unsupported, show a clear toast: "Your browser doesn't support recording. Try Chrome."

Files: `swr-app.html` only.

Estimate: **3–4 days**.

### 1.2 Per-layer asset assignment + composite (gap #3, #4) — the real "mashup" feature

Today uploaded media lives in the library but **never reaches the stage canvas** — the visuals are 100% procedural shapes (rings, rays, grid). This is the single biggest gap. When the user uploads 3 images, they expect a 3-layer composite. The legacy engine has 6 layers with per-layer blend/opacity/scale/rot.

Acceptance:
- [ ] `state.layerAssignment[layerId] = [assetId, assetId, ...]` — one layer can have multiple assets
- [ ] `drawVisual()` rewritten to render each layer's assigned assets in order, applying the layer's `blend` and `opacity` via `ctx.globalCompositeOperation` and `ctx.globalAlpha`
- [ ] Per-layer `blend` dropdown actually affects the visual output (was stored but never read)
- [ ] Per-layer `opacity` slider works (currently the slider is the layer's only persisted value; ties into the rendered layer alpha)
- [ ] Auto-assign on upload: round-robin assets into `background → overlay → typography → effects` (so 4 uploads fill all 4 layers, 5+ start cycling)
- [ ] Assets play correctly in the stage: videos show first frame + play in place (using the existing `resolveVideoThumbnail` pattern, but inside the stage render loop instead of the library grid)
- [ ] When a layer has no assets, fall back to the existing procedural shapes (no visual regression)
- [ ] Beat-driven crossfade: rotate through the assets in a layer on every N beats (using the new beat detector)
- [ ] Composer tab: drag assets from the library onto layer rows to assign manually
- [ ] When clicking an asset in the library tab, it gets added to the currently-active layer (not just toggles layer visibility)

Files: `swr-app.html` only.

Estimate: **1 week** (this is the single biggest piece of work — the most important feature for "production ready").

### 1.3 Real beat detector (gap #2)

Replace the `bands.bass > 0.7` proxy with a proper onset/beat detector. The legacy engine's `audio-analysis-v2.js` does this with an adaptive threshold.

Acceptance:
- [ ] Beat detector runs on the same `AnalyserNode` we already use
- [ ] Detects onsets via energy flux (spectral difference between consecutive frames)
- [ ] Adaptive threshold (60% of running mean) to handle different song dynamics
- [ ] Emits `state.beat = { detected: true, bpm: 120, confidence: 0.8 }` on each beat
- [ ] Story timeline's auto-cycle uses real beats, not bass spikes
- [ ] Per-layer reactor's `beat` feature uses the real beat-detected pulse, not the smoothed bass
- [ ] The reactor's `scale` slider reflects the actual beat energy

Files: `swr-app.html` only.

Estimate: **2 days**.

### 1.4 Project save/load (gap #5)

Save the current engine state (presets, sliders, layer assignments, audio source as a Blob reference, brand, caption) as a `.swr` JSON file. Load it back later to reproduce a performance.

Acceptance:
- [ ] "Save Project" button in the engine toolbar
- [ ] Saves: preset, sliders, layer assignments, brand, caption seed, current fragment, reactor configs
- [ ] Audio bytes: re-encoded as base64 inside the JSON (with a warning toast if file > 5MB)
- [ ] "Load Project" button: file picker, restores everything
- [ ] Restored project shows "Loaded from <filename.json>" toast
- [ ] After load, the engine is fully reproducible: same preset + same layers + same audio + same brand
- [ ] Share via URL still works (existing share-link is the URL-share flavor; project file is the file-share flavor)

Files: `swr-app.html` only.

Estimate: **2 days**.

### Phase 1 milestone (Demo): "Real VJ tool"

End-of-P1 acceptance:
- A user can drop in an MP3, click Record, get back a real MP4 file with the visual baked in
- The visual shows their uploaded media (not just procedural shapes)
- Auto-arrange fills 4 layers from their uploads
- The recording starts on beat, not on bass spike
- They can save the whole project as a JSON file and reload it later

---

## Phase 2 — "It can be performed" (target: +2 weeks)

**Goal**: A DJ can load a track, switch presets on the beat, mutate the visual, and feel they're in control of an instrument.

### 2.1 Real BPM detection (gap #6)

Autocorrelation on the energy envelope to estimate BPM. The legacy engine's `audio-analysis-v2.js` has this.

Acceptance:
- [ ] BPM detection runs continuously on the loaded audio
- [ ] Output: `state.audio.bpm` (estimated, with confidence)
- [ ] Display in the stage pill: "Live · PLAYING · 124 BPM"
- [ ] Beat-quantized preset switching: if a preset is queued and the next beat lands within 200ms, hold until the beat
- [ ] Beat-quantized fragment switching: same pattern for story fragments
- [ ] Manual tap-tempo: hold the BPM pill to set by tapping (4 taps minimum)
- [ ] Show estimated BPM in the Brand tab "Track info" row (also display key when detected)

Files: `swr-app.html` only.

Estimate: **2 days**.

### 2.2 Multiple reactors per layer (gap #7)

Right now each layer has 1 reactor. The legacy engine has 3 per layer (and 9 LFO modules). Expand to 3 reactors per layer, each with its own feature/target/scale.

Acceptance:
- [ ] `state.reactors[layerId] = [{feature, target, scale, enabled}, ...]` (array, max 3)
- [ ] UI: 3 reactor rows per layer in the workspace
- [ ] "+ Add reactor" button adds another row (up to 3)
- [ ] Each reactor applies in sequence (compositing)
- [ ] All three reactors are persisted in localStorage

Files: `swr-app.html` only.

Estimate: **1 day**.

### 2.3 Generative mutate/evolve/randomize (gap #8) — the RE-MAP system

The hallucination variant has RE-MAP, mutate, evolve, randomize. These procedurally alter sliders/reactor configs to find new variations. Critical for live performance — the DJ can "evolve" the current look.

Acceptance:
- [ ] "Randomize" button: applies random offsets to all 10 sliders within a user-set "amount" (10%–100%)
- [ ] "Mutate" button: applies a small drift to the current config
- [ ] "Evolve" button: takes 3-5 random variations and picks the one with the highest audio-reactivity score (peaks on bass/mid/treble)
- [ ] "Commit" button: saves the current state as a new named preset
- [ ] "Undo / Redo" buttons: keep the last 10 states, navigate with prev/next
- [ ] All four buttons live in a new "Generative" row in the engine workspace
- [ ] Randomize respects "preserve assets / mappings / blend" checkboxes (per the legacy spec)

Files: `swr-app.html` only.

Estimate: **3 days**.

### 2.4 Key detection (gap #9)

Krumhansl-Schmuckler algorithm on the chromagram to estimate musical key.

Acceptance:
- [ ] Display detected key in the stage pill: "Live · 124 BPM · A min"
- [ ] Key shown in the Brand tab Track info
- [ ] Key quantization for preset matching: if user has a preset named "A minor" and the song is in A minor, surface it as a suggestion

Files: `swr-app.html` only.

Estimate: **2 days**.

### Phase 2 milestone (Demo): "Performable"

End-of-P2 acceptance:
- The DJ can load any track, see BPM and key
- They can tap-tempo, switch presets on the beat, queue up multiple reactors
- "Randomize" / "Mutate" / "Evolve" all work and produce audible visual differences
- The 5-fragment story auto-cycles perfectly on beat
- They can do a 30-minute live set without re-touching the mouse

---

## Phase 3 — "It works on every device" (target: +2 weeks)

**Goal**: A musician in a phone browser can use the app offline, a tablet user can drop in a song and get a working visual, and the GPU-accelerated render path runs on every modern browser.

### 3.1 WebGL post-FX (gap #10)

Replace the CPU-bound `drawVisual` with a WebGL pipeline. The legacy engine has a 14-FX uniform dictionary (temp/mut/chroma/grain/vignette/posterize/etc). The post-FX pass applies them in a single fragment shader.

Acceptance:
- [ ] WebGL renderer available via feature detection
- [ ] CPU canvas renderer as fallback (no WebGL, e.g. old Safari)
- [ ] Post-FX: bloom, vignette, grain, sepia, glow, blur, grayscale, posterize, chromatic aberration, scanlines
- [ ] Each FX exposed as a slider in the Reactive Controls panel
- [ ] FX uniforms passed as a uniform dictionary (matching legacy)
- [ ] Per-layer reactors still work in the WebGL path

Files: `swr-app.html` (split into a separate `swr-app-webgl.js` if it gets >50KB).

Estimate: **1.5 weeks** (this is the second-biggest piece of work after #1.2).

### 3.2 Persona assets panel (gap #11)

Surface the 40 persona images from the existing `/library/persona/` directory as a quick-pick grid.

Acceptance:
- [ ] New "Personas" sub-tab under Media
- [ ] 40 persona images in a grid, tagged with their set (Raw/Poster/Mask/FX/Filter/Neon/Film/Grid/Smoke/Hallucination)
- [ ] Click a persona to add to the current layer (same flow as media auto-arrange)
- [ ] Auto-tag with persona set for filtering

Files: `swr-app.html` only.

Estimate: **1 day**.

### 3.3 PWA / mobile fullscreen (gap #12)

The legacy engine has a `manifest.webmanifest`, `sw.js` (service worker v2), and PWA bootstrap. The SPA should get the same treatment.

Acceptance:
- [ ] `manifest.webmanifest` with icons, name, theme color, start_url
- [ ] Service worker caches the SPA shell, library/manifest.json, presets/manifest.json
- [ ] Offline mode: SPA shell + last-loaded library + last preset work without network
- [ ] "Add to Home Screen" prompt on iOS / Android
- [ ] Fullscreen mode when launched from home screen
- [ ] Background sync: when the user adds an asset online, it shows up offline

Files: new `swr-manifest.json`, new `swr-sw.js`, plus updates to `swr-app.html`.

Estimate: **3 days**.

### Phase 3 milestone (Demo): "Everywhere"

End-of-P3 acceptance:
- A user on iOS Safari can install the SPA to their home screen and use it offline
- A user on a desktop with WebGL gets 60fps even on a 4K canvas
- The 40 persona images are one click away from any layer
- All 14 post-FX work in real time at 30fps

---

## Phase 4 — "It makes money" (target: +3 weeks)

**Goal**: Users can sign up, save projects to the cloud, share them via short URLs, and pay for premium features (cloud library, 4K export, multi-reactor per layer).

### 4.1 Magic-link auth (gap #13)

Wire the existing `/api/auth/magic` endpoint to the SPA. Add a "Sign in" button in the header that sends a magic link to the user's email.

Acceptance:
- [ ] "Sign in" button in the nav
- [ ] Email input → POST to `/api/auth/magic`
- [ ] Magic link sent to email (uses existing endpoint)
- [ ] Clicking the link sets a `swrc_session` cookie + auth state in the SPA
- [ ] Auth state shows user's email in the nav
- [ ] Sign out clears state

Files: `swr-app.html` (UI), `api/` (existing endpoints).

Estimate: **2 days**.

### 4.2 Cloud project save (extends #1.4)

Save projects to the cloud (vs. local JSON). Wire to existing `/api/projects` endpoint.

Acceptance:
- [ ] "Save to cloud" button (vs. the local "Save Project")
- [ ] Project metadata (name, thumbnail, settings) goes to `/api/projects` (POST)
- [ ] Audio blob goes to `/api/storage/sign-upload` + PUT
- [ ] Project list page shows saved projects with thumbnails
- [ ] "Open" loads from `/api/projects/:id` and `/api/storage/sign-download`
- [ ] Soft-delete with `softDeleteProject` (existing endpoint)

Files: `swr-app.html` + `api/projects.js` (existing).

Estimate: **3 days**.

### 4.3 Pricing / Stripe (gap #14)

Add the three pricing tiers from the existing landing page as actual billing. Use Stripe Checkout.

Acceptance:
- [ ] "Upgrade" button in the nav (visible when signed in)
- [ ] Pricing modal: Free / Creator / Studio
- [ ] Stripe Checkout for Creator and Studio
- [ ] Tier checks: `free` = 720p, 20s, watermark; `creator` = 1080p, 60s, no watermark; `studio` = 4K, unlimited, custom presets
- [ ] Tier badge in the nav after upgrade
- [ ] Webhook from Stripe updates `user.tier` in the API

Files: new `api/stripe.js`, `api/webhook.js`, plus `swr-app.html` UI.

Estimate: **1 week**.

### 4.4 OG share images per preset (gap #15)

When a user shares a preset link, the OG image shows a preview of that preset's visual.

Acceptance:
- [ ] When sharing a preset, generate an OG image dynamically (server-rendered PNG of the preset's first frame)
- [ ] Or: ship a curated OG image per preset (20+ presets × 1200×630 PNG = ~1.5MB)
- [ ] Twitter, Slack, iMessage show the preview

Files: `api/og.js` (dynamic), or `og-presets/` (curated), plus `swr-app.html` meta tags.

Estimate: **3 days**.

### Phase 4 milestone (Demo): "Ship it"

End-of-P4 acceptance:
- A user can sign up, save a project to the cloud, share a link, view the OG image on socials, and the recipient can open the project in their own browser
- They can pay for Creator tier, get 1080p / 60s / no watermark, and record a real music video in under 5 minutes
- The "studio" tier exists for power users

---

## Cross-cutting (all phases)

These run in parallel with the phase work and never block a release.

- **Accessibility**: every interactive element has a focus-visible outline (already in place), every panel has a heading, every button has an `aria-label`. The Record button has `aria-live` on the timer.
- **Performance**: render loop pinned to 60fps via `requestAnimationFrame`; resize handlers debounced; canvases re-sized only on `view` change or window resize; large library items lazy-loaded.
- **i18n**: every user-facing string is in a `STRINGS` table, with a current `en` locale. New locales can drop in `STRINGS['es']` etc.
- **Error reporting**: `window.onerror` and `unhandledrejection` handlers POST to a `/api/errors` endpoint with the SPA state snapshot. Helps debug user-reported issues.
- **Telemetry** (optional, gated on consent): track preset usage, fragment usage, average session length. Helps prioritize which features to invest in.
- **Documentation**: every feature has a `<details>` block at the bottom of its section, explaining what it does and how to use it.

---

## Risk register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| MediaRecorder MP4 support varies wildly across browsers | High | High | Detect support, fall back to WebM, show clear toast |
| Per-layer composite breaks when user has 50+ assets | Medium | Medium | Asset culling + virtualization (skip off-screen assets) |
| WebGL pipeline takes longer than 1.5 weeks | High | Low | Ship CPU renderer as the default, WebGL as a progressive enhancement behind a feature flag |
| Stripe integration requires production keys we don't have | High | Medium | Stub the webhook locally; ship the UI in dev mode with a fake "upgrade" button |
| localStorage quota hit on users with many large assets | Medium | Medium | Compress base64 assets before storing; warn at 4MB |

---

## Dependency graph

```
P1.1 MediaRecorder ─┐
                    ├─→ P1 milestone ─→ P2 milestone ─→ P3 milestone ─→ P4 milestone ─→ SHIP
P1.3 Beat detector ─┘            │
                                ↓
P2.1 BPM ──→ P2.2 Multi-reactor ──→ P2.3 Generative ──→ P2.4 Key
                                                              │
                                                              ↓
P3.1 WebGL ←─── P3.2 Personas ──→ P3.3 PWA
   │
   ↓
P4.1 Auth ←── P4.2 Cloud projects ←── P4.3 Stripe ←── P4.4 OG images
```

Critical path: **P1.1 → P1.2 (asset composite) → P2.3 (generative) → P3.1 (WebGL) → P4.3 (Stripe)**.

That's roughly **6–8 weeks** of focused work, single developer, to go from "demo" to "ship-it SaaS".

---

## Definition of done — per phase

| Phase | Done when |
|-------|-----------|
| P1 | A user can record a 30s real MP4 of a 4-asset composite, save the project, reload it tomorrow, and get the exact same visual back |
| P2 | A DJ can perform a 30-minute live set with randomize/mutate/evolve on every transition, beat-quantized preset switching, and BPM/key readout |
| P3 | An iOS user can install the SPA to home screen, use it offline, and a desktop WebGL user gets 60fps on a 4K canvas |
| P4 | A signed-in user can save a project to the cloud, share a link, the recipient sees an OG image, the original user can pay for Creator tier and get 1080p / 60s / no watermark |

---

## What I'm NOT doing (out of scope)

- **AI-generated presets** ("make me a visual for this song"): cool but a research project, not product work
- **Multi-user live performance** (two VJs collaborating on one visual): interesting, but adds a CRDT layer; not P1-P4
- **VST plugin hosting**: would require native Web Audio nodes; way out of scope
- **Mobile native apps** (iOS/Android wrappers): the PWA is good enough for v1
- **CDN for the library**: same-host is fine for now; only matters at scale

---

## Open questions for you

1. **P1.1 MP4 export**: do you want me to support both MP4 (where the browser supports it) and WebM (always), or MP4-only with a clear "browser not supported" toast on Firefox/Safari?

2. **P1.2 auto-arrange**: should the first upload go to `background` always, or should the user be able to pick the target layer per upload (a "Send to layer" dropdown on the upload button)?

3. **P2.3 generative scope**: do you want the full RE-MAP system (mutate / evolve / randomize / commit / undo-redo) or just the randomize button to start?

4. **P3.1 WebGL**: is GPU acceleration a hard requirement for production, or can the CPU canvas renderer be good enough for v1?

5. **P4 priority**: is Stripe / paid tiers a P4 (after ship) or P1 (before ship) requirement? The legacy engine has the landing page already, so maybe wire it up before the SPA launches.

6. **Audio source bytes in localStorage**: currently session-only (re-import on reload). For P1.4 project save, the bytes need to be in the JSON. What's the size budget? 5MB? 20MB? Pick a number.

7. **First-frame preview for persona assets**: the legacy engine has 40 personas. Should they be a "quick-pick" in the SPA, or skipped to keep the engine tab lean?

8. **Real-time collaboration**: any interest in a Figma-style multi-user model, or strictly single-user for v1?

Answer these and I'll start P1.1 today.
