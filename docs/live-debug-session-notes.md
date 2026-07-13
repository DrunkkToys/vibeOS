# vibeOS live-debug session notes (reference only)

Branch: `fix/live-debug-pass`. PR: https://github.com/DrunkkToys/vibeOS/pull/428 (merged)
Branch: `fix/footer-audit-round2`. PR: https://github.com/DrunkkToys/vibeOS/pull/430 (open)
Branch: `fix/live-debug-pass` (LOOPING feedback loop). PR: https://github.com/DrunkkToys/vibeOS/pull/429

## Round 2 findings (fix/footer-audit-round2) -- the real root cause

The passiveNegative feedback-loop fix in PR #429 was real but NOT the primary cause of
"it's always looping." Root-caused via live driving in OpenCode Desktop:

1. **`src/lib/hooks/footer.ts` disk-fallback dead code**: referenced `_cascadeRouteLen`,
   never declared anywhere -- silently threw, swallowed by `catch{}`, the whole
   disk-cascade-override block never ran. Fixed by removing the dead reference.
2. **Footer cross-session regime leak**: once (1) was fixed, the fallback used the
   file's ROOT-level `sub_regime`/`cascade_depth`/`cv` (a process-global "last writer
   wins" mirror) instead of `sessions[sid]`. `resolveActiveCascadeTier` already used
   the session-scoped record for the tier badge -- so regime label and tier badge could
   disagree (matches "cascade icon and llm tier does not match"). Fixed by scoping the
   fallback to `sessions[sid]`.
3. **ROOT CAUSE: `src/index.ts` never synced session identity to OpenCode's real
   sessionID.** `@opencode-ai/plugin`'s Hooks type confirms `tool.execute.before/after`,
   `experimental.text.complete`, `experimental.session.compacting`,
   `experimental.chat.system.transform`, `chat.params` all carry a real per-conversation
   `sessionID` in their `input`. The plugin ignored it -- `_OC_SID` was generated ONCE at
   `DelegationEnforcer` init (`opencode-<pid>-<timestamp>-<rand>` format) and reused for
   the ENTIRE app process lifetime via a `shouldReuseSessionId` heuristic. Every chat
   tab/conversation in one running OpenCode Desktop instance shared ONE vibeOS session
   record. Live-reproduced: a genuinely new "New session" chat's first message
   immediately showed "Looping," silently inheriting a 40+ turn unrelated session's
   state. Fixed by calling `setCurrentSessionId(input.sessionID)` in those 5 hooks.
   Live-verified post-fix: fresh sessions now get OpenCode's real `ses_...`-format ID and
   correctly start at "Starting" with 0 interactions.
4. **Scratchpad/smart-cache session scoping never followed suit**: `setCurrentSessionId()`
   only updated `currentSessionId`; `scratchpad-cache.ts`'s `getSessionRoot()` reads a
   SEPARATE identity source, `getOcSessionId()` from `runtime-state.ts`, never kept in
   sync. Fixed by having `setCurrentSessionId()` also call `setOcSessionId()`.

All 4 fixes are TDD-verified (each new test fails on pre-fix code via `git stash`, passes
with the fix): `tests/test_footer_cross_session_regime_leak.test.mjs`,
`tests/test_hook_session_id_sync.test.mjs`, `tests/test_scratchpad_session_id_sync.test.mjs`.

## Found but NOT yet fixed (documented, needs its own follow-up branch)

- **Pivot/counter-pivot is dead code in the default `vibeultrax` mode.**
  `vibeultraxPipeline` (`src/vibeOS-lib/blackbox/vibeultrax.ts`) only ever READS from
  `PivotCache` (`detectPivotBack`/`read`/`buildInjection`) -- it never calls `.snapshot()`.
  Only `vibemax.ts`'s pipeline writes snapshots. Since the live app defaults to
  `vibeultrax`, pivot detection can never match anything real. Confirmed live:
  `.vibeos-pivot-cache.json` has 279 stored pivots, ALL 12+ days old from a past vibemax
  session, ZERO from today's vibeultrax usage. Separately, `PivotCache` is a single
  global instance (`globalThis.__vibeultraxPivotCache`) backed by ONE shared file
  (`$VIBEOS_HOME/.vibeos-pivot-cache.json`) with NO session scoping -- the same class of
  cross-session leak as items 2-4 above, just not yet exploited because nothing writes
  to it in vibeultrax mode. Proper fix: (a) add `detectPivot`+`.snapshot()` calls to
  `vibeultraxPipeline` mirroring `vibemaxPipeline`'s pattern, AND (b) session-scope the
  cache file/instance (same pattern as scratchpad cache) before enabling writes, to avoid
  leaking one conversation's captured workflow/decisions/files into an unrelated one.

- **TDD skeleton generation never calls the documented remote API.** `api-client.ts` has
  a working `tddSkeleton()` method hitting `POST /api/v1/tdd/skeleton` (multi-language
  generation, per CLAUDE.md's protected-algorithms table), but `tdd-enforcer.ts`'s
  `buildTestSkeleton()`/`enforceTestFile()` (both fully synchronous) never call it -- 100%
  local template generation. The "default" language template is literally
  `TODO: Quality assertion for ${funcName}` comments with zero real assertions; the code
  even self-detects this via `isSkeletonUseless()` and logs a warning, but writes the
  useless file anyway. Matches the user's live feedback: "TDD should not create a
  skeleton, it's only mess." Proper fix requires converting `enforceTestFile()`'s call
  chain to async to await the remote API (with a deadline+local-fallback, matching the
  `raceWithDeadline`/`BLACKBOX_API_DEADLINE_MS` pattern already used for blackbox calls),
  which is a larger, riskier change deferred for its own branch/PR.

## Round 3: broader README/SPEC vs. code audit (background agent + manual verification)

- **`resolveCascadeRouteDecision` (src/lib/hooks/tool-execute.ts:357) is only ever
  called from test files** -- `cascade_route_contract.test.mjs`,
  `cascade_escalation_contract.test.mjs`, `test_task_routing_authority.test.mjs`,
  `cascade_footer_depth.test.mjs`, `cascade_audit_writer.test.mjs`,
  `vibeultrax_subagent_cascade.test.mjs`, all import/call it directly, never through a
  live hook. Verified directly: the ACTUAL runtime path (tool-execute.ts:~763, the
  real-task-tool routing site) builds `routeDecision` inline from
  `selection.worker_slot`/`active_pipeline` with an explicit comment "ONE source of
  truth... never re-derive," reading a decision already made upstream by
  `syncControlSettings` (chat-transform.ts). This may be a deliberate, intentional fix
  (avoiding duplicate/conflicting cascade computations across two independent code
  paths -- exactly the class of bug this whole session has been finding elsewhere) where
  the old function + its large test suite were simply never removed after the refactor.
  Judgment call, not unilaterally fixed: either (a) SPEC.md's certified behavior for
  this function is now testing dead code and should be updated/removed, or (b) if the
  function is genuinely still meant to be load-bearing somewhere, it needs to be wired
  back in. Needs a maintainer decision, not a blind delete or blind rewire.
- **`pricingFetch()` (remote `POST /api/v1/pricing/fetch`) is dead** --
  `api-client.ts:486` defines it, nothing calls it. `vibe rebuild`
  (`trinity-rebuild.ts:226-269`) populates `model-pricing-cache.json` by hitting
  OpenRouter/DeepSeek's public APIs directly, bypassing the documented remote vibeOS API
  entirely. CLAUDE.md's protected-algorithms table and README's "live pricing fetch"
  claim don't match what actually runs.
- **`blackboxCalibrate`/`blackboxCalibration` (online calibration) are dead** --
  `api-client.ts:399-405` wraps the documented `POST /api/v1/blackbox/calibrate` /
  `GET /api/v1/blackbox/calibration` endpoints ("Online calibration: Aggregates session
  outcomes and auto-tunes thresholds per project" per CLAUDE.md). Never called from any
  hook, trinity command, or test. `resolution-tracker.ts` has local `calibratedWeights`
  fields that load/save locally, but nothing ever fetches fresh calibration from the API.
- **Smart-cache `predictCacheHit().estimatedSavings` is computed but discarded** --
  `smart-cache.ts:246-314` computes it on every non-hit observation;
  `tool-execute.ts:663-719` only reads `.shouldWarm`/`.confidence`/`.similarEntries`/
  `.reason`. Lower severity than the others: the footer's actual "$X saved" figure comes
  from a separate, genuinely-working path (`recordCacheSaving` on real scratchpad hits),
  so this is a leftover/unused field on the prediction object, not a broken user-facing
  feature.

## Session identity architecture note for future work

Three subsystems each maintain their OWN session-identity variable, and only one
(`state.ts`'s `currentSessionId`/`_OC_SID`) is now correctly synced to OpenCode's real
per-conversation `sessionID`:
- `state.ts`: `currentSessionId` (footer, blackbox) -- FIXED, synced via hooks.
- `runtime-state.ts`: `getOcSessionId()`/`setOcSessionId()` (scratchpad cache) -- FIXED,
  now piggybacks on `setCurrentSessionId()`.
- `vibeultrax.ts`/`vibemax.ts`: `globalThis.__vibeultraxPivotCache` / module-level
  `pivotCache` (pivot cache) -- NOT fixed, still fully global/unscoped.
If a fourth subsystem introduces its own session-id variable in the future, it will
inherit this same bug class by default -- worth grepping for `globalThis.__vibeos` /
module-level singletons keyed by session before shipping anything new that persists
per-conversation state.

## Fixed this session
- `resolveActiveCascadeTier()` (`src/lib/hooks/footer.ts`): `legacyDepth || N` -> `legacyDepth ?? N` nullish-coalescing fix (real depth-0 was treated as unknown). Removed duplicate `claimTag` key.
- Model-corroboration override for footer tier display: attempted, then **reverted** (`4cb3d8f7`) — broke `tests/test_footer_alert_regression.test.mjs` (real Task-delegation-to-brain case with frozen entry-model string). No safe way to distinguish stale `route_path` from genuine delegation using only `liveModel` + `route_path`. Underlying footer inconsistency (brain badge + Big Pickle name) remains unfixed; existing "model drift" alert is the only current signal.
- Unbounded JSONL growth: added `appendJsonlWithRotation()` (`src/utils/fs-helpers.ts`), wired into `turn-ledger.ts`, `state.ts` (loop-audit), `session-health.ts`, `chat-transform.ts` (calibration buffer).
- Reports directory grew to 7,688 orphaned files (30MB) despite `report-list` showing capped "200" — `_pruneReports()`'s count-cap branch only trimmed the index, never deleted files. Fixed in `src/lib/reporting.ts`; one-time cleanup deleted 7,487 orphaned files.
- 2 pre-existing tests (`cascade_real_proof.test.mjs`, `test_api_client_fallback_regression.test.mjs`) updated to match the already-landed self-heal contract (401 clears fallback state instead of staying stuck).
- **Test-hang bug**: `tests/blackbox_bootstrap_exchange_gap.test.mjs` and `tests/api_client_auth_rejection_self_heal.test.mjs` both spin up a bare `http.createServer()` fixture and never call `server.close()`. The actual assertions pass in ~15ms, but the open server keeps the process's event loop alive forever, so the file-level test hangs until the runner's timeout and the process never exits — this is what silently spawned repeated zombie `node` processes (6 dead ones found from 4:26pm-5:30pm, all producing 0 bytes of output). Fixed by closing the server in a `finally` block. This is almost certainly the "2 known-flaky 240s timeout file-level artifacts" noted earlier in the session — now genuinely fixed, not just tolerated.

## Still open (from user feedback, not yet fixed)
1. **"TDD should not create a skeleton, it should start by writing cascade tests"** — user wants `vibe tdd on`'s current skeleton-generation replaced with a flow that starts by writing real cascade-exercising tests. Skeleton-gen code is in `src/vibeOS-lib/` (tdd-enforcer, likely `tdd-enforcer.ts`). Not yet investigated.
2. **"it's always looping"** — traced to the REMOTE API's own `negative-outcome-repeat` loop detector (`decision_source: "api"`, confidence 0.92, `loop_source_reason: "repeated negative outcomes"`), seen live in `$VIBEOS_HOME/blackbox-state.json` for session `opencode-57678-1783870757985-bb16114c7bfca`. This is server-side (vibeOScore repo), not directly patchable here. The fixable angle from this repo: whether client-side reward/penalty computation ("Lie penalty: -15", "Meta-work penalty: -8" seen via `vibe blackbox status`) over-penalizes legitimate usage and feeds bad signals upstream. Grep attempted with `--include=*.ts` glob and failed on zsh quoting; retry as `grep -rn "lie penalty\|lie_penalty\|meta-work penalty\|meta_work_penalty\|metaWorkPenalty" src/` (no `--include`).
3. **"cascade ▸▸ is not correct"** — footer showed a 2-arrow (medium-depth) cascade icon alongside the real brain-tier model name (V4 Pro). Distinct from the corroboration bug above; not yet investigated. Check `ultraCascadeDepth`/cascade icon computation in `footer.ts` against what actually determined depth for that turn.

## Round 4: marathon live-debug session (PRs #429-435)

Fixed and merged: footer cross-session regime leak (dead `_cascadeRouteLen`),
session-identity root cause (5 hooks in `src/index.ts` never synced OpenCode's real
`sessionID`), scratchpad-cache session sync, `PivotCache` session-scoping, dashboard
stuck-loading (`Home.tsx` `<Show>` fix), passiveNegative feedback loop, TDD skeleton
hardcoded Jest `expect()` API under `node:test` (PR #433), TDD framework detection's
`directory` never wired at all in `tdd-enforcer.ts` — silently used `process.cwd()`
of the OpenCode Desktop GUI process instead of the project root, defaulting away
from `node:test` to `vitest` (PR #434, root cause of item 1 below), `vibe lock on|off`
missing from the action schema enum despite a full handler existing (PR #434), and
`vibe mode raw` unreachable — `RAW_MODE` fully implemented in `mode-table.ts` but
never included in `trinity-tool.ts`'s `slot` schema enum or internal mode lookup
(PR #435).

**Item 1 (TDD skeleton mess) — root cause found and fixed.** Live-reproduced: the
very first TDD skeleton generated against this repo in a fresh OpenCode Desktop
session imported from `'vitest'`, a package not installed anywhere in the project.
Root cause: `directory` in `tdd-enforcer.ts` was declared but never assigned, so
`_detectTestFramework()` always used the wrong root. Fixed via `setTddDirectory()`
mirroring the existing `setToolDirectory`/`setShellDirectory` pattern. Follow-up not
yet done: `buildQualityAssertionsForFunc`'s `default` branch (go/rs/rb/java/kt) still
emits pure `TODO` comments with zero real assertions — same complaint, next layer.

**Item 3 (cascade icon mismatch) — root-caused via turn-ledger history, not a fresh
live reproduction.** `turn-ledger.jsonl` has 333 historical turns with
`cascadeDepth: 1` (single-arrow icon) while `finalVisibleSlot: "brain"`, e.g. turnId
`70c6b439ac041bf2`: `finalVisibleModel: "opencode/big-pickle"` (the CHEAP model)
paired with `finalVisibleSlot: "brain"` in the SAME finalized record — this is not
just an icon depth quirk, the slot and model string themselves disagree. The footer
already self-detects this and appends a `⚠ model drift` alert
(`footerLine: "... brain | Opencode | Big Pickle ▶ ↻ Looping | ... ⚠ model drift ..."`).
This is the SAME issue already investigated earlier this session ("Model-corroboration
override... reverted... broke a legit delegation test. No safe way to distinguish
stale route_path from genuine delegation using only liveModel + route_path.") — not
re-attempting the same fix without a safer disambiguation signal. Current mitigation
(the model-drift alert) is real and working, just not a full fix. Needs a genuinely
new signal (e.g. corroborate against `turn-ledger`'s own `cascadeDepth`/route history
rather than only live model string) before another fix attempt.

**Haiku-audit false positive caught**: an audit claimed `report-save`/`report-list`/
`report-read`/`research-audit` don't exist because it only grepped `trinity-tool.ts`.
They're real, fully wired, independent top-level OpenCode tools registered under
`pluginHooks.tool` in `src/index.ts` (~line 1369, returned via `DelegationEnforcer`
at line 1501) — confirmed directly, no fix needed. Lesson: always verify a
subagent's grep-based negative claims against the actual registration/export site,
not just the file it happened to search.

**`"target"` action** — present in `trinity-tool.ts`'s action enum with zero handler,
but NOT documented anywhere in CLAUDE.md's trinity command list — orphaned enum
value, not a broken promise. Left alone, noted only.

## Round 5: `vibe mode raw` unreachable + vibeultrax pivot capture + a chain of 3 more TDD bugs (PRs #435, #437-439)

- **`vibe mode raw` unreachable** (PR #435) — CLAUDE.md documents `mode
  vibeultrax|vibeqmax|vibemax|vibelitex|raw` as supported; `RAW_MODE` is fully
  implemented in `mode-table.ts` but `trinity-tool.ts`'s `slot` schema enum AND its
  internal `allModeIds`/mode-entry lookup never included it. Same bug class as the
  `lock` action fix. Live-verified post-fix: `vibe mode raw` now switches correctly
  ("Raw Brain ⚡" in the footer).
- **TDD quality assertions were bare TODOs for rust/ruby/java/kotlin/go** (PR #437) —
  `buildQualityAssertionsForFunc`'s `default` branch (hit by rs/rb/java/kt) emitted
  comment-only TODOs; `go`'s skeleton in `test-skeletons.ts` bypassed the shared
  function entirely with its own hardcoded TODO comments. Added real per-language
  assertion blocks.
- **vibeultrax pivot capture** (PR #438) — `vibeultraxPipeline` (the app's default
  mode) only ever READ from `PivotCache`, never wrote to it; only `vibemax.ts` did.
  `_pivotContext` was already correctly wired into the call site in
  `chat-transform.ts`, just discarded inside the function body. Added
  session-scoped forward-pivot detection (mirroring the existing
  `getPivotCache()` session-scoping) and a `.snapshot()` call, matching
  `vibemaxPipeline`'s pattern. New test proves the full capture→pivot-away→pivot-back
  round trip with real injected content.
- **Two more TDD bugs found live-testing the above, same session** (PR #439):
  1. `buildTestSkeleton()` unconditionally overwrote a skeleton's file extension with
     the JS framework's detected extension (`fw.testExt`) regardless of the SOURCE
     file's language. Live-reproduced: a `.rs` file's skeleton was written to
     `..._test.js` — raw Rust syntax inside a `.js` file, invisible to `cargo test`,
     unparseable as JS. Fixed to only apply the override for JS-family extensions.
  2. `syncControlSettings()` never wrote `tdd_quality` at all, and compared
     `cv.tdd_mode === "strict"` — a value `tdd_mode` never actually holds
     (`mode-table.ts` only ever produces `"quality"` or `"lazy"`). So `tdd_strict`
     was always wrongly false for quality mode, and `tdd_quality` silently kept
     whatever stale value it had forever (e.g. `false`, left over from switching to
     `raw` mode, which correctly disables TDD via `tdd: "—"`). This **orphaned the
     entire PR #437 quality-assertion fix** — live-reproduced by switching
     raw → vibeultrax and generating a skeleton that still had zero real assertions.
  Both were caught by the "use OpenCode Desktop itself to test the fix" step of the
  per-defect loop, not by static reading — a good argument for the loop's design.
- **Minor observation**: cold-start `writeSelection()` calls against a brand-new,
  never-initialized `$VIBEOS_HOME` sandbox (no existing `model-tiers.json`) can take
  tens of seconds due to first-run provider-seeding logic. Not a bug, but worth
  pre-seeding a minimal `model-tiers.json` in any test that calls `writeSelection`/
  `syncControlSettings` for the first time in a fresh sandbox, to avoid slow tests —
  see `test_sync_control_settings_tdd_quality.test.mjs`'s `seedSandbox()` helper for
  the working pattern (mirrors `test_fixes_footer_pivot_quality.test.mjs`).
- **Blackbox sub-regime count drift**: CLAUDE.md claims "7 sub-regimes" (INIT,
  DIVERGENT, EXPLORING, REFINING, CONVERGING, CLOSED, LOOPING); the local
  `ResolutionTracker.SUB_REGIMES` (`src/vibeOS-lib/blackbox/resolution-tracker.ts:7`)
  actually has 11: adds IMPLEMENTING, RESEARCH, REVIEWING, DESIGNING. Likely
  documentation drift rather than a functional bug, since CLAUDE.md itself documents
  the local tracker as API-fallback-only (never authoritative when the remote API is
  live) — the remote API may genuinely only use 7. Not fixed; flagged for a docs
  correction pass.
- **Stress mitigation pipeline, Context7 injection**: both independently confirmed
  fully wired and live (haiku audit + spot-checked), no action needed.

## Round 6: dead smart-cache field + dead API-client methods (PRs #443, #444)

- **`estimatedSavings` field on `CachePrediction` (`smart-cache.ts`)** — computed in
  all 4 `predictCacheHit()` return paths but never consumed by its only call site
  (`tool-execute.ts` ~663-719, which only reads `.shouldWarm`/`.confidence`/
  `.similarEntries`/`.reason`). Removed the field from the interface, all 4 return
  paths, and `local-modules.d.ts` (which was also separately missing
  `shouldCache`/`similarEntries` from its type declaration — a bonus pre-existing
  drift bug caught while touching the file). Investigated and initially edited by
  OpenCode Desktop live (dogfooding); reviewed the diff before accepting, found it
  correct. PR #443's CI caught 2 pre-existing tests (`test_ml_cache_mega.test.mjs`,
  `test_smart_cache_regression.test.mjs`) that asserted `typeof
  pred.estimatedSavings === "number"` as part of a structure check — updated both to
  drop the now-invalid assertion.
- **Dead `pricingFetch`/`blackboxCalibrate`/`blackboxCalibration` API client methods**
  (PR #444) — all three defined in `src/lib/api-client.ts` with zero callers anywhere
  in `src/` or `tests/`. Delegated the judgment call to OpenCode Desktop live (told it
  to STOP and report a recommendation before editing, given it had applied an edit
  without waiting once before on the smart-cache task — this time it correctly
  complied). Its recommendation: remove all three, update CLAUDE.md/README.md claims,
  leave the remote API server endpoints untouched (they may still be wired up
  server-side or reactivated later; only the dead client wrappers are gone). Verified
  the diff, typecheck, and zero remaining references before merging.
- **Follow-up spotted, not yet fixed**: `pricingLookup()` in `api-client.ts` is ALSO
  dead code (zero callers in `src/` or `tests/`) — same class of bug as the three just
  removed, but wasn't in the original approved scope so it was deliberately left alone
  rather than scope-creeping the PR. Flagged for a follow-up pass.

## Process notes
- CI job is `test (20)` running `npm run test:ci` -> `scripts/run-test-suite.mjs ci` (different, longer-running mode than local `npm test` -> `full`).
- Full local suite: 1669 pass / 0 fail baseline (before this session's 2 hang fixes), plus the 2 known-flaky timeout artifacts (now fixed).
- Marathon session strategy: see `/Users/drunkktoys/.claude/plans/plan-multiples-live-sessions-crystalline-castle.md` for the per-defect loop, cost-management rules, and backlog.
