# AR Animation Loop

Drop a GIF or static image, see it loop in your space via markerless AR.

**Page:** [`/ar-loop`](https://sainted-word-records.vercel.app/ar-loop) (or [`/engine-ar-loop.html`](https://sainted-word-records.vercel.app/engine-ar-loop.html))
**Source:** `engine-ar-loop.html` + `client/ar-loop-app.client.js`

## How to use

1. Open `/ar-loop` on a phone or laptop with a camera.
2. Grant camera permission when prompted.
3. Click **Choose GIF or image** and select a file (≤ 10 MB).
4. The image appears as a rotating plane in front of you.
5. Click **Record 5s** to capture a 5-second WebM video of the loop.
6. Click **Reset** to start over. Click **Share link** to copy a URL with `?demo=1`.

## Browser support

| Browser | AR (live camera) | Recording | Animated GIFs |
|---|---|---|---|
| Chrome (desktop + Android) | ✅ | ✅ WebM | ✅ |
| Firefox | ✅ | ✅ WebM | ✅ |
| Safari iOS 16+ | ✅ | ⚠️ MP4 only | ✅ |
| Safari iOS < 16 / no-camera desktop | ⚠️ preview-only fallback | n/a | static frame only |

The "no-camera fallback" shows a static dark background with a hint; the plane still rotates so you can see what the page does without a camera.

## Architecture

- **A-Frame 1.5.0** + **AR.js 3.x** (markerless, sourceType: webcam) for the AR scene
- **aframe-gif-shader 0.9.1** for animated GIF playback (gracefully degrades to first-frame if CDN is blocked)
- **MediaRecorder API** for capturing canvas + AR video as WebM
- All CDN scripts pinned; no AI services, no third-party API keys

The controller (`client/ar-loop-app.client.js`) manages a state machine:
`idle → uploading → ready → recording → exporting → done` (or `error`).

## Known limitations

- **10 MB max upload.** Anything bigger is rejected with a status hint.
- **Recording is hard-coded to 5 seconds.** Future: expose a UI knob.
- **No image-to-3D in v1.** The user's drop is shown as a textured plane, not a 3D model. Adding `model-viewer` for GLB upload is a planned follow-up.
- **Share link** copies `?demo=1` but does not yet auto-load a bundled demo GIF. Future: ship a tiny `<5 KB` demo GIF and load it on `?demo=1`.

## Dev / test

```bash
npm run build && node verify-ar-loop.mjs
```

The verify script is a Puppeteer smoke test that uploads a 1×1 PNG, asserts the state pill transitions to `ready`, then asserts the Reset button returns to `idle`. Camera + microphone permissions are granted via CDP `--use-fake-ui-for-media-stream`.

Manual test checklist (also embedded in the controller file header):

1. Page loads with no console errors.
2. Camera permission prompt appears (or body.no-camera is set).
3. With camera granted, the live webcam feed is visible behind the empty plane.
4. Click "Choose GIF or image" → select any small GIF or PNG.
5. Within ~1s the image appears as a rotating plane in front of the camera.
6. Click "Record 5s" → status changes to "Recording 5s…" → after 5s a `.webm` file downloads.
7. Click "Reset" → plane disappears, status returns to "Drop a file to begin."
8. Reload, dismiss camera permission → page still works (plane spins on a static background).
