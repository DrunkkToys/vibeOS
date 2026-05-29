# vibeOS for OpenCode

**Prices validated: May 28, 2026** — verified against OpenRouter `/api/v1/models`

Cost-aware control plane for OpenCode Desktop. Keeps expensive models on strategy, routes implementation to cheaper tiers, surfaces savings in real time.

For teams, vibeOS adds practical guardrails: delegation enforcement, flow and TDD controls, pattern learning, stress-aware routing, VibeBoX decision tracking, reporting, and remote API protection for the core algorithms.

## Delegation Enforcement

Every `write`/`edit`/`notebookedit` on the **brain tier** is intercepted, cost-estimated, and blocked with a visible enforcement note. Work must be delegated to **medium** or **cheap**. This is the primary savings mechanism.

### Per-Turn Cost (700 input + 300 output tokens)

| Tier | Model | Per Turn | Per 100 Turns | vs Opus |
|------|-------|----------|---------------|---------|
| Brain | `claude-opus-4-7` | **$0.0330** | **$3.30** | — |
| Medium | `claude-sonnet-4-6` | **$0.0066** | **$0.66** | saves 80% |
| Cheap | `claude-haiku-4-5` | **$0.0022** | **$0.22** | saves 93% |

*Source: `src/lib/pricing.ts:279-285`. Conservative estimates — actual OpenRouter live: Opus $0.011, Sonnet $0.0066, Haiku $0.0022 per turn. The plugin over-estimates brain cost so savings are always understated.*

### Savings per Delegation

| Move | Per Turn | 10x | 100x | 1,000x |
|------|----------|-----|------|--------|
| Opus → Haiku | $0.0308 | $0.31 | $3.08 | $30.80 |
| Opus → Sonnet | $0.0264 | $0.26 | $2.64 | $26.40 |
| Sonnet → Haiku | $0.0044 | $0.04 | $0.44 | $4.40 |

Every blocked brain-tier write/edit saves at least $0.026 (Opus→Sonnet). The running total is tracked in `~/.claude/delegation-state.json` and displayed in the live footer.

---

## Features

| Feature | What it does |
|---------|-------------|
| **Delegation enforcement** | Blocks write/edit on brain tier. Routes to medium or cheap. |
| **Live savings footer** | Model, provider, cumulative savings, cache savings, stress gauge, lock/enforcement tags. |
| **Web dashboard** | SolidJS SPA with SSE real-time push. Model split, savings, session history, trinity controls. |
| **Trinity runtime** | `trinity set brain\|medium\|cheap`. Switch tiers mid-session. Change optimization mode. |
| **Flow enforcer** | Pattern-rule checks on write/edit. Extracts TODO/FIXME into an append-only queue. |
| **TDD enforcer** | Auto-creates test skeletons for changed source. Strict mode: TODO tests fail. |
| **Pattern learner** | Tracks recurring struggle/routine patterns per project. |
| **VibeBoX** | 7 sub-regimes, 11 features per turn, 4 loop intervention levels, PIVOT/SWITCH detection. Auto-mode maps regime to optimization mode. |
| **Stress-aware routing** | Stress gauge in footer. Stress > 1.5 escalates to quality mode. |
| **Cache savings** | Separate `cache_savings_usd` tracking for scratchpad cache hits. |
| **Report tools** | `report-save`, `report-list`, `report-read`, `research-audit`. |
| **MCP server** | Extended tool capabilities + dashboard serving + SSE push endpoint. |
| **Remote API** | Fastify server at `api.vibetheog.com`. Token auth with seat/license management. |
| **Session lock** | `trinity lock on\|off` — freezes model at session start. Resets on restart. |

---

## How It Works

8 hooks into OpenCode Desktop:

| Hook | Purpose |
|------|---------|
| `experimental.text.complete` | Appends footer to assistant responses |
| `experimental.chat.messages.transform` | Injects delegation protocol content |
| `experimental.chat.system.transform` | Injects cost optimization, stress inoculation, enforcement directives |
| `tool.execute.before` | Blocks write/edit on brain tier |
| `tool.execute.after` | Injects delegation UI notes |
| `message.updated` | Fallback footer for versions without text.complete |
| `experimental.session.compacting` | Preserves savings state |
| `shell.env` | Injects `OPENCODE_MODEL_TIER` and `OPENCODE_MODEL` |

---

## Local vs Remote

### Full Local (no token)

Model tier classification, static pricing (~20 models), stress scoring, context budget, turn classification, TDD skeleton gen, flow enforcement, savings ledger, session metrics, reports, footer, dashboard, smart cache, VibeBoX fallback.

### Requires Remote API (api-token)

Bootstrap token exchange, advanced VibeBoX with full session history, dynamic per-prompt delegation, cross-session calibration, live pricing fetch beyond static map.

---


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

```bash
npx vibeostheog setup --project      # per-project
npx vibeostheog setup                 # global ~/.config/opencode/
```

Adds `vibeostheog` to `opencode.json`. Restart OpenCode Desktop.

Local dev checkout:

```json
{
  "plugin": ["/absolute/path/to/theSaver-oc/src/index.js"]
}
```

---

## Commands

`trinity help` for full reference. Commands register in the TUI sidebar.

| Command | Effect |
|---------|--------|
| `trinity status` | Tier, enforcement, savings, stress, lock state |
| `trinity set brain\|medium\|cheap` | Switch active model tier |
| `trinity brain\|medium\|cheap` | Shorthand tier switch |
| `trinity enable\|disable` | Toggle plugin on/off |
| `trinity mode budget\|quality\|speed\|longrun\|auto` | Set optimization mode |
| `trinity thinking full\|brief\|off` | Reasoning depth |
| `trinity enforce on\|off` | Toggle enforcement |
| `trinity lock on\|off` | Freeze model for session |
| `trinity flow on\|off` | Toggle flow enforcer |
| `trinity flow enforce on\|off` | Toggle auto-extract TODOs |
| `trinity tdd on\|off\|strict\|quality` | Test skeleton behavior |
| `trinity rebuild` | Re-detect models from all providers |
| `trinity project` | Per-project analytics |
| `trinity patterns` / `trinity patterns clear` | Pattern inspection |
| `trinity diagnose` | Health check |
| `trinity VibeBoX on\|off\|status\|reset` | Decision engine control |
| `trinity repair-state preview\|apply` | Fix state collisions |
| `trinity guard` | Refresh AGENTS.md / README.md |
| `trinity api-token <token\|invalidate>` | Manage remote API token |
| `trinity api-bootstrap-token <token>` | Bootstrap token exchange |

**Report commands**: `report-save`, `report-list`, `report-read`, `research-audit`

---

## Live Footer

```
— Model: claude-sonnet-4-6 | Provider: Anthropic | $4.82 saved | $1.20 cached | ENFORCE | LOCK | Quality | VIBE —
```

Provider, model, delegation savings, cache savings, stress gauge (block chars), lock/enforcement tags, optimization mode. Persisted in `~/.claude/delegation-state.json`.

---

## Architecture

### Plugin Source

Single-file runtime `src/index.js` (5529+ lines). TypeScript source of truth at `src/vibeOS-lib/*.ts` and `src/utils/*.ts`. Build: `npm run build` (tsc + esbuild bundle + deploy script).

### State Files (`~/.claude/`)

| File | Purpose |
|------|---------|
| `delegation-state.json` | Sessions, warns, cache hits, lifetime totals |
| `model-tiers.json` | brain/medium/cheap model IDs |
| `project-states.json` | Per-project memory, analytics, report references |
| `reports/` | Saved report JSON files |
| `savings-ledger.jsonl` | Append-only savings and credit event log |
| `global-learning.json` | Cross-project pattern learning, pricing hints |
| `model-pricing-cache.json` | Cached pricing by model ID |
| `active-jobs.json` | In-flight delegation records |
| `VibeBoX-state.json` | Per-project resolution tracker, session outcomes |
| `.flow-todo-queue.jsonl` | Flow enforcer TODO queue |
| `.flow-dedup-keys.json` | Deduplication set for flow TODO |
| `.enforcement-cooldown.jsonl` | Per-tool cooldown for warn coalescing |

### VibeBoX Decision Engine


7 sub-regimes (INIT, DIVERGENT, EXPLORING, REFINING, CONVERGING, CLOSED, LOOPING). Classification via entropy trends, action consistency, feature contradiction, embedding drift. 11 derived features per turn. 4 loop intervention levels. PIVOT/SWITCH detection. Outcome tracking from satisfaction signals.


Regime→mode mapping via `syncControlSettings()`:

| Regime | Mode | Enforce | Flow | TDD | Tier | Think |
|--------|------|---------|------|-----|------|-------|
| INIT / DIVERGENT / EXPLORING / REFINING | budget | relaxed | audit | lazy | cheap | off |
| CONVERGING / CLOSED | quality | strict | strict | quality | brain | full |
| LOOPING | speed | relaxed | audit | lazy | medium | off |

Stress > 1.5 escalates any regime to quality.

### Remote API Server

`src/vibeOS-api-server/` — Fastify + SQLite at `api.vibetheog.com`. Endpoints: delegation check, tier routing, stress scoring, VibeBoX analysis/calibration, TDD skeleton gen, pattern observation, pricing fetch, context compression. Auth via `VIBEOS_API_TOKEN`. Client: `src/vibeOS-api-server/client.js` with automatic local fallback.

### Dashboard

SolidJS SPA at `src/dashboard/`. Build: `npm run build:dashboard` (vite). Served by MCP server or standalone. SSE `/events` for real-time push (model split, savings, session history, stress, VibeBoX state).

---

## Environment Variables

| Variable | Default | Effect |
|----------|---------|--------|
| `VIBEOS_API_URL` | `https://api.vibetheog.com` | Remote API base URL |
| `VIBEOS_API_TOKEN` | unset | Remote API auth |
| `VIBEOS_API_DISABLED` | `false` | Invalidate alpha token |
| `VIBEOS_API_BOOTSTRAP_TOKEN` | unset | Bootstrap exchange |
| `VIBEOS_API_ENABLED` | `true` | Set `false` for local-only |
| `CLAUDE_CREDIT_PERCENT` | `100` | Credit override |
| `CLAUDE_CONTEXT7_AVAILABLE` | unset | Context7 optimization |
| `VIBEOS_MCP_PORT` | `3001` | MCP server port |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Plugin not loading | Check `opencode.json` entry. Restart Desktop. |
| Model won't switch | `trinity rebuild` then `trinity set brain\|medium\|cheap` |
| Writes/edits blocked | Enforcement active — delegate to cheap tier |
| No footer visible | Verify plugin enabled, completions running |
| Dashboard blank | `npm run build` then restart |
| State looks wrong | `trinity diagnose` then `trinity repair-state preview` |

---

*`trinity help` is the canonical command reference. This README stays high-level so command details follow the code without a rewrite.*
