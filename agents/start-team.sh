#!/usr/bin/env bash
# SWR Multi-Agent Team Starter
# Usage: ./agents/start-team.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIGITAL_TWIN_ROOT="$REPO_ROOT/../digital_twin"

echo "════════════════════════════════════════════════════════════"
echo "  🌀 SWR Multi-Agent Team Starter"
echo "════════════════════════════════════════════════════════════"
echo ""

# Check prerequisites
if [ ! -d "$DIGITAL_TWIN_ROOT" ]; then
    echo "❌ Error: digital_twin/ not found at $DIGITAL_TWIN_ROOT"
    echo "   Expected: ../digital_twin/ relative to repo root"
    exit 1
fi

LOG_DIR="$REPO_ROOT/tasks/.logs"
mkdir -p "$LOG_DIR"

# Helper to check if a process is running
check_process() {
    local name="$1"
    local pattern="$2"
    if pgrep -f "$pattern" > /dev/null 2>&1; then
        echo "  ✅ $name"
        return 0
    else
        echo "  ⚪ $name (not running)"
        return 1
    fi
}

echo "📊 Watcher Status:"
echo "─────────────────────────────────────────────────────────"
check_process "Instagram Watcher" "ig-watcher"
check_process "YouTube Watcher" "youtube-batch"
check_process "Midjourney Watcher" "mj-watcher"
check_process "Reel Watcher" "reel-watcher"
check_process "Chart Watcher" "chart-watcher"
check_process "Songs Watcher" "songs-watcher"
echo ""

# Check for Claude CLI
if ! command -v claude &> /dev/null; then
    echo "⚠️  Warning: 'claude' CLI not found in PATH"
    echo "   Install from: https://docs.anthropic.com/en/docs/claude-code"
    echo ""
fi

# Start the team
echo "🚀 Starting SWR Team Agents..."
echo "─────────────────────────────────────────────────────────"

# SWR-Ops (orchestrator)
echo "  ▶ SWR-Ops (orchestrator)..."
(
    cd "$REPO_ROOT"
    claude \
        --project "$REPO_ROOT" \
        --system-role "agents/roles/ops.md" \
        --name "SWR-Ops" \
        2>&1 | tee "$LOG_DIR/swr-ops-$(date +%Y%m%d-%H%M%S).log"
) &
OPS_PID=$!

# SWR-Twin (digital twin)
echo "  ▶ SWR-Twin (digital twin)..."
(
    cd "$DIGITAL_TWIN_ROOT"
    claude \
        --project "$DIGITAL_TWIN_ROOT" \
        --system-role "agents/twin.md" \
        --name "SWR-Twin" \
        2>&1 | tee "$LOG_DIR/swr-twin-$(date +%Y%m%d-%H%M%S).log"
) &
TWIN_PID=$!

# SWR-Check (verifier)  
echo "  ▶ SWR-Check (verifier)..."
(
    cd "$REPO_ROOT"
    claude \
        --project "$REPO_ROOT" \
        --system-role "agents/roles/check.md" \
        --name "SWR-Check" \
        2>&1 | tee "$LOG_DIR/swr-check-$(date +%Y%m%d-%H%M%S).log"
) &
CHECK_PID=$!

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✅ Team launched!"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "📝 Log files: $LOG_DIR/"
echo "   - swr-ops-*.log"
echo "   - swr-twin-*.log" 
echo "   - swr-check-*.log"
echo ""
echo "🛑 To stop all agents:"
echo "   kill $OPS_PID $TWIN_PID $CHECK_PID"
echo ""

# Wait for all processes
wait
