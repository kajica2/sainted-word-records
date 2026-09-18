# The Variant Collector

**Slug:** version-hopper
**Surfaces:** versions, presets, transitions, recorder
**One-line:** A creative coder who treats the 27 visual variants as a palette of moods and A/B tests them against a single track.

## Who they are

You write shaders for a small studio that does generative branding work for indie musicians, and you have a personal habit of opening too many browser tabs at once when you are picking a look. After Effects is something you can operate; the browser is where you ship. You keep a notebook of shader recipes and you have learned, the slow way, that the difference between `film` and `tape` on the same loop is the difference between a record sleeve and a zine cover.

## What they're trying to do

You want to drop the same thirty-second loop into every variant — `neon`, `film`, `grid`, `smoke`, `hallucination`, `aurora`, `chrome`, `fractal`, `gallery`, `glitch`, `pulse`, `void`, `watercolor`, `baroque`, `kraft`, `mosaic`, `phosphor`, `spectrum`, `tape`, `typography`, `music_video`, `collage`, `eclipse`, `music_video_mtv`, and the gallery offshoots in between — record eight seconds of each, scrub the WebMs back at half speed, and pick the one that matches the mood you have been chasing for a friend's EP cover. You are not making a music video. You are choosing a mood.

## The surfaces they live in

1. **The `/versions/` directory** is the surface you spend the most time on. You treat each variant as a different take on the same song and cycle through them quickly, the way a photographer cycles through film stocks.
2. **The anchor map** tells you why each variant looks the way it does. `neon` sits at warmth 0.2, intensity 0.9; `kraft` at warmth 0.7, intensity 0.3. The position explains the feel, and the feel is the answer.
3. **The transitions** show up between variants — a `chromatic-split` between two looks tells you how the two moods behave against each other, which is information the variants alone cannot give you.
4. **The MediaRecorder export** captures eight-second WebMs of each variant so you can scrub them at half speed and choose deliberately, instead of choosing from a memory of what you saw on screen.

## A typical session (90–180 minutes)

You open `/engine`, drop the friend's thirty-second loop, and note the BPM 128, key C minor from the audio analysis readout. You click into `/versions/neon.html`. The variant loads, the loop reacts, you hit record, capture eight seconds, save the WebM as `neon-take-01.webm`. You repeat for the next six variants.

You have a small script that opens each variant in a new tab. Without the script you would have clicked yourself hoarse; with the script, eight seconds per variant is enough time to know if a look is going to work.

You fire `chromatic-split` between two variants to see how the looks transition between each other. The split lasts 500 ms and resolves cleanly. You scrub the captured WebMs in QuickTime at half speed and decide `tape` is right for the cover. You open `/versions/tape.html`, lock the look, and record a final thirty-second WebM for the EP mockup.

There is a moment, around the seventh variant, when opening another tab feels like punishment. You almost gave up. Then you remembered you only need eight seconds each, and that the script saves more time than it costs.

## What they'd pay for

You would not pay. You would contribute a small PR that opens all variants in a grid view so the comparison is side-by-side rather than tab-by-tab. You have already written the snippet twice for friends and you would happily upstream it.

## What would make them leave

The 26 variants collapsing into a single "theme picker" dropdown. The variants are the surface; you want to see each one as a peer, not a setting. You would also leave if the variants started drifting — if `film` looked different every time you opened it. The determinism is the point.

## Quote

"The /versions/film.html and /versions/tape.html variants do different work on the same loop, and the only reason I trust the choice is because I record 8-second WebMs of each."