# vibeOS for OpenCode

VIBE is a smart model router for OpenCode Desktop. It automatically selects and switches between brain, medium, and cheap model tiers based on the task at hand — expensive models handle orchestration while cost-effective models execute implementation work. No manual slot-picking needed.

The core is the VIBE autoswitcher: a decision engine that routes each request to the right tier based on context, enforcement policy, and session state. You stay in control via the `trinity` tool set, but the default workflow is zero-config.

Beyond routing, vibeOS tracks savings from tier-switching, enforces delegation policies, and provides real-time visibility through a live status footer and web dashboard.

## Savings Categories

- **Delegation savings** — Estimated cost avoided by routing tasks to cheaper models.
- **Cache savings** — Cost avoided from scratchpad cache hits.

Both are summed in the live footer and persisted in \`~/.claude/delegation-state.json\` across sessions.

## What It Does

- **Smart delegation** — Blocks direct write/edit on high-tier models and routes work to cheaper subagents
- **Cost tracking** — Tracks estimated savings from delegation events and cache hits, displayed in a live footer
- **trinity commands** — Runtime controls for model switching, enforcement toggles, audits, and diagnostics
- **Flow enforcer** — Validates write/edit patterns against project rules; optionally extracts TODOs/FIXMEs
- **TDD enforcer** — Auto-creates test skeletons for changed source files; strict mode makes TODO tests fail loudly
- **Project guard** — Protects AGENTS.md and README.md in every project with auto-regeneration
- **Pattern learner** — Detects recurring friction and routine patterns per project, surfaces via `trinity patterns`
- **Stress mitigation** — Detects user stress signals, adjusts tier routing, and injects protective prompts
- **Model locking** — Prevents auto-switching when model is changed in the OpenCode GUI (`trinity lock`)
- **Report & audit** — `report-save`, `report-list`, `report-read`, and `research-audit` tools
- **Worker-to-Brain protocol** — Delegates implementation tasks to cheaper subagents, synthesizes results in-chat
- **Web dashboard** — Real-time status, savings, stress gauge, and controls via browser
- **TUI sidebar** — Plugin status and controls via OpenCode sidebar plugin
- **Blackbox decision engine** — Dialogue trajectory tracking with loop prevention, pivot detection, and outcome tracking

## Install

### npm (Recommended)

```bash
npm install vibeOS
```

Register in `~/.config/opencode/opencode.json`:

```json
"plugins": [
  { "id": "vibeOS", "path": "node_modules/vibeOS/src/index.js" }
]
```

### Local Plugin File

Copy the plugin and lib files to `~/.config/opencode/plugins/`. See the repository for the complete file list.

Register in `~/.config/opencode/opencode.json`:

```json
"plugins": [
  { "id": "vibeOS", "path": "~/.config/opencode/plugins/vibeOS.js" }
]
```

Restart OpenCode Desktop. The plugin auto-creates its configuration on first run.

## trinity Commands

| Command | Description |
|---|---|
| `trinity status` | Show current plugin state |
| `trinity set brain\|medium\|cheap` | Switch model slot |
| `trinity brain\|medium\|cheap` | Shorthand slot switch |
| `trinity enable` / `trinity disable` | Toggle plugin on/off |
| `trinity thinking full\|brief\|off` | Set reasoning depth |
| `trinity enforce on\|off` | Toggle delegation enforcement |
| `trinity lock on\|off` | Toggle model locking |
| `trinity flow on\|off` | Toggle flow enforcer |
| `trinity flow enforce on\|off` | Toggle auto TODO extraction |
| `trinity tdd on\|off` | Toggle test skeleton gen |
| `trinity tdd strict on\|off` | Toggle strict mode |
| `trinity tdd quality on\|off` | Toggle quality mode |
| `trinity blackbox on\|off\|status\|reset` | Decision engine controls |
| `trinity project` | Per-project analytics |
| `trinity patterns` / `trinity patterns clear` | Inspect / clear patterns |
| `trinity guard` | Regenerate project guard files |
| `trinity diagnose` | Run diagnostics |
| `trinity rebuild` | Auto-detect available models |
| `trinity help` | Command reference |

## Footer Format

Typical output footer:

```
— [model route] | VibeTheOG: <total> saved <arrow> —
```

The footer shows model split, cumulative savings, stress gauge, and trend arrow.

## Web Dashboard

```bash
npm run build:dashboard   # Build the SPA
npm run dashboard         # Start server on http://127.0.0.1:3333
```

Displays model split, savings, session history, stress gauge, trinity controls, reports, and blackbox state with SSE push updates every 1.5s.

## Security

The API token (`VIBEOS_API_TOKEN`) acts as a **password** for your vibeOS seat. Treat it with the same care as any credential.

- **Token-based seat auth** — Each token is bound to a seat. Suspending a seat immediately revokes all associated tokens.
- **Graceful degradation** — If the token is revoked or the API is unreachable, the plugin falls back to local-only mode with bundled algorithms. No functionality is lost; only remote-optimized routing is disabled.
- **Never commit tokens** — `.env.production` and `PRODUCTION-CREDENTIALS.md` are gitignored. Do not share or hardcode tokens in source files.
- **Token rotation** — Generate a new token and update `VIBEOS_API_TOKEN` if you suspect a leak. Old tokens are invalidated immediately on seat suspension.
- **Local-only mode** — Without an API token, all algorithms run locally. Set `VIBEOS_API_ENABLED=false` to explicitly disable all remote calls.

## Context7 Cost Optimization

[context7](https://upstash.com/docs/context7) is an MCP tool that resolves library/framework documentation queries at a fraction of the cost of WebFetch (~$0.06/turn saved).

**Install it once:**

```bash
claude mcp add context7 npx @upstash/context7-mcp
```

### How vibeOS uses context7

- **Auto-detection** — At module load, vibeOS scans `~/.claude/settings.json`, `~/.claude.json`, `opencode.json`, and `~/.config/opencode/` for a `context7` reference. No manual config needed.
- **System prompt injection** — When context7 is detected, a cost-policy directive is injected into every system prompt instructing the model to prefer `mcp__context7__resolve-library-id` and `mcp__context7__get-library-docs` over WebFetch/WebSearch for documentation URLs.
- **Urgency levels** — Controlled by the blackbox engine:
  - `required` (strict/TDD-strict mode) — context7 is mandatory this turn.
  - `preferred` (default) — context7 is encouraged but not forced.
  - `optional` (relaxed mode) — context7 is a nice-to-have.
- **Docs nudge** — If context7 is not installed and the model uses WebFetch on a documentation URL (docs.*, readthedocs, MDN, npmjs, pypi, crates.io, pkg.go.dev, etc.), vibeOS logs a one-time install suggestion and tracks the missed savings.
- **Savings tracking** — Every docs URL fetched via WebFetch instead of context7 is recorded as `missed_context7_usd` in `~/.claude/delegation-state.json`. Accumulated misses appear in `trinity project` analytics with an installation suggestion when bypasses exceed 3.

### Force-enable detection

```bash
export CLAUDE_CONTEXT7_AVAILABLE=true
```

Use this when context7 is configured but the auto-scan misses it (unusual paths, remote configs, or runtime-loaded MCP definitions).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VIBEOS_API_URL` | `https://api.vibetheog.com` | API server URL |
| `VIBEOS_API_TOKEN` | — | **API token (password). Protect like a credential.** Required for remote mode. If compromised, rotate immediately via seat suspension. |
| `VIBEOS_API_ENABLED` | `true` | Set to `false` for local-only mode |
| `CLAUDE_CREDIT_PERCENT` | `100` | Credit percentage override |
| `CLAUDE_CONTEXT7_AVAILABLE` | — | Enable context7 cost optimization |
| `CLAUDE_SCRATCHPAD_MAX_AGE_SEC` | `86400` | Scratchpad cache lifetime |
| `VIBEOS_MCP_PORT` | `3001` | MCP server port |

Without an API token, the plugin runs in local-only mode with all algorithms bundled locally.

## Runtime Model Slots

Tier configuration in `~/.claude/model-tiers.json`:

| Slot | Purpose |
|---|---|
| `brain` | High-tier model for orchestration |
| `medium` | Mid-tier for moderate tasks |
| `cheap` | Low-tier for delegation subagents |

Use `trinity set brain|medium|cheap` or `trinity rebuild` to configure.

## Known Limitations

- OpenCode runtime behavior can vary by version.
- Some test suite tests may fail due to policy semantic changes rather than actual breakage.
- Savings displayed are estimates, not billing data.
