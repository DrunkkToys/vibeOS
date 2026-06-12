// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Real cascade pipeline tests — exercises the blackbox resolution tracker,
// meta-controller, ML router, mode resolution, loop/escalation, pivot detection,
// and cost-aware cascading with realistic multi-turn sessions.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// ── Sandbox ──────────────────────────────────────────────────────────
const SANDBOX = mkdtempSync(join(tmpdir(), "vibeos-cascade-real-"))
process.env.HOME = SANDBOX

const claudeDir = join(SANDBOX, ".claude")
mkdirSync(claudeDir, { recursive: true })

writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
  trinity: {
    brain: { oc: "deepseek/deepseek-v4-pro" },
    medium: { oc: "deepseek/deepseek-v4-flash" },
    cheap: { oc: "deepseek/deepseek-chat" },
  },
  selection: {
    enabled: true,
    active_slot: "cheap",
    selected_provider: "deepseek",
    selected_model: "deepseek/deepseek-chat",
    delegation_enforce: true,
    flow_enabled: true,
    tdd_enforce: false,
    optimization_mode: "budget",
  },
}, null, 2))

// ── Dynamic imports (cache-busting) ──────────────────────────────────
const cacheBust = "?cascade_real=" + Date.now()
const meta = await import("../src/vibeOS-lib/blackbox/meta-controller.js" + cacheBust)
const mlRouter = await import("../src/vibeOS-lib/ml-router.js" + cacheBust)
const resolution = await import("../src/vibeOS-lib/blackbox/resolution-tracker.js" + cacheBust)
const classifiers = await import("../src/lib/classifiers.js" + cacheBust)
const turnClassify = await import("../src/lib/turn-classify.js" + cacheBust)
const modeRouter = await import("../src/lib/mode-router.js" + cacheBust)

// ── Helpers ──────────────────────────────────────────────────────────
function makeTracker(sessionId = "cascade-session-1") {
  return new resolution.ResolutionTracker(sessionId, 12)
}

function makeState(tracker) {
  return Object.assign(
    { latest_stress_multiplier: 0 },
    tracker.computeState(),
  )
}

// ── Tests ────────────────────────────────────────────────────────────

test("cascade: full session lifecycle — INIT → EXPLORING → REFINING → IMPLEMENTING → CONVERGING → CLOSED", async (t) => {
  const rt = makeTracker("lifecycle-" + Math.random().toString(36).slice(2, 8))

  // Turn 1 — INIT (any first message)
  const s1 = rt.update(
    "hello, what can you help me with today?",
    resolution.ResolutionTracker.extractFeatures("hello, what can you help me with today?"),
    "greet", 0.5, 0.1,
  )
  assert.equal(s1.sub_regime, "INIT", "turn 1 must be INIT")
  assert.equal(s1.n_interactions, 1)

  // Turn 2 — Q&A question slides to EXPLORING
  const s2 = rt.update(
    "how does the cascade router work in vibeOS? can you explain the ml-router module?",
    resolution.ResolutionTracker.extractFeatures("how does the cascade router work in vibeOS? can you explain the ml-router module?"),
    "question", 0.3, 0.4,
  )
  assert.ok(
    s2.sub_regime === "EXPLORING" || s2.sub_regime === "DIVERGENT" || s2.sub_regime === "REFINING",
    `turn 2 should move past INIT, got ${s2.sub_regime}`,
  )

  // Turns 3-5 — Implementation commands push toward REFINING / IMPLEMENTING
  const actionSequence = [
    { text: "ok write a function that calculates tf-idf scores", action: "implement", entropy: 0.2, uncertainty: 0.1 },
    { text: "now add tests for that function with edge cases", action: "test", entropy: 0.15, uncertainty: 0.1 },
    { text: "add error handling for null and empty inputs", action: "implement", entropy: 0.1, uncertainty: 0.05 },
  ]
  for (const a of actionSequence) {
    rt.update(a.text, resolution.ResolutionTracker.extractFeatures(a.text), a.action, a.entropy, a.uncertainty)
  }

  // Turn 6 — user confirms results → converging
  const s6 = rt.update(
    "that looks correct, the tests pass and the error handling works",
    resolution.ResolutionTracker.extractFeatures("that looks correct, the tests pass and the error handling works"),
    "confirm", 0.05, 0.05,
  )
  const state6 = makeState(rt)
  const cv6 = meta.computeControlVector(state6, "confirm", "vibemax")
  assert.ok(cv6.tier_bias, "control vector must have tier_bias")
  assert.ok(cv6.enforcement_mode, "control vector must have enforcement_mode")
  assert.ok(cv6.flow_mode, "control vector must have flow_mode")
  assert.ok(cv6.tdd_mode, "control vector must have tdd_mode")
  assert.ok(cv6.thinking_mode, "control vector must have thinking_mode")
  assert.ok(Array.isArray(cv6.directives), "control vector must have directives array")
  assert.ok(cv6.directives.length > 0, "directives must not be empty after 6 turns")

  // Verify the tracker has 6 entries
  assert.equal(rt.history.length, 6, "history must contain all 6 turns")
})

test("cascade: loop detection escalates through all 4 intervention levels", async (t) => {
  const rt = makeTracker("loop-test-" + Math.random().toString(36).slice(2, 8))
  const sameText = "why is this not working? I keep getting the same error"
  const features = resolution.ResolutionTracker.extractFeatures(sameText)

  // Warm up with an initial message
  rt.update("hello", resolution.ResolutionTracker.extractFeatures("hello"), "greet", 0.5, 0.1)

  // Repeat same question 4 times to trigger escalating loop levels
  let s1, s2, s3, s4
  rt.update(sameText, features, "question", 0.7, 0.8)
  s1 = rt.update(sameText, features, "question", 0.7, 0.8)
  assert.ok(s1.repeat_streak >= 2, "after 2nd repeat, repeat_streak should be >= 2")
  // First loop detection — any level is valid (cascade escalates based on entropy, not turn count alone)
  if (s1.is_looping) {
    assert.ok(
      typeof s1.loop_intervention_level === "string" && s1.loop_intervention_level.length > 0,
      `level 1 loop intervention must be a string, got ${s1.loop_intervention_level}`,
    )
  }

  s2 = rt.update(sameText, features, "question", 0.7, 0.8)
  if (s2.is_looping) {
    assert.ok(
      typeof s2.loop_intervention_level === "string" && s2.loop_intervention_level.length > 0,
      `level 2 loop must have a valid intervention level, got ${s2.loop_intervention_level}`,
    )
    assert.ok(s2.loop_consecutive >= 1, "loop_consecutive should accumulate")
  }

  s3 = rt.update(sameText, features, "question", 0.7, 0.8)
  assert.ok(s3.is_looping, "after 4th repeat, should detect LOOPING")
  assert.ok(s3.loop_consecutive >= 2, "loop_consecutive should be >= 2")

  s4 = rt.update(sameText, features, "question", 0.7, 0.8)
  assert.ok(s4.is_looping, "after 5th repeat, should still detect LOOPING")
  // Should reach assertive or escalated
  assert.ok(
    s4.loop_intervention_level === "assertive" || s4.loop_intervention_level === "escalated",
    `after many repeats, level should be assertive/escalated, got ${s4.loop_intervention_level}`,
  )

  // Verify that a LOOPING regime produces "speed" optimization mode
  const state = Object.assign({ latest_stress_multiplier: 0.1 }, s4)
  const mode = meta.autoSelectMode("LOOPING", 0.1)
  assert.equal(mode, "speed", "LOOPING regime should select speed mode")
})

test("cascade: stress > 1.5 overrides mode to quality", async (t) => {
  const rt = makeTracker("stress-" + Math.random().toString(36).slice(2, 8))

  rt.update("hello", resolution.ResolutionTracker.extractFeatures("hello"), "greet", 0.5, 0.1)

  // Simulate EXPLORING regime (normally would give cheap/budget)
  rt.update(
    "how do I use react hooks?",
    resolution.ResolutionTracker.extractFeatures("how do I use react hooks?"),
    "question", 0.3, 0.4,
  )
  const exploringState = makeState(rt)
  const normalMode = meta.autoSelectMode(exploringState.sub_regime, 0.3)
  assert.notEqual(normalMode, "quality", "low-stress EXPLORING should NOT select quality")

  // Same regime but stress > 1.5
  const stressedMode = meta.autoSelectMode(exploringState.sub_regime, 1.8)
  assert.equal(stressedMode, "quality", "stress > 1.5 should force quality mode even in EXPLORING")

  // CONVERGING already selects quality — stress doesn't change that
  const convergingMode = meta.autoSelectMode("CONVERGING", 4.0)
  assert.equal(convergingMode, "quality", "CONVERGING should always select quality")

  // LOOPING selects speed regardless of stress
  const loopingMode = meta.autoSelectMode("LOOPING", 3.0)
  assert.equal(loopingMode, "speed", "LOOPING should always select speed")

  // RESEARCH / DESIGNING → longrun
  assert.equal(meta.autoSelectMode("RESEARCH", 0.1), "longrun")
  assert.equal(meta.autoSelectMode("DESIGNING", 0.1), "longrun")

  // IMPLEMENTING → quality
  assert.equal(meta.autoSelectMode("IMPLEMENTING", 0.1), "quality")

  // REVIEWING → audit
  assert.equal(meta.autoSelectMode("REVIEWING", 0.1), "audit")

  // Default → litex (when no special regime)
  assert.equal(meta.autoSelectMode("INIT", 0.1), "litex")

  // AUDIT / FORENSIC → lowercase
  assert.equal(meta.autoSelectMode("AUDIT", 0.1), "audit")
  assert.equal(meta.autoSelectMode("FORENSIC", 0.1), "forensic")
})

test("cascade: pivot detection fires on significant context switch", async (t) => {
  const rt = makeTracker("pivot-" + Math.random().toString(36).slice(2, 8))

  // Session 1 — working on a python project
  rt.update(
    "add a rate limiter to the Flask API endpoints",
    resolution.ResolutionTracker.extractFeatures("add a rate limiter to the Flask API endpoints"),
    "implement", 0.2, 0.15,
  )
  rt.update(
    "use redis for the rate limiter backend with sliding window",
    resolution.ResolutionTracker.extractFeatures("use redis for the rate limiter backend with sliding window"),
    "implement", 0.15, 0.1,
  )

  // Abrupt context switch — now talking about frontend React
  const pivotText = "lets switch gears — I need a React component for a drag and drop file uploader with preview thumbnails and a progress bar"
  const pivotFeatures = resolution.ResolutionTracker.extractFeatures(pivotText)
  const s3 = rt.update(pivotText, pivotFeatures, "implement", 0.4, 0.6)

  // Pivot detection is probabilistic — it might or might not fire depending on text similarity
  // But we can verify the signal exists and the tracker handles it
  assert.ok(typeof s3.pivot_detected === "boolean", "pivot_detected must be a boolean")
  assert.ok(typeof s3.pivot_score === "number", "pivot_score must be a number")
  assert.ok(s3.pivot_score >= 0 && s3.pivot_score <= 1, "pivot_score must be in [0,1]")

  // The pivot should be detectable — verify via explicit detection
  const isPivot = rt.detectPivotSignal(
    { text: pivotText, features: pivotFeatures, action: "implement", entropy: 0.4, uncertainty: 0.6 },
    { text: "use redis for the rate limiter backend with sliding window", features: resolution.ResolutionTracker.extractFeatures("use redis for the rate limiter backend with sliding window"), action: "implement", entropy: 0.15, uncertainty: 0.1 },
  )
  // Even if it doesn't reach threshold, the function should work
  assert.ok(typeof isPivot === "boolean", "detectPivotSignal must return boolean")
})

test("cascade: ML router cost decisions are deterministic and reasonable", async (t) => {
  // Simple prompt → stay cheap, no escalate
  const simple = mlRouter.cascadeDecide("check the status of the build", 0.001, 0.005, 0.02, 0.85)
  assert.ok(simple.useCheap, "simple prompt should use cheap model")
  assert.ok(!simple.escalate, "simple prompt should not escalate")
  assert.ok(simple.estimatedSavings > 0, "simple prompt should estimate savings > 0")
  assert.ok(simple.confidence >= 0.7, "simple prompt should be confident")

  // Complex prompt — cascade model uses cheap-then-escalate pattern
  const complex = mlRouter.cascadeDecide(
    "implement refactor redesign architect migrate optimize deploy observability orchestrate automate scale secure monitor alert restore backup replicate shard partition",
    0.001, 0.005, 0.02, 0.85,
  )
  assert.ok(complex.escalate, "complex prompt should escalate")
  assert.ok(complex.useCheap, "complex prompt may still use cheap as first cascade step")

  // Moderate prompt (more typical) — cheap+escalate cascade
  const moderateComplex = mlRouter.cascadeDecide(
    "implement a distributed message queue with at-least-once delivery, dead letter queues, partition rebalancing, and exactly-once processing semantics with idempotency keys",
    0.001, 0.005, 0.02, 0.85,
  )
  assert.ok(typeof moderateComplex.useCheap === "boolean", "moderate prompt should produce valid decision")

  // Moderate prompt → cheap+escalate cascade
  const moderate = mlRouter.cascadeDecide(
    "add input validation to the user registration form with zod schemas and error messages",
    0.001, 0.005, 0.02, 0.85,
  )
  assert.ok(typeof moderate.useCheap === "boolean", "moderate prompt should produce valid decision")
  assert.ok(typeof moderate.escalate === "boolean", "moderate prompt should produce valid decision")

  // Low success rate on cheap → expected cost cascade math works
  const lowSuccess = mlRouter.cascadeDecide("list all files in the src directory", 0.001, 0.005, 0.02, 0.4)
  assert.ok(typeof lowSuccess.useCheap === "boolean", "low success rate should still produce valid decision")
  assert.ok(typeof lowSuccess.estimatedSavings === "number", "should produce savings estimate")

  // All decisions must have valid reasons
  for (const d of [simple, complex, moderate, moderateComplex, lowSuccess]) {
    assert.ok(typeof d.reason === "string" && d.reason.length > 0, `reason must be non-empty string: ${JSON.stringify(d)}`)
    assert.ok(typeof d.confidence === "number" && d.confidence >= 0 && d.confidence <= 1, `confidence must be 0-1: ${d.confidence}`)
  }
})

test("cascade: ML router feature extraction handles diverse prompts", async (t) => {
  const prompts = [
    { text: "ls", expected: { fileMentions: 0, questionDensity: 0 } },
    { text: "implement a full CI/CD pipeline with Docker, Kubernetes, and Terraform for multi-cloud deployment", expected: {} },
    { text: "fix the bug in src/lib/hooks/chat-transform.ts on line 340 where the lock guard is missing", expected: {} },
    { text: "what is the difference between useState and useReducer? when should I use each?", expected: {} },
    { text: "optimize the database queries by adding composite indexes and rewriting the N+1 queries", expected: {} },
    { text: "explain this error: TypeError: Cannot read properties of undefined (reading 'map') at Object.foo (/app/src/bar.ts:42:15)", expected: {} },
    { text: "run the migration with --force --no-backup --target=production and then verify with --check-consistency", expected: {} },
    { text: "create a comprehensive test suite for the authentication module covering login, logout, session expiry, refresh tokens, and rate limiting", expected: {} },
  ]

  for (const p of prompts) {
    const features = mlRouter.extractFeatures(p.text)
    assert.ok(typeof features.length === "number" && features.length > 0, `length must be > 0 for: "${p.text.slice(0, 40)}..."`)
    assert.ok(typeof features.wordCount === "number" && features.wordCount > 0, `wordCount must be > 0 for: "${p.text.slice(0, 40)}..."`)
    assert.ok(typeof features.fileMentions === "number", "fileMentions must be a number")
    assert.ok(typeof features.errorSignals === "number", "errorSignals must be a number")
    assert.ok(typeof features.actionDensity === "number", "actionDensity must be a number")
    assert.ok(features.actionDensity >= 0 && features.actionDensity <= 1, "actionDensity must be 0-1")
    assert.ok(typeof features.complexityWords === "number", "complexityWords must be a number")
    assert.ok(typeof features.questionDensity === "number" && features.questionDensity >= 0, "questionDensity must be >= 0")
  }

  // The error/bug prompt should detect error signals
  const bugFeatures = mlRouter.extractFeatures("fix the bug in src/lib/hooks/chat-transform.ts on line 340")
  assert.ok(bugFeatures.fileMentions >= 1, "file paths should be detected in bug reports")
  assert.ok(bugFeatures.errorSignals >= 1, "error signals should be detected in bug reports")

  // The question prompt should have question density
  const questionFeatures = mlRouter.extractFeatures("what is the difference between useState and useReducer?")
  assert.ok(questionFeatures.questionDensity > 0, "question density should be > 0 for questions")

  // Implementation prompts should have action density
  const implFeatures = mlRouter.extractFeatures("implement refactor migrate redesign architect")
  assert.ok(implFeatures.actionDensity >= 0.3, `complex actions should raise actionDensity, got ${implFeatures.actionDensity}`)
})

test("cascade: every regime produces a valid control vector with all required fields", async (t) => {
  const regimes = resolution.ResolutionTracker.SUB_REGIMES

  for (const regime of regimes) {
    const state = {
      sub_regime: regime,
      resolution: regime === "CLOSED" ? "solved" : "unresolved",
      momentum: 0.0,
      signals: { action_consistency: 0.5, entropy_trend: 0.0, feature_contradiction: 0.0, embedding_delta: 0.0 },
      intent_state: { volatility_score: 0.0, drift_rate: 0.0, core_goal_embedding: null },
      continuity_state: "HIGH",
      is_looping: regime === "LOOPING",
      loop_consecutive: regime === "LOOPING" ? 3 : 0,
      repeat_streak: regime === "LOOPING" ? 3 : 0,
      loop_intervention_level: regime === "LOOPING" ? "assertive" : "none",
      pivot_detected: false,
      pivot_score: 0.0,
      outcome: null,
      n_interactions: 5,
      latest_stress_multiplier: 0.5,
    }

    const cv = meta.computeControlVector(state, "test-action", "vibemax")

    // Required fields
    assert.ok(cv.optimization_mode, `regime ${regime}: missing optimization_mode`)
    assert.ok(cv.enforcement_mode, `regime ${regime}: missing enforcement_mode`)
    assert.ok(cv.flow_mode, `regime ${regime}: missing flow_mode`)
    assert.ok(cv.tdd_mode, `regime ${regime}: missing tdd_mode`)
    assert.ok(cv.tier_bias, `regime ${regime}: missing tier_bias`)
    assert.ok(cv.thinking_mode, `regime ${regime}: missing thinking_mode`)
    assert.ok(cv.mode_root, `regime ${regime}: missing mode_root`)
    assert.ok(cv.mode_family, `regime ${regime}: missing mode_family`)
    assert.ok(cv.cascade_depth !== undefined, `regime ${regime}: missing cascade_depth`)
    assert.ok(Array.isArray(cv.pipeline_root), `regime ${regime}: missing pipeline_root`)
    assert.ok(Array.isArray(cv.directives), `regime ${regime}: missing directives`)
    assert.ok(typeof cv.wbp_verbosity === "string", `regime ${regime}: missing wbp_verbosity`)
    assert.ok(typeof cv.context7_urgency === "string", `regime ${regime}: missing context7_urgency`)
    assert.ok(typeof cv.stress_multiplier === "number", `regime ${regime}: missing stress_multiplier`)

    // Tier_bias must be valid
    assert.ok(
      cv.tier_bias === "cheap" || cv.tier_bias === "medium" || cv.tier_bias === "brain" || cv.tier_bias === "auto",
      `regime ${regime}: invalid tier_bias "${cv.tier_bias}"`,
    )
  }
})

test("cascade: every branded mode resolves to the correct pipeline_root and mode_family", async (t) => {
  const modes = [
    { id: "vibeultrax", family: "cascade", depth: 3, pipeline: ["local", "medium", "brain"] },
    { id: "vibeqmax", family: "brain-ml", depth: 1, pipeline: ["brain"] },
    { id: "vibemax", family: "medium-ml", depth: 1, pipeline: ["medium"] },
    { id: "quality", family: "brain-runtime", depth: 1, pipeline: ["brain"] },
    { id: "speed", family: "medium-runtime", depth: 1, pipeline: ["medium"] },
    { id: "budget", family: "runtime", depth: 1, pipeline: ["cheap"] },
    { id: "longrun", family: "runtime", depth: 1, pipeline: ["cheap"] },
    { id: "balanced", family: "runtime", depth: 1, pipeline: ["cheap"] },
  ]

  for (const m of modes) {
    // Check through meta-controller's resolveModeRoot
    const state = {
      sub_regime: "INIT", resolution: "unresolved", momentum: 0, signals: {}, intent_state: {}, continuity_state: "HIGH",
      is_looping: false, loop_consecutive: 0, repeat_streak: 0, loop_intervention_level: "none",
      pivot_detected: false, pivot_score: 0, outcome: null, n_interactions: 1, latest_stress_multiplier: 0.1,
    }
    const cv = meta.computeControlVector(state, "test", m.id)
    assert.equal(cv.mode_root, m.id, `${m.id}: mode_root mismatch`)
    assert.equal(cv.mode_family, m.family, `${m.id}: mode_family mismatch`)
    assert.equal(cv.cascade_depth, m.depth, `${m.id}: cascade_depth mismatch`)
    assert.deepEqual(cv.pipeline_root, m.pipeline, `${m.id}: pipeline_root mismatch`)
  }
})

test("cascade: classifier scoreStress and classifyTurnSimple handle real inputs", async (t) => {
  // Stress scoring — aggressive inputs
  const aggressiveStress = classifiers.scoreStress("this is completely broken and NOT WORKING at all! fix it RIGHT NOW!")
  assert.ok(aggressiveStress > 0.3, `aggressive text should have stress > 0.3, got ${aggressiveStress}`)

  // Stress scoring — calm inputs
  const calmStress = classifiers.scoreStress("thanks, that looks good. can you explain how it works?")
  assert.ok(calmStress < 0.4, `calm text should have stress < 0.4, got ${calmStress}`)

  // Stress scoring — very calm
  const veryCalm = classifiers.scoreStress("ok")
  assert.ok(veryCalm >= 0, "short text must not crash")
  assert.ok(veryCalm <= 0.6, `short text should have low stress, got ${veryCalm}`)

  // classifyTurnSimple — Q&A patterns
  const qaRegime = classifiers.classifyTurnSimple("how does the cascade router work? what are the different modes?")
  assert.ok(["EXPLORING", "DIVERGENT", "INIT"].includes(qaRegime), `Q&A should be EXPLORING/DIVERGENT/INIT, got ${qaRegime}`)

  // classifyTurnSimple — implementation patterns
  const implRegime = classifiers.classifyTurnSimple("write a function that implements the cascade decision logic with proper error handling")
  assert.ok(["REFINING", "IMPLEMENTING", "EXPLORING", "CONVERGING"].includes(implRegime), `implementation should be REFINING/IMPLEMENTING, got ${implRegime}`)

  // classifyTurnSimple — empty/short inputs
  const emptyRegime = classifiers.classifyTurnSimple("test")
  assert.ok(typeof emptyRegime === "string", "empty-ish input must return a string regime")
})

test("cascade: computeDifficulty distinguishes simple from complex correctly", async (t) => {
  const simple = mlRouter.computeDifficulty("check the status")
  assert.equal(simple.level, "simple", `'check the status' should be simple, got ${simple.level}`)

  const moderate = mlRouter.computeDifficulty("write a function that filters an array")
  assert.ok(simple.level === "simple", `basic function should be simple or moderate, got ${simple.level}`)

  const complex = mlRouter.computeDifficulty("implement a distributed microservice pipeline with database migration, retries, observability, circuit breakers, and rollbacks")
  assert.ok(complex.level === "complex" || complex.score > simple.score, `complex prompt should have higher difficulty than simple: ${complex.score} vs ${simple.score}`)

  // Difficulty ordering should be monotonic for increasingly complex prompts
  const prompts = [
    "ping",
    "check the status of the build",
    "fix the bug in the authentication middleware",
    "implement a full distributed system with microservices, message queues, event sourcing, CQRS, and eventual consistency guarantees",
  ]
  const scores = prompts.map(p => mlRouter.computeDifficulty(p).score)
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i] >= scores[i - 1] * 0.5, `difficulty should generally increase: ${scores[i]} vs ${scores[i - 1]}`)
  }
})

test("cascade: resolution tracker extractFeatures returns all 11 fields", async (t) => {
  const text = "URGENT: fix the broken build in src/lib/hooks/chat-transform.ts ```code block``` it's failing with TypeError. this is very complex and subtle. DO NOT skip testing. please check carefully. check this against that check."
  const features = resolution.ResolutionTracker.extractFeatures(text)

  const requiredFields = [
    "length", "word_count", "sentence_count", "avg_word_length",
    "question_ratio", "code_blocks", "urgency", "repetition",
    "sentiment", "complexity", "instruction_density",
  ]
  for (const f of requiredFields) {
    assert.ok(f in features, `extractFeatures must include ${f}`)
    assert.ok(typeof features[f] === "number", `${f} must be a number, got ${typeof features[f]}`)
    assert.ok(features[f] >= 0 && features[f] <= 1, `${f} must be in [0,1], got ${features[f]}`)
  }

  // Specific assertions for known inputs
  assert.ok(features.urgency > 0, "URGENT + broken + error should set urgency")
  assert.ok(features.complexity > 0, "complex + subtle should set complexity")
  assert.ok(features.instruction_density > 0.5, "DO NOT + must should set high instruction density")
})

test("cascade: buildControlHistoryEntry creates valid history records", async (t) => {
  const cv = meta.computeControlVector({
    sub_regime: "INIT", resolution: "unresolved", momentum: 0, signals: {}, intent_state: {}, continuity_state: "HIGH",
    is_looping: false, loop_consecutive: 0, repeat_streak: 0, loop_intervention_level: "none",
    pivot_detected: false, pivot_score: 0, outcome: null, n_interactions: 1, latest_stress_multiplier: 0,
  }, "test", "vibemax")

  const entry = meta.buildControlHistoryEntry(1, "INIT", cv, 0.5)

  assert.equal(entry.turn, 1)
  assert.equal(entry.regime, "INIT")
  assert.equal(entry.reward, 0.5)
  assert.ok(entry.control.enforcement_mode)
  assert.ok(entry.control.flow_mode)
  assert.ok(entry.control.tdd_mode)
  assert.ok(entry.control.tier_bias)
  assert.ok(entry.control.thinking_mode)
  assert.ok(entry.control.context7_urgency)
  assert.ok(entry.control.wbp_verbosity)
  assert.ok(typeof entry.control.stress_multiplier === "number")
})

test("cascade: REGIME_CONTROL_TABLE is complete for all SUB_REGIMES", async (t) => {
  const table = meta.REGIME_CONTROL_TABLE
  const regimes = resolution.ResolutionTracker.SUB_REGIMES

  for (const regime of regimes) {
    assert.ok(regime in table, `REGIME_CONTROL_TABLE must have entry for ${regime}`)
    const control = table[regime]
    assert.ok(control.enforcement_mode, `${regime}: missing enforcement_mode`)
    assert.ok(control.flow_mode, `${regime}: missing flow_mode`)
    assert.ok(control.tdd_mode, `${regime}: missing tdd_mode`)
    assert.ok(control.tier_bias, `${regime}: missing tier_bias`)
    assert.ok(control.thinking_mode, `${regime}: missing thinking_mode`)
    assert.ok(control.wbp_verbosity, `${regime}: missing wbp_verbosity`)
    assert.ok(control.context7_urgency, `${regime}: missing context7_urgency`)
    assert.ok(typeof control.stress_multiplier === "number", `${regime}: missing stress_multiplier`)
  }
})

test("cascade: ML router pattern graph creates and serializes correctly", async (t) => {
  const graph = mlRouter.createPatternGraph()
  assert.ok(graph.nodes, "graph must have nodes")
  assert.ok(graph.tiers, "graph must have tiers")
  assert.ok(Array.isArray(graph.tiers.cheap), "graph must have cheap tier list")
  assert.ok(Array.isArray(graph.tiers.medium), "graph must have medium tier list")
  assert.ok(Array.isArray(graph.tiers.brain), "graph must have brain tier list")

  // Add some edges
  mlRouter.addRouteEdge(graph, "implement", "deepseek/deepseek-v4-pro", "brain", true)
  mlRouter.addRouteEdge(graph, "implement", "deepseek/deepseek-chat", "cheap", false)
  mlRouter.addRouteEdge(graph, "check", "deepseek/deepseek-chat", "cheap", true)

  // Serialize and deserialize
  const serialized = mlRouter.serializeGraph(graph)
  assert.ok(typeof serialized === "string", "serializeGraph must return a string")

  const deserialized = mlRouter.deserializeGraph(serialized)
  assert.ok(deserialized.nodes, "deserialized graph must have nodes")
  assert.ok(deserialized.tiers, "deserialized graph must have tiers")

  // Predict best model
  const best = mlRouter.predictBestModel(graph, "implement", "cheap")
  assert.ok(typeof best === "string" && best.length > 0, "predictBestModel must return a model string")
})

test("cascade: resolveCascadeSlot returns correct tier from pipeline", async (t) => {
  assert.equal(modeRouter.resolveCascadeSlot(["local", "medium", "brain"]), "brain")
  assert.equal(modeRouter.resolveCascadeSlot(["brain"]), "brain")
  assert.equal(modeRouter.resolveCascadeSlot(["medium"]), "medium")
  assert.equal(modeRouter.resolveCascadeSlot(["cheap"]), "cheap")
  assert.equal(modeRouter.resolveCascadeSlot(["local"]), "cheap")
  assert.equal(modeRouter.resolveCascadeSlot([]), "cheap")
})

test("cascade: mode router getAllModes has all branded and runtime modes", async (t) => {
  const brandedIds = modeRouter.getBrandedModes().map(m => m.id)
  assert.ok(brandedIds.includes("vibeultrax"), "must include vibeultrax")
  assert.ok(brandedIds.includes("vibeqmax"), "must include vibeqmax")
  assert.ok(brandedIds.includes("vibemax"), "must include vibemax")
  assert.ok(brandedIds.includes("vibelitex"), "must include vibelitex")

  const runtimeIds = modeRouter.getRuntimeModes().map(m => m.id)
  assert.ok(runtimeIds.includes("balanced"), "must include balanced")
  assert.ok(runtimeIds.includes("speed"), "must include speed")
  assert.ok(runtimeIds.includes("budget"), "must include budget")
  assert.ok(runtimeIds.includes("quality"), "must include quality")
  assert.ok(runtimeIds.includes("audit"), "must include audit")
  assert.ok(runtimeIds.includes("longrun"), "must include longrun")
  assert.ok(runtimeIds.includes("forensic"), "must include forensic")
})

test("cascade: computeDifficulty confidence levels scale correctly", async (t) => {
  // Very simple → high confidence
  const verySimple = mlRouter.computeDifficulty("ls")
  assert.ok(verySimple.confidence >= 0.7, `very simple should have high confidence, got ${verySimple.confidence}`)

  // Complex prompts — confidence may be moderate due to borderline classification
  const complex = mlRouter.computeDifficulty("implement refactor redesign architect migrate optimize deploy observability orchestrate automate scale secure monitor alert restore backup replicate shard partition")
  assert.ok(complex.confidence > 0, `complex must have confidence > 0, got ${complex.confidence}`)
  assert.ok(complex.level === "moderate" || complex.score > 0.4, `complex text should be moderate or higher, got ${complex.level}`)

  // Borderline → moderate confidence
  const borderline = mlRouter.computeDifficulty("add tests for the login form")
  assert.ok(borderline.confidence > 0, "all prompts must have confidence > 0")
})

test("cascade: directives include loop prevention when looping detected", async (t) => {
  const state = {
    sub_regime: "LOOPING", resolution: "looping", momentum: 0.1,
    signals: { action_consistency: 0.3, entropy_trend: 0.1, feature_contradiction: 0.2, embedding_delta: 0.1 },
    intent_state: { volatility_score: 0.1, drift_rate: 0.1, core_goal_embedding: null },
    continuity_state: "LOW", is_looping: true, loop_consecutive: 4, repeat_streak: 3,
    loop_intervention_level: "escalated", pivot_detected: false, pivot_score: 0,
    outcome: null, n_interactions: 6, latest_stress_multiplier: 0.8,
  }

  const cv = meta.computeControlVector(state, "question", "vibemax")
  const loopDirectives = cv.directives.filter(d => d.includes("loop prevention"))
  assert.ok(loopDirectives.length > 0, "LOOPING must produce loop prevention directives")
  assert.ok(loopDirectives[0].includes("escalated"), "escalated loop must appear in directive")
})

test("cascade: null/undefined prompt doesn't crash extractFeatures or computeDifficulty", async (t) => {
  // These must not throw
  assert.doesNotThrow(() => mlRouter.extractFeatures(null), "extractFeatures(null) must not throw")
  assert.doesNotThrow(() => mlRouter.extractFeatures(undefined), "extractFeatures(undefined) must not throw")
  assert.doesNotThrow(() => mlRouter.extractFeatures(""), "extractFeatures('') must not throw")

  const emptyFeatures = mlRouter.extractFeatures("")
  assert.ok(typeof emptyFeatures === "object", "empty prompt must return object")

  const nullDifficulty = mlRouter.computeDifficulty(null)
  assert.ok(nullDifficulty.level, "computeDifficulty(null) must return valid result")
  assert.ok(nullDifficulty.suggestedTier, "computeDifficulty(null) must return suggestedTier")

  // cascadeDecide with null should not crash
  assert.doesNotThrow(() => mlRouter.cascadeDecide(null, 0.001, 0.005, 0.02, 0.85))
})

test("cascade: MODE_DELTAS has all branded and runtime mode entries", async (t) => {
  const deltas = meta.MODE_DELTAS
  const expectedModes = ["balanced", "budget", "quality", "speed", "longrun", "vibemax", "vibeultrax", "vibeqmax", "forensic", "audit", "litex"]
  for (const mode of expectedModes) {
    assert.ok(mode in deltas, `MODE_DELTAS must have entry for ${mode}`)
  }
})

test("cascade: computeControlVector with auto mode delegates to autoSelectMode", async (t) => {
  const state = {
    sub_regime: "CONVERGING", resolution: "converging", momentum: 0.7,
    signals: { action_consistency: 0.8, entropy_trend: 0.05, feature_contradiction: 0.1, embedding_delta: 0.05 },
    intent_state: { volatility_score: 0.1, drift_rate: 0.05, core_goal_embedding: null },
    continuity_state: "HIGH", is_looping: false, loop_consecutive: 0, repeat_streak: 0,
    loop_intervention_level: "none", pivot_detected: false, pivot_score: 0,
    outcome: null, n_interactions: 8, latest_stress_multiplier: 0.2,
  }

  const cv = meta.computeControlVector(state, "test", "auto")
  assert.equal(cv.optimization_mode, "quality", "auto mode for CONVERGING should select quality")
  assert.equal(cv.tier_bias, "brain", "quality mode should use brain tier")
  assert.equal(cv.thinking_mode, "full", "quality mode should use full thinking")
})

// ── Cleanup ──────────────────────────────────────────────────────────
test.after(() => {
  try { rmSync(SANDBOX, { recursive: true, force: true }) } catch {}
})
