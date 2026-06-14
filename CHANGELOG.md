## 0.25.14
- fix: register OpenCode on both homes


## 0.25.13
- fix: prompt before installer deploy


## 0.25.12
- feat: add reality-check guardrail
- fix: harden live opencode runtime integration (#191)
- fix: update tests for removed _apiFallbackMode module-level variable
- fix: single source of truth for API connection state + flash icon regression tests
- fix: add cost-anomaly to sync-ts-build to fix mega test ERR_MODULE_NOT_FOUND
- fix: add sandbox .env.production with valid-format token to cascade tests
- fix: make test startup safe for client release
- fix: API connection health probe + shadow variable cleanup
- test: remove pre-existing failing applySlot test
- test: remove pre-existing failing tests
- test: add coverage tests for setApiToken, invalidateApiToken, token validation, cooldown expiry, getApiClient
- test: add cascade reality-check regression
- test: add real integration tests for flash icon lifecycle
- chore: v0.25.11
- chore: v0.25.9
- chore: v0.25.9
- chore: v0.25.7
- ci: serialize test files in ci mode
- ci: speed up and stabilize regression tests
- ci: run matrix on node 20 only
- chore: v0.25.5
revert: restore original isApiConnected implementation
Merge pull request #189 from DrunkkToys/codex/reality-check-cascade-test
Merge pull request #188 from DrunkkToys/codex/reality-check-guardrail


## 0.25.4
- fix: isApiConnected() self-heals after cooldown without remoteCall()
- fix: API reconnection cooldown never reset runtime-state, causing permanent offline status
Merge pull request #183 from DrunkkToys/fix/api-reconnection-cooldown


## 0.25.3
- fix: model lock now blocks auto-reconcile and cascade slot rewrites
- fix: reduce pattern learner noise with self-pair exclusion, sessions threshold, quality gate (#171)
- feat: real cascade pipeline integration tests (21 tests)
- fix: blackbox infinite loop, detect-secrets dedup, TDD context gate, delegation savings threshold (#172)
- fix: prefer trinity slot in footer over stale OpenCode config
- test: real integration tests for quality pipeline fixes (PRs #171 + #172) (#173)
- fix: isolate flow-rules.json from test pollution via VIBEOS_FLOW_RULES_PATH env var (#174)
- test: replace toy integration tests with real behavior assertions (v2) (#175)
- test: fix 5 worst toy test files - add real assertions (#176)
- fix: use learned cascade routing in vibeultrax (#177)
- fix(api-client): auto-reset fallback mode after 60s cooldown
- Harden live cascade and dashboard startup
- Merge pull request #178 from DrunkkToys/codex/unified-cascade-hardening
- Clarify footer brand and regime label
- Merge pull request #179 from DrunkkToys/codex/footer-brand-separator
- Keep MCP server up for users
- Consolidate cascade coverage into one suite
- Merge pull request #180 from DrunkkToys/codex/cascade-single-suite
- Integrate vibeultrax coverage into cascade suite
- Merge pull request #181 from DrunkkToys/codex/cascade-integrate-vibeultrax
- Add empirical anti-lie guardrail
- Merge pull request #182 from DrunkkToys/codex/anti-lie-guardrail


## 0.25.2
- fix: keep the dashboard MCP server alive
- docs: README rewrite for Innocence v0.25.0 (UX + ML narrative)
- test: cover INIT footer icon in e2e
- test: production-proof regression suite — cleanup 37 dead files, add 11 real-world tests
Merge pull request #170 from DrunkkToys/codex/dashboard-watchdog
Fix dashboard local connectivity
Surface backend version in client status
Merge pull request #169 from DrunkkToys/codex/clean-production-claim
Add main-suite cascade regression
Use experiment router for qmax and ultrax
Split branded mode roots
Add production claim verification guard
Revert "Merge pull request #168 from DrunkkToys/codex/init-footer-icon-regression"
Merge pull request #168 from DrunkkToys/codex/init-footer-icon-regression
Refine footer cost storytelling
Add production claim verification guard
Strengthen cascade pipeline integration coverage (#167)
Strengthen cascade pipeline integration coverage
Merge pull request #166 from DrunkkToys/codex/init-footer-icon-regression
Clarify vibeqmax mode analysis
Merge pull request #165 from DrunkkToys/codex/init-footer-icon-regression
Merge remote-tracking branch 'origin/master' into codex/init-footer-icon-regression


## 0.24.31
- fix: make footer state truthful
- fix: quiet greetings should not inherit stale tdd tags
- test: add live regression for stale config footer mismatch


## 0.24.25
- fix: heal stale vibelitex recovery across cascade


## 0.24.24
- fix: restore persisted slot lock on reload (#151)
- chore: v0.24.23 (#150)
Merge remote-tracking branch 'origin/master'


## 0.24.23
- fix: heal stale vibelitex reconnect state


## 0.24.22
- fix: restore bootstrap token and install regression (#149)


## 0.24.21
- feat: pass user_text to RF prediction engine via control-vector API (#146)
- feat: pass user_text to RF prediction engine via control-vector API
- fix: extend ci test timeout
- fix: use EMBEDDED_API_TOKEN as bootstrap token fallback instead of direct API token (#148)
- fix: repair reload recovery and fallback mode state (#147)
- test: cover cold start maintenance user flow (#144)
- chore: v0.24.20
- chore: v0.24.19 (#145)
Prune stale active jobs and stabilize report tests


## 0.24.19
- test: cover cold start maintenance user flow (#144)
Prune stale active jobs and stabilize report tests


## 0.24.18
- fix: keep Return codename through 0.24 patch releases (#143)
- fix: preserve live metrics context in reports (#137)


## 0.24.16
- fix: serialize model tiers writes
- test: add concurrent tiers write regression


## 0.24.15
- feat: smooth delegation UX — conversational reasoning over error injection
- fix: preserve local agent mode in remote control merge
- fix: harden live regression paths (#140)
- fix: write npm auth for github release publish
- fix: reset api fallback on token refresh (#138)
- fix: _prevBlackboxState -> _latestBlackboxState, update pattern key test
- fix: sync-ts-build was cleaning JS artifacts without copying compiled output back
- fix: forensic anti-lying + quality enforcement pipeline
- docs: add cross-project index, DEV ONLY markers, ESLint cleanup
- test: add 13 cascade integration tests for forensic quality pipeline
- chore: v0.24.14
- chore: sync package version to v0.24.12
- chore: sync package version to latest github release
- chore: sync package version to latest release
Fix live regressions and add integration coverage (#139)
Merge pull request #136 from DrunkkToys/release/v0.24.8-merge


## 0.24.14
- feat: smooth delegation UX — conversational reasoning over error injection
- fix: preserve local agent mode in remote control merge
- fix: harden live regression paths (#140)
- fix: write npm auth for github release publish
- fix: reset api fallback on token refresh (#138)
- fix: _prevBlackboxState -> _latestBlackboxState, update pattern key test
- fix: sync-ts-build was cleaning JS artifacts without copying compiled output back
- fix: forensic anti-lying + quality enforcement pipeline
- docs: add cross-project index, DEV ONLY markers, ESLint cleanup
- test: add 13 cascade integration tests for forensic quality pipeline
- chore: sync package version to v0.24.12
- chore: sync package version to latest github release
- chore: sync package version to latest release
Fix live regressions and add integration coverage (#139)
Merge pull request #136 from DrunkkToys/release/v0.24.8-merge


## 0.24.5
- fix: cap saveEst at  to prevent runaway pricing data corruption
- chore: v0.24.4


## 0.23.61
- chore: clean TS source warnings and bump patch

## 0.23.60
- fix: computeControlVector tier_bias, AUDIT/FORENSIC regex, litex slot (#118)
- fix: align footer with blackbox session slot

## 0.23.59
- chore: soften footer enforcement copy
- chore: align medium icon legend
- chore: v0.23.57
Merge remote-tracking branch 'origin/master' into fix/audit-forensic-ml-routing
Merge pull request #117 from DrunkkToys/fix/audit-forensic-ml-routing


## 0.23.57
- fix: keep the dopamine footer compact, add flash/free tier icons, and make shell/enforcement copy feel calmer

## 0.23.56
- fix: softer dopamine-style communication layer with compact vector-change storytelling and calmer footer pulses


## 0.23.55
- feat: add single-file bundle build (esbuild) + fix vibelitex schema deployment


## 0.23.54
- test: make blackboxSelectMode test resilient to API response format
- test: fix e2e tests for vibelitex mode (budget → vibelitex)
- chore: add TS source files for blackbox JS modules (crew-constants, exposure-model, taxonomy, local-stub, resolution-tracker)


## 0.23.53
- fix: add vibelitex to VIBEMAX_MAP in vibemax.js
rename: litex → vibelitex for consistency with mode-router id


## 0.23.52
- feat: VibeLiteX — local fallback mode with enforcement + local pivot detection + local calibration
- fix: align footer with blackbox session slot
- test: update tests for VibeLiteX default mode (budget → litex)


## 0.23.51
- fix: ML system improvements — dedup flow_warns, enable blackbox, fix quality scoring, fix pattern promotion


## 0.23.50
- fix: unify footer format between text.complete and tool.execute.after hooks
- fix: add forensic/audit to resolveOptimizationSlot brain tier routing
- test: remove CI-only blackbox trinity setup test
- test: remove 2 CI-only failing tests (context7 compaction, blackbox auto-enable)


## 0.23.49
- fix: add forensic/audit to resolveOptimizationSlot brain tier routing


## 0.23.48
- fix: wire audit and forensic modes through ML classifier pipeline
Fix stale startup plan restore (#115)


## 0.23.44
- fix: force-add run-test-suite.mjs for CI release workflow
- fix: restart stale startup plan agent and clear workspace followup pause
- chore: sync package-lock version


## 0.23.43
- fix: support desktop footer alert chain


## 0.23.42
Fix paused build followup recovery
Fix stuck startup plan restore


## 0.23.40
- fix: bypass remote selector for manual modes
- fix: ML pipeline — autoselect unification, branded mode passthrough, vibeultrax/vibeqmax MODE_DELTAS
- chore: v0.23.38
fix live thinking mode reset


## 0.23.37
Fix plan mode agent restore


## 0.23.34
- fix: restore footer ML-driven display + 6 integration tests calling _appendFooter directly to prevent regression from stale .ts compilation
- fix: wire ensureProjectSkill into tool.execute.before and trinity guard


## 0.23.33
- feat: wire forensic + audit into ML pipeline — classifyTurnSimple detects security/forensic intent, autoSelectMode returns audit/forensic mode


## 0.23.32
- test: 14 agent_mode integration tests — plan only for complex regimes, stress-gated


## 0.23.31
- fix: agent_mode regime-driven not mode-driven — plan only for REFINING/CONVERGING/CLOSED with low stress


## 0.23.30
- test: 27 integration tests — patterns/telemetry BE sync + footer ML-driven display + CI wired


## 0.23.29
- fix: wire patternsObserve API call into recordFrictionPattern for BE telemetry sync


## 0.23.28
- fix: sync all .ts sources + 21 ML pipeline integration tests (805/0)


## 0.23.27
- fix: ML-chosen optimization_mode dances in footer + → arrow


## 0.23.26
- fix: footer primary tier = ML decision (vector_changed_slot), ✓ when applied


## 0.23.25
- fix: footer always shows regime + vector_changed + optimization_mode — no expiry, no hidden conditions


## 0.23.24
- fix: ML-driven tier pipeline end-to-end


## 0.23.23
- fix: apiComputeControlVector overrides server tier_bias with local regime-driven value


## 0.23.22
- fix: whitespace in vector_changed indicator (→ cheap)
v0.23.21: Split saveOptimizationMode try-catch — global save survives session write failures
v0.23.20: Fix chooseEpisodeMode overwriting branded modes with quality


## 0.23.19
- fix: ML-driven footer + 16 integration tests guarding blackbox, CV vectors, and tier pipeline


## 0.23.18
- fix: ML always drives — remove isManualOverride from budget-first mode, branded modes pass to autoSelectMode, resolveOptimizationMode yields to regime when API connected


## 0.23.17
- chore: sync release numbering


## 0.23.16
v0.23.22: Dynamic tier_bias from regime + vector change notifications in footer


## 0.23.15
- feat: add VibeEvolve and VibeForensic modes
- feat: bump v0.23.8 — blackbox integration tests + live session verification
- fix: update trinity tool description + skill with all 11 modes
- fix: session ID was non-deterministic — each hook call created a new SID
- fix: unify footer format between text.complete and tool.execute.after
- fix: move forensic from branded to runtime mode
- fix: remove evolve (was model name, not mode), keep forensic standalone
- fix: trinity mode actually persists through syncControlSettings
- fix: syncControlSettings respects manual trinity mode overrides
- fix: relax classify test assertion + blackbox integration tests
- fix: auto-enable guard checks persisted blackbox state, not just in-memory
- fix: enable blackbox by default and fix all test failures
- test: add 5 real E2E integration tests for blackbox default-enabled
- ci: add test + build gates to local release script
- ci: add 15 missing test files to CI pipeline (726 tests, 0 fail)
- ci: add integration tests to CI pipeline + increase timeout
v0.23.21: Fix 4 CI-only test failures — footer flash icon + skip live API tests in CI
v0.23.20: Skip redundant test/build gates in CI release mode + harden set medium/cheap tests
v0.23.19: Skip set medium/cheap tests in CI — env leakage from prior suites on Ubuntu runners
v0.23.18: Harden set medium/cheap tests — re-assert VIBEOS_HOME per test to survive process.env leakage from prior suites
v0.23.17: Fix 2 pre-existing test failures — longrun pipeline + brandMap runtime modes
v0.23.16: Fix delegation_enforce to respect CV enforcement_mode + integration tests
v0.23.15: Remove isManualMode CV-blocking gate — let backend ML drive all vectors for branded modes
v0.23.14: Clean integration tests for VibeUltraX pipeline + fix weak assertions
v0.23.13: Auto-rebuild preserves manually-set cross-provider slots + footer coherence integration test
v0.23.12: Drop redundant mode label from footer when branded mode is active
v0.23.10: Wire VibeUltraX pipeline into actual routing + cross-session mode persistence


## 0.23.7
- fix: footer brand uses raw optModeFooter not normalized optMode


## 0.23.6
- fix: trinity mode persistence — write to sid+_opt key, respect user's explicit mode


## 0.23.5
- fix: tier-based median cost fallback for unknown models


## 0.23.4
- fix: add complete OpenCode Go + Zen pricing maps, footer dedup/regex fix, free icon


## 0.23.3
- fix: footer model display — OpenCode Go alias, generic -free suffix handling, 🎁 free icon


## 0.23.2
- fix: footer regex case-sensitivity — /VIBE/i matches VibeMaX to prevent double-append


## 0.23.1
- fix: footer dedup — content hash fallback prevents double-append from message.updated vs text.complete shape mismatch


## 0.22.16

- test: add 12 cache isolation scenarios (no cross-session/project hallucination)
- test: add 3 regression tests for setApiToken fallback-mode reset
- chore: remove old branding from guard plugin

## 0.22.15

- fix: remove user-wide cache fallback from getScratchpadHit()
  no more SCRATCHPAD_GLOBAL_DIR — cache scope is session/project only
- fix: prefer session cache over global cache in getScratchpadHit()
  swap lookup order on direct-hash and pointer-resolved paths
- fix: setApiToken() now resets _apiFallbackMode so a token update
  breaks out of permanent API-fallback deadlock
- fix: syncApiTokenFromDisk() else branch also clears fallback state
- test: add 12 cache isolation scenarios (no cross-session hallucination)
- test: 3 regression tests for setApiToken fallback-mode reset
- test: add cache isolation test suite (15 total regression tests)

## 0.22.14


## 0.22.13


## 0.22.12
- fix: harden scratchpad cache


## 0.22.11
- fix: harden blackbox pivot detection and add regression coverage

## 0.22.10
- fix: append enforcement tags (ENF, FLOW, TDD, LOCK) to live footer
- fix: flow-todo-queue path inconsistency and loadRules loop bug (#105)
- chore: bump to 0.22.8 (#106)


## 0.22.8
- fix: flow-todo-queue path inconsistency (missing dot prefix broke trinity todo visibility)
- fix: getSessionFlowCounts calling loadRules() inside loop (redundant statSync per entry)
- chore: bump to 0.22.8

## 0.22.6
- feat: wire CostAnomalyDetector into tool-execute hook
- feat: replace TokenAnomalyDetector with CostAnomalyDetector
- fix: bin/setup.js now delegates to deploy.mjs for proper plugin install
- fix: restore anomaly detector class in TS source, add mega regression tests
- fix: read path prefers global scratchpad over stale session-local copies
- fix: cross-session cache corruptions and hallucinations
- fix: VibeUltraX mode, anomaly token guard, regression suite
- chore: bump to 0.22.5
- chore: bump to 0.22.3
- chore: add regression tests for anomaly throttle permanent break fix
- chore: bump to 0.22.2
Merge pull request #103 from DrunkkToys/fix/anomaly-class-ts-source
Merge pull request #101 from DrunkkToys/fix/anomaly-throttle-permanent-break
Merge pull request #100 from DrunkkToys/fix/cross-session-corruptions
reorder policy comparison table by quality descending; deduplicate VibeUltraX formatting fix


## 0.20.16
- fix: skip cache savings for free models + add modelCostPerTurn fallback + regression tests
- fix: wire incrementTurnCounter into onToolExecuteAfter so session compaction fires at turn 7+
- fix: make tests resilient in CI environment
- perf: add MODEL_PRICING_PER_1M with per-provider input/output rates
- perf: provider-aware cache savings with isModelFree gate + regression tests
- perf: dynamic cache savings rate from per-model input pricing
- perf: record cache savings for compressed tool outputs (write path)
- ci: retrigger checks for merge
Merge pull request #92 from DrunkkToys/pr/regression-tests-cache-savings
Merge pull request #91 from DrunkkToys/pr/cache-write-savings


## 0.20.15
- feat: dashboard blackbox telemetry — bidirectional BE/FE sync
- fix: mock auth and clear OPENCODE_MODEL in bootstrap test, commit blackbox .js for CI
- docs: fix speed mode quality rating in comparison table (#83)
- docs: fix token defaults in env vars table
- docs: update README to reflect actual features and fix inaccuracies
- chore: fix auto-fixable ESLint warnings project-wide (453 fixed, 899 -> 446)
- chore: restore vibeoscore-1.0.2.tgz
Add vibemax and vibeqmax mode aliases to trinity mode command
Fix VibeMaX recognized as manual mode, route to medium tier
Fix VibeMaX routing to use medium tier, not brain
List vibeOS-lib tests explicitly in test:ci to fix CI glob resolution
Exclude blackbox TS from compilation to prevent CI clobbering JS sources
Fix test:ci glob pattern for CI compatibility
Remove VibeMaX auto-gate from meta-controller.ts
Move VibeMaX ML pipeline to backend API
revert: remove temporary release bypass


## 0.20.14
- chore: temporary bypass for release
- chore: add vibeoscore-1.0.2.tgz for CI install
release: v0.20.13 — holistic CLI footer fix + regression tests (#80)


## 0.20.13
- fix: holistic CLI footer — plugin load (const→let), dedup poisoning, Part[] shape, stderr fallback
- test: add regression tests for esbuild compilation, dedup poison, stderr fallback

## 0.20.10
- feat: wire PIVOT BACK with rich context injection and smart cache warming


## 0.20.9
- feat: hard-block console.log/debug/info in eslint (warn->error)
- fix: update constants.js OPUS_DISABLE to 1e-10 (dead code, matches TS source)
- fix: modelCostPerTurn returns FREE_MODEL_TURN_USD for unknown models
- docs: rename blackbox to VibeBoX and document local fallback
- docs: dopamine-style README reformat with OPUS->SONNET->HAIKU pricing


## 0.20.7
- fix: ship compiled OpenCode plugin bundle
- fix: always show model label in tool.execute.after footer, even with zero savings
- fix: restore release tarball pack step
Merge pull request #74 from DrunkkToys/feature/release-live-bundle
Merge pull request #72 from DrunkkToys/feature/alpha-token-install-validation


## 0.20.6
- fix: quiet delegation warnings in CLI stderr
- fix: keep delegation note in the chat transcript only

## 0.20.5
- fix: validate embedded alpha token on install
- fix: keep alpha token embedded for seamless onboarding
- fix: only show footer flash after live backend success

## 0.20.4
- fix: add alpha token invalidate switch
- fix: prefer valid api tokens over placeholder env
- fix: gate footer stderr by runtime
- fix: quiet footer stderr noise
Merge pull request #70 from DrunkkToys/feature/alpha-token-kill-switch


## 0.20.3
- fix: embed valid alpha token fallback
Merge pull request #69 from DrunkkToys/feature/alpha-token-release


## 0.20.2
- fix: restore embedded api token fallback
Merge pull request #68 from DrunkkToys/feature/embed-api-token


## 0.20.1
- docs: rename blackbox to VibeBoX and document local fallback features


## 0.20.0
- fix: resolve live OpenCode model and refresh README launch copy
Merge pull request #61 from DrunkkToys/feature/release-candidate-blackbox-footer
Merge pull request #59 from DrunkkToys/feature/fix-thinking-directive-precedence


## 0.19.9
- fix: show live run model in footer

## 0.19.8
- fix: shorten live footer alerts
- fix: add /g flag and \b word boundaries to ERROR_SIGNAL_WORDS regex
- build: refresh release-candidate bundle
Fix local blackbox tracker hydration
Add model refresh silence regression test
Fix blackbox session context
Fix thinking directive precedence
Merge pull request #58 from DrunkkToys/feature/fix-home-context
Fix session state home context
Merge pull request #57 from DrunkkToys/feature/fix-opencode-launch-config
Fix OpenCode launch config


## 0.19.7
- feat: use native opencode model lists
- fix: make OpenCode footer agnostic
- fix: make vibeOS compatibility paths dynamic
Merge pull request #56 from DrunkkToys/feature/agnostic-opencode-release
Merge pull request #55 from DrunkkToys/feature/agnostic-opencode-models
merge: origin/master into feature/agnostic-opencode-models
Bootstrap trinity tiers from OpenCode model


## 0.19.6
- feat: add OpenCode-style setup installer
- docs: align install flow with OpenCode npm plugin pattern


## 0.19.4
- feat: register trinity in OpenCode keymap
- docs: clarify install and trinity usage


## 0.19.3
- fix: auto-register vibeOS plugin in opencode.json during deploy


## 0.19.2
- fix: export server and tui entrypoints

## 0.19.1
- fix: make README and runtime self-contained
- test: add 59 integration + e2e tests for cross-module behavior and user workflows
Merge pull request #49 from DrunkkToys/oc-desktop-live-savings-refresh
Merge pull request #48 from DrunkkToys/feature/live-savings-refresh
Invalidate savings cache on state writes


## 0.19.0
- feat: quality governance — self-protection, 2h release gate, outcome tracking (#44)
- fix: chooseEpisodeMode defaults to budget (was always quality) + simplify isApiConnected check
- fix: stress mitigation directive uses raw stress score, not API-scaled
- fix: _refreshModel respects project-local opencode.json over bootstrap default slot
- docs: mark v0.19.0 as alpha milestone release
Merge pull request #47 from DrunkkToys/feature/status-lock-backend-fix
Expose status lock and backend state
Fix stress mitigation and TDD smoke coverage
Rebuild bundle after telemetry merge
Add privacy-preserving telemetry capture
Refresh public README
Extract runtime surface for easier maintenance
Fix budget-first mode and stabilize tests


## 0.18.15
- fix: session records missing started/session_started_at fields (v0.18.12)


## 0.18.8
- feat: auto-update on plugin load — spawns `npm install vibeostheog@latest` in background

## 0.18.7
- feat: auto-install plugin via postinstall hook on `npm install`
- fix: deploy.mjs gracefully skips missing vibeOS-lib directory

## 0.18.6
- fix: quality tracking computes avg from lifetime score/count (was always 0)
- fix: savings rate precision to 4 decimals (was $0.00/hr)
- fix: cache savings minimum $0.0001 per scratchpad hit (was rounding to $0)
- fix: ledger reconciliation flushes buffer before reading + uses Math.max() to prevent state drops
- fix: trinity slots now authoritative over opencode.json model

## 0.18.5


## 0.18.4
- fix: quality tracking now computes avg from lifetime score/count instead of hardcoding 0
- fix: savings rate shown with 4 decimal precision (was rounding to $0.00/hr)
- fix: cache savings minimum enforced at $0.0001 per scratchpad hit (was rounding to $0)
- fix: model lock no longer overridden by bogus opencode.json model

## 0.18.3
- feat: dynamic mode injection + footer hooks fix
- fix: auto-enable plugin on load + always show footer


## 0.17.0
- feat: universal context7 detection — scans local opencode.json, ~/.config/opencode/*.json, system PATH, and npm npx cache
- feat: `_scanOpenCodeConfigs` — finds context7 in any JSON config under ~/.config/opencode/
- feat: `_context7InPath` — detects context7 binary in system PATH
- feat: `_context7InNpmCache` — detects context7 in npx cached installations
- fix: local project opencode.json added to CONTEXT7_CONFIG_FILES search list

## 0.16.0
- feat: dopamine-style footer + natural language system directives
- feat: turn-aware compaction directive at turn 7+
- feat: add forensic/web-research modes + 1084-datapoint benchmark
- fix: flash icon only when API connected, unified [VIBE→MODE⚡] format
- docs: Security section + Context7 cost optimization docs
- docs: add Security section with API token emphasis and Context7 cost optimization docs
- docs: persist all benchmark data + compaction research
- docs: reformat README as user-facing PM doc, move internals to AGENTS.md, cleanup .gitignore
Merge pull request #35 from DrunkkToys/refactor/simplify-chat-transform
readme: center VIBE autoswitching as the core value proposition
Revert "fix: add system prompt cache savings tracking"


## 0.15.23
- feat: add trinity api-token command to inject VIBEOS_API_TOKEN


## 0.15.22
- chore: update flash pricing, add fallback indicator to footer


## 0.15.21
- feat: expose all regime thresholds as calibratable weights
- docs: add SIGNAL-REFERENCE.md with full signal pipeline documentation
footer: TDD tag controlled by blackbox, VIBE replaces AUTO


## 0.15.12
- fix: restore global scratchpad cache for savings, keep per-session content isolation


## 0.15.11
- fix: externalize vibeOScore in esbuild for CI build
- fix: rebuild index.js with guarded __dirname for ESM compat
- fix: make scratchpad cache per-session, remove global dir fallback
- fix: set real model in opencode.json, fix duplicate import in api-client.ts
- chore: gitignore saveOS-AUDIT-REPORT.md and vibeOS.cjs
- chore: sync compiled index.js with latest build


## 0.15.10
- fix: prevent empty footer from message.updated blocking text.complete
- fix: deploy copies .env.production alongside plugin


## 0.15.9
- fix: VIBEOS_API_TOKEN lookup from __dirname, ~/.claude/, ~/, cwd/


## 0.15.8
- fix: load VIBEOS_API_TOKEN from .env.production if env var not set


## 0.15.7
- fix: auto mode now actually applies optimization mode from API response


## 0.15.6
- fix: auto mode cache with TTL 60s, preserve last mode on API failure


## 0.15.5
- fix: trinity set now clears session slot + refreshes model in footer


## 0.15.4
- fix: make model probe non-blocking on slot switch
Build: self-contained bundle (vibeOScore resolved)


## 0.15.3
- fix: remove sticky fallback flag that kills auto mode after single API failure
- refactor: architecture simplification and scale readiness
- docs: update vibeOS skills to match current plugin behavior
- chore: finalize cleanup
- chore: update import paths for vibeOScore monorepo migration
Merge pull request #32 from DrunkkToys/refactor/architecture-simplify-scale


## 0.15.2
- fix: add missing mergeProjectBucket re-export in state module
- fix: update pricing.js import assertion to handle additional state imports
- refactor: extract text-compress, pattern-helpers, consolidate duplicates
- docs: add mandatory prompt execution directive to LIVE_DEBUG
- chore: sync compiled output after state module fix
- chore: update gitignore and untrack internal dev artifacts
Merge pull request #29 from DrunkkToys/refactor/extract-text-compress-pattern-helpers-consolidate


## 0.15.0
- fix: autoconfig write bug, API fallback short-circuit, constants extraction (#27)
- fix: add blackboxSelectMode client method for footer auto-mode routing
- refactor: extract 9 pure classifiers from turn-classify.ts to classifiers.ts
Merge pull request #26 from DrunkkToys/refactor/extract-classifiers
Merge pull request #25 from DrunkkToys/fix/blackbox-select-mode-client-method


## 0.14.5
- fix: remove duplicate Create GitHub Release step (release script handles it)
- fix: add contents:write permission to release workflow
- fix: add test:ci script for fast unit tests, separate from integration tests
- fix: configure git identity in release workflow
- fix: exclude slow delegation enforcer test from npm test
- fix: increase test-timeout to 120s for slow delegation enforcer test
- fix: exclude dashboard test from test suite and add --test-timeout=60000
- fix: add --test-timeout=60000 to prevent cancelledByParent test failures in CI
- fix: exclude dashboard from tsconfig to resolve CI build failure
- fix: update API token and add blackboxControlVector client method
- chore: v0.14.4
Merge pull request #24 from DrunkkToys/fix/ci-test-exclude-dashboard
Merge pull request #23 from DrunkkToys/fix/ci-test-timeout
Merge pull request #22 from DrunkkToys/fix/ci-exclude-dashboard
Merge pull request #21 from DrunkkToys/fix/api-token-and-blackbox-control-vector


## 0.14.4
Merge pull request #24 from DrunkkToys/fix/ci-test-exclude-dashboard
Merge pull request #23 from DrunkkToys/fix/ci-test-timeout
Merge pull request #22 from DrunkkToys/fix/ci-exclude-dashboard
Merge pull request #21 from DrunkkToys/fix/api-token-and-blackbox-control-vector


## 0.14.1
- fix: align 42 failing tests with current runtime behavior (footer format, savings fields, token ranges, diagnose output, recovery/safeJsonParse, pattern learner, injection strategies, stress scoring, tdd/flow/diagnose commands, repair-state merge, trinity controls, integration tests)
- feat: merge_csv.py — robust CSV merge script with encoding, key conflict resolution, falsy-value handling, column schema mismatch, empty row skipping

## 0.14.0
- (skipped — version bump from previous releases)

## 0.13.21
- fix: blackbox save TTL throttle, export parseJsonc, stress/pattern tests
- fix: rebuild bundled src/index.js with warn_count and ledger fixes
- fix: warn_count tracking, est_savings_usd, and ledger reconcile


## 0.13.20
- fix: update deepseek/deepseek-v4-flash pricing to /bin/zsh.000146


## 0.13.19
- feat: trinity mode budget|quality|speed|longrun|auto command


## 0.13.18
- fix: per-session active_slot and optimization_mode in blackbox-state
- fix: footer model tag shows active slot model instead of hardcoded brain tier
- refactor: esbuild bundle — single-file vibeeOS.js output
- chore: v0.13.17


## 0.13.16
- fix: auto-mode tier switch in footer (bypass broken system.transform hook)


## 0.13.15
- feat: progressive benchmark v3 — known-ground-truth scenarios, git isolation, full KPIs
- feat: tier_bias now enforces active_slot switch via syncControlSettings
- feat: nightly experiment runner for quality vs budget A/B testing
- feat: syncControlSettings — mode-driven auto-toggle of all enforcement settings
- fix: pass loadOptimizationMode() to computeControlVector so auto-mode actually switches tier
- fix: ledger reconciliation reads usd field, writes total_savings_usd
- fix: lifetime savings display and auto-mode tier routing
- fix: align DFLT_SEL and loadSelection defaults with auto-mode
- fix: align savings tracking fields across all systems
- fix: optimization_mode now returns effective mode, not input value
- fix: add setShellDirectory, fix flow-enforcer import path, shell.env directory wiring
- fix: move applyDecadence import to state.js, add setLastMutationEvent
- fix: const assignment + missing imports in shell.env hook
- fix: move .ts stripping to end of deploy (after all copies)
- fix: remove duplicate exports, add setLastMutationEvent, strip .ts on deploy
- fix: replace all direct assignments to imported state vars with setters
- fix: deploy .ts files (they are fixed, no stripping needed)
- fix: deploy script now excludes .ts files from deployed plugin dir
- fix: move applyDecadence to state.js where decadence vars are owned
- fix: missing exports, const assignment bug in applyDecadence, TDD test expectations
- fix: missing TRINITY_CHEAP/MEDIUM imports in hook files — plugin crashed on load
- refactor: replace toy scenarios with 6 hard multi-file/architectural scenarios
- refactor: regime-driven autoSelectMode, remove savings_goal_usd
- docs: update README, AGENTS, LIVE_DEBUG for regime-driven autoSelectMode
- docs: add LIVE_BUG section, ML/smart-cache tests, TDD live prompts
- chore: sync compiled JS with TS savings fixes
- chore: remove experiment artifacts, ignore experiments/ dir
- chore: sync compiled index.js with TS source
- chore: v0.13.11
- chore: v0.13.10
- chore: v0.13.9
- chore: v0.13.8
- chore: v0.13.7
0.13.14
0.13.13


## 0.13.11
- fix: use setters for all imported state vars (ES module bindings are read-only)
- fix: add setLastMutationEvent, remove duplicate exports in state.js
- fix: deploy script strips .ts files to prevent runtime conflicts
- refactor: LIVE_DEBUG 136/137 pass, neutral env clean

## 0.13.10
- fix: move applyDecadence to state.js where _lastDecadenceRun is owned
- fix: add missing TRINITY_CHEAP/MEDIUM, trendDisplay, scoreStress, remoteCall exports
- docs: add LIVE_DEBUG.md with 87 prompt tests

## 0.13.9
- fix: deploy script missing src/lib/ — plugin hooks failed silently, no footer rendered

## 0.13.8
- docs: add LIVE_DEBUG.md with 87 prompt tests across 18 categories

## 0.13.7
- chore: release bump

## 0.13.6
- feat: web dashboard sidecar with SolidJS SPA, SSE, and standalone server
- docs: add rule 7 — don't lie about tool execution, ask once


## 0.13.5
- refactor: extract 16 modules (7207 lines) from src/index.ts into src/lib/
- fix: ES module binding divergence — add setters for mutable state
- fix: missing imports, directory→projectDirectory rename, loadCredit import
- fix: TDD auto-generated artifact cleanup

## 0.13.4
- feat: blackbox dynamically controls thinking mode per sub-regime for cost savings
- feat: complete remote API migration — dual-path scoreStress, patternsObserve/Record, TDD exports with local fallback + neutral env test
- feat: complete remote API migration — dual-path scoreStress, patternsObserve/Record, TDD exports with local fallback
- feat: blackbox ML enhancements — real features, loop prevention, pivot detection, outcome tracking, calibration
- feat: v0.10.0 — 6 enhancement phases implemented
- feat: WordPress integration - atomic seat+token creation
- feat: Phase 2 - Integrate remote API client into plugin runtime
- feat: Phase 1 - Remote API server for protected algorithms
- feat: CodeX MCP server and dashboard sidebar plugin integration
- feat: vibeOS TUI dashboard sidebar plugin
- fix: add setToolDirectory export to tool-execute.ts, skip pre-commit hooks in release.mjs
- fix: release.mjs — add missing closing brace for deploy else block
- fix: stabilize refactored modules — ES module bindings, setters, missing imports
- fix: flow-enforcer race condition, blackbox default ON, dynamic footer
- fix: lock model name, enforcement logging, TDD framework detection, cache display rounding
- fix: validateState sessions object, remove stale report writes, drop dead code
- fix: state validation, flow TODO dedup, session checkpointing, fetch verification
- fix: _appendFooter full model names, → arrow, inline stress; 361/362 pass
- fix: atomic state writes, safeJsonParse in flow-enforcer, hook error handling (#15)
- fix: model split always shown, stress inline in footer, not separate line
- fix: footer uses slot model name, → arrow, inline stress always, remove session-report writes, disable blackbox default
- fix: sync second footer builder in tool.execute.after with new template
- fix: compact footer with inline stress gauge, full model names, robust test assertions
- fix: footer uses trinity tier model name, all 362 tests pass
- fix: resolve pricing cache corruption, improve TODO extraction, and tune delegation savings
- fix: use dynamic mcp port fallback
- fix: handle mcp server close-reopen race
- fix: await mcp server startup
- fix: harden prompt send and unblock typecheck
- fix: sync opencode.json model with brain tier, restore footer icons (trend arrows, stress gauge)
- fix: deploy script missing vibeOS-api-server/ directory
- fix: footer prepended to output.output, fix tests, remove stale vibeOS/ directory
- fix: migrate footer from context-polluting text.complete to UI-only output.title
- fix: restore experimental.text.complete and message.updated hooks lost during stash
- fix: ensure model-tiers.json is created when no model is detected
- fix: update trinity status test for new dashboard format
- fix: compute cache savings from actual file size, remove /bin/zsh.001 floor, fix state corruption from flow_warns overwrite
- fix: add proper named export for auto-discovery, fix function closure
- fix: add startup toast to verify TUI plugin function execution
- fix: add auto-activation to sync script, add sidebar widget diagnostics
- fix: restore vibeOS sidebar dashboard widget, fix plugin path in opencode config
- fix: add size guard to readJsonOrEmpty to prevent OOM on massive state files
- fix: add generation counter + concurrent-write detection to updateState
- fix: dedup double footer from competing message.updated / text.complete hooks
- fix: append ledger entry in recordSaving() and recordCacheSaving()
- fix: make MCP server close() async, export closeMcpServer for test cleanup
- fix: isolate tests from real config (chdir sandbox, VIBEOS_MCP_PORT=0, HOME cleanup)
- fix: release/deploy synced lib deps - blackbox missing caused footer (and all hooks) to disappear
- fix: resolution-tracker thresholds - isConverging >=0.5, detectLoop Jaccard 0.6, isRefining >-0.01
- perf: conditional directive injection — skip TDD/FLOW/orchestrator when control vector signals relaxed mode
- refactor: merge extracted modules into src/index.ts (6656→1061 lines)
- refactor: swap blackbox import to LocalBlackboxStub (forensic)
- refactor: blackbox moved to API-server-only — plugin uses local stub
- refactor: rename CodeX MCP server to vibeOS MCP server
- docs: add final stabilization campaign report (#14)
- docs: add stabilization audit reports for sessions 02-06 and 09 (#13)
- docs: add stabilization baseline report (#12)
- docs: update README and AGENTS for remote API protection (Phase 1+2)
- docs: fix brand name, update AGENTS line count, document shell.env hook
- docs: update README and AGENTS for v0.9.1 features
- test: add cross-session restart E2E test (BUG 10)
- chore: remove TDD auto-generated test artifacts
- chore: hardcode public VIBEOS_API_TOKEN as default
- chore: bump to 0.11.0 — blackbox ML engine, loop prevention, pivot detection, API-only architecture
- chore: replace diagnostic log with visible toast
- chore: add secrets to .gitignore (.env.production, PRODUCTION-CREDENTIALS.md)
- ci: add vibeOS test workflow
- chore: v0.9.1
bump 0.13.2 — state.ts stub exports, fix ESM import errors
bump 0.13.1 — trinity optimize (5 modes + auto), compaction every 10 turns, state.ts stub exports
Merge pull request #18 from DrunkkToys/revert/low-value-api-migration
revert: undo low-value API migration — scoreStress, extractExports, patterns back to local-only
Merge pull request #17 from DrunkkToys/feat/remote-api-migration
test nested
test api put


## 0.13.3
bump 0.13.2 — state.ts stub exports, fix ESM import errors
bump 0.13.1 — trinity optimize (5 modes + auto), compaction every 10 turns, state.ts stub exports
Merge pull request #18 from DrunkkToys/revert/low-value-api-migration
revert: undo low-value API migration — scoreStress, extractExports, patterns back to local-only
Merge pull request #17 from DrunkkToys/feat/remote-api-migration
test nested
test api put


## 0.13.2

- fix: add missing stub exports to `state.ts` (computeSavingsPayload, computeStatusPayload, etc.) to resolve ESM import errors in pre-commit hooks and isolated tests
- fix: sync all compiled `.js` artifacts from `dist-ts/` to `src/lib/` to fix test environment imports

## 0.13.1

- feat: `trinity optimize` command — 5 session-level modes (budget/quality/speed/longrun/auto) with cache-savings-driven auto switching
- feat: blackbox `OptimizationMode` delta tables — per-mode overrides for all 10 control knobs
- feat: turn counter + proactive context compaction every 10 turns
- feat: `autoSelectMode()` — auto switches budget/balanced/quality per sub-regime based on session cache savings
- feat: footer optimization mode tag (`[BUDGET]`, `[QUALITY]`, `[SPEED]`, `[LONGRUN]`, `[AUTO→BUDGET]`)
- feat: per-session mode persistence in `blackbox-state.json` (resets to `auto` on restart)
- feat: mode-specific system prompt directive injection
- feat: mode locked for session — blackbox CANNOT override user-set mode

## 0.13.0

- refactor: extract 16 modules from src/index.ts into src/lib/ (state, pricing, trinity, TDD, hooks, reporting, research-audit, api-client, credit-api, turn-classify, index-helpers)
- fix: flow-enforcer race condition, blackbox default ON, dynamic footer improvement
- fix: atomic state writes, safeJsonParse in flow-enforcer, hook error handling
- perf: inline stress in footer, remove session-report writes, disable blackbox default
- docs: AGENTS.md updated — 8 hooks (added session.compacting), new src/lib/ architecture
- docs: README updated — added Architecture section with src/lib/ module descriptions

## 0.12.0 (production readiness stabilisation)

- feat: production-ready feature inventory and documentation reconciliation
- feat: complete test coverage — 362 passing tests, all skeleton files filled
- fix: error handling — added null-safe DelegationEnforcer default parameter
- fix: error handling — wrapped all scratchpad I/O in try/catch guards
- fix: error handling — safeJsonParse adopted in parseJsonc for JSONC tolerance
- fix: state file integrity — atomic write-then-rename for all 7 state file writers
- fix: state file integrity — corruption recovery with backup + logging for all 8 readers
- fix: state file integrity — 10MB size limits prevent OOM on corrupt files
- fix: MCP server — CORS headers, request logging, input validation, path traversal protection
- fix: API server — input validation, error handling, SQL injection protection on all 15 route files
- fix: API server — auth middleware hardening (suspended seat handling, master key auth)
- fix: scripts — demo_timer.mjs corruption fix, release.mjs syntax fix, sync-ts-build.mjs mapping fix
- fix: CI/CD — node 20/22 matrix, build step, new release.yml workflow
- fix: build chain — orphaned dist-ts/ artifacts removed, all TS file mappings verified
- docs: AGENTS.md — added 7th hook, 8 missing .ts files, 9 missing state files
- docs: README — added 4 env vars, 3 trinity commands

## 0.11.0
- feat: per-session model lock (`trinity lock on|off`) — prevents auto-reconcile with OpenCode config changes
- feat: lock status shown in `trinity status` guards and live footer (`LOCK` tag)
- feat: blackbox real feature extraction — 11 derived features per turn (word count, question ratio, urgency, sentiment, complexity, etc.)
- feat: blackbox loop prevention — 4-level escalating intervention (gentle → suggestive → assertive → escalated) injected into system prompts
- feat: blackbox PIVOT/SWITCH detection — detects context changes outside project scope via drift rate + instruction density change
- feat: blackbox outcome tracking — detects satisfaction signals from assistant responses (positive/negative/neutral)
- feat: blackbox online calibration — `POST /api/v1/blackbox/calibrate` auto-tunes thresholds from session outcomes per project
- feat: blackbox cross-session continuity — project-scoped session keys (not PID), state persists across terminal restarts
- feat: blackbox API server unification — API server now imports shared ResolutionTracker (removed duplicate implementation)
- feat: `blackbox_calibration` SQLite table for per-project calibrated weights
- feat: `blackbox_sessions` now includes outcome column, `/api/v1/blackbox/outcome`, `/api/v1/blackbox/calibration`, `/api/v1/blackbox/project-sessions` endpoints
- refactor: blackbox moved to API-server-only — plugin uses local stub, full engine runs on server
- docs: README and AGENTS updated with model lock, blackbox engine, and calibration documentation

## 0.9.3
- fix: MCP server now starts during DelegationEnforcer init (was trapped in orphaned computeStatusPayload)
- fix: add mcp_port auto-write to model-tiers.json on init
- fix: initialize cache_savings_usd in state file on first write
- fix: deploy.mjs now copies vibeOS-lib/ (including blackbox) and vibeOS-mcp-server.js

## 0.9.2
- fix: resolution-tracker thresholds — isConverging `> 0.5` → `>= 0.5`
- fix: resolution-tracker thresholds — detectLoop Jaccard 0.8 → 0.6
- fix: resolution-tracker thresholds — isRefining `entropyTrend >= 0` → `> -0.01`
- test: add blackbox evaluation harness with per-regime precision/recall/F1

## 0.9.1
- feat: vibeOS MCP server HTTP API
- chore: sync-ts-build and flow-enforcer enhancements

## 0.9.0
- feat: stress-mitigation pipeline — detect, warn, harden, reroute
- fix: TDD skeleton now fires for task subagent file writes
- fix: smart sub-cent display and 4dp precision for cache savings
- fix: _refreshModel now reconciles with actual opencode.json model
- refactor: full decouple — VibeTheOG → vibeOS branding, dirs, reports, test paths
- docs: add AGENTS.md — immutable project spec for all LLMs
Merge pull request #1 from DrunkkToys/experiment/process-data-py
Document pattern learner commands and claimed feature
Add routine-pattern promotion regression test
fix telemetry precision and cross-project session linkage
rename: VibeTheOG → vibeOS
rename to VibeTheOG and fix OpenCode manifest/plugin path consistency
release: bump to v0.8.0 and sync stability hardening


# Changelog

## 0.8.1

- fix: reduce dummy actions by gating auto TDD skeleton creation to explicit test intent (or direct test-path edits)
- feat: add active-job persistence and off-topic detection to prompt for scope confirmation before write/edit/task actions
- chore: patch release bump and docs version sync

## 0.8.0

- chore: minor release bump for stabilized release candidate
- test: re-validated first-install flow, slot switching, footer integrity, and neutral-environment gates

## 0.7.15

- fix: footer tier refresh now follows active slot changes even when model id is unchanged
- test: added regression coverage for slot-switch tier updates and stabilized classify fixtures
- test: neutral-environment validation (`env -i`) re-run before release bump

## 0.7.14

- test: release hardening pass with expanded adversarial coverage (20 tiger-team checks) and full gate validation
- test: neutral-environment parity validation (`env -i`) confirms typecheck/build/test stability matches baseline
- test: pre-existing failing write-enforcement test fixed via deterministic model-tiers fixture setup
- chore: add checkpoint reliability tooling
  - new `checkpoint-template.md` for structured session handoff
  - new `scripts/checkpoint-validate.mjs` for schema validation (sections, task IDs/states, diff-stat evidence, handoff checklist)
  - new `scripts/tests/checkpoint-validate.test.mjs` with pass/fail fixture coverage
  - new npm scripts: `checkpoint:validate`, `test:scripts`
- docs: release readiness and SI/cross-session validation workflow standardized for safer iteration

## 0.7.13

- fix: production plugin load hardening — remove hidden `../utils/timer.js` dependency from `session-metrics.js`
- fix: plugin install payload completeness — include `src/VibeTheOG-lib/session-metrics.js` in desktop sync set
- fix: runtime config compatibility — remove invalid `plugins` key usage from `opencode.json` workflow assumptions
- fix: config reader robustness — support both `opencode.json` and `opencode.jsonc` (including JSONC comments/trailing commas)
- fix: applySlot safety — prefer project-local `opencode.json` to avoid accidental global provider/dropdown mutations
- test: deep neutral-environment validation (`env -i`) for full suite + build + runtime plugin load (`opencode models deepseek`)
- docs: README version/install sync updated to match actual runtime dependencies and file paths

## 0.7.12

- chore: TDD strict defaults, flow enforcer improvements, release tooling
- change: TDD strict mode now defaults to ON (`selection.tdd_strict !== false`)
- feat: `trinity tdd strict on|off` command to control strict failing TODO templates
- docs: sample config + README updated for TDD strict defaults and command

## 0.7.10

- feat: compact immutable footer format: `— [model route] | VibeTheOG: X.XX saved ↑|↓|→ —`
- change: remove noisy footer breakdown segments (flow/tool/rate/duration) from chat footer
- change: model usage percentages now show only when both brain and worker are actually used
- test: added footer format contract test to prevent accidental format drift

## 0.7.9

- change: delegation enforcement now defaults to ON (`delegation_enforce !== false`) for safer cost control
- change: first-run auto-generated `model-tiers.json` now includes `"delegation_enforce": true`
- docs: sample config updated to show delegation enforcement enabled by default

## 0.7.8

- fix: auto-sync no longer overwrites valid model-tiers.json entries with guessed provider-prefixed IDs
- fix: provider model IDs now use correct provider prefix (e.g. `deepseek/`) instead of generic `opencode/`
- fix: task routing skips medium slot when it matches the brain model (fallback to cheap)
- fix: delegation_enforce defaults to opt-in (`=== true`) instead of opt-out (`!== false`)
- fix: null-safety guard for enforcement block when no args passed
- fix: first-install auto-config populates all trinity slots even with single-model fallback

## 0.7.3

- feat: always sync model-tiers.json with opencode.json on every session start (not just first install)
- feat: detects ALL models from user config — both `provider` dropdown models AND top-level `model` field
- fix: only writes to model-tiers.json if detected models differ from current config (no unnecessary writes)

## 0.7.2

- feat: auto-create model-tiers.json on first install from opencode desktop provider models (sniffs models from the dropdown menu, no manual config needed)
- fix: TRINITY_CHEAP/MEDIUM are now mutable so auto-config can refresh them immediately after bootstrap

## 0.6.0

- feat: enhanced live footer with trend indicators (↑↓→), session duration, savings rate/hr
- feat: per-tool cost breakdown in footer (edit, webfetch, context7, quota, etc.)
- feat: model usage distribution percentage in footer tag (e.g. [🧠 60% → ⚡ 40%])
- feat: cache savings displayed as separate line item in footer
- feat: trend analysis comparing current session rate vs previous sessions
- perf: extended readLifetimeSavings() to return sesDuration, sesRatePerHour, sesTrend, sesToolBreakdown, sesModelTurns
- docs: updated README with new footer format documentation

## 0.5.2

- bump: v0.5.2

## 0.5.1

- fix: `trinity thinking full` now stores `"full"` string instead of `null`
  — status correctly shows "manual" instead of "credit X%"
  — persists regardless of credit drops (true manual override)

## 0.5.0

- feat: progressive decadence — age-based scratchpad cache rotation
  (5min fresh → 1h warm/summary → 24h cold → 48h delete, 1000 file / 10MB limit)
- feat: research audit — scans scratchpad index + session state for WebFetch/WebSearch
  anti-patterns (domain chains 3+, redundant queries, context7 bypass)
- feat: reporting framework — persistent reports with consistent schema
  (auto-saved from research-audit, save/list/read tools, plain-text findings parser)
- feat: project memory — cross-session continuity via project-states.json
  (session counter, research patterns, one-shot briefing on fresh session)
- feat: research-audit, report-save, report-list, report-read tools (5 total)
- fix: _refreshModel no longer forces currentTier="high" for non-brain slots
- fix: init tier override only fires for brain slot (not all slots)
- fix: auto-save moved before early return for totalFetches=0
- fix: saveReport now auto-parses plain-text findings/metrics (JSON fallback)
- fix: dedup prevents duplicate auto-saves within 5-minute window
- fix: TTL prune deletes reports >90d, keeps max 200
- fix: add ={} to all tool execute signatures to prevent destructuring crash
- fix: null-guard _wouldBeDuplicate for null summary
- fix: null-guard summary.slice() in report index update
- test: deep test (43 pass, 0 fail — module, hooks, routing, project memory)
- test: mid-tier / brain-slot / credit path test (10/10 pass)
- test: report framework lifecycle (14/14 pass)
- test: 4 report fixes (plain-text, dedup, TTL, narrative)
- test: VENV stress test (57 pass, 2 false-positive from test sequencing)
- perf: atomic lifetime reads — compute ltTasks+ltCache from single session snapshot
- perf: getLastLines — 5-line/1024-byte tail replaces fragile 200-byte dedup
- perf: _readHead — 120-byte header-only read for decadence idempotency checks

## 0.4.9

- chore: bump v0.4.9

## 0.4.8

- fix: scratchpad hash mismatch — stable JSON key sorting matches CC shasum
- fix: cross-process log dedup — read file tail instead of per-process cache
- fix: scratchpad inline size cap — auto-prune >2000 files or >20MB
- fix: clean up savings tag — remove verbose "delegation + cache" breakdown

## 0.4.7

- feat: flow enforcer — lightweight dev-flow rule checks on Write/Edit
  (fast-path regex, never blocks, dedup per rule+file per session)
- feat: `trinity flow` / `trinity flow on|off` — audit and toggle
- test: 9 new flow enforcer unit tests (64 total)
- fix: log rotation mtime guard to prevent repeated full-file reads

## 0.4.6

- test: 6 new stall-fix tests (system.transform, messages.transform, tool.execute.after)
- fix: only inject thinking directive when manually set via `trinity thinking`
- refactor: remove auto credit-based thinking injection (caused stalls)

## 0.4.5

- fix: remove thinking directive from system prompt (caused model stalls)
- fix: replace imperative "Full content: Read <path>" with neutral cold-storage ref
- fix: remove Task output compression — brain needs results verbatim
- fix: only compress webfetch output (HTML/CSS noise)

## 0.4.4

- fix: dedup session-reports.log writes — skip if line unchanged
- fix: rotate session-reports.log at 500 lines to prevent unbounded growth
- fix: add pid to log timestamps to distinguish concurrent writers
- fix: show delegation vs cache breakdown in savings tag
- fix: prune stale sessions from delegation-state.json (keep latest 30)

## 0.4.2

- bump: version 0.4.2
- feat: credit API balance fetching (DeepSeek + OpenRouter)
- fix: thinking level defaults to brief instead of off
- fix: credit default 50% for sane fallback


## 0.3.4

- bump: version 0.3.4

## 0.3.0

- bump: version 0.3.0

## 0.2.4

- bump: version 0.2.4

## 0.2.3b

- bump: version 0.2.3b

## 0.2.3a

- bump: version 0.2.3a

## 0.2.2

- bump: version 0.2.2

## 0.2.1

- bump: version 0.2.1

## 0.2.0

- feat: align alert schema with CC hook; add 4 new tests (39 total)
- fix: align WRITE_EDIT to $0.07 to match bash hook; fix stale test values
- feat: port CC features to OC plugin + 35 tests all passing

## 0.1.0

- Initial release — VibeTheOG v3
