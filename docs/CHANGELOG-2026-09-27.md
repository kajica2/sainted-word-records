# Changelog — 2026-09-27

---

## Keyboard shortcuts: page-aware keymap + gear menu removal

`engine-keys.client.js` is shared by 16 pages that do **not** carry the same
subsystems, so it advertised keys that could not work. On `engine.html` — which
loads no GENOPS module and has no AUTO-SWAP panel — **nine** of its 46
advertised actions could not dispatch at all (`R`-remap, `N`, `Shift+N`,
`Cmd+Z`, `Cmd+Shift+Z`, `Cmd+Enter`, `Shift+M`, `Alt+1..6`, `Cmd+1..9`),
`Space` was half-broken, and four keys were bound twice.

Commits:
- `1ad969c` — `fix(keys): make the engine keymap page-aware and remove the gear menu`
- `5d9cea8` — `fix(nav): point the versions link at /versions.html and preserve the rewrite`
- `572bf62` — `fix(media): make the media cards' stage affordance visible and fix panel state`

### The dead-key map (measured, not inferred)

Live probes on production and against a local dev server gave. "Where" names
the pages on which the key could not dispatch:

| Root cause | Could not dispatch | Where |
|---|---|---|
| `window.SWR_GENOPS` absent | `R`-remap, `N`, `Shift+N`, `Cmd+Z`, `Cmd+Shift+Z`, `Cmd+Enter` | engine only |
| `#ls-panel-swap` never exists | `Shift+M` | **all 16 pages** |
| `Layers.autoMapLayer` absent (defined only in `engine-core.client.js`) | `Alt+1..6` | **all 16 pages** |
| `VersionsPresets` not loaded | `Cmd+1..9` | engine only — **and** unreachable on all 16 pages via a guard bug (see below) |
| `Story` runtime absent | `Shift+1..9` | every variant **except** `hallucination` (engine and hallucination both have a Story runtime) |
| `ACTIONS.play` read `Audio.el`; engine exposes `Audio.audioEl` | `Space` — silently no-op'd | engine only |
| `engine.html` bound its own inline listener | `Space`, `R`, `L`, `D` handled **twice** | engine only |

`R` on engine is not dead but *redefined*: the plan's curated set keeps it, so
it now rotates the selected clip (and falls back to RE-MAP). `Shift+A` was
**live** on engine and stays live — see premise 2 below.

The last row is why the bug was latent rather than audible: one `Space` press
called `Audio.play()` exactly once because engine-keys' half was inert. Fixing
the element lookup would have turned it into a real double-toggle — so the
inline block had to go in the same change.

### Four premises the measurements disproved

The originating plan asserted things that live probing contradicted. Recording
them because each would have caused a wrong fix:

1. **"`#ls-panel-swap` is missing on engine (only `timing` + `lfo` exist)."**
   It is missing on **all 16 pages**. The real AUTO-SWAP panel is
   `#layer-scheduler-panel`, force-hidden by design. So `Shift+M` was dead
   everywhere, not just on engine.
2. **"`Shift+A` is gated by the absent `RECIPES`."** `window.SWR.RECIPES` exists
   **nowhere** in the repo. The action reads `SWR_AUTOMAP`, which engine *does*
   load (14 recipes) — so `Shift+A` **works on engine** and gating it as
   written would have deleted a functioning feature.
3. **"The help table mis-splits the `'` rows into `'?'`."** It does not; they
   render correctly as `; / '` and `Shift+'`. There was nothing to fix.
4. **"`Shift+/` is a binding."** It is not. Opacity-up is `=`; `Shift+/` is the
   `?` help key. `ACTIONS.nudgeOpacityUp` carried a stale `keys` value that
   nothing reads (the help table tracks action blobs, not that field) — which is
   what `verify-genops.mjs` had been asserting all along.

### Design — one capability descriptor, one choke point

An action declares what it needs; the binder *and* the help table both consult
the same predicate, so a page can never advertise a key it cannot honour:

```js
const hostFlags = {
  genops:   () => !!window.SWR_GENOPS,
  automap:  () => !!(window.SWR_AUTOMAP && typeof window.SWR_AUTOMAP.list === 'function'),
  settings: () => !!(window.SWR_SETTINGS && typeof window.SWR_SETTINGS.togglePanel === 'function'),
  engineRotate:     () => typeof window.SWR_KEYS_HOST_ROTATE === 'function',
  engineAffordance: () => !!document.getElementById('add-layer'),
  story:      () => { /* SWR.Story.ORDER + enter */ },
  layerRemap: () => { /* Layers.autoMapLayer */ },
  presets:    () => { /* VersionsPresets.SHORTCUT_PRESETS */ },
};
```

- `requires` — a host flag that must be true.
- `panel` — an element that must exist (`Shift+M` needs `#ls-panel-swap`;
  `Shift+T`/`Shift+L` need their real panels, which do exist).

Flags are **re-probed while false**, never latched. This module is
`type="module"` while its dependencies install from classic `defer` scripts, so
a parse-time read can be early; latching a negative would silently disable a key
for the whole session. Once true, never re-read — on engine the price is one
global read per keystroke.

Enforcement is a single line at the exit of `handle()`:

```js
if (action && !actionAllowed(action)) action = null;
```

Both `case`-selected actions and the fallback/digit branches funnel through it.
`help()` applies the same filter to its rows, so the `?` overlay lists exactly
what remains. The result is genuinely per-page, not per-family — measured:

| Page | Rows | Has Story | Has `VersionsPresets` |
|---|---|---|---|
| `engine.html` | 39 | yes | no |
| `versions/neon.html` | 42 | no | yes |
| `versions/hallucination.html` | 43 | yes | yes |

`hallucination.html` is the outlier: it defines its own `SWR.Story`
(`HalStory`) **and** loads `versions-presets.js`, so it legitimately keeps both
`Shift+1..9` and `Cmd+1..9`. A family-level assumption would have got it wrong.

### Two latent bugs found while measuring

1. **`Cmd+1..9` was unreachable.** The FX-palette block sat inside
   `if (!action && !cmd && !ev.altKey)` while testing `ev.metaKey || ev.ctrlKey`
   — its own condition contradicted the guard enclosing it. Moved into the
   Cmd/Ctrl switch, where it now fires (`fx-preset-pulse` on neon).
2. **The bare-digit blocks keyed off `key` alone**, so they would have stranded
   that same combo (and `Alt+1..6`). Both `1..9` and `0` now require the
   modifier-free case.

### `R` — one key, page-scoped meaning

- GENOPS pages: `R` = remap, `Shift+R` = force swap (unchanged).
- `engine.html`: `R` = rotate the selected clip 90°, falling back to RE-MAP
  when nothing is selected.

The engine implementation moved out of the deleted listener into
`rotateSelectedOrRemap()` and is published as `window.SWR_KEYS_HOST_ROTATE`, so
the key and the `↻ ROT` button share one function instead of two listeners with
duplicated bodies. Exactly one of `remap` / `rotateClip` is ever allowed.

### Gear menu removed (all 16 pages)

`engine-settings.client.js` loses the floating ⚙ gear + dropdown entirely. Every
page loads this one module, so a single edit removes the surface everywhere —
no HTML churn, pages stay standalone.

Its `AUTO-SWAP` row was pointing at `#ls-panel-swap`, an element **no page has
ever built**: the real AUTO-SWAP panel is `#layer-scheduler-panel` and
`layer-scheduler.client.js:334` force-hides it as a developer surface. Half the
menu was decoration over behaviour the keymap already owned.

What remains is the non-UI half the keymap drives:

```js
window.SWR_SETTINGS = { togglePanel, saveProject, openProject, resetPanels }
```

`saveProject`/`openProject` bridge both project module APIs (`window.Project`
on engine, `window.SWR_PROJECT` on variants) — `Cmd+S` / `Cmd+O` reach them
either way. Panel toggles stay reachable by key (`Shift+T`, `Shift+L`), proven
to toggle on and back off on both page families.

### Verification

Every claim below was executed, not reasoned about:

- **`npm run check`** — exit 0 (unit suites, bundle, API tests, smokes).
- **`verify-genops.mjs` — 13/13 pages, 20/20 checks.** Was **0/13 on
  unmodified `HEAD`**. Its failures were stale expectations, not regressions:
  `'Shift+/'` was never a binding (opacity-up is `=`; `Shift+/` is the `?` help
  key) and `'Shift+M'` named the nonexistent panel. Its `library/` check is now
  an env skip — the manifest was deliberately removed, so it could never pass.
- **`verify-engine-automix.mjs`** — 11/11 green.
- **`verify-transitions.mjs`** — ALL CHECKS PASS.
- **`verify-automix-cross-surface.mjs`** — 0 failures.
- **`verify-site-nav.mjs`** — 13/13, all 55 nav URLs 200.
- **Live, on engine**: one `Space` press = exactly one `play()` (delta
  `{play:1,pause:0}`), and toggles back on the next press. `R` with a selection
  → `remapClicks: 0`, `rotOffset: 90`; `R` with no selection → `remapClicks: 1`.
- **The `?` overlay** confirmed by screenshot through the real key path, and
  asserted to contain `Cmd+Z`/`randomize` on neon but not on engine.
- **Per-page gate behaviour**, measured across families:

  | Page | Rows | `Shift+1..9` row | `Alt+1..6` row | Story | `Cmd+1` dispatches |
  |---|---|---|---|---|---|
  | `engine.html` | 39 | yes | no | yes | *(none — no presets)* |
  | `versions/neon.html` | 42 | no | no | no | `fx-preset-pulse` |
  | `versions/hallucination.html` | 43 | yes | no | yes | `fx-preset-pulse` |

- **`Alt+1..6` is dead on all 16 pages**, not just engine: `Layers.autoMapLayer`
  is defined only in `engine-core.client.js`, and no page loads that file or
  assigns the method, so the row is suppressed everywhere.
- **`Shift+1..9` is live on 2 of 16 pages**: engine has its own Story runtime and
  `hallucination.html` defines `SWR.Story` as `HalStory` — both keep the row.

The isolating step that mattered: after staging, the keyboard changes were
replayed into a **detached worktree** of `HEAD` and re-verified there, so
unrelated work-in-progress on the branch could not mask a failure. That is also
what made the coupling explicit — `verify-genops.mjs` **must ship in the same
commit** as the keymap change, because its old expectations assert exactly the
keys the fix removes.

### Known-open

- `verify-rot-master.mjs` and `verify-rotation-enabled.mjs` fail on
  **unmodified `HEAD`** (confirmed by stashing this work and re-running). They
  are pre-existing rotation issues, untouched here; `verify-rot-master` also
  needs a dev server on port 5174.
- `Alt+1..6` and `Shift+1..9` are now gated correctly, which means `Alt+1..6`
  disappears from the help table **everywhere** (its dependency is absent on all
  16 pages) and `Shift+1..9` appears only on engine. Both previously advertised
  keys that could not dispatch.

---

## Two companion fixes on the same branch

Unrelated to the keymap, carried on `fix/audit-critical-batch`:

- `5d9cea8` — the nav linked to `/versions`, which the rewrite generator mapped
  to `/versions/index.html` (that directory exists), so the link resolved to a
  directory index instead of the shipped versions page. `site-map.json` now
  points at `/versions.html` with an explicit `/^\/versions\/?$/` rule so
  regeneration cannot reintroduce the directory mapping. `vercel.json` verified
  to be byte-identical to the generator's output for the updated site-map.
- `572bf62` — media cards are click-to-stage but nothing said so. The renderer
  takes `onIsStaged` (a ✓ badge, evaluated every render so it survives a
  refresh — a one-shot class was wiped by the re-render that adding an item
  triggers) and `cardTitle` (hover text). Plus: `#library-grid` gains an
  explicit `[hidden]` rule, since the author-level `display: grid` beat the UA
  stylesheet's `[hidden] { display: none }` — so the panel showed the engine's 7
  cards twice, once natively and once through the merged "My Media" grid; and
  the songs list renders its header only when it has rows, since `SONGS` is
  empty now and the orphaned header read as if the images below were songs.

---

### Stats

- **16 pages** share the keymap; **8 capability flags** gate them.
- **Help rows** (per page, measured): `engine.html` 46 → 39 (dead entries no
  longer advertised); `neon` 46 → 42; `hallucination` → 43 (it has both a Story
  runtime and `VersionsPresets`, so it keeps both digit families).
- **1 module simplified**: `engine-settings.client.js` 400 → 216 lines
  (+86/−270) — the gear, dropdown, and all their row/builder plumbing replaced
  by a 4-function helper surface.
- **1 verifier un-staled**: `verify-genops.mjs` 0/13 → 13/13.
- Branch tip `572bf62`, pushed to `origin/fix/audit-critical-batch`.
