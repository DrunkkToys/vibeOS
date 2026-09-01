# theSaver-oc / vibeOS Plugin — Formal Feature Specification

> **Filed**: 2026-07-01 | **Contract**: 0 fail across full suite
> This is the source of truth for what this plugin does. Every claim below is backed by test assertions.
> If your change breaks a listed behavior, the tests will catch it.

---

## Preamble — How to Use This Spec

1. **Before modifying any code**, read the relevant section below and verify your change does not break any listed contract.
2. **After modifying code**, run `node --loader ./scripts/ts-src-loader.mjs --test tests/<relevant-test>` to prove no regressions.
3. If you must change a verified behavior, **update the tests first**, then update SPEC.md.
4. The contract is **0 fail**. A failing test means a broken contract — fix the code or update the spec.

---

## 1. Cascade Model Routing

### 1.1 Difficulty Scoring Returns a Usable Decision for Any Valid Input
- **Contract**: `cascadeDecide` / `computeDifficulty` return a decision with a level, confidence and suggested tier for any prompt, and score simple and complex prompts to different depths.
- **Test**: `tests/cascade_contract_fuzz.test.mjs` — "cascade: cascadeDecide returns different depths for simple vs complex prompts"
- **Module**: `src/vibeOS-lib/ml-router.ts`

### 1.2 Route Re-Evaluates Per Message (Not Cached Per Session)
- **Contract**: The task branch of `tool.execute.before` re-evaluates difficulty per message. A complex prompt from a cheap root delegates to medium/brain; a simple prompt stays cheap. Escalation requires `confidence >= 0.6` and a non-`moderate` level — weak signals deliberately leave the tier alone rather than churning it.
- **Test**: `tests/cascade_escalation_contract.test.mjs` — "[escalation] a complex prompt from cheap root delegates to medium/brain" + "[escalation] a simple prompt stays cheap with no delegation"
- **Module**: `src/lib/hooks/tool-execute.ts`

### 1.3 Bulk Batch Preserves Per-Message Re-Evaluation
- **Contract**: Each message in a bulk batch is classified independently, not cached from the first message.
- **Test**: `tests/cascade_escalation_contract.test.mjs` — "[escalation] bulk batch preserves per-message re-evaluation"
- **Module**: `src/vibeOS-lib/ml-router.ts`

### 1.4 Cascade Depth Tracking
- **Contract**: Footer `cascadeDepth` tracks the length of `routePath`. depth ≥ 3 shows ▸▸▸, depth ≥ 2 shows ▸▸, depth < 2 shows empty.
- **Test**: `tests/cascade_footer_depth.test.mjs` — "routePath length determines cascade icon", "cascadeDepth >= 3 shows ▸▸▸ icon"
- **Module**: `src/lib/hooks/shared-footer.ts`

### 1.5 Blackbox State Persists cascade_depth After Route Decision
- **Contract**: After the task branch resolves a route, `cascade_depth`, `route_path` and `pipeline_root` are persisted onto `sessions[_OC_SID]` in blackbox state, and the persisted depth equals the persisted route path length. Persistence updates an existing session only.
- **Test**: `tests/cascade_footer_depth.test.mjs` — "blackbox state persists cascade_depth after route decision"
- **Module**: `src/lib/hooks/tool-execute.ts` / `src/lib/state.ts`

### 1.6 VibeUltraX Pipeline Routes Correctly
- **Contract**: VibeUltraX applies the per-turn tier verdict to the PRIMARY, clamped to the mode's envelope. `entry_slot` records the tier the turn started from; `active_slot` records where it ended up. A verdict at or below the entry leaves the primary where it is.
- **Superseded contract** (until 2026-09-01): "selects brain tier for complex prompts without moving the root slot" — cheap-first, escalating by delegating a Task to a higher tier. Changed because the plugin can route but cannot force the model to delegate: across five live ml-impact runs vibeultrax voided on its first hard turn every time, the model doing the work itself on the cheap slot until the turn timed out (3027s on `diagnose`). The measurements also removed the savings rationale — prompt caching dominates cost (a warm third turn costs 249 input tokens against 14,057 cold), and switching models per turn discards the cache, so a cheaper model on a cold prompt is not cheaper.
- **Test**: `tests/cascade_route_contract.test.mjs` — "sync moves the vibeultrax primary to the per-turn route's slot, keeping entry_slot as the origin", plus `tests/test_ultrax_primary_escalation.test.mjs` (15 assertions incl. envelope clamp, `vibe lock on`, and `vibe axis tier` precedence)
- **Module**: `src/lib/mode-router.ts` / `src/lib/hooks/chat-transform.ts` (`ultraXPrimarySlot`)

### 1.7 Normalizer Keeps active_pipeline Durable
- **Contract**: When backend routes to cheap, the `active_pipeline` is kept as `["brain"]` (not overwritten).
- **Test**: `tests/cascade_route_contract.test.mjs` — "normalizer keeps vibeultrax active_pipeline durable when backend route is cheap"
- **Module**: `src/lib/mode-router.ts`

### 1.8 Control Vector Is the Baseline; a Confident ML Verdict Adjusts It Within the Envelope
- **Contract**: `syncControlSettings` writes the backend's decision into selection state, and the task branch of `tool.execute.before` takes `worker_slot || selected_slot` as the routing baseline. A per-message ML verdict that clears the confidence gate may adjust that baseline UP or DOWN, but never outside the envelope returned by `mlCascadeRoot` — the mode's declared pipeline widened by the live `route_path`. A verdict landing outside the envelope is **clamped into it** by `clampSlotToEnvelope` (nearest slot by rank), not discarded. A single-tier envelope (e.g. vibeqmax = brain only) is a hard bound the ML cannot leave: every verdict clamps to that one slot, which equals the baseline, so the adjustment is a no-op. Stress reaches routing by moving the control vector upstream, not in this branch.
- **Why clamping, not membership**: the gate excludes `level === "moderate"`, and `computeDifficulty` only ever returns `suggestedTier === "medium"` at that level. The reachable verdicts are therefore `cheap` and `brain` only. Under a two-slot envelope such as vibemax's `["medium","brain"]`, a plain membership test discards a confident `cheap` and leaves the Task on the brain baseline — the mechanism was unreachable in every mode whose envelope excludes `cheap`.
- **Direction available**: `normalizeRoutePath` clamps `route_path` at the selected slot (`route.slice(0, idx + 1)`), so the persisted route never extends ABOVE the backend's own pick. The envelope therefore spans downward from the baseline, and the reachable adjustment outside vibeultrax is de-escalation within the span the backend opened — not escalation past it. The backend stays authoritative for the ceiling.
- **Test**: `tests/cascade_route_contract.test.mjs` — "a confident ML verdict escalates above the control vector baseline", "a confident ML verdict de-escalates below the control vector baseline", "the envelope is a hard bound: the ML cannot route outside the declared pipeline"; `tests/test_task_routing_authority.test.mjs` — "vibemax: the ML de-escalates a trivial Task inside the span the backend opened", "vibeqmax: an explicitly single-tier mode is not de-escalated by a trivial prompt"
- **Module**: `src/lib/hooks/tool-execute.ts` (`mlCascadeRoot`, `clampSlotToEnvelope`, and the task branch of `onToolExecuteBefore`)
- **History**: This section previously specified a `resolveCascadeRouteDecision` precedence rule (explicit backend target beats local cascade). That function had zero call sites and was tree-shaken out of `dist/vibeOS.js`; the contract described code that never shipped.

### 1.8b Slot State Is Per-Turn, Not Vibeultrax-Only
- **Contract**: `entry_slot`, `worker_slot`, `selected_slot`, `worker_model`, `selected_subagent` and `requires_delegation` are written on every `syncControlSettings` turn regardless of optimization mode. Leaving vibeultrax refreshes them; it must not leave them frozen at their last vibeultrax value. `requires_delegation` is false and `selected_subagent` is null outside vibeultrax, where the orchestrator runs at tier instead of delegating.
- **Why it matters**: the task branch routes every Task off `worker_slot || selected_slot`. When these were written only inside the `isUltraX` branch, subagent routing in every other mode ran off stale vibeultrax state.
- **Test**: `tests/ml_routing_authority_all_modes.test.mjs` — "leaving vibeultrax refreshes entry_slot instead of freezing the ultrax value", "leaving vibeultrax refreshes worker_slot, which is what Task routing reads", "leaving vibeultrax clears the ultrax delegation contract", "worker_model follows the refreshed slot", "vibeultrax itself is unchanged: cheap entry, escalated worker, delegation on"
- **Module**: `src/lib/hooks/chat-transform.ts`

### 1.9 Remote API Unavailable → Local Fallback
- **Contract**: When the remote API times out (>3000ms) or errors, the local cascade decision engine is used as fallback.
- **Test**: `tests/blackbox_api_authoritative.test.mjs` — "API > 3000ms → local fallback", "API unavailable → local fallback"
- **Module**: `src/lib/hooks/tool-execute.ts`

### 1.10 Session Bridge Propagates parentSessionId
- **Contract**: Child sessions record `parentSessionId` linking back to the parent session. Multi-level cascades produce a chain.
- **Test**: `tests/cascade_route_contract.test.mjs` — "inherits parent session id"
- **Module**: `src/lib/session-bridge.ts`

### 1.11 Delegation Savings Accumulate Across Depth
- **Contract**: Savings are accumulated across cascade depth levels. Each child session's savings are added to the parent.
- **Test**: `tests/cascade_route_contract.test.mjs` — "accumulates savings across depth"
- **Module**: `src/lib/session-savings.ts`

### 1.12 Stress Upgrade: stress > 1.5 Forces Quality Mode
- **Contract**: When stress score exceeds 1.5, the mode is overridden to quality regardless of current mode.
- **Test**: `tests/cascade_real_proof.test.mjs` — "cascade: stress > 1.5 overrides mode to quality"
- **Module**: `src/lib/turn-classify.ts`

### 1.13 Pivot Detection Fires on Context Switch
- **Contract**: A significant change in user prompt content triggers a pivot detection event.
- **Test**: `tests/cascade_real_proof.test.mjs` — "cascade: pivot detection fires on significant context switch"
- **Module**: `src/vibeOS-lib/semantic-observer.ts`

### 1.14 ML Router Cost Decisions Are Deterministic
- **Contract**: For the same input, the ML router produces the same cost decision (same tier).
- **Test**: `tests/cascade_real_proof.test.mjs` — "cascade: ML router cost decisions are deterministic and reasonable"
- **Module**: `src/vibeOS-lib/ml-router.ts`

### 1.15 Loop Detection Escalates Through 4 Intervention Levels
- **Contract**: When a loop is detected, the system escalates through 4 distinct intervention levels (notify → warn → redirect → hard block).
- **Test**: `tests/cascade_real_proof.test.mjs` — "cascade: loop detection escalates through all 4 intervention levels"
- **Module**: `src/lib/loop-guard.ts`

### 1.16 Full Session Lifecycle
- **Contract**: Sessions progress through states: INIT → EXPLORING → REFINING → IMPLEMENTING → CONVERGING → CLOSED.
- **Test**: `tests/cascade_real_proof.test.mjs` — "cascade: full session lifecycle"
- **Module**: `src/lib/session-orchestrator.ts`

### 1.17 applySlot Does NOT Rewrite opencode.json
- **Contract**: `applySlot` persists the active slot to `model-tiers.json` but does NOT modify `opencode.json`.
- **Test**: `tests/test_cascade_real_switch.test.mjs` — "applySlot does NOT rewrite opencode.json"
- **Module**: `src/lib/selection-manager.ts`

---

## 2. Footer System

### 2.1 Footer Renders Without Crash at All Budget/Stress Levels
- **Contract**: `buildFooterLine` produces a valid string for any combination of budget (0 to 5.0) and stress (0 to 2.5).
- **Test**: `tests/mega/mega_05_footer_text_complete_gauntlet.test.mjs` — "buildFooterLine budget 0 stress 0" through "buildFooterLine budget 0.00003 stress 2.5"
- **Module**: `src/lib/hooks/footer.ts`

### 2.2 Footer Line Never Exceeds maxLength
- **Contract**: Every footer line output is ≤ the configured maximum length (typically 200 chars).
- **Test**: `tests/mega/mega_05_footer_text_complete_gauntlet.test.mjs` — "footer line never exceeds maxLength"
- **Module**: `src/lib/hooks/footer.ts`

### 2.3 Tier Icons Are Correct per Tier
- **Contract**: `resolveTierIcon('high'|'medium'|'cheap')` returns the correct emoji for each tier.
- **Test**: `tests/mega/mega_05_footer_text_complete_gauntlet.test.mjs` — "resolveTierIcon high/medium/cheap"
- **Module**: `src/lib/hooks/shared-footer.ts`

### 2.4 Reward Match Renders ✓ Badge
- **Contract**: When a reward claim is verified as true, the footer shows a checkmark (✓) badge.
- **Test**: `tests/reward_footer_claims.test.mjs` — "reward match renders ✓ badge"
- **Module**: `src/lib/hooks/footer.ts`

### 2.5 Reward Mismatch Renders Warning Icon
- **Contract**: When a reward claim is false, the footer shows a warning icon.
- **Test**: `tests/reward_footer_claims.test.mjs` — "reward mismatch renders mismatched icon"
- **Module**: `src/lib/hooks/footer.ts`

### 2.6 Reward No Cascade Runs Renders ? Icon
- **Contract**: When no cascade audit entries exist for the session, the footer shows a question mark (?) icon.
- **Test**: `tests/reward_footer_claims.test.mjs` — "reward no cascade runs renders ? icon"
- **Module**: `src/lib/hooks/footer.ts`

### 2.7 Stress Icon Updates per Stress Band
- **Contract**: The stress icon in the footer changes based on the stress level band (low/medium/high/critical).
- **Test**: `tests/reward_footer_claims.test.mjs` — "stress icon updates based on stress level"
- **Module**: `src/lib/hooks/footer.ts`

### 2.8 Footer Tool Title Is NOT Duplicated After Multiple Renders
- **Contract**: `setToolTitle` is called exactly once per render cycle, not duplicated.
- **Test**: `tests/test_footer_tool_title_no_clobber.test.mjs` — "footer tooltip title is NOT duplicated after multiple renders"
- **Module**: `src/lib/hooks/footer.ts`

### 2.9 Dynamic Footer Matches Static Footer for Identical Inputs
- **Contract**: The dynamic (runtime) footer builder produces the same output as the static (test) builder for identical parameters.
- **Test**: `tests/test_footer_dynamic_integration.test.mjs` — "dynamic footer matches static footer for identical inputs"
- **Module**: `src/lib/hooks/footer.ts` / `src/lib/hooks/shared-footer.ts`

### 2.10 Alert Severity Text Renders Without Crash
- **Contract**: All alert severity levels render without crashing in the footer.
- **Test**: `tests/test_footer_alert_regression.test.mjs` — "alert severity text renders without crash"
- **Module**: `src/lib/hooks/footer.ts`

---

## 3. Blackbox Decision Engine

### 3.1 Canonical Record Has Required Fields
- **Contract**: Every blackbox record contains `{sessionId, model, tier, mode, stress, budget, savings}`. `parentSessionId` and `parentSavings` are optional.
- **Test**: `tests/blackbox_record_canonical.test.mjs` — "canonical record fields"
- **Module**: `src/vibeOS-lib/blackbox/`

### 3.2 normalizeBlackboxRecord Fills Missing Defaults
- **Contract**: Missing fields in a blackbox record are filled with sensible defaults (not left undefined).
- **Test**: `tests/blackbox_record_canonical.test.mjs` — "normalizeBlackboxRecord fills defaults"
- **Module**: `src/vibeOS-lib/blackbox/`

### 3.3 recordLiveSessionSnapshot Persists to Disk
- **Contract**: `recordLiveSessionSnapshot` writes data to the blackbox state file on disk.
- **Test**: `tests/blackbox_record_canonical.test.mjs` — "recordLiveSessionSnapshot persists to disk"
- **Module**: `src/lib/state.ts`

### 3.4 API Verdict Authoritative Over Local Tracker
- **Contract**: If the remote API returns a decision, it always overrides the local tracker's decision.
- **Test**: `tests/blackbox_api_authoritative.test.mjs` — "API verdict ALWAYS overrides local tracker"
- **Module**: `src/vibeOS-lib/blackbox/`

### 3.5 Local Loop Fallback Works
- **Contract**: The local loop health check returns healthy status, and the fallback path returns valid data.
- **Test**: `tests/blackbox_local_loop_authority.test.mjs` — "local loop health check works", "local loop fallback works"
- **Module**: `src/vibeOS-lib/blackbox/local-stub.ts`

### 3.6 Stress Score Maps to [0, 3] Scale
- **Contract**: `scoreStress` returns a float in the range [0, 3] where 0=calm, 1=moderate, 2=urgent, 3=critical.
- **Test**: `tests/mega/mega_10_stress_pipeline_integration.test.mjs` — "scoreStress with diverse inputs returns valid values"
- **Module**: `src/lib/classifiers.ts`

### 3.7 Singleton Session ID Remains Constant
- **Contract**: The session ID returned by `getCurrentSessionId` stays the same across multiple calls within the same session.
- **Test**: `tests/test_blackbox_live_state_singleton.test.mjs` — "singleton session ID remains constant"
- **Module**: `src/lib/runtime-state.ts`

---

## 4. Delegation & Enforcement

### 4.1 Delegation State Read/Write/Create
- **Contract**: The delegation state file (`delegation-state.json`) can be created, read, and written. Missing files are handled gracefully.
- **Test**: `tests/test_delegation_enforcer.test.mjs` — delegation state file read/write/create works
- **Module**: `src/lib/state.ts`

### 4.2 Enforcer Executes with Real Tier Delegation
- **Contract**: The delegation enforcer routes tasks to the correct tier (`brain`/`medium`/`cheap`) based on complexity.
- **Test**: `tests/test_delegation_enforcer.test.mjs` — enforcer execution with real tier delegation
- **Module**: `src/lib/hooks/tool-execute.ts`

### 4.3 getOpenCodeHome Returns Stable Path
- **Contract**: `getOpenCodeHome()` returns a path ending in `.opencode`, ignoring the vibeOS home context.
- **Test**: `tests/deep_integration.test.mjs` — "getOpenCodeHome: ignores vibeOS home context and keeps OpenCode config stable"
- **Module**: `src/lib/runtime-paths.ts`

### 4.4 Delegation Path Resolution
- **Contract**: When VIBEOS_HOME is set, delegation state and audit files resolve relative to it.
- **Test**: `tests/deep_integration.test.mjs` — delegation deep integration tests
- **Module**: `src/lib/runtime-paths.ts`

### 4.5 Cascade Audit Writer Appends JSONL
- **Contract**: Every cascade decision appends a line to `cascade-audit.jsonl`. The file is valid JSONL (each line parseable JSON with `{sessionId, tier, mode, stress, strategy}`).
- **Test**: `tests/cascade_audit_writer.test.mjs` — "cascade audit: every decision appends to cascade-audit.jsonl", "cascade audit: file is parseable JSONL"
- **Module**: `src/lib/hooks/tool-execute.ts`

### 4.6 Claim Verification Rejects When Cascade Audit Missing
- **Contract**: `evaluateClaimVerification` returns rejected when no relevant cascade audit entries exist for the session.
- **Test**: `tests/cascade_claim_contract.test.mjs` — "contract: evaluateClaimVerification rejects when cascade audit missing"
- **Module**: `src/lib/claim-verification.ts`

### 4.7 Claim Verification Checks Tier Match
- **Contract**: `evaluateClaimVerification` verifies that the tier in the claim matches the tier logged in the cascade audit.
- **Test**: `tests/cascade_claim_contract.test.mjs` — "contract: evaluateClaimVerification verifies tier matches"
- **Module**: `src/lib/claim-verification.ts`

### 4.8 Claim Verification Honors Tolerance
- **Contract**: `evaluateClaimVerification` accepts stress/cost values within a configurable absolute tolerance window.
- **Test**: `tests/cascade_claim_contract.test.mjs` — "contract: evaluateClaimVerification honors absoluteTolerance"
- **Module**: `src/lib/claim-verification.ts`

---

## 5. State & Persistence

### 5.1 Fresh State Initialization
- **Contract**: On first run, `delegation-state.json` is created with empty sessions array and initial lifetime stats.
- **Test**: `tests/mega/mega_01_fresh_bootstrap.test.mjs` — fresh state init; session ID gen; savings file created
- **Module**: `src/lib/state.ts`

### 5.2 API Key Validation: Invalid Key → Local Functions Still Work
- **Contract**: Even with an invalid or empty API key, local functions (`scoreStress`, `classify`, `recordSaving`, `getCurrentSessionId`) continue working.
- **Test**: `tests/mega/mega_01_fresh_bootstrap.test.mjs` — API key validation
- **Module**: `src/lib/api-client.ts`

### 5.3 Missing/Corrupt State Files Handled Gracefully
- **Contract**: Missing `delegation-state.json`, empty content, non-JSON content, and null/empty objects are all handled without crashing.
- **Test**: `tests/mega/mega_03_state_corruption_gauntlet.test.mjs` — all 4 corruption scenarios
- **Module**: `src/lib/state.ts`

### 5.4 Concurrent Writes Don't Crash
- **Contract**: 20 parallel session writes and 20 parallel delegation enforcer calls all succeed without crash or data corruption.
- **Test**: `tests/mega/mega_04_concurrency_hammer.test.mjs` — concurrency tests
- **Module**: `src/lib/state.ts`

### 5.5 Remote API Degraded — Local Functions Still Work
- **Contract**: Wrong API token, empty API key, or bad API URL — `scoreStress`, `classify`, `recordSaving`, `setCurrentTier` all continue working locally.
- **Test**: `tests/mega/mega_06_remote_api_degraded_fallback.test.mjs` — all 3 degraded scenarios
- **Module**: `src/lib/hooks/tool-execute.ts` / `src/lib/api-client.ts`

### 5.6 Savings Recording Accumulates Correctly
- **Contract**: `recordSaving` accumulates delegation, cache, and missed_context7 savings. `SAVE_EST` constants are positive. `WARN_ON_DIRECT` lists write/edit/notebookedit. `FREE` includes trinity. `MONITOR` includes todowrite.
- **Test**: `tests/mega/mega_09_savings_ledger_tracking.test.mjs` — "recordSaving through index.js accumulates three categories", "SAVE_EST constants are correct"
- **Module**: `src/lib/state.ts` / `src/lib/constants.ts`

### 5.7 Session Compaction (Turn 7+)
- **Contract**: At turn 7+, a compaction directive is injected. The scratchpad is used to preserve key context across compaction.
- **Test**: `tests/session-bridge.test.mjs` — session bridge persistence tests
- **Module**: `src/lib/hooks/session-compact.ts`

---

## 6. TDD Enforcement

### 6.1 Test Skeleton Generation for Multiple Languages
- **Contract**: `buildTestSkeleton` generates test skeletons for 12 languages (py, js, ts, mjs, tsx, jsx, cjs, mts, go, sh, rs, java, kt, rb) with strict or quality depth.
- **Test**: `tests/mega/mega_08_trinity_flow_tdd_enforcers.test.mjs` — "TDD enforcer exports work"
- **Module**: `src/lib/test-skeletons.ts`

### 6.2 TDD Enforcer Cooldown-Guarded
- **Contract**: `enforceTestFile` respects a cross-process cooldown window, preventing duplicate test generation in rapid succession.
- **Test**: `tests/mega/mega_08_trinity_flow_tdd_enforcers.test.mjs` — TDD enforcer exports verified
- **Module**: `src/lib/tdd-enforcer.ts`

---

## 7. Reward Engine

### 7.1 Reward Points Are Computable for Any State
- **Contract**: `computeReward` exists and returns valid reward points for any input state (including empty).
- **Test**: `tests/mega/mega_10_stress_pipeline_integration.test.mjs` — reward engine exports verified
- **Module**: `src/vibeOS-lib/reward-engine.ts`

### 7.2 Reward Input Forwards Claim Evidence
- **Contract**: `buildRewardInput` forwards `claimEvidence` only when a mismatch is detected. Lie penalty is -15 for mismatch, 0 for no mismatch.
- **Test**: `tests/cascade_claim_contract.test.mjs` — "buildRewardInput forwards claim evidence", "buildRewardInput liePenalty = -15 for mismatch, 0 for no mismatch"
- **Module**: `src/vibeOS-lib/reward-engine.ts` / `src/lib/claim-verification.ts`

---

## 8. Flow Enforcer

### 8.1 Flow Rules Checkable
- **Contract**: `checkFlowRules`, `addFlowRule`, `resetAll`, `getFlowWarns`, `getFlowTodos`, `recordFlowTodo`, `ensureProjectDocs` are all exported and work without crash.
- **Test**: `tests/mega/mega_08_trinity_flow_tdd_enforcers.test.mjs` — "flow-enforcer exports work"
- **Module**: `src/vibeOS-lib/flow-enforcer.ts`

---

## 9. Reporting

### 9.1 Report Save/List/Read Functions Exportable
- **Contract**: `saveReport`, `readReport`, `listReports`, `researchAudit` are all exported from the main entry point and function correctly.
- **Test**: `tests/mega/mega_09_savings_ledger_tracking.test.mjs` — "report functions exported from index.js"
- **Module**: `src/lib/reporting.ts`

---

## 10. Bootstrap & Setup

### 10.1 Cross-Device Setup Works
- **Contract**: The setup contract validates that paths resolve correctly across devices.
- **Test**: `tests/setup_contract.test.mjs` — setup contract tests pass
- **Module**: `src/lib/state.ts`

### 10.2 Uninstall Leaves No Artifact Behind
- **Contract**: The uninstaller sweeps every OpenCode home an install could have targeted (`~/.opencode`, the XDG dir, the desktop app support dir, the project `.opencode`, and any `VIBEOS_OPENCODE_HOME` override) and removes plugin files, the `/vibe` skill, home-root runtime artifacts (`opencode-retention.log`, `learned-patterns.json`, `recent-events.jsonl`), vibeOS auto-generated project skills, runtime state dirs, the legacy home-root deployment, and the stray `undefined/` deploy artifact. It strips the vibe plugin ref, tier agents, and `default_agent` from both `opencode.json` and `opencode.jsonc` while preserving non-vibe entries. It is idempotent and safe on a bare `HOME`.
- **Test**: `tests/test_uninstall_completeness.test.mjs` — 11 tests
- **Module**: `scripts/uninstall.mjs`

### 10.2b The `vibe` Mode-Dropdown Entry Disappears From Every Source
- **Contract**: The dropdown entry can come from `config.agent.vibe`, a legacy `config.mode.vibe` block, or a markdown agent file (`<home>/agent/vibe*.md`, `<project>/.opencode/agent/vibe*.md`). Uninstall removes all three. Non-vibe `mode` entries and hand-written `agent/vibe*.md` files (no `vibeOS`/`VibeUltraX` marker in the body) are preserved.
- **Test**: `tests/test_uninstall_completeness.test.mjs` — "uninstall removes every source of the vibe mode-dropdown entry"
- **Module**: `scripts/uninstall.mjs`

### 10.3 An Uninstalled Plugin Is Inert
- **Contract**: When the uninstall marker exists, `DelegationEnforcer` returns `{}` — zero hooks — so an OpenCode process still holding the bundle in memory cannot recreate `$VIBEOS_HOME` or re-register tier agents. Reinstall clears the marker.
- **Test**: `tests/test_uninstalled_plugin_inert.test.mjs` — 2 tests
- **Module**: `src/index.ts`, `src/lib/runtime-config.ts`

### 10.3b Already-Registered Hooks Go Inert Mid-Process
- **Contract**: The load-time check cannot fire again for a bundle that is already loaded, so every hook re-checks the marker per call via `isVibeOSUninstalledCached()` (750 ms cache). After an in-session `vibe uninstall`, `experimental.chat.system.transform`, `experimental.text.complete` and `shell.env` leave their outputs untouched, and the `vibe` tool returns the inert notice for every action except `setup`.
- **Test**: `tests/test_agent_gate.test.mjs` — "an in-session uninstall makes already-registered hooks inert"
- **Module**: `src/index.ts`, `src/lib/runtime-config.ts`, `src/lib/trinity-tool.ts`

### 10.5 vibeOS Runs Only Under the `vibe` Agent
- **Contract**: Automatic behavior is gated on the agent selected in OpenCode's mode dropdown. `vibe` and `vibe-*` tier subagents run the full pipeline; `build`/`plan`/any other agent gets no footer, no system directives, no enforcement, no model override, no env injection. The agent is learned from `chat.message`/`chat.params`/`chat.headers` and cached per session (256-entry LRU). Fallbacks: `VIBEOS_AGENT_GATE=off` disables the gate; a known session agent is authoritative; a host that never reports an agent runs vibeOS; otherwise the last reported agent applies. The `vibe` tool itself is never agent-gated.
- **Test**: `tests/test_agent_gate.test.mjs` — 10 tests
- **Module**: `src/lib/agent-gate.ts`, `src/index.ts`

### 10.4 The In-Session `vibe uninstall` Reaches the Uninstaller
- **Contract**: `build-bundle.mjs` bundles `scripts/uninstall.mjs` to `dist/uninstall.mjs`; `deploy.mjs` copies it to `<ocHome>/plugins/uninstall.mjs`; `trinity-tool` resolves `join(here, "uninstall.mjs")` first. Without this the deployed plugin dir has no `scripts/` tree and `vibe uninstall` only printed instructions.
- **Test**: `tests/test_uninstall_completeness.test.mjs` — "the deployed plugin dir is a resolvable location for the uninstaller", "uninstall removes the deployed copy of itself from the plugin dir"
- **Module**: `scripts/build-bundle.mjs`, `scripts/deploy.mjs`, `src/lib/trinity-tool.ts`

---

## 11. Audit Trail

### 11.1 Cascade Audit Appends per Decision
- **Contract**: Every cascade decision appends a `_ts`-stamped JSON line to `cascade-audit.jsonl`.
- **Test**: `tests/cascade_audit_writer.test.mjs` — "[cascade-audit] a cascade decision appends a parseable _ts line"
- **Module**: `src/lib/hooks/tool-execute.ts`

### 11.2 Cascade Audit Substantiates Claims
- **Contract**: A cascade audit entry written within the claim window can substantiate a reward claim.
- **Test**: `tests/cascade_audit_writer.test.mjs` — "[cascade-audit] the written line substantiates a claim within the window"
- **Module**: `src/lib/hooks/tool-execute.ts` / `src/lib/claim-verification.ts`

---

## 12. Performance Guarantees

### 12.1 No Silent Regress in Escalation
- **Contract**: At least one test case in the escalation suite triggers an escalation (proving the system hasn't silently regressed to never-escalating).
- **Test**: `tests/cascade_escalation_contract.test.mjs` — "never silently regresses to never-escalating: must escalate for at least 1 of test cases"
- **Module**: all routing modules

### 12.2 100-Level Cascade Does Not Crash
- **Contract**: A delegation chain 100 levels deep renders without crash.
- **Test**: `tests/cascade_footer_depth.test.mjs` — "depth stress: pattern repeated 100 levels renders correctly"
- **Module**: `src/lib/hooks/shared-footer.ts`

### 12.3 Fuzz Testing: All ML Inputs Survive
- **Contract**: `mergeAuthoritativeBlackboxState`, `buildRewardInput`/`computeReward`, `computeControlVector`, and `classify` all survive random/boundary inputs without throwing.
- **Test**: `tests/cascade_contract_fuzz.test.mjs` — all 5 fuzz subtests
- **Module**: `src/lib/` + `src/vibeOS-lib/`

---

## 13. MCP Server & Dashboard

### 13.1 MCP Server Creates HTTP Endpoint
- **Contract**: `createMcpServer()` creates a Node HTTP server listening on a configured port. It serves dashboard SPA (React/Vite), REST endpoints, and SSE events.
- **Test**: `src/lib/tests/vibeos-mcp-server.test.ts` — MCP server contract tests
- **Module**: `src/lib/vibeos-mcp-server.ts`

### 13.2 Dashboard Bridge Queues Mutations
- **Contract**: `dashboard-bridge.ts` queues mutations, folds pending state, and syncs with the backend via `remoteCall`.
- **Test**: (covered by MCP server integration tests)
- **Module**: `src/lib/dashboard-bridge.ts`

---

## 14. Known Test Gaps (Untested Modules)

The following modules have NO dedicated test files. Changes to these modules carry higher regression risk:

| Module | File | Risk |
|---|---|---|
| Model cost tables, tier classification, dynamic pricing | `src/lib/pricing.ts` | HIGH |
| Selection manager (model-tiers.json R/W) | `src/lib/selection-manager.ts` | HIGH |
| Claim verification (partial coverage via cascade_claim_contract) | `src/lib/claim-verification.ts` | MEDIUM |
| Session savings aggregation | `src/lib/session-savings.ts` | MEDIUM |
| Session bridge audit log | `src/lib/session-bridge.ts` | MEDIUM |
| Research audit (scratchpad-based) | `src/lib/research-audit.ts` | MEDIUM |
| Loop state (sticky API/local) | `src/lib/loop-state.ts` | MEDIUM |
| Loop guard (bash circuit-breaker) | `src/lib/loop-guard.ts` | MEDIUM |
| Per-turn memoization | `src/lib/turn-memo.ts` | LOW |
| Text compression | `src/lib/text-compress.ts` | LOW |
| Credit API (live balance fetch) | `src/lib/credit-api.ts` | LOW |
| Dashboard base URL resolution | `src/lib/dashboard-base-url.ts` | LOW |
| Bootstrap paths | `src/lib/bootstrap-paths.ts` | LOW |
| Budget-first mode policy | `src/lib/mode-policy.ts` | LOW |
| Cost anomaly detection | `src/lib/cost-anomaly.ts` | LOW |
| Trinity model rebuild | `src/lib/trinity-rebuild.ts` | LOW |
| Project knowledge tree | `src/lib/project-tree.ts` | LOW |
| Hooks (tool-execute, chat-params, chat-transform, footer, session-compact, shell-env) | `src/lib/hooks/*` | HIGH (tested indirectly via integration tests) |

---

## Appendix: Configuration Surface

| Config | File | Values |
|---|---|---|
| Model tiers | `model-tiers.json` | `{"trinity":{"brain":{...},"medium":{...},"cheap":{...}}}` |
| Slot selection | `opencode.json` | `active_slot: brain|medium|cheap` |
| Optimization mode | runtime (chat parameter) | `vibeultrax|vibeqmax|vibemax|quality|balanced|longrun|budget|speed|audit|forensic` |
| Thinking level | runtime (chat parameter) | `full|brief|off` |
| Flow enforcement | runtime | `on|off` |
| Delegation enforcement | runtime | `on|off` |
| TDD enforcement | runtime | `on|off|strict` |

---

*End of SPEC.md — every claim above is test-verified. 0 fail is the contract.*
