#!/usr/bin/env bash
# branch-teardown.sh — Delete a plain (non-worktree) git branch safely.
# Usage: branch-teardown.sh <branch> [--check-only] [--pr-merged-head <sha>] [--force]
#
# Output (always exits 0): a RESULT block of KEY=VALUE lines:
#   BRANCH_TEARDOWN_STATUS=REMOVED|BLOCKED|CHECKED
#   BRANCH_TEARDOWN_REASON=<only when BLOCKED>
#   PROJECT_ROOT=<resolved MAIN repo root>
#   DEFAULT_BRANCH=<detected default branch>
#   CURRENT_BRANCH=<HEAD branch; literal DETACHED when detached>
#   MERGE_STATUS=ancestry-merged|not-merged
#   CHECKOUT_PERFORMED=true|false
#   DELETED_VIA=safe|pr-evidence|force   # only when REMOVED
#
# Portability: BSD + Linux. No GNU-only flags. python3 required for realpath.
# See .claude/rules/languages/shell.md for portability and resolver rules.
#
# Every git verdict command is if-guarded or `|| true`-captured so `set -e`
# can NEVER kill the script without first emitting a RESULT block via
# emit_blocked_bt().
set -euo pipefail

# ---------------------------------------------------------------------------
# python3 / realpath_portable
# ---------------------------------------------------------------------------
command -v python3 >/dev/null 2>&1 || {
    printf 'BRANCH_TEARDOWN_REASON=python3-not-found\nBRANCH_TEARDOWN_STATUS=BLOCKED\n'
    exit 0
}

realpath_portable() {
    python3 -c 'import os.path, sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

# ---------------------------------------------------------------------------
# emit_blocked_bt — print BLOCKED result (with optional known fields) and exit 0.
# Usage: emit_blocked_bt <reason> [extra KEY=VALUE lines...]
# ---------------------------------------------------------------------------
emit_blocked_bt() {
    local reason="$1"
    shift
    printf 'BRANCH_TEARDOWN_REASON=%s\n' "${reason}"
    local line
    for line in "$@"; do
        printf '%s\n' "${line}"
    done
    printf 'BRANCH_TEARDOWN_STATUS=BLOCKED\n'
    exit 0
}

# ---------------------------------------------------------------------------
# resolve_project_dir — MAIN-repo-root-aware 4-tier fallback.
#
# Tier 2 is an INTENTIONAL deviation from the canonical resolve_project_dir in
# shell.md (which uses --show-toplevel). Inside a linked worktree
# --show-toplevel returns the WORKTREE root, not the main repo root. We use
# --git-common-dir + realpath normalization + dirname instead, per wiki lesson
# 20_Lessons/2026-06-04 "Trap 3". Do NOT "fix" this back to --show-toplevel.
#
# --git-common-dir returns the RELATIVE path ".git" in the main checkout, so
# realpath normalization is mandatory before dirname (otherwise dirname yields
# "." and the guard silently breaks).
# ---------------------------------------------------------------------------
resolve_project_dir() {
    local root gitdir gitdir_abs

    # Tier 1: env override (trusted)
    if [[ -n "${CLAUDE_PROJECT_DIR:-}" && -d "${CLAUDE_PROJECT_DIR}" ]]; then
        printf '%s\n' "${CLAUDE_PROJECT_DIR}"; return 0
    fi

    # Tier 2: git common dir (main-repo-aware; NOT --show-toplevel — see above)
    if gitdir=$(git rev-parse --git-common-dir 2>/dev/null) && [[ -n "${gitdir}" ]]; then
        gitdir_abs=$(realpath_portable "${gitdir}")
        root=$(dirname "${gitdir_abs}")
        if [[ -n "${root}" && -d "${root}/.claude" ]]; then
            printf '%s\n' "${root}"; return 0
        fi
    fi

    # Tier 3: script-relative (depth 4: scripts/ -> omb-clean/ -> skills/ -> .claude/ -> root)
    root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." 2>/dev/null && pwd)
    if [[ -n "${root}" && -d "${root}/.claude" ]]; then
        printf '%s\n' "${root}"; return 0
    fi

    # Tier 4: last resort
    pwd
}

# ---------------------------------------------------------------------------
# branch_in_linked_worktree <branch> <main_root>
# Returns 0 (true) when git worktree list --porcelain shows the branch checked
# out in a LINKED worktree (worktree path != main_root). Being on the branch in
# the MAIN checkout is NOT a match (that is the checkout-back case).
#
# Modified from worktree-teardown.sh's worktree_is_registered: there is no
# expected path here, so we match on branch name alone, but skip the block whose
# worktree path equals the main repo root. Uses POSIX awk — no grep -F/-P.
# ---------------------------------------------------------------------------
branch_in_linked_worktree() {
    local branch="$1"
    local main_root="$2"

    git worktree list --porcelain 2>/dev/null | \
    awk -v bname="${branch}" -v mroot="${main_root}" '
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
            if (found_branch && cur != mroot) {
                exit 0
            }
            cur = ""
            found_branch = 0
        }
        END {
            # Last block may not end with a trailing blank line.
            if (found_branch && cur != mroot) {
                exit 0
            }
            exit 1
        }
    '
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
BRANCH="${1:-}"
shift || true

CHECK_ONLY="false"
FORCE="false"
PR_MERGED_HEAD=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --check-only)
            CHECK_ONLY="true"
            shift
            ;;
        --force)
            FORCE="true"
            shift
            ;;
        --pr-merged-head)
            PR_MERGED_HEAD="${2:-}"
            shift 2 || shift
            ;;
        *)
            shift
            ;;
    esac
done

if [[ -z "${BRANCH}" ]]; then
    emit_blocked_bt "empty-branch"
fi

PROJECT_DIR=$(resolve_project_dir)
PROJECT_ROOT=$(realpath_portable "${PROJECT_DIR}")

# Operate inside the main repo root so all git verdicts and worktree porcelain
# are evaluated against the primary checkout.
cd "${PROJECT_DIR}"

# ---------------------------------------------------------------------------
# Current branch / HEAD state
# ---------------------------------------------------------------------------
HEAD_REF=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'HEAD')
if [[ "${HEAD_REF}" == "HEAD" ]]; then
    CURRENT_BRANCH="DETACHED"
else
    CURRENT_BRANCH="${HEAD_REF}"
fi

# ---------------------------------------------------------------------------
# Guard (a): branch-name validation (treat BRANCH as arbitrary user input).
# ---------------------------------------------------------------------------
if ! git check-ref-format --branch "${BRANCH}" >/dev/null 2>&1; then
    emit_blocked_bt "invalid-branch-name" \
        "PROJECT_ROOT=${PROJECT_ROOT}" \
        "CURRENT_BRANCH=${CURRENT_BRANCH}"
fi

# ---------------------------------------------------------------------------
# Guard (b): protected branches (case glob; NOT bypassable by --force).
# ---------------------------------------------------------------------------
case "${BRANCH}" in
    main|master|develop|release/*|hotfix/*)
        emit_blocked_bt "protected-branch" \
            "PROJECT_ROOT=${PROJECT_ROOT}" \
            "CURRENT_BRANCH=${CURRENT_BRANCH}"
        ;;
esac

# ---------------------------------------------------------------------------
# Default branch detection.
# ---------------------------------------------------------------------------
DEFAULT=""
if origin_head=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null) \
    && [[ -n "${origin_head}" ]]; then
    DEFAULT="${origin_head#origin/}"
elif git show-ref --verify --quiet refs/heads/main; then
    DEFAULT="main"
elif git show-ref --verify --quiet refs/heads/master; then
    DEFAULT="master"
fi

if [[ -z "${DEFAULT}" ]]; then
    # No origin-HEAD / main / master. If the target IS the current HEAD branch,
    # it is effectively the repo's only/default branch and cannot be deleted —
    # report target-is-default. Otherwise the default is genuinely unknown.
    if [[ "${CURRENT_BRANCH}" != "DETACHED" && "${BRANCH}" == "${CURRENT_BRANCH}" ]]; then
        emit_blocked_bt "target-is-default" \
            "PROJECT_ROOT=${PROJECT_ROOT}" \
            "DEFAULT_BRANCH=${BRANCH}" \
            "CURRENT_BRANCH=${CURRENT_BRANCH}"
    fi
    emit_blocked_bt "default-branch-not-found" \
        "PROJECT_ROOT=${PROJECT_ROOT}" \
        "CURRENT_BRANCH=${CURRENT_BRANCH}"
fi

# ---------------------------------------------------------------------------
# Guard (c): target == default branch.
# ---------------------------------------------------------------------------
if [[ "${BRANCH}" == "${DEFAULT}" ]]; then
    emit_blocked_bt "target-is-default" \
        "PROJECT_ROOT=${PROJECT_ROOT}" \
        "DEFAULT_BRANCH=${DEFAULT}" \
        "CURRENT_BRANCH=${CURRENT_BRANCH}"
fi

# ---------------------------------------------------------------------------
# Guard (d): branch existence.
# ---------------------------------------------------------------------------
if ! git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    emit_blocked_bt "branch-not-found" \
        "PROJECT_ROOT=${PROJECT_ROOT}" \
        "DEFAULT_BRANCH=${DEFAULT}" \
        "CURRENT_BRANCH=${CURRENT_BRANCH}"
fi

# ---------------------------------------------------------------------------
# Guard (e): branch checked out in a LINKED worktree.
# ---------------------------------------------------------------------------
if branch_in_linked_worktree "${BRANCH}" "${PROJECT_DIR}"; then
    emit_blocked_bt "checked-out-in-worktree" \
        "PROJECT_ROOT=${PROJECT_ROOT}" \
        "DEFAULT_BRANCH=${DEFAULT}" \
        "CURRENT_BRANCH=${CURRENT_BRANCH}"
fi

# ---------------------------------------------------------------------------
# Merge verdict (single authority): local arm + optional origin arm.
# No network operations — callers handle fetch.
# ---------------------------------------------------------------------------
LOCAL_ARM_MERGED="false"
ORIGIN_ARM_MERGED="false"

if git merge-base --is-ancestor "${BRANCH}" "${DEFAULT}" >/dev/null 2>&1; then
    LOCAL_ARM_MERGED="true"
fi

if git show-ref --verify --quiet "refs/remotes/origin/${DEFAULT}"; then
    if git merge-base --is-ancestor "${BRANCH}" "origin/${DEFAULT}" >/dev/null 2>&1; then
        ORIGIN_ARM_MERGED="true"
    fi
fi

if [[ "${LOCAL_ARM_MERGED}" == "true" || "${ORIGIN_ARM_MERGED}" == "true" ]]; then
    MERGE_STATUS="ancestry-merged"
else
    MERGE_STATUS="not-merged"
fi

# ---------------------------------------------------------------------------
# --check-only mode: report and stop. NO deletion, NO checkout, NO side effects.
# ---------------------------------------------------------------------------
if [[ "${CHECK_ONLY}" == "true" ]]; then
    printf 'BRANCH_TEARDOWN_STATUS=CHECKED\n'
    printf 'PROJECT_ROOT=%s\n' "${PROJECT_ROOT}"
    printf 'DEFAULT_BRANCH=%s\n' "${DEFAULT}"
    printf 'CURRENT_BRANCH=%s\n' "${CURRENT_BRANCH}"
    printf 'MERGE_STATUS=%s\n' "${MERGE_STATUS}"
    printf 'CHECKOUT_PERFORMED=false\n'
    exit 0
fi

# ---------------------------------------------------------------------------
# Checkout-back (guarded): only when current HEAD branch == target branch.
# ---------------------------------------------------------------------------
CHECKOUT_PERFORMED="false"
if [[ "${CURRENT_BRANCH}" == "${BRANCH}" ]]; then
    # Dirty == tracked changes or untracked FILES. Untracked top-level
    # directories (porcelain "?? name/", trailing slash) are ignored: git
    # checkout never overwrites them, so they are not at-risk uncommitted work.
    dirty=$(git status --porcelain 2>/dev/null | awk '!(/^\?\? / && /\/$/)' || true)
    if [[ -n "${dirty}" ]]; then
        emit_blocked_bt "uncommitted-changes" \
            "PROJECT_ROOT=${PROJECT_ROOT}" \
            "DEFAULT_BRANCH=${DEFAULT}" \
            "CURRENT_BRANCH=${CURRENT_BRANCH}" \
            "MERGE_STATUS=${MERGE_STATUS}" \
            "CHECKOUT_PERFORMED=false"
    fi
    if git checkout "${DEFAULT}" >/dev/null 2>&1; then
        CHECKOUT_PERFORMED="true"
    else
        emit_blocked_bt "checkout-failed" \
            "PROJECT_ROOT=${PROJECT_ROOT}" \
            "DEFAULT_BRANCH=${DEFAULT}" \
            "CURRENT_BRANCH=${CURRENT_BRANCH}" \
            "MERGE_STATUS=${MERGE_STATUS}" \
            "CHECKOUT_PERFORMED=false"
    fi
fi

# ---------------------------------------------------------------------------
# Deletion (fixed priority).
# ---------------------------------------------------------------------------
DELETED_VIA=""

emit_delete_failed() {
    emit_blocked_bt "delete-failed" \
        "PROJECT_ROOT=${PROJECT_ROOT}" \
        "DEFAULT_BRANCH=${DEFAULT}" \
        "CURRENT_BRANCH=${CURRENT_BRANCH}" \
        "MERGE_STATUS=${MERGE_STATUS}" \
        "CHECKOUT_PERFORMED=${CHECKOUT_PERFORMED}"
}

if [[ "${MERGE_STATUS}" == "ancestry-merged" ]]; then
    if git branch -d "${BRANCH}" >/dev/null 2>&1; then
        DELETED_VIA="safe"
    elif [[ "${ORIGIN_ARM_MERGED}" == "true" ]]; then
        if git branch -D "${BRANCH}" >/dev/null 2>&1; then
            DELETED_VIA="safe"
        else
            emit_delete_failed
        fi
    else
        emit_delete_failed
    fi
elif [[ -n "${PR_MERGED_HEAD}" ]]; then
    tip=$(git rev-parse "refs/heads/${BRANCH}" 2>/dev/null || printf '')
    if [[ -n "${tip}" && "${tip}" == "${PR_MERGED_HEAD}" ]]; then
        if git branch -D "${BRANCH}" >/dev/null 2>&1; then
            DELETED_VIA="pr-evidence"
        else
            emit_delete_failed
        fi
    else
        emit_blocked_bt "pr-head-mismatch" \
            "PROJECT_ROOT=${PROJECT_ROOT}" \
            "DEFAULT_BRANCH=${DEFAULT}" \
            "CURRENT_BRANCH=${CURRENT_BRANCH}" \
            "MERGE_STATUS=${MERGE_STATUS}" \
            "CHECKOUT_PERFORMED=${CHECKOUT_PERFORMED}"
    fi
elif [[ "${FORCE}" == "true" ]]; then
    if git branch -D "${BRANCH}" >/dev/null 2>&1; then
        DELETED_VIA="force"
    else
        emit_delete_failed
    fi
else
    emit_blocked_bt "not-merged" \
        "PROJECT_ROOT=${PROJECT_ROOT}" \
        "DEFAULT_BRANCH=${DEFAULT}" \
        "CURRENT_BRANCH=${CURRENT_BRANCH}" \
        "MERGE_STATUS=${MERGE_STATUS}" \
        "CHECKOUT_PERFORMED=${CHECKOUT_PERFORMED}"
fi

# ---------------------------------------------------------------------------
# Success RESULT block.
# ---------------------------------------------------------------------------
printf 'BRANCH_TEARDOWN_STATUS=REMOVED\n'
printf 'PROJECT_ROOT=%s\n' "${PROJECT_ROOT}"
printf 'DEFAULT_BRANCH=%s\n' "${DEFAULT}"
printf 'CURRENT_BRANCH=%s\n' "${CURRENT_BRANCH}"
printf 'MERGE_STATUS=%s\n' "${MERGE_STATUS}"
printf 'CHECKOUT_PERFORMED=%s\n' "${CHECKOUT_PERFORMED}"
printf 'DELETED_VIA=%s\n' "${DELETED_VIA}"
