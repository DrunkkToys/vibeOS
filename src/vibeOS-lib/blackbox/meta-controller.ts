// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Meta-Controller — maps blackbox resolution state to a unified control vector.
// v2 orchestration: single source of truth for all subsystem directives.

export type ControlVector = {
  enforcement_mode: "relaxed" | "normal" | "strict"
  enforcement_reason: string

  flow_mode: "audit" | "normal" | "strict"
  flow_focus: string[]

  tdd_mode: "lazy" | "normal" | "strict" | "quality"
  tdd_focus: string[]

  tier_bias: "cheap" | "auto" | "medium" | "brain"

  stress_multiplier: number

  context7_urgency: "optional" | "preferred" | "required"

  wbp_verbosity: "minimal" | "normal" | "detailed"

  directives: string[]
}

type RegimeControlMap = Record<string, Omit<ControlVector, "directives" | "enforcement_reason"> & { enforcement_reason: string }>

const REGIME_CONTROL: RegimeControlMap = {
  INIT: {
    enforcement_mode: "normal",
    enforcement_reason: "fresh session — baseline enforcement",
    flow_mode: "normal",
    flow_focus: [],
    tdd_mode: "normal",
    tdd_focus: [],
    tier_bias: "auto",
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
    stress_multiplier: 2.0,
    context7_urgency: "required",
    wbp_verbosity: "minimal",
  },
}

const DEFAULT_CONTROL: Omit<ControlVector, "directives" | "enforcement_reason"> & { enforcement_reason: string } = REGIME_CONTROL.EXPLORING

export function computeControlVector(
  state: { sub_regime?: string; is_looping?: boolean; loop_intervention_level?: string; momentum?: number; n_interactions?: number },
  action?: string,
): ControlVector {
  const regime = state.sub_regime || "INIT"
  const base = REGIME_CONTROL[regime] || DEFAULT_CONTROL

  const directives = buildDirectives(base, regime, state, action)

  return {
    ...base,
    directives,
  }
}

function buildDirectives(
  cv: Omit<ControlVector, "directives">,
  regime: string,
  state: { sub_regime?: string; is_looping?: boolean; loop_intervention_level?: string; momentum?: number; n_interactions?: number },
  action?: string,
): string[] {
  const d: string[] = []

  if (cv.enforcement_mode !== "normal") {
    d.push(
      `[delegation enforcement: ${cv.enforcement_mode}] ${cv.enforcement_reason}. ` +
      (cv.enforcement_mode === "relaxed"
        ? "Write/Edit restrictions are temporarily eased. Proceed with caution."
        : "ALL write/edit operations must pass strict validation. No exceptions.")
    )
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

  if (cv.context7_urgency !== "preferred") {
    d.push(
      `[context7] Documentation lookup is ${cv.context7_urgency}. ` +
      (cv.context7_urgency === "required"
        ? "You MUST use mcp__context7__* tools before any web search for library/framework docs."
        : "context7 tools are available but not required.")
    )
  }

  if (cv.wbp_verbosity !== "normal") {
    d.push(
      `[wbp protocol] Delegation output synthesis is ${cv.wbp_verbosity}. ` +
      (cv.wbp_verbosity === "minimal"
        ? "Summarize subagent results in 1-2 sentences."
        : "Provide full detail from subagent output including code changes and rationale.")
    )
  }

  if (state.is_looping && state.loop_intervention_level && state.loop_intervention_level !== "none") {
    const severity = state.loop_intervention_level === "escalated" ? "CRITICAL"
      : state.loop_intervention_level === "assertive" ? "WARNING" : "NOTICE"
    d.push(`[loop prevention: ${severity}] The conversation may be looping — try a different approach. (level: ${state.loop_intervention_level})`)
  }

  return d
}

export function buildControlHistoryEntry(
  turn: number,
  regime: string,
  control: ControlVector,
  reward: number | null = null,
): Record<string, unknown> {
  return {
    turn,
    regime,
    control: {
      enforcement_mode: control.enforcement_mode,
      flow_mode: control.flow_mode,
      tdd_mode: control.tdd_mode,
      tier_bias: control.tier_bias,
      stress_multiplier: control.stress_multiplier,
      context7_urgency: control.context7_urgency,
      wbp_verbosity: control.wbp_verbosity,
    },
    reward,
  }
}

export const REGIME_CONTROL_TABLE = REGIME_CONTROL
