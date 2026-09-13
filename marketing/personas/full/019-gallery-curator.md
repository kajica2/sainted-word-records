# The Gallery Curator

**Slug:** gallery-curator
**Surfaces touched (3+ minimum):** engine, AR, presets, recorder, library
**One-line:** A museum curator who builds an audio-reactive exhibit by compositing ambient tracks into the engine, locking the variant via the anchor map, and shipping AR labels via /ar-loop.

## Who they are
You are a museum curator in your late forties who has been working in contemporary art for twenty years and who has started using audio-reactive visuals in exhibits because the younger visitors expect them. You are not a coder and you have never opened After Effects. Your toolbelt is a museum's AV budget, a folder of ambient field recordings, and a willingness to learn one new tool per exhibit if it survives the install.

## What you're trying to do
You want to drop three ambient field recordings (a tide pool, a forest, a city street) into /engine, lock the variant per recording via the anchor map (`phosphor` for the tide pool, `kraft` for the forest, `glitch` for the city street), stack photos of the corresponding locations behind each, and record a 5-minute WebM per recording via MediaRecorder. You drop each WebM into /ar-loop on the exhibit's tablet, and visitors record the AR scene with their phones as a take-home.

## Which surfaces they actually use, and why
1. **/engine** — the compositor where you stack the field recordings and the location photos.
2. **/ar-loop** — the exhibit's tablet floats each recording as a markerless AR object; visitors record the AR scene on their phones.
3. **Presets (anchor map)** — you assign one anchor per recording; `phosphor` for the tide pool, `kraft` for the forest, `glitch` for the city street.
4. **Recorder** — you record a 5-minute WebM per recording for the exhibit's archive.
5. **Library** — your library is 30 photos of the locations, tagged by location and time of day.

## A typical session (90-180 minutes)
1. You open /engine, drop the tide pool recording, audio-analysis v2 returns chromagram weighted on C, E, G.
2. You lock /versions/phosphor.html, push `glow=0.5`, `bloom=0.4` (cool, electric).
3. You stack the tide pool photos behind the recording.
4. You drop the forest recording, lock /versions/kraft.html, push `sepia=0.5`, `grain=0.4` (warm, organic).
5. You drop the city street recording, lock /versions/glitch.html, push `chroma=0.6`, `posterize=4` (cold, fractured).
6. You record a 5-minute WebM per recording via MediaRecorder.
7. You drop each WebM into /ar-loop on the exhibit's tablet; the AR scene loads, visitors record the AR scene with their phones.
8. You almost quit at step 7 — the exhibit's tablet almost failed to load /ar-loop because the museum's Wi-Fi has a strict firewall. You almost gave up before the AV team whitelisted the domain.

## What they'd pay for
You would pay a flat $200/year per exhibit for a "museum tier" that unlocked longer AR recordings (30s instead of 5s) and a custom share-link domain so the museum's firewall does not block it. You would not pay a monthly fee.

## What would make them leave
You would leave forever if /ar-loop required a login to view, because the visitors do not have accounts and the museum's firewall does not support OAuth. You would tolerate the 5-second AR record limit forever — it is enough for a take-home.

## Quote
"The /versions/phosphor.html tide pool and the /ar-loop tablet at the exhibit entrance are the only reason visitors can take the audio home on their phones, and the audio-analysis chromagram is the only reason the anchor map matches the recording."
