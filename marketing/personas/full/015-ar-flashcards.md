# The AR Flashcard Educator

**Slug:** ar-flashcards
**Surfaces:** AR, recorder, transitions, engine, versions
**One-line:** A high-school biology teacher who makes AR flashcards by recording 5-second WebMs of cell division, looping them via /ar-loop, and firing `whip-blur` between phases.

## Who they are

You have been teaching biology for fifteen years and you have started using visuals in class because the textbook's static diagrams are losing the students to their phones. You are not a coder and you have never opened After Effects. Your smartboard is the most expensive object in the classroom. Your toolbelt includes a folder of GIFs from the textbook's website and a willingness to learn one new tool per year if it helps the students — which is a low bar, and the bar is getting lower every year.

## What they're trying to do

You want to drop four GIFs of cell division (prophase, metaphase, anaphase, telophase) into `/ar-loop`, record each as a five-second WebM, and stitch them together with `whip-blur` transitions between phases so the students can walk around the cell on their phones and watch the division happen in space. You share the AR link via the class's LMS and the students record the AR scene with their own phones for homework review, which is when the lesson actually sticks.

## The surfaces they live in

1. **`/ar-loop`** is the entry point. Each GIF becomes a loopable markerless AR object in the classroom; the A-Frame scene loads on the phone without the students having to install anything.
2. **The MediaRecorder WebM** is the file format the LMS accepts. You re-record if a phase reads too fast — students will not re-watch a phase they could not parse the first time.
3. **The `whip-blur` transition** at 450 ms between phases reads as motion, not as a hard cut. The hard cut is what makes the static diagrams feel like diagrams.
4. **`/engine`** is where you load the four GIFs into the layers and author the phase order.
5. **`/versions/film.html`** is the variant you lock because the film grain reads as "microscope footage" to the students, and microscope footage is the visual contract.

## A typical session (90–180 minutes)

You open `/engine` and drop the four GIFs (prophase.gif, metaphase.gif, anaphase.gif, telophase.gif) into the layers panel. You lock `/versions/film.html` and push `grain=0.3` so the canvas reads as microscope footage. You assign the phase order: prophase (0–5s), metaphase (5–10s), anaphase (10–15s), telophase (15–20s).

You fire `whip-blur` at each phase boundary (5s, 10s, 15s) and the transition resolves at 450 ms. You record the twenty-second sequence as a WebM via MediaRecorder. You drop the WebM into `/ar-loop` on your phone; the loop floats at the marker origin in the classroom.

You share the AR link via the class's LMS. The students open it on their phones and walk around the loop. You can tell, from across the room, which students are paying attention because they are the ones whose phones are pointed at the desk.

There is a moment, around the share link, when the LMS almost blocks the URL because it looks like an external link. You almost gave up. Then the IT department whitelisted the domain and you remembered why you use a tool that gives you a shareable link instead of a feature-gated portal.

## What they'd pay for

You would not pay — you are a teacher and your budget is the textbook budget. You would happily accept a free "educator tier" with longer AR recordings (10s instead of 5s) and a custom share-link domain so the LMS does not block it.

## What would make them leave

`/ar-loop` requiring a login to view. The students do not have accounts and the LMS does not support OAuth, and a login wall would erase exactly the audience you built the flashcards for. You would also leave if the AR scene ever became desktop-only; the students are on phones and the lesson happens on the phones.

## Quote

"The /ar-loop share link on the four phase WebMs is the only reason my students can walk around a dividing cell on their phones, and the `whip-blur` transition between phases is what makes the division read as motion."