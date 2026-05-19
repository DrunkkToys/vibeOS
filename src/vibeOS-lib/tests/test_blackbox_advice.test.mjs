import test from "node:test"
import assert from "node:assert/strict"
import {
  buildAdvice,
  buildDecisionBlock,
  computeModality,
  humanReadableAction,
  compressMetrics,
  compressUncertainty,
  compressEntropy,
  enforceClosure,
  stabilityScore,
  shouldUseFastPath,
  buildCautionNote,
  scoreUsefulness,
  getFallbackPlan,
  getActionSuggestion,
  getCuriosityPrompt,
} from "../blackbox/index.js"

test("computeModality — low risk + converging = strict", () => {
  assert.equal(computeModality("low", "CONVERGING"), "strict")
})

test("computeModality — high risk = exploratory", () => {
  assert.equal(computeModality("high", "INIT"), "exploratory")
})

test("computeModality — divergent = exploratory", () => {
  assert.equal(computeModality("low", "DIVERGENT"), "exploratory")
})

test("computeModality — medium risk + exploring = suggestive", () => {
  assert.equal(computeModality("medium", "EXPLORING"), "suggestive")
})

test("compressUncertainty — low/medium/high thresholds", () => {
  assert.equal(compressUncertainty(20), "low")
  assert.equal(compressUncertainty(30), "low")
  assert.equal(compressUncertainty(45), "medium")
  assert.equal(compressUncertainty(60), "medium")
  assert.equal(compressUncertainty(75), "high")
  assert.equal(compressUncertainty(100), "high")
})

test("compressEntropy — descriptive levels", () => {
  assert.ok(compressEntropy(0.3).includes("largely settled"))
  assert.ok(compressEntropy(1.0).includes("preference is emerging"))
  assert.ok(compressEntropy(1.5).includes("genuinely torn"))
  assert.ok(compressEntropy(2.0).includes("pulled in many directions"))
})

test("enforceClosure — high confidence + act = no change", () => {
  const [action, changed] = enforceClosure("act", 0.8, { sub_regime: "CONVERGING" })
  assert.equal(action, "act")
  assert.equal(changed, false)
})

test("enforceClosure — low confidence + explore → act (safe action)", () => {
  const [action, changed] = enforceClosure("explore", 0.3, { sub_regime: "INIT" })
  assert.equal(action, "act")
  assert.equal(changed, true)
})

test("enforceClosure — high confidence + explore → commit", () => {
  const [action, changed] = enforceClosure("explore", 0.9, { sub_regime: "CLOSED" })
  assert.equal(action, "commit")
  assert.equal(changed, true)
})

test("buildAdvice — returns structured output", () => {
  const advice = buildAdvice("act", { uncertainty: 25, entropy: 0.8, confidence: 0.7 })
  assert.equal(advice.action, "act")
  assert.ok(advice.risk_level)
  assert.ok(advice.guidance)
  assert.ok(advice.situation_description)
  assert.ok(advice.decision_block)
  assert.ok(advice.decision_block.modality)
  assert.ok(advice.decision_block.if_unsure)
})

test("buildAdvice — high uncertainty = high risk", () => {
  const advice = buildAdvice("observe", { uncertainty: 80, entropy: 2.0, confidence: 0.2 })
  assert.equal(advice.risk_level, "high")
})

test("buildDecisionBlock — exploratory modality uses consider_today", () => {
  const block = buildDecisionBlock("explore", "exploratory")
  assert.ok(block.consider_today)
  assert.ok(block.avoid_today)
  assert.equal(block.modality, "exploratory")
})

test("buildDecisionBlock — suggestive modality uses do_today", () => {
  const block = buildDecisionBlock("act", "suggestive")
  assert.ok(block.do_today)
  assert.ok(block.avoid_today)
  assert.equal(block.modality, "suggestive")
})

test("humanReadableAction — returns description", () => {
  assert.ok(humanReadableAction("observe").length > 0)
  assert.ok(humanReadableAction("defer").length > 0)
  assert.ok(humanReadableAction("explore").length > 0)
  assert.ok(humanReadableAction("act").length > 0)
  assert.ok(humanReadableAction("commit").length > 0)
  assert.ok(humanReadableAction("change").length > 0)
})

test("humanReadableAction — LOW continuity adds warning", () => {
  const desc = humanReadableAction("act", "LOW")
  assert.ok(desc.includes("confirm your goal hasn't shifted"))
})

test("compressMetrics — returns risk/guidance/situation", () => {
  const metrics = compressMetrics({ uncertainty: 40, entropy: 1.0 }, { sub_regime: "EXPLORING" }, "explore")
  assert.ok(metrics.risk_level)
  assert.ok(metrics.guidance)
  assert.ok(metrics.situation_description)
})

test("stabilityScore — high consistency + low entropy = high stability", () => {
  const score = stabilityScore(
    { sub_regime: "CLOSED", signals: { action_consistency: 0.9 } },
    { entropy: 0.2 }
  )
  assert.ok(score > 0.7)
})

test("stabilityScore — low consistency = low stability", () => {
  const score = stabilityScore(
    { sub_regime: "DIVERGENT", signals: { action_consistency: 0.1 } },
    { entropy: 1.5 }
  )
  assert.ok(score < 0.3)
})

test("shouldUseFastPath — CLOSED + low entropy + high stability = true", () => {
  const result = shouldUseFastPath(
    { sub_regime: "CLOSED", signals: { action_consistency: 0.9, feature_contradiction: 0.1 } },
    { entropy: 0.3 }
  )
  assert.equal(result, true)
})

test("shouldUseFastPath — INIT regime = false", () => {
  const result = shouldUseFastPath({ sub_regime: "INIT" })
  assert.equal(result, false)
})

test("shouldUseFastPath — high entropy = false", () => {
  const result = shouldUseFastPath(
    { sub_regime: "CLOSED", signals: { action_consistency: 0.9, feature_contradiction: 0.1 } },
    { entropy: 0.8 }
  )
  assert.equal(result, false)
})

test("buildCautionNote — verification required + converging", () => {
  const note = buildCautionNote(true, "CONVERGING")
  assert.ok(note.includes("confident"))
})

test("buildCautionNote — no verification = empty", () => {
  const note = buildCautionNote(false, "CONVERGING")
  assert.equal(note, "")
})

test("scoreUsefulness — full output scores well", () => {
  const output = {
    advice: {
      action: "act",
      action_description: "Move forward",
      guidance: "Proceed with care",
      situation_description: "Things look good",
      risk_level: "low",
      decision_block: {
        do_today: ["Step 1"],
        avoid_today: ["Don't wait"],
        if_unsure: "Start small",
      },
    },
    diagnostics: { confidence: 0.8 },
    symbolic: { hexagram: "1" },
    latent: { regime: "stable" },
    resolution: { state: "converging" },
    taxonomy: { type: "work" },
  }
  const score = scoreUsefulness(output)
  assert.ok(score.total > 0.5)
  assert.ok(score.action_usefulness > 0)
  assert.ok(score.emotional_clarity > 0)
})

test("getFallbackPlan — returns steps for each action", () => {
  for (const action of ["observe", "defer", "explore", "act", "commit", "change"]) {
    const plan = getFallbackPlan(action)
    assert.ok(Array.isArray(plan))
    assert.ok(plan.length >= 3)
  }
})

test("getActionSuggestion — returns string for each action", () => {
  for (const action of ["observe", "defer", "explore", "act", "commit", "change"]) {
    const suggestion = getActionSuggestion(action)
    assert.ok(typeof suggestion === "string")
    assert.ok(suggestion.length > 10)
  }
})

test("getCuriosityPrompt — returns question for each action", () => {
  for (const action of ["observe", "defer", "explore", "act", "commit", "change"]) {
    const prompt = getCuriosityPrompt(action)
    assert.ok(typeof prompt === "string")
    assert.ok(prompt.includes("?"))
  }
})
