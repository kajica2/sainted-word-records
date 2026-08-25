#!/usr/bin/env bash
# tools/dev-down.sh — inverse of dev-up.sh. Kills the WS bridge
# (port 8787 by default), the healthz (8799), and Vite (5174 by
# default). Also walks tools/.dev-pids and SIGTERMs each pid.
#
# Safe to call repeatedly. Safe to call when nothing's running.
# Reversibility: nothing permanent was created (pids file is rewritten).

set -u

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS_FILE="$ROOT/tools/.dev-pids"

kill_from_pids_file() {
  if [ ! -f "$PIDS_FILE" ]; then return 0; fi
  while IFS='=' read -r label pid; do
    [ -z "$pid" ] && continue
    if kill -0 "$pid" 2>/dev/null; then
      echo "[dev-down] $label pid=$pid — TERM"
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done < "$PIDS_FILE"
  : > "$PIDS_FILE"
}

kill_on_port() {
  local port="$1"
  local pids
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "[dev-down] port :$port still bound — TERM"
    for pid in $pids; do
      kill -TERM "$pid" 2>/dev/null || true
    done
  fi
}

# Belt and suspenders: both pids-file and live-port scan.
kill_from_pids_file
kill_on_port 8787
kill_on_port 8799
kill_on_port 5174

sleep 0.5

# Anything that survived SIGTERM, escalate.
for port in 8787 8799 5174; do
  leftover=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -n "$leftover" ]; then
    echo "[dev-down] port :$port still bound — KILL"
    for pid in $leftover; do
      kill -KILL "$pid" 2>/dev/null || true
    done
  fi
done

echo "[dev-down] done."
