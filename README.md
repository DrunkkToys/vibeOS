# theSaver for OpenCode

Cost-aware delegation and policy plugin for OpenCode Desktop.

`theSaver` helps keep expensive model usage under control by enforcing delegation behavior, tracking savings, and exposing runtime controls through the `trinity` tool.

## Version

Current package version: `0.7.13`

## What It Does

- Tracks estimated savings from delegation warnings and enforcement events.
- Tracks cache savings as a separate persisted category when scratchpad cache hits are observed.
- Adds a live footer to assistant outputs with model split, cumulative savings, and trend arrow.
- Provides `trinity` runtime controls for slot switching, enforcement toggles, audits, and diagnostics.
- Adds optional flow checks and TDD skeleton enforcement.
- Adds report and research-audit tooling.

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

`— [model route] | theSaver: <total> saved <arrow> —`

Example (with savings):

`— [🧠 deepseek-v4-flash → ⚙ deepseek-chat] | theSaver: 0.01 saved → —`

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

## Install / Sync (Local Plugin File)

This repo exports plugin runtime from `src/index.js`.

For OpenCode Desktop local plugin usage:

1. Copy `src/index.js` to `~/.config/opencode/plugins/theSaver.js`
2. Copy `src/theSaver-lib/flow-enforcer.js` to `~/.config/opencode/plugins/theSaver-lib/flow-enforcer.js`
3. Copy `src/theSaver-lib/session-metrics.js` to `~/.config/opencode/plugins/theSaver-lib/session-metrics.js`
4. Copy `src/theSaver-lib/flow-rules.json` to `~/.config/opencode/plugins/theSaver-lib/flow-rules.json`
5. Restart OpenCode Desktop

## Build

- `npm run build`

This compiles TypeScript source-of-truth modules and syncs generated JS artifacts used by runtime.

## Known Limitations

- OpenCode runtime behavior can vary by version for per-task model override handling.
- Some legacy tests in this repo are older than current enforcement defaults and may fail due to changed policy semantics rather than runtime breakage.
- Savings are estimates, not billing data.
