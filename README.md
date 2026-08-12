# vibeOS for OpenCode -- The Corners of the Mouth v0.27.5

> **VIBEOS_HOME** = `/Users/drunkktoys/Library/Application Support/ai.opencode.desktop/vibeOS/`
> All runtime state files live under `$VIBEOS_HOME` (set via `VIBEOS_HOME` env var on this machine).

A quality-first control plane for AI-assisted coding.

When AI coding is cheap, you use more of it. That is the upside of the current moment -- the marginal cost of a code suggestion has collapsed. But volume does not equal quality. The more you delegate to AI, the more often a mediocre suggestion slips through: a half-implemented fix, a fabricated API call, a test that passes only because the assertions are stubs. The quality problem gets worse as the cost problem gets better. vibeOS exists to solve the quality problem. The savings are a side effect.

OpenCode Desktop gives you access to the most capable language models ever created -- Opus, Sonnet, DeepSeek v4 Pro -- but running them on every single turn adds up fast. More importantly, routing every turn through the most expensive model does not guarantee the best output. vibeOS keeps one primary `vibe` agent in the dropdown, lets same-provider tier changes swap in-thread, and delegates cross-provider tier work to tier subagents without rewriting the active agent every turn.

The real system is smaller than the feature list makes it sound:

1. Routing and enforcement decide which tier should act.
2. Context compression keeps the hot path small and pushes old tool output into scratch storage.
3. Pattern learning remembers recurring friction and routine, per project first and cross-project second.
4. Quality signals combine reward, lie detection, and laziness detection so bad runs are visible.

## How It Feels

The first thing you notice is the footer. A single line at the bottom of every assistant response, barely visible, shows you what model handled the turn and the regime classification for what just happened. It is not a warning. It is not a nag. It is a quality receipt.

The dashboard now opens on an executive Home summary instead of a dense table, so you can see the active session, project, mode, stress, savings, blackbox state, open TODOs, and next action at a glance.

```text
— brain | DeepSeek | v4-flash -> RFNE | $198.93 saved | VibeUltraX . Quality >>> | guarded | _
```

When you write code, the system routes implementation work to cheaper tiers automatically if the brain is reserved for strategy. You never see a block screen. You never get a cost warning interrupting your flow. The enforcement happens transparently -- the work gets done, just on the right tier.

The VibeBoX decision engine watches how you work. Are you exploring a new codebase? It keeps the cheap model active and stays out of your way. Are you converging on a solution? It quietly upgrades to full quality mode with strict enforcement. Are you stuck in a loop fixing the same test? It detects the frustration pattern and escalates before you ask. You never configure any of this. It just adapts.

The stress detector reads your messages for signs of frustration -- repeated failures, urgency, abrupt tone. When it senses stress above a threshold, it upgrades your model tier automatically. You get the best possible assistance while you are in the weeds, and you never had to ask.

The lie detector flags when the assistant claims success without evidence. The laziness detector catches short outputs, TODO placeholders, and skipped delegation on brain tier. The reward engine rolls those signals into one quality score so the UI stays simple. You forget vibeOS is even running. That is the point.

## The Cascade Engine

vibeOS uses a single primary `vibe` agent plus three tier subagents to route every turn through the cheapest model that can produce a quality result.

### How It Works

1. **Cheap proposal** -- The unified `vibe` primary starts on your configured cheap slot (e.g., a local Ollama model via `vibe set cheap magiccoder:7b`, or any API model).
2. **Flash review** -- The medium tier runs as a subagent and critiques/refines the proposal without changing the dropdown agent.
3. **Pro polish** -- The brain tier runs as a subagent on complex sections; cross-provider work delegates there instead of flipping the active agent.

Not every turn goes through all three stages. The cascade router estimates input difficulty and routes simple queries directly to the cheap tier. Complex reasoning, multi-file edits, and ambiguous instructions escalate to medium or brain. The router learns from session outcomes and calibrates its thresholds over time.

Benchmarked at **107% of raw brain quality at 58% of cost**. Local inference is free; only the Flash and Pro stages incur API costs. This is the first routing strategy that Pareto-dominates the raw brain baseline -- better quality, lower cost, without per-turn agent churn.

### Research Foundation

The cascade shape follows the general LLM routing literature, but the live source of truth is the code in this repo. The runtime does not depend on external papers; it depends on the router, the hooks, and the state files below.

### VibeBoX Decision Engine

At the core of vibeOS is a real-time decision engine that classifies every user turn into one of thirteen sub-regimes:

- **INIT / DIVERGENT / EXPLORING** -- You are learning the codebase, asking questions, browsing. cheap model, relaxed enforcement. Stay out of your way.
- **REFINING / IMPLEMENTING / DESIGNING** -- You are iterating on a solution or actively building. Default mode: VibeUltraX, auto-escalate on complexity.
- **RESEARCH / REVIEWING** -- You are investigating, comparing, or checking work. Routing and enforcement tighten as evidence requirements increase.
- **CONVERGING / CLOSED** -- You are finalizing. Full quality mode, brain tier, strict enforcement and flow checks.
- **LOOPING** -- You are stuck or the session needs intervention. Speed mode and escalating intervention levels activate to break cycles.
- **FORENSIC / AUDIT** -- You are doing deep investigation or security-style review. Brain tier, strict enforcement, detailed verification.

For VibeMaX, feature extraction currently yields 11 numeric features per turn: length, word count, sentence count, average word length, question ratio, code blocks, urgency, repetition, sentiment, complexity, and instruction density. Four escalating intervention levels prevent infinite loops. PIVOT/SWITCH detection recognizes context changes and injects scope-confirmation directives.

When the VibeBoX is disabled, a lightweight classifyTurnSimple fallback distinguishes Q&A from implementation intent using regex patterns.

### Stress-Aware Routing

A real-time stress scoring pipeline analyzes user messages for frustration signals. When stress exceeds 1.5 (on a 0-3 scale), any regime is escalated to quality mode. The stress gauge renders in the footer as a subtle indicator. Inoculation directives are injected into system prompts to adjust the assistant's tone -- slower, more structured, more thorough.

### Pattern Learner

Per-project friction and routine tracking. The learner watches repeated tool failures, recovery loops, and stable workflows, then stores the result locally first. Cross-project hints are merged later into `VIBEOS_HOME/global-learning.json` so the client can stay small while still learning.

### Context Compression

Three small layers keep context under control without pretending to be a full memory system:

1. **Web fetch stripping** (`compressText`) -- Applied immediately after webfetch tool execution. It strips verbose status lines, file-operation prefixes, and bullet markers, then collapses blank lines. If the result still exceeds 2000 characters, it keeps the most useful lines and truncates the rest.

2. **Cold-storage context compression** (`compressToolOutputs`) -- Runs on every LLM turn via the messages transform hook. Tool outputs older than the last 10 messages are written to content-addressed cold storage and replaced with a short summary reference. Hot messages stay expanded so the model can still use recent context.

3. **Project memory directives** (`projectMemoryDirective`) -- Shrinks per-project state into a single-line directive for the system prompt while keeping the full JSON for audit.

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

Cache state persists across sessions in `VIBEOS_HOME/global-learning.json` with a 7-day TTL eviction. The prediction results feed into the delegation enforcer's cost calculations and appear in the live footer savings display.

### Pivot and Counter-Pivot

Two complementary mechanisms manage context transitions:

**Forward pivot** -- Detects when you abruptly change topic mid-session. Uses a composite score of word-overlap distance, instruction-density delta, message-length ratio, and action-type change. Fires when `pivotScore > 0.45`. When detected:
1. Snapshots the current workflow (intent, files, decisions, blockers, code) to `$VIBEOS_HOME/.vibeos-pivot-cache.json`
2. Downgrades mode to budget (cheap tier, thinking off, relaxed enforcement)
3. Injects a context-shift directive into the system prompt

**Counter-pivot** -- Detects when you return to a previously abandoned workflow. Compares current query tokens against all cached workflow snapshots using Jaccard similarity with exact-match and recency bonuses. Fires when confidence >= 0.5. When detected:
1. Restores files, decisions, blockers, and code snippets from the cached workflow
2. Injects a `[PIVOT BACK]` context-restoration string into the system prompt
3. Warms the smart cache with tool outputs from the cached workflow
4. Increments `access_count` on the cached entry (learning which workflows get revisited)

The pivot system integrates with the loop intervention escalation: assertive loop-breaking uses "PIVOT: list 3 alternative approaches", and escalated intervention uses "STOP entirely. Reset strategy, SWITCH topics."

## The Numbers

Savings are shown honestly. The footer displays **verified** savings first (real model-cost deltas from completed task delegations), and labels anything estimated as `~$X saved est` — never a bare, unverifiable figure. When there is nothing verifiable, the segment is omitted.

### Savings per Delegation

| Move | Per Turn (est) | 10x | 100x | 1,000x |
|------|----------|-----|------|--------|
| Opus -> Haiku | $0.0308 | $0.31 | $3.08 | $30.80 |
| Opus -> Sonnet | $0.0264 | $0.26 | $2.64 | $26.40 |
| Sonnet -> Haiku | $0.0044 | $0.04 | $0.44 | $4.40 |

Delegation is **non-blocking** in v2: direct writes on the strong tier are never prevented — the plugin only suggests a cheaper route. Verified savings are tracked in `$VIBEOS_HOME/delegation-state.json`; cache savings are tracked separately under `cache_savings_usd`.

The stress gauge in the footer is also derived from **real signals** — tool failure rate, loop/guard-breach events, and quality-gate failures this session — not a text heuristic.

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
| VibeUltraX | 107% | 0.58x | 42% | vibe primary + tier subagents |
| VibeQMaX | ~100% | 0.50x | 50% | same model, framework optimizations |
| VibeMaX | ~75% | 0.18x | 82% | trained cascade (conservative escalate) |
| VibeLiteX | ~40% | 0.00x | 100% | direct cheap routing |
| Budget | ~40% | 0.00x | 100% | direct routing |

**VibeUltraX** -- Default mode. The unified `vibe` primary starts on cheap, medium and brain run as subagents, and same-provider escalations stay in-thread. 107% quality at 58% cost.

**VibeQMaX** -- Routes strategic turns through v4 Pro with full thinking, strict enforcement, strict flow checks, and quality TDD. Write/edit delegated per enforcement rules. Blended cost ~$0.00029/turn (50% of brain baseline).

**VibeMaX** -- ML-optimized medium mode. Routes through v4 Flash with a random forest classifier (29 trees, gini-split, trained on telemetry) that decides each turn. ~75% quality at 18% cost.

**VibeLiteX** -- Cheap direct routing with relaxed enforcement. Ideal for exploration and Q&A.

**Budget** -- DeepSeek Chat. Direct routing. ~40% quality at zero cost.

### Mode Configuration

| Mode | Model | Thinking | Enforcement | Flow | TDD |
|------|-------|----------|-------------|------|-----|
| VibeQMaX | v4 Pro | full | strict | strict | quality |
| VibeUltraX | vibe primary + tier subagents | auto | auto | auto | auto |
| VibeMaX | v4 Flash (auto-escalate) | auto | auto | auto | auto |
| VibeLiteX | cheap | off | relaxed | audit | lazy |
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
| Web dashboard | Session-first SolidJS SPA with executive Home summary, session actions, per-session templates, polling refresh for model split, savings, session history, controls |
| Trinity runtime | Update tier slots and keep the unified vibe primary plus tier subagents synced through the native OpenCode config path, change optimization mode, toggle subsystems live |
| Flow enforcer | Pattern-rule checks on write/edit. Extracts TODO/FIXME into append-only queue. |
| TDD enforcer | Auto-creates test skeletons for changed source. Strict mode fails TODO tests. |
| Pattern learner | Tracks recurring struggle/routine patterns per project, cross-project too |
| VibeBoX | 13 sub-regimes, 11 features per turn, loop intervention, PIVOT/SWITCH detection |
| Stress-aware routing | Real-time stress scoring, auto-escalation, system prompt inoculation |
| Cache savings | Separate cache_savings_usd tracking for scratchpad cache hits |
| Report tools | report-save, report-list, report-read, research-audit |
| MCP server | Extended tool capabilities + dashboard serving + HTTP dashboard endpoints |
| Remote API | Fastify server at api.vibetheog.com with token auth and seat management |
| Session lock | `vibe lock on\|off` -- freezes model at session start |
| Model locking | Per-session lock that skips auto-reconcile with OpenCode config changes |
| Blackbox decision engine | Dialogue trajectory tracking, loop prevention, outcome calibration |
| WBP protocol | Worker-to-Brain Protocol synthesizes delegated task output in assistant chat |
| Pattern learner runtime | vibe patterns, vibe patterns clear, vibe patterns suggest |
| Reward engine | Quality credits, saving bonus, lie/laziness penalties -- gamified quality assurance |
| Lie detector | Detects fabricated claims, invented function names, hallucinated APIs |
| Laziness detector | Flags short outputs, TODO placeholders, skipped delegation on brain tier |
| Claim verification | Scans assistant output for made-up references, validates against codebase |
| Token compression | Web fetch output stripped to 30% of original size -- verbose lines, bullet prefixes, and blank lines collapsed. Tool output history compressed to cold-storage references after the hot window (last 10 messages). Project memory condensed to single-line directives for system prompts. |
| Rotation memory | Scratchpad files age through a four-stage lifecycle: fresh (< 5 min, full content), warm (5 min - 24 hr, 500-char summary), cold (24 - 48 hr, 200-char summary), expired (> 48 hr, deleted). Rotation runs opportunistically on every tool execution, throttled to once per minute. Cache hits degrade gracefully over time instead of failing abruptly. |
| Smart cache | Predicts whether a tool query will hit scratchpad cache using composite similarity scoring (Jaccard + cosine bigram + weighted keyword overlap). Per-tool hit rates tracked with exponential decay. Estimated savings calculated and displayed in the live footer. Cache entries persisted across sessions via `VIBEOS_HOME/global-learning.json` with 7-day TTL eviction. |
| Pivot / counter-pivot | Detects when you switch topics mid-session (forward pivot) and when you return to a previously abandoned workflow (counter-pivot). Forward pivots snapshot the old workflow context and downgrade to budget mode. Counter-pivots restore files, decisions, blockers, and code snippets from cached workflow snapshots into the system prompt. |
| Deferred reports | saveReport deferred to setTimeout to avoid blocking tool output |
| Stress gauge footer | Live indicator in footer -- ▁▂▃▅▆█ (none/minimal/calm/elevated/high/critical) |
| Cascade escalation API | classifyTurn + escalateTurn endpoints wired through the cascade pipeline with real-time tier resolution |
| Backend-authoritative slot sync | Active API health probe syncs slot state from backend authority without passive fallback |
| SPEC §14 coverage | Certified test coverage for cascade tier-routing, deescalation, mode-router, and API shape compliance |

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

### Scoped to the vibe agent

vibeOS runs **only while `vibe` is the agent selected in OpenCode's mode dropdown** (and inside its own `vibe-cheap` / `vibe-medium` / `vibe-brain` tier subagents). Pick `build` or `plan` and every automatic behavior switches off for that session — no footer, no system-prompt directives, no delegation enforcement, no per-turn model override — until you switch back. The selection is read from the agent OpenCode reports on each turn, so it takes effect on the next turn after you change the dropdown, with no restart.

The `vibe` tool stays callable from any agent so `vibe status` and `vibe uninstall` always work. Set `VIBEOS_AGENT_GATE=off` to disable the gate and run vibeOS under every agent (pre-gate behavior).

## Uninstall

vibeOS ships a clean, complete uninstaller — no leftovers, ready to reinstall:

```bash
npx vibeostheog uninstall        # or: node bin/setup.js uninstall
```

It removes everything vibeOS created:

It sweeps every OpenCode home an install could have targeted — `~/.opencode`, the XDG dir (`~/.config/opencode`), the desktop app support dir, the current project's `.opencode`, and any `VIBEOS_OPENCODE_HOME` override — and removes:

- Plugin files (`plugins/vibeOS.js`, assets, `.env.production`, retention job, the deployed uninstaller) and the `/vibe` skill
- The `vibe` / `vibe-cheap` / `vibe-medium` / `vibe-brain` agents and `default_agent` from every `opencode.json` **and** `opencode.jsonc` — plus the legacy `mode` block entries and any vibeOS-authored `agent/vibe*.md` file, so the `vibe` entry disappears from the mode dropdown whichever source your OpenCode build reads it from (hand-written `agent/vibe*.md` files are left alone)
- Home-root runtime artifacts: `opencode-retention.log`, `learned-patterns.json`, `recent-events.jsonl`
- vibeOS auto-generated project skills (`.opencode/skills/<project>/SKILL.md`) — hand-written skills are left alone
- All runtime state dirs: `$VIBEOS_HOME`, `~/.vibetheog`, `~/.vibeos`, `~/Library/Application Support/ai.opencode.desktop/vibeOS`, and `~/.vibelm-debug-*` artifacts
- The legacy home-root deployment (`~/opencode.json`, `~/plugins`, `config.json.vibeos-bak-*`)
- The `com.vibeos.opencode-event-retention` launch agent and the nightly pricing cron
- The global `vibeostheog` npm link

It deliberately leaves `~/.claude`, OpenCode's own config, and `~/.opencode/bin/opencode` (the OpenCode binary itself) untouched so OpenCode keeps working.

An uninstall marker is written to `~/.opencode/vibeOS-uninstalled` and `~/.config/opencode/vibeOS-uninstalled`. An OpenCode process that loaded vibeOS before the removal still holds the bundle in memory; the marker makes that instance **inert** in both directions — a fresh load registers zero hooks, and hooks that were *already* registered (the in-session `vibe uninstall` case) check the marker on every call and no-op, so no footer, directive, state file or config write survives the uninstall. The `vibe` tool itself replies "uninstalled — this command is inert" for every action except `setup`. Restart OpenCode to unload it fully. Reinstall (`npx vibeostheog setup`) clears the marker.

You can also run it from inside a session with `vibe uninstall` — the uninstaller is deployed next to the plugin bundle, so it runs for real rather than printing instructions.

Set `VIBEOS_UNINSTALL_SKIP_SYSTEM=1` to skip the machine-global side effects (crontab, `launchctl bootout`, `npm unlink -g`); those ignore a redirected `HOME`, so tests and sandboxed runs must set it.

## Quality Gate

vibeOS v2 is a **deterministic quality gate**, not a blocker. The model may act freely — but a completion is only considered backed by evidence when its claims match what actually happened in the session:

- "tests pass / build green" requires a **real verification run with exit code 0** observed in the session.
- Code changes require a **test step** (a test file touched or a test run) before claiming done — this fires even for a bare "Done." after editing source.
- Non-code changes require an **extra verification iteration** after the last change.

The gate is **deterministic** (pure rules, no ML). It is silent when claims hold up; when evidence is missing it appends **one concise, deduped report** listing the exact missing evidence, and records the verdict to `$VIBEOS_HOME/quality-gate/<session>.jsonl` (inspect with `vibe gate`). It never blocks reads, writes, or edits.

**Correction loop** — if the gate flags a completion, the next turn (after the model adds the missing evidence) flips the verdict to a silent PASS; the note is never duplicated.

**Scoping guarantees** (verified by E2E):
- Test-file detection is strict (`*.test.*`, `*.spec.*`, `tests/` dirs, `test_*` basenames) — a file like `contest.ts` is a source file, not a test.
- Self-modification protection fires **only inside the vibeOS plugin repo**. Writing `tests/`, `scripts/`, `src/`, or `package.json` in any other project is allowed.

**Offline/degraded** — if the API is unreachable the gate still records verdicts locally and never crashes; it simply skips posting outcomes/telemetry.

Delegation enforcement is **non-blocking** in v2: direct writes on the strong tier are allowed and only suggested as a cheaper alternative — the gate, not write-blocking, is what enforces flow.

## E2E Release Test

Headless, user-perspective release testing is built in: `scripts/e2e/` drives **real** `opencode run` sessions against the built bundle with a real model + a local mock backend, then prints a pass/fail table and a `RELEASE: GO|NO` verdict. See `scripts/e2e/README.md` for the scenario list, options, and artifacts.

```bash
npm run build:bundle
npm run test:e2e -- --seed round2 --k 2 --model deepseek/deepseek-chat   # full suite
npm run test:e2e -- --list                                              # list scenarios
npm run test:e2e -- --only correction-loop --model deepseek/deepseek-chat
```

Coverage: the correction loop (FAIL → fix → PASS, ≤1 note, real-signal stress gauge), the `vibe gate` surface, protected-path behavior in both external projects and the plugin repo, offline degradation, wired `blackbox/outcome` + telemetry, TDD skeleton auto-creation, strict test-file detection, and gate silence across cheap/medium/brain tiers. Without `--model` the harness skips cleanly (exit 0) so CI can include it without API keys.

## Commands

`vibe help` for full reference. Commands register in the TUI sidebar.
`/vibe` is the fast slash-command entrypoint for the same command surface.

| Command | Effect |
|---------|--------|
| `/vibe` | OpenCode slash-command entrypoint for status, dashboard, sessions, templates, and diagnostics |
| `vibe status` | Tier, enforcement, savings, stress, lock state |
| `vibe dashboard` / `vibe gui` | Live dashboard URL and browser entrypoint |
| `vibe set brain\|medium\|cheap [model=<model_id>]` | Switch active model tier or override slot |
| `vibe brain\|medium\|cheap` | Shorthand tier switch |
| `vibe enable|disable` | Toggle plugin on/off |
| `vibe mode budget\|quality\|speed\|longrun\|auto\|balanced\|audit\|forensic\|vibeultrax\|vibeqmax\|vibemax\|vibelitex` | Set optimization mode (generic or branded) |
| `vibe thinking full\|brief\|off` | Reasoning depth |
| `vibe enforce on|off` | Toggle delegation enforcement |
| `vibe lock on|off` | Freeze model for session |
| `vibe flow on|off` | Toggle flow enforcer |
| `vibe flow enforce on|off` | Toggle auto-extract TODOs |
| `vibe tdd on|off` | Toggle TDD skeleton generation |
| `vibe tdd strict on|off` | Toggle strict failing TODO test templates |
| `vibe tdd quality on|off` | Toggle quality assertion stubs |
| `vibe rebuild` | Re-detect models from all providers |
| `vibe project` | Per-project analytics |
| `vibe patterns` / `vibe patterns clear` / `vibe patterns suggest` | Pattern inspection |
| `vibe axis [status\|reset\|<name> <value>]` | Axis overrides for enforcement, flow, tdd, tier, thinking, context7_urgency, wbp_verbosity, websearch |
| `vibe todo` / `vibe todo-done <id>` / `vibe todo-sync` | View pending todos, mark done, sync flow todos |
| `vibe verify-claims` | Audit recent claim output against cascade evidence |
| `vibe diagnose` | Health check |
| `vibe diagnose cascade` | Deep cascade check: slot config, subagent drift, cheap-first cross-provider degradation |
| `vibe blackbox on|off|status|reset` | Decision engine control |
| `vibe repair-state preview|apply` | Fix state collisions |
| `vibe guard` | Refresh AGENTS.md / README.md |
| `vibe reality-check` | Read verified live state, report evidence-backed facts only |
| `vibe setup` | Create a compatibility profile for first-time users; fresh installs start in VibeUltraX |
| `vibe api-token <token|invalidate>` | Manage remote API token |
| `vibe api-bootstrap-token <token>` | Bootstrap token exchange |
| `vibe report savings` | Deep savings breakdown from the append-only ledger |
| `vibe uninstall` | Run the clean uninstaller (plugin, agents, skill, state, launch agent, cron, npm link) |
| `vibe gate` | Show deterministic quality-gate verdicts for this session |

**Report commands**: report-save, report-list, report-read, research-audit

## Under the Hood

### Architecture

vibeOS hooks into OpenCode Desktop through 10 extension points:

| Hook | Purpose |
|------|---------|
| experimental.text.complete | Appends footer to assistant responses |
| experimental.chat.messages.transform | Injects delegation protocol content |
| experimental.chat.system.transform | Injects cost optimization, stress inoculation, enforcement directives |
| experimental.chat.params | Modifies chat parameters before requests |
| experimental.chat.headers | Injects custom HTTP headers into chat requests |
| tool.execute.before | Blocks write/edit on brain tier |
| tool.execute.after | Injects delegation UI notes |
| message.updated | Fallback footer for versions without text.complete |
| experimental.session.compacting | Preserves savings state |
| shell.env | Injects OPENCODE_MODEL_TIER and OPENCODE_MODEL |

### State Files (`VIBEOS_HOME/`)

The plugin persists state to `VIBEOS_HOME/` for cross-session continuity:

- **delegation-state.json** -- Sessions, warns, cache hits, lifetime totals
- **model-tiers.json** -- Brain/medium/cheap model IDs
- **project-states.json** -- Per-project memory, analytics, report references
- **blackbox-state.json** -- Per-project resolution tracker, session outcomes
- **savings-ledger.jsonl** -- Append-only savings event log
- **global-learning.json** -- Cross-project pattern learning
- **active-jobs.json** -- In-flight delegation records

### Local vs Remote

Core features work fully offline: model tier classification, static pricing, stress scoring, context budget, VibeBoX fallback, TDD skeletons, flow enforcement, savings ledger, session metrics, reports, footer, dashboard.

Remote API (api.vibetheog.com) enables: bootstrap token exchange, advanced VibeBoX with full session history, dynamic per-prompt delegation, learned subagent routing. Falls back gracefully when unreachable.

### Live Footer

The footer is the primary status line, appended to every assistant response. It surfaces model assignment, savings, mode, alerts, and session metrics in a single line.

```text
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

#### Alert Tags

The alert is part of the one footer (it is **not** a separate line). When present it renders
after the enforcement tags and before the stress gauge. Multiple alerts join with ` · `.
This table is the single source of truth — `buildFooterAlert()` must match it exactly.

| Alert | Trigger |
|-------|---------|
| ⚠ api degraded | API latency is degraded / the backend is unhealthy this turn |
| ⚠ switch pending | A tier switch is deferred and will apply at the next turn boundary |
| ⚠ model drift | The live model is outside the cascade tiers and differs from the expected slot model |
| ⚠ model unreachable | The last model call failed with a network error (EHOSTUNREACH / ENOTFOUND / ETIMEDOUT) |

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
| Alert tags | ⚠ alert · ⚠ alert | ⚠ model drift | Live status alerts (see Alert Tags) |
| Stress gauge | gaugeChar | _ | Current stress level |
| Vector pulse | slot | cheap | Active slot changed this turn |

Controls: `vibe status` for full state, `vibe enable/disable` to toggle. Persisted in $VIBEOS_HOME/delegation-state.json.

### Environment Variables

| Variable | Default | Effect |
|----------|---------|--------|
| VIBEOS_HOME | ~/.vibeos | Runtime state directory |
| VIBEOS_API_URL | https://api.vibetheog.com | Remote API base URL |
| VIBEOS_API_TOKEN | unset | Remote API auth |
| VIBEOS_API_BOOTSTRAP_TOKEN | unset | Bootstrap exchange |
| VIBEOS_AGENT_GATE | unset | `off` runs vibeOS under every agent instead of only the `vibe` dropdown selection |
| VIBEOS_MCP_PORT | 3001 | MCP server port |
| VIBEOS_BUILD_CHANNEL | alpha | Build channel for API client |
| VIBEOS_DEBUG | unset | Verbose debug logging |
| VIBEOS_DEBUG_INTERNALS | unset | Internal state debug logging |
| VIBEOS_DEBUG_DELEGATION | unset | Delegation enforcer debug logging |
| VIBEOS_DEBUG_FOOTER | unset | Footer builder debug logging |
| VIBEOS_DEBUG_LOGS | unset | Flow enforcer debug logging |
| VIBEOS_DEBUG_STDERR | unset | Flow enforcer stderr debug logging |
| VIBEOS_FLOW_RULES_PATH | unset | Custom flow rules file path |
| VIBEOS_DASHBOARD_SYNC_MS | 20000 | Dashboard polling interval (ms) |
| VIBEOS_ACTIVE_PROBE_MS | 10000 | Backend health probe interval (ms) |
| VIBEOS_REMOTE_LATENCY_DEGRADE_MS | 800 | Latency threshold for degraded alert (ms) |
| VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS | 120000 | Cooldown between degraded alerts (ms) |
| VIBEOS_VIBEMAX_MODEL_PATH | unset | Custom VibeMaX model path |
| VIBEOS_OPENCODE_DESKTOP_HOME | unset | OpenCode Desktop home override |
| VIBEOS_OPENCODE_HOME | unset | OpenCode config home override |
| VIBEOS_API_MASTER_KEY | unset | API master key for backend auth |
| VIBEOS_BACKEND_HEALTH_URL | unset | Custom backend health check URL |
| CLAUDE_CREDIT_PERCENT | 50 | Credit override percentage |

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| Plugin not loading | Check opencode.json entry. Restart Desktop. |
| No footer / nothing happens | The mode dropdown is on `build` or `plan` — vibeOS only runs under the `vibe` agent. Switch back, or set VIBEOS_AGENT_GATE=off. |
| Model won't switch | vibe rebuild then vibe set brain/medium/cheap |
| Writes/edits blocked | Enforcement active -- delegate to cheap tier |
| No footer visible | Verify plugin enabled, completions running |
| Dashboard blank | npm run build then restart |
| State looks wrong | vibe diagnose then vibe repair-state preview |

---

*vibe help is the canonical command reference. This README stays high-level so command details follow the code without a rewrite.*
