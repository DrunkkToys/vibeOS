#!/bin/bash
# Same arm and tiers as runs 6/7. The only variable is the api-client fallback
# cooldown: runs 6/7 paid a 7s retry ladder on every remote call because the
# breaker never latched, which put ~49s of dead time before every model step.
# Run 6 (no cooldown, no stable prefix): diagnose 856s, fix-batching 403s, fix-rest HANG 3022s.
# Run 7 (no cooldown, stable prefix):    diagnose 313s, fix-batching 244s, fix-rest HANG 2990s.
cd /Users/drunkktoys/Desktop/theSaver-oc || exit 1
export VIBEOS_STABLE_PREFIX=1
nohup node scripts/e2e/ml-impact.mjs \
  --model opencode/mimo-v2.5-free \
  --k 1 --arms vibeultrax --out .ml-run8 \
  --turn-timeout 1200000 --mock-port 48184 \
  > .ml-run8.console.log 2>&1 &
echo $! > .ml-run8.pid
disown
echo "launched pid $(cat .ml-run8.pid) -> .ml-run8"
