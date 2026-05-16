#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

echo "[theSaver-codex] guard: start"

# Baseline checks should be fast and stable for hook usage.
if [ -f "plugins/thesaver-codex/.codex-plugin/plugin.json" ]; then
  node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync("plugins/thesaver-codex/.codex-plugin/plugin.json","utf8"));'
  echo "[theSaver-codex] guard: plugin manifest JSON valid"
else
  echo "[theSaver-codex] guard: missing plugin manifest" >&2
  exit 1
fi

if [ "${THESAVER_GUARD_FULL:-0}" = "1" ]; then
  if command -v npm >/dev/null 2>&1 && [ -f package.json ]; then
    echo "[theSaver-codex] guard: THESAVER_GUARD_FULL=1 -> running full tests"
    npm test --silent
  else
    echo "[theSaver-codex] guard: full mode requested but npm/package.json unavailable" >&2
    exit 1
  fi
else
  echo "[theSaver-codex] guard: full test suite skipped (set THESAVER_GUARD_FULL=1 to enable)"
fi

echo "[theSaver-codex] guard: ok"
