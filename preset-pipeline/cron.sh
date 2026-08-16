#!/usr/bin/env bash
# cron.sh — daily preset generator + verifier + auto-commit.
# Idempotent: safe to run multiple times per day (generator appends,
# git commit is a no-op if there's nothing to commit).
#
# LaunchAgent (macOS) at 09:00 every day:
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
# Only commit + push + redeploy if there are new/updated preset files
if git status --porcelain -- presets/ | grep -q .; then
  log "committing new presets"
  git add -- presets/ preset-pipeline/out/ 2>/dev/null || true
  git commit -m "preset-pipeline: daily generation (seed $SEED)

Generated $(git diff --cached --name-only -- presets/ | wc -l | tr -d ' ') new preset(s) on $(date +%Y-%m-%d)." 2>&1 | tee -a "$LOG"

  if git remote get-url origin >/dev/null 2>&1; then
    log "pushing to origin"
    git push origin main 2>&1 | tee -a "$LOG"
  else
    log "no origin remote, skipping push"
  fi

  # Redeploy to Vercel so the new presets are served. Vercel does NOT
  # auto-deploy on push (we use --prebuilt in our manual deploy), so
  # this step is required to make the new personalities appear in the
  # live engine. Best-effort: if the deploy fails, the next manual
  # deploy will still pick up the new presets.
  if [[ -d "$REPO_ROOT/.vercel" ]] && command -v vercel >/dev/null 2>&1; then
    log "redeploying to Vercel (best-effort)"
    cd "$REPO_ROOT"
    if npx vercel build --prod 2>&1 | tee -a "$LOG" \
       && npx vercel deploy --prebuilt --prod --yes 2>&1 | tee -a "$LOG"; then
      log "deploy succeeded"
    else
      log "deploy failed — new presets are in git but not yet live"
    fi
  else
    log "no .vercel/ or no vercel CLI, skipping deploy"
  fi
else
  log "no new presets to commit"
fi

log "done"
