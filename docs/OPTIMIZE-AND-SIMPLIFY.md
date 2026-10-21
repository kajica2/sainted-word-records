# Optimize & Simplify — overview

**What this is.** A map of where this project's weight actually is, and the ordered
moves that remove it. Every number below was measured on the working tree on
**2026-10-21** (`0f42ab38` + the 22-variant switcher expansion) — none of it is
estimated. The point of the doc is that the next session should not have to
rediscover the cost centres.

**How to read it.** §1 is the measurement. §2 is *optimize* (make the thing
cheaper to run and ship). §3 is *simplify* (make the thing smaller to reason
about). §4 carries the three findings from the Codex adversarial review of this
change. §5 is the ordering.

---

## 1. Where the weight is

| Surface | Count | Why it matters |
|---|---:|---|
| `versions/*.html` | 32 pages, **41,906 lines** | the largest single block of duplicated source in the repo |
| `engine.html` | 9,665 lines, one inline module | the engine's whole runtime in one file |
| `lib/` + `client/` + root JS | 69 + 88 + 57 = **214 modules** | two distinct trees plus 57 root scripts |
| root `*.html` | 97 pages | the marketing surface; sitemap = 153 URLs, `vercel.json` = 396 rewrites |
| `api/` route files | **39** (AGENTS.md said 12 until 2026-10-21 — now corrected) | one handler per product area; several trees (`catalogue/`, `kits/`, `drive/`, `slots/`, `invite/`, `pt/`, `connect/`) |
| `scripts/*.mjs` + root `verify-*.mjs` | 187 + 129 = **316** | the gate surface |
| npm scripts | **219** | of which **81 are invoked by no gate** |
| `dist/` | 221,182,702 B local, of which **183,066,484 B come from tracked files** | the CI ceiling is 188,743,680 B (180 MiB) |

### 1.1 The duplication, measured

> **53.2 %** of the long lines in `versions/*.html` (13,118 of 24,680) are
> byte-identical to lines in **8 or more** other version pages.

The pages are 32 separate copies of one engine with one different `drawFx` each:
24 of them carry their own `drawFx` and their own `window.SWR` assembly, 22 carry
their own inline `MediaRecorder` block (while `lib/recorder.client.js` exists),
28 carry their own `requestAnimationFrame` loop. That is the single largest
simplification lever in the repo, and §3.1 is the move.

### 1.2 The gate surface, measured

- **219** npm scripts; **81** of them are named by no run-steps group, no
  `check-verify-smoke.mjs` entry and no `ci.yml` step — they are promises nobody
  keeps.
- **129** root `verify-*.mjs`; **65** are referenced by no npm script at all.
- The `check` group is **99 steps** and runs in ~2 min; the `full` group adds 21
  browser steps and is the expensive one.

### 1.3 The catalogue, measured

- `client/variant-switcher.client.js` — **22** entries, i.e. every shipped
  visual language is now reachable from the engine's `#looks` dropdown.
- `versions-presets.js` — **23** grade presets in the catalogue, **21** in the
  dropdown (`gallery` and `mtv` are excluded by `GRADE_EXCLUDE`).
- `engine.html`'s private `VISUAL_PRESETS` — **5** motion presets.
- One control now drives all three: `client/looks-menu.client.js`. Before it,
  three unsynchronised catalogues were reachable and no single control listed
  them. **Keep it that way** — a new look is added to exactly one table.
- Verified in the running engine on 2026-10-21: the dropdown renders
  `Variant looks` 22 / `Grade presets` 21 / `Motion presets` 5, with no console
  errors.

### 1.4 The generated IA has 13 duplicate rules

`vercel.json` carries **396** rewrites but only **383** unique sources — 13
entries are emitted twice (`/engine`, `/engine/`, `/marketplace`,
`/marketplace/`, `/intro`, `/intro/`, …). First match wins, so nothing breaks;
it is noise in a generated file that humans read. The generator
(`scripts/generate-vercel-rewrites.mjs`) is the place to fix it.

### 1.5 Dead surfaces (verified by grep, 2026-10-21)

| Surface | Status |
|---|---|
| root `nav.client.js` | **no page loads it** (153 pages load `lib/nav.client.js`); it survives only in Vite's `rootFiles` and in a `personas.html` comment |
| `client/engine-debugger.client.js` | **no page loads it** — a debugger that ships and never opens |
| `versions/_*.js` (19 codemods) | **no page loads them** — dev-only, run by hand |
| `public/` | gitignored **and stale**; Vite copies it, then `copy-static` overwrites with the root files |
| `library/` | removed and gitignored — the 7 default textures moved to `default-library/` |

---

## 2. Optimize — make it cheaper to run and ship

### 2.1 The build budget is the binding constraint (~3 MiB of headroom)

CI measures `find dist -type f -printf '%s\n' | awk '{s+=$1}'` against a
**188,743,680 B (180 MiB)** ceiling. Splitting the local build by provenance:

| Part of the local `dist/` | Bytes | In CI? |
|---|---:|---|
| tracked files | 183,066,484 | yes |
| `generations/*.zip` (build output, gitignored) | 2,540,767 | yes — `prebuild` writes them |
| `keyart/brutalist/*` — the 20 **untracked** keyart files | 35,054,969 | **no** — local media only |
| other untracked (`media/inventory.json`, `data/`, …) | ~520,000 | no |
| **local total** | **221,182,702** | — |

So CI ships roughly **185.6 MB (177.0 MiB)** — about **2.9 MiB under the
ceiling**. The local number is inflated by the untracked keyart media; **do not
quote a local `du` as the deployed size**.

- The new `generations/*.zip` archives add 2.5 MB. They fit; they do not change
  the ceiling.
- The single biggest lever is the 20 untracked `keyart/` files — **35.05 MB** of
  a 44.93 MB directory (58 of the 78 files are already force-tracked, 9.88 MB).
  Force-track the ones that ship or delete the rest; either way CI's number
  drops by tens of MB **without touching the ceiling**.
- Rule to keep: a new binary artifact must state its bytes in the PR. The
  ceiling is not a number to be inflated.

### 2.2 The render hot path

- `engine.html` draws the media stack, then the FX pipeline (`fx-postprocess.js`,
  a WebGL fullscreen quad), then the variant pass. With 22 variants, the variant
  pass is now a **third** full-frame draw per frame.
- Keep the variant passes cheap: one gradient + N primitives, no per-pixel loops,
  no `getImageData` in a frame callback. The house style for a new pass is in
  `versions/mosaic.html` and `versions/collage.html`.
- DPR: the export path already clamps DPR to 1 around the recording session
  (`fitToSize`), and the auto-DPR ratchet has a unit gate
  (`check:dpr-ratchet-unit`). Leave both alone unless the ratchet gets a
  user-facing reset (audit P1.6, still open).

### 2.3 The variant pass is now a first-class per-frame cost

The eight new passes composite **additively** (`globalCompositeOperation =
'lighter'`) over the media, so they are cheap but not free: each is a
full-frame gradient fill plus geometry. If the engine ever renders a variant at
4K, the cost is 8 more full-frame fills. If that shows up in a profile, the
lever is to **bake the static part of a pass into a cached offscreen canvas** and
redraw only the audio-driven part — not to reduce the visual languages.

### 2.4 The gate suite

The unit group is cheap (99 steps ≈ 2 min) and the browser group is the cost
(21 steps, Puppeteer). Two things keep it that way and both are worth keeping:

- a gate that is not wired into `scripts/run-steps.mjs` is **not a gate** — this
  is the 81-script problem in §1.2;
- a gate that cannot fail is worse than no gate — the 14 synthetic cases in
  `check:doc-truth --self-test` exist so the gate stays honest.

---

## 3. Simplify — make it smaller to reason about

### 3.1 Extract the shared engine out of the 32 version pages (the big one)

The version pages differ from each other by a palette and a `drawFx`. The rest —
the recorder, the project round-trip, the cross-tab sync, the audio loader, the
`window.SWR` assembly — is duplicated 22–28 times. The plan:

1. Move the inline `Recorder` block to `lib/recorder.client.js` (it already
   exists — the pages just don't use it) and have the pages call it.
2. Move the per-page `window.SWR` assembly to one module.
3. Migrate **one** page, gate it, then the rest. A 22-page mechanical cut needs
   a mechanical gate (`check:variants-unit` already compiles every page's
   `drawFx` against a mock canvas, which is exactly the net that catches a bad
   cut).

Target: `versions/*.html` from 41,906 lines to roughly a third of that, with the
per-page file reduced to *palette + drawFx + copy*.

**Do not** template the pages into one file. The audit was explicit: 32 visual
hypotheses *is* the research. The fix is a shared module, not a template.

### 3.2 Close the gate gap (81 unwired scripts, 65 orphan verifiers)

Two buckets, no third:

- **real and useful** → wire into the `check` group. Most of the 81 are unit
  suites that already exist (`check:layer-retire-unit`, `check:layer-text-unit`,
  `check:library-store-unit`, `check:composer-client-unit`, …). A unit suite that
  nobody runs is dead code with a green tick next to it.
- **dead** → delete it, and if the feature is still wanted, re-add it with its
  gate. `verify:codemods`, the `vault:*` scripts and the `make:*` scripts are
  the obvious candidates for the second bucket.

### 3.3 Stop hardcoding the tree in the gates

This bit during the 22-variant expansion: `scripts/check-variant-switcher-unit.mjs`
had a hardcoded `ALL_VARIANTS` id list, so the eight new pages were not served to
the module under test and the gate died with
`Cannot read properties of undefined (reading 'indexOf')` instead of naming the
page it could not load. It now scans `versions/`. The same class of bug exists
wherever a gate names a file or an id that the tree owns.

**Rule:** a gate that enumerates the tree must enumerate the **tree**, not a
copy of the tree.

### 3.4 De-duplicate the generated IA

13 of the 396 rewrite entries in `vercel.json` are emitted twice. First match
wins so nothing breaks, but a generated file that humans read should not carry
the same rule twice. One-line fix in `scripts/generate-vercel-rewrites.mjs`:
de-duplicate on `source` before writing.

### 3.5 Delete the dead surfaces (§1.5)

`nav.client.js`, `engine-debugger.client.js`, `public/`, `library/`. Each
deletion needs a grep gate that proves no page references the file, because
"no page loads it" is only true until someone adds one.

### 3.6 The audit's still-open items, re-verified 2026-10-21

`docs/PLANS/architecture-audit-2026-10.md` is the source of truth for the
remaining backlog. Re-checked against the live tree:

| Item | Status today |
|---|---|
| 1.1 extract `lib/apply-reactors.js` (six divergent unit tables) | **open** — the file does not exist and **14** version pages still define their own `applyR` |
| 1.2 `luma` saturation in `autoMap` | **closed** — the P1.2 soft-luma clamp is in `lib/library.client.js` |
| 1.3 wire the real section detector | **closed** — `client/section-detector.client.js` is wired |
| 1.4 `ease()` shared | **closed** — `lib/ease.js` exists |
| 1.5 `BroadcastChannel` → `localStorage` fallback | **closed** — `lib/media-store.client.js` has the storage-event bridge, gated by `check:cross-tab-unit` |
| 2.1 CORS allowlist for `*.vercel.app` | **closed** — the regex is in `api/_lib/http.js` |
| 2.2 `Secure` on the session cookie delete | **closed** (this repo, 2026-10-21) |
| 2.3 safe-area insets + `overscroll-behavior` | **closed** on the engine surfaces; the variant pages still lack them |
| 2.4 44 px touch targets | **closed** — `check:touch-targets` |
| 2.7 doc-vs-code drift | **closed** — `check:doc-truth` |
| 2.8 export DPR clamp | **closed** |
| P3 `webgl-feature-detect` | **closed** — wired |
| P3 `TRUSTED_PROXIES` | **open** — a non-Vercel deploy has bypassable per-IP rate limits |

### 3.7 One concept, one place

The look catalogue is the worked example (§1.3): 22 variant looks, 23 grade
presets and 5 motion presets, one dropdown, three dispatch paths. When a fourth
kind of look arrives it goes into `looks-menu.client.js` and nowhere else. The
same rule applies to the IA (`site-map.json` → `generate-vercel-rewrites` →
`build:sitemap` → `check-dist-links`) and to the gates.

---

## 4. Adversarial review of this change (Codex, 2026-10-21)

Three findings, all NON-BLOCKING, all in the layer-groups feature that was
already in the tree when the variant work started:

| Lens | file:line | Failure scenario |
|---|---|---|
| Side-effects & omissions | `lib/layers.client.js:489-499` | Grouping layers that already belong to a hidden group reassigns them and forces them visible, but the old group record survives with no members — the header can disappear while the stale group persists in saved projects. |
| Side-effects & omissions | `lib/layers.client.js:946-949` | A drag-reorder resets `Layers.selected` to the item at the target index instead of preserving the selected layer, so the next per-layer control acts on a different layer. |
| Architecture | `lib/layers.client.js:857-860` | `autoMap()` clears the groups but does not clear or reapply the previous layers' `hidden` flag on reused layer objects, leaving visibility inconsistent. |

Two of the three are one-line fixes. They are listed here, not fixed, because
the review is review-only.

---

## 5. The order

| # | Move | Cost | Payoff |
|---|---|---|---|
| 1 | §3.3 — derive the tree in the gates; §3.2 — wire the ~20 real unit suites that are unwired | 1 day | removes the "37 % of scripts promise nothing" problem; the failures start being caught |
| 2 | §3.1 phase 1 — the recorder + `window.SWR` assembly out of the 22 version pages | 2–3 days | the largest readability win in the repo; gates already exist to catch a bad cut |
| 3 | §2.1 — reconcile the untracked `keyart/` media | 1 day | tens of MB of CI headroom with the 180 MB ceiling unchanged |
| 4 | §3.4 + §3.5 — de-duplicate the generated IA; delete the dead surfaces behind grep gates | 1 day | less surface, fewer "which one is live" questions |
| 5 | §3.6 — 1.1 (one reactor unit table); re-check the rest of the audit list | 2 days | closes the audit's open correctness items |
| 6 | §3.1 phase 2 — project persistence + cross-tab out of the version pages | 2 days | finishes the extraction |

**Not on the list, deliberately:** templating the version pages into one file
(§3.1), merging the curator modules, and the vendored GIF decoder. The audit
already ruled on all three.

**The mechanism that keeps this from growing back:** every new gate is wired
into `scripts/run-steps.mjs`; every new page goes through `site-map.json` →
`generate-vercel-rewrites` → `build:sitemap` → `check-dist-links`; every doc
claim about a file, a route or a global is checked by `check:doc-truth`.
Prose is not the mechanism — the gates are.
