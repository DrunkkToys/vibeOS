// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// @ts-nocheck

import { computeDifficulty } from "../ml-router.js"

function normalizeText(input = {}) {
  return String(input.user_text || input.prompt || input.text || "").trim()
}

function qmaxStrategyFromDifficulty(diff, text) {
  const lower = String(text || "").toLowerCase()
  if (/audit|security|compliance|legal|vulnerability|owasp|cve|csrf|xss|auth|permission|privacy/.test(lower)) return "audit"
  if (diff.level === "complex" || diff.features.fileMentions >= 2 || diff.features.errorSignals >= 2) return "longrun"
  if (diff.features.questionDensity > 0.02 || diff.features.length > 120 || /research|analyze|compare|investigate|review|explain|why|how/.test(lower)) return "longrun"
  return "quality"
}

function qmaxControlBlock(strategy) {
  if (strategy === "audit") {
    return {
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "full",
      tier_bias: "brain",
      context7_urgency: "required",
      wbp_verbosity: "detailed",
    }
  }
  if (strategy === "longrun") {
    return {
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "full",
      tier_bias: "brain",
      context7_urgency: "required",
      wbp_verbosity: "detailed",
    }
  }
  return {
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    thinking_mode: "full",
    tier_bias: "brain",
    context7_urgency: "required",
    wbp_verbosity: "normal",
  }
}

export function vibeqmaxSelectMode(input = {}) {
  const text = normalizeText(input)
  const diff = computeDifficulty(text)
  const strategy = qmaxStrategyFromDifficulty(diff, text)
  const block = qmaxControlBlock(strategy)

  return {
    mode: "vibeqmax",
    source: "vibeqmax",
    mode_root: "vibeqmax",
    mode_family: "brain-ml",
    cascade_depth: 1,
    pipeline_root: ["brain"],
    qmax_strategy: strategy,
    qmax_difficulty_score: diff.score,
    qmax_difficulty_level: diff.level,
    qmax_confidence: diff.confidence,
    qmax_suggested_tier: diff.suggestedTier,
    qmax_features: diff.features,
    qmax_reason: strategy === "audit"
      ? "audit-sensitive prompt"
      : strategy === "longrun"
        ? "long-context or multi-step prompt"
        : "brain-tier quality prompt",
    ...block,
  }
}

export function vibeqmaxControlVector(input = {}) {
  const selected = vibeqmaxSelectMode(input)
  return {
    optimization_mode: "vibeqmax",
    mode_root: "vibeqmax",
    mode_family: "brain-ml",
    cascade_depth: 1,
    pipeline_root: ["brain"],
    enforcement_mode: selected.enforcement_mode,
    enforcement_reason: "[optimize: vibeqmax] difficulty-driven brain route",
    flow_mode: selected.flow_mode,
    flow_focus: [],
    tdd_mode: selected.tdd_mode,
    tdd_focus: [],
    tier_bias: selected.tier_bias,
    thinking_mode: selected.thinking_mode,
    stress_multiplier: Number(input.stress_multiplier ?? input.stress ?? 0),
    context7_urgency: selected.context7_urgency,
    wbp_verbosity: selected.wbp_verbosity,
    qmax_strategy: selected.qmax_strategy,
    qmax_difficulty_score: selected.qmax_difficulty_score,
    qmax_difficulty_level: selected.qmax_difficulty_level,
    qmax_confidence: selected.qmax_confidence,
    qmax_suggested_tier: selected.qmax_suggested_tier,
    qmax_features: selected.qmax_features,
    directives: [`[qmax root] difficulty=${selected.qmax_difficulty_level}; strategy=${selected.qmax_strategy}`],
  }
}

export function predictVibeQMax(input = {}) {
  const selected = vibeqmaxSelectMode(input)
  return {
    label: selected.qmax_strategy,
    confidence: selected.qmax_confidence,
    source: "vibeqmax",
    difficulty: selected.qmax_difficulty_score,
    tier: selected.qmax_suggested_tier,
  }
}
