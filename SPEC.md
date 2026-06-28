# SPEC: vibeOS Test-Verified Specification

> **LAW.** Every claim below is verified by the test suite (the contract is
> **0 fail** across `npm test`; the exact pass count drifts as tests are added)
> or by live session testing. Any code change that breaks these behaviors
> violates the specification contract.

---

## A. RUNTIME HOOKS — 8 EXTENSION POINTS

| Hook | Purpose | Verified By |
|------|---------|-------------|
| `experimental.text.complete` | Appends live footer | e2e lifecycle, deep integration |
| `experimental.chat.messages.transform` | Injects WBP protocol | e2e lifecycle |
| `experimental.chat.system.transform` | Injects context7, stress, flow/TDD directives | e2e lifecycle, system transform |
| `tool.execute.before` | Delegation enforcement | e2e lifecycle, 141 enforcement assertions |
| `tool.execute.after` | Delegation UI notes | e2e lifecycle |
| `message.updated` | Fallback footer append | e2e lifecycle |
| `experimental.session.compacting` | Preserves savings state | session compact |
| `shell.env` | OPENCODE_MODEL_TIER / OPENCODE_MODEL | shell.env tests |

---

## B. QUALITY-AWARE DELEGATION ENFORCEMENT

**Source:** `src/lib/hooks/tool-execute.ts`, `src/lib/api-client.ts`

1. Write/Edit/NotebookEdit blocked on brain tier
2. User-visible enforcement notes with reason
3. Cost estimation per delegation
4. Warning coalescing (cap 3 per session)
5. Cooldown tracking per tool in `~/.claude/.enforcement-cooldown.jsonl`
6. Task subagent routing to cheap tier
7. Credit nudges on block

**Tests:** 141 assertions (test_delegation_enforcer) + 815 deep integration

---

## C. CACHE TRACKING

**Source:** `src/vibeOS-lib/smart-cache.ts`, `src/lib/hooks/tool-execute.ts`

1. Separate cache_savings_usd from delegation savings
2. recordCacheSaving() on scratchpad hit
3. lifetime.cache_savings_usd in delegation-state.json
4. lifetime.missed_context7_usd tracked separately
5. Smart cache: Jaccard (0.3), cosine bigram (0.3), keyword overlap (0.4)
6. Per-tool hit rates with exponential decay (0.9)
7. Cross-session 7-day TTL in global-learning.json

---

## D. LIVE FOOTER

**Source:** `src/lib/hooks/shared-footer.ts`

Segments: tier icon + slot | provider + model | regime | savings | flash | mode | cascade | tags | alerts | stress | vector pulse

1. Model split: tier icon, slot, provider, model name
2. Cumulative savings with trend arrow
3. Stress gauge (none/minimal/calm/elevated/high/critical)
4. Mode label (VibeUltraX, VibeQMaX, VibeMaX, Budget, Speed, Longrun, Auto)
5. Regime icon (INIT/DIVERGENT/EXPLORING/REFINING/CONVERGING/CLOSED/LOOPING)
6. Enforcement tags (guarded, flow steady, flow strict, tests live, quiet, locked)
7. Alert tags (api degraded, switch pending, model drift, model unreachable)
8. Vector pulse when slot changed this turn
9. Cascade depth icon
10. Flash connected indicator

---

## E. TRINITY RUNTIME CONTROLS

**Source:** `src/lib/trinity-tool.ts`

Every command functional: status, set, enable/disable, mode, thinking,
enforce, lock, flow, flow enforce, tdd, tdd strict, tdd quality, rebuild,
project, patterns, patterns clear, dashboard/gui, diagnose, help,
api-token, blackbox, repair-state, guard, reality-check, setup,
report savings, todo/todo-done/todo-sync, verify-claims,
api-bootstrap-token, shorthand brain/medium/cheap

**Tests:** 815 deep integration + live session verified

---

## F. FLOW ENFORCER

**Source:** `src/vibeOS-lib/flow-enforcer.ts`, `src/flow-enforcer.ts`

1. Pattern rule checks on write/edit
2. LGTM detection in strict mode
3. Debug artifact detection (console.log, debugger, TODO)
4. TODO/FIXME extraction queue (append-only .flow-todo-queue.jsonl)
5. Dedup keys (.flow-dedup-keys.json)
6. Flow rules config
7. Audit mode (check without enforce)

---

## G. TDD ENFORCER

**Source:** `src/tdd-enforcer.ts`

1. Auto skeleton tests for changed source files
2. Strict mode ON by default — TODO tests fail loudly
3. Quality mode toggle
4. Multi-language skeleton gen
5. Nudge only when disabled

---

## H. REPORT / RESEARCH-AUDIT

**Source:** `src/lib/hooks/tool-execute.ts`

1. report-save to `~/.claude/reports/`
2. report-list by type/project/hours
3. report-read by ID
4. research-audit for anti-patterns
5. Deferred saves via setTimeout

**Live verified:** 200 reports listed, report saved, audit executed

---

## I. STRESS MITIGATION PIPELINE

**Source:** `src/vibeOS-lib/session-metrics.ts`

1. scoreStress() — user stress detection
2. Live footer gauge
3. System prompt inoculation directives
4. Stress > 1.5 upgrades to MEDIUM tier
5. Stress > 1.5 escalates regime to quality mode

---

## J. CONTEXT7 DIRECTIVE INJECTION

**Source:** `src/lib/hooks/chat-system-transform.ts`

1. Injects context7 instructions into system prompts
2. Detects context7 presence
3. Multiple directive variants
4. Bypass detection/qualification

---

## K. WBP PROTOCOL

**Source:** `src/lib/hooks/chat-messages-transform.ts`

1. Synthesizes delegated task output in assistant chat
2. Injected via messages.transform
3. Preserves delegation provenance

---

## L. JSONC-TOLERANT CONFIG PARSING

**Source:** `src/lib/hooks/tool-execute.ts` (_safeJsonParse)

1. Trailing commas
2. Comments (// and /* */)
3. Unquoted keys
4. Graceful fallback to JSON.parse
5. Used for all state file reads

---

## M. FILE-BASED LOCKING

**Source:** `src/lib/hooks/tool-execute.ts`

1. Concurrent instance prevention via `~/.claude/.vibeOS-locks/`
2. Lock files by session ID
3. Auto-cleanup
4. Stale lock detection

---

## N. WARNING CAPS AND COALESCING

**Source:** `src/lib/hooks/tool-execute.ts`

1. Merged warnings per tool per session
2. Max 3 visible warnings per session
3. Per-tool cooldown
4. Lifetime totals in delegation-state.json

---

## O. PATTERN LEARNER

**Source:** `src/vibeOS-lib/global-learning.ts`

1. Per-project friction/routine tracking
2. Cross-project hints in global-learning.json
3. 77 stored, 16 promoted (live verified)
4. vibe patterns / patterns clear
5. Friction: corrected imports, naming, repeated tool calls

---

## P. MCP SERVER + DASHBOARD

**Source:** `src/vibeOS-lib/vibeos-mcp-server.ts`

1. Extended MCP tools
2. Dashboard: executive Home, sessions, templates
3. HTTP: /dashboard/home, /sessions, /templates
4. URL: http://127.0.0.1:63452/ (live verified)
5. Watchdog, polling refresh

---

## Q. REMOTE API PROTECTION

**Source:** `src/lib/api-client.ts`

1. Core algorithms at api.vibetheog.com
2. Token-based auth
3. Seat/license management
4. Graceful fallback to local mode
5. isApiFallback() state tracking

**Live verified:** token set, backend=connected

---

## R. PER-SESSION MODEL LOCKING

**Source:** `src/lib/hooks/tool-execute.ts`

1. vibe lock on|off
2. In-memory only (resets on restart)
3. Skips auto-reconcile
4. LOCK tag in footer
5. Overrideable by vibe set / lock off

---

## S. BLACKBOX DECISION ENGINE

**Source:** `src/vibeOS-lib/blackbox/`

1. 7 sub-regimes: INIT, DIVERGENT, EXPLORING, REFINING, CONVERGING, CLOSED, LOOPING
2. 11 derived features per turn
3. 4 escalating loop interventions (gentle/suggestive/assertive/escalated)
4. PIVOT/SWITCH detection
5. Outcome tracking (positive/negative)
6. Cross-session state in blackbox-state.json + remote SQLite
7. Online calibration per project
8. Auto-mode: control vector writes to model-tiers.json each turn
9. Disabled fallback: classifyTurnSimple()
10. Commands: vibe blackbox on|off|status|reset
11. **API authoritative for regime/loop/pivot.** `trackBlackbox` awaits `POST /api/v1/blackbox/analyze` and persists its `sub_regime`/loop/pivot verdict as the source of truth each turn. The local `ResolutionTracker` is used only as fallback when the API is unreachable or exceeds the `BLACKBOX_API_DEADLINE_MS` (3000ms) cap. Persisted sessions carry `decision_source: "api" | "local"`.

**Source (authoritative wiring):** `trackBlackbox` in `src/lib/hooks/chat-transform.ts`; `fetchBlackboxEnrichment`, `mergeAuthoritativeBlackboxState`, `raceWithDeadline`, `BLACKBOX_API_DEADLINE_MS` in `src/lib/turn-classify.ts`.

**Test:** `tests/blackbox_api_authoritative.test.mjs` — contract units (merge precedence, 3000ms deadline cap, rejection fallback) plus real HTTP-server e2e proving the analyze verdict (LOOPING) is the persisted regime with `decision_source: "api"`, and that an API outage falls back to a local-sourced regime.

**Live verified:** LOOPING regime, momentum 0.13, 253 session history

---

## T. LIE DETECTION / LAZINESS / REWARD ENGINE

**Source:** `src/lib/hooks/tool-execute.ts`

1. Lie detector — fabricated claims, invented APIs
2. Laziness detector — short outputs, TODO placeholders
3. Reward engine — quality credits, bonuses, penalties
4. Claim verification against codebase
5. Single quality score from all signals

---

## U. CONTEXT COMPRESSION

**Source:** `src/lib/hooks/chat-messages-transform.ts`

1. compressText — web fetch stripping
2. compressToolOutputs — cold storage after 10 messages
3. projectMemoryDirective — single-line per-project state
4. Cold storage: ~/.claude/scratch/by-hash/<sha256>.txt
5. Hot window: last 10 messages

---

## V. ROTATION MEMORY (SCRATCHPAD DECADENCE)

**Source:** `src/vibeOS-lib/smart-cache.ts`

| Age | Action | Content |
|-----|--------|---------|
| <5min | Keep | Full |
| 5min-24hr | Warm | 500-char summary |
| 24-48hr | Cold | 200-char summary |
| >48hr | Delete | Nothing |

Throttled 1/min. Caps: 1000 files/10MB total, 200 files/2MB per session.

---

## W. SMART CACHE PREDICTION

**Source:** `src/vibeOS-lib/smart-cache.ts`

1. Jaccard similarity (0.3), cosine bigram (0.3), keyword overlap (0.4)
2. predictCacheHit() — confidence, savings, similar entries
3. Per-tool hit rates, exponential decay (0.9)
4. 7-day TTL eviction

---

## X. PIVOT / COUNTER-PIVOT

**Source:** `src/vibeOS-lib/blackbox/`

1. Forward pivot: topic change (score > 0.45)
2. Workflow snapshot to .vibeos-pivot-cache.json
3. Mode downgrade on pivot
4. Counter-pivot: return detection (confidence >= 0.5)
5. Workflow restoration, cache warming, access count

---

## Y. VIBEBOX FALLBACK

**Source:** `src/lib/hooks/tool-execute.ts`

When blackbox disabled:
1. classifyTurnSimple() — Q&A patterns -> EXPLORING (relaxed)
2. Implementation patterns -> REFINING (normal)
3. Phase-appropriate enforcement levels

---

## Z. CASCADE ROUTING

**Source:** `src/vibeOS-lib/ml-router.ts`, `src/lib/hooks/tool-execute.ts`

1. Single primary `vibe` agent plus cheap -> medium -> brain subagents
2. Confidence thresholds: 0.6 (base), 0.7 (cheap), 0.7 (escalation), 0.8 (brain depth-3)
3. HIGH/MID/BUDGET regex classification
4. API authoritative when connected
5. Local cascade wins when API unreachable (VibeLiteX fallback)
6. API-bypass gate at tool-execute.ts:395 (local cascade on !backendRoute.target)

### Model Switch Contract (no watched-file writes)

**Source:** `src/lib/pricing.ts` (`applySlot`, `flushPendingLiveSwitch`),
`src/lib/hooks/chat-params.ts`, `src/lib/hooks/tool-execute.ts`

OpenCode binds the primary model at session start and watches `opencode.json` AND
`config.json`; any mid-turn change to either disposes the active project instance and
aborts the in-flight turn (`disposing instance` -> `AbortError`). vibeOS therefore
NEVER rewrites a watched config file to switch models, and NEVER calls
`client.config.update` (OpenCode's `Config.update` handler persists
`<projectDir>/config.json`).

1. `applySlot()` persists the orchestrator decision (`active_slot`) to the UNWATCHED
   `model-tiers.json` only. It does not write `opencode.json` or `config.json`.
2. The per-turn model override is applied by the `chat.params` middleware
   (`onChatParams` sets `output.options.model` to `trinity[active_slot].oc` for
   SAME-provider tiers) — no file write, no abort.
3. Cross-provider tier work reaches a different model through `vibe-cheap` /
   `vibe-medium` / `vibe-brain` subagent delegation in `tool-execute` (the Task tool's
   `model` is rewritten to the tier target).
4. `flushPendingLiveSwitch()` is state-only: it clears the queued footer hint and
   performs no I/O and no SDK call.
5. The `vibe-cheap/medium/brain` agent topology is installed into `opencode.json` once
   at startup / `vibe rebuild` (out of any turn), not on every slot switch.
6. `vibe set` / `vibe mode` report "Takes effect next turn" — the slot decision is read
   by `chat.params` on the next outbound request within the same session.

### Live Cascade Test (2026-06-27)

| Metric | Result |
|--------|--------|
| API route status | Remote API returned .target -> enforce ON |
| Cascade fired? | Skipped when apiRoute.target truthy (line 395 gate) |
| Slot switch via cascade? | No — cascade fires only when API unavailable; same-provider changes stay in-thread and cross-provider work delegates to tier subagents |
| applySlot() fired? | No when API route present |
| CV persistence | No cv field in blackbox-state.json sessions |
| Root cause | apiRoute.target gates out local cascade at line 409 |

---

## AA. CLAIM VERIFICATION ENGINE

1. Scans assistant output for made-up references
2. Validates against codebase
3. Flags invented function names, hallucinated APIs
4. Integrates with reward engine for scoring

---

## BB. STATE FILES

| File | Purpose | Verified |
|------|---------|----------|
| delegation-state.json | Sessions, warns, cache, lifetime | live |
| model-tiers.json | Brain/medium/cheap IDs | live |
| project-states.json | Per-project memory | live |
| blackbox-state.json | Resolution tracker | live |
| savings-ledger.jsonl | Append-only event log | integration |
| global-learning.json | Cross-project patterns | integration |
| active-jobs.json | In-flight delegation | integration |

---

## CC. ENVIRONMENT VARIABLES

| Variable | Default | Effect |
|----------|---------|--------|
| VIBEOS_API_URL | https://api.vibetheog.com | API base |
| VIBEOS_API_TOKEN | unset | Auth |
| VIBEOS_API_DISABLED | false | Invalidate token |
| VIBEOS_API_BOOTSTRAP_TOKEN | unset | Bootstrap exchange |
| VIBEOS_API_ENABLED | true | Local-only toggle |
| CLAUDE_CREDIT_PERCENT | 100 | Credit override |
| VIBEOS_MCP_PORT | 3001 | MCP port |

---

## DD. BUILD CHAIN

1. npm run build = typecheck + esbuild bundle + deploy
2. TypeScript source -> .js compilation
3. Single-file bundle dist/vibeOS.js (~860KB)
4. Deploy to ~/.opencode/plugins/vibeOS.js
5. tsc -p tsconfig.json --noEmit must pass
6. npm test = typecheck + build + run the full suite

**Verified:** typecheck clean, build succeeds, and `npm test` passes on the current suite.

---

## EE. COMMAND SURFACE

Every README.md command must be implemented:

```
vibe status|dashboard|gui|set|enable|disable|mode|thinking|enforce|lock
vibe flow [enforce]|tdd [strict|quality]|rebuild|project|patterns|todo
vibe verify-claims|diagnose|blackbox|repair-state|guard|reality-check
vibe setup|api-token|api-bootstrap-token|report savings
report-save|report-list|report-read|research-audit
brain|medium|cheap (shorthand)
```

---

## FF. CONTRACT TESTS

The following test suites form the contract verification layer.
All must pass before any commit:

```
npm test                                    # Full suite (0 fail is the gate)
npm run typecheck                           # TypeScript validation (also the syntax gate; src has no committed .js)
node tests/deep_integration.test.mjs        # 815 assertions - core pipeline
node tests/test_delegation_enforcer.test.mjs # 141 assertions - enforcement
node tests/production_regressions.test.mjs  # 35 assertions - footer/mode
node tests/cascade_real_proof.test.mjs      # cascade coverage
node tests/test_install_and_recovery.test.mjs # 14 assertions - install
node tests/test_mega_all_fixes.test.mjs      # core runtime
```

**Test result:** current suite verified via `npm test`; exact counts drift as tests are added.

---

## GG. PROTECTED ALGORITHMS (Remote API only)

These run on api.vibetheog.com — do NOT reimplement locally:

| Algorithm | Endpoint |
|-----------|----------|
| Delegation enforcement | POST /api/v1/delegate/check |
| Model tier routing | POST /api/v1/route/model |
| Stress scoring | POST /api/v1/stress/score |
| Blackbox engine | POST /api/v1/blackbox/analyze |
| Blackbox calibration | POST /api/v1/blackbox/calibrate |
| TDD skeleton gen | POST /api/v1/tdd/skeleton |
| Pattern learner | POST /api/v1/patterns/observe |
| Model pricing | POST /api/v1/pricing/fetch |
| Context compression | POST /api/v1/compress/context |

---

> **This SPEC.md is a contract.**
> Any commit changing verified feature behavior must include updated test
> coverage and must not break existing tests. CI must catch violations
> before merge.
