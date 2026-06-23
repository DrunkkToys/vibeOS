// Decision input passed to the advice layer. All fields are optional — callers
// supply whatever signal they have; the index tail carries extra dynamic keys.
export interface DecisionInput {
  action?: string
  intent?: string
  confidence?: number
  uncertainty?: number
  reason?: string
  note?: string
  stress?: number
  stress_multiplier?: number
  mode?: string
  tier?: string
  prompt?: string
  text?: string
  question?: string
  fallback?: string
  plan?: string
  suggestion?: string
  [key: string]: unknown
}

export function buildDecisionBlock(input: DecisionInput = {}) {
  const action = input.action || input.intent || "explore"
  return {
    action,
    modality: computeModality(input),
    confidence: typeof input.confidence === "number" ? input.confidence : 0.5,
    reason: input.reason || "neutral",
  }
}

export function buildAdvice(input: DecisionInput = {}) {
  return {
    ...buildDecisionBlock(input),
    suggestion: getActionSuggestion(input),
    fallback: getFallbackPlan(input),
  }
}

export function computeModality(input: DecisionInput = {}) {
  const stress = Number(input.stress ?? input.stress_multiplier ?? 0)
  if (stress > 1.5) return "quality"
  if (String(input.mode || input.tier || "").toLowerCase().includes("budget")) return "budget"
  if (String(input.mode || input.tier || "").toLowerCase().includes("speed")) return "speed"
  return "balanced"
}

export function humanReadableAction(action: unknown) {
  return String(action || "explore").replace(/[_-]+/g, " ")
}

export function compressMetrics(metrics: unknown) {
  return metrics && typeof metrics === "object" ? { ...metrics } : {}
}

export function compressUncertainty(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}

export function compressEntropy(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

export function enforceClosure(input: DecisionInput = {}) {
  return {
    ...input,
    closed: true,
  }
}

export function stabilityScore(input: DecisionInput = {}) {
  const confidence = compressUncertainty(input.confidence ?? 0.5)
  const uncertainty = compressUncertainty(input.uncertainty ?? 0)
  return Math.max(0, Math.min(1, confidence * (1 - uncertainty)))
}

export function shouldUseFastPath(input: DecisionInput = {}) {
  return computeModality(input) === "speed" || Number(input.confidence ?? 0) >= 0.8
}

export function buildCautionNote(input: DecisionInput = {}) {
  return String(input.note || input.reason || "Proceed carefully.")
}

export function scoreUsefulness(input: DecisionInput = {}) {
  const prompt = String(input.prompt || input.text || "")
  return Math.min(1, Math.max(0, prompt.length / 1000))
}

export function getFallbackPlan(input: DecisionInput = {}) {
  return input.fallback || input.plan || "keep exploring"
}

export function getActionSuggestion(input: DecisionInput = {}) {
  return input.suggestion || humanReadableAction(input.action || input.intent || "explore")
}

export function getCuriosityPrompt(input: DecisionInput = {}) {
  return String(input.prompt || input.question || "What should we look at next?")
}
