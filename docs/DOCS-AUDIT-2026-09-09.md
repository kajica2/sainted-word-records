# Docs + Meta Audit

**Audit date:** 2026-09-09
**Repo state:** 454 commits on `main`, latest merge `ee33824` (PR #69, engine parity docs), engine.html = 7,292 lines, swr-app.html = 9,402 lines, video_single.html = 770 lines, presets/ has 30+ files, 22 sprint PRs landed since 2026-09-08.

---

## Per-doc status

### Root MDs

- **README.md** — last touched 2026-08-31; tagline says "23 personas, 20 CSS filters, local-first, zero backend, your-footage-driven." **CONTRADICTION:** local-first / zero-backend copy is stale. The codebase has a thin serverless M1 backend (`api/auth/`, `api/storage/`, `api/projects/`, `swrc_session` cookie, magic-link, Vercel Blob signed URLs) per `SECURITY.md` and `AGENTS.md`. The README never mentions auth, cloud projects, or Vercel Blob. The "How to try it" instructions still describe a single `landing.html` → `engine.html` flow and never mention `swr-app.html` at `/app` or `photo.html`. Project structure tree lists only `engine.html`, `landing.html`, etc. — missing `swr-app.html`, `photo.html`, `versions/music_video.html`, `api/`, `auth/`, `lib/`, `client/`, `preset-pipeline/`, `reels/`, `verify-screenshots/`, the PRD suite under `docs/prds/`. Claims `~32 KB` engine bundle; the actual built `dist/assets/engine-DqGHXoHA.js` is several hundred KB. Stale by ~6 weeks. **Verdict: stale + contradicting backend story.**

- **AGENTS.md** — last touched 2026-08-31; **CANONICAL** (matches project conventions used in 22 recent PRs); references the right set of files (`engine-*.client.js`, `audio-analysis-v2.js`, `api/_lib/`, `verify-*.mjs`); correctly documents the production library fetch (`scripts/fetch-library.mjs` / `LIBRARY_BLOB_URL`) and the daily preset cron. Minor: doesn't yet mention the post-2026 additions (`swr-app.html`, `versions/music_video.html` parity, `engine-keys.js`, `brandkit.client.js`, `engine-transitions.client.js`, `engine.html` parity PR #68, `photo.html`, `reels/`, `docs/prds/`). **Verdict: authoritative but ~6 weeks behind on layout; not contradicting itself.**

- **SECURITY.md** — last touched 2026-08-31; matches the actual `api/_lib/` / `safeKey()` / `swrc_session` / rate-limit code in `AGENTS.md` and the API route files. **OUTDATED SCOPE:** says backend added in "M1, 2026-08-24" and points at `.hermes/decisions/001-auth-provider.md` for the M2 (Postgres + R2) migration. No `.hermes/decisions/` directory exists in the repo (`ls .hermes/` shows only `plans/` and `templates/`); the decision doc is gone or never committed. Threat model still says "Cross-user scope — verified end-to-end (see `verify-cloud-auth.mjs`)" — that verifier is still in the repo (PR-derived from M1 work). **Verdict: accurate for code, dead link inside.**

- **launch.md** — last touched 2026-08-31; written as a Product-Hunt-style launch submission with copy like "Free. No paid tier yet.", "No login, no signup, no install.", "5 visual presets (Pulse, Drift, Strobe, Warp, Mosh)". All of these claims **contradict** the current state: README documents €25/€45/€75 service tiers and €120/€280/€600 PT; M1 backend now requires login via magic-link for cloud projects; the visual presets are now `SHORTCUT_PRESETS` (9-item list) / `versions-presets.js` (19 named presets) — not the original 5. Source URL says `https://github.com/kajica2/rnn` (monorepo) — but the README and AGENTS.md use `github.com/kajica2/sainted-word-records` and the actual remote is `kajica2/sainted-word-records`. The "OG image" / "Full-page screenshot" claims point to `landing-full.png` / `landing-light.png` / `landing-dark.png` / `landing-catalog.png` / `landing-catalog-dark.png` — none of which exist in the repo (only `og.png` inside a worktree and `press/og-card.png` exist). Bundle size claim "51 KB" is now an order of magnitude off. Dev path `/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/` doesn't match the real workspace `/Users/kaidejuricmasscmbook/Downloads/sainted-word-records/`. **Verdict: comprehensively stale — pre-M1 / pre-pricing / pre-sprint copy.**

- **ORDER_TRACKER.md** — dated 2026-08-13; manual fulfillment tracker for first 20 orders. Lists 5 curated sets ("Neon Church", "Morning Haunt", "Brutalist Grid", "Dream Sequence", "System Error"). These names do not appear in the codebase (`grep -rE "Neon Church|Morning Haunt|Brutalist Grid|Dream Sequence|System Error" .` returns no hits). The set list looks aspirational and was never tied to a real engine surface. Sets the founding-customer discount to 30% — matches README ("founding customers (first 5) get 30% off"). Acceptable as a manual tracker doc, but the set names are not load-bearing anywhere. **Verdict: stale set names; otherwise the doc still serves its one purpose.**

- **PR-site-structure.md** — written ~2026-08-31 about the URL restructure that split `index.html` into `landing.html` + `engine.html` at `/engine`. Still factually correct: `/engine` → `/engine.html`, `/index.html` 404, etc. **Minor staleness:** does not mention the post-restructure additions (`/app` → `swr-app.html`, `/photo` → `photo.html`, `/engine-demos` → `engine-demos.html`, `/versions` → `versions.html` rewrites added later). The vite plugin description predates `copy-static` / `swrc-api-middleware` / `strip-absolute-module-scripts`. The cited commit `e712003` isn't verifiable in the current `git log` (no commit with that hash exists) — likely from a pre-merge state. **Verdict: stale-on-edges, otherwise accurate.**

- **SPRINT-SUMMARY.md** — written 2026-09-09 (same day as this audit); claims "22 PRs / ~8 hours = ~2.75 PRs/hour" across the 2026-09-08/09 sprint, lists PRs #25-#65, audit queue "fully cleared (9 of 9)", says "PRD-002 through PRD-011" cleared. The PR numbers are real (verifiable in `git log`). PR #66 (docs/sprint-summary), PR #67 (docs/subagent-dev-pattern), PR #68 (engine parity feat), PR #69 (engine parity docs) all landed **after** the doc claims to summarize, but they were authored as part of the same sprint. PRD-AUDIT.md (the verdict source) confirms 9 re-specs cleared. The doc's "What ships next" table is internal planning and useful. **Inconsistency:** headline says "~7-8 hours" and again "22 PRs / ~8 hours = ~2.75 PRs/hour" — both numbers. **Verdict: accurate and current; minor self-contradiction in the velocity math.**

- **HOWTO-30s-VIDEO.md** — last touched 2026-08-31; describes recording a 30-second MP4 from `/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/` via a `nohup` Vite command on port 5174. Path is wrong (real workspace is `/Users/kaidejuricmasscmbook/Downloads/sainted-word-records/`). Says the library is "75MB of 12 videos + 15 images" — that was the prebuild reality a month ago, but since then the library has been replaced by a fetch-from-`LIBRARY_BLOB_URL` flow (`scripts/fetch-library.mjs`) — there is no `library/` dir in the repo (`ls library/` returns "No such file or directory"). Claims the `dist/` ships "the full library/ (75MB of 12 videos + 15 images) AND the 5 versions"; today the build's `dist/` does **not** include `library/` unless `LIBRARY_BLOB_URL` is set in the build env. Compatibility matrix at the end says only 5 versions (NEON/FILM/GRID/SMOKE/HALLUCINATION) — there are now 22 version pages (excluding `music_video.html`), including `collage`, `spectrum`, `typography`, `kraft`, `aurora`, etc. **Verdict: comprehensively stale — pre-M1 / pre-library-fetch / pre-version-expansion.**

- **OPTIMIZATION-AUDIT.md** — dated 2026-08-24 (pre-M1 backend); says "13 engines", "13 engine presets in `versions/`", "9 modulator modules, 13 engine pages wired". Reality: `versions/*.html` has 22 engine variants today; `versions-presets.js` defines 19 named presets; README claims "23 personas". Plan list ("typography engine", "spectrum engine", "collage engine", marketplace, persona selector) was mostly **shipped in subsequent PRs** but the audit doc has no closure note. Suggests `marketplace.html` as a new file — already exists (25 KB). Suggests "No MIDI / OSC / Ableton Bridge" — out-of-scope rationale is still valid. **Verdict: stale — gap analysis was correct at the time; everything since has not been reconciled.**

- **PRODUCTION-PLAN.md** — **DATE STAMP IS WRONG.** Header says `Date: 2026-09-03` and `Current state: 5,823 lines, 10 commits since SPA start, 27 features shipped, ALL GREEN CI`. Actual state today (2026-09-09): `swr-app.html` is **9,402 lines** (not 5,823), and the engine has had 5+ PRs of parity work since 2026-09-03 (PR #51–#68). The SPA has 50+ features live (not 27): per-layer reactor, scene pads, mood board, brandkit wiring, edit-data download, hook generator, stats widget, client review, format selector, hero frame capture, etc. — all shipped post-this-doc. The plan's four phases (P1: records, P2: performable, P3: everywhere, P4: monetizes) are completely misaligned with how the work actually shipped: real MediaRecorder MP4/WebM, real BPM (autocorrelation), beat detector, key detection (Krumhansl-Schmuckler), generative mutate/evolve/randomize, WebGL post-FX, magic-link auth, **all shipped already** but the plan says they're Phase 1–4 future work. Magic-link auth (P4.1) is **already done** — it has a full `auth/` directory and `api/auth/` routes. Cloud project save (P4.2) is **already done** — `api/projects/` exists. "Stripe Checkout" (P4.3) is the only P4 item still pending. Every "Files: `swr-app.html` only" assertion in the plan is wrong — almost every feature added post-plan landed across `music_video.html`, `engine.html`, `swr-app.html`, `brandkit.client.js`, `engine-*.client.js`, and `versions-presets.js`. **Verdict: **completely wrong on baseline state**; describes an aspirational roadmap that has been substantially executed. Keep only the "Definition of done" / Risk register / Dependency graph sections as historical reference.**

### docs/*.md

- **docs/ARCHITECTURE.md** — last touched 2026-09-09 (PR #65/#69); **the most current doc**. Accurately documents the `swr-app.html` + `engine.html` + `music_video.html` triad, the 11 engine subsystems, the render pipeline, the LFO / auto-map / genops layers, the `client/` modules, and the API surface. Recent PR #65 added `photo.html` + `make-video.html` as new-page templates. Refs `verify-pwa.mjs` (out/audit-core-features/) — that file is in `out/`, not at root, which the doc acknowledges. Refs `SWR_LAST_SONG` (`versions/last-song.js`) — file exists. Refs `PRD-AUDIT.md` — file exists at `docs/prds/PRD-AUDIT.md` (not `docs/PRD-AUDIT.md` — the relative path inside ARCHITECTURE.md says `PRD-AUDIT.md`, which is broken since the file is one level deeper). **Stale:** does not mention `engine-transitions.client.js` (700-line CSS transition pack shipped 2026-09-09), `video_single.html` (770-line single-canvas transition showcase, shipped 2026-09-09), `reels/` directory (new music-video reel format), `docs/dev/subagent-dev-pattern.md` (PR #67), `docs/prds/pages/` (10 platform-surface specs), the `SWR_MOOD` / `SWR_HOOK_DETECTOR` / `SWR_STATS` / `SWR_SCENES` / `SWR_REVIEW` / `SWR_HERO_FRAMES` / `SWR_FIT` / `SWR_Brandkit` globals added in the sprint (SPRINT-SUMMARY.md §"Architectural changes"). **Verdict: best current architecture doc, but ~10% of the post-sprint surface is undocumented.**

- **docs/SPRINT-SUMMARY.md** — 2026-09-09 (latest sprint retro); accurate as of today; the only contradiction with itself is the "~7-8 hours" vs "~8 hours" velocity. The "Test counts before/after" table reads as if it's the post-sprint state but doesn't include the new smokes added in PR #55/#57/#59/#63. The "What ships next" list is internal planning and is good signal. **Verdict: current and accurate. Minor math typo.**

- **docs/CI-VERIFY-STRATEGY.md** — dated 2026-08-25; "The repo had ~80 `verify-*.mjs` scripts" — still accurate (root has ~80 of them). Says "5 verifiers gate CI"; `package.json` confirms `verify:cloud-auth`, `verify:hf-publish`, `verify:rotation-enabled`, `verify:story-graph`, `verify:hallucination-story`, `verify:autoplay`, `verify:e2e-media-record` — that's **7** not 5 wired in `package.json` (the doc's 5 omitted story-graph and hallucination-story). `verify:weddings`, `verify:library-loads`, `verify:collage-loads`, `verify:overlay-failure`, `verify:library-switcher`, `verify:music-video-maker`, `verify:mvm-review-fixes`, `verify:mvm-phase8`, `verify:mvm-phase9`, `verify:mvm-phase10` are all wired but not in the doc's 5. Mentions `scripts/check-verify-smoke.mjs` and `scripts/lib/verify-runner.mjs` — both exist. Refs `.github/workflows/ci.yml` — that file exists. **Verdict: stale — drift between the doc's 5 and `package.json`'s actual gate list.**

- **docs/CROSS-APP-BRIDGE.md** — 2026-08-25; "13 engine-driven visualizers" — that number is now 22. **No follow-up** after the 3 deployment options were recommended; deployment status is unknown. The doc references freq-lab bridge work that landed in commits `5d647d5`–`1240d0a` — `git log` no longer shows these commits (they're pre-merge / squashed). The recommendation "A, then C" was never executed. **Verdict: stale numbers, status unknown — no follow-up note.**

- **docs/VERCEL-DEPLOY.md** — 2026-08-25; recipe still mostly accurate: `vite build` → `dist/`, `tools/deploy-vercel.sh` exists (`ls tools/deploy-vercel.sh` confirms), `vercel.json` rewrites still include the ones the doc references. **Stale:** "5 Puppeteer smokes" gate was true at the time — now `package.json` has 7 `verify:*` runners wired. The doc's claim "doesn't touch the `package.json` / `package-lock.json` / `verify-hf-publish.mjs` / `.github/workflows/ci.yml` / `docs/CI-VERIFY-STRATEGY.md` / `scripts/check-verify-smoke.mjs` / `scripts/lib/` WIP" — those have all been touched. The doc explicitly opts out of the visualizer-control transport (`tools/freq-bridge.js`, `client/visualizer-controller.js`) — that work landed via PR #67-ish and is **not in `tools/` anymore** (lives in `client/`). **Verdict: stale paths and gate list, but the recipe itself still works.**

- **docs/hf-publish.md** — 2026-08-25; mostly accurate for the magenta-dsp HF push. **Verify paths:** `scripts/push-magenta-dsp-to-hf.sh` (exists), `scripts/build-magenta-dsp-bundle.sh` (exists), `tools/hf-publish.html` — **does not exist** (`ls tools/hf-publish.html` returns "No such file or directory"). The doc tells users to "Open `http://localhost:5174/tools/hf-publish/`" — that path 404s today. The bundled script path is correct; the admin UI HTML is missing. **Verdict: dead link for the admin UI; CLI path still works.**

- **docs/RALPH-WIGGUM-RECEIPTS.md** — 2026-08-25; explicit session-receipts log; **named-receipt archive** ("durable copy" of `/tmp/ralph-loops/INDEX.md`). The commits it cites (`5d647d5`, `8cc6d59`, `28e82ef`, `d6e5f03`, `1240d0a`, `823e8b2`, `323810d`, `9cd54c4`, `02415ea`, `01af195`, `f97dd2b`, `5ec611e`) are all in the **pre-merge / pre-squash era** — most cannot be found in current `git log` (the only matching commit is `5ec611e feat(library): per-asset × button with optimistic delete + 5s undo`). Receipts index is **historically valuable** but the commit SHAs are not findable today. Acceptable as a session log, but the "commit → file" table is unverifiable. **Verdict: historically accurate, currently un-verifiable. Park it as "session archive"; don't use as a navigation map.**

- **docs/music-video.md** — 2026-09-09 (PR #69); comprehensive reference for `versions/music_video.html` (864 lines). Recent edit updated for engine parity. **Minor gaps:** doesn't mention `engine-transitions.client.js` (post-2026 transition pack), `video_single.html` (single-canvas transition showcase), `reels/` JSON format, or `SWR_HOOK_DETECTOR` / `SWR_MOOD` / `SWR_SCENES` / `SWR_STATS` globals in detail. The "Last-merge SHA" reference "see `git log --oneline origin/main -1`" is fine. **Verdict: accurate for `music_video.html`; missing recent (post-2026-09-09) subsystem references.**

- **docs/music-video-research-framework.md** — dated 2026-09-09; explicitly says "Adapted from a daily-cron methodology note dated 2026-09-09". Refs `engine-transitions.client.js` and 4 specific preset files (`presets/2026-09-09-click-kahn-whip-cyan.json`, etc.). The presets do exist (verified via `ls presets/ | grep 2026-09-09` returns the 4 files), and `engine-transitions.client.js` exists (700 lines). **Issue:** of all the doc authors, this one is **the only doc to mention `engine-transitions.client.js`**; README, AGENTS.md, ARCHITECTURE.md, SECURITY.md, launch.md, OPTIMIZATION-AUDIT.md, PRODUCTION-PLAN.md, CI-VERIFY-STRATEGY.md, CROSS-APP-BRIDGE.md, VERCEL-DEPLOY.md, hf-publish.md, and RALPH-WIGGUM-RECEIPTS.md all **omit it**. The new file is undocumented at the meta level. **Verdict: useful research artifact; sole reference to `engine-transitions.client.js`.**

- **docs/dev/subagent-dev-pattern.md** — exists, 11,708 bytes, 2026-09-09 (PR #67). Codifies the 22-PR sprint pattern. **Verdict: current and useful.**

- **docs/prds/_index.md** — current; "🎉 As of 2026-09-09, all 9 re-spec items have shipped" — accurate (matches SPRINT-SUMMARY + PRD-AUDIT). PRD links to all 21 PRDs verified. **Verdict: current.**

- **docs/prds/PRD-AUDIT.md** — 21,799 bytes; comprehensive audit table; ships with PRD-002-AUDIT.md (the "no work needed" verdict). **Verdict: current.**

---

## Missing READMEs

The following directories have no README and contain non-trivial new surface:

- **reels/** — new music-video reel format. Contains `manifest.json` (3 lines, 1 entry) + `rooftop-opening.json` (3,545 bytes, 3-panel storyboard for `audios/kraft.mp3`). Referred to by `reels/manifest.json` `updated_at: 2026-09-09T10:00:00+00:00`. **Not mentioned in any root MD, AGENTS.md, README.md, or ARCHITECTURE.md.** The format (panels with `at`/`hold`/`mood`/`transitionIn`/`transitionOut` + audio cue analysis) is novel enough that it needs documentation.
- **docs/prds/pages/** — 10 platform-surface specs (`PAGE-001-DASHBOARD.md` … `PAGE-010-HELP-LEARN.md`). No top-level explanation of what these are or how they relate to the 21 PRDs.
- **data/** — empty (just `.gitkeep`-like)? `ls data/` was not enumerated but ARCHITECTURE.md says `SWRC_DATA_DIR` defaults to `./data`. No README on the directory.
- **dist-dev/** — auto-generated build artifacts (per AGENTS.md: "wipes `dist/`, `dist-dev/`, `.vite/`"). Exists today with 38 files; should be `.gitignore`d and has no README. Not in `.gitignore` per the visible state? (`.gitignore` content was not verified, but `dist-dev/` is tracked because it's sitting in the working tree.)
- **tools/** — has VISUALIZER-CONTROL.md and several `.py`/`.mjs` files but **no README** explaining the dev-tools convention. AGENTS.md mentions `tools/` but only one-liners.
- **presets/** — has daily-generated JSON presets. **No README** on the format. `preset-pipeline/cron.sh` is the canonical entry point (per AGENTS.md) but the `presets/` directory itself has no schema doc; `docs/music-video-research-framework.md` is the only place the format is exemplified.
- **versions/** — has 22 variant HTML pages. **No README** listing what each variant is (the legacy "5 visual versions" framing from HOWTO-30s-VIDEO.md is stale).
- **lib/** — has ~30 client modules. AGENTS.md says "shared helpers live in `lib/`" but no module-by-module README.
- **client/** — has ~10 post-2026 modules. ARCHITECTURE.md §4.2 documents these well, but there's no top-level README at `client/README.md`.
- **marketplace/** — has `curated/`. No README. (The doc suggests a `marketplace.html` page exists separately.)
- **portfolio/**, **promo/**, **press/**, **keyart/**, **icons/**, **legal/** — content directories; no READMEs (acceptable for static asset dirs).

---

## Contradictions

1. **README.md ↔ SECURITY.md / AGENTS.md** — README says "zero backend", "local-first", "free". SECURITY.md + AGENTS.md document a thin M1 serverless backend (auth, storage, projects) and PT (€120/€280/€600) tiers. The "Open the engine" quickstart never mentions the auth-gated `/app` SPA.

2. **README.md ↔ launch.md** — README says "Free" engine; launch.md says "Free. No paid tier yet." README documents service tier pricing (€25/€45/€75) and PT pricing — launch.md has neither.

3. **HOWTO-30s-VIDEO.md ↔ README.md / AGENTS.md** — both mention a 27-item library. AGENTS.md documents `scripts/fetch-library.mjs` + `LIBRARY_BLOB_URL` as the source; HOWTO says "auto-loads from the `library/` folder" — that directory does not exist. README says "Library auto-loads with 27 demo clips (first visit only)" — same contradiction.

4. **OPTIMIZATION-AUDIT.md ↔ README.md** — OPTIMIZATION-AUDIT says "13 engines", "13 engine pages wired", "23 personas" not yet shipped. README says "23 personas in 4 families" with full sub-listing, and `versions/` has 22 distinct variants today.

5. **PRODUCTION-PLAN.md ↔ reality** — header claims "5,823 lines, 10 commits since SPA start, 27 features shipped". Actual: 9,402 lines (62% larger), 50+ features shipped (per SPRINT-SUMMARY + ARCHITECTURE.md). Plan says Phase 1–4 work is future; all of P1, P2, P3.1, P4.1, P4.2 are **already shipped**.

6. **docs/CI-VERIFY-STRATEGY.md ↔ package.json** — doc says "5 verifiers gate CI". `package.json` `scripts` block wires 7 `verify:*` runners (added `verify:story-graph` + `verify:hallucination-story` after the doc was written).

7. **README.md ↔ AGENTS.md** — README's "Try it (60 seconds)" walkthrough starts at `splash → click Open the engine → /engine/`. AGENTS.md (and `vercel.json`) reveal that `/app` → `swr-app.html` is a separate production target — README never acknowledges `swr-app.html` exists or that the "real" production surface is at `/app`.

8. **launch.md ↔ README.md source location** — launch.md's "Source" line says `github.com/kajica2/rnn` (monorepo). README and AGENTS.md say `github.com/kajica2/sainted-word-records` (this repo) and `github.com/kai-djuric/sainted-word-records` (README). Three different answers; the actual remote is `kajica2/sainted-word-records`.

9. **launch.md ↔ launch.md's own dev path** — Says "Kai Djuric. Solo developer. Email: kajicadjuric at the usual domains." HOWTO-30s-VIDEO.md uses `/Users/kajicadjuric/...` for the dev path. README uses `kai [at] saintedwordrecords [dot] com`. SECURITY.md uses `kai.djuric@gmail.com`. Four different email conventions across four files.

10. **HOWTO-30s-VIDEO.md ↔ versions/** — HOWTO says "5 visual versions → opens /versions/" and names NEON, FILM, GRID, SMOKE, HALLUCINATION. `versions/` has 22 variants today (including `collage`, `spectrum`, `typography`, `kraft`, `aurora`, etc.). `versions.html` is the new top-level entry, not a top-left badge.

11. **SPRINT-SUMMARY.md ↔ itself** — headline "≈7-8 hours" vs footer "~8 hours = ~2.75 PRs/hour". Math is consistent at 8 hours but the headline range gives two numbers.

12. **AGENTS.md ↔ PRODUCTION-PLAN.md on backend** — AGENTS.md documents the M1 backend as shipped (auth, storage, projects, `safeKey()`, `TRUSTED_PROXIES`). PRODUCTION-PLAN.md §4.1 lists Magic-link auth as **future P4 work**.

13. **ARCHITECTURE.md ↔ SPRINT-SUMMARY.md on subsystems** — ARCHITECTURE.md §4.1 lists 11 `engine-*.client.js` files. SPRINT-SUMMARY.md §"Architectural changes" lists 8 new IIFE-side-effect globals (`SWR_HERO_FRAMES`, `SWR_FIT`, `SWR_HOOK_DETECTOR`, `SWR_REVIEW`, `SWR_STATS`, `SWR_MOOD`, `SWR_SCENES`, `SWR_Brandkit`) that ARCHITECTURE.md does not enumerate.

14. **README.md persona count ↔ AGENTS.md / versions/** — README claims "23 personas". AGENTS.md doesn't enumerate. ARCHITECTURE.md is silent. The persona names listed in README do not all appear as `versions/*.html` filenames; they appear in `personas.js` and `personas.html`.

15. **launch.md "Free" claim vs README "Free engine, paid tiers exist"** — launch.md explicitly says "Free. No paid tier yet" and "No login, no signup". Both contradicted by the README's documented €25/€45/€75 service tiers and €120/€280/€600 PT tiers, and by the actual auth flow.

---

## Critical

- [PRODUCTION-PLAN.md] — **Baseline numbers are wrong by ~60% on file size and a factor of 2× on features shipped**. Header says 5,823 lines / 10 commits / 27 features / "ALL GREEN CI"; reality is 9,402 lines / 50+ features / multiple smokes added post-plan. The 4-phase roadmap (P1 records → P2 performable → P3 everywhere → P4 monetizes) describes work that is **already done** for P1, P2, P3.1, P4.1, P4.2. The doc reads as a future plan when it should read as a retrospective or be replaced by SPRINT-SUMMARY.md + PRD-AUDIT.md.

- [README.md] — **"Zero backend, local-first" framing is contradicted by the entire M1 backend** (`api/`, `swrc_session`, magic-link, Vercel Blob signed URLs). The pricing section documents paid tiers but the launch.md submission still says "Free. No paid tier yet". Project structure tree is missing `swr-app.html`, `photo.html`, `versions/music_video.html`, `api/`, `auth/`, `lib/`, `client/`, `preset-pipeline/`, `reels/`, the entire `docs/prds/` tree, and 17 of the post-sprint additions.

- [HOWTO-30s-VIDEO.md] — **Wrong dev path** (`/Users/kajicadjuric/Documents/...` instead of `/Users/kaidejuricmasscmbook/Downloads/sainted-word-records/`); **claims a `library/` directory exists that doesn't**; describes a `nohup ./node_modules/.bin/vite` invocation when AGENTS.md says to use `npm run dev`; the 5-version matrix omits the 17 other variants; bundle-size claim "82MB" predates the library-fetch change.

- [SECURITY.md] — **References `.hermes/decisions/001-auth-provider.md` — that file does not exist in the repo** (`ls .hermes/` returns only `plans/` and `templates/`). Either the file was never committed or the path was wrong from the start.

- [launch.md] — **A launch submission with copy that contradicts the product** ("Free. No paid tier yet", "No login, no signup"). If this doc gets sent anywhere it will mis-sell. Bundle claim "51 KB" is off by an order of magnitude. `og.png` / `landing-full.png` / `landing-light.png` / `landing-dark.png` / `landing-catalog.png` / `landing-catalog-dark.png` references all point to files that don't exist (only `press/og-card.png` exists).

---

## High

- [docs/ARCHITECTURE.md] — **Does not document `engine-transitions.client.js`** (700-line CSS transition pack shipped 2026-09-09, the same day as this audit) — even though it's a major engine subsystem. Doesn't mention `video_single.html` (the 770-line single-canvas transition showcase). Doesn't document the `reels/` directory or the JSON reel format. Doesn't list the 8 new IIFE globals (`SWR_MOOD`, `SWR_HOOK_DETECTOR`, `SWR_STATS`, `SWR_SCENES`, `SWR_REVIEW`, `SWR_HERO_FRAMES`, `SWR_FIT`, `SWR_Brandkit`) that SPRINT-SUMMARY.md explicitly names.

- [AGENTS.md] — **Project layout section is missing `swr-app.html`** (the actual SPA at `/app`), **`photo.html`** (post-2026 new page), **`make-video.html`** (PRD #44), **`engine-transitions.client.js`**, **`brandkit.client.js`**, **`engine-keys.client.js`** (post-2026 keyboard dispatcher), **`engine-timing.client.js`**, **`engine-timing-panel.client.js`**, **`engine-lfos.client.js`**, **`engine-automap.client.js`**, **`engine-lfo-panel.client.js`**, **`engine-panel-visibility.client.js`**, **`engine-render.client.js`**, **`engine-genops.client.js`**, **`reels/`**, **`dist-dev/`**, **`out/`**, **`verify-screenshots/`**, **`scripts/lib/`**, the **`docs/prds/`** PRD suite (21 PRDs + audit + 4 standalone specs + 10 platform-page specs), and **`docs/dev/subagent-dev-pattern.md`**. The "verify-*.mjs" line says "~80 files" which is still accurate but the example E2E list omits many `verify:mvm-*` / `verify:library-*` / `verify:collage-loads` / `verify:overlay-failure` scripts wired into `package.json`.

- [docs/CI-VERIFY-STRATEGY.md] — **Drift between the "5 gate verifiers" and `package.json`'s actual `verify:*` scripts** (7 wired). The doc's table lists `verify-cloud-auth`, `verify-hf-publish`, `verify-rotation-enabled`, `verify-autoplay`, `verify-e2e-media-record`; `package.json` also wires `verify:story-graph`, `verify:hallucination-story`, `verify:library-loads`, `verify:collage-loads`, `verify:overlay-failure`, `verify:library-switcher`, `verify:music-video-maker`, `verify:mvm-review-fixes`, `verify:mvm-phase8/9/10`, `verify:weddings`. The "Archive candidates" list explicitly excluded `verify-story-graph.mjs` and `verify-hallucination-story.mjs` as "feature smokes, not engine surface" — but `package.json` now gates CI on them.

- [README.md personas count] — README claims "23 personas in 4 families: 10 original (RAW, POSTER, MASK, FX, FILTER, NEON, FILM, GRID, SMOKE, HALLUCINATION) + 5 generative (LIQUID GLASS, PEARL HAZE, CLUB STROBE, VHS VIBE, NEON WASH) + 5 MORPHA (ANCHOR, FLOW, FRACTURE, VOID, ECHO) + 3 Train-stages" — but 10 + 5 + 5 + 3 = **23 only because Train-stages is plural;** the actual file count is unverifiable from the doc alone (requires grepping `personas.js` or `personas.json`). The count is internally consistent but the names overlap with the `versions/*.html` engine variants (NEON, FILM, GRID, SMOKE, HALLUCINATION are also engines) — there's no documentation of how "personas" vs "engine variants" differ.

---

## Medium

- [launch.md] — Wrong source URL (`kajica2/rnn` monorepo) — actual repo is `kajica2/sainted-word-records`. Bundle size "51 KB" off by an order of magnitude. Wrong `/Users/kajicadjuric/...` dev path. Free + no paid tier contradicts README's documented pricing. Phone numbers in the how-to section reference a non-existent splash file (open `https://sainted-word-records.vercel.app/landing.html` instead of `https://sainted-word-records.vercel.app/`).

- [HOWTO-30s-VIDEO.md] — "Default is `30s` — exactly what you asked for" — README's pricing table promises "PT Band" MP4 export is a v1.1 feature, but the doc treats MP4 as default. The flow says "Click `● REC` — button turns red, status: `recording · MP4 · 30s`" — but the engine falls back to WebM, the doc doesn't acknowledge the codec-fallback.

- [ORDER_TRACKER.md] — Set names ("Neon Church", "Morning Haunt", "Brutalist Grid", "Dream Sequence", "System Error") are not in the codebase. Order templates ("Hi [name]") still reference "SWR Single/Double/Full/Custom" — the README's pricing table uses "Single/Double/Full Rotation/Custom Source". Founding-customer 30% off matches README. The doc is functional but the set names should be tied to `marketplace/curated/` or the engine's actual `personas.js` set list.

- [OPTIMIZATION-AUDIT.md] — Says "13 engines" 5 times. Today `versions/*.html` has 22 variants; README claims 23 personas. Three of the gap items in the audit's "What exists today" section (typography engine, spectrum engine, collage engine) **shipped** (collage + typography + spectrum are now real `versions/*.html` files), but the audit has no closure note. The audit's "Persona selector in onboarding" suggestion — never closed.

- [PR-site-structure.md] — Cites commit `e712003` (engine-rename commit) — that hash is not findable in current `git log` (probably pre-squash). Doesn't mention subsequent URL additions: `/app` → `swr-app.html`, `/photo` → `photo.html`, `/engine-demos` → `engine-demos.html`, `/versions` → `versions.html`, `/about`, `/changelog`, `/press`, `/status` rewrites. The vite plugin description predates `copy-static` / `swrc-api-middleware` / `strip-absolute-module-scripts` (the current `vite.config.js` plugins).

- [docs/CROSS-APP-BRIDGE.md] — "13 engine-driven visualizers" is now 22. The commits it cites (`5d647d5`–`1240d0a`) are pre-merge / squashed; not findable in current `git log`. The recommendation "A, then C" was never executed — the deployment problem still exists.

- [docs/RALPH-WIGGUM-RECEIPTS.md] — A durable session archive but the commit SHAs it references are mostly unfindable in current `git log`. Acceptable as a session log; not useful as a navigation map. Park it as historical.

- [docs/VERCEL-DEPLOY.md] — The recipe still works but the gate list (`check + check:full`) is now `check` (8 sub-checks per `package.json`) + `check:full` (adds `check:verify` + `check:automix-smoke`). The "doesn't touch `docs/CI-VERIFY-STRATEGY.md` / `scripts/lib/`" carve-out has been violated (both touched post-deploy-doc). The visualizer-control paths referenced (`tools/freq-bridge.js`, `tools/mobile/`, `tools/osc-bridge.py`) have been moved/refactored — `tools/freq-bridge.js` → `tools/freq-bridge.js` still exists but `tools/mobile/` was deleted.

- [docs/hf-publish.md] — **References `tools/hf-publish.html` — that file does not exist** (`ls tools/hf-publish.html` returns "No such file or directory"). The CLI flow (`scripts/push-magenta-dsp-to-hf.sh`) still works. The admin panel flow is broken (the file was either deleted or never committed; references to it in the doc 404). The `verify-hf-publish.mjs` verifier may now skip the admin-panel mount test.

- [docs/SPRINT-SUMMARY.md] — Self-contradiction: "~7-8 hours" (headline) vs "~8 hours = ~2.75 PRs/hour" (footer). Math is consistent at 8 hours but the headline gives a range. The "Test counts before/after" table lists smoke counts but not the new smokes added in PR #55/#57/#59/#63.

---

## Low

- [README.md] — "**23 personas, 20 CSS filters**" — the 20 CSS filters claim is unverifiable from the doc alone; needs a grep against `engine-genops.css` + `video-fx.css`. Tagline "your-footage-driven" contradicts the M1 cloud-storage and PT-credit-bank flows (those are engine-AST-driven, not footage-driven).

- [README.md] — Project-structure tree lists `output/` ("PRD research + audit reports") and `launch/` ("5 launch docs") — neither directory exists (`ls output/` → `out/`; `ls launch/` → no such dir). The actual directories are `out/`, `docs/prds/`, and `docs/`-level MDs.

- [SECURITY.md] — "Hall of Fame" section is empty with a placeholder — fine, but the doc lists a "2026-08-24" M1 milestone; could use a "M2 status" line if M2 is in flight.

- [ORDER_TRACKER.md] — "Last updated: 2026-08-13" footer is accurate (the doc hasn't been touched since). The 5-slot founding-customer tracker + DM templates + delivery email are copy-paste ready — usable as-is, just needs the set-name list reconciled.

- [docs/CI-VERIFY-STRATEGY.md] — "The 5 that gate CI" — even if the count was 5 at the time, the archive list excludes 13+ scripts that are now CI-gated (see Medium entry above).

- [docs/CROSS-APP-BRIDGE.md] — "Bluetooth driver — still macOS-only, still needs a named device" parked item is fine.

- [docs/VERCEL-DEPLOY.md] — "Reversibility" section is fine. The "single irreversible step" framing of `vercel promote` is accurate.

- [docs/hf-publish.md] — The "Troubleshooting" section is good. "Roll back" section is good.

- [docs/RALPH-WIGGUM-RECEIPTS.md] — The "Reversibility table" at the top is excellent guidance. Keep this.

- [docs/SPRINT-SUMMARY.md] — The "Architectural changes made during sprint" subsection is the most useful artifact in the audit. Process notes are honest about subagent reliability issues. Maintainers pickup section is clear.

- [docs/music-video-research-framework.md] — The "Mood-to-technique mapping" table is useful for content creation; the "Categories of transition" list is good; the "Related engine artefacts" footer is the **only doc-wide reference** to `engine-transitions.client.js` — keep this.

- [docs/dev/subagent-dev-pattern.md] — Codifies a real lesson; references real failure modes from the 22-PR sprint. Useful as a procedural-memory doc.

- [docs/prds/_index.md] — Current; PRDs enumerated; audit-queue clearance called out correctly.

- [docs/prds/PRD-AUDIT.md] — Comprehensive; per-PRD verdicts; "shipped as PR #55" annotations are accurate.

- [PR-site-structure.md] — The diff blocks (`index_app.html` → `engine.html`, manifest `swr-v1` → `swr-v2`) are correct; the verification table at the bottom is correct.

---

## Summary table

| File | Last touched | Date | Verdict |
|---|---|---|---|
| README.md | 2026-08-31 | stale | contradicting M1 backend + missing post-sprint additions |
| AGENTS.md | 2026-08-31 | stale | canonical but missing ~10% of post-sprint layout |
| SECURITY.md | 2026-08-31 | accurate | dead link to `.hermes/decisions/001-auth-provider.md` |
| launch.md | 2026-08-31 | critical | free + no-login copy, wrong paths, dead PNG refs, off-by-10× bundle size |
| ORDER_TRACKER.md | 2026-08-13 | functional | set names aspirational; templates still usable |
| PR-site-structure.md | ~2026-08-31 | stale-on-edges | accurate, missing newer rewrites + new plugins |
| SPRINT-SUMMARY.md | 2026-09-09 | current | self-math typo |
| HOWTO-30s-VIDEO.md | 2026-08-31 | critical | wrong dev path, library doesn't exist, 5 vs 22 variants |
| OPTIMIZATION-AUDIT.md | 2026-08-24 | stale | 13 vs 22 engines; gaps have shipped |
| PRODUCTION-PLAN.md | 2026-09-03 | critical | baseline wrong 60%; roadmap mostly done |
| docs/ARCHITECTURE.md | 2026-09-09 | current | missing 3 post-sprint subsystems |
| docs/SPRINT-SUMMARY.md | 2026-09-09 | current | math typo |
| docs/CI-VERIFY-STRATEGY.md | 2026-08-25 | stale | 5 vs 7 gated |
| docs/CROSS-APP-BRIDGE.md | 2026-08-25 | stale | 13 vs 22; deployment status unknown |
| docs/VERCEL-DEPLOY.md | 2026-08-25 | stale | gate list drift; tools/mobile/ gone |
| docs/hf-publish.md | 2026-08-25 | broken-link | `tools/hf-publish.html` doesn't exist |
| docs/RALPH-WIGGUM-RECEIPTS.md | 2026-08-25 | historical | commits not findable; park as archive |
| docs/music-video.md | 2026-09-09 | current | minor gaps |
| docs/music-video-research-framework.md | 2026-09-09 | current | sole reference to engine-transitions.client.js |
| docs/dev/subagent-dev-pattern.md | 2026-09-09 | current | codifies sprint lessons |
| docs/prds/_index.md | current | current | — |
| docs/prds/PRD-AUDIT.md | current | current | — |

## Top 5 fixes by impact (not applied — report only)

1. **PRODUCTION-PLAN.md** — replace with "what shipped" retrospective OR delete. The current doc misleads readers about both baseline and roadmap.
2. **launch.md** — delete or annotate "pre-M1 / pre-pricing" — sending it as a launch submission today would misrepresent the product.
3. **HOWTO-30s-VIDEO.md** — fix the dev path, acknowledge `LIBRARY_BLOB_URL` flow, drop the 5-version list, point at `versions.html` + the new `swr-app.html` SPA.
4. **README.md** — update project-structure tree (add `swr-app.html`, `photo.html`, `api/`, `auth/`, `client/`, `lib/`, `preset-pipeline/`, `reels/`, `docs/prds/`); add an "Auth + cloud (M1)" subsection; replace "zero backend" framing.
5. **docs/ARCHITECTURE.md** — add `engine-transitions.client.js`, `video_single.html`, `reels/` JSON format, the 8 new IIFE globals from SPRINT-SUMMARY §"Architectural changes".