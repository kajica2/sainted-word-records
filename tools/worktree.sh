#!/usr/bin/env bash
# tools/worktree.sh — worktree manager for sainted-word-records.
#
# What this does:
#   ./tools/worktree.sh ls              list current worktrees + their branches
#   ./tools/worktree.sh status          print which branches have no worktree
#   ./tools/worktree.sh add <branch>    create a worktree at ../swr-worktrees/<branch>
#                                       on the named branch (creates the branch from
#                                       origin/<branch> if missing locally)
#   ./tools/worktree.sh rm <branch>     remove the worktree (branch stays)
#   ./tools/worktree.sh sync-node       symlink node_modules from canonical so
#                                       the new worktree skips the 250MB install
#
# Why this exists:
#   The repo has ~10 active feature branches from parallel Hermes sessions,
#   Claude Code agents, and Codex runs. Each one is its own isolated working
#   tree at /Users/.../Documents/swr-worktrees/<branch>. New sessions can
#   spawn their own worktree with one command instead of manually running
#   `git worktree add` + `npm install`.

set -e

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_PARENT="$(dirname "$ROOT")/swr-worktrees"

# Sanity: this script must be run from inside the canonical repo.
if [ ! -d "$ROOT/.git" ]; then
  echo "error: $ROOT/.git not found. Run from the canonical repo root." >&2
  exit 2
fi

cmd="${1:-ls}"

case "$cmd" in
  ls|list)
    git worktree list
    ;;

  status)
    echo "=== current worktrees ==="
    git worktree list
    echo ""
    echo "=== orphaned branches (no worktree) ==="
    found=0
    git for-each-ref --format='%(refname:short)' refs/heads/ | while read b; do
      if ! git worktree list | grep -q "\\[$b\\]"; then
        echo "  $b"
        found=$((found + 1))
      fi
    done
    echo ""
    echo "total: $(git worktree list | wc -l | tr -d ' ') worktrees, $(git for-each-ref --format='%(refname:short)' refs/heads/ | wc -l | tr -d ' ') branches"
    ;;

  add)
    branch="${2:?usage: $0 add <branch>}"
    if [ -d "$WORKTREE_PARENT/$branch" ]; then
      echo "error: $WORKTREE_PARENT/$branch already exists" >&2
      exit 1
    fi
    # If the branch doesn't exist locally, try to fetch from origin.
    if ! git show-ref --verify --quiet "refs/heads/$branch"; then
      if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
        echo "fetching origin/$branch..."
        git branch "$branch" "origin/$branch"
      else
        echo "error: branch '$branch' doesn't exist locally or on origin" >&2
        exit 2
      fi
    fi
    mkdir -p "$WORKTREE_PARENT"
    git worktree add "$WORKTREE_PARENT/$branch" "$branch"
    # Symlink node_modules to save the 250MB install.
    if [ -d "$ROOT/node_modules" ] && [ ! -e "$WORKTREE_PARENT/$branch/node_modules" ]; then
      ln -s "$ROOT/node_modules" "$WORKTREE_PARENT/$branch/node_modules"
      echo "node_modules symlinked from canonical"
    fi
    echo ""
    echo "ready: cd $WORKTREE_PARENT/$branch"
    ;;

  rm|remove)
    branch="${2:?usage: $0 rm <branch>}"
    target="$WORKTREE_PARENT/$branch"
    if [ ! -d "$target" ]; then
      echo "error: $target doesn't exist" >&2
      exit 1
    fi
    # Unlink node_modules symlink first if present (so we don't delete canonical's node_modules).
    if [ -L "$target/node_modules" ]; then
      rm "$target/node_modules"
    fi
    git worktree remove "$target"
    echo "removed $target"
    echo "(branch $branch still exists; use 'git branch -D $branch' to delete it)"
    ;;

  sync-node)
    branch="${2:?usage: $0 sync-node <branch>}"
    target="$WORKTREE_PARENT/$branch"
    if [ ! -d "$target" ]; then
      echo "error: $target doesn't exist" >&2
      exit 1
    fi
    if [ -e "$target/node_modules" ]; then
      echo "node_modules already present in $target (not a symlink?)"
      exit 0
    fi
    ln -s "$ROOT/node_modules" "$target/node_modules"
    echo "node_modules symlinked from canonical into $target"
    ;;

  help|--help|-h|"")
    cat <<EOF
tools/worktree.sh — manage git worktrees for sainted-word-records

usage:
  $0 ls                  list current worktrees
  $0 status              show worktrees + orphaned branches
  $0 add <branch>        spawn a new worktree at ../swr-worktrees/<branch>
  $0 rm <branch>         remove a worktree (branch stays)
  $0 sync-node <branch>  symlink node_modules from canonical into worktree

Examples:
  $0 add feat/auth-and-membership
  $0 rm feat/auth-and-membership
  $0 status
EOF
    ;;

  *)
    echo "unknown command: $cmd (try 'help')" >&2
    exit 2
    ;;
esac