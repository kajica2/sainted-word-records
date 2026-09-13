# Batch Video Creator — Documentation

A CLI tool that turns a folder of audio files into audio-reactive MP4 videos, by:

1. Analyzing each track with `audio-analysis-v2.js` (BPM, key, scale, chromagram, onsets)
2. Picking the best-fitting engine variant from `versions/*.html` (15 candidates)
3. Rendering the full song via Puppeteer + CDP screenshots + ffmpeg image2pipe

The output is one MP4 per input plus a `summary.json` with the analysis, pick rationale, and render metrics.

---

## Quick start

```bash
# Render every .mp3/.wav in a folder (default: hallucination variant via CLI shim)
node scripts/batch-video.mjs \
  --input /path/to/songs \
  --output /path/to/out

# Auto-pick the best variant for each track
node scripts/batch-video.mjs \
  --input /path/to/songs \
  --output /path/to/out

# Override the picker (force a single variant for the whole batch)
node scripts/batch-video.mjs \
  --input /path/to/songs \
  --output /path/to/out \
  --variant film

# Faster drafts (12fps instead of 24) with 2 concurrent renders
node scripts/batch-video.mjs \
  --input /path/to/songs \
  --output /path/to/out \
  --fps 12 --parallel 2

# Just analyze (no render) for fast picker evaluation
node scripts/analyze-mp3.mjs song.mp3
```

A pre-render dev server must be running for the page-based variants to work:

```bash
npm run dev   # serves http://localhost:5174/ — required for any render
```

---

## Architecture

```
                        ┌────────────────────────────────────────┐
                        │   audio-analysis-v2.js (browser-side)  │
                        │   FFT, Krumhansl-Schmuckler, onsets   │
                        └─────────────────┬──────────────────────┘
                                          │
                                          ▼
                       ┌─────────────────────────────────────┐
                       │   scripts/analyze-mp3.mjs           │
                       │   Headless Chrome wrapper:          │
                       │   decode + analyzeBuffer → JSON     │
                       └─────────────────┬───────────────────┘
                                         │ one JSON per file
                                         ▼
                  ┌──────────────────────────────────────────┐
                  │   lib/variant-picker.mjs (pure)         │
                  │   bucketize() → score profiles → pick() │
                  └────────────────┬─────────────────────────┘
                                   │ { variant, score, rationale, allScores }
                                   ▼
             ┌────────────────────────────────────────────────┐
             │   scripts/batch-video.mjs                     │
             │   per-song:                                  │
             │     analyze → pick → renderVariant()          │
             │   --parallel N: spawn N child Node procs     │
             └─────────────────────┬──────────────────────────┘
                                   │ spawn or direct call
                                   ▼
        ┌────────────────────────────────────────────────────┐
        │   scripts/render-full-song.mjs (renderVariant)    │
        │   1. boot static file server (port 0 = ephemeral)│
        │   2. Puppeteer headless Chrome                   │
        │   3. open versions/<variant>.html               │
        │   4. drop user library into #asset-input         │
        │   5. drop song into #song-input, click play      │
        │   6. CDP screenshot per frame → ffmpeg image2pipe│
        │   7. ffmpeg remux with original WAV               │
        └────────────────────┬───────────────────────────────┘
                             │ MP4
                             ▼
                    /path/to/out/<song>.<variant>.mp4
```

The picker is pure (no DOM, no Node globals) and reused by every entry point — CLI, batch, or any future UI.

---

## File reference

### `lib/variant-picker.mjs` — pure picker

Exports:
- `pick(analysis)` → `{ variant, score, rationale, allScores, features }`
- `bucketize(analysis)` → `{ bpmBucket, scale, energyBucket, onsetRate, chromaVariance, synthChroma, beatStrength }`
- `listKnownVariants()` → `Array<{ name, title, description }>`

### `scripts/analyze-mp3.mjs` — analyze CLI

CLI: `node scripts/analyze-mp3.mjs <input.mp3|wav> [input2 ...]`

Loads each file in a headless Chrome page (`scripts/_analyze-stub.html`), decodes via Web Audio, runs `AudioAnalysisV2.analyzeBuffer`. Prints one JSON line per input to stdout, errors to stderr.

The page-side stub loads `audio-analysis-v2.js` and exposes `window.__analyzeBlob(arrayBuffer)`. The Node side passes the file as base64 (sidesteps CDP's typed-array marshalling — `decodeAudioData` is strict about receiving a plain `ArrayBuffer`, not a view).

Output JSON shape:
```json
{
  "input": "song.mp3",
  "bpm": 120,
  "key": "E",
  "scale": "minor",
  "confidence": 0.71,
  "chromagram": [0.18, 0.65, ...],   // 12 floats, 0..1, normalized
  "onsetCount": 234,
  "onsets": [0.08, 0.29, ...],       // seconds
  "duration": 56.58,
  "features": {                       // same as bucketize()
    "bpmBucket": "mid", "scale": "minor", "energyBucket": "hi",
    "onsetRate": 4.14, "chromaVariance": 0.038,
    "synthChroma": 1.9, "beatStrength": 0.71
  }
}
```

### `scripts/batch-video.mjs` — batch orchestrator

CLI:
```
--input <dir|file>     required; directory of MP3/WAV/M4A/FLAC/OGG, or single file
--output <dir>         required; output directory (created if missing)
--variant <name>       override picker; force this variant for every song
--parallel N           spawn N concurrent Node child processes (each its own browser)
--fps N                capture fps (default 24; 12 = draft mode)
--width N --height N   viewport + capture dimensions (default 640×360)
--quiet                suppress per-render progress logs
```

Per song, the orchestrator:
1. Spawns `analyze-mp3.mjs` once with all inputs (single Puppeteer session — fast)
2. For each input: runs `pick()` unless `--variant` overrides
3. For each render: either calls `renderVariant()` directly (parallel=1) or spawns a child Node process (parallel>1)
4. Writes `summary.json` to `--output` with per-song results

`--parallel` is the key for batch speed — each parallel worker has its own Puppeteer browser, so CDP screenshots don't compete.

Output filename pattern: `<basename>.<variant>.mp4`

Example batch on 5 vocal tracks with parallel=2 and draft fps:
```bash
node scripts/batch-video.mjs --input ./my-album --output ./renders \
  --fps 12 --parallel 2
```
Yields `./renders/song1.music_video.mp4`, `./renders/song2.music_video.mp4`, etc., plus `summary.json`.

### `scripts/render-full-song.mjs` — single render

Exports `renderVariant(opts)`:
```js
await renderVariant({
  inputPath,     // absolute .wav|.mp3 path
  outPath,       // absolute .mp4 destination
  variant,       // 'hallucination' | 'music_video' | 'film' | ... any versions/*.html
  libraryPaths,  // optional array of image/video paths
  fps,           // capture fps (default 24)
  width, height, // viewport + capture dimensions (default 640×360)
  quiet,         // suppress per-step console logs
});
```

Returns `{ framesWritten, fpsActual, durationMs }`.

The render uses CDP screenshots (`Page.captureScreenshot`) instead of `canvas.captureStream()` because in headless Chrome on macOS with ANGLE+swiftshader, the page's canvas readback buffer is empty even though the compositor paints correctly — so `getImageData`, `canvas.captureStream()`, and `ImageCapture.grabFrame()` all return black. CDP screenshots read the compositor directly and bypass the bug.

The CLI shim at the bottom of the file preserves backwards compat:
```bash
node scripts/render-full-song.mjs <input.wav> <output.mp4> [lib.mp4 ...]
```
calls `renderVariant` with `variant: 'hallucination'` (the previous hardcoded default).

### `scripts/_analyze-stub.html` — analyzer host

Tiny 32-line page that loads `audio-analysis-v2.js` and exposes `window.__analyzeBlob(arrayBuffer)` for the Node side to call.

### `scripts/test-variant-picker.mjs` — picker unit tests

15 assertions covering:
- `bucketize()`: slow/mid/fast BPM, onset rate drives energy bucket, missing fields degrade to null (no false triggers)
- `pick()`: 8 specific song archetypes (slow minor ballad, fast electronic, 4-on-the-floor, dreamy major, heavy bass, ambient, vocal-no-BPM ×2)
- `listKnownVariants()`: every PROFILE entry has a real `versions/*.html` file

Run: `node scripts/test-variant-picker.mjs`

---

## The picker algorithm

### Step 1: bucketize raw analysis into weighted features

```js
{
  bpmBucket:        'lo' | 'mid' | 'hi' | 'unknown',  // bpm <90, 90-140, >140, or 0
  scale:            'major' | 'minor' | null,         // null when no signal
  energyBucket:     'lo' | 'mid' | 'hi' | null,       // onsetRate <0.5/s, 0.5-2/s, >2/s
  onsetRate:        <float>,
  chromaVariance:   <float>,                          // 0 if no signal
  synthChroma:      <float>,                          // sum of A, E, D chroma weights
  beatStrength:     <float>,                          // confidence × min(onsetRate/2, 1)
}
```

**Critical:** when the analysis has no signal (no bpm, no duration, no onsets), every bucket must read as `unknown` / `null` so picker weights don't accidentally fire for nonexistent features. Tested explicitly in `bucketize missing fields degrades gracefully`.

### Step 2: score each variant against its profile

Each of the 15 variants has a hand-tuned profile. A variant's score is the sum of weights whose features match:

```js
PROFILES = {
  music_video: { default: 1.0, bpmBucket_unknown: 0.8 },
  spectrum:    { default: 0.9, bpmBucket_unknown: 0.6 },
  film:        { bpmBucket_lo: 1.4, scale_minor: 1.2, energyBucket_lo: 0.6 },
  neon:        { bpmBucket_hi: 1.5, synthChroma: 1.3 },
  grid:        { bpmBucket_mid: 1.2, beatStrength: 1.4 },
  smoke:       { bpmBucket_lo: 1.3, energyBucket_lo: 1.2 },
  aurora:      { scale_major: 1.5, energyBucket_lo: 1.1 },
  void:        { energyBucket_lo: 1.4, scale_minor: 1.1 },
  glitch:      { beatStrength: 1.2, energyBucket_hi: 1.1, chromaVariance: 0.5 },
  chrome:      { bpmBucket_mid: 1.2, scale_minor: 0.6, chromaVariance: 0.4 },
  fractal:     { chromaVariance: 1.3, beatStrength: -0.8 },  // negative: penalty
  collage:     { bpmBucket_mid: 1.1, beatStrength: 0.8 },
  pulse:       { energyBucket_hi: 1.8, bpmBucket_lo: 1.0, beatStrength: 0.5 },
  watercolor:  { energyBucket_lo: 1.3, scale_major: 1.0 },
  eclipse:     { scale_minor: 1.2, energyBucket_mid: 1.0 },
};
```

Weight key shape:
- `bpmBucket_lo|mid|hi|unknown` — bucket match against `bpmBucket` value
- `energyBucket_lo|mid|hi` — bucket match against `energyBucket` value
- `scale_major|minor` — bucket match against `scale` value
- `synthChroma` — numeric; fires if value >1.0 (synth-heavy chroma: A, E, D)
- `chromaVariance` — numeric; fires if value >0.04 (non-flat chroma)
- `beatStrength` — numeric; fires if value >0.05 (clear beat). Negative weights apply when value >threshold (e.g. fractal penalizes beat-driven tracks)
- `default` — always applied as a floor so any track scores positively on every variant

Top score wins. Ties broken by PROFILES insertion order (music_video listed first).

### Step 3: emit pick + rationale

```js
{
  variant:  'film',
  score:    2.6,
  rationale: 'film wins (score 2.60) via: bpmBucket_lo, scale_minor',
  allScores: { film: {score: 2.6, hits: [...]}, neon: {...}, ... },
  features: { ...bucketize() output... }
}
```

The full `allScores` map is emitted so downstream consumers (UI, batch script, manual review) can see what was considered.

### When `music_video` is the right answer

The picker routes two cases to `music_video`:

1. **Truly empty analysis** (bpm=0, no duration, no onsets) — there's literally no signal to score on. `music_video` wins via its `default: 1.0` floor.
2. **Vocal tracks with undetectable BPM** (bpm=0 but onsetRate >0) — onset-based tempo detection fails on vocal material, so `bpmBucket === 'unknown'`. `music_video` carries a `bpmBucket_unknown: 0.8` weight specifically for this case.

Both are correct: `music_video`'s description literally says "drop a track, the engine synthesizes a preset" — it's the variant designed to handle any input gracefully.

### Variant profile rationale (every entry)

| Variant | Weight intent |
|---|---|
| `music_video` | Catch-all. Default 1.0 floor; `bpmBucket_unknown` weight for vocal tracks. |
| `spectrum` | Pure audio-reactive visualizer, doesn't need footage. Default + `bpmBucket_unknown` for the same reason as music_video. |
| `film` | 16mm grain + sepia + warm. Slow + minor + lo energy. |
| `neon` | Magenta/cyan glow + chromatic aberration. Fast + synth chroma. |
| `grid` | Monochrome hard cells, snap to the beat. Mid BPM + strong beat. |
| `smoke` | Cream warm heavy blur, slow drift. Slow + lo energy. |
| `aurora` | Pastel mint/cyan, gentle bloom. Major + lo energy (dreamy). |
| `void` | Pure black with single-pixel scanlines. Lo energy + minor (minimal). |
| `glitch` | Datamosh slice displacement. Strong beat + hi energy + non-flat chroma (chaotic). |
| `chrome` | Liquid metal, hard specular. Mid BPM + minor + non-flat chroma (metallic). |
| `fractal` | Mandelbrot-adjacent, heavy chroma + grain. Non-flat chroma BUT NOT beat-driven (negative weight on beatStrength to prevent it from absorbing any non-flat track). |
| `collage` | Magazine-grid split-screen. Mid BPM + moderate beat. |
| `pulse` | Bass-locked concentric rings. Hi energy + slow + clear beat. |
| `watercolor` | Soft pastel pigment pools. Lo energy + major (gentle). |
| `eclipse` | Deep black + corona glow. Minor + mid energy (dramatic). |

The weights are tuned against each variant's `<meta name="description">` in `versions/*.html`. If you add a new variant, add a profile entry; if you change a variant's description, retune the matching profile.

---

## The render pipeline

### Why CDP screenshots instead of MediaRecorder

The `versions/*.html` engine pages create their `<canvas>` with `getContext('2d', { willReadFrequently: true })`. In headless Chrome on macOS with ANGLE+swiftshader, that flag leaves the canvas's CPU readback buffer empty even though the compositor paints correctly. Consequences:

| Read path | Result |
|---|---|
| `ctx.getImageData(x, y, w, h)` | black |
| `ctx.drawImage(otherCanvas, ...)` | black |
| `canvas.captureStream(30)` → MediaRecorder | black |
| `ImageCapture.grabFrame()` on capture track | black |
| `Page.captureScreenshot` (CDP, reads compositor) | real pixels |

CDP screenshots are the only path that produces non-black frames in headless. ~5 fps capture rate in swiftshader at 640×360 is the floor — no Metal path exists for headless WebGL on macOS.

### Pipeline (per render)

1. Launch headless Chrome with the swiftshader flag combo that produces real pixels:
   ```
   --use-gl=angle --use-angle=swiftshader --enable-webgl
   --ignore-gpu-blocklist --enable-unsafe-swiftshader
   --disable-background-timer-throttling
   --disable-renderer-backgrounding
   --disable-backgrounding-occluded-windows
   --disable-features=IntensiveWakeUpThrottling
   ```
2. Override `localStorage.swr.audio.armed` and `swr.recorder.worker` before page boot (disable auto-start overlay, force legacy MediaRecorder path)
3. Open `versions/<variant>.html` with `waitUntil: 'domcontentloaded'` (Vite HMR keeps a WebSocket open; `networkidle0` never resolves). Poll `window.SWR.Audio/Layers` for readiness
4. Upload user library videos via `#asset-input` (file picker with multiple accepts), wait for each to load + classify
5. Replace the auto-populated curated layers with the user's library (`Layers.list.length = 0; Layers.add(items[i])` for each), click `#remap`
6. Drop the song into `#song-input`, click `#play`, force `AudioContext.resume()`, poll `audioEl.currentTime` until >0.05
7. Loop `totalFrames` times: `Page.captureScreenshot(format: 'jpeg', quality: 88, clip: viewport)` → base64 → buffer → pipe into ffmpeg stdin. Pace to `1000/FPS` ms per frame
8. `ffmpeg -i - -i <song.wav> -map 0:v:0 -map 1:a:0 -c:v libx264 -c:a aac -shortest` produces the MP4

### Why use the original WAV as the soundtrack

Chrome's MediaRecorder drops duration cues from the WebM container (a long-standing bug — the audio track has no duration metadata). When ffmpeg muxes that WebM with `-shortest`, the output is truncated to the first ~30s.

The fix: re-mux with the **original WAV** as the audio source instead of the captured WebM's audio. ffmpeg uses the WAV's duration cues (199.20s for the 199.20s song) and the `-shortest` flag bounds the output to the shorter stream — usually the WebM, which is bounded by the song's audio length.

Bonus: the WAV is sample-accurate. The MediaRecorder audio capture is also sample-accurate but resampled through the browser's audio graph, so the WAV is more faithful to the source.

### Wall-time expectations

Empirically measured on a 3:20 (199s) song with `--fps 24`:
- Total frames: 4780
- Capture rate: ~5 fps (CDP bottleneck)
- Wall time: ~22-25 min
- Output: ~190 MB (mostly I-frame-heavy because content varies)

Draft mode `--fps 12`:
- Total frames: ~2400
- Capture rate: same (~5 fps, but fewer frames needed)
- Wall time: ~12 min

`--parallel N` divides wall time roughly by N (each worker has its own browser), but memory cost is N × ~500 MB. On a 16 GB Mac, `--parallel 4` is comfortable.

---

## `summary.json` shape

Per batch, `summary.json` contains an array of objects:

```json
[
  {
    "input": "/abs/path/to/song.mp3",
    "ok": true,
    "output": "/abs/path/to/out/song.music_video.mp4",
    "analysis": {
      "input": "song.mp3",
      "bpm": 0, "key": "E", "scale": "minor", "confidence": 0.71,
      "chromagram": [...], "onsetCount": 234, "duration": 56.58,
      "features": {...}
    },
    "pick": {
      "variant": "music_video",
      "score": 1.8,
      "rationale": "music_video wins (score 1.80) via: bpmBucket_unknown",
      "allScores": {
        "music_video": { "score": 1.8, "hits": ["bpmBucket_unknown"] },
        "film":        { "score": 1.2, "hits": ["scale_minor"] },
        ...
      }
    },
    "render": {
      "framesWritten": 1358,
      "fpsActual": 3.6,
      "durationMs": 377000
    },
    "wallMs": 377234
  },
  ...
]
```

Failed renders include `"ok": false, "error": "<message>"` instead of `output`/`render`.

---

## Tuning the picker

The PROFILES table is hand-tuned against each variant's `<meta name="description">`. To retune:

1. Run `node scripts/analyze-mp3.mjs <song>` on a sample song
2. Pipe through the picker to see what wins and why
3. Adjust weights in `lib/variant-picker.mjs` if the pick is wrong
4. Add a fixture to `scripts/test-variant-picker.mjs` covering the new case

**When to retune:**
- New variant added to `versions/*.html` — add a PROFILES entry + variant-page-existence test
- Variant description changes — retune the matching profile
- Picker chooses wrong on real songs — add fixture, retune weight, verify test catches it

**When NOT to retune:**
- The picker chooses a variant you don't personally like — preferences vary; the picker is descriptive of the variant's stated character, not your taste
- Single outlier tracks — too small a sample; collect more first

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Navigation timeout of 60000 ms exceeded` | `waitUntil: 'networkidle0'` hangs because of HMR WebSocket | Already fixed: script uses `domcontentloaded` + readiness poll |
| `Failed to execute 'decodeAudioData' on 'BaseAudioContext'` | CDP serializes ArrayBuffer as a view, `decodeAudioData` rejects views | Already fixed: script passes audio as base64 |
| Black video frames | Canvas readback bug with `willReadFrequently: true` under swiftshader | Already worked around: CDP screenshots bypass canvas readback |
| `No #asset-input on page` | Variant page doesn't support library upload | Use a variant that supports it (most do — verify with `grep -l asset-input versions/*.html`) |
| `No #song-input on page` | Variant page has no audio input wired | Use a different variant — almost all support it |
| Capture fps <5, render takes >30 min | swiftshader CPU limit; can't be improved in software | Reduce viewport (`--width 480 --height 270`), use `--fps 12`, or run on a Linux box with NVIDIA + `--use-gl=egl --enable-unsafe-webgpu` for 20-50× speedup |
| `localStorage.swr.audio.armed` was set in a previous session | Overlay races the user's upload and replaces it | Already handled: `evaluateOnNewDocument` clears the flag before any page script runs |
| Picker keeps choosing `fractal`/`music_video` for everything | No BPM detected (vocal tracks) OR weights are wrong | Verify analyzer output: `node scripts/analyze-mp3.mjs song.mp3 | jq .features.bpmBucket`. If `unknown`, vocal — fall back to `music_video` is correct. If `mid` but fractal still wins, retune weights. |

---

## API summary

### `lib/variant-picker.mjs`

```js
import { pick, bucketize, listKnownVariants } from './lib/variant-picker.mjs';

const result = pick(analysisJSON);
// result.variant     -> 'film' | 'music_video' | ...
// result.score       -> 2.6
// result.rationale   -> 'film wins (score 2.60) via: bpmBucket_lo, scale_minor'
// result.allScores   -> { variant: {score, hits[]}, ... } for ALL variants
// result.features    -> bucketize() output

const buckets = bucketize(analysisJSON);
// { bpmBucket, scale, energyBucket, onsetRate, chromaVariance, synthChroma, beatStrength }

const known = listKnownVariants();
// [{ name: 'film', title: 'FILM · SWR engine v2', description: '16mm grain + sepia...' }, ...]
```

### `scripts/render-full-song.mjs`

```js
import { renderVariant } from './scripts/render-full-song.mjs';

const result = await renderVariant({
  inputPath: '/abs/song.mp3',
  outPath:   '/abs/out.mp4',
  variant:   'film',
  libraryPaths: ['/abs/clip1.mp4', '/abs/clip2.jpg'],
  fps: 24,
  width: 640, height: 360,
});
// result.framesWritten -> 4780
// result.fpsActual     -> 5.2 (actual capture rate)
// result.durationMs    -> 1470000 (25 min wall time)
```

---

## Versioning

Tied to `feat/asset-curator` branch. To ship:

```bash
# Push the commits
git push origin feat/asset-curator

# Open a PR to main — Vercel auto-deploys on merge
gh pr create --base main --head feat/asset-curator \
  --title "feat(batch-video): batch auto video creator" \
  --body "..."
```

The CLI scripts (`scripts/batch-video.mjs`, `scripts/analyze-mp3.mjs`, `scripts/render-full-song.mjs`, `scripts/_analyze-stub.html`, `scripts/test-variant-picker.mjs`) and the library module (`lib/variant-picker.mjs`) ship in `dist/` after `npm run build` if you add them to the `vite.config.js` `copyStatic` paths. Currently they're dev-only — not included in `rootFiles`.

To make them accessible from a web UI (e.g. a `/batch` page), expose `variant-picker` as a browser IIFE and import it. The `pick()` function is already pure and dependency-free.