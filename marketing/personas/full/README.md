# Full Personas — README

The 28 personas in this directory are **workflow-grounded** — each one names the engine surfaces they actually touch, the specific routes (`/engine`, `/versions/film.html`, `/ar-loop`), specific presets (`kraft`, `void`, `phosphor`), specific transitions (`whip-blur`, `glitch-block`, `chromatic-split`), and specific capabilities (BPM detection, 12-bin chromagram, MediaRecorder WebM export, magic-link login). These are not strategic typologies (those live at `marketing/personas/01–11`) and they are not the abandoned consumer personas (those live at `marketing/personas/abandoned/`). This is a different layer: real workflows against the real surface area.

The 11 surfaces that matter:

| Code | Surface | Notes |
| --- | --- | --- |
| ENG | `/engine` | main entry; drop song + library, get reactive layered composition |
| VER | `/versions/*` | 26+ visual styles (neon, film, grid, smoke, hallucination, eclipse, aurora, chrome, fractal, gallery, glitch, pulse, void, watercolor, baroque, kraft, mosaic, phosphor, spectrum, tape, typography, music_video, neon-pulse, collage, music_video_mtv) |
| FX | 14-FX pipeline | `fx-postprocess.js` + `video-fx.css`; WebGL fullscreen-quad pipeline with chroma, grain, glow, temp, sepia, grayscale, posterize, mut, mutAlgo, bloom, vignette, liquid, pearl, blur |
| TX | 10 CSS transitions | `engine-transitions.client.js`; whip-blur, swivel, glitch-block, chromatic-split, zoom-through, flash-cover, lens-flare, paint-stroke, circle-wipe, warp-dissolve |
| AR | `/ar-loop` | markerless AR via A-Frame + AR.js; 5s WebM record; share link without login |
| SB | storyboard engine | planned (see `.hermes/plans/2026-09-09_smart-pattern-storyboard.md`); bar-aligned auto-edits with override |
| REC | recorder | MediaRecorder → WebM → ffmpeg → MP4 |
| PST | presets | 19 anchor presets plotted on a (warmth × intensity) 2D anchor map |
| AAP | `/api/projects` + magic-link auth | save and reload storyboards/projects with login |
| LIB | library | curated set of clips/images/GIFs with tags (mood, palette, motion, subject, duration, isVideo/isImage/isGif) |
| AUD | audio analysis v2 | BPM (autocorrelation), key/scale (Krumhansl-Schmuckler), 12-bin chromagram, onsets, duration |

## File index

### Per-surface (10 — one primary surface each)

| File | Persona | Surfaces |
| --- | --- | --- |
| `001-ar-loop-poster.md` | The AR Poster Maker | AR, LIB, PST, REC |
| `002-storyboard-editor.md` | The Storyboard-First Editor | AAP, AUD, LIB, PST, SB |
| `003-version-hopper.md` | The Variant Collector | VER, PST, TX, REC |
| `004-fx-surgeon.md` | The FX Surgeon | FX, PST, AUD, REC |
| `005-transition-choreo.md` | The Transition Choreographer | TX, ENG, LIB, REC |
| `006-recorder-renderer.md` | The Export-First Renderer | REC, ENG, VER, TX, LIB |
| `007-anchor-curator.md` | The Anchor-Map Curator | PST, LIB, FX, VER, AUD |
| `008-audio-theorist.md` | The Audio Theorist | AUD, ENG, FX, PST |
| `009-tag-janitor.md` | The Tag Janitor | LIB, AUD, PST, SB |
| `010-auth-projects.md` | The Magic-Link Project Saver | AAP, ENG, PST, SB, REC |

### Cross-cutting (5 — combining 3–4 surfaces each)

| File | Persona | Surfaces |
| --- | --- | --- |
| `011-ar-poster-artist.md` | The AR Poster Artist | ENG, AR, REC, PST, TX |
| `012-live-vj.md` | The Live VJ | PST, TX, REC, ENG, FX, VER |
| `013-film-composer.md` | The Film Composer | SB, LIB, AAP, PST, AUD, ENG |
| `014-theory-sonifier.md` | The Theory Sonifier | AUD, FX, VER, REC, ENG |
| `015-ar-flashcards.md` | The AR Flashcard Educator | AR, REC, TX, ENG, VER |

### Domain (13 — defined by the domain, each touching 3+ surfaces)

| File | Persona | Surfaces |
| --- | --- | --- |
| `016-short-film-scorer.md` | The Short-Film Scorer | ENG, PST, SB, REC, AAP |
| `017-touring-visualist.md` | The Touring-Band Visualist | VER, FX, TX, AR, PST |
| `018-data-sonifier.md` | The Research Data Sonifier | AUD, FX, REC, LIB, ENG |
| `019-gallery-curator.md` | The Gallery Curator | ENG, AR, PST, REC, LIB |
| `020-podcast-visual.md` | The Podcast Visual Editor | AUD, LIB, REC, FX, ENG |
| `021-music-therapist.md` | The Music Therapist | ENG, PST, REC, AR, LIB |
| `022-ad-creative-director.md` | The Ad Agency Creative Director | PST, TX, ENG, AAP, VER, LIB |
| `023-online-music-teacher.md` | The Online Music Teacher | ENG, VER, REC, SB, PST |
| `024-bedroom-producer.md` | The Bedroom Producer | ENG, PST, LIB, REC, VER |
| `025-choreographer.md` | The Choreographer | ENG, FX, AR, VER, AUD, PST |
| `026-wedding-videographer.md` | The Wedding Videographer | ENG, PST, VER, REC, LIB, TX |
| `027-album-cover-designer.md` | The Album Cover Designer | VER, PST, FX, REC, ENG |
| `028-ar-storyboard-reviewer.md` | The AR Storyboard Reviewer | AR, SB, REC, AAP, PST |

## Coverage matrix

`X` = persona touches the surface as part of their workflow; `·` = no.

| Persona | ENG | VER | FX | TX | AR | SB | REC | PST | AAP | LIB | AUD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The AR Poster Maker | · | · | · | · | X | · | X | X | · | X | · |
| The Storyboard-First Editor | · | · | · | · | · | X | · | X | X | X | X |
| The Variant Collector | · | X | · | X | · | · | X | X | · | · | · |
| The FX Surgeon | · | · | X | · | · | · | X | X | · | · | X |
| The Transition Choreographer | X | · | · | X | · | · | X | · | · | X | · |
| The Export-First Renderer | X | X | · | X | · | · | X | · | · | X | · |
| The Anchor-Map Curator | · | X | X | · | · | · | · | X | · | X | X |
| The Audio Theorist | X | · | X | · | · | · | · | X | · | · | X |
| The Tag Janitor | · | · | · | · | · | X | · | X | · | X | X |
| The Magic-Link Project Saver | X | · | · | · | · | X | X | X | X | · | · |
| The AR Poster Artist | X | · | · | X | X | · | X | X | · | · | · |
| The Live VJ | X | X | X | X | · | · | X | X | · | · | · |
| The Film Composer | X | · | · | · | · | X | · | X | X | X | X |
| The Theory Sonifier | X | X | X | · | · | · | X | · | · | · | X |
| The AR Flashcard Educator | X | X | · | X | X | · | X | · | · | · | · |
| The Short-Film Scorer | X | · | · | · | · | X | X | X | X | · | · |
| The Touring-Band Visualist | · | X | X | X | X | · | · | X | · | · | · |
| The Research Data Sonifier | X | · | X | · | · | · | X | · | · | X | X |
| The Gallery Curator | X | · | · | · | X | · | X | X | · | X | · |
| The Podcast Visual Editor | X | · | X | · | · | · | X | · | · | X | X |
| The Music Therapist | X | · | · | · | X | · | X | X | · | X | · |
| The Ad Agency Creative Director | X | X | · | X | · | · | · | X | X | X | · |
| The Online Music Teacher | X | X | · | · | · | X | X | X | · | · | · |
| The Bedroom Producer | X | X | · | · | · | · | X | X | · | X | · |
| The Choreographer | X | X | X | · | X | · | · | X | · | · | X |
| The Wedding Videographer | X | X | · | X | · | · | X | X | · | X | · |
| The Album Cover Designer | X | X | X | · | · | · | X | X | · | · | · |
| The AR Storyboard Reviewer | · | · | · | · | X | X | X | X | X | · | · |
| **Total per surface** | **20** | **13** | **10** | **9** | **8** | **7** | **20** | **22** | **6** | **14** | **10** |

## What we noticed

- The presets system (22 personas) and the recorder (20 personas) are the two most-touched surfaces. They are also the two surfaces that have the cleanest mental models (anchor map, WebM file). The engine core itself is close behind at 20, which says the engine is the connective tissue — almost every workflow passes through it, but it is rarely the *primary* surface.
- Projects/auth is the least-touched surface at 6 personas, but every persona who touches it does so because they trust the magic-link login specifically. None of them would accept OAuth as a substitute. That is a small set with a strong signal.
- Storyboard (7 personas) and recorder (20 personas) feel like two distinct audiences. Of the 7 personas that touch the storyboard engine, only 4 also touch the recorder (the storyboard editor, the magic-link saver, the film composer, the short-film scorer). The other 3 (the tag janitor, the film composer, the AR storyboard reviewer) treat the storyboard as a planning artifact, not a render target. Storyboard-first users are not recorder-first users.
- The 10 CSS transitions are touched by 9 personas, all of them as part of a choreography workflow — never as a default behavior. Every transition user fires transitions manually, on phrase boundaries, and would leave if the engine started auto-firing on every bar. The transitions are a vocabulary, not a metronome.
- The AR loop surface (8 personas) splits cleanly into two camps: take-home loops (gallery curator, music therapist, wedding-videographer-adjacent) and merch-table posters (touring visualist, AR poster maker, AR poster artist). Both camps insist on no-login share links; both camps would leave forever if a login were required. The 5-second AR record limit is a shared tolerance, not a complaint.
- The 14-FX pipeline is touched by 10 personas, and in 7 of those the chroma uniform is the specific uniform they push. The FX pipeline's chroma is the single most-named specific feature in the entire library. That is a quiet signal about what the FX pipeline is actually for.
- Audio analysis v2 (10 personas) is overwhelmingly used as a sanity check on the chromagram — the 12-bin chromagram is the data these users cite, not the BPM. Two personas (the FX surgeon, the theory sonifier) use it as the *primary* surface; the other 8 use it as ground truth for another surface's claim.
- Three personas (the variant collector, the FX surgeon, the album cover designer) explicitly record multiple takes and pick the best. The recorder's "record and re-record" loop is a feature for them, not a bug — they would leave if the engine started auto-picking a single take.
- The library surface (14 personas) is most often touched as a tag-curation or shot-picking problem, not a browsing problem. Six of the 14 library users either re-tag the library or constrain the ShotPicker to a tag bucket. The library is metadata, not a folder.
- Three personas (the FX surgeon, the touring visualist, the live VJ) explicitly refuse any "smart" auto-correction or "trust the AI" pass. The engine's refusal to smooth the surface is a feature for them, not a limitation.
- The magic-link login is the only auth flow that appears across all the projects/auth users. None of the 6 AAP personas would accept OAuth. The /api/projects endpoint is the API they would pay to keep; the auth flow is the API they would not change.
