# vibeOS for OpenCode -- Innocence v0.25.48

A quality-first control plane for AI-assisted coding.

When AI coding is cheap, you use more of it. That is the upside of the current moment -- the marginal cost of a code suggestion has collapsed. But volume does not equal quality. The more you delegate to AI, the more often a mediocre suggestion slips through: a half-implemented fix, a fabricated API call, a test that passes only because the assertions are stubs. The quality problem gets worse as the cost problem gets better. vibeOS exists to solve the quality problem. The savings are a side effect.

OpenCode Desktop gives you access to the most capable language models ever created -- Opus, Sonnet, DeepSeek v4 Pro -- but running them on every single turn adds up fast. More importantly, routing every turn through the most expensive model does not guarantee the best output. A cheap model proposing, a mid-tier model reviewing, and a top-tier model polishing often produces better results than a single expensive model guessing alone. vibeOS makes that routing decision automatically, on every turn, based on what you are actually doing.

## How It Feels

The first thing you notice is the footer. A single line at the bottom of every assistant response, barely visible, shows you what model handled the turn and the regime classification for what just happened. It is not a warning. It is not a nag. It is a quality receipt.

```
— brain | DeepSeek | v4-flash -> RFNE | $198.93 saved | VibeUltraX . Quality >>> | guarded | _
```

When you write code, the system routes implementation work to cheaper tiers automatically if the brain is reserved for strategy. You never see a block screen. You never get a cost warning interrupting your flow. The enforcement happens transparently -- the work gets done, just on the right tier.

The VibeBoX decision engine watches how you work. Are you exploring a new codebase? It keeps the cheap model active and stays out of your way. Are you converging on a solution? It quietly upgrades to full quality mode with strict enforcement. Are you stuck in a loop fixing the same test? It detects the frustration pattern and escalates before you ask. You never configure any of this. It just adapts.

The stress detector reads your messages for signs of frustration -- repeated failures, urgency, abrupt tone. When it senses stress above a threshold, it upgrades your model tier automatically. You get the best possible assistance while you are in the weeds, and you never had to ask.

The lie detector flags when the assistant claims success without evidence. The laziness detector catches short outputs, TODO placeholders, and skipped delegation on brain tier. The reward engine gamifies quality with XP credits for good outcomes and penalties for bad ones. You forget vibeOS is even running. That is the point.

## The Cascade Engine

vibeOS uses a three-tier cascade to route every turn through the cheapest model that can produce a quality result.

### How It Works

1. **Cheap proposal** -- Your configured cheap slot generates an initial response (e.g., a local Ollama model via `vibe set cheap magiccoder:7b`, or any API model).
2. **Flash review** -- A mid-tier model (DeepSeek v4 Flash) critiques and refines the proposal.
3. **Pro polish** -- The brain-tier model (DeepSeek v4 Pro) applies a final quality pass on complex sections.

Not every turn goes through all three stages. The cascade router estimates input difficulty and routes simple queries directly to the cheap tier. Complex reasoning, multi-file edits, and ambiguous instructions escalate to medium or brain. The router learns from session outcomes and calibrates its thresholds over time.

Benchmarked at **107% of raw brain quality at 58% of cost**. Local inference is free; only the Flash and Pro stages incur API costs. This is the first routing strategy that Pareto-dominates the raw brain baseline -- better quality, lower cost.

### Research Foundation

The cascade design is informed by recent work in LLM routing and cascade inference:

**Dekoninck et al. (2024)** -- "A Unified Approach to Routing and Cascading for LLMs" (arXiv:2410.10347, 52 citations). Foundational framework showing cascade routing is theoretically optimal when calibrated routers can estimate input difficulty. Proves cascades Pareto-dominate single-model inference on the quality-cost curve. This is the theoretical basis for vibeOS's claim that a three-stage cascade can outperform a single expensive model on both quality and cost simultaneously.

**Moslem & Kelleher (2026)** -- "Dynamic Model Routing and Cascading for Efficient LLM Inference: A Survey" (arXiv:2603.04445, 10 citations). Comprehensive survey covering all routing paradigms: classifier-based, embedding-based, RL-based, hybrid. Establishes cascade routing as a well-studied class with practical deployment strategies. Validates that the cheap-propose / mid-review / pro-polish pattern is a known and effective architecture, not an ad hoc design.

**Jiang et al. (2025)** -- "Cascadia: An Efficient Cascade Serving System for Large Language Models" (arXiv:2506.04203, 3 citations). Co-optimizes deployment and routing -- reduces compute cost 42% and latency 50% vs. naive cascade serving. Demonstrates that cascades work in practice, not just in theory. The cost reduction numbers align closely with vibeOS's measured 58% cost reduction under VibeUltraX.

**Bouchard (2026)** -- "Is Escalation Worth It? A Decision-Theoretic Characterization of Cascade Routing at Inference Time" (arXiv:2604.04408, 1 citation). Models escalation as a binary decision problem. Shows cascades pay off when router accuracy exceeds 84% and cheaper model failure rate is above 5%. Below that, flat routing dominates. This work informs vibeOS's escalation thresholds: the cascade only escalates when the router confidence exceeds the point where flat routing would be better.

### VibeBoX Decision Engine

At the core of vibeOS is a real-time decision engine that classifies every user turn into one of seven sub-regimes:

- **INIT / DIVERGENT / EXPLORING** -- You are learning the codebase, asking questions, browsing. cheap model, relaxed enforcement. Stay out of your way.
- **REFINING** -- You are iterating on a solution. Default mode: VibeMaX, auto-escalate on complexity.
- **CONVERGING / CLOSED** -- You are finalizing. Full quality mode, brain tier, strict enforcement and flow checks.
- **LOOPING** -- You are stuck. Speed mode, medium tier, cycle-breaking interventions.

Classification uses 11 derived features per turn: message length, code block density, question ratio, urgency signals, sentiment, complexity estimate, repetition, instruction density, and more. Four escalating intervention levels prevent infinite loops. PIVOT/SWITCH detection recognizes context changes and injects scope-confirmation directives.

When the VibeBoX is disabled, a lightweight classifyTurnSimple fallback distinguishes Q&A from implementation intent using regex patterns.

### Stress-Aware Routing

A real-time stress scoring pipeline analyzes user messages for frustration signals. When stress exceeds 1.5 (on a 0-3 scale), any regime is escalated to quality mode. The stress gauge renders in the footer as a subtle indicator. Inoculation directives are injected into system prompts to adjust the assistant's tone -- slower, more structured, more thorough.

### Pattern Learner

Per-project friction and routine tracking. The pattern learner observes which tools you use, what errors recur, and where you spend most of your time. Over time, it surfaces optimization suggestions and learns struggle/tech co-occurrence mappings. Cross-project patterns are stored in global-learning.json and inform pricing hints and routing hints.

### Token Compression

Three-layer compression pipeline reduces token waste without losing semantic content:

1. **Web fetch stripping** (`compressText`) -- Applied immediately after webfetch tool execution. Strips verbose status lines, file-operation prefixes, and bullet markers. Collapses blank lines. If the result still exceeds 2000 characters, extracts bullet-priority lines and truncates to 30% of original size. Threshold: 2000 characters minimum.

2. **Cold-storage context compression** (`compressToolOutputs`) -- Runs on every LLM turn via the messages transform hook. Tool outputs older than the last 10 messages (the "hot window") are written to content-addressed cold storage (`~/.claude/scratchpad/by-hash/{hash}.txt`) and replaced with a ~200-character summary reference. Hot messages stay fully expanded so the LLM can reference recent context. Savings are estimated per-model using `cacheSavePer1MInputTokens()` and recorded to the delegation state.

3. **Project memory directives** (`projectMemoryDirective`) -- Compresses per-project state (sessions, reports, tech stack, topics) into a single-line directive injected into the system prompt. Full JSON stored for audit; prompt gets only the compact form.

The remote API also exposes a `POST /api/v1/compress/context` endpoint for server-side bullet-point extraction, available as a fallback for arbitrary text compression.

### Rotation Memory (Scratchpad Decadence)

The scratchpad rotation system manages the lifecycle of cached tool outputs through four age-based tiers:

| Age | Action | Content Preserved |
|-----|--------|-------------------|
| < 5 minutes | Kept as-is | Full content |
| 5 min - 24 hours | Warm storage | 500-char summary + pointer |
| 24 - 48 hours | Cold storage | 200-char summary + pointer |
| > 48 hours | Deleted | Nothing |

Rotation runs opportunistically on every tool execution and message transform, throttled to once per minute via `_lastDecadenceRun`. The effect is graceful degradation: fresh cache hits return full content, warm hits return summaries, cold hits return minimal previews, and expired entries are gone.

Global caps prevent unbounded growth: 1000 files / 10 MB total, 200 files / 2 MB per session. Stale session directories are cleaned up after 48 hours.

### Smart Cache Prediction

The smart cache predicts whether a tool query will hit scratchpad cache before execution, using three similarity functions blended into a composite score:

- **Jaccard similarity** (weight 0.3) -- Word-level overlap between current and cached prompts
- **Cosine bigram similarity** (weight 0.3) -- Word-pair co-occurrence angle
- **Keyword overlap** (weight 0.4) -- Domain-weighted overlap (code/file/fix/test keywords weighted 3x)

The prediction engine (`predictCacheHit`) computes a confidence score and returns whether caching is worthwhile, estimated savings, and the most similar cached entries. Per-tool hit rates are tracked with exponential decay (DECAY = 0.9) so recent performance matters more than historical averages.

Cache state persists across sessions in `~/.claude/global-learning.json` with a 7-day TTL eviction. The prediction results feed into the delegation enforcer's cost calculations and appear in the live footer savings display.

### Pivot and Counter-Pivot

Two complementary mechanisms manage context transitions:

**Forward pivot** -- Detects when you abruptly change topic mid-session. Uses a composite score of word-overlap distance, instruction-density delta, message-length ratio, and action-type change. Fires when `pivotScore > 0.45`. When detected:
1. Snapshots the current workflow (intent, files, decisions, blockers, code) to `~/.claude/.vibeos-pivot-cache.json`
2. Downgrades mode to budget (cheap tier, thinking off, relaxed enforcement)
3. Injects a context-shift directive into the system prompt

**Counter-pivot** -- Detects when you return to a previously abandoned workflow. Compares current query tokens against all cached workflow snapshots using Jaccard similarity with exact-match and recency bonuses. Fires when confidence >= 0.5. When detected:
1. Restores files, decisions, blockers, and code snippets from the cached workflow
2. Injects a `[PIVOT BACK]` context-restoration string into the system prompt
3. Warms the smart cache with tool outputs from the cached workflow
4. Increments `access_count` on the cached entry (learning which workflows get revisited)

The pivot system integrates with the loop intervention escalation: assertive loop-breaking uses "PIVOT: list 3 alternative approaches", and escalated intervention uses "STOP entirely. Reset strategy, SWITCH topics."

## The Numbers

The savings are real and measurable. Every write/edit on the brain tier is intercepted, cost-estimated, and routed to a cheaper tier. A single blocked brain-tier write saves at least $0.026 over Opus-to-Sonnet delegation.

### Savings per Delegation

| Move | Per Turn | 10x | 100x | 1,000x |
|------|----------|-----|------|--------|
| Opus -> Haiku | $0.0308 | $0.31 | $3.08 | $30.80 |
| Opus -> Sonnet | $0.0264 | $0.26 | $2.64 | $26.40 |
| Sonnet -> Haiku | $0.0044 | $0.04 | $0.44 | $4.40 |

The running total is persisted in ~/.claude/delegation-state.json and displayed in the live footer. Cache savings are tracked separately under cache_savings_usd.

### Model Tiers

Benchmarked on the DeepSeek v4 family. Prices based on 700 input + 300 output tokens per turn.

| Slot | Model | API ID | Per Turn | Per 1K Turns | Tier |
|------|-------|--------|----------|--------------|------|
| brain | v4 Pro | deepseek/deepseek-v4-pro | $0.00057 | $0.58 | high |
| medium | v4 Flash | deepseek/deepseek-v4-flash | $0.000182 | $0.18 | mid |
| cheap | DeepSeek Chat | deepseek/deepseek-chat | $0.00 | $0.00 | budget |
| cheap (local) | MagicCoder:7b | magiccoder:7b (Ollama) | $0.00 | $0.00 | budget |

DeepSeek Chat costs $0/turn when routed through the Direct DeepSeek provider (no OpenRouter markup).

### Optimization Modes

| Policy | Quality vs Brain | Cost vs Brain | Savings | Method |
|--------|-----------------|--------------|---------|--------|
| VibeUltraX | 107% | 0.58x | 42% | cheap -> medium -> brain cascade |
| VibeQMaX | ~100% | 0.50x | 50% | same model, framework optimizations |
| Raw Brain | 100% | 1.00x | - | baseline |
| VibeMaX | ~75% | 0.18x | 82% | trained cascade (conservative escalate) |
| Budget | ~40% | 0.00x | 100% | direct routing |

**VibeUltraX** -- Cheap slot proposes, medium reviews, brain refines. 107% quality at 58% cost.

**VibeQMaX** -- Routes strategic turns through v4 Pro with full thinking, strict enforcement, strict flow checks, and quality TDD. Write/edit delegated per enforcement rules. Blended cost ~$0.00029/turn (50% of brain baseline).

**VibeMaX** -- ML-optimized default. Routes through v4 Flash with a random forest classifier (29 trees, gini-split, trained on telemetry) that decides each turn. ~75% quality at 18% cost.

**Budget** -- DeepSeek Chat. Direct routing. ~40% quality at zero cost.

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

When auto-mode is active, the VibeBoX control vector is the authority. syncControlSettings() writes enforcement, flow, TDD, and thinking mode to model-tiers.json every turn:

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
| Live savings footer | Tier, provider, model name, total savings, mode -- one line of reassurance |
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
| Session lock | vibe lock on|off -- freezes model at session start |
| Model locking | Per-session lock that skips auto-reconcile with OpenCode config changes |
| Blackbox decision engine | Dialogue trajectory tracking, loop prevention, outcome calibration |
| TensorTAG routing | WBP protocol synthesizes delegated task output in assistant chat |
| Pattern learner runtime | trinity patterns and trinity patterns clear |
| Reward engine | Quality credits, saving bonus, lie/laziness penalties -- gamified quality assurance |
| Lie detector | Detects fabricated claims, invented function names, hallucinated APIs |
| Laziness detector | Flags short outputs, TODO placeholders, skipped delegation on brain tier |
| Claim verification | Scans assistant output for made-up references, validates against codebase |
| Token compression | Web fetch output stripped to 30% of original size -- verbose lines, bullet prefixes, and blank lines collapsed. Tool output history compressed to cold-storage references after the hot window (last 10 messages). Project memory condensed to single-line directives for system prompts. |
| Rotation memory | Scratchpad files age through a four-stage lifecycle: fresh (< 5 min, full content), warm (5 min - 24 hr, 500-char summary), cold (24 - 48 hr, 200-char summary), expired (> 48 hr, deleted). Rotation runs opportunistically on every tool execution, throttled to once per minute. Cache hits degrade gracefully over time instead of failing abruptly. |
| Smart cache | Predicts whether a tool query will hit scratchpad cache using composite similarity scoring (Jaccard + cosine bigram + weighted keyword overlap). Per-tool hit rates tracked with exponential decay. Estimated savings calculated and displayed in the live footer. Cache entries persisted across sessions via global-learning.json with 7-day TTL eviction. |
| Pivot / counter-pivot | Detects when you switch topics mid-session (forward pivot) and when you return to a previously abandoned workflow (counter-pivot). Forward pivots snapshot the old workflow context and downgrade to budget mode. Counter-pivots restore files, decisions, blockers, and code snippets from cached workflow snapshots into the system prompt. |
| Deferred reports | saveReport deferred to setTimeout to avoid blocking tool output |
| Stress gauge footer | Live indicator in footer -- ▁▂▃▅▆█ (none/minimal/calm/elevated/high/critical) |

## Install

```bash
npx vibeostheog setup --project        # per-project
npx vibeostheog setup                   # global ~/.config/opencode/
npx vibeostheog setup --help             # full usage
```

One command. Deploys plugin files and registers in opencode.json. Restart OpenCode Desktop.
It also ships the `/vibe` entrypoint so the slash-command surface works on user installs.

Local dev checkout:

```json
{
  "plugin": ["/absolute/path/to/theSaver-oc/dist/vibeOS.js"]
}
```

## Commands

`vibe help` (or `trinity help`) for full reference. Commands register in the TUI sidebar.
`/vibe` is the fast slash-command entrypoint for the same command surface.

| Command | Effect |
|---------|--------|
| `/vibe` | OpenCode slash-command entrypoint for status, dashboard, sessions, templates, and diagnostics |
| `vibe status` (or `trinity status`) | Tier, enforcement, savings, stress, lock state |
| `vibe dashboard` / `vibe gui` | Live dashboard URL and browser entrypoint |
| `vibe set brain|medium|cheap [model=<model_id>]` | Switch active model tier or override slot |
| `vibe brain|medium|cheap` | Shorthand tier switch |
| `vibe enable|disable` | Toggle plugin on/off |
| `vibe mode budget|quality|speed|longrun|auto|balanced|audit|forensic` | Set optimization mode |
| `vibe thinking full|brief|off` | Reasoning depth |
| `vibe enforce on|off` | Toggle delegation enforcement |
| `vibe lock on|off` | Freeze model for session |
| `vibe flow on|off` | Toggle flow enforcer |
| `vibe flow enforce on|off` | Toggle auto-extract TODOs |
| `vibe tdd on|off` | Toggle TDD skeleton generation |
| `vibe tdd strict on|off` | Toggle strict failing TODO test templates |
| `vibe tdd quality on|off` | Toggle quality assertion stubs |
| `vibe rebuild` (or `trinity rebuild`) | Re-detect models from all providers |
| `vibe project` | Per-project analytics |
| `vibe patterns` / `vibe patterns clear` | Pattern inspection |
| `vibe diagnose` | Health check |
| `vibe blackbox on|off|status|reset` | Decision engine control |
| `trinity repair-state preview|apply` | Fix state collisions |
| `vibe guard` | Refresh AGENTS.md / README.md |
| `vibe reality-check` | Read verified live state, report evidence-backed facts only |
| `vibe setup` | Create a compatibility profile for first-time users; fresh installs start in VibeUltraX |
| `trinity api-token <token|invalidate>` | Manage remote API token |
| `trinity api-bootstrap-token <token>` | Bootstrap token exchange |

**Report commands**: report-save, report-list, report-read, research-audit

## Under the Hood

### Architecture

vibeOS hooks into OpenCode Desktop through 8 extension points:

| Hook | Purpose |
|------|---------|
| experimental.text.complete | Appends footer to assistant responses |
| experimental.chat.messages.transform | Injects delegation protocol content |
| experimental.chat.system.transform | Injects cost optimization, stress inoculation, enforcement directives |
| tool.execute.before | Blocks write/edit on brain tier |
| tool.execute.after | Injects delegation UI notes |
| message.updated | Fallback footer for versions without text.complete |
| experimental.session.compacting | Preserves savings state |
| shell.env | Injects OPENCODE_MODEL_TIER and OPENCODE_MODEL |

### State Files (~/.claude/)

The plugin persists state to ~/.claude/ for cross-session continuity:

- **delegation-state.json** -- Sessions, warns, cache hits, lifetime totals
- **model-tiers.json** -- Brain/medium/cheap model IDs
- **project-states.json** -- Per-project memory, analytics, report references
- **blackbox-state.json** -- Per-project resolution tracker, session outcomes
- **savings-ledger.jsonl** -- Append-only savings event log
- **global-learning.json** -- Cross-project pattern learning
- **active-jobs.json** -- In-flight delegation records

### Local vs Remote

Core features work fully offline: model tier classification, static pricing, stress scoring, context budget, VibeBoX fallback, TDD skeletons, flow enforcement, savings ledger, session metrics, reports, footer, dashboard.

Remote API (api.vibetheog.com) enables: bootstrap token exchange, advanced VibeBoX with full session history, dynamic per-prompt delegation, cross-session calibration, live pricing fetch, learned subagent routing. Falls back gracefully when unreachable.

### Live Footer

The footer is the primary status line, appended to every assistant response. It surfaces model assignment, savings, mode, alerts, and session metrics in a single line.

```
— brain | DeepSeek | v4-flash -> RFNE | $198.93 saved | VibeUltraX . Quality >>> | guarded | _
```

#### Tier Icons

| Icon | Slot | Meaning |
|------|------|---------|
| 🧠 | brain | Highest-tier model, reserved for complex reasoning |
| ◉ | medium | Mid-tier model, balance of quality and cost |
| ⚡ | cheap | Budget tier, fast and free or near-free |
| 🎁 | free | Free-tier model (e.g. HuggingFace free inference) |

#### Regime Icons

| Icon | Regime | Behavior |
|------|--------|----------|
| ◌ | INIT | Session starting, gathering context |
| ⇄ | DIVERGENT | Exploring multiple directions |
| ⌕ | EXPLORING | Investigating codebase, asking questions |
| ✎ | REFINING | Iterating on a solution |
| ⚙ | IMPLEMENTING | Active code generation |
| ⌁ | RESEARCH | Deep investigation, reading docs |
| ✓ | REVIEWING | Code review, verification |
| ◫ | DESIGNING | Architecture, planning |
| ⟲ | CONVERGING | Narrowing to final solution |
| ◆ | CLOSED | Task complete |
| ↻ | LOOPING | Detected stuck pattern, intervention active |
| ☑ | AUDIT | Audit mode active |
| ⟁ | FORENSIC | Forensic analysis mode active |

#### Stress Gauge

| Gauge | Threshold | Meaning |
|-------|-----------|---------|
| ▁ | 0 - 0.10 | None -- calm session |
| ▂ | 0.10 - 0.30 | Minimal -- slight friction detected |
| ▃ | 0.30 - 0.50 | Calm -- normal working state |
| ▅ | 0.50 - 0.70 | Elevated -- user showing signs of frustration |
| ▆ | 0.70 - 0.85 | High -- repeated failures, urgency signals |
| █ | 0.85+ | Critical -- system intervening with quality escalation |

#### Cascade Depth Icons

| Icon | Depth | Pipeline |
|------|-------|----------|
| (no icon) | 1 | Direct response, no cascade routing |
| ▸▸ | 2 | Two-stage: medium -> brain refinement |
| ▸▸▸ | 3 | Full cascade: cheap -> medium -> brain |

#### Enforcement and Status Tags

| Tag | Meaning |
|-----|---------|
| guarded | Delegation enforcement active -- write/edit on brain tier blocked |
| flow steady | Flow enforcer active, pattern rules being checked |
| flow strict | Flow enforcer in strict mode -- LGTM banned, debug artifacts flagged |
| tests live | TDD enforcer active -- test skeletons auto-generated |
| quiet | Quiet mode -- reduced footer verbosity |
| locked | Model lock active -- tier frozen for session |

#### Savings Display

| Format | Meaning |
|--------|---------|
| $X saved | Cumulative delegation + cache savings this session |
| $X saved ↗ | Savings trending upward (savings rate increasing) |
| $X saved ↘ | Savings trending downward (less delegation happening) |
| $0 saved | No savings yet this session |

#### Vector Pulse

| Tag | Meaning |
|-----|---------|
| ⟡ cheap | Active slot changed to cheap this turn |
| ⟡ medium | Active slot changed to medium this turn |
| ⟡ brain | Active slot changed to brain this turn |

**Segments (left to right):**

| Segment | Format | Example | Meaning |
|---------|--------|---------|---------|
| Tier icon + slot | icon tier | 🧠 brain | Active model slot |
| Provider + model | provider modelName | DeepSeek / v4-flash | Current model |
| Regime | regimeIcon regimeTag | -> RFNE | Current sub-regime classification |
| Savings | $X saved | $198.93 saved | Lifetime savings |
| Flash icon | flashIcon | ⚡ | API connected indicator |
| Brand + mode label | VibeBrand . modeLabel | VibeUltraX . Quality | Requested mode + regime-derived label |
| Cascade icon | >>> or >> | >>> | VibeUltraX cascade depth >= 3 |
| Enforcement tags | guarded, flow steady, tests live | guarded | Guard state summary |
| Stress gauge | gaugeChar | _ | Current stress level |
| Vector pulse | slot | cheap | Active slot changed this turn |

Controls: `vibe status` (or `trinity status`) for full state, `vibe enable/disable` to toggle. Persisted in ~/.claude/delegation-state.json.

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
| Model won't switch | vibe rebuild (or trinity rebuild) then vibe set brain/medium/cheap |
| Writes/edits blocked | Enforcement active -- delegate to cheap tier |
| No footer visible | Verify plugin enabled, completions running |
| Dashboard blank | npm run build then restart |
| State looks wrong | vibe diagnose then trinity repair-state preview |

---

*vibe help (or trinity help) is the canonical command reference. This README stays high-level so command details follow the code without a rewrite.*
