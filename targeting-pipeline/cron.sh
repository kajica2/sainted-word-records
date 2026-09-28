#!/usr/bin/env bash
# targeting-pipeline/cron.sh — regenerate + verify the targeting artifacts.
#
# Same shape as preset-pipeline/cron.sh (generate → verify), minus the
# commit/push: the artifacts are committed by hand. Run from the repo root or
# from this directory; the script resolves its own path.
set -euo pipefail

cd "$(dirname "$0")"

node parse-personas.mjs
node parse-scripts.mjs
node build-rules.mjs
node build-voice-lint.mjs
node verify.mjs

echo "[targeting-pipeline] artifacts regenerated and verified"
