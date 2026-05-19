# vibeOS v0.9.1 ("theSaver" / "VibeTheOG") Forensic Test Matrix

> Generated: 2026-05-19
> Scope: Full-spectrum QA coverage based on README.md, CHANGELOG.md, and AGENTS.md

---

## Source Reference: README.md (full text)

```
# VibeTheOG for OpenCode

Cost-aware delegation and policy plugin for OpenCode Desktop.

`VibeTheOG` helps keep expensive model usage under control by enforcing delegation behavior, tracking savings, and exposing runtime controls through the `trinity` tool.

## Version

Current package version: `0.9.1`

## What It Does

- Tracks estimated savings from delegation warnings and enforcement events.
- Tracks cache savings as a separate persisted category when scratchpad cache hits are observed.
- Adds a live footer to assistant outputs with model split, cumulative savings, and trend arrow.
- Provides `trinity` runtime controls for slot switching, enforcement toggles, audits, and diagnostics.
- Adds optional flow checks and TDD skeleton enforcement.
- Adds report and research-audit tooling.
- Learns recurring struggle and routine patterns per project, with `trinity patterns` inspection and `trinity patterns clear`.
- Stress mitigation pipeline: detects user stress signals, shows live stress gauge in footer, injects protective system prompts, and upgrades Task tier when user is stressed.
- CodeX MCP server integration for extended tool capabilities.
- TUI dashboard sidebar plugin for real-time plugin status and controls.
- Worker-to-Brain (WBP) protocol synthesizes delegated task output directly in assistant chat.

## Runtime Model Slots

Slots are configured in `~/.claude/model-tiers.json`:

- `brain`
- `medium`
- `cheap`

On startup, the plugin detects the active model/slot from `model-tiers.json`. No automatic slot switching occurs; use `trinity set <slot>` or `trinity rebuild` to change slots.

## Savings Categories (Persisted)

State file: `~/.claude/delegation-state.json`

- Delegation savings:
  - `sessions[...].warns[].est_savings_usd`
  - aggregated into footer totals
- Cache savings:
  - `sessions[...].cache_savings_usd`
  - `lifetime.cache_savings_usd`
  - optional `sessions[...].cache_hits[]` audit entries
- Context7 missed-savings tracker:
  - `lifetime.missed_context7_usd`

## Footer Format

Typical output footer:

`— [model route] | VibeTheOG: <total> saved <arrow> —`

Example (with savings):

`— [🧠 deepseek-v4-flash → ⚙ deepseek-chat] | VibeTheOG: 0.01 saved → —`

Example (no savings yet, tier label only):

`— [⚙ Mid] —`

## `trinity` Tool Commands

Main commands:

- `trinity status`
- `trinity set brain|medium|cheap`
- `trinity brain|medium|cheap`
- `trinity enable` / `trinity disable`
- `trinity thinking full|brief|off`
- `trinity enforce` / `trinity enforce on|off`
- `trinity flow on|off` / `trinity flow enforce on|off` / `trinity flow`
- `trinity tdd on|off` / `trinity tdd strict on|off` / `trinity tdd quality on|off` / `trinity tdd`
- `trinity project`
- `trinity patterns`
- `trinity patterns clear`
- `trinity diagnose`
- `trinity rebuild`
- `trinity help`

## Optional Enforcement Modules

- Delegation enforcement:
  - Blocks direct `write`/`edit`/`notebookedit` on high-tier brain when enabled.
  - Adds user-visible enforcement notes.
- Flow enforcer:
  - Rule checks for write/edit patterns.
  - Optional TODO/FIXME extraction queue when flow enforcement is enabled.
- TDD enforcer:
  - Auto-creates skeleton tests for changed source files when enabled.
  - Strict mode is ON by default: TODO tests fail loudly until implemented.

## Reports and Audit Tools

- `research-audit`
- `report-save`
- `report-list`
- `report-read`

These use `~/.claude/reports` and project memory in `~/.claude/project-states.json`.

## Pattern Learning

- Detects repeated friction signals and recurring successful routines from session behavior.
- Stores per-project pattern memory in `~/.claude/project-states.json`.
- Promotes patterns after repeated confirmation across sessions and surfaces them via `trinity patterns`.

## Install / Sync (Local Plugin File)

This repo exports plugin runtime from `src/index.js`.

For OpenCode Desktop local plugin usage, copy these files to `~/.config/opencode/plugins/`:

```
cp src/index.js                    ~/.config/opencode/plugins/vibeOS.js
cp src/vibeOS-lib/flow-enforcer.js ~/.config/opencode/plugins/vibeOS-lib/flow-enforcer.js
cp src/vibeOS-lib/session-metrics.js ~/.config/opencode/plugins/vibeOS-lib/session-metrics.js
cp src/vibeOS-lib/flow-rules.json  ~/.config/opencode/plugins/vibeOS-lib/flow-rules.json
cp src/utils/cost-formatter.js     ~/.config/opencode/plugins/vibeOS-lib/cost-formatter.js
cp src/utils/math.js               ~/.config/opencode/plugins/vibeOS-lib/math.js
cp src/utils/timer.js              ~/.config/opencode/plugins/vibeOS-lib/timer.js
```

Then register the plugin in `~/.config/opencode/opencode.json`:

```json
"plugins": [
  { "id": "vibeOS", "path": "~/.config/opencode/plugins/vibeOS.js" }
]
```

Restart OpenCode Desktop. The plugin auto-creates `~/.claude/model-tiers.json` on first run.

## Build

- `npm run build`

This compiles TypeScript source-of-truth modules and syncs generated JS artifacts used by runtime.

## Known Limitations

- OpenCode runtime behavior can vary by version for per-task model override handling.
- Some legacy tests in this repo are older than current enforcement defaults and may fail due to changed policy semantics rather than runtime breakage.
- Savings are estimates, not billing data.
```

---

## Risk Assessment

| Risk ID | Area | Severity | Rationale |
|---|---|---|---|
| R01 | State file corruption (`delegation-state.json`) | **HIGH** | Central persistence file aggregates all savings/warns/hits. Corruption persists across sessions and breaks savings tracking permanently. JSONC-tolerant parser (`safeJsonParse`) is a mitigation but introduces edge cases with malformed data. |
| R02 | Stress mitigation pipeline | **HIGH** | Recently added (0.9.0). Complex multi-phase pipeline: `scoreStress()` → footer gauge → system prompt injection → tier rerouting. Interaction between stress state and other enforcement modules (delegation, flow, TDD) is untested at scale. |
| R03 | OpenCode Desktop cross-version compatibility | **HIGH** | README explicitly warns runtime behavior varies by version for per-task model override handling. Six hooks (`text.complete`, `messages.transform`, `system.transform`, `tool.execute.before`, `tool.execute.after`, `message.updated`) depend on OpenCode's internal hook signatures. |
| R04 | Delegation enforcement logic | **HIGH** | Core feature with complex boolean logic (`delegation_enforce !== false` defaults to ON since 0.7.9). Must correctly identify brain-tier tools and block only `write`/`edit`/`notebookedit`. Edge cases: null args, no args, tool aliases. |
| R05 | Model slot switch / rebuild | **MEDIUM** | Writes to user's `opencode.json` (project-local and global). `applySlot` safety fix (0.7.13) prefers project-local to avoid global provider mutations. Wrong path selection silently breaks model configuration. |
| R06 | MCP server integration | **MEDIUM** | New in 0.9.1. CodeX MCP server (`src/mcp-server.ts`/`.js`) integration with external protocol. Protocol handshake failures, tool registration conflicts, and cross-process communication are untested in the test matrix. |
| R07 | TUI dashboard sidebar | **MEDIUM** | New in 0.9.1. `.opencode/plugins/*` sidebar plugin for real-time display. Renders live state from plugin runtime. UI rendering bugs may not be caught by existing test suite (no visual regression tests). |
| R08 | TDD enforcer (strict mode, auto-skeleton) | **MEDIUM** | Defaults to strict ON (0.7.12). Auto-creates skeleton tests for changed source files. Reduced dummy actions in 0.8.1 (gated to explicit test intent). Risk of generating spurious test files or failing on unexpected file changes. |
| R09 | Cache savings tracking accuracy | **MEDIUM** | Tracks scratchpad cache hits as separate persisted category. Smart sub-cent display and 4dp precision added in 0.9.0. Accuracy depends on correct detection of scratchpad cache hit events. |
| R10 | Concurrent plugin instance locking | **LOW** | File-based locking via `~/.claude/.vibeOS-locks/`. File lock cleanup on crash/unexpected exit may leave stale lock files blocking subsequent starts. |
| R11 | Pattern learner cross-session promotion | **LOW** | Learns recurring patterns and promotes across sessions. Pattern memory in `project-states.json`. Risk of false positives from short sessions or noise. |
| R12 | Context7 optimization directive injection | **LOW** | Injects context7 usage instructions into system prompts via `system.transform`. May conflict with other system prompt modifications or cause context window bloat. |

---

## Test Matrix

### 1. Installation & Setup

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| I001 | Install / Sync | Copy 7 runtime files to `~/.config/opencode/plugins/` | All 7 files (`vibeOS.js`, `flow-enforcer.js`, `session-metrics.js`, `flow-rules.json`, `cost-formatter.js`, `math.js`, `timer.js`) exist at target paths after `cp` commands | Manual: run cp commands, verify each file exists | not started | | Verify file sizes are non-zero |
| I002 | Install / Sync | Register plugin in `opencode.json` via `"plugins": [{ "id": "vibeOS", "path": "..." }]` | Plugin loads on OpenCode Desktop restart without errors | Manual: restart OpenCode, check logs for plugin load confirmation | not started | | |
| I003 | Install / Sync | Plugin auto-creates `~/.claude/model-tiers.json` on first run | After first run with no existing `model-tiers.json`, file exists with valid JSON structure containing `brain`, `medium`, `cheap` slots | Manual: delete `model-tiers.json`, restart, verify file created | not started | | From 0.7.2: auto-creation from dropdown models |
| I004 | Install / Sync | Plugin install payload completeness (0.7.13 fix) | `session-metrics.js` is included in the install set (was missing in earlier versions) | Manual: verify `~/.config/opencode/plugins/vibeOS-lib/session-metrics.js` exists | not started | | Regression: 0.7.13 fix |
| I005 | Build | `npm run build` compiles TS and syncs JS artifacts | Command exits 0, `dist-ts/` directory populated, sync script copies to correct `src/` paths | Manual: run `npm run build`, verify output | not started | | |
| I006 | Install / Sync | Plugin supports both `opencode.json` and `opencode.jsonc` (0.7.13 fix) | Plugin reads config correctly from either filename, including JSONC with comments/trailing commas | Manual: test with `.jsonc` extension and with comments in file | not started | | JSONC-tolerant via `safeJsonParse()` |
| I007 | Install / Sync | First-install auto-config populates all trinity slots even with single-model fallback (0.7.8 fix) | When only one model is available in OpenCode config, all three slots (brain/medium/cheap) are populated with fallback values | Manual: delete model-tiers.json, configure single model, restart | not started | | Regression: 0.7.8 fix |
| I008 | Install / Sync | No hidden `../utils/timer.js` dependency in `session-metrics.js` (0.7.13 fix) | Plugin loads without "cannot find module" errors for timer.js | Manual: clean install, check for load errors | not started | | Regression: 0.7.13 fix |

### 2. Runtime Model Slots & Trinity Commands

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| R001 | Runtime Model Slots | Three slots: `brain`, `medium`, `cheap` configured in `model-tiers.json` | `model-tiers.json` contains valid entries for all three slots | Manual: inspect `model-tiers.json` structure | not started | | |
| R002 | Runtime Model Slots | Plugin detects active model/slot from `model-tiers.json` on startup | Current tier matches one of the configured slots | Manual: run `trinity status`, verify active slot | not started | | |
| R003 | Runtime Model Slots | No automatic slot switching occurs on startup | Active model does not change between restarts unless user invokes `trinity set` or `trinity rebuild` | Manual: restart OpenCode twice, verify same active model | not started | | |
| R004 | trinity Commands | `trinity status` | Displays current slot, enforcement state, flow state, TDD state, savings, plugin enabled/disabled | Manual: invoke `trinity status` | not started | | |
| R005 | trinity Commands | `trinity set brain` | Switches active model to brain-tier model | Manual: invoke `trinity set brain`, verify model changes | not started | | |
| R006 | trinity Commands | `trinity set medium` | Switches active model to medium-tier model | Manual: invoke `trinity set medium`, verify model changes | not started | | |
| R007 | trinity Commands | `trinity set cheap` | Switches active model to cheap-tier model | Manual: invoke `trinity set cheap`, verify model changes | not started | | |
| R008 | trinity Commands | `trinity brain` (shorthand) | Same as `trinity set brain` | Manual: invoke `trinity brain`, verify model changes | not started | | |
| R009 | trinity Commands | `trinity medium` (shorthand) | Same as `trinity set medium` | Manual: invoke `trinity medium`, verify model changes | not started | | |
| R010 | trinity Commands | `trinity cheap` (shorthand) | Same as `trinity set cheap` | Manual: invoke `trinity cheap`, verify model changes | not started | | |
| R011 | trinity Commands | `trinity enable` | Enables the vibeOS plugin | Manual: invoke `trinity enable`, verify plugin active | not started | | |
| R012 | trinity Commands | `trinity disable` | Disables the vibeOS plugin (takes effect immediately, no restart) | Manual: invoke `trinity disable`, verify plugin inactive (no footer, no enforcement) | not started | | |
| R013 | trinity Commands | `trinity thinking full` | Sets thinking to full and persists as `"full"` string (not null); status shows "manual" not "credit X%" | Manual: invoke `trinity thinking full`, then `trinity status`, verify status shows "manual" | not started | | Regression: 0.5.1 fix |
| R014 | trinity Commands | `trinity thinking brief` | Sets thinking to brief | Manual: invoke `trinity thinking brief`, verify | not started | | |
| R015 | trinity Commands | `trinity thinking off` | Disables thinking | Manual: invoke `trinity thinking off`, verify | not started | | |
| R016 | trinity Commands | `trinity rebuild` | Auto-detects available models from all configured providers and reassigns brain/medium/cheap slots | Manual: invoke `trinity rebuild`, verify slots updated from OpenCode provider config | not started | | |
| R017 | trinity Commands | `trinity diagnose` | Runs diagnostic checks and reports plugin health | Manual: invoke `trinity diagnose` | not started | | |
| R018 | trinity Commands | `trinity help` | Displays available commands and usage | Manual: invoke `trinity help` | not started | | |
| R019 | Runtime Model Slots | Model sync: auto-syncs `model-tiers.json` with `opencode.json` on every session start (0.7.3) | Changes in `opencode.json` provider models are reflected in `model-tiers.json` after restart | Manual: change provider model in opencode.json, restart, verify sync | not started | | 0.7.3 feature |
| R020 | Runtime Model Slots | Only writes to `model-tiers.json` if detected models differ from current config (0.7.3) | No unnecessary writes when models are unchanged | Manual: restart twice, check `model-tiers.json` modification time unchanged on second restart | not started | | 0.7.3 fix |
| R021 | Runtime Model Slots | Provider model IDs use correct prefix (e.g., `deepseek/`) not `opencode/` (0.7.8 fix) | `model-tiers.json` entries show correct provider prefix | Manual: inspect `model-tiers.json` after sync | not started | | Regression: 0.7.8 fix |
| R022 | Runtime Model Slots | Task routing skips medium slot when it matches brain model, falls back to cheap (0.7.8 fix) | If brain model ID == medium model ID, task routing uses cheap tier | Manual: configure brain and medium to same model, verify cheap is used for tasks | not started | | Regression: 0.7.8 fix |
| R023 | Runtime Model Slots | `applySlot` prefers project-local `opencode.json` to avoid global provider mutations (0.7.13 fix) | Slot switch writes to project `opencode.json` when present, not global config | Manual: with project opencode.json present, switch slot, verify change is in project file | not started | | Regression: 0.7.13 fix |
| R024 | Runtime Model Slots | Footer tier refresh follows active slot changes even when model ID unchanged (0.7.15 fix) | After slot switch where model ID is the same, footer still updates tier label | Manual: set two slots to same model, switch between them, verify footer changes | not started | | Regression: 0.7.15 fix |
| R025 | Runtime Model Slots | `_refreshModel` reconciles with actual `opencode.json` model (0.9.0 fix) | After external model change, refresh picks up the actual active model | Manual: change model in opencode.json externally, invoke status, verify match | not started | | Regression: 0.9.0 fix |

### 3. Savings & Persistence

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| S001 | Savings Categories | Delegation savings stored in `sessions[...].warns[].est_savings_usd` | After a delegation warning event, the warning entry includes a non-zero `est_savings_usd` | Manual: trigger delegation warning on brain tier, inspect `delegation-state.json` | not started | | |
| S002 | Savings Categories | Delegation savings aggregated into footer totals | Footer displays cumulative sum of all `est_savings_usd` across sessions | Manual: trigger multiple delegation events, verify footer total increases | not started | | |
| S003 | Savings Categories | Cache savings stored as `sessions[...].cache_savings_usd` | After scratchpad cache hit, `cache_savings_usd` increments | Manual: observe cache hit in session, inspect state file | not started | | |
| S004 | Savings Categories | `lifetime.cache_savings_usd` tracks aggregate across all sessions | Value persists across session restarts | Manual: note value, restart, verify same or higher | not started | | |
| S005 | Savings Categories | Optional `sessions[...].cache_hits[]` audit entries | Cache hit events produce audit entries in state | Manual: check state file for `cache_hits` array after known cache hit | not started | | |
| S006 | Savings Categories | `lifetime.missed_context7_usd` tracks missed savings from not using context7 | Value increments when WebFetch/WebSearch is used where context7 could have been used | Manual: use WebFetch for documented library, check state file | not started | | |
| S007 | Savings Categories | Savings are estimates, not billing data (Known Limitation) | Footer disclaimer or README notes that savings are estimates | Manual: verify README states this limitation | not started | | |
| S008 | Savings Categories | State file prunes stale sessions, keeps latest 30 (0.4.4 fix) | `delegation-state.json` never exceeds 30 sessions | Manual: simulate 35+ sessions, verify old entries pruned | not started | | Regression: 0.4.4 fix |
| S009 | Savings Categories | Smart sub-cent display and 4dp precision for cache savings (0.9.0 fix) | Cache savings under $0.01 display with 4 decimal places | Manual: trigger small cache hit, verify display precision | not started | | Regression: 0.9.0 fix |
| S010 | Savings Categories | Atomic lifetime reads compute totals from single session snapshot (0.5.0 perf) | Concurrent writes don't produce inconsistent lifetime totals | Manual: stress test with rapid delegation events, verify totals consistent | not started | | |

### 4. Footer Format

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| F001 | Footer Format | Footer format: `— [model route] \| VibeTheOG: <total> saved <arrow> —` | Footer matches this exact pattern when savings exist | Manual: inspect assistant message footer after delegation event | not started | | |
| F002 | Footer Format | Example with savings: `— [🧠 deepseek-v4-flash → ⚙ deepseek-chat] \| VibeTheOG: 0.01 saved → —` | Footer shows model route, savings amount, and trend arrow | Manual: trigger savings, verify format | not started | | |
| F003 | Footer Format | No savings footer: `— [⚙ Mid] —` | When no savings exist, footer shows only tier label without savings amount | Manual: check footer in fresh session with no savings | not started | | |
| F004 | Footer Format | Footer appended via `experimental.text.complete` hook | Footer appears at end of completed assistant text | Manual: complete an assistant turn, verify footer appended | not started | | |
| F005 | Footer Format | Footer also appended via `message.updated` hook as fallback | Footer appears even if `text.complete` doesn't fire (older OpenCode versions) | Manual: test on different OpenCode versions | not started | | |
| F006 | Footer Format | Model usage percentages show only when both brain and worker are actually used (0.7.10) | Percentages absent when only one tier is used | Manual: session with only brain-tier usage, verify no percentage in footer | not started | | Regression: 0.7.10 |
| F007 | Footer Format | Compact immutable footer format (0.7.10) | Footer does not include noisy breakdown segments (flow/tool/rate/duration) | Manual: verify footer structure matches compact format, no extra fields | not started | | Regression: 0.7.10 |
| F008 | Footer Format | Trend indicators: ↑ (increasing savings rate), ↓ (decreasing), → (flat) | Arrow direction correctly reflects savings rate trend vs previous sessions | Manual: compare footer arrow against actual rate change | not started | | From 0.6.0 |

### 5. Enforcement Modules

#### 5A. Delegation Enforcement

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| D001 | Enforcement Modules | Delegation enforcement blocks `write`, `edit`, `notebookedit` on brain tier when enabled | Attempting `write`/`edit`/`notebookedit` on brain tier shows enforcement block message | Manual: enable enforcement, on brain tier, attempt to write a file | not started | | |
| D002 | Enforcement Modules | Delegation enforcement defaults to ON (`delegation_enforce !== false`, 0.7.9) | Fresh install/run has enforcement enabled by default | Manual: fresh install, verify enforcement is active | not started | | 0.7.9 change |
| D003 | Enforcement Modules | `trinity enforce on` enables enforcement | Enforcement becomes active after command | Manual: disable then re-enable, verify behavior | not started | | |
| D004 | Enforcement Modules | `trinity enforce off` disables enforcement | Enforcement stops blocking writes on brain tier | Manual: disable enforcement, attempt write on brain tier, verify it works | not started | | |
| D005 | Enforcement Modules | `trinity enforce` shows current state | Displays enabled/disabled status | Manual: invoke `trinity enforce` | not started | | |
| D006 | Enforcement Modules | User-visible enforcement notes added | When write/edit is blocked, user sees an explanation note | Manual: trigger enforcement block, check message content | not started | | |
| D007 | Enforcement Modules | Delegation cost estimates shown | Enforcement note includes estimated savings from delegation | Manual: trigger block, check for cost estimate in message | not started | | |
| D008 | Enforcement Modules | First-run `model-tiers.json` includes `"delegation_enforce": true` (0.7.9) | Auto-generated model-tiers.json has delegation_enforce set to true | Manual: delete model-tiers.json, restart, inspect generated file | not started | | 0.7.9 change |
| D009 | Enforcement Modules | Null-safety guard for enforcement block when no args passed (0.7.8 fix) | Plugin does not crash when tool is called with no arguments | Manual: invoke tool with empty args on brain tier with enforcement enabled | not started | | Regression: 0.7.8 fix |
| D010 | Enforcement Modules | Per-session warning caps and coalescing (claimed feature #13) | Repeated delegation warnings are merged/limited per session | Manual: trigger same delegation path multiple times, verify warnings coalesced | not started | | |

#### 5B. Flow Enforcer

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| FL001 | Enforcement Modules | Flow enforcer: rule checks for write/edit patterns | Write/Edit operations are checked against flow rules (fast-path regex, never blocks) | Manual: perform various write/edit operations, verify rules checked (check logs) | not started | | |
| FL002 | Enforcement Modules | `trinity flow on` enables flow enforcement | Flow rule checks become active | Manual: enable flow, perform writes, verify checks | not started | | |
| FL003 | Enforcement Modules | `trinity flow off` disables flow enforcement | Flow rule checks stop | Manual: disable flow, verify checks stop | not started | | |
| FL004 | Enforcement Modules | `trinity flow enforce on` enables auto-extract TODOs/FIXMEs | TODO/FIXME comments in code are extracted into queue | Manual: enable flow enforce, write code with TODO comment, verify extraction | not started | | |
| FL005 | Enforcement Modules | `trinity flow enforce off` disables TODO/FIXME extraction | TODO/FIXME extraction stops | Manual: disable enforce, write TODO, verify no extraction | not started | | |
| FL006 | Enforcement Modules | `trinity flow` (no args) shows audit/status | Displays current flow enforcer state and any findings | Manual: invoke `trinity flow` | not started | | |
| FL007 | Enforcement Modules | Flow enforcer deduplication per rule+file per session | Same rule violation in same file only reported once per session | Manual: trigger same violation twice, verify single report | not started | | From 0.4.7 |

#### 5C. TDD Enforcer

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| T001 | Enforcement Modules | TDD enforcer auto-creates skeleton tests for changed source files when enabled | Modifying a source file creates a corresponding skeleton test file | Manual: enable TDD, edit a source file, check for generated test | not started | | |
| T002 | Enforcement Modules | `trinity tdd on` enables TDD skeleton creation | Test skeletons start appearing after source edits | Manual: enable TDD, edit source, verify test created | not started | | |
| T003 | Enforcement Modules | `trinity tdd off` disables TDD skeleton creation | No test skeletons created for source edits | Manual: disable TDD, edit source, verify no test created | not started | | |
| T004 | Enforcement Modules | TDD strict mode ON by default (0.7.12) | Generated test skeletons contain failing TODO assertions | Manual: fresh install, verify strict mode is active (check generated test content) | not started | | 0.7.12 change |
| T005 | Enforcement Modules | `trinity tdd strict on` enables strict mode | Generated tests contain TODO assertions that fail loudly | Manual: enable strict, create source edit, check test content | not started | | |
| T006 | Enforcement Modules | `trinity tdd strict off` disables strict mode | Generated tests are non-failing placeholders | Manual: disable strict, create source edit, check test content | not started | | |
| T007 | Enforcement Modules | `trinity tdd quality on` enables quality mode | (Verify behavior of quality mode) | Manual: enable quality, verify effect | not started | | |
| T008 | Enforcement Modules | `trinity tdd quality off` disables quality mode | (Verify behavior change) | Manual: disable quality, verify | not started | | |
| T009 | Enforcement Modules | `trinity tdd` (no args) shows audit | Displays TDD enforcer state | Manual: invoke `trinity tdd` | not started | | |
| T010 | Enforcement Modules | TDD skeleton fires for task subagent file writes (0.9.0 fix) | When a task subagent writes files, TDD skeletons are generated | Manual: delegate a file write to task agent, verify test skeleton created | not started | | Regression: 0.9.0 fix |
| T011 | Enforcement Modules | Auto TDD skeleton gated to explicit test intent or direct test-path edits (0.8.1 fix) | Non-test-related source edits don't trigger spurious TDD skeletons | Manual: edit non-test file in non-test context, verify no skeleton created | not started | | Regression: 0.8.1 fix |

### 6. Reports & Audit Tools

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| A001 | Reports & Audit | `research-audit` tool available | Tool scans recent session data for research anti-patterns (domain chains, redundant queries, no synthesis) | Manual: invoke `research-audit`, verify output | not started | | |
| A002 | Reports & Audit | `report-save` tool available | Saves a manual report with findings, metrics, narrative | Manual: invoke `report-save` with test data, verify saved | not started | | |
| A003 | Reports & Audit | `report-list` tool available | Lists saved reports, filterable by type, project, hours | Manual: invoke `report-list`, verify listing | not started | | |
| A004 | Reports & Audit | `report-read` tool available | Reads a specific report by ID | Manual: save report, invoke `report-read` with its ID, verify content | not started | | |
| A005 | Reports & Audit | Reports stored in `~/.claude/reports/` | Report files exist in directory after `report-save` | Manual: save report, check filesystem | not started | | |
| A006 | Reports & Audit | Project memory in `~/.claude/project-states.json` | Project state persists report references and audit data across sessions | Manual: save report, restart, verify report still referenceable | not started | | |
| A007 | Reports & Audit | Research audit auto-saves findings | After `research-audit` runs, a report is auto-saved | Manual: run research-audit, check report-list for new auto-saved entry | not started | | From 0.5.0 |
| A008 | Reports & Audit | Auto-save dedup within 5-minute window (0.5.0 fix) | Running research-audit twice quickly only saves once | Manual: run research-audit twice within 1 minute, verify single report | not started | | Regression: 0.5.0 fix |
| A009 | Reports & Audit | Reports TTL prune: delete reports >90d, keep max 200 (0.5.0 fix) | Old reports pruned automatically | Manual: create mock old reports, verify cleanup | not started | | Regression: 0.5.0 fix |
| A010 | Reports & Audit | Plain-text findings parser for `report-save` (0.5.0 fix) | `report-save` correctly parses `warn:`, `info:`, `fetches=N`, `cost=N` plain-text lines | Manual: invoke report-save with plain-text findings, verify structured output | not started | | Regression: 0.5.0 fix |

### 7. Pattern Learning

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| P001 | Pattern Learning | Detects repeated friction signals from session behavior | After repeated similar friction events, a pattern is detected | Manual: perform same friction-causing action multiple times across sessions, check patterns | not started | | |
| P002 | Pattern Learning | Detects recurring successful routines | Repeated successful workflows are learned as patterns | Manual: repeat same workflow across sessions, verify pattern emerges | not started | | |
| P003 | Pattern Learning | Stores per-project pattern memory in `~/.claude/project-states.json` | Pattern data visible in project-states.json | Manual: inspect project-states.json for pattern entries | not started | | |
| P004 | Pattern Learning | Promotes patterns after repeated confirmation across sessions | Patterns appear only after multiple confirmations, not on first occurrence | Manual: trigger pattern candidate, verify it doesn't appear until confirmed across sessions | not started | | |
| P005 | Pattern Learning | `trinity patterns` surfaces learned patterns | Command displays detected patterns for current project | Manual: invoke `trinity patterns` | not started | | |
| P006 | Pattern Learning | `trinity patterns clear` clears learned patterns | After clear, `trinity patterns` shows no patterns | Manual: invoke `trinity patterns clear`, then `trinity patterns` | not started | | |

### 8. Stress Mitigation Pipeline

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| ST001 | Stress Mitigation | `scoreStress()` detects user stress signals | Plugin identifies stress indicators in user messages | Manual: send message with stress signals (urgency, frustration), verify detection | not started | | |
| ST002 | Stress Mitigation | Live stress footer gauge | Footer shows stress gauge (e.g., `▁▂▃▅▆█`) reflecting current stress level | Manual: send messages of varying stress levels, observe gauge change | not started | | |
| ST003 | Stress Mitigation | System prompt inoculation with CRITICAL/elevated directives | When stress detected, system prompt includes protective directives | Manual: trigger stress detection, inspect system prompt content (via system.transform hook) | not started | | |
| ST004 | Stress Mitigation | Stress-aware tier routing: upgrades Task to MEDIUM when user is stressed | Task subagent model upgraded from cheap to medium tier during stress | Manual: trigger stress, initiate task delegation, verify model tier used | not started | | |
| ST005 | Stress Mitigation | `trinity project` shows per-project analytics including stress data | Running `trinity project` includes stress-related analytics | Manual: run `trinity project` after stress events, verify stress data in output | not started | | |

### 9. CodeX MCP Server

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| M001 | CodeX MCP Server | MCP server integration for extended tool capabilities | MCP server starts and registers tools with OpenCode | Manual: verify MCP server is running, check for registered tools | not started | | New in 0.9.1 |
| M002 | CodeX MCP Server | `src/mcp-server.ts` TypeScript source compiles correctly | `npm run build` compiles mcp-server.ts to mcp-server.js without errors | Manual: run `npm run typecheck`, verify no errors | not started | | |
| M003 | CodeX MCP Server | MCP tools are available in session | MCP-provided tools appear in tool list | Manual: check available tools for MCP-provided entries | not started | | |
| M004 | CodeX MCP Server | MCP server TypeScript source is source of truth | Changes to `src/mcp-server.ts` must be reflected in `src/mcp-server.js` | Manual: compare .ts and .js files for consistency | not started | | |

### 10. TUI Dashboard Sidebar

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| U001 | TUI Dashboard | Sidebar plugin at `.opencode/plugins/*` | Sidebar renders in OpenCode Desktop | Manual: verify sidebar visible in OpenCode Desktop UI | not started | | New in 0.9.1 |
| U002 | TUI Dashboard | Real-time plugin status display | Sidebar updates to reflect current plugin state (enabled/disabled, active slot) | Manual: change plugin state, verify sidebar updates | not started | | |
| U003 | TUI Dashboard | Model split display in sidebar | Sidebar shows current brain/medium/cheap model assignments | Manual: check sidebar model display against `model-tiers.json` | not started | | |
| U004 | TUI Dashboard | Controls accessible via sidebar | Sidebar provides controls (toggle enforcement, switch slots, etc.) | Manual: use sidebar controls, verify effect matches command-line equivalents | not started | | |

### 11. WBP Protocol (Worker-to-Brain)

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| W001 | WBP Protocol | Synthesizes delegated task output in assistant chat | After task subagent completes, results appear synthesized in main chat | Manual: delegate task, verify output appears in chat with synthesis | not started | | |
| W002 | WBP Protocol | Injected via `experimental.chat.messages.transform` hook | WBP content is injected through the messages transform hook | Manual: verify hook transformation on task completion | not started | | |
| W003 | WBP Protocol | Brain receives task results verbatim (not compressed) | Task output reaches brain tier without compression (0.4.5 fix) | Manual: delegate task with large output, verify full content present | not started | | Regression: 0.4.5 fix |

### 12. Additional Features

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| X001 | What It Does | Cache savings tracked as separate persisted category | Cache savings shown separate from delegation savings in footer and state | Manual: trigger cache hit, verify separate line item | not started | | |
| X002 | What It Does | Context7 cost optimization directive injection in system prompts | System prompt includes context7 usage instructions via `system.transform` hook | Manual: inspect system prompt for context7 directives | not started | | |
| X003 | What It Does | File-based locking via `~/.claude/.vibeOS-locks/` | Second plugin instance fails to start (or is prevented) when first is running | Manual: attempt to start two OpenCode instances with plugin, check lock behavior | not started | | |
| X004 | What It Does | JSONC-tolerant config parsing (`safeJsonParse`) | Config files with trailing commas, comments, or unquoted keys parse without error | Manual: create malformed (but valid JSONC) config, verify plugin loads | not started | | |
| X005 | What It Does | Per-session warning caps and coalescing | Delegation warnings limited per session, similar warnings merged | Manual: trigger 10+ same-category warnings in one session, verify count capped | not started | | |
| X006 | What It Does | Active-job persistence and off-topic detection (0.8.1) | Plugin prompts for scope confirmation before write/edit/task actions on off-topic jobs | Manual: start job, switch topics, verify scope confirmation prompt | not started | | 0.8.1 feature |
| X007 | What It Does | Progressive decadence — age-based scratchpad cache rotation (0.5.0) | Scratchpad cache: 5min fresh → 1h warm/summary → 24h cold → 48h delete, 1000 file / 10MB limit | Manual: create scratchpad files, let age, verify rotation | not started | | |
| X008 | What It Does | Credit API balance fetching (DeepSeek + OpenRouter, 0.4.2) | Plugin fetches credit balance from provider APIs | Manual: check if credit balance is displayed, verify against actual API | not started | | |
| X009 | What It Does | Thinking directive only injected when manually set via `trinity thinking` (0.4.6 fix) | System prompt does not include thinking directive unless explicitly set by user | Manual: check system prompt without explicit thinking setting, verify no directive | not started | | Regression: 0.4.6 fix |
| X010 | What It Does | Session reports log rotation at 500 lines (0.4.4 fix) | `session-reports.log` rotates at 500 lines, doesn't grow unbounded | Manual: generate 501 log entries, verify old log backed up | not started | | Regression: 0.4.4 fix |
| X011 | What It Does | Scratchpad hash mismatch fix — stable JSON key sorting (0.4.8 fix) | Scratchpad hashes match across processes | Manual: generate scratchpad from two processes, verify matching hashes | not started | | Regression: 0.4.8 fix |
| X012 | What It Does | Scratchpad inline size cap — auto-prune >2000 files or >20MB (0.4.8 fix) | Scratchpad directory never exceeds caps | Manual: create many/large scratchpad files, verify auto-pruning | not started | | Regression: 0.4.8 fix |
| X013 | What It Does | Only compress WebFetch output (HTML/CSS noise), not Task output (0.4.5 fix) | WebFetch results compressed, delegated task output verbatim | Manual: compare raw vs processed WebFetch and Task outputs | not started | | Regression: 0.4.5 fix |
| X014 | What It Does | Remove verbose "delegation + cache" savings breakdown from tag (0.4.8 fix) | Savings display is clean/compact, not verbose breakdown | Manual: check savings display format | not started | | Regression: 0.4.8 fix |

### 13. Known Limitations (Verification)

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| L001 | Known Limitations | OpenCode runtime behavior varies by version for per-task model override handling | Different OpenCode versions may produce different delegation behavior | Manual: test on 2+ different OpenCode Desktop versions | not started | | Verification of known limitation |
| L002 | Known Limitations | Some legacy tests may fail due to changed policy semantics | Running `npm test` may show some test failures that are policy-related, not code bugs | Manual: run full test suite, categorize failures as policy-semantic vs runtime-breakage | not started | | |
| L003 | Known Limitations | Savings are estimates, not billing data | Footer/state savings values don't match actual billing | Manual: compare plugin savings against actual provider billing data | not started | | Confirm this is documented as limitation |

### 14. Configuration & State Files

| ID | README Section | Feature or Claim | Expected Behavior | Test Method | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| C001 | Install / Sync | `~/.config/opencode/plugins/vibeOS.js` — main plugin runtime | File exists, is valid JavaScript, exports required hooks | Manual: `node --check vibesOS.js`, verify no syntax errors | not started | | |
| C002 | Install / Sync | `~/.config/opencode/plugins/vibeOS-lib/flow-enforcer.js` — flow enforcer module | File exists, importable by main plugin | Manual: verify file exists and is valid JS | not started | | |
| C003 | Install / Sync | `~/.config/opencode/plugins/vibeOS-lib/session-metrics.js` — session metrics module | File exists, importable by main plugin | Manual: verify file exists and is valid JS | not started | | |
| C004 | Install / Sync | `~/.config/opencode/plugins/vibeOS-lib/flow-rules.json` — flow rules config | File exists, valid JSON (or JSONC) | Manual: parse file, verify structure | not started | | |
| C005 | Install / Sync | `~/.config/opencode/plugins/vibeOS-lib/cost-formatter.js` | File exists at correct path | Manual: verify file exists | not started | | |
| C006 | Install / Sync | `~/.config/opencode/plugins/vibeOS-lib/math.js` | File exists at correct path | Manual: verify file exists | not started | | |
| C007 | Install / Sync | `~/.config/opencode/plugins/vibeOS-lib/timer.js` | File exists at correct path | Manual: verify file exists | not started | | |
| C008 | Savings | `~/.claude/delegation-state.json` — delegation savings state | File uses valid JSON structure with correct schema | Manual: parse file, verify schema (sessions, lifetime, warns, cache_savings_usd, etc.) | not started | | |
| C009 | Runtime Model Slots | `~/.claude/model-tiers.json` — model slot configuration | File contains `brain`, `medium`, `cheap` keys with valid model IDs | Manual: parse file, verify all three keys present | not started | | |
| C010 | Reports & Audit | `~/.claude/project-states.json` — project memory | File contains per-project data (reports, analytics, patterns) | Manual: parse file, verify project entries | not started | | |
| C011 | Reports & Audit | `~/.claude/reports/` — saved report directory | Directory exists and contains saved report JSON files | Manual: list directory, verify report files | not started | | |
| C012 | Additional Features | `~/.claude/.vibeOS-locks/` — file-based locks | Lock directory exists, lock files created when plugin is active | Manual: check lock directory while plugin is running | not started | | |
| C013 | Install / Sync | Plugin registration in `~/.config/opencode/opencode.json` | JSON contains `"plugins"` array with vibeOS entry | Manual: inspect opencode.json, verify entry | not started | | |

---

## Changelog Cross-Reference

Key changes from CHANGELOG.md mapped to test matrix IDs:

| Version | Change | Test IDs Affected |
|---|---|---|
| 0.9.1 | CodeX MCP server integration | M001-M004 |
| 0.9.1 | TUI dashboard sidebar plugin | U001-U004 |
| 0.9.0 | Stress mitigation pipeline | ST001-ST005 |
| 0.9.0 | TDD skeleton fires for task subagent writes | T010 |
| 0.9.0 | Smart sub-cent display / 4dp cache savings | S009 |
| 0.9.0 | `_refreshModel` reconciles with opencode.json model | R025 |
| 0.8.1 | Auto TDD skeleton gated to explicit test intent | T011 |
| 0.8.1 | Active-job persistence / off-topic detection | X006 |
| 0.7.15 | Footer tier refresh follows slot changes even with unchanged model ID | R024 |
| 0.7.13 | Plugin install payload completeness (session-metrics.js) | I004 |
| 0.7.13 | Support opencode.json and opencode.jsonc | I006 |
| 0.7.13 | applySlot prefers project-local opencode.json | R023 |
| 0.7.13 | Remove hidden timer.js dependency | I008 |
| 0.7.12 | TDD strict defaults to ON | T004 |
| 0.7.12 | `trinity tdd strict on\|off` command | T005-T006 |
| 0.7.10 | Compact immutable footer format | F006-F007 |
| 0.7.9 | Delegation enforcement defaults to ON | D002 |
| 0.7.9 | Auto-generated model-tiers.json includes delegation_enforce: true | D008 |
| 0.7.8 | Correct provider prefix (deepseek/) | R021 |
| 0.7.8 | Task routing skips medium when matches brain | R022 |
| 0.7.8 | Null-safety guard for enforcement block | D009 |
| 0.7.8 | First-install auto-config fills all slots even single-model | I007 |
| 0.7.3 | Sync model-tiers.json with opencode.json every session start | R019 |
| 0.7.3 | Only write if models differ | R020 |
| 0.5.1 | `trinity thinking full` stores "full" string | R013 |
| 0.5.0 | Research audit, reporting framework, project memory | A001-A010 |
| 0.5.0 | Progressive decadence cache rotation | X007 |
| 0.4.9 | Version bump | — |
| 0.4.8 | Scratchpad hash mismatch fix | X011 |
| 0.4.8 | Scratchpad inline size cap | X012 |
| 0.4.8 | Clean savings tag | X014 |
| 0.4.7 | Flow enforcer | FL001-FL007 |
| 0.4.6 | Only inject thinking directive when manually set | X009 |
| 0.4.5 | Only compress WebFetch output, not Task output | X013 |
| 0.4.4 | Dedup session reports log, rotate at 500 lines | X010 |
| 0.4.4 | Prune stale sessions (keep latest 30) | S008 |

---

## Test Execution Summary

| Category | Total Tests | Passed | Failed | Blocked | Skipped |
|---|---|---|---|---|---|
| 1. Installation & Setup | 8 | 0 | 0 | 0 | 0 |
| 2. Runtime Model Slots & Trinity | 25 | 0 | 0 | 0 | 0 |
| 3. Savings & Persistence | 10 | 0 | 0 | 0 | 0 |
| 4. Footer Format | 8 | 0 | 0 | 0 | 0 |
| 5A. Delegation Enforcement | 10 | 0 | 0 | 0 | 0 |
| 5B. Flow Enforcer | 7 | 0 | 0 | 0 | 0 |
| 5C. TDD Enforcer | 11 | 0 | 0 | 0 | 0 |
| 6. Reports & Audit Tools | 10 | 0 | 0 | 0 | 0 |
| 7. Pattern Learning | 6 | 0 | 0 | 0 | 0 |
| 8. Stress Mitigation | 5 | 0 | 0 | 0 | 0 |
| 9. CodeX MCP Server | 4 | 0 | 0 | 0 | 0 |
| 10. TUI Dashboard Sidebar | 4 | 0 | 0 | 0 | 0 |
| 11. WBP Protocol | 3 | 0 | 0 | 0 | 0 |
| 12. Additional Features | 14 | 0 | 0 | 0 | 0 |
| 13. Known Limitations | 3 | 0 | 0 | 0 | 0 |
| 14. Configuration & State Files | 13 | 0 | 0 | 0 | 0 |
| **TOTAL** | **141** | **0** | **0** | **0** | **0** |
