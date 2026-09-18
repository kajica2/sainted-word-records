# The AR Storyboard Reviewer

**Slug:** ar-storyboard-reviewer
**Surfaces:** AR, storyboard, recorder, auth, presets
**One-line:** A film director who reviews the composer's storyboard as a markerless AR loop in the spotting session and records the AR scene as a WebM for the studio's archive.

## Who they are

You have been directing features for twenty-five years and you have started using visuals in spotting sessions because the composer wants to see the cue rendered before the orchestra is booked, and because the orchestra is the most expensive line item in the film's budget. You are not a coder and you have never opened After Effects. The spotting notebook is home. A folder of reference frames is the visual library. You learn one new tool per film if it survives pre-production, and pre-production is where films are saved.

## What they're trying to do

You want to log in via magic-link, reload the composer's saved storyboard (one per cue sheet), and drop the storyboard's WebM into `/ar-loop` on your phone so you can walk around the cue in the spotting session. You record the AR scene as a five-second WebM via the AR scene's built-in recorder and ship it to the studio's archive so the producer can see what you saw. The producer is the person who has to approve the cue before the orchestra is booked; the AR WebM is what the producer uses.

## The surfaces they live in

1. **`/ar-loop`** is the entry point. The composer's storyboard WebM floats in the spotting room; the markerless AR scene is the only reason the cue can be walked around without the composer having to plan a marker placement.
2. **The storyboard engine** is where the composer's bar-aligned cuts render in the AR scene. The storyboard is the cue's first draft; the AR scene is the draft's last review.
3. **The AR scene's recorder** captures its own five-second WebM, which you ship to the studio's archive.
4. **`/api/projects` with magic-link auth** is where you log in via magic-link and reload the composer's saved storyboard on your phone. The login is a single email; the reload is a single tap.
5. **The anchor map** is where the composer's per-cue anchors render in the AR scene — `void` for the opening, `gallery` for the violin solo, `phosphor` for the chase. The anchors are the composer's reading of the cue; the AR scene is the reading's review.

## A typical session (90–180 minutes)

You open `/auth/login` on your phone. The magic-link arrives; sometimes the studio's email gateway delays it, sometimes it does not. You land at `/engine`. You reload the composer's saved project `film-01-cue-violin-solo` via `GET /api/projects`.

The storyboard renders; the `gallery` preset (warmth 0.5, intensity 0.4) applies; the chromagram's D/F#/A weight reads as warm. You drop the storyboard's WebM into `/ar-loop` on your phone; the AR scene loads and the loop floats in the spotting room.

You walk around the loop; the bar-aligned cuts land on the eight-bar phrase boundaries. You record a five-second WebM of the AR scene via the AR scene's built-in recorder. You ship the WebM to the studio's archive.

There is a moment, around the magic-link, when the studio's email gateway almost delays it by twenty minutes. You almost gave up. Then the email arrived twenty seconds later and you remembered why the magic-link is the right answer for a director on a film set: it survives the studio's IT department, and the studio's IT department is the gatekeeper to the orchestra booking.

## What they'd pay for

$20/month per film for unlimited project reloads and per-project version history — so you can compare the first spotting pass and the second. You would not pay per cue; per-cue pricing would punish you for the cues that need three spotting passes, and the three-pass cues are the ones where the film gets saved.

## What would make them leave

`/ar-loop` requiring a login to view. The studio's firewall does not support OAuth, and a login wall would erase exactly the AR walk-around that makes the spotting session useful. You would also leave if the AR record limit dropped below five seconds — five seconds is enough for a take-home, and a take-home is what survives the cue's first reaction.

## Quote

"The composer's storyboard engine saves one named project per cue, the magic-link login lets me reload on my phone, and the /ar-loop share link is the only reason I can walk around the cue in the spotting room."