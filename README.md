# vibeOS for OpenCode

Cost-aware delegation and policy plugin for OpenCode Desktop.

vibeOS helps keep expensive model usage under control by enforcing delegation behavior, tracking savings, and exposing runtime controls through the `trinity` tool.

## Version

Current package version: `0.11.0`

## What It Does

- Tracks estimated savings from delegation warnings and enforcement events.
- Tracks cache savings as a separate persisted category when scratchpad cache hits are observed.
- Adds a live footer to assistant outputs with model split, cumulative savings, and trend arrow.
- Provides `trinity` runtime controls for slot switching, enforcement toggles, audits, and diagnostics.
- Adds per-session model locking: prevents the plugin from auto-switching models when the user changes the model in the OpenCode GUI (`trinity lock on|off`).
- Adds optional flow checks and TDD skeleton enforcement.
- Adds project guard: ensures AGENTS.md and README.md exist and stay protected in every project.
- Adds report and research-audit tooling.
- Learns recurring struggle and routine patterns per project, with `trinity patterns` inspection and `trinity patterns clear`.
- Stress mitigation pipeline: detects user stress signals, shows live stress gauge in footer, injects protective system prompts, and upgrades Task tier when user is stressed.
- vibeOS MCP server with HTTP API for extended tool capabilities (trinity, reports, session metrics, diagnostics).
- TUI dashboard sidebar plugin for real-time plugin status and controls.
- Worker-to-Brain (WBP) protocol synthesizes delegated task output directly in assistant chat.
- **Remote API protection**: Core algorithms run on a self-hosted API server (`api.vibetheog.com`) with token-based authentication. Non-paying seats can be deactivated, immediately revoking all API tokens and falling back to local degraded mode.

## Remote API Protection

vibeOS protects its core algorithms by serving them from a self-hosted API server rather than bundling them entirely in the plugin:

| Algorithm | Endpoint | Description |
|---|---|---|---|
| Delegation enforcement | `POST /api/v1/delegate/check` | Model cost calculation, block/warn routing |
| Model tier routing | `POST /api/v1/route/model` | Tier classification, stress-aware routing |
| Stress scoring | `POST /api/v1/stress/score` | NLP stress signal detection |
| Blackbox engine | `POST /api/v1/blackbox/analyze` | Dialogue trajectory, loop detection, pivot/switch, outcome tracking |
| Blackbox calibration | `POST /api/v1/blackbox/calibrate` | Auto-tune thresholds from session outcomes |
| Blackbox calibration state | `GET /api/v1/blackbox/calibration` | Read calibrated weights per project |
| Blackbox outcome | `POST /api/v1/blackbox/outcome` | Record session satisfaction outcome |
| Blackbox project sessions | `GET /api/v1/blackbox/project-sessions` | List cross-session history per project |
| TDD skeleton gen | `POST /api/v1/tdd/skeleton` | Multi-language test generation |
| Pattern learner | `POST /api/v1/patterns/observe` | Friction/routine detection |
| Model pricing | `POST /api/v1/pricing/fetch` | Dynamic OpenRouter pricing cache |
| Context compression | `POST /api/v1/compress/context` | Bullet-point extraction |

### Environment Variables

```
VIBEOS_API_URL=https://api.vibetheog.com   # API server URL (default: https://api.vibetheog.com)
VIBEOS_API_TOKEN=vos_...                    # Your API token (required for remote mode)
VIBEOS_API_ENABLED=true                     # Set to "false" to use local-only mode
CLAUDE_CREDIT_PERCENT=150                   # Override credit percentage (default: 100)
CLAUDE_CONTEXT7_AVAILABLE=true              # Set to enable context7 cost optimization
CLAUDE_SCRATCHPAD_MAX_AGE_SEC=86400         # Scratchpad cache lifetime in seconds
VIBEOS_MCP_PORT=3001                        # MCP server port (default: 3001)
```

When `VIBEOS_API_TOKEN` is not set or `VIBEOS_API_ENABLED=false`, the plugin runs in local-only mode with all algorithms bundled. When a valid token is provided, core algorithms are offloaded to the remote API.

### Seat & Token Management

The API server manages licenses via seats:

- **Create a seat + token** (WordPress integration):  
  `POST /admin/seats` with `{ "name": "...", "email": "...", "with_token": "label" }`

- **Suspend a seat** (non-paying customer):  
  `PATCH /admin/seats/:id` with `{ "status": "suspended" }`  
  This immediately revokes all API tokens for that seat. The plugin falls back to local degraded mode.

- **Reactivate a seat**:  
  `PATCH /admin/seats/:id` with `{ "status": "active" }`

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
- `trinity lock on|off` / `trinity lock`
- `trinity flow on|off` / `trinity flow enforce on|off` / `trinity flow`
- `trinity tdd on|off` / `trinity tdd strict on|off` / `trinity tdd quality on|off` / `trinity tdd`
- `trinity project`
- `trinity patterns`
- `trinity patterns clear`
- `trinity patterns suggest`
- `trinity target <amount>`
- `trinity repair-state`
- `trinity guard`
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
- Project Guard:
  - On session init, checks if AGENTS.md and README.md exist in the project root.
  - Auto-creates AGENTS.md with protective rules (LLM must ask before modifying code).
  - Auto-creates README.md with tech stack auto-detection and feature stubs.
  - Flow rules warn/flag on write/edit to these protected files.
  - System prompt injects directive to maintain both files.
  - `trinity guard` command regenerates both files on demand.

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

## Blackbox Decision Engine

The blackbox tracks dialogue trajectory per-session and per-project, providing real-time decision state insights:

**Enabled by default.**

- **Resolution tracking**: Classifies each session into one of 7 sub-regimes (INIT, DIVERGENT, EXPLORING, REFINING, CONVERGING, CLOSED, LOOPING) based on entropy trends, action consistency, feature contradiction, and embedding drift.
- **Real feature extraction**: Derives 11 features from each user message — message length, word count, question ratio, code blocks, urgency signals, sentiment, complexity, repetition, and instruction density.
- **Loop prevention**: Detects when the conversation is going in circles and injects escalating system prompt interventions (gentle → suggestive → assertive → escalated) to break the loop.
- **PIVOT/SWITCH detection**: Recognizes when the user changes context outside the current project scope and injects scope-confirmation directives.
- **Outcome tracking**: Detects satisfaction signals from assistant responses (positive: "thanks/that works/perfect"; negative: "broken/still failing/wrong") and records them for calibration.
- **Cross-session continuity**: State persists per project fingerprint in `~/.claude/blackbox-state.json` and remotely in SQLite, allowing resolution state to carry across terminal restarts.
- **Online calibration**: The API server aggregates session outcomes and auto-tunes loop detection, momentum, and closure thresholds per project via `POST /api/v1/blackbox/calibrate`.

Commands:
- `trinity blackbox on` — Enable the decision engine
- `trinity blackbox off` — Disable the decision engine
- `trinity blackbox status` — View current resolution, sub-regime, momentum, loop state, and project history
- `trinity blackbox reset` — Clear the resolution tracker for the current session


The blackbox injects a decision directive into system prompts showing current resolution state, intent volatility, and continuity. When looping or pivoting is detected, stronger intervention directives are injected to guide the model.

## Install

### npm (Recommended)

Published to npm as `vibeOS`:

```bash
npm install vibeOS
```

Then register in `~/.config/opencode/opencode.json`:
```json
"plugins": [
  { "id": "vibeOS", "path": "node_modules/vibeOS/src/index.js" }
]
```

### Local Plugin File

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

## CI/CD

GitHub Actions workflows are in `.github/workflows/`:

- **CI** (`.github/workflows/ci.yml`): Runs on every push/PR to `main`/`master`. Executes typecheck, syntax check, test suite, TypeScript audit, and build validation.

- **Release** (`.github/workflows/release.yml`): Manual trigger via GitHub Actions UI (`workflow_dispatch`). Prompts for version bump type (patch/minor/major), then runs tests, builds, and executes `scripts/release.mjs --yes --ci` which bumps version, updates changelog, commits/tags/pushes, creates a GitHub Release, and publishes to npm.

Before using the release workflow, add an `NPM_TOKEN` secret to the repository with an npm automation token that has publish permissions for the `vibeOS` package.

## Known Limitations

- OpenCode runtime behavior can vary by version for per-task model override handling.
- Some legacy tests in this repo are older than current enforcement defaults and may fail due to changed policy semantics rather than runtime breakage.
- Savings are estimates, not billing data.
