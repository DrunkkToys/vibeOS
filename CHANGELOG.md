## 0.13.2

- fix: add missing stub exports to `state.ts` (computeSavingsPayload, computeStatusPayload, etc.) to resolve ESM import errors in pre-commit hooks and isolated tests
- fix: sync all compiled `.js` artifacts from `dist-ts/` to `src/lib/` to fix test environment imports

## 0.13.1

- feat: `trinity optimize` command — 5 session-level modes (budget/quality/speed/longrun/auto) with cache-savings-driven auto switching
- feat: blackbox `OptimizationMode` delta tables — per-mode overrides for all 10 control knobs
- feat: turn counter + proactive context compaction every 10 turns
- feat: `autoSelectMode()` — auto switches budget/balanced/quality per sub-regime based on session cache savings
- feat: footer optimization mode tag (`[BUDGET]`, `[QUALITY]`, `[SPEED]`, `[LONGRUN]`, `[AUTO→BUDGET]`)
- feat: per-session mode persistence in `blackbox-state.json` (resets to `auto` on restart)
- feat: mode-specific system prompt directive injection
- feat: mode locked for session — blackbox CANNOT override user-set mode

## 0.13.0

- refactor: extract 16 modules from src/index.ts into src/lib/ (state, pricing, trinity, TDD, hooks, reporting, research-audit, api-client, credit-api, turn-classify, index-helpers)
- feat: blackbox dynamically controls thinking mode per sub-regime for cost savings
- fix: flow-enforcer race condition, blackbox default ON, dynamic footer improvement
- fix: lock model name, enforcement logging, TDD framework detection, cache display rounding
- perf: conditional directive injection — skip TDD/FLOW/orchestrator when control vector signals relaxed mode
- fix: model split always shown, stress inline in footer, not separate line
- fix: atomic state writes, safeJsonParse in flow-enforcer, hook error handling
- perf: inline stress in footer, remove session-report writes, disable blackbox default
- docs: AGENTS.md updated — 8 hooks (added session.compacting), new src/lib/ architecture
- docs: README updated — added Architecture section with src/lib/ module descriptions

## 0.12.0 (production readiness stabilisation)

- feat: production-ready feature inventory and documentation reconciliation
- feat: complete test coverage — 362 passing tests, all skeleton files filled
- fix: error handling — added null-safe DelegationEnforcer default parameter
- fix: error handling — wrapped all scratchpad I/O in try/catch guards
- fix: error handling — safeJsonParse adopted in parseJsonc for JSONC tolerance
- fix: state file integrity — atomic write-then-rename for all 7 state file writers
- fix: state file integrity — corruption recovery with backup + logging for all 8 readers
- fix: state file integrity — 10MB size limits prevent OOM on corrupt files
- fix: MCP server — CORS headers, request logging, input validation, path traversal protection
- fix: API server — input validation, error handling, SQL injection protection on all 15 route files
- fix: API server — auth middleware hardening (suspended seat handling, master key auth)
- fix: scripts — demo_timer.mjs corruption fix, release.mjs syntax fix, sync-ts-build.mjs mapping fix
- fix: CI/CD — node 20/22 matrix, build step, new release.yml workflow
- fix: build chain — orphaned dist-ts/ artifacts removed, all TS file mappings verified
- docs: AGENTS.md — added 7th hook, 8 missing .ts files, 9 missing state files
- docs: README — added 4 env vars, 3 trinity commands

## 0.11.0
- feat: per-session model lock (`trinity lock on|off`) — prevents auto-reconcile with OpenCode config changes
- feat: lock status shown in `trinity status` guards and live footer (`LOCK` tag)
- feat: blackbox real feature extraction — 11 derived features per turn (word count, question ratio, urgency, sentiment, complexity, etc.)
- feat: blackbox loop prevention — 4-level escalating intervention (gentle → suggestive → assertive → escalated) injected into system prompts
- feat: blackbox PIVOT/SWITCH detection — detects context changes outside project scope via drift rate + instruction density change
- feat: blackbox outcome tracking — detects satisfaction signals from assistant responses (positive/negative/neutral)
- feat: blackbox online calibration — `POST /api/v1/blackbox/calibrate` auto-tunes thresholds from session outcomes per project
- feat: blackbox cross-session continuity — project-scoped session keys (not PID), state persists across terminal restarts
- feat: blackbox API server unification — API server now imports shared ResolutionTracker (removed duplicate implementation)
- feat: `blackbox_calibration` SQLite table for per-project calibrated weights
- feat: `blackbox_sessions` now includes outcome column, `/api/v1/blackbox/outcome`, `/api/v1/blackbox/calibration`, `/api/v1/blackbox/project-sessions` endpoints
- refactor: blackbox moved to API-server-only — plugin uses local stub, full engine runs on server
- docs: README and AGENTS updated with model lock, blackbox engine, and calibration documentation

## 0.9.3
- fix: MCP server now starts during DelegationEnforcer init (was trapped in orphaned computeStatusPayload)
- fix: add mcp_port auto-write to model-tiers.json on init
- fix: initialize cache_savings_usd in state file on first write
- fix: deploy.mjs now copies vibeOS-lib/ (including blackbox) and vibeOS-mcp-server.js

## 0.9.2
- fix: resolution-tracker thresholds — isConverging `> 0.5` → `>= 0.5`
- fix: resolution-tracker thresholds — detectLoop Jaccard 0.8 → 0.6
- fix: resolution-tracker thresholds — isRefining `entropyTrend >= 0` → `> -0.01`
- test: add blackbox evaluation harness with per-regime precision/recall/F1

## 0.9.1
- feat: vibeOS MCP server HTTP API
- feat: vibeOS TUI dashboard sidebar plugin
- chore: sync-ts-build and flow-enforcer enhancements

## 0.9.0
- feat: stress-mitigation pipeline — detect, warn, harden, reroute
- fix: TDD skeleton now fires for task subagent file writes
- fix: smart sub-cent display and 4dp precision for cache savings
- fix: _refreshModel now reconciles with actual opencode.json model
- refactor: full decouple — VibeTheOG → vibeOS branding, dirs, reports, test paths
- docs: add AGENTS.md — immutable project spec for all LLMs
Merge pull request #1 from DrunkkToys/experiment/process-data-py
Document pattern learner commands and claimed feature
Add routine-pattern promotion regression test
fix telemetry precision and cross-project session linkage
rename: VibeTheOG → vibeOS
rename to VibeTheOG and fix OpenCode manifest/plugin path consistency
release: bump to v0.8.0 and sync stability hardening


# Changelog

## 0.8.1

- fix: reduce dummy actions by gating auto TDD skeleton creation to explicit test intent (or direct test-path edits)
- feat: add active-job persistence and off-topic detection to prompt for scope confirmation before write/edit/task actions
- chore: patch release bump and docs version sync

## 0.8.0

- chore: minor release bump for stabilized release candidate
- test: re-validated first-install flow, slot switching, footer integrity, and neutral-environment gates

## 0.7.15

- fix: footer tier refresh now follows active slot changes even when model id is unchanged
- test: added regression coverage for slot-switch tier updates and stabilized classify fixtures
- test: neutral-environment validation (`env -i`) re-run before release bump

## 0.7.14

- test: release hardening pass with expanded adversarial coverage (20 tiger-team checks) and full gate validation
- test: neutral-environment parity validation (`env -i`) confirms typecheck/build/test stability matches baseline
- test: pre-existing failing write-enforcement test fixed via deterministic model-tiers fixture setup
- chore: add checkpoint reliability tooling
  - new `checkpoint-template.md` for structured session handoff
  - new `scripts/checkpoint-validate.mjs` for schema validation (sections, task IDs/states, diff-stat evidence, handoff checklist)
  - new `scripts/tests/checkpoint-validate.test.mjs` with pass/fail fixture coverage
  - new npm scripts: `checkpoint:validate`, `test:scripts`
- docs: release readiness and SI/cross-session validation workflow standardized for safer iteration

## 0.7.13

- fix: production plugin load hardening — remove hidden `../utils/timer.js` dependency from `session-metrics.js`
- fix: plugin install payload completeness — include `src/VibeTheOG-lib/session-metrics.js` in desktop sync set
- fix: runtime config compatibility — remove invalid `plugins` key usage from `opencode.json` workflow assumptions
- fix: config reader robustness — support both `opencode.json` and `opencode.jsonc` (including JSONC comments/trailing commas)
- fix: applySlot safety — prefer project-local `opencode.json` to avoid accidental global provider/dropdown mutations
- test: deep neutral-environment validation (`env -i`) for full suite + build + runtime plugin load (`opencode models deepseek`)
- docs: README version/install sync updated to match actual runtime dependencies and file paths

## 0.7.12

- chore: TDD strict defaults, flow enforcer improvements, release tooling
- change: TDD strict mode now defaults to ON (`selection.tdd_strict !== false`)
- feat: `trinity tdd strict on|off` command to control strict failing TODO templates
- docs: sample config + README updated for TDD strict defaults and command

## 0.7.10

- feat: compact immutable footer format: `— [model route] | VibeTheOG: X.XX saved ↑|↓|→ —`
- change: remove noisy footer breakdown segments (flow/tool/rate/duration) from chat footer
- change: model usage percentages now show only when both brain and worker are actually used
- test: added footer format contract test to prevent accidental format drift

## 0.7.9

- change: delegation enforcement now defaults to ON (`delegation_enforce !== false`) for safer cost control
- change: first-run auto-generated `model-tiers.json` now includes `"delegation_enforce": true`
- docs: sample config updated to show delegation enforcement enabled by default

## 0.7.8

- fix: auto-sync no longer overwrites valid model-tiers.json entries with guessed provider-prefixed IDs
- fix: provider model IDs now use correct provider prefix (e.g. `deepseek/`) instead of generic `opencode/`
- fix: task routing skips medium slot when it matches the brain model (fallback to cheap)
- fix: delegation_enforce defaults to opt-in (`=== true`) instead of opt-out (`!== false`)
- fix: null-safety guard for enforcement block when no args passed
- fix: first-install auto-config populates all trinity slots even with single-model fallback

## 0.7.3

- feat: always sync model-tiers.json with opencode.json on every session start (not just first install)
- feat: detects ALL models from user config — both `provider` dropdown models AND top-level `model` field
- fix: only writes to model-tiers.json if detected models differ from current config (no unnecessary writes)

## 0.7.2

- feat: auto-create model-tiers.json on first install from opencode desktop provider models (sniffs models from the dropdown menu, no manual config needed)
- fix: TRINITY_CHEAP/MEDIUM are now mutable so auto-config can refresh them immediately after bootstrap

## 0.6.0

- feat: enhanced live footer with trend indicators (↑↓→), session duration, savings rate/hr
- feat: per-tool cost breakdown in footer (edit, webfetch, context7, quota, etc.)
- feat: model usage distribution percentage in footer tag (e.g. [🧠 60% → ⚡ 40%])
- feat: cache savings displayed as separate line item in footer
- feat: trend analysis comparing current session rate vs previous sessions
- perf: extended readLifetimeSavings() to return sesDuration, sesRatePerHour, sesTrend, sesToolBreakdown, sesModelTurns
- docs: updated README with new footer format documentation

## 0.5.2

- bump: v0.5.2

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

- Initial release — VibeTheOG v3
