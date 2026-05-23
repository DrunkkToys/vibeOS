# vibeOS Full Functionality Test + Low-Risk Refactor Audit

## Phase 1 — Test Suite Baseline

Run: `npm test`
- Document: total tests, pass/fail/skip
- List every failure with its name and error message
- Check: `node --check src/index.js`
- Check: `npm run typecheck`

## Phase 2 — Trinity Runtime Controls

Test each command:
- `trinity status` — shows slots, active tier, thinking level, flow/TDD/blackbox state
- `trinity enable` / `trinity disable` — toggles plugin
- `trinity set brain` / `set medium` / `set cheap` — slot switching
- `trinity rebuild` — auto-discovers models (dry run, just check it doesn't crash)
- `trinity think full|brief|off` — thinking mode toggle
- `trinity enforce on|off` — enforcement toggle
- `trinity lock on|off` — model locking
- `trinity flow on|off` / `flow enforce on|off` — flow enforcer
- `trinity tdd on|off` / `tdd strict on|off` / `tdd quality on|off` — TDD enforcer

Check:
- Does each command return or error gracefully?
- Is the footer updated after each toggle?

## Phase 3 — Delegation Enforcement

- Attempt write/edit on brain-tier: should be blocked with enforcement note
- Verify delegation cost estimate is shown in UI notes
- Verify `enforcementBlocked` counter increments
- Check `~/.claude/delegation-state.json` for session warns + savings

## Phase 4 — Footer + Savings Tracking

- Verify footer shows: model split, cumulative savings, stress gauge
- Verify savings recorded via `recordSaving()` / `recordCacheSaving()`
- Verify trend arrow direction
- Check `~/.claude/savings-ledger.jsonl` for append-only events
- Check footer auto-saves report every 5 messages

## Phase 5 — Blackbox Decision Engine

- `trinity blackbox status` — shows current state
- `trinity blackbox on|off` — toggle
- `trinity blackbox reset` — clears state
- Verify footer shows resolution state + sub-regime
- Verify `~/.claude/blackbox-state.json` is well-formed
- Verify disabled fallback `classifyTurnSimple()` still works

## Phase 6 — Flow Enforcer

- Check `flow-rules.json` is valid
- Verify write/edit pattern checks trigger on rule violations
- `trinity flow enforce on` — verify TODO extraction queue appears
- Check `~/.claude/.flow-todo-queue.jsonl` exists (or is created)
- Check `~/.claude/.flow-dedup-keys.json` exists

## Phase 7 — TDD Enforcer

- `trinity tdd on` — write a test .ts file, verify skeleton is auto-generated
- `trinity tdd strict on` — verify strict TODO test template includes fail marker
- `trinity tdd quality on` — verify quality mode
- Check `buildTestSkeleton()` output for .ts, .js, .py, .rs, .cjs, .mts

## Phase 8 — Report & Audit

- `report-save` — save a test report
- `report-list` — list recent reports
- `report-read` — read the saved report
- `research-audit` — run session research audit
- Check `~/.claude/reports/` directory exists
- Check `REPORTS_INDEX` file integrity

## Phase 9 — Project Guard

- Verify AGENTS.md has auto-guard in hooks (check `ensureProjectDocs()`)
- Check `trinity guard` returns current state

## Phase 10 — Pattern Learner

- `trinity patterns` — show learned patterns
- `trinity patterns clear` — clear them
- Check `promotedProjectPatterns` and `projectPatternRows` data flow
- Check `~/.claude/global-learning.json` structure

## Phase 11 — State File Integrity

For each state file, verify:
- Valid JSON / JSONL structure
- Expected keys present
- No corruption

Files:
- `~/.claude/delegation-state.json`
- `~/.claude/model-tiers.json`
- `~/.claude/blackbox-state.json`
- `~/.claude/project-states.json`
- `~/.claude/savings-ledger.jsonl`
- `~/.claude/global-learning.json`
- `~/.claude/active-jobs.json`
- `~/.claude/model-pricing-cache.json`
- `~/.claude/.flow-todo-queue.jsonl`
- `~/.claude/.flow-dedup-keys.json`
- `~/.claude/.enforcement-cooldown.jsonl`

## Phase 12 — Architectural Review

Check:
1. **TypeScript compilation gap**: 9 `.ts` test files have no `.js` counterpart. Verify they're included/excluded correctly in `tsconfig.json` and `npm test`.
2. **Build chain**: AGENTS.md describes `sync-ts-build.mjs` step. Verify it still works: `node scripts/sync-ts-build.mjs`
3. **dist-ts/ directory**: Does not exist. The build chain expects it. Check if this is intentional.
4. **Hook registration**: Verify all 8 hooks are registered in `src/index.ts` (text.complete, chat.messages.transform, chat.system.transform, tool.execute.before, tool.execute.after, message.updated, session.compacting, shell.env)
5. **Import consistency**: All `.ts` → `.js` import paths correct? No dead imports?
6. **Blackbox module**: `src/vibeOS-lib/blackbox/` has 7 `.ts` files compiled to `.js`. Verify no drift between .ts and .js.
7. **Test coverage gaps**: Which features have NO tests? (e.g., stress pipeline, pattern learner, project guard, model locking, thinking mode, auto-mode)
8. **state.js size**: Single file exports ~100 functions. Check for extractable concerns.
9. **index.ts size**: ~738 lines of orchestrator + helpers. Check for extractable concerns.
10. **error handling**: Are catch blocks logging useful info? Any silent fails?

## Phase 13 — Low-Hanging Fruit, No-Risk Refactors

For each candidate, evaluate: **is it safe to change without breaking tests?** Score 1-5 (5 = safest).

1. **TS-only test files not compiled to JS** — 9 files. Easy fix: add build step or update test runner.
2. **dist-ts/ missing** — Cleanup AGENTS.md build instructions or add dist-ts to .gitignore.
3. **Test failures** — 19 failures. Are they real bugs or stale assertions?
4. **Dead imports** — Grep for unused imports in .ts files.
5. **Inconsistent naming**: Some files use `_` prefix for private (convention), others don't.
6. **Magic numbers**: e.g., `SAVE_EST` constants, `SOFT_QUOTA_LIMIT`. Could be extracted to constants.ts.
7. **sync-ts-build.mjs stale**: Check if `sync-ts-build.mjs` actually works or if `esbuild` is now the sole build path.
8. **Duplicated regex patterns**: `HIGH_TIER_RE`, `MID_TIER_RE` appear in multiple places.

## Deliverables

Return:
1. **Test results summary**: pass/fail/skip counts + full failure details
2. **Feature coverage matrix**: each feature from README/AGENTS.md, marked as PASS/FAIL/UNTESTED
3. **Refactoring candidates**: ordered by risk score (lowest first), with specific line-level suggestions
4. **Architectural findings**: 3-5 key observations with severity (low/med/high)
5. **State file health**: each state file's integrity status
