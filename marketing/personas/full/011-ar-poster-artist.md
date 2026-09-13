# The AR Poster Artist

**Slug:** ar-poster-artist
**Surfaces touched (3+ minimum):** engine, AR, recorder, presets, transitions
**One-line:** A visual artist who makes AR posters of their own tracks by compositing a song into the engine, exporting a 5-second WebM, and dropping it into /ar-loop for markerless placement in galleries.

## Who they are
You are a visual artist in your mid-thirties who also makes music and who has been showing in small galleries for ten years. You treat every show as a chance to merge the two practices, but the technical bridge has always been a headache. Your toolbelt is Procreate, a Tascam field recorder, and a friend who knows A-Frame just well enough to be dangerous.

## What they're trying to do
You want to record a 30-second loop in your studio, drop it into /engine, lock the variant at /versions/eclipse.html because the gallery curator wants a "lunar" feel, stack three of your own paintings behind the loop, fire a `chromatic-split` transition at the halfway mark, and export a 5-second WebM via MediaRecorder. You take the WebM to the gallery, drop it into /ar-loop on your phone, and watch the loop float at the gallery entrance during the opening. Visitors record the AR scene with their own phones and the WebM spreads via the share link.

## Which surfaces they actually use, and why
1. **/engine** — the compositor where you stack the loop, the paintings, and the FX stack.
2. **/versions/eclipse.html** — the variant you choose for the "lunar" feel; the eclipse variant's chroma and grain uniforms match the gallery's brief.
3. **Presets** — you pick the `eclipse` preset at warmth=0.2, intensity=0.8 because the chromagram of your track is heavily weighted on F and Ab.
4. **Transitions** — `chromatic-split` (500ms) at the halfway mark because the gallery brief asked for a "phase shift."
5. **Recorder** — the WebM capture that becomes the AR asset.
6. **/ar-loop** — the markerless AR scene that floats the WebM in the gallery.

## A typical session (90-180 minutes)
1. You drop your 30-second loop into /engine, audio-analysis-v2 returns BPM=72, key=F minor, chromagram weighted on F and Ab.
2. You lock /versions/eclipse.html, push `chroma=0.4`, `grain=0.3`, `temp=-0.3` (cold eclipse).
3. You stack three of your paintings (one per layer in the engine's layers panel).
4. You fire `chromatic-split` at the 15-second mark — the transition resolves cleanly at 500ms.
5. You record a 5-second WebM via MediaRecorder, save as `eclipse-loop-take-01.webm`.
6. You take the WebM to the gallery and drop it into /ar-loop on your phone; the A-Frame scene loads and the loop floats at the marker origin.
7. You record a 5-second WebM of the AR scene itself (the AR scene records its own WebM), save as `eclipse-ar-take-01.webm`.
8. You share the AR link via the share button — the link works without a login.
9. You almost quit at step 7 — the AR scene's recorder almost failed because the gallery's Wi-Fi was slow. You almost gave up before the second take landed.

## What they'd pay for
You would pay a flat $100/year for a "gallery tier" that unlocked longer AR recordings (the current 5s is too short for a poster that needs to be observed) and a custom share-link domain. You would not pay a monthly fee.

## What would make them leave
You would leave forever if the AR scene started requiring a login to view, because the share link is the only way the loop reaches visitors who did not commit to an account. You would tolerate the 5-second AR record limit forever — it is enough for a poster.

## Quote
"The engine's /versions/eclipse.html variant on my track, the MediaRecorder WebM, and the /ar-loop share link are the only reason my poster opened at the gallery without a login."
