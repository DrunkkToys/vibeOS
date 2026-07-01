# DEEP CASCADE + FEATURE AUDIT REPORT

**Source of truth**: VIBEOS_HOME (`/Users/drunkktoys/Library/Application Support/ai.opencode.desktop/vibeOS`)
**Date**: 2026-07-01
**Model**: opencode/big-pickle (cheap) → opencode-go/deepseek-v4-flash (medium) → opencode-go/mimo-v2.5 (brain)
**Tier routing**: quality mode, delegation enforce=on, flow enforce=on, tdd=strict

---

## 1. CASCADE TEST RESULTS — 165/165 PASS (10 suites)

| Test Suite | Pass | Fail |
|---|---|---|
| cascade_route_contract | 6/6 | 0 |
| cascade_contract_fuzz | 61/61 | 0 |
| cascade_escalation_contract | 2/2 | 0 |
| cascade_footer_depth | 8/8 | 0 |
| cascade_real_e2e | 9/9 | 0 |
| cascade_real_proof | 51/51 | 0 |
| cascade_claim_contract | 11/11 | 0 |
| cascade_audit_writer | 2/2 | 0 |
| test_cascade_real_switch | 9/9 | 0 |
| vibeultrax_subagent_cascade | 6/6 | 0 |
| **TOTAL** | **165/165** | **0** |

## 2. MEGA SUITE TEST RESULTS — 36/36 PASS (10 suites)

mega_01 through mega_10: ALL 100% PASS
- Fresh bootstrap, delegation enforce matrix, state corruption, concurrency
- Footer gauntlet, remote API degraded fallback, blackbox decision engine
- Trinity/flow/TDD enforcers, savings ledger, stress pipeline integration

## 3. DEEP INTEGRATION — 29/30 PASS (1 failure)

**FAIL**: `getOpenCodeHome: ignores vibeOS home context` (`tests/deep_integration.test.mjs:244`)
- Cause: test expects path `join(sandbox, ".opencode")` but actual code returns temp OS path
- Fix needed: make path comparison sandbox-aware or use `realpathSync`

## 4. OTHER TEST SUITES

| Test Suite | Pass | Fail |
|---|---|---|
| test_delegation_enforcer (20 tests, 4 skipped) | 16/16 | 0 |
| user_prompt_escalation_deep_test | All pass | 0 |

## 5. CLAIMS vs REALITY — VIBEOS_HOME VERIFIED

### A) ⚠️ MODEL TIERS MISMATCH (README vs Reality)

- **README claims**: brain=deepseek/deepseek-v4-pro, medium=deepseek/deepseek-v4-flash, cheap=deepseek/deepseek-chat
- **VIBEOS_HOME reality** (`model-tiers.json`): brain=opencode-go/mimo-v2.5, medium=opencode-go/deepseek-v4-flash, cheap=opencode/big-pickle
- **NOTE**: CLAUDE.md documents this as "DEV ONLY: dev machine fallback" — but README presents table as canonical

### B) ⚠️ SAVINGS ARE 99.98% CACHE, NOT DELEGATION

- **README claim**: Delegation savings of $0.026-$0.0308/turn are core feature narrative
- **VIBEOS_HOME** (`delegation-state.json` lifetime totals):
  - Delegation savings: **$0.0001**
  - Cache savings: **$0.455**
  - **Total savings: $0.4551**
  - **Cache = 99.98% of all savings**
- Delegation savings are effectively zero — the narrative is misaligned

### C) 🔴 SESSION METADATA NOT RECORDED

- **VIBEOS_HOME** (`delegation-state.json`): All 30 sessions are **empty strings** (no objects)
- No `tier`, `model`, `provider`, or `regime` data per session
- **Telemetry IS working** (54,040 events, 18 tool types, 3 tier counts, 3 slot counts) — but per-session metadata is lost
- TDD: 871 enforced, 871 skeletons, 660 strict-fail templates
- This is a recording/persistence bug in the delegation state module

### D) 🔶 CV PERSISTENCE — NOW WORKING (previously reported as broken)

- **Earlier CLAUDE.md claim** (line ~280): "No session in blackbox-state.json contains a `cv` field"
- **VIBEOS_HOME reality**: ALL 25+ recent sessions have `cv` objects with:
  - `cascade_depth`, `pipeline_root`, `cascade_root`, `route_path`
  - `optimization_mode`, `mode_root`, `mode_family`
  - `ultrax_*` fields with learned model preferences
- **This has been fixed** since the CLAUDE.md note was written. The note is now stale.

### E) ⚠️ REMOTE API SHORT-CIRCUITS LOCAL CASCADE

- When the remote API (`routeModel`) sets a target, the local ML cascade is **bypassed entirely**
- The local `cascadeDecide()` + `computeDifficulty()` only runs as **fallback**
- Documented in CLAUDE.md as known architecture — but the "107% quality at 58% cost" claim comes from the remote API, not the local code
- The cascade IS working correctly for the fallback path

### F) 🔶 SPEC.md DOES NOT EXIST

- **CLAUDE.md line 63 claim**: "SPEC.md is the formal, test-verified specification of every working feature"
- **REALITY**: No SPEC.md file exists anywhere in this repo
- CLAUDE.md IS the de facto spec

### G) ✅ CASCADE AUDIT IS WORKING

- **VIBEOS_HOME** (`cascade-audit/cascade-audit.jsonl`): **207 entries** logged
- Slot distribution: brain=37, medium=98, cheap=72
- Model distribution: opencode/big-pickle=72, opencode-go/mimo-v2.5=60, test/brain=37, test/medium=37, deepseek/deepseek-v4-flash=1
- Difficulty scoring, escalation, and routing all functioning across tiers
- 710 claim verifications in claim-audit.jsonl

### H) ✅ FOOTER IMPLEMENTATION VERIFIED

- 14/14 footer claims verified against source (`shared-footer.ts:44-303`)
- Tier icons (🧠⚡⟡), regime icons (⌕✎◆⟲▸), savings display, stress gauge, cascade depth icons — all implemented and tested

### I) ✅ SESSION LIFECYCLE WORKING

- cascade_real_proof confirmed: INIT → EXPLORING → REFINING → IMPLEMENTING → CONVERGING → CLOSED
- Loop detection: cycles through 4 intervention levels
- Pivot detection: fires on significant context switch
- ML router: deterministic, reasonable cost decisions

### J) ✅ TDD ENFORCER VERIFIED

- 871 TDD enforcements, 871 skeletons created, 660 strict-fail templates
- 242 follow-up completions, 5 quality templates
- 2,106 reward credits accrued
- 1,270 quality score across 448 evaluations

## 6. WHAT WAS USEFULLY DONE THIS SESSION

- **Ran ALL cascade tests** (10 suites): 165/165 pass ✓
- **Ran ALL mega tests** (10 suites): 36/36 pass ✓
- **Ran deep integration**: 29/30 pass (1 path issue identified)
- **Verified cascade-audit data**: 207 real decisions logged across brain/medium/cheap
- **Verified claim-audit data**: 710 claim verifications
- **Identified 8 claims-vs-reality misalignments** with quantified evidence from VIBEOS_HOME
- **Confirmed CV persistence fix** is now working (previously reported broken — stale documentation)
- **Quantified savings breakdown**: $0.455 cache vs $0.0001 delegation (misaligned narrative)
- **Found session metadata bug**: all 30 sessions are empty strings (data loss)
- **Read and verified README claims** against actual source code and VIBEOS_HOME state
- **Saved full audit** to vibeOS reports system

## 7. RECOMMENDED FIXES (not applied, per AGENTS.md rules — ask user first)

1. **README model tier table** → update to match actual installed models (opencode-go/mimo-v2.5, opencode/big-pickle)
2. **Session metadata recording** → fix delegation-state.json so sessions store tier/model/provider data
3. **SPEC.md claim** → either create SPEC.md or remove the claim from CLAUDE.md
4. **deep_integration line 244** → fix temp path assertion in getOpenCodeHome test
5. **Cascade remote API short-circuit** → document more prominently if it's a known limitation
6. **Savings narrative** → accurately attribute 99.98% of savings to cache, not delegation
7. **CV persistence stale doc** → update CLAUDE.md to reflect that CV persistence IS working now
