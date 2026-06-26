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
    directives: [`[ultrax root] cascade profile=${profile.profile}; reason=${cascade.reason}${learned ? `; learned=${learned.predictedModel}` : ""}`],
  }
}

export function vibeultraxPipeline(input = {}) {
  const text = normalizeText(input)
  const pc = getPivotCache()
  const cascade = cascadeDecide(text, CHEAP, MEDIUM, BRAIN, 0.85)
  const learned = learnedRouteFromGraph(text)
  const profile = profileFromCascade(cascade, learned)
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
  }
}
