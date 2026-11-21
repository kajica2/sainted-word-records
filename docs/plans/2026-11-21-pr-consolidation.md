# Consolidating the open pull requests

**Written 2026-11-21, against `main` at `9de74166`.**

Twelve pull requests were open. Every one of them was opened between 2026-11-06
and 2026-11-10, and every one of them had fallen behind: not one was both
mergeable *and* up to date with `main`. In the same fortnight `main` took 128
commits — the NEON demo panel and its preset transitions, a rewritten
accessibility gate, five codemod repairs, the tone-slider fix. The pull
requests were written against a tree that no longer exists.

This document says what each one is, what is left to do with it, and in what
order. It is a plan, not a report: the four pull requests that were already
dead have been closed, and the rest are described well enough to be landed
one at a time.

---

## 1. The bar

"Up to notch" is not one thing in this repo. It is three layers, and a pull
request has to clear all three.

**Layer 1 — the ruleset.** `main` is protected by ruleset `26608109`
(`docs/MAIN-BRANCH-RULESET.md`): no direct pushes, every change arrives
through a pull request, the required check is `check + verify + build-size`,
and `strict_required_status_checks_policy` is **on** — so the branch has to be
**up to date with `main`** at the moment it merges, not merely green. Merge
and Squash are both allowed; there is one collaborator, so approvals are 0
and the gate is the machine.

**Layer 2 — the gate groups.** `scripts/run-steps.mjs` defines three:

| group | steps | what it is |
|---|---|---|
| `check` | **158** | the unit checks, the source lints, the honesty gates |
| `full` | **35** | `check` plus the browser smokes and the build |
| `storyboard` | **5** | the storyboard pipeline |

A pull request that adds a feature but does not wire its tests into
`scripts/run-steps.mjs` is **not** up to notch, whatever its own workflow
says. The repo's gates never run those tests, so they rot.

**Layer 3 — the honesty gates.** This repo's distinctive discipline: the
things the repository claims about itself are measured and checked.

| gate | what it holds honest |
|---|---|
| `check:codemods` | `versions/manifest.json` matches the tree; pending drift ages out after 30 days |
| `check:doc-truth` | 471 claims across 13 docs still match the source |
| `check:a11y` | per-rule violation counts may only shrink (`qa/a11y-baseline.json`) |
| `check:a11y-names-unit` | the accessible-name census may only shrink (`qa/a11y-names-baseline.json`) |
| `check:media-budget` | per-directory shipped bytes |
| `check:dist-links` | every route in `site-map.json` resolves |
| `check:site-chrome` | every page carries the shared chrome |

A pull request is up to notch when the truth it adds is **measured**, not
asserted. The two closed pull requests below are the clearest examples of
what happens when it is not.

---

## 2. The audit

`main` = `9de74166`. "Behind" is commits of `main` the branch has not seen.
"Dist cost" is shipped bytes the branch adds to `dist/`.

| PR | What it is | State | Dist cost | Verdict |
|---|---|---|---|---|
| #308 | bound the NEON demo frame wait | 0 changed files | — | **closed 2026-11-21** |
| #306 | measure the right pages; measure accessibility | DIRTY, 16 conflicts | — | **closed 2026-11-21** |
| #321 | plan the NEON demo follow-ups | DIRTY | — | **closed 2026-11-21** |
| #328 | plan the NEON audio top layer | behind 47 | — | **closed 2026-11-21** |
| #329 | GTM research + campaign playbook | behind 55, green, clean | 0 | **merge as-is** |
| #333 | plan the animation FX menu | behind 40, green, clean | 0 | **merge as-is** |
| #302 | keep Command Center evidence; close resources | behind 123, red on an unrelated flake | 0 | **rework** |
| #309 | real Color Tales default pages | behind 116, red on a stale budget | ~445 KB | **rework** |
| #332 | NEON slideshow script + image lane | DIRTY (CHANGELOG only) | small | **rework** |
| #334 | BeatCanvas studio + research lab | DIRTY | small | **rework** |
| #335 | BeatCanvas video strips (stacked on #334) | draft, green on its own workflow only | small | **rework, into #334** |
| #301 | Remix Studio | behind 123, green, clean | small | **rework** |

### The three failures that are not failures

Three pull requests are red for reasons that have nothing to do with their
code:

- **#334** and **#309** — both fail only at `build-size budget (<= 181M)`:
  `181.0M` and `181.7M` against a 181M ceiling. Their `ci.yml` carries the
  **old** ceiling. `main` raised it to **182M** on 2026-11-10 (`a62f0f0a`),
  and `main`'s own tree now measures **181.1M** against that 182M ceiling.
  Rebasing onto `main` is the whole fix.
- **#302** — fails at `check:neon-demo-panel-verify` with
  `✗ keys:home (no state or pixel delta)`. That is the NEON flake, not this
  pull request: its own gates pass (`✓ npm run check:command-center 21.2s`).

The general lesson: **these pull requests were red against a tree that has
since moved, and the redness says nothing about the code.** A pull request
that is red has to be re-run before it can be judged.

### The two that are genuinely superseded

**#306** is not merely stale — it is *dangerous*. `git cherry` against `main`
returns empty, so every byte of its original commit already landed as
`679dc69c`. What the branch still carries is a **stale
`qa/a11y-baseline.json`** (`label-title-only` 133 against `main`'s 561,
`color-contrast` 4796 against `main`'s 4561) and the **pre-#340
`scripts/check-a11y.mjs`** — the version that exits only on failure and
therefore hangs on success. That is the defect that made its own run
`42637458168` time out after **4 h 0 m 16 s**. Merging it would loosen the
accessibility gate by hundreds of instances per rule and reintroduce the
hang.

**#321**'s document landed on `main` through `f57e656d`, and `main`'s copy is
a strict superset: the same five follow-ups plus the `Shipped:` markers that
record what has since been done (items 2, 4 and 5 `DONE`; item 3 still open).

---

## 3. What was consolidated on 2026-11-21

Four pull requests were closed, each with the evidence in the closing comment:

| PR | Why it was closed |
|---|---|
| #308 | its tree is byte-identical to its merge base — the merge commit resolved to `main`'s tree and erased the change. The fix itself is on `main` as #313 (`f07cf759`), which carries the same 5000 ms bound and the same control-ID diagnostic, and is strictly ahead of the branch |
| #306 | the work already landed as `679dc69c`; the branch would loosen the a11y baseline and restore the gate hang |
| #321 | the document landed as `f57e656d`, and `main`'s copy is a strict superset with the `Shipped:` markers |
| #328 | the plan's deliverable shipped: `client/wave-lines.client.js` carries exactly the planned `PRESETS_PUBLIC = ['pulse','spike','scan','ribbon','off']` (`790443bd`), and the plan file is still marked draft |

That leaves **eight**: two that can be merged as they are, six that need
work.

---

## 4. The landing order

`main`'s `dist/` measures **181.1M** against a **182M** ceiling. That is
**under one megabyte of headroom**, and three of the remaining pull requests
add shipped bytes. So the order is not by importance, it is by cost:

**Group A — no shipped bytes, land first.**

1. **#329** (GTM campaigns) — four new documentation paths, zero conflicts,
   all checks green. Read the market figures once before merging: they were
   written on 2026-11-09 and may have drifted.
2. **#333** (animation FX menu plan) — one new plan file, clean merge. **Move
   it from `.omb/plans/` to `docs/plans/`**: `main` keeps 27 plans in
   `docs/plans/` and only two in `.omb/plans/`, and the repo's own convention
   is `docs/plans/YYYY-MM-DD-topic.md`.
3. **#302** (Command Center evidence) — see §5.

**Group B — small features, measured against the budget.**

4. **#309** (Color Tales default pages) — see §5. Lands at roughly 181.5M.
5. **#332** (NEON slideshow script) — see §5.

**Group C — new surfaces, last.**

6. **#334 + #335** (BeatCanvas) — see §5.
7. **#301** (Remix Studio) — see §5. The last merge of the batch.

**Why this order.** Every merge in Group A is free in bytes, so the budget
cannot move. #309 is measured before it lands rather than after — if it
pushes `dist/` over 182M the right answer is to raise the ceiling knowingly
with the number in the commit message, not to discover it in CI. #301 is last
because it is the largest surface and the one whose stale base has to be
picked apart by hand.

---

## 5. The bring-up checklist, per pull request

### #329 — GTM campaigns (merge as-is)

- [ ] Read `marketing/campaigns/tiktok-influencer-daily-offers.md` for figures
      that have moved since 2026-11-09 (TAM, pricing, dates).
- [ ] Confirm `docs/plans/gtm-target-campaigns-2026-11.md` still describes the
      persona library it scores against (`marketing/personas/`).
- [ ] Rebase onto `main` (55 commits) — no conflicts expected; all four paths
      are new.
- [ ] Merge (squash).

### #333 — animation FX menu plan (merge as-is)

- [ ] Move `.omb/plans/2026-11-10-animation-fx-menu.md` to
      `docs/plans/2026-11-10-animation-fx-menu.md`.
- [ ] Rebase onto `main` (40 commits) — clean.
- [ ] Merge (squash).

The plan is still live: `main` has no `lib/fx-anim.glsl.js`, no `SWR_ANIM`,
no `animComposer`, and `mutAlgo` is still the 0–5 / 6–11 scheme the plan
presumes.

### #302 — Command Center evidence and cleanup (rework)

The gap is real and still open on `main`: `scripts/visual-correct.mjs` has a
bare `await browser.close()` with no `finally`, no evidence report and no
screenshot, and `.github/workflows/visual-correct.yml` has no
`upload-artifact` step. The branch merges cleanly — zero conflicts, zero
files changed in both.

- [ ] Rebase onto `main` (123 commits). `main` has not touched
      `scripts/visual-correct.mjs` since `3fd2640c` (2026-11-05).
- [ ] Re-run CI. The red step was `check:neon-demo-panel-verify`, not this
      change; if it is still red, that is the NEON flake and it must be fixed
      on `main` first, not here.
- [ ] Check that the new `tests/visual-correct-lifecycle.test.mjs` is wired
      into a `run-steps.mjs` group — it currently runs only in the workflow.
- [ ] Merge (squash).

### #309 — Color Tales default pages (rework)

- [ ] Rebase onto `main` (116 commits).
- [ ] **Keep the source JPEGs out of `dist/`.** `vite.config.js:822` copies the
      whole `color-tales` directory, so `color-tales/source/*.jpg` (445 KB)
      would ship to production. Move them out of the copied tree or add a
      copy exclusion.
- [ ] Add a `color-tales` entry to `scripts/media-budget.mjs`'s `BUDGETS` map
      so the per-directory gate can see this directory at all (see §6.4).
- [ ] Fix the pull request body: it says "7 default pages shipped"; the
      merged `default-pages.json` ships **4**.
- [ ] Re-run CI against the 182M ceiling and record the measured `dist/` size
      in the pull request body.
- [ ] Merge (squash).

### #332 — NEON slideshow script + image lane (rework)

The feature is genuinely new — `main` has no `SWR_SLIDESHOW`, no
`swr.slideshowMusic`, no `client/slideshow-script.client.js`. Only
`CHANGELOG.md` really conflicts (two hunks, both sides inserting at the same
spot); the other six files that changed on both sides auto-merge.

- [ ] Rebase onto `main` (40 commits), resolving `CHANGELOG.md` by hand.
- [ ] Confirm the new `scripts/check-slideshow-script-unit.mjs` is wired into
      the `check` group in `scripts/run-steps.mjs` (the branch adds one line
      — verify it survived the rebase).
- [ ] Re-check `lib/image-lane.client.js` against `main`'s: the branch adds
      `removeByAsset` and `clear`, and `main` has since changed the lane
      (`8b6831f8`, `815705de`, `dd0f2de5`).
- [ ] Merge (squash).

### #334 + #335 — BeatCanvas (rework, as one pull request)

**#335 is stacked on #334 and must not be merged as a second surface.** Its
`beatcanvas/index.html` conflicts against its own base and would revert
`d8f0cf5f` — the shared site chrome (`<swr-nav>`, `<swr-footer>`,
`rel="canonical"`, `og:image`, the meta description). And because its base is
`feature/beatcanvas-mvp` and not `main`, **the whole-repo gates have never
run on it**: it is green only on its own `BeatCanvas validation` workflow.

- [ ] Squash #335 into #334's branch, keeping #334's `index.html` chrome and
      adding #335's video-strips layer.
- [ ] Rebase the result onto `main`. The one real conflict is
      `package-lock.json`: `engines.node` `">=22.0.0"` (the branch) against
      `"24.x"`. Decide deliberately — `main` still says `>=22.0.0`, so this is
      a live policy change, not a no-op — and regenerate the lockfile.
- [ ] **Wire `tests/beatcanvas/*.test.mjs` into a `run-steps.mjs` group.** They
      currently run only in the dedicated workflow, so the repository's own
      gates never execute them.
- [ ] Add the surface to `site-map.json`. The branch adds its own rewrites to
      `vercel.json` and one line to `vite.config.js`, but `site-map.json`
      knows nothing about `/beatcanvas/` — so it will not appear in
      `sitemap.html` or the tools navigation. `check:dist-links` will not
      catch it either, because that gate checks the other direction.
- [ ] Measure `dist/` and record it in the pull request body.
- [ ] Merge (squash), close #335 as folded in.

### #301 — Remix Studio (rework, last)

The feature does not exist on `main` in any form, the pull request is green,
and it merges with **zero conflicts**. The work is the base: it was written
against 2026-11-06 `main`, and `main` has since changed the very files it
touches.

- [ ] Rebase onto `main` and **check the rebase did not revert `main`'s newer
      work in `engine.html` and `vite.config.js`**. The branch's diff against
      current `main` would remove:
      - the `fx-preset-transition.client.js`, `media-kind.client.js`,
        `image-layer-styles.client.js` and `mask-illusions.client.js` script
        tags;
      - the mask-illusion `<optgroup>`;
      - `mediaItemToLayerAsset` MIME classification and the `SWR_MEDIA_KIND`
        folder import;
      - the `Layers.MAX` cap of 3 (the branch puts the count stepper back to
        6);
      - the `python-audio-toolkit` dist-skip, which `main` removed on purpose
        for the size budget;
      - the `color-tales` copy rule.
      None of that is intentional — it is a stale base. Every one of those
      lines must survive.
- [ ] Check the placement of the new modules. `remix-planner.js`,
      `remix-renderer.js` and `remix-workflow.js` sit at the **repository
      root**; the repo's convention is `lib/` for shared modules and
      `client/` for browser code. Move them, or write down why they are
      different.
- [ ] Wire the four `remix-*.test.mjs` files into a `run-steps.mjs` group —
      they currently run only in the `Remix Studio` workflow.
- [ ] Merge (squash) only after the budget is measured with BeatCanvas
      already on `main`.

---

## 6. Phase 0 — the repo-level drift

Four things are true of `main` itself, not of any pull request. They are the
"up to notch" of the repository rather than of the queue.

### 6.1 AGENTS.md's description of CI — **fixed in this pull request**

The paragraph claimed that `.github/workflows/ci.yml` was the only workflow,
that it ran on pushes to **non-main** branches with `branches-ignore: main`,
and that the size ceiling was 181 MiB. All three were wrong: `ci.yml` runs
on pushes to `main` as well as pull requests against it, there are eleven
active workflows, and the ceiling is 182 MiB.

`check:doc-truth` verifies 471 claims across 13 docs but **did not reach this
paragraph**, and the reason is worth recording because it is a hole in the
gate rather than in the doc:

- the gate skips any sentence containing a negation, and the old sentence
  carried one — *"so a direct push to main **does not** trigger it"* — so
  the whole bullet was skipped, claims and all;
- the corpus it verifies against did not include YAML at all, so even a
  scanned `BUDGET_BYTES` would have failed to resolve against
  `.github/workflows/ci.yml`.

Both are fixed in this pull request: YAML is now part of the corpus, the
sentence no longer hides behind a negation, and the gate verifies **472**
claims. A negation is a reasonable thing to skip — "there is no
`api/health.js`" is not a claim — but it must not be able to smuggle an
unchecked claim past the gate.

### 6.2 Re-pin the accessibility baseline

The baseline still reads what the tree measured *before* the two WCAG
defects were fixed:

| rule | baseline | measured | delta | tolerance |
|---|---|---|---|---|
| `label-content-name-mismatch` | 268 | **132** | −136 | 2 |
| `label-title-only` | 561 | **542** | −19 | 2 |
| `color-contrast` | 4561 | 4562 | +1 | 9 |
| the other 16 rules | = | = | 0 | — |

Both moved rules measured **identically on two independent green runs** (the
pull-request run and the `main` push run), so they are not wobble. Every
other rule sits exactly on its baseline.

The consequence of leaving the baseline at 268/561 is that the gate has
**136 instances of slack** on a rule whose real count is 132 — a regression
of a hundred broken names would still pass.

To re-pin, a browser is needed, and a browser only exists on a runner or on
the maintainer's machine:

```bash
node scripts/check-a11y.mjs --update-baseline
```

Then restore the one noise-dominated rule, and only that one:

```
color-contrast: 4562 → 4561
```

`color-contrast` has been measured at 4546 (the gate's own comment records it
on the CI runner), 4562 (the `main` push run) and 4566 (both pull-request
runs). Its tolerance is 9, so leaving it at the **lower** number keeps the
full wobble inside the tolerance; pinning it to today's reading would move
the boundary of that tolerance by one instance for no benefit.

Verify with `node scripts/check-a11y.mjs` (no `--update`): it must report
*no accessibility rule regressed* and *nothing improved*.

**The pattern for doing this on a runner** is the one already used on
2026-11-10: add a one-shot job to the workflow that re-pins the baseline on
the branch, let it run, then remove the job (`e60253ab` → `06ea06ed`). The
`a11y A/B (one-shot)` workflow on `origin/ci/a11y-ab-20261117` is the
measurement-only sibling of that pattern and is stranded on a branch that can
never run it again (§6.3).

### 6.3 Stranded workflows

Two workflow files exist only on unmerged branches, where they can never run
again:

- `.github/workflows/presets-daily.yml` — on `origin/feat/score-evolution`,
  `origin/backup/*`, `origin/feat/downloads-snapshot-2026-09-11`. It
  **auto-commits generated presets to `main`**, which the ruleset refuses.
  If it is wanted, it has to be re-shaped into branch-and-PR; if it is not,
  the branches should be deleted.
- `.github/workflows/a11y-ab-20261117.yml` — on `origin/ci/a11y-ab-20261117`,
  triggered only by pushes to that branch. Its measurement scripts
  (`scripts/a11y-snapshot.mjs`, `scripts/a11y-diff.mjs`) live on that branch
  only. It served its purpose (proving the +4 was noise); it is now clutter.

Decide: land a corrected version, or delete the branches.

### 6.4 A media-budget entry for `color-tales`

`scripts/media-budget.mjs` has a `BUDGETS` map of per-directory limits, and
`color-tales` is not in it — so the 445 KB of source JPEGs that #309 would
ship would be invisible to the per-directory gate and would only surface as
pressure on the coarse global ceiling. Add the entry as part of #309's
rework, with the directory's real size.

---

## 7. Risks

- **The size budget is the binding constraint.** 181.1M of 182M. Three pull
  requests add bytes. Every merge in §4 is measured before the next one
  starts, and the ceiling is raised only deliberately, with the number in
  the commit message.
- **A stale base can revert `main`'s newer work silently.** #301's diff
  against `main` would remove eight distinct pieces of newer functionality.
  A rebase that "conflicts cleanly" is not the same as a rebase that is
  correct — the #301 checklist exists because of this.
- **A green dedicated workflow is not a green pull request.** #335 was green
  on `BeatCanvas validation` and had never run `main`'s gates at all.
- **The honesty gates punish optimistic claims.** #309's body said seven
  pages; the tree ships four. #334's own tests are not in the repo's gate
  groups. Both are the same failure: a claim that was never measured.
- **The a11y baseline currently has 136 instances of slack.** Until §6.2 is
  done, the gate would not catch a large regression on the rule that was just
  fixed.

---

## 8. Definition of done

The queue is consolidated when:

- [ ] No pull request is open that is superseded, empty, or conflicts with
      `main` — done for #308, #306, #321 and #328.
- [ ] Every remaining pull request merges with `check + verify + build-size`
      green **on a branch that is up to date with `main`**.
- [ ] Every test a pull request adds is wired into a `scripts/run-steps.mjs`
      group, so the repository's own gates run it.
- [ ] Every new surface is in `site-map.json`, so it appears in
      `sitemap.html` and the navigation and `check:dist-links` can see it.
- [ ] Every pull request body states its measured `dist/` size.
- [ ] `qa/a11y-baseline.json` reads the measured truth (132 / 542).
- [ ] `AGENTS.md` describes CI as it is.
- [ ] No workflow file exists only on a branch that can never run it.
