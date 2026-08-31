#!/usr/bin/env bash
# tools/deploy-vercel.sh — one-command Vercel deploy for SWR.
#
# Why this is a script and not auto-fired:
#   - Vercel deployment requires auth (interactive login or VERCEL_TOKEN).
#   - This repo's build is already verified (`npm run check` ALL GREEN;
#     `npm run build:vercel` produces ~89 MB in dist/).
#   - The recipe here: build, then `vercel deploy --yes` against the
#     already-linked project at .vercel/project.json
#     (team_KY5T7HVOj3wnX1ylM2x0g8o0, project sainted-word-records).
#
# Auth resolution (first match wins):
#   1. --token=***          (flag)
#   2. $VERCEL_TOKEN        (env)
#   3. $HOME/.config/vercel/token  (POSIX CLI cache, if present)
#   4. interactive `vercel login` (blocker if no TTY)
#
# Usage:
#   bash tools/deploy-vercel.sh                  # smoke + build + preview
#   bash tools/deploy-vercel.sh --no-check       # skip the smoke
#   bash tools/deploy-vercel.sh --prod           # promote the deploy
#   bash tools/deploy-vercel.sh --token=***      # non-interactive auth
#   VERCEL_TOKEN=*** bash tools/deploy-vercel.sh # same, via env
#
# Reversibility: every command is non-destructive until step 3.
# The deploy itself is a preview URL by default — promote to
# production only with --prod or `vercel promote <url>` after
# you've inspected it.

set -e

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---- flags ------------------------------------------------------------
RUN_CHECK=1
PROMOTE=0
TOKEN_ARG=""
DEPLOY_TARGET="preview"  # --prod flips this to production

while [ $# -gt 0 ]; do
  case "$1" in
    --no-check) RUN_CHECK=0 ;;
    --prod)     PROMOTE=1; DEPLOY_TARGET="production" ;;
    --preview)  PROMOTE=0; DEPLOY_TARGET="preview" ;;
    --token=*)  TOKEN_ARG="${1#*=}" ;;
    --help|-h)
      # Help: print contiguous # / #! comment lines from the top of
      # this file (stops at the first non-# line). Trims the leading
      # '#' so the output reads as plain prose.
      awk 'BEGIN{p=1} p && /^#[^!]?/{sub(/^# ?/,""); print; next} p{exit}' "$0"
      exit 0
      ;;
    *) echo "unknown flag: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

# ---- preflight --------------------------------------------------------
if [ ! -f .vercel/project.json ]; then
  echo "no .vercel/project.json — this directory isn't linked to a Vercel project."
  echo "link it with: vercel link"
  exit 2
fi

# ---- auth resolution --------------------------------------------------
resolve_token() {
  # 1. flag
  if [ -n "$TOKEN_ARG" ]; then printf '%s' "$TOKEN_ARG"; return 0; fi
  # 2. env
  if [ -n "$VERCEL_TOKEN" ]; then printf '%s' "$VERCEL_TOKEN"; return 0; fi
  # 3. POSIX CLI cache
  local tfile="$HOME/.config/vercel/token"
  if [ -f "$tfile" ]; then
    local v; v="$(cat "$tfile" 2>/dev/null | head -c 4096)"
    [ -n "$v" ] && printf '%s' "$v" && return 0
  fi
  # 4. interactive login (vercel CLI uses keychain/browser flow)
  return 1
}

TOKEN="$(resolve_token || true)"
if [ -z "$TOKEN" ] && ! vercel whoami >/dev/null 2>&1; then
  cat <<EOF
vercel auth not detected. Run one of:

  vercel login                                 # interactive
  VERCEL_TOKEN=*** bash tools/deploy-vercel.sh # non-interactive
  bash tools/deploy-vercel.sh --token=***      # inline
EOF
  exit 2
fi

if [ -n "$TOKEN" ]; then
  export VERCEL_TOKEN="$TOKEN"
fi

# ---- 1. Smoke (optional) ----------------------------------------------
if [ "$RUN_CHECK" -eq 1 ]; then
  echo "[1/3] npm run check …"
  npm run check
else
  echo "[1/3] npm run check … (skipped — --no-check)"
fi

# ---- 2. Build ---------------------------------------------------------
echo "[2/3] npm run build:vercel …"
npm run build:vercel

# Resolve scope once (the global Vercel CLI's currentTeam may point at a
# team the project doesn't live under — known issue when the local CLI
# config drifts from the actual project owner).
SCOPE_FLAG=""
if [ -n "${VERCEL_SCOPE:-}" ]; then
  SCOPE_FLAG="--scope $VERCEL_SCOPE"
elif vercel whoami >/dev/null 2>&1; then
  # `vercel ls <project>` writes only URLs to stdout and the
  # "Fetching deployments in <team>" header to stderr — so grep stdout
  # for `in <team>` matches nothing. The deployment URLs themselves
  # contain the team slug (e.g. https://sainted-word-records-<hash>-kai-djurics-projects.vercel.app),
  # so extract from there.
  #
  # Capture both streams, then look for either:
  #   1) the stderr "in <team>" header (older CLI versions)
  #   2) the team slug in a deployment URL (current CLI behavior)
  LS_OUT="$(vercel ls sainted-word-records --yes 2>&1)"
  PROJECT_TEAM="$(printf '%s\n' "$LS_OUT" \
    | grep -oE 'in [a-zA-Z0-9_-]+' \
    | head -1 \
    | awk '{print $2}')"
  if [ -z "$PROJECT_TEAM" ]; then
    PROJECT_TEAM="$(printf '%s\n' "$LS_OUT" \
      | grep -oE 'https?://sainted-word-records-[a-zA-Z0-9_-]+' \
      | head -1 \
      | sed -E 's|.*-kai-djurics-projects\.vercel\.app$|kai-djurics-projects|;s|.*-([a-zA-Z0-9_-]+)\.vercel\.app$|\1|')"
  fi
  if [ -n "$PROJECT_TEAM" ]; then
    SCOPE_FLAG="--scope $PROJECT_TEAM"
  fi
fi
[ -n "$SCOPE_FLAG" ] && echo "[scope] using $SCOPE_FLAG"

# ---- 3. Deploy --------------------------------------------------------
echo "[3/3] vercel deploy --yes --archive=tgz --target=$DEPLOY_TARGET $SCOPE_FLAG …"

# We deliberately avoid --no-clipboard: when interactive, the CLI
# shows the URL on stdout and copies it; in non-interactive mode
# it skips the clipboard call.
DEPLOY_OUT="$(vercel deploy --yes --archive=tgz --target="$DEPLOY_TARGET" $SCOPE_FLAG)" || {
  echo "vercel deploy failed."
  echo "$DEPLOY_OUT" | tail -40
  exit 1
}

DEPLOY_URL="$(printf '%s\n' "$DEPLOY_OUT" | grep -E '^https?://' | tail -1)"
echo
echo "✓ deploy queued (target=$DEPLOY_TARGET)."
[ -n "$DEPLOY_URL" ] && echo "  URL:    $DEPLOY_URL"
echo "  Inspect:    vercel inspect ${DEPLOY_URL:-<url>}"
echo "  Tail logs:  vercel logs ${DEPLOY_URL:-<url>}"
echo "  Promote:    vercel promote ${DEPLOY_URL:-<url>}"
echo "  List all:   vercel ls"

# Auto-promote iff --prod was passed.
if [ "$PROMOTE" -eq 1 ] && [ -n "$DEPLOY_URL" ]; then
  echo
  echo "[bonus] vercel promote $DEPLOY_URL $SCOPE_FLAG"
  vercel promote "$DEPLOY_URL" $SCOPE_FLAG
fi
