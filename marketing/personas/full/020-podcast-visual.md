# The Podcast Visual Editor

**Slug:** podcast-visual-editor
**Surfaces:** audio-analysis, library, recorder, FX, engine
**One-line:** A podcast editor who makes 10-second visual hooks per episode by mapping the chromagram peaks to library stills and recording the WebM for YouTube Shorts.

## Who they are

You have been cutting weekly podcast episodes for three years and you started making YouTube Shorts to promote each episode because the podcast platform's discoverability is dying and Shorts is where the audience is moving. You are not a motion designer but you have learned just enough of the engine to deliver a hook the same day the episode drops. Hindenburg is home. A folder of stock stills is the visual library. You learn one new tool per quarter; the quarters are getting shorter.

## What they're trying to do

You want to drop the episode's first sixty seconds into `/engine`, read the chromagram from audio analysis v2 to find the three loudest peaks, and assign a library still to each peak — the guest's headshot on the first peak, the topic's stock photo on the second, the show's logo on the third. You push `chroma=0.4` on the peaks so the stills read as motion, and you record a ten-second WebM via MediaRecorder for the YouTube Shorts upload. The hook ships the same day the episode drops; same-day is the contract.

## The surfaces they live in

1. **Audio analysis v2** is where the chromagram tells you where the loudest peaks are. You assign a still to each peak because peaks are where the stills get read.
2. **The library** holds eighty stock stills tagged by topic — politics, tech, culture. The tags are how the chromagram finds the right still for the right peak.
3. **The MediaRecorder WebM** is the file the Shorts upload pipeline assumes. You record a ten-second WebM per episode for the upload.
4. **The FX pipeline** is where you push `chroma=0.4` on the peaks so the stills read as motion. You push `grain=0.2` so the canvas does not look sterile.
5. **`/engine`** is the render surface where you stack the stills per peak.

## A typical session (90–180 minutes)

You drop the episode's first sixty seconds. Audio analysis v2 returns chromagram weighted on the guest's voice's fundamental and the topic's two keywords. You mark the three loudest peaks at 4s, 22s, 41s.

You assign stills: `guest-headshot.jpg` at 4s, `topic-stock.jpg` at 22s, `show-logo.jpg` at 41s. You push `chroma=0.4` on the peaks and `grain=0.2` so the canvas does not look sterile. You record a ten-second WebM via MediaRecorder for the YouTube Shorts upload.

You upload the WebM to Shorts and paste the episode link in the description. The Shorts feed surfaces the hook; the description sends the listener to the episode. The funnel works because the hook ships the same day.

There is a moment, around `chroma=0.4`, when the visual looks like a glitch and you almost revert it. You almost did. Then you realized the chromatic offsets make the stills read as motion, and Shorts needs motion to surface the video — a static still would die in the feed, and the episode would die with it.

## What they'd pay for

$5/month for a "podcast tier" that unlocked longer WebM capture (60 seconds instead of 10) so you can author sixty-second hooks for Twitter. You would not pay per episode; per-episode pricing would punish you for the long episodes the platform is rewarding.

## What would make them leave

MediaRecorder dropping WebM support. Your upload pipeline assumes WebM input, and the moment the recorder switches to MP4 or to a custom container, the Shorts upload stops working and you would have no reason to come back. You would also leave if the chromagram ever started returning peaks on the wrong timestamps — the peaks are where the stills go, and a mistimed peak is a mistimed still.

## Quote

"The audio-analysis chromagram tells me where the three loudest peaks are, the FX pipeline's chroma uniform on the peaks is what makes the stills read as motion, and the MediaRecorder WebM is what YouTube Shorts gets."