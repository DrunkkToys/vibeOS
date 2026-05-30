# vibeOS for OpenCode

Cost-aware control plane for OpenCode Desktop. Keeps expensive models on strategy, routes implementation to cheaper tiers, surfaces savings in real time.

For teams, vibeOS adds practical guardrails: delegation enforcement, flow and TDD controls, pattern learning, stress-aware routing, VibeBoX decision tracking, reporting, and remote API protection for the core algorithms.

## Delegation Enforcement

Every `write`/`edit`/`notebookedit` on the **brain tier** is intercepted, cost-estimated, and blocked with a visible enforcement note. Work must be delegated to **medium** or **cheap**. This is the primary savings mechanism.

### Savings per Delegation

| Move | Per Turn | 10x | 100x | 1,000x |
|------|----------|-----|------|--------|
| Opus -> Haiku | $0.0308 | $0.31 | $3.08 | $30.80 |
| Opus -> Sonnet | $0.0264 | $0.26 | $2.64 | $26.40 |
| Sonnet -> Haiku | $0.0044 | $0.04 | $0.44 | $4.40 |

Every blocked brain-tier write/edit saves at least $0.026 (Opus -> Sonnet). The running total is tracked in `~/.claude/delegation-state.json` and displayed in the live footer.

## Model Tiers

Benchmarked on the DeepSeek v4 family. Prices based on 700 input + 300 output tokens per turn.

> DeepSeek Chat costs $0/turn when routed through the Direct DeepSeek provider (no OpenRouter markup).

| Slot | Model | API ID | Per Turn | Per 1K Turns | Tier |
|------|-------|--------|----------|--------------|------|
| brain | v4 Pro | `deepseek/deepseek-v4-pro` | $0.00057 | $0.58 | high |
| medium | v4 Flash | `deepseek/deepseek-v4-flash` | $0.000182 | $0.18 | mid |
| cheap | DeepSeek Chat | `deepseek/deepseek-chat` | $0.00 | $0.00 | budget |
| cheap (local) | MagicCoder:7b | `magicoder:7b` (Ollama) | $0.00 | $0.00 | budget |

*Source: `src/lib/pricing.ts`. Conservative estimates — savings are always understated.*

## Optimization Modes

### Mode Comparison — Sorted by Quality Descending

| # | Mode | Pipeline | Quality vs Brain | Cost vs Brain | Cost/Turn | Saves |
|---|------|----------|-----------------|--------------|-----------|-------|
| 1 | **Raw Brain** | v4 Pro (no framework) | baseline | 1.00x | $0.00057 | - |
| 2 | **VibeQMaX** (quality) | v4 Pro + full guardrails | ~baseline | 0.50x | $0.00029 | 50% |
| 3 | **VibeUltraX** | MagicCoder:7b -> v4 Flash -> v4 Pro (debate) | brain parity | 0.58x | $0.00033 | 42% |
| 4 | **VibeMaX** (default) | medium (auto-escalate via trained cascade) | ~75% | 0.18x | $0.00010 | 82% |
| 5 | **Speed** | v4 Flash | ~55% | 0.32x | $0.000182 | 68% |
| 6 | **Budget** | DeepSeek Chat | ~40% | 0.00x | $0.00 | 100% |

**VibeQMaX (Quality Max)** — Routes strategic turns through v4 Pro with full thinking, strict enforcement, strict flow checks, and quality TDD. Write/edit turns delegated to cheaper tiers per enforcement rules. Effective blended cost ~$0.00029/turn (50% of Raw Brain).

**VibeMaX (ML-Optimized, Default)** — Intelligent cost-quality sweet spot. Routes through v4 Flash (medium) and uses a random forest classifier (29 trees, gini-split, trained on telemetry) to decide each turn. Classifies on 11 derived features: message length, code block density, urgency, complexity, repetition, question ratio, and more. Benchmarked at ~75% of Brain quality at 18% of cost.

**VibeUltraX** — Cascade pipeline: MagicCoder:7b (local Ollama) proposes, v4 Flash reviews, v4 Pro refines. Achieves Brain-quality parity at 58% cost (local inference is free, only Flash/Pro API calls cost).

### Cost vs Quality Visual

```
Quality
  baseline  . Raw Brain . VibeQMaX
    parity      |   . VibeUltraX
  ~75%      |   . VibeMaX (default)
  ~55%      |   . Speed
  ~40%      |   . Budget
              |
              +--------------------------------
              1.0x  0.50x 0.32x 0.18x 0.00x
                          Cost Multiplier
```

### Configuration Per Mode

| Mode | Model | Thinking | Enforcement | Flow | TDD |
|------|-------|----------|-------------|------|-----|
| Raw Brain | v4 Pro | full | - | - | - |
| VibeQMaX | v4 Pro | full | strict | strict | quality |
| VibeUltraX | cascade (local->Flash->Pro) | auto | auto | auto | auto |
| VibeMaX | v4 Flash (auto-escalate) | auto | auto | auto | auto |
| Speed | v4 Flash | off | relaxed | audit | lazy |
| Budget | DeepSeek Chat | off | relaxed | audit | lazy |

### Benchmark Details

All tests run with DeepSeek v4 family. Quality scores measured against Raw Brain (v4 Pro, full thinking, no vibeOS overhead). VibeMaX quality benchmark derived from real session telemetry with bootstrap confidence intervals (36 bootstrap samples). Pareto frontier computed from 70 holdout scenarios across 170 training samples via hyperparameter sweep. VibeUltra is the first mode that beats Raw Brain on both accuracy and cost — Pareto-dominant.

| Policy | Quality vs Brain | Cost vs Brain | Savings | Method |
|--------|-----------------|--------------|---------|--------|
| VibeUltraX | brain parity | 0.58x | 42% | local -> Flash -> Pro cascade |
| VibeMaX | ~75% | 0.18x | 82% | trained cascade (conservative escalate) |
| VibeQMaX | ~100% | 0.50x | 50% | same model, framework optimizations |
| Raw Brain | 100% | 1.00x | - | baseline |
| Budget | ~40% | 0.00x | 100% | direct routing |

Benchmarked on 1000 simulated questions across 20 runs, using model accuracies from MMLU-Pro / GPQA Diamond with real error correlation data.

## Features

| Feature | What it does |
|---------|-------------|
| **Delegation enforcement** | Blocks write/edit on brain tier. Routes to medium or cheap. |
| **Live savings footer** | Model, provider, cumulative savings, cache savings, stress level, lock/enforcement tags. |
| **Web dashboard** | SolidJS SPA with SSE real-time push. Model split, savings, session history, trinity controls. |
| **Trinity runtime** | Switch tiers mid-session. Change optimization mode. Flow/TDD/enforcement toggles. |
| **Flow enforcer** | Pattern-rule checks on write/edit. Extracts TODO/FIXME into append-only queue. |
| **TDD enforcer** | Auto-creates test skeletons for changed source. Strict mode: TODO tests fail. |
| **Pattern learner** | Tracks recurring struggle/routine patterns per project. |
| **VibeBoX** | 7 sub-regimes, 11 features per turn, 4 loop intervention levels, PIVOT/SWITCH detection. Auto-mode maps regime to optimization mode. |
| **Stress-aware routing** | Stress gauge in footer. Stress > 1.5 escalates to quality mode. |
| **Cache savings** | Separate cache_savings_usd tracking for scratchpad cache hits. |
| **Report tools** | report-save, report-list, report-read, research-audit. |
| **MCP server** | Extended tool capabilities + dashboard serving + SSE push endpoint. |
| **Remote API** | Fastify server at api.vibetheog.com. Token auth with seat/license management. |
| **Session lock** | trinity lock on|off — freezes model at session start. |

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
| `shell.env` | Injects OPENCODE_MODEL_TIER and OPENCODE_MODEL |

## Local Models (Ollama)

To use **MagicCoder:7b** or other local models with vibeOS and OpenCode Desktop:

### Setup

1. Install Ollama — `curl -fsSL https://ollama.ai/install.sh | sh`
2. Pull MagicCoder — `ollama pull magicoder:7b`
3. Add provider — In OpenCode settings, add an Ollama provider (default: http://localhost:11434)
4. Detect — Run `trinity rebuild` — MagicCoder:7b appears in the model dropdown
5. Assign slot — `trinity set cheap magicoder:7b`

### Minimum Hardware

| Component | Minimum |
|-----------|---------|
| CPU | Apple Silicon (M1+) or x86_64 with AVX2 |
| RAM | **16 GB** (MagicCoder:7b @ Q4_K_M uses ~5 GB + context overhead) |
| GPU | Integrated (M1 16GB unified memory) or NVIDIA 6GB+ VRAM |
| Storage | 4 GB free for model weights |

> **Note**: Local models run entirely on your machine. vibeOS treats them as any other OpenCode provider — pricing shows $0.00/turn.

## Install

```bash
npx vibeostheog setup --project      # per-project
npx vibeostheog setup                 # global ~/.config/opencode/
```

Adds `vibeostheog` to opencode.json. Restart OpenCode Desktop.

Local dev checkout:

```json
{
  "plugin": ["/absolute/path/to/theSaver-oc/src/index.js"]
}
```

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
| `trinity enforce on\|off` | Toggle delegation enforcement |
| `trinity lock on\|off` | Freeze model for session |
| `trinity flow on\|off` | Toggle flow enforcer |
| `trinity flow enforce on\|off` | Toggle auto-extract TODOs |
| `trinity tdd on\|off\|strict\|quality` | Test skeleton behavior |
| `trinity rebuild` | Re-detect models from all providers |
| `trinity project` | Per-project analytics |
| `trinity patterns` / `trinity patterns clear` | Pattern inspection |
| `trinity diagnose` | Health check |
| `trinity blackbox on\|off\|status\|reset` | Decision engine control |
| `trinity repair-state preview\|apply` | Fix state collisions |
| `trinity guard` | Refresh AGENTS.md / README.md |
| `trinity api-token <token\|invalidate>` | Manage remote API token |
| `trinity api-bootstrap-token <token>` | Bootstrap token exchange |

**Report commands**: report-save, report-list, report-read, research-audit

## Live Footer

```
— Model: claude-sonnet-4-6 | Provider: Anthropic | $4.82 saved | $1.20 cached | ENFORCE | LOCK | Quality | VIBE —
```

Provider, model, delegation savings, cache savings, stress level (low/elevated/high), lock/enforcement tags, optimization mode. Persisted in ~/.claude/delegation-state.json.

## Architecture

### Plugin Source

Single-file runtime `src/index.js` (5529+ lines). TypeScript source of truth at `src/vibeOS-lib/*.ts` and `src/utils/*.ts`. Build: `npm run build` (tsc compile + sync-ts-build + deploy script).

### State Files (~/.claude/)

| File | Purpose |
|------|---------|
| delegation-state.json | Sessions, warns, cache hits, lifetime totals |
| model-tiers.json | brain/medium/cheap model IDs |
| project-states.json | Per-project memory, analytics, report references |
| reports/ | Saved report JSON files |
| savings-ledger.jsonl | Append-only savings and credit event log |
| global-learning.json | Cross-project pattern learning, pricing hints |
| model-pricing-cache.json | Cached pricing by model ID |
| active-jobs.json | In-flight delegation records |
| blackbox-state.json | Per-project resolution tracker, session outcomes |
| .flow-todo-queue.jsonl | Flow enforcer TODO queue |
| .flow-dedup-keys.json | Deduplication set for flow TODO |
| .enforcement-cooldown.jsonl | Per-tool cooldown for warn coalescing |

### Local vs Remote

**Fully functional locally:** Model tier classification, static pricing, stress scoring, context budget, turn classification, TDD skeleton generation, flow enforcement, savings ledger, session metrics, reports, footer, dashboard, smart cache, VibeBoX fallback.

**Requires remote API (api-token):** Bootstrap token exchange, advanced VibeBoX with full session history, dynamic per-prompt delegation, cross-session calibration, live pricing fetch beyond static map, learned subagent routing.

When the remote API is unreachable, the plugin degrades gracefully to rule-based local algorithms. Core enforcement features continue working.

### VibeBoX Decision Engine

7 sub-regimes (INIT, DIVERGENT, EXPLORING, REFINING, CONVERGING, CLOSED, LOOPING). Classification via entropy trends, action consistency, feature contradiction, embedding drift. 11 derived features per turn. 4 loop intervention levels. PIVOT/SWITCH detection. Outcome tracking from satisfaction signals.

Regime -> mode mapping via syncControlSettings():

| Regime | Mode | Enforce | Flow | TDD | Tier | Think |
|--------|------|---------|------|-----|------|-------|
| INIT / DIVERGENT / EXPLORING / REFINING | budget | relaxed | audit | lazy | cheap | off |
| CONVERGING / CLOSED | quality | strict | strict | quality | brain | full |
| LOOPING | speed | relaxed | audit | lazy | medium | off |

Stress > 1.5 escalates any regime to quality.

### Remote API Server

`src/vibeOS-api-server/` — Fastify + SQLite at api.vibetheog.com. Endpoints: delegation check, tier routing, stress scoring, VibeBoX analysis/calibration, TDD skeleton gen, pattern observation, pricing fetch, context compression. Auth via VIBEOS_API_TOKEN. Client: `src/vibeOS-api-server/client.js` with automatic local fallback.

### Dashboard

SolidJS SPA at `src/dashboard/`. Build: `npm run build:dashboard` (vite). Served by MCP server or standalone. SSE /events for real-time push.

## Environment Variables

| Variable | Default | Effect |
|----------|---------|--------|
| VIBEOS_API_URL | https://api.vibetheog.com | Remote API base URL |
| VIBEOS_API_TOKEN | unset | Remote API auth |
| VIBEOS_API_DISABLED | false | Invalidate alpha token |
| VIBEOS_API_BOOTSTRAP_TOKEN | unset | Bootstrap exchange |
| VIBEOS_API_ENABLED | true | Set false for local-only |
| CLAUDE_CREDIT_PERCENT | 100 | Credit override |
| CLAUDE_CONTEXT7_AVAILABLE | unset | Context7 optimization |
| VIBEOS_MCP_PORT | 3001 | MCP server port |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Plugin not loading | Check opencode.json entry. Restart Desktop. |
| Model won't switch | `trinity rebuild` then `trinity set brain|medium|cheap` |
| Writes/edits blocked | Enforcement active — delegate to cheap tier |
| No footer visible | Verify plugin enabled, completions running |
| Dashboard blank | `npm run build` then restart |
| State looks wrong | `trinity diagnose` then `trinity repair-state preview` |

---

*`trinity help` is the canonical command reference. This README stays high-level so command details follow the code without a rewrite.*
