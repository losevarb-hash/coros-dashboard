#!/bin/bash
# Еженедельное обновление дашборда Coros.
# 1) тянет свежий снимок через coros-mcp (локально, токен не уезжает)
# 2) шифрует его ключом из PIN в public/coros.enc.json
# 3) коммитит и пушит только зашифрованный файл
# GitHub Actions пересобирает Pages на пуш.
#
# Запуск: scripts/weekly_refresh.sh  (см. launchd-плист рядом)
set -euo pipefail

REPO="$HOME/code/coros-dashboard"
cd "$REPO"

# PATH для launchd (там он урезанный): homebrew + системный
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

LOG="$REPO/refresh.log"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') refresh start ===" >> "$LOG"

python3 scripts/coros_fetch.py            >> "$LOG" 2>&1
COROS_PIN="${COROS_PIN:-4832}" node scripts/encrypt_data.mjs >> "$LOG" 2>&1

git add public/coros.enc.json
if git diff --cached --quiet; then
  echo "no data change, skip commit" >> "$LOG"
else
  git commit -q -m "data: weekly Coros snapshot $(date '+%Y-%m-%d')" >> "$LOG" 2>&1
  git push -q origin main >> "$LOG" 2>&1
  echo "pushed" >> "$LOG"
fi
echo "=== refresh done ===" >> "$LOG"
