# The Gallery Curator

**Slug:** gallery-curator
**Surfaces:** engine, AR, presets, recorder, library
**One-line:** A museum curator who builds an audio-reactive exhibit by compositing ambient tracks into the engine, locking the variant via the anchor map, and shipping AR labels via /ar-loop.

## Who they are

You have been working in contemporary art for twenty years and you have started using audio-reactive visuals in exhibits because the younger visitors expect them, and because the older visitors stay longer when there is something to listen to while they look. You are not a coder and you have never opened After Effects. The museum's AV budget is the most generous line item you have; the field recordings you have been collecting for a decade are the most personal. You learn one new tool per exhibit if it survives the install.

## What they're trying to do

You want to drop three ambient field recordings (a tide pool, a forest, a city street) into `/engine`, lock the variant per recording via the anchor map (`phosphor` for the tide pool, `kraft` for the forest, `glitch` for the city street), stack photos of the corresponding locations behind each, and record a five-minute WebM per recording via MediaRecorder. You drop each WebM into `/ar-loop` on the exhibit's tablet, and visitors record the AR scene with their phones as a take-home — which is the part of the exhibit that lives past the closing reception.

## The surfaces they live in

1. **`/engine`** is the compositor where you stack the field recordings and the location photos.
2. **`/ar-loop`** is the exhibit's tablet. Each recording floats as a markerless AR object; visitors record the AR scene with their phones and take the loop home.
3. **The anchor map** is where you assign one anchor per recording. `phosphor` for the tide pool (cool, electric), `kraft` for the forest (warm, organic), `glitch` for the city street (cold, fractured). The mapping is in the exhibit's curatorial statement.
4. **The MediaRecorder WebM** is the five-minute file per recording that lands in the exhibit's archive.
5. **The library** holds thirty photos of the locations, tagged by location and time of day.

## A typical session (90–180 minutes)

You open `/engine` and drop the tide pool recording. Audio analysis v2 returns chromagram weighted on C, E, G. You lock `/versions/phosphor.html`, push `glow=0.5`, `bloom=0.4` — cool, electric, the way the tide pool sounds in person.

You drop the forest recording. You lock `/versions/kraft.html`, push `sepia=0.5`, `grain=0.4` — warm, organic, the way the forest looks at four in the afternoon. You drop the city street recording. You lock `/versions/glitch.html`, push `chroma=0.6`, `posterize=4` — cold, fractured, the way the city street sounds at midnight.

You record a five-minute WebM per recording via MediaRecorder. You drop each WebM into `/ar-loop` on the exhibit's tablet; the AR scene loads. Visitors record the AR scene with their phones.

There is a moment, around the tablet, when the museum's Wi-Fi firewall almost blocks `/ar-loop` because the URL looks external. You almost gave up. Then the AV team whitelisted the domain, and the take-home loop went home with the visitors, which is the only reason the exhibit survives the closing reception.

## What they'd pay for

A flat $200/year per exhibit for a "museum tier" that unlocked longer AR recordings (30s instead of 5s) and a custom share-link domain so the museum's firewall does not block it. You would not pay a monthly fee; exhibits are not recurring revenue, and a flat annual fee matches the curatorial cycle.

## What would make them leave

`/ar-loop` requiring a login to view. The visitors do not have accounts and the museum's firewall does not support OAuth, and a login wall would erase exactly the take-home that made the exhibit worth doing. You would also leave if the anchor map ever drifted between sessions — visitors expect to see the same tide pool they heard; you cannot ask them to expect a "similar" tide pool.

## Quote

"The /versions/phosphor.html tide pool and the /ar-loop tablet at the exhibit entrance are the only reason visitors can take the audio home on their phones, and the audio-analysis chromagram is the only reason the anchor map matches the recording."