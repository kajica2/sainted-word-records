# Automix + Fade Audit — 2026-09-09

> 2-agent parallel study of `/Users/kaidejuricmasscmbook/Downloads/sainted-word-records` (branch: `main`).
> Goal: make RE-MAP non-abrupt + add fade-in/out at every audio transition point.

This report consolidates two slice audits:
1. **Automix audit** — `Layers.autoMap()`, scoring, modes, smoothness. Report at `.hermes/plans/automix-audit.md` (27.6 KB).
2. **Fade audit** — every audio transition point (RE-MAP, song load, song end, play, layer add/remove, promoteToSong). Report at `docs/fade-audit.md` (16.2 KB).

**No code touched.** The fix list below is a proposal; apply nothing until approved.

---

## TL;DR — top 5 things to fix

1. **`Layers.autoMap()` hard-wipes `this.list = []` in one frame.** This is the literal "abrupt ending or start" the user is asking about. The fix template already exists: `versions/music_video_mtv.html:961-992` has a `Layers.reset({fadeMs})` function using `SWR_TIMING.fadeOut`. Reuse the template, apply it to engine-core.client.js's `autoMap()`.

2. **Audio gain is never ramped.** `Audio.gain.value = 1.0` is set once and never touched. A 30-line `Audio.fadeTo(target, ms)` helper using `gain.linearRampToValueAtTime` (with `cancelScheduledValues` first) fixes song load, play, pause, song-end, and promoteToSong in one shot.

3. **The MediaRecorder audio branch bypasses `Audio.gain`.** Wired `analyser → dest` at L2986-2990, **bypassing** the gain node. A gain-only fade would fix the speakers but leave the exported file clipping. **Re-route through `Audio.gain`** so the recorder picks up fades too.

4. **RE-MAP isn't wrapped in `withHistory()`** but the genops `remap()` is. Inconsistent: bad RE-MAP clicks are unrecoverable. Wire both paths through the same undo scaffold.

5. **Latent bug uncovered**: `Audio.loadFile` attaches a new `ended` listener (L204) but never removes the old one. Loading a new song while the old one is mid-playback means the **old song's ended event can fire onSongEnd → pause the new song's playback** at the wrong moment. Fix during the gain work.

---

## Full prioritized fix list

### Critical (blocks user's "no abrupt" goal)

| # | Where | Issue | Source |
|---|---|---|---|
| C1 | `engine-core.client.js:1444` (`Layers.autoMap`) | `this.list = []` hard-wipes all 6 layers in one frame. RE-MAP is the most abrupt UX in the engine. | Automix |
| C2 | `engine-core.client.js:2986-2990` (MediaRecorder audio branch) | Recorder wired `analyser → dest`, **bypassing `Audio.gain`**. A gain-only fade fixes the speakers but leaves exported files clipped. Re-route through `Audio.gain` so recorder captures the fade envelope. | Fade |
| C3 | `engine-core.client.js:204` (`Audio.loadFile`) | Each call attaches a new `ended` listener but never removes the old. Old song's `ended` can fire `onSongEnd → pause` after a new song loaded. Latent bug — likely to fire exactly when a fade-out is in progress. | Fade |

### High (next 1–2 hours)

| # | Where | Issue | Source |
|---|---|---|---|
| H1 | All audio transitions | No `Audio.fadeTo(target, ms)` helper. Song load (#2), song end (#3), play/pause (#4), promoteToSong (#7) all snap. | Fade |
| H2 | `Layers.autoMap` | RE-MAP not wrapped in `withHistory('remap', ...)` while the genops `remap()` already is. Inconsistent undo. | Automix |
| H3 | `Layers.autoMap` scoring | Scoring ignores `Audio.feat.bpm / sub / centroid / key`. A 90 BPM drum track and a 130 BPM house track get the same mapping. Use BPM to weight `mode = (bpm > 100) ? 'chaos' : 'ambient'`. Use sub to weight `brightness` of low-frequency layers. | Automix |
| H4 | `Layers.autoMap` | RE-MAP can't target one layer. No "remap only the worst-scoring layer" or "remap layer N" mode. Add `autoMapLayer(index)` and wire to a keyboard shortcut. | Automix |

### Medium (improves UX further)

| # | Where | Issue | Source |
|---|---|---|---|
| M1 | `Layers.autoMap` | No freshness/cooldown for repeated RE-MAP presses. Two clicks in a row pick the same top-3. Track last-used asset IDs in a sliding window. | Automix |
| M2 | `pickReactors` (L1483+) | Uses `i % 8` — deterministic round-robin, ignores audio. Should pick based on `Audio.feat.{bass,mid,treble,beat}` like `pickBlend` already does for `mode`. | Automix |
| M3 | `pickBlend` (L1469) | No adjacency-complement rule. Hard-cut blends (`difference`, `overlay`) get assigned next to soft-blend (`source-over`, `soft-light`) and the visual jitters. Add: "if previous blend was hard, prefer soft next." | Automix |
| M4 | `Library._classify` (L800+) | Asset features (motion/luma/hue) are first-frame or luminance-only. No audio snapshot for stable scoring. A still image with bright background scores high on `luma` even if it's a static dark photo. | Automix |
| M5 | All layer add/remove events | When a layer is added/removed, the new state appears instantly. Could fade the new layer in over 200ms using `SWR_TIMING.fadeIn`. The fade audit confirms 3 of 7 candidate transitions are audio-no-ops (layers are muted) so this is visual-only. | Fade |

### Low (cosmetic / future)

| # | Where | Issue | Source |
|---|---|---|---|
| L1 | `engine-keys.client.js` | R-key conflict: rotates selected clip OR triggers RE-MAP. Re-map and rotate are different intents. Pick one key per intent. | Automix |
| L2 | All "fade" sites | Default durations are reasonable (150ms play, 200ms pause, 600ms song-end/load) but not user-tunable. A small "fade duration" slider in the global controls would let users dial it in. | Fade |
| L3 | `Audio.fadeTo` | Web Audio `linearRampToValueAtTime` is linear; `setTargetAtTime` is exponential. For perceived loudness, exponential is more musical. Tradeoff: more params to tune. | Fade |
| L4 | `Layers.autoMap` | No "lock a layer" UI — the user can't say "I like layer 3, don't remap it." Would need a per-layer pin. | Automix |
| L5 | `Layers` class | The `Layer` object has `opacity` but no per-layer `gain`. When per-layer video audio is eventually un-muted (future), there's no place to store per-layer gain. | Fade (forward-compat) |

---

## Recommended fix order

### Phase 1 — Foundation (1.5 hours, low risk)
*Single helper that fixes 4 transitions at once.*

1. **C3 + H1**: Add `Audio.fadeTo(target, ms)` helper + `Audio.fadeIn(ms)`, `Audio.fadeOut(ms)` wrappers. Use `gain.linearRampToValueAtTime` (with `cancelScheduledValues` first). Fix the stale `ended` listener leak (C3) — track the active listener and remove it before adding a new one.
2. **C2**: Re-route the MediaRecorder audio branch `analyser → dest` → `analyser → Audio.gain → dest`. Recorder now captures the fade envelope. **Test**: trigger a fade-out and verify the exported file is silent at the end (not clipped at full volume).
3. Wrap `Audio.loadFile`, `Audio.play`, `Audio.pause`, `Audio._onSongEnd` with the helper. Default durations: 150ms play, 200ms pause, 600ms song-end/load.

### Phase 2 — RE-MAP smoothness (1 hour, low risk)
*Template already exists in the MTV variant.*

4. **C1**: Add `Layers.reset({fadeMs = 200})` to `engine-core.client.js` (or hoist it from `versions/music_video_mtv.html:961-992` into the shared core). Have `autoMap()` call `reset()` before rebuilding the list.
5. **H2**: Wrap `autoMap()` in `SWR_GENOPS.withHistory('remap', ...)` (mirror the existing genops remap wrapper).

### Phase 3 — Better scoring (2 hours, medium risk)

6. **H3**: Read `Audio.feat.bpm / sub / centroid / key` in `autoMap()`. Use BPM to weight `mode` selection (chaos for fast, ambient for slow). Use centroid to bias which layer gets the brightest asset.
7. **H4**: Add `autoMapLayer(index)` for per-layer remap. Wire to Shift+1..6 keyboard shortcuts.
8. **M1**: Track `lastUsedAssetIds` (Set, sliding window of 4) to avoid picking the same top-3 every time.
9. **M2**: Make `pickReactors` audio-driven — high bass = reactor that pulses on bass; high treble = reactor that pulses on treble. **Test**: load a low-BPM track and verify the reactors assigned are the slow-pulse family, not the fast-pulse.
10. **M3**: `pickBlend` adjacency rule — if previous blend was hard (`difference`, `overlay`), prefer soft (`source-over`, `soft-light`) for the next layer.

### Phase 4 — Visual layer fade (1 hour, low risk)
*Per-layer visual fade, no audio impact (layers are muted).*

11. **M5**: When `Layer` is added to `this.list`, animate `layer.opacity` 0→1 over 200ms via `SWR_TIMING.fadeIn`. On remove, fade out then splice. Use the same `_swapPending` mechanism the render layer already supports.

### Phase 5 — Polish (deferrable)

12. **L1**: R-key conflict fix.
13. **L2**: User-tunable fade duration slider.

---

## What I will NOT do without explicit approval

- Touch `fx-postprocess.js` (no overlap)
- Touch any variant page (they each have their own custom paint; the fade/automix work is engine-core)
- Change the autoMap `topN` (currently 1-4) — would be a UX choice
- Add per-layer video audio un-muting (would require picking one layer as the "audio source" and routing it through Audio.gain — out of scope)
- Touch the swr-app.html separate engine
- Add undo/redo UI (the withHistory scaffold exists; the UX to drive it is a separate feature)

---

## Approval gate

Pick which phase(s) to apply:
- **Phase 1** — gain helper + MediaRecorder re-route + stale listener fix (1.5h, low risk, fixes 5 transitions + 1 latent bug)
- **Phases 1–2** — add RE-MAP smoothness on top (2.5h, low risk)
- **Phases 1–3** — full automix improvements (4.5h, medium risk)
- **Phases 1–4** — all of the above plus per-layer visual fade (5.5h, low risk)
- **All 5 phases** — everything (6.5h)

Or pick specific items. If you want changes to the plan, give them and I'll revise before any code touches.