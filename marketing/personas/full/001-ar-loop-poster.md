# The AR Poster Maker

**Slug:** ar-loop-poster
**Surfaces:** AR, recorder, library, presets
**One-line:** A zine maker who turns 5-second WebM clips into shareable markerless AR stickers that print on demand.

## Who they are

You run a risograph studio out of a third-floor walk-up and you keep a Patreon open for the days the riso bills arrive. By day you do paid identity work; by night you cut stencils for a zine that nobody asked for and almost everyone reads. Your phone camera is the cheapest mockup tool you own. InDesign and Illustrator handle the prints; the phone handles everything that has to convince a printer before the run.

## What they're trying to do

You want to drop a five-second loop of your latest poster into `/ar-loop`, watch it hover over the studio floor, and text the link to a print client so they can see the poster as a real object in the room before approving the run. When the loop reads from behind as well as the front — your posters always read from behind, because symmetry is half the work — you re-record on a friend's phone and post the result to the zine's Instagram. You are not editing the loop. You are proving that the loop works as a poster.

## The surfaces they live in

1. **`/ar-loop`** is where you drop the WebM and where the markerless A-Frame scene picks it up. It is honest about being a phone-first surface, which is the only reason you keep coming back.
2. **The recorder's WebM export** is the only file format you trust. You re-record from your phone every time the loop changes, not once and ship.
3. **The library** holds thirty private loops that never see the curated gallery; you reach for the AR scene's file picker instead of the public library.
4. **The `gallery` and `tape` presets** handle the color shifts when the client calls a loop "too pink." You push the temperature slider and re-record.

## A typical session (90–180 minutes)

You finish a poster in InDesign, export a 480×480 WebM of the headline element spinning once, and open `/ar-loop` on your phone. The desktop page tells you to use a mobile device; you already knew. You tap the file picker, the A-Frame scene loads, and the loop lands on the floor of your studio at the marker origin.

You walk around it. The spin is symmetrical; it reads from behind. You tap the AR scene's record button and capture five seconds. The WebM drops into the camera roll. You text the link to the print client with a single line: *"open this on your phone, point it at your desk."*

Two hours later the client replies *"too pink."* You open the same WebM back through `/ar-loop`, slide the temperature control toward the cooler end of the `tape` preset, and re-record. The client approves on the second pass. You post the WebM to Instagram, export a still frame for the printed zine cover, and move on.

There is a moment, every time, when the desktop page tells you to switch to your phone and you almost write it off as broken. You almost did, the first time. Then you realized the page is being honest about what the engine is, and that honesty is the reason you keep using it.

## What they'd pay for

A one-time Pro purchase that unlocked a higher WebM bitrate (so the riso dot pattern survives close-up) and removed the watermark from the share link. You would not pay a monthly fee — you make posters, not subscriptions.

## What would make them leave

A login wall on the share link. The whole point of sending the link is that the client can open it without committing to an account. You would also leave if a desktop fallback appeared; the mobile-only constraint is honest, not a bug, and a fake desktop mode would tell you the engine had stopped being honest about its own limits.

## Quote

"I open the AR loop on my phone, the WebM records in five seconds, and the link works without a login — that's the only reason my printer ever approves anything."