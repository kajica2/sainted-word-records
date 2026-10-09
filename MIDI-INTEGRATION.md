# MIDI Integration — Sainted Word Records

> **Scope:** `.mid` / `.midi` as a first-class song source for the engine
> **Status:** Shipped on `main` · gate green (all `npm run check` steps pass)
> **PR:** [#171 — feat(engine): MIDI files as a song source](https://github.com/kajica2/sainted-word-records/pull/171) (merged)
> **Commits on main:** `f6bfec1` (the integration) + `4c17cef` (the engine.html wire-up)
> **Date:** 2026-10-09

A Standard MIDI File is now a song. Drop one in and the score drives the
visuals — every variant that reads `Audio.feat` works without
modification.

## Why

The engine is "drop in a song, drop in a library of videos / GIFs / images,
get a reactive layered composition." A `.mid` has no audio, so it could not
be a song — `Audio.feat` stayed zeroed and every variant rendered a black
composition. The fix is to derive the canonical 12-field feat shape
(`{bass, mid, treble, air, sub, rms, centroid, beat, onset, beatPulse,
onsetPulse, bpm}`) from the note events themselves.

A MIDI file is, in fact, the **better** source for several feat channels:
note-on times *are* the onsets (no spectral-flux guessing, no jitter), and
the tempo map gives BPM exactly.

## The contract

The feat shape, the decay constants, and the paused-transport semantics
are deliberately identical to `lib/media-feat.client.js`, so a MIDI
source is a drop-in replacement for an `<audio>` element from every
variant's point of view.

- `beat` / `onset` are **decaying envelopes**: `1` on the hit frame,
  `prev × 0.7` thereafter. The 0.7 matches `media-feat`'s `DECAY`.
- `beatPulse` / `onsetPulse` are booleans, true only on the hit frame.
- A **paused** transport clears the pulses and freezes the envelopes —
  the same `if (!el || el.paused) return` early-return `media-feat`
  does when the media element is paused.

Engine-core's render loop reads `Audio.feat.beat` straight into opacity
(line 3230 of `engine-core.client.js`), so the 0.7 decay and the
pulse-on-hit boolean are the contract, not an implementation detail.

## What landed

| File | Role |
|---|---|
| **`lib/midi-feat.client.js`** | Zero-dep SMF parser + feature synth. `window.SWR_MIDI_FEAT` exposes `parse(buffer)`, `analyze(source)`, `attach(source)`. Handles running status, vel-0 note-on as note-off, dangling note-ons, tempo maps, and rejects SMPTE division with a clear error. |
| **`lib/audio.client.js`** | `loadFile()` routes `.mid` / `.midi` through `loadMidi()`. `sample()` delegates to the MIDI handle, and `play` / `pause` / `seek` drive its transport. The recorder stays disabled — there is no audio to record. **No variant changes** were required. |
| **`client/dropzone.client.js`** | `defaultAccept()` gains `.mid,.midi`. |
| **`engine.html`** | Loads `/lib/midi-feat.client.js` beside `audio.client.js`, and the engine's song picker (`#song-input`) accepts `.mid,.midi` alongside audio + video. Without both, `loadMidi()` hit "MIDI support not loaded". |
| **`scripts/check-midi-feat-unit.mjs`** | 47 deterministic checks. |
| **`package.json` + `scripts/run-steps.mjs`** | `check:midi-feat-unit` script, added to the `check` group beside `check:bpm-unit`. |

## Use

A `.mid` is loaded the same way as any other song — by the engine's
existing drop / pick UI. The status line reports the parsed score:

```
loaded MIDI · 9 notes · 120 bpm · click play
```

`MIDI support not loaded` is the only error path the user will see; it
fires if `lib/midi-feat.client.js` was not loaded by the page
(caught and fixed in `4c17cef` for the engine). All other failures
are SMF syntax problems (missing `MThd`, SMPTE division, truncated
varint) and surface as `✕ can't read <name>: <reason>`.

`analyze(source)` returns the `AudioAnalysisV2` shape directly:

```js
{ bpm, key, scale, confidence, chromagram, onsets, duration }
```

Krumhansl-Schmuckler key detection runs on a velocity-weighted
pitch-class chromagram (not an FFT chromagram), so a MIDI-derived
key is comparable with an audio-derived one. The two are not
interchangeable at the rhythm level — onset times and tempo are
exact here, not estimated — but the key / confidence pair is
on the same scale.

## Regression coverage

`check-midi-feat-unit` covers, in order:

- **Parse:** header (format, ppq, tracks), note ticks / durations /
  velocity, tempo map, duration. Running-status resolves to a note-on.
  `vel-0 note-on` closes a note (it is *not* a zero-velocity note, per
  the SMF spec).
- **Analyze:** BPM is read from the tempo map (not estimated);
  onsets are the note-on times in seconds; the chromagram sums to 1;
  the tonic bin is the max; C-major material detects as C major;
  the duration matches `parse`. 0 notes → C / major fallback.
- **Attach / feat:** all 12 keys present, `feat.bpm` seeded from the
  tempo map, `duration` exposed, `C4` lands in the `mid` band. At
  `t = 0` the onset and beat pulses both fire; an off-beat note-on
  fires onset without a beat. The 0.5-second beat fires the beat
  grid; off-hit frames decay the envelopes by ×0.7; a paused
  transport clears the pulses and freezes the envelopes. A seek
  **onto** a note-on fires it once; a seek **past** it does not.
- **Negative:** garbage bytes throw `missing MThd`; SMPTE division
  throws `SMPTE time division is not supported`; truncated varint
  throws; `null` input throws `empty`; zero-length buffer throws
  `too short to be a MIDI file`.

The transport clock is **injected** (`play(0)`, `sample(ms)`) — no
`Date.now()` in the test path, so the suite is deterministic and a
flake is a real bug, not a clock race.

## Constraints

- **No audio to record.** The recorder (`rec`) stays disabled while
  a MIDI source is loaded. This is by design, not a TODO.
- **No transport `ended` event.** A MIDI handle reaches the end of
  the score and stops. There is no media-element `ended` to listen
  to; the `updateTime` UI hook should poll `handle.position` if
  exact transport time matters (the engine does not currently do
  this — see Open).
- **SMPTE division is rejected.** SMPTE-timed files are a vanishingly
  small slice of the corpus; the rejection is a clear error rather
  than a silent fallback. Adding SMPTE support is a one-function
  `tickToSec` extension.
- **No metadata chord / lyric / rehearsal extraction.** The parser
  reads note on / off and tempo. Chord symbols, lyrics and
  rehearsal marks are present in MusicXML but not in SMF in a
  way the SMF spec standardises; not in scope.
- **One MIDI source at a time.** A second `loadMidi()` call detaches
  the first. Multiple concurrent MIDI handles are not supported
  (and not needed — there is one song slot).

## Decisions worth keeping

- **Onset detection is an exact cursor, not a time comparison.**
  First version compared `windows[j].t0 > prevPos`; a note sitting
  exactly on `play()` or `seek()` (the common case) was missed
  because `prevPos === pos` at the first frame. The cursor is
  re-armed to the first note-on at-or-after the seek position and
  advances by index; no double-fire, exact at the boundary.
- **Vel-0 note-on is a note-off.** The SMF spec says so; the
  parser pairs it with the open note-on. Treating it as a
  zero-velocity note (the popular mistake) leaks an unclosed
  note and corrupts the next pairing.
- **Tempo map collapses duplicates on the same tick** (last write
  wins, as sequencers do). The map is then sorted and queried
  with a two-pointer walk in `tickToSec`.
- **Chromagram is velocity-weighted duration**, not just velocity.
  A held long note contributes more than a short staccato one,
  which matches the musical intuition and improves key detection
  on realistic (non-quantised) scores.
- **Feature ranges are 0..1 by clamp, not by scale.** Sum
  `vel / 127` per band; clamp to 1. ~4 concurrent notes saturates
  each band. `rms = mass / 4`, clamped. `centroid = (meanNote -
  21) / 87`, clamped. Easy to reason about; no hidden
  normaliser to keep in sync with the variant rendering.

## Open

- `updateTime` does not currently reflect MIDI transport position.
  The engine's progress UI is wired to `<audio>.currentTime`.
  Either poll `handle.position` in the sample loop or expose
  `position` as a `timeupdate`-style event.
- The engine's `ended` handler (`onSongEnd`) never fires for MIDI.
  A `handle.ended` event dispatched at end-of-score would let the
  queue / playlist UI loop on MIDI sources.
- The recorder is intentionally disabled, but the export-video
  path may want to render the visual + a flat MIDI audio track
  for upload. That is a `lib/media-feat`-side change, not here.

## Next

- (a) Live-state wiring for the agent-loop dashboard (the standing
  backlog item).
- (b) Add `.mid` to the curated marketplace packs (the Harmonic
  Study Engine MP3+MIDI package in `7891314` is the seed of that).
- (c) A real `analyze()` use from the engine's key / genre UI so
  the audio and MIDI paths surface the same chip — currently the
  engine reads `AudioAnalysisV2` for the audio path and ignores
  the MIDI path's own analysis.

---

**Gate:** `npm run check` → `check: all 59 steps passed` (verified
locally before merge; CI re-runs `check:full` on every push).
**Zero secrets** in any of the files added; `lib/midi-feat.client.js`
is a self-contained IIFE attaching a single upper-case global to
`window`, in the project's established pattern.
