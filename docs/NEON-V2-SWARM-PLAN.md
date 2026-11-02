# KAI SWARM — NEON v2 development plan

Status: Phase 1 started on `kai-swarm/neon-v2-phase1-20261102`. Production main is protected by workflow policy: **never auto-merge**.

## Operating envelope
- Maximum two concurrent agents/workstreams: UI & Accessibility, QA & Regression.
- Maximum API expenditure $2/day (budget policy; no paid autonomous execution is activated by this document).
- Missions: visual, API, regression, security, creative. Phase 1 prioritizes visual and regression.
- No production secrets, production deploys, automated merges, or changes to checkout/licensing.
- All work in a feature branch, draft PR, and human review before merge.

## Phase 1 — stabilization
- [x] Define legacy startup accent CSS variable.
- [x] Add keyboard activation and visible focus to startup overlay.
- [x] Respect reduced-motion preference for startup, status indicator and watermark.
- [x] Use dynamic viewport sizing and bounded stage grid on narrow screens.
- [ ] Validate visual layouts in an actual browser at 360, 390, 768 and 1440 px.
- [ ] Check horizontal overflow, footer reachability, safe-area offsets and portrait rotation.
- [ ] Test startup using default track, saved song, missing track, keyboard and touch.
- [ ] Run npm run check, npm run build and mobile E2E suites in CI.

## Phase 2 — interface consolidation
- Compose: media/library, scene and layers.
- Perform: stage-first view with Energy, Motion, Distortion, Density macros.
- Record: codec, framerate, quality, duration and capture diagnostics.
- Export: output quality, dimensions, preview and retry.
- Keep existing DOM IDs and event contract while reshaping controls; retain keyboard shortcuts.

## Phase 3 — musical behavior
- Section-aware intro/verse/break/chorus/outro visual pacing.
- Explicit override controls for low-confidence beat/section detection.
- Raw analog motion and glitch presets with intensity bounds.
- Per-song reproducible random seed and export metadata.

## Phase 4 — production verification
- Screenshot and DOM regression at device breakpoints.
- Validate canvas frame pacing, audio sync and recording playback.
- Security review of imports, persistence, media metadata and user-supplied files.
- CI artifact: screenshots, console errors, reproducible failure steps, pass/fail summary.

## Acceptance gate
1. No critical overflow or inaccessible control at selected breakpoints.
2. Keyboard/touch can start or recover playback.
3. Reduced motion disables discretionary blinking and continuous watermark animation.
4. Previously supported load, mix, record and export paths still pass tests.
5. PR is draft, branch isolated, no production merge.

## Current limitations
Source-level changes are committed. Browser QA and full CI results must be verified separately. The two-agent workflow above is a bounded task allocation; it does not imply an always-on background runtime has been started.
