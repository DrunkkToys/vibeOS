# vibeOS for OpenCode

Cost-aware delegation and policy plugin for OpenCode Desktop.

vibeOS helps keep expensive model usage under control by enforcing delegation behavior, tracking savings, and exposing runtime controls through the `trinity` tool.

## Version

Current package version: `0.10.0`

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

## Remote API Protection

vibeOS core algorithms are protected via a remote API server. Proprietary code (delegation enforcement, stress mitigation, blackbox decision engine, TDD enforcement, pattern learner, context compression, dynamic pricing) runs on a remote server — not in the local plugin.

### Architecture

```
Local Plugin (src/index.js)          Remote API Server (VPS)
─────────────────────────            ─────────────────────────
- Hook registrations                 - Fastify API server
- File I/O, state management         - SQLite token/seat DB
- UI/footer rendering                - Protected algorithms
- HTTPS calls to remote API          - Admin token management
- Fallback if API unreachable        - SSL (api.vibetheog.com)
```

### How It Works

1. Plugin sends `Authorization: Bearer <token>` with each protected algorithm call
2. API server validates token against seat/license database
3. If token is valid → returns algorithm result
4. If token is revoked/expired → returns 403, plugin enters fallback mode
5. When a customer doesn't pay → admin deactivates their seat → all tokens revoked

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VIBEOS_API_URL` | `https://api.vibetheog.com` | API server URL |
| `VIBEOS_API_TOKEN` | `null` | User's API token (required for remote calls) |
| `VIBEOS_API_ENABLED` | `true` (if token set) | Enable/disable remote API |

When `VIBEOS_API_TOKEN` is not set, the plugin runs entirely in local fallback mode (degraded — no protected algorithms).

### Token Management (Admin)

All admin endpoints require the master key (`VIBEOS_API_MASTER_KEY`):

```bash
# Create a seat with token (WordPress integration)
curl -X POST -H "Authorization: Bearer $MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"User","email":"user@example.com","with_token":"wp-label"}' \
  https://api.vibetheog.com/admin/seats

# Suspend a seat (revokes all tokens)
curl -X PATCH -H "Authorization: Bearer $MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"suspended"}' \
  https://api.vibetheog.com/admin/seats/:id

# Reactivate a seat
curl -X PATCH -H "Authorization: Bearer $MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"active"}' \
  https://api.vibetheog.com/admin/seats/:id

# List all tokens
curl -H "Authorization: Bearer $MASTER_KEY" \
  https://api.vibetheog.com/admin/tokens
```

### WordPress Integration

When a user purchases a subscription via WordPress:
1. WordPress membership plugin handles payment
2. On payment success, WordPress calls `POST /admin/seats` with `with_token` param
3. API returns seat + token → stored in WordPress user meta
4. On subscription lapse, WordPress calls `PATCH /admin/seats/:id` with `status: "suspended"`
5. All tokens for that seat are revoked → plugin gets 403 → fallback mode

### Deploying the API Server

The API server is in `src/vibeOS-api-server/`. To deploy:

```bash
cd src/vibeOS-api-server
./scripts/deploy.sh
```

This installs Node.js, uploads files, sets up systemd service, and configures Nginx reverse proxy on the VPS.

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/delegate/check` | Check if tool call should be blocked |
| `POST` | `/api/v1/route/model` | Tier routing decision |
| `POST` | `/api/v1/stress/score` | Stress scoring |
| `POST` | `/api/v1/blackbox/analyze` | Dialogue analysis |
| `POST` | `/api/v1/tdd/skeleton` | Test skeleton generation |
| `POST` | `/api/v1/patterns/observe` | Record pattern observation |
| `POST` | `/api/v1/pricing/fetch` | Fetch model pricing |
| `POST` | `/api/v1/compress/context` | Context compression |
| `POST` | `/admin/seats` | Create seat (optionally with token) |
| `GET` | `/admin/seats` | List all seats |
| `PATCH` | `/admin/seats/:id` | Suspend/reactivate seat |
| `POST` | `/admin/tokens` | Create token |
| `GET` | `/admin/tokens` | List all tokens |
| `PATCH` | `/admin/tokens/:id` | Revoke/reactivate token |
| `DELETE` | `/admin/tokens/:id` | Delete token |

## Known Limitations

- OpenCode runtime behavior can vary by version for per-task model override handling.
- Some legacy tests in this repo are older than current enforcement defaults and may fail due to changed policy semantics rather than runtime breakage.
- Savings are estimates, not billing data.
