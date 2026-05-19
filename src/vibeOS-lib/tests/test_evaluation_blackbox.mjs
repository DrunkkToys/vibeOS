import test from "node:test"
import assert from "node:assert/strict"
import { ResolutionTracker } from "../blackbox/resolution-tracker.js"
import { classifySituation, recommendAction } from "../blackbox/taxonomy.js"
import { ExposureModel } from "../blackbox/exposure-model.js"
import { buildAdvice, computeModality, enforceClosure } from "../blackbox/advice-layer.js"

// ── Labeled test sequences ──────────────────────────────────────────
// Each sequence simulates a multi-message conversation.
// expected -> expected regime after the LAST message in the sequence.
const SEQUENCES = [

  // ── CONVERGING ──────────────────────────────────────────────────
  {
    name: "converging - simple decision",
    messages: [
      { text: "I need to decide between two job offers", action: "explore", entropy: 1.3, uncertainty: 55 },
      { text: "Let me compare the compensation packages", action: "explore", entropy: 1.1, uncertainty: 50 },
      { text: "Company A has better benefits but Company B pays more", action: "act", entropy: 0.9, uncertainty: 40 },
      { text: "I think I will go with Company B", action: "act", entropy: 0.6, uncertainty: 30 },
    ],
    expected: { sub_regime: "CONVERGING", is_looping: false },
  },
  {
    name: "converging - slow tightening",
    messages: [
      { text: "What color should I paint the living room", action: "explore", entropy: 1.2, uncertainty: 50 },
      { text: "White is classic but blue is calming", action: "explore", entropy: 1.0, uncertainty: 45 },
      { text: "My wife prefers light gray actually", action: "observe", entropy: 0.9, uncertainty: 40 },
      { text: "Okay let us go with light gray it works for both", action: "commit", entropy: 0.5, uncertainty: 25 },
      { text: "Light gray it is I will order the paint today", action: "commit", entropy: 0.3, uncertainty: 15 },
    ],
    expected: { sub_regime: "CONVERGING", is_looping: false },
  },
  {
    name: "converging - fast decision",
    messages: [
      { text: "Should I buy this laptop on sale", action: "explore", entropy: 1.0, uncertainty: 50 },
      { text: "The specs are good and the price is right", action: "act", entropy: 0.7, uncertainty: 35 },
      { text: "I am buying it now before the sale ends", action: "commit", entropy: 0.4, uncertainty: 20 },
    ],
    expected: { sub_regime: "CONVERGING", is_looping: false },
  },

  // ── DIVERGENT ───────────────────────────────────────────────────
  {
    name: "divergent - increasing entropy",
    messages: [
      { text: "I want to start a side business", action: "explore", entropy: 1.0, uncertainty: 40 },
      { text: "Maybe a coffee shop or an online store", action: "explore", entropy: 1.3, uncertainty: 50 },
      { text: "Actually what about dropshipping or freelancing", action: "explore", entropy: 1.6, uncertainty: 60 },
      { text: "Wait I could also do consulting or create a course", action: "explore", entropy: 1.9, uncertainty: 70 },
    ],
    expected: { sub_regime: "DIVERGENT", is_looping: false },
  },
  {
    name: "divergent - scattered signals",
    messages: [
      { text: "I am unhappy with my current living situation", action: "observe", entropy: 0.8, uncertainty: 35 },
      { text: "Should I move to a new city", action: "explore", entropy: 1.2, uncertainty: 50 },
      { text: "Or should I renovate my current place", action: "defer", entropy: 1.5, uncertainty: 60 },
      { text: "Maybe I just need a vacation not a move", action: "change", entropy: 1.8, uncertainty: 65 },
    ],
    expected: { sub_regime: "DIVERGENT", is_looping: false },
  },

  // ── EXPLORING ───────────────────────────────────────────────────
  {
    name: "exploring - steady exploration",
    messages: [
      { text: "I am researching different CRM tools", action: "explore", entropy: 1.0, uncertainty: 50 },
      { text: "HubSpot seems popular for small businesses", action: "explore", entropy: 1.0, uncertainty: 48 },
      { text: "Salesforce is too expensive for what we need", action: "explore", entropy: 1.1, uncertainty: 50 },
      { text: "What about Pipedrive or Zoho", action: "explore", entropy: 1.0, uncertainty: 47 },
    ],
    expected: { sub_regime: "EXPLORING", is_looping: false },
  },
  {
    name: "exploring - information gathering",
    messages: [
      { text: "I want to learn machine learning", action: "explore", entropy: 1.2, uncertainty: 55 },
      { text: "Should I take a course or read a book", action: "explore", entropy: 1.1, uncertainty: 50 },
      { text: "Andrew Ng course is supposed to be great", action: "observe", entropy: 1.0, uncertainty: 48 },
      { text: "Also fastai has a practical approach", action: "explore", entropy: 1.1, uncertainty: 50 },
    ],
    expected: { sub_regime: "EXPLORING", is_looping: false },
  },

  // ── REFINING ────────────────────────────────────────────────────
  {
    name: "refining - near-final tweaks",
    messages: [
      { text: "I will accept the offer but negotiate the start date", action: "act", entropy: 0.58, uncertainty: 25 },
      { text: "Actually I will also ask for a signing bonus", action: "act", entropy: 0.58, uncertainty: 20 },
      { text: "And I need to review the non-compete clause", action: "act", entropy: 0.58, uncertainty: 18 },
    ],
    expected: { sub_regime: "REFINING", is_looping: false },
  },
  {
    name: "refining - small adjustments",
    messages: [
      { text: "The website design is mostly done", action: "act", entropy: 0.55, uncertainty: 20 },
      { text: "Just need to tweak the mobile layout", action: "act", entropy: 0.55, uncertainty: 18 },
      { text: "And fix the footer colors", action: "act", entropy: 0.55, uncertainty: 15 },
    ],
    expected: { sub_regime: "REFINING", is_looping: false },
  },

  // ── CLOSED ──────────────────────────────────────────────────────
  {
    name: "closed - clear final decision",
    messages: [
      { text: "I compared all the options for my new phone", action: "explore", entropy: 1.0, uncertainty: 45 },
      { text: "I am leaning toward the Pixel it has the best camera", action: "act", entropy: 0.7, uncertainty: 30 },
      { text: "I am ordering the Pixel tonight", action: "commit", entropy: 0.4, uncertainty: 15 },
    ],
    expected: { sub_regime: "CLOSED", is_looping: false },
  },
  {
    name: "closed - confirmed closure",
    messages: [
      { text: "Should I invest in index funds", action: "explore", entropy: 1.0, uncertainty: 50 },
      { text: "VOO has low fees and tracks the S&P 500", action: "act", entropy: 0.7, uncertainty: 35 },
      { text: "I will put 500 a month into VOO starting this month", action: "commit", entropy: 0.4, uncertainty: 20 },
      { text: "Done I set up the recurring investment just now", action: "commit", entropy: 0.3, uncertainty: 10 },
    ],
    expected: { sub_regime: "CLOSED", is_looping: false },
  },

  // ── LOOPING ─────────────────────────────────────────────────────
  {
    name: "looping - repetitive text",
    messages: [
      { text: "I cannot decide whether to quit my job", action: "defer", entropy: 1.5, uncertainty: 70 },
      { text: "The main issue is the commute is too long", action: "explore", entropy: 1.4, uncertainty: 65 },
      { text: "But the pay is good and the benefits are solid", action: "defer", entropy: 1.3, uncertainty: 60 },
      { text: "I cannot decide whether to quit my job decide to quit", action: "defer", entropy: 1.5, uncertainty: 70 },
    ],
    expected: { is_looping: true },
  },
  {
    name: "looping - no progress",
    messages: [
      { text: "Should I breakup with my girlfriend", action: "defer", entropy: 1.8, uncertainty: 70 },
      { text: "I keep going back and forth on this decision", action: "observe", entropy: 1.7, uncertainty: 68 },
      { text: "Maybe I should think about it more", action: "defer", entropy: 1.6, uncertainty: 65 },
      { text: "I should breakup with my girlfriend should I breakup", action: "defer", entropy: 1.8, uncertainty: 70 },
    ],
    expected: { is_looping: true },
  },

  // ── INIT ─────────────────────────────────────────────────────────
  {
    name: "init - single message",
    messages: [
      { text: "I have a problem I need help with", action: "explore", entropy: 1.2, uncertainty: 55 },
    ],
    expected: { sub_regime: "INIT", is_looping: false },
  },

  // ── EDGE CASES ──────────────────────────────────────────────────
  {
    name: "edge - empty features",
    messages: [
      { text: "Hello", action: "explore", entropy: 1.0, uncertainty: 50, features: {} },
      { text: "How are you", action: "explore", entropy: 1.0, uncertainty: 50, features: {} },
    ],
    expected: { is_looping: false },
  },
  {
    name: "edge - action switching without divergence",
    messages: [
      { text: "I will start with research", action: "explore", entropy: 1.2, uncertainty: 55 },
      { text: "Actually let me observe first", action: "observe", entropy: 1.0, uncertainty: 50 },
      { text: "No I should act now", action: "act", entropy: 0.8, uncertainty: 40 },
      { text: "Wait I need to defer this", action: "defer", entropy: 0.7, uncertainty: 35 },
      { text: "Alright I will commit to a decision", action: "commit", entropy: 0.5, uncertainty: 25 },
    ],
    expected: { is_looping: false },
  },
]

// ── Full pipeline test cases (end-to-end: classifySituation → resolve) ──
const PIPELINE_CASES = [
  {
    name: "pipeline - work situation converges",
    messages: [
      { text: "I need to decide between two job offers", entropy: 1.2, uncertainty: 50 },
      { text: "Company A offers better growth potential", entropy: 1.0, uncertainty: 45 },
      { text: "I will accept Company A they have the best long term prospects", entropy: 0.6, uncertainty: 25 },
    ],
    expected_situation: "work",
  },
  {
    name: "pipeline - financial situation diverges",
    messages: [
      { text: "I need to invest my savings somewhere", entropy: 1.0, uncertainty: 40 },
      { text: "Maybe real estate or maybe the stock market", entropy: 1.4, uncertainty: 55 },
      { text: "Or cryptocurrency could be good too", entropy: 1.7, uncertainty: 65 },
    ],
    expected_situation: "financial",
  },
  {
    name: "pipeline - relationship looping",
    messages: [
      { text: "My partner and I are fighting a lot", entropy: 1.5, uncertainty: 65 },
      { text: "I am not sure if I should stay or go", entropy: 1.4, uncertainty: 60 },
      { text: "Sometimes we are great together honestly", entropy: 1.5, uncertainty: 65 },
      { text: "My partner and I are fighting my partner and I", entropy: 1.5, uncertainty: 65 },
    ],
    expected_situation: "relationship",
  },
]

// ── Evaluation runner ──────────────────────────────────────────────
function evaluateTracker() {
  const results = []
  for (const seq of SEQUENCES) {
    const tracker = new ResolutionTracker("eval", 10)
    const defaultFeatures = { info: 0.5 }
    for (const msg of seq.messages) {
      const features = msg.features || defaultFeatures
      tracker.update(msg.text, features, msg.action, msg.entropy, msg.uncertainty)
    }
    const state = tracker.snapshot()

    const row = {
      name: seq.name,
      n: seq.messages.length,
      predicted: {
        sub_regime: state.sub_regime,
        resolution: state.resolution,
        is_looping: state.is_looping,
        momentum: state.momentum,
      },
      expected: seq.expected,
      correct: {},
    }

    // Per-field correctness
    if ("sub_regime" in seq.expected) {
      row.correct.sub_regime = state.sub_regime === seq.expected.sub_regime
    }
    if ("resolution" in seq.expected) {
      row.correct.resolution = state.resolution === seq.expected.resolution
    }
    if ("is_looping" in seq.expected) {
      row.correct.is_looping = state.is_looping === seq.expected.is_looping
    }

    results.push(row)
  }
  return results
}

function evaluatePipeline() {
  const model = new ExposureModel()
  const results = []
  for (const seq of PIPELINE_CASES) {
    const tracker = new ResolutionTracker("eval-pipeline", 10)
    for (const msg of seq.messages) {
      const situation = classifySituation(msg.text)
      const exposure = model.computeExposure(msg.uncertainty)
      const rec = recommendAction({ situation_type: situation, exposure, uncertainty_total: msg.uncertainty })
      tracker.update(msg.text, { situation_based: true }, rec.action, msg.entropy, msg.uncertainty)
    }
    const state = tracker.snapshot()

    // Check situation classification on first message
    const firstSituation = classifySituation(seq.messages[0].text)
    results.push({
      name: seq.name,
      n: seq.messages.length,
      situation_predicted: firstSituation,
      situation_expected: seq.expected_situation,
      situation_correct: firstSituation === seq.expected_situation,
      final_regime: state.sub_regime,
      final_resolution: state.resolution,
      is_looping: state.is_looping,
      momentum: state.momentum,
    })
  }
  return results
}

function computeMetrics(results) {
  const fields = ["sub_regime", "resolution", "is_looping"]
  const totals = {}

  for (const field of fields) {
    const correct = results.filter(r => r.correct[field] !== undefined)
    totals[field + "_accuracy"] = correct.length > 0
      ? correct.filter(r => r.correct[field]).length / correct.length
      : null
  }

  // Per-regime precision/recall
  const regimePredictions = results.filter(r => r.correct.sub_regime !== undefined)
  const regimes = [...new Set(regimePredictions.map(r => r.expected.sub_regime))]
  const regimeMetrics = {}
  for (const regime of regimes) {
    const truePos = regimePredictions.filter(r => r.expected.sub_regime === regime && r.predicted.sub_regime === regime).length
    const falsePos = regimePredictions.filter(r => r.expected.sub_regime !== regime && r.predicted.sub_regime === regime).length
    const falseNeg = regimePredictions.filter(r => r.expected.sub_regime === regime && r.predicted.sub_regime !== regime).length
    const precision = truePos + falsePos > 0 ? truePos / (truePos + falsePos) : 0
    const recall = truePos + falseNeg > 0 ? truePos / (truePos + falseNeg) : 0
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0
    regimeMetrics[regime] = { true_pos: truePos, false_pos: falsePos, false_neg: falseNeg, precision, recall, f1 }
  }

  // Confusion matrix
  const confusion = {}
  for (const r of regimePredictions) {
    const key = `${r.expected.sub_regime} -> ${r.predicted.sub_regime}`
    confusion[key] = (confusion[key] || 0) + 1
  }

  const total = results.length
  const correctOverall = results.filter(r =>
    Object.values(r.correct).length > 0 && Object.values(r.correct).every(Boolean)
  ).length

  return {
    total_cases: total,
    exact_match: correctOverall,
    exact_match_accuracy: total > 0 ? correctOverall / total : 0,
    per_field: totals,
    per_regime: regimeMetrics,
    confusion,
  }
}

// ── Pretty printing ────────────────────────────────────────────────
function printResults(evalResults, pipelineResults, metrics) {
  console.log("\n" + "=".repeat(72))
  console.log("  BLACKBOX EVALUATION REPORT")
  console.log("=".repeat(72))

  // Summary
  console.log(`\n  Test sequences: ${evalResults.length}`)
  console.log(`  Pipeline tests: ${pipelineResults.length}`)
  console.log(`  Exact match accuracy: ${(metrics.exact_match_accuracy * 100).toFixed(1)}% (${metrics.exact_match}/${metrics.total_cases})`)

  // Per-field
  console.log(`\n  ── Per-field accuracy ──`)
  for (const [field, acc] of Object.entries(metrics.per_field)) {
    if (acc !== null) {
      console.log(`    ${field.padEnd(20)} ${(acc * 100).toFixed(1)}%`)
    }
  }

  // Per-regime
  console.log(`\n  ── Per-regime metrics ──`)
  console.log(`    ${"Regime".padEnd(16)} ${"Precision".padEnd(12)} ${"Recall".padEnd(12)} ${"F1".padEnd(12)} ${"TP".padEnd(6)} ${"FP".padEnd(6)} ${"FN".padEnd(6)}`)
  for (const [regime, m] of Object.entries(metrics.per_regime)) {
    console.log(`    ${regime.padEnd(16)} ${(m.precision * 100).toFixed(1).padEnd(11)}% ${(m.recall * 100).toFixed(1).padEnd(11)}% ${(m.f1 * 100).toFixed(1).padEnd(11)}% ${String(m.true_pos).padEnd(6)} ${String(m.false_pos).padEnd(6)} ${String(m.false_neg).padEnd(6)}`)
  }

  // Confusion matrix
  console.log(`\n  ── Confusion matrix (expected -> predicted) ──`)
  for (const [key, count] of Object.entries(metrics.confusion).sort()) {
    console.log(`    ${key.padEnd(32)} ${count}`)
  }

  // Pipeline results
  console.log(`\n  ── Pipeline end-to-end results ──`)
  for (const r of pipelineResults) {
    const icon = r.situation_correct ? "\u2713" : "\u2717"
    console.log(`    ${icon} ${r.name}: classify=${r.situation_predicted} (expected ${r.situation_expected}) | regime=${r.final_regime} | looping=${r.is_looping}`)
  }

  // Per-sequence detail
  console.log(`\n  ── Per-sequence detail ──`)
  for (const r of evalResults) {
    const flags = []
    if (r.correct.sub_regime !== undefined) flags.push(`regime=${r.correct.sub_regime ? "\u2713" : "\u2717"}`)
    if (r.correct.is_looping !== undefined) flags.push(`loop=${r.correct.is_looping ? "\u2713" : "\u2717"}`)
    console.log(`    ${r.name.padEnd(38)} n=${r.n}  ${flags.join(" ")}  (got: ${r.predicted.sub_regime}/${r.predicted.resolution})`)
  }

  console.log("\n" + "=".repeat(72) + "\n")
}

// ── Main test ──────────────────────────────────────────────────────
test("blackbox evaluation harness", () => {
  const evalResults = evaluateTracker()
  const pipelineResults = evaluatePipeline()
  const metrics = computeMetrics(evalResults)

  printResults(evalResults, pipelineResults, metrics)

  // Assert reasonable baseline: at least 10% exact match (no trained model)
  assert.ok(metrics.exact_match_accuracy >= 0.1, `Exact match accuracy ${(metrics.exact_match_accuracy * 100).toFixed(1)}% is below 10% baseline`)

  // Assert per-regime: at least 1 regime has TP > 0
  const hasCorrectRegime = Object.values(metrics.per_regime).some(m => m.true_pos > 0)
  assert.ok(hasCorrectRegime, "No regime achieved any correct predictions")
})
