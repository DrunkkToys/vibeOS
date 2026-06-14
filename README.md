# vibeOS for OpenCode — Innocence v0.25.0

Cost-aware control plane for OpenCode Desktop.

OpenCode Desktop gives you access to the most capable language models ever created — Opus, Sonnet, DeepSeek v4 Pro — but running them on every single turn adds up fast. Most users do not think about token costs until the bill arrives, and by then the damage is done. You should not have to choose between using the best model and staying within budget. That choice is a distraction from the work that matters.

Innocence is about removing that cognitive overhead entirely. vibeOS handles the economics behind the scenes — routing, cascading, deferring, and optimizing every turn so you never have to think about cost again. You code with innocence. The plugin earns its keep silently.

## How It Feels

The first thing you notice is the footer. A single line at the bottom of every assistant response, barely visible, shows you what model handled the turn and how much you have saved this session. It is not a warning. It is not a nag. It is reassurance.

```
- brain | Deepseek | V4 Pro | $12.57 | VibeMaX Budget
```

When you write code, the system routes implementation work to cheaper tiers automatically if the brain is reserved for strategy. You never see a block screen. You never get a cost warning interrupting your flow. The enforcement happens transparently — the work gets done, just on the right tier.

The VibeBoX decision engine watches how you work. Are you exploring a new codebase? It keeps the cheap model active and stays out of your way. Are you converging on a solution? It quietly upgrades to full quality mode with strict enforcement. Are you stuck in a loop fixing the same test? It detects the frustration pattern and escalates before you ask. You never configure any of this. It just adapts.

The stress detector reads your messages for signs of frustration — repeated failures, urgency, abrupt tone. When it senses stress above a threshold, it upgrades your model tier automatically. You get the best possible assistance while you are in the weeds, and you never had to ask.

You forget vibeOS is even running. That is the point.

## The ML Engine

vibeOS is not a collection of static rules. It is a learning system that patterns your work style and adapts the control plane in real time.

### VibeUltraX Cascade

The flagship routing strategy. Every turn passes through a three-stage cascade:

1. **Cheap proposal** — Your configured cheap slot generates an initial response (e.g., a local Ollama model via `trinity set cheap magiccoder:7b`, or any API model).
2. **Flash review** — DeepSeek v4 Flash critiques and refines the proposal.
3. **Pro polish** — DeepSeek v4 Pro applies final quality pass on complex sections.

Benchmarked at **107% of raw brain quality at 58% of cost**. Local inference is free; only the Flash and Pro stages incur API costs. This is the first routing strategy that Pareto-dominates the raw brain baseline — better quality, lower cost.

### VibeBoX Decision Engine

At the core of vibeOS is a real-time decision engine that classifies every user turn into one of seven sub-regimes:

- **INIT / DIVERGENT / EXPLORING** — You are learning the codebase, asking questions, browsing. cheap model, relaxed enforcement. Stay out of your way.
- **REFINING** — You are iterating on a solution. Default mode: VibeMaX, auto-escalate on complexity.
- **CONVERGING / CLOSED** — You are finalizing. Full quality mode, brain tier, strict enforcement and flow checks.
- **LOOPING** — You are stuck. Speed mode, medium tier, cycle-breaking interventions.

Classification uses 11 derived features per turn: message length, code block density, question ratio, urgency signals, sentiment, complexity estimate, repetition, instruction density, and more. Four escalating intervention levels prevent infinite loops. PIVOT/SWITCH detection recognizes context changes and injects scope-confirmation directives.

When the VibeBoX is disabled, a lightweight `classifyTurnSimple` fallback distinguishes Q&A from implementation intent using regex patterns.

### Stress-Aware Routing

A real-time stress scoring pipeline analyzes user messages for frustration signals. When stress exceeds 1.5 (on a 0–3 scale), any regime is escalated to quality mode. The stress gauge renders in the footer as a subtle indicator. Inoculation directives are injected into system prompts to adjust the assistant's tone — slower, more structured, more thorough.

### Pattern Learner

Per-project friction and routine tracking. The pattern learner observes which tools you use, what errors recur, and where you spend most of your time. Over time, it surfaces optimization suggestions and learns struggle/tech co-occurrence mappings. Cross-project patterns are stored in `global-learning.json` and inform pricing hints and routing hints.

## The Numbers

The savings are real and measurable. Every write/edit on the brain tier is intercepted, cost-estimated, and routed to a cheaper tier. A single blocked brain-tier write saves at least $0.026 over Opus-to-Sonnet delegation.

### Savings per Delegation

| Move | Per Turn | 10x | 100x | 1,000x |
|------|----------|-----|------|--------|
| Opus -> Haiku | $0.0308 | $0.31 | $3.08 | $30.80 |
| Opus -> Sonnet | $0.0264 | $0.26 | $2.64 | $26.40 |
| Sonnet -> Haiku | $0.0044 | $0.04 | $0.44 | $4.40 |

The running total is persisted in `~/.claude/delegation-state.json` and displayed in the live footer. Cache savings are tracked separately under `cache_savings_usd`.

### Model Tiers

Benchmarked on the DeepSeek v4 family. Prices based on 700 input + 300 output tokens per turn.

| Slot | Model | API ID | Per Turn | Per 1K Turns | Tier |
|------|-------|--------|----------|--------------|------|
| brain | v4 Pro | `deepseek/deepseek-v4-pro` | $0.00057 | $0.58 | high |
| medium | v4 Flash | `deepseek/deepseek-v4-flash` | $0.000182 | $0.18 | mid |
| cheap | DeepSeek Chat | `deepseek/deepseek-chat` | $0.00 | $0.00 | budget |
| cheap (local) | MagicCoder:7b | `magiccoder:7b` (Ollama) | $0.00 | $0.00 | budget |

DeepSeek Chat costs $0/turn when routed through the Direct DeepSeek provider (no OpenRouter markup).

### Optimization Modes

| Policy | Quality vs Brain | Cost vs Brain | Savings | Method |
|--------|-----------------|--------------|---------|--------|
| VibeUltraX | 107% | 0.58x | 42% | cheap -> medium -> brain cascade |
| VibeQMaX | ~100% | 0.50x | 50% | same model, framework optimizations |
| Raw Brain | 100% | 1.00x | - | baseline |
| VibeMaX | ~75% | 0.18x | 82% | trained cascade (conservative escalate) |
| Budget | ~40% | 0.00x | 100% | direct routing |

**VibeUltraX** — Cheap slot proposes, medium reviews, brain refines. 107% quality at 58% cost.

**VibeQMaX** — Routes strategic turns through v4 Pro with full thinking, strict enforcement, strict flow checks, and quality TDD. Write/edit delegated per enforcement rules. Blended cost ~$0.00029/turn (50% of brain baseline).

**VibeMaX** — ML-optimized default. Routes through v4 Flash with a random forest classifier (29 trees, gini-split, trained on telemetry) that decides each turn. ~75% quality at 18% cost.

**Budget** — DeepSeek Chat. Direct routing. ~40% quality at zero cost.

### Mode Configuration

| Mode | Model | Thinking | Enforcement | Flow | TDD |
|------|-------|----------|-------------|------|-----|
| Raw Brain | v4 Pro | full | - | - | - |
| VibeQMaX | v4 Pro | full | strict | strict | quality |
| VibeUltraX | cascade (cheap->medium->brain) | auto | auto | auto | auto |
| VibeMaX | v4 Flash (auto-escalate) | auto | auto | auto | auto |
| Speed | v4 Flash | off | relaxed | audit | lazy |
| Budget | DeepSeek Chat | off | relaxed | audit | lazy |

### Auto-Mode Behavior

When auto-mode is active, the VibeBoX control vector is the authority. `syncControlSettings()` writes enforcement, flow, TDD, and thinking mode to `model-tiers.json` every turn:

| Regime | Mode | Enforce | Flow | TDD | Tier | Think |
|--------|------|---------|------|-----|------|-------|
| INIT / DIVERGENT / EXPLORING / REFINING | vibelitex | relaxed | audit | lazy | cheap | off |
| CONVERGING / CLOSED | quality | strict | strict | quality | brain | full |
| LOOPING | quality | relaxed | audit | lazy | brain | full |

Stress > 1.5 escalates any regime to quality mode regardless of the above mapping.

## What You Get

| Feature | What it does |
|---------|-------------|
| Delegation enforcement | Blocks write/edit on brain tier, routes to cheaper tiers transparently |
| Live savings footer | Tier, provider, model name, total savings, mode — one line of reassurance |
| Web dashboard | SolidJS SPA with SSE real-time push for model split, savings, session history, controls |
| Trinity runtime | Switch tiers mid-session, change optimization mode, toggle subsystems live |
| Flow enforcer | Pattern-rule checks on write/edit. Extracts TODO/FIXME into append-only queue. |
| TDD enforcer | Auto-creates test skeletons for changed source. Strict mode fails TODO tests. |
| Pattern learner | Tracks recurring struggle/routine patterns per project, cross-project too |
| VibeBoX | 7 sub-regimes, 11 features per turn, loop intervention, PIVOT/SWITCH detection |
| Stress-aware routing | Real-time stress scoring, auto-escalation, system prompt inoculation |
| Cache savings | Separate cache_savings_usd tracking for scratchpad cache hits |
| Report tools | report-save, report-list, report-read, research-audit |
| MCP server | Extended tool capabilities + dashboard serving + SSE push endpoint |
| Remote API | Fastify server at api.vibetheog.com with token auth and seat management |
| Session lock | trinity lock on|off — freezes model at session start |
| Model locking | Per-session lock that skips auto-reconcile with OpenCode config changes |
| Blackbox decision engine | Dialogue trajectory tracking, loop prevention, outcome calibration |
| TensorTAG routing | WBP protocol synthesizes delegated task output in assistant chat |
| Pattern learner runtime | trinity patterns and trinity patterns clear |

## Install

```bash
npx vibeostheog setup --project        # per-project
npx vibeostheog setup                   # global ~/.config/opencode/
npx vibeostheog setup --help             # full usage
```

One command. Deploys plugin files and registers in opencode.json. Restart OpenCode Desktop.

Local dev checkout:

```json
{
  "plugin": ["/absolute/path/to/theSaver-oc/dist/vibeOS.js"]
}
```

## Commands

`trinity help` for full reference. Commands register in the TUI sidebar.

| Command | Effect |
|---------|--------|
| `trinity status` | Tier, enforcement, savings, stress, lock state |
| `trinity set brain\|medium\|cheap [model=<model_id>]` | Switch active model tier or override slot |
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

## Under the Hood

### Architecture

vibeOS hooks into OpenCode Desktop through 8 extension points:

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

### State Files (~/.claude/)

The plugin persists state to `~/.claude/` for cross-session continuity:

- **delegation-state.json** — Sessions, warns, cache hits, lifetime totals
- **model-tiers.json** — Brain/medium/cheap model IDs
- **project-states.json** — Per-project memory, analytics, report references
- **blackbox-state.json** — Per-project resolution tracker, session outcomes
- **savings-ledger.jsonl** — Append-only savings event log
- **global-learning.json** — Cross-project pattern learning
- **active-jobs.json** — In-flight delegation records

### Local vs Remote

Core features work fully offline: model tier classification, static pricing, stress scoring, context budget, VibeBoX fallback, TDD skeletons, flow enforcement, savings ledger, session metrics, reports, footer, dashboard.

Remote API (api.vibetheog.com) enables: bootstrap token exchange, advanced VibeBoX with full session history, dynamic per-prompt delegation, cross-session calibration, live pricing fetch, learned subagent routing. Falls back gracefully when unreachable.

### Live Footer

The footer is the primary status line, appended to every assistant response. It surfaces model assignment, savings, mode, alerts, and session metrics in a single line.

```
- brain | DeepSeek | v4-flash -> RFNE | $198.93 saved | VibeUltraX . Quality >>> | guarded | _
```

**Segments (left to right):**

| Segment | Format | Example | Meaning |
|---------|--------|---------|---------|
| Tier icon + slot | icon tier | `- brain` | Active model slot |
| Provider + model | provider modelName | `DeepSeek | v4-flash` | Current model |
| Regime | regimeIcon regimeTag | `-> RFNE` | Current sub-regime classification |
| Savings | `$X saved` | `$198.93 saved` | Lifetime savings |
| Flash icon | flashIcon | `  ` (lightning) | API connected indicator |
| Brand + mode label | VibeBrand . modeLabel | `VibeUltraX . Quality` | Requested mode + regime-derived label |
| Cascade icon | >>> or >> | `>>>` | VibeUltraX cascade depth >= 3 |
| Enforcement tags | guarded, flow steady, tests live | `guarded` | Guard state summary |
| Stress gauge | gaugeChar | `_` | Current stress level (none/calm/elevated/high/critical) |
| Session slot | session:slot | `session:medium` | Different active slot |
| Vector pulse | slot | `cheap` | Active slot changed this turn |

**Stress gauge levels:**

| Gauge | Range | Meaning |
|-------|-------|---------|
| `_` | 0 - 0.1 | None |
| `_` | 0.1 - 0.3 | Minimal |
| `_` | 0.3 - 0.5 | Calm |
| `_` | 0.5 - 0.7 | Elevated |
| `_` | 0.7 - 0.85 | High |
| `_` | 0.85+ | Critical |

**Cascade icon (VibeUltraX mode only):**

| Icon | cascade_depth | Meaning |
|------|---------------|---------|
| (none) | 1 | Direct response, no cascade |
| `>>` | 2 | Standard cascade (medium -> brain) |
| `>>>` | 3+ | Deep cascade (cheap -> medium -> brain) |

Controls: `trinity status` for full state, `trinity enable/disable` to toggle. Persisted in `~/.claude/delegation-state.json`.

### Environment Variables

| Variable | Default | Effect |
|----------|---------|--------|
| VIBEOS_API_URL | https://api.vibetheog.com | Remote API base URL |
| VIBEOS_API_TOKEN | unset | Remote API auth |
| VIBEOS_API_DISABLED | false | Invalidate alpha token |
| VIBEOS_API_BOOTSTRAP_TOKEN | unset | Bootstrap exchange |
| VIBEOS_API_ENABLED | true | Set false for local-only |
| CLAUDE_CREDIT_PERCENT | 100 | Credit override |
| VIBEOS_MCP_PORT | 3001 | MCP server port |

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| Plugin not loading | Check opencode.json entry. Restart Desktop. |
| Model won't switch | `trinity rebuild` then `trinity set brain\|medium\|cheap` |
| Writes/edits blocked | Enforcement active — delegate to cheap tier |
| No footer visible | Verify plugin enabled, completions running |
| Dashboard blank | `npm run build` then restart |
| State looks wrong | `trinity diagnose` then `trinity repair-state preview` |

---

*`trinity help` is the canonical command reference. This README stays high-level so command details follow the code without a rewrite.*
