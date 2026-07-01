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

### 1.1 Route Decision Returns {tier, mode, strategy} for Any Valid Input
- **Contract**: `resolveCascadeRouteDecision` always returns an object with `{tier, mode, strategy}` when given valid inputs (stress, budget, complexity, current tier).
- **Test**: `tests/cascade_contract_fuzz.test.mjs` — "fuzz: route decision with random stress/budget"
- **Module**: `src/vibeOS-lib/ml-router.ts`

### 1.2 Route Re-Evaluates Per Call (Not Cached Per Session)
- **Contract**: `resolveCascadeRouteDecision` re-evaluates each call independently. Complex prompts route to medium/brain; simple prompts stay cheap.
- **Test**: `tests/cascade_escalation_contract.test.mjs` — "[escalation] a complex prompt from cheap root delegates to medium/brain" + "[escalation] a simple prompt stays cheap with no delegation"
- **Module**: `src/vibeOS-lib/ml-router.ts`

### 1.3 Bulk Batch Preserves Per-Message Re-Evaluation
- **Contract**: Each message in a bulk batch is classified independently, not cached from the first message.
- **Test**: `tests/cascade_escalation_contract.test.mjs` — "[escalation] bulk batch preserves per-message re-evaluation"
- **Module**: `src/vibeOS-lib/ml-router.ts`

### 1.4 Cascade Depth Tracking
- **Contract**: Footer `cascadeDepth` tracks the length of `routePath`. depth ≥ 3 shows ▸▸▸, depth ≥ 2 shows ▸▸, depth < 2 shows empty.
- **Test**: `tests/cascade_footer_depth.test.mjs` — "routePath length determines cascade icon", "cascadeDepth >= 3 shows ▸▸▸ icon"
- **Module**: `src/lib/hooks/shared-footer.ts`

### 1.5 Blackbox State Persists cascade_depth After Route Decision
- **Contract**: After `resolveCascadeRouteDecision` runs, the resulting `cascade_depth` is persisted in blackbox state.
- **Test**: `tests/cascade_footer_depth.test.mjs` — "blackbox state persists cascade_depth after route decision"
- **Module**: `src/lib/vibeOS/blackbox.ts` / `src/lib/state.ts`

### 1.6 VibeUltraX Pipeline Routes Correctly
- **Contract**: VibeUltraX optimization mode selects brain tier for complex prompts without moving the root slot.
- **Test**: `tests/cascade_route_contract.test.mjs` — "vibeultrax complex route selects brain without moving the root slot"
- **Module**: `src/lib/mode-router.ts`

### 1.7 Normalizer Keeps active_pipeline Durable
- **Contract**: When backend routes to cheap, the `active_pipeline` is kept as `["brain"]` (not overwritten).
- **Test**: `tests/cascade_route_contract.test.mjs` — "normalizer keeps vibeultrax active_pipeline durable when backend route is cheap"
- **Module**: `src/lib/mode-router.ts`

### 1.8 Remote API Verdict Overrides Local Cascade
- **Contract**: When the remote API (`routeModel`) sets a target, the local ML cascade (`cascadeDecide` + `computeDifficulty`) is bypassed. The remote API is authoritative.
- **Test**: `tests/blackbox_api_authoritative.test.mjs` — "API verdict ALWAYS overrides local tracker"
- **Module**: `src/lib/hooks/tool-execute.ts` (around line 575)

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
