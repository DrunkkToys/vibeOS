# vibeOS Integration Audit

> Status: fixes merged on `fix/integration-audit`. Read-only map + verified interference
> findings + minimal-composition spec for deciding whether/when the plugin should be
> reinstalled.

## Why this exists

The plugin's individual subsystems benchmark well in isolation, but the historical
complaint is that *mixed together* they misbehave. This audit maps every subsystem,
every shared resource it touches, and every concrete interference point — then fixes
the objectively verifiable ones and leaves the product-policy calls as an explicit,
flaggable list.

## 1. Subsystem inventory

24 mutation-producing subsystems, 10 hooks, ~30 persistent state files.

| # | Subsystem | Mutations |
|---|---|---|
| 1 | Thinking/directive injection | system-prompt directives |
| 2 | Cascade routing / tier enforcement | model override, selection writes |
| 3 | Quality gate | verdicts, gate notes, outcome posts |
| 4 | Blackbox / decision engine | control vectors, regime, stress |
| 5 | Footer / display state | output text, footer probes, outcome sync |
| 6 | Context budget monitor | directive |
| 7 | TDD enforcer | skeleton tests, notes |
| 8 | Telemetry | session-events, turn-ledger, privacy |
| 9 | Savings ledger | ledger entries, verified savings |
| 10 | Smart cache / scratchpad | compressed tool outputs, pointer files |
| 11 | Project guard / skills / self-modification protection | SKILL.md, blocked tool args |
| 12 | Flow enforcer | flow warns, todo queue |
| 13 | Loop guard | bash/edit loop neutralization |
| 14 | Cost anomaly detector | in-memory + notes |
| 15 | API client / auth bootstrap | `.env.production`, token state |
| 16 | Model tier / trinity config | `model-tiers.json` |
| 17 | MCP / dashboard sync | dashboard-bridge, mcp-runtime, network |
| 18 | Research audit | project-states bucket |
| 19 | Reporting | reports index + files |
| 20 | ML router | routing decisions, ML state |
| 21 | Reward engine / XP / laziness | footer tags, session-health |
| 22 | Claim verifier | claim/drift audits |
| 23 | Semantic observer | session events, friction patterns |
| 24 | Context7 | cost-policy directive, install flag |

## 2. Mutation matrix (highest-risk resources)

| Resource | Mutators | Conflict class |
|---|---|---|
| `model-tiers.json` | selection-manager (🔒), pricing/applySlot (🔒), chat-params per-turn (🔒), **trinity-tool (✍/⚛ no lock — FIXED)**, index persistMcpPort (⚛ no lock) | lost `selection.*` updates, torn reads |
| `blackbox-state.json` | state.ts (🔒), chat-transform (🔒), cascade (🔒), tool-execute (🔒), **semantic-observer (✍ — FIXED)**, **trinity-tool repair (✍ — FIXED)** | lost CV/turn-counter updates, torn reads |
| `delegation-state.json` | updateState (🔒), **flow-enforcer warn (✍ unlocked fallback — FIXED)** | lost lifetime/session updates, stale footer totals |
| `savings-ledger.jsonl` | buffered flush + compaction (🔒), **tool-execute direct append (✍ — FIXED)** | line loss across compaction rename |
| `session-events/<sid>.jsonl` | footer/index (append+rotation), **semantic-observer (✍ whole-file rewrite — FIXED)** | clobbered footer/gate lines |
| `orch-*.json` | orch-store (**plain async write — FIXED to atomic**) | corrupted JSON (only corrupting writer) |
| system prompt | thinking, cascade CV, blackbox, orchestrator, context7, anti-loop, reality-check, project guard, budget | directive conflicts (see §4) |
| assistant output | footer (append), quality gate (append), verify injection | ordering (see F8) |

Legend: 🔒 = withFileLock + atomic rename; ⚛ = atomic tmp+rename; ✍ = plain write.

## 3. Verified findings and fixes (this branch)

| # | Finding (verified) | Fix |
|---|---|---|
| F1 | `blackbox-state.json` had 2 unlocked whole-file writers (`semantic-observer.ts:254`, `trinity-tool.ts:142`) racing 5 locked writers | both route through `saveBlackboxState` (lock + atomic) |
| F2 | `model-tiers.json` written unlocked/non-atomic by trinity-tool (6 sites) | new `writeTiersLocked()` (lock + atomic) used everywhere |
| F3 | `delegation-state.json`: flow-enforcer's `recordFlowWarn` used an unlocked read-merge-write fallback (the intended `_stateWriter` is never wired) | routes through `updateState` (lock + atomic + cache invalidation) |
| F4 | `savings-ledger.jsonl`: tool-execute appended directly, racing the buffered flush + compaction rename | routes through buffered `recordSavingsLedgerEntry` |
| F5 | `session-events/<sid>.jsonl`: semantic-observer rewrote the whole file, clobbering footer/gate appends | uses `appendJsonlWithRotation` |
| F6 | `orch-*.json`: plain async `fs.writeFile` could corrupt JSON under concurrency | atomic tmp+rename |
| F7 | Prompt conflicts: thinking directive could double-fire with contradictory depths (OFF vs full); loop-prevention tripled | exactly one thinking directive (manual pin wins); one loop-prevention (severity-tagged wins) |
| F8 | Gate note appended *after* the footer broke the footer's trailing-strip regex → `footer + gate-note + footer` on next paint | quality gate runs **before** the footer so the footer is always last |
| F9 | Control vector computed twice per turn (messages.transform + system.transform) → divergent CVs, duplicate backend round-trip | turn-scoped CV cache keyed by session+intent; system.transform reuses it when fresh |
| F10 | API-fallback `vibelitex` pin could be overridden same-turn by a local `resolved_tier` estimate → slot divergence | fallback pin is authoritative while `isApiFallback()`; backend `resolved_tier` governs otherwise |

Each fix is a low-risk conversion (plain/async writes → locked/atomic, or directive
dedup). F7/F9/F10 are the only model-visible changes and are covered by E2E
(round-6 TDD scenarios re-run green; round-7 integration scenarios added).

## 4. Flagged for a product decision (not auto-fixed)
- **Delegation posture tension**: `[AI ORCHESTRATOR AGENT]` mandates "hand file writes
  and edits to Task subagents" while a relaxed-regime `[delegation enforcement:
  relaxed]` says "Write/Edit restrictions are temporarily eased. Proceed with
  caution." Both can appear in one prompt. Resolution is product intent (does the
  orchestrator mandate win, or the relaxed posture?), so it's documented, not
  changed.
- **`_refreshModel` bypasses `_modelLocked`**: it observes the live model into
  `currentModel`; the lock only blocks slot *application*. This is arguably correct
  (observation ≠ mutation) and left as-is.
- **Redundant-but-consistent directives**: anti-fabrication / empirical-answer /
  reality-check overlap. Not a conflict; left alone to avoid churn.
- **`correction-loop` E2E drift**: the round-2 scenario now fails on both base and
  fixed code — the model responds "Acknowledged." instead of fixing on session
  continuation. Pre-existing model drift, not a regression; the scenario should be
  made adaptive or retired.

## 5. Minimal viable composition (spec only)

Subsystem → kill-toggle map for a "benchmarked-value-only" install. Everything you
benchmark as valuable stays on; the orchestration churn turns off via existing
toggles — no code change required to try it.

| Keep (candidate value) | Toggle to keep it on |
|---|---|
| Quality gate (deterministic, non-blocking) | `VIBEOS_QUALITY_GATE` != 0 (default on) |
| Honest savings / verified savings | default on (`vibe status`) |
| TDD auto-on-coding | `selection.quality_gate_tdd` (default auto) |

| Turn off (candidate churn) | Toggle |
|---|---|
| Cascade / model auto-switching | `selection.active_slot` pinned via `vibe lock on`; or `requested_optimization_mode` = non-backend mode |
| Blackbox / decision engine | `vibe blackbox off` (env `VIBEOS_BLACKBOX`?) — verify current kill-switch |
| Flow enforcer | `selection.flow_enabled = false` (`vibe flow off`) |
| TDD skeleton auto-create | `selection.tdd_enforce = false` (`vibe tdd off`) |
| Thinking directives | `selection.thinking_level = "full"` (no local pin; CV still injects) |
| Context7 cost policy | `selection.context7_urgency` = "preferred" |
| Smart cache / scratchpad compression | verify env switch (`VIBEOS_SCRATCHPAD`?) |
| Dashboard MCP | dashboard opt-in already gated (`selection.dashboard_mcp_enabled`) |
| Telemetry to backend | offline mode / API token revoked |

> The exact env/selection kill-switches for each subsystem should be confirmed
> against `selection-manager.ts` before building a one-command "minimal" mode. This
> spec intentionally does not build that command.

## 6. Suggested follow-ups

1. Build a `vibe setup minimal` command from §5 once the kill-switch list is confirmed.
2. Fix or retire `correction-loop` (model drift, see §4).
3. Consider routing `persistMcpPort` and the dashboard/index stable writers through the
   shared lock helpers (F2-style) to close the remaining unlocked-writer gaps.
4. Add a long-session "all systems on" soak to the E2E harness (round-7 scenarios are
   the single-turn starting point; continuation is blocked by the DeepSeek
   `reasoning_content` pass-back bug in opencode, not by the plugin).
