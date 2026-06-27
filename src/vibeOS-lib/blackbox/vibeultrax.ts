// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// @ts-nocheck

import { cascadeDecide, predictBestModel } from "../ml-router.js"
import { _mlGraph } from "../../lib/state.js"
import { PivotCache } from "./pivot-cache.js"

const CHEAP = 0.0001
const MEDIUM = 0.001
const BRAIN = 0.01
const VIBEULTRAX_ROOT = ["cheap", "medium", "brain"]

function normalizeText(input = {}) {
  return String(input.user_text || input.prompt || input.text || "").trim()
}

function clampConfidence(value) {
  return Math.max(0.1, Math.min(0.99, Number.isFinite(Number(value)) ? Number(value) : 0.5))
}

function detectOrchestrationSignals(text, input = {}) {
  const lower = String(text || "").toLowerCase()
  const wordCount = lower ? lower.split(/\s+/).filter(Boolean).length : 0
  const contextBudgetPct = Number(input.context_budget_pct ?? input.contextBudgetPct ?? input.context_budget_pct_estimate ?? 0)
  const stressScore = Number(input.stress_score ?? input.stressScore ?? 0)
  const codeHeavy = /\b(fix|build|implement|write|create|add|edit|modify|update|refactor|debug|patch|test|tdd|endpoint|route|component|function|class|module|file|branch|merge|commit|deploy|release)\b/i.test(lower) || /(\.ts|\.tsx|\.js|\.jsx|\.py|\.go|\.rs|\.java|package\.json|tsconfig\.json|swagger|openapi)/i.test(lower)
  const researchHeavy = /\b(latest|recent|today|current|now|news|release notes?|docs?|documentation|source|sources|cite|citations?|web[- ]search|search the web|what changed|status|health|reachable|available|web)\b/i.test(lower)
  const contextLong = contextBudgetPct >= 70 || text.length >= 1800 || wordCount >= 260 || /```/.test(text) || /\b(long|noisy|verbose|wall of text|big transcript|full transcript|large prompt)\b/i.test(lower)
  const loopRisk = Boolean(input.blackbox?.is_looping || input.blackbox?.looping || input.blackbox?.loop_count >= 2 || input.blackbox?.repeat_streak >= 2 || /(\bagain\b|\bstill\b|\bsame issue\b|\bkeeps failing\b|\bloops?\b|\bstuck\b|\bbroken\b|\bfailed again\b|\bno progress\b|\bnot working\b|\bworse\b)/i.test(lower) || stressScore >= 0.65)
  const mixed = codeHeavy && researchHeavy
  return { contextLong, codeHeavy, researchHeavy, loopRisk, mixed, wordCount, contextBudgetPct, stressScore }
}

export function buildOrchestrationPlan(input = {}) {
  const text = normalizeText(input)
  const signals = detectOrchestrationSignals(text, input)
  const steps = []
  let planKind = "direct"
  let recommendedNextAction = "Proceed directly without helper detours."
  let reason = "Prompt is simple enough to route directly."
  let confidence = 0.45
  let primaryAction = "direct"
  let autoExecute = false

  const addStep = (action, stepReason, stepAuto = false) => {
    steps.push({ action, auto_execute: stepAuto, reason: stepReason })
  }

  if (signals.contextLong) {
    planKind = "compress-first"
    primaryAction = "compress"
    autoExecute = true
    confidence = clampConfidence(0.82 + (signals.contextBudgetPct >= 85 ? 0.06 : 0) + (signals.wordCount >= 380 ? 0.04 : 0))
    reason = signals.contextBudgetPct >= 70
      ? `Context budget is around ${Math.round(signals.contextBudgetPct)}%, so compression should happen before any deeper routing.`
      : "Prompt is long or noisy enough that context compression will reduce wasted work."
    recommendedNextAction = "Compress context first, then re-run planning on the reduced payload."
    addStep("compress", "Shrink the current context before choosing the next helper.", true)
    addStep("vibeultrax", "Replan after compression so the next helper order is chosen from the shorter payload.", false)
    if (signals.mixed) {
      addStep("web-search", "Research needs still matter after compression.", true)
      addStep("tdd", "Code-shape work still needs test scaffolding.", false)
    } else if (signals.researchHeavy) {
      addStep("web-search", "Recent facts and citations are still required after compression.", true)
    } else if (signals.codeHeavy) {
      addStep("tdd", "Implementation work should still be driven by tests after compression.", false)
    }
  } else if (signals.loopRisk) {
    planKind = "ultrax-escalate"
    primaryAction = "vibeultrax"
    confidence = clampConfidence(0.88 + (signals.stressScore >= 0.8 ? 0.04 : 0) + (signals.mixed ? 0.03 : 0))
    reason = signals.stressScore >= 0.65
      ? "Looping, ambiguity, or elevated stress means the controller should choose the next mode instead of guessing."
      : "Repeated signals mean VibeUltraX should break the tie before the next helper runs."
    recommendedNextAction = "Escalate with VibeUltraX before choosing search, TDD, or a cheaper route."
    addStep("vibeultrax", "Use the cascade controller to decide whether to stay cheap, research, or switch to implementation work.", false)
    if (signals.researchHeavy) {
      addStep("web-search", "Research is still the safest next helper if the prompt needs current facts.", true)
    }
    if (signals.codeHeavy) {
      addStep("tdd", "Code-writing prompts should still be backed by tests after the controller decision.", false)
    }
  } else if (signals.researchHeavy && !signals.codeHeavy) {
    planKind = "search-first"
    primaryAction = "web-search"
    autoExecute = true
    confidence = clampConfidence(0.84 + (signals.contextBudgetPct >= 60 ? -0.05 : 0) + (signals.wordCount <= 40 ? 0.02 : 0))
    reason = /latest|current|today|recent|news|release notes|status|health|reachable|available|cite|source|docs|web/i.test(text)
      ? "The prompt depends on fresh facts or citations, so search should go first."
      : "The prompt asks for research, so web-search should ground the answer before synthesis."
    recommendedNextAction = "Use web-search first, then feed citations back into the main decision path."
    addStep("web-search", "Ground the answer in current sources before taking the next turn.", true)
    addStep("vibeultrax", "Replan after citations if the search reveals code or implementation work.", false)
  } else if (signals.codeHeavy && !signals.researchHeavy) {
    planKind = "tdd-first"
    primaryAction = "tdd"
    confidence = clampConfidence(0.83 + (signals.loopRisk ? 0.05 : 0) + (signals.wordCount >= 120 ? 0.02 : 0))
    reason = "The prompt is code-shaped, so TDD helpers should anchor the implementation path."
    recommendedNextAction = "Run TDD helpers first, then write the implementation against the generated tests."
    addStep("tdd", "Create or refresh test scaffolding before editing source files.", false)
    addStep("vibeultrax", "Replan after TDD so the controller can adjust the slot or helper order if needed.", false)
  } else if (signals.mixed) {
    planKind = "ultrax-escalate"
    primaryAction = "vibeultrax"
    confidence = clampConfidence(0.86)
    reason = "The prompt mixes code work and current-fact work, so the cascade controller should pick the order."
    recommendedNextAction = "Escalate with VibeUltraX to choose whether search or TDD should lead."
    addStep("vibeultrax", "Let the cascade controller resolve the mixed intent before the helpers run.", false)
    if (signals.researchHeavy) {
      addStep("web-search", "Fresh facts and citations are part of the request.", true)
      addStep("tdd", "Code changes should still end in test scaffolding.", false)
    } else {
      addStep("tdd", "The request is code-shaped, so test scaffolding should still be first after orchestration.", false)
      addStep("web-search", "Research is secondary but still relevant if the work needs external facts.", true)
    }
  } else {
    planKind = "direct"
    primaryAction = "direct"
    confidence = clampConfidence(0.55)
    reason = "The prompt does not strongly require compression, research, TDD, or escalation."
    recommendedNextAction = "Proceed directly."
    addStep("direct", "No helper detour is needed for this prompt.", false)
  }

  return {
    plan_kind: planKind,
    primary_action: primaryAction,
    recommended_next_action: recommendedNextAction,
    reason,
    confidence,
    auto_execute: autoExecute,
    signals: {
      context_long: signals.contextLong,
      code_heavy: signals.codeHeavy,
      research_heavy: signals.researchHeavy,
      loop_risk: signals.loopRisk,
      mixed_code_research: signals.mixed,
      context_budget_pct: signals.contextBudgetPct,
      stress_score: signals.stressScore,
    },
    steps,
  }
}

function tierFromModelName(modelName) {
  const lower = String(modelName || "").toLowerCase()
  if (!lower) return null
  if (/_?chat\b/.test(lower) || /(^|\/)deepseek\/deepseek-chat$/.test(lower)) return "cheap"
  if (/_?flash\b/.test(lower) || /(^|\/)deepseek\/deepseek-v4-flash$/.test(lower)) return "medium"
  return "brain"
}

function supportForPrediction(graph, firstWord, modelName) {
  const node = graph?.nodes?.[firstWord]
  const modelNode = graph?.nodes?.[modelName]
  if (!node || !modelNode) return 0
  const totalRoutes = Object.values(node.edges || {}).reduce((sum, count) => sum + Number(count || 0), 0)
  if (!totalRoutes) return 0
  const routeSupport = Number(node.edges?.[modelName] || 0) / totalRoutes
  const okEdges = Object.entries(modelNode.edges || {})
    .filter(([key]) => String(key).endsWith("::ok"))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0)
  const totalEdges = Object.values(modelNode.edges || {}).reduce((sum, count) => sum + Number(count || 0), 0) || 0
  const successRate = totalEdges > 0 ? okEdges / totalEdges : 0
  return (routeSupport * 0.45) + (successRate * 0.55)
}

function learnedRouteFromGraph(text) {
  const firstWord = String(text || "").trim().split(/\s+/)[0]?.toLowerCase() || ""
  if (!firstWord || !_mlGraph?.nodes) return null
  const predictedModel = predictBestModel(_mlGraph, firstWord, "brain")
  if (!predictedModel) return null
  const learnedTier = tierFromModelName(predictedModel)
  if (!learnedTier) return null
  const support = supportForPrediction(_mlGraph, firstWord, predictedModel)
  if (support < 0.5) return null
  return { firstWord, predictedModel, learnedTier, support }
}

function profileFromCascade(decision, learned = null) {
  if (learned?.learnedTier === "cheap") return { profile: "direct", cascade_depth: 1, pipeline_root: VIBEULTRAX_ROOT, route_path: ["cheap"], tier_bias: "cheap", selected_slot: "cheap" }
  if (learned?.learnedTier === "medium") return { profile: "standard", cascade_depth: 2, pipeline_root: VIBEULTRAX_ROOT, route_path: ["cheap", "medium"], tier_bias: "cheap", selected_slot: "medium" }
  if (learned?.learnedTier === "brain") return { profile: "deep", cascade_depth: 3, pipeline_root: VIBEULTRAX_ROOT, route_path: VIBEULTRAX_ROOT, tier_bias: "cheap", selected_slot: "brain" }
  // A genuinely "complex" prompt must reach brain even when escalate fired without
  // useCheap (the high-confidence complex branch in cascadeDecide never sets useCheap).
  if (decision.escalate && decision.level === "complex") return { profile: "deep", cascade_depth: 3, pipeline_root: VIBEULTRAX_ROOT, route_path: VIBEULTRAX_ROOT, tier_bias: "cheap", selected_slot: "brain" }
  if (decision.useCheap && decision.escalate) return { profile: "deep", cascade_depth: 3, pipeline_root: VIBEULTRAX_ROOT, route_path: VIBEULTRAX_ROOT, tier_bias: "cheap", selected_slot: "brain" }
  if (decision.escalate) return { profile: "standard", cascade_depth: 2, pipeline_root: VIBEULTRAX_ROOT, route_path: ["cheap", "medium"], tier_bias: "cheap", selected_slot: "medium" }
  return { profile: "direct", cascade_depth: 1, pipeline_root: VIBEULTRAX_ROOT, route_path: ["cheap"], tier_bias: "cheap", selected_slot: "cheap" }
}

function getPivotCache() {
  if (!globalThis.__vibeultraxPivotCache) globalThis.__vibeultraxPivotCache = new PivotCache()
  return globalThis.__vibeultraxPivotCache
}

export function vibeultraxControlVector(input = {}) {
  const text = normalizeText(input)
  const cascade = cascadeDecide(text, CHEAP, MEDIUM, BRAIN, 0.85)
  const learned = learnedRouteFromGraph(text)
  const profile = profileFromCascade(cascade, learned)
  const orchestrationPlan = buildOrchestrationPlan(input)

  return {
    optimization_mode: "vibeultrax",
    mode_root: "vibeultrax",
    mode_family: "cascade",
    cascade_depth: profile.cascade_depth,
    cascade_root: VIBEULTRAX_ROOT,
    route_path: profile.route_path,
    selected_slot: profile.selected_slot,
    route_source: learned ? "learned" : "local",
    pipeline_root: profile.pipeline_root,
    tier_bias: profile.tier_bias,
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    thinking_mode: profile.profile === "direct" ? "brief" : "full",
    stress_multiplier: 1.0,
    context7_urgency: "required",
    wbp_verbosity: profile.profile === "deep" ? "detailed" : "normal",
    ultrax_profile: profile.profile,
    ultrax_confidence: cascade.confidence,
    ultrax_reason: cascade.reason,
    ultrax_estimated_savings: cascade.estimatedSavings,
    ultrax_learned_model: learned?.predictedModel || null,
    ultrax_learned_tier: learned?.learnedTier || null,
    ultrax_learned_support: learned?.support || 0,
    orchestration_plan: orchestrationPlan,
    orchestration_kind: orchestrationPlan.plan_kind,
    orchestration_primary_action: orchestrationPlan.primary_action,
    orchestration_recommended_next_action: orchestrationPlan.recommended_next_action,
    orchestration_reason: orchestrationPlan.reason,
    orchestration_confidence: orchestrationPlan.confidence,
    orchestration_auto_execute: orchestrationPlan.auto_execute,
    orchestration_signals: orchestrationPlan.signals,
    orchestration_steps: orchestrationPlan.steps,
    directives: [`[ultrax root] cascade profile=${profile.profile}; reason=${cascade.reason}${learned ? `; learned=${learned.predictedModel}` : ""}`],
  }
}

export function vibeultraxPipeline(input = {}) {
  const text = normalizeText(input)
  const pc = getPivotCache()
  const cascade = cascadeDecide(text, CHEAP, MEDIUM, BRAIN, 0.85)
  const learned = learnedRouteFromGraph(text)
  const profile = profileFromCascade(cascade, learned)
  const orchestrationPlan = buildOrchestrationPlan(input)
  const tokens = text ? pc.tokenize(text) : new Set()
  const pivotBack = text && tokens.size > 0 ? pc.detectPivotBack(tokens, 0.5) : { matchedId: null, confidence: 0, reason: "no_text" }
  const isPivotBack = pivotBack.matchedId !== null

  return {
    ...vibeultraxControlVector(input),
    mode: "vibeultrax",
    source: "vibeultrax",
    profile: profile.profile,
    source_strategy: learned ? "learned" : "cascade",
    learned_model: learned?.predictedModel || null,
    learned_tier: learned?.learnedTier || null,
    learned_support: learned?.support || 0,
    pivot: isPivotBack ? {
      workflowId: pivotBack.matchedId,
      matchedId: pivotBack.matchedId,
      confidence: pivotBack.confidence,
      reason: pivotBack.reason,
      injection: pc.buildInjection(pivotBack.matchedId),
      toolOutputs: (pc.read(pivotBack.matchedId)?.toolOutputs || []),
    } : null,
    pivot_detected: isPivotBack,
    pivot_confidence: pivotBack.confidence || 0,
    pivot_reason: pivotBack.reason || null,
    pipeline: profile.pipeline_root,
    cascade_root: VIBEULTRAX_ROOT,
    route_path: profile.route_path,
    selected_slot: profile.selected_slot,
    route_source: learned ? "learned" : "local",
    cascade_depth: profile.cascade_depth,
    ultrax_reason: cascade.reason,
    ultrax_confidence: cascade.confidence,
    ultrax_estimated_savings: cascade.estimatedSavings,
    orchestration_plan: orchestrationPlan,
    orchestration_kind: orchestrationPlan.plan_kind,
    orchestration_primary_action: orchestrationPlan.primary_action,
    orchestration_recommended_next_action: orchestrationPlan.recommended_next_action,
    orchestration_reason: orchestrationPlan.reason,
    orchestration_confidence: orchestrationPlan.confidence,
    orchestration_auto_execute: orchestrationPlan.auto_execute,
    orchestration_signals: orchestrationPlan.signals,
    orchestration_steps: orchestrationPlan.steps,
  }
}
