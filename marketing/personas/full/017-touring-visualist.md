# The Touring-Band Visualist

**Slug:** touring-visualist
**Surfaces:** versions, FX, transitions, AR, presets
**One-line:** A touring band's stage visualist who picks per-song variants from the 27, fires `glitch-block` on drops, and ships AR merch posters via /ar-loop at the merch table.

## Who they are

You have been on the road for six years with two different indie bands and you treat every show as its own small film. You project behind the band, you run the merch table, and you make the AR poster for the next tour leg. QLab handles the audio playback. A hard drive of tour footage handles the past. The engine handles everything in between. You learn one new tool per tour if it survives the bus.

## What they're trying to do

You want to drop each setlist track into `/engine` and pick a per-song variant from the twenty-seven (`/versions/tape.html` for the opener, `/versions/glitch.html` for the loud song, `/versions/watercolor.html` for the ballad). You fire `glitch-block` on drops, `whip-blur` on resets, and record the per-song WebM via MediaRecorder for the venue's archive. At the merch table, you drop the tour's poster GIF into `/ar-loop` on your phone and let fans record the AR scene with their own phones — which is the merch they actually take home.

## The surfaces they live in

1. **The `/versions/` directory** is where the per-song choice lives. You pick a variant per song so the visual language tracks the setlist's emotional arc, and the arc is what the audience remembers the morning after the show.
2. **The FX pipeline** is where you push `chroma` and `grain` on the loud song, `bloom` and `sepia` on the ballad. The loud song gets colder; the ballad gets warmer.
3. **The transitions** carry the setlist's punctuation. `glitch-block` (500 ms) on drops, `whip-blur` (450 ms) on resets, `flash-cover` (500 ms) on the encore.
4. **`/ar-loop`** is the merch-table poster. Fans record the AR scene with their phones and the loop travels home with them.
5. **The anchor map** locks the per-tour visual language so the band's identity is consistent across dates, even when the venue's projector is wildly different.
6. **The MediaRecorder WebM** is the per-song archive file the venue keeps.

## A typical session (90–180 minutes)

You drop the opener track. Audio analysis v2 returns BPM 104, key G major. You lock `/versions/tape.html`, push `grain=0.4`, `sepia=0.3` — warm, worn, like the band has been playing the song for a decade.

You drop the loud song. You lock `/versions/glitch.html`, push `chroma=0.6`, `grain=0.5` — cold, fractured. You drop the ballad. You lock `/versions/watercolor.html`, push `bloom=0.5`, `posterize=4` — soft, painterly.

You fire `glitch-block` on the loud song's drop, `whip-blur` on the ballad's entry, `flash-cover` on the encore. You record a per-song WebM via MediaRecorder for the venue's archive. At the merch table, you drop the tour poster GIF into `/ar-loop` on your phone; the AR scene loads, and fans record the AR scene with their own phones while you sell them the vinyl.

There is a moment, around the merch table, when the venue's Wi-Fi almost fails. You almost gave up before tethering to your phone's hotspot. The hotspot saved the merch, and the fans went home with a loop on their phone that the band never recorded as a video.

## What they'd pay for

$5/month per band for unlimited project saves and a 30-day TTL on the magic-link session — so the band's account does not lapse between tour legs. You would not pay per song; per-song pricing would punish you for writing longer setlists and the longer setlists are the gigs the band wants to play.

## What would make them leave

The twenty-seven variants collapsing into a single "theme picker" dropdown. The per-song choice is the work; a dropdown would make every show feel like the same show. You would also leave if `/ar-loop` ever required a login to view; the merch table is a no-account zone, and a login wall would erase the merch in the most literal sense.

## Quote

"The /versions/tape.html opener and the /versions/glitch.html loud song are the visual language for this tour leg, and the /ar-loop share link at the merch table is the only reason fans record the poster on their phones."