---
description: "Worktree deterministic scripts — RESULT-block contract, scope, and DB invariants"
paths: [".omb/**", ".claude/skills/**", ".claude/agents/**", ".claude/rules/**"]
---

# Worktree Deterministic Scripts

Covers: Deterministic Scripts

See `workflow/INDEX.md` for the full topic index.

## Deterministic Scripts

Three shell scripts serve as canonical, always-exit-0 implementations. Callers branch on the STATUS key in the RESULT block, never on `$?`.

The first two live under `.claude/skills/omb-worktree/scripts/` and wrap the WorktreeDB CLI (HARD rule #1 is preserved). The third is owned by `omb-clean` and operates on plain branches only — it intentionally does NOT touch WorktreeDB (HARD rule #2 covers worktree create/teardown only).

### Script paths and arguments

| Script | Owner | Arguments |
|--------|-------|-----------|
| `.claude/skills/omb-worktree/scripts/worktree-setup.sh` | `omb-worktree` | `<branch> [description]` |
| `.claude/skills/omb-worktree/scripts/worktree-teardown.sh` | `omb-worktree` | `<branch> [--delete-branch]` |
| `.claude/skills/omb-clean/scripts/branch-teardown.sh` | `omb-clean` | `<branch> [--check-only] [--pr-merged-head <sha>] [--force]` |

### RESULT-block contract

Both scripts print a machine-parseable RESULT block on stdout. Callers MUST read this output and branch on the status key. Exit code is always 0.

**worktree-setup.sh — success:**

```
WORKTREE_PATH=<absolute-path>
WORKTREE_STATUS=READY
```

Idempotent re-run (worktree already registered) additionally prints:

```
WORKTREE_NOTE=already-registered
```

**worktree-setup.sh — failure:**

```
WORKTREE_REASON=<reason>
WORKTREE_STATUS=BLOCKED
```

**worktree-teardown.sh — success:**

```
PROJECT_ROOT=<absolute-path>
TEARDOWN_STATUS=REMOVED
```

**worktree-teardown.sh — failure:**

```
TEARDOWN_REASON=<reason>
TEARDOWN_STATUS=BLOCKED
```

**branch-teardown.sh — RESULT contract (8 keys, always exit 0):**

```
BRANCH_TEARDOWN_STATUS=REMOVED|BLOCKED|CHECKED
BRANCH_TEARDOWN_REASON=<reason>           # present only when BLOCKED
PROJECT_ROOT=<absolute-path>
DEFAULT_BRANCH=<branch>
CURRENT_BRANCH=<branch>|DETACHED
MERGE_STATUS=ancestry-merged|not-merged   # present only when CHECKED or REMOVED
CHECKOUT_PERFORMED=true|false
DELETED_VIA=safe|pr-evidence|force        # present only when REMOVED
```

`BRANCH_TEARDOWN_STATUS` values:
- `REMOVED` — branch deleted successfully; `DELETED_VIA` indicates how deletion was authorized.
- `BLOCKED` — deletion refused (e.g., not merged, protected branch, branch is currently checked out); `BRANCH_TEARDOWN_REASON` explains why.
- `CHECKED` — `--check-only` mode; branch was inspected but not deleted; `MERGE_STATUS` reports the ancestry result.

Scope and constraints:
- Handles **plain git branches only** — no git worktree operations, no WorktreeDB reads or writes.
- Protected branches (`main`, `master`, `develop`, `release/*`, `hotfix/*`) are always `BLOCKED`, regardless of flags.
- `--pr-merged-head <sha>` is validated by comparing the full 40-character `headRefOid` against the local branch tip — a partial SHA match is insufficient.
- `--force` skips merge checks but still refuses protected branches.
- HARD rule #2 (`omb-worktree` scripts are the single worktree create/teardown procedure) does **not** apply here — `branch-teardown.sh` is outside that scope by design.

### Calling skill responsibilities

- Branch on `WORKTREE_STATUS` / `TEARDOWN_STATUS` / `BRANCH_TEARDOWN_STATUS`, never on exit code.
- `WORKTREE_STATUS=BLOCKED` or `TEARDOWN_STATUS=BLOCKED` → the calling skill MUST emit `<omb>BLOCKED</omb>` and surface `WORKTREE_REASON` / `TEARDOWN_REASON` in the result envelope's `blockers:` field.
- `BRANCH_TEARDOWN_STATUS=BLOCKED` → the calling skill MUST emit `<omb>BLOCKED</omb>` and surface `BRANCH_TEARDOWN_REASON` in the result envelope's `blockers:` field.

### Real-registration verification

Setup success requires passing both of the following checks against `git worktree list --porcelain` output:

1. A line matching `worktree <absolute-path>` for the new worktree.
2. A line matching `branch refs/heads/<branch>` within the same worktree block.

A plain `git branch` entry combined with a stray directory does NOT satisfy the verification — only porcelain confirmation of both the path and the `refs/heads/` branch reference is sufficient. This is the load-bearing safeguard against phantom registrations.

### DB invariants

The scripts invoke `oh-my-braincrew WorktreeSetup` / `oh-my-braincrew WorktreeTeardown` via `.claude/bin/omb-cli.sh`. All WorktreeDB state changes therefore still go through the CLI (HARD rule #1), and DONE records are never deleted (HARD rule #3).

### Model responsibilities

The model still owns two things the scripts cannot do:

- **`{type}` inference** — inferring the correct branch type prefix (`feat`, `fix`, etc.) from the task context before calling the script.
- **Working directory** — a subshell cannot change the parent CWD; after setup succeeds, the model must issue a single `cd <WORKTREE_PATH>` to switch context.
