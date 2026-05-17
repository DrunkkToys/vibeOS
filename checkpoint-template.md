# Checkpoint Template

Use this template for every long-running checkpoint and handoff.

## 1) Metadata
- Checkpoint ID: `CP-YYYYMMDD-HHMM`
- Timestamp (UTC): `YYYY-MM-DDTHH:MM:SSZ`
- Author:
- Session ID / Thread:

## 2) Repo State
- Branch:
- HEAD commit:
- Working tree status summary:

## 3) Task Ledger
| Task ID | Title | State (`todo`/`in_progress`/`done`/`dropped`) | Notes |
|---|---|---|---|
| T-001 |  |  |  |

## 4) Commands Run
List every significant command with outcome.
- `npm run typecheck` — pass/fail
- `npm run build` — pass/fail
- `npm test` — pass/fail

## 5) File Changes
Paste `git diff --stat` output for this checkpoint.

```text
# paste exact output here
```

## 6) Orphan Signals
Log important observations that are not mapped to a Task ID yet.
- Example: warning spikes, flaky tests, unexpected logs, state-file anomalies.

## 7) Risks & Assumptions
- Risk:
- Assumption:
- Mitigation:

## 8) Handoff Readiness
- [ ] Task ledger states are current
- [ ] File changes are captured (`git diff --stat`)
- [ ] Failing checks (if any) are documented with root cause
- [ ] Next 1–3 actions are explicit

## 9) Next Actions
1. 
2. 
3. 
