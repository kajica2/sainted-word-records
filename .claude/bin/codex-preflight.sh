#!/usr/bin/env bash
# Codex preflight — checks codex binary on PATH and OMB_USE_CODEX env flag.
# Outputs a single "exit=<signal>" line. Signals: not-found, 0, 1
set -uo pipefail
# NOTE: -e intentionally omitted — every error path must still emit a "exit=<signal>"
# line so callers can parse the result deterministically.

# Layer 1: codex binary present? (also report path + version for debug)
CODEX_BIN="$(command -v codex 2>/dev/null || true)"
if [[ -z "$CODEX_BIN" ]]; then
  echo "exit=not-found"
  exit 0
fi
CODEX_VER="$(codex --version 2>/dev/null | head -1 || echo 'unknown')"
echo "codex_path=$CODEX_BIN"
echo "codex_version=$CODEX_VER"

# Layer 2: OMB_USE_CODEX enabled?
# Check process env first; fall back to .claude/settings.local.json so that
# `omb init` / OMB_USE_CODEX=1 activations in the SAME session are visible. Anchor the path
# to ${CLAUDE_PROJECT_DIR:-$(pwd)} so the fallback works even when CWD is not
# the project root (the same class of bug this script's callers were fixed for).
ENABLED="${OMB_USE_CODEX:-}"
SETTINGS_PATH="${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/settings.local.json"
if [[ -z "$ENABLED" && -r "$SETTINGS_PATH" ]]; then
  ENABLED="$(SETTINGS_PATH="$SETTINGS_PATH" python3 -c 'import json,os; d=json.load(open(os.environ["SETTINGS_PATH"])); print(d.get("env",{}).get("OMB_USE_CODEX",""))' 2>/dev/null || true)"
fi

if [[ "$ENABLED" = "1" ]]; then
  echo "exit=0"
else
  echo "exit=1"
fi
exit 0
