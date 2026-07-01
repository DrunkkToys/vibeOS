// Axis Bundle — single source of truth for per-turn control-vector composition.
// Replaces the duplicated logic previously spread across mode-router.ts (BRANDED_MODES/
// RUNTIME_MODES), mode-policy.ts (AdaptiveMode auto-switching), meta-controller.ts
// (REGIME_CONTROL/MODE_DELTAS, dead code — nothing called it), and turn-classify.ts
// (buildOfflineControlVector, the ad hoc reimplementation that was actually live).
//
// Composition order: raw bypass > regime base > mode defaults > user axis overrides >
// LOOPING safety hardening. Mode selection itself is never auto-switched — only axis
// values flex per regime/stress within whatever mode the user picked.
import type { Mode } from "./mode-router.js"

export type Regime =
  | "INIT" | "DIVERGENT" | "EXPLORING" | "REFINING" | "IMPLEMENTING" | "RESEARCH"
  | "REVIEWING" | "DESIGNING" | "CONVERGING" | "LOOPING" | "CLOSED" | "FORENSIC" | "AUDIT"

export type EnforcementAxis = "off" | "relaxed" | "normal" | "strict"
export type FlowAxis = "off" | "audit" | "normal" | "strict"
export type TddAxis = "off" | "lazy" | "normal" | "quality" | "strict"
export type TierAxis = "cheap" | "medium" | "brain" | "auto"
export type ThinkingAxis = "off" | "brief" | "full" | "auto"
export type Context7Axis = "optional" | "preferred" | "required"
export type WbpVerbosityAxis = "minimal" | "normal" | "detailed"
export type WebsearchAxis = "off" | "allowed" | "encouraged"

export interface AxisBundle {
  enforcement: EnforcementAxis
  flow: FlowAxis
  flow_focus: string[]
  tdd: TddAxis
  tdd_focus: string[]
  tier: TierAxis
  thinking: ThinkingAxis
  stress_multiplier: number
  context7_urgency: Context7Axis
  wbp_verbosity: WbpVerbosityAxis
  websearch: WebsearchAxis
}

export const AXIS_NAMES = [
  "enforcement", "flow", "tdd", "tier", "thinking",
  "context7_urgency", "wbp_verbosity", "websearch",
] as const
export type AxisName = (typeof AXIS_NAMES)[number]

export function isAxisName(v: unknown): v is AxisName {
  return AXIS_NAMES.includes(String(v || "") as AxisName)
}

// Ported 1:1 from meta-controller.ts REGIME_CONTROL (tier_bias renamed to tier).
export const REGIME_AXIS_BASE: Record<Regime, AxisBundle> = {
  INIT: {
    enforcement: "normal", flow: "normal", flow_focus: [], tdd: "normal", tdd_focus: [],
    tier: "auto", thinking: "auto", stress_multiplier: 1.0,
    context7_urgency: "preferred", wbp_verbosity: "normal", websearch: "off",
  },
  DIVERGENT: {
    enforcement: "relaxed", flow: "audit", flow_focus: ["no-write-without-clarification"], tdd: "lazy", tdd_focus: [],
    tier: "medium", thinking: "off", stress_multiplier: 0.5,
    context7_urgency: "optional", wbp_verbosity: "detailed", websearch: "off",
  },
  EXPLORING: {
    enforcement: "relaxed", flow: "audit", flow_focus: [], tdd: "lazy", tdd_focus: [],
    tier: "cheap", thinking: "off", stress_multiplier: 0.7,
    context7_urgency: "optional", wbp_verbosity: "detailed", websearch: "off",
  },
  REFINING: {
    enforcement: "normal", flow: "normal", flow_focus: [], tdd: "normal", tdd_focus: [],
    tier: "auto", thinking: "auto", stress_multiplier: 1.0,
    context7_urgency: "preferred", wbp_verbosity: "normal", websearch: "off",
  },
  IMPLEMENTING: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files"],
    tdd: "strict", tdd_focus: ["skeleton-on-write", "assertion-check"],
    tier: "brain", thinking: "brief", stress_multiplier: 1.3,
    context7_urgency: "required", wbp_verbosity: "normal", websearch: "off",
  },
  RESEARCH: {
    enforcement: "normal", flow: "audit", flow_focus: ["trace-audit"], tdd: "lazy", tdd_focus: [],
    tier: "brain", thinking: "full", stress_multiplier: 1.2,
    context7_urgency: "required", wbp_verbosity: "detailed", websearch: "allowed",
  },
  REVIEWING: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "no-lgtm"],
    tdd: "quality", tdd_focus: ["full-coverage", "edge-cases"],
    tier: "brain", thinking: "brief", stress_multiplier: 1.1,
    context7_urgency: "required", wbp_verbosity: "normal", websearch: "off",
  },
  DESIGNING: {
    enforcement: "normal", flow: "audit", flow_focus: ["trace-audit"], tdd: "normal", tdd_focus: [],
    tier: "brain", thinking: "full", stress_multiplier: 1.1,
    context7_urgency: "required", wbp_verbosity: "detailed", websearch: "allowed",
  },
  CONVERGING: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files"],
    tdd: "strict", tdd_focus: ["skeleton-on-write", "assertion-check"],
    tier: "brain", thinking: "brief", stress_multiplier: 1.5,
    context7_urgency: "required", wbp_verbosity: "minimal", websearch: "off",
  },
  LOOPING: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "suggest-alternative"],
    tdd: "strict", tdd_focus: ["skeleton-on-write", "assertion-check"],
    tier: "brain", thinking: "brief", stress_multiplier: 2.0,
    context7_urgency: "required", wbp_verbosity: "detailed", websearch: "off",
  },
  CLOSED: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "no-lgtm"],
    tdd: "quality", tdd_focus: ["full-coverage", "edge-cases"],
    tier: "brain", thinking: "brief", stress_multiplier: 2.0,
    context7_urgency: "required", wbp_verbosity: "minimal", websearch: "off",
  },
  FORENSIC: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "trace-audit"],
    tdd: "quality", tdd_focus: ["full-coverage", "edge-cases", "property-based"],
    tier: "brain", thinking: "full", stress_multiplier: 1.5,
    context7_urgency: "required", wbp_verbosity: "detailed", websearch: "encouraged",
  },
  AUDIT: {
    enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "security-scan"],
    tdd: "quality", tdd_focus: ["full-coverage", "edge-cases", "security-test"],
    tier: "brain", thinking: "full", stress_multiplier: 1.2,
    context7_urgency: "required", wbp_verbosity: "detailed", websearch: "encouraged",
  },
}

export const DEFAULT_REGIME_BASE = REGIME_AXIS_BASE.EXPLORING

// One row per canonical mode. Old runtime-mode identities (balanced/speed/budget/
// quality/audit/longrun/forensic) no longer exist as selectable modes — their intent
// is expressed via these axis defaults plus per-turn regime/stress flex.
export const MODE_AXIS_DEFAULTS: Record<Mode, Partial<AxisBundle>> = {
  vibemax: {
    tier: "medium", thinking: "auto", tdd: "normal", flow: "audit",
    enforcement: "normal", websearch: "off", wbp_verbosity: "normal",
  },
  vibeqmax: {
    tier: "brain", thinking: "full", tdd: "quality", flow: "strict",
    enforcement: "strict", websearch: "off", context7_urgency: "required", wbp_verbosity: "normal",
  },
  vibeultrax: {
    tier: "auto", thinking: "full", tdd: "quality", flow: "strict",
    enforcement: "strict", websearch: "off", context7_urgency: "required", wbp_verbosity: "detailed",
    stress_multiplier: 2.5,
  },
  vibelitex: {
    tier: "medium", thinking: "brief", tdd: "lazy", flow: "audit",
    enforcement: "normal", websearch: "off", context7_urgency: "preferred", wbp_verbosity: "normal",
  },
  raw: {},
}

export const RAW_AXIS_BUNDLE: AxisBundle = {
  enforcement: "off", flow: "off", flow_focus: [], tdd: "off", tdd_focus: [],
  tier: "brain", thinking: "full", stress_multiplier: 1.0,
  context7_urgency: "optional", wbp_verbosity: "normal", websearch: "off",
}

const LOOPING_HARDENING: Partial<AxisBundle> = {
  enforcement: "strict", flow: "strict", flow_focus: ["write-edit-check", "no-untouched-files", "suggest-alternative"],
  tdd: "strict", tdd_focus: ["skeleton-on-write", "assertion-check"],
  tier: "brain", thinking: "brief", context7_urgency: "required",
}

export type AxisOverrides = Partial<Record<AxisName, string>>

function normalizeRegime(regime?: string | null): Regime {
  const r = String(regime || "INIT").toUpperCase()
  return (r in REGIME_AXIS_BASE ? r : "EXPLORING") as Regime
}

/**
 * Composition order: raw bypass > regime base > mode defaults > user axis overrides >
 * LOOPING safety hardening (hardening cannot be overridden — it's a safety rail, not a
 * mode switch). stress_multiplier is read-time-computed and not user-overridable.
 */
export function computeAxisBundle(
  regime: string | undefined,
  mode: Mode,
  axisOverrides: AxisOverrides = {},
  stress = 0,
): AxisBundle {
  if (mode === "raw") return { ...RAW_AXIS_BUNDLE }

  const normalizedRegime = normalizeRegime(regime)
  const base = REGIME_AXIS_BASE[normalizedRegime] || DEFAULT_REGIME_BASE
  const modeDefaults = MODE_AXIS_DEFAULTS[mode] || {}
  const looping = normalizedRegime === "LOOPING"

  const merged: AxisBundle = {
    ...base,
    ...modeDefaults,
    ...(axisOverrides.enforcement ? { enforcement: axisOverrides.enforcement as EnforcementAxis } : {}),
    ...(axisOverrides.flow ? { flow: axisOverrides.flow as FlowAxis } : {}),
    ...(axisOverrides.tdd ? { tdd: axisOverrides.tdd as TddAxis } : {}),
    ...(axisOverrides.tier ? { tier: axisOverrides.tier as TierAxis } : {}),
    ...(axisOverrides.thinking ? { thinking: axisOverrides.thinking as ThinkingAxis } : {}),
    ...(axisOverrides.context7_urgency ? { context7_urgency: axisOverrides.context7_urgency as Context7Axis } : {}),
    ...(axisOverrides.wbp_verbosity ? { wbp_verbosity: axisOverrides.wbp_verbosity as WbpVerbosityAxis } : {}),
    ...(axisOverrides.websearch ? { websearch: axisOverrides.websearch as WebsearchAxis } : {}),
  }

  if (looping) {
    Object.assign(merged, LOOPING_HARDENING)
    merged.stress_multiplier = Math.max(2.0, Number(stress || 0))
  } else {
    merged.stress_multiplier = Number(modeDefaults.stress_multiplier ?? base.stress_multiplier ?? 1.0)
  }

  return merged
}

export function buildAxisDirectives(bundle: AxisBundle, mode: Mode, looping = false): string[] {
  if (mode === "raw") return []
  const d: string[] = []
  if (bundle.enforcement !== "normal") {
    d.push(`[delegation enforcement: ${bundle.enforcement}] ` +
      (bundle.enforcement === "relaxed"
        ? "Write/Edit restrictions are temporarily eased. Proceed with caution."
        : bundle.enforcement === "off"
          ? "Delegation enforcement is disabled."
          : "ALL write/edit operations must pass strict validation. No exceptions."))
  }
  if (bundle.flow !== "normal") {
    const focusNote = bundle.flow_focus.length > 0 ? ` Focus rules: ${bundle.flow_focus.join(", ")}.` : ""
    d.push(`[flow: ${bundle.flow}] Flow enforcer is in ${bundle.flow} mode.${focusNote}`)
  }
  if (bundle.tdd !== "normal") {
    const focusNote = bundle.tdd_focus.length > 0 ? ` Focus: ${bundle.tdd_focus.join(", ")}.` : ""
    d.push(`[tdd: ${bundle.tdd}] TDD enforcement is ${bundle.tdd}.${focusNote}`)
  }
  if (bundle.tier !== "auto") {
    d.push(`[tier routing] Route to ${bundle.tier} tier for this turn.`)
  }
  if (bundle.thinking !== "auto") {
    d.push(`[thinking mode: ${bundle.thinking}] Reasoning depth set to ${bundle.thinking}. ` +
      (bundle.thinking === "off"
        ? "Skip extended thinking entirely. Respond directly and concisely."
        : "Use extended thinking only for genuinely complex multi-step problems."))
  }
  if (bundle.context7_urgency !== "preferred") {
    d.push(`[context7] Documentation lookup is ${bundle.context7_urgency}. ` +
      (bundle.context7_urgency === "required"
        ? "You MUST use mcp__context7__* tools before any web search for library/framework docs."
        : "context7 tools are available but not required."))
  }
  if (bundle.websearch !== "off") {
    d.push(`[websearch: ${bundle.websearch}] Web research is ${bundle.websearch}. ` +
      (bundle.websearch === "encouraged"
        ? "Prefer verifying claims against current external sources before asserting facts."
        : "Web research may be used if helpful."))
  }
  if (bundle.wbp_verbosity !== "normal") {
    d.push(`[wbp protocol] Delegation output synthesis is ${bundle.wbp_verbosity}. ` +
      (bundle.wbp_verbosity === "minimal"
        ? "Summarize subagent results in 1-2 sentences."
        : "Provide full detail from subagent output including code changes and rationale."))
  }
  if (looping) {
    d.push(`[loop prevention] The conversation may be looping — stop repeating the same answer path and try a different approach.`)
  }
  return d
}

export const REGIME_CONTROL_TABLE: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(REGIME_AXIS_BASE).map(([regime, b]) => [regime, {
    enforcement_mode: b.enforcement,
    flow_mode: b.flow,
    tdd_mode: b.tdd,
    tier_bias: b.tier,
    thinking_mode: b.thinking,
    wbp_verbosity: b.wbp_verbosity,
    context7_urgency: b.context7_urgency,
    stress_multiplier: b.stress_multiplier,
  }])
)
