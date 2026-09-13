# The Tag Janitor

**Slug:** tag-janitor
**Surfaces touched (3+ minimum):** library, audio-analysis, presets, storyboard
**One-line:** A video editor who curates the library's tag schema (mood, palette, motion, subject) so the ShotPicker stops returning traffic clips for tender songs.

## Who they are
You are a video editor in your early thirties who has spent the last two years tagging 1,200 short clips in a private DAM because you got tired of the auto-curated stock libraries surfacing the wrong clip. You know what good metadata looks like and you know that "mood" is the most under-tagged axis. Your toolbelt is a spreadsheet, a regex habit, and a willingness to spend a Saturday re-tagging 200 clips because the tags were wrong.

## What they're trying to do
You want to open the library manifest, audit the existing tags (mood, palette, motion, subject, duration, isVideo/isImage/isGif), and re-tag every clip whose mood field is empty or wrong. You use the audio-analysis v2 chromagram of the clip's reference song as a sanity check on the mood tag — if the clip is tagged `mood=tense` but its reference song's chromagram is heavily weighted on F# major, you flip the tag to `mood=tender`. When you are done, the ShotPicker in the storyboard engine stops returning traffic clips for tender songs.

## Which surfaces they actually use, and why
1. **Library** — the surface you spend the most time on; the manifest schema (`mood`, `palette`, `motion`, `subject`, `duration`, `isVideo/isImage/isGif`) is the only metadata you trust.
2. **Audio analysis v2** — you run audio-analysis v2 on each clip's reference song as a sanity check on the mood tag; chromagram weight is the ground truth.
3. **Presets** — you map each tag bucket to a preset anchor so the ShotPicker can match mood→anchor: `tender → kraft (warmth 0.7, intensity 0.3)`, `restless → pulse (warmth 0.3, intensity 0.7)`, `tense → void (warmth 0.1, intensity 0.85)`.
4. **Storyboard engine (planned)** — once the tags are clean, you run a storyboard pass on a song you have been cutting and confirm the ShotPicker returns the right clips.

## A typical session (90-180 minutes)
1. You open the library manifest, dump the tag fields into a spreadsheet, sort by mood, and find 47 clips with empty mood fields.
2. For each empty-mood clip, you run audio-analysis v2 on its reference song and read the chromagram.
3. A clip of a child on a swing has an empty mood; its reference song's chromagram is weighted on C, E, G. You tag it `mood=tender`.
4. A clip of highway traffic has `mood=tense`; its reference song's chromagram is weighted on F#, A#. You keep `mood=tense` because the chromagram confirms it.
5. A clip of a city crosswalk has `mood=tense`; its reference song's chromagram is weighted on C, F, G — a Lydian palette, not tense. You flip it to `mood=restless`.
6. You map each tag bucket to a preset anchor in a side spreadsheet: tender→kraft, restless→pulse, tense→void, joyful→phosphor, melancholy→gallery, defiant→glitch.
7. You run a storyboard pass on a song you have been cutting and confirm the ShotPicker returns three tender clips for the bridge.
8. You almost quit at step 4 — 47 empty mood tags is a lot. You almost stopped after 12 before remembering the ShotPicker's mood-match is the reason you started tagging.

## What they'd pay for
You would pay a flat $30/year for a bulk-tag editor that let you re-tag 50 clips at a time from a spreadsheet view. You would not pay for cloud storage — your NAS is bigger.

## What would make them leave
You would leave forever if the library added an auto-tagging model that guessed tags from clip content, because the audio-analysis chromagram is the ground truth and the model would get it wrong 20% of the time. You would tolerate the manual re-tagging forever — it is the work.

## Quote
"The library's mood tags are why the ShotPicker stops returning traffic clips for tender songs, and the audio-analysis chromagram is the only reason I trust the new tags."
