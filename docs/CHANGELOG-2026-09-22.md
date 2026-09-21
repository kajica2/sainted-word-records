# Changelog — 2026-09-22

---

## Live Camera & Mic foundation (PR 1 of 4)

Ships the first primitive of the live capture story — a reusable,
browser-native camera + mic API plus 2 reusable UI components. This is
the foundation for Spit Live (PR 2), TikTok Studio (PR 3), and any
future page that needs live capture. No engine integration yet — the
3 modules are pure primitives that consumer pages will wire in.

Commits:
- `b0ba51c` — `feat(media-input): SWRMediaInput class — camera + mic + analysis + recording`
- `e53a7a3` — `feat(media-input): SWRCameraPreview reusable UI component`
- `dce161a` — `fix(camera-preview): route switchCamera failure to onError/_warn`
- `91203a5` — `feat(media-input): SWRMicMeter reusable UI component`
- `c1a99d6` — `test(media-input): unit + smoke coverage, wire check chains`
- `64492a8` — `feat(media-input): demo page at /lab/media-input`
- `632f126` — `fix(lab): persistence readout now reflects live camera/mic state`

### Stats

- **3 new modules** (all IIFE + global pattern, matching automix-runtime / capture-runtime):
  - `client/swr-media-input.client.js` (488 LOC) — `SWRMediaInput.create(options)` factory + 14 instance methods
  - `client/swr-camera-preview.client.js` (399 LOC) — `SWRCamera_PREVIEW.mount/unmount` lifecycle
  - `client/swr-mic-meter.client.js` (348 LOC) — `SWR_MIC_METER.mount/unmount` + meter handle with `start/stop/setAnalyser/getState`
- **1 demo page**: `lab/media-input.html` (215 LOC) — standalone HTML at `/lab/media-input` that mounts the camera preview + mic meter, wires 6 control buttons + status text + persistence readout.
- **1 Vercel rewrite** (× 2 sources, with + without trailing slash) for `/lab/media-input` → `/lab/media-input.html`.
- **1 site-map entry** in the `tools` array: "Media Input Lab".
- **Tests**: `scripts/check-media-input-unit.mjs` (75 assertions across 5 sections: factory + state, codec selection, audio features, Camera Preview mount, Mic Meter mount) + `scripts/check-media-input-smoke.mjs` (Puppeteer smoke verifying all 3 globals load + factory returns an instance).
- **NPM scripts**: `check:media-input-unit` (wired into `check`) + `check:media-input-smoke` (wired into `check:full`).
- **No edits** to `engine.html`, the 5 core variants, `music_video.html`, or any pre-existing engine subsystem.

### Public API (3 globals on `window`)

- **`window.SWR_MEDIA_INPUT`** — factory + constants
  - `create(options)` → instance with 14 methods (`startCamera/stopCamera/switchCamera/startMic/stopMic/setupAudioAnalysis/getAudioData/startMonitor/startRecording/stopRecording/getDevices/getDeviceInfo/requestPermissions/destroy`)
  - Test hooks: `KEY_LAST_DEVICES`, `RECORDING_MIME_PREFERENCE`, `DEFAULT_VIDEO_RESOLUTION`, `DEFAULT_VIDEO_FRAMERATE`, `DEFAULT_AUDIO_SAMPLE_RATE`, `FFT_SIZE`, `SMOOTHING_TIME_CONSTANT`, `TRANSIENT_THRESHOLD`, `MONITOR_GAIN`
- **`window.SWR_CAMERA_PREVIEW`** — `mount(target, options)` returns `{ id, mediaInput, videoEl, controls }`; `unmount(targetOrId)` returns boolean; 4 size constants (`SMALL/MEDIUM/LARGE/FULL`); 5 CSS class constants
- **`window.SWR_MIC_METER`** — `mount(target, options)` returns `{ id, meter, canvas, levelsEl, clipEl }`; `unmount(targetOrId)` returns boolean; 5 class constants; 4 tunables (`LEVEL_BAR_COUNT=11`, `WARM_THRESHOLD=8`, `HOT_THRESHOLD=10`, `CLIP_RMS_THRESHOLD=0.95`)

### Persistence keys (new)

- `swr.media.lastDevices` — JSON `{videoDeviceId, audioDeviceId, videoFacingMode}`. Restored on `create()`.

### Browser requirements

- **HTTPS or localhost** required for `navigator.mediaDevices.getUserMedia` (browser security). The demo page does NOT warn on this — if you open `/lab/media-input` on `http://example.com/lab/media-input`, `getUserMedia` will fail silently.
- **MediaRecorder webm** is supported on Chrome, Edge, Firefox, and Safari 14.1+. Safari needs `playsinline` for non-fullscreen video.
- **iOS Safari** quirks: needs `<video playsinline>` (already set) and HTTPS (not localhost on real devices).

### Fix vs original PRD

The original PRD at `/Users/kaidejuricmasscmbook/Downloads/swr-live-camera-mic.md:296` referenced `MediaRecorder.isTypeMime(...)` which doesn't exist on the Web platform. The actual API is `MediaRecorder.isTypeSupported(...)`. This PR uses the correct method (see `client/swr-media-input.client.js:_pickSupportedMime`).

### Mic Meter: no-analyser-source behavior

If `mount()` is called without `options.analyser`, `options.mediaInput`, or `options.stream`, the meter returns `null` instead of mounting empty. This is defensive — it surfaces a likely programming error rather than silently rendering zero-amplitude bars. The `meter.setAnalyser()` API is still available for deferred-attach use cases. (Documented as a minor spec deviation; fix-on-encounter if it ever matters.)

### Out of scope (intentionally — future PRs)

- Spit Live page (`/spit`) — PR 2
- TikTok Studio page (`/tiktok`) — PR 3
- Engine integration (audio-reactive visuals riding mic input)
- Server-side recording (Cloudflare Stream, Mux, etc.)
- Multi-track mixing (beat audio + mic + canvas → single file)
- WebRTC peer connections
- Authentication / saved sessions
- Safari MP4 codec support (currently webm-only)
