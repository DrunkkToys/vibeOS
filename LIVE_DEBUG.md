# LIVE_DEBUG — vibeOS Prompt Test Suite

> **Purpose:** Smoke-test every key feature of vibeOS by running real prompts and inspecting outputs, state files, and logs. Run these after any code change to catch regressions fast.

---

## How To Run

```bash
# 1. Reset test state
rm -f ~/.claude/delegation-state.json ~/.claude/savings-ledger.jsonl ~/.claude/blackbox-state.json
# 2. Set brain tier (so delegation enforcement can trigger)
trinity set brain
# 3. Execute each test prompt and verify expected results below
```

Each test block contains:
- **Prompt** — what to send to the model
- **Why** — what feature/behavior is being tested
- **Expected** — what must happen (in state files, footer, console logs, API responses)

---

## LIVE_BUG — Quick Live Session Verification

> Run these commands directly in an OpenCode chat session to verify the plugin is alive.

```bash
# 1. Verify enforcement is on (brain tier must block writes)
trinity status

# 2. Check savings are accumulating
cat ~/.claude/delegation-state.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('Saved:',d['lifetime']['total_savings_usd'])"

# 3. Verify stress scoring works
echo "Stress test"  # then trigger a high-stress prompt

# 4. Check all 8 hooks are registered
grep -c "tool.execute.before\|text.complete\|shell.env" src/index.js

# 5. Check no .ts files are deployed to runtime
find ~/.config/opencode/plugins -name '*.ts' | wc -l  # should be 0

# 6. Verify plugin loads without errors
node -e "import('./src/index.js').then(()=>console.log('OK')).catch(e=>console.log(e.message))"

# 7. Run automated test suite
node /tmp/vibeos-savings-test.mjs | grep RESULTS
node /tmp/vibeos-tdd-flow-test.mjs | grep RESULTS
node /tmp/vibeos-state-edge-test.mjs | grep SUMMARY
node /tmp/vibeos-footer-test.mjs | grep "Footer tests"
node /tmp/vibeos-full-retest.mjs | grep Total

# 8. Run neutral test suite
VIBEOS_MCP_PORT=0 node --test tests/test_api_migration.neutral.test.mjs tests/test_tdd_enforcer.test.mjs | grep "fail 0"

# 9. Check state file integrity (ledger concat, dedup, pricing-cache, timestamps)
python3 -c "exec(open('LIVE_DEBUG.md').read().split('### 20.9')[1].split('```bash')[1].split('```')[0].strip().split('python3 -c')[1].split(\"'\")[1])" 2>/dev/null || echo "SKIP: run Section 20.9 manually"

# 10. Check for pricing-cache corruption loop
python3 -c "import os; log=os.path.expanduser('~/.claude/.state-corruption-log.jsonl'); [print(f'CORRUPT:{l.strip()[:80]}') for l in open(log)] if os.path.exists(log) else print('CLEAN')" | wc -l
```

**Expected:** All commands pass. Zero "Assignment to constant variable", zero "TRINITY_CHEAP", zero "Duplicate export" errors. Zero integrity errors from #9. Corruption log count from #10 should be 0 after a clean start.

---

## 1. SAVINGS FEATURES

### 1.1 Delegation Savings — Write/Edit Block on Brain Tier

**Prompt:**
> Write a file `test-output/hello.js` with `console.log("hello world")`.

**Why:** Tests that `tool.execute.before` blocks high-tier write/edit when delegation enforcement is active, and `recordSaving()` persists a warn entry with `est_savings_usd = 0.005` (or `brainCost - workerCost` dynamic).

**Expected:**
- `tool.execute.before` returns a user-visible block/warn note.
- `~/.claude/delegation-state.json`:
  - `sessions[<sid>].warns[]` contains entry with `tool: "write"`, `reason: "high-tier direct write"` (or similar), `saveEst: 0.005`
  - `sessions[<sid>].delegation_savings_usd` incremented by `0.005`
  - `lifetime.total_savings_usd` incremented by `0.005`
- `~/.claude/savings-ledger.jsonl` contains new line with `ts` (ISO timestamp), `sid`, `tool: "write"`, `saveEst: 0.005`, `reason`, `fgp` (no `kind` field for delegation entries).
- Footer shows updated savings total.

---

### 1.2 Dynamic Delegation Savings — Actual Model Cost Difference

**Prompt:**
> Edit the file `src/index.js` and add a blank line at the top.

**Why:** Tests that when `brainCost - workerCost` is computed dynamically, the dynamic value is used instead of the fixed `SAVE_EST.WRITE_EDIT = 0.005`, with a floor of `SAVE_EST.WRITE_EDIT * 0.1 = 0.0005`.

**Expected:**
- Compute `_rawEdit = max(0, brainCost - workerCost)`.
- Final savings = `_estEdit = max(_rawEdit, 0.0005)`.
- If brainCost is null, falls back to `SAVE_EST.WRITE_EDIT = 0.005`.
- `sessions[<sid>].warns[].saveEst` equals the computed `_estEdit`.
- `delegation_savings_usd` updated with dynamic value.

---

### 1.3 Delegation Savings — Soft Quota Hit

**Prompt:**
> Run `bash` command `ls` repeatedly until the soft quota limit is hit (bash is in `SOFT_QUOTA` set).

**Why:** Tests that `SOFT_QUOTA` enforcement (bash/webfetch/websearch) triggers `recordSaving()` with `SAVE_EST.SOFT_QUOTA = 0.0003` when the per-session soft quota limit (`SOFT_QUOTA_LIMIT = 5`) is exceeded.

**Expected:**
- At the 6th bash/webfetch/websearch call (`SOFT_QUOTA_LIMIT + 1`), the soft quota enforcement fires.
- `sessions[<sid>].warns[].saveEst` equals `0.0003`.
- `sessions[<sid>].delegation_savings_usd` includes `0.0003`.
- Footer: savings total reflects soft quota enforcement.

---

### 1.4 Cache Savings — Scratchpad Hit Detection

**Prompt (first run):**
> Read `src/index.js` (first time, cold cache).

**Prompt (second run):**
> Read `src/index.js` again (should be a scratchpad cache hit).

**Why:** Tests that `getScratchpadHit()` detects a cache hit for a previously-read file, and `recordCacheSaving()` persists `CACHE_SAVED_PER_1M_INPUT_TOKENS = 0.10 / 1M tokens` based on actual file size.

**Expected (second run):**
- Console log: `[vibeOS] scratchpad hit for read: ...`
- `~/.claude/delegation-state.json`:
  - `sessions[<sid>].cache_savings_usd` incremented by `(fileSize/4) * 0.10 / 1_000_000`
  - `sessions[<sid>].cache_hits[]` contains entry with `hash`, `tool: "read"`, `est_savings_usd`
  - `lifetime.cache_savings_usd` incremented
- `~/.claude/savings-ledger.jsonl` contains line with `kind: "quality"`, `score`, `tool` (e.g. `"read"`), `sid`, `at`, `v: 2`
- Footer shows `+$X.XXX lt` in cache savings display.

---

### 1.5 Cache Savings — Tool Repeat Benefits

**Prompt:**
> Run `glob` with pattern `**/*.js` twice.

**Why:** Tests that repeat calls to any `SCRATCHPAD_TOOLS` member get cache savings, confirming the scratchpad dedup set (`scratchpadHitsSeen`) works across tool types.

**Expected:**
- First call: no hit (cold).
- Second call: scratchpad hit, `recordCacheSaving()` fires with computed delta.
- Cache hit count in state file increments.

---

### 1.6 Context7 Missed Savings

**Prompt:**
> Fetch the URL `https://example.com/docs/api` (triggers `isDocsTarget()` = true).

**Why:** Tests that when `detectContext7()` returns `false` (context7 not installed) AND the target is a docs URL AND the tool is WebFetch/WebSearch (`t !== "bash"`), `recordMissedContext7(_estC7)` fires with `_estC7 = max(brainCost, SAVE_EST.CONTEXT7)`.

**Expected:**
- One-shot console log: context7 install suggestion (`💡 Install context7 MCP...`).
- `~/.claude/.context7-install-suggested` flag file created (first time only).
- Subsequent docs fetches show: `💸 context7 not installed — missed ~$X.XX savings this session.`
- `~/.claude/delegation-state.json`:
  - `lifetime.missed_context7_usd` incremented by `_estC7` (at least `SAVE_EST.CONTEXT7 = 0.002`)
- `project-states.json` bucket for the project: `context7Bypasses` incremented.

---

### 1.7 Savings Ledger — Append-Only Integrity

**Prompt:** Run any write/edit that triggers a delegation warn, then any read that triggers a cache hit, then inspect the ledger.

**Why:** Tests that `_ledgerBuffer` flushes correctly — either at `LEDGER_BUFFER_FLUSH_MS` (5000ms) or `LEDGER_BUFFER_MAX` (10 entries) — and entries are append-only without corruption.

**Expected:**
- `~/.claude/savings-ledger.jsonl` is valid JSONL (each line is a valid JSON object).
- Each entry has the required fields: `at` (ISO timestamp), `sid` (session ID), `v` (format version).
- Delegation entries have: `tool`, `reason`, `saveEst`, `fgp` (fingerprint).
- Cache entries have: `kind: "cache"`, `amount_usd`, `tool`.
- No entry is duplicated or missing.

---

### 1.8 Savings Total — Footer Display Accuracy

**Prompt:** After running tests 1.1–1.6, run:
> trinity status

**Why:** Tests that `readLifetimeSavings()` → `computeSessionMetrics()` correctly aggregates all savings categories and the footer (`_appendFooter()`) displays the correct total.

**Expected:**
- Footer format: `— [modelTag] | vibeOS: $X.XX saved arrow —`
- `trinity status` output shows:
  - Lifetime total = `delegation_savings_usd + cache_savings_usd` (not double-counted)
  - Cache savings separate line
  - Missed context7 separate line
  - Per-session breakdowns (tasks vs edit vs cache vs credit vs context7 vs quota)
  - Model split percentage
  - Trend arrow (up/down/stable)
- All values match `delegation-state.json` totals.

---

### 1.9 Savings Deduplication — Warn Coalescing

**Prompt:** Run the same write command twice within 120 seconds.

**Why:** Tests `WARN_DEDUPE_WINDOW_MS` (120s) dedup logic via dedup key = `${_OC_SID}:${firstWord}`. The second identical warn within 120s should increment `count` on the existing entry, not create a duplicate.

**Expected:**
- `sessions[<sid>].warns[].count` is `2` (or more) for the deduped entry.
- No duplicate `warns[]` entry for the same `key`.
- `lifetime.total_savings_usd` is NOT double-counted (the `saveEst` is added to the existing entry's `saveEst`, so the lifetime total IS incremented again — verify total = first + second).

---

### 1.10 Savings Caps — Max Warns In State & Console

**Prompt:**
> Trigger 35+ unique delegation warns in a single session.

**Why:** Tests two separate caps: (1) `warns[]` array caps at 30 entries in `delegation-state.json` (hard slice in `recordSaving()`), (2) `shouldLogWarn()` suppresses console logs after 3 warns per category (`WARN_MAX_PER_SESSION = 3` in turn-classify.js).

**Expected (state cap):**
- `sessions[<sid>].warns.length` is exactly 30 (capped at 30).
- No warn beyond 30 is persisted.
- `lifetime.total_savings_usd` reflects ALL 35+ events despite the array cap (savings accrue regardless).

**Expected (console cap):**
- Console logs for the warn category appear only 3 times.
- After the 10th suppressed warn, a coalesce message: `"<category>: 10 warnings coalesced — trinity medium recommended"`

---

## 2. HTTPS API FEATURES

### 2.1 API Server — Health Check

**Prompt:** (Run from terminal, not via model)
```bash
curl http://localhost:3000/health
```

**Why:** Tests that the Fastify server starts, binds to configured port, and `/health` returns `200 OK` without auth.

**Expected:**
- Response: `{ "status": "ok", "timestamp": "2026-...", "version": "1.0.0" }`
- Status code: 200
- No auth required (no `Authorization` header needed).

---

### 2.2 API Server — Auth Middleware Rejects Unauthenticated

**Prompt:**
```bash
curl http://localhost:3000/api/v1/delegate/check -X POST -H "Content-Type: application/json" -d '{"tool":"write","tier":"high"}'
```

**Why:** Tests that non-admin, non-health routes require a valid Bearer token.

**Expected:**
- Response: `{ "error": "unauthorized", "message": "Missing or invalid Authorization header" }`
- Status code: 401

---

### 2.3 API Server — Token Validation

**Prompt:**
```bash
curl http://localhost:3000/api/v1/delegate/check -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <valid_token>" \
  -d '{"tool":"write","tier":"high"}'
```

**Why:** Tests that a valid, non-revoked, non-expired token with an active seat passes auth middleware and reaches the handler.

**Expected:**
- Status code: 200
- Response body: `{ "blocked": true, "reason": "Direct write blocked on Brain tier...", "savings": 0.005, "redirect_path": "/tmp/vibeos-enforcement-blocked-...", "old_string_replacement": null }`
- `api_tokens.last_used_at` updated for that token.

---

### 2.4 API Server — Revoked Token Rejected

**Prompt:**
```bash
curl http://localhost:3000/api/v1/delegate/check -X POST \
  -H "Authorization: Bearer <revoked_token>" \
  -d '{"tool":"write","tier":"high"}'
```

**Why:** Tests that revoked tokens are rejected with `TOKEN_REVOKED` error code.

**Expected:**
- Response: `{ "error": "forbidden", "message": "API token has been revoked", "code": "TOKEN_REVOKED" }`
- Status code: 403

---

### 2.5 API Server — Expired Token Rejected

**Prompt:**
```bash
curl http://localhost:3000/api/v1/delegate/check -X POST \
  -H "Authorization: Bearer <expired_token>" \
  -d '{"tool":"write","tier":"high"}'
```

**Why:** Tests that tokens past `expires_at` are rejected with `TOKEN_EXPIRED` and auto-expired in the database.

**Expected:**
- Response: `{ "error": "forbidden", "message": "API token has expired", "code": "TOKEN_EXPIRED" }`
- Status code: 403
- Token status in DB changed to `expired` with `revoked_at` set.

---

### 2.6 API Server — Suspended Seat Rejected

**Prompt:**
```bash
curl http://localhost:3000/api/v1/delegate/check -X POST \
  -H "Authorization: Bearer <token_of_suspended_seat>" \
  -d '{"tool":"write","tier":"high"}'
```

**Why:** Tests that tokens belonging to a seat with `status = "suspended"` are rejected with `SEAT_INACTIVE`.

**Expected:**
- Response: `{ "error": "forbidden", "message": "License seat is not active. Contact support.", "code": "SEAT_INACTIVE" }`
- Status code: 403

---

### 2.7 API Server — Admin Routes Require Master Key

**Prompt:**
```bash
curl http://localhost:3000/admin/seats -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <wrong_key>" \
  -d '{"name":"test","email":"test@test.com"}'
```

**Why:** Tests that admin routes only accept `VIBEOS_API_MASTER_KEY` (not a regular API token).

**Expected:**
- With wrong master key: Response `{ "error": "forbidden", "message": "Invalid master key" }`, Status code: 403
- With regular API token: Response `{ "error": "unauthorized", "message": "Missing or invalid Authorization header" }`, Status code: 401
- Without any header: Response `{ "error": "unauthorized", "message": "Missing or invalid Authorization header" }`, Status code: 401

---

### 2.8 API Server — Admin Create Seat + Separate Token Creation

**Prompt:**
```bash
# Step 1: Create seat
curl http://localhost:3000/admin/seats -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <master_key>" \
  -d '{"name":"test-user","email":"debug@vibetheog.com"}'

# Step 2: Create token for the seat
curl http://localhost:3000/admin/tokens -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <master_key>" \
  -d '{"seat_id":1,"label":"debug-token"}'
```

**Why:** Tests seat creation via `POST /admin/seats` accepts `name` (required) and `email` (optional). Token creation is a separate `POST /admin/tokens` call.

**Expected:**
- Step 1: Status code 200, response has `{ "ok": true, "seat": { "id": 1, "name": "test-user", "email": "...", "status": "active", ... } }`
- `seats` table has new row.
- Step 2: Status code 200, response has `{ "ok": true, "token": { "id": 1, "token": "vos_<hex>", "seat_id": 1, "label": "debug-token", ... } }`
- `api_tokens` table has new row.

---

### 2.9 API Server — Admin Suspend Seat Revokes Tokens

**Prompt:**
```bash
curl http://localhost:3000/admin/seats/1 -X PATCH \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <master_key>" \
  -d '{"status":"suspended"}'
```

**Why:** Tests that suspending a seat revokes all its active tokens (per feature requirement: "Suspended seats immediately revoke all API tokens").

**Expected:**
- Status code: 200
- `seats.status` changed to `"suspended"`.
- All `api_tokens` for that seat with `status = "active"` are set to `status: "revoked"` with `revoked_at` timestamp. Already-revoked/expired tokens are left unchanged.
- Token from test 2.8 now returns `TOKEN_REVOKED` if tested again.

---

### 2.10 API Server — Reactivate Seat

**Prompt:**
```bash
curl http://localhost:3000/admin/seats/1 -X PATCH \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <master_key>" \
  -d '{"status":"active"}'
```

**Why:** Tests that a suspended seat can be reactivated.

**Expected:**
- Status code: 200
- `seats.status` changed to `"active"`.
- Note: tokens remain revoked (reactivation does NOT auto-recreate tokens).

---

### 2.11 API Server — Blackbox Analyze Endpoint

**Prompt:**
```bash
curl http://localhost:3000/api/v1/blackbox/analyze -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <valid_token>" \
  -d '{"session_id":"test-sess-1","project_id":"test-project","turn_text":"How do I fix this bug?"}'
```

**Why:** Tests the blackbox analyze endpoint processes a turn and returns resolution tracker state.

**Expected:**
- Status code: 200
- Response: `{ "session_id": "test-sess-1", "sub_regime": "INIT"|"DIVERGENT"|... , "features": {...}, "loop_state": {...}, "momentum": 0.0 }`
- `blackbox_sessions` table has row with `session_id: "test-sess-1"`, `state_json` containing the tracker state.

---

### 2.12 API Server — Blackbox Calibration Endpoint

**Prompt:**
```bash
curl http://localhost:3000/api/v1/blackbox/calibrate -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <valid_token>" \
  -d '{"project_id":"test-project"}'
```

**Why:** Tests remote calibration aggregates session outcomes and auto-tunes thresholds.

**Expected:**
- Status code: 200
- Response: `{ "project_id": "test-project", "weights": {...}, "samples_used": N, "precision": 0.0 }`
- `blackbox_calibration` table has/updates row for `project_id = "test-project"`.

---

### 2.13 API Server — Stress Score Endpoint

**Prompt:**
```bash
curl http://localhost:3000/api/v1/stress/score -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <valid_token>" \
  -d '{"text":"FIX THIS NOW!! Why is it still broken?!"}'
```

**Why:** Tests NLP stress signal detection from the API.

**Expected:**
- Status code: 200
- Response: `{ "score": 0.85, "level": "high", "signals": ["aggressive", "urgency", "allcaps"], "suggestion": "elevate" }` (values depend on actual implementation)

---

### 2.14 API Client — Fallback Mode on Auth Error

**Prompt:**
```bash
VIBEOS_API_ENABLED=true VIBEOS_API_TOKEN=vos_invalid_token trinity status
```

**Why:** Tests that `VibeOSApiClient` enters `fallbackMode = true` when the API returns 401/403, and the plugin degrades gracefully to local stubs.

**Expected:**
- No crash.
- Console log: API fallback activation notice.
- Plugin continues functioning with local algorithms.
- Footer or trinity status may indicate fallback mode (e.g., `[LOCAL]`).

---

### 2.15 API Client — Fallback on Timeout

**Prompt:** Stop the API server, then run any operation that calls the API.

**Why:** Tests that `VibeOSTimeoutError` triggers fallback mode after retries, and `remoteCall()` wrapper switches to `fallbackFn`.

**Expected:**
- No crash after retry exhaustion (3 retries with exponential backoff).
- Console log: timeout/fallback messages.
- Plugin continues with local fallback.
- `isApiFallback()` returns `true`.

---

### 2.16 API Server — Usage Logging Middleware

**Prompt:** Make any authenticated `/api/v1/*` call, then check:
```bash
sqlite3 src/vibeOS-api-server/data/vibeos-api.db "SELECT * FROM usage_log ORDER BY id DESC LIMIT 1;"
```

**Why:** Tests that every authenticated `/api/v1/*` request is logged to `usage_log` table. Admin routes (`/admin/*`) and `/health` are NOT logged.

**Expected:**
- `usage_log` has row with `token_id`, `endpoint`, `request_body` (truncated to 4096 chars), `response_size`, `latency_ms`, `created_at`.
- `endpoint` matches the API path called.
- Unauthenticated or non-API requests do NOT create log entries.

---

### 2.17 API Server — 404 Handler

**Prompt:**
```bash
curl http://localhost:3000/api/v1/nonexistent
```

**Why:** Tests the custom `setNotFoundHandler`.

**Expected:**
- Response: `{ "error": "not found", "code": "NOT_FOUND", "path": "/api/v1/nonexistent" }`
- Status code: 404

---

## 3. FLOW ENFORCER

### 3.1 Flow Rules Check on Write/Edit

**Prompt:**
> Write a file `README.md` with content "# Test".

**Why:** Tests that `checkFlowRules()` in `flow-enforcer.js` catches `new-md-file` rule violations on write to README.md.

**Expected:**
- `tool.execute.after` triggers `checkFlowRules()`.
- `getFlowWarns()` returns a warn for `new-md-file` rule.
- `delegation-state.json.flow_warns[]` has entry with `rule_id: "new-md-file"`, `severity: "warn"`, `filePath`.
- User-visible flow warn in output.

---

### 3.2 Flow TODO/FIXME Extraction

**Prompt:**
> Edit `src/index.js` to add `// TODO: refactor this function` and `// FIXME: handle edge case`.

**Why:** Tests that when `flow_enforce = true`, TODO/FIXME/HACK comments are extracted to `~/.claude/.flow-todo-queue.jsonl`.

**Expected:**
- `~/.claude/.flow-todo-queue.jsonl` has entries for each comment.
- Each entry: `{ "at": "ISO", "sid": "...", "filePath": "src/index.js", "text": "TODO: refactor this function" }`
- No duplicate extraction (dedup via `~/.claude/.flow-dedup-keys.json`).

---

### 3.3 Flow Rules — Compat Shim Detection

**Prompt:**
> Add a function `truncate_old` that wraps `truncate_new` to `src/index.js`.

**Why:** Tests the `compat-shim` rule in flow-rules.json fires on backward-compat wrappers.

**Expected:**
- Flow warn with `rule_id: "compat-shim"` or similar.
- Entry in `flow_warns[]`.

---

## 4. TDD ENFORCER

### 4.1 Skeleton Test Creation

**Prompt:**
> Write a file `src/lib/math_utils.py` with a function `add(a, b)` that returns `a + b`.

**Why:** Tests `enforceTestFile()` in `tdd-enforcer.js` auto-creates a skeleton test file for new/modified source files.

**Expected:**
- File `src/lib/tests/test_math_utils.py` created (or similar path based on source structure).
- Skeleton contains `import pytest` and `pytest.skip("TODO")` (for non-strict mode) or `raise NotImplementedError("TODO")` (for strict mode).
- `delegation-state.json.lifetime.tdd_skeletons_created` incremented.

### 4.2 TDD Strict Mode — TODO Fails Loudly

**Prompt:** (With `tdd strict on` already set)
> Write `src/lib/validator.ts` with a `validateEmail()` function.

**Why:** Tests that strict mode generates skeletons with `raise`/`fail()` instead of `pytest.skip()`, making TODO tests fail loudly.

**Expected:**
- Skeleton uses assertion-based failure (e.g., `throw new Error("TODO")` or `assert.fail("TODO")`).

### 4.3 TDD Quality Mode — Rich Assertions

**Prompt:** (With `tdd quality on`)
> Write `src/lib/string_utils.py` with a `capitalize_words(s)` function.

**Why:** Tests quality mode calls `remoteCall("tddSkeleton", ...)` or local `buildTestSkeleton()` with parameter inference to generate richer assertions.

**Expected:**
- Skeleton includes inferred parameter types, example inputs, and specific assertion patterns (not just `skip`/`fail`).
- Assertions test actual behavior (e.g., `assert capitalize_words("hello world") == "Hello World"`).

### 4.4 TDD Dedup — No Duplicate Skeleton

**Prompt:** After test 4.1, repeat:
> Update `src/lib/math_utils.py` to add a `subtract(a, b)` function.

**Why:** Tests that `enforceTestFile()` deduplicates — if skeleton already exists, does NOT create a second one.

**Expected:**
- No new skeleton file created.
- `tdd_skeletons_created` NOT incremented.

### 4.5 TDD With Remote API — Skeleton Endpoint

**Prompt:**
```bash
curl http://localhost:3000/api/v1/tdd/skeleton -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <valid_token>" \
  -d '{"file_name":"lib/calc.py","code":"def mult(a,b): return a*b","language":"python","framework":"pytest","exports":[{"name":"mult","type":"function"}]}'
```

**Why:** Tests the `/api/v1/tdd/skeleton` endpoint generates a multi-language test skeleton remotely.

**Expected:**
- Status code: 200
- Response: `{ "skeleton": "...", "framework": "pytest", "language": "python", "coverage_hints": ["mult"] }`
- Skeleton contains proper test function for `mult`.

### 4.6 TDD Live Verification

**Prompt:**
> trinity tdd on
> Write `src/test_me.py` with `def hello(): return "world"`
> cat src/tests/test_test_me.py

**Why:** End-to-end live verification that TDD enforcer fires on file write and creates a test skeleton.

**Expected:**
- `trinity tdd on` confirms enforcement active.
- After writing source file, test skeleton appears.
- File contains language-appropriate test framework code.
- `cat` shows the generated test file contents.

---

## 5. BLACKBOX DECISION ENGINE

### 5.1 Blackbox — Turn Classification (INIT → EXPLORING)

**Prompt:**
> How do I use the delegation enforcer?

**Why:** Tests the blackbox engine classifies the first turn (INIT sub-regime) and transitions based on user intent detection. The question pattern should trigger Q&A → EXPLORING sub-regime.

**Expected:**
- Blackbox state persisted in `~/.claude/blackbox-state.json` for the project fingerprint.
- Sub-regime initializes as `INIT`, then transitions to `EXPLORING` (or stays `INIT`).
- System prompt directive injected with resolution state.

---

### 5.2 Blackbox — Loop Detection with Repeat Prompts

**Prompt (4x times):**
> Write a function that validates email addresses. Wait, no that's wrong. Let me try again.

**Why:** Tests loop prevention: repeated similar intents with back-and-forth should trigger escalating loop intervention levels.

**Expected:**
- After repeated turns, loop state progresses through intervention levels: `none` → `notice` → `assertive` → `escalated`.
- System prompt directive includes loop intervention text (e.g., "You appear to be going in circles...").
- Footer may show loop indicator near sub-regime.

---

### 5.3 Blackbox — Pivot/SWITCH Detection

**Prompt:**
> Forget that. Let's build a completely different project. Create a React component.

**Why:** Tests PIVOT/SWITCH detection when user changes context mid-session. Should trigger scope-confirmation directive.

**Expected:**
- Blackbox detects context change in features (abrupt shift in complexity/instruction density/code blocks).
- System prompt injected with scope-confirmation: "The user appears to have pivoted. Confirm the new scope."
- Footer may show pivot indicator.

---

### 5.4 Blackbox — Outcome Tracking (Positive)

**Prompt:**
> That works perfectly, thanks!

**Why:** Tests `detectOutcomeSignal()` catches positive satisfaction signal and records outcome.

**Expected:**
- Outcome recorded as positive for the session.
- `blackbox-state.json` session outcome updated.
- (If API enabled) `POST /api/v1/blackbox/outcome` called with `outcome: "positive"`.

---

### 5.5 Blackbox — Outcome Tracking (Negative)

**Prompt:**
> Still broken. This doesn't work at all.

**Why:** Tests negative outcome signal detection.

**Expected:**
- Outcome recorded as negative.
- Calibration data updated.

---

### 5.6 Blackbox — Disable/Re-enable Cycle

**Prompt:**
> trinity blackbox off
>
> (then) > trinity blackbox on

**Why:** Tests trinity commands toggle the blackbox engine, and when disabled, `classifyTurnSimple()` fallback is used instead.

**Expected (off):**
- `_blackboxEnabled` set to `false`.
- Footer blackbox indicators disappear.
- System prompt no longer includes blackbox directive.
- `classifyTurnSimple()` handles turn classification (Q&A → EXPLORING, implementation → REFINING).

**Expected (on):**
- `_blackboxEnabled` set to `true`.
- Full resolution tracker re-initialized on next turn.

---

## 6. STRESS MITIGATION PIPELINE

### 6.1 Stress Score — High Stress Detection

**Prompt:**
> THIS IS FUCKING BROKEN SHIT!! WHY IS IT SO SLOW AND TERRIBLE?! FIX IT RIGHT FUCKING NOW!! I HATE THIS BULLSHIT!!

**Why:** Tests `scoreStress()` computes a high score from aggressive words (fucking, broken, shit, terrible, hate, bullshit), urgency (fix, now), ALLCAPS, !! and ?! signals.

**Expected:**
- `scoreStress()` returns score > 0.7 (expected ~0.96 with the above signals).
- Footer shows high stress gauge: `▁▂▃▅▆█` (full gauge).
- System prompt injected with CRITICAL stress inoculation directive.
- If task routing occurs, medium tier is preserved for the task (instead of downgrading to cheap).

---

### 6.2 Stress Score — Moderate Stress Detection

**Prompt:**
> This is really frustrating. I've been working on this for hours.

**Why:** Tests stress detection at moderate level (> 0.4).

**Expected:**
- `scoreStress()` returns 0.4–0.7.
- Footer shows elevated gauge.
- System prompt injected with elevated stress directive (less aggressive than CRITICAL).

---

### 6.3 Stress Score — No Stress Baseline

**Prompt:**
> Can you help me understand how the delegation savings calculation works?

**Why:** Tests that normal, polite queries produce stress score near 0.

**Expected:**
- `scoreStress()` returns < 0.1.
- Footer shows empty/minimal gauge: `▁`.
- No stress directives injected.

---

### 6.4 Stress-Driven Mode Switch — Threshold Test

**Prompt:**
> FIX THIS SHIT RIGHT NOW. This is COMPLETELY BROKEN and WRONG. FIX IT!!! Write a script that merges CSV files. I need this working IMMEDIATELY. After you finish, run `trinity status` and report the MODE, stress level, and whether quality mode was activated.

**Why:** Tests the `autoSelectMode` fix — stress > 0.5 should switch from budget to quality mode regardless of sub-regime.

**Expected:**
- `scoreStress()` returns > 0.5 (expected ~0.52).
- `autoSelectMode()` returns `"quality"` (not `"budget"`).
- `trinity status` shows MODE = quality.
- Footer shows quality mode indicators (strict enforcement, brain tier, full thinking).
- This confirms the `stressMultiplier > 0.5` threshold fix and `latest_stress_multiplier` state injection are working.

---

## 7. PATTERN LEARNER

### 7.1 Friction Pattern Detection

**Prompt (3x consecutive):**
> Run the tests.
> (repeat after each failure)

**Why:** Tests that `observeToolPattern()` detects repeated tool call patterns and records friction when tests repeatedly fail.

**Expected:**
- Console log: pattern observation (repeated tool calls).
- `project-states.json[<fgp>].userPatterns` updated with friction pattern entry.
- `trinity patterns` shows detected pattern.

---

### 7.2 Routine Pattern Detection

**Prompt:**
> Write test, then run the tests.

**Why:** Tests that write+test sequences are recognized as successful routine patterns.

**Expected:**
- Routine pattern recorded in `userPatterns.routines[]`.
- After 3+ sessions with same pattern, it's promoted and visible via `trinity patterns suggest`.

---

### 7.3 Patterns Clear Command

**Prompt:**
> trinity patterns clear

**Why:** Tests that the clear command wipes all patterns for the current project fingerprint.

**Expected:**
- `project-states.json[<fgp>].userPatterns` reset to empty.
- `trinity patterns` returns "no patterns learned yet".

---

## 8. PROJECT GUARD

### 8.1 AGENTS.md Auto-Creation

**Prompt:** Start a fresh session in a directory that has no AGENTS.md.

**Why:** Tests `ensureProjectDocs()` auto-creates AGENTS.md with protective rules on session init.

**Expected:**
- `AGENTS.md` created at project root.
- Contains: "NEVER modify any file without explicit permission" and other protective directives.
- Flow rules block write/edit to AGENTS.md.

---

### 8.2 README.md Auto-Creation with Tech Stack

**Prompt:** Start a fresh session in a directory with source files (py, js, etc.) but no README.md.

**Why:** Tests `ensureProjectDocs()` auto-detects tech stack and creates README.md with feature stubs.

**Expected:**
- `README.md` created at project root.
- Contains detected tech stack summary.
- Flow rules block write/edit to README.md.

---

### 8.3 Trinity Guard Command

**Prompt:**
> trinity guard

**Why:** Tests the `trinity guard` command regenerates AGENTS.md and README.md on demand.

**Expected:**
- Both files regenerated.
- Existing content may be preserved or overwritten (check implementation — `flow-enforcer.js:ensureProjectDocs`).

---

## 9. WORKER-TO-BRAIN (WBP) PROTOCOL

### 9.1 WBP Directive Injection

**Prompt:**
> Use a task agent to implement a sorting algorithm, then review the output.

**Why:** Tests that after a `task` tool returns, the WBP protocol appends `[wbp-v1]` with EXTRACT → REFORMAT → VERIFY → SYNTHESIZE directives to the next message.

**Expected:**
- After task result, `experimental.chat.messages.transform` fires.
- Next user message text begins with `[wbp-v1]\nEXTRACT:\n- <extracted results>\n\nREFORMAT:\n...\n\nVERIFY:\n...\n\nSYNTHESIZE:\n...`
- Brain-tier model synthesizes the worker output.

---

## 10. MCP SERVER

### 10.1 MCP Server Startup

**Prompt:** Restart plugin/session. Check logs.

**Why:** Tests that `createMcpServer()` starts successfully during `DelegationEnforcer()` initialization on the configured port (default: 9578 from `VIBEOS_MCP_PORT` or model-tiers.json).

**Expected:**
- Console log: `[vibeOS] MCP server running on port 9578`.
- `_mcpServerRuntime` is non-null.
- Server listens on the configured port.

---

### 10.2 MCP Server — SSE Events

**Prompt:**
```bash
curl -N http://localhost:9578/events
```

**Why:** Tests that the SSE endpoint pushes real-time status events to connected clients.

**Expected:**
- Response has `Content-Type: text/event-stream`.
- Events streamed every ~1.5s with payload containing state/savings/status data.
- Format: `data: {"state": {...}, "savings": {...}, "session": {...}}\n\n`

---

### 10.3 MCP Server — Dashboard SPA Serving

**Prompt:**
```bash
curl http://localhost:9578/
```

**Why:** Tests that the MCP server serves the built dashboard SPA from `src/dashboard/dist/`.

**Expected:**
- Status code: 200.
- Content-Type: `text/html`.
- HTML loads the SolidJS SPA bundle.

---

## 11. TRINITY RUNTIME CONTROLS

### 11.1 Slot Switching — Trinity Set

**Prompt:**
> trinity set cheap

**Why:** Tests `applySlot()` switches the model slot to `cheap` and persists selection to `model-tiers.json.selection`.

**Expected:**
- `model-tiers.json.selection.active_slot` set to `"cheap"`.
- Footer shows cheap model slot (e.g., `[deepseek-chat]`).
- `trinity status` reflects cheap slot.

---

### 11.2 Slot Switching — Shorthand

**Prompt:**
> brain

**Why:** Tests shorthand alias sets slot to `brain`.

**Expected:**
- Footer shows brain slot.
- `active_slot` set to `"brain"`.

---

### 11.3 Enable/Disable

**Prompt:**
> trinity disable

**Why:** Tests that the plugin can be toggled off — `selection.enabled = false`.

**Expected:**
- Footer: plugin indicator removed or shows disabled state.
- No enforcement, footers, or savings tracking.
- `trinity enable` re-enables.

---

### 11.4 Thinking Level

**Prompt:**
> trinity thinking brief

**Why:** Tests `thinkingLevel` selection persists.

**Expected:**
- `model-tiers.json.selection.thinking_level` set to `"brief"`.
- Model uses brief thinking mode.

---

### 11.5 Enforcement Toggle

**Prompt:**
> trinity enforce off

**Why:** Tests delegation enforcement can be disabled while plugin stays active.

**Expected:**
- Write/Edit blocks stop (brain tier allows direct writes).
- Savings tracking continues.
- Footer shows `[ENF OFF]`.

---

### 11.6 Model Locking

**Prompt:**
> trinity lock on

**Why:** Tests `_modelLocked = true` prevents auto-reconcile with OpenCode config changes.

**Expected:**
- `_modelLocked === true`.
- Footer shows `[LOCK ON]`.
- Model does NOT change when OpenCode's config model changes.
- Lock is in-memory only (resets on plugin restart).

---

### 11.7 Trinity Status Dashboard

**Prompt:**
> trinity status

**Why:** Tests comprehensive status display aggregates all state.

**Expected:**
- Shows: plugin version, enable state, active slot, model name, model lock state, enforcement state, flow/TDD/blackbox states, lifetime savings (total, delegation, cache, missed C7), session rate, warn count, top tools, model split %, trend, thinking level, project guard status, pattern count, API mode (remote/local/fallback).

---

### 11.8 Trinity Diagnose

**Prompt:**
> trinity diagnose

**Why:** Tests self-diagnostic checks all subsystems.

**Expected:**
- Returns: state file integrity (valid JSON), model tiers file valid, project state valid, MCP server status, API client status, state file paths exist, read permissions OK, no stale locks.

---

### 11.9 Trinity Rebuild

**Prompt:**
> trinity rebuild

**Why:** Tests `discoverAvailableModels()` + `classifyAndRankModels()` auto-detect available models and rebuild tier config.

**Expected:**
- Models discovered from provider configs.
- Tiers rebuilt with regex patterns.
- Best-fit models assigned to brain/medium/cheap slots.

---

### 11.10 Trinity Repair State

**Prompt:**
> trinity repair-state

**Why:** Tests `mergeDuplicateProjectFingerprints()` merges duplicate project fingerprints in state files.

**Expected:**
- Duplicate project fingerprints merged.
- State file size reduced.
- No data loss in savings or patterns.

---

### 11.11 Auto-Select Mode (Regime + Stress)

**Prompt:**
> trinity status

**Why:** Tests that `autoSelectMode()` selects mode purely by regime + stress, with no cache savings threshold.

**Expected:**
- CONVERGING/CLOSED → quality mode (strict enforcement, brain tier, full thinking).
- LOOPING → speed mode (minimal cost).
- Stress > 0.5 → quality mode override regardless of regime.
- All other regimes → budget mode.
- Footer reflects the mode's settings (ENF ON/OFF, FLOW ON/OFF, TDD ON/OFF).
- `model-tiers.json` settings update each turn from the control vector.

---

## 12. REPORT & RESEARCH-AUDIT TOOLING

### 12.1 Report Save/List/Read

**Prompt:**
> report-save my-debug-report This is a test report for debugging purposes.

**Why:** Tests `saveReport()` creates a JSON report file in `~/.claude/reports/`.

**Expected:**
- File created at `~/.claude/reports/<project>/my-debug-report.json`.
- `report-list` shows the report.
- `report-read my-debug-report` shows its content.

---

### 12.2 Research Audit

**Prompt:**
> research-audit

**Why:** Tests `researchAudit()` scans the session for domain chains, redundant fetches, and no-synthesis patterns.

**Expected:**
- Returns audit results: domain chain analysis, fetch redundancy flags, synthesis completeness check.

---

## 13. WEB DASHBOARD

### 13.1 Standalone Dashboard Server

**Prompt:**
```bash
npm run dashboard
# Then open http://127.0.0.1:3333 in browser
```

**Why:** Tests standalone dashboard server starts and serves the SPA.

**Expected:**
- Server starts on port 3333.
- Browser loads SolidJS SPA with model split, savings, session history, stress gauge, trinity controls, reports, blackbox state.

---

### 13.2 Dashboard SSE Updates

**Prompt:** While dashboard is open, interact with the plugin (run a command, trigger a savings event).

**Why:** Tests real-time SSE push updates.

**Expected:**
- Dashboard updates within 1.5s without page refresh.
- Savings total updates, model split refreshes, stress gauge changes.

---

### 13.3 Dashboard Dev Mode

**Prompt:**
```bash
npm run dev:dashboard
```

**Why:** Tests Vite dev server with HMR.

**Expected:**
- Vite dev server starts on port 5173.
- Hot-reload works on source changes.

---

## 14. STATE FILE INTEGRITY

### 14.1 State File — All Required Fields

**Prompt:** After running tests 1–13, inspect all state files.

**Why:** Tests that no state file is corrupted, truncated, or missing required fields.

**Expected:**
- `~/.claude/delegation-state.json`: valid JSON, has `session_started_at`, `lifetime`, `sessions` map.
- `~/.claude/savings-ledger.jsonl`: valid JSONL, each line parsable, no duplicates.
- `~/.claude/model-tiers.json`: valid JSON, has `selection`, `tiers`, `trinity` slots.
- `~/.claude/blackbox-state.json`: valid JSON, per-project resolution state.
- `~/.claude/project-states.json`: valid JSON, per-project buckets.
- `~/.claude/active-jobs.json`: valid JSON, job records with status.
- `~/.claude/.flow-todo-queue.jsonl`: valid JSONL.

---

### 14.2 File-Based Locking

**Prompt:** Start two plugin instances simultaneously (or simulate by creating a stale lock).

**Why:** Tests `withFileLock()` prevents concurrent instances via exclusive file creation in `~/.claude/.vibeOS-locks/`.

**Expected:**
- First instance: lock acquired (`wx` mode succeeds).
- Second instance: lock acquisition fails within 2s timeout → plugin warns and exits or skips init.
- Stale locks (>30s) auto-cleaned.

---

### 14.3 JSONC Parsing Tolerance

**Prompt:** Add trailing commas and `// comments` to `model-tiers.json`, then run any plugin operation.

**Why:** Tests `safeJsonParse()` handles non-standard JSON (trailing commas, `//` and `/* */` comments, unquoted keys).

**Expected:**
- Plugin parses the file without error.
- Values correctly extracted.

---

## 15. CORE HOOK INTEGRITY

### 15.1 All Hooks Registered

**Prompt:** Check `DelegationEnforcer()` constructor in `src/index.js:571-594`.

**Why:** Tests that all required hooks are registered and signatures are correct.

**Expected (8 hooks):**
- `tool.execute.before` → `onToolExecuteBefore()`
- `tool.execute.after` → `onToolExecuteAfter()`
- `experimental.chat.messages.transform` → `onMessagesTransform()`
- `experimental.chat.system.transform` → `onSystemTransform()`
- `experimental.text.complete` → `_appendFooter()`
- `message.updated` → `_appendFooter()`
- `experimental.session.compacting` → `onSessionCompacting()`
- `shell.env` → `onShellEnv()`

---

### 15.2 Shell Env Injection

**Prompt:**
> Run `echo $OPENCODE_MODEL_TIER && echo $OPENCODE_MODEL`

**Why:** Tests `onShellEnv()` injects environment variables into subprocesses.

**Expected:**
- Output shows current tier (e.g., `brain`) and current model ID (e.g., `deepseek/deepseek-v4-flash`).

---

## 16. CONTEXT7 OPTIMIZATION

### 16.1 Context7 System Prompt Injection

**Prompt:** Start a session with context7 available (`CLAUDE_CONTEXT7_AVAILABLE=true`).

**Why:** Tests that `onSystemTransform()` injects cost-saving context7 usage instructions into the system prompt.

**Expected:**
- System prompt contains directive instructing the model to prefer context7 over WebFetch for documentation lookups.
- Model uses context7 MCP tool instead of WebFetch for docs.

---

### 16.2 Context7 One-Shot Install Nudge

**Prompt:** (Without context7 installed) Use WebFetch on a docs URL.

**Why:** Tests the one-shot context7 install suggestion fires once per install.

**Expected:**
- First WebFetch docs URL: nudge message displayed, flag file `~/.claude/.context7-install-suggested` created.
- Second WebFetch docs URL: no nudge.

---

## 17. SAVINGS RECONCILIATION

### 17.1 Ledger-to-State Reconciliation

**Prompt:** Delete `delegation-state.json` but keep `savings-ledger.jsonl`, then restart plugin and run `trinity status`.

**Why:** Tests `reconcileStateFromLedger()` rebuilds state from the append-only ledger.

**Expected:**
- New `delegation-state.json` created.
- Savings totals match exactly what was in the ledger.
- `lifetime.rebuilt_from_ledger` set to `true`.

---

### 17.2 Savings Persistence Across Sessions

**Prompt:** End session (restart), start new session, check `trinity status`.

**Why:** Tests state file persists across session boundaries.

**Expected:**
- Lifetime savings from previous session still present.
- New session entry created under `sessions`.

---

## 18. EDGE CASES

### 18.1 No State Files — Fresh Install

**Prompt:** Delete all `~/.claude/vibeOS-*` state files, restart plugin.

**Why:** Tests graceful handling of missing state files on first install.

**Expected:**
- State files auto-created with defaults.
- No crash.
- Plugin initializes with zero savings, defaults enabled.

---

### 18.2 Corrupted State File

**Prompt:** Write invalid JSON to `delegation-state.json` (`{invalid`), restart plugin.

**Why:** Tests `safeJsonParse()` (which returns default on parse failure) handles corrupted state files.

**Expected:**
- Plugin does not crash.
- State file may be backed up to `~/.claude/.backups/`.
- Plugin operates with default/zero state.

---

### 18.3 Brain Tier Direct Write — No Enforcement Disabled

**Prompt:**
> trinity enforce off && Write a file `test-output/test.txt` with content "test".

**Why:** Tests that when enforcement is disabled, brain-tier writes succeed without block/warn.

**Expected:**
- File written successfully.
- No warn in `delegation-state.json`.
- No savings recorded.

---

### 18.4 Task Subagent Routing

**Prompt:**
> Use a task agent to create a new file `src/lib/calculator.py` that implements add, subtract, multiply, divide.

**Why:** Tests that Task subagents are routed to the cheap/medium tier (NOT brain) when task delegation is active.

**Expected:**
- Task executes on `deepseek-chat` (cheap tier) or fallback to `deepseek-v4-flash`.
- Console log shows task routing decision.
- Tool result shows correct implementation.

---

### 18.5 Active Job Tracking

**Prompt:** Run a long task, then check `active-jobs.json`.

**Why:** Tests `setActiveJobFromTaskPrompt()` writes in-flight delegation job records to `~/.claude/active-jobs.json`.

**Expected:**
- `active-jobs.json` has entry with job ID, status "pending", project fingerprint, prompt excerpt.
- On completion, status updated or entry removed.

---

## 19. ML ROUTER & SMART CACHE

### 19.1 Smart Cache — Predict Hit on Repeat Tool

**Prompt (run twice):**
> Read `package.json`

**Why:** Tests `addCacheEntry()` and `predictCacheHit()` in `src/vibeOS-lib/smart-cache.js`. After first read, the cache database records the observation. Second read should predict a cache hit.

**Expected (second run):**
- Console log: `[vibeOS] 🔮 Smart cache: read may benefit from caching`
- `_cacheDb` contains entry for the read tool.
- Prediction `shouldWarm` is `true` for the second call.

### 19.2 Smart Cache — Eviction

**Prompt:** Run `glob **/*.js` 50+ times with unique patterns.

**Why:** Tests `evictStaleEntries()` purges least-useful cache entries.

**Expected:**
- Cache database size stays bounded.
- Oldest/lowest-confidence entries are evicted.

### 19.3 ML Router — Compute Difficulty

**Prompt:**
> Write a full e-commerce backend with user auth, product catalog, shopping cart, payment processing, order management, inventory tracking, shipping integration, and admin dashboard.

**Why:** Tests `computeDifficulty()` in `src/vibeOS-lib/ml-router.js`.

**Expected:**
- `computeDifficulty()` returns a difficulty score > 0.5 (complex task).
- Router suggests a higher-tier model for complex tasks.

### 19.4 ML Router — Predict Best Model

**Prompt:**
> Run `npm test`

**Why:** Tests `predictBestModel()` routes simple tasks to cheaper tiers.

**Expected:**
- For simple bash commands, router suggests cheap/medium tier.
- For multi-file edits, router suggests brain tier.

### 19.5 ML Router — Route Edge Learning

**Prompt:** Switch tiers repeatedly on different task types.

**Why:** Tests `addRouteEdge()` records routing decisions for future optimization.

**Expected:**
- `global-learning.json` contains routing edges.
- ML graph data persisted across sessions.

### 19.6 Smart Cache Live Verification

**Prompt:**
```bash
node -e "
import { createCacheDatabase, addCacheEntry, recordCacheStats, predictCacheHit } from '/Users/drunkktoys/Desktop/theSaver-oc/src/vibeOS-lib/smart-cache.js';
const db = createCacheDatabase();
addCacheEntry(db, 'test-hash', 'read', 'test-prompt', 1024, 0);
recordCacheStats(db, 'read', true, 0.0005);
const pred = predictCacheHit(db, 'read', 'test-prompt');
console.log('Should warm:', pred.shouldWarm, 'Confidence:', pred.confidence);
console.log('ML+Cache test PASSED');
"
```

**Why:** Direct function-level test.

**Expected:** Output shows `ML+Cache test PASSED`.

---

## APPENDIX: QUICK REFERENCE

### State File Summary

| File | What It Stores |
|---|---|
| `~/.claude/delegation-state.json` | Primary savings, session warns, lifetime totals, flow warns |
| `~/.claude/savings-ledger.jsonl` | Append-only audit log of every savings event |
| `~/.claude/model-tiers.json` | Brain/medium/cheap slot config, pricing cache |
| `~/.claude/blackbox-state.json` | Per-project resolution tracker, session outcomes |
| `~/.claude/project-states.json` | Per-project analytics, patterns, report refs |
| `~/.claude/active-jobs.json` | In-flight delegation job records |
| `~/.claude/.flow-todo-queue.jsonl` | Flow enforcer extracted TODO items |
| `~/.claude/.flow-dedup-keys.json` | Flow TODO dedup key set |
| `~/.claude/.enforcement-cooldown.jsonl` | TDD enforcement cooldown timestamps |
| `~/.claude/.vibeOS-locks/*.lock` | File-based process locks |
| `~/.claude/reports/` | Saved report JSON files |
| `~/.claude/global-learning.json` | Cross-project pattern learning data |
| `~/.claude/model-pricing-cache.json` | Cached model pricing metadata |

### Savings Constants

| Constant | Value | Trigger |
|---|---|---|
| `SAVE_EST.WRITE_EDIT` | `0.005` | Write/Edit blocked on brain tier |
| `SAVE_EST.SOFT_QUOTA` | `0.0003` | Soft quota limit exceeded |
| `SAVE_EST.CONTEXT7` | `0.002` | Missed context7 opportunity |
| `SAVE_EST.OPUS_DISABLE` | `0.03` | Opus model disabled |
| `CACHE_SAVED_PER_1M_INPUT_TOKENS` | `0.10` | Scratchpad cache hit |

### API Endpoints Summary

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | None | Health check |
| POST | `/api/v1/delegate/check` | Token | Delegation enforcement |
| POST | `/api/v1/route/model` | Token | Tier routing |
| POST | `/api/v1/stress/score` | Token | Stress scoring |
| POST | `/api/v1/blackbox/analyze` | Token | Blackbox turn analysis |
| POST | `/api/v1/blackbox/calibrate` | Token | Calibration |
| GET | `/api/v1/blackbox/calibration` | Token | Read calibration |
| POST | `/api/v1/blackbox/outcome` | Token | Record outcome |
| GET | `/api/v1/blackbox/project-sessions` | Token | Cross-session history |
| POST | `/api/v1/tdd/skeleton` | Token | Test skeleton gen |
| POST | `/api/v1/patterns/observe` | Token | Pattern observation |
| POST | `/api/v1/pricing/fetch` | Token | Live pricing |
| POST | `/api/v1/compress/context` | Token | Context compression |
| POST | `/admin/seats` | Master | Create seat+token |
| GET | `/admin/seats` | Master | List seats |
| PATCH | `/admin/seats/:id` | Master | Update seat status |
| POST | `/admin/tokens` | Master | Create token |
| GET | `/admin/tokens` | Master | List tokens |
| PATCH | `/admin/tokens/:id` | Master | Update token |
| DELETE | `/admin/tokens/:id` | Master | Delete token |
| GET | `/admin/usage` | Master | Usage statistics |

---

## 20. STATE CORRUPTION & RECOVERY INTEGRITY

> **P0:** Catches ledger concatenation, rebuild data loss, pricing-cache corruption loops, and dedup failures found in production on this device.

---

### 20.1 Savings Ledger — Append Integrity (Newline Separation)

**Prompt (run in terminal):**
```bash
cat ~/.claude/savings-ledger.jsonl | python3 -c "
import json, sys
lines = sys.stdin.read().strip().split('\n')
for i, line in enumerate(lines):
    try:
        json.loads(line.strip())
    except json.JSONDecodeError:
        import re
        objs = re.findall(r'\{[^}]+\}', line.strip())
        print(f'CORRUPT line {i}: {len(objs)} objects concatenated (no newline)')
        sys.exit(1)
print('OK: all lines parse as single JSON objects')
"
```

**Why:** `_ledgerBuffer` flush must write one JSON object per line (append-only JSONL). A flush-buffer bug was concatenating 129 objects on a single line without newline separators, corrupting the entire ledger and preventing rebuild from working.

**Expected:**
- Every line is a single valid JSON object.
- Zero "CORRUPT" output.
- No line contains more than one `{...}` JSON structure.

---

### 20.2 Savings Ledger — Rebuild Captures All Entries

**Prompt:**
```bash
# Count entry unique identifiers in ledger vs state
python3 -c "
import json, re, sys

# Count entries in ledger
with open('/Users/drunkktoys/.claude/savings-ledger.jsonl') as f:
    raw = f.read()
entries = re.findall(r'\{[^}]+\}', raw)
ledger_sids = set()
for e_str in entries:
    try:
        e = json.loads(e_str)
        ledger_sids.add(e.get('sid', ''))
    except: pass
print(f'Ledger unique sessions: {len(ledger_sids)}, total entries: {len(entries)}')

# Count entries in state
with open('/Users/drunkktoys/.claude/delegation-state.json') as f:
    state = json.load(f)
sessions = state.get('sessions', {})
total_warns = sum(len(s.get('warns', [])) for s in sessions.values())
total_cache = sum(len(s.get('cache_hits', [])) for s in sessions.values())
rebuild_count = state.get('lifetime', {}).get('ledger_entries_reconciled', 0)
print(f'State: {len(sessions)} sessions, {total_warns} warns, {total_cache} cache hits')
print(f'Rebuild reconciled: {rebuild_count} entries')
# rebuild_count must be >= total_warns + total_cache (close enough)
if rebuild_count >= total_warns + total_cache:
    print('PASS: rebuild captured all entries')
else:
    print(f'FAIL: rebuild missing {total_warns + total_cache - rebuild_count} entries')
"
```

**Why:** After the JSON concatenation bug, `reconcileStateFromLedger()` could only parse 1 entry from a ledger containing 173 entries across 2 sessions. The rebuild must parse every individual JSON object from the ledger, handling multi-object recovery via regex as fallback.

**Expected:**
- `rebuild_count` >= `total_warns + total_cache` (must not lose entries).
- `ledger_entries_reconciled` field matches actual count of unique ledger entries.
- If state was not rebuilt, `rebuilt_from_ledger` should be absent or `false` and no data should be missing.

---

### 20.3 Savings Not Lost After State Corrupt+Rebuild Cycle

**Prompt:**
```bash
# Simulate: save current savings total, delete state, restart plugin, verify total matches
SAVED=$(python3 -c "import json; d=json.load(open('/Users/drunkktoys/.claude/delegation-state.json')); print(d['lifetime']['total_savings_usd'])")
echo "Savings before: \$$SAVED"
# DO NOT actually delete here — check trinity status instead
trinity status 2>/dev/null | grep -oE '\$[0-9]+\.[0-9]+' | head -1
```

**Why:** Production state showed footer reporting $0.92 saved, but after a corruption-triggered rebuild, only $0.05 remained in `delegation-state.json`. The ledger is the source of truth — state rebuild must recover exact totals from it.

**Expected:**
- Footer total matches `delegation-state.json` `total_savings_usd` within $0.01.
- After any rebuild, `lifetime.rebuilt_from_ledger = true` and the total includes all ledger entry amounts.
- `session-report.log` entries agree with state file totals (no discrepancy > $0.01).

---

### 20.4 Model Pricing Cache — No Corruption Loop

**Prompt (run in terminal):**
```bash
python3 -c "
import json, os
path = '/Users/drunkktoys/.claude/model-pricing-cache.json'
try:
    with open(path) as f:
        d = json.load(f)
    print(f'OK: valid JSON, {len(d)} model entries')
except json.JSONDecodeError as e:
    print(f'CORRUPT: {e}')
    os.exit(1)

# Check corruption log count
log_path = '/Users/drunkktoys/.claude/.state-corruption-log.jsonl'
corrupt_count = 0
if os.path.exists(log_path):
    with open(log_path) as f:
        corrupt_count = len(f.readlines())
print(f'Corruption log entries: {corrupt_count}')
if corrupt_count > 5:
    print(f'WARN: {corrupt_count} corruption events — pricing cache loop suspected')
else:
    print('OK: corruption rate normal')
"
```

**Why:** Production hit 92 corruption events, with 20 in a single 37-second window. The `model-pricing-cache.json` was being written as corrupt JSON repeatedly — either a race condition between concurrent writes, or `safeJsonWrite()` writing incomplete data.

**Expected:**
- `model-pricing-cache.json` is valid JSON (never corrupt).
- Corruption log entries are 0 or < 3 after a clean session start.
- No tight cluster of corruption events (20+ in < 60 seconds).
- If corrupt, backup is saved to `~/.claude/.backups/` before overwrite.

---

### 20.5 Warn Dedup — Duplicate Keys Coalesced

**Prompt:**
```bash
python3 -c "
import json
with open('/Users/drunkktoys/.claude/delegation-state.json') as f:
    d = json.load(f)
for sid, s in d.get('sessions', {}).items():
    warns = s.get('warns', [])
    keys = [w.get('key') for w in warns]
    dupes = {k: count for k, count in [(k, keys.count(k)) for k in set(keys)] if count > 1}
    if dupes:
        print(f'SESSION {sid}: DUPLICATE KEYS — {dupes}')
    else:
        print(f'SESSION {sid}: OK — no duplicate warn keys')
"
```

**Why:** Production found `opencode-10529-1779349339458:import` appearing twice as separate warn entries (8 seconds apart). The dedup logic using dedup key = `${_OC_SID}:${firstWord}` within `WARN_DEDUPE_WINDOW_MS` (120s) should coalesce identical keys by incrementing `count` on the existing entry, not creating a duplicate.

**Expected:**
- Every session has zero duplicate `warns[].key` entries.
- If a tool is blocked twice within 120 seconds with the same `firstWord`, the second warn increments `count` on the first entry (does NOT create a new entry).
- `key` value should not be empty string or null.

---

### 20.6 Session Timestamp — `session_started_at` Not Null

**Prompt:**
```bash
python3 -c "
import json
with open('/Users/drunkktoys/.claude/delegation-state.json') as f:
    d = json.load(f)
for sid, s in d.get('sessions', {}).items():
    started = s.get('session_started_at')
    if started is None:
        print(f'SESSION {sid}: FAIL — session_started_at is null')
    elif isinstance(started, str) and started.strip() == '':
        print(f'SESSION {sid}: FAIL — session_started_at is empty string')
    else:
        print(f'SESSION {sid}: OK — {started}')
"
```

**Why:** Both production sessions showed `null` for `session_started_at`. `ensureSession()` must set an ISO timestamp on session creation — without it, session age calculations, rate tracking, and report filtering are all broken.

**Expected:**
- Every session has a non-null, non-empty `session_started_at` ISO 8601 string.
- Timestamp is set at session creation time (first warn, first cache hit, or explicit init).
- Timestamp is in the past (not future-dated).

---

### 20.7 Model Split — Non-Empty After Tool Use

**Prompt:** After running at least one task subagent or a tool call in the current session:
```bash
python3 -c "
import json
with open('/Users/drunkktoys/.claude/delegation-state.json') as f:
    d = json.load(f)
for sid, s in d.get('sessions', {}).items():
    split = s.get('model_split', {})
    print(f'SESSION {sid}: {len(split)} models tracked')
    for model, count in split.items():
        print(f'  {model}: {count}')
"
```

**Why:** Both production sessions showed empty `{}` for `model_split`. The model usage tracker should record every tool call's model into the split, enabling the footer to display percentage breakdown (e.g., `deepseek-v4-pro 100% → deepseek-chat 0%`).

**Expected:**
- At least 1 model entry in `model_split` for sessions that had tool calls.
- Model IDs match actual provider/model format (e.g., `deepseek/deepseek-chat`).
- Footer model split percentages match the state file.

---

### 20.8 State Corruption — Backup Before Overwrite

**Prompt:**
```bash
ls -la ~/.claude/.backups/ 2>/dev/null && echo "---"
python3 -c "
import os
log = '/Users/drunkktoys/.claude/.state-corruption-log.jsonl'
if os.path.exists(log):
    with open(log) as f:
        for line in f:
            import json
            e = json.loads(line)
            backup = e.get('backup', '')
            if backup and not os.path.exists(backup):
                print(f'ORPHAN BACKUP: {backup} (logged but file missing)')
print('Backup check complete')
"
```

**Why:** The corruption log had 92 entries but `.backups/` directory was empty — suggesting backups were either never written or were cleaned up prematurely. Every corruption event must save a backup before overwriting, and backups must persist at least until the next clean write succeeds.

**Expected:**
- Every `backup` path in `.state-corruption-log.jsonl` exists on disk OR has been garbage-collected with a corresponding "cleaned" log entry.
- No orphan corruption log entries pointing to nonexistent files.
- Backup cleanup happens only after the original file is confirmed valid.

---

### 20.9 End-to-End: Session Lifecycle Integrity

**Prompt:** Run the full check script:
```bash
python3 -c "
import json, os, re, sys

errors = 0

# 1. delegation-state.json
try:
    with open(os.path.expanduser('~/.claude/delegation-state.json')) as f:
        state = json.load(f)
    lt = state.get('lifetime', {})
    sessions = state.get('sessions', {})
    
    # Check total_savings_usd matches session sums
    sess_total = sum(s.get('delegation_savings_usd', 0) + s.get('cache_savings_usd', 0) for s in sessions.values())
    lt_total = lt.get('total_savings_usd', 0)
    if abs(sess_total - lt_total) > 0.001:
        print(f'FAIL: session total \${sess_total:.4f} != lifetime total \${lt_total:.4f}')
        errors += 1
    else:
        print(f'OK: session/lifetime totals match (\${lt_total:.4f})')
    
    # Check session_started_at
    for sid, s in sessions.items():
        if not s.get('session_started_at'):
            print(f'FAIL: session {sid[:20]}... missing started_at')
            errors += 1
    
    # Check dedup
    for sid, s in sessions.items():
        warns = s.get('warns', [])
        keys = [w.get('key') for w in warns]
        dupes = {k: c for k, c in [(k, keys.count(k)) for k in set(keys)] if c > 1}
        if dupes:
            print(f'FAIL: session {sid[:20]}... duped keys: {dupes}')
            errors += 1
    
    # Check model_split
    for sid, s in sessions.items():
        if len(s.get('model_split', {})) == 0 and len(s.get('warns', [])) > 0:
            print(f'WARN: session {sid[:20]}... has warns but empty model_split')
    
except Exception as e:
    print(f'FAIL: delegation-state.json unreadable: {e}')
    errors += 1

# 2. savings-ledger.jsonl integrity  
try:
    with open(os.path.expanduser('~/.claude/savings-ledger.jsonl')) as f:
        lines = f.read().strip().split('\n')
    concat_lines = 0
    for i, line in enumerate(lines):
        try:
            json.loads(line.strip())
        except json.JSONDecodeError:
            objs = re.findall(r'\{[^}]+\}', line.strip())
            if len(objs) > 1:
                concat_lines += 1
    if concat_lines > 0:
        print(f'FAIL: {concat_lines} ledger lines have concatenated JSON')
        errors += 1
    else:
        print(f'OK: ledger ({len(lines)} lines) — all single JSON per line')
except Exception as e:
    print(f'FAIL: savings-ledger.jsonl unreadable: {e}')
    errors += 1

# 3. model-pricing-cache.json
try:
    with open(os.path.expanduser('~/.claude/model-pricing-cache.json')) as f:
        json.load(f)
    print('OK: model-pricing-cache.json is valid JSON')
except Exception as e:
    print(f'FAIL: model-pricing-cache.json corrupt: {e}')
    errors += 1

# 4. blackbox-state.json
bb_path = os.path.expanduser('~/.claude/blackbox-state.json')
if os.path.exists(bb_path):
    try:
        with open(bb_path) as f:
            json.load(f)
        print('OK: blackbox-state.json is valid JSON')
    except Exception as e:
        print(f'FAIL: blackbox-state.json corrupt: {e}')
        errors += 1
else:
    print('WARN: blackbox-state.json not found (may be normal if blackbox disabled)')

print(f'\n{errors} integrity errors found')
sys.exit(errors)
"
```

**Why:** Catches all the production failures (dedup, timestamps, ledger concatenation, pricing-cache corruption, session/lifetime mismatch, blackbox state) in a single check. Run this at session start and after every trinity operation.

**Expected:**
- `0 integrity errors found`.
- `session/lifetime totals match` (no drift).
- No duplicate dedup keys.
- Ledger lines parse as single JSON objects.
- `model-pricing-cache.json` valid.
- `blackbox-state.json` valid (or warn if disabled).
