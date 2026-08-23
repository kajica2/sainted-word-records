#!/usr/bin/env bash
# cron.sh — daily preset generator + verifier + push.
# Idempotent: safe to run multiple times per day (generator appends,
# git commit is a no-op if there's nothing to commit).
#
# Production runs are scheduled via .github/workflows/presets-daily.yml
# in the kajica2/sainted-word-records GitHub repo. That workflow generates,
# verifies, and opens a PR — once merged, Vercel auto-deploys.
#
# This script remains for local manual runs (e.g. testing the pipeline
# before the GH Action is set up, or generating presets while offline).
# It does NOT call `npx vercel deploy` — Vercel auto-deploys from the
# new repo on push, so the manual deploy step is redundant.
#
# LaunchAgent (macOS) for the local-fallback case:
#   ~/Library/LaunchAgents/com.swr.preset-pipeline.daily.plist
#   launchctl load -w ~/Library/LaunchAgents/com.swr.preset-pipeline.daily.plist
#
# Crontab fallback:
#   0 9 * * *  cd /path/to/sainted-word-records && ./preset-pipeline/cron.sh >> preset-pipeline/out/cron.log 2>&1
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# The repo root is the parent of the preset-pipeline/ folder. The generator
# writes to ../presets/, the verifier reads it, and the auto-commit runs
# from the repo root so git picks up the new files.
REPO_ROOT="$(cd "$HERE/.." && pwd)"
cd "$REPO_ROOT"

COUNT="${COUNT:-2}"
SEED="${SEED:-$(date +%Y%m%d)}"
LOG="$HERE/out/cron.log"
mkdir -p "$HERE/out"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }

log "=== preset-pipeline daily run ==="
log "repo: $REPO_ROOT"
log "count: $COUNT  seed: $SEED"

cd "$REPO_ROOT/preset-pipeline"
log "generating $COUNT preset(s)"
python3 generate.py --count "$COUNT" --seed "$SEED"

log "verifying"
node verify.mjs

cd "$REPO_ROOT"
# Only commit + push if there are new/updated preset files. Vercel
# auto-deploys from the new GitHub repo on push, so we don't call
# `npx vercel deploy` here — the GH Action does the equivalent on the
# server. This script is just a local fallback.
if git status --porcelain -- presets/ | grep -q .; then
  log "committing new presets"
  git add -- presets/ preset-pipeline/out/ 2>/dev/null || true
  git commit -m "preset-pipeline: daily generation (seed $SEED)

Generated $(git diff --cached --name-only -- presets/ | wc -l | tr -d ' ') new preset(s) on $(date +%Y-%m-%d). Generated locally via preset-pipeline/cron.sh." 2>&1 | tee -a "$LOG"

  if git remote get-url origin >/dev/null 2>&1; then
    log "pushing to origin (Vercel will auto-deploy from the new repo on push)"
    git push origin main 2>&1 | tee -a "$LOG"
  else
    log "no origin remote, skipping push"
  fi
else
  log "no new presets to commit"
fi

log "done"
