// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// @ts-nocheck
// Meta-Controller — maps blackbox resolution state to a unified control vector.
// v2 orchestration: single source of truth for all subsystem directives.
// v3: OptimizationMode system — 4 session-level profiles + auto mode.
const REGIME_CONTROL = {
  INIT: {
    enforcement_mode: "normal",
    enforcement_reason: "fresh session — baseline enforcement",
    flow_mode: "normal",
    flow_focus: [],
    tdd_mode: "normal",
    tdd_focus: [],
    tier_bias: "auto",
    thinking_mode: "auto",
    stress_multiplier: 1.0,
    context7_urgency: "preferred",
    wbp_verbosity: "normal",
  },
  DIVERGENT: {
    enforcement_mode: "relaxed",
    enforcement_reason: "signals scattered — avoid interrupting exploration",
    flow_mode: "audit",
    flow_focus: ["no-write-without-clarification"],
    tdd_mode: "lazy",
    tdd_focus: [],
    tier_bias: "medium",
    thinking_mode: "off",
    stress_multiplier: 0.5,
    context7_urgency: "optional",
    wbp_verbosity: "detailed",
  },
  EXPLORING: {
    enforcement_mode: "relaxed",
    enforcement_reason: "user researching — minimal enforcement, save brain for real work",
    flow_mode: "audit",
    flow_focus: [],
    tdd_mode: "lazy",
    tdd_focus: [],
    tier_bias: "cheap",
    thinking_mode: "off",
    stress_multiplier: 0.7,
    context7_urgency: "optional",
    wbp_verbosity: "detailed",
  },
  REFINING: {
    enforcement_mode: "normal",
    enforcement_reason: "user narrowing down — balanced mode",
    flow_mode: "normal",
    flow_focus: [],
    tdd_mode: "normal",
    tdd_focus: [],
    tier_bias: "auto",
    thinking_mode: "auto",
    stress_multiplier: 1.0,
    context7_urgency: "preferred",
    wbp_verbosity: "normal",
  },
  CONVERGING: {
    enforcement_mode: "strict",
    enforcement_reason: "user about to commit — full enforcement, catch violations",
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-untouched-files"],
    tdd_mode: "strict",
    tdd_focus: ["skeleton-on-write", "assertion-check"],
    tier_bias: "brain",
    thinking_mode: "brief",
    stress_multiplier: 1.5,
    context7_urgency: "required",
    wbp_verbosity: "minimal",
  },
  LOOPING: {
    enforcement_mode: "relaxed",
    enforcement_reason: "user stuck — relax all enforcement, fresh perspective",
    flow_mode: "audit",
    flow_focus: ["suggest-alternative"],
    tdd_mode: "lazy",
    tdd_focus: [],
    tier_bias: "medium",
    thinking_mode: "off",
    stress_multiplier: 0.3,
    context7_urgency: "optional",
    wbp_verbosity: "detailed",
  },
  CLOSED: {
    enforcement_mode: "strict",
    enforcement_reason: "finalizing — full enforcement, max stress sensitivity",
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-untouched-files", "no-lgtm"],
    tdd_mode: "quality",
    tdd_focus: ["full-coverage", "edge-cases"],
    tier_bias: "brain",
    thinking_mode: "brief",
    stress_multiplier: 2.0,
    context7_urgency: "required",
    wbp_verbosity: "minimal",
  },
  FORENSIC: {
    enforcement_mode: "strict",
    enforcement_reason: "forensic analysis — full enforcement, deep investigation",
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-untouched-files", "trace-audit"],
    tdd_mode: "quality",
    tdd_focus: ["full-coverage", "edge-cases", "property-based"],
    tier_bias: "brain",
    thinking_mode: "full",
    stress_multiplier: 1.5,
    context7_urgency: "required",
    wbp_verbosity: "detailed",
  },
  AUDIT: {
    enforcement_mode: "strict",
    enforcement_reason: "security audit — full enforcement, OWASP validation",
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-untouched-files", "security-scan"],
    tdd_mode: "quality",
    tdd_focus: ["full-coverage", "edge-cases", "security-test"],
    tier_bias: "brain",
    thinking_mode: "full",
    stress_multiplier: 1.2,
    context7_urgency: "required",
    wbp_verbosity: "detailed",
  },
}
const DEFAULT_CONTROL = REGIME_CONTROL.EXPLORING
const QUALITY_STRESS_THRESHOLD = 1.5
const MODE_DELTAS = {
  balanced: {},
  budget: {
    tier_bias: "cheap",
    thinking_mode: "off",
    tdd_mode: "lazy",
    tdd_focus: [],
    flow_mode: "audit",
    flow_focus: [],
    enforcement_mode: "relaxed",
    wbp_verbosity: "minimal",
    context7_urgency: "optional",
    stress_multiplier: 0.3,
    loop_threshold: 0.7,
    api_enrichment: false,
    outcome_detection: true,
  },
  quality: {
    tier_bias: "brain",
    thinking_mode: "full",
    tdd_mode: "quality",
    tdd_focus: ["full-coverage", "edge-cases", "property-based"],
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-untouched-files", "no-lgtm", "suggest-alternative"],
    enforcement_mode: "strict",
    wbp_verbosity: "detailed",
    context7_urgency: "required",
    stress_multiplier: 2.0,
    loop_threshold: 0.4,
    api_enrichment: true,
    outcome_detection: true,
  },
  speed: {
    tier_bias: "medium",
    thinking_mode: "off",
    tdd_mode: "lazy",
    tdd_focus: [],
    flow_mode: "audit",
    flow_focus: [],
    enforcement_mode: "relaxed",
    wbp_verbosity: "minimal",
    context7_urgency: "optional",
    stress_multiplier: 0.0,
    loop_threshold: 0.9,
    api_enrichment: false,
    outcome_detection: false,
  },
  longrun: {
    tier_bias: "brain",
    thinking_mode: "brief",
    tdd_mode: "quality",
    tdd_focus: ["full-coverage", "edge-cases", "skeleton-on-write", "assertion-check"],
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-untouched-files", "no-lgtm", "suggest-alternative"],
    enforcement_mode: "strict",
    wbp_verbosity: "detailed",
    context7_urgency: "required",
    stress_multiplier: 1.0,
    loop_threshold: 0.5,
    api_enrichment: true,
    outcome_detection: true,
  },
  vibemax: {
    tier_bias: "medium",
    thinking_mode: "full",
    tdd_mode: "quality",
    tdd_focus: ["skeleton-on-write", "assertion-check", "edge-cases"],
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-lgtm", "check-debug-artifacts"],
    enforcement_mode: "strict",
    wbp_verbosity: "normal",
    context7_urgency: "required",
    stress_multiplier: 1.0,
    loop_threshold: 0.6,
    api_enrichment: true,
    outcome_detection: true,
  },
  vibeultrax: {
    tier_bias: "brain",
    thinking_mode: "full",
    tdd_mode: "quality",
    tdd_focus: ["full-coverage", "edge-cases", "property-based"],
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-untouched-files", "no-lgtm", "suggest-alternative"],
    enforcement_mode: "strict",
    wbp_verbosity: "detailed",
    context7_urgency: "required",
    stress_multiplier: 2.5,
    loop_threshold: 0.3,
    api_enrichment: true,
    outcome_detection: true,
  },
  vibeqmax: {
    tier_bias: "brain",
    thinking_mode: "full",
    tdd_mode: "quality",
    tdd_focus: ["skeleton-on-write", "assertion-check", "edge-cases"],
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-lgtm", "check-debug-artifacts"],
    enforcement_mode: "strict",
    wbp_verbosity: "normal",
    context7_urgency: "required",
    stress_multiplier: 1.5,
    loop_threshold: 0.5,
    api_enrichment: true,
    outcome_detection: true,
  },
  forensic: {
    tier_bias: "brain",
    thinking_mode: "full",
    tdd_mode: "quality",
    tdd_focus: ["full-coverage", "edge-cases", "property-based"],
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-untouched-files", "trace-audit"],
    enforcement_mode: "strict",
    wbp_verbosity: "detailed",
    context7_urgency: "required",
    stress_multiplier: 1.5,
    loop_threshold: 0.4,
    api_enrichment: true,
    outcome_detection: true,
  },
  audit: {
    tier_bias: "brain",
    thinking_mode: "full",
    tdd_mode: "quality",
    tdd_focus: ["full-coverage", "edge-cases", "security-test"],
    flow_mode: "strict",
    flow_focus: ["write-edit-check", "no-untouched-files", "security-scan"],
    enforcement_mode: "strict",
    wbp_verbosity: "detailed",
    context7_urgency: "required",
    stress_multiplier: 1.2,
    loop_threshold: 0.5,
    api_enrichment: true,
    outcome_detection: true,
  },
}
export function autoSelectMode(subRegime, stressMultiplier) {
  const regime = String(subRegime || "INIT").toUpperCase()
  if (regime === "AUDIT" || regime === "FORENSIC") return regime.toLowerCase()
  if (regime === "LOOPING") return "speed"
  if (regime === "CONVERGING" || regime === "CLOSED") return "quality"
  if (stressMultiplier && stressMultiplier > QUALITY_STRESS_THRESHOLD) return "quality"
  return "budget"
}
export function computeControlVector(state, action, optimizationMode) {
  const regime = state.sub_regime || "INIT"
  const base = REGIME_CONTROL[regime] || DEFAULT_CONTROL
  // Determine effective mode
  let effectiveMode = optimizationMode || "vibemax"
  if (effectiveMode === "auto") {
    effectiveMode = autoSelectMode(regime, state.latest_stress_multiplier)
  }
  // Apply mode deltas on top of base (only for non-balanced modes)
  const delta = effectiveMode !== "balanced" ? (MODE_DELTAS[effectiveMode] || {}) : {}
  const overridden = {
    optimization_mode: effectiveMode,
    enforcement_mode: delta.enforcement_mode ?? base.enforcement_mode,
    enforcement_reason: delta.enforcement_mode
      ? `[optimize: ${effectiveMode}] ${describeMode(delta)}`
      : base.enforcement_reason,
    flow_mode: delta.flow_mode ?? base.flow_mode,
    flow_focus: delta.flow_focus ?? base.flow_focus,
    tdd_mode: delta.tdd_mode ?? base.tdd_mode,
    tdd_focus: delta.tdd_focus ?? base.tdd_focus,
    tier_bias: delta.tier_bias ?? base.tier_bias,
    thinking_mode: delta.thinking_mode ?? base.thinking_mode,
    stress_multiplier: delta.stress_multiplier ?? base.stress_multiplier,
    context7_urgency: delta.context7_urgency ?? base.context7_urgency,
    wbp_verbosity: delta.wbp_verbosity ?? base.wbp_verbosity,
  }
  const directives = buildDirectives(overridden, regime, state, action, effectiveMode)
  return {
    ...overridden,
    directives,
  }
}
function describeMode(delta) {
  if (delta.tier_bias === "cheap")
    return "budget mode — max cost savings"
  if (delta.tier_bias === "brain" && delta.thinking_mode === "full")
    return "quality mode — max output quality"
  if (delta.tdd_mode === "quality" && delta.flow_mode === "strict")
    return "longrun mode — codebase health"
  if (delta.tier_bias === "medium" && delta.stress_multiplier === 0)
    return "speed mode — max response speed"
  if (delta.tier_bias === "medium" && delta.loop_threshold === 0.6)
    return "vibemax mode — ml-optimized budget: 97% quality at 37% cost"
  return `${delta.tier_bias || "auto"} / ${delta.thinking_mode || "auto"}`
}
function buildDirectives(cv, regime, state, action, optimizationMode) {
  const d = []
  if (cv.enforcement_mode !== "normal") {
    d.push(`[delegation enforcement: ${cv.enforcement_mode}] ${cv.enforcement_reason}. ` +
            (cv.enforcement_mode === "relaxed"
              ? "Write/Edit restrictions are temporarily eased. Proceed with caution."
              : "ALL write/edit operations must pass strict validation. No exceptions."))
  }
  if (cv.flow_mode !== "normal") {
    const focusNote = cv.flow_focus.length > 0 ? ` Focus rules: ${cv.flow_focus.join(", ")}.` : ""
    d.push(`[flow: ${cv.flow_mode}] Flow enforcer is in ${cv.flow_mode} mode.${focusNote}`)
  }
  if (cv.tdd_mode !== "normal") {
    const focusNote = cv.tdd_focus.length > 0 ? ` Focus: ${cv.tdd_focus.join(", ")}.` : ""
    d.push(`[tdd: ${cv.tdd_mode}] TDD enforcement is ${cv.tdd_mode}.${focusNote}`)
  }
  if (cv.tier_bias !== "auto") {
    d.push(`[tier routing] Route to ${cv.tier_bias} tier for this turn.`)
  }
  if (cv.thinking_mode !== "auto") {
    d.push(`[thinking mode: ${cv.thinking_mode}] Reasoning depth set to ${cv.thinking_mode}. ` +
            (cv.thinking_mode === "off"
              ? "Skip extended thinking entirely. Respond directly and concisely. Every thinking token costs money — save it for when the user explicitly asks."
              : "Use extended thinking only for genuinely complex multi-step problems. Keep reasoning concise."))
  }
  if (cv.context7_urgency !== "preferred") {
    d.push(`[context7] Documentation lookup is ${cv.context7_urgency}. ` +
            (cv.context7_urgency === "required"
              ? "You MUST use mcp__context7__* tools before any web search for library/framework docs."
              : "context7 tools are available but not required."))
  }
  if (cv.wbp_verbosity !== "normal") {
    d.push(`[wbp protocol] Delegation output synthesis is ${cv.wbp_verbosity}. ` +
            (cv.wbp_verbosity === "minimal"
              ? "Summarize subagent results in 1-2 sentences."
              : "Provide full detail from subagent output including code changes and rationale."))
  }
  if (state.is_looping && state.loop_intervention_level && state.loop_intervention_level !== "none") {
    const severity = state.loop_intervention_level === "escalated" ? "CRITICAL"
      : state.loop_intervention_level === "assertive" ? "WARNING" : "NOTICE"
    const repeatNote = state.repeat_streak >= 2 ? ` Repeated prompt streak: ${state.repeat_streak}.` : ""
    d.push(`[loop prevention: ${severity}] The conversation may be looping — stop repeating the same answer path and try a different approach.${repeatNote} (level: ${state.loop_intervention_level})`)
  }
  if (optimizationMode && optimizationMode !== "balanced") {
    d.push(`[optimization: ${optimizationMode}] Session optimization mode is "${optimizationMode}". This overrides default per-regime behavior.`)
  }
  return d
}
export function buildControlHistoryEntry(turn, regime, control, reward = null) {
  return {
    turn,
    regime,
    control: {
      enforcement_mode: control.enforcement_mode,
      flow_mode: control.flow_mode,
      tdd_mode: control.tdd_mode,
      tier_bias: control.tier_bias,
      thinking_mode: control.thinking_mode,
      stress_multiplier: control.stress_multiplier,
      context7_urgency: control.context7_urgency,
      wbp_verbosity: control.wbp_verbosity,
    },
    reward,
  }
}
export const REGIME_CONTROL_TABLE = REGIME_CONTROL
export { MODE_DELTAS }
