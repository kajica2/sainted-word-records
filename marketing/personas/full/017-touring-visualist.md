# The Touring-Band Visualist

**Slug:** touring-visualist
**Surfaces touched (3+ minimum):** versions, FX, transitions, AR, presets
**One-line:** A touring band's stage visualist who picks per-song variants from the 26, fires `glitch-block` on drops, and ships AR merch posters via /ar-loop at the merch table.

## Who they are
You are a touring band's visualist in your early thirties who has been on the road for six years with two different indie bands and who treats every show as its own small film. You project behind the band, you run the merch table, and you make the AR poster for the next tour leg. Your toolbelt is QLab, a hard drive of tour footage, and a willingness to learn one new tool per tour if it survives the bus.

## What they're trying to do
You want to drop each setlist track into /engine and pick a per-song variant from the 26 (`/versions/tape.html` for the opener, `/versions/glitch.html` for the loud song, `/versions/watercolor.html` for the ballad). You fire `glitch-block` on drops, `whip-blur` on resets, and record the per-song WebM via MediaRecorder for the venue's archive. At the merch table, you drop the tour's poster GIF into /ar-loop on your phone and let fans record the AR scene with their own phones.

## Which surfaces they actually use, and why
1. **Versions (26 variants)** — you pick a variant per song so the visual language tracks the setlist's emotional arc.
2. **FX pipeline** — you push `chroma` and `grain` on the loud song, `bloom` and `sepia` on the ballad.
3. **Transitions** — `glitch-block` (500ms) on drops, `whip-blur` (450ms) on resets, `flash-cover` (500ms) on the encore.
4. **/ar-loop** — the merch-table poster that fans record on their phones.
5. **Presets** — you lock the per-tour visual language via the anchor map so the band identity is consistent across dates.
6. **Recorder** — you record a per-song WebM for the venue's archive.

## A typical session (90-180 minutes)
1. You drop the opener track, audio-analysis v2 returns BPM=104, key=G major.
2. You lock /versions/tape.html, push `grain=0.4`, `sepia=0.3` (warm, worn).
3. You drop the loud song, lock /versions/glitch.html, push `chroma=0.6`, `grain=0.5` (cold, fractured).
4. You drop the ballad, lock /versions/watercolor.html, push `bloom=0.5`, `posterize=4` (soft, painterly).
5. You fire `glitch-block` on the loud song's drop, `whip-blur` on the ballad's entry, `flash-cover` on the encore.
6. You record a per-song WebM via MediaRecorder for the venue's archive.
7. At the merch table, you drop the tour poster GIF into /ar-loop on your phone; the AR scene loads, fans record the AR scene.
8. You almost quit at step 7 — the venue's Wi-Fi almost failed at the merch table. You almost gave up before tethering to your phone's hotspot.

## What they'd pay for
You would pay $5/month per band for unlimited project saves and a 30-day TTL on the magic-link session (so the band's account does not lapse between tour legs). You would not pay per song.

## What would make them leave
You would leave forever if the 26 variants collapsed into a single "theme picker" dropdown, because the per-song choice is the work. You would tolerate the venue Wi-Fi dependency forever — you have a phone hotspot.

## Quote
"The /versions/tape.html opener and the /versions/glitch.html loud song are the visual language for this tour leg, and the /ar-loop share link at the merch table is the only reason fans record the poster on their phones."
