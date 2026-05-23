#!/bin/bash
# SPDX-License-Identifier: MIT
# Nightly Experiment Cron Entry — runs 00:00-00:59
# Install: crontab -e
# Add: 0 0 * * * /path/to/vibeOS/scripts/nightly-experiment.sh >> ~/.claude/experiment-cron.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCKFILE="$HOME/.claude/.vibeOS-locks/nightly-experiment.lock"

# Abort if already running
if [ -f "$LOCKFILE" ]; then
  echo "$(date): Experiment already running (lockfile exists). Aborting."
  exit 0
fi

# Abort if not within the 00:00-00:59 window (belt-and-suspenders check)
HOUR=$(date +%H)
if [ "$HOUR" -ne 0 ]; then
  echo "$(date): Not in experiment window (hour=$HOUR). Aborting."
  exit 0
fi

echo "=========================================="
echo "$(date): vibeOS Nightly Experiment — START"
echo "=========================================="

mkdir -p "$HOME/.claude/.vibeOS-locks"
touch "$LOCKFILE"

cd "$SCRIPT_DIR/.."

START_TS=$(date +%s)
DEADLINE=$((START_TS + 3540)) # 59 minutes

# ── Step 1: Sync model pricing (24h refresh) ─────────────────
echo "$(date): [PRICING] Syncing model pricing from OpenRouter..."
node scripts/sync-pricing.mjs >> "$HOME/.claude/pricing-sync-cron.log" 2>&1
PRICE_EXIT=$?
echo "$(date): [PRICING] Done (exit $PRICE_EXIT)"

# ── Step 2: Warn if v4-pro promo is ending (after May 31, price x4) ──
NOW_EPOCH=$(date +%s)
PROMO_END_EPOCH=$(date -j -f "%Y-%m-%d" "2026-05-31" +%s 2>/dev/null || echo 0)
DAYS_LEFT=$(( (PROMO_END_EPOCH - NOW_EPOCH) / 86400 ))
if [ "$DAYS_LEFT" -gt 0 ] && [ "$DAYS_LEFT" -le 30 ]; then
  echo "$(date): [PRICING] WARNING: v4-pro 75% discount expires in ${DAYS_LEFT} days (May 31). Price jumps 4x."
fi

# ── Step 3: Nightly experiment ────────────────────────────────
node scripts/nightly-experiment.mjs
EXIT=$?

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))
echo "$(date): Completed in ${ELAPSED}s with exit code $EXIT"

# Show summary if available
if [ -f "$HOME/.claude/experiment-results-summary.json" ]; then
  echo "---"
  echo "Latest conclusion:"
  node -e "const s = require('$HOME/.claude/experiment-results-summary.json'); console.log('  ' + s.conclusion); console.log('  Quality wins:', s.aggregates.quality.wins, '/ Budget wins:', s.aggregates.budget.wins)"
  echo "---"
fi

rm -f "$LOCKFILE"
echo "$(date): Done."
exit $EXIT
