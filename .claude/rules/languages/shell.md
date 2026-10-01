---
description: "Shell Scripting Rules"
paths: ["**/*.sh", ".claude/hooks/**", ".claude/bin/**", ".claude/skills/*/scripts/**", "scripts/**", "src/hook/**/*.py"]
---

# Shell Scripting Rules

Scope: `.sh` files in `.claude/hooks/`, `.claude/skills/*/scripts/`, `.claude/bin/`, `scripts/`.

## Portability

The harness runs on macOS (BSD userland) and Linux (GNU userland). Shell scripts MUST work on both without requiring Homebrew packages such as `coreutils` (`grealpath`, `gsed`, …).

**[HARD] Do not use GNU-only flags in shell scripts.** Banned:

| GNU-only | Why banned | Portable alternative |
|----------|------------|----------------------|
| `realpath -m` | BSD `realpath` only supports `-q` | `realpath_portable` helper (python3 `os.path.realpath`) — see `.claude/skills/omb-wiki/scripts/wiki-summary.sh` |
| `realpath --` (end-of-options) | BSD `realpath` does not accept `--` | Quote the path argument; use the python3 helper for arbitrary inputs |
| `readlink -f` | BSD `readlink` does not support `-f` | Same `realpath_portable` helper |
| `sed -i <pattern>` (no backup arg) | BSD `sed -i` REQUIRES a backup suffix, even if empty | `sed -i '' <pattern>` on BSD or use `sed -i.bak <pattern>` everywhere and remove the backup; prefer `python3 -c` or `awk` for non-trivial edits |
| `date --iso-8601` | BSD `date` does not support long options | `date -u +%Y-%m-%dT%H:%M:%SZ` |
| `grep -P` (Perl regex) | Not universally supported on BSD | Rewrite with ERE (`grep -E`) or `awk` |

## Canonical path helper

For resolving paths that may not yet exist (the common `realpath -m` use case):

```bash
command -v python3 >/dev/null 2>&1 || {
    echo "Error: python3 not found on PATH — required for path canonicalization." >&2
    exit 1
}
realpath_portable() {
    python3 -c 'import os.path, sys; print(os.path.realpath(sys.argv[1]))' "$1"
}
```

Reference implementation: `.claude/skills/omb-wiki/scripts/wiki-summary.sh`.

## Project root resolution

All shell wrappers under `.claude/bin/` and `.claude/hooks/omb/` MUST resolve the project root via a **4-tier fallback chain**, never by trusting `${CLAUDE_PROJECT_DIR}` alone. Claude Code injects `CLAUDE_PROJECT_DIR` for lifecycle-hook invocations, but NOT for manual `bash` invocations, certain sub-agent Bash calls, or some worktree contexts. A wrapper that hard-fails on unset `CLAUDE_PROJECT_DIR` becomes unusable in those paths.

Canonical helper (copy verbatim into each wrapper):

```bash
resolve_project_dir() {
  local root gitdir
  # Tier 1: env (trusted; explicit override set by user or harness)
  if [[ -n "${CLAUDE_PROJECT_DIR:-}" && -d "${CLAUDE_PROJECT_DIR}" ]]; then
    printf '%s\n' "${CLAUDE_PROJECT_DIR}"; return 0
  fi
  # Tier 2: primary checkout root, via the COMMON git dir.
  # NOT --show-toplevel: inside a linked worktree that returns the *worktree*
  # path, so harness state (.omb/db/worktrees.db) gets created fresh and empty
  # under the worktree instead of read from the primary checkout.
  # --git-common-dir yields the primary checkout's .git in both cases
  # (relative ".git" at the primary root, absolute inside a linked worktree),
  # so dirname(realpath(...)) is the primary root either way.
  if gitdir=$(git rev-parse --git-common-dir 2>/dev/null) && [[ -n "$gitdir" ]]; then
    root=$(dirname "$(realpath_portable "$gitdir")")
    if [[ -n "$root" && -d "$root/.claude" ]]; then
      printf '%s\n' "$root"; return 0
    fi
  fi
  # Tier 3: script-relative + sanity check
  # Adjust the `../..` segment count to match the wrapper's depth from the project root:
  #   .claude/bin/X.sh        -> ../..
  #   .claude/hooks/omb/X.sh  -> ../../..
  root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)
  if [[ -n "$root" && -d "$root/.claude" ]]; then
    printf '%s\n' "$root"; return 0
  fi
  # Tier 4: last resort
  pwd
}
PROJECT_DIR=$(resolve_project_dir)
```

Rules:
- **[HARD] Tier 1 is contractual trust.** If `CLAUDE_PROJECT_DIR` is set AND the directory exists, use it as-is — even if it points to a different checkout than `git rev-parse` would find. Users and the harness set this env to override resolution intentionally.
- **[HARD] Tier 2 uses `--git-common-dir`, never `--show-toplevel`.** Inside a linked worktree, `--show-toplevel` returns the worktree path; every harness resolver treating that as the project root creates a *second* `.omb/db/worktrees.db` there and reads/writes state the primary checkout never sees. `--git-common-dir` returns the primary checkout's `.git` from both the primary tree and any linked worktree, so `dirname(realpath(...))` is the primary root in both. Tier 2 therefore depends on the `realpath_portable` helper defined above — copy both or neither.
- **[HARD] Tier 2/3 sanity check is mandatory.** Both must verify `[[ -d "$root/.claude" ]]` before accepting the candidate, so wrong-root candidates fall through to the next tier instead of being silently accepted.
- **[HARD] Use `printf '%s\n'`, not `echo`** — avoids `echo` escape-interpretation differences across shells.
- **[HARD] Use `${CLAUDE_PROJECT_DIR:-}`** (default expansion) — bare `${CLAUDE_PROJECT_DIR}` under `set -u` aborts when the variable is unbound.
- The Python equivalent lives in `src/hook/core/contract.py::resolve_project_dir()`; Python and shell paths MUST stay in sync — including the `--git-common-dir` choice and the `.claude` sanity check. Regression coverage: `tests/hooks/test_resolve_project_dir.py`.

This pattern has the same standing as the `realpath_portable` helper above — it is canonical, copy-paste verbatim, and not optional.

## Safety Defaults

Every script MUST start with:

```bash
#!/usr/bin/env bash
set -euo pipefail
```

- `-e`: exit on error
- `-u`: error on unset variables
- `-o pipefail`: exit code of a pipeline is the rightmost non-zero status

## Linting

- Run `shellcheck` on every shell script before committing.
- No unused variables, no quoting warnings, no masked return values.
