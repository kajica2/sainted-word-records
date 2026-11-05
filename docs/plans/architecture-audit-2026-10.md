# Architecture Audit 2026-10 — Plan

A 285k-line audio-reactive video engine. Six module sub-agents + direct
verification of all P1/P2 claims. The author did substantial work;
**every structural claim in the prior `ANALYSIS_REPORT.md` was stale,
and the live repo is in materially better shape than that report says.**

The 4 P1 findings I verified against the live tree at `8d4060a`:

| # | P1 finding | State @ `8d4060a` |
|---|---|---|
| 1 | `/api/early-access` 500s on every request (`api/early-access.js:16` imports non-existent `_lib/paths.js`) | **STILL LIVE** |
| 2 | Personal Tier enforcement is a `localStorage` boolean + regex (trivially forgeable) | **STILL LIVE** |
| 3 | No IndexedDB quota eviction, despite `.kai` claiming "lazy-evict" | **STILL LIVE** |
| 4 | `engine.html` renders canvas at 0px wide on any phone | **LIKELY FIXED** — the old `grid-template-columns: 240px 1fr 280px;` line is gone, but the modern composer.html exists as a mobile-first surface |

**None of the P1s are hard problems. None of them should ship after this plan.**

---

## Plan (prioritized action list)

### P0 — within this session

#### 0.1 Fix the broken import (1 line)

`api/early-access.js:16` imports `./_lib/paths.js` — that file does not exist.
Every POST to `/api/early-access` returns 500. The waitlist modal is loaded on
`landing.html`, `login.html`, and `auth/login.html`, so this is the top
of the conversion funnel for both paid tiers.

```js
// api/early-access.js:16
import { join, DATA_ROOT } from './_lib/db.js'; // was './_lib/paths.js'
```

### 0.2 Add the simplest quota-eviction policy

`media-store.client.js:282-294` already builds a proper QuotaExceededError
shape (`.code`, `.hint`, `.usage`). The instrumentation is collected and
**thrown away** because `.usage` resolves after the promise already rejected.
**Fix:** the function is `async`, so the easy path is: catch the error and
call `navigator.storage.estimate()` synchronously into `err.usage` before
the caller sees it. Then add a one-time "oldest-first" eviction: on QuotaExceeded
during a write, drop the oldest non-favorite item and retry once.

```js
} catch (e) {
  if (e && e.name === 'QuotaExceededError') {
    const est = await navigator.storage.estimate();
    Object.assign(e, { code: 'QUOTA_EXCEEDED', usage: { usage: est.usage, quota: est.quota } });
    const dropped = await evictOldestOne();
    if (dropped) { /* retry once */ }
  }
  throw e;
}
```

**This is the only one that isn't a 20-minute fix**, and it's the one that
protects the product's core promise: "your unreleased track never leaves your
machine." It must NOT silently lose data.

### 0.3 Add server-side PT key verification (~30 lines)

`api/_lib/pt-keys.js:3-5` and `pt.client.js:8-12` already say the words:
*"the client wallet accepts `swr-{tier}-{8 alnum}` keys with no signature
check. Replace with a signed license + server validation when Stripe
webhooks are wired up."*

Stripe webhooks *are* wired up (`api/webhooks/stripe.js:122-136` mints a real
key server-side). The deferred replacement is:
- `POST /api/license/verify { code }` — server reads the key, looks up the
  signed payload in Postgres, returns `{ tier, creditsRemaining, slotCount,
  valid }` or `{ valid: false }`
- `pt.client.js` queries this endpoint on load and on every credits-debit
- `localStorage` becomes a cache, not a source of truth

**Without this, the €600 product is a `localStorage.setItem('swr.inviteUnlocked','1')`
away from free.** That's a P1. It's a one-route file plus a 30-line client
edit. The webhook already mints keys server-side; the verify route is the
missing half.

### 0.4 Verify engine.html mobile path is intact

The grid-template-columns line cited in the audit is **gone** from the live
`engine.html` (grep returns nothing). I'll grep the relevant media queries
to confirm `#app` gets a real mobile layout and `engine.html` doesn't have
the 0px-canvas regression. The composer.html I shipped earlier already
solves the mobile story for *new* users — the engine.html fix is the long
tail for users who land on `/engine/` directly.

### 0.5 Codemod manifest + verify (the "I rebuilt it" #1)

A 7-line `versions/manifest.json` + a 40-line
`scripts/verify-codemods.mjs`. The manifest lists which codemods
processed each variant and which were skipped. The verifier re-runs each
codemod in dry-run and fails CI on `git diff`. **This would have caught
the mobile gap automatically** — that's the real test of whether the
codemod architecture is the right trade.

### 0.6 Move the 4 P1s to the CI gate (mechanism not prose)

The audit found 11 doc-vs-code drifts across 9 files. The
`.kai/conventions/architecture.md` itself has the staleness. Add a CI step
that greps `*.md` for asserted file paths, line counts, and library
names, and verifies them against the source tree. This is the same
class of fix as `check:dist-links` — convert a known-hazard into a
mechanism.

---

### P1 — within the next session

#### 1.1 Reactor contract (the "I rebuilt it" #2)

**DONE** — `3b63805` (2026-10-22). The contract ships as `lib/apply-reactors.js`
(`window.SWR_REACTORS`): one `UNIT` table, one `CLAMP` table, one `TARGETS`
allowlist, one dispatch loop, and the historical per-page tables as the named
compatibility `UNITS` tables. All 15 variant pages plus `engine.html` call it
— 16 surfaces. Gate: `scripts/check-apply-reactor-unit.mjs`.

Three deliberate deltas from the sketch below: the module is a classic IIFE,
not an ES module (see "What I will *not* do" below); `hue` is 1, not 40
(`engine.html`, `neon` and the two music-video cuts read `r.scale` as a
degree count, so 1 is the only value that is both the contract and
behaviour-preserving on four surfaces); and `contrast` is clamped to
[0.1, 2.5] alongside `brightness`. The divergence was also wider than this
section says — 15 pages, not five (see "Where the plan's numbers were
wrong" below).

The original finding, for the record:

`versions/grid.html:1023` drops `x`/`y`/`rot` reactors silently. Every page
has its own `applyR` with its own per-target unit table. Five variants,
five unit tables, missing clamp on `scale`, per-target missing targets.

Extract `lib/apply-reactors.js`:
```js
const UNIT = { x: 250, y: 250, rot: 12, hue: 40, brightness: 1, contrast: 1 };
const CLAMP = { scale: [0.05, 4], opacity: [0, 1.5], brightness: [0.1, 2.5] };
export function applyReactor(layer, feat, opts) { /* shared + 1-line */ }
```

Variants pass a unit scale and a target allowlist. Six divergent unit
tables collapse to one, the missing `x`/`y`/`rot` branch is gone, the
unclamped `scale` is fixed once. This is **the** surgical refactor the
audit points at.

#### 1.2 `luma` saturation (the "I rebuilt it" #3)

`library.client.js:710,755` clamps `min(1, 4 × meanLuma)` — any
video >25% grey gets `luma = 1.0`, collapsing `autoMap`'s 2-factor
score. Fix is 4 lines:

```js
// in library.client.js:710
const meanLuma = ...; const normalized = meanLuma / (1 + meanLuma * 0.2);
// in :755
it.luma = clamp(normalized, 0, 1);
```

Or: use a log-luminance mapping that doesn't saturate for bright video.

#### 1.3 Section detector wiring

**DONE** — `3b63805` (2026-10-22), for the wiring this section meant, plus
the downstream link the section did not know was missing.

This section's finding was stale. `client/section-detector.client.js` IS
the sophisticated detector — chroma self-similarity matrix plus a Foote
checkerboard novelty curve — and it IS the one wired into the engine:
`engine.html` loads it as a classic deferred script
(`engine.html:8849`) and calls `window.SWR_SECTION.detect(audioFeatures)`
once per frame from the render loop (`engine.html:5694`). It is never
`import`-ed because it is not a module: it is a global script like every
other engine primitive, and the engine reads the global. The audit's
*"three section-detection implementations in the repo. The one actually
wired into the engine is the shallowest."* was measured before this file
was rewritten; the rewrite is the file's own header, and it is what
closed the finding.

What `3b63805` added is the missing DOWNSTREAM link. The detected section
now reaches `client/automix-arc.client.js`, which consumes
`swr-section-change` to bias the next act transition — the cue is additive
(a cue's opinion overrides the act plan's, and with no cue armed the
original rule is untouched) and one-shot (the act boundary consumes it).
`client/section-detector.client.js` also fires `swr-section-reset`, a
SEPARATE event carrying `detail: { reason, dropped }`, whenever it restarts
its stream, so an emptied map is never dressed up as a boundary and the arc
drops an armed cue across a song swap. Gate:
`scripts/check-section-detector-unit.mjs`.

#### 1.4 `ease()` shared

`ease()` is defined 5× over one enum across variant pages. Extract
`lib/ease.js`. One map of 5 functions, one import per page.

#### 1.5 Cross-tab sync + localStorage fallback

The README claims a localStorage fallback for browsers without
`BroadcastChannel`. There isn't one. **It's the smaller of the P2s
in the audit** and 6 lines:

```js
if (!('BroadcastChannel' in window)) {
  window.addEventListener('storage', function (e) {
    if (e.key && e.key.indexOf('swr.') === 0) handleCrossTabUpdate(e);
  });
}
```

#### 1.6 Stop ratcheting auto-DPR (the smaller half of #1.4)

`engine-render.client.js:132-135` writes the down-step to
`localStorage` and only clears on a successful up-step. No user-facing
reset, no time decay. Add a "Reset DPR" item to the existing settings
panel and a 30-day TTL on the cached value:

```js
function autoDprDownCleared() {
  return Date.now() - (readRatchetTimestamp() || 0) > 30 * 86400 * 1000;
}
```

---

### P2 — within a week

#### 2.1 Vercel-preview domains in CORS allowlist

`api/_lib/http.js:132-136` only allows three origins. A preview deploy
gets a hostname like `sainted-word-records-git-feature-xyz.vercel.app`,
which **the CORS allowlist rejects silently** — the CORS error is invisible
to the engine. Add a regex match for `*.vercel.app` and a single
env-controlled primary origin.

#### 2.2 `session` cookie `Secure` on delete

`api/_lib/http.js:25-30` — `clearSessionCookie` omits `Secure`. The set
cookie has it; the delete cookie doesn't. **2-line fix.** Real, but
inconsequential because the cookie is HttpOnly + the path is host-only,
so it can't actually be read cross-origin. Document the gap as a
P3.

#### 2.3 `env(safe-area-inset-*)` + `overscroll-behavior`

`engine.html`, `swr-app.html`, and all 13 unpatched variants lack both.
4 lines per file. The composer.html I shipped earlier has them.

#### 2.4 Touch targets 44px

`.tbtn` at `engine.html:138-146` is ~30px tall. Sliders at
`engine.html:897` are 14px. @media (pointer: coarse) override, ~10
lines.

#### 2.5 `ease()` in the report: actually P2 after P1.4 above

#### 2.6 `applyReactor` unit-multiplier variance (the bigger half of #1.4)

Done by P1.1 above.

#### 2.7 README + .kai doc-truth reconciliation

`README.md:80` says "BPM (autocorrelation)". `.kai/conventions/architecture.md:78-79`
claims "lazy-evict quota handling". Both are wrong. Fix two sentences
in this session.

#### 2.8 1080p export DPR clamp (the real memory cost)

`engine.html:4349-4356` (or thereabouts) calls `fitToSize` which sets
the stage to the export preset — but **doesn't force DPR to 1**. A
1080p export allocates 4× the pixels it needs (126.6 MB vs 31.6 MB).
Forcing DPR=1 around the recording session drops 95 MB:

```js
// in capture-runtime or fitToSize
const prevDpr = Renderer.dpr;
Renderer.dpr = 1;
Recorder.start(...);
Renderer.dpr = prevDpr;
```

---

### P3 — backlog

These are real but lower-priority. Most are doc + cosmetic.

- **TRUSTED_PROXIES gate** - **done** (2026-10-22). There is no
  `api/middleware.js` in this repo, so the gate lives where the mechanism
  actually has to be: `clientIp(req)` in `api/_lib/http.js`. All seven call
  sites use it, the chain is walked from the right, an untrusted peer means
  the header is ignored, and a missing `TRUSTED_PROXIES` fails closed to the
  peer. Gated by `check:trusted-proxies-unit`.
- **`webgl-feature-detect` integration** — there's a feature-detect
  module but it's not used by the engine. Either wire it or delete.
- **The 11-instance doc drift** — covered by mechanism (0.6) once
  the CI grep is in place.
- **3 of 9 curator modules** could be merged (the audit's curator
  sprawl) — but only if the goal is *fewer concepts* and not *fewer
  lines*. Don't do it just to do it.
- **The 818-line vendored GIF decoder** — a month-long evaluation
  would determine whether the engine gains anything by supporting
  GIF input. Default: leave it; revisit if a user asks.
- **Auto-DPR user-facing reset** — covered by P1.6.

---

## What I will *not* do

In the spirit of `.kai/memory.yaml`'s "the prior report was wrong" honesty:

- **Don't reverse the codemod architecture.** 32 visual hypotheses *is*
  the research. The fix is a manifest, not a template.
- **Don't add stem separation.** It's a real capability gap but a
  research-scale problem. Lean harder on the wedge that's defensible:
  footage ownership + local-only + zero-cost + offline.
- **Don't replace IIFE wrappers with ESM.** Tree-shaking would save a
  little, but the zero-dependency "drop in a folder" claim is worth
  more. Read the comment at `engine.html:31-37` for the reasoning.
- **Don't rewrite the BPM detector.** The IOI histogram with octave
  folding is *better* than autocorrelation for this use case, and the
  confidence floor is a product decision. The only fix is to fix the
  doc.

---

## Verification

After each phase, the existing gate should pass:

```bash
npm run check:full            # 20-step pre-PR gate
node scripts/check-versions-links-unit.mjs
node scripts/check-engine-keys-keyspress-unit.mjs
node scripts/check-look-variant-unit.mjs
node scripts/check-look-filter-cycler-unit.mjs
```

The new work adds:
- A `node scripts/check-imports-resolve.mjs` gate that fails CI on any
  import of a non-existent module
- A `node scripts/check-quota-eviction.mjs` integration test that
  pushes IndexedDB past its budget and asserts the oldest item is
  evicted + the next write succeeds
- A `node scripts/check-pt-verify.mjs` integration test that mints a
  key via the Stripe webhook fixture, hits the verify route, and
  asserts the response shape

All three would be 30-80 lines each. None of them are hard.

---

## Ordering

```
P0.1 (1 line)  P0.2 (50 lines)  P0.3 (60 lines)  P0.4 (grep only)
  |              |                |                |
  v              v                v                v
  ship           ship             ship            ship
  one commit      one commit       one commit      one commit
  P0.5 (50 lines + verifier)  P0.6 (CI step)
                                      |
                                      v
                                     ship
```

Then P1 cluster in two PRs:
- PR-A: P1.1 + P1.2 + P1.3 + P1.4 (4 mutually-independent fixes)
- PR-B: P1.5 + P1.6 (cross-tab + DPR ratchet)

Then P2 in one or two PRs.

Then P3 in any order.

Total: **~7 PRs** to land every P1 and most P2s in the audit.

The **biggest** of them all is `applyReactor.js`. It's the surgical refactor the
audit points at, it kills six divergent unit tables, and it makes the
missing-target bug structurally impossible. It belongs in PR-A.

---

## Status (2026-10-22)

P0, P1 and P2 are closed. P3 is untouched and stays in the backlog.

| Item | State | Commit | Gate |
|---|---|---|---|
| 0.1 broken `_lib/paths.js` import | done | pre-audit | `check:api-*` |
| 0.2 quota-eviction policy | done | pre-audit | `check:media-*` |
| 0.3 server-side PT key verify | done | pre-audit (`api/license/verify.js`) | `check:auth-unit` |
| 0.4 engine.html mobile path | verified, no change needed | - | `check:syntax` |
| 0.5 codemod manifest + verifier | done | `656bc2e` | `check:codemods`, `check:variant-codemods` |
| 0.6 doc-vs-code drift gate | done | `f6f1645` | `check:doc-truth` (436 claims) |
| 1.1 `applyReactor` contract | done | `3b63805` | `check:apply-reactor-unit` |
| 1.2 luma saturation | done | pre-audit | `check:library-unit` |
| 1.3 section detector | done | `3b63805` | `check:section-detector-unit` (46) |
| 1.4 `ease()` shared | done | pre-audit | `check:variant-codemods` |
| 1.5 cross-tab + storage fallback | done | pre-audit | `check:media-store-unit` (36) |
| 1.6 auto-DPR ratchet TTL | done | pre-audit | `check:render-unit` (32) |
| 2.1 Vercel-preview CORS | done | `f6f1645` | `check:cors-preview-domain` |
| 2.2 `Secure` on delete cookie | done | `f6f1645` | `check:session-cookie-secure` |
| 2.3 safe-area + overscroll | done | `aaf7e39d` + `21e9c693` | `check:safe-area-inset` (33 pages, 25 self-test cases) |
| 2.4 44px touch targets | done | `f6f1645` | `check:touch-targets` |
| 2.5 (folded into 1.4) | done | - | - |
| 2.6 (folded into 1.1) | done | - | - |
| 2.7 README + .kai reconciliation | done | `f6f1645` | `check:doc-truth` |
| 2.8 1080p export DPR clamp | done | `f6f1645` | `check:export-dpr-unit` |

### Where the plan's numbers were wrong

Three estimates did not survive contact with the tree, and each one cost
real work to correct. They are recorded because the *shape* of each error
is the reusable lesson, not the specific count.

- **"all 13 unpatched variants"** (2.3). There are **27** fullscreen
  renderers in `versions/`. 13 is the `REACTIVE` set in
  `check-variant-codemods.mjs` - pages sharing the engine-genops render
  pipeline, a different concept entirely. Two numbers for two different
  things, one of them remembered rather than measured.
- **"4 lines per file"** (2.3). It was 30-40, because the insets have to
  land on four separate things per page: the viewport meta, the token
  block, the `overscroll-behavior` declaration, and the padded shell.
- **"6 divergent unit tables"** (1.1). There were **15** pages, because
  the divergence had been copy-pasted along with the feature.

### The one that matters: a fix that cannot reach its own target

`aaf7e39d` padded `#app` in every renderer variant to inset the grid
chrome. It was correct and it was **incomplete**, and the reason is a
property of the technique rather than an oversight in the execution: a
box's padding only ever reaches its own content, and for a grid
container the content box is the tracks. An absolutely positioned
descendant resolves against the ancestor's *padding* box, inside which
the padding already lives (CSS 2.1 10.1), so the grid padding can never
reach it. Making `#app` `position: relative` does not help either -
`#app` is `100vh` with no border, so its padding box already *is* the
viewport box.

That produced the one genuinely instructive moment of the audit: a grep
counted **89** affected overlays and a plausible-looking fix
(`position: relative`) would have made the naive check go green on an
unfixed page. Parsing each page into an element tree and resolving every
absolute element's nearest containing-block ancestor put the real number
at **6** - the other 95 were always correct, sitting inside
`section.stage { position: relative }` or an `aside`. Both errors are now
self-test cases in `check:safe-area-inset`, so neither can recur.

The lesson for the next audit of this shape: **a counter-measure that
cannot reach the thing it is aimed at still passes a gate written by the
same person in the same hour.** The gate needed an ancestry resolver, not
a declaration scan, and only because someone went looking for the case
the gate could not see.

### Not done

No browser was available in this environment, so every visual claim
above is static CSS resolution rather than a `getBoundingClientRect`
differential. The containing-block rule is deterministic CSS and the
`calc(var(--safe-*) + Npx)` composition is provably `Npx` at zero inset,
but the on-device confirmation is outstanding. `check:full` needs Chrome
for the same reason.
