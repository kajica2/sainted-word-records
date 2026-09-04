# score-evolution.md — emergent narrative visualizer (P3.7 long-horizon)

**Status:** Plan + infrastructure; Stage 1 starting.
**Branch:** `feat/score-evolution`
**Base:** `feat/music-video-hologram` (already has Phase A gradient + onboarding).
**Companion plan:** `.hermes/plans/music-video-hologram.md`.

---

## What this is

A score-aware visualizer that tells a story through emergent
narrative. The neon engine today reacts to audio frame-by-frame;
this work makes it **accumulate over time** so the visuals reflect
the song's journey, not just its instantaneous features.

Three things, stitched into one feature:

1. **Build over time** — running averages, drift walkers, exponential
   decay. The visual carries memory of the song.
2. **Tells a story** — emergent narrative through three continuous
   phases (opening / middle / climax) keyed off `state.age /
   expectedDuration`. No hardcoded section labels — pure time-based
   evolution.
3. **Reuse what we have** — the neon reactor math (`out.scale`,
   `out.hue`, etc.) stays the same. Only the **input signals** change:
   from raw `A.feat` to smoothed/accumulated/drifted values.

---

## What this is NOT

- **Not** beat-locked preset swaps. The hologram already crossfades
  anchors based on `weights[]`; that work belongs to Phase B of the
  music-video-hologram plan.
- **Not** 3D parallax / spatial audio / chromatic aberration sweep.
  Those were the wrong plan. Neon visuals stay 2D.
- **Not** ML-based structure detection. Pure DSP / statistical
  smoothing only.
- **Not** a new file system. All work in `versions/music_video.html`
  + one new file `client/narrative-state.client.js`.

---

## Architecture

```
   A.feat (raw audio)
        │
        ▼
   NarrativeState (accumulator)  ←────  user presses (idle reset)
        │
        │  state.tension       (running RMS avg, 4s window)
        │  state.peak         (max beat, slow decay)
        │  state.drift.x/y    (bounded random walk, tempo-scaled)
        │  state.warmth       (exponential centroid avg)
        │  state.age          (seconds since song load)
        │
        ▼
   applyR(layer, audio, narrative)  ←──  replaces direct A.feat reads
        │
        ▼
   SWR_RENDER.frame(stage, ctx, ...)
```

---

## Stage 1 — accumulator state (`client/narrative-state.client.js`)

Pure module. ~150 lines. Window-attached as `window.SWR_NARRATIVE`.

Tracks the 5 state variables above. No render code.

```js
window.SWR_NARRATIVE = {
  state: { tension, peak, drift: {x, y}, warmth, age },
  init(bpm, durationSec),    // seed drift walker with deterministic rng
  step(audioFeatures),       // call once per RAF with A.feat
  reset(),                    // call on song-end / new song
}
```

`step()` does:
- `tension = lerp(tension, A.feat.rms, 0.0625)`  (4s window half-life at 60fps)
- `peak` = `max(A.feat.beat, peak * 0.97)`  (1.5s half-life)
- `drift.x += (random - 0.5) * drift_step * tension`, mean-reverting
  toward 0 with strength proportional to `(1 - tension)` so quiet
  passages drift more
- `drift_step` scales with `bpm / 100` (faster BPM = faster drift)
- `warmth = lerp(warmth, A.feat.centroid, 0.02)`  (long-term color temp)
- `age += dt`

**Success criteria:**
- 6 unit tests in `scripts/check-narrative-unit.mjs`:
  - tension asymptotes to a fixed value when fed constant RMS
  - peak decays smoothly
  - drift walker stays bounded in [-1, +1] over 1000 steps
  - drift_step scales with bpm
  - warmth follows a smooth curve
  - reset() zeros all state

---

## Stage 2 — drift reactors (applyR rewiring)

Patch `versions/music_video.html`'s inline `applyR()`:

```js
function applyR(l) {
  const n = window.SWR_NARRATIVE.state;
  const a = l.asset, sens = A.params.sens;
  const out = { scale: l.baseScale, x:0, y:0, rot: l.hue*0.05,
                opacity: l.opacity, hue: l.hue,
                brightness: l.brightness, contrast: l.contrast };
  // Drift -> x/y
  out.x += n.drift.x * sens * 80;          // ±80px at sens=1
  out.y += n.drift.y * sens * 60;
  // Warmth -> hue (slow color drift over the song)
  out.hue += (n.warmth - 0.5) * 200 * sens;
  // Tension -> scale bias (louder = bigger)
  out.scale += n.tension * 0.4 * sens;
  // Peak -> brightness flash (1.5s decay)
  out.brightness = clamp(out.brightness + n.peak * 0.6, 0.1, 2.5);
  // Then: existing reactor maths from A.feat for fine detail
  for (const r of l.reactors) { ... unchanged ... }
  ...
}
```

**Success criteria:**
- Drop a 30s WAV, scrub to t=20s in the visualizer: drift.x is non-zero,
  warmth is past midpoint, peak is below 0.1.
- New smoke assertions in `scripts/check-mv-smoke.mjs`.

---

## Stage 3 — phase narrative

Three continuous phases as a function of `state.age / expectedDuration`:

```js
function phaseMultiplier(n, expectedDurationSec) {
  const t = clamp(n.age / expectedDurationSec, 0, 1);
  // Opening (0-25%): dampen motion, low contrast
  // Middle (25-75%): full strength
  // Climax (75-100%): amplify drift, pull back to center
  const openness = t < 0.25 ? 0.4 : (t < 0.75 ? 1.0 : 0.7);
  const driftAmp  = t < 0.25 ? 0.3 : (t < 0.75 ? 1.0 : 1.4);
  const pullback  = t < 0.75 ? 0.0 : (t - 0.75) * 4;  // 0..1 in last 25%
  return { openness, driftAmp, pullback };
}
```

The applyR patch multiplies drift by `driftAmp` and adds a small
center-pulling force proportional to `pullback`.

**Success criteria:**
- 1 unit test: phaseMultiplier(0) returns openness=0.4; at t=0.5
  returns 1.0; at t=0.9 returns driftAmp=1.4, pullback=0.6.

---

## Stage 4 — beat-locked micro-evolution

Every 4 beats, a small evolution fires:
- Slowly rotate the `HologramState.weights` map by one anchor
- Bump `state.peak` slightly even without a hard beat
- Bump drift amplitudes briefly for 2 beats, then back

This is the "evolves every 4 beats" requirement, implemented as smooth
parameter nudges.

**Success criteria:**
- 1 unit test: with a synthetic 120 BPM beat stream, after 8 beats the
  weights map has shifted by ≥1 anchor.

---

## Stage 5 — end-of-song release

When the song ends (`A.el.ended` or `state.tension < threshold for 8s`),
the visualizer releases:
- Drift amplitudes taper to 0 over 4s
- Tension decay accelerates (half-life drops to 0.5s)
- Brightness fades to baseline

Reset is automatic when a new song loads.

**Success criteria:**
- 1 unit test: after song-end signal, drift.x decreases to 0 within 4s.

---

## Stage 6 — integration smoke + polish

`scripts/check-score-evolution-smoke.mjs`:
- Drop a synthetic 30s song with deliberate dynamics (intro quiet,
  middle loud, climax peak)
- Verify `state.tension`, `state.warmth`, `state.drift` evolve
  smoothly across the timeline
- Verify phaseMultiplier returns correct values at t=0, 0.3, 0.6, 0.9

Plus a manual smoke: drop a real track, watch the visual breathe
across the song.

---

## File plan

**New (2):**
- `client/narrative-state.client.js` (~150 lines)
- `scripts/check-narrative-unit.mjs` (~120 lines, 8 unit tests)

**Modified (1):**
- `versions/music_video.html`:
  - Load `client/narrative-state.client.js` in `<head>`
  - Add `<script>` block in the inline IIFE that initializes
    `window.SWR_NARRATIVE` and steps it per RAF
  - Patch `applyR()` to read from `narrative.state`
  - Reset `narrative` on song-load and on song-end
  - Add `state` and `phaseMultiplier` references

**New tests:**
- `scripts/check-score-evolution-smoke.mjs` (~150 lines, 6 Puppeteer assertions)

---

## Total effort

- Stage 1: 1 day (pure module)
- Stage 2: 1 day (applyR rewiring + smoke)
- Stage 3: 0.5 day
- Stage 4: 0.5 day
- Stage 5: 0.5 day
- Stage 6: 0.5 day

Total: ~4 days.

---

## Risks

1. **Drift tuning is subjective.** Constants will need eyes. Ship
   reasonable defaults; flag in commit message.
2. **The drift walker's seed.** If `Math.random()` is used directly,
   every page load produces different drift. Solution: seed with
   `bpm * durationSec` for determinism. Same song → same drift.
3. **applyR has perf budget.** It's called 6 layers × 4 reactors per
   RAF = 24 calls per frame. Adding 4 more arithmetic ops is
   negligible (sub-µs).

---

## Out of scope

- MusicXML score import
- MIDI sync
- Custom shaders / WebGL
- Pre-computed analysis (server-side)
- Beat-locked preset swaps
