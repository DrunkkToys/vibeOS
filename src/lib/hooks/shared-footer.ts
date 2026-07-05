// SPDX-License-Identifier: MIT
// Shared footer formatting — single source of truth for text.complete and tool.execute.after

import { BRANDED_MODES, RUNTIME_MODES, MODE_TABLE, normalizeLegacyMode } from "../mode-router.js"

export interface FooterLineInput {
  activeSlot: string
  sessionSlot?: string
  workerSlot?: string
  providerLabel: string
  modelName: string
  savingsTotal?: number
  ltTotal?: number
  ltTrend?: string
  vibeBrand: string
  optMode: string
  flashIcon: string
  enfTags: string[]
  subRegime?: string
  stressGauge?: string
  cascadeIcon?: string
  cascadeLabel?: string
  claimTag?: string
  rewardTag?: string
  alertTag?: string
}

const REGIME_TAG: Record<string, string> = {
  INIT: "Starting",
  DIVERGENT: "Off-track",
  EXPLORING: "Exploring",
  REFINING: "Refining",
  IMPLEMENTING: "Building",
  RESEARCH: "Researching",
  REVIEWING: "Reviewing",
  DESIGNING: "Designing",
  CONVERGING: "Converging",
  CLOSED: "Closed",
  LOOPING: "Looping",
  AUDIT: "Auditing",
  FORENSIC: "Deep dive",
}

const REGIME_ICON: Record<string, string> = {
  INIT: "◌",
  DIVERGENT: "⇄",
  EXPLORING: "⌕",
  REFINING: "✎",
  IMPLEMENTING: "⚙",
  RESEARCH: "⌁",
  REVIEWING: "✓",
  DESIGNING: "◫",
  CONVERGING: "⟲",
  CLOSED: "◆",
  LOOPING: "↻",
  AUDIT: "☑",
  FORENSIC: "⟁",
}

const BRAND_MAP: Record<string, string> = {
  ...Object.fromEntries(Object.entries(MODE_TABLE).flatMap(([, mode]) => {
    const aliases = [mode.id]
    if (mode.id === "vibelitex") aliases.push("litex")
    return aliases.map((alias) => [alias, mode.name])
  })),
  ...Object.fromEntries(RUNTIME_MODES.map(m => [m.id, m.name])),
}

const TIER_ICON: Record<string, string> = {
  brain: "\u{1F9E0}",
  medium: "\u25D0",
  cheap: "\u26A1",
  free: "\u{1F381}",
}

export function resolveBrand(optMode: string, _activeSlot: string): string {
  const raw = String(optMode || "").trim().toLowerCase()
  if (!raw || raw === "auto") return "vibeOS"
  if (raw === "raw") return MODE_TABLE.raw.name
  const isKnownMode = BRANDED_MODES.some((mode) => mode.id === raw) || RUNTIME_MODES.some((mode) => mode.id === raw)
  const isKnownAlias = raw === "litex"
  if (!isKnownMode && !isKnownAlias) return "vibeOS"
  try {
    const canonical = normalizeLegacyMode(raw)
    return MODE_TABLE[canonical]?.name || "vibeOS"
  } catch {
    return "vibeOS"
  }
}

export function resolveTierIcon(slot: string): string {
  return TIER_ICON[slot] || "\u26A1"
}

export type CascadeTier = "cheap" | "medium" | "brain"

export interface CascadeTierResolution {
  tier: CascadeTier
  depth: number
}

interface CascadeTierSessionState {
  route_path?: unknown
  pipeline_root?: unknown
  cascade_depth?: unknown
}

function _asTier(value: unknown): CascadeTier | null {
  return value === "cheap" || value === "medium" || value === "brain" ? value : null
}

// Single resolver for "what tier is currently active" \u2014 the depth icon
// (\u25B8/\u25B8\u25B8/\u25B8\u25B8\u25B8) and the tier label both come from this one read of `route_path`
// so they can never disagree. Used by both tool.execute.after and
// experimental.text.complete.
export function resolveActiveCascadeTier(opts: {
  liveSession?: CascadeTierSessionState
  diskSession?: CascadeTierSessionState
  // Pre-session-scoped schema (root-level control_vector.cascade_depth / cascade_depth).
  // Only used for the depth number when neither session has route_path/pipeline_root.
  legacyDepth?: number
  liveModel?: string
  trinityCheap?: string
  trinityMedium?: string
  trinityBrain?: string
  classify?: (model: string) => string
}): CascadeTierResolution {
  for (const session of [opts.liveSession, opts.diskSession]) {
    const routePath = Array.isArray(session?.route_path) ? (session!.route_path as unknown[]) : []
    const tier = routePath.length ? _asTier(routePath[routePath.length - 1]) : null
    if (tier) return { tier, depth: routePath.length }
  }
  for (const session of [opts.liveSession, opts.diskSession]) {
    const pipelineRoot = Array.isArray(session?.pipeline_root) ? (session!.pipeline_root as unknown[]) : []
    const depth = Number(session?.cascade_depth) || 0
    if (pipelineRoot.length && depth > 0) {
      const tier = _asTier(pipelineRoot[Math.min(depth, pipelineRoot.length) - 1])
      if (tier) return { tier, depth }
    }
  }
  const legacyDepth = Number(opts.legacyDepth) || 0
  const m = opts.liveModel || ""
  if (opts.trinityCheap && m === opts.trinityCheap) return { tier: "cheap", depth: legacyDepth || 1 }
  if (opts.trinityMedium && m === opts.trinityMedium) return { tier: "medium", depth: legacyDepth || 2 }
  if (opts.trinityBrain && m === opts.trinityBrain) return { tier: "brain", depth: legacyDepth || 3 }
  const c = String((opts.classify ? opts.classify(m) : "") || "").toLowerCase()
  const tier: CascadeTier = c === "high" || c === "brain" ? "brain" : c === "mid" || c === "medium" ? "medium" : "cheap"
  return { tier, depth: legacyDepth || (tier === "brain" ? 3 : tier === "medium" ? 2 : 1) }
}

export function resolveRegimeIcon(subRegime: string): string {
  return REGIME_ICON[String(subRegime || "").toUpperCase()] || "◦"
}

export function formatModeLabel(optMode: string): string {
  const normalized = String(optMode || "").toLowerCase()
  if (!normalized) return ""
  if (normalized === "vibemax") return "VibeMaX"
  if (normalized === "vibelitex" || normalized === "litex") return "VibeLiteX"
  if (normalized === "vibeqmax") return "VibeQMaX"
  if (normalized === "vibeultrax") return "VibeUltraX"
  if (normalized === "speed") return "Speed"
  if (normalized === "longrun") return "Longrun"
  if (normalized === "audit") return "Audit"
  if (normalized === "forensic") return "Forensic"
  if (normalized === "balanced") return "Balanced"
  if (normalized === "budget") return "Budget"
  if (normalized === "quality") return "Quality"
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export function formatEnforcementPulse(enfTags: string[]): string {
  const tags = new Set(enfTags || [])
  const parts: string[] = []

  if (tags.has("[Q&A]")) {
    parts.push("quiet mode")
  } else {
    if (tags.has("[ENF ON]") || tags.has("[STRICT]")) parts.push("guarded")
    if (tags.has("[FLOW ON]")) parts.push("flow steady")
    if (tags.has("[TDD ON]")) parts.push("tests live")
  }

  if (tags.has("[LOCK ON]")) parts.push("locked")

  return parts.join(" · ")
}

export function trendGlyph(trend?: string): string {
  if (trend === "up") return "↗"
  if (trend === "down") return "↘"
  return "→"
}

export function formatSavingsPulse(amountUsd: number, trend?: string): string {
  const amount = Number(amountUsd || 0)
  if (!Number.isFinite(amount) || amount <= 0) return ""
  const arrow = trendGlyph(trend)
  return `$${amount.toFixed(2)} saved${arrow !== "→" ? ` ${arrow}` : ""}`
}

export function formatCascadePulse(cascadeIcon?: string, cascadeLabel?: string): string {
  const icon = String(cascadeIcon || "").trim()
  const label = String(cascadeLabel || "").trim()
  if (!icon && !label) return ""
  return [icon, label].filter(Boolean).join(" ")
}

// Shared state resolver — normalizes partial/optional footer state into a complete
// FooterLineInput with safe defaults. Used by both the rich path and the degrade path
// so they always produce the same footer line format.
export function resolveFooterState(partial?: Partial<FooterLineInput> | null): FooterLineInput {
  const p = partial && typeof partial === "object" ? partial : {}
  const savingsTotalNum = Number(p.savingsTotal ?? p.ltTotal)
  return {
    activeSlot: typeof p.activeSlot === "string" && p.activeSlot ? p.activeSlot : "cheap",
    sessionSlot: p.sessionSlot,
    workerSlot: p.workerSlot,
    providerLabel: typeof p.providerLabel === "string" && p.providerLabel ? p.providerLabel : "Unknown",
    modelName: typeof p.modelName === "string" && p.modelName ? p.modelName : "unknown",
    savingsTotal: Number.isFinite(savingsTotalNum) ? savingsTotalNum : 0,
    ltTotal: Number.isFinite(savingsTotalNum) ? savingsTotalNum : 0,
    ltTrend: p.ltTrend,
    vibeBrand: typeof p.vibeBrand === "string" ? p.vibeBrand : "",
    optMode: typeof p.optMode === "string" ? p.optMode : "",
    flashIcon: typeof p.flashIcon === "string" ? p.flashIcon : "",
    enfTags: Array.isArray(p.enfTags) ? p.enfTags : [],
    subRegime: p.subRegime,
    stressGauge: p.stressGauge,
    cascadeIcon: p.cascadeIcon,
    cascadeLabel: p.cascadeLabel,
    claimTag: p.claimTag,
    rewardTag: p.rewardTag,
    alertTag: p.alertTag,
  }
}

// SINGLE SOURCE OF TRUTH degrade path. There is exactly ONE footer line format
// (buildFooterLine). When the rich path can't gather every field (a sub-call threw,
// or this is the index.ts safety net), we still render the SAME README line with safe
// defaults for the missing fields — never a different, shorter, alert-less line.
export function buildResilientFooterLine(partial?: Partial<FooterLineInput> | null): string {
  const state = resolveFooterState(partial)
  if (!state.vibeBrand) {
    state.vibeBrand = resolveBrand(state.optMode, state.activeSlot)
  }
  try {
    return buildFooterLine(state)
  } catch {
    const cascade = formatCascadePulse(state.cascadeIcon, state.cascadeLabel)
    const alert = state.alertTag ? ` | ${state.alertTag}` : ""
    const cascadePart = cascade ? ` | ${cascade}` : ""
    return `— ${resolveTierIcon(state.activeSlot)} ${state.activeSlot} | ${state.providerLabel} | ${state.modelName} | VIBE${cascadePart} | ${state.vibeBrand || "vibeOS"}${alert} —`
  }
}

export function buildEnforcementTags(opts: {
  delegationEnforce: boolean
  flowEnforce: boolean
  tddEnforce: boolean
  bbMode: string
  modelLocked: boolean
  quietIntent?: boolean
}): string[] {
  const tags: string[] = []
  if (opts.quietIntent || opts.bbMode === "relaxed") {
    tags.push("[Q&A]")
  } else {
    if (opts.delegationEnforce) tags.push("[ENF ON]")
    if (opts.flowEnforce) tags.push("[FLOW ON]")
    if (opts.tddEnforce) tags.push("[TDD ON]")
    if (opts.bbMode === "strict") tags.push("[STRICT]")
  }
  if (opts.modelLocked) tags.push("[LOCK ON]")
  return tags
}

export function buildFooterAlert(opts: {
  apiDegraded?: boolean
  apiSlow?: boolean
  liveModel?: string
  expectedModel?: string
  lastModelError?: string
  pendingLiveModel?: string
} | null = {}): string {
  opts = opts || {}
  const alerts: string[] = []
  if (opts.apiSlow) alerts.push("⚠ api slow")
  if (opts.apiDegraded && String(opts.lastModelError || "").trim()) alerts.push("⚠ api degraded")
  const expectedToCompare = opts.pendingLiveModel || opts.expectedModel
  if (opts.liveModel && expectedToCompare && opts.liveModel !== expectedToCompare) {
    if (opts.pendingLiveModel) {
      alerts.push("⚠ switch pending")
    } else {
      alerts.push("⚠ model drift")
    }
  }
  const err = String(opts.lastModelError || "")
  if (err && (err.includes("EHOSTUNREACH") || err.includes("ENOTFOUND") || err.includes("ETIMEDOUT"))) {
    alerts.push("⚠ model unreachable")
  }
  return alerts.join(" · ")
}

export function buildFooterLine(input: FooterLineInput): string {
  const { activeSlot, providerLabel, modelName, ltTrend, vibeBrand, optMode, flashIcon, enfTags, subRegime } = input
  const savingsTotal = Number.isFinite(Number(input.savingsTotal ?? input.ltTotal)) ? Number(input.savingsTotal ?? input.ltTotal) : 0

  const tierIcon = resolveTierIcon(activeSlot)
  const regimeTag = subRegime ? REGIME_TAG[subRegime] || subRegime.slice(0, 4) : null
  const regimeIcon = subRegime ? resolveRegimeIcon(subRegime) : null
  const modeLabel = formatModeLabel(optMode)
  const workerSuffix = input.workerSlot ? ` [${input.workerSlot}]` : ""
  let line = `\u2014 ${tierIcon} ${activeSlot} | ${providerLabel} | ${modelName}${workerSuffix}${regimeTag ? ` \u25B6 ${regimeIcon} ${regimeTag}` : ""}`

  if (savingsTotal > 0) {
    const savingsPulse = formatSavingsPulse(savingsTotal, ltTrend)
    if (savingsPulse) line += ` | ${savingsPulse}`
  } else {
    line += " | VIBE"
  }

  if (vibeBrand) {
    line += ` | ${vibeBrand}${flashIcon}`
  } else if (flashIcon.trim()) {
    line += ` | ${flashIcon.trim()}`
  }

  const cascadePulse = formatCascadePulse(input.cascadeIcon, input.cascadeLabel)
  if (cascadePulse) {
    line += ` | ${cascadePulse}`
  }

  const enforcementPulse = formatEnforcementPulse(enfTags)
  if (enforcementPulse) {
    line += ` | ${enforcementPulse}`
  }

  if (input.alertTag) {
    line += ` | ${input.alertTag}`
  }

  if (input.stressGauge) {
    line += ` | ${input.stressGauge}`
  }

  if (input.claimTag) {
    line += ` | ${input.claimTag}`
  }

  if (input.rewardTag) {
    line += ` | ${input.rewardTag}`
  }

  line += " \u2014"

  return line
}
