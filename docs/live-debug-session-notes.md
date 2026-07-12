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

## Process notes
- CI job is `test (20)` running `npm run test:ci` -> `scripts/run-test-suite.mjs ci` (different, longer-running mode than local `npm test` -> `full`).
- Full local suite: 1669 pass / 0 fail baseline (before this session's 2 hang fixes), plus the 2 known-flaky timeout artifacts (now fixed).
