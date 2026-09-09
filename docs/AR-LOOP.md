# AR Animation Loop

Drop a GIF or static image, see it loop in your space via markerless AR,
record a 5s WebM, share a link.

**Page:** [`/ar-loop`](https://sainted-word-records.vercel.app/ar-loop)
(also reachable at `/engine-ar-loop.html`).
**Source:** `engine-ar-loop.html` + `client/ar-loop-app.client.js`.
**Plan:** `.hermes/plans/2026-09-09_ar-animation-loop.md`.

## 1. Overview

AR Animation Loop is a stand-alone page that turns any user-supplied GIF
or static image into a textured, slowly-rotating plane floating in the
device camera feed. It exists so a visitor can mint a personal AR
artifact in under 30 seconds without learning the audio-reactive
engine: drop a file, point a camera, hit **Record 5s**, get a WebM.
The page is also a deliberate low-stakes on-ramp to the rest of the
engine — the share link it copies (`?demo=1`) sends visitors back to a
known starting state.

The implementation is intentionally thin: A-Frame 1.5.0 + AR.js 3.x for
the markerless camera feed, `aframe-gif-shader` 0.9.1 for animated GIF
playback (with a graceful static-image fallback if the CDN blocks it),
and the browser's `MediaRecorder` API for the WebM capture. There is no
backend, no auth, and no AI call — the GIF *is* the animation.

## 2. User flow

1. Open `/ar-loop` on a phone or laptop with a camera. The page
   mounts the A-Frame scene, then calls `getUserMedia({video:true})`
   to trigger the camera-permission prompt.
2. Grant (or deny) camera permission. On desktop Safari / older
   browsers with no usable webcam, the page sets
   `body.no-camera`, swaps in a static radial-gradient backdrop, and
   keeps the rotating plane so the demo is still visible.
3. Click **Choose GIF or image** and select a file. The file input
   accepts `image/gif,image/png,image/jpeg,image/webp` up to **10 MB**.
4. The state pill in the header flips to `uploading`, the file is
   decoded via `<img id="userGif">` inside `<a-assets>`, and the
   plane resizes to match the source aspect ratio. The state pill
   moves to `ready` and **Record 5s** becomes active.
5. Point the camera at anything. The plane spins around its Y axis
   (`aframe animation: rotation 0 360 0 dur 4000 loop linear`).
6. Click **Record 5s**. The controller calls `scene.captureStream(30)`,
   opens a `MediaRecorder` with a VP9-then-VP8-then-MP4 MIME fallback
   list, and starts a 5000 ms `setTimeout` that stops the recorder.
7. The state pill walks through `recording → exporting → done`. On
   `stop` the controller assembles a `Blob`, creates an anchor with
   `download="ar-loop-<ISO-stamp>.webm"`, clicks it, then revokes
   the object URL after 5 s.
8. Click **Reset** to clear the file input, revoke the object URL,
   and return the pill to `idle`. Click **Share link** at any time
   after the file is loaded to copy `/ar-loop?demo=1` to the
   clipboard (or surface it in the status bar if the clipboard API
   is unavailable).

## 3. Architecture diagram

```
                  ┌──────────────────────────────┐
                  │   engine-ar-loop.html (436 L) │
                  │   <a-scene> + <a-plane>      │
                  │   <file input> + buttons     │
                  └──────────────┬───────────────┘
                                 │ defer
                                 ▼
                  ┌──────────────────────────────┐
                  │  client/ar-loop-app.client.js│
                  │  (270 L IIFE, SWR_AR_LOOP)   │
                  │                              │
                  │  boot() → detectCamera()     │
                  │  onFile() → startRecording() │
                  │  reset() → share()           │
                  └────────┬──────────────┬──────┘
                           │              │
            ┌──────────────▼──┐     ┌─────▼─────────────┐
            │  A-Frame 1.5.0  │     │  MediaRecorder    │
            │  + AR.js 3.x    │     │  captureStream(30)│
            │  + gif-shader   │     │  → Blob → .webm   │
            │  (CDN, pinned)  │     │  (browser native) │
            └─────────────────┘     └───────────────────┘
```

The HTML page is the only thing the browser loads on first paint; the
controller attaches to existing DOM ids (`#fileInput`, `#recordBtn`,
`#resetBtn`, `#shareBtn`, `#pill-state`, `#status`) and exports a
`window.SWR_AR_LOOP` namespace for tests and the browser devtools.

## 4. State machine

```
          upload too large
  idle ──────────────────────► error
    │                            ▲
    │ file selected              │
    ▼                            │
 uploading                       │
    │ <img>.onload               │
    ▼                            │
  ready                          │
    │ click Record 5s            │
    ▼                            │
 recording                       │ MediaRecorder / setTimeout throws
    │ 5000 ms timeout fires      │
    ▼                            │
 exporting                       │
    │ onstop fires               │
    ▼                            │
  done   ── click Reset ──► idle
```

The current phase lives at `STATE.phase` and is mirrored in the
header pill. Allowed button states per phase:

| Phase | Record | Reset | Share |
|---|---|---|---|
| idle | disabled | disabled | disabled |
| uploading | disabled | enabled | disabled |
| ready | enabled | enabled | enabled |
| recording | disabled | enabled (cancels recorder) | disabled |
| exporting | disabled | enabled | disabled |
| done | enabled | enabled | enabled |
| error | disabled | enabled | disabled |

## 5. File map

| File | LOC | Role |
|---|---|---|
| `engine-ar-loop.html` | 436 | Page shell. Brand tokens (root palette matching engine.html), CDN scripts (A-Frame, AR.js, gif-shader with graceful-degrade), footer buttons, status + state pill, no-camera fallback. Includes ~340 LOC of brand tokens + style block plus ~95 LOC of structural markup. |
| `client/ar-loop-app.client.js` | 270 | Controller. IIFE global-script pattern, registers `window.SWR_AR_LOOP`. Owns the state machine, MIME pick, MediaRecorder wiring, and share-link copy. |
| `verify-ar-loop.mjs` | 111 | Puppeteer smoke test. Spins up `npm run preview`, grants fake camera + mic via CDP, uploads a 1×1 PNG, asserts `idle → ready → idle` round-trip, fails on any console error that isn't an A-Frame/AR.js headless warning. |
| `docs/AR-LOOP.md` | this file | Reference doc (you are here). |
| `vercel.json` | 2 rewrites | `/ar-loop` and `/ar-loop/` both map to `/engine-ar-loop.html`. |
| `versions.html` | 1 card | New `style-card` linking to `/ar-loop`, label "Camera · AR". |
| `vite.config.js` | 2 entries | `engine-ar-loop.html` and `client/ar-loop-app.client.js` added to the `rootFiles` allow-list so Vite copies them to `dist/`. |
| `package.json` | 1 script | `npm run verify:ar-loop` → `node verify-ar-loop.mjs`. |

## 6. Configuration / extension points

| Knob | Default | Where to change |
|---|---|---|
| Max upload size | `10 * 1024 * 1024` (10 MB) | `MAX_BYTES` constant at `client/ar-loop-app.client.js:77`. Files above the cap are rejected with a status message and the pill moves to `error`. |
| Recording duration | `5000` ms | The `setTimeout(..., 5000)` at the end of `startRecording()` at `client/ar-loop-app.client.js:201-205` stops the recorder after 5s. The button label reads "Record 5s"; if you change the value, update the button label too. `reset()` calls `STATE.mediaRecorder.stop()` directly without a timeout — stopping is immediate when the user clicks Reset. |
| Recording bitrate | `4_000_000` bps | `videoBitsPerSecond` argument to `new MediaRecorder(...)` at line 158. |
| Capture framerate | `30` fps | `scene.captureStream(30)` at line 148. |
| Plane rotation speed | `4000` ms / full revolution | `animation="...dur: 4000..."` attribute on `<a-plane>` in `engine-ar-loop.html`. |
| Plane distance | `-2` m on Z | `position="0 0 -2"` on `<a-plane>`. |
| Plane size | `1.5` m base height | `baseHeight = 1.5` in the controller's `img.onload`. Width auto-fits to the image aspect ratio. |
| MIME fallback chain | VP9 → VP8 → WebM → MP4 → default | `pickMimeType()` at lines 121-133 — add your preferred codec here. |
| Accepted file types | gif, png, jpeg, webp | The `accept` attribute on `<input id="fileInput">`. |

## 7. Browser support matrix

| Browser | Markerless AR | WebM recording | Animated GIF shader |
|---|---|---|---|
| Chrome (desktop + Android) | ✅ webcam + AR.js | ✅ WebM (VP9/VP8) | ✅ |
| Firefox (desktop + Android) | ✅ webcam + AR.js | ✅ WebM (VP8) | ✅ |
| Safari iOS 16+ | ✅ (HTTPS required) | ⚠️ MP4 only — Safari's MediaRecorder rejects `video/webm` | ✅ |
| Safari iOS < 16 | ⚠️ preview-only fallback (`body.no-camera`) | n/a | static first-frame only |
| Desktop without a webcam | ⚠️ preview-only fallback | n/a (no canvas stream source) | static first-frame only |

Notes:

- **HTTPS is mandatory** for `getUserMedia` outside `localhost`. Vercel
  already serves the production deploy over HTTPS; on `localhost` the
  dev server works without TLS.
- **Headless Chromium** (Puppeteer) has no real camera; the smoke
  test uses `--use-fake-ui-for-media-stream` +
  `--use-fake-device-for-media-stream` so the permission prompt
  auto-accepts and AR.js gets a synthetic pattern.
- **gif-shader** is loaded from `cdn.jsdelivr.net` with
  `crossorigin="anonymous"` and an `onerror` handler that sets
  `window.__gifShaderFailed = true`. The controller detects that
  flag on boot and surfaces a status hint ("Animated GIF support
  unavailable — static images still work.") instead of letting the
  plane render blank.

## 8. Known limitations

- **10 MB upload cap.** Bigger files are rejected with a status
  message. Increase `MAX_BYTES` if you need larger source files.
- **5 s hard-coded recording duration.** The button label and the
  `setTimeout` both bake in 5000 ms; making it user-configurable
  means also reworking the share/download UX.
- **No image-to-3D.** A still photo or a GIF is shown as a flat
  textured plane. Adding `model-viewer` for GLB upload is on the
  roadmap.
- **`?demo=1` does not auto-load a bundled demo GIF yet.** It just
  copies the URL. The plan is to ship a tiny `<5 KB` demo GIF and
  load it on `?demo=1`.
- **Single-plane AR.** No multi-plane stacking, no compositing with
  the audio-reactive engine.
- **Headless smoke test can't see AR.** Puppeteer never actually
  renders a marker plane — it only asserts the state machine. Full
  visual regression would need a real device or a WebXR emulator.
- **iOS Safari's recording is MP4, not WebM.** The fallback chain
  handles this automatically but the downloaded file extension is
  always `.webm` (the controller ignores the actual MIME when naming
  the file). Renaming the file by `rec.mimeType` is a one-line fix.

## 9. Dev / test commands

```bash
# Build (Vite copies engine-ar-loop.html + ar-loop-app.client.js into dist/)
npm run build

# Boot preview server and run the puppeteer smoke test
npm run preview &
sleep 2
npm run verify:ar-loop

# Direct test (assumes preview already on :4174)
node verify-ar-loop.mjs

# Manual checklist (mirrors the comment block in client/ar-loop-app.client.js)
# 1. Page loads with no console errors.
# 2. Camera permission prompt appears (or body.no-camera is set).
# 3. With camera granted, the live webcam feed is visible behind the empty plane.
# 4. Click "Choose GIF or image" → select any small GIF or PNG.
# 5. Within ~1s the image appears as a rotating plane in front of the camera.
# 6. Click "Record 5s" → status changes to "Recording 5s…" → after 5s a .webm file downloads.
# 7. Click "Reset" → plane disappears, status returns to "Drop a file to begin."
# 8. Reload, dismiss camera permission → page still works (plane spins on a static background).
```

## 10. Future work

- **GLB / glTF upload via `<model-viewer>`** — render the user's
  model in the same AR scene with the same record-and-share UX.
- **Demo GIF on `?demo=1`** — bundle a `<5 KB` looping GIF, load it
  when the query string is present so the share link is a real
  preview instead of a placeholder.
- **Configurable record length** — UI slider, 1–30 s, with a small
  bitrate heuristic so longer recordings don't blow past 50 MB.
- **Server-side render** — POST the WebM to `/api/storage` (signed
  upload) so the user gets a persistent URL instead of a one-shot
  download. Uses the existing storage API.
- **Multi-plane scenes** — let the user add 2-4 GIFs and stack them
  in Z. Drives toward a future `/ar-stories` page.
- **FFmpeg-based trim** — record 30 s, let the user trim to 5 s in
  browser, then export. The existing `lib/omggif.js` plus a small
  WebCodecs encoder can do this without leaving the client.
