#!/usr/bin/env bash
# statusline-omb.sh — OMB multiline statusline for Claude Code
# Reads JSON from stdin (Claude Code statusline protocol), outputs 3-5 ANSI lines.
# Style C: Compact Nerd
set -uo pipefail

# --- Project-local PATH --------------------------------------------------
# Prepend ${CLAUDE_PROJECT_DIR}/.claude/bin so the statusline finds jq when
# `omb init` / `omb update` installed it project-locally, even if the user
# shell PATH does not include that directory.
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  export PATH="${CLAUDE_PROJECT_DIR}/.claude/bin:${PATH}"
fi

# --- jq guard -----------------------------------------------------------
if ! command -v jq &>/dev/null; then
  printf 'OMB (jq missing — run: omb update)\n'
  exit 0
fi

# --- Read stdin (before width detection — needed for terminal.columns probe)
INPUT=$(cat)

# --- Terminal width detection ---------------------------------------------
TERM_WIDTH=${COLUMNS:-0}

# Only trust tput if stdout is a real TTY
if (( TERM_WIDTH == 0 )) && [[ -t 1 ]]; then
  TERM_WIDTH=$(tput cols 2>/dev/null || echo 0)
fi

# Try stty via /dev/tty
if (( TERM_WIDTH == 0 )); then
  TERM_WIDTH=$(stty size </dev/tty 2>/dev/null | awk '{print $2}')
  TERM_WIDTH=${TERM_WIDTH:-0}
fi

# Probe JSON input (future-proof if Claude Code adds terminal.columns)
if (( TERM_WIDTH == 0 )); then
  TERM_WIDTH=$(printf '%s' "$INPUT" | jq -r '.terminal.columns // 0' 2>/dev/null)
  TERM_WIDTH=${TERM_WIDTH:-0}
fi

# Conservative default — compact is better than hard-truncated
if (( TERM_WIDTH == 0 )); then
  TERM_WIDTH=50
fi

TERM_WIDTH=$(( TERM_WIDTH - 2 ))

# --- jq field extraction -------------------------------------------------
MODEL=$(printf '%s' "$INPUT" | jq -r '.model.display_name // "Unknown"')
CURRENT_DIR=$(printf '%s' "$INPUT" | jq -r '.workspace.current_dir // "unknown"')
FOLDER=$(basename "${CLAUDE_PROJECT_DIR:-$CURRENT_DIR}")
CTX_PCT=$(printf '%s' "$INPUT" | jq -r '.context_window.used_percentage // 0')
COST=$(printf '%s' "$INPUT" | jq -r '.cost.total_cost_usd // 0')
RATE_5H=$(printf '%s' "$INPUT" | jq -r '.rate_limits.five_hour.used_percentage // empty')
RATE_7D=$(printf '%s' "$INPUT" | jq -r '.rate_limits.seven_day.used_percentage // empty')
RESET_5H_TS=$(printf '%s' "$INPUT" | jq -r '.rate_limits.five_hour.resets_at // empty')
RESET_7D_TS=$(printf '%s' "$INPUT" | jq -r '.rate_limits.seven_day.resets_at // empty')
WORKTREE=$(printf '%s' "$INPUT" | jq -r '.worktree.name // empty')

# --- Effort level resolution --------------------------------------------
# statusline stdin JSON does not expose effortLevel, so we read it directly
# from settings files in precedence order (env > local > project > user).
resolve_effort() {
  if [[ -n "${CLAUDE_CODE_EFFORT_LEVEL:-}" ]]; then
    printf '%s' "$CLAUDE_CODE_EFFORT_LEVEL"
    return
  fi
  local candidates=(
    "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.local.json"
    "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json"
    "${HOME}/.claude/settings.json"
  )
  local f val
  for f in "${candidates[@]}"; do
    [[ -f "$f" ]] || continue
    val=$(jq -r '.effortLevel // empty' "$f" 2>/dev/null)
    if [[ -n "$val" ]]; then
      printf '%s' "$val"
      return
    fi
  done
}
EFFORT=$(resolve_effort)

# --- Git branch (fast: reads .git/HEAD only, no network) ------------------
BRANCH=$(git -C "$CURRENT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# --- Version caching (300s TTL) ------------------------------------------
VERSION_CACHE="/tmp/omb-version-cache"
VERSION="0.1.0"
VERSION_CACHE_TTL=300

# Portable mtime helper: BSD `stat -f %m` / GNU `stat -c %Y`.
# See .claude/rules/languages/shell.md — no GNU-only flags.
mtime_portable() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null
}

get_version() {
  # 1. Dev repo: read from source
  local init_file="${CLAUDE_PROJECT_DIR:-}/src/hook/__init__.py"
  if [[ -f "$init_file" ]]; then
    grep -oE '__version__ = "[^"]+"' "$init_file" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' && return
  fi
  # 2. Installed binary: ask omb/oh-my-braincrew for version
  local ver
  ver=$(omb version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)
  if [[ -n "$ver" ]]; then
    echo "$ver"
    return
  fi
  ver=$(oh-my-braincrew version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)
  if [[ -n "$ver" ]]; then
    echo "$ver"
    return
  fi
  echo "0.1.0"
}

if [[ -f "$VERSION_CACHE" ]]; then
  CACHE_MTIME=$(mtime_portable "$VERSION_CACHE")
  CACHE_MTIME=${CACHE_MTIME:-0}
  CACHE_AGE=$(( $(date +%s) - CACHE_MTIME ))
  # Invalidate the cache if the installed `omb` binary was rebuilt/reinstalled
  # more recently than the cache, even when still within TTL — so a fresh
  # install shows its new version immediately.
  OMB_BIN=$(command -v omb 2>/dev/null || true)
  BIN_MTIME=0
  if [[ -n "$OMB_BIN" ]]; then
    BIN_MTIME=$(mtime_portable "$OMB_BIN")
    BIN_MTIME=${BIN_MTIME:-0}
  fi
  if [[ "$CACHE_AGE" -lt "$VERSION_CACHE_TTL" && "$BIN_MTIME" -le "$CACHE_MTIME" ]]; then
    VERSION=$(cat "$VERSION_CACHE")
  else
    VERSION=$(get_version)
    printf '%s' "$VERSION" > "$VERSION_CACHE"
  fi
else
  VERSION=$(get_version)
  printf '%s' "$VERSION" > "$VERSION_CACHE"
fi

# --- Time remaining formatter ---------------------------------------------
fmt_remaining() {
  local reset_ts="$1"
  [[ -z "$reset_ts" ]] && return
  local now diff h m d
  now=$(date +%s)
  diff=$(( reset_ts - now ))
  (( diff <= 0 )) && return
  if (( diff < 3600 )); then
    m=$(( diff / 60 ))
    printf '%dm' "$m"
  elif (( diff < 86400 )); then
    h=$(( diff / 3600 ))
    m=$(( (diff % 3600) / 60 ))
    printf '%dh %02dm' "$h" "$m"
  else
    d=$(( diff / 86400 ))
    h=$(( (diff % 86400) / 3600 ))
    printf '%dd %02dh' "$d" "$h"
  fi
}

# --- ANSI colors ---------------------------------------------------------
RESET='\033[0m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
DIM='\033[90m'
CYAN='\033[36m'

# --- Progress bar --------------------------------------------------------
CTX_INT=${CTX_PCT%.*}
CTX_INT=${CTX_INT:-0}
FILLED=$(( CTX_INT * 10 / 100 ))
EMPTY=$(( 10 - FILLED ))
BAR=""
for (( i=0; i<FILLED; i++ )); do BAR="${BAR}█"; done
for (( i=0; i<EMPTY; i++ )); do BAR="${BAR}░"; done

if [[ "$CTX_INT" -ge 90 ]]; then
  BAR_COLOR="$RED"
elif [[ "$CTX_INT" -ge 70 ]]; then
  BAR_COLOR="$YELLOW"
else
  BAR_COLOR="$GREEN"
fi

# --- Cost formatting -----------------------------------------------------
COST_FMT=$(printf '%.2f' "$COST" 2>/dev/null || echo "0.00")

# --- Responsive helpers ---------------------------------------------------
MODEL_SHORT="${MODEL%% (*}"
# "Opus 4.6 (1M context)" -> "Opus 4.6"

truncate_str() {
  local s="$1" max="$2"
  if (( ${#s} > max )); then
    printf '%s' "${s:0:$((max-1))}…"
  else
    printf '%s' "$s"
  fi
}

# --- Line 1: OMB version │ folder (responsive) ---------------------------
VER_W=$(( 5 + ${#VERSION} ))
SEP_W=3
FOLDER_W=$(( 3 + ${#FOLDER} ))
FULL_W=$(( VER_W + SEP_W + FOLDER_W ))

if (( FULL_W <= TERM_WIDTH )); then
  # Tier 1: Full — version + folder
  printf '%b' "OMB v${VERSION} ${DIM}│${RESET} 📁 ${FOLDER}\n"
elif (( FOLDER_W <= TERM_WIDTH )); then
  # Tier 2: Folder only (drop version)
  printf '%b' "📁 ${FOLDER}\n"
elif (( TERM_WIDTH >= 5 )); then
  # Tier 3: Truncated folder
  BUDGET=$(( TERM_WIDTH - 3 ))
  FOLDER_T=$(truncate_str "$FOLDER" "$BUDGET")
  printf '%b' "📁 ${FOLDER_T}\n"
else
  # Tier 4: Floor — emit minimal label so the line is never empty
  printf '%b' "📁\n"
fi

# --- Line 2: Progress bar │ cost (responsive) ----------------------------
if (( TERM_WIDTH >= 25 )); then
  printf '%b' "${BAR_COLOR}${BAR}${RESET} ${CTX_INT}% ${DIM}│${RESET} \$${COST_FMT}\n"
elif (( TERM_WIDTH >= 15 )); then
  printf '%b' "${BAR_COLOR}${BAR}${RESET} ${CTX_INT}%\n"
else
  printf '%b' "${CTX_INT}%\n"
fi

# --- Line 3: Rate limits (only if present) --------------------------------
if [[ -n "$RATE_5H" || -n "$RATE_7D" ]]; then
  RATE_5H_INT=${RATE_5H%.*}
  RATE_5H_INT=${RATE_5H_INT:-0}
  RATE_7D_INT=${RATE_7D%.*}
  RATE_7D_INT=${RATE_7D_INT:-0}

  if [[ "$RATE_5H_INT" -ge 80 ]]; then
    C5H="$RED"
  elif [[ "$RATE_5H_INT" -ge 50 ]]; then
    C5H="$YELLOW"
  else
    C5H="$GREEN"
  fi

  if [[ "$RATE_7D_INT" -ge 80 ]]; then
    C7D="$RED"
  elif [[ "$RATE_7D_INT" -ge 50 ]]; then
    C7D="$YELLOW"
  else
    C7D="$GREEN"
  fi

  REMAIN_5H=$(fmt_remaining "$RESET_5H_TS")
  SEG_5H="${DIM}5H${RESET} ${C5H}${RATE_5H_INT}%${RESET}"
  [[ -n "$REMAIN_5H" ]] && SEG_5H="${SEG_5H} ${DIM}(${REMAIN_5H})${RESET}"

  REMAIN_7D=$(fmt_remaining "$RESET_7D_TS")
  SEG_7D="${DIM}7D${RESET} ${C7D}${RATE_7D_INT}%${RESET}"
  [[ -n "$REMAIN_7D" ]] && SEG_7D="${SEG_7D} ${DIM}(${REMAIN_7D})${RESET}"

  if (( TERM_WIDTH >= 40 )); then
    printf '%b' "${SEG_5H} ${DIM}│${RESET} ${SEG_7D}\n"
  elif (( TERM_WIDTH >= 25 )); then
    # Drop remaining time, keep percentages
    SEG_5H_SHORT="${DIM}5H${RESET} ${C5H}${RATE_5H_INT}%${RESET}"
    SEG_7D_SHORT="${DIM}7D${RESET} ${C7D}${RATE_7D_INT}%${RESET}"
    printf '%b' "${SEG_5H_SHORT} ${DIM}│${RESET} ${SEG_7D_SHORT}\n"
  elif (( TERM_WIDTH >= 12 )); then
    # 5H only
    SEG_5H_SHORT="${DIM}5H${RESET} ${C5H}${RATE_5H_INT}%${RESET}"
    printf '%b' "${SEG_5H_SHORT}\n"
  fi
  # < 12: suppress line entirely
fi

# --- Line 4: Branch / Worktree (responsive) ------------------------------
if [[ -n "$BRANCH" ]] && (( TERM_WIDTH >= 8 )); then
  BRANCH_DISPLAY="$BRANCH"
  if (( TERM_WIDTH >= 20 )); then
    BRANCH_BUDGET=$(( TERM_WIDTH - 3 ))  # 3 = "🌿 " (emoji=2 + space=1)
    if [[ -n "$WORKTREE" ]]; then
      BRANCH_BUDGET=$(( BRANCH_BUDGET - 12 ))  # 12 = " (worktree)"
    fi
    if (( BRANCH_BUDGET > 0 && ${#BRANCH} > BRANCH_BUDGET )); then
      BRANCH_DISPLAY=$(truncate_str "$BRANCH" "$BRANCH_BUDGET")
    fi
    if [[ -n "$WORKTREE" ]] && (( TERM_WIDTH >= 30 )); then
      printf '%b' "🌿 ${CYAN}${BRANCH_DISPLAY}${RESET} ${DIM}(worktree)${RESET}\n"
    else
      printf '%b' "🌿 ${CYAN}${BRANCH_DISPLAY}${RESET}\n"
    fi
  else
    # Very tight: just branch name, no emoji
    printf '%b' "${CYAN}${BRANCH}${RESET}\n"
  fi
fi

# --- Line 5: Model [EFFORT] (responsive) ---------------------------------
EFFORT_SEG=""
EFFORT_PLAIN_W=0
if [[ -n "$EFFORT" ]]; then
  EFFORT_UPPER=$(printf '%s' "$EFFORT" | tr '[:lower:]' '[:upper:]')
  case "$EFFORT" in
    low)    EFFORT_COLOR="$DIM" ;;
    medium) EFFORT_COLOR="$GREEN" ;;
    high|xhigh) EFFORT_COLOR="$YELLOW" ;;
    max)    EFFORT_COLOR="$RED" ;;
    *)      EFFORT_COLOR="$DIM" ;;
  esac
  EFFORT_SEG=" ${EFFORT_COLOR}[${EFFORT_UPPER}]${RESET}"
  EFFORT_PLAIN_W=$(( 3 + ${#EFFORT_UPPER} ))  # " [" + upper + "]"
fi

MODEL_W=$(( 3 + ${#MODEL} + EFFORT_PLAIN_W ))           # 3 = "⚡ "
MODEL_SHORT_W=$(( 3 + ${#MODEL_SHORT} + EFFORT_PLAIN_W ))

if (( MODEL_W <= TERM_WIDTH )); then
  printf '%b' "⚡ ${MODEL}${EFFORT_SEG}\n"
elif (( MODEL_SHORT_W <= TERM_WIDTH )); then
  printf '%b' "⚡ ${MODEL_SHORT}${EFFORT_SEG}\n"
elif (( 3 + ${#MODEL_SHORT} <= TERM_WIDTH )); then
  printf '%b' "⚡ ${MODEL_SHORT}\n"
elif (( TERM_WIDTH >= 5 )); then
  BUDGET=$(( TERM_WIDTH - 3 ))
  if (( BUDGET >= 2 )); then
    MODEL_T=$(truncate_str "$MODEL_SHORT" "$BUDGET")
    printf '%b' "⚡ ${MODEL_T}\n"
  fi
fi
