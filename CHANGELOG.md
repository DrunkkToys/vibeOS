# Changelog

## 0.5.1

- fix: `trinity thinking full` now stores `"full"` string instead of `null`
  — status correctly shows "manual" instead of "credit X%"
  — persists regardless of credit drops (true manual override)

## 0.5.0

- feat: progressive decadence — age-based scratchpad cache rotation
  (5min fresh → 1h warm/summary → 24h cold → 48h delete, 1000 file / 10MB limit)
- feat: research audit — scans scratchpad index + session state for WebFetch/WebSearch
  anti-patterns (domain chains 3+, redundant queries, context7 bypass)
- feat: reporting framework — persistent reports with consistent schema
  (auto-saved from research-audit, save/list/read tools, plain-text findings parser)
- feat: project memory — cross-session continuity via project-states.json
  (session counter, research patterns, one-shot briefing on fresh session)
- feat: research-audit, report-save, report-list, report-read tools (5 total)
- fix: _refreshModel no longer forces currentTier="high" for non-brain slots
- fix: init tier override only fires for brain slot (not all slots)
- fix: auto-save moved before early return for totalFetches=0
- fix: saveReport now auto-parses plain-text findings/metrics (JSON fallback)
- fix: dedup prevents duplicate auto-saves within 5-minute window
- fix: TTL prune deletes reports >90d, keeps max 200
- fix: add ={} to all tool execute signatures to prevent destructuring crash
- fix: null-guard _wouldBeDuplicate for null summary
- fix: null-guard summary.slice() in report index update
- test: deep test (43 pass, 0 fail — module, hooks, routing, project memory)
- test: mid-tier / brain-slot / credit path test (10/10 pass)
- test: report framework lifecycle (14/14 pass)
- test: 4 report fixes (plain-text, dedup, TTL, narrative)
- test: VENV stress test (57 pass, 2 false-positive from test sequencing)
- perf: atomic lifetime reads — compute ltTasks+ltCache from single session snapshot
- perf: getLastLines — 5-line/1024-byte tail replaces fragile 200-byte dedup
- perf: _readHead — 120-byte header-only read for decadence idempotency checks

## 0.4.9

- chore: bump v0.4.9

## 0.4.8

- fix: scratchpad hash mismatch — stable JSON key sorting matches CC shasum
- fix: cross-process log dedup — read file tail instead of per-process cache
- fix: scratchpad inline size cap — auto-prune >2000 files or >20MB
- fix: clean up savings tag — remove verbose "delegation + cache" breakdown

## 0.4.7

- feat: flow enforcer — lightweight dev-flow rule checks on Write/Edit
  (fast-path regex, never blocks, dedup per rule+file per session)
- feat: `trinity flow` / `trinity flow on|off` — audit and toggle
- test: 9 new flow enforcer unit tests (64 total)
- fix: log rotation mtime guard to prevent repeated full-file reads

## 0.4.6

- test: 6 new stall-fix tests (system.transform, messages.transform, tool.execute.after)
- fix: only inject thinking directive when manually set via `trinity thinking`
- refactor: remove auto credit-based thinking injection (caused stalls)

## 0.4.5

- fix: remove thinking directive from system prompt (caused model stalls)
- fix: replace imperative "Full content: Read <path>" with neutral cold-storage ref
- fix: remove Task output compression — brain needs results verbatim
- fix: only compress webfetch output (HTML/CSS noise)

## 0.4.4

- fix: dedup session-reports.log writes — skip if line unchanged
- fix: rotate session-reports.log at 500 lines to prevent unbounded growth
- fix: add pid to log timestamps to distinguish concurrent writers
- fix: show delegation vs cache breakdown in savings tag
- fix: prune stale sessions from delegation-state.json (keep latest 30)

## 0.4.2

- bump: version 0.4.2
- feat: credit API balance fetching (DeepSeek + OpenRouter)
- fix: thinking level defaults to brief instead of off
- fix: credit default 50% for sane fallback


## 0.3.4

- bump: version 0.3.4

## 0.3.0

- bump: version 0.3.0

## 0.2.4

- bump: version 0.2.4

## 0.2.3b

- bump: version 0.2.3b

## 0.2.3a

- bump: version 0.2.3a

## 0.2.2

- bump: version 0.2.2

## 0.2.1

- bump: version 0.2.1

## 0.2.0

- feat: align alert schema with CC hook; add 4 new tests (39 total)
- fix: align WRITE_EDIT to $0.07 to match bash hook; fix stale test values
- feat: port CC features to OC plugin + 35 tests all passing

## 0.1.0

- Initial release — theSaver-oc v3
