#!/bin/bash
# bin/deploy-gh-pages.sh — Commit, push, deploy to GitHub Pages, open in browser

set -e

cd ~/Documents/sainted-word-records

# Check for uncommitted changes
if [[ -n "$(git status --porcelain)" ]]; then
    echo "[deploy] Uncommitted changes found. Adding all..."
    git add -A
    git status
    echo "[deploy] Enter commit message (or press Enter for default):"
    read -r msg
    if [[ -z "$msg" ]]; then
        msg="Update: $(date '+%Y-%m-%d %H:%M')"
    fi
    git commit -m "$msg"
else
    echo "[deploy] No changes to commit."
fi

# Push to main
echo "[deploy] Pushing to origin/main..."
git push origin main

# Wait for GitHub Pages to deploy
echo "[deploy] Waiting for GitHub Pages to deploy..."
sleep 10

# Open in browser
echo "[deploy] Opening GitHub Pages..."
open https://kajica2.github.io/sainted-word-records/

echo "[deploy] Done!"
