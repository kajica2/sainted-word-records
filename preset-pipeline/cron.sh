#!/usr/bin/env bash
# cron.sh — daily preset generator + verifier.
# Run via crontab or hf Space scheduled task. Idempotent: safe to run multiple times per day.
#
# Crontab example (run at 09:00 every day, log to a file):
#   0 9 * * *  cd /Users/kajicadjuric/Documents/daily/visual-preset-pipeline && ./cron.sh >> out/cron.log 2>&1
#
# HF Space scheduled task: same command, set the Space's schedule to daily.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

COUNT="${COUNT:-2}"
SEED="${SEED:-$(date +%Y%m%d)}"

echo "[$(date -Iseconds)] generating $COUNT preset(s) with seed $SEED"
python3 generate.py --count "$COUNT" --seed "$SEED"

echo "[$(date -Iseconds)] verifying"
node verify.mjs

echo "[$(date -Iseconds)] done"
