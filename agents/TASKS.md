# TASKS.md — Sainted Word Records

> Managed by SWR-Ops. Updated after each slice.
>
> State as of **2026-10-22 06:52**, against the **uncommitted** working
> tree. The P1.1/P1.3 files themselves last changed at **06:30:46**
> (`lib/apply-reactors.js`); a *separate* workstream (the Preset Editor)
> is landing on the same tree concurrently — see *Blocked on me*.
> Nothing here is committed, and nothing is marked done without its
> gate output pasted in this file.

---

## Blocked on me (human)

- [ ] **Another agent is editing this tree — it changed under me three
      times.** `lib/apply-reactors.js` moved `06:26:32 → 06:30:46` and
      `scripts/check-apply-reactor-unit.mjs` `06:26:32 → 06:30:33`
      *during* my audit; my first `check:apply-reactor-unit` run
      printed **`5 FAILED`** and every run since prints `ALL GREEN`
      (10/10 subsequent runs green). Then `AGENTS.md` (06:45:15),
      `scripts/generate-site-manifest.mjs` (06:43:41),
      `scripts/check-preset-editor-smoke.mjs` (06:44:33, new),
      `preset-editor.html` (06:47:42, new) and
      `scripts/check-quota-eviction.mjs` (06:49:24) — and the last of
      those **fixed the `check:quota-eviction` port collision I had
      flagged** (it now binds an ephemeral port, with
      `QUOTA_EVICTION_PORT` to pin one;
      `scripts/check-quota-eviction.mjs:54-58`). None of these is
      written by any command I ran.
      **I have re-verified every claim below against the current tree.**
      But the question stands: **who else is on this repo?** If a
      second agent is mid-flight, the "done" markers here describe a
      tree that may move again, and the two of us will collide on
      `lib/apply-reactors.js` and on `agents/TASKS.md`. A separate
      workstream (the Preset Editor) is landing on the same tree — see
      the last *Found* entry for the files it owns, so they do not get
      bundled with P1.1/P1.3.
- [ ] **P1.1 has shipped three deliberate rendering changes that no
      human has seen.** These are *not* bugs — I measured each one and
      they map 1:1 onto the deltas the module documents at
      `lib/apply-reactors.js:81-108`. But "documented" is not
      "approved":
      1. **Opacity ceiling 1.0 → 1.5 on all 15 variant pages** (old
         pages clamped opacity to `[0, 1]`; the shared table clamps to
         `[0, 1.5]`). Measured on `aurora`: old `1.0000` → new `1.4500`
         for one `opacity` reactor at `scale:2`.
      2. **`neon` / `music_video` / `music_video_mtv`: the preset's
         `scale` now reaches `opacity`/`brightness`/`contrast`**, which
         it did not before (those pages' `v` carried no `r.scale`).
         Measured `brightness`: old `1.3` → new `1.6` at `scale:2`.
      3. **`grid`: opacity flipped from an *inverse* blend to
         additive**, so louder music now *brightens* the layer instead
         of dimming it (old `0.9` → new `1.5`), and `grid` gained the
         `brightness`/`contrast` targets it never had (old stayed at
         `1`, new `1.6`).
      **Please eyeball one `neon` render and one `grid` render before
      this lands.** Delta 3 is the one I would least like to discover
      from a customer.

---

## In Progress

- [ ] **Slice 1 — P1.1: make the parity sweep permanent** —
      Owner: SWR-Check (evidence + verdict)
- [ ] **Slice 2 — P1.3: rule on the section cue's page coverage** —
      Owner: SWR-Check (evidence) → human (ruling)
- [ ] **Slice 3 — P1.3: close the detector's double-count hole** —
      Owner: SWR-Check (verification) → human (code)

---

## Changed

_(file:line + what changed + why)_

- [x] `lib/apply-reactors.js:1-387` *(untracked, new)* — the one shared
      reactor contract. One `UNIT` table (line 130: `x:250 y:250 rot:12
      hue:1 opacity:1 scale:1 brightness:1 contrast:1`, plus
      `DEFAULT_UNIT: 100` at line 146), one `CLAMP` table (line 148:
      `scale:[0.05,4] opacity:[0,1.5] brightness:[0.1,2.5]
      contrast:[0.1,2.5]`), one `TARGETS` list (line 158), one dispatch
      loop (`applyReactor`, line 285), and the eight historical unit
      tables preserved as named compatibility tables (`UNITS`, line 165)
      so no shipped preset has to migrate. Why: plan P1.1 — six
      divergent unit tables collapse to one file, and the
      missing-target bug becomes structurally impossible (the dispatch
      is `out[target] += delta` against a fixed key set, so a new
      target is a row in `UNIT`, not an `else if` in 15 files).
- [x] `lib/apply-reactors.js:120-387` — the module is a **classic IIFE
      exposing `window.SWR_REACTORS`** (line 385), not ESM, and resolves
      `window.SWR_AUDIO_DAMP` lazily *at call time* (`globalDamp`, line
      366) so it cannot race a `defer` load order. Why: the plan's
      "What I will not do" section keeps every page a global-script
      surface, and Vite's `strip-absolute-module-scripts` plugin
      rewrites a `type="module"` absolute path into a late-loading
      defer classic script.
- [x] `lib/apply-reactors.js:322-330` — the `mutate` jitter is applied
      to the **post-gain** value (`delta = v * gain * sens; delta +=
      jitter; delta *= unit`), so it is multiplied by the *unit* but not
      by `r.scale` or `sens` a second time. Why: every historical
      `applyR` did exactly this; adding the jitter to the *eased* value
      would silently rescale the mutation randomness by `r.scale * sens`.
      The comment at lines 325-329 says so, and the gate now pins it
      (`scripts/check-apply-reactor-unit.mjs:237`).
- [x] `versions/aurora.html:322`, `chrome.html:322`, `eclipse.html`,
      `film.html`, `fractal.html`, `glitch.html`, `grid.html:374`,
      `hallucination.html`, `music_video.html`, `music_video_mtv.html`,
      `neon.html`, `pulse.html`, `smoke.html`, `void.html`,
      `watercolor.html` — each gained a blocking
      `<script src="/lib/apply-reactors.js"></script>` and its
      hand-typed `if (r.target === …)` chain replaced by one
      `RX.applyReactor(l, A, 0, { units: RX.UNITS.<table>, … })` call.
      Why: plan P1.1.
- [x] `engine.html:35` — the engine loads the same module, and its
      reactor path now goes through it (`engine.html:5034-5050`),
      passing `units: RX.UNITS.natural` (line 5036 — every unit 1),
      its **own** `ease` map (line 5041, because its `release` curve is
      an ease-out and `lib/ease.js`'s is identity), `damp: false`
      (line 5049 — the engine never loaded the audio damper) and
      `wrapRotation: false` (line 5048 — it never folded the
      accumulated angle). Why: P1.1 — the engine's presets read
      `r.scale` as a gain in the target's natural units, so `natural` is
      the identity table.
- [x] `engine.html:5047, 5051` — the rotation gate is now
      `allowRotation: enabled` **plus** an explicit
      `if (!enabled) return out;` *after* the shared call. The old code
      had two near-duplicate loops (one with a `rot` branch, one
      without) and returned early from the second. Why: the old
      `!enabled` loop ran *before* the audio-algorithm block; the new
      one must too, or the non-rot reactors would be applied twice.
- [x] `client/automix-arc.client.js:363-368` — the section cue's
      vocabulary (plan P1.3). `SECTION_CLASS` maps `chorus → dynamic`,
      `breakdown/intro/outro → subtle`; `verse` and `prechorus` are
      deliberately absent (no opinion — the act plan's own
      warmth/intensity is the better signal mid-song).
- [x] `client/automix-arc.client.js:372, 386-401` —
      `MIN_CUE_CONFIDENCE = 0.5` (the same threshold
      `client/automix.client.js:456` already uses to accept a label) and
      `noteSection` (line 386), which arms the one-shot `pendingCue`
      (line 377). A boundary with no usable name, an unknown name, or a
      confidence below the floor leaves an already-armed cue alone — it
      does not clear a good cue with a weak one.
- [x] `client/automix-arc.client.js:427-428, 403-411` — the arc
      subscribes to `swr-section-change` and `swr-section-reset` on
      `window`; `onSectionChange` (line 403) and `onSectionReset`
      (line 410) are also callable directly. Why: the arc is built
      *offline* from a decoded buffer while the detector runs *live* —
      nothing on the data path connected them.
- [x] `client/automix-arc.client.js:432-451` —
      `pickTransition(warmth, intensity, cue)`. A cue's opinion
      overrides the plan's; with no cue the original
      warmth/intensity rule is untouched. Why: the cue is *additive*,
      never a replacement.
- [x] `client/automix-arc.client.js:461-462` — the cue is **consumed at
      the act boundary**, not inside `pickTransition`. Why:
      `pickTransition` is a pure read that the unit gate calls
      directly, and a pure function must not be able to spend a
      one-shot. Whether or not the name resolves to a catalog entry, the
      vote is spent.
- [x] `client/section-detector.client.js:668-686` — `restartStream`
      now takes a `reason` and dispatches a **new, separate**
      `swr-section-reset` event (`detail: { reason, dropped }`, line
      683). Every call site passes one: `'gap'` (line 704), `'silence'`
      (line 741), `'reset'` (line 942, from the public
      `SWR_SECTION.reset()`). Why: `swr-section-change` is a contract
      other modules already parse (`client/section-scheduler.client.js`
      reads `detail.to`), so an emptied map must not be dressed up as a
      boundary to a chorus.
- [x] `client/automix-arc.client.js:410-425` — the arc drops its armed
      cue on `swr-section-reset` and records `lastResetReason`. Why: a
      cue from the previous song must not bias the new song's first act
      boundary.
- [x] `scripts/check-section-detector-unit.mjs:452-618` — new section
      11 (168 lines) covering the arc cue: the vocabulary is unchanged
      (3 subtle / 5 dynamic), a subtle cue beats a hot act and a
      dynamic cue beats a cold act, a null cue leaves the original rule
      intact, a neutral/low-confidence/unknown section cannot arm or
      replace a cue, reading does not consume, an act transition
      consumes exactly once, and a song swap drops the stale cue and
      records the reason.
      **Evidence: `node scripts/check-section-detector-unit.mjs` →
      `PASS: 74 / FAIL: 0`.**
- [x] `scripts/check-apply-reactor-unit.mjs` *(untracked, new,
      515 lines)* — the P1.1 gate: the unit and clamp tables, the
      dispatch (one reactor per target at the contract's unit), both
      ends of every clamp, the rotation gate and angle wrap, the target
      allowlist, `sens`, `ease`, `mutate` (including the jitter's
      placement, line 238) and the damper, 19 malformed-input cases,
      `baseTransform`, all 8 named tables, a static pass over the 16
      call sites (`SURFACES`, line 416), and a self-test that breaks the
      table on purpose to prove the gate can still fail (line 483).
      **Evidence: `node scripts/check-apply-reactor-unit.mjs` →
      `ALL GREEN - one reactor contract, one unit table, one clamp
      table` (263 PASS; 10/10 consecutive runs green).**
- [x] `package.json:38` + `scripts/run-steps.mjs:186-191` — the new gate
      is wired into the `check` group. Why: a gate nobody runs is
      decoration.
- [x] `versions/_render-inject.js:269-291` — codemod step 5b. It no
      longer writes a per-page unit chain; it **warns** if a page has
      an `applyR` that does not call the shared module, or calls it
      without the `<script src="/lib/apply-reactors.js">` tag. Why: the
      codemod used to be the exact mechanism that forked the table back
      out.
- [x] `engine-genops.client.js:46-51` — the comment now names
      `SWR_REACTORS.UNITS.natural` as the unit table the engine's
      `TARGET_RANGE` values are expressed in. Why: the old comment said
      "matching applyR()'s multipliers in the pages", which is no longer
      where the multipliers live.

---

## Found

_(discoveries + implications)_

- [x] **P1.1 is complete, and I can now prove it numerically.** All 15
      variant pages that carry an `applyR` plus `engine.html` call the
      shared module — **16 call sites**, confirmed three ways:
      `grep -l 'SWR_REACTORS' versions/*.html engine.html | wc -l` → `16`;
      the gate's own `SURFACES` list (16 entries,
      `check-apply-reactor-unit.mjs:416-433`); and a repo-wide sweep
      for a leftover hand-typed table
      (`grep -rn "out\.[a-z]\+ += v \* [0-9]"`) which returns **only
      the explanatory comment in `versions/_render-inject.js:271`**.
      Implication: the plan's "six divergent unit tables collapse to
      one" is met, and grid's missing-target bug is fixed by
      construction.
- [x] **A 240-case old-vs-new parity sweep: every motion target
      matches exactly, and all 46 differences map 1:1 onto the three
      documented deltas.** I replayed each of the 15 pages' *pre-
      refactor* `applyR` (reconstructed from `git show HEAD:versions/
      <id>.html`) against the shipped shared contract, for all 8
      targets × 2 mutate settings: **194/240 exact to 1e-9; 46
      differ, and every one is a grade target
      (`opacity`/`brightness`/`contrast`)** — the three deltas listed
      under *Blocked on me*, and nothing else. `scale`, `x`, `y`,
      `rot` and `hue` match on **every page**, and so does every rot
      seed (`l.hue * 0.05` on 10 pages, `l.hue * 0.1` on
      `hallucination`, `0` on `eclipse`/`film`/`grid`/`smoke`).
      Implication: the refactor is a faithful reorganisation, not a
      re-tune — **the only behaviour changes are the three that were
      chosen on purpose.** The gate cannot show this today, because it
      pins the *tables*, not the *rendered transform*; that gap is
      Slice 1.
- [x] **Every page's unit table is faithful to its own history.** I
      diffed each old page's hand-typed chain against its new
      `UNITS` row, all 7 units each: `aurora/chrome/fractal/glitch/
      pulse/void/watercolor` were `200/200/30/60/0.5/0.5/0.5` →
      `gain200`; `eclipse` `180/180/25/60/0.6/0.5/0.5` → `eclipse`;
      `film` `250/250/12/40/0.4/0.3/0.3` → `film`; `smoke`
      `300/300/8/50/0.3/0.2/0.2` → `smoke`; `hallucination`
      `150/150/45/80/0.7/0.7/0.7` → `hallucination`;
      `neon/music_video/music_video_mtv` → `naturalHalfGrade`; `grid`
      → `grid`. **15/15 pages: all 7 units match.** Implication: no
      page's visual tuning moved, and the module's `UNITS` rows are
      not guesses.
- [x] **The `mutate` jitter was correct on my *first* read and is
      still correct — but only because it was fixed mid-session.** My
      initial read of `lib/apply-reactors.js` (378 lines) added the
      jitter to the **eased** value, which multiplies it by `r.scale` a
      second time: on `aurora`'s shipped preset
      (`{feature:'air',target:'hue',scale:120}`) with `mutate=0.4` I
      measured **OLD hue 4752.0000 → NEW 141840.0000, a 29.8× change**
      (the default `mutate:0` matched exactly, so it would have shipped
      invisible). The current file (387 lines, mtime 06:30:46) applies
      the jitter to the post-gain value instead, and the gate now
      (`scripts/check-apply-reactor-unit.mjs:237`: at
      `random()=1` the hue must move by `10 + 4 = 14`, not
      `(1+4)*10 = 50`). I re-ran the comparison against the current
      file: **OLD 4752.0000 = NEW 4752.0000, exact match.**
      Implication: the bug was real and is now fixed *and* pinned —
      but this is precisely why Slice 1 exists. The gate caught it
      only because someone added the assertion; the parity sweep I ran
      by hand is what proves the whole set.
- [x] **The detector's documented double-count guard does not hold in
      the real engine.** `client/section-detector.client.js:693-695`
      skips a frame when `tMs === live.lastTMs`, and
      `client/automix.client.js:448` calls `SWR_SECTION.detect(features)`
      with the *same live* `Audio.feat` object the engine passes — so
      the comment at `engine.html:5677` ("the detector dedupes on the
      timestamp … cannot double-count") depends on the feature object
      carrying a stable `tMs`. It does not:
      `lib/audio.client.js:118-128` builds `feat` as
      `{bass, mid, treble, air, sub, rms, centroid, beat, onset,
      beatPulse, onsetPulse, bpm}` with **no `tMs`**, so `nowMs()`
      (`section-detector.client.js:606-613`) falls back to
      `performance.now()` and the two callers get *different*
      timestamps. Instrumented proof (patching the accumulator's
      `accN++` to count): **63 engine calls → 63 ingests; 63 engine
      calls + 63 automix calls → 126 ingests** (every call re-ingests);
      **with a frozen `tMs` → 1 ingest** (the guard works). The row
      count is unaffected (70 rows either way), so boundaries still
      land — but each descriptor row is averaged over twice the samples
      it thinks it has, and the section cue is fed by a noisier stream
      than the unit gate's fixture (which *does* set `tMs`, at
      `check-section-detector-unit.mjs:145`). Implication: a fidelity
      change, not a correctness break — but the comment at
      `engine.html:5677` currently asserts a protection the production
      path does not have.
- [x] **The arc's `swr-section-change` listener is only reachable on 8
      of the 25 pages that load the arc.** The detector script is
      loaded by `engine.html:8838` and 7 variants (`film`, `smoke`,
      `grid`, `hallucination`, `music_video`, `music_video_mtv`,
      `neon`), but the detector is only *fed* by `engine.html:5683`
      (`window.SWR_SECTION.detect(a)`). The 7 variants load
      `client/section-detector.client.js` but never call
      `SWR_SECTION.detect` themselves — they get sections only through
      `client/automix.client.js:448`, on the automix tick, and only
      when automix is enabled. The other 17 arc pages (`aurora`,
      `baroque`, `chrome`, `collage`, `echo-manifold`, `eclipse`,
      `fractal`, `glitch`, `kraft`, `mosaic`, `phosphor`, `pulse`,
      `spectrum`, `tape`, `typography`, `void`, `watercolor`) load the
      arc but not the detector, so `swr-section-change` can never fire
      there and the cue is dead code. Implication: P1.3 is live on the
      engine and thin elsewhere. The plan's own P1.3 wording ("never
      `import`-ed by the engine", `docs/PLANS/architecture-audit-2026-
      10.md:149-150`) is **already stale** — the detector *is* wired at
      `engine.html:5683` and was before this diff.
- [x] **The cue's confidence gate rejects roughly half of the real
      boundaries.** Replaying the repo's own fixture
      (`check-section-detector-unit.mjs:100-160`, the 72-beat 3-section
      track) through the real detector + real arc in a sandbox:
      `intro → chorus` publishes `confidence 0.5390` (**arms** →
      `cls: dynamic`) and `chorus → verse` publishes `confidence 0.4424`
      (**does not arm**, below `MIN_CUE_CONFIDENCE 0.5`); the arc's
      armed cue is `chorus/dynamic`. The detector's `confidence()`
      (`section-detector.client.js:444-459`) damps by section age
      (`0.6 + 0.4*min(1, frames/4)`) and by steadiness, so a
      freshly-cut section is *least* confident at the moment it is
      announced. Implication: the cue fires on a minority of boundaries
      by construction — soft by design, but "the cue never arms" is the
      common case. The gate's own end-to-end assertion
      (`check-section-detector-unit.mjs:596-604`) is written to accept
      `!cue` ("or null if the detector's damped confidence held it
      back"), so it cannot fail on this.
- [x] **`versions/gallery.html` is NOT a reactor surface — the 4
      `reactors` hits are marketing copy, not config.** Lines 186, 222,
      258 and 276 are all `<span>… reactors</span>` inside feature
      blurbs ("3 reactors", "1–2 reactors"). There is no `applyR`, no
      `reactors` array and no shared-module call on that page.
      Implication: it is correctly absent from the gate's `SURFACES`
      list, and no slice is needed for it.
- [x] **The module's own header counts are stale, and one is wrong.**
      `lib/apply-reactors.js:70` says "fifteen surfaces" and line 74
      "other fourteen" — the truth is **16** surfaces (15 variants +
      `engine.html`), as the gate's `SURFACES` list has 16 entries. The
      header's table (lines 22-34) also labels the `gain200` family
      "the eleven-page artistic family" — it is **7** pages
      (`aurora/chrome/fractal/glitch/pulse/void/watercolor`), and the
      family is 7, not 11. `scripts/check-apply-reactor-unit.mjs:6,18,20`
      repeat the "fifteen surfaces / fifteen HTML files" figure.
      Implication: the *code* is right and the *comments* are wrong —
      a doc-truth defect in the exact file the plan's P0.6 CI gate
      exists to prevent. Cheap to fix, and it is the kind of drift
      that costs the next reader an hour.
- [x] **`opts.targets` (the plan's "target allowlist") is implemented
      but used by no call site.** `lib/apply-reactors.js:297` honours
      it and the gate asserts it (`check-apply-reactor-unit.mjs:204`),
      but no migrated page passes it — `engine.html:4128-4194` has
      `targets: [...]` arrays that are *preset* target lists, not the
      reactor allowlist. Implication: dead-but-tested API surface.
      Harmless, but it should be marked reserved or dropped.
- [x] **The `hue` unit is 1, not the plan's 40 — and the plan says
      so.** `docs/PLANS/architecture-audit-2026-10.md:132` sketches
      `hue: 40`; the shipped `UNIT.hue` is `1`
      (`lib/apply-reactors.js:134`), because `engine.html`, `neon`,
      `music_video` and `music_video_mtv` already read `r.scale` for
      `hue` as a degree count, and the per-page tables
      (`UNITS.gain200.hue = 60`, `UNITS.hallucination.hue = 80`, …)
      carry the rest. Implication: the plan's snippet is a sketch, not
      a spec; the deviation is documented at `lib/apply-reactors.js:
      48-56`. No action beyond noting the plan and the code disagree.
- [x] **Dist packaging is already correct — no build change needed.**
      `vite.config.js:759` copies `{ src: 'lib', dst: 'lib' }`
      wholesale, so the root-absolute `/lib/apply-reactors.js` resolves
      in the built output exactly as in dev. And the load order holds
      on both page shapes: `versions/aurora.html:322` places the tag
      *before* the `applyR` inline module, and `engine.html:35` places
      it before the `window.SWR` assembly — which is why it must be a
      blocking classic script and must not carry `type="module"`.
- [x] **The `check:quota-eviction` port collision is fixed (by the
      concurrent writer, at 06:49:24).** The gate used to bind a fixed
      `PORT = 5197`, which collided with a stray `node lib/serve.js
      --port 5197` (PID 28503) and failed with `EADDRINUSE` *before
      asserting anything* — so the suite read 105/106 for a reason that
      had nothing to do with this work. It now binds an ephemeral port
      and reads back the real one
      (`scripts/check-quota-eviction.mjs:54-58` and `:125`,
      `QUOTA_EVICTION_PORT` to pin one).
      **Evidence: `npm run check:quota-eviction` → `PASS - quota
      eviction drops the oldest non-favorite record, retries once, and
      never loses a favorite`.** Implication: the full suite is now
      green end to end — **Evidence: `npm run check` → `check: all 107
      steps passed` (173.92s)** — so the P1.1 and P1.3 gates both pass
      *inside* it, and the suite's earlier red is gone.
- [x] **A codemod-safety check passes.** `node versions/verify-codemods.mjs`
      → `PASS - manifest matches the tree (9 warnings)`; none of the 9
      warnings concerns `_render-inject` or the reactor contract. The
      pre-existing warnings (blend-shuffle, library-loader, site-exit,
      tone-slider) are unrelated drift.
- [x] **A second, unrelated workstream is landing on this tree
      concurrently: the Preset Editor.** New untracked `preset-editor.html`
      (06:47:42) and `scripts/check-preset-editor-smoke.mjs` (06:44:33),
      plus `site-map.json` (a `/preset-editor` nav entry),
      `vercel.json` (its 301 rewrites) and `sitemap.xml` — all
      regenerated by `scripts/generate-site-manifest.mjs` (touched
      06:43:41). Implication: **these files are not part of P1.1 or
      P1.3 and must not be bundled with them.** The reactor refactor
      touches none of them; the correct commit for P1.1+P1.3 is
      `lib/apply-reactors.js`, `scripts/check-apply-reactor-unit.mjs`,
      `package.json`, `scripts/run-steps.mjs`, `client/automix-arc.
      client.js`, `client/section-detector.client.js`,
      `scripts/check-section-detector-unit.mjs`, `engine.html`,
      `engine-genops.client.js`, `versions/_render-inject.js` and the 15
      `versions/*.html` pages — and nothing else.

---

## Slices

> Each slice is small, has one owner, one file set, a check that can be
> run, and the evidence that closes it. "Parallel" means the slice can
> run alongside its neighbours **without a file conflict** — per
> `agents/swr-ops.md` rule 3.
>
> **Ownership note (contract):** SWR-Twin writes only inside
> `../digital_twin` and never in `sainted-word-records`; SWR-Check
> writes nothing. So **every slice below that changes repo code is
> executed by the human**, and SWR-Check's role on each is to produce
> the evidence and the verdict. SWR-Twin is used only where a
> *creative / taste* judgement is genuinely required.

### Slice 1 — P1.1: make the parity sweep permanent

- **Owner:** SWR-Check (spec + verdict) → human (implementation)
- **Files owned:** `scripts/check-apply-reactor-unit.mjs`
- **Acceptance:** the gate gains a section that replays **each of the
  15 pages' pre-refactor `applyR`** (reconstructed from
  `git show HEAD:versions/<id>.html`) against the shipped shared
  contract, for all 8 targets × 2 mutate settings — 240 cases — and
  asserts:
  - every motion target (`scale`, `x`, `y`, `rot`, `hue`) and every rot
    seed matches **exactly** (1e-9), and
  - the grade targets (`opacity`, `brightness`, `contrast`) match
    **only** where the three documented deltas say they should —
    `lib/apply-reactors.js:81-108` must be the source of truth, so the
    gate cites that comment rather than re-deriving the numbers.
  It must be a **difference** assertion, not an equality one: a
  *fourth* delta must fail the gate. Run:
  `node scripts/check-apply-reactor-unit.mjs` → `ALL GREEN`, and it
  must be shown to go red when a page's `UNITS` row is mutated on
  purpose (the file already has that self-test pattern at line 483).
- **Evidence required:** the pasted gate output; the per-page
  expected-value table the gate encodes; and the red output from the
  deliberate mutation.
- **Parallel:** **no** — it is the top slice and the highest-value
  item; it is file-disjoint from Slices 2, 3, 4 and 6, so it can run
  alongside those.

### Slice 2 — P1.3: rule on the section cue's page coverage

- **Owner:** SWR-Check (evidence) → human (ruling)
- **Files owned:** the 7 variant pages that load the detector but never
  feed it (`versions/film.html`, `smoke.html`, `grid.html`,
  `hallucination.html`, `music_video.html`, `music_video_mtv.html`,
  `neon.html`) — **or** `client/automix-runtime.client.js` if the
  decision is to feed the detector from the shared runtime
- **Acceptance:** a one-line written ruling — *the section cue is
  engine-only* **or** *the cue is live on all N surfaces* — answering:
  on the 17 arc pages that load no detector, is the cue supposed to be
  dead? Options, in the order I would try them:
  (a) feed the detector from `client/automix-runtime.client.js`, which
  already calls `SWR_AUTOMIX.tickSection` (line 538), which already
  calls `SWR_SECTION.detect` (`client/automix.client.js:448`) — so
  every automix surface gets sections for free and the 7 variants
  start producing boundaries;
  (b) load `client/section-detector.client.js` on the remaining 17
  arc pages and feed them from the same place `engine.html:5683` does;
  (c) declare it engine-only, and delete the arc's listener from the
  pages that cannot use it.
  Verify with: `node scripts/check-section-detector-unit.mjs` →
  `PASS: 74 / FAIL: 0`, **plus** a new assertion that the cue arms on
  at least one boundary of the repo's own fixture (today it arms on
  `0.5390` and is refused on `0.4424`).
- **Evidence required:** the ruling in writing; the chosen option's
  file list; a boundary-confidence trace showing which boundaries arm.
- **Parallel:** **yes** — disjoint from Slices 1, 3, 4 and 6
  (`versions/*.html` + `client/automix-runtime.client.js` vs
  `lib/apply-reactors.js` + `scripts/check-apply-reactor-unit.mjs`).
  Caveat: Slice 2(a) touches `client/automix-runtime.client.js`, which
  no other slice touches, so the disjointness holds.

### Slice 3 — P1.3: close the detector's double-count hole, or correct the comment

- **Owner:** SWR-Check (verification) → human (code)
- **Files owned:** `lib/audio.client.js` (add `tMs` to the `feat`
  object, ~line 118) **or** `client/section-detector.client.js`
  (dedupe on a frame identity rather than a timestamp) **or** the
  comment at `engine.html:5677-5678`
- **Acceptance:** the engine's two `detect()` callers on the same audio
  frame ingest **once**. The cheapest correct fix is to stamp `tMs` on
  `Audio.feat` — the detector already prefers `feat.tMs` over
  `performance.now()` (`section-detector.client.js:606-608`), which
  makes the existing guard at line 695 do its job *and* makes the
  detector's frame window exact. Assert it: a gate case that calls
  `detect(feat)` twice with the **same** feat object and counts
  ingests (today: 126 for 126 calls; after the fix: 63). Run:
  `node scripts/check-section-detector-unit.mjs` → `PASS: 74 / FAIL: 0`
  (or higher).
- **Evidence required:** the ingest count before and after, and the
  pasted gate output. **If the fix is not made, the comment at
  `engine.html:5677` must be corrected** — as it stands it asserts a
  protection the production path does not have.
- **Parallel:** **yes** — disjoint from Slices 1, 2, 4 and 6.
  `lib/audio.client.js` is touched by no other slice.

### Slice 4 — P1.1: fix the header's stale counts

- **Owner:** SWR-Check (evidence) → human (edit)
- **Files owned:** `lib/apply-reactors.js` (the comment block, lines
  22-34 and 70-74) and `scripts/check-apply-reactor-unit.mjs` (its
  header comment, lines 6, 18, 20)
- **Acceptance:** the counts match the tree — **16** surfaces (15
  variants + `engine.html`), and the `gain200` family is **7** pages
  (`aurora/chrome/fractal/glitch/pulse/void/watercolor`), not eleven.
  The `UNITS` table's own inline comment
  (`lib/apply-reactors.js:176-180`, "the eleven-page artistic family")
  is part of the same fix. Verify with a count:
  `grep -l 'SWR_REACTORS' versions/*.html engine.html | wc -l` → `16`,
  `grep -l 'UNITS.gain200' versions/*.html | wc -l` → `7`.
- **Evidence required:** the pasted `grep` output for both counts.
- **Parallel:** **yes** — but it edits `lib/apply-reactors.js`, which
  Slice 1's spec and Slice 6's behaviour both depend on. **Run it
  after Slice 1**, or fold it into Slice 1's file set. It is
  comment-only, so it cannot change behaviour — but it does touch a
  file the other slices read, so it does not run *concurrently* with
  them.

### Slice 5 — P1.1: decide whether `opts.targets` stays

- **Owner:** SWR-Check (evidence) → human (ruling)
- **Files owned:** `lib/apply-reactors.js` (the `opts.targets` branch,
  line 297) and `scripts/check-apply-reactor-unit.mjs` (its assertion,
  line 204) — **or** nothing, if the ruling is "keep it, it is the
  extension point"
- **Acceptance:** a written ruling — "reserved for future use, keep
  the gate assertion" **or** "drop it". If dropped, remove the branch
  at `lib/apply-reactors.js:297, 314` **and** the gate assertion at
  `check-apply-reactor-unit.mjs:204-206`, so the module does not carry
  an option nothing can reach. Verify with
  `node scripts/check-apply-reactor-unit.mjs` → `ALL GREEN`.
- **Evidence required:** the ruling, and the pasted gate output.
- **Parallel:** **no** — it edits `lib/apply-reactors.js` and the gate,
  the same two files as Slices 1 and 4. Sequence it after them.

### Slice 6 — surface the new contracts in the canonical docs

- **Owner:** human (docs) — SWR-Twin may draft the wording
- **Files owned:** `AGENTS.md` (the canonical current-state doc — it
  currently has **zero** mentions of `apply-reactors`, `applyReactor`,
  `swr-section-change` or `swr-section-reset`),
  `CHANGELOG.md` (`[Unreleased] → Added`), and
  `docs/PLANS/architecture-audit-2026-10.md:125-143` (P1.1) and
  `:147-154` (P1.3 — its "never `import`-ed by the engine" claim is
  already stale; the detector is wired at `engine.html:5683`)
- **Acceptance:** `AGENTS.md` names `lib/apply-reactors.js` in the
  `lib/` inventory with its one-line contract, and names the
  `swr-section-reset` event; `CHANGELOG.md` records the shared reactor
  contract and the section cue; the plan's P1.1 and P1.3 entries are
  marked done with a pointer to the real change. Check:
  `grep -c 'apply-reactors' AGENTS.md` → ≥ 1, and the same for
  `CHANGELOG.md`.
- **Evidence required:** the pasted `grep -n` output for each file.
- **Parallel:** **yes** — disjoint from Slices 1-5 (it touches only
  `.md` files). It can run alongside everything; it is the
  lowest-risk slice and the one most likely to be forgotten.

### Slice 7 — P1.2 (plan item, not started, not in this diff)

- **Owner:** SWR-Check (audit) → human
- **Files owned:** `client/library.client.js` (the `luma` saturation at
  plan lines 136-143) — the plan calls it 4 lines
- **Acceptance:** `library.client.js:710` and `:755` no longer collapse
  `luma` to 1.0 for any video above 25 % grey; a regression assertion
  in the `library` unit gate shows `autoMap`'s 2-factor score is not
  flattened by a bright-but-flat video. Verify with the existing
  library unit gate name from `package.json`.
- **Evidence required:** the saturation curve before/after and the
  pasted gate output.
- **Parallel:** **yes** — `client/library.client.js` is touched by no
  other slice, and P1.2 is independent of P1.1 and P1.3 (the plan
  itself lists them as "4 mutually-independent fixes").
- **Note:** P1.2 is *not* implied by the current diff. It is listed
  here only because the plan's P1 cluster names it and it is the next
  unstarted item in the same PR-A group. **Confirm before spending on
  it.**

---

## How to Use

1. **SWR-Ops** decomposes work and updates this file
2. **SWR-Twin** picks up creative tasks
3. **SWR-Check** verifies before marking done
4. After each slice: implement → test → verify → commit → update TASKS.md

**Do not mark a slice done without its evidence pasted above.** A slice
is done when its command output is in this file, not when the code
looks right.
