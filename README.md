# vibeOS for OpenCode

> **Alpha Release** — This is the first alpha milestone of vibeOS. See [CHANGELOG.md](CHANGELOG.md) for release notes.
vibeOS is the cost-aware routing layer for OpenCode Desktop. It keeps high-tier models focused on orchestration, pushes implementation work to cheaper tiers, and makes the savings visible in real time through the live footer and dashboard.


It also adds guardrails: delegation enforcement, flow and TDD controls, pattern learning, stress-aware routing, blackbox decision tracking, reporting, and remote API protection for the core algorithms.

## Why Teams Use It

- Routes work to the right model tier without manual babysitting
- Tracks delegation savings and cache savings separately
- Shows live status in chat, the footer, and the web dashboard
- Adds runtime controls for flow, TDD, model locking, and blackbox mode
- Falls back to local algorithms if the remote API is unavailable

## Install

### OpenCode plugin

1. Install the package:

```bash
npm install vibeostheog
```

2. Let OpenCode load the built plugin from its plugin directory.
   The package deploys `src/index.js` to `~/.config/opencode/plugins/vibeOS.js`
   and can auto-register `./plugins/vibeOS.js` in `~/.config/opencode/opencode.json`.

3. If you want to configure it manually, use:

```json
{
  "plugin": [
    "./plugins/vibeOS.js"
  ]
}
```

### Local plugin file

If you keep a local checkout of the plugin, point OpenCode at the built file instead:

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

`npm run build` compiles `src/index.ts` to `src/index.js` and deploys the built plugin into the OpenCode plugin directory. `npm run typecheck` validates the TypeScript sources without emitting files.

## Core Controls

`trinity` is an OpenCode plugin command. Run it from inside OpenCode, not from a normal terminal shell.
Use `trinity help` for the full command list. The most common controls are:

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
- `trinity blackbox on|off|status|reset` - control the decision engine
- `trinity guard` - refresh AGENTS.md and README.md checks
- `trinity api-token <token>` - update the remote API token

Additional reporting commands:

- `report-save`
- `report-list`
- `report-read`
- `research-audit`

## Savings And Footer

The footer shows:

- the active model split
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
- If the remote API is down or the token is invalid, use `trinity api-token <token>` or rely on local-only mode.
- If the dashboard does not load, rebuild the plugin with `npm run build` and restart OpenCode.
- If state or config looks inconsistent, run `trinity diagnose` and `trinity guard`.

## Notes

- `trinity help` is the canonical command reference.
- The README stays intentionally high level so the command details can follow the code without a rewrite.
