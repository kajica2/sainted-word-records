# The Music Therapist

**Slug:** music-therapist
**Surfaces:** engine, presets, recorder, AR, library
**One-line:** A music therapist with non-verbal clients who builds calming visual environments via the anchor map and ships take-home AR loops for the families.

## Who they are

You work with non-verbal children and adults in a clinical setting and you have started using visuals in sessions because some clients respond more to visual rhythm than to audio rhythm. You are not a coder and you have never opened After Effects. A folder of lullaby recordings is the audio library. A set of soft visuals you have collected over ten years is the visual one. You learn one new tool per year if it helps the clients, and the bar is whether the client breathes easier after the session.

## What they're trying to do

You want to drop a five-minute lullaby recording into `/engine`, lock the variant at `/versions/watercolor.html` because the watercolor reads as "soft" to your clients, push `bloom=0.5` and `sepia=0.3` for warmth, and record a five-minute WebM via MediaRecorder. You drop the WebM into `/ar-loop` on your phone and ship the AR link to the families so the take-home loop lives in the child's bedroom. The loop is what the child reaches for when the session ends and the room goes quiet.

## The surfaces they live in

1. **`/engine`** is the compositor where you stack the lullaby recording and the soft visuals.
2. **The anchor map** is where you assign the `watercolor` anchor at warmth 0.5, intensity 0.3 because it reads as soft to your clients. The mapping is not negotiable and the clients vote with their breathing.
3. **The MediaRecorder WebM** is the five-minute file you record per session for the family's take-home.
4. **`/ar-loop`** is where the take-home loop floats in the child's bedroom via the family's phone. The markerless AR scene is the reason the loop can live anywhere in the room without the family having to install a marker.
5. **The library** holds twenty soft visuals — clouds, water, slow flowers — tagged by mood.

## A typical session (90–180 minutes)

You open `/engine` and drop the five-minute lullaby recording. Audio analysis v2 returns BPM 60, key C major. You lock `/versions/watercolor.html`, push `bloom=0.5`, `sepia=0.3` — soft, warm, the way a lullaby should look.

You stack the soft visuals behind the recording. You record a five-minute WebM via MediaRecorder. You drop the WebM into `/ar-loop` on your phone; the AR scene loads. You share the AR link with the family via iMessage.

The loop floats in the child's bedroom on the family's phone. The child's breathing slows. The session has reached the part of the session that matters.

There is a moment, around the share link, when the family's bedroom Wi-Fi almost fails to load `/ar-loop` because the router is two walls away. You almost gave up. Then the family moved the phone closer to the router and the loop loaded, and the take-home lived another night on the child's nightstand.

## What they'd pay for

You would not pay — you are a clinician and your budget is the clinical budget. You would happily accept a free "clinician tier" with longer AR recordings (30s instead of 5s) and a custom share-link domain so the hospital's firewall does not block it.

## What would make them leave

`/ar-loop` requiring a login to view. The families do not have accounts and the hospital's firewall does not support OAuth, and a login wall would erase exactly the take-home that makes the clinical work possible outside the session room. You would also leave if the visual ever changed without warning — clients who respond to visual rhythm need the rhythm to stay the same, and a surprise variation is a surprise the room cannot absorb.

## Quote

"The /versions/watercolor.html lullaby and the /ar-loop take-home on the family's phone are the only reason a non-verbal client can have a calming visual at home, and the audio-analysis BPM=60 is the only reason the visual rhythm matches the breathing."