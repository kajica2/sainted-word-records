#!/usr/bin/env bash
# tools/dev-ps.sh — report on the visualizer-control server shelf.
#
# Prints the status of the three ports:
#   5174 — Vite (visualizer pages)
#   8787 — WS bridge (driver connect target)
#   8799 — healthz (peer list endpoint)
#
# Plus pids, the .dev-pids registry, and tool/connection counts.
#
# Safe to call any time. Reads only. Reversible by definition.

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

probe() {
  local port="$1" name="$2"
  local pid
  pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [ -n "$pid" ]; then
    local cmd
    cmd=$(ps -o command= -p "$pid" 2>/dev/null | sed 's/[[:space:]]\+/ /g' | cut -c1-60)
    printf '  %-7s  %-22s  UP   pid=%-6s  %s\n' "$port" "$name" "$pid" "$cmd"
  else
    printf '  %-7s  %-22s  down\n' "$port" "$name"
  fi
}

peers() {
  local hz
  hz=$(curl -s --max-time 1 "http://127.0.0.1:8799/healthz" 2>/dev/null)
  if [ -z "$hz" ]; then echo "  (no healthz — bridge likely down)"; return 0; fi
  local n_viz n_drv
  n_viz=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log((j.peers||[]).filter(p=>p.role==='visualizer').length+' visualizers, '+(j.peers||[]).filter(p=>p.role!=='visualizer').length+' drivers');}catch(e){}})" <<<"$hz" 2>/dev/null)
  printf '  peers: %s\n' "${n_viz:-unknown}"
}

echo "SWR · visualizer-control server shelf"
echo
probe 5174 "vite"
probe 8787 "ws-bridge"
probe 8799 "healthz"
echo
peers
echo
if [ -f "$ROOT/tools/.dev-pids" ]; then
  echo "tools/.dev-pids:"
  if [ -s "$ROOT/tools/.dev-pids" ]; then
    sed 's/^/  /' "$ROOT/tools/.dev-pids"
  else
    echo "  (empty)"
  fi
else
  echo "tools/.dev-pids: (file missing)"
fi
