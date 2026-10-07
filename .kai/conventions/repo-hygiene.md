# Repo hygiene

How to clean this repo without losing work. Learned the hard way on 2026-10-07
(114 local branches, 97 remote, 20 worktrees, ~2 GB in worktree dirs).

## Branch cleanup — use CONTENT, not `git branch -d`

`git branch -d` compares a branch against its **upstream**. In this repo most
upstreams are stale, so `-d` reports fully-merged work as "not fully merged"
and refuses. It is not a safety net here; it is a false negative.

The correct test is content-in-`main`:

```bash
git rev-list --count origin/main..<branch>     # 0 = safe to delete
```

Measured on 2026-10-07: `-d` refused 3 branches (`feat/auto-pick-handoff`,
`feat/dashboard-gate-media-file`, `fix/portfolio-cache-bust`) that were **all**
fully in `main` — `git rev-list origin/main..<branch>` returned 0 for each.
A content-based pass then cleared 22 branches `-d` had left behind.

Procedure:
1. `git fetch origin main`
2. Build the deletable set: every local branch with `origin/main..<branch>` = 0.
3. **Exclude** branches checked out in a worktree (`git worktree list --porcelain`
   → `^branch`), `main`, and every open PR head (`gh pr list --state open`).
4. Re-check the count immediately before each delete, then `git branch -D`.

## Worktree cleanup — three conditions, all required

A worktree is safe to remove only when it is **merged + clean + stale**:

```bash
git merge-base --is-ancestor <branch> origin/main   # merged
git -C <wt> status --porcelain | wc -l              # 0 = clean
# newest file mtime > ~100h old = stale (no live agent)
git worktree remove <wt>                            # refuses a dirty tree
```

Measured 2026-10-07: 20 worktrees → 11. The 4 unmerged ones are real unfinished
work; 3 touched within 10 h are plausibly live agent sessions. Do not remove
either category.

**`node_modules` is usually a symlink** into the canonical repo
(`tools/worktree.sh sync-node`), so worktrees are not as heavy as they look.
Check with `[ -L <wt>/node_modules ]` before counting a worktree's cost.

## Disk

- `npm run clean` targets (`dist/`, `dist-dev/`, `.vite/`) are regenerable —
  including inside worktrees. `dist-dev/` alone was 211 MB.
- The repo itself is ~3.3 GB; the sibling worktree dirs
  (`~/Documents/swr-worktrees`, `.worktrees/`) add ~1.7 GB on top. Repo size and
  worktree size are separate accounts — do not quote one as the other.

## Pitfalls that produced wrong answers here

- **`git status | head`** truncates — a 25-file diff hid 10 unrelated modified
  files. Use the full output or `--porcelain | wc -l`.
- **`grep -c <pattern> <file>` counts matching LINES, not facts** — it returned
  a "hit" for `library.client.js` that was a *comment*, and for `personas` that
  was a title. Confirm a hit is what you think it is.
- **Globs match more than intended.** `swr-worktrees/*/*` matched worktree
  *subdirectories* (`main/dist`), producing a screenful of false "orphans".
  Compare absolute paths against `git worktree list --porcelain`.
- **Dot-directories are invisible to `glob`** (hidden: false) — `.kai/**`
  returned nothing while `.kai/` was fully populated.
