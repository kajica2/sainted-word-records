# The Variant Collector

**Slug:** version-hopper
**Surfaces touched (3+ minimum):** versions, presets, transitions, recorder
**One-line:** A creative coder who treats the 26 visual styles as a palette of moods and A/B tests them against a single track.

## Who they are
You are a creative coder in your mid-twenties working at a small studio that does generative branding work for indie musicians. You write shaders in your day job, you have a passing knowledge of After Effects but you ship in the browser. Your toolbelt is GLSL, a notebook of shader recipes, and a habit of opening a dozen browser tabs at once when you are picking a look.

## What they're trying to do
You want to drop the same 30-second loop into /versions/neon.html, /versions/film.html, /versions/grid.html, /versions/smoke.html, /versions/hallucination.html, /versions/aurora.html, /versions/chrome.html, /versions/fractal.html, /versions/gallery.html, /versions/glitch.html, /versions/pulse.html, /versions/void.html, /versions/watercolor.html, /versions/baroque.html, /versions/kraft.html, /versions/mosaic.html, /versions/phosphor.html, /versions/spectrum.html, /versions/tape.html, /versions/typography.html, /versions/music_video.html, /versions/collage.html, /versions/eclipse.html, and /versions/music_video_mtv.html in sequence, record 8 seconds of each, and pick the one that looks right for a friend's EP cover. You are not making a music video — you are choosing a mood.

## Which surfaces they actually use, and why
1. **/versions/* (26 visual styles)** — the surface you spend the most time on; you treat each variant as a different take on the same song and cycle through them quickly.
2. **Presets (anchor map)** — you use the anchor map to understand why each variant looks the way it does: `neon` sits at warmth=0.2 intensity=0.9, `kraft` at warmth=0.7 intensity=0.3, and the position explains the feel.
3. **Transitions** — when you are recording you sometimes trigger a `chromatic-split` between variants to see how two looks behave against each other.
4. **Recorder** — you record 8-second WebMs of each variant via the MediaRecorder export so you can scrub them back at half speed and pick.

## A typical session (90-180 minutes)
1. You open /engine, drop the friend's 30-second loop, and note the BPM=128, key=C minor from the audio-analysis readout.
2. You click through /versions/neon.html — the variant loads, the loop reacts, you hit record, capture 8 seconds, and save the WebM as `neon-take-01.webm`.
3. You repeat for /versions/film.html, /versions/grid.html, /versions/smoke.html, /versions/hallucination.html, /versions/aurora.html — you have a script that opens each in a new tab because clicking from one variant to another in the same tab takes longer.
4. You fire `chromatic-split` between two variants to see the transition read — the split lasts 500ms and resolves cleanly.
5. You scrub the captured WebMs in QuickTime at half speed and decide the `tape` variant is right for the cover.
6. You open /versions/tape.html, lock in the look, and record a final 30-second WebM for the EP mockup.
7. You almost quit at step 3 — opening 26 tabs in sequence is tedious. You almost gave up after the seventh variant, then remembered you only need 8 seconds each and the script saves time.

## What they'd pay for
You would not pay — you would contribute a small PR that opens all variants in a grid view so the comparison is side-by-side rather than tab-by-tab. You have already written the snippet twice for friends and would happily upstream it.

## What would make them leave
You would leave forever if the 26 variants collapsed into a single "theme picker" dropdown, because the variants are the surface and you want to see each one as a peer, not a setting. You would tolerate the tab-management overhead forever — you have been doing it for years, it is the price of the look.

## Quote
"The /versions/film.html and /versions/tape.html variants do different work on the same loop, and the only reason I trust the choice is because I record 8-second WebMs of each."
