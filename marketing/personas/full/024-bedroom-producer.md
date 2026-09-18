# The Bedroom Producer

**Slug:** bedroom-producer
**Surfaces:** engine, presets, library, recorder, versions
**One-line:** A SoundCloud bedroom producer who picks an anchor per track, stacks two loop stills from the library, and records a 30-second WebM for the SoundCloud visual.

## Who they are

You have been putting tracks on SoundCloud for three years and you have started adding visuals to your tracks because the platform now surfaces them, and the streams follow the visuals. You are not a motion designer and you have never opened After Effects. Ableton is home. A folder of loops you have chopped is the source material. You learn one new tool per quarter if it helps the streams; the quarters are getting shorter and the streams are getting more competitive.

## What they're trying to do

You want to drop your latest track into `/engine`, lock the variant via the anchor map (`glitch` for the loud song, `phosphor` for the ambient one, `kraft` for the ballad), stack two loop stills from the library behind the track, and record a thirty-second WebM via MediaRecorder. You upload the WebM to SoundCloud as the track's visual. The visual is what the listener sees while the track plays; the visual is what makes the listener click play in the first place.

## The surfaces they live in

1. **`/engine`** is the compositor where you stack the track and the two loop stills.
2. **The anchor map** is where you assign one of the nineteen anchors per track. `glitch`, `phosphor`, and `kraft` are your usual three; the other sixteen are waiting for a track that earns them.
3. **The library** is where you pull two loop stills from per track. The stills are the only reason the visual reads as motion.
4. **The MediaRecorder WebM** is the thirty-second file per track that SoundCloud surfaces.
5. **The `/versions/` pages** are where you lock the variant per track.

## A typical session (90–180 minutes)

You drop your latest track into `/engine`. Audio analysis v2 returns BPM 140, key F# minor. You lock `/versions/glitch.html`, push `chroma=0.6`, `grain=0.5` — cold, fractured, the way the track sounds at 2 a.m.

You stack two loop stills from the library: `loop-city-traffic.mp4`, `loop-rain-window.mp4`. You record a thirty-second WebM via MediaRecorder. You upload the WebM to SoundCloud as the track's visual.

There is a moment, around the library, when the first search result for "city" is a still, not a loop, and you almost gave up before scrolling to the loop. The scroll saved the visual. The visual saved the track.

## What they'd pay for

You would not pay — you are a bedroom producer and your budget is the streaming revenue, which is a budget in name only. You would happily accept a free "indie tier" with longer WebM capture (60 seconds instead of 30) so you can author sixty-second hooks for Twitter.

## What would make them leave

MediaRecorder dropping WebM support. SoundCloud's upload pipeline assumes WebM input, and the moment the recorder switches to MP4 or to a custom container, the upload stops working and you would have no reason to come back. You would also leave if the anchor map ever added a "recommended anchor" badge — the recommendation would be exactly the kind of opinion you came here to escape, and opinion is what the streaming platforms are full of already.

## Quote

"The /versions/glitch.html variant on my track and the MediaRecorder WebM are what SoundCloud surfaces, which is why the engine replaced the After Effects tutorials I was watching."