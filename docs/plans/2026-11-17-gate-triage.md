# Gate triage — 2026-11-17

One page for the state of `npm run check`, so the next session does not
re-triage twenty failures one at a time.

## The number

`npm run check` runs 157 steps. On this branch: **138 pass, 19 fail** —
and every one of those 19 is the same failure.

Before this triage the number was 137/157: nineteen browser steps plus
`check:security-gates-unit`. The security gate is now fixed, so the
count is 138/157.

## Cause 1 — nineteen browser steps, one cause (ENVIRONMENT)

| Field | Value |
|---|---|
| **Cause** | The browser cannot be launched on this machine |
| **Symptom** | `Error: Could not find Chrome (ver. 152.0.7977.42)` |
| **Affects** | `check:engine-mobile`, `check:ver-picker`, `check:svg-grade-integration`, `check:webgl-default-off`, `check:webgl-nav-probe`, `check:responsive-overflow`, `check:a11y`, `check:page-errors`, `check:pwa-sw-reload`, `check:mask-illusions`, `check:neon-demo-panel-verify`, `check:webgl-no-invalid-op`, `check:score-evolution-smoke`, `test:asset-curator`, `check:dashboard`, `check:variant-switcher-smoke`, `check:photo-slideshow`, `check:default-library`, `check:grade-smoke` |
| **Fix** | None in the repo — the gates are correct and CI installs the pinned Chrome |
| **Locally** | `npx puppeteer browsers install chrome` |

The deeper reason this sandbox cannot launch a browser at all, even with
a Chrome present: Chromium's process singleton creates its socket
directory inside the **system** per-user temp (`/var/folders/.../T`), and
that path is not writable here. `TMPDIR` does not help — on macOS
Chromium resolves its temp directory through `NSTemporaryDirectory()`,
which ignores `TMPDIR`. The symptom therefore has two layers:

1. the pinned Chrome (152.0.7977.42) is not in the Puppeteer cache, and
2. the cached 155.x build **and** the system Chrome both abort with
   `Failed to create a ProcessSingleton for your profile directory`.

Both are the host, not the code. **Do not "fix" a gate because it is in
this list.**

The demo panel's own browser gate (`check:neon-demo-panel-smoke`) is not
in the list above because it is not part of `npm run check` — it runs
separately, and the same Chrome limit applies to it.

## Cause 2 — one real failure (FIXED)

`npm run check:security-gates-unit` failed on:

```
FAIL  status remains public without session
```

`GET /api/control-centre?action=status` answered **500** instead of 200.
The cause was not the API's authorisation — the status read is public and
stays public — but one unreadable system reading:

```
{"error":"control_centre_failed","message":"A system error occurred: uv_uptime returned EPERM (operation not permitted)"}
```

`systemStats()` calls `os.uptime()`, which on macOS needs a `sysctl` the
host refused. The throw rejected the whole status request, and it
rejected it in the one place that did not guard it:

```js
Promise.resolve(systemStats())   // a synchronous throw happens BEFORE Promise.resolve
```

`gitInfo()` and `health()` were already guarded with `.catch()`;
`systemStats()` was not, and `Promise.resolve(x)` does not catch a
synchronous throw of `x` anyway.

**Fixed** in `api/control-centre.js`: each reading is taken on its own
(`uptimeUnavailable` reports the uptime as unreadable), and each of the
three sources of the status card stands alone, so one that cannot answer
reports its own failure instead of taking the other two down.

## How the demo panel work was verified without a browser

`npm run check:neon-demo-panel-unit` (node:vm, no browser) covers the
helpers and the mount contract: 86 assertions, 66 controls. The new
assertions were also run **against the old panel code** to prove they
fail there (the file was swapped for `HEAD`'s version and the gate was
re-run).

The browser behaviour was verified in a real browser instead — the
Chrome DevTools MCP browser, driving the built `dist` served by
`npm run preview`:

| Check | Result |
|---|---|
| A pre-staged layer survives Start demo | `['performer-layer-1', 18, 19]` — kept |
| A pack cut from 13 clips to 9 | refilled to 13, layers re-bound to the new ids |
| The audio preset survives a reload | restored, buttons painted, `A.params` matches |
| The knobs moved off the preset | the knobs win, the stale preset id is dropped |
| The same, on the synced root `/neon.html` | identical |

## Cause 3 — the audio toolkit gate (FIXED)

CI went red with:

```
FAIL: pip install of audio toolkit requirements failed
```

The message is a symptom. The real cause was nine minutes further up the
log, inside a source build:

```
ERROR: Dependency "OpenBLAS" not found (tried pkg-config and cmake)
```

OpenBLAS is not the disease either. The runner image rolled from
`ubuntu-24.04` (Python 3.12) to `ubuntu-26.04` (Python 3.14) on
2026-11-11, and `tools/python-audio-toolkit/requirements.txt` pins

```
numpy>=1.26,<2.1   scipy>=1.11,<1.15   matplotlib>=3.8,<3.10
```

**None of those three publishes a cp314 wheel.** Verified with
`pip download --only-binary=:all: --python-version 3.14` — "Could not
find" for all three; all three DO have cp312 wheels. So pip fell back to
building scipy from source, and a source build needs OpenBLAS.

The pins are deliberate — the requirements file says they are there "so
CI / local Python 3.12 installs stay reliable" — so **the interpreter is
what gets pinned, not the requirements**. `.github/workflows/ci.yml` now
sets up Python 3.12 explicitly, which makes the gate's outcome a
property of this repository instead of a property of the runner image's
release cadence. The gate also reports the interpreter it ran on, and a
failed install names its cause instead of leaving it buried in a build
log.

## Cause 4 — the accessibility gate's +4 (FIXED)

CI went red with the a11y gate measuring **272** `label-content-name-mismatch`
instances against a baseline of **268** (tolerance 2).

**It was not a regression from the demo-panel work.** Three pieces of
evidence:

1. The demo-panel commits touch no HTML and add no DOM nodes. `qa/` and
   every `*.html` file are byte-identical between `464c416a` (the last
   green run) and `563df4bf` (the red one).
2. A local A/B in one browser — old build against new build, same pages —
   measured **identical** violations on `/neon`, `/versions/music_video`
   and `/versions/music_video_mtv`.
3. Five rules moved at once (contrast −18, image-alt −2,
   landmark-one-main −4, page-has-heading-one −4, labels +4) although
   the commits touched nothing those rules look at. That is the
   signature of the measurement, not of the code.

The measurement races. The `#swr-start` overlay removes itself 600 ms
after it is hidden, and the gate measures 700 ms after the fonts settle —
so whether the overlay is still in the DOM when axe runs is a coin flip.
At the gate's exact timing, on `/versions/music_video`, the old build had
`startPresent: true` with two `label-content-name-mismatch` violations
(`#swr-start`, `#swr-version-badge`) and the new build had
`startPresent: false` with none. Same page, same browser, same clock.

### The two real defects it found

Both of them are genuine WCAG 2.5.3 ("Label in Name") violations: the
accessible name has to CONTAIN the text the user can see.

| Element | Visible | Named itself | Where |
|---|---|---|---|
| the version badge | `v2026.10.13.1` | "App version 2026.10.13.1, link to changelog" | all 148 pages |
| the drop-a-song overlay | "Drop a song" (+ more on the music-video pages) | "Start Sainted Word Records" / "Drop a song to begin" | 25 pages |

**Fixed** rather than re-pinned. The baseline is a record of what was
measured, and raising it to 272 would have recorded the race as the
truth and left both defects in place. Instead:

- the badge now leads its name with the text on screen
  (`'v' + v + ' — SWR app version, link to changelog'`);
- the overlay carries no `aria-label` at all, so its name comes from its
  content — which is exactly what it shows. (Browser-verified: an
  `aria-label` that repeats the visible label still fails, because axe
  compares the name against the element's WHOLE visible text, "▶ Drop a
  song Radio + Video", not against one child of it.)

Measured in a real browser, before and after, on the same pages:

| Page | Before | After |
|---|---|---|
| `/versions/music_video` | 2 | **0** |
| `/engine` | 1 | **0** |
| `/versions/mosaic` | 1 | **0** |
| `/neon` | 0 | 0 |

Because the overlay no longer contributes a violation whether or not it
is still in the DOM, the race that produced the +4 cannot produce it
again.

### The gate that keeps it fixed

`scripts/check-a11y-names-unit.mjs` asserts the rule on the SOURCE:
the version badge, every `#swr-start` overlay, and a census of every
other labelled element in the shipped pages held against
`qa/a11y-names-baseline.json` — a baseline it may only shrink. The
census starts at the 72 offenders that predate the gate (icon buttons
like `← ver` named "Previous version"), every one listed, so the backlog
is visible and cannot grow. It runs in seconds and needs no browser,
which is the gap the browser-measuring gate leaves: that gate reports a
count and not a place.

## Still open

- **Plan item 3 — the Recent folder on `/engine`.** `engine.html` loads
  `lib/library.client.js` and never calls `SWR_RECENT_MEDIA`; the folder
  is painted only inside the inline `Lib.render` in `versions/neon.html`.
  See `docs/plans/2026-11-09-neon-demo-followups.md`.
- **The browser gates on this host.** Not a repo problem, but it means
  the browser-driven half of the suite is unproven here. CI runs it.
