#!/usr/bin/env bash
# tools/deploy-vercel.sh — single-command Vercel deploy for SWR.
#
# Why this is a script and not auto-fired:
#   - Vercel deployment requires auth (interactive login or VERCEL_TOKEN).
#   - This repo's build is already verified (`npm run check` ALL GREEN;
#     `npm run build:vercel` produces ~89 MB in dist/).
#   - The recipe here: build, then `vercel deploy --yes` against the
#     already-linked project at .vercel/project.json (team_KY5T7HVOj3wnX1ylM2x0g8o0,
#     project sainted-word-records).
#
# What this script does:
#   1. `npm run check`                — full smoke (catches anything
#                                        that would break the build).
#   2. `npm run build:vercel`          — Vite build + library fetch.
#   3. `vercel deploy --yes --no-clipboard --archive=tgz`
#                                     — non-interactive deploy (when
#                                       `vercel` CLI is logged in).
#
# When the CLI isn't logged in, the script pauses cleanly and tells
# you exactly how to log in (`vercel login` interactively, or export
# VERCEL_TOKEN first).
#
# Reversibility: every command is non-destructive until step 3. The
# deploy itself is **a preview URL** by default — promote to production
# only with `vercel promote <url>` after you've inspected it.

set -e

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .vercel/project.json ]; then
  echo "no .vercel/project.json — this directory isn't linked to a Vercel project."
  echo "link it with: vercel link"
  exit 2
fi

# 1. Smoke
echo "[1/3] npm run check …"
npm run check

# 2. Build
echo "[2/3] npm run build:vercel …"
npm run build:vercel

# 3. Deploy (non-interactive preview)
echo "[3/3] vercel deploy --yes --archive=tgz …"
vercel deploy --yes --archive=tgz

echo
echo "✓ deploy queued. The CLI prints a URL like https://sainted-word-records-abc.vercel.app"
echo "  Inspect:    vercel inspect <url>"
echo "  Promote:    vercel promote <url>"
echo "  Tail logs:  vercel logs <url>"
echo "  List all:   vercel ls"
