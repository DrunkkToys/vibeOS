// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// @ts-nocheck

import { cascadeDecide } from "../ml-router.js"
import { PivotCache } from "./pivot-cache.js"

const CHEAP = 0.0001
const MEDIUM = 0.001
const BRAIN = 0.01

function normalizeText(input = {}) {
  return String(input.user_text || input.prompt || input.text || "").trim()
}

function profileFromCascade(decision) {
  if (decision.useCheap && decision.escalate) return { profile: "deep", cascade_depth: 3, pipeline_root: ["local", "medium", "brain"], tier_bias: "brain" }
  if (decision.escalate) return { profile: "standard", cascade_depth: 2, pipeline_root: ["medium", "brain"], tier_bias: "brain" }
  return { profile: "direct", cascade_depth: 1, pipeline_root: ["brain"], tier_bias: "brain" }
}

function getPivotCache() {
  if (!globalThis.__vibeultraxPivotCache) globalThis.__vibeultraxPivotCache = new PivotCache()
  return globalThis.__vibeultraxPivotCache
}

export function vibeultraxControlVector(input = {}) {
  const text = normalizeText(input)
  const cascade = cascadeDecide(text, CHEAP, MEDIUM, BRAIN, 0.85)
  const profile = profileFromCascade(cascade)

  return {
    optimization_mode: "vibeultrax",
    mode_root: "vibeultrax",
    mode_family: "cascade",
    cascade_depth: profile.cascade_depth,
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
    directives: [`[ultrax root] cascade profile=${profile.profile}; reason=${cascade.reason}`],
  }
}

export function vibeultraxPipeline(input = {}) {
  const text = normalizeText(input)
  const pc = getPivotCache()
  const cascade = cascadeDecide(text, CHEAP, MEDIUM, BRAIN, 0.85)
  const profile = profileFromCascade(cascade)
  const tokens = text ? pc.tokenize(text) : new Set()
  const pivotBack = text && tokens.size > 0 ? pc.detectPivotBack(tokens, 0.5) : { matchedId: null, confidence: 0, reason: "no_text" }
  const isPivotBack = pivotBack.matchedId !== null

  return {
    ...vibeultraxControlVector(input),
    mode: "vibeultrax",
    source: "vibeultrax",
    profile: profile.profile,
    pivot: isPivotBack ? {
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
    cascade_depth: profile.cascade_depth,
    ultrax_reason: cascade.reason,
    ultrax_confidence: cascade.confidence,
    ultrax_estimated_savings: cascade.estimatedSavings,
  }
}
