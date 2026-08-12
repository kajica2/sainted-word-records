# How to record a 30-second video with SWR

This is the local how-to for `sainted-word-records` — the audio-reactive video
engine at `/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/`.

You can also record videos with the **hyperframes** skill (separate tool for
scene-based keyframed video). The flow below is for SWR's audio-reactive,
library-mixing, algorithmic output.

---

## Quick path (main engine)

1. **Start the dev server**
   ```bash
   cd /Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records
   nohup ./node_modules/.bin/vite --port 5174 --host 0.0.0.0 > /tmp/swr.log 2>&1 &
   ```
2. **Open** `http://localhost:5174/` in a browser (width ≥ 1080px)
3. **Click `LOAD SONG`**, pick an audio file
   - `.mp3`, `.wav`, `.m4a` all work
   - The 27-item library (12 videos + 15 images) auto-loads from the `library/` folder
4. **Wait for the status pill to say `READY`** (green) — engine is ready
5. **Click `▶ PLAY`** to start the audio
6. **Pick a duration** from the new dropdown next to REC: `10s / 15s / 30s / 60s / song / manual`
   - Default is `30s` — exactly what you asked for
   - `song` records the remaining length of the loaded track
   - `manual` keeps the old hand-timed behavior
7. **Click `● REC`** — button turns red, status shows `recording · MP4 · 30s`
8. **Wait** — engine auto-stops at 30s, status flips to `exported`
9. **Browser downloads** `sainted-word-{timestamp}.mp4` to your downloads folder
10. **Done.** A real 30.00s H.264 + AAC MP4, ~4 MB, plays in any video editor.

## Want a different look?

Click **`RE-MAP`** any time before REC. Each click is a fresh look — different
assets assigned to the 6 layers, different blend-mode orderings (screen /
lighter / difference / overlay / multiply). Click until you see one you like.

The library sidebar shows what's in the pool. Drop more videos / images / GIFs
onto the page to add to the pool — the engine scores each by motion / luma /
hue and picks accordingly.

## Want a different aesthetic?

Top-left badge: **"5 visual versions →"** opens `/versions/` — five different
visual languages (NEON, FILM, GRID, SMOKE, HALLUCINATION). Each is the same
engine with a different blend/blur/grid/grain treatment. Same flow.

## Production build (deploy-ready)

```bash
cd /Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records
./node_modules/.bin/vite build
```

Outputs to `dist/`. The new `copyStatic` plugin in `vite.config.js` ships the
full `library/` (75MB of 12 videos + 15 images) AND the 5 versions
(`dist/versions/`) along with the main engine. Total dist is ~82MB. Drop the
folder on Vercel / Netlify / Cloudflare Pages and you're live.

## How the recording actually works (for the curious)

- The canvas is captured via `stageCanvas.captureStream(30)` — 30 fps video
- Web Audio is tapped at the `analyser` node into a `MediaStreamDestination`
  (a `MediaStream` with the audio track at 48 kHz)
- Both tracks go into one `MediaStream` → `MediaRecorder`
- `MediaRecorder` is asked for `video/mp4;codecs=avc1.42E01E,mp4a.40.2` first
  (H.264 + AAC). Modern Chrome 126+ and Safari 14.5+ ship it natively. Falls
  back to WebM if the browser can't do MP4
- `videoBitsPerSecond: 8_000_000` (8 Mbps, fine for 1080p)
- The Recorder auto-stops via `setTimeout` matching `autoStopAt = Date.now() + durationMs`
- On `onstop`, the chunks are muxed into a `Blob` and a download `<a>` is auto-clicked

## Hyperframes alternative

If you want a **scene-based, hand-keyframed** video (different paradigm — full
creative control, no audio reactivity), the `hyperframes` skill in this
agent's toolbox is the right tool:

```
skill({ name: "hyperframes" })
```

It builds multi-phase scene blueprints with seek-safe keyframes (GSAP /
CSS keyframes / Anime.js), explicit timeline composition, and a
build/snapshot/lint/render CLI. The output is rendered offline (Remotion or
similar) and exported as MP4. Doesn't mix audio + video reactively the way
SWR does. Use hyperframes when you want every second planned, SWR when you
want the engine to drive the visuals from the audio.

## What ships in this engine right now

| | main `/` | NEON | FILM | GRID | SMOKE | HALLUCINATION |
|--|--|--|--|--|--|--|
| 30s auto-stop | ✅ default | ✅ | ✅ | ✅ | ✅ | ✅ |
| MP4 export | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fresh remap each click | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 27-item library | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `window.SWR` exposed | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
