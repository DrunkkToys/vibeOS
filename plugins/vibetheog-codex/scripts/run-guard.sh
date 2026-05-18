#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

echo "[VibeTheOG-codex] guard: start"

# Baseline checks should be fast and stable for hook usage.
if [ -f "plugins/vibetheog-codex/.codex-plugin/plugin.json" ]; then
  node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync("plugins/vibetheog-codex/.codex-plugin/plugin.json","utf8"));'
  echo "[VibeTheOG-codex] guard: plugin manifest JSON valid"
else
  echo "[VibeTheOG-codex] guard: missing plugin manifest" >&2
  exit 1
fi

if [ "${VIBETHEOG_GUARD_FULL:-0}" = "1" ]; then
  if command -v npm >/dev/null 2>&1 && [ -f package.json ]; then
    echo "[VibeTheOG-codex] guard: VIBETHEOG_GUARD_FULL=1 -> running full tests"
    npm test --silent
  else
    echo "[VibeTheOG-codex] guard: full mode requested but npm/package.json unavailable" >&2
    exit 1
  fi
else
  echo "[VibeTheOG-codex] guard: full test suite skipped (set VIBETHEOG_GUARD_FULL=1 to enable)"
fi

echo "[VibeTheOG-codex] guard: ok"
