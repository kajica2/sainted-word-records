#!/usr/bin/env bash
# SWR Multi-Agent Team Starter — now on MiniMax.
# Usage: ./agents/start-team.sh [agent]
#
# WHAT CHANGED AND WHY
# ---------------------
# This used to launch three `claude` CLI sessions with
# `--system-role agents/roles/ops.md` / `agents/roles/twin.md` /
# `agents/roles/check.md`. Two problems with that:
#
#   1. Those paths do not exist. The role files are `agents/swr-ops.md`,
#      `agents/swr-twin.md` and `agents/swr-check.md`, so every agent
#      started with a missing system role.
#   2. It pinned the team to Claude. The CI factory now runs on MiniMax
#      (software-factory/routing.config.json), and a local team that
#      judges work differently from the one in CI is a trap.
#
# Now every agent starts through software-factory/swr-agent.mjs, which
# reads the same routing config, the same role files and the same model
# per agent. One source of truth for the laptop and for CI.
#
# REQUIREMENTS
#   export MINIMAX_API_KEY=...            # https://platform.minimax.io
#   node >= 18                            # the bridge uses global fetch
#   the twin checkout at ../digital_twin  # for SWR-Twin's voice samples
#
# The model per agent comes from agents/team.config.json, and the fallback
# chain from software-factory/routing.config.json:
#   SWR-Ops   → minimax/MiniMax-M3         (planning, adaptive thinking)
#   SWR-Twin  → minimax/MiniMax-M2.7       (creative, 8k thinking budget)
#   SWR-Check → minimax/MiniMax-M3.1-Flash (verification, effort=low)
#
# Every provider key is optional. The ones you have not set are skipped and
# the chain moves on to the next model.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIGITAL_TWIN_ROOT="$REPO_ROOT/../digital_twin"
BRIDGE="$REPO_ROOT/software-factory/swr-agent.mjs"

echo "════════════════════════════════════════════════════════════"
echo "  🌀 SWR Multi-Agent Team Starter (MiniMax)"
echo "════════════════════════════════════════════════════════════"
echo ""

if [ ! -f "$BRIDGE" ]; then
    echo "❌ Error: the MiniMax bridge is missing at $BRIDGE"
    exit 1
fi

if [ -z "${MINIMAX_API_KEY:-}" ] && [ -z "${OPENCODE_API_KEY:-}" ] && [ -z "${XAI_API_KEY:-}" ] && [ -z "${GEMINI_API_KEY:-}" ]; then
    echo "❌ Error: no provider key is set."
    echo "   The factory needs at least one of:"
    echo "     MINIMAX_API_KEY   https://platform.minimax.io → Account → API keys"
    echo "     OPENCODE_API_KEY  https://opencode.ai/auth"
    echo "     XAI_API_KEY       https://console.x.ai"
    echo "     GEMINI_API_KEY    https://aistudio.google.com/apikey"
    exit 1
fi

if [ ! -d "$DIGITAL_TWIN_ROOT" ]; then
    echo "⚠️  Warning: digital_twin/ not found at $DIGITAL_TWIN_ROOT"
    echo "   SWR-Twin can still run, but it has no voice samples to read."
    echo ""
fi

LOG_DIR="$REPO_ROOT/tasks/.logs"
mkdir -p "$LOG_DIR"

ONLY_AGENT="${1:-}"
PIDS=()

launch() {
    local name="$1"
    local task="$2"
    local extra="${3:-}"

    if [ -n "$ONLY_AGENT" ] && [ "$ONLY_AGENT" != "$name" ]; then
        return
    fi

    echo "  ▶ $name ($task)…"
    (
        cd "$REPO_ROOT"
        node "$BRIDGE" chat \
            --agent "$name" \
            --task "$task" \
            $extra \
            2>&1 | tee "$LOG_DIR/${name,,}-$(date +%Y%m%d-%H%M%S).log"
    ) &
    PIDS+=($!)
}

# SWR-Ops (orchestrator) — owns agents/TASKS.md
launch "SWR-Ops" "planning" "--allow-writes"

# SWR-Twin (digital twin) — creative work, decisions
launch "SWR-Twin" "creative" ""

# SWR-Check (verifier) — read-only, cannot write
launch "SWR-Check" "verification" ""

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✅ Team launched on MiniMax"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "📝 Logs: $LOG_DIR/"
echo "   - swr_ops-*.log"
echo "   - swr_twin-*.log"
echo "   - swr_check-*.log"
echo ""
if [ ${#PIDS[@]} -gt 0 ]; then
    echo "🛑 To stop all agents:  kill ${PIDS[*]}"
fi
echo ""

wait
