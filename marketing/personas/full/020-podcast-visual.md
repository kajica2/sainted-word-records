# The Podcast Visual Editor

**Slug:** podcast-visual-editor
**Surfaces touched (3+ minimum):** audio-analysis, library, recorder, FX, engine
**One-line:** A podcast editor who makes 10-second visual hooks per episode by mapping the chromagram peaks to library stills and recording the WebM for YouTube Shorts.

## Who they are
You are a podcast editor in your early thirties who has been cutting weekly episodes for three years and who started making YouTube Shorts to promote each episode because the podcast platform's discoverability is dying. You are not a motion designer but you have learned just enough of the engine to deliver a hook the same day the episode drops. Your toolbelt is Hindenburg, a folder of stock stills, and a willingness to learn one new tool per quarter.

## What you're trying to do
You want to drop the episode's first 60 seconds into /engine, read the chromagram from audio-analysis v2 to find the three loudest peaks, and assign a library still to each peak (the guest's headshot on the first peak, the topic's stock photo on the second, the show's logo on the third). You push `chroma=0.4` on the peaks so the stills read as motion, and you record a 10-second WebM via MediaRecorder for the YouTube Shorts upload.

## Which surfaces they actually use, and why
1. **Audio analysis v2** — the chromagram tells you where the loudest peaks are; you assign a still to each peak.
2. **Library** — your library is 80 stock stills tagged by topic (politics, tech, culture).
3. **Recorder** — you record a 10-second WebM per episode for the YouTube Shorts upload.
4. **FX pipeline** — you push `chroma=0.4` on the peaks so the stills read as motion; you push `grain=0.2` so the canvas does not look sterile.
5. **Engine** — the render surface where you stack the stills per peak.

## A typical session (90-180 minutes)
1. You drop the episode's first 60 seconds, audio-analysis v2 returns chromagram weighted on the guest's voice's fundamental and the topic's two keywords.
2. You mark the three loudest peaks at 4s, 22s, 41s.
3. You assign stills: `guest-headshot.jpg` at 4s, `topic-stock.jpg` at 22s, `show-logo.jpg` at 41s.
4. You push `chroma=0.4` on the peaks and `grain=0.2` so the canvas does not look sterile.
5. You record a 10-second WebM via MediaRecorder for the YouTube Shorts upload.
6. You upload the WebM to YouTube Shorts and paste the episode link in the description.
7. You almost quit at step 4 — `chroma=0.4` looked like a glitch at first. You almost reverted before realizing the chromatic offsets make the stills read as motion, and YouTube Shorts needs motion to surface the video.

## What they'd pay for
You would pay $5/month for a "podcast tier" that unlocked longer WebM capture (60 seconds instead of 10) so you can author 60-second hooks for Twitter. You would not pay per episode.

## What would make them leave
You would leave forever if MediaRecorder dropped WebM support, because your upload pipeline assumes WebM input. You would tolerate the 10-second record limit forever — it is enough for a YouTube Shorts hook.

## Quote
"The audio-analysis chromagram tells me where the three loudest peaks are, the FX pipeline's chroma uniform on the peaks is what makes the stills read as motion, and the MediaRecorder WebM is what YouTube Shorts gets."
