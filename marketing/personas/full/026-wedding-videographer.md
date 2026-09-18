# The Wedding Videographer

**Slug:** wedding-videographer
**Surfaces:** engine, presets, versions, recorder, library, transitions
**One-line:** A wedding videographer who authors a 3-minute highlight reel per wedding by stacking ceremony clips, locking the variant via the anchor map, and recording a WebM for the couple.

## Who they are

You shoot thirty weddings a year and you have started using the engine for the highlight reel because the couples expect something more cinematic than a slideshow, and because the slideshow templates stopped feeling cinematic about five years ago. Premiere is home; the engine is the new tool that lets you deliver a 3-minute reel the same week as the wedding. A folder of ceremony clips is your archive. You learn one new tool per year if it survives the season, and the season is most of the year.

## What they're trying to do

You want to drop the ceremony audio (the vows, the first dance, the toasts) into `/engine`, stack twenty short clips from the day behind the audio, lock the variant via the anchor map (`kraft` for the ceremony, `gallery` for the first dance, `phosphor` for the toasts), fire `whip-blur` between sections, and record a three-minute WebM via MediaRecorder. You upload the WebM to a private Vimeo link and ship it to the couple. The couple shows the reel at the anniversary dinner; the reel is what survives the wedding.

## The surfaces they live in

1. **`/engine`** is the compositor where you stack the ceremony clips and the audio.
2. **The anchor map** is where you assign one anchor per section. `kraft` for the ceremony (warm, organic); `gallery` for the first dance (soft, painterly); `phosphor` for the toasts (cool, modern). The mapping is in the agency's mood board.
3. **The `/versions/` pages** are where you lock the variant per section.
4. **The MediaRecorder WebM** is the three-minute file per wedding for the couple's private Vimeo.
5. **The library** holds twenty short clips per wedding, tagged by section — ceremony, first dance, toasts.
6. **The `whip-blur` transition** at 450 ms between sections reads as motion, not as a hard cut.

## A typical session (90–180 minutes)

You drop the vows audio. Audio analysis v2 returns BPM 72 (the bride's breath), key D major. You lock `/versions/kraft.html`, push `sepia=0.5`, `grain=0.4` — warm, organic, the way the chapel smelled.

You stack five ceremony clips: `vows-01.mp4` through `vows-05.mp4`. You drop the first dance audio, lock `/versions/gallery.html`, push `bloom=0.5`, `posterize=4` — soft, painterly, the way the first dance looked. You drop the toasts audio, lock `/versions/phosphor.html`, push `glow=0.5`, `bloom=0.4` — cool, modern, the way the toasts sounded.

You fire `whip-blur` at each section boundary (3:00, 6:00, 9:00). You record a three-minute WebM via MediaRecorder. You upload the WebM to Vimeo and ship the private link to the couple.

There is a moment, around the upload, when the WebM almost exceeds Vimeo's 4 GB cap because you recorded at 4K. You almost re-rendered at 1080p before remembering Vimeo has a 4K tier. The tier saved the reel. The reel went home with the couple.

## What they'd pay for

$20/month for a "wedding tier" that unlocked 4K WebM capture and a private Vimeo upload pipeline so you do not have to manually upload. You would not pay per wedding; per-wedding pricing would punish you for the weddings where the couple wants more reels, and the more-reel weddings are exactly the bookings worth keeping.

## What would make them leave

MediaRecorder dropping WebM support. Your Vimeo pipeline assumes WebM input, and the moment the recorder switches to MP4 or to a custom container, the upload stops working and you would have no reason to come back. You would also leave if the anchor map ever added a "wedding preset" that picked for you — the couples expect you to pick the anchor per section, and a preset that picked for you would erase exactly the craft the couples are paying for.

## Quote

"The /versions/kraft.html vows and the /versions/phosphor.html toasts are the visual language for each wedding, and the MediaRecorder WebM is what the couple's private Vimeo link embeds, which is why the engine replaced the slideshow templates."