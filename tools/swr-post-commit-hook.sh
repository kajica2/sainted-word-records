#!/usr/bin/env bash
# .git/hooks/post-commit — auto-log every commit to the SWR Obsidian
# journal. Idempotent: re-running produces one entry per commit.
#
# The journal is at $SWR_VAULT (default .obsidian-swr/ in the repo). If
# the vault is missing (e.g. someone ran `npm install` clean), the
# hook silently no-ops so `git commit` is never blocked by a missing
# optional tool.

set -e

# Repo root (this script is invoked from there by git)
REPO=$(git rev-parse --show-toplevel)
SHA=$(git rev-parse HEAD)
VAULT="${SWR_VAULT:-$REPO/.obsidian-swr}"

# No-op if the logger isn't there
LOGGER="$REPO/tools/swr-journal-log.mjs"
if [ ! -f "$LOGGER" ]; then
  exit 0
fi

# No-op if the vault hasn't been initialized
if [ ! -d "$VAULT" ]; then
  exit 0
fi

node "$LOGGER" commit "$SHA" 2>/dev/null || true
exit 0
