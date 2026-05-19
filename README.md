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
- vibeOS MCP server with HTTP API for extended tool capabilities (trinity, reports, session metrics, diagnostics).
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
