#!/usr/bin/env bash
# worktree-teardown.sh — Remove a git worktree and mark it DONE in the DB via the CLI.
# Usage: worktree-teardown.sh <branch> [--delete-branch]
#
# Output (always exits 0):
#   Success: PROJECT_ROOT=<abs>  TEARDOWN_STATUS=REMOVED
#   Failure: TEARDOWN_REASON=<reason>  TEARDOWN_STATUS=BLOCKED
#
# Portability: BSD + Linux. No GNU-only flags. python3 required for realpath.
# See .claude/rules/languages/shell.md for portability and resolver rules.
set -euo pipefail

# ---------------------------------------------------------------------------
# python3 / realpath_portable
# ---------------------------------------------------------------------------
command -v python3 >/dev/null 2>&1 || {
    printf 'TEARDOWN_REASON=python3-not-found\nTEARDOWN_STATUS=BLOCKED\n'
    exit 0
}

realpath_portable() {
    python3 -c 'import os.path, sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

# ---------------------------------------------------------------------------
# emit_blocked_td — print BLOCKED teardown result and exit 0.
# ---------------------------------------------------------------------------
emit_blocked_td() {
    printf 'TEARDOWN_REASON=%s\nTEARDOWN_STATUS=BLOCKED\n' "$1"
    exit 0
}

# ---------------------------------------------------------------------------
# resolve_project_dir — primary-worktree-aware 4-tier fallback.
#
# Same logic as worktree-setup.sh — kept in-file (no shared sourced file)
# per spec: each script is standalone.
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
#   worktree <expected_path>   (exact-line, no substring prefix confusion)
#   branch refs/heads/<branch> (within same block)
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

BRANCH="${1:-}"
DELETE_BRANCH_FLAG=""
if [[ "${2:-}" == "--delete-branch" ]]; then
    DELETE_BRANCH_FLAG="--delete-branch"
fi

if [[ -z "${BRANCH}" ]]; then
    emit_blocked_td "empty-branch"
fi

PROJECT_DIR=$(resolve_project_dir)
EXPECTED_PATH="${PROJECT_DIR}/worktrees/${BRANCH}"

# ---------------------------------------------------------------------------
# Invoke CLI with || true so a non-zero teardown exit does not abort before
# the verification step. Verification is the source of truth.
# Redirect stdout to /dev/null to keep our own stdout clean.
# ---------------------------------------------------------------------------
printf '{}' | "${PROJECT_DIR}/.claude/bin/omb-cli.sh" \
    WorktreeTeardown "${BRANCH}" ${DELETE_BRANCH_FLAG:+"${DELETE_BRANCH_FLAG}"} \
    >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# Post-CLI verification: confirm worktree is NO LONGER registered.
# ---------------------------------------------------------------------------
if worktree_is_registered "${PROJECT_DIR}" "${EXPECTED_PATH}" "${BRANCH}"; then
    emit_blocked_td "worktree-still-registered"
fi

# Return the primary project root so the caller can cd back to it.
PROJECT_ROOT=$(realpath_portable "${PROJECT_DIR}")
printf 'PROJECT_ROOT=%s\nTEARDOWN_STATUS=REMOVED\n' "${PROJECT_ROOT}"
