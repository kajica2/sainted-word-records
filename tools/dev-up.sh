#!/usr/bin/env bash
# tools/dev-up.sh — one-shot dev bootstrap for the visualizer-control
# transport. Fans out the WebSocket bridge + healthz, then Vite, then
# prints every URL you need to send anyone.
#
# Usage:
#   bash tools/dev-up.sh
#   VC_PORT=9001 bash tools/dev-up.sh   # custom WS port
#
# Idempotent. Captures pids in tools/.dev-pids. tools/dev-down.sh kills
# them. If they survive a Ctrl-C, the next dev-up reuses them.
#
# Reversibility: rm tools/dev-up.sh tools/dev-down.sh tools/.dev-pids
# (or just leave them and never call).

set -e

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p tools

VC_PORT="${VC_PORT:-8787}"
HEALTH_PORT="${VC_WS_HEALTH_PORT:-8799}"
VITE_PORT="${VITE_PORT:-5174}"
LOG_DIR="$ROOT/tools/.dev-logs"
mkdir -p "$LOG_DIR"

is_alive() { kill -0 "$1" 2>/dev/null; }
already_on() {
  local port="$1"
  local pid
  pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 | awk '{print $2}')
  if [ -n "$pid" ]; then echo "$pid"; return 0; fi
  return 1
}

PIDS_FILE="$ROOT/tools/.dev-pids"
touch "$PIDS_FILE"

start_or_reuse() {
  local label="$1"
  local port="$2"
  shift 2
  local logfile="$LOG_DIR/${label}.log"

  # 1) already on this port from a prior bash session?
  local existing_pid
  existing_pid=$(already_on "$port" || true)
  if [ -n "$existing_pid" ]; then
    echo "[dev-up] $label already on :$port (pid=$existing_pid) — reusing"
    echo "$label=$existing_pid" >> "$PIDS_FILE"
    return 0
  fi

  # 2) running already from this same process group?
  if [ -f "$PIDS_FILE" ]; then
    local prev
    prev=$(awk -F= -v label="$label" '$1==label {print $2}' "$PIDS_FILE" 2>/dev/null || true)
    if [ -n "$prev" ] && is_alive "$prev"; then
      echo "[dev-up] $label already running (pid=$prev) — reusing"
      return 0
    fi
  fi

  # 3) fresh launch
  echo "[dev-up] starting $label on :$port (log → $logfile)"
  nohup "$@" > "$logfile" 2>&1 &
  local pid=$!
  echo "$label=$pid" >> "$PIDS_FILE"
}

# Healthz port: 8799. The bridge binds 8787 only when started via
# VC_PORT. We start the WS bridge first (its healthz is the readiness
# signal).
if [ -z "$(already_on "$VC_PORT")" ]; then
  start_or_reuse "ws-bridge" "$VC_PORT" env VC_WS_PORT="$VC_PORT" VC_WS_HEALTH_PORT="$HEALTH_PORT" node scripts/dev-control-ws.mjs
fi

# Wait for /healthz to answer before booting Vite so a user can open
# the mobile page immediately.
echo "[dev-up] waiting for healthz on :$HEALTH_PORT ..."
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://127.0.0.1:$HEALTH_PORT/healthz" 2>/dev/null || echo "?")
  if [ "$code" = "200" ]; then break; fi
  sleep 0.25
done

# Vite — only if not already serving.
if [ -z "$(already_on "$VITE_PORT")" ]; then
  start_or_reuse "vite" "$VITE_PORT" env VITE_DEV_PORT="$VITE_PORT" npm run dev -- --port "$VITE_PORT"
fi

# Print the URLs the user actually needs.
cat <<EOF

┌─────────────────────────────────────────────────────────────────────┐
│ Sainted Word Records · visualizer-control dev shell                 │
├─────────────────────────────────────────────────────────────────────┤
│ Visualizer (in any browser):                                        │
│   http://127.0.0.1:$VITE_PORT/versions/aurora.html                  │
│   http://127.0.0.1:$VITE_PORT/versions/eclipse.html                 │
│   … (any of the 13 audio-reactive styles in versions/*.html)       │
│                                                                     │
│ Mobile controller (open on phone, same LAN):                       │
│   http://<your-dev-box-ip>:$VITE_PORT/tools/mobile/index.html       │
│                                                                     │
│ WebSocket bridge (driver connect target):                           │
│   ws://127.0.0.1:$VC_PORT                                            │
│   http://127.0.0.1:$HEALTH_PORT/healthz                              │
│                                                                     │
│ CLI drivers:                                                         │
│   node tools/agentic-set.mjs param sens 1.7                         │
│   python3 tools/osc-bridge.py    (UDP :9000)                        │
│                                                                     │
│ Stop with:   bash tools/dev-down.sh                                  │
└─────────────────────────────────────────────────────────────────────┘

This shell stays running. Logs are at:
  $LOG_DIR/{ws-bridge,vite}.log
EOF

echo "[dev-up] tailing both processes; Ctrl-C to drop to a shell."
echo "[dev-up] (the actual server processes keep running in background.)"
echo

trap 'echo "[dev-up] detached (servers still running). Use tools/dev-down.sh to stop."; exit 0' INT TERM

while true; do
  sleep 5
  # If the bridge died, surface it.
  if ! curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$HEALTH_PORT/healthz" 2>/dev/null; then
    echo "[dev-up] WARN: bridge healthz unavailable on :$HEALTH_PORT"
  fi
done
