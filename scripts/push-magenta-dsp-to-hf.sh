#!/usr/bin/env bash
# scripts/push-magenta-dsp-to-hf.sh
# ---------------------------------------------------------------
# Build the bundle and push it to the Hugging Face Hub as the model
# `kaidjuric/magenta-dsp-procedural`.
#
# REQUIRES
#   - hf CLI on PATH (pip install -U "huggingface_hub[cli]" or Homebrew)
#   - HF_TOKEN env var with write access to kaidjuric/* — OR you'll be
#     prompted for it (read -s, never echoed, never logged, unset on exit)
#
# USAGE
#   bash scripts/push-magenta-dsp-to-hf.sh [--tag v0.1.0] [--dry-run]
#
# FLAGS
#   --tag <vX.Y.Z>   Tag (default: package.json#version)
#   --dry-run        Print the exact hf upload command and exit
#   --no-build       Skip the bundle build step (assume dist-hf/<tag> exists)
#   --private        Create the repo private if it doesn't exist
# ---------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG=""
DRY_RUN=0
DO_BUILD=1
PRIVATE="--no-private"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)      TAG="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --no-build) DO_BUILD=0; shift ;;
    --private)  PRIVATE="--private"; shift ;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 64 ;;
  esac
done

# ---- resolve tag ----
if [[ -z "$TAG" ]]; then
  if command -v jq >/dev/null 2>&1; then
    TAG="v$(jq -r '.version' "$REPO_ROOT/package.json")"
  else
    TAG="v$(node -e 'process.stdout.write(require("./package.json").version)')"
  fi
fi

REPO_ID="kaidjuric/magenta-dsp-procedural"
BUNDLE="$REPO_ROOT/dist-hf/$TAG"

# ---- preflight ----
if ! command -v hf >/dev/null 2>&1; then
  echo "[hf-push] ERROR: 'hf' CLI not on PATH" >&2
  echo "" >&2
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "  install via Homebrew:" >&2
    echo "    brew install huggingface-cli" >&2
    echo "  …or pip:" >&2
    echo "    pip install -U \"huggingface_hub[cli]\"" >&2
  else
    echo "  pip install -U \"huggingface_hub[cli]\"" >&2
  fi
  exit 4
fi

echo "[hf-push] repo  = $REPO_ID"
echo "[hf-push] tag   = $TAG"
echo "[hf-push] mode  = $([[ $DRY_RUN -eq 1 ]] && echo DRY-RUN || echo APPLY)"

# ---- build bundle (unless --no-build) ----
if [[ $DO_BUILD -eq 1 ]]; then
  echo "[hf-push] build: bash scripts/build-magenta-dsp-bundle.sh --tag $TAG --apply"
  bash "$REPO_ROOT/scripts/build-magenta-dsp-bundle.sh" --tag "$TAG" --apply
fi

if [[ ! -d "$BUNDLE" ]]; then
  echo "[hf-push] ERROR: bundle missing at $BUNDLE" >&2
  echo "[hf-push] tip:   run with --no-build false (default) to generate it" >&2
  exit 5
fi

# ---- token ----
if [[ -z "${HF_TOKEN:-}" ]] && [[ $DRY_RUN -eq 0 ]]; then
  echo -n "[hf-push] HF_TOKEN (write access to $REPO_ID): "
  read -rs HF_TOKEN
  echo ""
  if [[ -z "$HF_TOKEN" ]]; then
    echo "[hf-push] ERROR: empty token" >&2
    exit 6
  fi
  trap 'unset HF_TOKEN' EXIT
  export HF_TOKEN
fi
# Always have the var defined so set -u doesn't trip the upload command.
: "${HF_TOKEN:=}"

# ---- upload ----
UPLOAD_CMD=(hf upload "$REPO_ID" "$BUNDLE/" .
            --repo-type model
            --commit-message "release: $TAG"
            --commit-description "Magenta.js procedural audio bundle $TAG — drum RNN, melody VAE interpolator, trio generator."
            --token "$HF_TOKEN"
            $PRIVATE)

echo "[hf-push] cmd: ${UPLOAD_CMD[*]}"

if [[ $DRY_RUN -eq 1 ]]; then
  echo ""
  echo "[hf-push] DRY-RUN — copy the command above to push for real:"
  echo "  HF_TOKEN=hf_xxx bash scripts/push-magenta-dsp-to-hf.sh --tag $TAG --no-build"
  exit 0
fi

echo "[hf-push] pushing…"
"${UPLOAD_CMD[@]}"
EC=$?
echo ""
echo "[hf-push] exit=$EC"
echo "[hf-push] view at: https://huggingface.co/$REPO_ID/tree/main"
exit $EC
