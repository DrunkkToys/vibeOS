#!/bin/bash
# vibeultrax alone against the routing fix (f0902c39). This arm has voided on
# `diagnose` five consecutive times against the pre-fix bundle; the question is
# whether reading the backend slot decision lets it leave the cheap slot and
# finish the turn at all.
cd /Users/drunkktoys/Desktop/theSaver-oc || exit 1
nohup node scripts/e2e/ml-impact.mjs \
  --model opencode/mimo-v2.5-free \
  --k 1 \
  --arms vibeultrax \
  --out .ml-run6 \
  --turn-timeout 1200000 \
  --mock-port 48181 \
  > .ml-run6.console.log 2>&1 &
echo $! > .ml-run6.pid
disown
echo "launched pid $(cat .ml-run6.pid) -> .ml-run6"
