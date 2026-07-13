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

## Round 7
- **Cascade icon showed brain-depth (▸▸▸) while the model badge showed cheap** —
  user personally spotted this live in the footer. First fix attempt (trusting
  turn-ledger's `finalized.cascadeDepth`) was INSUFFICIENT — caught only by pulling
  the real production `turn-ledger.jsonl` for the exact session and finding that
  signal is itself polluted: turnId is keyed off the last routing decision, not the
  current conversational turn, so one real Task dispatch to brain at 08:15 had its
  turnId reused by 28 subsequent `turn.finalize` writes over the next 45 minutes, all
  still recording `cascadeDepth: 3`. Real fix (PR #450): `getLatestRouteEvent()` reads
  the RAW `turn.route` event's own timestamp directly from the ledger file (not the
  merged/re-touched view), and only trusts an elevated depth within
  `CASCADE_ROUTE_RECENCY_MS` (30s) of now; otherwise falls back to classifying the
  model actually displayed, never the route-path-derived tier (the same polluted
  signal `resolveActiveCascadeTier` uses). Verified against the live session data
  directly (not just test fixtures) before and after the fix. Required an OpenCode
  Desktop app restart to pick up the new plugin bundle — an already-open session kept
  running the old in-memory code and re-produced the stale depth even after deploy,
  which is expected (no plugin hot-reload) but worth remembering for future
  build→deploy→verify cycles.
- **`vibe diagnose` — first live verification ever this session** — found a genuine
  (if locally-scoped) misconfiguration: this repo's gitignored `opencode.json` had a
  plugin path pointing at a stale temp setup directory
  (`/private/tmp/vibeos-setup-*/`) from an earlier `setup`/test run, instead of the
  real deployed plugin path. Confirmed `opencode.json` is gitignored (not a shipped
  defect, purely local dev-machine cruft). Ran the suggested fix
  (`npx vibeostheog setup --project`), re-ran `diagnose` live, confirmed 13/13 checks
  now pass. Good end-to-end proof the diagnose→fix→reverify loop genuinely works.
- Note on driving the chat directly: asking the model in natural language to run
  `vibe diagnose` is NOT reliable — it substituted `action="status"` on the first
  attempt. Had to explicitly instruct it to call the tool with the exact action
  string before it actually exercised the command. Worth remembering when live-testing
  any trinity action this way: verify which action actually got called, don't trust
  the summary text alone.

- **Scratchpad cache-hit feature silently defeated by footer noise** (PR #451, the
  session's most valuable find so far) — `tool-execute.ts`'s `onToolExecuteAfter`
  prepends a live footer alert (savings/regime/XP/connectivity icon) onto virtually
  every non-task tool output, and `chat-transform.ts`'s `compressToolOutputs()` hashed
  that raw, footer-and-all string for its content-addressed scratchpad cache. Since
  the footer changes turn to turn, two calls reading the identical unchanged file
  almost never hashed the same, so cache-hit detection almost never fired session-wide
  (confirmed: `delegation-state.json` showed 0 `cache_hits` for the whole session
  despite many repeated reads; lifetime data showed only 42 hits ever recorded across
  33 historical sessions — the feature "works" occasionally by luck when the footer
  happens to be byte-identical between two calls, not reliably). Fixed by stripping
  the leading footer line before hashing (same regex as `tool-execute.ts`'s own
  `_stripLeadingFooter`, duplicated rather than imported to avoid a new
  `footer.ts`/`chat-transform.ts`/`tool-execute.ts` import cycle). Found by literally
  reading the same file twice live in OpenCode Desktop and diffing the two resulting
  `scratch/by-hash/*.txt` files byte-for-byte.
- **Minor, lower-priority schema mismatch (not fixed, just logged)**: `vibe axis`'s
  own error message advertises values like `strict|relaxed|required|optional`, but
  the `level` parameter's JSON schema enum only declares
  `["full","brief","off","on"]`. Tested live: `vibe axis tdd level="strict"` worked
  anyway (OpenCode doesn't appear to strictly enforce the enum), so no live user
  impact found, but the schema declaration doesn't match the documented values. Worth
  a follow-up pass to widen the enum or use a separate untyped field for axis values.

- **`vibe todo` returned a global cross-project dump instead of anything project-relevant**
  (PR #452) — live-tested `vibe todo` action and it reported "1,609 pending TODOs" in
  this small repo's session. `todos.json` (`$VIBEOS_HOME/todos.json`) is a single
  global file with zero project scoping; confirmed several of the 1609 entries
  reference `theog:instinct-v2`/`router.py`/M5-M1 model training -- clearly
  VibeBrainUltra content, not theSaver-oc. Same class of cross-project leak as the
  footer/scratchpad/PivotCache bugs found earlier. Fixed by adding an optional
  `projectFingerprint` field to `TodoEntry`, stamped on write by `upsertTodo()`, and a
  new `loadTodosForCurrentProject()` used only by the `vibe todo` action. **Correction
  (Round 9, PR #454): the "dashboard/MCP consumers deliberately left unscoped" call was
  wrong** -- live-driving `vibe dashboard` showed the same 1609-entry leak on
  `/dashboard/home`'s raw JSON. Not a deliberate design choice, just two call sites
  (`src/index.ts`'s `_dashboardSyncDeps.todos`/`getTodos`) that were missed when #452
  scoped the trinity-tool path. Fixed in the same PR. Legacy entries with no fingerprint
  are excluded from the scoped todo view rather than silently attributed to whichever
  project happens to be open.
- Live-verified several more trinity actions this round, all working correctly:
  `reality-check`, `verify-claims`, `patterns`, `axis status`/`axis <name> <value>`,
  `project`, `blackbox status`, `repair-state preview`, `guard` (correctly reported
  AGENTS.md/README.md already present, made zero file changes), `mode` (round-tripped
  vibemax -> vibeultrax cleanly), `help`.
- **Minor, not a plugin bug**: while live-testing, one sent message rendered with a
  stray "need" prefix ("needCall the vibe tool with action=..."). This is an artifact
  of the computer-use automation's typing interacting with OpenCode's own input-field
  autocomplete/placeholder text, not a vibeOS defect -- noted only so a future pass
  doesn't waste time chasing it as a plugin bug.

## Round 8 — cascade icon (real fix), scratchpad-cache footer pollution, todo cross-project leak

- **Cascade icon depth vs model mismatch**: first attempt trusted
  `turn.finalize`'s `cascadeDepth` as ground truth -- wrong, because
  `recordTurnFinalize`'s `turnId` is `state.latestTurnTruth.turnId` (the LAST
  known turnId, not tied to the current conversational turn), so a Task
  dispatch to brain at 08:15:24 had its `turnId` reused by 28 subsequent
  `turn.finalize` writes over 45 minutes, all still recording `cascadeDepth: 3`.
  Real fix: added `getLatestRouteEvent()` (turn-ledger.ts) reading the raw
  `turn.route` event's own `_ts` directly, and
  `clampCascadeDepthToTurnTruth()` (tool-execute.ts) which only trusts a route
  event's `cascadeDepth` if it's within `CASCADE_ROUTE_RECENCY_MS` (30s) of
  now; otherwise falls back to live-model-tier classification (not the
  route-path-derived tier, which was the actual pollutant). Also applied in
  `footer.ts`'s `ultraCascadeDepth` computation. PR #450, merged, live-reverified
  after restart: fresh session shows `cascadeDepth: 0` for a cheap-tier turn,
  no stray cascade icon.
- **Scratchpad cache-hit defeated by footer noise (this round's most valuable
  find)**: `compressToolOutputs` (chat-transform.ts) content-hashes tool
  output including the live footer line vibeOS itself prepends
  (`_prependFooterAlert`), which changes every turn (savings figures, XP,
  regime). So two calls with byte-identical *real* output never hashed the
  same, and the scratchpad cache-hit path (`getScratchpadHit` in
  tool-execute.ts) could never fire in practice. Fixed by hashing
  `_stripLeadingFooterForHash(raw)` instead of raw (stored content unchanged
  -- full raw output including footer is still what's written to
  `scratch/by-hash/<hash>.txt`). PR #451, merged.
- **`vibe todo` global cross-project leak**: `todos.json` had no project
  scoping at all -- a real user's file had 1,609 pending entries, most from
  unrelated repos (VibeBrainUltra), and `vibe todo` reported "1,609 pending"
  regardless of which project you were in. Fixed: `TodoEntry.projectFingerprint`
  field, `upsertTodo()` stamps it from `currentProjectFingerprint`, new
  `loadTodosForCurrentProject()` filters by it (falls back to the full list
  only when no fingerprint is set), trinity-tool.ts's `todo` handler uses the
  scoped loader. Legacy unscoped entries from other projects correctly
  excluded once a fingerprint is set. PR #452, merged, live-reverified after
  restart: fresh session's `vibe todo` now reports "No pending todos" instead
  of leaking unrelated-project entries.
- Logged, not fixed (no live impact found): `axis` action's `level` param
  JSON schema enum (`["full","brief","off","on"]`) doesn't match the actual
  axis values needed (`strict|relaxed|required|optional` etc.) -- OpenCode
  doesn't strictly enforce the declared enum, so it worked live anyway.
- Non-bugs ruled out this round: a "△12 verify" footer glyph (font rendering
  of `⚠` U+26A0, raw stored string was correct); a stale `▸▸▸` cascade icon in
  an already-open pre-restart session (confirmed stale in-memory plugin code,
  not a new bug -- OpenCode Desktop does not hot-reload the plugin, confirmed
  again this round); a "need" prefix in one message bubble (computer-use
  typing artifact).
- **Operational note reconfirmed**: OpenCode Desktop must be fully quit
  (`osascript -e 'tell application "OpenCode" to quit'`) and reopened
  (`open_application` with bundle id `ai.opencode.desktop` -- display name
  "OpenCode" alone is not resolvable by `request_access`) after every
  `npm run build` deploy; an already-running session keeps the old in-memory
  plugin code.
- **Pivot capture live-verified**: confirmed working via a real forward-pivot
  + pivot-back sequence in OpenCode Desktop. A quick 3-message test didn't
  show an immediate snapshot for the newest topic switch -- traced to
  `chat-transform.ts:1631-1634`, which deliberately gates pivot
  detection/injection to 1-in-5 turns or a sub_regime change (cost control,
  not a bug). Confirmed via direct inspection of
  `$VIBEOS_HOME/pivot-cache/<session>/.vibeos-pivot-cache.json` that the
  earlier real pivot (todo -> JSON-parser topic switch) WAS captured
  correctly (PR #438's fix already covers this; no new work needed).
- **Haiku-audited 3 more CLAUDE.md claims (items 8, 9, 20)**, findings
  verified directly:
  - Item 8 stress mitigation: fully wired (`scoreStress`, footer gauge,
    system-prompt inoculation, stress>1.5 tier upgrade all present and
    reachable). One doc-only inaccuracy: CLAUDE.md says stress "upgrades Task
    to MEDIUM"; the actual code (`cascade.ts` `QUALITY_STRESS_THRESHOLD`)
    upgrades all the way to `quality`/brain, which is stricter than claimed,
    not a defect -- not fixing, since the real behavior is safer than
    documented.
  - Item 9 context7 directive injection: fully wired and confirmed to vary
    with `context7_urgency` (`chat-transform.ts` `context7Directive()`).
  - Item 20 blackbox sub-regimes: confirmed real gap.
    `ResolutionTracker.SUB_REGIMES` (resolution-tracker.ts:7) lists only 11 of
    the 13 documented regimes (missing FORENSIC, AUDIT), and the tracker's own
    inline classify logic (lines 384-407) can only ever assign 7 of the 13:
    INIT, LOOPING, CLOSED, DIVERGENT, EXPLORING, REFINING, CONVERGING.
    IMPLEMENTING/RESEARCH/REVIEWING/DESIGNING/FORENSIC/AUDIT are only ever
    produced by the remote API's classifier, never by the local fallback
    tracker. Per CLAUDE.md, the API is authoritative and the local tracker is
    the fallback ONLY when the API is unreachable/slow -- so this gap is real
    but narrow: it only surfaces in degraded/offline mode, and fixing it
    requires designing 6 new heuristic classification branches with no
    existing spec for what distinguishes e.g. FORENSIC from AUDIT locally.
    Logging as a known gap rather than guessing at heuristics; same
    treatment as the already-logged `axis`/`level` enum mismatch.
## Round 9 (PR #454) -- dashboard todo/session leaks were bigger than #452 fixed, plus UX simplification

- **Live-driving `vibe dashboard` found the todo leak was NOT actually closed by #452.**
  `/dashboard/home`'s raw JSON still showed `"TODOs": 1609` with entries from an
  unrelated project. Root cause: `src/index.ts`'s `_dashboardSyncDeps` object had TWO
  call sites (`todos: loadTodos()` for the status payload, `getTodos: () =>
  loadTodos()` for the dashboard home model) that #452 never touched -- it only fixed
  the trinity-tool `vibe todo` action's own read path. Fixed both to use
  `loadTodosForCurrentProject()`.
- **The exact same leak class existed for SESSIONS, across THREE separate call
  sites**, none of which had ever been scoped or capped:
  1. `/sessions` (`buildLocalSessions()` in vibeos-mcp-server.ts) -- fed the standalone
     Sessions table.
  2. `/dashboard/home`'s own `sessions` array (`buildDashboardHomeModel()` in
     session-orchestrator.ts) -- fed Home's "Recent Sessions" card. This one bypassed
     `buildLocalSessions()` entirely, reading `getMergedSessionsMap(deps)` directly.
  3. Neither had a cap -- delegation-state.json had 32 tracked sessions total; the
     dashboard rendered them (or a hardcoded `.slice(0,5)`) with no real limit logic.
  - **Important difference from the todo fix**: for todos, entries with no
    `projectFingerprint` were confirmed old cross-project junk and excluded. For
    sessions, direct inspection showed the OPPOSITE: 25 of 32 real, genuinely recent
    sessions had never been stamped with `project_fingerprint` at all (stamping
    predates full wiring for some session-id formats) -- excluding them the same way
    would have hidden most of today's real activity. So the sessions fix only excludes
    a session with a CONFIRMED, different fingerprint; unscoped sessions are kept.
  - Both call sites now: filter (confirmed-different-project only), sort by
    `last_updated`/`started` descending (current session always pinned first), and cap
    to 10 -- matching what OpenCode Desktop's own sidebar shows, per the user's
    explicit ask.
- **Test-isolation finding along the way**: `dashboard-bridge.ts`'s projection cache
  reads a REAL disk file under `getVibeOSHome()` -- not scoped to `HOME` overrides used
  elsewhere in the test suite. A sessions-scoping test's `total_sessions` assertion
  silently picked up a stale cached projection from THIS live dogfooding session
  running concurrently, before the test isolated `HOME`. This is very likely also why
  `tests/dashboard-api.test.mjs` hangs/is flaky when run as part of the full suite
  (confirmed independently: it also hangs on unmodified master, in isolation, with no
  relation to this session's code changes) -- worth a dedicated follow-up to add
  `HOME` isolation to that file too, not fixed here (out of scope for this PR).
- **Dashboard UX simplification** (user request, mid-session): `Home.tsx` was a dense
  hero + ops-strip + controls-strip + mode-grid + overview-grid + detail-grid (4 more
  cards: current-session, todos, savings, recent-sessions-of-5). Consolidated into 3
  clearly labeled sections: **KPIs** (total/session savings, pending todos, session
  count, backend, model), **Orchestrator** (slot/mode/thinking/enforce/flow controls +
  the branded mode grid, one panel), **Running Sessions** (the now-correctly-scoped
  last-10 list, current session pinned first and badged). Live-verified against the
  running dashboard via DOM query (not full-page screenshot -- the Browser pane's
  scroll action was flaky/black-framed in this environment, unrelated to the app code;
  `get_page_text` and a `querySelectorAll` count confirmed exactly 10 session rows and
  1 current-badge, matching the real 25-total/10-shown backend numbers).

## Round 10 (PR #458, #459) -- session-timestamp gap, loop-guard blind spot for edit/write

- **Live-driving found `started_at: null` ("unknown start") for the CURRENT session**
  in the dashboard's Running Sessions list, while every other session showed a real
  timestamp. Root cause: two of the four functions that can be the FIRST writer to
  create a session's `delegation-state.json` record --
  `saveSessionStress()`/`recordSaving()` in `index-helpers.ts` -- never stamped
  `started`/`session_started_at`, unlike the other two initializers in `state.ts`
  (`recordDelegation`, `recordCacheSaving`, plus telemetry) which all do. Since either
  of the two buggy writers can fire before any of the correct ones on a brand-new
  session, and every writer uses `??=`/exists-guards, a session that hit this path
  first was stuck with no start time forever. Fixed both to stamp on first write. PR
  #458, merged, live-reproduced via direct `delegation-state.json` inspection before
  and after the fix.
- **Loop-guard blind spot: `edit`/`write` aren't in `SOFT_QUOTA`, so repeated FAILING
  edits are invisible to any loop/cost mechanism.** Live-reproduced by asking OpenCode
  Desktop to make a real edit: it retried a failing `edit` call **8+ times in a row**
  (each a full model turn) before self-recovering by re-reading the file. The existing
  bash-only `ToolLoopGuard.observe()` couldn't have caught this even if wired up,
  since each retry likely carried a different `oldString` guess -- an exact-repeat
  signature match wouldn't fire. Added `observeEditFailure(key)`/`clearEditFailure(key)`
  tracking consecutive failures per `tool:filePath`, independent of args, and wired it
  into `onToolExecuteAfter` to append an advisory nudge (not a hard block -- blocking
  edits outright risked breaking legitimate multi-step fixes) once the threshold is
  hit. PR #459, merged.
- **Release-branch version drift (real, recurring, not fixed at the workflow level)**:
  `scripts/release.mjs` pushes its version-bump commit to an unmergeable
  `release/vX.Y.Z` branch because CI's `GITHUB_TOKEN` can't push to protected
  `master`, and nothing merges that branch back. This left `master`'s `package.json`
  one release behind published npm/GitHub versions TWICE in a row (v0.26.2, v0.26.3),
  and each time caused the next release run to recompute the same "next version" and
  fail with `tag already exists`. Fixed via two narrow follow-up PRs (#456, #457) that
  synced only the version + CHANGELOG delta -- deliberately NOT merging the full
  release branch, which was cut from a stale master and would have reverted several
  already-merged fixes/tests (confirmed via diff before doing anything). The
  underlying workflow gap (no auto-merge-back) is flagged, not fixed -- needs explicit
  sign-off before touching `release.yml`/`scripts/release.mjs`.
- **GitHub-side PR wedge (process note, not a vibeOS bug)**: PR #454 got CI and
  mergeability computation permanently stuck after its last two commits (no workflow
  run fired, `refs/pull/454/merge` never got created, close/reopen didn't unstick it)
  despite the branch merging cleanly with zero conflicts against a *stale* local test.
  Root cause of the false "clean merge" read: the verification clone's `origin` remote
  was still pointed at the local disk path, not the real GitHub repo, so it never
  tested the actual current `origin/master` -- re-testing against the real remote
  showed a genuine content conflict in this notes file (two rounds' sections appended
  at the same spot). Fixed by resolving the conflict for real and opening a fresh PR
  (#455) from a new branch, which got a working CI/merge pipeline immediately.
- **Non-bugs ruled out this round**: `axis status` initially got a "What did you mean
  by axis?" non-response from the model -- confirmed as a cheap-tier model
  instruction-following miss, not a tool-schema bug, since a more explicit prompt
  immediately called it correctly. `repair-state preview` showing
  `active_slot: brain` vs `selected_slot: cheap` drift was the CORRECT, working
  result of an intentional `vibe set brain <model>` call earlier in the session
  followed by the documented cascade auto-reconcile (simple prompts route to cheap
  per-turn unless locked) -- not a bug. A stray `undefined/opencode.json` +
  `undefined/.vibeOS-locks/` directory pair was found in the repo root (gitignored,
  harmless) but its provenance couldn't be conclusively pinned to a vibeOS code path
  in the time available -- flagged as an open lead, not chased further. `diagnose`
  correctly found a real stale plugin-path registration in the project's root
  `opencode.json` (pointing at a deleted `/private/tmp/vibeos-setup-*` test sandbox)
  and its suggested repair (`vibeostheog setup --project`) genuinely fixed it,
  confirmed via a second `diagnose` call showing "Plugin path repaired since last
  call." Flow TODO-extraction appearing not to fire for a real edit was explained by
  `flow_enforce` legitimately being `false` at the time (auto-mode's regime-driven
  control vector), not a bug -- the status line's "(extract)" suffix only appears
  when both `flow_enabled` and `flow_enforce` are true, and it was accurate.

## Process notes
- CI job is `test (20)` running `npm run test:ci` -> `scripts/run-test-suite.mjs ci` (different, longer-running mode than local `npm test` -> `full`).
- Full local suite: 1669 pass / 0 fail baseline (before this session's 2 hang fixes), plus the 2 known-flaky timeout artifacts (now fixed).
- Marathon session strategy: see `/Users/drunkktoys/.claude/plans/plan-multiples-live-sessions-crystalline-castle.md` for the per-defect loop, cost-management rules, and backlog.
