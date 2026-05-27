# vibeOS for OpenCode

> **Alpha Omega Launch** - This release is the first major public launch of vibeOS. See [CHANGELOG.md](CHANGELOG.md) for release notes.

vibeOS is the cost-aware control plane for OpenCode Desktop. It helps individuals and teams keep expensive models focused on strategy, move implementation work to cheaper tiers, and make the resulting savings visible in real time through the live footer and dashboard.

For teams, vibeOS adds practical guardrails: delegation enforcement, flow and TDD controls, pattern learning, stress-aware routing, VibeBoX decision tracking, reporting, and remote API protection for the core algorithms.

## What We Offer

- Model routing that matches the job to the right provider and tier
- Live savings visibility in chat, the footer, and the web dashboard
- Separate tracking for delegation savings and cache savings
- Runtime controls for flow, TDD, model locking, and VibeBoX mode
- A local fallback path if the remote API is unavailable

## Local Fallback Mode

Without a token, vibeOS keeps running in local-only mode with bundled algorithms. Here's what works locally versus what requires the remote API.

### Fully Functional Locally

- Model tier classification (brain / medium / cheap)
- Static pricing for ~20 common models
- Stress scoring, context budget estimation, and turn classification
- TDD skeleton generation, text compression, and flow enforcement
- Savings ledger, session metrics, reports, and footer/dashboard rendering
- Session-scoped smart cache for duplicate tool output detection

### Requires Remote API

- Bootstrap token exchange (required for initial API setup)
- Advanced VibeBoX decision engine with full session history tracking
- Dynamic per-prompt delegation decisions (local fallback uses a safe "block all writes on high tier" default)
- Learned subagent routing patterns across projects (local fallback uses a static exploratory keyword list)
- Optimization mode selection via advanced VibeBoX (local fallback uses rule-based selection)
- Aggregated cross-session calibration and model retraining
- Live pricing fetch for models beyond the hardcoded map

When the remote API is unreachable, the plugin degrades gracefully to rule-based local algorithms. Core enforcement features continue working — the plugin stays functional and safe, just less adaptive in its routing and mode decisions.


## Install

### OpenCode plugin

1. Register the plugin with the bundled setup command:

```bash
npx vibeostheog setup --project
```

Use `npx vibeostheog setup` for a global OpenCode install under `~/.config/opencode/`.

2. The setup command writes the package name into your OpenCode config. OpenCode installs npm plugins automatically at startup:

```json
{
  "plugin": [
    "vibeostheog"
  ]
}
```

3. If you keep a local checkout of the plugin, point OpenCode at the built file instead:

```json
{
  "plugin": [
    "/absolute/path/to/theSaver-oc/src/index.js"
  ]
}
```

Restart OpenCode Desktop after changing the config.

The package also exposes `vibeostheog/server` and `vibeostheog/tui` for integrations that need the MCP server or sidebar plugin entrypoints directly.

## Common Npm Commands

```bash
npm install
npm run build
npm run typecheck
npm test
npm run release:patch
```

`npm run build` compiles `src/index.ts` to `src/index.js` for the local checkout. `npm run typecheck` validates the TypeScript sources without emitting files.

## Core Controls

`trinity` is an OpenCode plugin command. Run it from inside OpenCode, not from a normal terminal shell. Use `trinity help` for the full command list. The bundled TUI plugin also registers `trinity` and the common slot actions in OpenCode's command palette.

The most common controls are:

- `trinity status` - show current tier, enforcement, savings, stress, and lock state
- `trinity set brain|medium|cheap` - switch the active tier
- `trinity brain|medium|cheap` - shorthand tier switch
- `trinity rebuild` - re-detect available models and repopulate slots
- `trinity enable` / `trinity disable` - toggle the plugin on or off
- `trinity mode budget|quality|speed|longrun|auto` - change the optimization mode
- `trinity thinking full|brief|off` - change reasoning depth
- `trinity enforce on|off` - control delegation enforcement
- `trinity lock on|off` - freeze the active model for the session
- `trinity flow on|off` and `trinity flow enforce on|off` - manage flow checks
- `trinity tdd on|off`, `trinity tdd strict on|off`, `trinity tdd quality on|off` - manage test skeleton behavior
- `trinity project` - open project analytics
- `trinity patterns` / `trinity patterns clear` - inspect or reset learned patterns
- `trinity diagnose` - run a health check
- `trinity repair-state preview|apply` - fix state fingerprint collisions
- `trinity VibeBoX on|off|status|reset` - control the decision engine
- `trinity guard` - refresh AGENTS.md and README.md checks
- `trinity api-token <token>` - update the remote API token
- `trinity api-bootstrap-token <token>` - store an alpha bootstrap token and exchange it for a normal API token on alpha builds

Additional reporting commands:

- `report-save`
- `report-list`
- `report-read`
- `research-audit`

## Savings And Footer

The footer shows:

- the active provider/model in use for the current run
- cumulative delegation savings
- cache savings
- stress level
- lock and enforcement tags

Savings are persisted in `~/.claude/delegation-state.json`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `VIBEOS_API_URL` | `https://api.vibetheog.com` | Remote API server URL |
| `VIBEOS_API_TOKEN` | unset | vos_ffa6c7dacb244a03 |
| `VIBEOS_API_BOOTSTRAP_TOKEN` | unset | Alpha bootstrap token for initial auth exchange |
| `VIBEOS_API_ENABLED` | `true` | Set to `false` for local-only mode |
| `CLAUDE_CREDIT_PERCENT` | `100` | Credit override |
| `CLAUDE_CONTEXT7_AVAILABLE` | unset | Enables context7 optimization |
| `CLAUDE_SCRATCHPAD_MAX_AGE_SEC` | `86400` | Scratchpad cache lifetime |
| `VIBEOS_MCP_PORT` | `3001` | MCP server port |

Without a token, vibeOS keeps running in local-only mode with bundled algorithms.

## Troubleshooting

- If the plugin does not appear, confirm the OpenCode config entry, then restart OpenCode Desktop.
- If the model will not switch, run `trinity rebuild` and then `trinity set brain|medium|cheap`.
- If writes or edits are blocked, that is usually delegation enforcement working as intended on the brain tier.
- If the footer is missing, check that the plugin is enabled and that the current OpenCode session is receiving assistant completions.
- If the remote API is down or the token is invalid, use `trinity api-token <token>` or `trinity api-bootstrap-token <token>` on alpha builds, or rely on local-only mode.
- If the dashboard does not load, rebuild the plugin with `npm run build` and restart OpenCode.
- If state or config looks inconsistent, run `trinity diagnose` and `trinity guard`.

## Notes

- `trinity help` is the canonical command reference.
- The README stays intentionally high level so the command details can follow the code without a rewrite.
