---
name: vibeOS-core
description: Use when the user mentions vibeOS, trinity, model slots, delegation enforcement, savings, footer, MCP, dashboard, remote API, api-token, report tools, or repair-state. Covers the core plugin surface and the Desktop sibling backend root.
---

# vibeOS Core

vibeOS is a cost-aware routing and enforcement layer for OpenCode. It keeps orchestration on the strong tier, moves implementation work to cheaper tiers, tracks savings, and exposes the current state through `trinity`, the footer, and the dashboard.

## Install

```bash
npm install vibeostheog
```

Then add the plugin in `~/.config/opencode/opencode.json`:

```json
{
  "plugins": [
    { "id": "vibeOS", "path": "node_modules/vibeOS/src/index.js" }
  ]
}
```

## Backend Root

The API server, MCP server, and dashboard source live in the Desktop sibling folder `../vibeOScore`.

Use that folder when you need to build or test the backend:

```bash
npm run start
npm run start:all
npm run build:dashboard
npm run dev:dashboard
npm run dashboard:serve
npm run typecheck
npm test
```

## Remote API

The remote API is used for protected algorithms and falls back locally when unavailable.

```bash
VIBEOS_API_URL=https://api.vibetheog.com
VIBEOS_API_TOKEN=vos_...
VIBEOS_API_ENABLED=true
```

`trinity api-token <token>` updates the token at runtime.

## Trinity Commands

| Command | Effect |
|---|---|
| `trinity status` | Show current state, savings, stress, and lock state |
| `trinity set brain|medium|cheap` | Switch the active model slot |
| `trinity brain|medium|cheap` | Shorthand slot switch |
| `trinity rebuild` | Re-detect models and repopulate slots |
| `trinity enable` / `trinity disable` | Toggle the plugin |
| `trinity mode budget|quality|speed|longrun|auto|balanced|audit|vibeultrax|vibeqmax|vibemax|forensic` | Change the optimization mode |
| `trinity thinking full|brief|off` | Set reasoning depth |
| `trinity enforce on|off` | Toggle delegation enforcement |
| `trinity lock on|off` | Freeze the active model for the session |
| `trinity flow on|off` | Toggle the flow enforcer |
| `trinity flow enforce on|off` | Toggle TODO extraction |
| `trinity tdd on|off` | Toggle auto test skeletons |
| `trinity tdd strict on|off` | Toggle strict TDD mode |
| `trinity tdd quality on|off` | Toggle quality mode |
| `trinity project` | Show project analytics |
| `trinity patterns` / `trinity patterns clear` | Inspect or clear learned patterns |
| `trinity guard` | Refresh AGENTS.md and README.md checks |
| `trinity diagnose` | Run a runtime health check |
| `trinity repair-state preview|apply` | Fix fingerprint collisions |
| `trinity api-token <token>` | Update the remote API token |

## Reports

- `report-save`
- `report-list`
- `report-read`
- `research-audit`

## State Files

| File | Purpose |
|---|---|
| `~/.claude/delegation-state.json` | Delegation savings, cache savings, warnings, lifetime totals |
| `~/.claude/model-tiers.json` | Brain, medium, and cheap model slots |
| `~/.claude/project-states.json` | Per-project analytics and pattern memory |
| `~/.claude/blackbox-state.json` | Per-project decision tracker state |
| `~/.claude/.vibeOS-locks/` | File-based instance locking |
| `~/.claude/savings-ledger.jsonl` | Append-only savings event log |
| `~/.claude/reports/` | Saved report JSON files |
| `~/.claude/.flow-todo-queue.jsonl` | Flow TODO extraction queue |
| `~/.claude/.enforcement-cooldown.jsonl` | Delegation warning cooldowns |

Reads use `safeJsonParse()` so JSONC-style input stays tolerated.

## Hook Surface

The plugin uses these OpenCode hooks:

- `experimental.text.complete`
- `experimental.chat.messages.transform`
- `experimental.chat.system.transform`
- `tool.execute.before`
- `tool.execute.after`
- `message.updated`
- `experimental.session.compacting`
- `shell.env`

## Footer

The live footer shows the active route, model split, cumulative savings, stress level, and enforcement or lock tags.
