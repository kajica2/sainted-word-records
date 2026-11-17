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

## Still open

- **Plan item 3 — the Recent folder on `/engine`.** `engine.html` loads
  `lib/library.client.js` and never calls `SWR_RECENT_MEDIA`; the folder
  is painted only inside the inline `Lib.render` in `versions/neon.html`.
  See `docs/plans/2026-11-09-neon-demo-followups.md`.
- **The browser gates on this host.** Not a repo problem, but it means
  the browser-driven half of the suite is unproven here. CI runs it.
