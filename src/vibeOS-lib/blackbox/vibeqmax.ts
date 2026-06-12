// @ts-nocheck
const QUALITY_STRESS_THRESHOLD = 1.5

function normalizeText(text) {
  return String(text || "").trim()
}

function extractFeatures(text) {
  const value = normalizeText(text).toLowerCase()
  const words = value.split(/\s+/).filter(Boolean)
  const sentences = value.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean)
  return {
    length: value.length / 5000,
    word_count: words.length / 500,
    sentence_count: sentences.length / 50,
    question_ratio: (value.match(/\?/g) || []).length / Math.max(sentences.length, 1),
    code_blocks: (value.match(/```/g) || []).length / 10,
    urgency: /urgent|asap|immediately|critical|broken|failing|crash|error|bug/i.test(value) ? 1 : 0,
    complexity: /complex|difficult|hard|confusing|subtle|nuance|architecture|design/i.test(value) ? 1 : 0,
    instruction_density: /must|should|always|never|critical|need to|please|could you/i.test(value) ? 1 : 0.5,
    repetition: /again|same|repeat|loop|stuck/i.test(value) ? 1 : 0,
  }
}

function scoreQMax(features, stress) {
  const raw =
    0.2 +
    features.length * 0.1 +
    features.word_count * 0.2 +
    features.sentence_count * 0.15 +
    features.question_ratio * 0.2 +
    features.code_blocks * 0.25 +
    features.urgency * 0.15 +
    features.complexity * 0.2 +
    features.instruction_density * 0.1 +
    features.repetition * 0.05 +
    Math.min(0.3, Number(stress || 0) / 10)
  return Math.max(0, Math.min(1, raw))
}

export function vibeqmaxSelectMode(input = {}) {
  const text = normalizeText(input.user_text || input.prompt || "")
  const stress = Number(input.stress_multiplier || input.stress || 0)
  const features = extractFeatures(text)
  const confidence = scoreQMax(features, stress)
  const sourcePrediction = confidence > 0.72 ? "quality" : confidence > 0.42 ? "vibeqmax" : "budget"
  return {
    mode: "vibeqmax",
    source: "vibeqmax",
    mode_root: "vibeqmax",
    source_prediction: sourcePrediction,
    confidence,
    tier: "brain",
    thinking: "full",
    tdd: "quality",
    flow: "strict",
    enforcement: "strict",
    wbp: "detailed",
    c7: "required",
    stress_multiplier: Math.max(QUALITY_STRESS_THRESHOLD, stress || QUALITY_STRESS_THRESHOLD),
    qmax_features: features,
  }
}

export function vibeqmaxControlVector(input = {}) {
  const selected = vibeqmaxSelectMode(input)
  return {
    optimization_mode: "vibeqmax",
    mode_root: "vibeqmax",
    mode_family: "brain-ml",
    tier_bias: "brain",
    thinking_mode: "full",
    tdd_mode: "quality",
    tdd_focus: ["full-coverage", "edge-cases", "property-based"],
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-untouched-files", "check-debug-artifacts"],
    enforcement_mode: "strict",
    context7_urgency: "required",
    wbp_verbosity: "detailed",
    stress_multiplier: selected.stress_multiplier,
    qmax_confidence: selected.confidence,
    qmax_source_prediction: selected.source_prediction,
  }
}

export function predictVibeQMax(input = {}) {
  const selected = vibeqmaxSelectMode(input)
  return {
    label: selected.mode,
    confidence: selected.confidence,
    source: selected.source,
    source_prediction: selected.source_prediction,
    mode_root: selected.mode_root,
  }
}
