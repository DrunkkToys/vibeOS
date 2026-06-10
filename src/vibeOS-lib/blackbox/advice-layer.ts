export function buildDecisionBlock(input: any = {}) {
  const action = input.action || input.intent || "explore"
  return {
    action,
    modality: computeModality(input),
    confidence: typeof input.confidence === "number" ? input.confidence : 0.5,
    reason: input.reason || "neutral",
  }
}

export function buildAdvice(input: any = {}) {
  return {
    ...buildDecisionBlock(input),
    suggestion: getActionSuggestion(input),
    fallback: getFallbackPlan(input),
  }
}

export function computeModality(input: any = {}) {
  const stress = Number(input.stress ?? input.stress_multiplier ?? 0)
  if (stress > 1.5) return "quality"
  if (String(input.mode || input.tier || "").toLowerCase().includes("budget")) return "budget"
  if (String(input.mode || input.tier || "").toLowerCase().includes("speed")) return "speed"
  return "balanced"
}

export function humanReadableAction(action: any) {
  return String(action || "explore").replace(/[_-]+/g, " ")
}

export function compressMetrics(metrics: any) {
  return metrics && typeof metrics === "object" ? { ...metrics } : {}
}

export function compressUncertainty(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}

export function compressEntropy(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

export function enforceClosure(input: any = {}) {
  return {
    ...input,
    closed: true,
  }
}

export function stabilityScore(input: any = {}) {
  const confidence = compressUncertainty(input.confidence ?? 0.5)
  const uncertainty = compressUncertainty(input.uncertainty ?? 0)
  return Math.max(0, Math.min(1, confidence * (1 - uncertainty)))
}

export function shouldUseFastPath(input: any = {}) {
  return computeModality(input) === "speed" || Number(input.confidence ?? 0) >= 0.8
}

export function buildCautionNote(input: any = {}) {
  return String(input.note || input.reason || "Proceed carefully.")
}

export function scoreUsefulness(input: any = {}) {
  const prompt = String(input.prompt || input.text || "")
  return Math.min(1, Math.max(0, prompt.length / 1000))
}

export function getFallbackPlan(input: any = {}) {
  return input.fallback || input.plan || "keep exploring"
}

export function getActionSuggestion(input: any = {}) {
  return input.suggestion || humanReadableAction(input.action || input.intent || "explore")
}

export function getCuriosityPrompt(input: any = {}) {
  return String(input.prompt || input.question || "What should we look at next?")
}
