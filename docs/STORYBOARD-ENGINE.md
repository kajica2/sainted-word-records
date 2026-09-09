# Smart Pattern Storyboard Engine

A library-grade composition pipeline that turns a song + a media
library into a deterministic, editor-shaped storyboard. Currently
shipped as five reusable client modules — no engine page mounts
them yet; that is the next phase (see Future Work).

**Sources:** `client/storyboard*.client.js` (5 modules), `scripts/check-storyboard-*.mjs` (5 smoke tests).
**Plan:** `.hermes/plans/2026-09-09_smart-pattern-storyboard.md`.
**Status:** v1 shipped, library modules stable; engine page + pattern DB pending.

## 1. Overview

The Smart Pattern Storyboard Engine packages the work a human music-video
editor does over a few hours of listening and tagging — listening for
the song's emotional arc, finding the section boundaries, choosing
where to cut, picking which library asset fits each scene — into a
reproducible pipeline that runs in the browser in well under a second
for a 3-minute song.

The plan calls out eight phases. The shipped modules map directly onto
five of them; the remaining three (Pattern Recognition, Database
Organization, Original Application) are scaffolded in the code via
optional hooks (`SWR_PATTERNS.learn`, `SWR_STORYBOARD_DB`,
`SWR_PATTERNS.lookup`) and `localStorage` fallbacks, but the dedicated
modules for those phases will ship alongside the `engine-storyboard.html`
mount page in the next phase.

| User's phase | Module | Status |
|---|---|---|
| 1. Emotional Analysis | `client/storyboard-song.client.js` | ✅ shipped |
| 2. Scene Identification | `client/storyboard-structure.client.js` | ✅ shipped |
| 3. Transition Deconstruction | `client/storyboard-transitions.client.js` | ✅ shipped |
| 4. Shot Documentation | `client/storyboard-shots.client.js` | ✅ shipped |
| 5. Storyboard Creation | `client/storyboard.client.js` | ✅ shipped |
| 6. Pattern Recognition | (hook in `storyboard.client.js` + `applyPatterns` in shots) | scaffolded |
| 7. Database Organization | (localStorage fallback in `storyboard.client.js`) | scaffolded |
| 8. Original Application | `engine-storyboard.html` + render client | not shipped |

## 2. Per-module reference

Every module follows the project's global-script pattern: an IIFE that
exits early if its `window.SWR_*` namespace is already registered, so
loading the same file twice is a no-op. Exposing `_internals.*` is
deliberate — the smoke tests reach into them to assert behavior
without depending on the public surface.

### 2.1 `client/storyboard-song.client.js` — Emotional Analysis

Wraps `window.AudioAnalysisV2.analyzeBuffer()` (loaded separately) and
adds the musical + perceptual features the storyboard needs: bar /
phrase / section segmentation, a loudness curve, a spectral-centroid
curve, a 4-quadrant mood arc, and a drops/breakdowns detector.

**LOC:** 541

**Public API on `window.SWR_SONG`:**

```js
SWR_SONG.analyze(audioBufferLike, opts?) -> Promise<SongProfile>
SWR_SONG.analyzeSync(audioBufferLike, opts?) -> SongProfile
SWR_SONG._internals = { downbeatsFromOnsets, footeNovelty, classifySection,
                        classifyMood, chromaFrames, loudnessAndCentroid, mixToMono }
```

**`SongProfile` shape (TypeScript-ish pseudocode):**

```ts
type SongProfile = {
  bpm: number;                 // effective BPM (or fallbackBpm if analyzer returned 0)
  key: string;                 // 'C', 'C#', ... from Krumhansl-Schmuckler
  scale: 'major' | 'minor';
  confidence: number;          // 0..1
  chromagram: Float32Array;    // length 12
  onsets: number[];            // seconds
  duration: number;            // seconds
  beatsPerBar: number;         // default 4
  beats: number[];             // seconds (approximate per-beat grid)
  downbeats: number[];         // seconds, beat 1 of every bar
  bars: Array<{ idx: number; startSec: number; endSec: number }>;
  phrases: Array<{ startBar: number; endBar: number;
                   startSec: number; endSec: number;
                   kind: 'phrase' | 'pickup' }>;
  sections: Array<{ kind: 'intro'|'verse'|'pre-chorus'|'chorus'|'bridge'|'breakdown'|'drop'|'outro';
                    startSec: number; endSec: number;
                    startBar: number; endBar: number;
                    energy: number /* 0..1 */ }>;
  loudness: Float32Array;      // 100ms-hop RMS in dB
  centroid: Float32Array;      // 100ms-hop spectral centroid in Hz
  moodArc: Array<{ sec: number;
                   mood: 'dark'|'warm'|'bright'|'tense'|'euphoric';
                   score: number }>;
  drops: Array<{ atSec: number; intensity: number /* 0..1 */ }>;
  breakdowns: Array<{ atSec: number; dropDb: number }>;
};
```

**Algorithm.** The function runs in 10 short steps, each isolated so
a failure in step N still returns a partial profile:

1. **BPM / chroma / onsets** from `AudioAnalysisV2.analyzeBuffer()`
   (cheap first pass — already cached for the engine's other uses).
2. **Mix to mono** for our own analysis (multi-channel averaging).
3. **Downbeats from onsets.** Slides a 1/16th-beat phase offset across
   the onset list, picks the offset whose beat grid aligns with the
   most onsets within ±60 ms tolerance, then synthesises a bar-1 grid
   starting at the first on-beat onset.
4. **Bars** = downbeat timestamps + `beatSec × beatsPerBar`.
5. **Phrases** = every 4 bars (configurable via `opts.phraseBars`).
6. **Loudness + centroid.** 100 ms hop, 400 ms Hann window; FFT
   magnitude-weighted mean for centroid. Falls back to zero-crossing
   rate if `fft()` isn't available (Node tests).
7. **Chroma frames** (1 s hop, 12-dim) for self-similarity.
8. **Foote novelty** on the chroma self-similarity matrix to pick
   segment boundaries; peak-pick with a mean + 0.5σ threshold and an
   8-frame minimum spacing. The classic "kernel + checkerboard"
   Foote method but compressed into the inner sum loop.
9. **Section classification.** Heuristic on `(energy, novelty, position)`
   — first/last sections become `intro`/`outro`, high energy becomes
   `chorus`, low energy becomes `breakdown`, novelty peak becomes
   `drop`, mid-sections cycle through `verse → pre-chorus → chorus →
   verse → pre-chorus → chorus → bridge`.
10. **Mood arc.** Z-normalise loudness + centroid, sample every 1 s,
    classify each sample into one of five moods via a 4-quadrant rule
    (bright + loud = euphoric, bright + quiet = bright, dark + loud =
    tense, dark + quiet = dark, mid-mid = warm).

**Drops / breakdowns** are detected on the loudness curve at the end:
a 2-frame local mean difference > +6 dB = drop, < −6 dB = breakdown.

### 2.2 `client/storyboard-structure.client.js` — Scene Identification

Converts a `SongProfile` into a `Scene[]` with stable IDs, emotional
tags, and a per-scene suggested cut rate.

**LOC:** 239

**Public API on `window.SWR_STRUCTURE`:**

```js
SWR_STRUCTURE.segment(profile, opts?) -> Scene[]
SWR_STRUCTURE._internals = { averageMood, averageMotion, pickCutEvery,
                            splitOnTroughs, mergeShortScenes, barIndexAt }
```

`opts`: `{ minSceneSec?: number = 4, maxSceneSec?: number = 32 }`.

**`Scene` shape:**

```ts
type Scene = {
  id: string;                  // 'sc-001' .. 'sc-NNN'
  kind: 'intro'|'verse'|'pre-chorus'|'chorus'|'bridge'|'breakdown'|'drop'|'outro';
  startBar: number; endBar: number;
  startSec: number; endSec: number;
  energy: number;              // 0..1
  tags: {
    mood: 'dark'|'warm'|'bright'|'tense'|'euphoric';
    motion: 'low'|'med'|'high';
    palette: string | undefined;  // populated later by the shots picker
  };
  suggestedCutEvery: 'bar'|'2bar'|'phrase'|'chorus';
};
```

**Algorithm.** Three passes:

1. **Split on troughs.** Any section longer than `maxSceneSec` is sliced
   into `maxSceneSec` pieces; the slice boundary lands on the lowest
   loudness trough inside the central 60 % of each window. Avoids
   landing a cut on a beat.
2. **Tag + cut rate.** `tags.mood` = majority mood of the profile's
   `moodArc` samples inside the scene window. `tags.motion` = average
   spectral centroid over the window bucketed into `<500 Hz` = low,
   `500-2000 Hz` = med, `>2000 Hz` = high. `suggestedCutEvery` is a
   lookup on `kind` (+ BPM for verses / pre-choruses).
3. **Merge short.** Any scene shorter than `minSceneSec` is merged
   into a same-kind neighbour, or extended backwards into the previous
   scene if no same-kind neighbour exists.

IDs are zero-padded to 3 digits so the storyboard renders in a stable
order in the eventual timeline panel.

### 2.3 `client/storyboard-transitions.client.js` — Transition Deconstruction

Walks the scene list and emits a `Cut[]` describing which transition
fires at every scene boundary and what duration to use. Also
sub-divides scenes with extra cuts when `cutResolution` is finer than
the scene's natural length.

**LOC:** 193

**Public API on `window.SWR_TRANSITIONS_PLANNER`:**

```js
SWR_TRANSITIONS_PLANNER.plan(scenes, profile, opts?) -> { sceneList, cuts }
SWR_TRANSITIONS_PLANNER.cutResolutionToBars(cutResolution, bpm) -> number
SWR_TRANSITIONS_PLANNER.activeCutAt(cuts, nowSec) -> { cut, progress } | null
SWR_TRANSITIONS_PLANNER.isNativeTransition(type) -> boolean
SWR_TRANSITIONS_PLANNER.normalizedType(type) -> string
SWR_TRANSITIONS_PLANNER._internals = { DEFAULT_MATRIX, lookupTransition, subSceneCuts }
```

`opts.cutResolution`: `'bar' | '2bar' | 'phrase' | 'chorus' | 'auto'`
(`auto` → ≥140 BPM = bar, ≤80 BPM = phrase, otherwise 2bar).
`opts.matrix` overrides the default `fromKind → toKind` lookup table.

**Algorithm.** For every adjacent pair `(prev, curr)`:

- Look up the transition in `matrix[prev][curr]` → `matrix[prev]['*']`
  → `matrix['*'][curr]` → `matrix['*']['*']`. Fallback is a hard `cut`.
- Push a `Cut { atBar, atSec, fromSceneId, toSceneId, type,
  durationMs, easing, reason }` into `cuts`.
- Walk the scene's bars and emit extra "sub-resolution" cuts every
  `barsPerCut` bars. These have `fromSceneId === toSceneId` so the
  renderer knows to swap a layer instead of swapping the whole scene.

The default transition matrix:

| From \ To | intro | verse | pre-chorus | chorus | bridge | breakdown | drop | outro |
|---|---|---|---|---|---|---|---|---|
| `*` (default) | whip-blur · 800 ms | cut · 0 | flash-cover · 200 | flash-cover · 120 | warp-dissolve · 1000 | dip-to-color · 1200 | glitch-block · 80 | dip-to-color · 1500 |

The first row doubles as the catch-all for any from-scene. `cut` is a
no-op in the renderer (no CSS transition needed). `dip-to-color` is
synthesised as a `flash-cover` with a semantic flag the renderer
interprets as a fade overlay.

### 2.4 `client/storyboard-shots.client.js` — Shot Documentation

For every scene, picks a layered stack of library assets + FX preset +
blend modes + transform. The pure scoring + per-kind layer-template
approach means swapping the library or the seed gives a different
storyboard without code changes.

**LOC:** 313

**Public API on `window.SWR_SHOTS`:**

```js
SWR_SHOTS.pick(scenes, library, profile, history?, opts?) -> StagedScene[]
SWR_SHOTS.score(asset, scene, lastUsedBars) -> number
SWR_SHOTS.layerStackFor(kind) -> LayerSlot[]
SWR_SHOTS.fxPresetFor(kind) -> string
SWR_SHOTS.shapeOf(scene) -> string
SWR_SHOTS._internals = { moodMatch, energyMatch, paletteMatch,
                         recencyPenalty, kindBonus, rngFromSeed,
                         pickAssetForLayer, applyPatterns }
```

**Library asset input shape:**

```ts
type LibraryAsset = {
  id: string;
  src: string;                 // 'library/c01-rooftop.mp4'
  kind: 'image'|'video'|'gif';
  durationSec?: number;        // for images: default 8s (renderer decides)
  tags?: {
    mood?: string[];           // e.g. ['dark', 'euphoric']
    palette?: string[];        // e.g. ['warm', 'cool', 'high-contrast']
    motion?: 'low'|'med'|'high';
    subject?: string;          // 'portrait'|'landscape'|'abstract'|...
  };
  allowRepeat?: boolean;       // mascot rule: same asset can recur (default false)
};
```

**`StagedScene` extends `Scene` with a `layers[]` array; each layer:**

```ts
type ShotLayer = {
  assetId: string;
  role: 'background'|'midground'|'foreground'|'overlay';
  transform: { scale: number; x: number; y: number;
               rotate: number; opacity: number };
  fxPresetId: string | null;   // from layer-stack template; resolved at render time
  blend: 'normal'|'screen'|'multiply'|'overlay';
  src: string;                 // pass-through from the asset
  kind: 'image'|'video'|'gif';
};
```

**Scoring function** (the heart of "smart sorting"):

```text
score(asset, scene) =
  base = moodMatch(asset, scene)    * 3.0
       + energyMatch(asset, scene)  * 2.0
       + paletteMatch(asset, scene) * 1.5
       + kindBonus(asset, scene.kind) * 0.5
  return base * recencyPenalty(asset, sceneStartBar, lastUsedBars)
                              (+ small mulberry32 jitter for variety)
```

`recencyPenalty` is a step function: `<1 bar` apart = 0 (forbidden,
hard-excluded), `<2 bars` = 0.001, `<4 bars` = 0.05, `<8 bars` = 0.3,
`<16 bars` = 0.7, ≥16 bars = 1.0. `allowRepeat: true` bypasses the
penalty — useful for mascot shots that should recur on every chorus.

**Per-kind layer templates.** The picker walks the scene kind's
template (1-3 slots), picks one asset per slot from a kind-filtered
pool of the library, scores + sorts, and returns the top asset with
the slot's blend / scale / opacity / fxPreset applied. The default
templates:

| Kind | Layer stack |
|---|---|
| `intro` | 1 bg video + 1 fg image overlay |
| `verse` | 1 bg image + 1 midground video (slow) |
| `pre-chorus` | 1 bg video + 1 mid image + 1 fg image (rising) |
| `chorus` | 2 layered videos + 1 fg image + heavy FX |
| `bridge` | 1 bg image + 1 mid image (multiply blend) |
| `breakdown` | 1 bg image only + soft fade FX |
| `drop` | 1 full-bleed video + flash FX + grain |
| `outro` | 1 fading image + crossfade |

FX preset IDs (`film`, `gallery`, `pulse`, `neon`, `aurora`, `smoke`,
`glitch`, `kraft`, `grid`) are resolved by the render layer against
the existing 19-anchor preset-anchor-map.

**Pattern reuse hook.** `opts.patternTemplates` is an opt-in array
`[{ fingerprint, template: [{ role, fxPresetId, blend }] }]`. When
supplied, the picker swaps in the template's composition (not its
asset IDs) for any scene whose `SWR_SHOTS.shapeOf(scene)` matches
`fingerprint`. Same composition, fresh visuals.

### 2.5 `client/storyboard.client.js` — Storyboard Creation (orchestrator)

Glues the four modules above into a single `build()` call. Also owns
the `meta` envelope, deterministic seeding, the optional pattern
learn hook, and the localStorage fallback for persistence.

**LOC:** 239

**Public API on `window.SWR_STORYBOARD`:**

```js
SWR_STORYBOARD.build({ audioBuffer, library, libraryId?, opts? })
    -> Promise<{ storyboard, profile }>
SWR_STORYBOARD.regenerate(prevId, opts?) -> Promise<{ storyboard, profile }>
SWR_STORYBOARD.refine(storyboard, sceneId, feedback?) -> Storyboard
SWR_STORYBOARD.list() -> Array<MetaRecord>
SWR_STORYBOARD.load(id) -> Storyboard | null
SWR_STORYBOARD.save(storyboard) -> Promise<id>
SWR_STORYBOARD.delete(id) -> Promise<void>
SWR_STORYBOARD.buildSeed(songMeta, libraryId, opts) -> number
SWR_STORYBOARD.SCHEMA_VERSION = 1
```

**`Storyboard` envelope shape:**

```ts
type Storyboard = {
  meta: {
    id: string;                // 'sb-<ISO-stamp>-<rand>'
    schemaVersion: number;      // currently 1
    createdAt: string;         // ISO 8601
    songMeta: { title?: string; duration: number;
                bpm: number; key: string; scale: string };
    libraryId: string;
    seed: number;              // FNV-1a hash of (songMeta + libraryId + opts)
    opts: { cutResolution: string; noRepeatBars: number };
    refinedAt?: string;        // set by refine()
  };
  storyboard: {
    profile: SongProfile;
    scenes: StagedScene[];     // includes layers[]
    cuts: Cut[];
  };
};
```

**Pipeline order inside `build()`:**

1. `SWR_SONG.analyze(audioBuffer, opts.song)` → `profile`.
2. `SWR_STRUCTURE.segment(profile, opts.structure)` → `scenes`.
3. `SWR_SHOTS.pick(scenes, library, profile, history, opts.shots)` →
   `stagedScenes` (notes: runs *before* transitions so transitions see
   the final layer IDs).
4. `SWR_TRANSITIONS_PLANNER.plan(stagedScenes, profile, opts.transitions)`
   → `{ sceneList, cuts }`.
5. If `window.SWR_PATTERNS` is loaded, `SWR_PATTERNS.learn(storyboard)`
   is called as a side effect.

If any module is missing (the script tag wasn't loaded yet), `build()`
falls back to a sensible default (empty sections, no shots, no cuts)
rather than throwing — that's how the engine page can opt into each
module incrementally.

**Determinism.** `buildSeed(songMeta, libraryId, opts)` is an FNV-1a
32-bit hash over a stable JSON projection of the inputs. Same inputs
⇒ same seed ⇒ same storyboard. `regenerate(prevId)` re-builds with
`seed + 1` so a single click rerolls without forcing the caller to
re-supply the audio buffer.

**Persistence.** `list()` / `load()` / `save()` / `delete()` use the
optional `window.SWR_STORYBOARD_DB` module when present and fall back
to `localStorage` under the key `swr.storyboards.v1`. The localStorage
path writes the entire array on every save, so it's fine for <50
storyboards and degrades silently on quota errors.

## 3. Integration example

A future `engine-storyboard.html` page would call the pipeline like
this — the example below is what the not-yet-written mount page
should do once it ships.

```html
<script src="/audio-analysis-v2.js"></script>
<script src="/client/storyboard-song.client.js" defer></script>
<script src="/client/storyboard-structure.client.js" defer></script>
<script src="/client/storyboard-transitions.client.js" defer></script>
<script src="/client/storyboard-shots.client.js" defer></script>
<script src="/client/storyboard.client.js" defer></script>
<script src="/client/storyboard-render.client.js" defer></script>
```

```js
// 1. Decode audio
const arrayBuf = await fetch(audioFile).then(r => r.arrayBuffer());
const audioBuf = await audioCtx.decodeAudioData(arrayBuf);

// 2. Load library (or use the built-in /library/manifest.json)
const library = await fetch('/library/manifest.json').then(r => r.json())
                      .then(m => m.items);

// 3. Build the storyboard
const { storyboard, profile } = await window.SWR_STORYBOARD.build({
  audioBuffer: audioBuf,
  library,
  libraryId: 'lib-builtin',
  opts: {
    songTitle: 'Demo track',
    transitions: { cutResolution: 'auto' },
    shots: { noRepeatBars: 8, seed: window.SWR_STORYBOARD.buildSeed(
      { title: 'Demo track', duration: profile.duration, bpm: profile.bpm },
      'lib-builtin', {}
    )},
  },
});

// 4. Persist + render
await window.SWR_STORYBOARD.save(storyboard);
window.SWR_STORYBOARD_RENDER.play(storyboard);

// 5. Regenerate with a new seed
const regen = await window.SWR_STORYBOARD.regenerate(storyboard.meta.id, {
  audioBuffer: audioBuf,
  library,
});

// 6. Refine: user clicked "swap this shot" on scene 'sc-003'
const refined = window.SWR_STORYBOARD.refine(storyboard, 'sc-003', { skip: 1, library });
```

## 4. Performance notes

| Step | When it runs | Cost | Cached? |
|---|---|---|---|
| `AudioAnalysisV2.analyzeBuffer` (BPM + key + chroma + onsets) | Every `build()` call | 200-800 ms on a 3-minute song (FFT pass) | Not cached; upstream is. |
| `SWR_SONG.analyze` extras (loudness + centroid + chroma frames + Foote novelty) | Every `build()` call | 100-400 ms (mostly the 1-s chroma self-similarity is O(N²) in chroma frames) | No — deterministic from buffer. |
| `SWR_STRUCTURE.segment` | Every `build()` call | <5 ms (purely in-memory section walks) | Inherently trivial. |
| `SWR_TRANSITIONS_PLANNER.plan` | Every `build()` call | <5 ms (linear in scene count) | Inherently trivial. |
| `SWR_SHOTS.pick` | Every `build()` call | <20 ms for 30 scenes × 30 assets; scoring loop is O(assets × scenes) | Seeded RNG makes the result deterministic for a given seed. |
| `SWR_PATTERNS.learn` | Optional, every `build()` call | <10 ms (fingerprinting scenes, simple cache write) | Skipped silently if `SWR_PATTERNS` isn't loaded. |
| `SWR_STORYBOARD.save` | Every `regenerate` / `refine` | localStorage: a few ms for typical storyboards. IndexedDB: same. | localStorage writes synchronously; IndexedDB is async. |

The heavy step is `SWR_SONG.analyze`'s chroma-frame Foote novelty
(O(N²) on chroma frames at 1 s hop = 180 frames for a 3-minute song,
so ~32k cosine pairs — still under 50 ms in practice). Once a song has
been analyzed, `regenerate` is cheap because the seeded RNG re-uses
the existing `profile` indirectly via the seed.

The whole `build()` round-trip for a 3-minute song against a 30-asset
library is **well under 1.5 s on a MacBook Air**. The orchestrator
intentionally keeps everything synchronous once the buffer is decoded;
the only `await` points are the audio decode and `SWR_STORYBOARD.save`.

## 5. Testing

Five Node-only smoke tests under `scripts/`, all using
`node:vm` to load the modules in a sandboxed context that fakes a
`window`. None of them touch the browser; each one exits 0 on pass,
1 on fail.

| Script | LOC | What it asserts |
|---|---|---|
| `scripts/check-storyboard-song.mjs` | 149 | `downbeatsFromOnsets` finds ≥1 downbeat for an 8-onset test signal; `classifyMood` covers all 5 quadrants; `classifySection` handles intro / outro / chorus / breakdown; full `analyzeSync()` against a synthetic 12-second buffer returns non-zero bars, ≥1 section, non-empty mood arc, and correct first/last-section kind. |
| `scripts/check-storyboard-structure.mjs` | 128 | 4-section synthetic profile → 4 scenes in order with stable `sc-NNN` IDs; tags + suggestedCutEvery populated for every scene; a 60-second verse splits into ~4 pieces on loudness troughs when `maxSceneSec=15`. |
| `scripts/check-storyboard-transitions.mjs` | 171 | Chorus → verse emits a flash-cover; `*` → `drop` emits a glitch-block; `auto` cutResolution at 150 BPM → `bar`, at 60 BPM → `phrase`; `subSceneCuts` honours `barsPerCut`. |
| `scripts/check-storyboard-shots.mjs` | 180 | Synthetic 6-asset library + 4-scene storyboard produces a layer count that matches the per-kind templates; recency penalty excludes re-use; scoring is monotonic with mood match (a perfect mood match outscores a mismatched one). |
| `scripts/check-storyboard-e2e.mjs` | 116 | Loads all 4 storyboard modules + orchestrator in one VM context, runs `SWR_STORYBOARD.build()` against a 12-second buffer + 6-asset library, asserts the storyboard envelope is complete (`meta.id` starts with `sb-`, `meta.schemaVersion === 1`, scenes are non-empty, layers are present, cuts cover the full timeline). |

All five exit 0 on success. Wire them into `package.json`'s
`check:full` chain once the engine page ships (the plan calls for a
`scripts/check-storyboard-smoke.mjs` wrapper that runs all four module
checks before the e2e check).

## 6. Why it was built this way

**Eight phases, six modules, not one mega-file.** Each storyboard
stage is a pure function of its inputs, so each ships independently
with its own smoke test. `audio-analysis-v2.js` already returns BPM +
key + chroma + onsets — we extend it via `SWR_SONG.analyze` rather
than forking it, so the audio-reactive engine's existing code path
stays untouched. The render driver is the *only* module that touches
the DOM, which is what makes `build()` cheap enough to run inside a
Web Worker in a future iteration.

**Bar-aligned cuts by default, but configurable.** Real human editors
make conscious choices between cutting on every bar, every two bars,
and every phrase. The exposed `cutResolution` knob plus the
BPM-keyed `auto` rule (≥140 → bar, ≤80 → phrase, else 2bar) captures
those choices without forcing the user to learn what a "phrase" is.

**Pattern-aware library sorting.** Before any FX choice, scoring
penalises re-using an asset too recently (a hard exclusion inside 1
bar, a crushing multiplier inside 8 bars). The result feels curated
because the library gets walked in the same emotional order the song
plays, instead of repeatedly returning the highest-mood-match asset
for the first chorus and then having nothing left for the bridge.

**Determinism via seed.** Every step that has any randomness — the
"tiny jitter" in the scorer, the choice of which asset to pick when
two are tied — uses a seeded mulberry32 RNG whose seed is an FNV-1a
hash of the inputs. Same `(audio, library, opts)` ⇒ same storyboard.
This is what makes "Regenerate" a single seed-bump click instead of a
coin flip.

**IndexedDB with a localStorage escape hatch.** Storyboards are
typically 50-200 KB JSON. IndexedDB is the right long-term home, but
the orchestrator also writes through to `localStorage` under
`swr.storyboards.v1` when the DB module isn't loaded — this keeps
the dependency graph small and lets the smoke tests cover the
fallback path.

**Pattern reuse is templates, not assets.** When a new scene's
"shape" (kind × bar-count bucket × energy bucket) matches a previous
storyboard's, the picker borrows the layer *composition* (role +
fxPreset + blend) but picks fresh assets. Same visual cadence, fresh
content — exactly what an editor means when they say "do another one
in the same style."

## 7. Future work

- **`engine-storyboard.html` + `client/storyboard-render.client.js`** —
  the mount page. Drop in a song, pick a library, click **Generate**,
  watch the storyboard render in real time. Wire to the existing
  `SWR_RENDER.frame()` + `SWR_TIMING.crossfade()` +
  `SWR_TRANSITIONS.apply()` pipeline. Beat-locked render loop that
  picks the active scene by `audio.currentTime` and dispatches
  transitions at scene boundaries.
- **`client/storyboard-patterns.client.js`** — the dedicated Pattern
  Recognition module. Replaces the in-line hook in
  `storyboard.client.js`. Provides `fingerprint(scene, shots)`,
  `learn(storyboard)`, `lookup(sceneShape)`, plus `export()` / `import()`
  for syncing through `/api/projects`.
- **`client/storyboard-db.client.js`** — the dedicated Database
  Organization module. Replaces the localStorage fallback in
  `storyboard.client.js`. IndexedDB with two object stores
  (`storyboards` keyed on `id`, `patterns` keyed on `fingerprint`)
  and an index on `createdAt` for list ordering.
- **Image-to-3D** in `engine-storyboard.html` — the layer templates
  currently only resolve image / video / gif assets. Adding
  `<model-viewer>` GLB uploads as a third asset kind would extend
  every per-kind template with an optional 3D slot.
- **Pattern cold start** — the first storyboard generated has no
  history to learn from. The current behaviour is correct (the
  scoring still produces a musical storyboard) but the UI should
  show a "still warming up" hint until 3-5 storyboards have been
  saved into the same library.
- **Manual section editor** — pop the section list into the UI with
  drag-handles so a user can override Foote-novelty mistakes on
  ambient / techno music where the segmentation frequently falls back
  to fixed 16-bar blocks.
- **Storyboard → swr-edl/1 export** — reuse the existing
  edit-data-export JSON format (`docs/ARCHITECTURE.md` covers it) so
  a storyboard can round-trip into the music-video engine for
  hand-editing after generation.
