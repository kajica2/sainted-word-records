---
description: "Worktree Protocol (DB-Based)"
paths: [".omb/**", ".claude/skills/**", ".claude/agents/**", ".claude/rules/**"]
---

# Worktree Protocol (DB-Based)

All worktree lifecycle management goes through the SQLite DB at `.omb/db/worktrees.db`. The `omb-worktree` scripts are the canonical create/teardown mechanism; the `omb:worktree` skill is the active-worktree discovery interface.

## Architecture

```
omb:worktree (master skill)
  |
oh-my-braincrew CLI (WorktreeSetup / WorktreeTeardown / worktree-status / worktree-update)
  |
WorktreeDB (src/hook/db.py) — SQLite + git worktree operations
  |
.omb/db/worktrees.db (single source of truth)
```

## State Machine

```
IDLE --> PLAN --> PROGRESS --> DONE
 |                     |
 +-- (omb:clean) ------+--> DONE
```

| Status | Meaning | Transition Trigger |
|--------|---------|-------------------|
| `IDLE` | Worktree created, no plan yet | `omb:worktree create` |
| `PLAN` | Plan file exists | `omb:plan` completion |
| `PROGRESS` | Execution in progress | `omb:run` start |
| `DONE` | Completed or cleaned up | `omb:clean` or PR merge |

## HARD Rules

1. **[HARD] All state changes go through WorktreeDB** — never modify worktree state by filesystem inspection alone.
2. **[HARD] The `omb-worktree` scripts are the single create/teardown procedure** — `worktree-setup.sh` / `worktree-teardown.sh` are the canonical mechanism; skills invoke them directly (by path) or via `Skill('omb-worktree')`. Skills MUST NOT hand-roll `git worktree add` / `git checkout -b` or their own porcelain-parsing logic. Active-worktree discovery still goes through `Skill('omb-worktree') context`. Exception: ephemeral detached Herdr isolation worktrees, created and removed only by the `.claude/skills/omb-herdr/references/delegation.md` §2/§6 procedure, use `git worktree add --detach` / `git worktree remove` and that procedure's detached-entry check of `git worktree list --porcelain`; they are never registered and never carry a branch. Mechanism: that procedure's text plus the exception assertion in `tests/skills/test_herdr_delegation_contract.py::test_worktree_protocol_names_herdr_isolation_exception`.
3. **[HARD] DONE records are never deleted** — preserved for history tracking.
4. **[HARD] Never auto-merge** — always ask the user before merging worktree changes. Exception: Herdr isolation integration auto-applies only the delegate's own commits after result-contract step-3 reconciliation, because the user authorized it by starting a full delegation from a dirty checkout; ordinary worktree merges still ask. Mechanism: the same procedure's §5 isolated-integration guards plus that test.
5. **[HARD] Branch names must match convention** — `^(feat|fix|refactor|test|docs|chore|ci|perf|style|build)/[a-z0-9]+(-[a-z0-9]+)*$`.
6. **[HARD] Calling skills MUST check the exit code of `worktree-update`** — it is no longer unconditionally `OK`. A branch that is not registered in the resolved database exits **1** and prints `NOT_FOUND: branch <branch> not found in <db-path>` to stderr. Treat a non-zero exit as a real failure and surface it; never pipe it through `|| true`. The stderr line names the database on purpose: an unexpected path there means project-root resolution picked the wrong checkout (see `languages/shell.md` "Project root resolution").
7. **[HARD] Reconciling a record that may not exist requires a precondition check, not error suppression** — call `worktree-status` (or `omb-worktree context`) first and only issue `worktree-update` when the branch is present. This applies to `omb-clean`'s stale-record reconciliation after a Branch-Flow deletion, where the record is optional by design.

## Skill Integration

Every skill that supports worktree context MUST start with the sequence below, except `omb-run`, which first binds its plan identity and then filters `worktree-status` records before any checkout change.

```
Step 0: Worktree Context
  1. Invoke Skill("omb-worktree") with argument "context"
  2. Based on response:
     - Single active worktree -> cd into it, proceed
     - No active worktree -> work on main
     - Multiple -> If the current working directory is inside one of the active worktrees (path-component containment compared after `realpath` canonicalization of both the working directory and each `worktree_path`, longest `worktree_path` wins — a sibling like `{slug}-2` is never matched by `{slug}`), select that worktree without asking.
     -             When invoked with `--bypass` and the current working directory is inside none of the active worktrees, use the invocation checkout without asking.
     -             Otherwise the user chooses.
```

Skills update DB state after their work:

| Skill | Update Command |
|-------|---------------|
| `omb:plan` | `omb:worktree update <branch> --status PLAN --plan <file>` |
| `omb:run` | `omb:worktree update <branch> --status PROGRESS --todo <file>` |
| `omb:pr` | `omb:worktree update <branch> --pr <url>` |

See `workflow/07-worktree-scripts.md` for deterministic script contracts.

## SessionStart Recovery

`WorktreeRecoveryHandler` reads the DB on SessionStart and outputs recovery guidance:
- Lists all active worktrees (status != DONE)
- Suggests next action based on current status
- Includes PR URL if one was recorded

## CLI Commands

| Command | Purpose |
|---------|---------|
| `oh-my-braincrew WorktreeSetup <branch>` | Create worktree + DB record (IDLE) |
| `oh-my-braincrew WorktreeTeardown <branch> [--delete-branch]` | Remove worktree + mark DONE |
| `oh-my-braincrew worktree-status` | JSON dump of active worktrees |
| `oh-my-braincrew worktree-update <branch> --status X [--plan Y] [--todo Z] [--pr URL]` | Update DB fields. Exit 0 + `OK` when exactly the named branch was updated; **exit 1** + `NOT_FOUND: branch <b> not found in <db-path>` on stderr when no row matched (HARD rule #6). |

## DB Schema

File: `.omb/db/worktrees.db`

```sql
CREATE TABLE worktrees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch TEXT UNIQUE NOT NULL,
    worktree_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'IDLE',
    plan_file TEXT,
    todo_file TEXT,
    pr_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    description TEXT
);
```

WAL mode enabled for concurrent access safety.
