import test from "node:test"
import assert from "node:assert"
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "bb-stress-"))
  const claudeDir = join(dir, ".claude")
  mkdirSync(claudeDir, { recursive: true })
  return { dir, claudeDir }
}

const IMPORT_PREFIX = process.cwd()

let _rtMod = null
let _mcMod = null
let _classifyMod = null

async function loadModules() {
  if (_rtMod) return { rtMod: _rtMod, mcMod: _mcMod, classifyMod: _classifyMod }
  _rtMod = await import(join(IMPORT_PREFIX, "src/vibeOS-lib/blackbox/index.js"))
  _mcMod = _rtMod
  _classifyMod = await import(join(IMPORT_PREFIX, "src/lib/classifiers.js"))
  return { rtMod: _rtMod, mcMod: _mcMod, classifyMod: _classifyMod }
}

test("full blackbox and stress pipeline", async (t) => {
  const { rtMod, classifyMod } = await loadModules()
  const { claudeDir } = sandbox()
  const prevHome = process.env.HOME
  process.env.HOME = claudeDir.replace("/.claude", "")

  try {
    writeFileSync(join(claudeDir, "blackbox-state.json"), JSON.stringify({ enabled: true }, null, 2))

    const { ResolutionTracker, computeControlVector } = rtMod
    const { scoreStress, detectOutcomeSignal } = classifyMod

    assert.ok(typeof ResolutionTracker === "function", "ResolutionTracker is a class")
    assert.ok(typeof computeControlVector === "function", "computeControlVector is a function")
    assert.ok(typeof scoreStress === "function", "scoreStress is a function")
    assert.ok(typeof detectOutcomeSignal === "function", "detectOutcomeSignal is a function")

    const tracker = new ResolutionTracker("test-session", 15)
    assert.ok(tracker instanceof ResolutionTracker, "instantiated")
    assert.ok(Array.isArray(ResolutionTracker.SUB_REGIMES), "has SUB_REGIMES")
    assert.equal(tracker.sessionId, "test-session")

    const messages = [
      { text: "hello", action: "greet", entropy: 0.5, uncertainty: 0.3 },
      { text: "i need to implement a user authentication module with JWT tokens and password hashing using bcrypt can you help me design this", action: "research", entropy: 0.7, uncertainty: 0.5 },
      { text: "what are the best practices for securing REST APIs rate limiting input validation and CORS configuration", action: "research", entropy: 0.6, uncertainty: 0.4 },
      { text: "let me think about how to structure the auth flow register login refresh token and logout endpoints", action: "think", entropy: 0.4, uncertainty: 0.35 },
      { text: "ok here is what I want write the register endpoint with email validation password strength check and JWT issuance", action: "write", entropy: 0.3, uncertainty: 0.2 },
      { text: "now add the login endpoint with credential verification and token refresh logic", action: "write", entropy: 0.25, uncertainty: 0.15 },
      { text: "that looks good but fix the error handling in the register function it should return proper status codes", action: "edit", entropy: 0.2, uncertainty: 0.1 },
      { text: "thanks that works now implement the logout endpoint and test it", action: "write", entropy: 0.15, uncertainty: 0.08 },
      { text: "perfect everything compiles and the tests pass", action: "verify", entropy: 0.1, uncertainty: 0.05 },
      { text: "wrap up the module and commit the changes", action: "commit", entropy: 0.05, uncertainty: 0.02 },
    ]

    const FEATURE_COUNT = 11
    const states = []

    for (const msg of messages) {
      const features = ResolutionTracker.extractFeatures(msg.text)
      const featureKeys = Object.keys(features)
      assert.equal(featureKeys.length, FEATURE_COUNT,
        `extractFeatures("${msg.text.slice(0, 30)}...") returned ${featureKeys.length} features, expected ${FEATURE_COUNT}`)
      assert.ok(features.hasOwnProperty("length"), "has length")
      assert.ok(features.hasOwnProperty("word_count"), "has word_count")
      assert.ok(features.hasOwnProperty("sentence_count"), "has sentence_count")
      assert.ok(features.hasOwnProperty("avg_word_length"), "has avg_word_length")
      assert.ok(features.hasOwnProperty("question_ratio"), "has question_ratio")
      assert.ok(features.hasOwnProperty("code_blocks"), "has code_blocks")
      assert.ok(features.hasOwnProperty("urgency"), "has urgency")
      assert.ok(features.hasOwnProperty("repetition"), "has repetition")
      assert.ok(features.hasOwnProperty("sentiment"), "has sentiment")
      assert.ok(features.hasOwnProperty("complexity"), "has complexity")
      assert.ok(features.hasOwnProperty("instruction_density"), "has instruction_density")
      for (const [k, v] of Object.entries(features)) {
        assert.ok(typeof v === "number" && v >= 0 && v <= 1,
          `feature "${k}" = ${v} not in [0,1]`)
      }

      const state = tracker.update(msg.text, features, msg.action, msg.entropy, msg.uncertainty)
      states.push(state)
    }

    assert.equal(states.length, 10, "10 states recorded")

    const regimes = states.map(s => s.sub_regime)
    console.error("Regime sequence: " + regimes.join(" → "))

    assert.equal(regimes[0], "INIT", "first message is INIT")

    const nonInit = regimes.slice(1)
    const hasExploring = nonInit.includes("EXPLORING")
    const hasRefining = nonInit.includes("REFINING")
    const hasConverging = nonInit.includes("CONVERGING")

    assert.ok(hasExploring || hasRefining || hasConverging,
      `regime sequence should include at least one of EXPLORING/REFINING/CONVERGING, got: ${regimes.join(", ")}`)

    assert.ok(states.some(s => s.resolution === "unresolved"), "at least one unresolved state")
    assert.ok(states.some(s => s.momentum !== undefined), "states have momentum")
    assert.ok(states.some(s => s.signals && typeof s.signals.action_consistency === "number"), "states have signal action_consistency")
    assert.ok(states.some(s => s.intent_state && typeof s.intent_state.volatility_score === "number"), "states have intent_state")

    console.error("Regime transition sequence verified: " + regimes.join(" → "))

    console.error("--- Loop detection test ---")
    const loopTracker = new ResolutionTracker("loop-test", 15)
    const loopMsg = "fix this bug it keeps crashing"
    const loopStates = []
    for (let i = 0; i < 4; i++) {
      const features = ResolutionTracker.extractFeatures(loopMsg)
      const state = loopTracker.update(loopMsg, features, "fix", 0.5, 0.5)
      loopStates.push(state)
    }

    const lastLoopState = loopStates[loopStates.length - 1]
    assert.ok(lastLoopState.loop_consecutive > 0, `loop_consecutive should be > 0, got ${lastLoopState.loop_consecutive}`)
    assert.ok(lastLoopState.is_looping, "should detect looping after 4 identical messages")
    assert.ok(lastLoopState.loop_intervention_level !== "none",
      `loop_intervention_level should be non-none, got ${lastLoopState.loop_intervention_level}`)
    console.error(`Loop intervention level after 4 identical msgs: ${lastLoopState.loop_intervention_level} (loopCount=${lastLoopState.loop_consecutive}, repeatStreak=${lastLoopState.repeat_streak})`)

    assert.ok(lastLoopState.loop_intervention_level === "escalated" || lastLoopState.loop_intervention_level === "assertive",
      `loop should reach assertive/escalated, got ${lastLoopState.loop_intervention_level}`)

    const inter = loopTracker.getLoopIntervention()
    assert.ok(inter !== null, "getLoopIntervention should return non-null when looping")
    assert.ok(typeof inter.directive === "string" && inter.directive.length > 20, "loop intervention has directive")
    assert.ok(inter.level === lastLoopState.loop_intervention_level, "intervention level matches state")

    console.error("--- Pivot detection test ---")
    const pivotTracker = new ResolutionTracker("pivot-test", 15)
    const pivotGroup = [
      { text: "implement the user login page with react hooks", action: "write" },
      { text: "add form validation to the login page", action: "edit" },
      { text: "style the login page with tailwind css", action: "write" },
      { text: "completely switch topic configure nginx reverse proxy for the production server", action: "write" },
    ]
    const pivotStates = []
    for (const msg of pivotGroup) {
      const features = ResolutionTracker.extractFeatures(msg.text)
      const state = pivotTracker.update(msg.text, features, msg.action, 0.3, 0.2)
      pivotStates.push(state)
    }

    const lastPivotState = pivotStates[pivotStates.length - 1]
    assert.ok(lastPivotState.pivot_detected,
      "pivot should be detected when topic changes drastically, got pivot_detected=" + lastPivotState.pivot_detected)
    console.error(`Pivot detected: ${lastPivotState.pivot_detected}, pivotScore: ${lastPivotState.pivot_score}`)

    const pivotDir = pivotTracker.getPivotDirective()
    assert.ok(pivotDir !== null, "getPivotDirective should return non-null when pivot_detected")
    assert.ok(pivotDir.includes("PIVOT"), "pivot directive contains PIVOT marker")

    console.error("--- Meta-controller / computeControlVector test ---")
    const allRegimes = ["INIT", "EXPLORING", "DIVERGENT", "REFINING", "CONVERGING", "CLOSED", "LOOPING", "FORENSIC", "AUDIT"]
    const allModes = ["balanced", "budget", "quality", "speed", "longrun", "vibemax", "vibeultrax", "vibeqmax", "forensic", "audit", "litex"]

    const sampleState = {
      sub_regime: "EXPLORING",
      resolution: "unresolved",
      momentum: 0.5,
      signals: { action_consistency: 0.6, entropy_trend: 0.1, feature_contradiction: 0.2, embedding_delta: 0.3 },
      intent_state: { volatility_score: 0.2, drift_rate: 0.1, core_goal_embedding: null },
      continuity_state: "HIGH",
      is_looping: false,
      loop_consecutive: 0,
      loop_intervention_level: "none",
      pivot_detected: false,
      pivot_score: 0.1,
      outcome: null,
      n_interactions: 5,
    }

    for (const regime of allRegimes) {
      const regimeState = { ...sampleState, sub_regime: regime }
      for (const mode of allModes) {
        const cv = computeControlVector(regimeState, "test", mode)
        assert.ok(cv, `computeControlVector returned something for regime=${regime} mode=${mode}`)
        assert.ok(cv.optimization_mode, `has optimization_mode for ${regime}/${mode}`)
        assert.ok(cv.enforcement_mode, `has enforcement_mode for ${regime}/${mode}`)
        assert.ok(cv.flow_mode, `has flow_mode for ${regime}/${mode}`)
        assert.ok(cv.tdd_mode, `has tdd_mode for ${regime}/${mode}`)
        assert.ok(cv.tier_bias, `has tier_bias for ${regime}/${mode}`)
        assert.ok(cv.thinking_mode, `has thinking_mode for ${regime}/${mode}`)
        assert.ok(typeof cv.stress_multiplier === "number", `has numeric stress_multiplier for ${regime}/${mode}`)
        assert.ok(cv.context7_urgency, `has context7_urgency for ${regime}/${mode}`)
        assert.ok(cv.wbp_verbosity, `has wbp_verbosity for ${regime}/${mode}`)
        assert.ok(Array.isArray(cv.directives), `has directives array for ${regime}/${mode}`)
        assert.equal(cv.optimization_mode, mode === "auto" ? "vibelitex" : mode,
          `optimization_mode matches for ${regime}/${mode}`)
      }
    }
    console.error(`All ${allRegimes.length} regimes × ${allModes.length} modes = ${allRegimes.length * allModes.length} control vectors verified`)

    console.error("--- Stress scoring test ---")

    const highStress = scoreStress("fuck this broken shit is useless")
    assert.ok(highStress > 0.4, `high stress text scored ${highStress}, expected > 0.4`)
    console.error(`scoreStress("fuck this broken shit...") = ${highStress}`)

    const lowStress = scoreStress("help me understand how this works")
    assert.ok(lowStress < 0.1, `low stress text scored ${lowStress}, expected < 0.1`)
    console.error(`scoreStress("help me understand...") = ${lowStress}`)

    const exactSpec = scoreStress("fuck this broken shit")
    assert.ok(exactSpec > 0.4, `exact spec "fuck this broken shit" scored ${exactSpec}, expected > 0.4`)

    const exactLowSpec = scoreStress("help me understand")
    assert.ok(exactLowSpec < 0.1, `exact spec "help me understand" scored ${exactLowSpec}, expected < 0.1`)

    console.error("--- Outcome detection test ---")

    const posOutcome = detectOutcomeSignal("thanks that works perfectly")
    assert.equal(posOutcome, "positive", `"thanks that works perfectly" → "${posOutcome}", expected "positive"`)

    const negOutcome = detectOutcomeSignal("still broken and not working")
    assert.equal(negOutcome, "negative", `"still broken and not working" → "${negOutcome}", expected "negative"`)

    const nullOutcome = detectOutcomeSignal("what is the weather today")
    assert.equal(nullOutcome, null, `"what is the weather" → ${nullOutcome}, expected null`)

    const exactPos = detectOutcomeSignal("thanks that works")
    assert.equal(exactPos, "positive", `"thanks that works" → "${exactPos}", expected "positive"`)

    const exactNeg = detectOutcomeSignal("still broken")
    assert.equal(exactNeg, "negative", `"still broken" → "${exactNeg}", expected "negative"`)

    console.error("--- Serialization / persistence test ---")
    const serialized = tracker.serialize()
    assert.ok(serialized.sessionId === "test-session", "serialized sessionId preserved")
    assert.ok(Array.isArray(serialized.history), "serialized has history array")
    assert.ok(Array.isArray(serialized.outcomeHistory), "serialized has outcomeHistory")
    assert.ok(typeof serialized.loopCount === "number", "serialized has loopCount")

    const deserialized = ResolutionTracker.deserialize(serialized)
    assert.ok(deserialized instanceof ResolutionTracker, "deserialized is ResolutionTracker")
    assert.equal(deserialized.sessionId, "test-session", "deserialized sessionId matches")
    assert.equal(deserialized.history.length, serialized.history.length, "deserialized history length matches")

    console.error("--- serialize + deserialize round-trip OK ---")

    const results = {
      timestamp: new Date().toISOString(),
      feature_count: FEATURE_COUNT,
      regimes_observed: regimes,
      regime_sequence_ok: true,
      has_exploring: hasExploring,
      has_refining: hasRefining,
      has_converging: hasConverging,
      loop_detection: {
        loop_consecutive: lastLoopState.loop_consecutive,
        is_looping: lastLoopState.is_looping,
        loop_intervention_level: lastLoopState.loop_intervention_level,
        get_loop_intervention_works: inter !== null,
      },
      pivot_detection: {
        pivot_detected: lastPivotState.pivot_detected,
        pivot_score: lastPivotState.pivot_score,
        get_pivot_directive_works: pivotDir !== null,
      },
      control_vectors: {
        regimes_tested: allRegimes.length,
        modes_tested: allModes.length,
        total: allRegimes.length * allModes.length,
        all_valid: true,
      },
      stress_scoring: {
        high_stress_text: "fuck this broken shit is useless",
        high_stress_score: highStress,
        high_stress_threshold_met: highStress > 0.4,
        low_stress_text: "help me understand how this works",
        low_stress_score: lowStress,
        low_stress_threshold_met: lowStress < 0.1,
      },
      outcome_detection: {
        positive: { input: "thanks that works perfectly", result: posOutcome },
        negative: { input: "still broken and not working", result: negOutcome },
        null: { input: "what is the weather today", result: nullOutcome },
      },
      serialize_deserialize: {
        history_length: serialized.history.length,
        round_trip_ok: deserialized.history.length === serialized.history.length,
      },
    }

    writeFileSync(join(claudeDir, "test-blackbox-stress.json"), JSON.stringify(results, null, 2))
    console.error("Results written to ~/.claude/test-blackbox-stress.json")

    console.error(JSON.stringify(results, null, 2))
  } finally {
    process.env.HOME = prevHome
  }
})
