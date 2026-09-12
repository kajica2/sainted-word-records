# Fade / Cross-fade Audit

> **Scope:** Every place a clip's *audio* (not canvas opacity) can start or stop
> abruptly in `engine-core.client.js`. The engine already has a layer-opacity
> fade system (`window.SWR_TIMING`, see `engine-timing.client.js`); this audit is
> only about *audio* gain envelopes, which are not yet covered.
>
> **Bottom line:** there is exactly **one** audible audio source per engine
> (the master `Audio.gain` node, fed by `Audio.audioEl`). All seven transition
> points reduce to **one** place to fix. A single `Audio.fadeTo(target, ms)`
> helper plus a few call-sites closes the gap.
>
> **Caveat:** the MediaRecorder capture branch is wired **before** the gain
> node (`analyser.connect(dest)`), so a gain-node-only fade would **not** be
> recorded. The implementer must also route the recorder branch through the
> gain node (see "Recording pipeline interaction" below).

---

## Background — the audio graph (engine-core.client.js)

```
file picker ─► Audio.audioEl   (HTMLAudioElement | HTMLVideoElement)
                    │
                    ▼
            Audio.source = ctx.createMediaElementSource(audioEl)
                    │
                    ▼
              Audio.analyser  (FFT 2048, smoothing 0.65)
                    │
                    ├──► Audio.gain ─► ctx.destination   (speakers)        L162-165
                    │
                    └──► MediaStreamDestination ─► MediaRecorder           L2986-2990
```

Per-layer videos render to canvas but are **muted** (`a._el.muted = true` at
L2419), so layer add / remove / RE-MAP do **not** cause audio clicks — there is
no per-layer audio path to fade. The only audible audio is the master song
through `Audio.gain`, and its value is currently set once to `1.0` (L163) and
never ramped.

---

## Where transitions happen

| #  | Trigger               | Code path                                                       | Current behavior                                                | Abrupt? | Severity  |
|----|-----------------------|-----------------------------------------------------------------|-----------------------------------------------------------------|---------|-----------|
| 1  | RE-MAP button         | `Layers.autoMap()` L1389-1466 (handler at L3399)               | `this.list = []`, rebuilds 6 layers, plays through muted video| no¹     | — (audio) |
| 2  | Song load             | `Audio.loadFile(file)` L176-228 (handler at L3294, L3575)       | Creates new `<audio>`/`<video>`, sets `gain.value = 1.0`       | yes     | high      |
| 3  | Song end              | `UI.onSongEnd()` L3532 → `Audio.pause()` L288                    | `audioEl.pause()` immediately at full gain                      | yes     | medium    |
| 4  | Play button           | `Audio.play()` L229-238 (handler at L3298, L3309)                | `ctx.resume()`, `audioEl.play()`, no fade-in                    | yes     | medium    |
| 5  | Layer add             | `Layers.add(asset)` L1198-1220 (also `applyPreset` L1647)      | `_el.muted = true` (no audio at all)                            | no      | — (audio) |
| 6  | Layer remove          | `Layers.remove(id)` L1221-1228                                   | `this.list.splice(i,1)`, no audio to fade                       | no      | — (audio) |
| 7  | `promoteToSong`       | `Library.promoteToSong(item)` L982 → `Audio.loadFile(file)`      | Same as #2 (loadFile replaces audioEl, gain jumps to 1.0)       | yes     | high      |

¹ **Severity rationale for RE-MAP / layer add / layer remove:** the prompt
listed these as candidates, but per-layer video elements are muted at the DOM
level (`a._el.muted = true`, L2419), so they cannot produce a click. The only
audio that exists is the shared master song; RE-MAP and layer ops do not
touch it. Marked "no" / "—" in the audio column. **If a future change un-mutes
layer audio, those rows immediately become "critical"** — the helper proposed
below supports that case for free.

### Cross-cutting findings

- **`Audio.gain.gain.value` is set to 1.0 exactly once** (L163) and never
  ramped. There is no fade helper anywhere in `engine-core.client.js`.
- **`Audio.unlock()` reconnects the graph** every time `loadFile` is called —
  `if (this.source) try { this.source.disconnect(); } catch {}` (L178). The
  gain node is reused, but if the implementer replaces `Audio.gain` they must
  re-wire `analyser.connect(gain)` and `gain.connect(destination)`. The
  recorder branch `analyser.connect(dest)` is also reconnected each `start()`.
- **`Audio.pause()` and `Audio.play()` are called from several places** beyond
  the play button: `pause` from L3533 (`onSongEnd`), L3796 auto-play, L3533,
  and the picker buttons at L3298/3309. Each is a candidate call-site for the
  new fade helper.
- **`Audio.loadFile` is fire-and-forget** for the `ended` event listener
  (L204). Old listener is not removed when the element is replaced, which
  means the **previous song can fire `ended` on the old element after the new
  one is loaded**, calling `UI.onSongEnd()` → `Audio.pause()`. This is a
  latent bug, not strictly a fade issue, but it interacts: a fade-out on the
  old element via the gain node would help mask the swap. Implementer should
  remove the old `ended` listener at the top of `loadFile` as part of the fix.

---

## Recommended shared fade helper

```js
// Sketch — DO NOT IMPLEMENT
// Lives in engine-core.client.js alongside Audio.unlock() / Audio.gain.

Audio.fadeTo = function fadeTo(target /* 0..1 */, ms /* default 200 */) {
  if (!this.ctx || !this.gain) return Promise.resolve();
  target = Math.max(0, Math.min(1, +target));
  ms = Math.max(0, +ms || 0);
  const g = this.gain.gain;
  const now = this.ctx.currentTime;
  // Cancel any in-flight automation so we don't fight a previous fade.
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  // Linear ramp is fine — perceptual loudness is roughly linear for short fades
  // (< 500ms). For longer fades, swap to setTargetAtTime(target, now, ms/3000)
  // for an exponential ease that matches loudness perception.
  g.linearRampToValueAtTime(target, now + ms / 1000);
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// Convenience wrappers (call-sites are noisy otherwise):
Audio.fadeIn  = (ms) => Audio.fadeTo(1.0, ms == null ? 200 : ms);
Audio.fadeOut = (ms) => Audio.fadeTo(0.0, ms == null ? 250 : ms);
```

### Default durations (recommended)

| Transition                       | Default | Rationale                                                       |
|----------------------------------|---------|----------------------------------------------------------------|
| Play-button fade-in              | 150 ms  | Short enough to feel instant, long enough to kill the click.   |
| Pause-button / user pause fade-out| 200 ms | Symmetric with fade-in; matches YouTube / Spotify behavior.    |
| Song-end fade-out                | 600 ms  | Long enough to feel like a real ending, not a glitch.          |
| Song-load cross-fade             | 600 ms each, overlapping 300 ms | A real cross-fade, not a click.                                |
| `promoteToSong`                  | 600 ms  | Same as song load — it goes through `loadFile`.                |

Expose these as `Audio.fadeDefaults = { play:150, pause:200, end:600,
load:600 }` so they can be tuned from one place (and overridden by tests).

---

## Per-issue fix proposal (prioritized)

### Critical
- **None.** The only "critical" candidate in the prompt (RE-MAP) does not
  produce an audio event because per-layer videos are muted. **However**: the
  gain helper should be designed so that, if a future change un-mutes layer
  audio, it can be applied to per-layer `MediaElementAudioSourceNode`s too.
  See "Extending to per-layer audio" below.

### High

- **#2 — Song load** (`Audio.loadFile`, L176):
  - Before disconnecting the current `audioEl`, call `await this.fadeOut(200)`.
  - Create the new `audioEl`, assign src, connect.
  - Then schedule `setTimeout(() => this.fadeIn(200), 50)` (or better, chain on
    the audioEl's `canplay` event so the fade-in lands when audio actually
    starts). When the page is paused (`Audio.playing === false`) do **not**
    fade in — leave gain at 1.0 silently.

- **#7 — `promoteToSong`** (`Library.promoteToSong`, L982):
  - Currently calls `Audio.loadFile(file)` directly. With the song-load fix
    above, this gets the fade-out + fade-in for free. **No separate change
    needed** beyond verifying the path lands in `loadFile`.

### Medium

- **#3 — Song end** (`UI.onSongEnd`, L3532):
  - Replace `Audio.pause()` with `await Audio.fadeOut(600); Audio.pause();`.
  - Also: when the user clicks Pause manually (`Audio.pause()` from L3298),
    apply the shorter 200 ms fade-out before pausing.

- **#4 — Play button** (`Audio.play`, L229):
  - Before `audioEl.play()`, ensure `gain.value` is at the previous level
    (typically 0 if we just paused-with-fade, 1.0 on first play). Add
    `await this.fadeIn(150)` after `this.audioEl.play()`.
  - Symmetric: `Audio.pause()` should `await this.fadeOut(200)` before
    `audioEl.pause()`.

### Low

- **#1, #5, #6 — RE-MAP, layer add, layer remove:**
  - **No audio fix needed today** because per-layer videos are muted. The
    canvas-opacity fade (`SWR_TIMING.crossfade` / `staggeredFadeIn`) already
    covers the *visual* swap, so the user perceives continuity even though no
    audio changes.
  - **Forward-looking note:** if a future feature un-mutes per-layer videos,
    the implementer should add `audioEl.volume = 0` + `fadeIn/fadeOut` in
    `Layers.add()` / `Layers.remove()` / `Layers.autoMap()`, using the same
    `Audio.fadeTo` helper. The helper signature accepts any `GainNode`, so
    per-layer usage is identical.

### Latent bug uncovered (worth fixing in the same PR)

- **`loadFile` does not remove the old `ended` listener.** L204 attaches a
  listener to the new `audioEl` but never removes the previous one. After
  loading song B mid-playback, song A's `<audio>` can still fire `ended` →
  `UI.onSongEnd()` → `Audio.pause()`. Fix: at the top of `loadFile`, before
  `removeAttribute('src')`, do `this.audioEl.removeEventListener('ended',
  this._onEndedRef)` and store the bound function on `Audio`.

---

## Recording pipeline interaction

The MediaRecorder path is wired **before** the gain node:

```js
// engine-core.client.js L2986-2990
const dest = Audio.ctx.createMediaStreamDestination();
Audio.analyser.connect(dest);   // ← bypasses Audio.gain
```

This means **a gain-node-only fade would NOT be captured** by `MediaRecorder`.
The recorded export would clip in / out at full volume while the speakers
faded, producing an audible mismatch between preview and export.

### Recommended fix

Re-route the recorder branch through the gain node so the recorded export
matches what the user heard:

```js
// Sketch — DO NOT IMPLEMENT
// In Recorder.start() (around L2986-2990):
const dest = Audio.ctx.createMediaStreamDestination();
this.mediaDest = dest;
Audio.gain.connect(dest);          // route through the gain node instead
const astream = dest.stream;
// …
```

And on `Recorder.stop()` (where the existing code calls
`Audio.analyser.connect(dest)` — check `this.mediaDest`), disconnect
`Audio.gain` from `dest` after stopping.

### Why this matters

- The user's exact request is *"no abrupt ending or start, transition at the
  end of a clip"* — that includes the exported file the user shares.
- Without re-routing, the helper above halves the value: speakers fade, export
  doesn't, and the discrepancy is louder than the original click was.

### Note on WebCodecs path

`_startWebCodecs` (L3101) does not yet wire audio at all — the comment at
L2958 says *"audio lands in a follow-up"*. When that follow-up lands, it must
take the new `Audio.gain → dest` path so it picks up the same fade. No
additional change needed in this PR.

---

## Extending to per-layer audio (future)

`Audio.fadeTo(target, ms)` is intentionally written against a single
`Audio.gain` node, but the same body works on any `GainNode`. If a future
feature un-mutes per-layer videos, wrap each `a._el` in a per-asset GainNode
(via `Audio.ctx.createGain()` + `createMediaElementSource(el).connect(g)`),
cache `g` on `a._audioGain`, and call `a._audioGain.gain.linearRampToValueAtTime`
with the same helper body. Then:

- `Layers.add(asset)` → `audioGain.fadeTo(asset.audio || 1, 200)`
- `Layers.remove(id)` → `audioGain.fadeTo(0, 200)`, then disconnect after.
- `Layers.autoMap()` → fade out current layer audio, then fade in new.

The helper signature does not need to change; only the call-sites.

---

## Files to read for the implementer

| File                                       | What it contains                                                                                                  |
|--------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `engine-core.client.js` L108-167           | The `Audio` object — `ctx`, `analyser`, `gain`, `audioEl`, `unlock()`. Place the new `fadeTo` here.              |
| `engine-core.client.js` L176-228           | `Audio.loadFile` — add fade-out before swap, fade-in after `canplay` (and remove the stale `ended` listener).      |
| `engine-core.client.js` L229-238           | `Audio.play` — wrap with `fadeIn(150)`.                                                                           |
| `engine-core.client.js` L288-294           | `Audio.pause` — wrap with `fadeOut(200)`.                                                                         |
| `engine-core.client.js` L982-994           | `Library.promoteToSong` — already routes through `loadFile`; verify no extra change needed.                       |
| `engine-core.client.js` L2419              | `a._el.muted = true` — confirms layer videos don't contribute to audio.                                          |
| `engine-core.client.js` L2986-2990         | Recorder audio branch — re-route through `Audio.gain`.                                                            |
| `engine-core.client.js` L3532-3534         | `UI.onSongEnd` — call `fadeOut(600)` before `pause()`.                                                            |
| `engine-timing.client.js`                 | Reference for the *visual* fade system (`SWR_TIMING.fadeIn/fadeOut/crossfade`). Don't conflate — that one is per-layer canvas opacity, not audio gain. Same convention can be borrowed for the API shape (`fadeTo(target, ms)` returns a `Promise`). |
| `engine-core.client.js` L1198-1228         | `Layers.add` / `Layers.remove` — **read-only** for this audit; no audio changes needed today.                     |
| `engine-core.client.js` L1389-1466         | `Layers.autoMap` — **read-only** for this audit; per-layer videos are muted, so no audio click.                    |
| `check-fade.mjs` / `check-crossfade.mjs`  | Reference Puppeteer tests for `SWR_TIMING` opacity fades. Use the same pattern to add `check-audio-fade.mjs` for the new audio helper (assert gain ramps 0→1 over 150ms and 1→0 over 600ms). |

---

## Summary of changes (count: 1 helper + 4 edits + 1 recorder edit + 1 bug fix)

1. **Add** `Audio.fadeTo(target, ms)` (+ `fadeIn` / `fadeOut` wrappers) to `engine-core.client.js` (after L167).
2. **Edit** `Audio.loadFile` (L176) — fade out old, fade in new, remove stale `ended` listener.
3. **Edit** `Audio.play` (L229) — `await fadeIn(150)` after `audioEl.play()`.
4. **Edit** `Audio.pause` (L288) — `await fadeOut(200)` before `audioEl.pause()`.
5. **Edit** `UI.onSongEnd` (L3532) — `await fadeOut(600)` before `Audio.pause()`.
6. **Edit** recorder audio branch (L2986-2990) — connect `Audio.gain` to `dest` instead of `analyser` to `dest`; disconnect on stop.
7. **Optional but recommended**: add `check-audio-fade.mjs` mirroring `check-fade.mjs` but asserting on `Audio.gain.gain.value` over time.
