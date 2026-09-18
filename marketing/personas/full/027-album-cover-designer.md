# The Album Cover Designer

**Slug:** album-cover-designer
**Surfaces:** versions, presets, FX, recorder, engine
**One-line:** An album cover designer who picks the variant per track, freezes the cover frame at the chromagram peak, and records the still as a PNG.

## Who they are

You have been making covers for indie labels for five years and you have started using the engine for the cover because the labels expect something more than a still photo, and because the still photo stopped feeling like enough about three years ago. Photoshop and Illustrator are home; the engine is the new tool that lets you deliver a cover the same week as the album. A folder of band photos is your archive. You learn one new tool per year if it survives the deadline, and the deadline is most of the year.

## What they're trying to do

You want to drop the album's lead track into `/engine`, lock the variant via the anchor map (`void` for the dark album, `kraft` for the warm one, `glitch` for the loud one), stack three band photos behind the track, push `chroma=0.4` so the photos read as motion, freeze the frame at the chromagram peak, and record the still as a PNG via MediaRecorder's frame-capture mode. You send the PNG to the label for print. The PNG is what the label prints; the print is what the buyer holds.

## The surfaces they live in

1. **The `/versions/` pages** are where you lock the variant per album.
2. **The anchor map** is where you assign one anchor per album. `void`, `kraft`, and `glitch` are your usual three; the other sixteen are waiting for an album that earns them.
3. **The FX pipeline** is where you push `chroma=0.4` so the band photos read as motion, and `grain=0.3` so the canvas does not look sterile.
4. **The MediaRecorder PNG capture** is the file the label's print pipeline assumes. Frame-capture mode is the only reason the chromagram peak can become a print-ready still.
5. **`/engine`** is the compositor where you stack the band photos behind the track.

## A typical session (90–180 minutes)

You drop the lead track. Audio analysis v2 returns BPM 128, key A minor, chromagram weighted on A and C. You lock `/versions/void.html`, push `chroma=0.4`, `grain=0.3` — cold, fractured, the way the album sounds on the third listen.

You stack three band photos: `band-01.jpg`, `band-02.jpg`, `band-03.jpg`. You freeze the frame at the chromagram peak at 1:42. You record the still as a PNG via MediaRecorder's frame-capture mode. You send the PNG to the label for print.

There is a moment, around the frame capture, when the capture almost failed because you tried to capture during a transition. You almost gave up before pausing the playback and re-capturing. The pause saved the cover. The cover went to the label.

## What they'd pay for

$10/month for a "print tier" that unlocked 300 DPI PNG export and CMYK color space so the label does not have to convert. You would not pay per album; per-album pricing would punish you for the albums that need three covers (the first pick, the label's note pass, the photographer's note pass), and the three-cover albums are the ones the labels remember.

## What would make them leave

The recorder dropping frame-capture mode. The print pipeline assumes PNG input, and the moment the recorder switches to WebM-only or to MP4, the label's print shop stops accepting the file and you would have no reason to come back. You would also leave if the chromagram rendering ever drifted between sessions — designers need to see the same peak the previous session saw, and a surprise variation is a surprise the print run cannot absorb.

## Quote

"The /versions/void.html variant on the lead track and the MediaRecorder PNG at the chromagram peak are what the label's print pipeline gets, which is why the engine replaced the stock photo templates."