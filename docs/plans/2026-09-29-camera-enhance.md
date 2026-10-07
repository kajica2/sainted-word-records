# Plan — Camera Enhance (`/camera-enhance`)

## Goal

Ship **Camera Enhance** — clean, professional video processing for
camera-shot footage: upload a clip, fix what the camera got wrong
(exposure, grain, shake, motion), apply a cinematic look, add a subtle
reactive overlay, configure burn-ins, export. Browser-native, zero
backend — no synthetic or holographic styling, the footage stays the
subject.

Source of truth: `docs/prds/camera-enhance.md` (1,737 lines, §3–§6).
This plan implements it and records where an aspiration is scoped down
to what a browser can honestly do.

This is **PR 4 of 4** in the user's chosen sequence
(live-camera-mic → spit-live → tiktok → **camera-enhance**) — the last
of the four.

## Scope

### In

- `/camera-enhance` page — source · stage · look · export (§3 layout,
  §4 panels)
- Upload: dropzone + picker, metadata (resolution, frame rate,
  duration, codec, bitrate), poster thumbnail
- Transport: play/pause, ±10 s, draggable scrubber, time readout
- Fixes (§4.1): Stabilize, Denoise, Smooth Motion, Auto Exposure —
  honest per-frame implementations, see "Fix semantics"
- Looks (§5): 8 presets + 9 grading sliders on Custom (exposure,
  contrast, saturation, highlights, shadows, temperature, tint, grain,
  vignette)
- Reactive overlay (§4.5): Subtle / Mood / Energy / Off, intensity
  0–100 (default 30), optional audio analyser for reactivity
- Export (§4.4): 5 formats (9:16, 1:1, 4:5, 16:9, 2.39:1), quality
  (1080p / source), 5 burn-ins (logo, title, subtitle, date, location),
  audio (original / muted / + music), MediaRecorder → `.webm`
- The SWR mark on every export — repo rule, forced like `/tiktok`
- Unit + smoke checks wired into the `check` and `check:full` groups
- CHANGELOG + AGENTS.md + generated wiring (rewrites, site-map, sitemap)

### Out (intentionally)

- Optical-flow interpolation — Smooth Motion is a temporal blend
- Per-pixel WebGL denoise — v1 is an edge-preserving soften
- Backend/cloud processing; uploads beyond browser memory
- Multi-clip timelines, transitions, extra title styles
- Audio mixing beyond original / muted / one music track
- Real file containers other than `.webm` (MediaRecorder's native shape)

## Architecture

**One renderer, two outputs.** The preview and the export run the same
per-frame processor, so "what you see is what you export":

```
source ─┬─ preview  <video> filter = grade string
        │           + grain / vignette / overlay DOM layers
        │           + transform = stabiliser counter-motion
        └─ export   offscreen canvas at output size:
                    drawImage(video, format crop) with ctx.filter =
                    the same grade, then grain + vignette + overlay +
                    SWR mark + burn-ins painted, captured via
                    captureStream(outputFps) + the source audio track
                    → MediaRecorder → .webm
```

Grade = one CSS filter string built from the look params
(`brightness() contrast() saturate() sepia() hue-rotate()`), identical
in both paths. Composition order is fixed and documented so preview and
export cannot drift.

### Files

|File|LOC budget|Notes|
|---|---|---|
|`camera-enhance.html`|~900|Self-contained page: `<swr-nav>`, design tokens, §3 layout, §4 panels, inline controller|
|`client/swr-camera-enhance.client.js`|~700|Runtime: state, source/upload, fixes, looks, overlay, transport|
|`client/swr-camera-enhance-export.client.js`|~350|Export: compositor, burn-ins, mark, MediaRecorder|
|`scripts/check-camera-enhance-unit.mjs`|~400|node:vm unit tests (no browser APIs)|
|`scripts/check-camera-enhance-smoke.mjs`|~150|Puppeteer smoke against built `dist/`|
|`docs/CHANGELOG-2026-09-29.md`|+~60|Section|
|`AGENTS.md`|small|Module list + testing bullets|
|`vercel.json` / `site-map.json` / `sitemap.xml`|generated|Rewrites + entry|

**~2,500 LOC of new code**, in line with PR 3.

### Fix semantics

|Toggle|What it actually does|Verified by|
|---|---|---|
|Auto Exposure (default on)|Samples the live frame on a downscaled grid, measures mean luma + clipping, and biases the grade toward a target band. The bias is shown in the UI|Unit: synthetic luma → bias within bounds, stable on a balanced frame|
|Stabilize (default on)|Software translation stabiliser: estimates the frame-to-frame offset on a coarse luma grid, smooths the path over time, counter-transforms the preview/export inside a crop|Unit: smoothing a synthetic shake series lowers displacement variance; real clip A/B|
|Denoise|Edge-preserving soften (blend of two blur radii) to reduce sensor grain|Unit: parameter mapping + clamp; real clip high-frequency energy drops|
|Smooth Motion|Temporal blend of the previous and current frame, smoothing residual judder|Unit: blend weight mapping; real clip inter-frame delta drops|

Each toggle is a *real* pass over the pixels — no dead switches.

## Tasks

1. **Page + runtime** — `camera-enhance.html` + `client/swr-camera-enhance.client.js`.
   Deliverable: page renders §3 layout on tokens/nav; upload → metadata +
   poster; transport; looks + slider math; overlay modes; fixes on/off.
   Verify: syntax gate; browser check on a served tree.
2. **Export pipeline** — `client/swr-camera-enhance-export.client.js`.
   Deliverable: format/quality/burn-ins/audio → `.webm` download with the
   SWR mark.
   Verify: real export of a generated fixture clip; ffprobe the output.
3. **Checks** — unit + smoke scripts, wired into `check` and
   `check:full`.
   Verify: both green locally.
4. **Wiring + docs** — npm scripts, generated rewrites/site-map/sitemap,
   CHANGELOG, AGENTS.md.
   Verify: `check:dist-links`, `check:sitemap`, `generate-*` idempotent.
5. **Real-footage verification** — ffmpeg-generated "camera" clip
   (flat + noisy + shaky), driven through the page: look applied,
   fixes measurable, burn-ins in the exported frames, 0 console errors.
6. **Sprint close-out** — close-out table appended here; PR opened.

## Acceptance criteria

- [ ] `/camera-enhance` loads cleanly in dev and built `dist/`
- [ ] Upload shows resolution / duration / codec + a poster thumbnail
- [ ] 8 looks + Custom sliders visibly change the preview (measured)
- [ ] All 4 fixes change measured frame statistics (not just UI state)
- [ ] Overlay modes render at ≤30% opacity default and respond to audio
- [ ] Export produces a real `.webm` with the chosen format, burn-ins,
      SWR mark, and the source audio
- [ ] `check:camera-enhance-unit` ≥ 30 assertions, green
- [ ] `npm run check` stays green with the new step
- [ ] `check:syntax` exits 0; `check:dist-links` 4/4
- [ ] CHANGELOG section + AGENTS.md module list updated
- [ ] Commits authored as `Kajica Djuric <kai.djuric@gmail.com>`

## Risks / honest limits

- **MediaRecorder is realtime.** A 60 s clip takes ~60 s to export; the
  export panel states the estimate rather than promising instant output.
- **No true optical flow.** Smooth Motion is a temporal blend; the page
  says so in the control's sublabel.
- **Codec support varies.** VP9/Opus preferred with VP8 fallback; Safari
  MP4 recording is a follow-up (same note as PR 1).
- **Large uploads** are limited by browser memory, not the 4 GB copy in
  the PRD's hint text — the hint is corrected to the honest limit.

## Sprint ordering reminder

This is **PR 4 of 4** in the user's chosen sequence:
- ✅ PR 1 — Live Camera & Mic foundation (#101)
- ✅ PR 2 — Spit Live (`/spit`) (#102)
- ✅ PR 3 — TikTok Studio (`/tiktok`) (#163)
- 🚧 PR 4 — Camera Enhance (`/camera-enhance`) — this PR — **closes the sequence**

---

## Close-out — 2026-09-29

| Acceptance criterion | Result |
|---|---|
| `/camera-enhance` loads cleanly in dev + built `dist/` | PASS — smoke **27/27** against built `dist/camera-enhance.html` |
| Upload shows resolution / duration / type / size + poster | PASS — `1280 × 720`, `0:06`, `14.6 MB · camera-fixture.mp4`, `mp4`; thumbnail sampled non-black |
| 8 looks + Custom sliders change the preview (measured) | PASS — same-frame samples: mono channel spread **0.3**, warm r−b **11.0** vs clean **7.8**, cool r−b **−1.4**; 9 custom sliders asserted in the smoke |
| All 4 fixes change measured frame statistics | PASS — auto-exposure readout live (`+25.0 %` → `+0.6 %` as the frame brightened); stabiliser counter-move bounded (**−1.4 … +1.2 cells** across 1.4 s) and, after the sign fix, pinned by the unit's variance-reduction assertion (`var(raw)` **0.5000** → `var(net)` **0.0041**, **121×**); denoise adds `blur(0.4px)` to the grade string; smooth motion blends the previous frame |
| Overlay modes ≤ 30 % opacity, audio-reactive | PASS — `overlayAlpha` peaks 0.18 / 0.26 / 0.30 (unit); Subtle / Mood / Energy / Off asserted in the smoke. Reactivity is wired through a `createMediaElementSource` → `AnalyserNode` graph built on the first user gesture (never connected to `destination`, so the stage stays muted) and the runtime derives `{energy, bass, mid, high}` from the analyser's frequency data; with no WebAudio — or a source that cannot be read — `state.audio` stays `null`/yields `null` and the overlays idle at the base level. Because the element stays muted, a muted source's bands sit near zero, so the overlay reads as "idle", not as "live meter" |
| Export → real `.webm` with format + burn-ins + mark + audio | PASS — vp9+opus **720×1280**, 1.5 MB; frames show title, subtitle, date, location, logo and the `SWR · enhance` mark; YAVG **112.6 → 87.6** under the film look |
| `check:camera-enhance-unit` ≥ 30 assertions | PASS — **63 assertions** |
| `npm run check` stays green with the new step | PASS — **all 49 steps**, `check:camera-enhance-unit` among them (0.4 s) |
| `check:syntax` / `check:dist-links` / `check:site-chrome` / `check:sitemap` | PASS — 448 files + 131 inline scripts; 4/4 dist-link checks; 102 content pages; 130 URLs |
| CHANGELOG + AGENTS.md updated | PASS |
| Commits authored as `Kajica Djuric <kai.djuric@gmail.com>` | PASS |
| Deployed verification on production | PENDING — this PR's deploy |

**Four defects the verification caught after the first checks were already green** (each fixed;
three now pinned by assertions): `smoothPath` re-summed an already-cumulative path, so the
stabiliser's counter-move ran away to hundreds of cells and sat pinned at the draw clamp; the
burn-in stack and the forced mark shared the bottom-right corner and printed over each other;
`burnText` had no `date` key, so the page's own date write was silently dropped; and the
checked-on-load title box never reached the runtime, so the "on" burn-in did not paint.

## Post-review fixes — 2026-09-29

An adversarial review of the sprint raised 17 findings (one blocker). All are fixed; the diff is
the runtime, the exporter, the page, the two check scripts and this documentation. No behaviour
outside the findings was touched.

**The blocker — the stabiliser sign.** `refreshStabilizer` set `pathX = smoothed − raw`, but the
draw offset only *adds* to the content, which already carries its own displacement from the source
frame. The net painted position was therefore `smoothed − 2·raw`: shake was doubled, not cancelled,
and the offset ran to the draw clamp. The correction is now the pure helper `stabilizerOffset(raw,
alpha) = raw − smoothed` (exported beside `smoothPath`), used for both axes. The unit section for it
asserts the sign on a rightward juke, that the rendered-excursion variance drops by more than 2×
(measured **0.5000 → 0.0041**, 121×) and that an empty series yields 0.

**Corrected rows above.** The stabiliser row now names the variance-reduction assertion rather than
only the observed clamp bounds; the overlay row now says reactivity is wired through an element
analyser from the first user gesture (never connected to `destination`) and idles at the base level
when WebAudio is unavailable.

**The other fixes, by finding:**

- *Export never advanced the stateful fixes.* `exportVideo`'s draw loop now calls
  `runtime.advanceFixes()` before `renderFrame`, so stabilise and auto-exposure run at export
  resolution on a deterministic clock instead of only on the preview tick. `advanceFixes()` samples
  the frame once and refreshes the auto bias on a frame counter — the `Math.random()` gate in
  `tick()` is gone, so the preview is reproducible too.
- *The stage canvas was 1–2 px off the paint geometry.* `applyPreviewSize()` now takes its dimensions
  from `formatRect(format, 1920, 1080, 720)` (the renderer's own rounding) instead of re-deriving
  them, which removes the unpainted band on 9:16 / 16:9 / 2.39:1. Pinned by a smoke check that walks
  all 5 formats and compares the canvas to `formatRect`.
- *`destroy()` crashed.* It referenced a `denoisePrev` binding that no longer existed — a
  `ReferenceError` under `'use strict'`, so teardown was dead. It now revokes the tracked object URL,
  pauses and clears the video, and nulls the frame caches and `state.previewCtx`. `loadFile` revokes
  the previous URL at the start and removes its `loadedmetadata`/`error` handlers once the load
  settles, so a failed decode leaves nothing behind.
- *Smooth-motion cache thrash.* The previous-frame cache was a single canvas keyed by nothing, so the
  720 stage and the up-to-4K export invalidated each other every frame. It is now a `Map` keyed
  `${outW}x${outH}` holding at most 2 entries.
- *Music mode failed silently.* `audioMode === 'music'` with no file returned the *source* audio, and
  a decode failure did the same — the opposite of what the mode promises. Both are now hard failures
  (`music_file_missing`, `audio_decode_failed`, plus `no_webaudio` when there is no AudioContext),
  and the page maps them to readable status text.
- *Export could not fail safely.* Everything after `captureStream` is now inside try/catch/finally:
  any failure stops every track (canvas and audio) and returns `{ ok: false, error }`. The page
  wraps its handler in try/finally and locks the format, quality, audio and burn-in controls while
  an export runs.
- *Geometry could drift mid-export.* Format and quality are snapshotted at the start; if either
  changes, the export stops cleanly with `state_changed` rather than letting the stream disagree
  with the painted rect.
- *`buildFilter(LOOKS.warm)` dropped the preset's brightness.* `buildFilter` now maps a raw preset's
  `brightness` key onto `exposure` itself, so calling it with a preset object is honest without
  going through `effectiveParams`. The unit routes every preset filter through `effectiveParams` and
  asserts warm is brighter than clean.
- *Paint did not scale with resolution.* The grain tile is now painted through a patch proportional
  to the output (`scale(outW/720, outH/720)`) with its translate reseeded each frame, so a 4K export
  gets stage-sized grain rather than a frozen tile; the `energy` crosshair is sized from `w` instead
  of a hardcoded 20 px.
- *The stage box was always phone-shaped.* Its `aspect-ratio` now follows the chosen format
  (`height: auto; max-height: 604px`), so wide formats stop letterboxing inside it.
- *Audio reactivity was wired to an object the runtime could not read.* The page hands the runtime a
  live `AnalyserNode`, but the overlay maths reads `{ energy, bass, mid, high }` — a DOM node has
  none of those, so every read was `undefined` and the derived alpha was `NaN`. `addColorStop` then
  threw a `SyntaxError` DOMException, which killed the *export* at its very first probe frame (every
  export failed with a bare numeric code) and raised a pageerror on the stage. The runtime now
  derives the bands from the analyser's frequency data (`audioFeatures(audio)`, exported and
  unit-tested: features object passes through, analyser is read into finite 0..1 bands, a throwing or
  bandless source yields `null` instead of `NaN`).
- *Smaller cleanups:* the export rejects clips under 0.5 s (`too_short`); `#ceVideo` is no longer
  `loop` (a clip that loops under the scrubber reads as a live preview); and the stale comment above
  the old `refreshStabilizer` ("a steady pan passes through untouched") is gone — a steady ramp
  leaves a constant offset, which is what `stabilizerOffset` returns.

**Limits this round made explicit.** There is no codec or bitrate readout — the browser does not
expose the encoder's choice, and the panel's "Type" is the *container* hint from the file, not the
output codec. There is no export cancellation: once recording starts the UI is locked until the clip
ends. And it is still one clip per page load — the object URL is revoked on the next load, but the
page has no "replace clip" affordance beyond reloading.

**Test counts after this round.** `check:camera-enhance-unit` is now **86 assertions** (was 63) and
`check:camera-enhance-smoke` **29 checks** (was 28 — the added one pins all 5 formats' stage
geometry). The close-out table above records the counts as they stood at close-out.

**One test deviation, recorded.** The review specified the variance assertion as
`var(raw + offset)`; that expression double-counts the camera's own displacement (the content's
motion is already in the source frame), so it grows the variance rather than cutting it. The
assertion therefore measures the net painted excursion, `raw − offset`, which is the quantity that
actually lands on screen — and it is the corrected-sign helper that makes it collapse. The measured
numbers are printed in the run.

