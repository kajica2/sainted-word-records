# Batch Auto Video Creator — Implementation Plan

> **For Hermes:** Plan first, phased execution with approval gates (per `code-work-defaults`).

**Goal:** A CLI that takes an MP3 (or a folder of MP3s), runs `audio-analysis-v2.js` to extract BPM/key/scale/chromagram/onsets, picks the best-matching `versions/*.html` engine variant by a feature→variant scoring table, and renders a full-song audio-reactive MP4 using the proven `scripts/render-full-song.mjs` capture pipeline. Output is one MP4 per input song, plus a `summary.json` with the analysis + variant + score for each.

**Architecture:**
- New Node script `scripts/batch-video.mjs` — orchestrator that handles one MP3 end-to-end (analyze → pick → render).
- New module `lib/variant-picker.mjs` — pure function `(analysis) => { variant, score, rationale }`. Reused by both the batch script and (later) any UI surface that wants to suggest a variant.
- Reuses `audio-analysis-v2.js` via `AudioContext.decodeAudioData` (Node 22 has it via WebAudio polyfill? → use a lightweight offline path: `ffmpeg → PCM → Float32Array` to avoid the Web Audio dep entirely; we only need raw samples for FFT).
- Reuses `scripts/render-full-song.mjs` capture logic (CDP screenshots + ffmpeg image2pipe) — refactor the per-render block into a function `renderVariant({ inputPath, variant, libraryPaths, outPath })` so both single and batch flows share it.
- Scoring table lives in `lib/variant-picker.mjs` (data), not the engine pages. Variants declare their affinity in `meta name="description"` already — the picker parses that.

**Tech Stack:** Node 22, `puppeteer`, `ffmpeg`/`ffprobe`, existing `audio-analysis-v2.js` for FFT + Krumhansl-Schmuckler (loaded into a Puppeteer page since it's `window.AudioAnalysisV2`-shaped, OR ported to a thin Node wrapper). The dev server (`npm run dev`) provides the variant pages.

**Hard constraint surfaced up front:** the existing `scripts/render-full-song.mjs` is **~25 min for a 3:20 song** because it uses CDP screenshots at ~5 fps capture. A 10-song batch = ~4 hours. Two mitigations built into the plan: (a) optional `--fps 12` flag for draft batches (cuts wall time by ~2x), (b) `--parallel N` flag to launch N Puppeteer browsers concurrently (each song gets its own browser). Even with `--parallel 4`, 10 songs ≈ 1 hour. That's the floor.

---

## Variant scoring table (the heart of the picker)

This lives in `lib/variant-picker.mjs` as a plain JS object. The picker computes per-variant scores and picks the highest. Ties broken by `music_video` (the default "drop any track" variant).

```js
// Per-variant weights over audio features. Higher = stronger fit.
// Features come from audio-analysis-v2.js: bpm (number 60-180),
// energy (mean onset rate per sec), chroma[12] (Float32 normalized),
// key+scale (string), duration.
const VARIANT_PROFILES = {
  music_video: { default: 1.0 },                          // catches everything
  spectrum:    { default: 0.9 },                          // audio-only, no footage needed
  film:        { bpm_lo: 1.5, scale_minor: 1.2 },          // slow + melancholic
  neon:        { bpm_hi: 1.5, chroma_synth: 1.3 },        // fast + electronic
  grid:        { bpm_mid: 1.3, beat_strength: 1.4 },       // beat-locked 90-140
  smoke:       { bpm_lo: 1.3, energy_lo: 1.2 },            // ambient / slow drift
  aurora:      { scale_major: 1.3, energy_lo: 1.1 },       // dreamy
  void:        { energy_lo: 1.4, scale_minor: 1.1 },       // minimal / dark
  glitch:      { beat_strength: 1.2, energy_hi: 1.1 },    // jagged
  chrome:      { bpm_mid: 1.2, scale_minor: 1.0 },         // contrast
  fractal:     { chroma_complexity: 1.3 },                  // dense keys
  collage:     { bpm_mid: 1.1 },                            // magazine grid
  pulse:       { energy_hi: 1.3, bpm_lo: 1.0 },             // bass-heavy
  watercolor:  { energy_lo: 1.3, scale_major: 1.0 },       // gentle
  eclipse:     { scale_minor: 1.2, energy_mid: 1.0 },       // dramatic
};
```

**Feature extraction pipeline (in `variant-picker.mjs`):**
- `bpm` → bucketed: `bpm_lo` if <90, `bpm_mid` if 90-140, `bpm_hi` if >140
- `key + scale` → `scale_major` or `scale_minor`
- `onsets.length / duration` → `energy_lo` <0.5/s, `energy_mid` 0.5-2/s, `energy_hi` >2/s
- `chroma` → dominant-class weights → `chroma_synth` if C/G/D/A (sharp keys), `chroma_complexity` if variance >0.05
- `beat_strength` → (bpm_confidence × onset density) — currently bpm analyzer returns confidence; we reuse it.

Each variant's score is the sum of weighted feature matches. `default` is the floor for any variant. Top score wins; ties → `music_video`.

---

## Phased execution

### Phase 1 — Pure variant picker (no Puppeteer, no render)

**Goal:** Pick a variant from audio analysis output, deterministically, with a verifiable score per input.

**Files:**
- Create: `lib/variant-picker.mjs` — scoring + pick logic
- Create: `scripts/test-variant-picker.mjs` — unit tests over a fixture set of analyses
- Create: `scripts/analyze-mp3.mjs` — thin CLI: `node scripts/analyze-mp3.mjs <input.mp3> > analysis.json` (uses Puppeteer to load a stub page with `audio-analysis-v2.js`, decodes the audio, calls `analyzeBuffer`, prints JSON). Puppeteer is the easiest way to reuse the existing analyzer without porting the FFT to Node.

**Tasks (bite-sized):**

1. Stub page `scripts/_analyze-stub.html` — 10 lines: `<script src="../audio-analysis-v2.js"></script>` + a function `window.__analyze = (file) => AudioAnalysisV2.analyzeBuffer(...)`.
2. `scripts/analyze-mp3.mjs` — launch Puppeteer, drop the MP3 via `fetch('/__audio_b64/<base64>')` or the local file server bridge, wait for `window.__analyze(file)`, return JSON.
3. `lib/variant-picker.mjs` — `pick(analysis)` returns `{ variant, score, allScores, rationale }`.
4. `scripts/test-variant-picker.mjs` — 8-10 fixture analyses (fast song, slow song, major key, minor key, ambient, beat-locked, etc.); assert the right variant wins for each.
5. Commit: `feat(batch-video): pure variant picker + analyze CLI + tests`.

**Verification:** `node scripts/test-variant-picker.mjs` exits 0, all assertions pass.

---

### Phase 2 — Refactor `scripts/render-full-song.mjs` to expose `renderVariant(opts)`

**Goal:** Same per-song render, callable from batch script.

**Files:**
- Modify: `scripts/render-full-song.mjs` — extract everything from the Puppeteer launch to the final MP4 into a function `renderVariant({ inputPath, variant, libraryPaths, outPath })`. Keep the CLI wrapper at the bottom for backwards compat (calls `renderVariant` with `variant: 'hallucination'`).

**Tasks:**

1. Read the current file, identify the boundaries (boot → render → transcode).
2. Lift the inner block into `export async function renderVariant(opts)`.
3. CLI shim: parse argv, call `renderVariant`.
4. Smoke-test: `node scripts/render-full-song.mjs <test.mp3> out/test.mp4` still produces a valid MP4 of correct duration. **Use a 5-second test clip, not the full song** — verify the refactor is byte-equivalent for short input.

**Verification:** 5-second smoke render produces correct MP4 duration, audio intact.

---

### Phase 3 — Batch orchestrator

**Goal:** `node scripts/batch-video.mjs --input <folder|file.mp3> --output <folder> [--parallel N] [--fps 12]`

**Files:**
- Create: `scripts/batch-video.mjs` — main entry. Globs inputs, for each: analyze → pick → renderVariant. Supports `--parallel N` (concurrent Puppeteer browsers) and `--fps 12` (draft mode).

**Tasks:**

1. CLI parsing (`--input`, `--output`, `--parallel` default 1, `--fps` default 24, `--variant <name>` to override picker).
2. Input discovery: if `--input` is a directory, glob `*.mp3` (and `*.wav`); if a file, single input.
3. Output dir setup; output filename = `<basename>.<variant>.mp4`.
4. Per-song pipeline: analyze → pick → renderVariant. Catch errors per-song and continue (don't fail the batch on one bad file).
5. Write `summary.json` to output dir: array of `{ input, variant, score, rationale, output, durationSec, status }`.
6. Parallel mode: launch N child Node processes via `child_process.spawn`, each running a single-song variant of the batch script with `--worker` flag. Avoids CDP browser contention.
7. Commit: `feat(batch-video): batch orchestrator with parallel render + summary JSON`.

**Verification:** `node scripts/batch-video.mjs --input <dir-with-3-mp3s> --output out/batch --parallel 2 --fps 12` produces 3 MP4s + summary.json. Each MP4 plays, audio intact, duration matches input. Summary JSON is valid.

---

### Phase 4 — Smoke test on a real folder

**Goal:** End-to-end verification with the user's actual song collection.

**Action:** I'll run it against a small folder (e.g. 3 MP3s from the user's Downloads), report wall-clock time, file sizes, summary contents.

**Verification:** All MP4s play. Pick rationale makes sense for each track (a fast electronic track → neon/grid; a slow ballad → film/smoke; a vocal track → music_video default).

---

## What I will NOT do without explicit approval

- **No UI surface** (no `/batch` web page, no UI in the engine). CLI only.
- **No edits to engine pages** — `versions/*.html` stay untouched. The picker reads their `meta description` text, doesn't modify them.
- **No new deps.** Use existing puppeteer, ffmpeg, ffprobe.
- **No automatic deployment.** Local CLI output only.
- **No pushing to git.** Each phase's commit stays on the current branch (`feat/asset-curator`), per AGENTS.md branch convention. You decide when to push.
- **No cloud rendering / no GPU server.** Everything runs locally with swiftshader.

## Trade-offs to flag

- **CDP-screenshot bottleneck is the floor.** Even with `--parallel 4`, a 10-song batch ≈ 1 hour at 24fps. The `--fps 12` draft mode halves that with noticeably worse smoothness; the engine page renders at 30fps anyway so the output is closer to 12-fps capture. Both are acceptable for batch-quality drafts.
- **The scoring table is hand-tuned.** It'll favor "obvious" matches and fall back to `music_video` for ambiguous tracks. We can tune by adjusting the per-variant weight objects in `lib/variant-picker.mjs` once we see real batch outputs.
- **`audio-analysis-v2.js` runs inside Puppeteer.** That's a deliberate choice — the analyzer is already a browser module. Cost is ~1s per song to spin up a Puppeteer page just to analyze; acceptable.
- **No `--library` flag in batch yet.** Phase 3 uses the curated library for every song. A later phase can add per-genre library pools.