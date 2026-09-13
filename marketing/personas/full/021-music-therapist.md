# The Music Therapist

**Slug:** music-therapist
**Surfaces touched (3+ minimum):** engine, presets, recorder, AR, library
**One-line:** A music therapist with non-verbal clients who builds calming visual environments via the anchor map and ships take-home AR loops for the families.

## Who they are
You are a music therapist in your late thirties who works with non-verbal children and adults in a clinical setting and who has started using visuals in sessions because some clients respond more to visual rhythm than to audio rhythm. You are not a coder and you have never opened After Effects. Your toolbelt is a folder of lullaby recordings, a set of soft visuals you have collected over ten years, and a willingness to learn one new tool per year if it helps the clients.

## What you're trying to do
You want to drop a 5-minute lullaby recording into /engine, lock the variant at /versions/watercolor.html because the watercolor reads as "soft" to your clients, push `bloom=0.5` and `sepia=0.3` for warmth, and record a 5-minute WebM via MediaRecorder. You drop the WebM into /ar-loop on your phone and ship the AR link to the families so the take-home loop lives in the child's bedroom.

## Which surfaces they actually use, and why
1. **/engine** — the compositor where you stack the lullaby recording and the soft visuals.
2. **Presets (anchor map)** — you assign the `watercolor` anchor at warmth=0.5, intensity=0.3 because it reads as soft to your clients.
3. **Recorder** — you record a 5-minute WebM per session for the family's take-home.
4. **/ar-loop** — the take-home loop floats in the child's bedroom via the family's phone.
5. **Library** — your library is 20 soft visuals (clouds, water, slow flowers) tagged by mood.

## A typical session (90-180 minutes)
1. You open /engine, drop the 5-minute lullaby recording, audio-analysis v2 returns BPM=60, key=C major.
2. You lock /versions/watercolor.html, push `bloom=0.5`, `sepia=0.3` (soft, warm).
3. You stack the soft visuals behind the recording.
4. You record a 5-minute WebM via MediaRecorder.
5. You drop the WebM into /ar-loop on your phone; the AR scene loads.
6. You share the AR link with the family via iMessage; the loop floats in the child's bedroom on the family's phone.
7. You almost quit at step 6 — the family's phone almost failed to load /ar-loop because the bedroom's Wi-Fi was weak. You almost gave up before the family moved the phone closer to the router.

## What they'd pay for
You would not pay — you are a clinician and your budget is the clinical budget. You would happily accept a free "clinician tier" with longer AR recordings (30s instead of 5s) and a custom share-link domain so the hospital's firewall does not block it.

## What would make them leave
You would leave forever if /ar-loop required a login to view, because the families do not have accounts and the hospital's firewall does not support OAuth. You would tolerate the 5-second AR record limit forever — it is enough for a take-home loop.

## Quote
"The /versions/watercolor.html lullaby and the /ar-loop take-home on the family's phone are the only reason a non-verbal client can have a calming visual at home, and the audio-analysis BPM=60 is the only reason the visual rhythm matches the breathing."
