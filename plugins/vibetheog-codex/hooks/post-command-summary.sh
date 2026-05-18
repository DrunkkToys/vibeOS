#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOG_DIR="$ROOT_DIR/.codex-logs"
LOG_FILE="$LOG_DIR/vibetheog-codex.log"
mkdir -p "$LOG_DIR"

TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
CMD="${1:-unknown-command}"
STATUS="${2:-unknown-status}"

printf "%s | cmd=%s | status=%s\n" "$TS" "$CMD" "$STATUS" >> "$LOG_FILE"
echo "[VibeTheOG-codex] summary logged: $LOG_FILE"
