# Worktree Manager — multi-session isolation

> For: any session/agent running parallel work in `sainted-word-records`
> Tooling: `tools/worktree.sh`
> Worktree parent: `/Users/kaidejuricmasscmbook/Documents/swr-worktrees/`

## Why this exists

The repo has ~11 active feature branches from parallel Hermes sessions,
Claude Code agents, and Codex runs. Without isolation they collide on
uncommitted edits, shared `node_modules`/`.vite`, and a single vite
dev server. The worktree manager gives each session:

- its own directory (no cross-session file collisions)
- its own `node_modules` symlink (no 250MB install per spawn)
- its own branch checkout (clean slate per workstream)
- a single CLI for spawn/teardown so future agents don't reinvent it

## Commands

```bash
# from canonical repo
tools/worktree.sh ls                  # list current worktrees
tools/worktree.sh status              # show worktrees + orphaned branches
tools/worktree.sh add <branch>        # spawn at ../swr-worktrees/<branch>
tools/worktree.sh rm  <branch>        # remove worktree (branch stays)
tools/worktree.sh sync-node <branch>  # symlink node_modules from canonical
```

`add` fetches from `origin/<branch>` if the branch doesn't exist locally,
then `git worktree add` + symlink `node_modules` to canonical.

## Current worktree inventory (2026-09-11)

```
/Users/kaidejuricmasscmbook/Documents/sainted-word-records                         [feat/asset-curator]      ← primary
/Users/kaidejuricmasscmbook/Documents/swr-hologram                                 (detached HEAD)            ← pre-existing
/Users/kaidejuricmasscmbook/Documents/swr-worktrees/main                           [main]                    ← baseline
/Users/kaidejuricmasscmbook/Documents/swr-worktrees/feat-parallel-snapshot         [feat-parallel-snapshot]  ← Downloads dirty work
/Users/kaidejuricmasscmbook/Documents/swr-worktrees/feat/agent-key-nudger          [feat/agent-key-nudger]
/Users/kaidejuricmasscmbook/Documents/swr-worktrees/feat/auth-and-membership       [feat/auth-and-membership]
/Users/kaidejuricmasscmbook/Documents/swr-worktrees/feat/music-video-hologram      [feat/music-video-hologram]
/Users/kaidejuricmasscmbook/Documents/swr-worktrees/feat/score-evolution           [feat/score-evolution]
/Users/kaidejuricmasscmbook/Documents/swr-worktrees/fix/desktop-overflow-tabs-fit  [fix/desktop-overflow-tabs-fit]
/Users/kaidejuricmasscmbook/Documents/swr-worktrees/focus/current-versions-engine  [focus/current-versions-engine]
/Users/kaidejuricmasscmbook/Documents/swr-worktrees/sprint/2026-08-31              [sprint/2026-08-31]
```

## Conventions

- Each new workstream that lasts > 1 commit should get its own worktree.
- Single-shot fixes can stay on the canonical repo (`feat/asset-curator`).
- Don't run `npm install` in a worktree — `sync-node` instead. Saves ~250MB
  per spawn and avoids `node_modules` drift between worktrees.
- When tearing down, `tools/worktree.sh rm <branch>` — never `rm -rf` the
  directory, that bypasses git's worktree metadata.

## Out of scope (deferred)

- Auto-spawn-on-session-start hook. Current model: user/agent runs the
  add command explicitly when starting a new workstream.
- Per-session CLAUDE.md / Hermes config pointing at a specific worktree.
  Future agent context can be added by setting `cwd` to the worktree.
- Branch protection / pre-commit hooks per worktree. Currently all
  worktrees share the canonical repo's hooks.

## Artifacts

- `tools/worktree.sh` (135 LOC, bash)
- `/Users/kaidejuricmasscmbook/Documents/swr-worktrees/` (11 worktrees)
- `.hermes/plans/asset-curator-journal.mdl` (2026-09-12 entry documenting the capture)