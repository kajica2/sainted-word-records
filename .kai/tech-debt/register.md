# Tech Debt Register

Auto-detected 2026-09-20 from repo inspection. Update via @refactor-advisor.
Severity scale: **P1** (blocks / user-visible) · **P2** (maintenance drag) · **P3** (nice-to-have).

---

## P1 — None detected on the current main

The current `main` (HEAD `811391a`) passes `npm run check` cleanly: syntax,
manifest, bundle, API unit, variant switcher, photo slideshow, default library,
dashboard. No CRITICAL/HIGH debt items observed.

---

## P2 — Maintenance Drag

### P2-001 — 12+ stale worktrees under `~/Documents/swr-worktrees/`

**Detected**: 2026-09-20.
**Evidence**: `git worktree list` shows 12 worktrees, 9 of which are feature
branches with 0 ahead of main (i.e. either fully merged or abandoned):
- `feat/music-video-hologram` — 0 ahead / 52 behind
- `feat/remove-demo-library` — 0 ahead / 45 behind
- `feat/shortcut-honesty` — 0 ahead / 59 behind
- `focus/current-versions-engine` — 0 ahead / 346 behind
- `sprint/2026-08-31` — 0 ahead / 437 behind
- plus `integration/worktree-merge-20260919` and the merged `backup/*` set

**Risk**: `git worktree list` output becomes noise; future branches may collide.
**Remediation**: prune worktrees whose `feat/<x>` is already in `main`. Keep
branches with ahead-commits (see P2-002). Don't `git worktree remove` until each
branch is confirmed merged or explicitly abandoned by the user.

### P2-002 — 4 feature branches with ahead-commits, none rebased on current main

**Detected**: 2026-09-20.
**Evidence**:
| Branch | Ahead | Behind main |
| --- | --- | --- |
| `feat/score-evolution` | 14 | 343 |
| `fix/desktop-overflow-tabs-fit` | 7 | 346 |
| `feat/agent-key-nudger` | 2 | 343 |
| `feat/auth-and-membership` | 1 | 343 |

**Risk**: rebases will be painful (300+ commits behind); merge conflicts likely.
**Remediation**: triage each branch — ship, archive, or rebase-and-resolve.
Suggested owner: user (Kai). See Kai's "go" prompt response from 2026-09-20.

### P2-003 — No `.kai/` project memory prior to 2026-09-20

**Detected**: 2026-09-20 (just initialized).
**Evidence**: `.kai/` directory did not exist before today. Pipeline runs were
not tracking prevention rules, tech-debt register, or ADR log.
**Risk**: repeated mistakes; new subagents re-learn conventions from scratch.
**Remediation**: initialized 2026-09-20. Future @postmortem and @refactor-advisor
runs should populate this register.

### P2-004 — 2 historical stashes, oldest unverified

**Detected**: 2026-09-20.
**Evidence**:
- `stash@{0}` — `feat/asset-curator: swr-assistant: stash before style-guide deploy 2026-09-12`
- `stash@{1}` — `tmp-merge-asset-curator-into-main: tmp-merge untracked from prior session, save before switching`

**Risk**: stash contents unknown; may hold work that was never committed.
**Remediation**: ask user before dropping either. Stash@{0} is likely superseded
by the style-guide-and-brand merge (`3fc8e54`); stash@{1} is from a temporary
merge branch.

---

## P3 — Nice-to-Have

### P3-001 — No CI on PR open

**Evidence**: `presets-daily.yml` is the only GitHub Action. `npm run check:full`
is local-only.
**Remediation**: add a `ci.yml` that runs `npm run check` on PR open + push to
non-main branches.

### P3-002 — Build size not enforced

**Evidence**: Build is ~66MB post-library-removal. No budget assertion in CI.
**Remediation**: when adding new asset-heavy features, snapshot build size in
`.vercel-build-size.json` and assert ≤ 80MB.

### P3-003 — Backup branches accumulating under `backup/*`

**Evidence**: 19 backup branches created during the 2026-09-19 worktree-merge sweep.
**Remediation**: prune after 30 days if not needed; or move off-repo to a
`backups/` archive tarball.

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