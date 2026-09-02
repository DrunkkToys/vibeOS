#!/bin/bash
# Same arm and tiers as run 6; the only variable is VIBEOS_STABLE_PREFIX.
# Run 6 (flag off): diagnose 856s ok, fix-batching 403s ok, fix-rest HANG 3022s.
cd /Users/drunkktoys/Desktop/theSaver-oc || exit 1
export VIBEOS_STABLE_PREFIX=1
nohup node scripts/e2e/ml-impact.mjs \
  --model opencode/mimo-v2.5-free \
  --k 1 --arms vibeultrax --out .ml-run7 \
  --turn-timeout 1200000 --mock-port 48183 \
  > .ml-run7.console.log 2>&1 &
echo $! > .ml-run7.pid
disown
echo "launched pid $(cat .ml-run7.pid) -> .ml-run7 (VIBEOS_STABLE_PREFIX=1)"
