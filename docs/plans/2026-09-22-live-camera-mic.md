# Plan — Live Camera & Mic MediaInput foundation

## Goal

Ship a **reusable, browser-native camera + mic primitive** as 3 client modules
plus a demo page. Unblocks the Spit Live and TikTok Studio PRDs (PRs 2 + 3 of
the 4-PR sequence). Foundation only — no engine integration in this PR.

## Scope

| In | Out (deferred) |
|---|---|
| `SWRMediaInput` class (camera, mic, analysis, recording, device mgmt, permissions, cleanup) | Spit Live page (`/spit`) |
| `SWRCameraPreview` reusable UI component | TikTok Studio page (`/tiktok`) |
| `SWRMicMeter` reusable UI component | Live Control Room wiring |
| Demo page at `/lab/media-input` | Engine coupling (audio-reactive visuals) |
| Unit + smoke tests | Migration of pre-recorded video flows |
| CHANGELOG + AGENTS.md updates | Real OAuth/identity for the demo |

## Architecture

### Module 1 — `client/swr-media-input.client.js`

IIFE pattern (matches `client/automix-runtime.client.js`, `client/capture-runtime.client.js`).
Exposes `window.SWR_MEDIA_INPUT.create(options)` factory returning a
`SWRMediaInput` instance.

**Public API:**
- `create(options)` — factory; options mirror PRD §2 (`videoResolution`, `videoFrameRate`, `echoCancellation`, `noiseSuppression`, `autoGainControl`)
- Instance: `startCamera(deviceId?)`, `stopCamera()`, `switchCamera()`, `startMic(deviceId?)`, `stopMic()`, `getAudioData()`, `startMonitor()`, `startRecording(canvas?)`, `stopRecording()`, `getDevices(kind?)`, `requestPermissions()`, `destroy()`

**Fix vs PRD:** the PRD has a bug at line 296 (`MediaRecorder.isTypeMime` doesn't exist). Use `MediaRecorder.isTypeSupported()` instead.

**Persistence:** localStorage `swr.media.lastDevices` — JSON `{ videoDeviceId, audioDeviceId, videoFacingMode }`. Restored on `create()`.

**Permissions:** `requestPermissions()` triggers the prompt for both video + audio in a single getUserMedia call. Returns `{ camera, mic, error? }`.

**No recording until camera/mic enabled:** `startRecording()` without active streams returns `{ success: false, error: 'no_streams' }`. Mix canvas `captureStream` if passed.

### Module 2 — `client/swr-camera-preview.client.js`

IIFE pattern. Exposes `window.SWR_CAMERA_PREVIEW.mount(target, options)`.

- Wraps a `<video>` element + overlay controls (switch, mute, LIVE indicator, face guide)
- Auto-creates a `SWRMediaInput` if not passed in options
- Size variants: `.small` (160×120), `.medium` (320×240), `.large` (480×360), `.full` (100%)
- Self-cleans on `unmount(target)`

### Module 3 — `client/swr-mic-meter.client.js`

IIFE pattern. Exposes `window.SWR_MIC_METER.mount(target, options)`.

- Waveform canvas + level bars + clip indicator
- Drives from a passed-in `AnalyserNode` or auto-creates one from a passed stream
- Self-starts/stops on mount/unmount
- `rAF`-driven redraw loop with `cancelAnimationFrame` on stop

### Module 4 — Demo page `lab/media-input.html`

Standalone HTML that:
- Loads the 3 modules
- Mounts the camera preview (medium size) + mic meter side by side
- Has start/stop buttons per media type + a "Record 5s test" button
- Shows the persistence in action (reload preserves device selection)
- Lives at `/lab/media-input` (Vercel rewrite)

### Test surface

- `scripts/check-media-input-unit.mjs` — node:vm with browser shims (no real getUserMedia; mock `navigator.mediaDevices`)
- `scripts/check-media-input-smoke.mjs` — Puppeteer against built `dist/`; assert modules mount, factory works, no console errors. Skip the actual camera/mic permission flow (CI sandbox can't grant it).

## Close-out

All 6 tasks landed on `feat/live-camera-mic` and reviewed:

| Task | Commit | Outcome |
|---|---|---|
| 1 — MediaInput API | `b0ba51c` | PASS, 14 methods, 488 LOC |
| 2 — Camera Preview UI | `e53a7a3` + `dce161a` | PASS + minor fix (switchCamera failure routing) |
| 3 — Mic Meter UI | `91203a5` | PASS with minor deviation (no-analyser-source returns null instead of mounting idle — defensive) |
| 4 — Tests + chain wiring | `c1a99d6` | PASS, 75/75 unit assertions green, smoke syntax-clean |
| 5 — Demo page | `64492a8` + `632f126` | PASS + minor fix (persistence readout now reflects live state) |
| 6 — Docs (this commit) | `b8b7248` | n/a |

7 commits total. PR opens after this commit lands.

Sprint ordering reminder: this is PR 1 of the user's chosen 4-PR sequence.
Next: PR 2 = Spit Live (`/spit`), then PR 3 = TikTok Studio (`/tiktok`),
then PR 4 = Camera Enhance (independent of this foundation).

## Persistence keys (new)

- `swr.media.lastDevices` — JSON `{ videoDeviceId, audioDeviceId, videoFacingMode }`

## Permissions

- Camera + mic require HTTPS or localhost (browser security); document in CHANGELOG
- First call to `startCamera`/`startMic` triggers the prompt
- `requestPermissions()` is a convenience that prompts for both in one call

## Constraints

- No TypeScript, 2-space indent, single quotes, `'use strict'` not needed (ESM)
- AGENTS.md git identity rule applies (every commit uses `-c user.name='Kajica Djuric' -c user.email='kai.djuric@gmail.com' --author='Kajica Djuric <kai.djuric@gmail.com>'`)
- Build size budget: currently ~114MB / 130MB. New modules are ~30KB combined (no assets). Well within budget.
- Sandbox: chmod on helper scripts blocked; inline equivalent logic if needed.
- The `cover-behaviour` smoke flake at `scripts/check-automix-smoke.mjs:1010-1038` is still pre-existing; expect to merge with `--admin` if it triggers. Not a blocker for this PR — the new smoke is independent.

## Risks

- **Browser-only APIs:** SWRMediaInput can't be tested in pure node; node:vm sandbox requires careful shimming of `navigator.mediaDevices`. Mitigation: write a thin `MockMediaDevices` class with the 4-5 methods we touch (`getUserMedia`, `enumerateDevices`, `getDisplayMedia` not needed).
- **iOS Safari quirks:** getUserMedia requires HTTPS even on localhost; `playsinline` attribute needed for non-fullscreen video. Document in CHANGELOG.
- **Cleanup leaks:** unclosed MediaStream tracks will keep the camera/mic light on. Mitigation: explicit `destroy()` + auto-stop in `unmount()` paths.
- **MediaRecorder codec:** webm-vp9 with opus fallback to webm-vp8 with opus. Safari needs different mime (mp4). Document; defer Safari support to a follow-up.

## Out of scope (intentionally)

- Engine integration (audio-reactive visuals riding mic input) — that's PRs 2/3
- Server-side recording (Cloudflare Stream, Mux, etc.)
- Multi-track mixing (beat audio + mic + canvas → single file) — Spit Live PR handles
- WebRTC peer connections (no peer-to-peer streaming in scope)
- Authentication / saved sessions
- Recording format conversions (server-side muxing)

## Acceptance criteria (whole PR)

- [ ] `client/swr-media-input.client.js` exists, ≤ 600 LOC, exposes factory + 11 instance methods
- [ ] `client/swr-camera-preview.client.js` exists, ≤ 400 LOC, exposes `mount/unmount`
- [ ] `client/swr-mic-meter.client.js` exists, ≤ 350 LOC, exposes `mount/unmount`, rAF-driven
- [ ] `/lab/media-input` loads cleanly in dev + dist; both components visible
- [ ] `node scripts/check-media-input-unit.mjs` exits 0 with ≥30 green assertions
- [ ] `npm run check` includes `check:media-input-unit` and stays green
- [ ] `npm run check:full` includes `check:media-input-smoke` (may be skipped by automix-smoke flake, that's fine)
- [ ] `node scripts/check-syntax.mjs` exits 0
- [ ] `docs/CHANGELOG-2026-09-22.md` has `## Live Camera & Mic foundation` section
- [ ] `AGENTS.md` lists the 3 new modules + the 2 new test scripts
- [ ] All commits authored as `Kajica Djuric <kai.djuric@gmail.com>` (NOT `kajica2`)

## Sprint ordering reminder

This is **PR 1 of 4** in the user's chosen sequence. Subsequent PRs:
- PR 2: Spit Live (`/spit`) — depends on PR 1
- PR 3: TikTok Studio (`/tiktok`) — depends on PR 1
- PR 4: Camera Enhance (`/camera-enhance`) — independent of PR 1, can run in parallel
