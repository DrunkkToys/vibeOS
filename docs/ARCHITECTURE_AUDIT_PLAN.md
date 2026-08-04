# Architectural Audit — Plan

> Status: plan. This doc defines the follow-up audit's scope, method, and
> deliverables. Each phase ships as its own PR (CI + E2E green) so findings
> are reviewable and independently mergeable.

## Goal

The integration audit (`docs/INTEGRATION_AUDIT.md`) answered *"do the subsystems
fight each other when mixed?"* and fixed the verified interference bugs. This
audit answers the bigger question: **is the system well-architected, and can it
become a plugin you install on purpose rather than a monolith you tolerate?**

## Preliminary facts (first pass, this branch)

| Metric | Value |
|---|---|
| Largest files | `state.ts` 2823, `trinity-tool.ts` 2104, `chat-transform.ts` 1966, `tool-execute.ts` 1716, `index.ts` 1686, `cascade.ts` 1627, `footer.ts` 1542, `pricing.ts` 1307 |
| `@ts-nocheck` files | 42 |
| Bare `catch {}` (silent swallows) | ~167 across the core files (`state.ts` 44, `trinity-tool.ts` 24, `chat-transform.ts` 23, `footer.ts` 17, `index.ts` 16, `pricing.ts` 15, `flow-enforcer.ts` 13, `cascade.ts` 12) |
| Layer cycles | `vibeOS-lib/flow-enforcer` → `lib/state` while `lib/state` → `vibeOS-lib/smart-cache` and `lib/trinity-tool` → `vibeOS-lib/flow-enforcer`: the "lower" layer imports the "upper" layer → real bidirectional coupling |
| Persistent state files | ~30, no schema/versioning, several split sources of truth (`active_slot` in `model-tiers.json` + `blackbox-state.json`; lifetime savings in `delegation-state.json` + ledger) |
| Bundle | single 1MB+ plugin doing ~24 subsystems |

These are the audit's input hypotheses, to be verified with evidence, not assumed.

## Phases (each = one deliverable + one PR)

### Phase A — Layering & coupling
- **Question**: what is the intended boundary between `lib/` and `vibeOS-lib/`? Where are the cycles?
- **Method**: import-scan dependency graph with cycle detection; identify god-modules (`state.ts`, `chat-transform.ts`); propose a boundary contract (who may import whom) and extraction candidates.
- **Deliverable**: dependency report + a proposed layer contract.

### Phase B — Reliability & error handling
- **Question**: how many failures are silently swallowed, and which ones lose data vs. just skip a nicety?
- **Method**: inventory every `catch {}` and `@ts-nocheck`; classify by impact (benign vs data-loss vs corrupt-state); define a logging/observability policy (structured log under `VIBEOS_DEBUG_INTERNALS`, error counters surfaced in `vibe diagnose`).
- **Deliverable**: swallow-site inventory + error-handling policy + fix list for data-loss sites.

### Phase C — Performance
- **Question**: how much latency/token does the plugin add per turn?
- **Method**: instrument hook latency (`system.transform`, `messages.transform`, `text.complete`, `tool.execute.before/after`); measure sync fs in the hot path (footer reads ~6 state files per paint); measure prompt-bloat (directive bytes per turn) and token cost.
- **Deliverable**: per-hook timing budget, hot-path rework list, prompt-slimming targets.

### Phase D — Security & trust
- **Question**: credential handling, network exposure, and prompt-injection surface.
- **Method**: audit `.env.production` handling (mostly hardened by prior work); review every `remoteCall` endpoint and the data sent; review directives that echo user-controlled text into the system prompt (job-focus, project memory, corrections); document the trust boundary.
- **Deliverable**: trust-boundary doc + fixes for any credential/leak risk.

### Phase E — Data model & state
- **Question**: 30 files, no schema/migration, split sources of truth.
- **Method**: build the state inventory with owner + staleness (start from `INTEGRATION_AUDIT.md` §2); find single-source-of-truth violations; propose a versioned schema + migration path.
- **Deliverable**: state ownership map + schema/migration proposal.

### Phase F — Monolith decomposition options
- **Question**: can the plugin become a lean core + opt-in modules so users install only the value they benchmarked?
- **Method**: cluster the Phase A dependency map into cohesive modules; evaluate opencode multi-plugin/entry-point support; define the target "core + modules" architecture with a compatibility + rollback plan.
- **Deliverable**: decomposition options with cost/benefit, and the recommended target architecture.

## Prioritization (proposed)

1. **B — silent failures** (correctness risk, cheap to start)
2. **A — cycles/layering** (unblocks D, E, F)
3. **C — performance** (user-visible latency)
4. **D — security** (trust boundary)
5. **E — state schema** (foundation for F)
6. **F — decomposition** (the endgame: install what you benchmarked)

Phases B and A can run in parallel; C and D are independent; E feeds F.

## Definition of done

- Each phase: findings with `file:line` evidence, severity, and a concrete fix/decision.
- Each phase merges with CI `test (20)` green + relevant E2E scenarios re-run.
- Final `docs/ARCHITECTURE_AUDIT.md` consolidates all phases into a prioritized
  remediation roadmap.
