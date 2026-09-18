# The Export-First Renderer

**Slug:** recorder-renderer
**Surfaces:** recorder, engine, versions, transitions, library
**One-line:** A working animator who treats the engine as a render farm that outputs WebM via MediaRecorder and converts to MP4 with ffmpeg.

## Who they are

You ship thirty-second explainer videos for B2B clients out of a one-room office above a laundromat. After Effects handles the character work; everything else goes through the browser because the render queue in AE is forty minutes for the same thirty seconds the engine produces in real time. You keep a NAS in the closet that holds every render you have ever shipped. You have one browser tab open all day, and it is usually pointed at the engine.

## What they're trying to do

You want to drop a client's thirty-second voiceover into `/engine`, stack three library stills behind it, lock the variant at `/versions/grid.html` because the grid reads as "data" to a B2B audience, fire `flash-cover` transitions on the cuts between sections of the voiceover, and record a WebM via MediaRecorder. You convert the WebM to MP4 with `ffmpeg -i input.webm -c:v libx264 -crf 18 output.mp4`, drop the MP4 into your NAS, and ship it to the client. You never open After Effects for the explainer work anymore.

## The surfaces they live in

1. **The MediaRecorder WebM export** is the file format your entire downstream pipeline assumes. Every render is a WebM capture that you transcode in ffmpeg; the moment the recorder stops outputting WebM, your pipeline stops working.
2. **`/engine`** is your render farm. You drop the voiceover, stack the library, lock the look, hit record, walk away.
3. **`/versions/grid.html`** is the variant you reach for most often for B2B work, because the grid reads as structure to a client who has never heard the word "generative" before.
4. **The transitions** are mostly `flash-cover` (500 ms) for section cuts and `whip-blur` (450 ms) for hard resets.
5. **The library** holds eighty stills you have licensed from a stock library, tagged by industry.

## A typical session (90–180 minutes)

You open `/engine`, drop the client's thirty-second voiceover. The engine detects BPM 0 (speech) and shows the waveform. You load three library stills: `c01-data-room.jpg`, `c02-network-diagram.jpg`, `c03-server-rack.jpg`. You open `/versions/grid.html` to lock the variant.

You mark four section boundaries in the voiceover at 0:08, 0:16, 0:22, 0:28 and fire `flash-cover` at each. You hit record. The MediaRecorder captures thirty seconds of WebM. You run `ffmpeg -i take-01.webm -c:v libx264 -crf 18 -c:a aac take-01.mp4` in terminal. The MP4 lands in your Downloads.

You preview the MP4 in QuickTime. There is a 200 ms audio gap at 0:08. You re-record with the WebM export and accept the gap as the engine's audio pipeline behavior — it is the price of browser-native rendering, and the client will never hear it. You ship the MP4.

There is a moment, around the audio gap, when AE looks very attractive again. You almost switched back. Then you remembered AE's render queue is forty minutes for the same thirty seconds, and the gap is invisible to the client who asked for the video on Wednesday and is getting it on Wednesday.

## What they'd pay for

A flat $200/year "render farm" tier that unlocked 4K WebM capture and concurrent multi-take recording — so you can capture three takes of the same scene and pick the best without re-running the timeline. You would not pay per render; you would not pay a monthly fee; you would pay a flat annual fee and stop thinking about it.

## What would make them leave

The recorder dropping MediaRecorder support for anything other than WebM. Your ffmpeg pipeline assumes WebM input; the moment the recorder switches to MP4 or to a custom container, your local pipeline stops working and you would have no reason to come back. You would also leave if the recorder added a "render in our cloud" upsell; you have a NAS and you trust your local pipeline more than you trust a vendor's.

## Quote

"The MediaRecorder WebM export is what I trust, and the /versions/grid.html variant is what my B2B clients trust, which is why the engine replaced After Effects for 30-second explainers."