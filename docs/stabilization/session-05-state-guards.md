# VibeOS Stabilization — Session 05: State File Corruption Guard Audit

Date: 2026-05-20
Branch: chore/vibeos-stabilize-session-05-state-guards
Risk: MEDIUM
Status: AUDIT COMPLETE (5 gaps found)

## Scope
Audit all state file read/write paths for safety.

## Findings

### 1. Non-atomic TIERS_FILE writes (7 occurrences)
Seven `writeFileSync(TIERS_FILE, ...)` calls lack atomic rename. A crash during any of these writes corrupts model-tier configuration:
- src/index.js:466 (applySlot)
- src/index.js:3014 (mcp_port write)
- src/index.js:3862 (refresh sync)
- src/index.js:4001 (auto-sync on build)
- src/index.js:4011 (auto-sync fallback)
- src/index.js:4022 (mcp_port default set)
- src/index.js:5848 (rebuild write)

### 2. PROJECT_STATE_FILE without atomic rename
src/index.js:3454 — Has file lock but no atomic rename. Crash corrupts project state.

### 3. flow-enforcer.js uses raw JSON.parse, not safeJsonParse
`src/vibeOS-lib/flow-enforcer.js` reads STATE_FILE (lines 165, 187, 229) and FLOW_DEDUP_FILE (line 122) using raw `JSON.parse()` — no JSONC tolerance, no corruption handling. STATE_FILE write at line 189 also lacks atomic rename.

### 4. No write-side size guards
A runaway mutation could write multi-GB state before the read-side 10MB guard catches it. No size limits on PROJECT_STATE_FILE, REPORTS_INDEX, FLOW_TODO_FILE, or FLOW_DEDUP_FILE.

### 5. Tests operate against real ~/.claude/ state
No sandbox isolation or CUSTOM_PATH override. A buggy test can corrupt user's production state.

## Existing Protections (working correctly)
- `_handleStateCorruption` called at 14 sites (size guard hits + parse failures)
- 10MB read-side size guard for 7 state files
- Atomic rename for STATE_FILE, BLACKBOX_STATE_FILE, PRICING_CACHE_FILE, ACTIVE_JOBS_FILE, GLOBAL_LEARNING_FILE
- All state paths use `join(USER_HOME, ...)` — no hardcoded paths

## Checks
- `npm test`: 362 pass, 0 fail
- `node --check src/index.js`: PASS

## Recommendation
- Convert TIERS_FILE writes to atomic rename (low-risk, 7 sites)
- Convert PROJECT_STATE_FILE write to atomic rename (low-risk)
- Add safeJsonParse to flow-enforcer.js state file reads (low-risk)
- Add write-side size guards to prevent runaway state bloat (medium-risk, needs testing)
