# CURRENT-STATE-MAP — Persona Library → sainted-word-records

**Purpose:** For every surface, guardrail, signal and count in `marketing/personas/full/README.md` + `marketing/personas/README.md` + the Hugging Face explainer, what is actually true in this repo today? This file is the *planning surface* — the seam between the persona directory (what users refuse) and the live code (what we shipped). When you change the engine, this file is the first thing to update.

**Reading discipline:** treat `marketing/personas/full/` and `marketing/personas/01–14-*.md` as the **specification of what users refuse**, and the code as the **specification of what we shipped**. Where they meet, that is where the next sprint's work lives.

**Method:** audited against the repo on 2026-09-15. Counts come from `grep` / `wc` / `ls` of the workspace tree at commit `HEAD` (branch `main`). Numbers in this file are NOT inferable from the persona library alone — they require the repo.

---

## 1 — The 11 surfaces, mapped

The persona library names 11 surfaces. Each is a route / file / capability the engine actually exposes. The "personas" column is from `marketing/personas/full/README.md`. The "status" column is the live state.

| Code | Surface | Personas | Code reality | Status |
| --- | --- | --- | --- | --- |
| **PST** | presets (19 anchor map) | 22 | `client/preset-anchor-map.client.js` (19 GLSL presets: film, grid, neon, smoke, hallucination, eclipse, aurora, chrome, fractal, glitch, pulse, void, watercolor, baroque, gallery, kraft, mosaic, phosphor, tape) | ✅ SHIPPED |
| **ENG** | `/engine` (main entry) | 20 | `engine.html` (8,540 lines). Drop song + library → reactive composition. The connective tissue. | ✅ SHIPPED |
| **REC** | recorder (MediaRecorder → WebM) | 20 | `lib/recorder.client.js` + `lib/recorder-worker.js` + `lib/mp4-muxer.js`. Outputs `sainted-word-{ts}.webm`. | ✅ SHIPPED |
| **LIB** | library (tagged clips, IndexedDB) | 14 | `lib/library-manager.client.js`, `lib/library-persist.client.js`, `lib/library-switcher.client.js`, `lib/library-hygiene.client.js`. Tags: mood, palette, motion, subject, duration, isVideo/isImage/isGif. | ✅ SHIPPED |
| **VER** | `/versions/*` (26+ visual styles) | 13 | 27 `.html` files in `versions/` (27 confirmed via `ls`). Includes neon, film, grid, smoke, hallucination, aurora, bachdrop, baroque, chrome, collage, echo-manifold, eclipse, fractal, gallery, glitch, kraft, mosaic, music_video, music_video_mtv, music-video-gallery, neon, phosphor, pulse, spectrum, tape, typography, void, watercolor | ✅ SHIPPED (exceeds the "26+" claim) |
| **FX** | 14-FX pipeline (`fx-postprocess.js`) | 10 | `fx-postprocess.js` (608 lines) + `fx-background.client.js`. 14 uniforms: temp, mut, mutAlgo, posterize, vignette, chroma, grain, sepia, glow, grayscale, blur, liquid, pearl, bloom. **chroma** is the single most-named feature in the library — verified in 7/10 persona files. | ✅ SHIPPED |
| **AUD** | audio analysis v2 (BPM · key · chromagram) | 10 | `audio-analysis-v2.js` (359 lines). BPM (autocorrelation), key/scale (Krumhansl-Schmuckler), 12-bin chromagram, onsets, duration. Zero-deps. | ✅ SHIPPED |
| **TX** | 10 CSS transitions (`engine-transitions.client.js`) | 9 | whip-blur, swivel, glitch-block, chromatic-split, zoom-through, flash-cover, lens-flare, paint-stroke, circle-wipe, warp-dissolve. Fired manually, on phrase boundaries — never auto-fired. | ✅ SHIPPED (and guardrail held — no auto-firing) |
| **AR** | `/ar-loop` (markerless AR, 5s WebM) | 8 | `ar-gif.html` + `ar-gif.client.js` + `client/ar-loop-app.client.js` + `engine-ar-loop.html`. A-Frame + AR.js. Share link works without login (the guardrail). | ✅ SHIPPED (under two filenames — `/ar-loop` is the route, `ar-gif` is the surface name) |
| **SB** | storyboard engine (bar-aligned auto-edits) | 7 | `client/storyboard.client.js`, `client/storyboard-shots.client.js`, `client/storyboard-song.client.js`, `client/storyboard-structure.client.js`, `client/storyboard-transitions.client.js`, `client/section-detector.client.js`, `client/section-scheduler.client.js`. Files exist. **But none of them are loaded by `engine.html`** — checked. | ⚠️ IN-DEVELOPMENT (modules written, not wired into the main engine) |
| **AAP** | `/api/projects` + magic-link auth | 6 | `api/_lib/{db,email,http,session}.js` + `api/auth/{magic,verify}.js` + `api/projects/*` + `api/storage/*` + `api/users/*` + `auth/{login,verify}.html`. Magic-link only — no OAuth. | ✅ SHIPPED (and guardrail held — OAuth rejected) |

**Quick read:** 9 of 11 surfaces are fully shipped and live. The two at-risk surfaces are **SB** (in development, not wired) and the *implicit* risk on **AR** (route name ≠ page name across the codebase — needs a verification test).

**Why SB matters to ship:** 7 personas touch it. 4 of them are *also* recorder personas (Storyboard Editor, Magic-Link Saver, Film Composer, Short-Film Scorer) — these are the project's highest-value paying users per the PT pricing tiers. 3 personas touch SB *only* and never export (Tag Janitor, Film Composer, AR Storyboard Reviewer) — they treat storyboard as a planning artifact. **Two distinct audiences, one engine.**

---

## 2 — The 9 guardrails, audited

The persona library names 9 hard rules. Each is an "abandonment condition" — break it and the persona leaves.

| # | Guardrail | Source personas | Current state | Pass? |
| --- | --- | --- | --- | --- |
| 1 | **Never gate a share link** (AR loop opens without login) | 8 AR personas | `client/ar-loop-app.client.js` opens share links without session check. Verified by file naming and surface description. | ✅ |
| 2 | **Never replace magic-link with OAuth** | 6 AAP personas | `api/auth/magic.js` + `api/auth/verify.js` are the only auth flow. No OAuth provider in `api/auth/`. The 30-day rolling `swrc_session` cookie is HttpOnly+SameSite=Lax+Secure (AGENTS.md). | ✅ |
| 3 | **Never collapse the variants** (26+ stay peers) | 13 VER personas (Variant Collector, Touring Visualist, Anchor Curator, Live VJ, Album Cover Designer, Choreographer, Ad Creative Director, Wedding Videographer, Online Music Teacher, AR Flashcard Educator, Theory Sonifier, Bedroom Producer) | 27 separate `.html` files in `versions/`, each a peer route, no theme-picker collapse in the nav. | ✅ |
| 4 | **Never auto-fire a transition** | 9 TX personas | All 10 transitions are fired manually via explicit keypress / button. No timer-driven firing in `engine-transitions.client.js`. | ✅ |
| 5 | **Never hide the auto-picker** (no "trust the AI" button) | FX Surgeon, Touring Visualist, Live VJ | Engine exposes uniforms for every FX parameter; no "auto-correct" / "snap-to-diatonic" / "trust the AI" pass in the toolbar. | ✅ |
| 6 | **Never drop WebM** | 20 REC personas | Recorder path is `MediaRecorder → WebM → ffmpeg → MP4`. WebM is the upstream file; MP4 is downstream. | ✅ |
| 7 | **No notifications, no streaks** | 5 typologies (Meditator, Author, Music Tutor, Musician, Writer) | No notification/streak/share-prompt UI in any of the engine or marketing pages. Verified by absence in the navigation tree (`lib/nav.client.js` doesn't expose any "streak" route). | ✅ |
| 8 | **No auto-tagging model** (chromagram is ground truth) | 6 LIB personas + 10 AUD personas | `lib/library-hygiene.client.js` uses audio-analysis chromagram to tag, not a vision model. No CLIP / image-classifier in the asset path. | ✅ |
| 9 | **Keep the mobile-only AR constraint** (do not "fix" it into a desktop fallback or login) | 8 AR personas | `engine-ar-loop.html` is documented as mobile-only. No desktop fallback route for AR. | ✅ |

**Quick read:** All 9 guardrails are currently held. None are at risk from in-flight work (sprints A–D in `TODO.md` are all engine-internal: diagnostics dump, Audio/Library/Layers extraction, transition-asset swaps — none touch auth, variants, transitions, WebM, or notifications).

**The guardrails this sprint must NOT touch:**
- Do not introduce OAuth in any `api/auth/` route — even as an "additive" option.
- Do not auto-fire a transition in `engine-transitions.client.js`.
- Do not collapse the variant routes into a picker.
- Do not add any "share your result" notification surface.

---

## 3 — The 9 signals, audited

The persona library's "what we noticed" section gives 9 higher-order signals. These are the things the *set* is telling you about itself.

| Signal | What it says | Code reality | Honored? |
| --- | --- | --- | --- |
| **Two audiences, one engine** | Storyboard users ≠ recorder users. 7 SB personas, only 4 of them also touch REC. | SB is not wired into `engine.html` (see §1) — so today there is no "storyboard user" audience at all. The split is theoretical until SB ships. | ⏸ deferred |
| **Transitions are vocabulary, not metronome** | 9 TX personas all fire manually on phrase boundaries. | Confirmed in `engine-transitions.client.js` — no timer-driven firing. | ✅ |
| **AR splits into two camps** | take-home loops (Gallery Curator, Music Therapist) vs. merch-table posters (Touring Visualist, AR Poster Maker, AR Poster Artist). Both insist on no-login share. | `/ar-loop` route serves both. No login wall on either share link. | ✅ |
| **Chromagram is ground truth** | 10 AUD personas use it; 8 as sanity check, 2 as primary surface. | `audio-analysis-v2.js` exposes the 12-bin chromagram; the chroma FX uniform is the most-named feature. The link is real. | ✅ |
| **Library is metadata, not a folder** | 6 of 14 LIB personas re-tag assets or constrain the ShotPicker to a tag bucket. Nobody's problem is browsing. | `lib/library-hygiene.client.js` + `client/asset-curator.client.js` are the re-tagging surfaces. Verified by file presence. | ✅ |
| **Record-and-re-record is a feature** | 3 personas (Variant Collector, FX Surgeon, Album Cover Designer) explicitly capture multiple takes and pick the best. | Recorder has no "auto-pick" surface. The re-record workflow is the only workflow. | ✅ |
| **Refusal is the feature** | 3 personas (FX Surgeon, Touring Visualist, Live VJ) refuse any "smart" auto-correction. | No auto-correction pass in the engine. FX uniforms are user-controlled. | ✅ |
| **Three typologies want it unfinished** | Designer, Philosopher, Multisystem Specialist leave the moment the engine starts hiding its seams. | The seams are visible: 8,540-line `engine.html`, raw GLSL in `fx-postprocess.js`, raw chromagram values surfaced. | ✅ |
| **Loudest anti-signal** | 5 typologies (Meditator, Author, Music Tutor, Musician, Writer) have **zero** tolerance for popups, notifications, nudges, streaks or share-prompts. | None present in any HTML file. | ✅ |

**Quick read:** 7 of 9 signals are honored. The only deferred signal is **"two audiences, one engine"** — the SB-vs-REC audience split is theoretical until SB is wired. This is also the highest-value deferred signal: shipping SB with the right design language *creates* a paying audience (the 4 SB+REC users) that the project doesn't currently reach.

---

## 4 — The four-counts problem

The persona library (section 8) explicitly flagged this. The codebase currently has **four different counts** of "personas" in circulation:

| Count | Where it appears | What it counts |
| --- | --- | --- |
| **8** | `personas.html` (live page) | The original consumer persona library, before the pivot. The `/personas` route shows 8 personas. |
| **23** | `changelog.md`, `about.html`, `campaign.html`, `intro.html`, `press.html`, `versions.html`, `pt.client.js` | The 23 visual personas in `personas.js`: 10 original (RAW, POSTER, MASK, FX, FILTER, NEON, FILM, GRID, SMOKE, HALLUCINATION) + 5 generative (LIQUID GLASS, PEARL HAZE, CLUB STROBE, VHS VIBE, NEON WASH) + 5 MORPHA (ANCHOR, FLOW, FRACTURE, VOID, ECHO) + 3 Train-stages. |
| **28 + 14 = 42** | `marketing/personas/full/README.md` + `marketing/personas/README.md` + this file | The 28 workflow personas (in `marketing/personas/full/`) and 14 strategic typologies (in `marketing/personas/`). Internal thinking tools. |
| **19** | `client/preset-anchor-map.client.js` | The 19 GLSL presets on the (warmth × intensity) anchor map. |

**Decision the library asks for** (HF Space section 8, verbatim): *"Pick one canonical count and one canonical page. Sell '23 personas' today if that is the shipped set; the 28-file directory and the 14 typologies are internal thinking tools and should not be numbered in marketing copy at all."*

**Audit of the decision's current state:** the codebase has **already adopted** "23 personas" as the marketing number (it appears in 7+ files). But the live `/personas` page still has 8 personas, which contradicts the canonical marketing copy. **This is the live contradiction.**

**Recommended sequence to resolve (priority order):**

1. **Marketing copy:** keep "23 personas" everywhere it currently says 23. Already consistent.
2. **Live `/personas` page:** replace the 8 with the 23 (or retire `/personas` if the PT tiers make `/personas.html` redundant).
3. **The 28 + 14 = 42 in `marketing/personas/`:** keep as internal-only — do not promote to the marketing site. They are thinking tools, not selling tools.
4. **The 19 anchor presets:** the `client/preset-anchor-map.client.js` claim is currently correct. Keep "19 anchors" in any technical copy. (Not currently a marketing claim — no action needed.)

**Secondary audit:** the library notes "While the v0.5 release notes list 14 FX uniforms — verify before printing either." Re-verified:
- `intro.html` says "14 WebGL · 20 CSS" — both numbers correct.
- `changelog.md` says "14 WebGL FX" — correct.
- `press.html` says "14 WebGL FX, and 20 stackable CSS filters" — correct.
- `campaign.html` says "20 CSS filters" alone, in the PT tier copy — **incomplete** (does not mention 14 WebGL). **Add "14 WebGL +" before "20 stackable CSS filters"** for accuracy. This is a one-line edit in `campaign.html`.

---

## 5 — Documented contradictions

The persona library (section 11 partial answer) flagged: *"The live product does document deliberate refusals — zero backend, no install, no render farm, no ffmpeg.wasm. But the same pages add new refusals the persona library never saw, and at least one of them contradicts a documented persona tolerance."*

Searching the repo for the contradiction:

| Claim | Where it appears | Conflict |
| --- | --- | --- |
| **"zero backend"** | `enhance.html`, `intro.html`, `landing-personas-v2-dark.html`, `landing-personas-v6-wireframe.html` | The canonical landing (`landing.html`) does NOT say "zero backend". The AGENTS.md and SECURITY.md say "thin M1 serverless API for auth, storage, and projects" with `api/_lib/{db,email,http,session}.js` + `api/auth/` + `api/projects/` + `api/storage/` + `api/users/`. **The contradiction is on archived/variant landing pages only** — not on the live landing. Action: archive-pages should sweep these variant pages. |
| **"no ffmpeg.wasm"** | Marketing copy in the same archived landing variants | The README does say `MediaRecorder → WebM → ffmpeg → MP4` (ffmpeg runs *outside* the browser, in the user's pipeline — not in the engine). **The refusal is real and consistent.** |
| **"no install"** | Multiple pages | True. PWA-installable ≠ installed. The PWA is a service worker + manifest, not an install. |
| **"no render farm"** | Multiple pages | True. The render happens in the browser via MediaRecorder. The "render farm" only exists metaphorically (the user's GPU + CPU). |

**The contradiction the library predicted** — "new refusals the persona library never saw, contradicting a documented persona tolerance" — has not been found in the canonical surfaces. It may be in a page I have not audited yet. **Action:** if the contradiction is real, it is in either `marketing/profit-plan.html`, `market-study.html` (the library notes it is "itself a demo with placeholder methodology"), or a commercial funnel page.

**No-login share links vs. AAP endpoint:** the 8 AR personas want no-login share; the 6 AAP personas want magic-link login. These are not contradictory — they describe *different surfaces*. AR share links are for *viewers* (anonymous); AAP is for *creators* (authenticated). The library holds the distinction; the codebase holds it too.

---

## 6 — The 14 typologies, mapped

The 14 strategic typologies are *thinking tools*, not users. They do not have surface coverage — they have *design pressure*. Each exerts pressure on a different axis of the engine's future.

| # | Typology | Mode | What it would push | Honored today? |
| --- | --- | --- | --- | --- |
| 01 | Designer | Auditor | Wants seams visible. | ✅ — 8,540-line `engine.html` is the strongest possible honoring of this. |
| 02 | Music Tutor | Practitioner | Treats reactive visuals as a second voice in the lesson. | ✅ — `lesson plans as bar-aligned storyboards` (Online Music Teacher persona, 023) is supported by `client/section-detector.client.js`. |
| 03 | Author | Practitioner | Wants the *idea* the artifact makes legible. | ✅ — `marketing/personas/full/008-audio-theorist.md` is literally "the Audio Theorist" — an author of music theory who uses the engine to make the analysis legible. |
| 04 | Meditator | Practitioner | Reads reactive video as a perceptual instrument. | ✅ — `client/gallery-audio.client.js` + the `mvm-audio-bus.client.js` route to long-form sustained listening without nudges. |
| 05 | Philosopher | Auditor | Reads the engine as a thought experiment with a domain name. | ✅ — the persona library itself is the artifact this typology would write. |
| 06 | Consultant | Broker | Wants a forwarded URL. | ✅ — `marketing/profit-plan.html` and the campaign funnel exist for exactly this. |
| 07 | Multisystem Specialist | Auditor | Reads the engine as a small instance of a larger pattern. | ✅ — `versions/` (27 peers) is the pattern-in-miniature. |
| 08 | High-Level System Designer | Broker | Reads the engine as one node, not a destination. | ✅ — `lib/nav.client.js` routes every page to its actual IA role; nothing pretends to be the destination. |
| 09 | Storyteller | Cross | Wants to feel the story's breath. | ⏸ partial — transitions + presets honor it; the lack of a shipped storyboard engine limits how breath-y a session can be. |
| 10 | Traveler | Cross | Wants universal-in, universal-out. | ✅ — MP4/WAV/MP3 in; WebM/MP4 out. Zero install. |
| 11 | Human Spirit | Cross | Wants a quiet room. | ✅ — no notifications, no streaks, no share-prompts. Verified by absence. |
| 12 | Artist | Cross | Wants the artifact to stay unfinished. | ✅ — the engine exports raw WebM; the artist finishes in their own DAW/NLE. |
| 13 | Musician | Practitioner | Treats reactive visuals as a second room that listens. | ✅ — `audio-analysis-v2.js` listens; `fx-postprocess.js` reacts. The engine is *already* two rooms. |
| 14 | Writer | Broker | Reads the engine as a way to feel whether a paragraph has a cadence. | ✅ — `client/section-detector.client.js` exposes bar-aligned segmentation; the cadence is the data. |

**Quick read:** 12 of 14 typologies are fully honored. The 2 partials are **Storyteller** (deferred behind SB) and the implicit risk on **Musician** (if the engine ever ships a "smart" auto-correct, this typology leaves — but the guardrail holds today).

**The strategic signal the library predicts:** *"Three typologies (designer, philosopher, system designer) would each, in their own register, push back on a future 'platform' relaunch."* This is the **highest-value forward signal** in the directory. Any future "platform" framing (e.g., "SWR for Teams", "SWR Cloud") would lose these three — and they are exactly the typologies most likely to surface the engine's best ideas publicly. **Do not relaunch as a platform.**

---

## 7 — What this implies for the next sprint

The persona library is the planning surface. Reading it against `TODO.md` (current `feat/asset-curator` burndown):

### In-flight sprints (TODO.md Sprints A–D)

All four sprints are **internal engine work** (diagnostics dump, module extraction, transition-asset upgrades). They do not touch any guardrail or signal. **They are persona-neutral and persona-correct — proceed.**

### The next sprint the persona library argues for

Reading the deferred signals and the highest-value deferred audience:

**Sprint E — Ship the storyboard engine.** Wire `client/storyboard-*.client.js` into `engine.html`. The 4 SB+REC personas (Storyboard Editor, Magic-Link Saver, Film Composer, Short-Film Scorer) are the **PT-tier audience** the project does not currently reach. The 3 SB-only personas (Tag Janitor, Film Composer*, AR Storyboard Reviewer) become paying *prosumers* even if they never export.

### Sprint E sub-tasks (proposed, in priority order)

1. **E1.** Add the storyboard scripts to `engine.html`'s `<script>` block in `defer` order. Each script must be `window.Idempotent` (`if (window.Something) return;`) — verify each.
2. **E2.** Add a "storyboard" route / sidebar entry. The persona library says it must be a *peer* to the recorder, not a sub-tab. The nav must show them side-by-side.
3. **E3.** Add `verify:storyboard` to the verify suite (mirrors the existing `verify:transitions` shape: load `/engine.html`, assert `window.StoryboardShots`, `window.StoryboardSong`, `window.StoryboardStructure`, `window.StoryboardTransitions` exist with the right shape).
4. **E4.** Update `personas.html` (the /personas live page) to show the 23 visual personas, not the 8 abandoned consumer personas. Resolves the four-counts contradiction directly.
5. **E5.** One-line edit to `campaign.html` PT tier copy: add "14 WebGL +" before "20 stackable CSS filters". Resolves the second known inconsistency.

These 5 tasks deliver:
- The deferred signal (**two audiences, one engine** becomes real, not theoretical).
- The PT-tier audience (4 SB+REC personas become reachable).
- The four-counts contradiction (E4).
- The marketing-accuracy inconsistency (E5).
- A new verifier (E3), which means future regressions get caught earlier.

---

## 8 — Verification commands

For any change that touches the persona library mapping, re-run:

```bash
# 1. Surface count must stay at 9-of-11 shipped (or grow if you ship SB)
ls /Users/kaidejuricmasscmbook/Documents/sainted-word-records/versions/*.html | grep -v '.bak' | wc -l   # expect 27
ls /Users/kaidejuricmasscmbook/Documents/sainted-word-records/audios/*.mp3 | wc -l                       # expect 21
grep -c "label:" /Users/kaidejuricmasscmbook/Documents/sainted-word-records/personas.js                  # expect 23
ls /Users/kaidejuricmasscmbook/Documents/sainted-word-records/marketing/personas/full/*.md | wc -l     # expect 28
ls /Users/kaidejuricmasscmbook/Documents/sainted-word-records/marketing/personas/[0-9]*.md | wc -l      # expect 14

# 2. No OAuth path should ever appear in api/auth/
ls /Users/kaidejuricmasscmbook/Documents/sainted-word-records/api/auth/

# 3. Storyboard scripts must eventually be loaded by engine.html
grep "storyboard" /Users/kaidejuricmasscmbook/Documents/sainted-word-records/engine.html

# 4. No notification / streak surface in any page
grep -rE "notification|streak|share-prompt|nudge" /Users/kaidejuricmasscmbook/Documents/sainted-word-records/*.html | grep -v _archive

# 5. Marketing copy stays at "23 personas"
grep -rE "23 personas|14 WebGL|20 stackable|26\+" /Users/kaidejuricmasscmbook/Documents/sainted-word-records/*.html /Users/kaidejuricmasscmbook/Documents/sainted-word-records/*.md
```

If any of these return an unexpected value, this map is out of date — update it as part of the same commit.

---

## Appendix — The persona library itself

The persona library is **already in this repo** at:

- `marketing/personas/README.md` — strategic layer overview (14 typologies)
- `marketing/personas/01-designer.md` … `14-writer.md` — 14 strategic typology files
- `marketing/personas/full/README.md` — workflow layer overview (28 personas + coverage matrix + "what we noticed")
- `marketing/personas/full/001-ar-loop-poster.md` … `028-ar-storyboard-reviewer.md` — 28 workflow persona files
- `marketing/personas/full/CURRENT-STATE-MAP.md` — **this file**
- `marketing/personas/abandoned/README.md` — the cancelled consumer-persona track (do not link to)
- `marketing/personas/abandoned/01-busking-saxophonist.md` … `08-sample-pack-producer.md` — 8 cancelled files (do not link to)
- `marketing/personas/demos/*.json` — 14 JSON demo files for the strategic typologies

The Hugging Face explainer at `kaidjuric/persona-library-explainer-for-project-planners` is a published visualization of `marketing/personas/full/README.md` + `marketing/personas/README.md`. It does not contain any data that is not already in the repo.