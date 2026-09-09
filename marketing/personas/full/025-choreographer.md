# The Choreographer

**Slug:** choreographer
**Surfaces touched (3+ minimum):** engine, FX, AR, versions, audio-analysis, presets
**One-line:** A choreographer who sonifies the dancers' movements by mapping the chromagram to the FX pipeline's chroma uniform and projecting an AR mirror in the studio.

## Who they are
You are a choreographer in your late thirties who has been making work for fifteen years and who has started using visuals in rehearsals because some dancers learn by watching the movement reflected back. You are not a coder and you have never opened After Effects. Your toolbelt is a studio with a projector, a folder of rehearsal recordings, and a willingness to learn one new tool per year if it helps the dancers.

## What you're trying to do
You want to drop a rehearsal recording into /engine, read the chromagram from audio-analysis v2 to find the loudest peaks, and push the FX pipeline's `chroma` uniform on each peak so the visual mirrors the dancers' weight shifts. You project the visual in the studio via /versions/spectrum.html (so the chromagram is visible) and drop the rehearsal WebM into /ar-loop on your phone so the dancers can walk around the projected loop on the studio floor.

## Which surfaces they actually use, and why
1. **/engine** — the compositor where you stack the rehearsal recording and the studio visuals.
2. **FX pipeline** — you push `chroma` on each chromagram peak so the visual mirrors the weight shifts; you push `chroma=0.5` for the heavy movements, `chroma=0.2` for the light ones.
3. **/ar-loop** — the studio's phone projects the rehearsal WebM as a markerless AR loop on the studio floor.
4. **Versions** — you lock /versions/spectrum.html so the chromagram is visible to the dancers.
5. **Audio analysis v2** — the chromagram tells you where the loudest peaks are; you map each peak to a weight shift.
6. **Presets** — you assign `phosphor` for the fast piece, `kraft` for the slow one.

## A typical session (90-180 minutes)
1. You drop the rehearsal recording, audio-analysis v2 returns chromagram weighted on the dancers' footsteps and the breath cues.
2. You mark the loudest peaks and map each to a weight shift in the choreography.
3. You push `chroma=0.5` on the heavy movements and `chroma=0.2` on the light ones.
4. You lock /versions/spectrum.html so the chromagram is visible.
5. You project the visual in the studio via the engine's render loop.
6. You drop the rehearsal WebM into /ar-loop on your phone; the AR scene loads and the loop floats on the studio floor.
7. You almost quit at step 6 — the studio's Wi-Fi almost failed to load /ar-loop because the studio is in a basement. You almost gave up before tethering to your phone's hotspot.

## What they'd pay for
You would pay a flat $100/year for a "studio tier" that unlocked longer AR recordings (30s instead of 5s) and a custom share-link domain so the studio's firewall does not block it. You would not pay a monthly fee.

## What would make them leave
You would leave forever if /ar-loop required a login to view, because the dancers do not have accounts and the studio's firewall does not support OAuth. You would tolerate the 5-second AR record limit forever — it is enough for a take-home.

## Quote
"The /versions/spectrum.html chromagram on the rehearsal recording and the /ar-loop loop on the studio floor are the only reason the dancers can see their own weight shifts reflected back, and the audio-analysis chromagram is the only reason the visual matches the breath."
