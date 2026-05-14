# Changelog

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
