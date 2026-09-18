# The Tag Janitor

**Slug:** tag-janitor
**Surfaces:** library, audio-analysis, presets, storyboard
**One-line:** A video editor who curates the library's tag schema so the ShotPicker stops returning traffic clips for tender songs.

## Who they are

You spent the last two years tagging 1,200 short clips in a private DAM because you got tired of the auto-curated stock libraries surfacing the wrong clip, and because you have learned the slow way that *mood* is the most under-tagged axis in any video library. You know what good metadata looks like. You know that "good metadata" is ninety percent consistency and ten percent vocabulary. Your toolbelt is a spreadsheet, a regex habit, and a willingness to spend a Saturday re-tagging 200 clips because the previous Saturday's tags were wrong.

## What they're trying to do

You want to open the library manifest, audit the existing tags (mood, palette, motion, subject, duration, isVideo/isImage/isGif), and re-tag every clip whose mood field is empty or wrong. You use the audio analysis v2 chromagram of each clip's reference song as a sanity check on the mood tag — if the clip is tagged `mood=tense` but its reference song's chromagram is heavily weighted on F# major, you flip the tag to `mood=tender`. When you are done, the ShotPicker in the storyboard engine stops returning traffic clips for tender songs, and your weekend was not wasted.

## The surfaces they live in

1. **The library manifest** is the only metadata you trust. The schema — `mood`, `palette`, `motion`, `subject`, `duration`, `isVideo/isImage/isGif` — is clean and flat, which is the only shape that survives a Saturday of re-tagging.
2. **Audio analysis v2** is your sanity check. You run it on each clip's reference song and read the chromagram; the chromagram is the ground truth that the mood tag has to match.
3. **The presets** give you a tag-to-anchor mapping the ShotPicker can use: `tender → kraft` (warmth 0.7, intensity 0.3), `restless → pulse` (0.3, 0.7), `tense → void` (0.1, 0.85), `joyful → phosphor` (0.4, 0.5), `melancholy → gallery` (0.5, 0.4), `defiant → glitch` (0.2, 0.9). The mapping is the contract.
4. **The storyboard engine** is where you confirm the work. Once the tags are clean, you run a storyboard pass on a song you have been cutting and the ShotPicker returns the right clips for the bridge.

## A typical session (90–180 minutes)

You open the library manifest, dump the tag fields into a spreadsheet, sort by mood, and find forty-seven clips with empty mood fields. For each empty-mood clip, you run audio analysis v2 on its reference song and read the chromagram.

A clip of a child on a swing has an empty mood; its reference song's chromagram is weighted on C, E, G. You tag it `mood=tender`. A clip of highway traffic has `mood=tense`; its reference song's chromagram is weighted on F#, A#. You keep `mood=tense` because the chromagram confirms it. A clip of a city crosswalk has `mood=tense`; its reference song's chromagram is weighted on C, F, G — a Lydian palette, not tense. You flip it to `mood=restless`.

You map each tag bucket to a preset anchor in a side spreadsheet: tender→kraft, restless→pulse, tense→void, joyful→phosphor, melancholy→gallery, defiant→glitch. You run a storyboard pass on a song you have been cutting and confirm the ShotPicker returns three tender clips for the bridge.

There is a moment, around clip twelve of forty-seven, when the empty mood tags start to feel like punishment. You almost stopped. Then you remembered the ShotPicker's mood-match is the reason you started tagging in the first place, and clip forty-eight would not exist unless you finished clip forty-seven.

## What they'd pay for

A flat $30/year for a bulk-tag editor that let you re-tag fifty clips at a time from a spreadsheet view. You would not pay for cloud storage; your NAS is bigger than anything a vendor would offer and you trust it.

## What would make them leave

An auto-tagging model that guessed tags from clip content. The audio analysis chromagram is the ground truth, and a model that guessed from frames would get it wrong twenty percent of the time — and the twenty percent would be exactly the clips the ShotPicker needed to find. You would also leave if the tag schema ever grew a free-form field; free-form is where consistency goes to die.

## Quote

"The library's mood tags are why the ShotPicker stops returning traffic clips for tender songs, and the audio-analysis chromagram is the only reason I trust the new tags."