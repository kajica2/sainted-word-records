# NEON demo follow-ups — 2026-11-09

## Problem

PR #320 makes `/versions/neon` install the 13 Dance Clips, play the demo song, cycle presets, and show a Recent folder. The gates prove that path. They do not prove the cases around it: a library that lost only some clips, a performer who already had a stage, the engine page (which does not use neon's inline library), or a phone-width panel. Those are the next changes. None of them belong in #320.

## What #320 already proves

- `check:neon-demo-panel-smoke` on the built page: Start demo is the element under the pointer while `#swr-start` is up; 13 `dancer-video` clips install; 6 video layers decode and advance; audio features move; the overlay leaves; Recent holds 12; Punch writes sens 2.4 to the slider and to `A.params`.
- `check:neon-demo-panel-verify`: all 79 controls, including the four audio presets changing pixels, and `stage:start` staging, playing and cycling.
- Known limits, left on purpose: WebGL stays opt-in (`?webgl=1`). Start demo calls `Layers.remap()`, so it replaces whatever was already staged. Recent and the demo panel are wired on `versions/neon.html` (and the synced root `neon.html`), not on `engine.html`.

## Order

### 1. Housekeeping, no new behaviour

- Merge #320 only when `check + verify + build-size` is success. `bounded-qa` does not gate it.
- Close #308. Its branch was merged with `main` and the diff is empty: the bounded frame wait already lives in `scripts/check-neon-demo-panel-verify.mjs` as `waitForFrames`.
- Leave #306, #309, #302 and #301 on their own checks. #306 is the accessibility gate. The other three are behind `main` and are not part of the demo.

### 2. Reinstall the clips when the pack is only partly there

`installDemoClips` in `client/neon-demo-panel.client.js` calls `SWR_LIBRARY_PACKS.unload` only when `demoClipItems()` is empty. Clear-all is covered. Deleting 4 of the 13 clips is not: the loader still says loaded, and Start demo will not fetch the missing files.

Acceptance: with 4 `dancer-video` items removed from `SWR_LIB`, Start demo restores all 13, then stages. The unit stub in `scripts/check-neon-demo-panel-unit.mjs` should fail today on that case and pass after. Do not unload when all 13 are already present.

### 3. Recent folder on the engine page

`client/recent-media.client.js` is page-agnostic. The folder is painted only inside the inline `Lib.render` in `versions/neon.html`. `engine.html` loads `lib/library.client.js` and never calls `SWR_RECENT_MEDIA`.

Acceptance: adding or assigning media on `/engine` shows the same `recent` header, cap 12, no duplicate rows, and a reload keeps the time. `groupItems()` in `client/media-grouping.client.js` stays the name-prefix rule the automix pool uses. Gate it with a node:vm unit plus one assertion in an existing engine smoke, not a new browser suite.

### 4. Stop Start demo from wiping a staged set

`Layers.remap()` inside `installDemoClips` replaces the current layers. That is right for an empty stage and wrong for a performer who already built one.

Acceptance: Start demo fills empty layer slots from the new clips and leaves occupied slots alone. A separate control can still remap. The smoke asserts a pre-staged layer's asset id is unchanged after Start demo.

### 5. Remember the audio preset

Punch, Club, Soft and Tight write `sens`, `gate` and `decay` for the session only. The sliders already persist through the page's own input path in some cases; the preset id does not, so a reload cannot show which preset is active.

Acceptance: the active id survives a reload in the same store the audio knobs already use, the buttons paint the restored preset, and `A.params` matches it. One unit assertion. No new key namespace.

## Not in this plan

- Turning WebGL on by default. The gate in `lib/webgl-feature-detect.client.js` is off unless `?webgl=1` or `swrWebGL=1`, because headless and low-power clients pay for it.
- Mounting the demo panel on the other variant pages. They do not share neon's inline `Lib` / `Layers`.
- Merging #301 (Remix Studio) or #309 (color-tales) under the demo work.

## Rejected

- Auto-loading the Dance Clips at boot. Packs are opt-in. Start demo is the explicit install.
- Changing `groupItems()` so Recent is a group kind. Automix stacks from that function. A second folder in the panel render keeps the pool stable.
- Raising the start overlay's z-index instead of the panel. The overlay has to cover the stage. The panel has to stay clickable. `--swr-z-startup + 8` does that without covering the keys help at 10020.
