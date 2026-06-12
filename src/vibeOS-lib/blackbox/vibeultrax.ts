// @ts-nocheck
import { PivotCache } from "./pivot-cache.js"

let pivotCache = null

function getPivotCache() {
  if (!pivotCache) pivotCache = new PivotCache()
  return pivotCache
}

export function vibeultraxControlVector(input = {}) {
  return {
    optimization_mode: "vibeultrax",
    mode_root: "vibeultrax",
    mode_family: "cascade",
    tier_bias: "brain",
    thinking_mode: "full",
    tdd_mode: "quality",
    flow_mode: "strict",
    enforcement_mode: "strict",
    context7_urgency: "required",
    wbp_verbosity: "detailed",
    stress_multiplier: 2.5,
    cascade_depth: 3,
    cascade_stages: ["local", "medium", "brain"],
    pivot_threshold: 0.45,
    prompt_length: String(input.user_text || input.prompt || "").length,
  }
}

export function vibeultraxPipeline(input = {}) {
  const text = String(input.user_text || input.prompt || "")
  const pc = getPivotCache()
  const tokens = pc.tokenize(text)
  const pivotBack = text && tokens.size > 0 ? pc.detectPivotBack(tokens, 0.45) : { matchedId: null, confidence: 0, reason: "no_text" }
  const isPivotBack = pivotBack.matchedId !== null
  const localStage = {
    tier: "local",
    tokens: [...tokens],
    intent: text.slice(0, 80),
  }
  const mediumStage = {
    tier: "medium",
    matched: isPivotBack,
    confidence: pivotBack.confidence,
    reason: pivotBack.reason,
  }
  const brainStage = {
    tier: "brain",
    action: isPivotBack ? "restore-pivot" : "refine",
    injection: isPivotBack ? pc.buildInjection(pivotBack.matchedId) : "",
  }
  return {
    mode: "vibeultrax",
    source: "vibeultrax",
    mode_root: "vibeultrax",
    tier: "brain",
    pipeline: ["local", "medium", "brain"],
    cascade_depth: 3,
    cascade_stages: [localStage, mediumStage, brainStage],
    pivot: isPivotBack ? {
      matchedId: pivotBack.matchedId,
      confidence: pivotBack.confidence,
      reason: pivotBack.reason,
      injection: brainStage.injection,
      toolOutputs: input?._pivotContext?.toolOutputs || [],
    } : null,
  }
}
