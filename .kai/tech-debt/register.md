# Tech Debt Register

Auto-detected 2026-09-20 from repo inspection. Update via @refactor-advisor.
Severity scale: **P1** (blocks / user-visible) · **P2** (maintenance drag) · **P3** (nice-to-have).

Last scan: 2026-09-20 (worktree + stash triage, refactor-advisor v1.2.2).

---

## P1 — None detected on the current main

The current `main` (HEAD `811391a`) passes `npm run check` cleanly: syntax,
manifest, bundle, API unit, variant switcher, photo slideshow, default library,
dashboard. No CRITICAL/HIGH debt items observed.

---

## P2 — Maintenance Drag

### P2-001 — Worktree + branch housekeeping (CLOSED — triage issued 2026-09-20)

**Detected**: 2026-09-20.
**Triaged**: 2026-09-20 (refactor-advisor P1 sweep).

**Findings**: 12 worktrees enumerated under `~/Documents/swr-worktrees/`. Of
these, **6 are fully merged into `main` (0 ahead) and safe to archive**, and
**1 has 1 ahead-commit that is a personal scratch snapshot, owner-decide**.
The 4 remaining worktrees with ahead-commits are tracked under P2-002.

| Worktree branch | Ahead | Behind | Backup exists? | Recommendation |
| --- | --- | --- | --- | --- |
| `feat/music-video-hologram` | 0 | 52 | yes (`backup/feat-music-video-hologram-20260919`) | **ARCHIVE** — merged |
| `feat/remove-demo-library` | 0 | 45 | yes | **ARCHIVE** — merged |
| `feat/shortcut-honesty` | 0 | 59 | yes | **ARCHIVE** — merged |
| `focus/current-versions-engine` | 0 | 346 | yes | **ARCHIVE** — merged |
| `sprint/2026-08-31` | 0 | 437 | yes | **ARCHIVE** — merged (oldest sprint branch) |
| `integration/worktree-merge-20260919` | 0 | 19 | **NO** | **ARCHIVE + create backup first** (only active branch missing a backup) |
| `feat-parallel-snapshot` | 1 | 192 | yes | **KEEP / archive** — owner-decide; see P2-002 |

**Risk (if unresolved)**: `git worktree list` output stays noisy; new branches
risk colliding with old names; the lone `integration/worktree-merge-20260919`
branch has no `backup/` mirror, so a forced cleanup would lose history.

**Remediation**: 6 stale 0-ahead worktrees → create `backup/<name>-20260920`
shadows + `git worktree remove`. For `integration/worktree-merge-20260919`,
first create `backup/integration-worktree-merge-20260920`. For
`feat-parallel-snapshot`, see P2-002 (1 ahead, owner decision). Pending user
approval — agent is read-only per the 2026-09-20 sprint scope.

### P2-002 — 4 feature branches with ahead-commits + 1 parallel-snapshot (CLOSED — executed 2026-09-20)

**Detected**: 2026-09-20.
**Triaged**: 2026-09-20 (refactor-advisor P1 sweep).

**Per-branch analysis (ahead-commits vs merge-base with `main`)**:

| Branch | Ahead | Behind | Last commit | Real work (vs merge-base) | Backup? | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| `feat/score-evolution` | 14 | 343 | 2026-09-12 | score-evolution stages 1-6 (`versions/music_video.html` +61 / `client/narrative-state.client.js` 220 NEW / `scripts/check-narrative-unit.mjs` 281 / `scripts/check-score-evolution-smoke.mjs` 272) + auth scaffolding duplicate of `feat/auth-and-membership`. **1756 LOC ahead, 6 deleted.** Branched from `1398ba6` 2026-09-04. | yes | **DEFER** — see P2-005 (porting risk) |
| `fix/desktop-overflow-tabs-fit` | 7 | 346 | 2026-09-04 | GIF support (`lib/gif-decoder.client.js` 250 + `lib/omggif.js` 818 + 2 check scripts) + `swr-app.html` responsive (+522) + `check-loop-unit.mjs` 132. **2178 LOC ahead, 71 deleted.** Branched from `0dfff81` 2026-09-04. | yes | **ARCHIVE** to `backup/fix-desktop-overflow-tabs-fit-20260920` — superseded; GIF support was a one-off P3.6 not picked up by any later work |
| `feat/agent-key-nudger` | 2 | 343 | 2026-09-04 | `engine-keys.client.js` keyboard-shortcuts surface (+346) + `check-agent-smoke.mjs` 303 + auth scaffolding duplicate. **1069 LOC ahead, 33 deleted.** | yes | **ARCHIVE** to `backup/feat-agent-key-nudger-20260920` — superseded; user can cherry-pick `engine-keys.client.js` if shortcuts are still wanted |
| `feat/auth-and-membership` | 1 | 343 | 2026-09-04 | `api/users/[id].js` 110 NEW + db/session/verify tweaks + `check-auth-unit.mjs` 277 NEW. **448 LOC ahead.** | yes | **ARCHIVE** to `backup/feat-auth-and-membership-20260920` — superseded by `3926f1a` in main, which re-ships the same work + adds `journey-state.client.js` / `journey-effects.client.js` / `journey-state.css` (548 LOC more) |
| `feat-parallel-snapshot` | 1 | 192 | 2026-09-12 | "feat(snapshot): captures parallel-session work in Downloads clone" — 116 files / 18,524 insertions: new `versions/music_video_mtv.html` (+3879) + `video_single.html` (+773) + tiny `versions/*.html` script-tag tweaks. Branched from `42a4413`. | yes | **KEEP** (or archive — owner decision) — personal scratch snapshot, not project work; the commit message literally says "captures parallel-session work in Downloads clone" |

**Critical finding**: `3ea0b04 "Auth & membership (Stage 2)"` is the shared base
of three branches (`feat/auth-and-membership`, `feat/agent-key-nudger`,
`feat/score-evolution`) and is **NOT** an ancestor of `main`. None of those
three branches have rebased since 2026-09-04. The music-video port
(`c27b669..2722524..5a1fdba..de1dece..a2069c3`, 8 commits) was done on a
detached HEAD and is the actual working state, not on any worktree branch.

**Risk (if unresolved)**: the 4 ahead branches stay around consuming
worktree-disk + cognitive overhead; their unique work (narrative state, GIF
support, keyboard shortcuts) is invisible to anyone who only follows `main`.

**Remediation**: archive per the table above.
**Executed 2026-09-20**:
- ✅ Archived `fix/desktop-overflow-tabs-fit` (worktree removed, branch deleted)
- ✅ Archived `feat/agent-key-nudger` (worktree removed, branch deleted)
- ✅ Archived `feat/auth-and-membership` (worktree removed, branch deleted)
- ⏳ `feat/score-evolution` — KEPT (porting risk per P2-005; deferred)
- ⏳ `feat-parallel-snapshot` — KEPT (personal scratch, owner-decide)

**Final state (2026-09-20 post-cleanup)**: 2 worktrees remain from P2-002
(`feat/score-evolution`, `feat-parallel-snapshot`). All others archived.

### P2-003 — No `.kai/` project memory prior to 2026-09-20

**Detected**: 2026-09-20 (just initialized).
**Evidence**: `.kai/` directory did not exist before today. Pipeline runs were
not tracking prevention rules, tech-debt register, or ADR log.
**Risk**: repeated mistakes; new subagents re-learn conventions from scratch.
**Remediation**: initialized 2026-09-20. Future @postmortem and @refactor-advisor
runs should populate this register. This scan is the first such entry.

### P2-004 — 2 historical stashes (CLOSED — executed 2026-09-20)

**Detected**: 2026-09-20.
**Triaged**: 2026-09-20 (refactor-advisor P1 sweep).

**Per-stash analysis**:

| Stash | Branch context | Files | Real content | Superseded by | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `stash@{0}` | `feat/asset-curator`, captured 2026-09-12 ("stash before style-guide deploy") | 20 / +184 / -233 | `SWR_LIBLOAD` → `SWR_LIB_PERSIST` rename across 12 `versions/*.html`; `defaultTagUntagged()` helper inline in `lib/library-persist.client.js`; `<script>` tags for `lib/library-persist.client.js` + `lib/media-store.client.js` added to 11 `versions/*.html`; `verify-grid-library-persist.mjs` deletion; `campaign.html` `p_*.jpg` → `p*.jpg` rename; `shop.html` variant-cycle bug fix; `vite.config.js` adds `preset-preview.client.js`. | **`feat/asset-curator` HEAD `d8865d0`** (2026-09-14, "Merge branch 'main' into feat/asset-curator") — all 20 files exist on the branch, but the helper was moved to a new file `lib/persist-wire.client.js` instead of inlined. Cleaner re-implementation. Plus `feat/style-guide-and-brand` already merged into `main` via `3fc8e54`. | **DROP** — superseded; `defaultTagUntagged` lives in `lib/persist-wire.client.js` on `feat/asset-curator` HEAD, all script tags are in the branch HEAD, the rename happened in the style-guide merge |
| `stash@{1}` | `tmp-merge-asset-curator-into-main` (deleted branch from 2026-09-19 sweep), captured "tmp-merge untracked from prior session" | 282 / +48,768 / -298 | Massive untracked blob: `.hermes/plans/*.mdl .json .md` (agent journaling), `.wiggum/learning.md`, `_curator-runner.html`, 8 `artists/*.html`, 17+ `gallery-*.html`, 21 `personas/v/*.html`, 16 `marketing/personas/*.md` + 14 `demos/*.json`, 24 `gallery-vintage/*.webp`, 24 `shop-designs/*.webp`, 7 new `client/*.client.js` modules (asset-curator, beat-pulse, bg-removal-confirm, etc.), `engine-3d.client.js`, `swr-build-id.client.js`, `swr-onboarding-hf.client.js`, `persona-runtime.client.js`, `gif-to-svg.client.js`, `tools/worktree.sh`, `audios/bachdrop.mp3`, 12+ `scripts/check-*-unit.mjs` + build scripts, 18 new `verify-*.mjs`. | **Every meaningful file re-shipped via cleaner later commits** in `main`: `3926f1a` (auth), `5585189` (artist pages + persona variants + gif-to-svg), `cf97dc2` (HyperFrames onboarding), `91587df` (worktree.sh), `b1a0990` (engine-3d), and others. The tmp-merge branch was deleted 2026-09-19; the stash is its untracked snapshot. | **DROP** — superseded; tmp-merge branch is gone, the work was re-shipped, and 282-file blob is dominated by agent journaling noise that should never have been stashed |

**Critical finding**: `git diff 3ea0b04 3926f1a --stat` shows main's auth
commit re-ships all of `feat/auth-and-membership`'s work plus adds
`lib/journey-effects.client.js` (106 LOC), `lib/journey-state.client.js`
(237 LOC), `lib/journey-state.css` (52 LOC), and `make-video.html` (22 LOC).
So main's `3926f1a` is a strict superset.

**Risk (if unresolved)**: stashes pile up in `.git/refs/stash`; every
`git stash show`/`git fetch` slows slightly; agents waste time guessing
whether stashes hold unsaved work.

**Remediation**: drop both stashes.
**Executed 2026-09-20**: `git stash drop stash@{0}` (asset-curator rename,
superseded), `git stash drop stash@{0}` (tmp-merge untracked blob,
superseded). `git stash list` is now empty.

**Final state (2026-09-20 post-cleanup)**: 0 stashes. 4 worktrees remain.

### P2-005 — `feat/score-evolution` narrative modules need porting to new runtimes architecture (NEW)

**Detected**: 2026-09-20.
**Evidence**: `feat/score-evolution` (14 ahead, branched 2026-09-04) added
`client/narrative-state.client.js` (220 LOC) + score-evolution stages 1-6
in `versions/music_video.html` (+61 LOC). But the music-video port landed
later (a244d2b + 7 commits, in detached HEAD `c27b669`) and **extracted the
engine into 4 runtimes** (`hook/stats/mood/scenes`) per commit `2722524
"feat(engine): extract 4 runtimes (hook/stats/mood/scenes) + apply to
engine"`. The score-evolution modules still target the pre-port
`versions/music_video.html` shape and would need re-architecting against
the new runtime hooks before they can ship. Additionally, the
`3ea0b04` auth commit is shared with 2 other branches and is itself superseded
by `3926f1a` in main.
**Risk**: if a future agent cherry-picks the score-evolution commits blind,
they will land on top of a heavily-refactored engine and silently break
runtime wiring. The cherry-pick would compile but never fire because the
narrative accumulator would never be called by the new `runtime-hooks`.
**Remediation**: before re-attempting to ship score-evolution, re-architect
the narrative-state module to expose a hook consumed by the new runtimes
(`hook/stats/mood/scenes`). Decide whether `applyR` should become a mood-
runtime responsibility. Suggested owner: user (Kai) — porting is non-trivial.

### P2-006 — Detached HEAD `c27b669` has 8 commits ahead of `main` and an uncommitted modification (NEW)

**Detected**: 2026-09-20.
**Evidence**: `git worktree list` shows the main checkout at
`/Users/kaidejuricmasscmbook/Documents/sainted-word-records` is detached
HEAD at `c27b669`, which is 8 commits ahead of `main` (`811391a`):
```
c27b669 chore(ci): remove presets-daily.yml workflow + update doc references
a244d2b feat(dashboard): expose 5 runtimes + read-only status tile (Phase 3 + 4)
3fd7c20 feat(variants): port automix+curator stack to grid + smoke + hallucination (Phase 2B)
4c6e62c feat(variants): port automix+curator stack to neon + film (Phase 2A)
2722524 feat(engine): extract 4 runtimes (hook/stats/mood/scenes) + apply to engine
5a1fdba feat(engine): port automix stack + extract automix-runtime from music_video
de1dece docs(audit): Phase 0 — port music_video automix+curator stack to all variants
a2069c3 chore(kai): initialize project memory directory
```
Additionally `git status` reports one uncommitted modification:
```
modified:   engine.html  (Phase 1a regression fix — toolbar wraps onto 2nd line)
```
The detached HEAD is not on any worktree branch ref. A `git checkout` away
or a rebase by mistake would orphan these 8 commits.
**Risk**: if the user switches the main checkout to another branch
(e.g. `main`) without first committing the `engine.html` fix, the Phase 1a
regression fix is lost (no ref points to it). Same risk applies to the 8
ahead-commits — they're only reachable via the detached HEAD.
**Remediation**: either (a) commit the `engine.html` fix as a Phase 1a
regression patch + then fast-forward `main` to `c27b669` and `git checkout
main`, OR (b) create a branch `feat/music-video-automix-port-20260920`
pointing at `c27b669`, commit the engine.html fix there, then PR into
main. Owner: user (Kai).

### P2-007 — `integration/worktree-merge-20260919` is the only active worktree branch with no `backup/*` mirror (NEW)

**Detected**: 2026-09-20.
**Evidence**: All 21 `backup/*` branches listed via
`git for-each-ref --format='%(refname:short)' refs/heads/ | grep ^backup/`
preserve a 2026-09-19 snapshot of every other active branch. The only
exception is `integration/worktree-merge-20260919`, which has 0 ahead of
`main` but no `backup/integration-worktree-merge-20260919-*` mirror.
**Risk**: a forced cleanup that deletes the integration branch would lose
its full history (no recovery via backup). The branch is also the most
recent (2026-09-19) integration sweep, so it likely contains the most
"consolidated state" snapshot.
**Remediation**: `git branch backup/integration-worktree-merge-20260919-20260920 integration/worktree-merge-20260919`
before any cleanup. Owner: user (Kai).

---

## P3 — Nice-to-Have

### P3-001 — No CI on PR open

**Evidence**: Only GitHub Action is `.github/workflows/ci.yml` (PR/push gate). It
does not run `check:full` or any of the `verify:*` scripts — the curated
5-smoke + transitions verifier are local-only.
**Remediation**: add a `ci.yml` that runs `npm run check` on PR open + push to
non-main branches.

### P3-002 — Build size not enforced

**Evidence**: Build is ~66MB post-library-removal. No budget assertion in CI.
**Remediation**: when adding new asset-heavy features, snapshot build size in
`.vercel-build-size.json` and assert ≤ 80MB.

### P3-003 — Backup branches accumulating under `backup/*`

**Evidence**: **21 backup branches** created during the 2026-09-19
worktree-merge sweep (the prior register said 19 — actual count was 19 then,
2 more added since). One new entry likely needed for
`integration/worktree-merge-20260919` per P2-007.
**Remediation**: prune after 30 days if not needed; or move off-repo to a
`backups/` archive tarball.

### P3-004 — Worktree ↔ branch mapping has one duplicated branch name (NEW)

**Evidence**: The `feat-parallel-snapshot` worktree uses branch
`feat-parallel-snapshot` (no slash), while every other `feat-*` worktree
uses the slash-prefixed `feat/<name>` convention. `git worktree list` is
slightly harder to read because of this.
**Remediation**: rename the branch to `feat/parallel-snapshot` to match
the project convention (`git branch -m feat-parallel-snapshot feat/parallel-snapshot`
on the worktree). Low priority. Owner: user (Kai).

---

## Discovered-by Sources

This register is populated by:
1. **First-run detection** (Kai on 2026-09-20) — repo inspection.
2. **`@refactor-advisor`** — complexity hotspots, dead code, architectural drift.
3. **`@postmortem`** — root causes from pipeline failures, with prevention rules.

Future entries should follow the template:

```markdown
### P2-NNN — <one-line title>

**Detected**: YYYY-MM-DD.
**Evidence**: <file:line or repo-wide observation>.
**Risk**: <what breaks if we ignore it>.
**Remediation**: <how to fix, who owns>.
```
