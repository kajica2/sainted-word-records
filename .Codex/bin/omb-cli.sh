#!/usr/bin/env bash
# Release wrapper shared by skills and hooks.
set -euo pipefail
BIN="${HOME}/.local/bin/omb"
[ -x "$BIN" ] || BIN="${HOME}/.local/bin/oh-my-braincrew"
if [[ ! -x "$BIN" && -n "${LOCALAPPDATA:-}" ]]; then
  RELEASE_DIR="${LOCALAPPDATA}/oh-my-braincrew"
  if command -v cygpath >/dev/null 2>&1; then
    RELEASE_DIR=$(cygpath -u "$RELEASE_DIR")
  fi
  BIN="${RELEASE_DIR}/oh-my-braincrew.exe"
fi
if [[ ! -x "$BIN" ]]; then
  BIN=$(command -v oh-my-braincrew || command -v omb) || {
    echo "[omb] Installed binary not found. Re-run the OMB installer." >&2
    exit 127
  }
fi
exec "$BIN" "$@"
