# The Live VJ

**Slug:** live-vj
**Surfaces touched (3+ minimum):** presets, transitions, recorder, engine, FX, versions
**One-line:** A live VJ who builds hour-long sets from the 19 anchor presets and the 10 CSS transitions, recording each set as a WebM for the venue's archive.

## Who they are
You are a live VJ in your early thirties who projects behind DJs at clubs three nights a week and who has been collecting reactive visuals in a folder for ten years. You are tired of Resolume's licensing model and you are willing to learn a new tool if it means owning your sets. Your toolbelt is a MIDI controller, a projector, and a long-running habit of timing visuals to drops rather than to beats.

## What they're trying to do
You want to drop a friend's 60-minute DJ set into /engine, mark 12 drops by hovering the chromagram from audio-analysis v2, and assign one of the 19 anchor presets to each drop so the visual language tracks the set's emotional arc — `glitch` (warmth 0.2, intensity 0.9) for the opening drop, `phosphor` (warmth 0.4, intensity 0.5) for the second, `void` (warmth 0.1, intensity 0.85) for the third, `kraft` (warmth 0.7, intensity 0.3) for the breakdown. Between drops, you fire `whip-blur` or `glitch-block` transitions. You record the full set as a 60-minute WebM via MediaRecorder and ship it to the venue's archive.

## Which surfaces they actually use, and why
1. **Presets (anchor map)** — the 19 anchor presets are your set list; you assign one per drop.
2. **Transitions** — `whip-blur` and `glitch-block` between drops, `flash-cover` on the biggest drop, `circle-wipe` on the last drop.
3. **Recorder** — the 60-minute WebM that ships to the venue's archive.
4. **Engine** — the render surface where you stack the library clips behind each preset.
5. **FX pipeline** — you push `chroma` and `grain` on the high-intensity drops, `sepia` and `bloom` on the breakdown.
6. **Versions** — you switch variants mid-set when a preset is not loud enough; `/versions/glitch.html` for the opening drop, `/versions/void.html` for the third.

## A typical session (90-180 minutes)
1. You drop the 60-minute DJ set, audio-analysis v2 returns BPM=128, key=A minor, chromagram weighted on A and C.
2. You mark 12 drops by hovering the chromagram peaks — the 12 drop timestamps are logged.
3. You assign anchors: drop 1=`glitch` (0.2, 0.9), drop 2=`phosphor` (0.4, 0.5), drop 3=`void` (0.1, 0.85), drop 4=`kraft` (0.7, 0.3), and so on around the 19 presets.
4. You load the library clips and stack them per drop.
5. You fire `whip-blur` between drops 1-2, `glitch-block` between drops 2-3, `flash-cover` on the biggest drop, `circle-wipe` on the last.
6. You push `chroma=0.6, grain=0.5` for drops 1-3 (high intensity), `sepia=0.5, bloom=0.4` for the breakdown.
7. You hit record via MediaRecorder and let the set run for 60 minutes.
8. You ship the WebM to the venue's archive.
9. You almost quit at step 3 — assigning 12 anchors across 19 presets felt like a Sudoku. You almost settled for 4 presets before remembering the anchor map is the feature.

## What they'd pay for
You would pay $20/month for a "live tier" that unlocked 4K WebM capture and a MIDI-mapping layer so you can fire transitions from your controller. You would not pay per set.

## What would make them leave
You would leave forever if the 19 anchor presets collapsed into 4 "modes" (warm/cool/calm/intense), because the granularity is the work. You would tolerate the absence of MIDI mapping forever — you can hit keyboard shortcuts.

## Quote
"The 19 anchor presets and the 10 CSS transitions are my set list, and the MediaRecorder WebM is what the venue's archive gets, which is why I never went back to Resolume."
