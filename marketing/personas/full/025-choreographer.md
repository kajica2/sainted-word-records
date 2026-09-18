# The Choreographer

**Slug:** choreographer
**Surfaces:** engine, FX, AR, versions, audio-analysis, presets
**One-line:** A choreographer who sonifies the dancers' movements by mapping the chromagram to the FX pipeline's chroma uniform and projecting an AR mirror in the studio.

## Who they are

You have been making work for fifteen years and you have started using visuals in rehearsals because some dancers learn by watching the movement reflected back, and because the dancers who learn by watching the movement reflected back tend to be the ones who need a different kind of feedback than your verbal notes can give. You are not a coder and you have never opened After Effects. The studio has a projector. A folder of rehearsal recordings is your archive. You learn one new tool per year if it helps the dancers, and the bar is whether the dancers leave the rehearsal knowing what they came in not knowing.

## What they're trying to do

You want to drop a rehearsal recording into `/engine`, read the chromagram from audio analysis v2 to find the loudest peaks, and push the FX pipeline's `chroma` uniform on each peak so the visual mirrors the dancers' weight shifts. You project the visual in the studio via `/versions/spectrum.html` (so the chromagram is visible) and drop the rehearsal WebM into `/ar-loop` on your phone so the dancers can walk around the projected loop on the studio floor. The studio floor is the mirror; the loop is what the mirror reflects.

## The surfaces they live in

1. **`/engine`** is the compositor where you stack the rehearsal recording and the studio visuals.
2. **The FX pipeline** is where you push `chroma` on each chromagram peak so the visual mirrors the weight shifts. `chroma=0.5` for the heavy movements, `chroma=0.2` for the light ones.
3. **`/ar-loop`** is the studio's phone projecting the rehearsal WebM as a markerless AR loop on the studio floor.
4. **The `/versions/` pages** are where you lock `/versions/spectrum.html` so the chromagram is visible to the dancers.
5. **Audio analysis v2** is where the chromagram tells you where the loudest peaks are. You map each peak to a weight shift in the choreography; the shift is the lesson.
6. **The anchor map** is where you assign `phosphor` for the fast piece, `kraft` for the slow one.

## A typical session (90–180 minutes)

You drop the rehearsal recording. Audio analysis v2 returns chromagram weighted on the dancers' footsteps and the breath cues. You mark the loudest peaks and map each to a weight shift in the choreography.

You push `chroma=0.5` on the heavy movements and `chroma=0.2` on the light ones. You lock `/versions/spectrum.html` so the chromagram is visible. You project the visual in the studio via the engine's render loop. You drop the rehearsal WebM into `/ar-loop` on your phone; the AR scene loads and the loop floats on the studio floor.

There is a moment, around the studio floor, when the studio's Wi-Fi almost fails to load `/ar-loop` because the studio is in a basement. You almost gave up before tethering to your phone's hotspot. The hotspot saved the rehearsal. The dancers walked around the loop on the studio floor and saw their weight shifts reflected back, which is the part of the rehearsal that does not survive in the verbal notes.

## What they'd pay for

A flat $100/year for a "studio tier" that unlocked longer AR recordings (30s instead of 5s) and a custom share-link domain so the studio's firewall does not block it. You would not pay a monthly fee; rehearsals are not recurring revenue, and a flat annual fee matches the production cycle.

## What would make them leave

`/ar-loop` requiring a login to view. The dancers do not have accounts and the studio's firewall does not support OAuth, and a login wall would erase exactly the studio-floor mirror that makes the rehearsal useful. You would also leave if the chromagram rendering ever drifted between sessions — dancers need to see the same peaks the previous rehearsal saw, and a surprise variation is a surprise the rehearsal cannot absorb.

## Quote

"The /versions/spectrum.html chromagram on the rehearsal recording and the /ar-loop loop on the studio floor are the only reason the dancers can see their own weight shifts reflected back, and the audio-analysis chromagram is the only reason the visual matches the breath."