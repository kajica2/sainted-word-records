# The Album Cover Designer

**Slug:** album-cover-designer
**Surfaces touched (3+ minimum):** versions, presets, FX, recorder, engine
**One-line:** An album cover designer who picks the variant per track, freezes the cover frame at the chromagram peak, and records the still as a PNG.

## Who they are
You are an album cover designer in your late twenties who has been making covers for indie labels for five years and who has started using the engine for the cover because the labels expect something more than a still photo. You work in Photoshop and Illustrator and you have learned just enough of the engine to deliver a cover the same week as the album. Your toolbelt is Photoshop, a folder of band photos, and a willingness to learn one new tool per year if it survives the deadline.

## What you're trying to do
You want to drop the album's lead track into /engine, lock the variant via the anchor map (`void` for the dark album, `kraft` for the warm one, `glitch` for the loud one), stack three band photos behind the track, push `chroma=0.4` so the photos read as motion, freeze the frame at the chromagram peak, and record the still as a PNG via MediaRecorder's frame-capture mode. You send the PNG to the label for print.

## Which surfaces they actually use, and why
1. **Versions** — you lock the variant per album via the version pages.
2. **Presets (anchor map)** — you assign one anchor per album; `void`, `kraft`, and `glitch` are your usual three.
3. **FX pipeline** — you push `chroma=0.4` so the band photos read as motion; you push `grain=0.3` so the canvas does not look sterile.
4. **Recorder** — you record the still frame at the chromagram peak as a PNG for the label's print pipeline.
5. **Engine** — the compositor where you stack the band photos behind the track.

## A typical session (90-180 minutes)
1. You drop the lead track, audio-analysis v2 returns BPM=128, key=A minor, chromagram weighted on A and C.
2. You lock /versions/void.html, push `chroma=0.4`, `grain=0.3` (cold, fractured).
3. You stack three band photos: `band-01.jpg`, `band-02.jpg`, `band-03.jpg`.
4. You freeze the frame at the chromagram peak at 1:42.
5. You record the still as a PNG via MediaRecorder's frame-capture mode.
6. You send the PNG to the label for print.
7. You almost quit at step 5 — the frame-capture mode almost failed because you tried to capture during a transition. You almost gave up before pausing the playback and re-capturing.

## What they'd pay for
You would pay $10/month for a "print tier" that unlocked 300 DPI PNG export and CMYK color space so the label does not have to convert. You would not pay per album.

## What would make them leave
You would leave forever if the recorder dropped frame-capture mode, because the print pipeline assumes PNG input. You would tolerate the sRGB color space forever — you can convert in Photoshop.

## Quote
"The /versions/void.html variant on the lead track and the MediaRecorder PNG at the chromagram peak are what the label's print pipeline gets, which is why the engine replaced the stock photo templates."
