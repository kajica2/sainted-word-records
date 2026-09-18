# The Live VJ

**Slug:** live-vj
**Surfaces:** presets, transitions, recorder, engine, FX, versions
**One-line:** A live VJ who builds hour-long sets from the 19 anchor presets and the 10 CSS transitions, recording each set as a WebM for the venue's archive.

## Who they are

You project behind DJs at clubs three nights a week and you have been collecting reactive visuals in a folder for ten years. You are tired of Resolume's licensing model and you are willing to learn a new tool if it means owning your sets. Your MIDI controller is the closest thing you have to an instrument; your projector is your stage. You have a long-running habit of timing visuals to drops rather than to beats, because the audience feels the drop before they hear the beat.

## What they're trying to do

You want to drop a friend's sixty-minute DJ set into `/engine`, mark twelve drops by hovering the chromagram from audio analysis v2, and assign one of the nineteen anchor presets to each drop so the visual language tracks the set's emotional arc — `glitch` (warmth 0.2, intensity 0.9) for the opening drop, `phosphor` (warmth 0.4, intensity 0.5) for the second, `void` (warmth 0.1, intensity 0.85) for the third, `kraft` (warmth 0.7, intensity 0.3) for the breakdown. Between drops, you fire `whip-blur` or `glitch-block` transitions. You record the full set as a sixty-minute WebM via MediaRecorder and ship it to the venue's archive.

## The surfaces they live in

1. **The nineteen anchor presets** are your set list. You assign one per drop and you keep the rotation irregular on purpose — the audience can feel when the same four looks are cycling, and irregularity is what makes a set feel curated.
2. **The ten CSS transitions** are the between-drop vocabulary. `whip-blur` and `glitch-block` between drops, `flash-cover` on the biggest drop, `circle-wipe` on the last drop.
3. **The MediaRecorder export** captures the full sixty-minute set as a WebM that ships to the venue's archive. The venue gets the same file you projected.
4. **`/engine`** is the render surface where you stack the library clips behind each preset.
5. **The FX pipeline** is where you push `chroma` and `grain` on the high-intensity drops, `sepia` and `bloom` on the breakdown. The breakdown gets warmer; the drops get colder.
6. **The variants** are where you switch mid-set when a preset is not loud enough. `/versions/glitch.html` for the opening drop, `/versions/void.html` for the third.

## A typical session (90–180 minutes)

You drop the sixty-minute DJ set. Audio analysis v2 returns BPM 128, key A minor, chromagram weighted on A and C. You mark twelve drops by hovering the chromagram peaks — the twelve drop timestamps are logged.

You assign anchors: drop 1 = `glitch` (0.2, 0.9), drop 2 = `phosphor` (0.4, 0.5), drop 3 = `void` (0.1, 0.85), drop 4 = `kraft` (0.7, 0.3), and so on around the nineteen presets. You load the library clips and stack them per drop.

You fire `whip-blur` between drops 1–2, `glitch-block` between drops 2–3, `flash-cover` on the biggest drop, `circle-wipe` on the last. You push `chroma=0.6`, `grain=0.5` for drops 1–3 (high intensity); `sepia=0.5`, `bloom=0.4` for the breakdown. You hit record via MediaRecorder and let the set run for sixty minutes. You ship the WebM to the venue's archive.

There is a moment, around drop three, when assigning twelve anchors across nineteen presets feels like a Sudoku. You almost settled for four presets. Then you remembered the anchor map is the feature, and the venue's projector is going to show twelve different looks on twelve different drops, which is the reason you left Resolume in the first place.

## What they'd pay for

$20/month for a "live tier" that unlocked 4K WebM capture and a MIDI-mapping layer so you can fire transitions from your controller. You would not pay per set; per-set pricing would punish you for running longer sets and the longer sets are exactly the gigs worth keeping.

## What would make them leave

The nineteen anchor presets collapsing into four "modes" (warm/cool/calm/intense). The granularity is the work; you can tell when an audience has seen the same four looks rotate three times and they start checking their phones. You would also leave if the transitions started auto-firing on the beat; the between-drop silence is as much a part of the set as the transitions themselves, and a metronome that fires for you would erase the silence.

## Quote

"The 19 anchor presets and the 10 CSS transitions are my set list, and the MediaRecorder WebM is what the venue's archive gets, which is why I never went back to Resolume."