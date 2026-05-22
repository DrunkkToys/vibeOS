---
name: vibeOS-core
description: Use when the user mentions "vibeOS", "trinity", "model slot", "delegation enforcement", "savings", "footer", "MCP", "dashboard", "remote API", or "api-token". Covers core plugin commands: trinity set/status/enable/disable, model switching, enforcement toggles, flow/TDD basics, install instructions, web dashboard, MCP server, and remote API protection. Does NOT cover blackbox engine, pattern learner, or stress pipeline (see vibeOS-advanced).
---

# vibeOS Core

vibeOS is a cost-aware delegation and policy plugin for OpenCode. It tracks savings, enforces delegation rules on expensive models, provides real-time runtime controls, serves a web dashboard via MCP/standalone server, and protects core algorithms behind a remote API server.

## Install

npm: `npm install vibeOS`

Then add to `~/.config/opencode/opencode.json`:
```json
"plugins": [{"id": "vibeOS", "path": "vibeOS"}]
```

Restart OpenCode.

## Remote API Protection (Env Vars)

```
VIBEOS_API_URL=https://api.vibetheog.com
VIBEOS_API_TOKEN=vos_...
VIBEOS_API_ENABLED=true
```

When `VIBEOS_API_TOKEN` is set, core algorithms (delegation, stress, pricing, blackbox) run on the remote API server. Without it, runs local-only degraded mode.

`trinity api-token <token>` updates the token at runtime.

## MCP Server

Starts automatically on port 9578 (configurable via `VIBEOS_MCP_PORT` env or `model-tiers.json` selection.mcp_port). Serves:
- REST API for plugin state, savings, reports, trinity commands
- Web dashboard SPA at `http://127.0.0.1:<port>/`
- SSE endpoint `/events` for real-time push updates

## Web Dashboard

SolidJS SPA with real-time SSE updates every 1.5s. Displays model split, savings, session history, stress gauge, trinity controls, reports, blackbox state.

```bash
npm run build:dashboard   # Build SPA (one-time)
npm run dashboard         # Standalone server on :3333
npm run dev:dashboard     # Vite dev server :5173 with hot-reload
```

## Trinity Commands

| Command | Effect |
|---|---|
| `trinity status` | Show current state (model slot, enforcement, flow, TDD, blackbox) |
| `trinity set brain|medium|cheap` | Switch model slot |
| `trinity brain|medium|cheap` | Shorthand slot switch |
| `trinity rebuild` | Auto-detect available models and re-populate slots |
| `trinity enable` / `trinity disable` | Enable or disable the plugin |
| `trinity lock on|off` | Prevent auto-switching model when user changes it in GUI (in-memory, resets on restart) |
| `trinity guard` | Ensure AGENTS.md and README.md exist and are current |
| `trinity api-token <token>` | Update VIBEOS_API_TOKEN and re-enable remote API |
| `trinity repair-state preview|apply` | Fix fingerprint collisions between project hashes |
| `trinity patterns suggest` | Suggest patterns from similar tech stack projects |
| `trinity report savings` | Show delegation and cache savings report |

## State Files

| File | Purpose |
|---|---|
| `~/.claude/delegation-state.json` | Delegation savings, cache savings, lifetime totals |
| `~/.claude/model-tiers.json` | Brain/medium/cheap model slots, selection flags, MCP port |
| `~/.claude/project-states.json` | Per-project analytics, pattern memory, research chains |
| `~/.claude/blackbox-state.json` | Per-project resolution tracker state |
| `~/.claude/.vibeOS-locks/` | File-based locks preventing concurrent plugin instances |
| `~/.claude/savings-ledger.jsonl` | Append-only savings event log |
| `~/.claude/reports/` | Saved report JSON files |
| `~/.claude/.flow-todo-queue.jsonl` | Flow enforcer TODO extraction queue |
| `~/.claude/.enforcement-cooldown.jsonl` | Per-tool cooldown for delegation warn coalescing |

All reads use `safeJsonParse()` (JSONC-tolerant — handles trailing commas, comments, unquoted keys).

## Enforcement

| Command | Effect |
|---|---|
| `trinity enforce on|off` | Toggle delegation enforcement |
| `trinity flow on|off` | Toggle flow enforcer (write/edit pattern checks) |
| `trinity flow enforce on|off` | Toggle strict flow enforcement |
| `trinity tdd on|off` | Toggle auto-test skeleton generation |
| `trinity tdd strict on|off` | Toggle strict TDD mode |
| `trinity tdd quality on|off` | Toggle TDD quality checks |

## Thinking Mode

`trinity thinking full|brief|off` — set reasoning depth.

## Reports

- `report-save` — save session findings
- `report-list` — list saved reports
- `report-read` — read a report by ID
- `research-audit` — scan for research anti-patterns

Reports use `~/.claude/reports/` and `~/.claude/project-states.json` for project memory.

## Warning Coalescing

Per-session warning caps and coalescing: repeated delegation warnings for the same tool within a cooldown window are merged. Limits and merges repeated warnings to reduce noise.

## Footers

Footer shows route, savings, stress gauge, and enforcement status. Example:
`-- [deepseek-chat] [AUTO--BALANCED] [ENF ON] [TDD ON] | vibeOS: $0.61 saved right arrow | stress: down-tick calm --`

## Mode Commands

`trinity mode budget|quality|speed|longrun|auto` — override optimization mode.
