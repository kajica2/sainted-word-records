#!/usr/bin/env bash
set -euo pipefail
BIN="${HOME}/.local/bin/omb"
[[ -x "${BIN}" ]] || BIN="${HOME}/.local/bin/oh-my-braincrew"
if [[ ! -x "${BIN}" ]]; then
  echo "[omb] installed runtime not found under ${HOME}/.local/bin" >&2
  exit 127
fi
exec "${BIN}" openwiki-read summary "$@"
