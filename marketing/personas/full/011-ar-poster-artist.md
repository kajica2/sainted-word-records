# The AR Poster Artist

**Slug:** ar-poster-artist
**Surfaces:** engine, AR, recorder, presets, transitions
**One-line:** A visual artist who makes AR posters of their own tracks by compositing a song into the engine, exporting a 5-second WebM, and dropping it into /ar-loop for markerless placement in galleries.

## Who they are

You have been showing in small galleries for ten years and you also make music, and you have always wanted to merge the two practices at an opening. The technical bridge has been a headache. Procreate handles the paintings; a Tascam field recorder handles the music; the bridge between them has historically been a friend who knows A-Frame just well enough to be dangerous. The engine is the first time the bridge has been a tool you can run yourself.

## What they're trying to do

You want to record a thirty-second loop in your studio, drop it into `/engine`, lock the variant at `/versions/eclipse.html` because the gallery curator asked for a "lunar" feel, stack three of your own paintings behind the loop, fire a `chromatic-split` transition at the halfway mark, and export a five-second WebM via MediaRecorder. You take the WebM to the gallery, drop it into `/ar-loop` on your phone, and watch the loop float at the gallery entrance during the opening. Visitors record the AR scene with their own phones and the WebM spreads via the share link.

## The surfaces they live in

1. **`/engine`** is the compositor where you stack the loop, the paintings, and the FX stack. It is the only place in your practice where music and image live in the same window.
2. **`/versions/eclipse.html`** is the variant for the lunar feel; the eclipse variant's chroma and grain uniforms match the gallery's brief without further adjustment.
3. **The `eclipse` preset** at warmth 0.2, intensity 0.8 is the choice you keep reaching for, because the chromagram of your track is heavily weighted on F and Ab and the eclipse palette sits exactly where those pitches live.
4. **The `chromatic-split` transition** at the halfway mark answers the gallery brief's "phase shift." 500 ms is the duration that reads as a phase shift and not as a glitch.
5. **The MediaRecorder WebM** is the file that becomes the AR asset.
6. **`/ar-loop`** is the markerless AR scene that floats the WebM in the gallery. The share link is what reaches the visitors who did not commit to an account.

## A typical session (90–180 minutes)

You drop your thirty-second loop into `/engine`. Audio analysis v2 returns BPM 72, key F minor, chromagram weighted on F and Ab. You lock `/versions/eclipse.html`, push `chroma=0.4`, `grain=0.3`, `temp=−0.3` — a cold eclipse. You stack three of your paintings (one per layer in the engine's layers panel).

You fire `chromatic-split` at the fifteen-second mark. The transition resolves cleanly at 500 ms. You record a five-second WebM via MediaRecorder, save as `eclipse-loop-take-01.webm`. You take the WebM to the gallery and drop it into `/ar-loop` on your phone; the A-Frame scene loads and the loop floats at the marker origin.

You record a five-second WebM of the AR scene itself — the AR scene records its own WebM — save as `eclipse-ar-take-01.webm`. You share the AR link via the share button. The link works without a login.

There is a moment, around the second AR recording, when the gallery's Wi-Fi slows the recorder almost to a stop. You almost gave up. Then the second take landed, and the opening was saved by the Wi-Fi holding out for thirty seconds longer than you thought it would.

## What they'd pay for

A flat $100/year for a "gallery tier" that unlocked longer AR recordings (the current five-second limit is too short for a poster that needs to be observed) and a custom share-link domain. You would not pay a monthly fee; galleries are not recurring revenue, and a one-time annual fee matches the practice.

## What would make them leave

The AR scene starting to require a login to view. The share link is the only way the loop reaches visitors who did not commit to an account, and a login wall would erase exactly the audience you built the AR poster for. You would also leave if the markerless AR ever became marker-based; the markerless constraint is what lets the loop float anywhere in the gallery without the curator having to plan a marker placement.

## Quote

"The engine's /versions/eclipse.html variant on my track, the MediaRecorder WebM, and the /ar-loop share link are the only reason my poster opened at the gallery without a login."