# The AR Flashcard Educator

**Slug:** ar-flashcards
**Surfaces touched (3+ minimum):** AR, recorder, transitions, engine, versions
**One-line:** A high-school biology teacher who makes AR flashcards by recording 5-second WebMs of cell division, looping them via /ar-loop, and firing `whip-blur` between phases.

## Who they are
You are a high-school biology teacher in your early forties who has been teaching for 15 years and who has started using visuals in class because the textbook's static diagrams are losing the students. You are not a coder and you have never opened After Effects. Your toolbelt is a smartboard, a folder of GIFs from the textbook's website, and a willingness to learn one new tool per year if it helps the students.

## What they're trying to do
You want to drop four GIFs of cell division (prophase, metaphase, anaphase, telophase) into /ar-loop, record each as a 5-second WebM, and stitch them together with `whip-blur` transitions between phases so the students can walk around the cell on their phones and watch the division happen in space. You share the AR link via the class's LMS and the students record the AR scene with their own phones for review at home.

## Which surfaces they actually use, and why
1. **/ar-loop** — the entry point; each GIF becomes a loopable markerless AR object in the classroom.
2. **Recorder** — the 5-second WebM capture per phase; you re-record if a phase reads too fast.
3. **Transitions** — `whip-blur` (450ms) between phases so the phase shift reads as motion, not as a hard cut.
4. **Engine** — you load the four GIFs into the engine's layers and author the phase order.
5. **Versions** — you lock the variant at /versions/film.html because the film grain reads as "microscope footage" to the students.

## A typical session (90-180 minutes)
1. You open /engine, drop the four GIFs (prophase.gif, metaphase.gif, anaphase.gif, telophase.gif) into the layers panel.
2. You lock /versions/film.html, push `grain=0.3` so the canvas reads as microscope footage.
3. You assign the phase order: prophase (0-5s), metaphase (5-10s), anaphase (10-15s), telophase (15-20s).
4. You fire `whip-blur` at each phase boundary (5s, 10s, 15s) — the transition resolves at 450ms.
5. You record the 20-second sequence as a WebM via MediaRecorder.
6. You drop the WebM into /ar-loop on your phone, the loop floats at the marker origin in the classroom.
7. You share the AR link via the class's LMS; the students open it on their phones and walk around the loop.
8. You almost quit at step 7 — the LMS almost blocked the share link because it looked like an external URL. You almost gave up before the IT department whitelisted the domain.

## What they'd pay for
You would not pay — you are a teacher and your budget is the textbook budget. You would happily accept a free "educator tier" with longer AR recordings (10s instead of 5s) and a custom share-link domain so the LMS does not block it.

## What would make them leave
You would leave forever if /ar-loop required a login to view, because the students do not have accounts and the LMS does not support OAuth. You would tolerate the 5-second AR record limit forever — it is enough for a phase.

## Quote
"The /ar-loop share link on the four phase WebMs is the only reason my students can walk around a dividing cell on their phones, and the `whip-blur` transition between phases is what makes the division read as motion."
