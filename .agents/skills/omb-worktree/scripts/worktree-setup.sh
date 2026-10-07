#!/usr/bin/env bash
# worktree-setup.sh — Create a git worktree and register it in the DB via the CLI.
# Usage: worktree-setup.sh <branch> [description]
#
# Output (always exits 0):
#   Success:   WORKTREE_PATH=<abs>  WORKTREE_STATUS=READY
#   Idempotent: WORKTREE_PATH=<abs>  WORKTREE_NOTE=already-registered  WORKTREE_STATUS=READY
#   Failure:   WORKTREE_REASON=<reason>  WORKTREE_STATUS=BLOCKED
#
# Portability: BSD + Linux. No GNU-only flags. python3 required for realpath.
# See .claude/rules/languages/shell.md for portability and resolver rules.
set -euo pipefail

# ---------------------------------------------------------------------------
# python3 / realpath_portable
# ---------------------------------------------------------------------------
command -v python3 >/dev/null 2>&1 || {
    printf 'WORKTREE_REASON=python3-not-found\nWORKTREE_STATUS=BLOCKED\n'
    exit 0
}

realpath_portable() {
    python3 -c 'import os.path, sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

# ---------------------------------------------------------------------------
# emit_blocked — print BLOCKED result and exit 0 (always-exit-0 contract).
# The calling skill parses WORKTREE_STATUS=BLOCKED as a stop signal.
# ---------------------------------------------------------------------------
emit_blocked() {
    printf 'WORKTREE_REASON=%s\nWORKTREE_STATUS=BLOCKED\n' "$1"
    exit 0
}

# ---------------------------------------------------------------------------
# resolve_project_dir — primary-worktree-aware 4-tier fallback.
#
# Tier 1: CLAUDE_PROJECT_DIR env (contractual trust — see shell.md).
# Tier 2: git --git-common-dir (worktree-safe: linked worktrees share the
#          common .git dir of the primary checkout; --show-toplevel returns
#          the *worktree* path, which would nest worktrees). The primary root
#          is dirname(realpath(git-common-dir)).
# Tier 3: script-relative ../../../../ (4 levels: scripts/omb-worktree/
#          skills/.claude/<root>).
# Tier 4: pwd (last resort).
# ---------------------------------------------------------------------------
resolve_project_dir() {
    local root gitdir gitdir_abs

    # Tier 1: env override (trusted)
    if [[ -n "${CLAUDE_PROJECT_DIR:-}" && -d "${CLAUDE_PROJECT_DIR}" ]]; then
        printf '%s\n' "${CLAUDE_PROJECT_DIR}"; return 0
    fi

    # Tier 2: git common dir (primary-worktree-aware)
    if gitdir=$(git rev-parse --git-common-dir 2>/dev/null) && [[ -n "${gitdir}" ]]; then
        gitdir_abs=$(realpath_portable "${gitdir}")
        root=$(dirname "${gitdir_abs}")
        if [[ -n "${root}" && -d "${root}/.claude" ]]; then
            printf '%s\n' "${root}"; return 0
        fi
    fi

    # Tier 3: script-relative (depth 4: scripts/ -> omb-worktree/ -> skills/ -> .claude/ -> root)
    root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." 2>/dev/null && pwd)
    if [[ -n "${root}" && -d "${root}/.claude" ]]; then
        printf '%s\n' "${root}"; return 0
    fi

    # Tier 4: last resort
    pwd
}

# ---------------------------------------------------------------------------
# worktree_is_registered <project_dir> <expected_path> <branch>
# Returns 0 (true) when git worktree list --porcelain shows BOTH:
#   worktree <expected_path>   (exact-line match, no substring prefix confusion)
#   branch refs/heads/<branch> (within the same block)
# Uses POSIX awk — no grep -F, no grep -P.
# ---------------------------------------------------------------------------
worktree_is_registered() {
    local project_dir="$1"
    local expected_path="$2"
    local branch="$3"

    git -C "${project_dir}" worktree list --porcelain 2>/dev/null | \
    awk -v wpath="${expected_path}" -v bname="${branch}" '
        /^worktree / {
            cur = substr($0, 10)
            found_branch = 0
            next
        }
        /^branch / {
            bval = substr($0, 8)
            if (bval == "refs/heads/" bname) {
                found_branch = 1
            }
        }
        /^$/ {
            if (cur == wpath && found_branch) {
                exit 0
            }
            cur = ""
            found_branch = 0
        }
        END {
            # Last block may not end with blank line
            if (cur == wpath && found_branch) {
                exit 0
            }
            exit 1
        }
    '
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# Argument validation
BRANCH="${1:-}"
DESC="${2:-}"

if [[ -z "${BRANCH}" ]]; then
    emit_blocked "empty-branch"
fi

# Mirror _BRANCH_PATTERN from src/hook/db.py
# ^(feat|fix|refactor|test|docs|chore|ci|perf|style|build)/[a-z0-9]+(-[a-z0-9]+)*$
if ! printf '%s' "${BRANCH}" | grep -qE \
    '^(feat|fix|refactor|test|docs|chore|ci|perf|style|build)/[a-z0-9]+(-[a-z0-9]+)*$'; then
    emit_blocked "invalid-branch-format"
fi

PROJECT_DIR=$(resolve_project_dir)
EXPECTED_PATH="${PROJECT_DIR}/worktrees/${BRANCH}"

# ---------------------------------------------------------------------------
# Ancestor-symlink gate: reject a symlinked ancestor of EXPECTED_PATH
# (e.g. a symlinked worktrees/ or worktrees/<type>/) before anything is
# created. lstat-based walk, no omb-herdr dependency. Mirrors
# .claude/skills/omb-herdr/scripts/herdr_isolation.py `ancestors`.
# See .claude/rules/languages/shell.md for portability rules.
# ---------------------------------------------------------------------------
if ! ANCESTOR=$(python3 -c 'import os, stat, sys
root, target = sys.argv[1], sys.argv[2]
cur = root
for part in os.path.relpath(target, root).split(os.sep):
    cur = os.path.join(cur, part)
    try:
        mode = os.lstat(cur).st_mode
    except FileNotFoundError:
        break
    if stat.S_ISLNK(mode):
        print(os.path.relpath(cur, root))
        break' "${PROJECT_DIR}" "${EXPECTED_PATH}" 2>/dev/null); then
    emit_blocked "ancestor-check-failed"
fi
if [[ -n "${ANCESTOR}" ]]; then
    emit_blocked "ancestor-symlink:${ANCESTOR}"
fi

# ---------------------------------------------------------------------------
# Idempotency probe: if already registered, return READY without re-invoking CLI.
# ---------------------------------------------------------------------------
if worktree_is_registered "${PROJECT_DIR}" "${EXPECTED_PATH}" "${BRANCH}"; then
    ABSPATH=$(realpath_portable "${EXPECTED_PATH}")
    printf 'WORKTREE_PATH=%s\nWORKTREE_NOTE=already-registered\nWORKTREE_STATUS=READY\n' \
        "${ABSPATH}"
    exit 0
fi

# ---------------------------------------------------------------------------
# Invoke CLI (set -e-safe: capture output; route failure to emit_blocked).
# Pipe '{}' as stdin so the CLI does not block waiting for stdin.
# Stdout is captured into $out — not streamed — so the RESULT block on our
# own stdout is the only output the caller sees.
# ---------------------------------------------------------------------------
if ! out=$(printf '{}' | "${PROJECT_DIR}/.claude/bin/omb-cli.sh" \
        WorktreeSetup "${BRANCH}" ${DESC:+"${DESC}"} 2>&1); then
    emit_blocked "cli-failed: $(printf '%s' "${out}" | tail -1)"
fi

# ---------------------------------------------------------------------------
# Post-CLI verification: confirm real porcelain registration.
# A bare directory existing is NOT sufficient (plan gotcha #1).
# ---------------------------------------------------------------------------
if ! worktree_is_registered "${PROJECT_DIR}" "${EXPECTED_PATH}" "${BRANCH}"; then
    emit_blocked "registration-not-verified"
fi

ABSPATH=$(realpath_portable "${EXPECTED_PATH}")
printf 'WORKTREE_PATH=%s\nWORKTREE_STATUS=READY\n' "${ABSPATH}"
