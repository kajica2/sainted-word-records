# The Wedding Videographer

**Slug:** wedding-videographer
**Surfaces touched (3+ minimum):** engine, presets, versions, recorder, library, transitions
**One-line:** A wedding videographer who authors a 3-minute highlight reel per wedding by stacking ceremony clips, locking the variant via the anchor map, and recording a WebM for the couple.

## Who they are
You are a wedding videographer in your early thirties who shoots 30 weddings a year and who has started using the engine for the highlight reel because the couples expect something more cinematic than a slideshow. You work in Premiere for the cut and you have learned just enough of the engine to deliver a 3-minute reel the same week as the wedding. Your toolbelt is Premiere, a folder of ceremony clips, and a willingness to learn one new tool per year if it survives the season.

## What you're trying to do
You want to drop the ceremony audio (the vows, the first dance, the toasts) into /engine, stack 20 short clips from the day behind the audio, lock the variant via the anchor map (`kraft` for the ceremony, `gallery` for the first dance, `phosphor` for the toasts), fire `whip-blur` between sections, and record a 3-minute WebM via MediaRecorder. You upload the WebM to a private Vimeo link and ship it to the couple.

## Which surfaces they actually use, and why
1. **/engine** — the compositor where you stack the ceremony clips and the audio.
2. **Presets (anchor map)** — you assign one anchor per section; `kraft` for the ceremony, `gallery` for the first dance, `phosphor` for the toasts.
3. **Versions** — you lock the variant per section via the version pages.
4. **Recorder** — you record a 3-minute WebM per wedding for the couple's private Vimeo.
5. **Library** — your library is 20 short clips per wedding, tagged by section (ceremony, first dance, toasts).
6. **Transitions** — `whip-blur` (450ms) between sections so the shift reads as motion.

## A typical session (90-180 minutes)
1. You drop the vows audio, audio-analysis v2 returns BPM=72 (the bride's breath), key=D major.
2. You lock /versions/kraft.html, push `sepia=0.5`, `grain=0.4` (warm, organic).
3. You stack five ceremony clips: `vows-01.mp4` through `vows-05.mp4`.
4. You drop the first dance audio, lock /versions/gallery.html, push `bloom=0.5`, `posterize=4` (soft, painterly).
5. You drop the toasts audio, lock /versions/phosphor.html, push `glow=0.5`, `bloom=0.4` (cool, modern).
6. You fire `whip-blur` at each section boundary (3:00, 6:00, 9:00).
7. You record a 3-minute WebM via MediaRecorder.
8. You upload the WebM to Vimeo and ship the private link to the couple.
9. You almost quit at step 7 — the WebM almost exceeded Vimeo' 4GB cap because you recorded at 4K. You almost re-rendered at 1080p before remembering Vimeo has a 4K tier.

## What they'd pay for
You would pay $20/month for a "wedding tier" that unlocked 4K WebM capture and a private Vimeo upload pipeline so you do not have to manually upload. You would not pay per wedding.

## What would make them leave
You would leave forever if MediaRecorder dropped WebM support, because your Vimeo pipeline assumes WebM input. You would tolerate the 4GB cap forever — you can re-render at 1080p.

## Quote
"The /versions/kraft.html vows and the /versions/phosphor.html toasts are the visual language for each wedding, and the MediaRecorder WebM is what the couple's private Vimeo link embeds, which is why the engine replaced the slideshow templates."
