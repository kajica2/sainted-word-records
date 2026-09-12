# Engine Onboarding — HyperFrames-Driven Two-Mode Flow

> For: `engine.html` only (the web panel; not marketing surfaces)
> Mode gate: `localStorage['swr.onboarded.v1']` — empty/missing → **basic (tour)**; present → **advanced (dashboard modal only)**
> Re-open path: `#swr-keys-help-btn` ("?") or `?` keystroke → **always opens the dashboard shortcuts modal**, regardless of mode

## Two modes, one entry point

| Mode | Trigger | Surface |
|---|---|---|
| **basic** | first visit (no `swr.onboarded.v1`) | the new `swr-onboarding-hf.client.js` cinematic tour — 5 beats with synthetic cursor + spotlight + per-beat caption |
| **advanced** | any subsequent visit | tour never auto-opens; the existing `#swr-onboard` shortcuts modal is the only "?" content |

This preserves the existing `?` button / shortcuts modal as the advanced-mode dashboard. The new tour replaces the auto-open path on first visit, not the modal itself.

## The 5-beat cinematic tour (`cursor-ui-demo` blueprint, static-stage state tour variant)

Locked GSAP timeline registered on `window.__timelines`, deterministic (no `Math.random`), finite repeats only, transform-only tweens. The composition contract (`hyperframes-core`) is in force — single paused timeline, no autoplay, `data-duration` governs length.

### Beat 0 (0.0–1.0s) — Title card
- Backdrop dim, center panel spring-pop (`back.out(2)`)
- Kinetic-type beats: "Welcome to the engine" → "Drop, play, record."
- 2 sentence typewriter reveal via `discrete-text-sequence`

### Beat 1 (1.0–3.2s) — Drop a song
- Spotlight hole on `#swr-start` overlay (the auto-start card) using `clip-path`
- Synthetic cursor springs in from off-screen (`physics-press-reaction`)
- Cursor path: top-right → `#swr-start` → press
- Caption typewriter: "Drop a song anywhere — audio becomes the score"
- Beat-locked ripple on click (`cursor-click-ripple`)

### Beat 2 (3.2–5.4s) — Drop clips into library
- Camera-static; spotlight transfers to `#library` via `depth-of-field-blur` on everything else
- Synthetic file chip drags in from below (`cursor-drag`, ghost = "my-clip.mp4")
- Drop-snap into `#library-grid` with spring entrance

### Beat 3 (5.4–7.0s) — Add a layer + RE-MAP
- Spotlight to `#remap` button
- Caption: "Hit RE-MAP until the composition lands"
- Cursor lands on `#remap`, ripple, a `#layers` row springs in via `spring-pop-entrance`

### Beat 4 (7.0–8.6s) — Press Play
- Spotlight to `#play`
- Caption: "Play. Bass, mids, treble, beats drive the composition."
- Cursor clicks; the `#render` canvas briefly lifts via `card-morph-anchor` (mocked — a brief overlay that fades to indicate "the canvas is alive")

### Beat 5 (8.6–11.0s) — Press Record / Export — payoff, holds
- Spotlight expands to both `#rec` and `#export-video`
- Caption: "REC records live. Export batches the whole song."
- Cursor clicks `#export-video`, ripple, lock static and hold for ~2s

### Beat 6 (11.0–13.0s) — Shortcuts grid-card-assemble + dismiss
- Title card swap: "All the keys you just learned."
- 8-item grid-card-assemble (spring-pop entrance + `svg-path-draw` check marks), one per keyboard shortcut
- Each card holds 0.3s, then the whole panel `card-morph-anchor`s down + fades
- Persists `swr.onboarded.v1 = {dismissedAt: ISO, version: 1, mode: 'basic'}`

## Mode gate (controller logic)

```js
function isDismissed() { return !!readStored(); }   // existing helper

if (!isDismissed()) {
  // First visit ever — basic mode. Run the cinematic tour.
  setTimeout(runHFTour, 600);  // 600ms matches existing AUTO_OPEN_DELAY_MS
} else {
  // Advanced — do nothing on boot.
}

// ? button and ? key — ALWAYS open the dashboard shortcuts modal
// (the existing SWR_ONBOARD.toggle behavior, unchanged).
```

`?` button → existing `SWR_ONBOARD.toggle()` → modal opens regardless of mode. The new client never overrides this.

## Files

### NEW
- `swr-onboarding-hf.client.js` — motion controller. ~450 LOC. Exports `window.SWR_ONBOARD_HF = { play, reset, state }`.
- `.hermes/plans/swr-onboarding-hf.md` (this plan)
- `.hermes/plans/swr-onboarding-hf-state.json` — initial state
- `.hermes/plans/swr-onboarding-hf-journal.mdl` — append-only
- `verify-onboarding-hf.mjs` — Puppeteer smoke test (golden-screenshot)

### MODIFIED
- `engine.html` — add `<script src="/swr-onboarding-hf.client.js" defer></script>` to `<head>` (after `swr-build-id.client.js`). Single one-line change.
- `vite.config.js` — add `'swr-onboarding-hf.client.js'` to `rootFiles` so it ships to `dist/`.
- `package.json` — add `"verify:onboarding-hf": "node verify-onboarding-hf.mjs"`.

### NOT MODIFIED
- The existing `#swr-onboard` modal markup + controller stay intact — that's the advanced-mode surface.
- `swr-build-id.client.js` is untouched.

## HyperFrames compliance checklist

- [ ] Single paused GSAP timeline registered on `window.__timelines`
- [ ] No `Math.random` / `Date.now` / `performance.now` in tweens — beat cues indexed off `tl.time()` only
- [ ] Transform-only tweens (`x`, `y`, `scale`, `rotation`, `opacity`) — no `width` / `height` / `top` / `left`
- [ ] All `fromTo` with explicit from-states (correct under seek; `immediateRender: false` when re-owning)
- [ ] No `repeat: -1` — finite repeats only
- [ ] Per-beat DOM measurements (`getBoundingClientRect`) at **build time only**, never inside timeline tweens
- [ ] `will-change: transform` on the spotlight panel and synthetic cursor
- [ ] No CSS `transition` on animated elements
- [ ] Idempotent — `if (window.__swrOnboardingHfLoaded) return`
- [ ] DOM-shape-agnostic — works regardless of which other engine scripts have loaded

## Verification (`verify-onboarding-hf.mjs`)

10 checks:
1. `node verify-onboarding-hf.mjs` boots a static server on dist:5187
3. With fresh localStorage → `#swr-onboard-tour` mounts, tour element present, GSAP timeline registered on `window.__timelines`
4. After 2s the tour has advanced past beat 0 (title card gone, beat 1 caption visible)
5. By 12s the tour has reached the shortcuts grid-card-assemble
6. localStorage `swr.onboarded.v1` set after dismiss
7. Reload with localStorage set → no tour mounts
8. Click `?` button → modal opens (advanced-mode path works)
9. Cursor + spotlight elements have `position: fixed` (not breaking layout)
10. No JS console errors during 14s of tour playback

Plus a golden-screenshot check: at beat 4 (Play), capture a screenshot of the running engine, save to `verify-screenshots/onboarding-hf-beat4.png`, pixel-sample to confirm the tour overlay is visible (not blank).

## Out of scope (explicit non-goals)

- NOT redesigning the `#swr-onboard` shortcuts modal. That's the advanced-mode dashboard and works fine.
- NOT touching any other engine surface (`engine-render.client.js`, persona onboarding, etc.).
- NOT changing the `?` button or `?` keystroke behavior.
- NOT adding a tooltip tour or coach marks (the 5 beats are the tour).
- NOT adding audio narration. Silent visual only.
- NOT wiring into the marketing landing pages. Engine-only.

## Rollback plan

Single one-line addition to `engine.html` to enable; comment out the script tag to disable. The cinematic tour never touches engine state — only adds a DOM overlay. Worst-case regression: a stuck overlay covers the page. The Escape key closes it (existing modal behavior is wired; new controller also listens for Esc).