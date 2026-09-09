# The Export-First Renderer

**Slug:** recorder-renderer
**Surfaces touched (3+ minimum):** recorder, engine, versions, transitions, library
**One-line:** A working animator who treats the engine as a render farm that outputs WebM via MediaRecorder and converts to MP4 with ffmpeg.

## Who they are
You are a working animator in your late twenties who ships 30-second explainer videos for B2B clients and who is tired of After Effects' render times. You keep one browser tab open all day. Your toolbelt is AE for character work, a hand-rolled ffmpeg pipeline for transcode, and a NAS where you keep every render you have ever shipped.

## What they're trying to do
You want to drop a client's 30-second voiceover into /engine, stack three library clips behind it, lock the variant at /versions/grid.html because the grid reads as "data" to a B2B audience, fire `flash-cover` transitions on the cuts between sections of the voiceover, and record a WebM via MediaRecorder. You convert the WebM to MP4 via ffmpeg (`ffmpeg -i input.webm -c:v libx264 -crf 18 output.mp4`), drop the MP4 into your NAS, and ship it to the client without ever opening AE.

## Which surfaces they actually use, and why
1. **Recorder (MediaRecorder + WebM)** — the surface you spend the most time on; every render is a WebM capture that you transcode in ffmpeg.
2. **Engine** — the render farm; you drop the voiceover, stack the library, lock the look.
3. **/versions/grid.html** — the variant you choose most often for B2B work because the grid reads as structure.
4. **Transitions** — `flash-cover` (500ms) for section cuts, `whip-blur` (450ms) for hard resets.
5. **Library** — your library is 80 stills you have licensed from a stock library, tagged by industry.

## A typical session (90-180 minutes)
1. You open /engine, drop the client's 30-second voiceover, the engine detects BPM=0 (speech) and shows the waveform.
2. You load three library stills: `c01-data-room.jpg`, `c02-network-diagram.jpg`, `c03-server-rack.jpg`.
3. You open /versions/grid.html to lock the variant.
4. You mark four section boundaries in the voiceover at 0:08, 0:16, 0:22, 0:28 and fire `flash-cover` at each.
5. You hit record, capture a 30-second WebM via MediaRecorder.
6. You run `ffmpeg -i take-01.webm -c:v libx264 -crf 18 -c:a aac take-01.mp4` in terminal — the MP4 lands in your Downloads.
7. You preview the MP4 in QuickTime, notice a 200ms audio gap at 0:08, re-record with the WebM export and accept the gap as the engine's audio pipeline behavior.
8. You ship the MP4 to the client.
9. You almost quit at step 7 — the audio gap almost made you go back to AE. You almost did before realizing AE's render queue is 40 minutes for the same 30 seconds and the gap is invisible to the client.

## What they'd pay for
You would pay a flat $200/year for a "render farm" tier that unlocked 4K WebM capture and concurrent multi-take recording (so you can capture three takes of the same scene and pick the best without re-running the timeline). You would not pay per render.

## What would make them leave
You would leave forever if the recorder dropped MediaRecorder support for anything other than WebM, because your ffmpeg pipeline assumes WebM input. You would tolerate the 200ms audio gap forever — it is the price of browser-native rendering.

## Quote
"The MediaRecorder WebM export is what I trust, and the /versions/grid.html variant is what my B2B clients trust, which is why the engine replaced After Effects for 30-second explainers."
